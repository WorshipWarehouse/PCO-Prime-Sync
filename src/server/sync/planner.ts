import type {
  DesiredShare,
  DesiredTrack,
  PlanSyncPreview,
  PlanSyncStatus,
  PrimeCapabilityReport,
  PrimeSetlist,
  PrimeSetlistTrack,
  SyncOperation,
} from '../../shared/types';
import type { PrimeSetlistRecord } from '../../shared/types';
import { keysEqual } from '../../shared/keys';
import { normalizeSongName } from '../../shared/naming';
import { capabilityNote, capabilitySupported } from '../prime/adapter';
import type { DesiredPlan, ResolvedSong } from './resolve';

export interface Pairing {
  song: ResolvedSong | null;
  desired: DesiredTrack | null;
  existing: PrimeSetlistTrack | null;
}

/**
 * Pair desired tracks with the tracks that already exist in Prime.
 *
 * Identity is preferred (Prime track id) and normalized titles are the fallback,
 * so an unchanged plan always pairs 1:1 and produces zero operations.
 */
export function pairTracks(desired: DesiredTrack[], existing: PrimeSetlistTrack[]): Pairing[] {
  const remaining = [...existing].sort((a, b) => a.position - b.position);
  const pairings: Pairing[] = [];

  for (const track of desired) {
    let index = remaining.findIndex((candidate) => candidate.trackId === track.trackId);
    if (index === -1) {
      index = remaining.findIndex(
        (candidate) => normalizeSongName(candidate.title) === normalizeSongName(track.trackName),
      );
    }
    if (index === -1) {
      pairings.push({ song: null, desired: track, existing: null });
      continue;
    }
    const [matched] = remaining.splice(index, 1);
    pairings.push({ song: null, desired: track, existing: matched ?? null });
  }

  for (const leftover of remaining) {
    pairings.push({ song: null, desired: null, existing: leftover });
  }
  return pairings;
}

export interface PlannerInput {
  desired: DesiredPlan;
  existingRecord: PrimeSetlistRecord | null;
  liveSetlist: PrimeSetlist | null;
  capabilities: PrimeCapabilityReport[];
}

/**
 * Compute the minimal, safe set of Loop Prime operations for one plan.
 * Never deletes a setlist and never touches BPM, tempo or mix settings.
 */
export function planPlanChanges(input: PlannerInput): PlanSyncPreview {
  const { desired, existingRecord, liveSetlist, capabilities } = input;
  const planId = desired.plan.id;
  const operations: SyncOperation[] = [];
  const blockedReasons = [...desired.blockedReasons];
  const flags: string[] = [];

  const songsBlocked = desired.songs.some((song) => song.matchStatus !== 'matched');
  const ambiguousSongs = desired.songs.filter((song) => song.matchStatus === 'ambiguous').map((s) => s.title);
  const unmatchedSongs = desired.songs
    .filter((song) => song.matchStatus !== 'matched' && song.matchStatus !== 'ambiguous')
    .map((song) => song.title);
  const ambiguousMusicians = desired.musicians.filter((m) => m.matchStatus === 'ambiguous').map((m) => m.name);
  const unmatchedMusicians = desired.musicians
    .filter((m) => m.matchStatus !== 'matched' && m.matchStatus !== 'ambiguous')
    .map((m) => m.name);

  const desiredTracks: DesiredTrack[] = desired.songs
    .filter((song) => song.matchStatus === 'matched' && song.trackId)
    .map((song) => ({
      itemId: song.item.id,
      title: song.title,
      keyName: song.keyName,
      trackId: song.trackId!,
      trackName: song.trackName ?? song.title,
      primeArrangementId: song.primeArrangementId,
    }));

  const desiredShares: DesiredShare[] = [];
  const seenMembers = new Set<string>();
  for (const musician of desired.musicians) {
    if (musician.matchStatus !== 'matched' || !musician.primeMemberId || !musician.email) continue;
    if (seenMembers.has(musician.primeMemberId)) continue;
    seenMembers.add(musician.primeMemberId);
    desiredShares.push({
      personId: musician.pcoPersonId,
      name: musician.name,
      email: musician.email,
      memberId: musician.primeMemberId,
    });
  }

  // ---- Creation path -----------------------------------------------------
  if (!existingRecord) {
    const canCreate =
      capabilitySupported(capabilities, 'create_setlist') && capabilitySupported(capabilities, 'add_track');
    if (songsBlocked) {
      flags.push('Not creating a Prime setlist until every song is matched');
    } else if (!canCreate) {
      flags.push(
        `Cannot create setlists yet: ${capabilityNote(capabilities, 'create_setlist')} / ${capabilityNote(
          capabilities,
          'add_track',
        )}`,
      );
      blockedReasons.push('Loop Prime setlist creation is not verified/configured');
    } else if (desiredTracks.length === 0) {
      flags.push('Plan has no songs to add');
    } else {
      operations.push({
        pcoPlanId: planId,
        changeType: 'create_setlist',
        description: `Create Prime setlist "${desired.setlistName}"`,
        setlistName: desired.setlistName,
        trackCount: desiredTracks.length,
      });
      operations.push(...addOperations(planId, desiredTracks, capabilities, flags));
      operations.push(...shareOperations(planId, desiredShares, [], capabilities, flags));
      const keyIssues = desired.songs.filter((song) => song.keyName === null);
      for (const song of keyIssues) {
        flags.push(`${song.title}: no key in Planning Center, key left as-is`);
      }
    }

    return finish({
      desired,
      operations,
      blockedReasons,
      flags,
      songsBlocked,
      ambiguousSongs,
      unmatchedSongs,
      ambiguousMusicians,
      unmatchedMusicians,
      hasExisting: false,
    });
  }

  // ---- Existing setlist path --------------------------------------------
  if (!liveSetlist) {
    flags.push(
      `A Prime setlist was previously recorded (${existingRecord.primeSetlistName}) but is no longer visible. It will NOT be recreated automatically.`,
    );
    blockedReasons.push('Previously synced Prime setlist is missing from Loop');
    return finish({
      desired,
      operations,
      blockedReasons,
      flags,
      songsBlocked,
      ambiguousSongs,
      unmatchedSongs,
      ambiguousMusicians,
      unmatchedMusicians,
      hasExisting: true,
    });
  }

  if (normalizeSongName(liveSetlist.name) !== normalizeSongName(desired.setlistName)) {
    flags.push(
      `Setlist name in Prime is "${liveSetlist.name}" but the convention expects "${desired.setlistName}". Renaming through the website is not implemented, so it was left unchanged.`,
    );
  }

  if (songsBlocked) {
    flags.push('Setlist left untouched until every song is matched');
    return finish({
      desired,
      operations,
      blockedReasons,
      flags,
      songsBlocked,
      ambiguousSongs,
      unmatchedSongs,
      ambiguousMusicians,
      unmatchedMusicians,
      hasExisting: true,
    });
  }

  const pairings = pairTracks(desiredTracks, liveSetlist.tracks);
  const removals = pairings.filter((pair) => pair.desired === null && pair.existing);
  const additions = pairings.filter((pair) => pair.desired && !pair.existing);
  const retained = pairings.filter((pair) => pair.desired && pair.existing);

  if (removals.length > 0) {
    if (capabilitySupported(capabilities, 'remove_track')) {
      for (const pair of removals) {
        operations.push({
          pcoPlanId: planId,
          changeType: 'remove_track',
          description: `Remove "${pair.existing!.title}" (no longer in the Planning Center plan)`,
          setlistTrackId: pair.existing!.setlistTrackId,
          trackTitle: pair.existing!.title,
          trackId: pair.existing!.trackId,
        });
      }
    } else {
      flags.push(
        `Removing tracks is not available through the automation: ${capabilityNote(capabilities, 'remove_track')}`,
      );
    }
  }

  if (additions.length > 0) {
    if (capabilitySupported(capabilities, 'add_track')) {
      const ordered = additions.map((pair) => pair.desired!);
      operations.push(...addOperations(planId, ordered, capabilities, flags, true));
    } else {
      flags.push(`Adding tracks is not available through the automation: ${capabilityNote(capabilities, 'add_track')}`);
    }
  }

  // Pure reorder: every desired track already exists, only the order changed.
  if (removals.length === 0 && additions.length === 0 && retained.length > 0) {
    const desiredOrder = retained.map((pair) => pair.existing!.setlistTrackId);
    const currentOrder = [...liveSetlist.tracks]
      .sort((a, b) => a.position - b.position)
      .map((track) => track.setlistTrackId);
    if (desiredOrder.join('|') !== currentOrder.join('|')) {
      if (capabilitySupported(capabilities, 'reorder_tracks')) {
        operations.push({
          pcoPlanId: planId,
          changeType: 'reorder_tracks',
          description: 'Reorder Prime setlist tracks to match Planning Center',
          desiredOrder,
          currentOrder,
        });
      } else {
        flags.push(
          `Reordering tracks is not available through the automation: ${capabilityNote(
            capabilities,
            'reorder_tracks',
          )}`,
        );
      }
    }
  }

  // ---- Keys --------------------------------------------------------------
  const keyChanges: Array<{ existing: PrimeSetlistTrack; desired: DesiredTrack; toKey: string }> = [];
  for (const pair of retained) {
    const toKey = pair.desired!.keyName;
    if (!toKey) continue;
    const fromKey = pair.existing!.key;
    if (fromKey === null) {
      flags.push(
        `Prime does not expose the current key for "${pair.existing!.title}", so the key cannot be verified. The key was not changed.`,
      );
      continue;
    }
    if (keysEqual(fromKey, toKey)) continue;
    keyChanges.push({ existing: pair.existing!, desired: pair.desired!, toKey });
  }

  if (keyChanges.length > 0) {
    if (capabilitySupported(capabilities, 'change_key')) {
      for (const change of keyChanges) {
        operations.push({
          pcoPlanId: planId,
          changeType: 'key_change',
          description: `Change key of "${change.existing.title}" from ${change.existing.key ?? 'unknown'} to ${change.toKey} (BPM untouched)`,
          setlistTrackId: change.existing.setlistTrackId,
          trackTitle: change.existing.title,
          fromKey: change.existing.key,
          toKey: change.toKey,
        });
      }
    } else {
      const detail = capabilityNote(capabilities, 'change_key');
      flags.push(
        `${keyChanges.length} key change${keyChanges.length === 1 ? '' : 's'} pending (${keyChanges
          .map((c) => `${c.existing.title}: ${c.existing.key ?? '?'} → ${c.toKey}`)
          .join('; ')}). Loop key editing is not verified/configured: ${detail}`,
      );
      for (const change of keyChanges) {
        operations.push({
          pcoPlanId: planId,
          changeType: 'flag_review',
          description: `Key change not applied for "${change.existing.title}" (${change.existing.key ?? '?'} → ${
            change.toKey
          }): ${detail}`,
          reason: 'prime_key_change_unsupported',
        });
      }
    }
  }

  // ---- Sharing -----------------------------------------------------------
  const currentShares = liveSetlist.shares.map((share) => share.memberId);
  operations.push(...shareOperations(planId, desiredShares, currentShares, capabilities, flags));
  const desiredMemberIds = new Set(desiredShares.map((share) => share.memberId));
  const extraShares = liveSetlist.shares.filter((share) => !desiredMemberIds.has(share.memberId));
  if (extraShares.length > 0) {
    if (capabilitySupported(capabilities, 'unshare_member')) {
      for (const share of extraShares) {
        operations.push({
          pcoPlanId: planId,
          changeType: 'unshare_member',
          description: `Remove sharing for ${share.memberName}${
            share.email ? ` (${share.email})` : ''
          } — no longer scheduled in a worship team`,
          memberId: share.memberId,
          memberName: share.memberName,
        });
      }
    } else {
      flags.push(
        `Removing an individual member from a setlist is not available through the automation: ${capabilityNote(
          capabilities,
          'unshare_member',
        )}`,
      );
    }
  }

  for (const flag of flags) {
    if (flag.includes('not available') || flag.includes('not verified') || flag.includes('not implemented')) {
      operations.push({
        pcoPlanId: planId,
        changeType: 'flag_review',
        description: flag,
        reason: 'prime_limitation',
      });
    }
  }

  return finish({
    desired,
    operations,
    blockedReasons,
    flags,
    songsBlocked,
    ambiguousSongs,
    unmatchedSongs,
    ambiguousMusicians,
    unmatchedMusicians,
    hasExisting: true,
    liveTrackCount: liveSetlist.tracks.length,
  });
}

function addOperations(
  planId: string,
  tracks: DesiredTrack[],
  capabilities: PrimeCapabilityReport[],
  flags: string[],
  existingSetlist = false,
): SyncOperation[] {
  if (!capabilitySupported(capabilities, 'add_track')) {
    flags.push(`Adding tracks is not available through the automation: ${capabilityNote(capabilities, 'add_track')}`);
    return [];
  }
  return tracks.map((track, index) => ({
    pcoPlanId: planId,
    changeType: 'add_track' as const,
    description: `${existingSetlist ? 'Add' : 'Add'} "${track.trackName}" to the Prime setlist${
      track.keyName ? ` (key ${track.keyName})` : ''
    }`,
    track,
    position: index + 1,
  }));
}

function shareOperations(
  planId: string,
  desiredShares: DesiredShare[],
  currentMemberIds: string[],
  capabilities: PrimeCapabilityReport[],
  flags: string[],
): SyncOperation[] {
  if (desiredShares.length === 0) return [];
  const current = new Set(currentMemberIds);
  const missing = desiredShares.filter((share) => !current.has(share.memberId));
  if (missing.length === 0) return [];
  if (!capabilitySupported(capabilities, 'share_member')) {
    flags.push(`Sharing is not available through the automation: ${capabilityNote(capabilities, 'share_member')}`);
    return [];
  }
  return missing.map((member) => ({
    pcoPlanId: planId,
    changeType: 'share_member' as const,
    description: `Share the setlist with ${member.name} (${member.email})`,
    member,
  }));
}

function finish(input: {
  desired: DesiredPlan;
  operations: SyncOperation[];
  blockedReasons: string[];
  flags: string[];
  songsBlocked: boolean;
  ambiguousSongs: string[];
  unmatchedSongs: string[];
  ambiguousMusicians: string[];
  unmatchedMusicians: string[];
  hasExisting: boolean;
  liveTrackCount?: number;
}): PlanSyncPreview {
  const { desired, operations } = input;
  const blocked = input.songsBlocked || input.blockedReasons.length > 0;

  const realOperations = operations.filter((operation) => operation.changeType !== 'flag_review');
  const status: PlanSyncStatus = blocked
    ? input.desired.songs.length === 0
      ? 'in_sync'
      : 'blocked'
    : input.songsBlocked || input.ambiguousMusicians.length > 0 || input.unmatchedMusicians.length > 0
      ? 'needs_matching'
      : realOperations.length > 0
        ? 'pending'
        : 'in_sync';

  return {
    pcoPlanId: desired.plan.id,
    planTitle: desired.plan.title,
    planDate: desired.plan.planDate,
    setlistName: desired.setlistName,
    status,
    blocked,
    blockedReasons: [...new Set([...input.blockedReasons, ...input.flags.filter((flag) => flag.includes('Cannot') || flag.includes('Not creating'))])],
    operations,
    unmatchedSongs: input.unmatchedSongs,
    ambiguousSongs: input.ambiguousSongs,
    unmatchedMusicians: input.unmatchedMusicians,
    ambiguousMusicians: input.ambiguousMusicians,
  };
}
