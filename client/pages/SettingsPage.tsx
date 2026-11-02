import { useCallback, useEffect, useState } from 'react';
import type { ChurchSettings, PcoServiceType } from '../../src/shared/types';
import { api, type TeamRow } from '../api';
import { Button, Card, ErrorBanner, Field, Spinner, formatDateTime } from '../components';

export function SettingsPage() {
  const [settings, setSettings] = useState<ChurchSettings | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamWarning, setTeamWarning] = useState<string | null>(null);
  const [secretSource, setSecretSource] = useState<string>('missing');
  const [primeInitError, setPrimeInitError] = useState<string | null>(null);
  const [serviceTypeInput, setServiceTypeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.settings();
      setSettings(result.settings);
      setTeams(
        result.teams.map((team) => ({
          teamId: team.teamId,
          teamName: team.teamName,
          serviceTypeId: team.serviceTypeId,
          isWorshipTeam: team.isWorshipTeam,
          archived: false,
        })),
      );
      setSecretSource(result.secretSource);
      setPrimeInitError(result.primeInitError);
      setServiceTypeInput(result.settings.pcoServiceTypeIds.join(', '));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTeams = async () => {
    try {
      const result = await api.teams();
      setTeams(result.teams);
      setTeamWarning(result.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async (patch: Partial<ChurchSettings>) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveSettings(patch);
      setSettings(result.settings);
      setServiceTypeInput(result.settings.pcoServiceTypeIds.join(', '));
      setMessage('Settings saved.');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleTeam = async (team: TeamRow) => {
    try {
      await api.setWorshipTeam(team.teamId, !team.isWorshipTeam, team.teamName);
      setTeams((current) =>
        current.map((entry) => (entry.teamId === team.teamId ? { ...entry, isWorshipTeam: !entry.isWorshipTeam } : entry)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!settings) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Credentials stay in .env or the macOS Keychain — never in the database or the browser bundle.</p>
        </div>
        <Button onClick={() => void load()}>Reload</Button>
      </div>

      <ErrorBanner message={error} />
      {message ? <div className="banner banner-info">{message}</div> : null}
      {primeInitError ? <ErrorBanner message={`Loop automation: ${primeInitError}`} /> : null}

      <Card title="Planning Center credentials">
        <p style={{ marginTop: 0, fontSize: 13 }}>
          Secret source: <strong>{secretSource}</strong>. Add <span className="mono">PCO_APP_ID</span> and{' '}
          <span className="mono">PCO_SECRET</span> to <span className="mono">.env</span> (or the macOS Keychain) and restart
          the server. They are never stored in SQLite.
        </p>
        <Field label="PCO application id (optional, display only)" hint="Not a secret; the matching secret must be in .env.">
          <input
            type="text"
            value={settings.pcoAppId ?? ''}
            onChange={(event) => setSettings({ ...settings, pcoAppId: event.target.value })}
            placeholder="e.g. 6f1c8f9a…"
          />
        </Field>
        <Field
          label="Service type IDs"
          hint="Comma-separated Planning Center service type ids (Services → service type URL). Used to fetch plans and teams."
        >
          <input
            type="text"
            value={serviceTypeInput}
            onChange={(event) => setServiceTypeInput(event.target.value)}
            placeholder="123456, 789012"
          />
        </Field>
        <div className="actions">
          <Button
            variant="primary"
            disabled={saving}
            onClick={() =>
              void save({
                pcoAppId: settings.pcoAppId?.trim() ? settings.pcoAppId.trim() : null,
                pcoServiceTypeIds: serviceTypeInput
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          >
            Save Planning Center settings
          </Button>
          <Button onClick={() => void loadTeams()}>Load teams from Planning Center</Button>
        </div>
      </Card>

      <Card title="Worship teams">
        <p style={{ marginTop: 0, fontSize: 13 }}>
          Only musicians scheduled on these teams are shared with. Production, audio, camera and livestream teams must stay
          unselected.
        </p>
        {teamWarning ? <div className="banner banner-info">{teamWarning}</div> : null}
        {teams.length === 0 ? (
          <p className="muted">No teams loaded yet. Configure service types, then load teams.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Team id</th>
                <th>Worship team</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.teamId}>
                  <td>{team.teamName}</td>
                  <td className="mono">{team.teamId}</td>
                  <td>
                    <label className="checkbox">
                      <input type="checkbox" checked={team.isWorshipTeam} onChange={() => void toggleTeam(team)} />
                      {team.isWorshipTeam ? 'included' : 'excluded'}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Loop Community Prime">
        <Field label="Prime base URL" hint="Used by the browser automation. Verify with `npm run prime:explore`.">
          <input
            type="url"
            value={settings.primeBaseUrl}
            onChange={(event) => setSettings({ ...settings, primeBaseUrl: event.target.value })}
          />
        </Field>
        <Field label="Browser profile directory" hint="Git-ignored. Contains the Loop login session — treat as a password.">
          <input
            type="text"
            value={settings.primeProfileDir}
            onChange={(event) => setSettings({ ...settings, primeProfileDir: event.target.value })}
          />
        </Field>
        <label className="checkbox" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={settings.primeHeadless}
            onChange={(event) => setSettings({ ...settings, primeHeadless: event.target.checked })}
          />
          Run Chromium headless (leave off until the workflow is verified)
        </label>
        <Button
          variant="primary"
          disabled={saving}
          onClick={() =>
            void save({
              primeBaseUrl: settings.primeBaseUrl,
              primeProfileDir: settings.primeProfileDir,
              primeHeadless: settings.primeHeadless,
            })
          }
        >
          Save Loop settings
        </Button>
      </Card>

      <Card title="Daily schedule">
        <div className="grid grid-2">
          <Field label="Sync hour (0-23)">
            <input
              type="number"
              min={0}
              max={23}
              value={settings.syncHour}
              onChange={(event) => setSettings({ ...settings, syncHour: Number(event.target.value) })}
            />
          </Field>
          <Field label="Sync minute (0-59)">
            <input
              type="number"
              min={0}
              max={59}
              value={settings.syncMinute}
              onChange={(event) => setSettings({ ...settings, syncMinute: Number(event.target.value) })}
            />
          </Field>
          <Field label="Timezone" hint="IANA name; America/New_York handles daylight saving automatically.">
            <input
              type="text"
              value={settings.timezone}
              onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
            />
          </Field>
          <Field label="Future days to synchronize" hint="Default 21 days.">
            <input
              type="number"
              min={1}
              max={120}
              value={settings.windowDays}
              onChange={(event) => setSettings({ ...settings, windowDays: Number(event.target.value) })}
            />
          </Field>
        </div>
        <label className="checkbox" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={settings.autoSyncEnabled}
            onChange={(event) => setSettings({ ...settings, autoSyncEnabled: event.target.checked })}
          />
          Enable automatic daily synchronization
        </label>
        <Button
          variant="primary"
          disabled={saving}
          onClick={() =>
            void save({
              syncHour: settings.syncHour,
              syncMinute: settings.syncMinute,
              timezone: settings.timezone,
              windowDays: settings.windowDays,
              autoSyncEnabled: settings.autoSyncEnabled,
            })
          }
        >
          Save schedule
        </Button>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          The in-process scheduler works while this server is running. For unattended daily runs install the launchd agent
          (see docs/SETUP.md) so the job still fires when the dashboard is closed.
        </p>
      </Card>

      <Card title="About">
        <table>
          <tbody>
            <tr>
              <th>Settings created</th>
              <td>{formatDateTime(settings.createdAt)}</td>
            </tr>
            <tr>
              <th>Last updated</th>
              <td>{formatDateTime(settings.updatedAt)}</td>
            </tr>
            <tr>
              <th>Worship team ids</th>
              <td className="mono">{settings.pcoTeamIds.join(', ') || '—'}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// Kept local to avoid importing PCO types into the settings page bundle.
export type { PcoServiceType };
