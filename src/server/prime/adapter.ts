import type {
  PrimeCapability,
  PrimeCapabilityReport,
  PrimeSetlist,
  PrimeSessionStatus,
  PrimeTeamMember,
  PrimeTrack,
} from '../../shared/types';

/**
 * Errors raised by the Loop Prime automation layer.
 *
 * The sync engine treats these differently:
 *  - session expired / needs login -> pause the whole run (manual action needed)
 *  - selector missing / layout changed -> stop the affected plan, record an error
 *  - verification failed -> stop the run: the remote state is uncertain
 *  - unsupported capability -> record the limitation, continue with the rest
 */
export class PrimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'PrimeError';
  }
}

export class PrimeSessionExpiredError extends PrimeError {
  constructor(message: string, detail?: string) {
    super(message, 'prime_session_expired', detail);
    this.name = 'PrimeSessionExpiredError';
  }
}

export class PrimeSelectorMissingError extends PrimeError {
  constructor(message: string, readonly selectorKey?: string, detail?: string) {
    super(message, 'prime_selector_missing', detail);
    this.name = 'PrimeSelectorMissingError';
  }
}

export class PrimeVerificationError extends PrimeError {
  constructor(message: string, detail?: string) {
    super(message, 'prime_verification_failed', detail);
    this.name = 'PrimeVerificationError';
  }
}

export class PrimeUnsupportedError extends PrimeError {
  constructor(
    message: string,
    readonly capability: PrimeCapability,
  ) {
    super(message, 'prime_capability_unsupported');
    this.name = 'PrimeUnsupportedError';
  }
}

export class PrimeActionError extends PrimeError {
  constructor(message: string, detail?: string) {
    super(message, 'prime_action_failed', detail);
    this.name = 'PrimeActionError';
  }
}

export interface CreateSetlistInput {
  name: string;
  tracks: Array<{ trackId: string; key: string | null; arrangementId: string | null }>;
  shares: Array<{ memberId: string }>;
}

/**
 * Everything the sync engine needs from Loop Prime.
 *
 * Both the Playwright adapter and the test mock implement this interface, so the
 * engine has no knowledge of browsers, selectors or HTML.
 */
/** What the login window actually loaded, so failures are diagnosable. */
export interface LoginWindowInfo {
  url: string;
  title: string;
  /** Set when the window ended somewhere other than the page it was sent to. */
  note?: string;
}

export interface PrimeAdapter {
  readonly kind: 'playwright' | 'mock';
  /** Page the login window opens; Loop redirects from here to its auth host. */
  readonly loginUrl: string;

  capabilities(): PrimeCapabilityReport[];
  sessionStatus(): Promise<PrimeSessionStatus>;

  /**
   * Launch the visible browser and open the login page, returning once it has
   * loaded. Throws if the window cannot actually be opened.
   */
  startManualLogin(): Promise<LoginWindowInfo>;

  /** Open the login window and keep waiting until the administrator is done. */
  openManualLogin(): Promise<void>;

  listTracks(query: string): Promise<PrimeTrack[]>;
  listTeamMembers(): Promise<PrimeTeamMember[]>;
  listSetlists(): Promise<PrimeSetlist[]>;
  getSetlist(setlistId: string): Promise<PrimeSetlist>;

  createSetlist(input: CreateSetlistInput): Promise<PrimeSetlist>;
  /** Rename an existing setlist. Only the name is ever changed. */
  renameSetlist(setlistId: string, name: string): Promise<void>;

  addTrack(setlistId: string, input: { trackId: string; position: number; key: string | null }): Promise<void>;
  removeTrack(setlistId: string, setlistTrackId: string): Promise<void>;
  /** Reorder using Prime track ids in the desired order. */
  reorderTracks(setlistId: string, desiredTrackIdsInOrder: string[]): Promise<void>;
  /** Only ever changes the key. BPM/mix/volume are never touched. */
  setTrackKey(setlistId: string, setlistTrackId: string, key: string): Promise<void>;

  shareMember(setlistId: string, memberId: string): Promise<void>;
  unshareMember(setlistId: string, memberId: string): Promise<void>;

  close(): Promise<void>;
}

/** Capabilities that must be 'yes' before the engine will attempt an operation. */
export function capabilitySupported(
  reports: PrimeCapabilityReport[],
  capability: PrimeCapability,
): boolean {
  return reports.some((report) => report.capability === capability && report.supported === 'yes');
}

export function capabilityNote(reports: PrimeCapabilityReport[], capability: PrimeCapability): string {
  return reports.find((report) => report.capability === capability)?.note ?? 'Capability not reported';
}
