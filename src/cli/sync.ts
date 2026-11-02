/**
 * Daily synchronization entry point (used by launchd and by `npm run sync`).
 *
 *   npm run sync                 # real sync
 *   npm run sync -- --dry-run    # preview only
 *   npm run sync -- --mock       # in-memory adapters, no external calls
 */
import { Services } from '../server/services';
import type { SyncMode } from '../shared/types';

function parseArgs(argv: string[]): { mode: SyncMode; mock: boolean } {
  return {
    mode: argv.includes('--dry-run') || argv.includes('--dry_run') ? 'dry_run' : 'sync',
    mock: argv.includes('--mock'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mock = args.mock || process.env.PCO_PRIME_SYNC_MOCK === '1';
  const services = new Services({ startScheduler: false, mock });
  const effectiveMock = mock;

  try {
    if (effectiveMock) {
      console.log('Running with in-memory mock adapters (no Planning Center or Loop traffic).');
      // Demo convenience: the mock fixtures describe service type "st-1" with
      // the worship/vocalist teams below. Seed them only when nothing is set so
      // `npm run sync -- --mock` works on a brand-new database.
      const settings = services.repo.getSettings();
      if (settings.pcoServiceTypeIds.length === 0 && services.repo.getWorshipTeamIds().length === 0) {
        services.repo.updateSettings({ pcoServiceTypeIds: ['st-1'] });
        services.repo.setWorshipTeamIds(['team-worship', 'team-vocals']);
        console.log('Mock mode: seeded demo service type and worship teams in the local database.');
      }
      console.log(
        'Note: the mock Loop account is in-memory for this process only. Repeated mock runs will report the previously\nrecorded setlists as missing (which is the real behaviour when a setlist disappears). Use the running dev server\nfor a repeatable demo, where the mock Loop state survives between syncs.',
      );
    }
    const result = await services.engine.run({ mode: args.mode, trigger: 'cli' });
    console.log(`\n${result.mode === 'dry_run' ? 'Dry run' : 'Sync'} ${result.status}: ${result.summary}`);
    for (const preview of result.planPreviews) {
      console.log(`\n- ${preview.planTitle} (${preview.planDate}) → ${preview.status}`);
      console.log(`  setlist: ${preview.setlistName}`);
      if (preview.blockedReasons.length > 0) {
        for (const reason of preview.blockedReasons) console.log(`  blocked: ${reason}`);
      }
      for (const operation of preview.operations) {
        console.log(`  [${operation.changeType}] ${operation.description}`);
      }
    }
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of result.errors) console.log(`  ${error.code}: ${error.message}`);
    }
    const fatal = result.status === 'failed' || result.status === 'blocked';
    await services.close();
    process.exit(fatal ? 1 : 0);
  } catch (error) {
    console.error('Sync failed:', error instanceof Error ? error.message : error);
    await services.close().catch(() => undefined);
    process.exit(1);
  }
}

void main();
