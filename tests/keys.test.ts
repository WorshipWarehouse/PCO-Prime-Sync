import { describe, expect, it } from 'vitest';
import { isKeyComparable, keyForPrime, keysEqual, parseKey } from '../src/shared/keys';

describe('parseKey', () => {
  it('parses simple and accidental keys', () => {
    expect(parseKey('G')).toMatchObject({ normalized: 'G', pitchClass: 7, mode: 'unknown' });
    expect(parseKey('Ab')).toMatchObject({ normalized: 'Ab', pitchClass: 8 });
    expect(parseKey('F#')).toMatchObject({ normalized: 'F#', pitchClass: 6 });
    expect(parseKey('bb')).toMatchObject({ normalized: 'Bb', pitchClass: 10 });
  });

  it('parses modes', () => {
    expect(parseKey('Am')).toMatchObject({ normalized: 'Am', pitchClass: 9, mode: 'minor' });
    expect(parseKey('Bb minor')).toMatchObject({ normalized: 'Bbm', pitchClass: 10, mode: 'minor' });
    expect(parseKey('C Major')).toMatchObject({ normalized: 'C', pitchClass: 0, mode: 'major' });
    expect(parseKey('')).toMatchObject({ normalized: '', pitchClass: null });
  });
});

describe('keysEqual', () => {
  it('treats enharmonic spellings as equal', () => {
    expect(keysEqual('Ab', 'G#')).toBe(true);
    expect(keysEqual('Db', 'C#')).toBe(true);
    expect(keysEqual('B', 'Cb')).toBe(true);
  });

  it('treats label differences as equal', () => {
    expect(keysEqual('G', 'g')).toBe(true);
    expect(keysEqual('G', 'G Major')).toBe(true);
    expect(keysEqual(' G ', 'G')).toBe(true);
  });

  it('detects real key changes', () => {
    expect(keysEqual('G', 'A')).toBe(false);
    expect(keysEqual('G', 'Gm')).toBe(false);
    expect(keysEqual('C', 'C#')).toBe(false);
  });

  it('handles missing values without throwing', () => {
    expect(keysEqual(null, null)).toBe(true);
    expect(keysEqual('G', null)).toBe(false);
    expect(keysEqual(undefined, '')).toBe(true);
  });
});

describe('key helpers', () => {
  it('sends PCO spelling to Prime', () => {
    expect(keyForPrime(' Bb ')).toBe('Bb');
    expect(keyForPrime('')).toBeNull();
    expect(keyForPrime(null)).toBeNull();
  });

  it('knows when a key is comparable', () => {
    expect(isKeyComparable('F#')).toBe(true);
    expect(isKeyComparable('unknown')).toBe(false);
  });
});
