import { useState } from 'react';
import { PlansPage } from './Plans';
import { SongMatchingPage } from './SongMatching';
import { TeamMatchingPage } from './TeamMatching';

type Section = 'plans' | 'songs' | 'team';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'plans', label: 'Plans' },
  { id: 'songs', label: 'Songs' },
  { id: 'team', label: 'Musicians' },
];

/**
 * One place for everything that needs a human decision before a sync runs.
 * The individual screens are unchanged; they are grouped so the sidebar stays
 * short and the first thing you see is not a wall of tables.
 */
export function ReviewPage() {
  const [section, setSection] = useState<Section>('plans');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Review</h1>
          <p>Plans imported from Planning Center and the matches that need your confirmation.</p>
        </div>
      </div>
      <div className="segmented" role="tablist" aria-label="Review sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={item.id === section}
            className={item.id === section ? 'active' : ''}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === 'plans' ? <PlansPage /> : null}
      {section === 'songs' ? <SongMatchingPage /> : null}
      {section === 'team' ? <TeamMatchingPage /> : null}
    </div>
  );
}
