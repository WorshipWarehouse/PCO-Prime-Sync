import type {
  ArrangementChoice,
  ChurchSettings,
  PcoPlan,
  PcoPlanItem,
  PrimeTeamMember,
  PrimeTrack,
  SongMapping,
} from '../../shared/types';
import { buildSetlistName, normalizeEmail, normalizeSongName } from '../../shared/naming';
import { selectArrangement, primeArrangementForTrack } from '../matching/arrangements';
import { matchSongToTracks } from '../matching/songs';
import { matchMusicianByEmail } from '../matching/musicians';
import type { PcoAdapter } from '../pco/adapter';
import type { PrimeAdapter } from '../prime/adapter';
import type { PlanMusicianInput, PlanSongInput, Repository } from '../db/repo';
import type { ServicePlanRecord } from '../../shared/types';
import { normalizePlan } from './plan-record';

export interface ResolvedSong {
  item: PcoPlanItem;
  position: number;
  title: string;
  normalizedTitle: string;
  arrangementChoice: ArrangementChoice;
  arrangementPcoId: string | null;
  arrangementPcoName: string | null;
  keyName: string | null;
  bpm: number | null;
  mapping: SongMapping | null;
  trackId: string | null;
  trackName: string | null;
  primeArrangementId: string | null;
  primeArrangementName: string | null;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched' | 'review';
  candidates: PrimeTrack[];
  issue: string | null;
}

export interface ResolvedMusician {
  pcoPersonId: string;
  name: string;
  email: string | null;
  rawEmail: string | null;
  teamId: string | null;
  teamName: string | null;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched' | 'review';
  primeMemberId: string | null;
  primeMemberName: string | null;
  candidates: PrimeTeamMember[];
  issue: string | null;
}

export interface DesiredPlan {
  plan: PcoPlan;
  record: ServicePlanRecord;
  setlistName: string;
  songs: ResolvedSong[];
  musicians: ResolvedMusician[];
  /** Reasons that make writing to Prime unsafe (unmatched songs, etc.). */
  blockedReasons: string[];
  /** Non-blocking issues (musician mapping) surfaced for review. */
  warnings: string[];
}

export interface ResolveDeps {
  repo: Repository;
  pco: PcoAdapter;
  prime: PrimeAdapter;
  settings: ChurchSettings;
  /** Per-run recording hooks; kept optional so preview mode can skip persistence. */
  recordError?: (input: {
    scope: string;
    code: string;
    message: string;
    detail?: string | null;
    pcoPlanId: string | null;
  }) => void;
}

export interface ResolveCache {
  trackSearch: Map<string, PrimeTrack[]>;
  members: PrimeTeamMember[] | null;
}

export function createResolveCache(): ResolveCache {
  return { trackSearch: new Map(), members: null };
}

/**
 * Turn one PCO plan into the desired Prime state, persisting the snapshot and
 * any newly confirmed unique mappings.
 *
 * Rules enforced here:
 *  - arrangement: Default, else Original, else manual review
 *  - key: always the PCO plan item key (never inferred from BPM/arrangement)
 *  - song match: exact normalized name; ambiguity is never auto-resolved
 *  - musician match: normalized email only; ambiguity is never auto-resolved
 */
export async function resolveDesiredPlan(
  plan: PcoPlan,
  deps: ResolveDeps,
  cache: ResolveCache,
): Promise<DesiredPlan> {
  const { repo, pco, prime, settings } = deps;
  const worshipTeamIds = repo.getWorshipTeamIds();
  const planRecord = repo.upsertPlan(normalizePlan(plan));
  const snapshot = await pco.getPlanSnapshot(plan, worshipTeamIds);

  const songs: ResolvedSong[] = [];
  const planSongRows: PlanSongInput[] = [];
  const blockedReasons: string[] = [];
  const warnings: string[] = [];

  const songItems = snapshot.items
    .filter((item) => item.itemType === 'song' && item.songId)
    .sort((a, b) => a.sequence - b.sequence);

  for (const [index, item] of songItems.entries()) {
    const position = index + 1;
    const normalizedTitle = normalizeSongName(item.title);
    const arrangements = item.songId ? await pco.listArrangements(item.songId) : [];
    const selection = selectArrangement(arrangements);

    let matchStatus: ResolvedSong['matchStatus'] = 'matched';
    let mapping = repo.getSongMappingByName(normalizedTitle);
    let candidates: PrimeTrack[] = [];
    let issue: string | null = null;

    if (selection.choice === 'none') {
      matchStatus = 'review';
      issue = selection.reason ?? 'No Default or Original arrangement available';
    }

    if (!mapping) {
      const tracks = await searchTracks(item.title, normalizedTitle, deps, cache);
      const match = matchSongToTracks(item.title, tracks);
      candidates = match.candidates;
      if (match.status === 'matched' && match.matched) {
        mapping = repo.upsertSongMapping({
          pcoSongId: item.songId,
          pcoSongTitle: item.title,
          primeTrackId: match.matched.id,
          primeTrackName: match.matched.title,
          confirmed: true,
          source: 'auto',
        });
      } else if (match.status === 'ambiguous') {
        matchStatus = 'ambiguous';
        issue = `${match.candidates.length} multitracks match "${item.title}"; choose one in Song matching`;
        deps.recordError?.({
          scope: 'song_matching',
          code: 'song_match_ambiguous',
          message: issue,
          detail: JSON.stringify(
            match.candidates.map((track) => ({ id: track.id, title: track.title, subtitle: track.subtitle })),
          ),
          pcoPlanId: plan.id,
        });
      } else {
        matchStatus = 'unmatched';
        issue = `No multitrack named "${item.title}" was found in this Loop account`;
        deps.recordError?.({
          scope: 'song_matching',
          code: 'song_match_unmatched',
          message: issue,
          pcoPlanId: plan.id,
        });
      }
    }

    if (matchStatus === 'matched' && !mapping) {
      matchStatus = 'review';
      issue = 'Song mapping could not be resolved';
    }

    const primeArrangement = mapping
      ? primeArrangementForTrack(
          {
            id: mapping.primeTrackId,
            title: mapping.primeTrackName,
            subtitle: null,
            arrangements: [],
            availableKeys: [],
            url: null,
          },
          selection.arrangement?.name ?? null,
        )
      : null;

    const resolved: ResolvedSong = {
      item,
      position,
      title: item.title,
      normalizedTitle,
      arrangementChoice: selection.choice,
      arrangementPcoId: selection.arrangement?.id ?? null,
      arrangementPcoName: selection.arrangement?.name ?? null,
      keyName: item.keyName,
      bpm: selection.arrangement?.bpm ?? item.arrangementBpm,
      mapping,
      trackId: mapping?.primeTrackId ?? null,
      trackName: mapping?.primeTrackName ?? null,
      primeArrangementId: primeArrangement?.id ?? mapping?.primeArrangementId ?? null,
      primeArrangementName: primeArrangement?.name ?? mapping?.primeArrangementName ?? null,
      matchStatus,
      candidates,
      issue,
    };

    if (resolved.matchStatus !== 'matched') {
      blockedReasons.push(`${item.title}: ${issue ?? 'needs review'}`);
    }
    if (resolved.matchStatus === 'matched' && !resolved.keyName) {
      warnings.push(`${item.title}: Planning Center has no key on this item; key not synchronized`);
      deps.recordError?.({
        scope: 'key_sync',
        code: 'pco_key_missing',
        message: `${item.title} has no key in Planning Center; key synchronization skipped`,
        pcoPlanId: plan.id,
      });
    }

    songs.push(resolved);
    planSongRows.push({
      pcoItemId: item.id,
      pcoSongId: item.songId,
      position,
      title: item.title,
      arrangementSelected: resolved.arrangementChoice,
      arrangementPcoId: resolved.arrangementPcoId,
      arrangementPcoName: resolved.arrangementPcoName,
      keyName: resolved.keyName,
      bpm: resolved.bpm,
      matchStatus: resolved.matchStatus,
      songMappingId: resolved.mapping?.id ?? null,
      primeTrackId: resolved.trackId,
      primeTrackName: resolved.trackName,
    });
  }

  if (songItems.length === 0) {
    warnings.push('This plan has no song items in Planning Center');
  }

  // ---- musicians ---------------------------------------------------------
  const members = await loadTeamMembers(deps, cache);
  const musicians: ResolvedMusician[] = [];
  const musicianRows: PlanMusicianInput[] = [];

  for (const person of snapshot.people) {
    const email = person.email ? normalizeEmail(person.email) : null;
    let mapping = email ? repo.getMemberMappingByEmail(email) : null;
    let matchStatus: ResolvedMusician['matchStatus'] = 'matched';
    let candidates: PrimeTeamMember[] = [];
    let issue: string | null = null;

    if (!mapping) {
      if (!members) {
        matchStatus = 'review';
        issue = 'Prime team members are not available (Loop session or layout problem)';
      } else {
        const match = matchMusicianByEmail(email, members);
        candidates = match.candidates;
        if (match.status === 'matched' && match.matched && email) {
          mapping = repo.upsertMemberMapping({
            normalizedEmail: email,
            pcoPersonId: person.personId,
            pcoName: person.name,
            primeMemberId: match.matched.id,
            primeMemberName: match.matched.name,
            status: 'matched',
            source: 'auto',
          });
        } else {
          matchStatus = match.status;
          issue = match.reason;
        }
      }
    }

    if (matchStatus === 'matched' && !mapping) {
      matchStatus = 'review';
      issue = 'Member mapping could not be resolved';
    }

    if (matchStatus !== 'matched') {
      warnings.push(`${person.name}: ${issue ?? 'needs a Prime team member match'}`);
      deps.recordError?.({
        scope: 'team_matching',
        code:
          matchStatus === 'ambiguous'
            ? 'member_match_ambiguous'
            : matchStatus === 'review'
              ? 'member_email_missing'
              : 'member_match_unmatched',
        message: `${person.name}: ${issue ?? 'needs a Prime team member match'}`,
        detail: candidates.length
          ? JSON.stringify(candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })))
          : null,
        pcoPlanId: plan.id,
      });
    }

    musicians.push({
      pcoPersonId: person.personId,
      name: person.name,
      email,
      rawEmail: person.rawEmail,
      teamId: person.teamId,
      teamName: person.teamName,
      matchStatus,
      primeMemberId: mapping?.primeMemberId ?? null,
      primeMemberName: mapping?.primeMemberName ?? null,
      candidates,
      issue,
    });

    musicianRows.push({
      pcoPersonId: person.personId,
      pcoName: person.name,
      emailNormalized: email,
      emailRaw: person.rawEmail,
      teamId: person.teamId,
      teamName: person.teamName,
      matchStatus,
      teamMemberMappingId: mapping?.id ?? null,
      primeMemberId: mapping?.primeMemberId ?? null,
      primeMemberName: mapping?.primeMemberName ?? null,
    });
  }

  repo.replacePlanSongs(planRecord.id, planSongRows);
  repo.replacePlanMusicians(planRecord.id, musicianRows);

  return {
    plan,
    record: planRecord,
    setlistName: buildSetlistName(plan.title, plan.planDate),
    songs,
    musicians,
    blockedReasons,
    warnings,
  };
}

async function searchTracks(
  title: string,
  normalizedTitle: string,
  deps: ResolveDeps,
  cache: ResolveCache,
): Promise<PrimeTrack[]> {
  const cached = cache.trackSearch.get(normalizedTitle);
  if (cached) return cached;
  try {
    const tracks = await deps.prime.listTracks(title);
    cache.trackSearch.set(normalizedTitle, tracks);
    return tracks;
  } catch (error) {
    deps.recordError?.({
      scope: 'prime_search',
      code: 'prime_search_failed',
      message: `Could not search the Loop multitrack library for "${title}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      pcoPlanId: null,
    });
    cache.trackSearch.set(normalizedTitle, []);
    return [];
  }
}

async function loadTeamMembers(deps: ResolveDeps, cache: ResolveCache): Promise<PrimeTeamMember[] | null> {
  if (cache.members) return cache.members;
  try {
    const members = await deps.prime.listTeamMembers();
    cache.members = members;
    return members;
  } catch (error) {
    deps.recordError?.({
      scope: 'prime_team',
      code: 'prime_team_members_unavailable',
      message: `Could not read Prime Team members: ${error instanceof Error ? error.message : String(error)}`,
      pcoPlanId: null,
    });
    return null;
  }
}


