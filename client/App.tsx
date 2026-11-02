import { useState } from 'react';
import { OverviewPage } from './pages/Overview';
import { PlansPage } from './pages/Plans';
import { SongMatchingPage } from './pages/SongMatching';
import { TeamMatchingPage } from './pages/TeamMatching';
import { SyncPage } from './pages/SyncPage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'overview' | 'plans' | 'songs' | 'team' | 'sync' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'plans', label: 'Service plans' },
  { id: 'songs', label: 'Song matching' },
  { id: 'team', label: 'Team matching' },
  { id: 'sync', label: 'Synchronization' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PCO</span>
          <div>
            <strong>Prime Sync</strong>
            <small>Planning Center → Loop Prime</small>
          </div>
        </div>
        <nav>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={item.id === tab ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <footer className="sidebar-footer">
          <p>Local-only app. Loop changes run through the visible website.</p>
        </footer>
      </aside>
      <main className="content">
        {tab === 'overview' && <OverviewPage onNavigate={setTab} />}
        {tab === 'plans' && <PlansPage />}
        {tab === 'songs' && <SongMatchingPage />}
        {tab === 'team' && <TeamMatchingPage />}
        {tab === 'sync' && <SyncPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
