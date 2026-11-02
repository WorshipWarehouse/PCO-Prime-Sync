import { describe, expect, it } from 'vitest';
import type { PrimeTrack } from '../src/shared/types';
import { dedupeTracks, matchSongToTracks } from '../src/server/matching/songs';

function track(id: string, title: string): PrimeTrack {
  return { id, title, subtitle: null, arrangements: [], availableKeys: [], url: null };
}

describe('matchSongToTracks', () => {
  it('matches exactly one multitrack', () => {
    const result = matchSongToTracks('Great Are You Lord', [track('1', 'Great Are You Lord')]);
    expect(result.status).toBe('matched');
    expect(result.matched?.id).toBe('1');
  });

  it('ignores punctuation, case and extra whitespace', () => {
    const result = matchSongToTracks('  goodness OF god! ', [track('1', 'Goodness of God')]);
    expect(result.status).toBe('matched');
  });

  it('does not match on artist or partial titles', () => {
    const result = matchSongToTracks('Goodness of God', [
      track('1', 'Goodness of God (Live)'),
      track('2', 'Goodness of God'),
    ]);
    expect(result.status).toBe('matched');
    expect(result.matched?.id).toBe('2');
  });

  it('reports ambiguity for duplicate names and never auto-picks', () => {
    const result = matchSongToTracks('Goodness of God', [
      track('1', 'Goodness of God'),
      track('2', 'Goodness of God'),
    ]);
    expect(result.status).toBe('ambiguous');
    expect(result.matched).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('reports unmatched songs', () => {
    const result = matchSongToTracks('Unknown Song', [track('1', 'Goodness of God')]);
    expect(result.status).toBe('unmatched');
    expect(result.candidates).toHaveLength(0);
  });

  it('treats an empty title as unmatched', () => {
    expect(matchSongToTracks('   ', [track('1', 'Goodness of God')]).status).toBe('unmatched');
  });
});

describe('dedupeTracks', () => {
  it('removes duplicate ids from search results', () => {
    const tracks = dedupeTracks([track('1', 'A'), track('1', 'A'), track('2', 'B')]);
    expect(tracks.map((item) => item.id)).toEqual(['1', '2']);
  });
});
