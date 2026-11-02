import { describe, expect, it } from 'vitest';
import type { PrimeSelectorConfig } from '../src/server/prime/playwright/selectors';
import {
  LOOP_PRIME_ENTRY_PATH,
  PrimeBrowserSession,
  WORSHIPTOOLS_LOGIN_URL,
} from '../src/server/prime/playwright/session';

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
  it('opens Loop Community sign-in through WorshipTools', () => {
    expect(WORSHIPTOOLS_LOGIN_URL).toBe('https://auth.worshiptools.com/login');
    expect(session().loginUrl).toBe('https://auth.worshiptools.com/login');
  });

  it('keeps the sign-in URL independent of the configured base URL', () => {
    expect(session({ baseUrl: 'https://loopcommunity.com/' }).loginUrl).toBe(
      'https://auth.worshiptools.com/login',
    );
    expect(session({ baseUrl: 'https://prime.example.test' }).loginUrl).toBe(
      'https://auth.worshiptools.com/login',
    );
  });

  it('honours an explicit login URL', () => {
    expect(session({ loginUrl: 'https://apps.example.test/sign-in' }).loginUrl).toBe(
      'https://apps.example.test/sign-in',
    );
  });

  it('still knows the Prime app entry path used by automation', () => {
    expect(LOOP_PRIME_ENTRY_PATH).toBe('/prime-multitrack-app');
  });
});
