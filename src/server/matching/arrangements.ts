import type { ArrangementChoice, PcoArrangement, PrimeTrack, PrimeTrackArrangement } from '../../shared/types';
import { normalizeSongName } from '../../shared/naming';

export interface ArrangementSelection {
  choice: ArrangementChoice;
  arrangement: PcoArrangement | null;
  reason: string | null;
}

/**
 * Arrangement selection rules (strict, per project spec):
 *  1. "Default" when it exists
 *  2. otherwise "Original"
 *  3. never any other arrangement — flag for manual review instead
 *
 * This is intentionally separate from key selection: the key always comes from
 * the PCO plan item, never from the arrangement.
 */
export function selectArrangement(arrangements: PcoArrangement[]): ArrangementSelection {
  const byName = (target: string): PcoArrangement | null =>
    arrangements.find((arrangement) => normalizeSongName(arrangement.name) === normalizeSongName(target)) ?? null;

  const defaultArrangement = byName('Default');
  if (defaultArrangement) {
    return { choice: 'default', arrangement: defaultArrangement, reason: null };
  }
  const originalArrangement = byName('Original');
  if (originalArrangement) {
    return { choice: 'original', arrangement: originalArrangement, reason: null };
  }
  return {
    choice: 'none',
    arrangement: null,
    reason:
      arrangements.length === 0
        ? 'Planning Center has no arrangements for this song'
        : `Neither a "Default" nor an "Original" arrangement exists (found: ${arrangements
            .map((a) => a.name || '(unnamed)')
            .join(', ')})`,
  };
}

/**
 * When the Loop multitrack exposes named arrangements, prefer the one whose name
 * matches the chosen PCO arrangement. Otherwise leave the track's own default
 * arrangement untouched (we never guess).
 */
export function selectPrimeArrangement(
  trackArrangements: PrimeTrackArrangement[],
  pcoArrangementName: string | null,
): PrimeTrackArrangement | null {
  if (!pcoArrangementName) return null;
  const normalized = normalizeSongName(pcoArrangementName);
  return trackArrangements.find((arrangement) => normalizeSongName(arrangement.name) === normalized) ?? null;
}

/** Helper used by the resolver to store a track's arrangement choice. */
export function primeArrangementForTrack(
  track: PrimeTrack,
  pcoArrangementName: string | null,
): PrimeTrackArrangement | null {
  return selectPrimeArrangement(track.arrangements ?? [], pcoArrangementName);
}
