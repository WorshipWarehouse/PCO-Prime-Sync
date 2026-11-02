import type {
  ChurchSettings,
  OverviewPayload,
  PcoServiceType,
  PcoTeamConfiguration,
  PlanMusicianRecord,
  PlanSongRecord,
  PrimeCapabilityReport,
  PrimeSessionStatus,
  PrimeTeamMember,
  PrimeTrack,
  ScheduleInfo,
  ServicePlanRecord,
  SongMapping,
  SyncChangeRecord,
  SyncErrorRecord,
  SyncHistoryRecord,
  SyncPreview,
  SyncRunResult,
  TeamMemberMapping,
  PrimeSetlistRecord,
} from '../src/shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('x-pco-prime-sync', '1');
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export interface PlanDetail extends ServicePlanRecord {
  songs: PlanSongRecord[];
  musicians: PlanMusicianRecord[];
  setlist: {
    primeSetlistId: string;
    primeSetlistName: string;
    primeUrl: string | null;
    lastVerifiedAt: string | null;
    trackCount: number;
    shareCount: number;
  } | null;
}

export interface UnmatchedSongRow extends PlanSongRecord {
  pcoPlanId: string;
  planDate: string;
  planTitle: string;
}

export interface UnmatchedMusicianRow extends PlanMusicianRecord {
  pcoPlanId: string;
  planDate: string;
  planTitle: string;
}

export interface DistinctMusicianRow {
  emailNormalized: string | null;
  emailRaw: string | null;
  pcoPersonId: string;
  pcoName: string;
  matchStatus: string;
  primeMemberId: string | null;
  primeMemberName: string | null;
  planCount: number;
}

export interface TeamRow {
  teamId: string;
  teamName: string;
  serviceTypeId: string | null;
  isWorshipTeam: boolean;
  archived: boolean;
}

export interface SyncJobStatus {
  status: 'idle' | 'running' | 'finished';
  mode: 'sync' | 'dry_run' | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: SyncRunResult | null;
  error: string | null;
}

export const api = {
  overview: () => request<OverviewPayload>('/api/overview'),
  settings: () =>
    request<{ settings: ChurchSettings; teams: PcoTeamConfiguration[]; secretSource: string; primeInitError: string | null }>(
      '/api/settings',
    ),
  saveSettings: (patch: Partial<ChurchSettings>) =>
    request<{ settings: ChurchSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  testPcoCredentials: (input: { appId: string; secret: string }) =>
    request<{ ok: boolean; message: string; serviceTypes: PcoServiceType[] }>('/api/pco/credentials/test', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  savePcoCredentials: (input: { appId: string; secret: string }) =>
    request<{
      ok: boolean;
      message: string;
      serviceTypes: PcoServiceType[];
      saved: boolean;
      envFile: string;
      secretSource: string;
    }>('/api/pco/credentials', { method: 'POST', body: JSON.stringify(input) }),
  plans: () => request<{ plans: PlanDetail[]; windowDays: number; today: string; toDate: string }>('/api/plans'),
  teams: () => request<{ teams: TeamRow[]; warning: string | null }>('/api/pco/teams'),
  setWorshipTeam: (teamId: string, isWorshipTeam: boolean, teamName?: string) =>
    request<{ ok: boolean; worshipTeamIds: string[] }>('/api/pco/teams/worship', {
      method: 'POST',
      body: JSON.stringify({ teamId, isWorshipTeam, teamName }),
    }),
  unmatchedSongs: () => request<{ songs: UnmatchedSongRow[] }>('/api/songs/needs-mapping'),
  songMappings: () => request<{ mappings: SongMapping[] }>('/api/songs/mappings'),
  searchTracks: (query: string) =>
    request<{ query: string; tracks: Array<PrimeTrack & { exactNameMatch: boolean }> }>(
      `/api/songs/search?q=${encodeURIComponent(query)}`,
    ),
  saveSongMapping: (input: {
    pcoSongTitle: string;
    pcoSongId?: string | null;
    primeTrackId: string;
    primeTrackName: string;
    primeArrangementId?: string | null;
    primeArrangementName?: string | null;
  }) =>
    request<{ mapping: SongMapping; plansUpdated: number }>('/api/songs/mappings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteSongMapping: (id: number) =>
    request<{ ok: boolean }>(`/api/songs/mappings/${id}`, { method: 'DELETE' }),
  musiciansNeedingMapping: () =>
    request<{ musicians: UnmatchedMusicianRow[]; distinct: DistinctMusicianRow[] }>('/api/team/needs-mapping'),
  memberMappings: () => request<{ mappings: TeamMemberMapping[] }>('/api/team/mappings'),
  primeMembers: () => request<{ members: PrimeTeamMember[] }>('/api/team/prime-members'),
  saveMemberMapping: (input: {
    normalizedEmail: string;
    primeMemberId: string;
    primeMemberName: string;
    pcoPersonId?: string | null;
    pcoName?: string | null;
  }) =>
    request<{ mapping: TeamMemberMapping; plansUpdated: number }>('/api/team/mappings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteMemberMapping: (id: number) =>
    request<{ ok: boolean }>(`/api/team/mappings/${id}`, { method: 'DELETE' }),
  preview: () => request<SyncPreview>('/api/sync/preview'),
  runSync: (mode: 'sync' | 'dry_run') =>
    request<{ started: boolean; message: string; job: SyncJobStatus }>('/api/sync/run', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  syncStatus: () => request<SyncJobStatus>('/api/sync/status'),
  history: () => request<{ runs: SyncHistoryRecord[] }>('/api/sync/history'),
  historyDetail: (id: number) => request<{ run: SyncHistoryRecord; changes: SyncChangeRecord[] }>(`/api/sync/history/${id}`),
  errors: () => request<{ errors: SyncErrorRecord[] }>('/api/sync/errors'),
  resolveError: (id: number) => request<{ ok: boolean }>(`/api/sync/errors/${id}/resolve`, { method: 'POST' }),
  schedule: () => request<ScheduleInfo>('/api/schedule'),
  primeStatus: () => request<PrimeSessionStatus>('/api/prime/status'),
  capabilities: () =>
    request<{ capabilities: PrimeCapabilityReport[]; automation: string; ready: boolean }>('/api/prime/capabilities'),
  openLogin: () => request<{ ok: boolean; message: string }>('/api/prime/open-login', { method: 'POST' }),
  setlistRecord: (pcoPlanId: string) =>
    request<{ setlist: PrimeSetlistRecord | null }>(`/api/plans/${encodeURIComponent(pcoPlanId)}`),
};
