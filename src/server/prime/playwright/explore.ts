import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { PrimeBrowserSession } from './session';

export interface DiscoveryCapture {
  capturedAt: string;
  url: string;
  title: string;
  /** Accessible name / role / tag for every interactive element on the page. */
  interactiveElements: Array<{ tag: string; role: string | null; name: string; type: string | null }>;
  /** Visible text, trimmed, for reading the actual workflow copy. */
  text: string;
  /** Raw HTML for selector construction (local, git-ignored). */
  html: string;
  screenshotPath: string | null;
}

/**
 * Capture everything needed to build the selector contract for the *real* Loop
 * Community Prime site. This tool is the honest alternative to guessing:
 * an administrator logs in manually, navigates to the Prime setlists area, and
 * this function records the live page so selectors can be derived from reality.
 */
export async function captureDiscovery(page: Page, outputDir: string): Promise<DiscoveryCapture> {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(outputDir, `capture-${timestamp}`);

  const interactiveElements = await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="option"]'),
    ).slice(0, 500);
    return elements.map((element) => {
      const htmlElement = element as HTMLElement;
      const tag = htmlElement.tagName.toLowerCase();
      const type = htmlElement.getAttribute('type');
      const name =
        htmlElement.innerText?.trim().slice(0, 120) ||
        htmlElement.getAttribute('aria-label') ||
        htmlElement.getAttribute('placeholder') ||
        htmlElement.getAttribute('title') ||
        htmlElement.getAttribute('name') ||
        htmlElement.id ||
        '';
      return {
        tag,
        role: htmlElement.getAttribute('role'),
        name,
        type,
      };
    });
  });

  const text = ((await page.locator('body').innerText().catch(() => '')) ?? '').slice(0, 20_000);
  const html = (await page.content()).slice(0, 400_000);
  const screenshotPath = `${base}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

  const capture: DiscoveryCapture = {
    capturedAt: new Date().toISOString(),
    url: page.url(),
    title: await page.title().catch(() => ''),
    interactiveElements,
    text,
    html,
    screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
  };

  fs.writeFileSync(`${base}.json`, JSON.stringify({ ...capture, html: '(see html file)' }, null, 2));
  fs.writeFileSync(`${base}.html`, html);
  return capture;
}

/** Launch the visible persistent profile for manual login/discovery. */
export async function withVisiblePrimeSession(
  options: { profileDir: string; baseUrl: string; loginTimeoutMs: number; actionTimeoutMs: number },
  fn: (page: Page, session: PrimeBrowserSession) => Promise<void>,
): Promise<void> {
  const session = new PrimeBrowserSession({
    profileDir: options.profileDir,
    headless: false,
    baseUrl: options.baseUrl,
    loginTimeoutMs: options.loginTimeoutMs,
    actionTimeoutMs: options.actionTimeoutMs,
  });
  try {
    const page = await session.page();
    await fn(page, session);
  } finally {
    await session.close();
  }
}
