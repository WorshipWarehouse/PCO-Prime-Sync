import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { PrimeSessionStatus } from '../../../shared/types';
import { PrimeSessionExpiredError } from '../adapter';
import { loadSelectorConfig, type PrimeSelectorConfig } from './selectors';

/**
 * Loop Community signs users in through WorshipTools' shared auth host, not
 * through the Prime site itself. Opening this page is the only login step the
 * app performs: the administrator types their own credentials there.
 */
export const LOOP_LOGIN_URL = 'https://auth.worshiptools.com/login';

export interface PrimeSessionOptions {
  profileDir: string;
  headless: boolean;
  baseUrl: string;
  /** Where the manual login window opens. Defaults to {@link LOOP_LOGIN_URL}. */
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
    this.loginUrl = options.loginUrl ?? LOOP_LOGIN_URL;
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
   * Open the visible browser and wait until the administrator has logged in.
   * The browser must not be headless for this to be usable.
   */
  /**
   * Launch the visible browser and open the login page, then return while the
   * window stays open. Throws when the browser cannot actually be launched, so
   * callers report the real reason instead of claiming a window opened.
   */
  async startManualLogin(): Promise<void> {
    if (this.headless) {
      throw new PrimeSessionExpiredError(
        'Manual Loop login needs a visible browser, but PRIME_HEADLESS is enabled. Set PRIME_HEADLESS=false and restart the app.',
      );
    }
    await this.ensureContext();
    const page = await this.page();
    // Go straight to the WorshipTools auth page: that is where Loop Community
    // actually signs people in, and it sets the cookies the Prime site reads.
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: this.actionTimeoutMs });
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
