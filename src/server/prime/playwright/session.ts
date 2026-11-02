import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { PrimeSessionStatus } from '../../../shared/types';
import { PrimeSessionExpiredError, type LoginWindowInfo } from '../adapter';
import { loadSelectorConfig, type PrimeSelectorConfig } from './selectors';

/**
 * Loop Community has no standalone login page: the Prime app redirects to
 * WorshipTools' shared sign-in with parameters only the site knows. So the login
 * window opens the Prime app and lets it perform that redirect, exactly like a
 * person would, instead of hard-coding an auth URL that redirects elsewhere.
 */
export const LOOP_PRIME_ENTRY_PATH = '/prime-multitrack-app';

/** Where the Prime app actually lives when nothing is configured. */
export const DEFAULT_PRIME_BASE_URL = 'https://loopcommunity.com';

/**
 * WorshipTools' marketing site. https://auth.worshiptools.com/login answers
 * with a 302 that ends here, so opening it shows a brochure with no sign-in
 * form: the flow has to start at the Prime app, which passes the parameters
 * the auth host needs.
 */
export const WORSHIPTOOLS_MARKETING_HOSTS = ['www.worshiptools.com', 'worshiptools.com'];

/** True when a URL ended up on WorshipTools' marketing site instead of a login. */
export function isMarketingDeadEnd(url: string): boolean {
  try {
    return WORSHIPTOOLS_MARKETING_HOSTS.includes(new URL(url).host);
  } catch {
    return false;
  }
}

export interface LoginNavigationFailure {
  message: string;
  hint: string;
}

/**
 * Turn a navigation error into something the administrator can act on.
 *
 * The browser normally launched fine and the page did not load, so telling
 * people to reinstall Chromium sends them after a browser that already worked.
 * The cause decides the fix, and a wrong base URL is the common one: a
 * configured `https://prime.loopcommunity.com` resolves nowhere.
 */
export function explainLoginNavigationFailure(
  error: unknown,
  loginUrl: string,
): LoginNavigationFailure {
  const raw = error instanceof Error ? error.message : String(error);
  let host = loginUrl;
  try {
    host = new URL(loginUrl).host;
  } catch {
    // Keep the raw URL when it cannot be parsed.
  }
  const fixBaseUrl =
    `The Prime app is at ${DEFAULT_PRIME_BASE_URL}${LOOP_PRIME_ENTRY_PATH}, so the configured base URL is wrong. ` +
    'Correct Settings → Prime base URL (or PRIME_BASE_URL in .env) and try again.';

  if (raw.includes('ERR_NAME_NOT_RESOLVED')) {
    return {
      message: `Loop Community could not be reached: the host ${host} does not resolve (net::ERR_NAME_NOT_RESOLVED).`,
      hint: fixBaseUrl,
    };
  }
  if (
    raw.includes('ERR_CONNECTION_REFUSED') ||
    raw.includes('ERR_INTERNET_DISCONNECTED') ||
    raw.includes('ERR_NETWORK_CHANGED') ||
    raw.includes('ERR_CONNECTION_RESET')
  ) {
    return {
      message: `Loop Community could not be reached at ${loginUrl}: the connection failed.`,
      hint: 'Check that this computer is online and that the Prime base URL in Settings points at a real host.',
    };
  }
  if (/timeout/i.test(raw)) {
    return {
      message: `The login window opened, but ${loginUrl} did not finish loading in time.`,
      hint: 'Check the connection and the Prime base URL in Settings, then try again.',
    };
  }
  return {
    message: `The login window opened, but ${loginUrl} could not be loaded.`,
    hint: fixBaseUrl,
  };
}

export interface PrimeSessionOptions {
  profileDir: string;
  headless: boolean;
  baseUrl: string;
  /** Overrides the page the manual login window opens. */
  loginUrl?: string;
  loginTimeoutMs: number;
  actionTimeoutMs: number;
  selectorConfig?: PrimeSelectorConfig;
}

/**
 * Owns the persistent Chromium profile used for Loop Community Prime.
 *
 * The profile directory stores the real session cookies. It is git-ignored and
 * created with owner-only permissions. Automation never bypasses CAPTCHA, 2FA or
 * any other security control: if the session is not authenticated, the adapter
 * pauses and asks the administrator to log in through the visible browser.
 */
export class PrimeBrowserSession {
  private context: BrowserContext | null = null;
  private readonly config: PrimeSelectorConfig;
  readonly profileDir: string;
  readonly headless: boolean;
  readonly baseUrl: string;
  readonly loginUrl: string;
  readonly loginTimeoutMs: number;
  readonly actionTimeoutMs: number;

  constructor(options: PrimeSessionOptions) {
    this.profileDir = options.profileDir;
    this.headless = options.headless;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // Default to the Prime app so its own sign-in redirect runs; the marketing
    // site (what auth.worshiptools.com/login falls back to) would just sit blank.
    this.loginUrl = options.loginUrl ?? `${this.baseUrl}${LOOP_PRIME_ENTRY_PATH}`;
    this.loginTimeoutMs = options.loginTimeoutMs;
    this.actionTimeoutMs = options.actionTimeoutMs;
    this.config = options.selectorConfig ?? loadSelectorConfig();
  }

  get selectorConfig(): PrimeSelectorConfig {
    return this.config;
  }

  /** Launch (once) the persistent browser context. */
  async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    fs.mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch (error) {
      throw new PrimeSessionExpiredError(
        'Playwright is not available. Run `npm install` and `npx playwright install chromium`.',
        error instanceof Error ? error.message : undefined,
      );
    }
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      viewport: { width: 1440, height: 900 },
      args: ['--no-first-run', '--no-default-browser-check'],
      // Never disable web security or add stealth patches: we drive the real site.
    });
    this.context.setDefaultTimeout(this.actionTimeoutMs);
    const pages = this.context.pages();
    const page = pages[0] ?? (await this.context.newPage());
    await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    return this.context;
  }

  async page(): Promise<Page> {
    const context = await this.ensureContext();
    const pages = context.pages();
    return pages[0] ?? context.newPage();
  }

  async isAuthenticated(): Promise<boolean> {
    const page = await this.page();
    const loggedIn = this.config.selectors.loggedInIndicator;
    const loggedOut = this.config.selectors.loggedOutIndicator;
    if (!loggedIn && !loggedOut) return false;
    if (loggedOut && (await page.locator(loggedOut).first().isVisible().catch(() => false))) return false;
    if (loggedIn) return page.locator(loggedIn).first().isVisible().catch(() => false);
    return false;
  }

  async status(): Promise<PrimeSessionStatus> {
    const checkedAt = new Date().toISOString();
    let currentUrl: string | null = null;
    try {
      const page = await this.page();
      currentUrl = page.url();
      const authenticated = await this.isAuthenticated();
      if (authenticated) {
        return {
          state: 'authenticated',
          checkedAt,
          message: 'Loop Community Prime session is active',
          currentUrl,
          profileDir: this.profileDir,
          loginUrl: this.loginUrl,
          headless: this.headless,
        };
      }
      const configured = Boolean(this.config.selectors.loggedInIndicator || this.config.selectors.loggedOutIndicator);
      return {
        state: configured ? 'needs_login' : 'unknown',
        checkedAt,
        message: configured
          ? `Loop Community needs a manual login at ${this.loginUrl} (Overview → Log in to Loop, or \`npm run prime:login\`).`
          : 'Login state cannot be detected yet: no login indicator selector is configured. Run `npm run prime:explore`.',
        currentUrl,
        profileDir: this.profileDir,
        headless: this.headless,
      };
    } catch (error) {
      return {
        state: 'error',
        checkedAt,
        message: error instanceof Error ? error.message : 'Failed to launch the Prime browser profile',
        currentUrl,
        profileDir: this.profileDir,
        headless: this.headless,
      };
    }
  }

  /**
   * Launch the visible browser and open the login page, then return while the
   * window stays open. Throws when the browser cannot actually be launched, so
   * callers report the real reason instead of claiming a window opened.
   */
  async startManualLogin(): Promise<LoginWindowInfo> {
    if (this.headless) {
      throw new PrimeSessionExpiredError(
        'Manual Loop login needs a visible browser, but PRIME_HEADLESS is enabled. Set PRIME_HEADLESS=false and restart the app.',
      );
    }
    await this.ensureContext();
    const page = await this.page();
    // Go straight to the Prime app: it redirects to WorshipTools' shared sign-in
    // with parameters only the site knows, and that is where the cookies the
    // Prime site reads come from.
    try {
      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: this.actionTimeoutMs });
    } catch (error) {
      const { message, hint } = explainLoginNavigationFailure(error, this.loginUrl);
      throw Object.assign(new Error(message, { cause: error }), { hint });
    }
    // Let the site's own redirect to the WorshipTools sign-in settle before the
    // request returns, so the window never sits on a blank intermediate page.
    await page
      .waitForLoadState('load', { timeout: Math.min(this.actionTimeoutMs, 20_000) })
      .catch(() => undefined);
    const primeEntry = `${this.baseUrl}${LOOP_PRIME_ENTRY_PATH}`;
    let finalUrl = page.url();
    let title = await page.title().catch(() => '');
    let note: string | undefined;

    // A window on the marketing site looks open and healthy but can never log
    // anyone in. When a configured login page is the dead end, finish the job at
    // the Prime app rather than failing the login that was asked for — and say
    // so, because the window is not where it was sent.
    if (isMarketingDeadEnd(finalUrl) && this.loginUrl !== primeEntry) {
      note = `${this.loginUrl} redirected to WorshipTools' marketing site (${finalUrl}), which has no sign-in form, so the window moved on to the Prime app instead.`;
      try {
        await page.goto(primeEntry, { waitUntil: 'domcontentloaded', timeout: this.actionTimeoutMs });
      } catch (error) {
        const failure = explainLoginNavigationFailure(error, primeEntry);
        throw Object.assign(new Error(failure.message, { cause: error }), { hint: failure.hint });
      }
      await page
        .waitForLoadState('load', { timeout: Math.min(this.actionTimeoutMs, 20_000) })
        .catch(() => undefined);
      finalUrl = page.url();
      title = await page.title().catch(() => '');
    }

    if (isMarketingDeadEnd(finalUrl)) {
      throw Object.assign(
        new Error(
          `The login window opened ${primeEntry}, but the site redirected to ${finalUrl}, WorshipTools' marketing page, which has no sign-in form.`,
        ),
        {
          hint: 'Loop Community is sending sign-in traffic to the marketing site. Check the Prime base URL in Settings and try again; if it keeps happening, the site has changed its login flow.',
        },
      );
    }

    // Report what the window is showing: an empty title means it painted
    // nothing, which is otherwise indistinguishable from a healthy window.
    return { url: finalUrl, title, ...(note ? { note } : {}) };
  }

  /**
   * Open the login window and wait for the administrator to finish there.
   * The browser must not be headless for this to be usable.
   */
  async openManualLogin(): Promise<void> {
    await this.startManualLogin();
    const context = await this.ensureContext();
    const deadline = Date.now() + this.loginTimeoutMs;
    const configured = Boolean(this.config.selectors.loggedInIndicator || this.config.selectors.loggedOutIndicator);
    if (!configured) {
      // Without a login indicator we cannot verify the result, so wait for the
      // administrator to close the window and never claim the login succeeded.
      // The persistent profile still captures whatever session Loop set.
      await Promise.race([
        new Promise<void>((resolve) => context.once('close', () => resolve())),
        new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(0, deadline - Date.now())).unref?.(),
        ),
      ]);
      return;
    }
    while (Date.now() < deadline) {
      if (await this.isAuthenticated().catch(() => false)) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new PrimeSessionExpiredError(
      'Timed out waiting for the Loop Community login. Log in through the browser window, then re-run the sync.',
    );
  }

  async close(): Promise<void> {
    if (!this.context) return;
    try {
      await this.context.close();
    } finally {
      this.context = null;
    }
  }

  /** Directory where discovery snapshots are written (git-ignored). */
  static discoveryDir(): string {
    return path.resolve(process.cwd(), 'artifacts/prime-discovery');
  }
}
