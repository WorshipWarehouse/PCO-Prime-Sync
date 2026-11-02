import type { PrimeTrack } from '../../shared/types';
import { normalizeSongName } from '../../shared/naming';

export interface SongMatchResult {
  status: 'matched' | 'ambiguous' | 'unmatched';
  normalized: string;
  candidates: PrimeTrack[];
  matched: PrimeTrack | null;
}

/**
 * Match a Planning Center song title against Loop Prime multitracks.
 *
 * Rules (exact, per project spec):
 *  - compare normalized names only (lowercase, punctuation-insensitive,
 *    whitespace-collapsed); artist metadata is never considered
 *  - exactly one match -> matched
 *  - more than one match -> ambiguous (NEVER auto-picked)
 *  - no match -> unmatched
 */
export function matchSongToTracks(title: string, tracks: PrimeTrack[]): SongMatchResult {
  const normalized = normalizeSongName(title);
  if (!normalized) {
    return { status: 'unmatched', normalized, candidates: [], matched: null };
  }

  const candidates = tracks.filter((track) => normalizeSongName(track.title) === normalized);

  if (candidates.length === 1) {
    return { status: 'matched', normalized, candidates, matched: candidates[0]! };
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', normalized, candidates, matched: null };
  }
  return { status: 'unmatched', normalized, candidates: [], matched: null };
}

/** Deduplicate candidates by Prime track id (search results often repeat). */
export function dedupeTracks(tracks: PrimeTrack[]): PrimeTrack[] {
  const seen = new Map<string, PrimeTrack>();
  for (const track of tracks) {
    if (!seen.has(track.id)) seen.set(track.id, track);
  }
  return [...seen.values()];
}
