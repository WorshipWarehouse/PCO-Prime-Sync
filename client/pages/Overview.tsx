import { useCallback, useEffect, useState } from 'react';
import type { OverviewPayload } from '../../src/shared/types';
import { api } from '../api';
import { Badge, Button, Card, ErrorBanner, Notice, Spinner, StatusBadge, formatDateTime } from '../components';

export function OverviewPage({ onNavigate }: { onNavigate: (tab: 'settings' | 'sync' | 'songs' | 'team') => void }) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.overview());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const openLogin = async () => {
    setBusy(true);
    try {
      const result = await api.openLogin();
      setMessage(result.message);
      setTimeout(() => void load(), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p>Local sync between Planning Center Services and Loop Community Prime.</p>
        </div>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>

      <ErrorBanner message={error} />
      {message ? <Notice>{message}</Notice> : null}

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat-label">Upcoming plans</div>
          <div className="stat-value">{data.counts.upcomingPlans}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Matched songs</div>
          <div className="stat-value">{data.counts.matchedSongs}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unmatched songs</div>
          <div className="stat-value">{data.counts.unmatchedSongs}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Musicians needing match</div>
          <div className="stat-value">{data.counts.musiciansNeedingMatching}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <Card title="Planning Center" actions={<Badge tone={data.pco.ok ? 'ok' : data.pco.configured ? 'bad' : 'warn'}>{data.pco.ok ? 'connected' : data.pco.configured ? 'error' : 'not configured'}</Badge>}>
          <p style={{ marginTop: 0 }}>{data.pco.message}</p>
          <table>
            <tbody>
              <tr>
                <th>Credentials</th>
                <td>{data.pco.configured ? `configured (secret from ${data.pco.secretSource})` : 'missing'}</td>
              </tr>
              <tr>
                <th>Service types</th>
                <td>{data.pco.serviceTypeCount ?? '—'}</td>
              </tr>
              <tr>
                <th>Checked</th>
                <td>{formatDateTime(data.pco.checkedAt)}</td>
              </tr>
            </tbody>
          </table>
          {!data.pco.configured ? (
            <div className="actions" style={{ marginTop: 12 }}>
              <Button onClick={() => onNavigate('settings')}>Open settings</Button>
            </div>
          ) : null}
        </Card>

        <Card
          title="Loop Community Prime"
          actions={<StatusBadge status={data.prime.state} />}
        >
          <p style={{ marginTop: 0 }}>{data.prime.message}</p>
          <p className="muted mono">profile: {data.prime.profileDir}</p>
          <div className="actions">
            <Button variant="primary" onClick={() => void openLogin()} disabled={busy}>
              {busy ? 'Opening…' : 'Log in to Loop'}
            </Button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            A visible Chromium window opens using the persistent profile. Log in there; the session is reused on later runs.
          </p>
        </Card>

        <Card title="Synchronization">
          <table>
            <tbody>
              <tr>
                <th>Last successful sync</th>
                <td>{data.lastSuccessfulSync ? formatDateTime(data.lastSuccessfulSync.finishedAt) : 'never'}</td>
              </tr>
              <tr>
                <th>Next scheduled run</th>
                <td>
                  {data.schedule.enabled ? formatDateTime(data.schedule.nextRunAt) : 'automatic sync disabled'}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {data.schedule.timeLabel} {data.schedule.timezone} · window {data.schedule.windowDays} days
                  </div>
                </td>
              </tr>
              <tr>
                <th>launchd agent</th>
                <td>{data.schedule.launchdInstalled ? 'installed' : 'not installed'}</td>
              </tr>
              <tr>
                <th>Pending changes</th>
                <td>{data.counts.pendingChanges}</td>
              </tr>
            </tbody>
          </table>
          <div className="actions" style={{ marginTop: 12 }}>
            <Button onClick={() => onNavigate('sync')}>Preview / sync now</Button>
          </div>
        </Card>

        <Card title="Needs attention">
          {data.counts.unmatchedSongs > 0 || data.counts.musiciansNeedingMatching > 0 ? (
            <ul className="list">
              {data.counts.unmatchedSongs > 0 ? (
                <li>
                  {data.counts.unmatchedSongs} song{data.counts.unmatchedSongs === 1 ? '' : 's'} need a multitrack match.{' '}
                  <button className="tab-inline" onClick={() => onNavigate('songs')}>
                    Open song matching
                  </button>
                </li>
              ) : null}
              {data.counts.musiciansNeedingMatching > 0 ? (
                <li>
                  {data.counts.musiciansNeedingMatching} musician
                  {data.counts.musiciansNeedingMatching === 1 ? '' : 's'} need a Prime Team match.{' '}
                  <button className="tab-inline" onClick={() => onNavigate('team')}>
                    Open team matching
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="muted">Nothing pending.</p>
          )}
        </Card>
      </div>

      <Card title="Loop Prime automation capabilities">
        <table>
          <thead>
            <tr>
              <th>Capability</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.capabilities.map((capability) => (
              <tr key={capability.capability}>
                <td className="mono">{capability.capability}</td>
                <td>
                  <StatusBadge status={capability.supported} />
                </td>
                <td className="muted">{capability.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Recent errors and warnings">
        {data.recentErrors.length === 0 ? (
          <p className="muted">No errors recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Code</th>
                <th>Message</th>
                <th>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {data.recentErrors.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td className="mono">{item.code}</td>
                  <td>{item.message}</td>
                  <td>{item.resolvedAt ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
