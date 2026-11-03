import { describe, expect, it } from 'vitest';
import type { PrimeTrack } from '../src/shared/types';
import { buildSetlistName } from '../src/shared/naming';
import { closeDatabase, openDatabase } from '../src/server/db';
import { Repository } from '../src/server/db/repo';
import { MockPcoAdapter } from '../src/server/pco/mock';
import { MockPrimeAdapter } from '../src/server/prime/mock';
import { SyncEngine } from '../src/server/sync/engine';
import { shiftedFixtures } from './helpers';

function setup(options: { prime?: MockPrimeAdapter } = {}) {
  const db = openDatabase(':memory:');
  const repo = new Repository(db);
  repo.updateSettings({
    pcoServiceTypeIds: ['st-1'],
    timezone: 'America/New_York',
    windowDays: 21,
  });
  repo.setWorshipTeamIds(['team-worship']);

  const fixtures = shiftedFixtures();
  const prime = options.prime ?? new MockPrimeAdapter();

  const buildPco = (plans = fixtures.plans) =>
    new MockPcoAdapter({ plans, teams: fixtures.teams, arrangements: fixtures.arrangements });

  const makeEngine = (pco = buildPco()) => new SyncEngine({ repo, pcoAdapter: pco, primeAdapter: prime });

  return { db, repo, fixtures, prime, buildPco, makeEngine };
}

const setlistName = (index: 0 | 1) => {
  const { plans } = shiftedFixtures();
  const fixture = plans[index]!;
  return buildSetlistName(fixture.plan.title, fixture.plan.planDate);
};

describe('SyncEngine — end to end with mock adapters', () => {
  it('creates one setlist per plan with tracks, keys and shares', async () => {
    const ctx = setup();
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    expect(result.status).toBe('success');
    expect(result.plansProcessed).toBe(2);
    const setlists = ctx.prime.peekAllSetlists();
    expect(setlists).toHaveLength(2);

    const first = setlists.find((setlist) => setlist.name === setlistName(0));
    expect(first).toBeDefined();
    expect(first!.tracks.map((track) => track.title)).toEqual([
      'Goodness of God',
      'Great Are You Lord',
      'Build My Life',
    ]);
    expect(first!.tracks.map((track) => track.key)).toEqual(['G', 'D', 'E']);
    // Only the configured worship team is shared with (not audio/camera/vocals).
    expect(first!.shares.map((share) => share.email).sort()).toEqual([
      'casey.morgan@example.com',
      'jordan.lee@example.com',
    ]);

    const second = setlists.find((setlist) => setlist.name === setlistName(1));
    expect(second!.tracks.map((track) => track.title)).toEqual(['Way Maker', 'Goodness of God']);
    expect(second!.tracks.map((track) => track.key)).toEqual(['Bb', 'A']);
    expect(second!.shares.map((share) => share.email).sort()).toEqual([
      'jordan.lee@example.com',
      'taylor.brooks@example.com',
    ]);

    const plan1 = ctx.repo.listPlansBetween('1900-01-01', '2999-12-31')[0]!;
    expect(plan1.status).toBe('in_sync');
    expect(plan1.lastSyncedAt).not.toBeNull();

    // Mappings were saved for reuse.
    expect(ctx.repo.listSongMappings().length).toBeGreaterThanOrEqual(4);
    expect(ctx.repo.listMemberMappings().length).toBeGreaterThanOrEqual(3);

    closeDatabase(ctx.db);
  });

  it('is idempotent: a second sync applies no changes and creates no duplicates', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    const afterFirst = ctx.prime.peekAllSetlists().map((setlist) => setlist.id);
    const callsAfterFirst = ctx.prime.calls.length;

    const second = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(second.status).toBe('success');
    expect(second.changesApplied).toBe(0);
    expect(ctx.prime.peekAllSetlists()).toHaveLength(2);
    expect(ctx.prime.peekAllSetlists().map((setlist) => setlist.id)).toEqual(afterFirst);

    const createCalls = ctx.prime.calls
      .slice(callsAfterFirst)
      .filter((call) => call.startsWith('createSetlist') || call.startsWith('addTrack'));
    expect(createCalls).toEqual([]);

    closeDatabase(ctx.db);
  });

  it('creates no setlist at all on a dry run', async () => {
    const ctx = setup();
    const result = await ctx.makeEngine().run({ mode: 'dry_run', trigger: 'manual' });
    expect(result.status).toBe('dry_run');
    expect(result.changesApplied).toBe(0);
    expect(ctx.prime.peekAllSetlists()).toHaveLength(0);
    const history = ctx.repo.listSyncHistory();
    expect(history[0]?.mode).toBe('dry_run');
    closeDatabase(ctx.db);
  });

  it('updates the Loop key when the PCO key changes and leaves BPM alone', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    // Change the key of the first song in plan 1 and its BPM.
    ctx.fixtures.plans[0]!.items[0]!.keyName = 'A';
    ctx.fixtures.plans[0]!.items[0]!.arrangementBpm = 200;
    ctx.fixtures.arrangements['song-1'] = [
      { id: 'arr-1-default', name: 'Default', bpm: 200, keys: [{ id: 'key-1', name: 'A', startingKey: 'A' }] },
    ];

    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(result.status).toBe('success');
    expect(result.changesApplied).toBeGreaterThan(0);

    const first = ctx.prime.peekAllSetlists().find((setlist) => setlist.name === setlistName(0))!;
    expect(first.tracks.map((track) => track.key)).toEqual(['A', 'D', 'E']);
    expect(first.tracks).toHaveLength(3);
    // The adapter has no BPM API at all; assert no call mentions it.
    expect(ctx.prime.calls.some((call) => /bpm|tempo|volume|mix/i.test(call))).toBe(false);

    // And the next run is clean again.
    const third = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(third.changesApplied).toBe(0);

    closeDatabase(ctx.db);
  });

  it('renames the setlist when the Planning Center plan title changes, and stays idempotent', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    ctx.fixtures.plans[0]!.plan.title = 'Sunday Night Service';
    const renamed = buildSetlistName('Sunday Night Service', ctx.fixtures.plans[0]!.plan.planDate);

    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(result.status).toBe('success');
    const names = ctx.prime.peekAllSetlists().map((setlist) => setlist.name);
    expect(names).toContain(renamed);
    expect(names).not.toContain(setlistName(0));
    // Renamed in place: the setlist was never recreated.
    expect(ctx.prime.calls.some((call) => call.startsWith('renameSetlist'))).toBe(true);
    expect(ctx.prime.peekAllSetlists()).toHaveLength(2);

    const again = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(again.changesApplied).toBe(0);

    closeDatabase(ctx.db);
  });

  it('reorders the Prime setlist when Planning Center order changes', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    const items = ctx.fixtures.plans[0]!.items;
    const songs = items.filter((item) => item.itemType === 'song');
    songs[0]!.sequence = 3;
    songs[1]!.sequence = 1;
    songs[2]!.sequence = 2;

    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(result.status).toBe('success');
    const first = ctx.prime.peekAllSetlists().find((setlist) => setlist.name === setlistName(0))!;
    expect(first.tracks.map((track) => track.title)).toEqual([
      'Great Are You Lord',
      'Build My Life',
      'Goodness of God',
    ]);

    const again = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(again.changesApplied).toBe(0);

    closeDatabase(ctx.db);
  });

  it('removes a track when the song is deleted from the plan', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    ctx.fixtures.plans[0]!.items = ctx.fixtures.plans[0]!.items.filter((item) => item.id !== 'item-2');
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(result.status).toBe('success');

    const first = ctx.prime.peekAllSetlists().find((setlist) => setlist.name === setlistName(0))!;
    expect(first.tracks.map((track) => track.title)).toEqual(['Goodness of God', 'Build My Life']);
    expect(first.tracks.map((track) => track.position)).toEqual([1, 2]);

    closeDatabase(ctx.db);
  });

  it('blocks a plan with an ambiguous multitrack match and never creates its setlist', async () => {
    // "Build My Life" only appears in plan 1, so exactly one plan is blocked.
    const duplicateTracks: PrimeTrack[] = [
      { id: 't1', title: 'Goodness of God', subtitle: null, arrangements: [], availableKeys: [], url: null },
      { id: 't3', title: 'Great Are You Lord', subtitle: null, arrangements: [], availableKeys: [], url: null },
      { id: 't4a', title: 'Build My Life', subtitle: null, arrangements: [], availableKeys: [], url: null },
      { id: 't4b', title: 'Build My Life', subtitle: null, arrangements: [], availableKeys: [], url: null },
      { id: 't5', title: 'Way Maker', subtitle: null, arrangements: [], availableKeys: [], url: null },
    ];
    const ctx = setup({ prime: new MockPrimeAdapter({ tracks: duplicateTracks }) });
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    expect(result.status).toBe('partial');
    const setlists = ctx.prime.peekAllSetlists();
    expect(setlists.map((setlist) => setlist.name)).toEqual([setlistName(1)]);
    expect(ctx.repo.listErrors({ limit: 50 }).some((error) => error.code === 'song_match_ambiguous')).toBe(true);
    expect(ctx.repo.getSongMappingByName('build my life')).toBeNull();

    closeDatabase(ctx.db);
  });

  it('flags songs with no multitrack and does not purchase or invent tracks', async () => {
    const limitedTracks: PrimeTrack[] = [
      { id: 't1', title: 'Goodness of God', subtitle: null, arrangements: [], availableKeys: [], url: null },
      { id: 't3', title: 'Great Are You Lord', subtitle: null, arrangements: [], availableKeys: [], url: null },
      { id: 't5', title: 'Way Maker', subtitle: null, arrangements: [], availableKeys: [], url: null },
    ];
    const ctx = setup({ prime: new MockPrimeAdapter({ tracks: limitedTracks }) });
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    expect(result.status).toBe('partial');
    const names = ctx.prime.peekAllSetlists().map((setlist) => setlist.name);
    expect(names).not.toContain(setlistName(0));
    expect(ctx.repo.listErrors({ limit: 50 }).some((error) => error.code === 'song_match_unmatched')).toBe(true);

    closeDatabase(ctx.db);
  });

  it('pauses the run when the Loop session has expired', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    const before = ctx.prime.peekAllSetlists().length;

    ctx.prime.expireSession();
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    expect(result.status).toBe('blocked');
    expect(result.changesApplied).toBe(0);
    expect(ctx.prime.peekAllSetlists()).toHaveLength(before);
    expect(result.errors.some((error) => /session|login/i.test(error.message))).toBe(true);

    closeDatabase(ctx.db);
  });

  it('flags a plan that disappeared from Planning Center without deleting its setlist', async () => {
    const ctx = setup();
    await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    const setlistsBefore = ctx.prime.peekAllSetlists().length;

    // PCO now returns only the second plan.
    const onlySecond = ctx.buildPco(ctx.fixtures.plans.slice(1));
    const result = await ctx.makeEngine(onlySecond).run({ mode: 'sync', trigger: 'manual' });

    expect(result.status).toBe('partial');
    expect(ctx.prime.peekAllSetlists()).toHaveLength(setlistsBefore);
    const firstPlan = ctx.repo.listPlans().find((plan) => plan.title === 'Sunday Service' && plan.status === 'missing_in_pco');
    expect(firstPlan).toBeDefined();
    expect(ctx.repo.listErrors({ limit: 50 }).some((error) => error.code === 'plan_missing_in_pco')).toBe(true);

    closeDatabase(ctx.db);
  });

  it('keeps a failed verification from retrying destructive work', async () => {
    const prime = new MockPrimeAdapter({ failVerification: true });
    const ctx = setup({ prime });
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });

    expect(['failed', 'partial']).toContain(result.status);
    expect(result.errors.some((error) => error.code === 'prime_verification_failed')).toBe(true);
    // The run stopped after the first verification failure instead of carving on.
    expect(result.changesApplied).toBeLessThan(4);

    closeDatabase(ctx.db);
  });

  it('never writes to Prime when there are no worship teams configured', async () => {
    const ctx = setup();
    ctx.repo.setWorshipTeamIds([]);
    const result = await ctx.makeEngine().run({ mode: 'sync', trigger: 'manual' });
    expect(result.status).toBe('success');
    const shares = ctx.prime.peekAllSetlists().flatMap((setlist) => setlist.shares);
    expect(shares).toHaveLength(0);

    closeDatabase(ctx.db);
  });
});
