import path from 'node:path';
import type { SyncMode, SyncRunResult, SyncTrigger } from '../shared/types';
import { openDatabase, type Db } from './db';
import { Repository } from './db/repo';
import { HttpPcoAdapter, type PcoAdapter } from './pco/adapter';
import { MockPcoAdapter } from './pco/mock';
import type { PrimeAdapter } from './prime/adapter';
import { MockPrimeAdapter } from './prime/mock';
import { PlaywrightPrimeAdapter } from './prime/playwright/adapter';
import { PrimeBrowserSession } from './prime/playwright/session';
import { loadSelectorConfig } from './prime/playwright/selectors';
import { SyncEngine } from './sync/engine';
import { DailyScheduler } from './sync/scheduler';
import { loadEnv, type AppEnv } from './env';

export interface ServicesOptions {
  db?: Db;
  pcoAdapter?: PcoAdapter | null;
  primeAdapter?: PrimeAdapter | null;
  /** Use in-memory adapters (tests / `--mock` mode). */
  mock?: boolean;
  startScheduler?: boolean;
}

export interface SyncJobState {
  status: 'idle' | 'running' | 'finished';
  mode: SyncMode | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: SyncRunResult | null;
  error: string | null;
}

/** Wires the database, adapters, sync engine and scheduler together. */
export class Services {
  readonly env: AppEnv;
  readonly db: Db;
  readonly repo: Repository;
  readonly engine: SyncEngine;
  readonly scheduler: DailyScheduler;
  private _pcoAdapter: PcoAdapter | null;
  readonly primeAdapter: PrimeAdapter | null;
  readonly primeInitError: string | null;
  private job: SyncJobState = {
    status: 'idle',
    mode: null,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  private readonly mock: boolean;

  get pcoAdapter(): PcoAdapter | null {
    return this._pcoAdapter;
  }

  constructor(options: ServicesOptions = {}) {
    this.env = loadEnv();
    // Demo/test mode: in-memory Planning Center + Loop adapters, no network.
    // Enabled explicitly (CLI flag or PCO_PRIME_SYNC_MOCK=1), never implicitly.
    this.mock = options.mock ?? process.env.PCO_PRIME_SYNC_MOCK === '1';
    this.db = options.db ?? openDatabase(this.env.databasePath);
    this.repo = new Repository(this.db);

    let pco: PcoAdapter | null;
    if (options.pcoAdapter !== undefined) {
      pco = options.pcoAdapter;
    } else if (this.mock) {
      pco = new MockPcoAdapter();
    } else if (this.env.pcoAppId && this.env.pcoSecret) {
      pco = new HttpPcoAdapter({
        appId: this.env.pcoAppId,
        secret: this.env.pcoSecret,
        timezone: this.repo.getSettings().timezone,
      });
    } else {
      pco = null;
    }
    this._pcoAdapter = pco;

    let prime: PrimeAdapter | null;
    let primeInitError: string | null = null;
    if (options.primeAdapter !== undefined) {
      prime = options.primeAdapter;
    } else if (this.mock) {
      prime = new MockPrimeAdapter();
    } else {
      try {
        const config = loadSelectorConfig();
        const settings = this.repo.getSettings();
        const session = new PrimeBrowserSession({
          profileDir: path.isAbsolute(settings.primeProfileDir)
            ? settings.primeProfileDir
            : path.resolve(this.env.primeProfileDir),
          headless: this.env.primeHeadless || settings.primeHeadless,
          baseUrl: settings.primeBaseUrl || this.env.primeBaseUrl,
          loginUrl: this.env.primeLoginUrl ?? undefined,
          loginTimeoutMs: this.env.primeLoginTimeoutMs,
          actionTimeoutMs: this.env.primeActionTimeoutMs,
          selectorConfig: config,
        });
        prime = new PlaywrightPrimeAdapter(session);
      } catch (error) {
        prime = null;
        primeInitError = error instanceof Error ? error.message : String(error);
      }
    }
    this.primeAdapter = prime;
    this.primeInitError = primeInitError;

    this.engine = new SyncEngine({
      repo: this.repo,
      pcoAdapter: this.pcoAdapter,
      primeAdapter: this.primeAdapter,
    });

    this.scheduler = new DailyScheduler({
      repo: this.repo,
      run: async ({ mode, trigger }) => {
        this.startSync(mode, trigger);
      },
    });

    if (options.startScheduler ?? false) {
      this.scheduler.start();
    }
  }

  /**
   * Replace the Planning Center adapter after the administrator enters a token
   * in the dashboard, so no server restart is required.
   */
  reconfigurePco(appId: string, secret: string): void {
    this._pcoAdapter = new HttpPcoAdapter({
      appId,
      secret,
      timezone: this.repo.getSettings().timezone,
    });
    this.engine.setPcoAdapter(this._pcoAdapter);
  }

  /** Read the current secret source fresh (it can change while the server runs). */
  pcoSecretSource(): AppEnv['pcoSecretSource'] {
    return loadEnv().pcoSecretSource;
  }

  /** One sync at a time; the dashboard polls `/api/sync/status`. */
  startSync(mode: SyncMode, trigger: SyncTrigger): { started: boolean; message: string } {
    if (this.job.status === 'running') {
      return { started: false, message: 'A synchronization is already running' };
    }
    this.job = {
      status: 'running',
      mode,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    void this.engine
      .run({ mode, trigger })
      .then((result) => {
        this.job = {
          status: 'finished',
          mode,
          startedAt: this.job.startedAt,
          finishedAt: result.finishedAt,
          result,
          error: null,
        };
        console.log(`[sync] ${result.status}: ${result.summary}`);
      })
      .catch((error: unknown) => {
        this.job = {
          status: 'finished',
          mode,
          startedAt: this.job.startedAt,
          finishedAt: new Date().toISOString(),
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
        console.error('[sync] failed:', error instanceof Error ? error.message : error);
      });
    return { started: true, message: `${mode === 'dry_run' ? 'Dry run' : 'Synchronization'} started` };
  }

  jobStatus(): SyncJobState {
    return this.job;
  }

  async close(): Promise<void> {
    this.scheduler.stop();
    await this.primeAdapter?.close().catch(() => undefined);
    this.db.close();
  }
}
