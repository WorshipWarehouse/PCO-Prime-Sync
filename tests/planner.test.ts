import { describe, expect, it } from 'vitest';
import { pairTracks, planPlanChanges } from '../src/server/sync/planner';
import {
  buildDesiredPlan,
  buildRecord,
  buildResolvedMusician,
  buildResolvedSong,
  buildSetlist,
  buildSetlistTrack,
  buildShare,
  buildTrack,
  capabilities,
  operationTypes,
} from './helpers';

describe('pairTracks', () => {
  it('pairs by Prime track id', () => {
    const pairings = pairTracks(
      [buildTrack({ itemId: 'i1', trackId: 't1' })],
      [buildSetlistTrack({ setlistTrackId: 's1', trackId: 't1' })],
    );
    expect(pairings[0]?.existing?.setlistTrackId).toBe('s1');
  });

  it('falls back to normalized titles when ids differ', () => {
    const pairings = pairTracks(
      [buildTrack({ itemId: 'i1', trackId: 'new-id', trackName: 'Goodness of God' })],
      [buildSetlistTrack({ setlistTrackId: 's1', trackId: 'old-id', title: 'goodness of god!' })],
    );
    expect(pairings[0]?.existing?.setlistTrackId).toBe('s1');
  });

  it('handles a song scheduled twice', () => {
    const pairings = pairTracks(
      [buildTrack({ itemId: 'i1' }), buildTrack({ itemId: 'i2' })],
      [buildSetlistTrack({ setlistTrackId: 's1' })],
    );
    expect(pairings.filter((pair) => pair.desired).length).toBe(2);
    expect(pairings.filter((pair) => pair.desired && pair.existing)).toHaveLength(1);
    expect(pairings.filter((pair) => pair.desired && !pair.existing)).toHaveLength(1);
  });
});

describe('planPlanChanges — creation', () => {
  it('creates a setlist, adds tracks and shares with matched musicians', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan(),
      existingRecord: null,
      liveSetlist: null,
      capabilities: capabilities(),
    });
    expect(operationTypes(preview)).toEqual(['create_setlist', 'add_track', 'share_member']);
    expect(preview.status).toBe('pending');
    expect(preview.blocked).toBe(false);
    expect(preview.setlistName).toBe('Sunday Service — November 8, 2026');
  });

  it('blocks creation when a song is unmatched', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        songs: [
          buildResolvedSong({ matchStatus: 'unmatched', trackId: null, trackName: null, issue: 'No multitrack found' }),
        ],
        blockedReasons: ['Goodness of God: No multitrack found'],
      }),
      existingRecord: null,
      liveSetlist: null,
      capabilities: capabilities(),
    });
    expect(preview.blocked).toBe(true);
    expect(operationTypes(preview)).not.toContain('create_setlist');
    expect(preview.unmatchedSongs).toEqual(['Goodness of God']);
  });

  it('does not create a setlist when the capability is unverified', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan(),
      existingRecord: null,
      liveSetlist: null,
      capabilities: capabilities({ create_setlist: 'unknown' }),
    });
    expect(preview.blocked).toBe(true);
    expect(operationTypes(preview)).not.toContain('create_setlist');
    expect(preview.blockedReasons.join(' ')).toContain('not verified/configured');
  });

  it('shares with a musician only once even if scheduled twice', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        musicians: [buildResolvedMusician(), buildResolvedMusician({ teamName: 'Vocalists' })],
      }),
      existingRecord: null,
      liveSetlist: null,
      capabilities: capabilities(),
    });
    expect(operationTypes(preview).filter((type) => type === 'share_member')).toHaveLength(1);
  });
});

describe('planPlanChanges — existing setlist', () => {
  it('produces no operations when everything already matches (idempotency)', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan(),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist(),
      capabilities: capabilities(),
    });
    expect(preview.operations).toHaveLength(0);
    expect(preview.status).toBe('in_sync');
  });

  it('renames the setlist when the plan title no longer matches the Prime name', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan(),
      existingRecord: buildRecord({ primeSetlistName: 'Sunday Service (old)' }),
      liveSetlist: buildSetlist({ name: 'Sunday Service (old)' }),
      capabilities: capabilities(),
    });
    expect(operationTypes(preview)).toEqual(['rename_setlist']);
    const operation = preview.operations[0];
    expect(operation?.changeType === 'rename_setlist' && operation.nameDesired).toBe(
      'Sunday Service — November 8, 2026',
    );
  });

  it('flags a rename it cannot perform instead of failing the plan', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan(),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({ name: 'Sunday Service (old)' }),
      capabilities: capabilities({ rename_setlist: 'no' }),
    });
    expect(operationTypes(preview)).not.toContain('rename_setlist');
    expect(
      preview.operations.some(
        (operation) =>
          operation.changeType === 'flag_review' && operation.description.includes('Renaming is not available'),
      ),
    ).toBe(true);
  });

  it('changes only the key when the PCO key changes', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({ songs: [buildResolvedSong({ keyName: 'A' })] }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({ tracks: [buildSetlistTrack({ key: 'G' })] }),
      capabilities: capabilities(),
    });
    expect(operationTypes(preview)).toEqual(['key_change']);
    const operation = preview.operations[0];
    expect(operation?.changeType === 'key_change' && operation.fromKey).toBe('G');
    expect(operation?.changeType === 'key_change' && operation.toKey).toBe('A');
  });

  it('ignores BPM changes entirely', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        songs: [buildResolvedSong({ bpm: 128, keyName: 'G' })],
      }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist(),
      capabilities: capabilities(),
    });
    expect(preview.operations).toHaveLength(0);
  });

  it('does not report a key change for enharmonic equivalents', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({ songs: [buildResolvedSong({ keyName: 'Ab' })] }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({ tracks: [buildSetlistTrack({ key: 'G#' })] }),
      capabilities: capabilities(),
    });
    expect(preview.operations).toHaveLength(0);
  });

  it('adds a song that was added in Planning Center', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        songs: [buildResolvedSong(), buildResolvedSong({ item: { ...buildResolvedSong().item, id: 'item-2', sequence: 2 }, trackId: 'track-way-maker', trackName: 'Way Maker', title: 'Way Maker', keyName: 'Bb' })],
        musicians: [],
      }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({ shares: [] }),
      capabilities: capabilities(),
    });
    expect(operationTypes(preview)).toContain('add_track');
    expect(preview.operations.some((op) => op.changeType === 'add_track' && op.track.trackName === 'Way Maker')).toBe(
      true,
    );
  });

  it('removes a song that disappeared from Planning Center', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({ musicians: [] }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({
        tracks: [
          buildSetlistTrack(),
          buildSetlistTrack({ setlistTrackId: 'st-track-2', trackId: 'track-way-maker', title: 'Way Maker', position: 2 }),
        ],
        shares: [],
      }),
      capabilities: capabilities(),
    });
    expect(operationTypes(preview)).toEqual(['remove_track']);
    expect(preview.operations[0]?.changeType === 'remove_track' && preview.operations[0].trackTitle).toBe('Way Maker');
  });

  it('reorders tracks when Planning Center order changes', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        songs: [
          buildResolvedSong({
            item: { ...buildResolvedSong().item, id: 'item-2', sequence: 1 },
            position: 1,
            trackId: 'track-way-maker',
            trackName: 'Way Maker',
            title: 'Way Maker',
            keyName: 'Bb',
          }),
          buildResolvedSong({ position: 2 }),
        ],
        musicians: [],
      }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({
        tracks: [
          buildSetlistTrack({ position: 1 }),
          buildSetlistTrack({
            setlistTrackId: 'st-track-2',
            trackId: 'track-way-maker',
            title: 'Way Maker',
            key: 'Bb',
            position: 2,
          }),
        ],
        shares: [],
      }),
      capabilities: capabilities(),
    });
    expect(operationTypes(preview)).toEqual(['reorder_tracks']);
    expect(preview.operations[0]?.changeType === 'reorder_tracks' && preview.operations[0].desiredOrder).toEqual([
      'st-track-2',
      'st-track-1',
    ]);
  });

  it('shares with newly added musicians and unshares removed ones', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        musicians: [buildResolvedMusician({ primeMemberId: 'member-9', email: 'new@example.com', name: 'New Person' })],
      }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({
        shares: [{ memberId: 'member-2', memberName: 'Old Person', email: 'old@example.com' }],
      }),
      capabilities: capabilities(),
    });
    expect(operationTypes(preview).sort()).toEqual(['share_member', 'unshare_member']);
  });

  it('flags key changes when the Loop UI cannot change keys', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({ songs: [buildResolvedSong({ keyName: 'A' })] }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist(),
      capabilities: capabilities({ change_key: 'unknown' }),
    });
    expect(operationTypes(preview)).toContain('flag_review');
    expect(operationTypes(preview)).not.toContain('key_change');
    expect(preview.operations.some((op) => op.changeType === 'flag_review' && op.description.includes('key change'))).toBe(
      true,
    );
  });

  it('never recreates a setlist that disappeared from Prime', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan(),
      existingRecord: buildRecord(),
      liveSetlist: null,
      capabilities: capabilities(),
    });
    expect(preview.blocked).toBe(true);
    expect(operationTypes(preview)).not.toContain('create_setlist');
    expect(preview.blockedReasons.join(' ')).toContain('missing');
  });

  it('does not flag a share when the setlist is already shared correctly', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({ songs: [buildResolvedSong({ keyName: null })] }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({ tracks: [buildSetlistTrack({ key: null })] }),
      capabilities: capabilities(),
    });
    expect(preview.operations).toHaveLength(0);
    expect(preview.status).toBe('in_sync');
  });

  it('flags members that could not be matched without blocking the plan', () => {
    const preview = planPlanChanges({
      desired: buildDesiredPlan({
        musicians: [buildResolvedMusician({ matchStatus: 'unmatched', primeMemberId: null, issue: 'No email match' })],
      }),
      existingRecord: buildRecord(),
      liveSetlist: buildSetlist({ shares: [] }),
      capabilities: capabilities(),
    });
    expect(preview.unmatchedMusicians).toEqual(['Jordan Lee']);
    expect(preview.status).toBe('needs_matching');
    expect(preview.blocked).toBe(false);
  });
});

describe('buildShare helper sanity', () => {
  it('is unused by the app but keeps fixtures honest', () => {
    expect(buildShare().memberId).toBe('member-1');
  });
});
