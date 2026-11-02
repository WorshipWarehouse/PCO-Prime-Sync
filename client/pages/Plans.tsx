import { useCallback, useEffect, useState } from 'react';
import { api, type PlanDetail } from '../api';
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

export function PlansPage() {
  const [plans, setPlans] = useState<PlanDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowInfo, setWindowInfo] = useState<{ today: string; toDate: string; windowDays: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.plans();
      setPlans(result.plans);
      setWindowInfo({ today: result.today, toDate: result.toDate, windowDays: result.windowDays });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Service plans</h1>
          <p>
            {windowInfo
              ? `Plans between ${formatDate(windowInfo.today)} and ${formatDate(windowInfo.toDate)} (${windowInfo.windowDays}-day window).`
              : 'Upcoming Planning Center plans in the synchronization window.'}
          </p>
        </div>
        <Button onClick={() => void load()}>Reload</Button>
      </div>

      <ErrorBanner message={error} />

      {!plans ? (
        <Spinner />
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState>
            No plans stored yet. Configure Planning Center in Settings, run a dry run, or use “Preview pending changes” to
            import the current plan data.
          </EmptyState>
        </Card>
      ) : (
        plans.map((plan) => (
          <Card
            key={plan.pcoPlanId}
            title={`${plan.title} — ${formatDate(plan.planDate)}`}
            actions={<StatusBadge status={plan.status} />}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              PCO plan {plan.pcoPlanId} · series {plan.seriesTitle ?? '—'} · last synced {formatDateTime(plan.lastSyncedAt)}
            </p>

            {plan.setlist ? (
              <div className="detail-panel" style={{ marginBottom: 14 }}>
                <strong>Prime setlist:</strong> {plan.setlist.primeSetlistName} · id{' '}
                <span className="mono">{plan.setlist.primeSetlistId}</span> · {plan.setlist.trackCount} track
                {plan.setlist.trackCount === 1 ? '' : 's'} · {plan.setlist.shareCount} share
                {plan.setlist.shareCount === 1 ? '' : 's'} · verified {formatDateTime(plan.setlist.lastVerifiedAt)}
                {plan.setlist.primeUrl ? (
                  <>
                    {' '}
                    · <span className="mono">{plan.setlist.primeUrl}</span>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>
                No Prime setlist recorded for this plan yet.
              </p>
            )}

            <h3 style={{ fontSize: 13, marginBottom: 6 }}>Songs</h3>
            {plan.songs.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No song data stored yet for this plan.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>PCO song</th>
                    <th>Arrangement</th>
                    <th>Key</th>
                    <th>Match</th>
                    <th>Prime multitrack</th>
                    <th>Applied key</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.songs.map((song) => (
                    <tr key={song.id}>
                      <td>{song.position}</td>
                      <td>{song.title}</td>
                      <td>
                        {song.arrangementPcoName ?? '—'}
                        {song.arrangementSelected === 'none' ? <Badge tone="bad">manual review</Badge> : null}
                      </td>
                      <td>{song.keyName ?? '—'}</td>
                      <td>
                        <StatusBadge status={song.matchStatus} />
                      </td>
                      <td>{song.primeTrackName ?? <span className="muted">not mapped</span>}</td>
                      <td>{song.primeAppliedKey ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>Scheduled worship musicians</h3>
            {plan.musicians.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No musicians from configured worship teams are scheduled (or team IDs are not configured).
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Team</th>
                    <th>Prime member</th>
                    <th>Status</th>
                    <th>Shared</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.musicians.map((musician) => (
                    <tr key={musician.id}>
                      <td>{musician.pcoName}</td>
                      <td>{musician.emailRaw ?? <span className="muted">no email</span>}</td>
                      <td>{musician.teamName ?? '—'}</td>
                      <td>{musician.primeMemberName ?? <span className="muted">not matched</span>}</td>
                      <td>
                        <StatusBadge status={musician.matchStatus} />
                      </td>
                      <td>{musician.shared ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
