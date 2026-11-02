import fs from 'node:fs';
import path from 'node:path';
import type { PrimeCapability, PrimeCapabilityReport } from '../../../shared/types';
import { PrimeSelectorMissingError } from '../adapter';

/**
 * The Loop Community Prime website has no public API, so every interaction is
 * driven by a selector contract that must be filled in from a real, inspected
 * session (`npm run prime:explore`).
 *
 * Nothing here guesses at selectors. If a selector is missing, the adapter
 * throws PrimeSelectorMissingError instead of clicking something random, and the
 * dashboard reports the capability as unknown.
 */
export const PRIME_SELECTOR_KEYS = [
  // session
  'loggedInIndicator',
  'loggedOutIndicator',
  // setlists
  'setlistList',
  'setlistListItem',
  'setlistListItemName',
  'setlistListItemLink',
  'createSetlistButton',
  'setlistNameInput',
  'createSetlistSubmitButton',
  'setlistTitle',
  'setlistTrackList',
  'setlistTrackItem',
  'setlistTrackTitle',
  'setlistTrackKey',
  // track search / adding
  'trackSearchOpenButton',
  'trackSearchInput',
  'trackSearchResult',
  'trackSearchResultTitle',
  'trackSearchAddButton',
  // track editing
  'trackRemoveButton',
  'trackConfirmButton',
  'trackMoveUpButton',
  'trackMoveDownButton',
  'trackKeyButton',
  'trackKeyOption',
  'trackKeySaveButton',
  // sharing
  'shareOpenButton',
  'shareSearchInput',
  'shareMemberOption',
  'shareConfirmButton',
  'shareMemberItem',
  'shareRemoveButton',
  'shareList',
  // team members
  'teamMemberList',
  'teamMemberItem',
  'teamMemberName',
  'teamMemberEmail',
] as const;

export type PrimeSelectorKey = (typeof PRIME_SELECTOR_KEYS)[number];

export interface PrimeSelectorConfig {
  version: number;
  /** Set to true only after every capability below has been tested manually. */
  verified: boolean;
  notes?: string;
  urls: {
    /** Page that lists the church's Prime setlists. */
    setlists: string;
    /** Page/section used to search the church's purchased multitracks. */
    trackSearch?: string;
    /** Page/section that lists Prime Team members. */
    teamMembers?: string;
  };
  selectors: Partial<Record<PrimeSelectorKey, string>>;
  /** Attribute names used to read stable ids from the page, if the site has them. */
  attributes?: {
    setlistId?: string;
    trackId?: string;
    setlistTrackId?: string;
    memberId?: string;
  };
  /** Extra human notes per capability, shown on the dashboard. */
  capabilityNotes?: Partial<Record<PrimeCapability, string>>;
}

export const CAPABILITY_SELECTORS: Record<PrimeCapability, PrimeSelectorKey[]> = {
  search_tracks: ['trackSearchInput', 'trackSearchResult', 'trackSearchResultTitle'],
  list_team_members: ['teamMemberItem', 'teamMemberEmail'],
  create_setlist: ['createSetlistButton', 'setlistNameInput', 'createSetlistSubmitButton'],
  add_track: ['setlistTrackList', 'trackSearchInput', 'trackSearchResult', 'trackSearchAddButton'],
  remove_track: ['setlistTrackList', 'trackRemoveButton'],
  reorder_tracks: ['setlistTrackList', 'trackMoveUpButton', 'trackMoveDownButton'],
  change_key: ['setlistTrackItem', 'trackKeyButton', 'trackKeyOption'],
  share_member: ['shareOpenButton', 'shareSearchInput', 'shareMemberOption', 'shareConfirmButton'],
  unshare_member: ['shareList', 'shareMemberItem', 'shareRemoveButton'],
  delete_setlist: [],
};

export const SELECTOR_CONFIG_PATH = path.resolve(
  process.cwd(),
  process.env.PRIME_SELECTOR_CONFIG ?? 'config/prime-selectors.json',
);

export const SELECTOR_EXAMPLE_PATH = path.resolve(process.cwd(), 'config/prime-selectors.example.json');

function parseConfig(raw: unknown, source: string): PrimeSelectorConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Prime selector config ${source} must be a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  const selectors = (record.selectors ?? {}) as Record<string, unknown>;
  const cleanSelectors: Partial<Record<PrimeSelectorKey, string>> = {};
  for (const key of PRIME_SELECTOR_KEYS) {
    const value = selectors[key];
    if (typeof value === 'string' && value.trim() !== '') cleanSelectors[key] = value;
  }
  // URLs may stay blank in the committed template: logging in only needs the
  // browser profile and the auth URL, so a fresh install must still start. Every
  // operation that actually needs a page goes through urlFor(), which fails
  // loudly with the exact missing key.
  const urls = (record.urls ?? {}) as Record<string, unknown>;
  const setlistsUrl = typeof urls.setlists === 'string' ? urls.setlists.trim() : '';
  return {
    version: Number(record.version ?? 1),
    verified: record.verified === true,
    notes: typeof record.notes === 'string' ? record.notes : undefined,
    urls: {
      setlists: setlistsUrl,
      trackSearch: typeof urls.trackSearch === 'string' ? urls.trackSearch : undefined,
      teamMembers: typeof urls.teamMembers === 'string' ? urls.teamMembers : undefined,
    },
    selectors: cleanSelectors,
    attributes: (record.attributes as PrimeSelectorConfig['attributes']) ?? undefined,
    capabilityNotes: (record.capabilityNotes as PrimeSelectorConfig['capabilityNotes']) ?? undefined,
  };
}

/**
 * Load the local selector config. Falls back to the committed example (which has
 * no real selectors) so the app can start and clearly report what is missing.
 */
export function loadSelectorConfig(configPath = SELECTOR_CONFIG_PATH): PrimeSelectorConfig & { source: string } {
  const candidates = [configPath, SELECTOR_EXAMPLE_PATH];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, 'utf8');
    try {
      return { ...parseConfig(JSON.parse(text), candidate), source: candidate };
    } catch (error) {
      throw new Error(
        `Could not read Prime selector config at ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    'No Prime selector config found. Copy config/prime-selectors.example.json to config/prime-selectors.json and fill it in after running `npm run prime:explore`.',
  );
}

/** Fetch required selectors or fail loudly with the exact key that is missing. */
export function requireSelectors<K extends PrimeSelectorKey>(
  config: PrimeSelectorConfig,
  keys: readonly K[],
  capability?: PrimeCapability,
): Record<K, string> {
  const missing = keys.filter((key) => !config.selectors[key]);
  if (missing.length > 0) {
    throw new PrimeSelectorMissingError(
      `Loop Prime website layout is not configured for ${capability ?? 'this operation'}: missing selector(s) ${missing.join(
        ', ',
      )}. Run \`npm run prime:explore\` to inspect the live site and fill config/prime-selectors.json.`,
      missing[0],
      `Missing selectors: ${missing.join(', ')}`,
    );
  }
  return Object.fromEntries(keys.map((key) => [key, config.selectors[key]!])) as Record<K, string>;
}

/**
 * Capability report shown on the dashboard.
 *  - all selectors present + config.verified -> 'yes'
 *  - selectors present but unverified        -> 'unknown'
 *  - selectors missing                       -> 'unknown' (never a false 'yes')
 */
export function reportCapabilities(config: PrimeSelectorConfig): PrimeCapabilityReport[] {
  return (Object.keys(CAPABILITY_SELECTORS) as PrimeCapability[]).map((capability) => {
    if (capability === 'delete_setlist') {
      return {
        capability,
        supported: 'no',
        note: 'Intentionally unsupported: PCO Prime Sync never deletes a Prime setlist automatically.',
      };
    }
    const required = CAPABILITY_SELECTORS[capability];
    const missing = required.filter((key) => !config.selectors[key]);
    const customNote = config.capabilityNotes?.[capability];

    if (missing.length > 0) {
      return {
        capability,
        supported: 'unknown',
        note:
          customNote ??
          `Not configured yet: missing selector(s) ${missing.join(', ')}. Run \`npm run prime:explore\` and document the real control.`,
      };
    }
    if (!config.verified) {
      return {
        capability,
        supported: 'unknown',
        note:
          customNote ??
          'Selectors configured but not verified against the live site. Test manually before trusting this operation.',
      };
    }
    return {
      capability,
      supported: 'yes',
      note: customNote ?? 'Verified through the visible Loop website interface.',
    };
  });
}
