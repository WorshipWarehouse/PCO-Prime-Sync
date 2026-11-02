/**
 * Musical key handling.
 *
 * Planning Center is the source of truth for keys. This module only:
 *  - normalizes key strings for comparison (so "G" vs "g " vs "G Major" match)
 *  - treats enharmonic spellings as equal (Ab == G#) so we do not thrash the
 *    Loop key back and forth between equivalent names
 *  - parses optional minor/major mode
 *
 * Minor keys are compared strictly: "Am" is NOT equal to "A".
 */

const PITCH_CLASSES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const ACCIDENTALS: Record<string, number> = {
  '': 0,
  '#': 1,
  '##': 2,
  b: -1,
  bb: -2,
  '♯': 1,
  '♭': -1,
};

export type KeyMode = 'major' | 'minor' | 'unknown';

export interface ParsedKey {
  /** Normalized display form, e.g. "Ab", "F#m", "C". */
  normalized: string;
  /** 0-11 pitch class of the tonic, or null when unparseable. */
  pitchClass: number | null;
  mode: KeyMode;
}

/**
 * Parse a key label such as "G", "Ab", "F#", "Bb minor", "Am", "C#m".
 * Returns normalized === '' for empty input.
 */
export function parseKey(raw: string | null | undefined): ParsedKey {
  const value = (raw ?? '').trim();
  if (!value) return { normalized: '', pitchClass: null, mode: 'unknown' };

  // Split trailing mode words, e.g. "Bb Major", "A minor", "Gm"
  let tonicPart = value;
  let mode: KeyMode = 'unknown';

  const modeWordMatch = /^(.*?)[\s-]*(major|maj|minor|min)$/i.exec(value);
  if (modeWordMatch) {
    tonicPart = (modeWordMatch[1] ?? '').trim();
    mode = /^maj/i.test(modeWordMatch[2] ?? '') ? 'major' : 'minor';
  }

  // Trailing single "m" means minor ("Am"), only if the tonic itself is not "m".
  const minorSuffix = /^([A-Ga-g][#b♯♭]?)m$/.exec(tonicPart.replace(/\s+/g, ''));
  if (!modeWordMatch && minorSuffix) {
    tonicPart = minorSuffix[1] ?? tonicPart;
    mode = 'minor';
  }

  const compact = tonicPart.replace(/\s+/g, '');
  const match = /^([A-Ga-g])(##|bb|#|b|♯|♭)?$/.exec(compact);
  if (!match) {
    return { normalized: value, pitchClass: null, mode };
  }

  const letter = (match[1] ?? '').toUpperCase();
  const accidentalRaw = match[2] ?? '';
  const accidental =
    accidentalRaw === '♯' ? '#' : accidentalRaw === '♭' ? 'b' : accidentalRaw;

  const base = PITCH_CLASSES[letter];
  const offset = ACCIDENTALS[accidental] ?? 0;
  const pitchClass = base === undefined ? null : (((base + offset) % 12) + 12) % 12;

  const suffix = mode === 'minor' ? 'm' : '';
  return {
    normalized: `${letter}${accidental}${suffix}`,
    pitchClass,
    mode,
  };
}

/**
 * Compare two key labels for sync purposes.
 *
 * Equal when the tonic pitch class matches (enharmonically) and neither side is
 * known to be minor while the other is major. When the mode cannot be
 * determined on both sides, only pitch class is compared — this avoids endless
 * key rewrites from label differences alone.
 */
export function keysEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseKey(a);
  const right = parseKey(b);
  if (!left.normalized && !right.normalized) return true;
  if (!left.normalized || !right.normalized) return false;
  if (left.pitchClass === null || right.pitchClass === null) {
    return left.normalized.toLowerCase() === right.normalized.toLowerCase();
  }
  if (left.pitchClass !== right.pitchClass) return false;
  // Minor keys are never treated as equal to a major/unspecified key: that would
  // silently skip a real key change. Major vs unspecified compares equal, since
  // major is the default reading of a bare key name like "G".
  if (left.mode === 'minor' || right.mode === 'minor') {
    return left.mode === 'minor' && right.mode === 'minor';
  }
  return true;
}

/**
 * The value we send to Loop when PCO's key differs. We send PCO's own spelling
 * (trimmed) so the musicians see the same label as in Planning Center.
 */
export function keyForPrime(pcoKeyName: string | null | undefined): string | null {
  const value = (pcoKeyName ?? '').trim();
  return value === '' ? null : value;
}

/** True when a key string is understood well enough to compare reliably. */
export function isKeyComparable(raw: string | null | undefined): boolean {
  return parseKey(raw).pitchClass !== null;
}
