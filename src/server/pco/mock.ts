import type {
  PcoPlan,
  PcoPlanItem,
  PcoPlanPerson,
  PcoPlanSnapshot,
  PcoServiceType,
  PcoTeam,
  PcoArrangement,
} from '../../shared/types';
import type { PcoAdapter, PcoConnectionResult } from './adapter';

export interface MockPlanFixture {
  plan: PcoPlan;
  items: PcoPlanItem[];
  people: PcoPlanPerson[];
}

/**
 * In-memory PCO adapter for tests and for `npm test` style dry runs.
 * Production code never selects this adapter: `createPcoAdapter()` uses the HTTP
 * implementation whenever credentials are configured.
 */
export class MockPcoAdapter implements PcoAdapter {
  readonly kind = 'mock' as const;
  readonly calls: string[] = [];
  private readonly plans: MockPlanFixture[];
  private readonly serviceTypes: PcoServiceType[];
  private readonly teams: PcoTeam[];
  private readonly arrangements: Record<string, PcoArrangement[]>;

  constructor(options: {
    plans?: MockPlanFixture[];
    serviceTypes?: PcoServiceType[];
    teams?: PcoTeam[];
    arrangements?: Record<string, PcoArrangement[]>;
  } = {}) {
    this.plans = options.plans ?? buildDefaultFixtures().plans;
    this.serviceTypes = options.serviceTypes ?? [{ id: 'st-1', name: 'Sunday Service' }];
    this.teams = options.teams ?? buildDefaultFixtures().teams;
    this.arrangements = options.arrangements ?? buildDefaultFixtures().arrangements;
  }

  async verifyConnection(): Promise<PcoConnectionResult> {
    return { ok: true, message: 'Mock Planning Center connection', serviceTypeCount: this.serviceTypes.length };
  }

  async listServiceTypes(): Promise<PcoServiceType[]> {
    this.calls.push('listServiceTypes');
    return this.serviceTypes;
  }

  async listTeams(serviceTypeIds: string[]): Promise<PcoTeam[]> {
    this.calls.push(`listTeams:${serviceTypeIds.join(',')}`);
    return this.teams.filter((team) => !team.serviceTypeId || serviceTypeIds.includes(team.serviceTypeId));
  }

  async listPlans(serviceTypeIds: string[], fromDate: string, toDate: string): Promise<PcoPlan[]> {
    this.calls.push(`listPlans:${serviceTypeIds.join(',')}:${fromDate}:${toDate}`);
    return this.plans
      .map((fixture) => fixture.plan)
      .filter(
        (plan) =>
          serviceTypeIds.includes(plan.serviceTypeId) && plan.planDate >= fromDate && plan.planDate <= toDate,
      )
      .sort((a, b) => (a.planDate < b.planDate ? -1 : a.planDate > b.planDate ? 1 : 0));
  }

  async getPlanSnapshot(plan: PcoPlan, worshipTeamIds: string[]): Promise<PcoPlanSnapshot> {
    this.calls.push(`getPlanSnapshot:${plan.id}`);
    const fixture = this.plans.find((entry) => entry.plan.id === plan.id);
    if (!fixture) return { plan, items: [], people: [] };
    const allowed = new Set(worshipTeamIds);
    const seen = new Set<string>();
    const people: PcoPlanPerson[] = [];
    for (const person of fixture.people) {
      if (!person.teamId || !allowed.has(person.teamId)) continue;
      if (seen.has(person.personId)) continue;
      seen.add(person.personId);
      people.push(person);
    }
    return { plan, items: fixture.items, people };
  }

  async listArrangements(songId: string): Promise<PcoArrangement[]> {
    this.calls.push(`listArrangements:${songId}`);
    return this.arrangements[songId] ?? [];
  }
}

/** Realistic two-Sunday fixture used by tests and the mock demo mode. */
export function buildDefaultFixtures(): {
  plans: MockPlanFixture[];
  teams: PcoTeam[];
  arrangements: Record<string, PcoArrangement[]>;
} {
  const teams: PcoTeam[] = [
    { id: 'team-worship', name: 'Worship Team', serviceTypeId: 'st-1', archived: false },
    { id: 'team-vocals', name: 'Vocalists', serviceTypeId: 'st-1', archived: false },
    { id: 'team-audio', name: 'Audio', serviceTypeId: 'st-1', archived: false },
    { id: 'team-camera', name: 'Camera', serviceTypeId: 'st-1', archived: false },
  ];

  const arrangements: Record<string, PcoArrangement[]> = {
    'song-1': [
      { id: 'arr-1-default', name: 'Default', bpm: 72, keys: [{ id: 'key-1', name: 'G', startingKey: 'G' }] },
      { id: 'arr-1-alt', name: 'Acoustic', bpm: 74, keys: [{ id: 'key-2', name: 'A', startingKey: 'A' }] },
    ],
    'song-2': [
      { id: 'arr-2-original', name: 'Original', bpm: 68, keys: [{ id: 'key-3', name: 'D', startingKey: 'D' }] },
    ],
    'song-3': [
      { id: 'arr-3-default', name: 'Default', bpm: 120, keys: [{ id: 'key-4', name: 'E', startingKey: 'E' }] },
      { id: 'arr-3-live', name: 'Live', bpm: 122, keys: [{ id: 'key-4b', name: 'E', startingKey: 'E' }] },
    ],
    'song-4': [
      { id: 'arr-4-default', name: 'Default', bpm: 80, keys: [{ id: 'key-5', name: 'Bb', startingKey: 'Bb' }] },
    ],
  };

  const plan1: PcoPlan = {
    id: 'plan-1001',
    serviceTypeId: 'st-1',
    title: 'Sunday Service',
    seriesTitle: 'Fall',
    sortDate: '2026-11-08T10:00:00Z',
    planDate: '2026-11-08',
    dates: 'November 8, 2026',
    itemsCount: 4,
    updatedAt: '2026-11-01T12:00:00Z',
  };

  const plan1Items: PcoPlanItem[] = [
    item('item-1', plan1.id, 'song-1', 'arr-1-default', 'Default', 'G', 1),
    item('item-2', plan1.id, 'song-2', 'arr-2-original', 'Original', 'D', 2),
    item('item-3', plan1.id, 'song-3', 'arr-3-live', 'Live', 'E', 3),
    {
      id: 'item-4',
      planId: plan1.id,
      itemType: 'header',
      title: 'Sermon',
      sequence: 4,
      servicePosition: 'during',
      keyName: null,
      songId: null,
      arrangementId: null,
      arrangementName: null,
      arrangementBpm: null,
      keyId: null,
    },
  ];

  const plan1People: PcoPlanPerson[] = [
    person('pp-1', plan1.id, 'person-1', 'Jordan Lee', 'team-worship', 'Worship Team', 'jordan.lee@example.com'),
    person('pp-2', plan1.id, 'person-2', 'Sam Rivera', 'team-vocals', 'Vocalists', 'sam.rivera@example.com'),
    person('pp-3', plan1.id, 'person-3', 'Alex Chen', 'team-audio', 'Audio', 'alex.chen@example.com'),
    person('pp-4', plan1.id, 'person-4', 'Casey Morgan', 'team-worship', 'Worship Team', 'casey.morgan@example.com'),
    person('pp-5', plan1.id, 'person-5', 'Riley Park', 'team-camera', 'Camera', 'riley.park@example.com'),
  ];

  const plan2: PcoPlan = {
    id: 'plan-1002',
    serviceTypeId: 'st-1',
    title: 'Sunday Service',
    seriesTitle: 'Fall',
    sortDate: '2026-11-15T10:00:00Z',
    planDate: '2026-11-15',
    dates: 'November 15, 2026',
    itemsCount: 2,
    updatedAt: '2026-11-02T12:00:00Z',
  };

  const plan2Items: PcoPlanItem[] = [
    item('item-5', plan2.id, 'song-4', 'arr-4-default', 'Default', 'Bb', 1),
    item('item-6', plan2.id, 'song-1', 'arr-1-default', 'Default', 'A', 2),
  ];

  const plan2People: PcoPlanPerson[] = [
    person('pp-6', plan2.id, 'person-1', 'Jordan Lee', 'team-worship', 'Worship Team', 'jordan.lee@example.com'),
    person('pp-7', plan2.id, 'person-6', 'Taylor Brooks', 'team-worship', 'Worship Team', 'taylor.brooks@example.com'),
  ];

  return {
    plans: [
      { plan: plan1, items: plan1Items, people: plan1People },
      { plan: plan2, items: plan2Items, people: plan2People },
    ],
    teams,
    arrangements,
  };
}

function item(
  id: string,
  planId: string,
  songId: string,
  arrangementId: string,
  arrangementName: string,
  keyName: string,
  sequence: number,
): PcoPlanItem {
  return {
    id,
    planId,
    itemType: 'song',
    title: songTitle(songId),
    sequence,
    servicePosition: 'during',
    keyName,
    songId,
    arrangementId,
    arrangementName,
    arrangementBpm: 72,
    keyId: `${arrangementId}-key`,
  };
}

function songTitle(songId: string): string {
  switch (songId) {
    case 'song-1':
      return 'Goodness of God';
    case 'song-2':
      return 'Great Are You Lord';
    case 'song-3':
      return 'Build My Life';
    case 'song-4':
      return 'Way Maker';
    default:
      return 'Unknown Song';
  }
}

function person(
  id: string,
  planId: string,
  personId: string,
  name: string,
  teamId: string,
  teamName: string,
  email: string,
): PcoPlanPerson {
  return {
    id,
    planId,
    personId,
    name,
    teamId,
    teamName,
    teamPositionName: 'Vocals',
    status: 'C',
    email: email.toLowerCase(),
    rawEmail: email,
  };
}
