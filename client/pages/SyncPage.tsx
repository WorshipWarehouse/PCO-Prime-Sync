import { useCallback, useEffect, useState } from 'react';
import type { SyncChangeRecord, SyncErrorRecord, SyncHistoryRecord, SyncPreview, SyncRunResult } from '../../src/shared/types';
import { api, type SyncJobStatus } from '../api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Spinner,
  StatusBadge,
  formatDate,
  formatDateTime,
} from '../components';

export function SyncPage() {
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [job, setJob] = useState<SyncJobStatus | null>(null);
  const [history, setHistory] = useState<SyncHistoryRecord[]>([]);
  const [errors, setErrors] = useState<SyncErrorRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<{ run: SyncHistoryRecord; changes: SyncChangeRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [historyResult, errorResult, status] = await Promise.all([
        api.history(),
        api.errors(),
        api.syncStatus(),
      ]);
      setHistory(historyResult.runs);
      setErrors(errorResult.errors);
      setJob(status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (job?.status !== 'running') return;
    const timer = setInterval(async () => {
      try {
        const status = await api.syncStatus();
        setJob(status);
        if (status.status !== 'running') await loadLists();
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [job?.status, loadLists]);

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(await api.preview());
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const startRun = async (mode: 'sync' | 'dry_run') => {
    try {
      const result = await api.runSync(mode);
      setJob(result.job);
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openRun = async (id: number) => {
    try {
      setSelectedRun(await api.historyDetail(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = job?.status === 'running';
  const lastResult: SyncRunResult | null = job?.result ?? null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Synchronization</h1>
          <p>Preview what would change in Loop Prime, then run a dry run or a real sync.</p>
        </div>
        <div className="actions">
          <Button onClick={() => void runPreview()} disabled={previewing || running}>
            {previewing ? 'Building preview…' : 'Preview pending changes'}
          </Button>
          <Button onClick={() => void startRun('dry_run')} disabled={running}>
            Dry run
          </Button>
          <Button variant="primary" onClick={() => void startRun('sync')} disabled={running}>
            {running ? 'Running…' : 'Sync now'}
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {running ? (
        <div className="banner banner-info">
          Synchronization is running ({job?.mode}). The Loop browser window may be visible while it works.
        </div>
      ) : null}

      {job?.error ? <ErrorBanner message={job.error} /> : null}

      {lastResult ? (
        <Card title={`Last run: ${lastResult.mode === 'dry_run' ? 'dry run' : 'sync'} (${lastResult.status})`}>
          <p style={{ marginTop: 0 }}>{lastResult.summary}</p>
          <p className="muted" style={{ fontSize: 12 }}>
            {formatDateTime(lastResult.startedAt)} → {formatDateTime(lastResult.finishedAt)} · {lastResult.plansProcessed}{' '}
            plans · {lastResult.changesApplied} changes
          </p>
          {lastResult.errors.length > 0 ? (
            <ul className="list">
              {lastResult.errors.map((item, index) => (
                <li key={`${item.code}-${index}`}>
                  <strong>{item.code}</strong>: {item.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {previewError ? <ErrorBanner message={previewError} /> : null}

      {preview ? (
        <Card
          title={`Preview (${preview.plans.length} plans, ${preview.totalOperations} pending operations)`}
          actions={<Badge tone="info">{preview.mode.replace('_', ' ')}</Badge>}
        >
          {preview.plans.length === 0 ? (
            <EmptyState>
              No plans could be analyzed. Check the Planning Center configuration, the Loop session, and the service type
              selection.
            </EmptyState>
          ) : (
            preview.plans.map((plan) => (
              <div key={plan.pcoPlanId} style={{ marginBottom: 18 }}>
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {plan.planTitle} — {formatDate(plan.planDate)}
                  </strong>
                  <StatusBadge status={plan.status} />
                </div>
                <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                  Setlist name: {plan.setlistName}
                </p>
                {plan.blockedReasons.length > 0 ? (
                  <ul className="list">
                    {plan.blockedReasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                {plan.operations.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    No changes — Loop already matches Planning Center.
                  </p>
                ) : (
                  plan.operations.map((operation, index) => (
                    <div
                      className={operation.changeType === 'flag_review' ? 'op op-flag' : 'op'}
                      key={`${operation.changeType}-${index}`}
                    >
                      <span className="mono">{operation.changeType}</span> — {operation.description}
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </Card>
      ) : null}

      <Card title="Sync history">
        {history.length === 0 ? (
          <EmptyState>No synchronization has run yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Mode</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Plans</th>
                <th>Changes</th>
                <th>Errors</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{run.mode}</td>
                  <td>{run.trigger}</td>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                  <td>{run.plansProcessed}</td>
                  <td>{run.changesApplied}</td>
                  <td>{run.errorsCount}</td>
                  <td>
                    <Button onClick={() => void openRun(run.id)}>Details</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selectedRun ? (
        <Card title={`Run ${selectedRun.run.id} changes`} actions={<Button onClick={() => setSelectedRun(null)}>Close</Button>}>
          <p style={{ marginTop: 0 }}>{selectedRun.run.summary}</p>
          {selectedRun.changes.length === 0 ? (
            <EmptyState>No change records for this run.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.changes.map((change) => (
                  <tr key={change.id}>
                    <td className="mono">{change.pcoPlanId ?? '—'}</td>
                    <td>{change.changeType}</td>
                    <td>{change.description}</td>
                    <td>
                      <StatusBadge status={change.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      <Card title="Errors and warnings">
        {errors.length === 0 ? (
          <EmptyState>No errors recorded.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Scope</th>
                <th>Code</th>
                <th>Message</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {errors.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.scope}</td>
                  <td className="mono">{item.code}</td>
                  <td>{item.message}</td>
                  <td>
                    {item.resolvedAt ? (
                      <Badge tone="ok">resolved</Badge>
                    ) : (
                      <Button
                        onClick={async () => {
                          await api.resolveError(item.id).catch(() => undefined);
                          await loadLists();
                        }}
                      >
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {!job && !preview ? <Spinner label="Loading synchronization state…" /> : null}
    </div>
  );
}
