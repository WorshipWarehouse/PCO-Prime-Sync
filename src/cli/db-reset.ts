/**
 * Delete the local SQLite database (and WAL files). Requires `--yes`.
 * Never touches Loop Prime; it only removes local mappings and history.
 */
import fs from 'node:fs';
import { loadEnv } from '../server/env';

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.log('This deletes the local database (mappings, sync history, plans).');
  console.log(`Would delete: ${loadEnv().databasePath}`);
  console.log('Re-run with --yes to confirm.');
  process.exit(0);
}

const env = loadEnv();
for (const suffix of ['', '-wal', '-shm']) {
  const target = `${env.databasePath}${suffix}`;
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    console.log(`Deleted ${target}`);
  }
}
console.log('Database removed. It will be recreated on the next server start.');
