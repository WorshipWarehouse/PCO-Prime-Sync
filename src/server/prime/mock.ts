import type { LoginWindowInfo } from './adapter';
import type {
  PrimeCapability,
  PrimeCapabilityReport,
  PrimeSetlist,
  PrimeSetlistTrack,
  PrimeSessionStatus,
  PrimeTeamMember,
  PrimeTrack,
} from '../../shared/types';
import { normalizeSongName } from '../../shared/naming';
import { dedupeTracks } from '../matching/songs';
import {
  PrimeSessionExpiredError,
  PrimeUnsupportedError,
  PrimeVerificationError,
  type CreateSetlistInput,
  type PrimeAdapter,
} from './adapter';

export interface MockPrimeOptions {
  tracks?: PrimeTrack[];
  members?: PrimeTeamMember[];
  capabilities?: Partial<Record<PrimeCapability, boolean>>;
  authenticated?: boolean;
  /** Simulate a broken UI: every mutating action throws a verification error. */
  failVerification?: boolean;
  /** Randomly-shaped ids are avoided so tests stay deterministic. */
  idPrefix?: string;
}

const ALL_CAPABILITIES: PrimeCapability[] = [
  'search_tracks',
  'list_team_members',
  'create_setlist',
  'rename_setlist',
  'add_track',
  'remove_track',
  'reorder_tracks',
  'change_key',
  'share_member',
  'unshare_member',
  'delete_setlist',
];

/**
 * In-memory Loop Prime adapter used by the test suite and by `--mock` previews.
 * It performs real (in-memory) state changes so idempotency can be tested.
 */
export class MockPrimeAdapter implements PrimeAdapter {
  readonly kind = 'mock' as const;
  readonly calls: string[] = [];
  private readonly tracks: PrimeTrack[];
  private readonly members: PrimeTeamMember[];
  private readonly enabled: Record<PrimeCapability, boolean>;
  private readonly setlists = new Map<string, PrimeSetlist & { createdAt: string }>();
  private readonly idPrefix: string;
  private authenticated: boolean;
  private readonly failVerification: boolean;
  private nextId = 1;
  private closed = false;

  constructor(options: MockPrimeOptions = {}) {
    this.tracks = options.tracks ?? defaultTracks();
    this.members = options.members ?? defaultMembers();
    this.authenticated = options.authenticated ?? true;
    this.failVerification = options.failVerification ?? false;
    this.idPrefix = options.idPrefix ?? 'prime';
    this.enabled = Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => [capability, options.capabilities?.[capability] ?? true]),
    ) as Record<PrimeCapability, boolean>;
  }

  capabilities(): PrimeCapabilityReport[] {
    return ALL_CAPABILITIES.map((capability) => ({
      capability,
      supported: this.enabled[capability] ? 'yes' : 'no',
      note: this.enabled[capability] ? 'Mock adapter: simulated' : 'Mock adapter: simulated as unsupported',
    }));
  }

  async sessionStatus(): Promise<PrimeSessionStatus> {
    return {
      state: this.authenticated ? 'authenticated' : 'needs_login',
      checkedAt: new Date().toISOString(),
      message: this.authenticated ? 'Mock Prime session authenticated' : 'Mock Prime session requires login',
      loginUrl: this.loginUrl,
      currentUrl: null,
      profileDir: 'mock',
      headless: true,
    };
  }

  readonly loginUrl = 'mock://prime/login';

  async startManualLogin(): Promise<LoginWindowInfo> {
    // No browser exists in mock mode; report the placeholder window.
    return { url: this.loginUrl, title: 'Mock Prime' };
  }

  async openManualLogin(): Promise<void> {
    this.authenticated = true;
  }

  /** Test helper: simulate session expiry. */
  expireSession(): void {
    this.authenticated = false;
  }

  private assertReady(capability?: PrimeCapability): void {
    if (this.closed) throw new PrimeSessionExpiredError('Mock Prime adapter closed');
    if (!this.authenticated) {
      throw new PrimeSessionExpiredError('Loop Prime session expired; manual login required');
    }
    if (capability && !this.enabled[capability]) {
      throw new PrimeUnsupportedError(`Capability "${capability}" is not supported by this adapter`, capability);
    }
  }

  async listTracks(query: string): Promise<PrimeTrack[]> {
    this.calls.push(`listTracks:${query}`);
    this.assertReady('search_tracks');
    const normalized = normalizeSongName(query);
    const hits = this.tracks.filter((track) => normalizeSongName(track.title).includes(normalized) || normalized === '');
    return dedupeTracks(hits);
  }

  async listTeamMembers(): Promise<PrimeTeamMember[]> {
    this.calls.push('listTeamMembers');
    this.assertReady('list_team_members');
    return [...this.members];
  }

  async listSetlists(): Promise<PrimeSetlist[]> {
    this.calls.push('listSetlists');
    this.assertReady();
    return [...this.setlists.values()].map((setlist) => structuredClone(setlist));
  }

  async getSetlist(setlistId: string): Promise<PrimeSetlist> {
    this.calls.push(`getSetlist:${setlistId}`);
    this.assertReady();
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found in mock Prime account`);
    return structuredClone(setlist);
  }

  async createSetlist(input: CreateSetlistInput): Promise<PrimeSetlist> {
    this.calls.push(`createSetlist:${input.name}`);
    this.assertReady('create_setlist');
    for (const setlist of this.setlists.values()) {
      if (setlist.name === input.name) {
        throw new PrimeVerificationError(`A setlist named "${input.name}" already exists`);
      }
    }
    const id = `${this.idPrefix}-setlist-${this.nextId++}`;
    const tracks: PrimeSetlistTrack[] = input.tracks.map((track, index) => {
      const source = this.tracks.find((candidate) => candidate.id === track.trackId);
      return {
        setlistTrackId: `${id}-track-${index + 1}`,
        trackId: track.trackId,
        title: source?.title ?? track.trackId,
        key: track.key,
        position: index + 1,
      };
    });
    const setlist: PrimeSetlist = {
      id,
      name: input.name,
      url: `https://mock.prime.local/setlists/${id}`,
      tracks,
      shares: input.shares.map((share) => {
        const member = this.members.find((candidate) => candidate.id === share.memberId);
        return {
          memberId: share.memberId,
          memberName: member?.name ?? share.memberId,
          email: member?.email ?? null,
        };
      }),
    };
    this.setlists.set(id, { ...setlist, createdAt: new Date().toISOString() });
    return structuredClone(setlist);
  }

  async renameSetlist(setlistId: string, name: string): Promise<void> {
    this.calls.push(`renameSetlist:${setlistId}:${name}`);
    this.assertReady('rename_setlist');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    setlist.name = name;
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after renaming the setlist');
    }
  }

  async addTrack(
    setlistId: string,
    input: { trackId: string; position: number; key: string | null },
  ): Promise<void> {
    this.calls.push(`addTrack:${setlistId}:${input.trackId}`);
    this.assertReady('add_track');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    const source = this.tracks.find((track) => track.id === input.trackId);
    if (!source) throw new PrimeUnsupportedError('Track is not available in this Prime account', 'add_track');
    const track: PrimeSetlistTrack = {
      setlistTrackId: `${setlistId}-track-${this.nextId++}`,
      trackId: source.id,
      title: source.title,
      key: input.key,
      position: input.position,
    };
    setlist.tracks.splice(Math.max(0, input.position - 1), 0, track);
    renumber(setlist.tracks);
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after add track');
    }
  }

  async removeTrack(setlistId: string, setlistTrackId: string): Promise<void> {
    this.calls.push(`removeTrack:${setlistId}:${setlistTrackId}`);
    this.assertReady('remove_track');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    const index = setlist.tracks.findIndex((track) => track.setlistTrackId === setlistTrackId);
    if (index === -1) throw new PrimeVerificationError('Track to remove not found in setlist');
    setlist.tracks.splice(index, 1);
    renumber(setlist.tracks);
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after remove track');
    }
  }

  async reorderTracks(setlistId: string, desiredIdsInOrder: string[]): Promise<void> {
    this.calls.push(`reorderTracks:${setlistId}`);
    this.assertReady('reorder_tracks');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    const remaining = [...setlist.tracks];
    const next: PrimeSetlistTrack[] = [];
    for (const id of desiredIdsInOrder) {
      // Setlist-track ids are the primary identity; fall back to the track id.
      let index = remaining.findIndex((track) => track.setlistTrackId === id);
      if (index === -1) index = remaining.findIndex((track) => track.trackId === id);
      if (index === -1) throw new PrimeVerificationError(`Cannot reorder: track ${id} is missing`);
      next.push(remaining.splice(index, 1)[0]!);
    }
    next.push(...remaining);
    renumber(next);
    setlist.tracks = next;
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after reorder');
    }
  }

  async setTrackKey(setlistId: string, setlistTrackId: string, key: string): Promise<void> {
    this.calls.push(`setTrackKey:${setlistId}:${setlistTrackId}:${key}`);
    this.assertReady('change_key');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    const track = setlist.tracks.find((candidate) => candidate.setlistTrackId === setlistTrackId);
    if (!track) throw new PrimeVerificationError('Track not found when changing key');
    track.key = key;
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after key change');
    }
  }

  async shareMember(setlistId: string, memberId: string): Promise<void> {
    this.calls.push(`shareMember:${setlistId}:${memberId}`);
    this.assertReady('share_member');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    if (setlist.shares.some((share) => share.memberId === memberId)) return;
    const member = this.members.find((candidate) => candidate.id === memberId);
    if (!member) throw new PrimeVerificationError(`Prime team member ${memberId} not found`);
    setlist.shares.push({ memberId, memberName: member.name, email: member.email });
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after sharing');
    }
  }

  async unshareMember(setlistId: string, memberId: string): Promise<void> {
    this.calls.push(`unshareMember:${setlistId}:${memberId}`);
    this.assertReady('unshare_member');
    const setlist = this.setlists.get(setlistId);
    if (!setlist) throw new PrimeVerificationError(`Setlist ${setlistId} not found`);
    setlist.shares = setlist.shares.filter((share) => share.memberId !== memberId);
    if (this.failVerification) {
      throw new PrimeVerificationError('Mock verification failure after unsharing');
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test helper: inspect raw state without going through capability checks. */
  peekSetlist(setlistId: string): PrimeSetlist | null {
    const setlist = this.setlists.get(setlistId);
    return setlist ? structuredClone(setlist) : null;
  }

  peekAllSetlists(): PrimeSetlist[] {
    return [...this.setlists.values()].map((setlist) => structuredClone(setlist));
  }
}

function renumber(tracks: PrimeSetlistTrack[]): void {
  tracks.forEach((track, index) => {
    track.position = index + 1;
  });
}

function defaultTracks(): PrimeTrack[] {
  return [
    track('track-goodness', 'Goodness of God', { keys: ['G', 'A', 'Ab'], arrangements: [] }),
    track('track-great-are-you-lord', 'Great Are You Lord', { keys: ['D'], arrangements: [] }),
    track('track-build-my-life', 'Build My Life', { keys: ['E'], arrangements: [] }),
    track('track-way-maker', 'Way Maker', { keys: ['Bb', 'A'], arrangements: [] }),
    track('track-goodness-live', 'Goodness of God (Live)', { keys: ['G'], arrangements: [] }),
  ];
}

function track(
  id: string,
  title: string,
  extra: { keys: string[]; arrangements: Array<{ id: string; name: string }> },
): PrimeTrack {
  return {
    id,
    title,
    subtitle: null,
    arrangements: extra.arrangements,
    availableKeys: extra.keys,
    url: null,
  };
}

function defaultMembers(): PrimeTeamMember[] {
  return [
    { id: 'member-1', name: 'Jordan Lee', email: 'jordan.lee@example.com', rawEmail: 'Jordan.Lee@example.com', role: 'Worship' },
    { id: 'member-2', name: 'Sam Rivera', email: 'sam.rivera@example.com', rawEmail: 'Sam.Rivera@example.com', role: 'Worship' },
    { id: 'member-3', name: 'Casey Morgan', email: 'casey.morgan@example.com', rawEmail: 'casey.morgan@example.com', role: 'Worship' },
    { id: 'member-4', name: 'Dana White', email: 'dana.white@example.com', rawEmail: 'dana.white@example.com', role: 'Worship' },
    { id: 'member-5', name: 'Taylor Brooks', email: 'taylor.brooks@example.com', rawEmail: 'Taylor.Brooks@example.com', role: 'Worship' },
  ];
}
