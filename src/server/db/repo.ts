import type { Db } from './index';
import type {
  ChangeStatus,
  ChangeType,
  ChurchSettings,
  IsoDateTime,
  MemberMatchStatus,
  PcoTeamConfiguration,
  PlanMusicianRecord,
  PlanSongRecord,
  PlanSyncStatus,
  PrimeSetlistRecord,
  PrimeStateSnapshot,
  ServicePlanRecord,
  SongMapping,
  SongMatchStatus,
  SyncChangeRecord,
  SyncErrorRecord,
  SyncHistoryRecord,
  SyncMode,
  SyncRunStatus,
  SyncTrigger,
  TeamMemberMapping,
  ArrangementChoice,
} from '../../shared/types';
import { normalizeSongName } from '../../shared/naming';

const nowIso = (): IsoDateTime => new Date().toISOString();

/* eslint-disable @typescript-eslint/no-explicit-any */
const rowToSettings = (row: any): ChurchSettings => ({
  pcoAppId: row.pco_app_id ?? null,
  pcoServiceTypeIds: JSON.parse(row.pco_service_type_ids ?? '[]') as string[],
  pcoTeamIds: JSON.parse(row.pco_team_ids ?? '[]') as string[],
  primeBaseUrl: row.prime_base_url,
  primeProfileDir: row.prime_profile_dir,
  primeHeadless: Boolean(row.prime_headless),
  syncHour: Number(row.sync_hour),
  syncMinute: Number(row.sync_minute),
  timezone: row.timezone,
  windowDays: Number(row.window_days),
  autoSyncEnabled: Boolean(row.auto_sync_enabled),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapPlan = (row: any): ServicePlanRecord => ({
  id: row.id,
  pcoPlanId: row.pco_plan_id,
  serviceTypeId: row.service_type_id,
  title: row.title,
  seriesTitle: row.series_title ?? null,
  sortDate: row.sort_date ?? null,
  planDate: row.plan_date,
  status: row.status as PlanSyncStatus,
  lastSyncedAt: row.last_synced_at ?? null,
  pcoUpdatedAt: row.pco_updated_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapSong = (row: any): PlanSongRecord => ({
  id: row.id,
  planId: row.plan_id,
  pcoItemId: row.pco_item_id,
  pcoSongId: row.pco_song_id ?? null,
  position: Number(row.position),
  title: row.title,
  normalizedTitle: row.normalized_title,
  arrangementSelected: row.arrangement_selected as ArrangementChoice,
  arrangementPcoId: row.arrangement_pco_id ?? null,
  arrangementPcoName: row.arrangement_pco_name ?? null,
  keyName: row.key_name ?? null,
  bpm: row.bpm === null || row.bpm === undefined ? null : Number(row.bpm),
  matchStatus: row.match_status as SongMatchStatus,
  songMappingId: row.song_mapping_id ?? null,
  primeTrackId: row.prime_track_id ?? null,
  primeTrackName: row.prime_track_name ?? null,
  primeSetlistTrackId: row.prime_setlist_track_id ?? null,
  primeAppliedKey: row.prime_applied_key ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMusician = (row: any): PlanMusicianRecord => ({
  id: row.id,
  planId: row.plan_id,
  pcoPersonId: row.pco_person_id,
  pcoName: row.pco_name,
  emailNormalized: row.email_normalized ?? null,
  emailRaw: row.email_raw ?? null,
  teamId: row.team_id ?? null,
  teamName: row.team_name ?? null,
  matchStatus: row.match_status as MemberMatchStatus,
  teamMemberMappingId: row.team_member_mapping_id ?? null,
  primeMemberId: row.prime_member_id ?? null,
  primeMemberName: row.prime_member_name ?? null,
  shared: Boolean(row.shared),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapSongMapping = (row: any): SongMapping => ({
  id: row.id,
  normalizedName: row.normalized_name,
  pcoSongId: row.pco_song_id ?? null,
  pcoSongTitle: row.pco_song_title,
  primeTrackId: row.prime_track_id,
  primeTrackName: row.prime_track_name,
  primeArrangementId: row.prime_arrangement_id ?? null,
  primeArrangementName: row.prime_arrangement_name ?? null,
  confirmed: Boolean(row.confirmed),
  source: row.source as 'auto' | 'manual',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMemberMapping = (row: any): TeamMemberMapping => ({
  id: row.id,
  normalizedEmail: row.normalized_email,
  pcoPersonId: row.pco_person_id ?? null,
  pcoName: row.pco_name ?? null,
  primeMemberId: row.prime_member_id,
  primeMemberName: row.prime_member_name,
  status: row.status as MemberMatchStatus,
  source: row.source as 'auto' | 'manual',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapHistory = (row: any): SyncHistoryRecord => ({
  id: row.id,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? null,
  mode: row.mode as SyncMode,
  trigger: row.trigger as SyncTrigger,
  status: row.status as SyncRunStatus,
  plansProcessed: Number(row.plans_processed),
  changesApplied: Number(row.changes_applied),
  errorsCount: Number(row.errors_count),
  summary: row.summary ?? null,
});

const mapChange = (row: any): SyncChangeRecord => ({
  id: row.id,
  syncRunId: row.sync_run_id,
  pcoPlanId: row.pco_plan_id ?? null,
  changeType: row.change_type as ChangeType,
  description: row.description,
  status: row.status as ChangeStatus,
  detail: row.detail ?? null,
  createdAt: row.created_at,
});

const mapError = (row: any): SyncErrorRecord => ({
  id: row.id,
  syncRunId: row.sync_run_id ?? null,
  pcoPlanId: row.pco_plan_id ?? null,
  scope: row.scope,
  code: row.code,
  message: row.message,
  detail: row.detail ?? null,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at ?? null,
});

export interface PlanUpsertInput {
  pcoPlanId: string;
  serviceTypeId: string;
  title: string;
  seriesTitle: string | null;
  sortDate: IsoDateTime | null;
  planDate: string;
  pcoUpdatedAt: IsoDateTime | null;
}

export interface PlanSongInput {
  pcoItemId: string;
  pcoSongId: string | null;
  position: number;
  title: string;
  arrangementSelected: ArrangementChoice;
  arrangementPcoId: string | null;
  arrangementPcoName: string | null;
  keyName: string | null;
  bpm: number | null;
  matchStatus: SongMatchStatus;
  songMappingId: number | null;
  primeTrackId: string | null;
  primeTrackName: string | null;
}

export interface PlanMusicianInput {
  pcoPersonId: string;
  pcoName: string;
  emailNormalized: string | null;
  emailRaw: string | null;
  teamId: string | null;
  teamName: string | null;
  matchStatus: MemberMatchStatus;
  teamMemberMappingId: number | null;
  primeMemberId: string | null;
  primeMemberName: string | null;
}

export interface SongMappingInput {
  pcoSongId: string | null;
  pcoSongTitle: string;
  primeTrackId: string;
  primeTrackName: string;
  primeArrangementId?: string | null;
  primeArrangementName?: string | null;
  confirmed?: boolean;
  source?: 'auto' | 'manual';
}

/** All persistent state access lives here so the sync engine stays testable. */
export class Repository {
  constructor(private readonly db: Db) {}

  get raw(): Db {
    return this.db;
  }

  // -- settings ------------------------------------------------------------
  getSettings(): ChurchSettings {
    const row = this.db.prepare('SELECT * FROM church_settings WHERE id = 1').get();
    if (!row) throw new Error('church_settings row missing; database not migrated');
    return rowToSettings(row);
  }

  updateSettings(patch: Partial<ChurchSettings>): ChurchSettings {
    const current = this.getSettings();
    const next: ChurchSettings = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE church_settings SET
          pco_app_id = ?, pco_service_type_ids = ?, pco_team_ids = ?, prime_base_url = ?,
          prime_profile_dir = ?, prime_headless = ?, sync_hour = ?, sync_minute = ?,
          timezone = ?, window_days = ?, auto_sync_enabled = ?, updated_at = ?
        WHERE id = 1`,
      )
      .run(
        next.pcoAppId,
        JSON.stringify(next.pcoServiceTypeIds),
        JSON.stringify(next.pcoTeamIds),
        next.primeBaseUrl,
        next.primeProfileDir,
        next.primeHeadless ? 1 : 0,
        next.syncHour,
        next.syncMinute,
        next.timezone,
        next.windowDays,
        next.autoSyncEnabled ? 1 : 0,
        next.updatedAt,
      );
    // Keep the denormalized worship-team id list in sync with the team table.
    this.syncWorshipTeamIds();
    return this.getSettings();
  }

  // -- team configuration --------------------------------------------------
  listTeamConfiguration(): PcoTeamConfiguration[] {
    const rows = this.db
      .prepare('SELECT * FROM pco_team_configuration ORDER BY team_name COLLATE NOCASE')
      .all() as any[];
    return rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      teamName: row.team_name,
      serviceTypeId: row.service_type_id ?? null,
      isWorshipTeam: Boolean(row.is_worship_team),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Insert/update known PCO teams, preserving existing worship flags. */
  upsertTeams(teams: Array<{ teamId: string; teamName: string; serviceTypeId: string | null }>): void {
    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO pco_team_configuration (team_id, team_name, service_type_id, is_worship_team, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT (team_id) DO UPDATE SET team_name = excluded.team_name,
         service_type_id = excluded.service_type_id, updated_at = excluded.updated_at`,
    );
    const tx = this.db.transaction(() => {
      for (const team of teams) stmt.run(team.teamId, team.teamName, team.serviceTypeId, now, now);
    });
    tx();
  }

  setWorshipTeam(teamId: string, isWorshipTeam: boolean): void {
    this.db
      .prepare('UPDATE pco_team_configuration SET is_worship_team = ?, updated_at = ? WHERE team_id = ?')
      .run(isWorshipTeam ? 1 : 0, nowIso(), teamId);
    this.syncWorshipTeamIds();
  }

  removeTeam(teamId: string): void {
    this.db.prepare('DELETE FROM pco_team_configuration WHERE team_id = ?').run(teamId);
    this.syncWorshipTeamIds();
  }

  /** Recompute `pco_team_ids` from the team table (single source of truth). */
  private syncWorshipTeamIds(): void {
    const rows = this.db
      .prepare('SELECT team_id FROM pco_team_configuration WHERE is_worship_team = 1 ORDER BY team_id')
      .all() as Array<{ team_id: string }>;
    const ids = rows.map((row) => row.team_id);
    this.db
      .prepare('UPDATE church_settings SET pco_team_ids = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(ids), nowIso());
  }

  /** Replace the explicit worship team id list (used by the settings API). */
  setWorshipTeamIds(ids: string[]): void {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const now = nowIso();
    const upsert = this.db.prepare(
      `INSERT INTO pco_team_configuration (team_id, team_name, service_type_id, is_worship_team, created_at, updated_at)
       VALUES (?, ?, NULL, 1, ?, ?)
       ON CONFLICT (team_id) DO UPDATE SET is_worship_team = 1, updated_at = excluded.updated_at`,
    );
    const clear = this.db.prepare('UPDATE pco_team_configuration SET is_worship_team = 0, updated_at = ?');
    const tx = this.db.transaction(() => {
      clear.run(now);
      for (const id of unique) upsert.run(id, `Team ${id}`, now, now);
    });
    tx();
    this.syncWorshipTeamIds();
  }

  getWorshipTeamIds(): string[] {
    const rows = this.db
      .prepare('SELECT team_id FROM pco_team_configuration WHERE is_worship_team = 1')
      .all() as Array<{ team_id: string }>;
    return rows.map((row) => row.team_id);
  }

  // -- service plans -------------------------------------------------------
  upsertPlan(input: PlanUpsertInput): ServicePlanRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO service_plans (pco_plan_id, service_type_id, title, series_title, sort_date,
           plan_date, status, pco_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'not_synced', ?, ?, ?)
         ON CONFLICT (pco_plan_id) DO UPDATE SET
           service_type_id = excluded.service_type_id,
           title = excluded.title,
           series_title = excluded.series_title,
           sort_date = excluded.sort_date,
           plan_date = excluded.plan_date,
           pco_updated_at = excluded.pco_updated_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.pcoPlanId,
        input.serviceTypeId,
        input.title,
        input.seriesTitle,
        input.sortDate,
        input.planDate,
        input.pcoUpdatedAt,
        now,
        now,
      );
    const plan = this.getPlanByPcoId(input.pcoPlanId);
    if (!plan) throw new Error(`Failed to persist plan ${input.pcoPlanId}`);
    return plan;
  }

  getPlanByPcoId(pcoPlanId: string): ServicePlanRecord | null {
    const row = this.db.prepare('SELECT * FROM service_plans WHERE pco_plan_id = ?').get(pcoPlanId);
    return row ? mapPlan(row) : null;
  }

  getPlanById(id: number): ServicePlanRecord | null {
    const row = this.db.prepare('SELECT * FROM service_plans WHERE id = ?').get(id);
    return row ? mapPlan(row) : null;
  }

  listPlans(): ServicePlanRecord[] {
    const rows = this.db.prepare('SELECT * FROM service_plans ORDER BY plan_date ASC, title ASC').all() as any[];
    return rows.map(mapPlan);
  }

  listPlansBetween(fromDate: string, toDate: string): ServicePlanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM service_plans WHERE plan_date >= ? AND plan_date <= ? ORDER BY plan_date ASC')
      .all(fromDate, toDate) as any[];
    return rows.map(mapPlan);
  }

  setPlanStatus(pcoPlanId: string, status: PlanSyncStatus, markSynced = false): void {
    const now = nowIso();
    if (markSynced) {
      this.db
        .prepare('UPDATE service_plans SET status = ?, last_synced_at = ?, updated_at = ? WHERE pco_plan_id = ?')
        .run(status, now, now, pcoPlanId);
    } else {
      this.db
        .prepare('UPDATE service_plans SET status = ?, updated_at = ? WHERE pco_plan_id = ?')
        .run(status, now, pcoPlanId);
    }
  }

  // -- plan songs ----------------------------------------------------------
  /**
   * Replace the song rows for a plan while preserving Prime-side tracking
   * columns (`prime_setlist_track_id`, `prime_applied_key`) for songs that are
   * still present. This is what makes change detection reliable.
   */
  replacePlanSongs(planDbId: number, songs: PlanSongInput[]): void {
    const now = nowIso();
    const existing = this.listPlanSongs(planDbId);
    const keep = new Set(songs.map((song) => song.pcoItemId));

    const insert = this.db.prepare(
      `INSERT INTO plan_songs (plan_id, pco_item_id, pco_song_id, position, title, normalized_title,
         arrangement_selected, arrangement_pco_id, arrangement_pco_name, key_name, bpm, match_status,
         song_mapping_id, prime_track_id, prime_track_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (plan_id, pco_item_id) DO UPDATE SET
         pco_song_id = excluded.pco_song_id,
         position = excluded.position,
         title = excluded.title,
         normalized_title = excluded.normalized_title,
         arrangement_selected = excluded.arrangement_selected,
         arrangement_pco_id = excluded.arrangement_pco_id,
         arrangement_pco_name = excluded.arrangement_pco_name,
         key_name = excluded.key_name,
         bpm = excluded.bpm,
         match_status = excluded.match_status,
         song_mapping_id = excluded.song_mapping_id,
         prime_track_id = excluded.prime_track_id,
         prime_track_name = excluded.prime_track_name,
         updated_at = excluded.updated_at`,
    );
    const remove = this.db.prepare('DELETE FROM plan_songs WHERE plan_id = ? AND pco_item_id = ?');

    const tx = this.db.transaction(() => {
      for (const song of songs) {
        insert.run(
          planDbId,
          song.pcoItemId,
          song.pcoSongId,
          song.position,
          song.title,
          normalizeSongName(song.title),
          song.arrangementSelected,
          song.arrangementPcoId,
          song.arrangementPcoName,
          song.keyName,
          song.bpm,
          song.matchStatus,
          song.songMappingId,
          song.primeTrackId,
          song.primeTrackName,
          now,
          now,
        );
      }
      for (const row of existing) {
        if (!keep.has(row.pcoItemId)) remove.run(planDbId, row.pcoItemId);
      }
    });
    tx();
  }

  listPlanSongs(planDbId: number): PlanSongRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM plan_songs WHERE plan_id = ? ORDER BY position ASC')
      .all(planDbId) as any[];
    return rows.map(mapSong);
  }

  setPlanSongTracking(
    planDbId: number,
    pcoItemId: string,
    tracking: { primeSetlistTrackId: string | null; primeAppliedKey: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE plan_songs SET prime_setlist_track_id = ?, prime_applied_key = ?, updated_at = ?
         WHERE plan_id = ? AND pco_item_id = ?`,
      )
      .run(tracking.primeSetlistTrackId, tracking.primeAppliedKey, nowIso(), planDbId, pcoItemId);
  }

  /** All plan songs with unmatched/ambiguous status (for the mapping dashboard). */
  listSongsNeedingMapping(): Array<PlanSongRecord & { pcoPlanId: string; planDate: string; planTitle: string }> {
    const rows = this.db
      .prepare(
        `SELECT ps.*, sp.pco_plan_id, sp.plan_date, sp.title AS plan_title
         FROM plan_songs ps
         JOIN service_plans sp ON sp.id = ps.plan_id
         WHERE ps.match_status IN ('unmatched', 'ambiguous', 'review')
         ORDER BY sp.plan_date ASC, ps.position ASC`,
      )
      .all() as any[];
    return rows.map((row) => ({
      ...mapSong(row),
      pcoPlanId: row.pco_plan_id,
      planDate: row.plan_date,
      planTitle: row.plan_title,
    }));
  }

  // -- plan musicians ------------------------------------------------------
  replacePlanMusicians(planDbId: number, musicians: PlanMusicianInput[]): void {
    const now = nowIso();
    const existing = this.listPlanMusicians(planDbId);
    const keep = new Set(musicians.map((m) => m.pcoPersonId));

    const insert = this.db.prepare(
      `INSERT INTO plan_musicians (plan_id, pco_person_id, pco_name, email_normalized, email_raw,
         team_id, team_name, match_status, team_member_mapping_id, prime_member_id, prime_member_name,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (plan_id, pco_person_id) DO UPDATE SET
         pco_name = excluded.pco_name,
         email_normalized = excluded.email_normalized,
         email_raw = excluded.email_raw,
         team_id = excluded.team_id,
         team_name = excluded.team_name,
         match_status = excluded.match_status,
         team_member_mapping_id = excluded.team_member_mapping_id,
         prime_member_id = excluded.prime_member_id,
         prime_member_name = excluded.prime_member_name,
         updated_at = excluded.updated_at`,
    );
    const remove = this.db.prepare('DELETE FROM plan_musicians WHERE plan_id = ? AND pco_person_id = ?');

    const tx = this.db.transaction(() => {
      for (const musician of musicians) {
        insert.run(
          planDbId,
          musician.pcoPersonId,
          musician.pcoName,
          musician.emailNormalized,
          musician.emailRaw,
          musician.teamId,
          musician.teamName,
          musician.matchStatus,
          musician.teamMemberMappingId,
          musician.primeMemberId,
          musician.primeMemberName,
          now,
          now,
        );
      }
      for (const row of existing) {
        if (!keep.has(row.pcoPersonId)) remove.run(planDbId, row.pcoPersonId);
      }
    });
    tx();
  }

  listPlanMusicians(planDbId: number): PlanMusicianRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM plan_musicians WHERE plan_id = ? ORDER BY pco_name COLLATE NOCASE')
      .all(planDbId) as any[];
    return rows.map(mapMusician);
  }

  setPlanMusicianShared(planDbId: number, pcoPersonId: string, shared: boolean): void {
    this.db
      .prepare('UPDATE plan_musicians SET shared = ?, updated_at = ? WHERE plan_id = ? AND pco_person_id = ?')
      .run(shared ? 1 : 0, nowIso(), planDbId, pcoPersonId);
  }

  listMusiciansNeedingMapping(): Array<PlanMusicianRecord & { pcoPlanId: string; planDate: string; planTitle: string }> {
    const rows = this.db
      .prepare(
        `SELECT pm.*, sp.pco_plan_id, sp.plan_date, sp.title AS plan_title
         FROM plan_musicians pm
         JOIN service_plans sp ON sp.id = pm.plan_id
         WHERE pm.match_status IN ('unmatched', 'ambiguous', 'review')
         ORDER BY sp.plan_date ASC, pm.pco_name COLLATE NOCASE`,
      )
      .all() as any[];
    return rows.map((row) => ({
      ...mapMusician(row),
      pcoPlanId: row.pco_plan_id,
      planDate: row.plan_date,
      planTitle: row.plan_title,
    }));
  }

  /** Distinct scheduled musicians across upcoming plans with their match state. */
  listDistinctMusicians(): Array<{
    emailNormalized: string | null;
    emailRaw: string | null;
    pcoPersonId: string;
    pcoName: string;
    matchStatus: MemberMatchStatus;
    primeMemberId: string | null;
    primeMemberName: string | null;
    planCount: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT email_normalized, email_raw, pco_person_id, pco_name, match_status,
                prime_member_id, prime_member_name, COUNT(*) AS plan_count
         FROM plan_musicians
         GROUP BY pco_person_id
         ORDER BY pco_name COLLATE NOCASE`,
      )
      .all() as any[];
    return rows.map((row) => ({
      emailNormalized: row.email_normalized ?? null,
      emailRaw: row.email_raw ?? null,
      pcoPersonId: row.pco_person_id,
      pcoName: row.pco_name,
      matchStatus: row.match_status as MemberMatchStatus,
      primeMemberId: row.prime_member_id ?? null,
      primeMemberName: row.prime_member_name ?? null,
      planCount: Number(row.plan_count),
    }));
  }

  // -- mappings ------------------------------------------------------------
  getSongMappingByName(normalizedName: string): SongMapping | null {
    const row = this.db.prepare('SELECT * FROM song_mappings WHERE normalized_name = ?').get(normalizedName);
    return row ? mapSongMapping(row) : null;
  }

  listSongMappings(): SongMapping[] {
    const rows = this.db
      .prepare('SELECT * FROM song_mappings ORDER BY pco_song_title COLLATE NOCASE')
      .all() as any[];
    return rows.map(mapSongMapping);
  }

  upsertSongMapping(input: SongMappingInput): SongMapping {
    const normalized = normalizeSongName(input.pcoSongTitle);
    if (!normalized) throw new Error('Cannot map a song with an empty title');
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO song_mappings (normalized_name, pco_song_id, pco_song_title, prime_track_id,
           prime_track_name, prime_arrangement_id, prime_arrangement_name, confirmed, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (normalized_name) DO UPDATE SET
           pco_song_id = COALESCE(excluded.pco_song_id, song_mappings.pco_song_id),
           pco_song_title = excluded.pco_song_title,
           prime_track_id = excluded.prime_track_id,
           prime_track_name = excluded.prime_track_name,
           prime_arrangement_id = excluded.prime_arrangement_id,
           prime_arrangement_name = excluded.prime_arrangement_name,
           confirmed = excluded.confirmed,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(
        normalized,
        input.pcoSongId,
        input.pcoSongTitle,
        input.primeTrackId,
        input.primeTrackName,
        input.primeArrangementId ?? null,
        input.primeArrangementName ?? null,
        input.confirmed === false ? 0 : 1,
        input.source ?? 'manual',
        now,
        now,
      );
    const mapping = this.getSongMappingByName(normalized);
    if (!mapping) throw new Error('Failed to persist song mapping');
    return mapping;
  }

  deleteSongMapping(id: number): void {
    this.db.prepare('DELETE FROM song_mappings WHERE id = ?').run(id);
  }

  getMemberMappingByEmail(normalizedEmail: string): TeamMemberMapping | null {
    const row = this.db.prepare('SELECT * FROM team_member_mappings WHERE normalized_email = ?').get(normalizedEmail);
    return row ? mapMemberMapping(row) : null;
  }

  listMemberMappings(): TeamMemberMapping[] {
    const rows = this.db
      .prepare('SELECT * FROM team_member_mappings ORDER BY pco_name COLLATE NOCASE')
      .all() as any[];
    return rows.map(mapMemberMapping);
  }

  upsertMemberMapping(input: {
    normalizedEmail: string;
    pcoPersonId: string | null;
    pcoName: string | null;
    primeMemberId: string;
    primeMemberName: string;
    status?: MemberMatchStatus;
    source?: 'auto' | 'manual';
  }): TeamMemberMapping {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO team_member_mappings (normalized_email, pco_person_id, pco_name, prime_member_id,
           prime_member_name, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (normalized_email) DO UPDATE SET
           pco_person_id = COALESCE(excluded.pco_person_id, team_member_mappings.pco_person_id),
           pco_name = COALESCE(excluded.pco_name, team_member_mappings.pco_name),
           prime_member_id = excluded.prime_member_id,
           prime_member_name = excluded.prime_member_name,
           status = excluded.status,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.normalizedEmail,
        input.pcoPersonId,
        input.pcoName,
        input.primeMemberId,
        input.primeMemberName,
        input.status ?? 'matched',
        input.source ?? 'manual',
        now,
        now,
      );
    const mapping = this.getMemberMappingByEmail(input.normalizedEmail);
    if (!mapping) throw new Error('Failed to persist member mapping');
    return mapping;
  }

  deleteMemberMapping(id: number): void {
    this.db.prepare('DELETE FROM team_member_mappings WHERE id = ?').run(id);
  }

  // -- prime setlists ------------------------------------------------------
  getPrimeSetlist(pcoPlanId: string): PrimeSetlistRecord | null {
    const row = this.db.prepare('SELECT * FROM prime_setlists WHERE pco_plan_id = ?').get(pcoPlanId) as any;
    if (!row) return null;
    return {
      id: row.id,
      pcoPlanId: row.pco_plan_id,
      primeSetlistId: row.prime_setlist_id,
      primeSetlistName: row.prime_setlist_name,
      primeUrl: row.prime_url ?? null,
      lastVerifiedAt: row.last_verified_at ?? null,
      state: parseState(row.state_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  savePrimeSetlist(input: {
    pcoPlanId: string;
    primeSetlistId: string;
    primeSetlistName: string;
    primeUrl: string | null;
    verified: boolean;
    state: PrimeStateSnapshot;
  }): PrimeSetlistRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO prime_setlists (pco_plan_id, prime_setlist_id, prime_setlist_name, prime_url,
           last_verified_at, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (pco_plan_id) DO UPDATE SET
           prime_setlist_id = excluded.prime_setlist_id,
           prime_setlist_name = excluded.prime_setlist_name,
           prime_url = excluded.prime_url,
           last_verified_at = excluded.last_verified_at,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.pcoPlanId,
        input.primeSetlistId,
        input.primeSetlistName,
        input.primeUrl,
        input.verified ? now : null,
        JSON.stringify(input.state),
        now,
        now,
      );
    const record = this.getPrimeSetlist(input.pcoPlanId);
    if (!record) throw new Error('Failed to persist prime setlist');
    return record;
  }

  // -- sync history --------------------------------------------------------
  createSyncRun(mode: SyncMode, trigger: SyncTrigger): number {
    const info = this.db
      .prepare(
        `INSERT INTO sync_history (started_at, mode, trigger, status, plans_processed, changes_applied, errors_count)
         VALUES (?, ?, ?, 'running', 0, 0, 0)`,
      )
      .run(nowIso(), mode, trigger);
    return Number(info.lastInsertRowid);
  }

  finishSyncRun(
    id: number,
    input: { status: SyncRunStatus; plansProcessed: number; changesApplied: number; errorsCount: number; summary: string },
  ): void {
    this.db
      .prepare(
        `UPDATE sync_history SET finished_at = ?, status = ?, plans_processed = ?, changes_applied = ?,
           errors_count = ?, summary = ? WHERE id = ?`,
      )
      .run(
        nowIso(),
        input.status,
        input.plansProcessed,
        input.changesApplied,
        input.errorsCount,
        input.summary,
        id,
      );
  }

  getSyncRun(id: number): SyncHistoryRecord | null {
    const row = this.db.prepare('SELECT * FROM sync_history WHERE id = ?').get(id);
    return row ? mapHistory(row) : null;
  }

  listSyncHistory(limit = 25): SyncHistoryRecord[] {
    const rows = this.db.prepare('SELECT * FROM sync_history ORDER BY started_at DESC LIMIT ?').all(limit) as any[];
    return rows.map(mapHistory);
  }

  getLastSuccessfulSync(): SyncHistoryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM sync_history WHERE status IN ('success', 'partial') ORDER BY finished_at DESC LIMIT 1")
      .get();
    return row ? mapHistory(row) : null;
  }

  addChange(input: {
    syncRunId: number;
    pcoPlanId: string | null;
    changeType: ChangeType;
    description: string;
    status: ChangeStatus;
    detail?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sync_changes (sync_run_id, pco_plan_id, change_type, description, status, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.syncRunId,
        input.pcoPlanId,
        input.changeType,
        input.description,
        input.status,
        input.detail ?? null,
        nowIso(),
      );
  }

  /** Number of errors persisted for a run (including ones recorded during analysis). */
  countErrorsForRun(syncRunId: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM sync_errors WHERE sync_run_id = ?').get(syncRunId) as {
      count: number;
    };
    return Number(row?.count ?? 0);
  }

  listChanges(syncRunId: number): SyncChangeRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_changes WHERE sync_run_id = ? ORDER BY id ASC')
      .all(syncRunId) as any[];
    return rows.map(mapChange);
  }

  addError(input: {
    syncRunId: number | null;
    pcoPlanId: string | null;
    scope: string;
    code: string;
    message: string;
    detail?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sync_errors (sync_run_id, pco_plan_id, scope, code, message, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.syncRunId,
        input.pcoPlanId,
        input.scope,
        input.code,
        input.message,
        input.detail ?? null,
        nowIso(),
      );
  }

  listErrors(input: { limit?: number; unresolvedOnly?: boolean } = {}): SyncErrorRecord[] {
    const limit = input.limit ?? 50;
    const sql = input.unresolvedOnly
      ? 'SELECT * FROM sync_errors WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM sync_errors ORDER BY created_at DESC LIMIT ?';
    const rows = this.db.prepare(sql).all(limit) as any[];
    return rows.map(mapError);
  }

  resolveError(id: number): void {
    this.db.prepare('UPDATE sync_errors SET resolved_at = ? WHERE id = ?').run(nowIso(), id);
  }

  resolveErrorsByCode(code: string): void {
    this.db.prepare('UPDATE sync_errors SET resolved_at = ? WHERE code = ? AND resolved_at IS NULL').run(nowIso(), code);
  }

  // -- dashboard helpers ---------------------------------------------------
  /** Song match counts for plans inside a date window. */
  countSongMatchStats(fromDate: string, toDate: string): { matched: number; unmatched: number; total: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN ps.match_status = 'matched' THEN 1 ELSE 0 END) AS matched,
           SUM(CASE WHEN ps.match_status <> 'matched' THEN 1 ELSE 0 END) AS unmatched,
           COUNT(*) AS total
         FROM plan_songs ps
         JOIN service_plans sp ON sp.id = ps.plan_id
         WHERE sp.plan_date >= ? AND sp.plan_date <= ?`,
      )
      .get(fromDate, toDate) as { matched: number | null; unmatched: number | null; total: number | null };
    return {
      matched: Number(row?.matched ?? 0),
      unmatched: Number(row?.unmatched ?? 0),
      total: Number(row?.total ?? 0),
    };
  }

  countPlanStatuses(fromDate: string, toDate: string): Record<string, number> {
    const rows = this.db
      .prepare(
        'SELECT status, COUNT(*) AS count FROM service_plans WHERE plan_date >= ? AND plan_date <= ? GROUP BY status',
      )
      .all(fromDate, toDate) as Array<{ status: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  /**
   * When an administrator maps a song, every already-imported plan row with the
   * same normalized title becomes matched immediately — no re-import needed.
   */
  applySongMappingToPlanSongs(normalizedName: string, mapping: SongMapping): number {
    const info = this.db
      .prepare(
        `UPDATE plan_songs SET match_status = 'matched', song_mapping_id = ?, prime_track_id = ?,
           prime_track_name = ?, updated_at = ?
         WHERE normalized_title = ? AND match_status <> 'matched'`,
      )
      .run(mapping.id, mapping.primeTrackId, mapping.primeTrackName, nowIso(), normalizedName);
    return info.changes;
  }

  /** Apply a confirmed member mapping to all outstanding plan musician rows. */
  applyMemberMappingToPlanMusicians(normalizedEmail: string, mapping: TeamMemberMapping): number {
    const info = this.db
      .prepare(
        `UPDATE plan_musicians SET match_status = 'matched', team_member_mapping_id = ?,
           prime_member_id = ?, prime_member_name = ?, updated_at = ?
         WHERE email_normalized = ? AND match_status <> 'matched'`,
      )
      .run(mapping.id, mapping.primeMemberId, mapping.primeMemberName, nowIso(), normalizedEmail);
    return info.changes;
  }

  /** Reset the Prime tracking columns for a plan (used when a setlist is re-created). */
  clearPlanSongTracking(planDbId: number): void {
    this.db
      .prepare(
        `UPDATE plan_songs SET prime_setlist_track_id = NULL, prime_applied_key = NULL, updated_at = ?
         WHERE plan_id = ?`,
      )
      .run(nowIso(), planDbId);
  }
}

function parseState(json: string): PrimeStateSnapshot {
  try {
    const parsed = JSON.parse(json) as Partial<PrimeStateSnapshot>;
    return {
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      shares: Array.isArray(parsed.shares) ? parsed.shares : [],
    };
  } catch {
    return { tracks: [], shares: [] };
  }
}
