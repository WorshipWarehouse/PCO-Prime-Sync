import type { LoginWindowInfo } from './prime/adapter';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  ConnectionStatus,
  OverviewPayload,
  ScheduleInfo,
  SyncMode,
  SyncPreview,
} from '../shared/types';
import { normalizeSongName } from '../shared/naming';
import { addDaysToIsoDate, timePartsInTimeZone } from '../shared/naming';
import type { Services } from './services';
import {
  applyPcoCredentials,
  validatePcoCredentials,
  writePcoCredentialsToEnv,
} from './pco/credentials';
import { scheduleInfo } from './sync/scheduler';
import { countOperations } from './sync/engine';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const asyncHandler = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  handler(req, res, next).catch(next);
};

const settingsSchema = z.object({
  pcoAppId: z.string().trim().max(200).nullable().optional(),
  pcoServiceTypeIds: z.array(z.string().trim().min(1)).max(50).optional(),
  pcoTeamIds: z.array(z.string().trim().min(1)).max(100).optional(),
  primeBaseUrl: z.string().url().max(500).optional(),
  primeProfileDir: z.string().trim().min(1).max(500).optional(),
  primeHeadless: z.boolean().optional(),
  syncHour: z.number().int().min(0).max(23).optional(),
  syncMinute: z.number().int().min(0).max(59).optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Must be a valid IANA timezone, e.g. America/New_York')
    .optional(),
  windowDays: z.number().int().min(1).max(120).optional(),
  autoSyncEnabled: z.boolean().optional(),
});

const songMappingSchema = z.object({
  pcoSongTitle: z.string().trim().min(1).max(300),
  pcoSongId: z.string().trim().max(100).nullable().optional(),
  primeTrackId: z.string().trim().min(1).max(300),
  primeTrackName: z.string().trim().min(1).max(300),
  primeArrangementId: z.string().trim().max(300).nullable().optional(),
  primeArrangementName: z.string().trim().max(300).nullable().optional(),
});

const memberMappingSchema = z.object({
  normalizedEmail: z.string().trim().min(3).max(300),
  primeMemberId: z.string().trim().min(1).max(300),
  primeMemberName: z.string().trim().min(1).max(300),
  pcoPersonId: z.string().trim().max(100).nullable().optional(),
  pcoName: z.string().trim().max(300).nullable().optional(),
});

const pcoCredentialSchema = z.object({
  appId: z.string().trim().min(1).max(200),
  secret: z.string().trim().min(1).max(500),
});

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Create the Express app.
 *
 * Security posture (local-only app):
 *  - intended to bind to 127.0.0.1 (see index.ts)
 *  - mutating requests require the `x-pco-prime-sync: 1` header, which a
 *    cross-site form cannot set, plus same-origin checks
 *  - optional ADMIN_TOKEN adds a shared-secret check
 *  - secrets are never returned by any endpoint
 */
export function createApp(services: Services): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use('/api', (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) return next();
    if (req.get('x-pco-prime-sync') !== '1') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Missing x-pco-prime-sync header. Use the dashboard for administrative actions.',
      });
      return;
    }
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) {
          res.status(403).json({ error: 'forbidden', message: 'Cross-origin request rejected' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'forbidden', message: 'Invalid Origin header' });
        return;
      }
    }
    const adminToken = process.env.ADMIN_TOKEN?.trim();
    if (adminToken && req.get('x-admin-token') !== adminToken) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing admin token' });
      return;
    }
    next();
  });

  // ---- overview ---------------------------------------------------------
  let pcoStatusCache: { value: ConnectionStatus; expires: number } | null = null;

  app.get(
    '/api/overview',
    asyncHandler(async (_req, res) => {
      const settings = services.repo.getSettings();
      const today = timePartsInTimeZone(new Date(), settings.timezone).isoDate;
      const toDate = addDaysToIsoDate(today, settings.windowDays);

      let pco: ConnectionStatus;
      const now = Date.now();
      if (pcoStatusCache && pcoStatusCache.expires > now) {
        pco = pcoStatusCache.value;
      } else if (!services.pcoAdapter) {
        pco = {
          configured: false,
          ok: false,
          message:
            'Planning Center credentials are not configured. Add a Personal Access Token in Settings.',
          checkedAt: new Date().toISOString(),
          secretSource: services.pcoSecretSource(),
          serviceTypeCount: null,
        };
        pcoStatusCache = { value: pco, expires: now + 15_000 };
      } else {
        const result = await services.pcoAdapter.verifyConnection();
        pco = {
          configured: true,
          ok: result.ok,
          message: result.message,
          checkedAt: new Date().toISOString(),
          secretSource: services.pcoSecretSource(),
          serviceTypeCount: result.serviceTypeCount,
        };
        pcoStatusCache = { value: pco, expires: now + 60_000 };
      }

      const prime = services.primeAdapter
        ? await services.primeAdapter.sessionStatus()
        : {
            state: 'error' as const,
            checkedAt: new Date().toISOString(),
            message: services.primeInitError ?? 'Loop Prime automation not initialized',
            currentUrl: null,
            profileDir: settings.primeProfileDir,
            headless: settings.primeHeadless,
          };

      const songStats = services.repo.countSongMatchStats(today, toDate);
      const distinctMusicians = services.repo.listDistinctMusicians();
      const statuses = services.repo.countPlanStatuses(today, toDate);
      const pendingChanges =
        (statuses.pending ?? 0) + (statuses.blocked ?? 0) + (statuses.needs_matching ?? 0);

      const schedule: ScheduleInfo = scheduleInfo(services.repo);
      const upcomingPlans = services.repo.listPlansBetween(today, toDate).length;

      const payload: OverviewPayload = {
        pco,
        prime,
        lastSuccessfulSync: services.repo.getLastSuccessfulSync(),
        schedule,
        counts: {
          upcomingPlans,
          matchedSongs: songStats.matched,
          unmatchedSongs: songStats.unmatched,
          musiciansNeedingMatching: distinctMusicians.filter((musician) => musician.matchStatus !== 'matched').length,
          pendingChanges,
        },
        capabilities: services.primeAdapter?.capabilities() ?? [],
        recentErrors: services.repo.listErrors({ limit: 10 }),
      };
      res.json(payload);
    }),
  );

  // ---- settings ---------------------------------------------------------
  app.get('/api/settings', (_req, res) => {
    const settings = services.repo.getSettings();
    res.json({
      settings,
      secretSource: services.pcoSecretSource(),
      primeInitError: services.primeInitError,
      teams: services.repo.listTeamConfiguration(),
    });
  });

  app.put(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const parsed = settingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_settings', message: parsed.error.issues.map((i) => i.message).join('; ') });
        return;
      }
      const patch = parsed.data;
      const { pcoTeamIds, ...rest } = patch;
      const saved = services.repo.updateSettings(rest);
      if (pcoTeamIds) services.repo.setWorshipTeamIds(pcoTeamIds);
      res.json({ settings: services.repo.getSettings(), saved: Boolean(saved) });
    }),
  );

  // ---- Planning Center credentials --------------------------------------
  /** Test a token against the real API. Nothing is stored. */
  app.post(
    '/api/pco/credentials/test',
    asyncHandler(async (req, res) => {
      if (services.pcoAdapter?.kind === 'mock') {
        res.status(409).json({
          error: 'mock_mode',
          message:
            'This server is running with mock adapters. Restart without PCO_PRIME_SYNC_MOCK=1 to use real Planning Center credentials.',
        });
        return;
      }
      const parsed = pcoCredentialSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_credentials',
          message: 'Enter both the Planning Center application id and secret.',
        });
        return;
      }
      const result = await validatePcoCredentials(parsed.data);
      res.status(result.ok ? 200 : 400).json(result);
    }),
  );

  /** Validate, then store the token locally and swap the live adapter. */
  app.post(
    '/api/pco/credentials',
    asyncHandler(async (req, res) => {
      if (services.pcoAdapter?.kind === 'mock') {
        res.status(409).json({
          error: 'mock_mode',
          message:
            'This server is running with mock adapters. Restart without PCO_PRIME_SYNC_MOCK=1 to use real Planning Center credentials.',
        });
        return;
      }
      const parsed = pcoCredentialSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_credentials',
          message: 'Enter both the Planning Center application id and secret.',
        });
        return;
      }

      const check = await validatePcoCredentials(parsed.data);
      if (!check.ok) {
        // Never store credentials that Planning Center did not accept.
        res.status(400).json({ ...check, saved: false });
        return;
      }

      applyPcoCredentials(parsed.data);
      const envPath = writePcoCredentialsToEnv(parsed.data);
      services.repo.updateSettings({ pcoAppId: parsed.data.appId.trim() });
      services.reconfigurePco(parsed.data.appId.trim(), parsed.data.secret.trim());
      pcoStatusCache = null;

      res.json({
        ...check,
        saved: true,
        envFile: path.relative(process.cwd(), envPath) || envPath,
        secretSource: services.pcoSecretSource(),
      });
    }),
  );

  // ---- Planning Center --------------------------------------------------
  app.get(
    '/api/pco/teams',
    asyncHandler(async (_req, res) => {
      const settings = services.repo.getSettings();
      const configured = services.repo.listTeamConfiguration();
      const configuredById = new Map(configured.map((team) => [team.teamId, team]));

      let remote: Array<{ teamId: string; teamName: string; serviceTypeId: string | null; archived: boolean }> = [];
      let warning: string | null = null;
      if (!services.pcoAdapter) {
        warning = 'Planning Center is not configured';
      } else if (settings.pcoServiceTypeIds.length === 0) {
        warning = 'Select at least one Planning Center service type first';
      } else {
        try {
          remote = (await services.pcoAdapter.listTeams(settings.pcoServiceTypeIds)).map((team) => ({
            teamId: team.id,
            teamName: team.name,
            serviceTypeId: team.serviceTypeId,
            archived: team.archived,
          }));
          services.repo.upsertTeams(remote.map((team) => ({ ...team })));
        } catch (error) {
          warning = error instanceof Error ? error.message : String(error);
        }
      }

      const teams = new Map<
        string,
        { teamId: string; teamName: string; serviceTypeId: string | null; isWorshipTeam: boolean; archived: boolean }
      >();
      for (const team of configured) {
        teams.set(team.teamId, {
          teamId: team.teamId,
          teamName: team.teamName,
          serviceTypeId: team.serviceTypeId,
          isWorshipTeam: team.isWorshipTeam,
          archived: false,
        });
      }
      for (const team of remote) {
        const existing = configuredById.get(team.teamId);
        teams.set(team.teamId, {
          ...team,
          isWorshipTeam: existing?.isWorshipTeam ?? false,
        });
      }

      res.json({ teams: [...teams.values()].sort((a, b) => a.teamName.localeCompare(b.teamName)), warning });
    }),
  );

  app.post(
    '/api/pco/teams/worship',
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          teamId: z.string().trim().min(1).max(100),
          isWorshipTeam: z.boolean(),
          teamName: z.string().trim().min(1).max(200).optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'invalid_request', message: body.error.issues.map((i) => i.message).join('; ') });
        return;
      }
      if (body.data.teamName) {
        services.repo.upsertTeams([
          { teamId: body.data.teamId, teamName: body.data.teamName, serviceTypeId: null },
        ]);
      }
      services.repo.setWorshipTeam(body.data.teamId, body.data.isWorshipTeam);
      res.json({ ok: true, worshipTeamIds: services.repo.getWorshipTeamIds() });
    }),
  );

  // ---- plans ------------------------------------------------------------
  app.get(
    '/api/plans',
    asyncHandler(async (_req, res) => {
      const settings = services.repo.getSettings();
      const today = timePartsInTimeZone(new Date(), settings.timezone).isoDate;
      const toDate = addDaysInclusive(today, settings.windowDays);
      const plans = services.repo.listPlansBetween(today, toDate).map((plan) => {
        const songs = services.repo.listPlanSongs(plan.id);
        const musicians = services.repo.listPlanMusicians(plan.id);
        const setlist = services.repo.getPrimeSetlist(plan.pcoPlanId);
        return {
          ...plan,
          songs,
          musicians,
          setlist: setlist
            ? {
                primeSetlistId: setlist.primeSetlistId,
                primeSetlistName: setlist.primeSetlistName,
                primeUrl: setlist.primeUrl,
                lastVerifiedAt: setlist.lastVerifiedAt,
                trackCount: setlist.state.tracks.length,
                shareCount: setlist.state.shares.length,
              }
            : null,
        };
      });
      res.json({ plans, windowDays: settings.windowDays, today, toDate });
    }),
  );

  app.get('/api/plans/:pcoPlanId', (req, res) => {
    const plan = services.repo.getPlanByPcoId(req.params.pcoPlanId);
    if (!plan) {
      res.status(404).json({ error: 'not_found', message: 'Plan not found' });
      return;
    }
    res.json({
      plan,
      songs: services.repo.listPlanSongs(plan.id),
      musicians: services.repo.listPlanMusicians(plan.id),
      setlist: services.repo.getPrimeSetlist(plan.pcoPlanId),
    });
  });

  // ---- song matching ----------------------------------------------------
  app.get('/api/songs/needs-mapping', (_req, res) => {
    res.json({ songs: services.repo.listSongsNeedingMapping() });
  });

  app.get('/api/songs/mappings', (_req, res) => {
    res.json({ mappings: services.repo.listSongMappings() });
  });

  app.get(
    '/api/songs/search',
    asyncHandler(async (req, res) => {
      const query = String(req.query.q ?? '').trim();
      if (query.length < 2) {
        res.status(400).json({ error: 'invalid_query', message: 'Provide at least 2 characters to search' });
        return;
      }
      if (!services.primeAdapter) {
        res.status(503).json({ error: 'prime_unavailable', message: 'Loop Prime automation is not configured' });
        return;
      }
      try {
        const tracks = await services.primeAdapter.listTracks(query);
        const normalizedQuery = normalizeSongName(query);
        res.json({
          query,
          tracks: tracks.map((track) => ({
            ...track,
            exactNameMatch: normalizeSongName(track.title) === normalizedQuery,
          })),
        });
      } catch (error) {
        res.status(503).json({
          error: 'prime_search_failed',
          message: error instanceof Error ? error.message : 'Loop Prime search failed',
        });
      }
    }),
  );

  app.put(
    '/api/songs/mappings',
    asyncHandler(async (req, res) => {
      const parsed = songMappingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', message: parsed.error.issues.map((i) => i.message).join('; ') });
        return;
      }
      const mapping = services.repo.upsertSongMapping({
        pcoSongTitle: parsed.data.pcoSongTitle,
        pcoSongId: parsed.data.pcoSongId ?? null,
        primeTrackId: parsed.data.primeTrackId,
        primeTrackName: parsed.data.primeTrackName,
        primeArrangementId: parsed.data.primeArrangementId ?? null,
        primeArrangementName: parsed.data.primeArrangementName ?? null,
        confirmed: true,
        source: 'manual',
      });
      const updated = services.repo.applySongMappingToPlanSongs(mapping.normalizedName, mapping);
      services.repo.resolveErrorsByCode('song_match_ambiguous');
      res.json({ mapping, plansUpdated: updated });
    }),
  );

  app.delete('/api/songs/mappings/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id', message: 'Invalid mapping id' });
      return;
    }
    services.repo.deleteSongMapping(id);
    res.json({ ok: true });
  });

  // ---- team matching ----------------------------------------------------
  app.get('/api/team/needs-mapping', (_req, res) => {
    res.json({
      musicians: services.repo.listMusiciansNeedingMapping(),
      distinct: services.repo.listDistinctMusicians(),
    });
  });

  app.get('/api/team/mappings', (_req, res) => {
    res.json({ mappings: services.repo.listMemberMappings() });
  });

  app.get(
    '/api/team/prime-members',
    asyncHandler(async (_req, res) => {
      if (!services.primeAdapter) {
        res.status(503).json({ error: 'prime_unavailable', message: 'Loop Prime automation is not configured' });
        return;
      }
      try {
        const members = await services.primeAdapter.listTeamMembers();
        res.json({ members });
      } catch (error) {
        res.status(503).json({
          error: 'prime_team_unavailable',
          message: error instanceof Error ? error.message : 'Could not read Prime Team members',
        });
      }
    }),
  );

  app.put(
    '/api/team/mappings',
    asyncHandler(async (req, res) => {
      const parsed = memberMappingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', message: parsed.error.issues.map((i) => i.message).join('; ') });
        return;
      }
      const mapping = services.repo.upsertMemberMapping({
        normalizedEmail: parsed.data.normalizedEmail.trim().toLowerCase(),
        pcoPersonId: parsed.data.pcoPersonId ?? null,
        pcoName: parsed.data.pcoName ?? null,
        primeMemberId: parsed.data.primeMemberId,
        primeMemberName: parsed.data.primeMemberName,
        status: 'matched',
        source: 'manual',
      });
      const updated = services.repo.applyMemberMappingToPlanMusicians(mapping.normalizedEmail, mapping);
      res.json({ mapping, plansUpdated: updated });
    }),
  );

  app.delete('/api/team/mappings/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id', message: 'Invalid mapping id' });
      return;
    }
    services.repo.deleteMemberMapping(id);
    res.json({ ok: true });
  });

  // ---- sync -------------------------------------------------------------
  app.get(
    '/api/sync/preview',
    asyncHandler(async (_req, res) => {
      const preview: SyncPreview = await services.engine.preview();
      res.json(preview);
    }),
  );

  app.post(
    '/api/sync/run',
    asyncHandler(async (req, res) => {
      const body = z.object({ mode: z.enum(['sync', 'dry_run']).default('sync') }).safeParse(req.body ?? {});
      if (!body.success) {
        res.status(400).json({ error: 'invalid_request', message: 'mode must be "sync" or "dry_run"' });
        return;
      }
      const mode = body.data.mode as SyncMode;
      const result = services.startSync(mode, 'manual');
      res.status(result.started ? 202 : 409).json({ ...result, job: services.jobStatus() });
    }),
  );

  app.get('/api/sync/status', (_req, res) => {
    res.json(services.jobStatus());
  });

  app.get('/api/sync/history', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
    res.json({ runs: services.repo.listSyncHistory(limit) });
  });

  app.get('/api/sync/history/:id', (req, res) => {
    const id = Number(req.params.id);
    const run = Number.isFinite(id) ? services.repo.getSyncRun(id) : null;
    if (!run) {
      res.status(404).json({ error: 'not_found', message: 'Sync run not found' });
      return;
    }
    res.json({ run, changes: services.repo.listChanges(run.id) });
  });

  app.get('/api/sync/errors', (req, res) => {
    const unresolvedOnly = req.query.unresolved === '1';
    res.json({ errors: services.repo.listErrors({ limit: 100, unresolvedOnly }) });
  });

  app.post('/api/sync/errors/:id/resolve', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id', message: 'Invalid error id' });
      return;
    }
    services.repo.resolveError(id);
    res.json({ ok: true });
  });

  app.get('/api/schedule', (_req, res) => {
    res.json(scheduleInfo(services.repo));
  });

  // ---- Loop Prime -------------------------------------------------------
  app.get(
    '/api/prime/status',
    asyncHandler(async (_req, res) => {
      if (!services.primeAdapter) {
        res.status(503).json({
          error: 'prime_unavailable',
          message: services.primeInitError ?? 'Loop Prime automation is not configured',
        });
        return;
      }
      res.json(await services.primeAdapter.sessionStatus());
    }),
  );

  app.get('/api/prime/capabilities', (_req, res) => {
    res.json({
      capabilities: services.primeAdapter?.capabilities() ?? [],
      automation: services.primeAdapter?.kind ?? 'unavailable',
      ready: Boolean(services.primeAdapter),
    });
  });

  /**
   * Opens the persistent, visible Chromium window so the administrator can log
   * in by hand. The request returns immediately; the browser stays open until
   * the login is detected or PRIME_LOGIN_TIMEOUT_MS elapses.
   */
  app.post(
    '/api/prime/open-login',
    asyncHandler(async (_req, res) => {
      if (!services.primeAdapter) {
        res.status(503).json({
          error: 'prime_unavailable',
          message: services.primeInitError ?? 'Loop Prime automation is not configured',
        });
        return;
      }
      if (services.primeAdapter.kind === 'mock') {
        res.json({ ok: true, message: 'Mock adapter: session marked authenticated' });
        return;
      }
      const loginUrl = services.primeAdapter.loginUrl;
      // Wait for the launch to actually happen: reporting success before this
      // point told people a window was opening when it never appeared.
      let opened: LoginWindowInfo;
      try {
        opened = await services.primeAdapter.startManualLogin();
      } catch (error) {
        const failure = error as { message?: string; hint?: string } | null;
        const reason = (failure?.message ?? String(error)).split('\n')[0];
        // The session attaches a hint when it knows the cause. Only fall back to
        // the browser-install advice when it does not: a page that failed to load
        // is not a Chromium that failed to start.
        const hint =
          typeof failure?.hint === 'string'
            ? failure.hint
            : 'Chromium could not start — run `npx playwright install chromium`, and on Linux it may also need system libraries. The window opens on the machine running PCO Prime Sync, so a remote or headless server cannot show it: run the app on your own Mac (npm run dev) to log in.';
        console.error('[prime] could not open the login window:', reason);
        res.status(502).json({
          error: 'login_window_failed',
          loginUrl,
          message: `Could not open the login window on this computer: ${reason} ${hint}`,
        });
        return;
      }
      const shown = opened.title ? `"${opened.title}"` : '(a page with no title)';
      const blankWarning = opened.title
        ? ''
        : ' The page has no title, which usually means it rendered nothing — compare the URL above with what you expect and try again.';
      res.json({
        ok: true,
        loginUrl,
        window: opened,
        message:
          `Login window now shows ${shown} at ${opened.url}. Sign in there with your own Loop Community credentials, then close the window.${blankWarning}` +
          (opened.note ? ` ${opened.note}` : ''),
      });
    }),
  );

  // ---- static dashboard -------------------------------------------------
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDir)) {
    app.use(
      express.static(clientDir, {
        index: false,
        setHeaders: (res, filePath) => {
          // A cached index.html can outlive the hashed bundle it references, and
          // the result is a blank page with a correct title and no error.
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
          // Hashed build output never changes under the same name.
          else if (filePath.includes(`${path.sep}assets${path.sep}`))
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          // A module script served with the wrong MIME type is refused, and
          // Safari refuses it silently. State the type explicitly instead of
          // depending on the mime database, and forbid sniffing.
          if (filePath.endsWith('.js') || filePath.endsWith('.mjs'))
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          else if (filePath.endsWith('.css'))
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
          res.setHeader('X-Content-Type-Options', 'nosniff');
        },
      }),
    );
    // Only page routes may fall back to the shell. Answering a missing
    // /assets/*.js with the HTML shell is a 200 that renders nothing in any
    // browser — the hardest possible blank page to diagnose.
    app.get(/^\/(?!api\/).*/, (req, res, next) => {
      const lastSegment = req.path.split('/').pop() ?? '';
      if (/\.[a-z0-9]+$/i.test(lastSegment)) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send(
          'PCO Prime Sync API is running. The dashboard build was not found — run `npm run dev` for the Vite dev server, or `npm run build` for the production bundle.',
        );
    });
  }

  // ---- errors -----------------------------------------------------------
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    console.error('[api] error:', message);
    res.status(500).json({ error: 'internal_error', message });
  });

  return app;
}

function addDaysInclusive(isoDate: string, days: number): string {
  return days <= 0 ? isoDate : addDaysToIsoDate(isoDate, days);
}

export { countOperations };
