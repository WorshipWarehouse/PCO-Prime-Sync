import { useCallback, useEffect, useState } from 'react';
import type { OverviewPayload } from '../../src/shared/types';
import { api } from '../api';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  ExternalLink,
  Notice,
  Spinner,
  StatusBadge,
  formatDateTime,
} from '../components';

const LOOP_LOGIN_URL = 'https://auth.worshiptools.com/login';

type Tab = 'home' | 'review' | 'sync' | 'settings';

/**
 * The home screen answers one question: what do I need to do next?
 * Everything that is not a next step lives behind "Technical details".
 */
export function OverviewPage({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string>(LOOP_LOGIN_URL);
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
      if (result.loginUrl) setLoginUrl(result.loginUrl);
      setMessage(result.message);
      setTimeout(() => void load(), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;

  const pcoReady = data.pco.configured && data.pco.ok;
  const loopReady = data.prime.state === 'authenticated';
  const hasServiceTypes = (data.pco.serviceTypeCount ?? 0) > 0;
  const songsChecked = data.counts.matchedSongs > 0 && data.counts.unmatchedSongs === 0;

  const steps: Array<{ label: string; done: boolean; hint: string; action: string; run: () => void }> = [
    {
      label: 'Add your Planning Center token',
      done: pcoReady,
      hint: pcoReady ? `${data.pco.serviceTypeCount ?? 0} service types visible` : data.pco.message,
      action: 'Open settings',
      run: () => onNavigate('settings'),
    },
    {
      label: 'Choose service types and worship teams',
      done: hasServiceTypes,
      hint: hasServiceTypes ? 'Plans will be read from these service types' : 'Nothing selected yet',
      action: 'Choose',
      run: () => onNavigate('settings'),
    },
    {
      label: 'Log in to Loop Community',
      done: loopReady,
      hint: loopReady ? 'Session saved in the persistent profile' : `Signs in at ${loginUrl.replace(/^https?:\/\//, '')}`,
      action: busy ? 'Opening…' : 'Log in',
      run: () => void openLogin(),
    },
    {
      label: 'Review song matches',
      done: songsChecked,
      hint: songsChecked
        ? `${data.counts.matchedSongs} songs matched`
        : `${data.counts.unmatchedSongs} of ${data.counts.unmatchedSongs + data.counts.matchedSongs} songs still need a multitrack`,
      action: 'Review',
      run: () => onNavigate('review'),
    },
    {
      label: 'Review musician matches',
      done: data.counts.musiciansNeedingMatching === 0,
      hint:
        data.counts.musiciansNeedingMatching === 0
          ? 'No musicians waiting for a match'
          : `${data.counts.musiciansNeedingMatching} musicians need a Prime Team match`,
      action: 'Review',
      run: () => onNavigate('review'),
    },
  ];

  const nextStep = steps.find((step) => !step.done);
  const primaryLabel = !pcoReady
    ? 'Add Planning Center token'
    : !loopReady
      ? 'Log in to Loop'
      : data.counts.pendingChanges > 0
        ? 'Preview pending changes'
        : 'Open sync';
  const runPrimary = () => {
    if (!pcoReady) return onNavigate('settings');
    if (!loopReady) return void openLogin();
    onNavigate('sync');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>PCO Prime Sync</h1>
          <p>
            {nextStep
              ? `Next: ${nextStep.label.toLowerCase()}.`
              : 'Everything is set up. A sync runs once a day, or whenever you press Sync.'}
          </p>
        </div>
        <div className="actions">
          <Button onClick={() => void load()}>Refresh</Button>
          <Button variant="primary" onClick={runPrimary} disabled={busy}>
            {primaryLabel}
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {message ? <Notice>{message}</Notice> : null}

      <div className="status-list">
        <div className="status-row">
          <div className="status-main">
            <div className="status-title">Planning Center</div>
            <div className="status-note">
              {pcoReady ? `${data.pco.serviceTypeCount ?? 0} service types · key source ${data.pco.secretSource}` : data.pco.message}
            </div>
          </div>
          <Badge tone={pcoReady ? 'ok' : data.pco.configured ? 'bad' : 'warn'}>
            {pcoReady ? 'connected' : data.pco.configured ? 'error' : 'not set up'}
          </Badge>
          <button className="tab-inline" onClick={() => onNavigate('settings')}>
            Settings
          </button>
        </div>

        <div className="status-row">
          <div className="status-main">
            <div className="status-title">Loop Community</div>
            <div className="status-note">
              {loopReady ? 'Signed in' : <>Signs in at <ExternalLink href={loginUrl}>{loginUrl.replace(/^https?:\/\//, '')}</ExternalLink></>}
            </div>
          </div>
          <StatusBadge status={data.prime.state} />
          <Button onClick={() => void openLogin()} disabled={busy}>
            {busy ? 'Opening…' : 'Log in'}
          </Button>
        </div>

        <div className="status-row">
          <div className="status-main">
            <div className="status-title">Automatic sync</div>
            <div className="status-note">
              {data.schedule.enabled
                ? `Daily at ${data.schedule.timeLabel} ${data.schedule.timezone} · next ${formatDateTime(data.schedule.nextRunAt)}`
                : 'Daily sync is turned off'}
            </div>
          </div>
          <Badge tone={data.schedule.enabled ? 'ok' : 'muted'}>{data.schedule.enabled ? 'scheduled' : 'off'}</Badge>
          <button className="tab-inline" onClick={() => onNavigate('sync')}>
            Sync
          </button>
        </div>
      </div>

      <Card title="Next steps">
        <ul className="steps">
          {steps.map((step) => (
            <li key={step.label} className={step.done ? 'step done' : 'step'}>
              <span className="step-mark" aria-hidden="true">
                {step.done ? '✓' : ''}
              </span>
              <div className="step-label">
                <div>{step.label}</div>
                <div className="status-note">{step.hint}</div>
              </div>
              {step.done ? null : (
                <button className="tab-inline" onClick={step.run}>
                  {step.action}
                </button>
              )}
            </li>
          ))}
        </ul>
        {data.counts.pendingChanges > 0 ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            {data.counts.pendingChanges} change{data.counts.pendingChanges === 1 ? '' : 's'} waiting for the next sync.
          </p>
        ) : null}
      </Card>

      <details className="panel">
        <summary>Technical details</summary>
        <div style={{ marginTop: 12 }}>
          <Card title="Loop automation capabilities">
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

          <Card title="Last run and schedule">
            <table>
              <tbody>
                <tr>
                  <th>Last successful sync</th>
                  <td>{data.lastSuccessfulSync ? formatDateTime(data.lastSuccessfulSync.finishedAt) : 'never'}</td>
                </tr>
                <tr>
                  <th>Next scheduled run</th>
                  <td>{data.schedule.enabled ? formatDateTime(data.schedule.nextRunAt) : 'automatic sync disabled'}</td>
                </tr>
                <tr>
                  <th>launchd agent</th>
                  <td>{data.schedule.launchdInstalled ? 'installed' : 'not installed'}</td>
                </tr>
                <tr>
                  <th>Prime profile</th>
                  <td className="mono">{data.prime.profileDir}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Recent errors and warnings">
            {data.recentErrors.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No errors recorded.
              </p>
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
      </details>
    </div>
  );
}
