import { describe, expect, it } from 'vitest';
import { computeNextRun } from '../src/server/sync/scheduler';
import { timePartsInTimeZone } from '../src/shared/naming';

describe('computeNextRun', () => {
  it('finds the next 3:00 AM Eastern run', () => {
    const from = new Date('2026-11-01T12:00:00Z');
    const next = computeNextRun(from, 3, 0, 'America/New_York');
    expect(next).not.toBeNull();
    expect(timePartsInTimeZone(next!, 'America/New_York')).toMatchObject({ hour: 3, minute: 0 });
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it('handles the spring DST transition', () => {
    // US DST starts 2026-03-08 at 02:00 local.
    const from = new Date('2026-03-07T12:00:00Z');
    const next = computeNextRun(from, 3, 0, 'America/New_York');
    expect(timePartsInTimeZone(next!, 'America/New_York')).toMatchObject({ hour: 3, minute: 0 });
    expect(next!.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('handles the autumn DST transition', () => {
    // US DST ends 2026-11-01 at 02:00 local.
    const from = new Date('2026-10-31T12:00:00Z');
    const next = computeNextRun(from, 3, 0, 'America/New_York');
    expect(timePartsInTimeZone(next!, 'America/New_York')).toMatchObject({ hour: 3, minute: 0 });
    expect(next!.toISOString()).toBe('2026-11-01T08:00:00.000Z');
  });

  it('respects a non-midnight minute offset', () => {
    const from = new Date('2026-05-04T00:00:00Z');
    const next = computeNextRun(from, 4, 30, 'America/New_York');
    expect(timePartsInTimeZone(next!, 'America/New_York')).toMatchObject({ hour: 4, minute: 30 });
  });
});
