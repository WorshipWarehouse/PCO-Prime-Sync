import type {
  ChurchSettings,
  DesiredTrack,
  PlanSyncPreview,
  PrimeCapabilityReport,
  PrimeSessionStatus,
  SyncMode,
  SyncOperation,
  SyncPreview,
  SyncRunResult,
  SyncRunStatus,
  SyncTrigger,
} from '../../shared/types';
import { addDaysToIsoDate, timePartsInTimeZone } from '../../shared/naming';
import type { Repository } from '../db/repo';
import type { PcoAdapter } from '../pco/adapter';
import {
  PrimeSessionExpiredError,
  PrimeVerificationError,
  type PrimeAdapter,
} from '../prime/adapter';
import { planPlanChanges, pairTracks } from './planner';
import { createResolveCache, resolveDesiredPlan, type DesiredPlan, type ResolveCache } from './resolve';

export interface SyncEngineDeps {
  repo: Repository;
  pcoAdapter: PcoAdapter | null;
  primeAdapter: PrimeAdapter | null;
  now?: () => Date;
}

interface AnalysisResult {
  settings: ChurchSettings;
  previews: PlanSyncPreview[];
  desiredPlans: Map<string, DesiredPlan>;
  capabilities: PrimeCapabilityReport[];
  primeStatus: PrimeSessionStatus | null;
  notices: string[];
  blockingNotices: string[];
  mode: SyncMode;
}

const OPERATION_ORDER: Record<string, number> = {
  create_setlist: 0,
  remove_track: 1,
  add_track: 2,
  reorder_tracks: 3,
  key_change: 4,
  share_member: 5,
  unshare_member: 6,
  flag_review: 9,
  noop: 10,
};

/**
 * The synchronization engine.
 *
 * Safety model:
 *  - plans with unmatched/ambiguous songs are never written to Prime
 *  - every mutation is followed by a verification read of the live setlist
 *  - a session expiry pauses the run (no retries of destructive actions)
 *  - a failed verification stops the whole run: the remote state is uncertain
 *  - setlists are never deleted and BPM/mix/tempo are never touched
 */
export class SyncEngine {
  private readonly repo: Repository;
  private readonly pcoAdapter: PcoAdapter | null;
  private readonly primeAdapter: PrimeAdapter | null;
  private readonly now: () => Date;

  constructor(deps: SyncEngineDeps) {
    this.repo = deps.repo;
    this.pcoAdapter = deps.pcoAdapter;
    this.primeAdapter = deps.primeAdapter;
    this.now = deps.now ?? (() => new Date());
  }

  private window(settings: ChurchSettings): { fromDate: string; toDate: string } {
    const today = timePartsInTimeZone(this.now(), settings.timezone).isoDate;
    return { fromDate: today, toDate: addDaysToIsoDate(today, settings.windowDays) };
  }

  async analyze(mode: SyncMode, syncRunId: number | null): Promise<AnalysisResult> {
    const settings = this.repo.getSettings();
    const notices: string[] = [];
    const blockingNotices: string[] = [];
    const cache: ResolveCache = createResolveCache();

    const recordError = (input: {
      scope: string;
      code: string;
      message: string;
      detail?: string | null;
      pcoPlanId: string | null;
    }): void => {
      this.repo.addError({
        syncRunId,
        pcoPlanId: input.pcoPlanId,
        scope: input.scope,
        code: input.code,
        message: input.message,
        detail: input.detail ?? null,
      });
    };

    if (!this.pcoAdapter) {
      blockingNotices.push(
        'Planning Center credentials are not configured. Add PCO_APP_ID and PCO_SECRET to .env (see docs/SETUP.md).',
      );
      return {
        settings,
        previews: [],
        desiredPlans: new Map(),
        capabilities: this.primeAdapter?.capabilities() ?? [],
        primeStatus: null,
        notices,
        blockingNotices,
        mode,
      };
    }

    if (!this.primeAdapter) {
      blockingNotices.push('Loop Community Prime automation is not configured.');
      return {
        settings,
        previews: [],
        desiredPlans: new Map(),
        capabilities: [],
        primeStatus: null,
        notices,
        blockingNotices,
        mode,
      };
    }

    const serviceTypeIds = settings.pcoServiceTypeIds;
    if (serviceTypeIds.length === 0) {
      blockingNotices.push(
        'No Planning Center service types are selected. Choose at least one in Settings, then load the plan data again.',
      );
    }
    const worshipTeamIds = this.repo.getWorshipTeamIds();
    if (worshipTeamIds.length === 0) {
      notices.push(
        'No worship teams are configured, so no musicians will be shared with. Configure worship team IDs in Settings.',
      );
    }

    const capabilities = this.primeAdapter.capabilities();
    let primeStatus: PrimeSessionStatus | null = null;
    try {
      primeStatus = await this.primeAdapter.sessionStatus();
    } catch (error) {
      notices.push(
        `Could not read the Loop Prime session status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { fromDate, toDate } = this.window(settings);
    let previews: PlanSyncPreview[] = [];
    const desiredPlans = new Map<string, DesiredPlan>();

    if (serviceTypeIds.length > 0) {
      let plans;
      try {
        plans = await this.pcoAdapter.listPlans(serviceTypeIds, fromDate, toDate);
      } catch (error) {
        blockingNotices.push(
          `Planning Center plan fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          settings,
          previews: [],
          desiredPlans,
          capabilities,
          primeStatus,
          notices,
          blockingNotices,
          mode,
        };
      }

      const sessionReady = primeStatus?.state === 'authenticated';

      for (const plan of plans) {
        let desired: DesiredPlan;
        try {
          desired = await resolveDesiredPlan(plan, {
            repo: this.repo,
            pco: this.pcoAdapter,
            prime: this.primeAdapter,
            settings,
            recordError,
          }, cache);
        } catch (error) {
          recordError({
            scope: 'pco_plan',
            code: 'plan_resolution_failed',
            message: `Could not read plan "${plan.title}" (${plan.planDate}): ${
              error instanceof Error ? error.message : String(error)
            }`,
            pcoPlanId: plan.id,
          });
          continue;
        }

        desiredPlans.set(plan.id, desired);
        const existingRecord = this.repo.getPrimeSetlist(plan.id);
        let liveSetlist = null;
        if (existingRecord && sessionReady) {
          try {
            liveSetlist = await this.primeAdapter.getSetlist(existingRecord.primeSetlistId);
          } catch (error) {
            if (error instanceof PrimeSessionExpiredError) {
              primeStatus = await this.primeAdapter.sessionStatus().catch(() => primeStatus);
            }
            recordError({
              scope: 'prime_setlist',
              code: 'prime_setlist_read_failed',
              message: `Could not read the Prime setlist for "${plan.title}": ${
                error instanceof Error ? error.message : String(error)
              }`,
              pcoPlanId: plan.id,
            });
          }
        }

        const preview = planPlanChanges({
          desired,
          existingRecord,
          liveSetlist,
          capabilities,
        });
        previews.push(preview);
      }

      if (!sessionReady) {
        blockingNotices.push(
          primeStatus?.message ??
            'Loop Community Prime is not authenticated. Click "Log in to Loop" in the dashboard, then sync again.',
        );
      }

      // Plans that disappeared from PCO are flagged, never deleted.
      const fetchedIds = new Set(plans.map((plan) => plan.id));
      const knownPlans = this.repo.listPlansBetween(fromDate, toDate);
      for (const known of knownPlans) {
        if (fetchedIds.has(known.pcoPlanId)) continue;
        if (known.status === 'missing_in_pco') continue;
        this.repo.setPlanStatus(known.pcoPlanId, 'missing_in_pco');
        if (mode === 'sync' && syncRunId !== null) {
          this.repo.addChange({
            syncRunId,
            pcoPlanId: known.pcoPlanId,
            changeType: 'flag_review',
            description: `Plan "${known.title}" (${known.planDate}) no longer exists in Planning Center. Its Prime setlist was left in place for manual review.`,
            status: 'blocked',
          });
        }
        recordError({
          scope: 'plan_lifecycle',
          code: 'plan_missing_in_pco',
          message: `Plan "${known.title}" (${known.planDate}) was not returned by Planning Center. Nothing was deleted.`,
          pcoPlanId: known.pcoPlanId,
        });
      }
    }

    return { settings, previews, desiredPlans, capabilities, primeStatus, notices, blockingNotices, mode };
  }

  async preview(): Promise<SyncPreview> {
    const analysis = await this.analyze('dry_run', null);
    const totalOperations = analysis.previews.reduce(
      (sum, preview) => sum + preview.operations.filter((operation) => operation.changeType !== 'flag_review').length,
      0,
    );
    return {
      generatedAt: this.now().toISOString(),
      mode: 'dry_run',
      windowDays: analysis.settings.windowDays,
      plans: analysis.previews.map((preview) => ({
        ...preview,
        blockedReasons: [...preview.blockedReasons, ...analysis.blockingNotices],
      })),
      totalOperations,
      unsyncedPlanCount: analysis.previews.filter((preview) => preview.status !== 'in_sync').length,
    };
  }

  async run(options: { mode: SyncMode; trigger: SyncTrigger }): Promise<SyncRunResult> {
    const startedAt = this.now().toISOString();
    const syncRunId = this.repo.createSyncRun(options.mode, options.trigger);
    const analysis = await this.analyze(options.mode, syncRunId);
    const errors: SyncRunResult['errors'] = [];
    let changesApplied = 0;
    let plansProcessed = 0;
    let plansInSync = 0;
    let fatalSession = false;
    let uncertainState = false;

    const recordErrorLocal = (input: {
      code: string;
      message: string;
      scope: string;
      pcoPlanId: string | null;
      detail?: string | null;
    }): void => {
      errors.push({ code: input.code, message: input.message, scope: input.scope, pcoPlanId: input.pcoPlanId });
      this.repo.addError({ syncRunId, ...input, detail: input.detail ?? null });
    };

    if (analysis.blockingNotices.length > 0) {
      for (const notice of analysis.blockingNotices) {
        recordErrorLocal({ code: 'sync_blocked', message: notice, scope: 'preflight', pcoPlanId: null });
      }
      // Local state is still recorded so the dashboard shows the latest PCO data.
      for (const preview of analysis.previews) {
        this.repo.setPlanStatus(preview.pcoPlanId, preview.status);
      }
      const status: SyncRunStatus = 'blocked';
      const summary = `Blocked: ${analysis.blockingNotices.join(' ')}`;
      this.repo.finishSyncRun(syncRunId, {
        status,
        plansProcessed: 0,
        changesApplied: 0,
        errorsCount: errors.length,
        summary,
      });
      return {
        syncRunId,
        mode: options.mode,
        trigger: options.trigger,
        status,
        startedAt,
        finishedAt: this.now().toISOString(),
        plansProcessed: 0,
        changesApplied: 0,
        errors,
        planPreviews: analysis.previews,
        summary,
      };
    }

    for (const preview of analysis.previews) {
      plansProcessed += 1;
      const desired = analysis.desiredPlans.get(preview.pcoPlanId);
      const record = this.repo.getPrimeSetlist(preview.pcoPlanId);
      let setlistId = record?.primeSetlistId ?? null;
      let planFailed = false;

      if (options.mode === 'dry_run') {
        for (const operation of preview.operations) {
          this.repo.addChange({
            syncRunId,
            pcoPlanId: preview.pcoPlanId,
            changeType: operation.changeType,
            description: operation.description,
            status: 'planned',
          });
        }
        this.repo.setPlanStatus(preview.pcoPlanId, preview.status);
        continue;
      }

      if (preview.blocked) {
        for (const operation of preview.operations) {
          this.repo.addChange({
            syncRunId,
            pcoPlanId: preview.pcoPlanId,
            changeType: operation.changeType,
            description: operation.description,
            status: 'blocked',
          });
        }
        this.repo.setPlanStatus(preview.pcoPlanId, preview.status);
        if (preview.blockedReasons.length > 0) {
          recordErrorLocal({
            code: 'plan_blocked',
            message: `"${preview.planTitle}" (${preview.planDate}) was not synchronized: ${preview.blockedReasons.join('; ')}`,
            scope: 'plan_sync',
            pcoPlanId: preview.pcoPlanId,
          });
        }
        continue;
      }

      const ordered = [...preview.operations].sort(
        (a, b) => (OPERATION_ORDER[a.changeType] ?? 5) - (OPERATION_ORDER[b.changeType] ?? 5),
      );

      for (const operation of ordered) {
        if (operation.changeType === 'flag_review') {
          this.repo.addChange({
            syncRunId,
            pcoPlanId: preview.pcoPlanId,
            changeType: 'flag_review',
            description: operation.description,
            status: 'skipped',
          });
          continue;
        }

        try {
          const result = await this.executeOperation(operation, {
            setlistId,
            setlistName: preview.setlistName,
            desired,
          });
          if (result.setlistId) setlistId = result.setlistId;
          changesApplied += 1;
          this.repo.addChange({
            syncRunId,
            pcoPlanId: preview.pcoPlanId,
            changeType: operation.changeType,
            description: operation.description,
            status: 'applied',
            detail: result.detail ?? null,
          });
        } catch (error) {
          planFailed = true;
          const isSession = error instanceof PrimeSessionExpiredError;
          const isVerification = error instanceof PrimeVerificationError;
          const message = error instanceof Error ? error.message : String(error);
          this.repo.addChange({
            syncRunId,
            pcoPlanId: preview.pcoPlanId,
            changeType: operation.changeType,
            description: operation.description,
            status: 'failed',
            detail: message,
          });
          recordErrorLocal({
            code: isSession ? 'prime_session_expired' : isVerification ? 'prime_verification_failed' : 'prime_action_failed',
            message: `${operation.description}: ${message}`,
            scope: 'prime_action',
            pcoPlanId: preview.pcoPlanId,
            detail: error instanceof Error && 'detail' in error ? String((error as { detail?: string }).detail ?? '') : null,
          });
          if (isSession) {
            fatalSession = true;
            break;
          }
          if (isVerification) {
            uncertainState = true;
            break;
          }
        }
      }

      if (fatalSession || uncertainState) break;

      // Verify the final state and persist it so the next run is idempotent.
      const verification = await this.verifyAndPersist({
        preview,
        desired,
        setlistId,
        recordError: recordErrorLocal,
      });
      if (verification === 'uncertain') {
        uncertainState = true;
        break;
      }
      if (planFailed || !verification) {
        this.repo.setPlanStatus(preview.pcoPlanId, 'error');
      } else {
        const needsMatching =
          preview.unmatchedSongs.length > 0 ||
          preview.ambiguousSongs.length > 0 ||
          preview.unmatchedMusicians.length > 0 ||
          preview.ambiguousMusicians.length > 0;
        const status = needsMatching ? 'needs_matching' : 'in_sync';
        if (status === 'in_sync') plansInSync += 1;
        this.repo.setPlanStatus(preview.pcoPlanId, status, status === 'in_sync');
      }
    }

    // Errors recorded during analysis (matching problems, missing plans) also
    // count towards the run status, not just execution failures.
    const totalErrors = Math.max(errors.length, this.repo.countErrorsForRun(syncRunId));

    let status: SyncRunStatus;
    if (options.mode === 'dry_run') status = 'dry_run';
    else if (fatalSession || uncertainState) status = changesApplied > 0 ? 'partial' : 'failed';
    else if (totalErrors > 0) status = changesApplied > 0 || plansInSync > 0 ? 'partial' : 'failed';
    else status = 'success';

    const summaryParts: string[] = [];
    summaryParts.push(
      `${options.mode === 'dry_run' ? 'Dry run' : 'Sync'} of ${plansProcessed} plan${plansProcessed === 1 ? '' : 's'}`,
    );
    summaryParts.push(`${changesApplied} change${changesApplied === 1 ? '' : 's'} applied`);
    if (totalErrors > 0) summaryParts.push(`${totalErrors} error${totalErrors === 1 ? '' : 's'}`);
    if (fatalSession) summaryParts.push('Loop session expired — manual login required');
    if (uncertainState) summaryParts.push('stopped after an unverified change (remote state uncertain)');

    this.repo.finishSyncRun(syncRunId, {
      status,
      plansProcessed,
      changesApplied,
      errorsCount: totalErrors,
      summary: summaryParts.join(', '),
    });

    return {
      syncRunId,
      mode: options.mode,
      trigger: options.trigger,
      status,
      startedAt,
      finishedAt: this.now().toISOString(),
      plansProcessed,
      changesApplied,
      errors,
      planPreviews: analysis.previews,
      summary: summaryParts.join(', '),
    };
  }

  private async executeOperation(
    operation: SyncOperation,
    context: { setlistId: string | null; setlistName: string; desired: DesiredPlan | undefined },
  ): Promise<{ setlistId?: string; detail?: string | null }> {
    const prime = this.primeAdapter;
    if (!prime) throw new Error('Prime adapter is not configured');

    switch (operation.changeType) {
      case 'create_setlist': {
        const created = await prime.createSetlist({
          name: operation.setlistName,
          tracks: [],
          shares: [],
        });
        this.repo.savePrimeSetlist({
          pcoPlanId: operation.pcoPlanId,
          primeSetlistId: created.id,
          primeSetlistName: created.name || operation.setlistName,
          primeUrl: created.url,
          verified: true,
          state: { tracks: created.tracks, shares: created.shares },
        });
        return { setlistId: created.id, detail: `Prime setlist id ${created.id}` };
      }
      case 'add_track': {
        if (!context.setlistId) throw new Error('Cannot add a track before the setlist exists');
        await prime.addTrack(context.setlistId, {
          trackId: operation.track.trackId,
          position: operation.position,
          // The key comes from Planning Center. BPM and mix settings are never sent.
          key: operation.track.keyName,
        });
        return { detail: `Prime track id ${operation.track.trackId}` };
      }
      case 'remove_track': {
        if (!context.setlistId) throw new Error('Cannot remove a track without a setlist');
        await prime.removeTrack(context.setlistId, operation.setlistTrackId);
        return {};
      }
      case 'reorder_tracks': {
        if (!context.setlistId) throw new Error('Cannot reorder without a setlist');
        await prime.reorderTracks(context.setlistId, operation.desiredOrder);
        return {};
      }
      case 'key_change': {
        if (!context.setlistId) throw new Error('Cannot change a key without a setlist');
        await prime.setTrackKey(context.setlistId, operation.setlistTrackId, operation.toKey);
        return { detail: `${operation.fromKey ?? '?'} → ${operation.toKey}` };
      }
      case 'share_member': {
        if (!context.setlistId) throw new Error('Cannot share before the setlist exists');
        await prime.shareMember(context.setlistId, operation.member.memberId);
        return { detail: operation.member.email };
      }
      case 'unshare_member': {
        if (!context.setlistId) throw new Error('Cannot unshare without a setlist');
        await prime.unshareMember(context.setlistId, operation.memberId);
        return {};
      }
      default:
        throw new Error(`Unsupported operation ${operation.changeType}`);
    }
  }

  /**
   * Read the live setlist after a plan's operations, persist the verified state,
   * and record per-song/per-musician tracking. Returns null when nothing changed
   * and no setlist exists yet.
   */
  private async verifyAndPersist(input: {
    preview: PlanSyncPreview;
    desired: DesiredPlan | undefined;
    setlistId: string | null;
    recordError: (input: {
      code: string;
      message: string;
      scope: string;
      pcoPlanId: string | null;
      detail?: string | null;
    }) => void;
  }): Promise<boolean | 'uncertain'> {
    const { preview, desired, setlistId, recordError } = input;
    if (!this.primeAdapter) return false;
    if (!setlistId) return true;

    try {
      const live = await this.primeAdapter.getSetlist(setlistId);
      this.repo.savePrimeSetlist({
        pcoPlanId: preview.pcoPlanId,
        primeSetlistId: live.id,
        primeSetlistName: live.name || preview.setlistName,
        primeUrl: live.url,
        verified: true,
        state: { tracks: live.tracks, shares: live.shares },
      });

      if (!desired) return true;
      const planRecord = this.repo.getPlanByPcoId(preview.pcoPlanId);
      if (!planRecord) return true;

      const desiredTracks: DesiredTrack[] = desired.songs
        .filter((song) => song.matchStatus === 'matched' && song.trackId)
        .map((song) => ({
          itemId: song.item.id,
          title: song.title,
          keyName: song.keyName,
          trackId: song.trackId!,
          trackName: song.trackName ?? song.title,
          primeArrangementId: song.primeArrangementId,
        }));
      const pairings = pairTracks(desiredTracks, live.tracks);
      for (const pairing of pairings) {
        if (!pairing.desired || !pairing.existing) continue;
        this.repo.setPlanSongTracking(planRecord.id, pairing.desired.itemId, {
          primeSetlistTrackId: pairing.existing.setlistTrackId,
          primeAppliedKey: pairing.existing.key,
        });
      }

      const shareIds = new Set(live.shares.map((share) => share.memberId));
      for (const musician of desired.musicians) {
        if (!musician.primeMemberId) continue;
        this.repo.setPlanMusicianShared(planRecord.id, musician.pcoPersonId, shareIds.has(musician.primeMemberId));
      }

      return true;
    } catch (error) {
      if (error instanceof PrimeSessionExpiredError) {
        recordError({
          code: 'prime_session_expired',
          message: `Could not verify the setlist after syncing: ${error.message}`,
          scope: 'prime_verification',
          pcoPlanId: preview.pcoPlanId,
        });
        return false;
      }
      if (error instanceof PrimeVerificationError) {
        recordError({
          code: 'prime_verification_failed',
          message: `Post-sync verification failed for "${preview.planTitle}": ${error.message}`,
          scope: 'prime_verification',
          pcoPlanId: preview.pcoPlanId,
        });
        return 'uncertain';
      }
      recordError({
        code: 'prime_verification_error',
        message: `Could not verify the setlist after syncing: ${
          error instanceof Error ? error.message : String(error)
        }`,
        scope: 'prime_verification',
        pcoPlanId: preview.pcoPlanId,
      });
      return false;
    }
  }
}

export function countOperations(operations: SyncOperation[]): number {
  return operations.filter((operation) => operation.changeType !== 'flag_review').length;
}
