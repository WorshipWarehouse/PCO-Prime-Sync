import type {
  PcoPlan,
  PcoPlanItem,
  PcoPlanPerson,
  PcoPlanSnapshot,
  PcoServiceType,
  PcoTeam,
} from '../../shared/types';
import { normalizeEmail, isPlausibleEmail, toIsoDateInTimeZone } from '../../shared/naming';
import type { PcoArrangement } from '../../shared/types';
import {
  PcoClient,
  PcoNotFoundError,
  indexIncluded,
  relatedId,
  toResource,
  type JsonApiResource,
} from './client';

/**
 * Planning Center adapter interface.
 *
 * Every endpoint used here was verified against the official Services API v2
 * documentation (2018-11-01 version):
 *   GET /services/v2/service_types
 *   GET /services/v2/service_types/{id}/teams
 *   GET /services/v2/service_types/{id}/plans
 *   GET /services/v2/service_types/{id}/plans/{plan}/items        ?include=arrangement,key,song
 *   GET /services/v2/service_types/{id}/plans/{plan}/team_members ?include=person,team
 *   GET /services/v2/songs/{song}/arrangements                    ?include=keys
 *   GET /services/v2/people                                       ?include=emails
 *   GET /services/v2/people/{id}                                  ?include=emails
 */
export interface PcoConnectionResult {
  ok: boolean;
  message: string;
  serviceTypeCount: number | null;
}

export interface PcoAdapter {
  readonly kind: 'http' | 'mock';
  verifyConnection(): Promise<PcoConnectionResult>;
  listServiceTypes(): Promise<PcoServiceType[]>;
  listTeams(serviceTypeIds: string[]): Promise<PcoTeam[]>;
  listPlans(serviceTypeIds: string[], fromDate: string, toDate: string): Promise<PcoPlan[]>;
  getPlanSnapshot(plan: PcoPlan, worshipTeamIds: string[]): Promise<PcoPlanSnapshot>;
  listArrangements(songId: string): Promise<PcoArrangement[]>;
  close?(): Promise<void>;
}

export interface HttpPcoAdapterOptions {
  appId: string;
  secret: string;
  client?: PcoClient;
  timezone?: string;
}

const ITEM_TYPE_SONG = 'song';

export class HttpPcoAdapter implements PcoAdapter {
  readonly kind = 'http' as const;
  private readonly client: PcoClient;
  private readonly timezone: string;
  private readonly arrangementCache = new Map<string, PcoArrangement[]>();
  private readonly emailCache = new Map<string, { raw: string | null; email: string | null }>();

  constructor(options: HttpPcoAdapterOptions) {
    this.client =
      options.client ??
      new PcoClient({
        appId: options.appId,
        secret: options.secret,
      });
    this.timezone = options.timezone ?? 'America/New_York';
  }

  async verifyConnection(): Promise<PcoConnectionResult> {
    try {
      const types = await this.listServiceTypes();
      return {
        ok: true,
        message: `Connected to Planning Center (${types.length} service type${types.length === 1 ? '' : 's'} visible)`,
        serviceTypeCount: types.length,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Planning Center connection failed',
        serviceTypeCount: null,
      };
    }
  }

  async listServiceTypes(): Promise<PcoServiceType[]> {
    const resources = await this.client.paginate('/services/v2/service_types', { per_page: 100 });
    return resources
      .map(toResource)
      .filter((r): r is JsonApiResource => Boolean(r))
      .map((r) => ({ id: r.id, name: String(r.attributes.name ?? `Service type ${r.id}`) }));
  }

  async listTeams(serviceTypeIds: string[]): Promise<PcoTeam[]> {
    const teams: PcoTeam[] = [];
    const seen = new Set<string>();
    for (const serviceTypeId of serviceTypeIds) {
      const resources = await this.client.paginate(`/services/v2/service_types/${serviceTypeId}/teams`, {
        per_page: 100,
      });
      for (const resource of resources.map(toResource)) {
        if (!resource || seen.has(resource.id)) continue;
        seen.add(resource.id);
        teams.push({
          id: resource.id,
          name: String(resource.attributes.name ?? `Team ${resource.id}`),
          serviceTypeId,
          archived: Boolean(resource.attributes.archived_at),
        });
      }
    }
    return teams.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List plans for the configured service types inside the date window.
   *
   * PCO's plan collection exposes `order=sort_date`; we request descending
   * order and stop paging once we pass the window start, which avoids pulling
   * the entire plan history for large accounts.
   */
  async listPlans(serviceTypeIds: string[], fromDate: string, toDate: string): Promise<PcoPlan[]> {
    const plans: PcoPlan[] = [];
    for (const serviceTypeId of serviceTypeIds) {
      const resources = await this.client.paginate(
        `/services/v2/service_types/${serviceTypeId}/plans`,
        { per_page: 100, order: '-sort_date' },
        {
          maxPages: 15,
          stopWhen: (doc) => {
            const page = (Array.isArray(doc.data) ? doc.data : [doc.data]).map(toResource).filter(Boolean);
            if (page.length === 0) return true;
            return page.every((resource) => {
              const sortDate = resource?.attributes.sort_date;
              const date = typeof sortDate === 'string' ? sortDate.slice(0, 10) : null;
              return date !== null && date < fromDate;
            });
          },
        },
      );

      for (const resource of resources.map(toResource)) {
        if (!resource) continue;
        const plan = this.mapPlan(resource, serviceTypeId);
        if (plan.planDate >= fromDate && plan.planDate <= toDate) plans.push(plan);
      }
    }
    return plans.sort((a, b) => (a.planDate === b.planDate ? a.title.localeCompare(b.title) : a.planDate < b.planDate ? -1 : 1));
  }

  private mapPlan(resource: JsonApiResource, serviceTypeId: string): PcoPlan {
    const attributes = resource.attributes;
    const sortDate = typeof attributes.sort_date === 'string' ? attributes.sort_date : null;
    const planDate = sortDate
      ? toIsoDateInTimeZone(new Date(sortDate), this.timezone)
      : this.fallbackPlanDate(attributes);
    return {
      id: resource.id,
      serviceTypeId,
      title: String(attributes.title ?? 'Untitled plan'),
      seriesTitle: typeof attributes.series_title === 'string' ? attributes.series_title : null,
      sortDate,
      planDate,
      dates: typeof attributes.dates === 'string' ? attributes.dates : null,
      itemsCount: Number(attributes.items_count ?? 0),
      updatedAt: typeof attributes.updated_at === 'string' ? attributes.updated_at : null,
    };
  }

  private fallbackPlanDate(attributes: Record<string, unknown>): string {
    const dates = typeof attributes.dates === 'string' ? attributes.dates : '';
    const match = /(\d{4})-(\d{2})-(\d{2})/.exec(dates);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    return new Date().toISOString().slice(0, 10);
  }

  async getPlanSnapshot(plan: PcoPlan, worshipTeamIds: string[]): Promise<PcoPlanSnapshot> {
    const [items, people] = await Promise.all([
      this.getPlanItems(plan),
      this.getPlanPeople(plan, worshipTeamIds),
    ]);
    return { plan, items, people };
  }

  private async getPlanItems(plan: PcoPlan): Promise<PcoPlanItem[]> {
    const { data, included } = await this.fetchAllWithIncludes(
      `/services/v2/service_types/${plan.serviceTypeId}/plans/${plan.id}/items`,
      'arrangement,key,song',
    );
    const includedIndex = included;

    const items: PcoPlanItem[] = [];
    for (const resource of data) {
      if (String(resource.attributes.item_type ?? '') !== ITEM_TYPE_SONG) continue;
      const songId = relatedId(resource, 'song');
      if (!songId) continue; // Song items without a linked song cannot be matched.
      const arrangementId = relatedId(resource, 'arrangement');
      const arrangement = arrangementId ? includedIndex.get(`Arrangement:${arrangementId}`) : undefined;
      const keyId = relatedId(resource, 'key');
      const key = keyId ? includedIndex.get(`Key:${keyId}`) : undefined;
      const keyName =
        typeof resource.attributes.key_name === 'string' && resource.attributes.key_name.trim() !== ''
          ? resource.attributes.key_name.trim()
          : typeof key?.attributes.name === 'string'
            ? key.attributes.name.trim()
            : null;

      items.push({
        id: resource.id,
        planId: plan.id,
        itemType: String(resource.attributes.item_type ?? ''),
        title: String(resource.attributes.title ?? 'Untitled song'),
        sequence: Number(resource.attributes.sequence ?? 0),
        servicePosition: String(resource.attributes.service_position ?? 'during'),
        keyName,
        songId,
        arrangementId,
        arrangementName:
          arrangement && typeof arrangement.attributes.name === 'string' ? arrangement.attributes.name : null,
        arrangementBpm:
          arrangement && typeof arrangement.attributes.bpm === 'number' ? Number(arrangement.attributes.bpm) : null,
        keyId,
      });
    }

    // PCO `sequence` is the plan order; keep it stable and ascending.
    return items.sort((a, b) => a.sequence - b.sequence);
  }

  /** Paginate a collection while merging the `included` side-loads. */
  private async fetchAllWithIncludes(
    path: string,
    include: string,
  ): Promise<{ data: JsonApiResource[]; included: Map<string, JsonApiResource> }> {
    const resources: JsonApiResource[] = [];
    const includedMap = new Map<string, JsonApiResource>();
    const perPage = 100;

    for (let page = 0; page < 20; page += 1) {
      const doc = await this.client.request(path, { per_page: perPage, offset: page * perPage, include });
      const pageData = (Array.isArray(doc.data) ? doc.data : [doc.data])
        .map(toResource)
        .filter((r): r is JsonApiResource => Boolean(r));
      resources.push(...pageData);
      for (const [key, value] of indexIncluded(doc.included)) includedMap.set(key, value);
      if (pageData.length < perPage) break;
    }

    return { data: resources, included: includedMap };
  }

  private async getPlanPeople(plan: PcoPlan, worshipTeamIds: string[]): Promise<PcoPlanPerson[]> {
    if (worshipTeamIds.length === 0) return [];

    const { data, included } = await this.fetchAllWithIncludes(
      `/services/v2/service_types/${plan.serviceTypeId}/plans/${plan.id}/team_members`,
      'person,team',
    );

    const allowed = new Set(worshipTeamIds.map((id) => id.trim()));
    const selected: PcoPlanPerson[] = [];

    for (const resource of data) {
      const teamId = relatedId(resource, 'team');
      if (!teamId || !allowed.has(teamId)) continue;

      const status = typeof resource.attributes.status === 'string' ? resource.attributes.status : null;
      // Declined volunteers are not scheduled for the service.
      if (status === 'D' || status === 'Declined') continue;

      const personId = relatedId(resource, 'person');
      if (!personId) continue;

      const person = included.get(`Person:${personId}`);
      const team = included.get(`Team:${teamId}`);
      const displayName =
        typeof resource.attributes.name === 'string' && resource.attributes.name.trim() !== ''
          ? resource.attributes.name.trim()
          : String(person?.attributes.full_name ?? 'Unknown');

      selected.push({
        id: resource.id,
        planId: plan.id,
        personId,
        name: displayName,
        teamId,
        teamName: team && typeof team.attributes.name === 'string' ? team.attributes.name : null,
        teamPositionName:
          typeof resource.attributes.team_position_name === 'string'
            ? resource.attributes.team_position_name
            : null,
        status,
        email: null,
        rawEmail: null,
      });
    }

    // Deduplicate: a person scheduled on several worship teams maps to one member.
    const deduped = new Map<string, PcoPlanPerson>();
    for (const person of selected) {
      const existing = deduped.get(person.personId);
      if (!existing) {
        deduped.set(person.personId, person);
        continue;
      }
      // Keep the first scheduled team, but remember additional teams in the name.
      if (person.teamName && existing.teamName && person.teamName !== existing.teamName) {
        existing.teamName = `${existing.teamName}, ${person.teamName}`;
      }
    }

    const people = [...deduped.values()];
    const emails = await this.getPersonEmails(people.map((person) => person.personId));
    for (const person of people) {
      const email = emails.get(person.personId);
      person.rawEmail = email?.raw ?? null;
      person.email = email?.email ?? null;
    }

    return people.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetch email addresses for people. Tries one batched request per 50 ids
   * (`where[id]=1,2,3` is supported by the Services people collection) and
   * falls back to individual reads for anything the batch did not return.
   */
  async getPersonEmails(personIds: string[]): Promise<Map<string, { raw: string | null; email: string | null }>> {
    const result = new Map<string, { raw: string | null; email: string | null }>();
    const missing: string[] = [];

    for (const personId of personIds) {
      const cached = this.emailCache.get(personId);
      if (cached) result.set(personId, cached);
      else missing.push(personId);
    }
    if (missing.length === 0) return result;

    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      try {
        const doc = await this.client.request('/services/v2/people', {
          per_page: 100,
          include: 'emails',
          'where[id]': batch.join(','),
        });
        const resources = (Array.isArray(doc.data) ? doc.data : [doc.data])
          .map(toResource)
          .filter((r): r is JsonApiResource => Boolean(r));
        const includedIndex = indexIncluded(doc.included);
        for (const resource of resources) {
          const email = pickPrimaryEmail(resource, includedIndex);
          result.set(resource.id, email);
          this.emailCache.set(resource.id, email);
        }
      } catch {
        // Fall through to individual lookups below.
      }
    }

    const stillMissing = missing.filter((id) => !result.has(id));
    for (const personId of stillMissing) {
      try {
        const doc = await this.client.request(`/services/v2/people/${personId}`, { include: 'emails' });
        const resource = toResource(Array.isArray(doc.data) ? doc.data[0] : doc.data);
        const includedIndex = indexIncluded(doc.included);
        const email = resource
          ? pickPrimaryEmail(resource, includedIndex)
          : { raw: null, email: null };
        result.set(personId, email);
        this.emailCache.set(personId, email);
      } catch (error) {
        if (error instanceof PcoNotFoundError) {
          result.set(personId, { raw: null, email: null });
          continue;
        }
        throw error;
      }
    }

    return result;
  }

  async listArrangements(songId: string): Promise<PcoArrangement[]> {
    const cached = this.arrangementCache.get(songId);
    if (cached) return cached;

    const { data, included } = await this.fetchAllWithIncludes(
      `/services/v2/songs/${songId}/arrangements`,
      'keys',
    );

    const arrangements: PcoArrangement[] = data.map((resource) => {
      const keyIds = (resource.relationships.keys?.data ?? []) as Array<{ id: string; type: string }>;
      const keys = keyIds
        .map((rel) => included.get(`Key:${rel.id}`))
        .filter((key): key is JsonApiResource => Boolean(key))
        .map((key) => ({
          id: key.id,
          name: String(key.attributes.name ?? ''),
          startingKey:
            typeof key.attributes.starting_key === 'string'
              ? key.attributes.starting_key
              : typeof key.attributes.name === 'string'
                ? key.attributes.name
                : null,
        }));
      return {
        id: resource.id,
        name: String(resource.attributes.name ?? ''),
        bpm: typeof resource.attributes.bpm === 'number' ? Number(resource.attributes.bpm) : null,
        keys,
      };
    });

    this.arrangementCache.set(songId, arrangements);
    return arrangements;
  }
}

/**
 * Prefer the primary email, then a "Home" address, then any plausible address.
 * Emails are matched case-insensitively, so the normalized value is returned too.
 */
export function pickPrimaryEmail(
  person: JsonApiResource,
  included: Map<string, JsonApiResource>,
): { raw: string | null; email: string | null } {
  const rel = person.relationships.emails?.data;
  const refs = Array.isArray(rel) ? rel : rel ? [rel] : [];
  const emails = refs
    .map((ref) => included.get(`Email:${ref.id}`))
    .filter((email): email is JsonApiResource => Boolean(email))
    .map((email) => ({
      address: String(email.attributes.address ?? '').trim(),
      primary: Boolean(email.attributes.primary),
      location: String(email.attributes.location ?? ''),
    }))
    .filter((email) => isPlausibleEmail(email.address));

  if (emails.length === 0) return { raw: null, email: null };
  const chosen =
    emails.find((e) => e.primary) ??
    emails.find((e) => e.location.toLowerCase() === 'home') ??
    emails[0]!;
  return { raw: chosen.address, email: normalizeEmail(chosen.address) };
}
