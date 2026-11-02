import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

/**
 * Open (and migrate) the local SQLite database.
 *
 * `:memory:` is supported for tests. For file databases the parent directory is
 * created, WAL mode is enabled and foreign keys are enforced.
 */
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    const dir = path.dirname(databasePath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

/** Apply the schema. Idempotent — every statement is CREATE ... IF NOT EXISTS. */
export function migrate(db: Db): void {
  const schemaPath = path.join(here, 'schema.sql');
  let schema = fs.readFileSync(schemaPath, 'utf8');
  // PRAGMA statements cannot run inside a transaction.
  schema = schema.replace(/^PRAGMA[^;]+;\s*$/gim, '');
  db.exec(schema);

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM church_settings WHERE id = 1').get();
  if (!existing) {
    db.prepare(
      `INSERT INTO church_settings (id, pco_app_id, pco_service_type_ids, pco_team_ids,
        prime_base_url, prime_profile_dir, prime_headless, sync_hour, sync_minute,
        timezone, window_days, auto_sync_enabled, created_at, updated_at)
       VALUES (1, NULL, '[]', '[]', ?, ?, 0, 3, 0, 'America/New_York', 21, 0, ?, ?)`,
    ).run(
      process.env.PRIME_BASE_URL?.trim() || 'https://loopcommunity.com',
      process.env.PRIME_PROFILE_DIR?.trim() || 'profiles/prime',
      now,
      now,
    );
  }
}

/** Close a database handle without throwing if it is already closed. */
export function closeDatabase(db: Db): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
