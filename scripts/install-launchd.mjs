#!/usr/bin/env node
/**
 * Install (or remove) the macOS launchd agent that runs the daily sync at the
 * time configured in the app's SQLite database.
 *
 *   npm run schedule:install
 *   npm run schedule:uninstall
 *
 * launchd runs the job in the configured timezone (America/New_York by default)
 * and start.sh sets TZ so daylight saving transitions are handled by the OS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const LABEL = 'com.pcoprimesync.daily';
const projectDir = process.cwd();
const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const logsDir = path.join(projectDir, 'logs');

function readSettings() {
  const dbPath = path.resolve(projectDir, process.env.DATABASE_PATH ?? 'data/pco-prime-sync.sqlite');
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}. Start the app once (npm run dev) so settings exist.`);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const row = db.prepare('SELECT sync_hour, sync_minute, timezone, window_days, auto_sync_enabled FROM church_settings WHERE id = 1').get();
  db.close();
  if (!row) {
    console.error('church_settings row missing. Start the app once to migrate the database.');
    process.exit(1);
  }
  return row;
}

function buildPlist({ hour, minute, timezone }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>--import</string>
    <string>tsx</string>
    <string>${path.join(projectDir, 'src/cli/sync.ts')}</string>
    <string>--trigger</string>
    <string>schedule</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TZ</key>
    <string>${timezone}</string>
    <key>SYNC_TIMEZONE</key>
    <string>${timezone}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(logsDir, 'sync.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logsDir, 'sync.error.log')}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

function launchctl(args, { ignoreFailure = false } = {}) {
  try {
    const output = execFileSync('launchctl', args, { encoding: 'utf8' });
    if (output.trim()) console.log(output.trim());
  } catch (error) {
    if (!ignoreFailure) {
      console.error(`launchctl ${args.join(' ')} failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }
}

const command = process.argv[2] ?? 'install';

if (process.platform !== 'darwin') {
  console.error('launchd is only available on macOS. Use `npm run dev` (in-process scheduler) or cron on other systems.');
  process.exit(1);
}

if (command === 'uninstall') {
  launchctl(['bootout', `gui/${process.getuid()}`, plistPath], { ignoreFailure: true });
  if (fs.existsSync(plistPath)) fs.rmSync(plistPath);
  console.log(`Removed ${plistPath}`);
  process.exit(0);
}

const settings = readSettings();
if (!settings.auto_sync_enabled) {
  console.warn('Warning: automatic synchronization is disabled in the app settings; the agent will run but the sync will be a no-op.');
}

fs.mkdirSync(path.dirname(plistPath), { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });
fs.writeFileSync(plistPath, buildPlist({
  hour: Number(settings.sync_hour),
  minute: Number(settings.sync_minute),
  timezone: settings.timezone,
}));

launchctl(['bootout', `gui/${process.getuid()}`, plistPath], { ignoreFailure: true });
launchctl(['bootstrap', `gui/${process.getuid()}`, plistPath]);

console.log(`Installed ${plistPath}`);
console.log(`Daily sync at ${String(settings.sync_hour).padStart(2, '0')}:${String(settings.sync_minute).padStart(2, '0')} ${settings.timezone}`);
console.log(`Logs: ${path.join(logsDir, 'sync.log')}`);
console.log('Check status with: launchctl print gui/$(id -u)/' + LABEL);
