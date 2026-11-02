/**
 * Loop Community Prime discovery helper.
 *
 * The Loop website has no public API, so the automation is driven by a selector
 * contract that has to be derived from the real site. This tool opens the
 * persistent profile, lets you log in and navigate to Prime setlists, and then
 * captures the visible page (interactive elements, text, HTML, screenshot) so
 * the selectors in config/prime-selectors.json can be filled in accurately.
 *
 *   npm run prime:explore
 */
import readline from 'node:readline/promises';
import path from 'node:path';
import { loadEnv } from '../server/env';
import { openDatabase } from '../server/db';
import { Repository } from '../server/db/repo';
import { PrimeBrowserSession } from '../server/prime/playwright/session';
import { captureDiscovery } from '../server/prime/playwright/explore';
import { loadSelectorConfig } from '../server/prime/playwright/selectors';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDatabase(env.databasePath);
  const repo = new Repository(db);
  const settings = repo.getSettings();
  const selectorConfig = loadSelectorConfig();

  const session = new PrimeBrowserSession({
    profileDir: path.isAbsolute(settings.primeProfileDir)
      ? settings.primeProfileDir
      : path.resolve(env.primeProfileDir),
    headless: false,
    baseUrl: settings.primeBaseUrl,
    loginTimeoutMs: env.primeLoginTimeoutMs,
    actionTimeoutMs: env.primeActionTimeoutMs,
    selectorConfig,
  });

  const page = await session.page();
  await page.goto(settings.primeBaseUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

  console.log('Loop Prime discovery mode');
  console.log('------------------------------------------------------------');
  console.log('1. Log in through the visible browser window.');
  console.log('2. Navigate to the Prime setlists page (and Prime Team members).');
  console.log('3. Return here and press Enter to capture the current page.');
  console.log('4. Repeat for each page you need selectors for (setlists, track search, team).');
  console.log('5. Type "q" and press Enter when finished.');
  console.log(`Captures are written to ${PrimeBrowserSession.discoveryDir()} (git-ignored).`);
  console.log('Never bypass CAPTCHA or 2FA: this tool only records what you can see yourself.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (;;) {
    const answer = (await rl.question('Press Enter to capture, or "q" to quit: ')).trim().toLowerCase();
    if (answer === 'q') break;
    try {
      const capture = await captureDiscovery(page, PrimeBrowserSession.discoveryDir());
      console.log(`\nCaptured ${capture.url}`);
      console.log(`  title: ${capture.title}`);
      console.log(`  interactive elements: ${capture.interactiveElements.length}`);
      if (capture.screenshotPath) console.log(`  screenshot: ${capture.screenshotPath}`);
      const interesting = capture.interactiveElements
        .filter((element) => element.name)
        .slice(0, 25)
        .map((element) => `    <${element.tag}${element.type ? ` type=${element.type}` : ''}> ${element.name}`);
      if (interesting.length > 0) {
        console.log('  sample controls (use these to write selectors):');
        console.log(interesting.join('\n'));
      }
      console.log(
        '\nNow fill config/prime-selectors.json with selectors that match these elements, then set "verified": true only after the operations have been tested by hand.',
      );
    } catch (error) {
      console.error('Capture failed:', error instanceof Error ? error.message : error);
    }
  }

  rl.close();
  await session.close();
  db.close();
  console.log('Discovery finished. Browser closed; the login session is preserved in the profile.');
}

main().catch((error: unknown) => {
  console.error('Prime discovery failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
