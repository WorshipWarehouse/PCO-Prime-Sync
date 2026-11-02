import { describe, expect, it } from 'vitest';
import type { PcoArrangement } from '../src/shared/types';
import { selectArrangement, selectPrimeArrangement } from '../src/server/matching/arrangements';

function arrangement(id: string, name: string): PcoArrangement {
  return { id, name, bpm: 72, keys: [] };
}

describe('selectArrangement', () => {
  it('prefers Default over other arrangements', () => {
    const result = selectArrangement([
      arrangement('a', 'Original'),
      arrangement('b', 'Default'),
      arrangement('c', 'Live'),
    ]);
    expect(result.choice).toBe('default');
    expect(result.arrangement?.id).toBe('b');
  });

  it('falls back to Original', () => {
    const result = selectArrangement([arrangement('a', 'Live'), arrangement('b', 'Original')]);
    expect(result.choice).toBe('original');
    expect(result.arrangement?.id).toBe('b');
  });

  it('never selects another arrangement automatically', () => {
    const result = selectArrangement([arrangement('a', 'Live'), arrangement('b', 'Acoustic')]);
    expect(result.choice).toBe('none');
    expect(result.arrangement).toBeNull();
    expect(result.reason).toContain('Default');
  });

  it('reports missing arrangements', () => {
    const result = selectArrangement([]);
    expect(result.choice).toBe('none');
    expect(result.reason).toContain('no arrangements');
  });

  it('matches arrangement names case-insensitively', () => {
    expect(selectArrangement([arrangement('a', 'default')]).choice).toBe('default');
    expect(selectArrangement([arrangement('a', 'ORIGINAL')]).choice).toBe('original');
  });
});

describe('selectPrimeArrangement', () => {
  it('matches the Loop arrangement by name', () => {
    const result = selectPrimeArrangement(
      [
        { id: 'x', name: 'Studio' },
        { id: 'y', name: 'Default' },
      ],
      'Default',
    );
    expect(result?.id).toBe('y');
  });

  it('returns null instead of guessing', () => {
    expect(selectPrimeArrangement([{ id: 'x', name: 'Studio' }], 'Original')).toBeNull();
    expect(selectPrimeArrangement([{ id: 'x', name: 'Studio' }], null)).toBeNull();
  });
});
