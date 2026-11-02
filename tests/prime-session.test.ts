import { describe, expect, it } from 'vitest';
import type { PrimeSelectorConfig } from '../src/server/prime/playwright/selectors';
import { LOOP_PRIME_ENTRY_PATH, PrimeBrowserSession } from '../src/server/prime/playwright/session';

const emptyConfig: PrimeSelectorConfig = { version: 1, verified: false, urls: { setlists: '' }, selectors: {} };

function session(overrides: { baseUrl?: string; loginUrl?: string } = {}): PrimeBrowserSession {
  return new PrimeBrowserSession({
    profileDir: '/tmp/pco-prime-sync-test-profile',
    headless: false,
    baseUrl: overrides.baseUrl ?? 'https://loopcommunity.com',
    loginUrl: overrides.loginUrl,
    loginTimeoutMs: 1_000,
    actionTimeoutMs: 1_000,
    selectorConfig: emptyConfig,
  });
}

describe('Prime login window URL', () => {
  it('opens the Prime app so the site performs its own sign-in redirect', () => {
    expect(LOOP_PRIME_ENTRY_PATH).toBe('/prime-multitrack-app');
    expect(session().loginUrl).toBe('https://loopcommunity.com/prime-multitrack-app');
  });

  it('ignores a trailing slash on the configured base URL', () => {
    expect(session({ baseUrl: 'https://loopcommunity.com/' }).loginUrl).toBe(
      'https://loopcommunity.com/prime-multitrack-app',
    );
  });

  it('follows a custom base URL', () => {
    expect(session({ baseUrl: 'https://prime.example.test' }).loginUrl).toBe(
      'https://prime.example.test/prime-multitrack-app',
    );
  });

  it('honours an explicit login URL', () => {
    expect(session({ loginUrl: 'https://apps.example.test/sign-in' }).loginUrl).toBe(
      'https://apps.example.test/sign-in',
    );
  });
});
