import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIME_BASE_URL,
  LOOP_PRIME_ENTRY_PATH,
  explainLoginNavigationFailure,
} from '../src/server/prime/playwright/session';

const loginUrl = 'https://prime.loopcommunity.com/prime-multitrack-app';

describe('login navigation failures', () => {
  it('names the unresolvable host and the correct entry point', () => {
    const result = explainLoginNavigationFailure(
      new Error(
        `page.goto: net::ERR_NAME_NOT_RESOLVED at ${loginUrl}\nCall log:\n  - navigating to "${loginUrl}"`,
      ),
      loginUrl,
    );

    expect(result.message).toContain('prime.loopcommunity.com');
    expect(result.message).toContain('ERR_NAME_NOT_RESOLVED');
    expect(result.hint).toContain(`${DEFAULT_PRIME_BASE_URL}${LOOP_PRIME_ENTRY_PATH}`);
    expect(result.hint).toContain('Prime base URL');
  });

  it('does not blame the browser for a refused connection', () => {
    const result = explainLoginNavigationFailure(new Error('net::ERR_CONNECTION_REFUSED'), loginUrl);

    expect(result.message).toContain('connection failed');
    expect(result.message.toLowerCase()).not.toContain('could not start');
    expect(result.hint.toLowerCase()).not.toContain('npx playwright install');
  });

  it('reports a slow page as a timeout rather than a missing browser', () => {
    const result = explainLoginNavigationFailure(new Error('page.goto: Timeout 20000ms exceeded.'), loginUrl);

    expect(result.message).toContain('did not finish loading in time');
    expect(result.hint).toContain('Prime base URL');
  });

  it('still points at the base URL when the reason is unrecognised', () => {
    const result = explainLoginNavigationFailure(new Error('something nobody predicted'), loginUrl);

    expect(result.message).toContain(loginUrl);
    expect(result.hint).toContain('Prime base URL');
  });
});
