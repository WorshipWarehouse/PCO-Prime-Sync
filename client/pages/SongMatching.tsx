import { useCallback, useEffect, useState } from 'react';
import type { SongMapping } from '../../src/shared/types';
import { api, type UnmatchedSongRow } from '../api';
import { Badge, Button, Card, EmptyState, ErrorBanner, Spinner, StatusBadge, formatDate } from '../components';

interface TrackResult {
  id: string;
  title: string;
  subtitle: string | null;
  exactNameMatch: boolean;
}

export function SongMatchingPage() {
  const [songs, setSongs] = useState<UnmatchedSongRow[] | null>(null);
  const [mappings, setMappings] = useState<SongMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const [needs, saved] = await Promise.all([api.unmatchedSongs(), api.songMappings()]);
      setSongs(needs.songs);
      setMappings(saved.mappings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uniqueTitles = new Map<string, UnmatchedSongRow>();
  for (const song of songs ?? []) {
    if (!uniqueTitles.has(song.normalizedTitle)) uniqueTitles.set(song.normalizedTitle, song);
  }

  const search = async (title: string) => {
    setActiveTitle(title);
    setQuery(title);
    setResults(null);
    await runSearch(title);
  };

  const runSearch = async (text: string) => {
    if (text.trim().length < 2) return;
    setSearching(true);
    try {
      const result = await api.searchTracks(text);
      setResults(result.tracks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const saveMapping = async (song: UnmatchedSongRow, track: TrackResult) => {
    try {
      const result = await api.saveSongMapping({
        pcoSongTitle: song.title,
        pcoSongId: song.pcoSongId,
        primeTrackId: track.id,
        primeTrackName: track.title,
      });
      setMessage(`Mapped "${song.title}" → "${track.title}". ${result.plansUpdated} plan row(s) updated. Run a preview to apply it to Loop.`);
      setActiveTitle(null);
      setResults(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeMapping = async (id: number) => {
    try {
      await api.deleteSongMapping(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Song matching</h1>
          <p>
            Planning Center song name → Loop Prime multitrack. Matching is punctuation- and case-insensitive; ambiguous
            matches always need your decision.
          </p>
        </div>
        <Button onClick={() => void load()}>Reload</Button>
      </div>

      <ErrorBanner message={error} />
      {message ? <div className="banner banner-info">{message}</div> : null}

      <Card title="Songs needing a match">
        {!songs ? (
          <Spinner />
        ) : uniqueTitles.size === 0 ? (
          <EmptyState>Every song in the current window is matched.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>PCO song</th>
                <th>Plan</th>
                <th>Key</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...uniqueTitles.values()].map((song) => (
                <tr key={song.normalizedTitle}>
                  <td>{song.title}</td>
                  <td>
                    {song.planTitle} · {formatDate(song.planDate)}
                  </td>
                  <td>{song.keyName ?? '—'}</td>
                  <td>
                    <StatusBadge status={song.matchStatus} />
                  </td>
                  <td>
                    <Button onClick={() => void search(song.title)}>Search Loop</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {activeTitle ? (
        <Card title={`Search Loop multitracks for “${activeTitle}”`} actions={<Button onClick={() => setActiveTitle(null)}>Close</Button>}>
          <div className="actions" style={{ marginBottom: 12 }}>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch(query);
              }}
              placeholder="Search multitrack names"
              style={{ minWidth: 280 }}
            />
            <Button onClick={() => void runSearch(query)} disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
          {results === null ? (
            <p className="muted">Search the Loop account to see which multitracks are available.</p>
          ) : results.length === 0 ? (
            <EmptyState>
              No multitracks returned. Loop only offers tracks already owned by this account — this app never purchases
              tracks.
            </EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Id</th>
                  <th>Name match</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((track) => (
                  <tr key={track.id}>
                    <td>{track.title}</td>
                    <td className="mono">{track.id}</td>
                    <td>
                      {track.exactNameMatch ? <Badge tone="ok">exact</Badge> : <Badge tone="warn">partial</Badge>}
                    </td>
                    <td>
                      <Button
                        variant="primary"
                        onClick={() => {
                          const song = [...uniqueTitles.values()].find((row) => row.title === activeTitle);
                          if (song) void saveMapping(song, track);
                        }}
                      >
                        Use this track
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      <Card title="Saved mappings">
        {mappings.length === 0 ? (
          <EmptyState>No mappings saved yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>PCO song</th>
                <th>Prime multitrack</th>
                <th>Track id</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>{mapping.pcoSongTitle}</td>
                  <td>{mapping.primeTrackName}</td>
                  <td className="mono">{mapping.primeTrackId}</td>
                  <td>{mapping.source}</td>
                  <td>
                    <Button variant="danger" onClick={() => void removeMapping(mapping.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
