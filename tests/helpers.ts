import type {
  DesiredShare,
  DesiredTrack,
  PlanSyncPreview,
  PcoPlan,
  PrimeCapability,
  PrimeCapabilityReport,
  PrimeSetlist,
  PrimeSetlistTrack,
} from '../src/shared/types';
import { addDaysToIsoDate, timePartsInTimeZone } from '../src/shared/naming';
import { buildDefaultFixtures, type MockPlanFixture } from '../src/server/pco/mock';
import type { DesiredPlan, ResolvedMusician, ResolvedSong } from '../src/server/sync/resolve';

export const ALL_CAPABILITIES: PrimeCapability[] = [
  'search_tracks',
  'list_team_members',
  'create_setlist',
  'rename_setlist',
  'add_track',
  'remove_track',
  'reorder_tracks',
  'change_key',
  'share_member',
  'unshare_member',
  'delete_setlist',
];

export function capabilities(
  overrides: Partial<Record<PrimeCapability, 'yes' | 'no' | 'unknown'>> = {},
): PrimeCapabilityReport[] {
  return ALL_CAPABILITIES.map((capability) => {
    const supported = overrides[capability] ?? (capability === 'delete_setlist' ? 'no' : 'yes');
    return {
      capability,
      supported,
      note: supported === 'yes' ? 'test: supported' : `test: ${supported}`,
    };
  });
}

export function todayIso(): string {
  return timePartsInTimeZone(new Date(), 'America/New_York').isoDate;
}

/** Shift the built-in PCO fixtures into the current sync window. */
export function shiftedFixtures(): { plans: MockPlanFixture[]; teams: ReturnType<typeof buildDefaultFixtures>['teams']; arrangements: ReturnType<typeof buildDefaultFixtures>['arrangements'] } {
  const base = buildDefaultFixtures();
  const today = todayIso();
  const shifts = [7, 14];
  const plans = base.plans.map((fixture, index) => {
    const offset = shifts[index] ?? 7 + index * 7;
    const planDate = addDaysToIsoDate(today, offset);
    const plan: PcoPlan = {
      ...fixture.plan,
      planDate,
      sortDate: `${planDate}T15:00:00Z`,
      dates: planDate,
    };
    return { ...fixture, plan };
  });
  return { plans, teams: base.teams, arrangements: base.arrangements };
}

export function buildTrack(overrides: Partial<DesiredTrack> = {}): DesiredTrack {
  return {
    itemId: 'item-1',
    title: 'Goodness of God',
    keyName: 'G',
    trackId: 'track-goodness',
    trackName: 'Goodness of God',
    primeArrangementId: null,
    ...overrides,
  };
}

export function buildShare(overrides: Partial<DesiredShare> = {}): DesiredShare {
  return {
    personId: 'person-1',
    name: 'Jordan Lee',
    email: 'jordan.lee@example.com',
    memberId: 'member-1',
    ...overrides,
  };
}

export function buildResolvedSong(overrides: Partial<ResolvedSong> = {}): ResolvedSong {
  return {
    item: {
      id: 'item-1',
      planId: 'plan-1',
      itemType: 'song',
      title: 'Goodness of God',
      sequence: 1,
      servicePosition: 'during',
      keyName: 'G',
      songId: 'song-1',
      arrangementId: 'arr-1',
      arrangementName: 'Default',
      arrangementBpm: 72,
      keyId: 'key-1',
    },
    position: 1,
    title: 'Goodness of God',
    normalizedTitle: 'goodness of god',
    arrangementChoice: 'default',
    arrangementPcoId: 'arr-1',
    arrangementPcoName: 'Default',
    keyName: 'G',
    bpm: 72,
    mapping: null,
    trackId: 'track-goodness',
    trackName: 'Goodness of God',
    primeArrangementId: null,
    primeArrangementName: null,
    matchStatus: 'matched',
    candidates: [],
    issue: null,
    ...overrides,
  };
}

export function buildResolvedMusician(overrides: Partial<ResolvedMusician> = {}): ResolvedMusician {
  return {
    pcoPersonId: 'person-1',
    name: 'Jordan Lee',
    email: 'jordan.lee@example.com',
    rawEmail: 'Jordan.Lee@example.com',
    teamId: 'team-worship',
    teamName: 'Worship Team',
    matchStatus: 'matched',
    primeMemberId: 'member-1',
    primeMemberName: 'Jordan Lee',
    candidates: [],
    issue: null,
    ...overrides,
  };
}

export function buildDesiredPlan(overrides: Partial<DesiredPlan> = {}): DesiredPlan {
  const plan: PcoPlan = {
    id: 'plan-1',
    serviceTypeId: 'st-1',
    title: 'Sunday Service',
    seriesTitle: null,
    sortDate: '2026-11-08T15:00:00Z',
    planDate: '2026-11-08',
    dates: 'November 8, 2026',
    itemsCount: 1,
    updatedAt: '2026-11-01T12:00:00Z',
  };
  return {
    plan,
    record: {
      id: 1,
      pcoPlanId: plan.id,
      serviceTypeId: 'st-1',
      title: plan.title,
      seriesTitle: null,
      sortDate: plan.sortDate,
      planDate: plan.planDate,
      status: 'not_synced',
      lastSyncedAt: null,
      pcoUpdatedAt: plan.updatedAt,
      createdAt: '2026-11-01T12:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z',
    },
    setlistName: 'Sunday Service — November 8, 2026',
    songs: [buildResolvedSong()],
    musicians: [buildResolvedMusician()],
    blockedReasons: [],
    warnings: [],
    ...overrides,
  };
}

export function buildSetlistTrack(overrides: Partial<PrimeSetlistTrack> = {}): PrimeSetlistTrack {
  return {
    setlistTrackId: 'st-track-1',
    trackId: 'track-goodness',
    title: 'Goodness of God',
    key: 'G',
    position: 1,
    ...overrides,
  };
}

export function buildSetlist(overrides: Partial<PrimeSetlist> = {}): PrimeSetlist {
  return {
    id: 'prime-setlist-1',
    name: 'Sunday Service — November 8, 2026',
    url: null,
    tracks: [buildSetlistTrack()],
    shares: [
      { memberId: 'member-1', memberName: 'Jordan Lee', email: 'jordan.lee@example.com' },
    ],
    ...overrides,
  };
}

export function buildRecord(overrides: Partial<import('../src/shared/types').PrimeSetlistRecord> = {}) {
  return {
    id: 1,
    pcoPlanId: 'plan-1',
    primeSetlistId: 'prime-setlist-1',
    primeSetlistName: 'Sunday Service — November 8, 2026',
    primeUrl: null,
    lastVerifiedAt: '2026-11-01T12:00:00Z',
    state: { tracks: [buildSetlistTrack()], shares: [] },
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
    ...overrides,
  };
}

export function operationTypes(preview: PlanSyncPreview): string[] {
  return preview.operations.map((operation) => operation.changeType);
}
