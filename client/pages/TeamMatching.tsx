import { useCallback, useEffect, useState } from 'react';
import type { PrimeTeamMember, TeamMemberMapping } from '../../src/shared/types';
import { api, type DistinctMusicianRow } from '../api';
import { Button, Card, EmptyState, ErrorBanner, Spinner, StatusBadge } from '../components';

export function TeamMatchingPage() {
  const [musicians, setMusicians] = useState<DistinctMusicianRow[]>([]);
  const [mappings, setMappings] = useState<TeamMemberMapping[]>([]);
  const [members, setMembers] = useState<PrimeTeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [needs, saved] = await Promise.all([api.musiciansNeedingMapping(), api.memberMappings()]);
      setMusicians(needs.distinct.filter((row) => row.matchStatus !== 'matched'));
      setMappings(saved.mappings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMembers = async () => {
    try {
      const result = await api.primeMembers();
      setMembers(result.members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async (musician: DistinctMusicianRow) => {
    const memberId = selected[musician.pcoPersonId];
    const member = members?.find((candidate) => candidate.id === memberId);
    if (!member || !musician.emailNormalized) return;
    try {
      const result = await api.saveMemberMapping({
        normalizedEmail: musician.emailNormalized,
        primeMemberId: member.id,
        primeMemberName: member.name,
        pcoPersonId: musician.pcoPersonId,
        pcoName: musician.pcoName,
      });
      setNotice(`Mapped ${musician.pcoName} → ${member.name}. ${result.plansUpdated} plan row(s) updated.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team matching</h1>
          <p>
            Email addresses are the only matching key. Ambiguous or missing emails are never guessed, and no new Prime Team
            members are ever invited.
          </p>
        </div>
        <div className="actions">
          <Button onClick={() => void load()}>Reload</Button>
          <Button variant="primary" onClick={() => void loadMembers()}>
            {members ? 'Reload Prime members' : 'Load Prime members'}
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice ? <div className="banner banner-info">{notice}</div> : null}

      <Card title="Scheduled musicians needing a Prime match">
        {loading ? (
          <Spinner />
        ) : musicians.length === 0 ? (
          <EmptyState>Every scheduled worship musician is matched.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Musician</th>
                <th>Email</th>
                <th>Plans</th>
                <th>Status</th>
                <th>Prime member</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {musicians.map((musician) => (
                <tr key={musician.pcoPersonId}>
                  <td>{musician.pcoName}</td>
                  <td>{musician.emailRaw ?? <span className="muted">no email</span>}</td>
                  <td>{musician.planCount}</td>
                  <td>
                    <StatusBadge status={musician.matchStatus} />
                  </td>
                  <td>
                    <select
                      value={selected[musician.pcoPersonId] ?? ''}
                      onChange={(event) =>
                        setSelected((current) => ({ ...current, [musician.pcoPersonId]: event.target.value }))
                      }
                      disabled={!members}
                    >
                      <option value="">{members ? 'Choose a member…' : 'Load Prime members first'}</option>
                      {(members ?? [])
                        .filter((member) => member.email === musician.emailNormalized)
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} ({member.email})
                          </option>
                        ))}
                      {(members ?? [])
                        .filter((member) => member.email !== musician.emailNormalized)
                        .map((member) => (
                          <option key={`other-${member.id}`} value={member.id}>
                            {member.name} ({member.email})
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <Button
                      variant="primary"
                      disabled={!selected[musician.pcoPersonId]}
                      onClick={() => void save(musician)}
                    >
                      Save mapping
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Saved member mappings">
        {mappings.length === 0 ? (
          <EmptyState>No member mappings saved yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>PCO name</th>
                <th>Email</th>
                <th>Prime member</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>{mapping.pcoName ?? '—'}</td>
                  <td>{mapping.normalizedEmail}</td>
                  <td>{mapping.primeMemberName}</td>
                  <td>{mapping.source}</td>
                  <td>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        await api.deleteMemberMapping(mapping.id).catch((err: unknown) =>
                          setError(err instanceof Error ? err.message : String(err)),
                        );
                        await load();
                      }}
                    >
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
