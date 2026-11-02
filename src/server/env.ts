import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import type { ChurchSettings } from '../shared/types';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env', quiet: true });

export const projectRoot = process.cwd();

export interface AppEnv {
  port: number;
  host: string;
  databasePath: string;
  pcoAppId: string | null;
  pcoSecret: string | null;
  pcoSecretSource: 'env' | 'keychain' | 'missing';
  primeBaseUrl: string;
  /** Optional starting page for the manual login window; empty means the Prime app. */
  primeLoginUrl: string | null;
  primeProfileDir: string;
  primeHeadless: boolean;
  primeLoginTimeoutMs: number;
  primeActionTimeoutMs: number;
  timezone: string;
  nodeEnv: string;
}

let cached: AppEnv | null = null;

/**
 * Read the PCO secret without ever logging or persisting it.
 * Order: environment variable, then the macOS Keychain (opt-in via
 * PCO_SECRET_KEYCHAIN_SERVICE), then missing.
 */
function resolvePcoSecret(): { secret: string | null; source: 'env' | 'keychain' | 'missing' } {
  const fromEnv = process.env.PCO_SECRET?.trim();
  if (fromEnv) return { secret: fromEnv, source: 'env' };

  const service = process.env.PCO_SECRET_KEYCHAIN_SERVICE?.trim();
  if (service && process.platform === 'darwin') {
    const account = process.env.PCO_SECRET_KEYCHAIN_ACCOUNT?.trim() || process.env.USER || '';
    try {
      const args = ['find-generic-password', '-s', service, '-w'];
      if (account) args.splice(2, 0, '-a', account);
      const value = execFileSync('security', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }).trim();
      if (value) return { secret: value, source: 'keychain' };
    } catch {
      // Keychain lookup failed; fall through to "missing" without leaking detail.
    }
  }

  return { secret: null, source: 'missing' };
}

export function loadEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  if (cached && Object.keys(overrides).length === 0) return cached;

  const secretInfo = resolvePcoSecret();
  const base = path.resolve(projectRoot, process.env.PRIME_PROFILE_DIR ?? 'profiles/prime');
  const databasePath = path.resolve(projectRoot, process.env.DATABASE_PATH ?? 'data/pco-prime-sync.sqlite');

  const env: AppEnv = {
    port: Number(process.env.PORT ?? 5178),
    host: process.env.HOST ?? '127.0.0.1',
    databasePath,
    pcoAppId: process.env.PCO_APP_ID?.trim() || null,
    pcoSecret: secretInfo.secret,
    pcoSecretSource: secretInfo.source,
    primeBaseUrl: process.env.PRIME_BASE_URL?.trim() || 'https://loopcommunity.com',
    primeLoginUrl: process.env.PRIME_LOGIN_URL?.trim() || null,
    primeProfileDir: base,
    primeHeadless: (process.env.PRIME_HEADLESS ?? 'false').toLowerCase() === 'true',
    primeLoginTimeoutMs: Number(process.env.PRIME_LOGIN_TIMEOUT_MS ?? 300_000),
    primeActionTimeoutMs: Number(process.env.PRIME_ACTION_TIMEOUT_MS ?? 20_000),
    timezone: process.env.SYNC_TIMEZONE?.trim() || 'America/New_York',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    ...overrides,
  };

  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}

/** Reset the cached environment (tests). */
export function resetEnvCache(): void {
  cached = null;
}

/** Convenience helper: settings-independent defaults used before the DB loads. */
export function defaultSettingsFromEnv(env: AppEnv, now = new Date().toISOString()): ChurchSettings {
  return {
    pcoAppId: env.pcoAppId,
    pcoServiceTypeIds: [],
    pcoTeamIds: [],
    primeBaseUrl: env.primeBaseUrl,
    primeProfileDir: path.relative(projectRoot, env.primeProfileDir) || env.primeProfileDir,
    primeHeadless: env.primeHeadless,
    syncHour: 3,
    syncMinute: 0,
    timezone: env.timezone,
    windowDays: 21,
    autoSyncEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Ensure the profile directory exists, with owner-only permissions. */
export function ensureProfileDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Resolve a possibly-relative path against the project root. Guarded to stay inside it. */
export function resolveInsideProject(relativeOrAbsolute: string): string {
  const resolved = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(projectRoot, relativeOrAbsolute);
  return resolved;
}
