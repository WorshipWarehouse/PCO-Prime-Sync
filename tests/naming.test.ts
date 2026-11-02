import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  buildSetlistName,
  formatLongDate,
  isPlausibleEmail,
  normalizeEmail,
  normalizeSongName,
  setlistNamesMatch,
  timePartsInTimeZone,
} from '../src/shared/naming';

describe('normalizeSongName', () => {
  it('lowercases, trims, removes punctuation and collapses spaces', () => {
    expect(normalizeSongName('  Great Are You Lord!  ')).toBe('great are you lord');
    expect(normalizeSongName('Goodness of God (Live)')).toBe('goodness of god live');
    expect(normalizeSongName('Way    Maker')).toBe('way maker');
    expect(normalizeSongName("It's   Well")).toBe('it s well');
  });

  it('folds accents and typographic apostrophes', () => {
    expect(normalizeSongName('Café Song')).toBe('cafe song');
    expect(normalizeSongName('God’s Love')).toBe('god s love');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeSongName(null)).toBe('');
    expect(normalizeSongName('   ')).toBe('');
    expect(normalizeSongName('!!!')).toBe('');
  });

  it('treats different punctuation as the same name', () => {
    expect(normalizeSongName('Hosanna - Praise')).toBe(normalizeSongName('Hosanna Praise'));
    expect(normalizeSongName('Oceans (Where Feet May Fail)')).toBe(
      normalizeSongName('Oceans Where Feet May Fail'),
    );
  });
});

describe('normalizeEmail / isPlausibleEmail', () => {
  it('trims and lowercases addresses', () => {
    expect(normalizeEmail('  Jordan.Lee@Example.COM ')).toBe('jordan.lee@example.com');
  });

  it('rejects junk addresses', () => {
    expect(isPlausibleEmail('not-an-email')).toBe(false);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail('a@b.co')).toBe(true);
    expect(isPlausibleEmail(null)).toBe(false);
  });
});

describe('setlist naming', () => {
  it('formats long dates deterministically', () => {
    expect(formatLongDate('2026-11-08')).toBe('November 8, 2026');
    expect(formatLongDate('2026-01-31')).toBe('January 31, 2026');
    expect(formatLongDate('bogus')).toBe('bogus');
  });

  it('builds the documented naming convention', () => {
    expect(buildSetlistName('Sunday Service', '2026-11-08')).toBe('Sunday Service — November 8, 2026');
    expect(buildSetlistName('  Sunday   Service ', '2026-11-08')).toBe('Sunday Service — November 8, 2026');
    expect(buildSetlistName('', '2026-11-08')).toBe('November 8, 2026');
  });

  it('compares names case/punctuation-insensitively', () => {
    expect(setlistNamesMatch('Sunday Service — November 8, 2026', 'sunday service november 8 2026')).toBe(true);
  });
});

describe('date helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDaysToIsoDate('2026-11-25', 10)).toBe('2026-12-05');
    expect(addDaysToIsoDate('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDaysToIsoDate('2026-03-07', 1)).toBe('2026-03-08');
  });

  it('reads local time in a timezone', () => {
    const winter = new Date('2026-01-15T08:30:00Z');
    const summer = new Date('2026-07-15T07:30:00Z');
    expect(timePartsInTimeZone(winter, 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
    expect(timePartsInTimeZone(summer, 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
  });
});
