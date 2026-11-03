/**
 * Shared domain types for PCO Prime Sync.
 *
 * This module is imported by both the Node server and the React dashboard, so it
 * must stay free of Node-only or browser-only imports.
 */

export type IsoDateTime = string;
export type IsoDate = string; // YYYY-MM-DD

/** Which PCO arrangement we sync. Deliberately limited to Default / Original. */
export type ArrangementChoice = 'default' | 'original' | 'none';

/** Result of trying to map a PCO song onto a Loop Prime multitrack. */
export type SongMatchStatus = 'matched' | 'ambiguous' | 'unmatched' | 'review';

/** Result of trying to map a PCO musician onto a Loop Prime team member. */
export type MemberMatchStatus = 'matched' | 'ambiguous' | 'unmatched' | 'review';

export type PlanSyncStatus =
  | 'not_synced'
  | 'pending'
  | 'in_sync'
  | 'needs_matching'
  | 'blocked'
  | 'error'
  | 'missing_in_pco';

export type SyncMode = 'sync' | 'dry_run';
export type SyncTrigger = 'manual' | 'schedule' | 'cli';

export type SyncRunStatus =
  | 'success'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'dry_run'
  | 'running';

export type ChangeType =
  | 'create_setlist'
  | 'rename_setlist'
  | 'add_track'
  | 'remove_track'
  | 'reorder_tracks'
  | 'key_change'
  | 'share_member'
  | 'unshare_member'
  | 'flag_review'
  | 'noop';

export type ChangeStatus = 'planned' | 'applied' | 'failed' | 'skipped' | 'blocked';

// ---------------------------------------------------------------------------
// Planning Center
// ---------------------------------------------------------------------------

export interface PcoPlan {
  id: string;
  serviceTypeId: string;
  title: string;
  seriesTitle: string | null;
  /** ISO timestamp of the first service time (PCO `sort_date`). */
  sortDate: IsoDateTime | null;
  /** Local calendar date of the plan, `YYYY-MM-DD`. */
  planDate: IsoDate;
  /** Raw `dates` string from PCO, shown for context only. */
  dates: string | null;
  itemsCount: number;
  updatedAt: IsoDateTime | null;
}

export interface PcoKey {
  id: string;
  name: string;
  startingKey: string | null;
}

export interface PcoArrangement {
  id: string;
  name: string;
  /** Arrangement BPM from PCO. Recorded for visibility only — never written to Prime. */
  bpm: number | null;
  /** Possible keys for this arrangement, when fetched. */
  keys: PcoKey[];
}

export interface PcoPlanItem {
  id: string;
  planId: string;
  itemType: string;
  title: string;
  sequence: number;
  servicePosition: string;
  /** e.g. "G", "Ab", "Bb" — PCO's selected key for this item. */
  keyName: string | null;
  songId: string | null;
  arrangementId: string | null;
  arrangementName: string | null;
  arrangementBpm: number | null;
  keyId: string | null;
}

export interface PcoPlanPerson {
  id: string;
  planId: string;
  personId: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  teamPositionName: string | null;
  status: string | null;
  /** Normalized (trimmed, lowercased) email address, when available. */
  email: string | null;
  rawEmail: string | null;
}

export interface PcoTeam {
  id: string;
  name: string;
  serviceTypeId: string | null;
  archived: boolean;
}

export interface PcoServiceType {
  id: string;
  name: string;
}

/** Everything the sync engine needs to know about one plan, from PCO. */
export interface PcoPlanSnapshot {
  plan: PcoPlan;
  items: PcoPlanItem[];
  people: PcoPlanPerson[];
}

// ---------------------------------------------------------------------------
// Loop Community Prime
// ---------------------------------------------------------------------------

export interface PrimeTrack {
  /** Stable identifier if the site exposes one; otherwise a deterministic slug. */
  id: string;
  title: string;
  /** Optional artist/author label shown next to the track. Never used for matching. */
  subtitle: string | null;
  /** Arrangements/versions offered for this multitrack, when the site exposes them. */
  arrangements: PrimeTrackArrangement[];
  /** Loops/keys the website states are available, when discoverable. */
  availableKeys: string[];
  url: string | null;
}

export interface PrimeTrackArrangement {
  id: string;
  name: string;
}

export interface PrimeTeamMember {
  id: string;
  name: string;
  /** Normalized email address used for matching. */
  email: string;
  rawEmail: string;
  role: string | null;
}

export interface PrimeSetlistTrack {
  /** Prime-side identifier for the track *within this setlist*. */
  setlistTrackId: string;
  trackId: string;
  title: string;
  /** Key that Prime reports for the setlist track, if the site exposes it. */
  key: string | null;
  position: number;
}

export interface PrimeSetlistShare {
  memberId: string;
  memberName: string;
  email: string | null;
}

export interface PrimeSetlist {
  id: string;
  name: string;
  url: string | null;
  tracks: PrimeSetlistTrack[];
  shares: PrimeSetlistShare[];
}

export type PrimeCapability =
  | 'search_tracks'
  | 'list_team_members'
  | 'create_setlist'
  | 'rename_setlist'
  | 'add_track'
  | 'remove_track'
  | 'reorder_tracks'
  | 'change_key'
  | 'share_member'
  | 'unshare_member'
  | 'delete_setlist';

export interface PrimeCapabilityReport {
  capability: PrimeCapability;
  supported: 'yes' | 'no' | 'unknown';
  /** Human readable note, especially for unsupported/unknown capabilities. */
  note: string;
}

export type PrimeSessionState = 'authenticated' | 'needs_login' | 'unknown' | 'error';

export interface PrimeSessionStatus {
  state: PrimeSessionState;
  checkedAt: IsoDateTime;
  message: string;
  /** Page the login window opens, as configured on the server. */
  loginUrl?: string;
  currentUrl: string | null;
  profileDir: string;
  headless: boolean;
}

// ---------------------------------------------------------------------------
// Local mapping + settings
// ---------------------------------------------------------------------------

export interface ChurchSettings {
  pcoAppId: string | null;
  pcoServiceTypeIds: string[];
  pcoTeamIds: string[];
  primeBaseUrl: string;
  primeProfileDir: string;
  primeHeadless: boolean;
  syncHour: number;
  syncMinute: number;
  timezone: string;
  windowDays: number;
  autoSyncEnabled: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PcoTeamConfiguration {
  id: number;
  teamId: string;
  teamName: string;
  serviceTypeId: string | null;
  isWorshipTeam: boolean;
  createdAt: IsoDateTime;
}

export interface SongMapping {
  id: number;
  normalizedName: string;
  pcoSongId: string | null;
  pcoSongTitle: string;
  primeTrackId: string;
  primeTrackName: string;
  primeArrangementId: string | null;
  primeArrangementName: string | null;
  confirmed: boolean;
  source: 'auto' | 'manual';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TeamMemberMapping {
  id: number;
  normalizedEmail: string;
  pcoPersonId: string | null;
  pcoName: string | null;
  primeMemberId: string;
  primeMemberName: string;
  status: MemberMatchStatus;
  source: 'auto' | 'manual';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ServicePlanRecord {
  id: number;
  pcoPlanId: string;
  serviceTypeId: string;
  title: string;
  seriesTitle: string | null;
  sortDate: IsoDateTime | null;
  planDate: IsoDate;
  status: PlanSyncStatus;
  lastSyncedAt: IsoDateTime | null;
  pcoUpdatedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PlanSongRecord {
  id: number;
  planId: number;
  pcoItemId: string;
  pcoSongId: string | null;
  position: number;
  title: string;
  normalizedTitle: string;
  arrangementSelected: ArrangementChoice;
  arrangementPcoId: string | null;
  arrangementPcoName: string | null;
  keyName: string | null;
  bpm: number | null;
  matchStatus: SongMatchStatus;
  songMappingId: number | null;
  primeTrackId: string | null;
  primeTrackName: string | null;
  primeSetlistTrackId: string | null;
  primeAppliedKey: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PlanMusicianRecord {
  id: number;
  planId: number;
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
  shared: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PrimeSetlistRecord {
  id: number;
  pcoPlanId: string;
  primeSetlistId: string;
  primeSetlistName: string;
  primeUrl: string | null;
  lastVerifiedAt: IsoDateTime | null;
  /** Last verified Loop state (track order/keys/shares) as JSON. */
  state: PrimeStateSnapshot;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PrimeStateSnapshot {
  tracks: PrimeSetlistTrack[];
  shares: PrimeSetlistShare[];
}

export interface SyncHistoryRecord {
  id: number;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  mode: SyncMode;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  plansProcessed: number;
  changesApplied: number;
  errorsCount: number;
  summary: string | null;
}

export interface SyncChangeRecord {
  id: number;
  syncRunId: number;
  pcoPlanId: string | null;
  changeType: ChangeType;
  description: string;
  status: ChangeStatus;
  detail: string | null;
  createdAt: IsoDateTime;
}

export interface SyncErrorRecord {
  id: number;
  syncRunId: number | null;
  pcoPlanId: string | null;
  scope: string;
  code: string;
  message: string;
  detail: string | null;
  createdAt: IsoDateTime;
  resolvedAt: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Sync operations (planner output)
// ---------------------------------------------------------------------------

export interface SyncOperationBase {
  pcoPlanId: string;
  changeType: ChangeType;
  description: string;
}

export interface CreateSetlistOperation extends SyncOperationBase {
  changeType: 'create_setlist';
  setlistName: string;
  /** Tracks are added with individual add_track operations after creation. */
  trackCount: number;
}

export interface RenameSetlistOperation extends SyncOperationBase {
  changeType: 'rename_setlist';
  nameOnPrime: string;
  nameDesired: string;
}

export interface AddTrackOperation extends SyncOperationBase {
  changeType: 'add_track';
  track: DesiredTrack;
  position: number;
}

export interface RemoveTrackOperation extends SyncOperationBase {
  changeType: 'remove_track';
  setlistTrackId: string;
  trackTitle: string;
  trackId: string;
}

export interface ReorderOperation extends SyncOperationBase {
  changeType: 'reorder_tracks';
  /** Desired order, using Prime setlist-track ids that exist today. */
  desiredOrder: string[];
  currentOrder: string[];
}

export interface KeyChangeOperation extends SyncOperationBase {
  changeType: 'key_change';
  setlistTrackId: string;
  trackTitle: string;
  fromKey: string | null;
  toKey: string;
}

export interface ShareMemberOperation extends SyncOperationBase {
  changeType: 'share_member';
  member: DesiredShare;
}

export interface UnshareMemberOperation extends SyncOperationBase {
  changeType: 'unshare_member';
  memberId: string;
  memberName: string;
}

export interface FlagReviewOperation extends SyncOperationBase {
  changeType: 'flag_review';
  reason: string;
}

export type SyncOperation =
  | CreateSetlistOperation
  | RenameSetlistOperation
  | AddTrackOperation
  | RemoveTrackOperation
  | ReorderOperation
  | KeyChangeOperation
  | ShareMemberOperation
  | UnshareMemberOperation
  | FlagReviewOperation;

export interface DesiredTrack {
  /** Stable key for diffing: the PCO plan item id. */
  itemId: string;
  title: string;
  keyName: string | null;
  trackId: string;
  trackName: string;
  primeArrangementId: string | null;
}

export interface DesiredShare {
  personId: string;
  name: string;
  email: string;
  memberId: string;
}

export interface PlanSyncPreview {
  pcoPlanId: string;
  planTitle: string;
  planDate: IsoDate;
  setlistName: string;
  status: PlanSyncStatus;
  blocked: boolean;
  blockedReasons: string[];
  operations: SyncOperation[];
  unmatchedSongs: string[];
  ambiguousSongs: string[];
  unmatchedMusicians: string[];
  ambiguousMusicians: string[];
}

export interface SyncPreview {
  generatedAt: IsoDateTime;
  mode: SyncMode;
  windowDays: number;
  plans: PlanSyncPreview[];
  totalOperations: number;
  unsyncedPlanCount: number;
}

export interface SyncRunResult {
  syncRunId: number;
  mode: SyncMode;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
  plansProcessed: number;
  changesApplied: number;
  errors: Array<{ code: string; message: string; scope: string; pcoPlanId: string | null }>;
  planPreviews: PlanSyncPreview[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Dashboard API payloads
// ---------------------------------------------------------------------------

export interface ConnectionStatus {
  configured: boolean;
  ok: boolean;
  message: string;
  checkedAt: IsoDateTime;
  /** Where the secret came from, for troubleshooting. Never the value itself. */
  secretSource: 'env' | 'keychain' | 'missing';
  serviceTypeCount: number | null;
}

export interface ScheduleInfo {
  enabled: boolean;
  timeLabel: string;
  timezone: string;
  nextRunAt: IsoDateTime | null;
  windowDays: number;
  launchdInstalled: boolean;
  launchdPlistPath: string;
}

export interface OverviewPayload {
  pco: ConnectionStatus;
  prime: PrimeSessionStatus;
  lastSuccessfulSync: SyncHistoryRecord | null;
  schedule: ScheduleInfo;
  counts: {
    upcomingPlans: number;
    matchedSongs: number;
    unmatchedSongs: number;
    musiciansNeedingMatching: number;
    pendingChanges: number;
  };
  capabilities: PrimeCapabilityReport[];
  recentErrors: SyncErrorRecord[];
}

export interface ApiError {
  error: string;
  message: string;
  detail?: string;
}
