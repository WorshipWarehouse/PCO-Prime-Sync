/**
 * Open the persistent Loop Community Prime browser profile so the administrator
 * can log in manually. The session is stored in the git-ignored profile folder
 * and reused by later synchronization runs.
 *
 *   npm run prime:login
 */
import readline from 'node:readline/promises';
import path from 'node:path';
import { loadEnv } from '../server/env';
import { openDatabase } from '../server/db';
import { Repository } from '../server/db/repo';
import { LOOP_LOGIN_URL, PrimeBrowserSession } from '../server/prime/playwright/session';
import { loadSelectorConfig } from '../server/prime/playwright/selectors';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDatabase(env.databasePath);
  const repo = new Repository(db);
  const settings = repo.getSettings();

  const session = new PrimeBrowserSession({
    profileDir: path.isAbsolute(settings.primeProfileDir)
      ? settings.primeProfileDir
      : path.resolve(env.primeProfileDir),
    headless: false,
    baseUrl: settings.primeBaseUrl,
    loginTimeoutMs: env.primeLoginTimeoutMs,
    actionTimeoutMs: env.primeActionTimeoutMs,
    selectorConfig: loadSelectorConfig(),
  });

  console.log('Opening the Loop Community login page in a visible Chromium window…');
  console.log(`Login:    ${LOOP_LOGIN_URL}`);
  console.log(`Prime:    ${settings.primeBaseUrl}`);
  console.log(`Profile:  ${session.profileDir} (session cookies are stored here — never commit it)`);

  const page = await session.page();
  await page.goto(LOOP_LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nLog in through the browser window. The app never asks for your password and never bypasses 2FA.');
  await rl.question('Press Enter here once you are signed in… ');
  rl.close();

  const statusMessage = await session.status();
  console.log(`Session state: ${statusMessage.state} — ${statusMessage.message}`);
  await session.close();
  db.close();
  console.log('Browser closed. The profile is saved; the next sync will reuse it.');
}

main().catch((error: unknown) => {
  console.error('Prime login failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
