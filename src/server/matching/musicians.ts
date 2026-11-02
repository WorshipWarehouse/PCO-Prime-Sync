import type { PrimeTeamMember } from '../../shared/types';
import { isPlausibleEmail, normalizeEmail } from '../../shared/naming';

export interface MemberMatchResult {
  status: 'matched' | 'ambiguous' | 'unmatched' | 'review';
  normalizedEmail: string;
  candidates: PrimeTeamMember[];
  matched: PrimeTeamMember | null;
  reason: string | null;
}

/**
 * Match a scheduled PCO musician to a Loop Prime team member using email only.
 *
 *  - emails are normalized (trim + lowercase) and compared exactly
 *  - names are NEVER used for automatic matching or as a tiebreaker
 *  - missing/invalid email -> review (cannot be matched safely)
 *  - several identical normalized emails -> ambiguous, administrator decides
 */
export function matchMusicianByEmail(email: string | null | undefined, members: PrimeTeamMember[]): MemberMatchResult {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return {
      status: 'review',
      normalizedEmail,
      candidates: [],
      matched: null,
      reason: 'No email address on the Planning Center person record',
    };
  }
  if (!isPlausibleEmail(normalizedEmail)) {
    return {
      status: 'review',
      normalizedEmail,
      candidates: [],
      matched: null,
      reason: `"${normalizedEmail}" is not a valid email address`,
    };
  }

  const candidates = members.filter((member) => normalizeEmail(member.email) === normalizedEmail);

  if (candidates.length === 1) {
    return { status: 'matched', normalizedEmail, candidates, matched: candidates[0]!, reason: null };
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      normalizedEmail,
      candidates,
      matched: null,
      reason: `${candidates.length} Prime team members share this email address`,
    };
  }
  return {
    status: 'unmatched',
    normalizedEmail,
    candidates: [],
    matched: null,
    reason: 'No Prime team member uses this email address',
  };
}

/**
 * Deduplicate scheduled musicians. A person scheduled on multiple worship teams
 * (across plans or within one plan) is shared with once.
 */
export function dedupeMusicians<T extends { pcoPersonId: string }>(musicians: T[]): T[] {
  const seen = new Map<string, T>();
  for (const musician of musicians) {
    if (!seen.has(musician.pcoPersonId)) seen.set(musician.pcoPersonId, musician);
  }
  return [...seen.values()];
}
