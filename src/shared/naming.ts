/**
 * Name/email normalization used for song and team-member matching.
 *
 * Rules (documented in README):
 *  - lowercase
 *  - trim leading/trailing whitespace
 *  - ignore punctuation (any character that is not a letter, number or space)
 *  - collapse repeated whitespace to single spaces
 *  - treat common unicode apostrophes/quotes as punctuation too
 *
 * Accents are folded (NFKD + strip combining marks) so "Café" === "Cafe".
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Normalize a song title for comparison. Never used as a permanent identifier. */
export function normalizeSongName(raw: string | null | undefined): string {
  if (!raw) return '';
  const folded = raw.normalize('NFKD').replace(COMBINING_MARKS, '');
  const withoutPunctuation = folded
    // Keep letters, numbers, and whitespace; drop everything else (.,'!?()-& etc.)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase();
  return withoutPunctuation.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize an email address for team-member matching.
 * Matching is case-insensitive on the whole address.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().toLowerCase();
}

/** Basic email sanity check; deliberately permissive but rejects obvious junk. */
export function isPlausibleEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const value = raw.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Format an ISO date (YYYY-MM-DD) as "November 8, 2026".
 * Done with plain string math so the result is timezone independent.
 */
export function formatLongDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const month = MONTHS[monthIndex];
  if (!month) return isoDate;
  return `${month} ${day}, ${year}`;
}

/**
 * Consistent Prime setlist naming convention: `<plan name> — <long date>`.
 *
 *   Sunday Service — November 8, 2026
 *
 * The em dash (U+2014) and single spaces are intentional and stable, so mapping
 * back from Prime names to PCO plans is deterministic.
 */
export function buildSetlistName(planTitle: string, isoDate: string): string {
  const title = (planTitle ?? '').trim().replace(/\s+/g, ' ');
  const date = formatLongDate(isoDate);
  if (!title) return date;
  return `${title} — ${date}`;
}

/**
 * Case/space tolerant comparison of a setlist name. Used only to help an admin
 * find an existing setlist; Prime setlist ids remain the real identifier.
 */
export function setlistNamesMatch(a: string, b: string): boolean {
  return normalizeSongName(a) === normalizeSongName(b);
}

/** Format a local Date as YYYY-MM-DD in the given IANA timezone. */
export function toIsoDateInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Current hour/minute/second in an IANA timezone. Used by the scheduler so that
 * daylight saving transitions follow America/New_York automatically.
 */
export function timePartsInTimeZone(
  date: Date,
  timeZone: string,
): { hour: number; minute: number; second: number; isoDate: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = Number(get('hour')) % 24;
  return {
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Add days to an ISO date (YYYY-MM-DD) without timezone drift. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const base = Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  const shifted = new Date(base + days * 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Compare two ISO dates (YYYY-MM-DD); negative when a < b. */
export function compareIsoDates(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
