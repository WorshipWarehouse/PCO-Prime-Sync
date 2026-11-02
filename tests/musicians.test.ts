import { describe, expect, it } from 'vitest';
import type { PrimeTeamMember } from '../src/shared/types';
import { dedupeMusicians, matchMusicianByEmail } from '../src/server/matching/musicians';

function member(id: string, name: string, email: string): PrimeTeamMember {
  return { id, name, email: email.toLowerCase(), rawEmail: email, role: null };
}

const members = [
  member('1', 'Jordan Lee', 'Jordan.Lee@Example.com'),
  member('2', 'Sam Rivera', 'sam.rivera@example.com'),
  member('3', 'Casey Morgan', 'casey.morgan@example.com'),
];

describe('matchMusicianByEmail', () => {
  it('matches case-insensitively on email', () => {
    const result = matchMusicianByEmail('jordan.lee@example.com', members);
    expect(result.status).toBe('matched');
    expect(result.matched?.id).toBe('1');
  });

  it('trims surrounding whitespace', () => {
    expect(matchMusicianByEmail('  sam.rivera@example.com ', members).status).toBe('matched');
  });

  it('never matches by name alone', () => {
    const result = matchMusicianByEmail('someone.else@example.com', members);
    expect(result.status).toBe('unmatched');
    expect(result.matched).toBeNull();
  });

  it('flags duplicate email matches instead of picking one', () => {
    const result = matchMusicianByEmail('casey.morgan@example.com', [
      ...members,
      member('4', 'Casey M.', 'casey.morgan@example.com'),
    ]);
    expect(result.status).toBe('ambiguous');
    expect(result.matched).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('flags missing or invalid emails for review', () => {
    expect(matchMusicianByEmail(null, members)).toMatchObject({ status: 'review' });
    expect(matchMusicianByEmail('not-an-email', members)).toMatchObject({ status: 'review' });
  });
});

describe('dedupeMusicians', () => {
  it('keeps one entry per PCO person (multiple teams)', () => {
    const deduped = dedupeMusicians([
      { pcoPersonId: 'p1', teamId: 'worship' },
      { pcoPersonId: 'p1', teamId: 'vocals' },
      { pcoPersonId: 'p2', teamId: 'worship' },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((entry) => entry.pcoPersonId)).toEqual(['p1', 'p2']);
  });
});
