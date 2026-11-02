import { useState } from 'react';
import { OverviewPage } from './pages/Overview';
import { ReviewPage } from './pages/ReviewPage';
import { SyncPage } from './pages/SyncPage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'home' | 'review' | 'sync' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'review', label: 'Review' },
  { id: 'sync', label: 'Sync' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('home');

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
          <p>Runs on this machine. Loop is only changed through its visible website.</p>
        </footer>
      </aside>
      <main className="content">
        {tab === 'home' && <OverviewPage onNavigate={setTab} />}
        {tab === 'review' && <ReviewPage />}
        {tab === 'sync' && <SyncPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
