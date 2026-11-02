import type { Page } from 'playwright';
import type {
  PrimeCapability,
  PrimeCapabilityReport,
  PrimeSetlist,
  PrimeSetlistShare,
  PrimeSetlistTrack,
  PrimeSessionStatus,
  PrimeTeamMember,
  PrimeTrack,
} from '../../../shared/types';
import { normalizeEmail, normalizeSongName } from '../../../shared/naming';
import {
  PrimeActionError,
  PrimeSessionExpiredError,
  PrimeSelectorMissingError,
  PrimeUnsupportedError,
  PrimeVerificationError,
  type CreateSetlistInput,
  type PrimeAdapter,
} from '../adapter';
import { PrimeBrowserSession } from './session';
import {
  CAPABILITY_SELECTORS,
  reportCapabilities,
  requireSelectors,
  type PrimeSelectorConfig,
} from './selectors';

/**
 * Playwright implementation of the Loop Prime adapter.
 *
 * This adapter only ever uses the *visible* website: no private endpoints are
 * called and no requests are replayed. It is driven entirely by the selector
 * contract in config/prime-selectors.json, which must be filled in from a real
 * inspected session. When a control cannot be found, the operation fails loudly
 * (PrimeSelectorMissingError) instead of guessing.
 *
 * Every mutation is followed by a verification read of the setlist. If the
 * expected state is not visible afterwards, PrimeVerificationError is thrown and
 * the sync engine stops instead of retrying a destructive action.
 */
export class PlaywrightPrimeAdapter implements PrimeAdapter {
  readonly kind = 'playwright' as const;
  private readonly session: PrimeBrowserSession;
  private readonly config: PrimeSelectorConfig;

  constructor(session: PrimeBrowserSession) {
    this.session = session;
    this.config = session.selectorConfig;
  }

  capabilities(): PrimeCapabilityReport[] {
    return reportCapabilities(this.config);
  }

  async sessionStatus(): Promise<PrimeSessionStatus> {
    return this.session.status();
  }

  async openManualLogin(): Promise<void> {
    await this.session.openManualLogin();
  }

  async close(): Promise<void> {
    await this.session.close();
  }

  // -- internal helpers ----------------------------------------------------
  private async page(): Promise<Page> {
    const page = await this.session.page();
    page.setDefaultTimeout(this.session.actionTimeoutMs);
    return page;
  }

  private async assertAuthenticated(): Promise<Page> {
    const page = await this.page();
    const authenticated = await this.session.isAuthenticated();
    if (!authenticated) {
      throw new PrimeSessionExpiredError(
        'Loop Community Prime session is not authenticated. Open the dashboard and click "Log in to Loop", then re-run the sync.',
      );
    }
    return page;
  }

  private urlFor(kind: 'setlists' | 'trackSearch' | 'teamMembers'): string {
    const configured =
      kind === 'setlists'
        ? this.config.urls.setlists
        : kind === 'trackSearch'
          ? this.config.urls.trackSearch
          : this.config.urls.teamMembers;
    if (!configured) {
      throw new PrimeSelectorMissingError(
        `No ${kind} URL is configured in config/prime-selectors.json. Run \`npm run prime:explore\` to find it on the live site.`,
        undefined,
        `urls.${kind} missing`,
      );
    }
    if (/^https?:\/\//i.test(configured)) return configured;
    return `${this.session.baseUrl}${configured.startsWith('/') ? '' : '/'}${configured}`;
  }

  private async goto(page: Page, kind: 'setlists' | 'trackSearch' | 'teamMembers'): Promise<void> {
    const url = this.urlFor(kind);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (!(await this.session.isAuthenticated())) {
      throw new PrimeSessionExpiredError(`Loop Community redirected to a login screen while opening ${kind}.`);
    }
  }

  /** Read a stable id from an element using configured attributes, then href. */
  private async readId(
    element: ReturnType<Page['locator']>,
    attribute: string | undefined,
    selectorKey: string,
  ): Promise<string> {
    if (attribute) {
      const value = await element.getAttribute(attribute).catch(() => null);
      if (value) return value;
    }
    for (const fallback of ['data-id', 'data-testid']) {
      const value = await element.getAttribute(fallback).catch(() => null);
      if (value) return value;
    }
    const href = await element.getAttribute('href').catch(() => null);
    if (href) {
      const clean = href.split('?')[0]?.replace(/\/+$/, '') ?? '';
      const segment = clean.split('/').filter(Boolean).pop();
      if (segment) return segment;
    }
    throw new PrimeSelectorMissingError(
      `Could not read an id for ${selectorKey}. Add an attribute name to the "attributes" section of config/prime-selectors.json (for example the data attribute or link pattern the site uses).`,
      selectorKey,
    );
  }

  private async textOf(
    parent: ReturnType<Page['locator']>,
    selector: string,
    fallback?: 'title' | 'aria-label',
  ): Promise<string | null> {
    const locator = parent.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      const text = (await locator.innerText().catch(() => ''))?.trim();
      if (text) return text;
    }
    if (fallback === 'title') return parent.getAttribute('title');
    if (fallback === 'aria-label') return parent.getAttribute('aria-label');
    return null;
  }

  // -- setlists ------------------------------------------------------------
  async listSetlists(): Promise<PrimeSetlist[]> {
    this.requireAuthCapability('create_setlist');
    const page = await this.assertAuthenticated();
    await this.goto(page, 'setlists');
    const selectors = requireSelectors(this.config, ['setlistList', 'setlistListItem'], 'create_setlist');
    await page.locator(selectors.setlistList).first().waitFor({ state: 'visible' });

    const items = page.locator(selectors.setlistListItem);
    const count = Math.min(await items.count(), 200);
    const setlists: PrimeSetlist[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const name = await this.readSetlistName(item);
      if (!name) continue;
      const linkSelector = this.config.selectors.setlistListItemLink;
      const id = await this.readId(
        linkSelector ? item.locator(linkSelector).first() : item,
        this.config.attributes?.setlistId,
        'setlistListItemLink',
      ).catch(() => null);
      if (!id) continue;
      setlists.push({
        id,
        name,
        url: page.url(),
        tracks: [],
        shares: [],
      });
    }
    return setlists;
  }

  private async readSetlistName(item: ReturnType<Page['locator']>): Promise<string | null> {
    const explicit = this.config.selectors.setlistListItemName;
    if (explicit) {
      const text = await this.textOf(item, explicit);
      if (text) return text;
    }
    const link = this.config.selectors.setlistListItemLink
      ? await this.textOf(item, this.config.selectors.setlistListItemLink)
      : null;
    if (link) return link;
    const fallback = (await item.innerText().catch(() => ''))?.split('\n')[0]?.trim();
    return fallback || null;
  }

  private async openSetlist(page: Page, setlistId: string): Promise<void> {
    const selectors = requireSelectors(this.config, ['setlistList', 'setlistListItem'], 'add_track');
    await this.goto(page, 'setlists');
    await page.locator(selectors.setlistList).first().waitFor({ state: 'visible' });
    const items = page.locator(selectors.setlistListItem);
    const count = await items.count();
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const linkSelector = this.config.selectors.setlistListItemLink;
      const id = await this.readId(
        linkSelector ? item.locator(linkSelector).first() : item,
        this.config.attributes?.setlistId,
        'setlistListItemLink',
      ).catch(() => null);
      if (id !== setlistId) continue;
      if (linkSelector) {
        await item.locator(linkSelector).first().click();
      } else {
        await item.click();
      }
      await page.waitForLoadState('domcontentloaded');
      return;
    }
    throw new PrimeActionError(`Could not find the Prime setlist with id ${setlistId} on the setlists page`);
  }

  async getSetlist(setlistId: string): Promise<PrimeSetlist> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    return this.readOpenSetlist(page, setlistId);
  }

  /** Read the setlist currently displayed in the page. */
  private async readOpenSetlist(page: Page, setlistId: string): Promise<PrimeSetlist> {
    const selectors = requireSelectors(
      this.config,
      ['setlistTrackList', 'setlistTrackItem', 'setlistTrackTitle'],
      'change_key',
    );
    const titleSelector = this.config.selectors.setlistTitle;
    const name = titleSelector ? (await this.textOf(page.locator('body'), titleSelector)) : null;

    const list = page.locator(selectors.setlistTrackList).first();
    await list.waitFor({ state: 'visible' });
    const items = page.locator(selectors.setlistTrackItem);
    const count = await items.count();
    const tracks: PrimeSetlistTrack[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const title = await this.textOf(item, selectors.setlistTrackTitle);
      if (!title) {
        throw new PrimeSelectorMissingError(
          `Could not read a track title from setlistTrackItem #${index + 1}. The Loop layout may have changed — re-run \`npm run prime:explore\`.`,
          'setlistTrackTitle',
        );
      }
      const key = this.config.selectors.setlistTrackKey
        ? await this.textOf(item, this.config.selectors.setlistTrackKey)
        : null;
      const setlistTrackId = await this.readId(
        item,
        this.config.attributes?.setlistTrackId,
        'setlistTrackItem',
      );
      const trackId =
        (this.config.attributes?.trackId
          ? await item.getAttribute(this.config.attributes.trackId).catch(() => null)
          : null) ?? setlistTrackId;
      tracks.push({
        setlistTrackId,
        trackId,
        title: title.trim(),
        key: key ? key.trim() : null,
        position: index + 1,
      });
    }

    const shares = await this.readShares(page);
    return { id: setlistId, name: name?.trim() ?? '', url: page.url(), tracks, shares };
  }

  private async readShares(page: Page): Promise<PrimeSetlistShare[]> {
    const shareList = this.config.selectors.shareList;
    const memberItem = this.config.selectors.shareMemberItem;
    if (!shareList || !memberItem) return [];
    if (!(await page.locator(shareList).first().isVisible().catch(() => false))) return [];

    const items = page.locator(memberItem);
    const count = Math.min(await items.count(), 500);
    const shares: PrimeSetlistShare[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const text = (await item.innerText().catch(() => '')) ?? '';
      const emailMatch = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(text);
      const email = emailMatch ? normalizeEmail(emailMatch[0]) : null;
      const memberId = await this.readId(
        item,
        this.config.attributes?.memberId,
        'shareMemberItem',
      ).catch(() => email ?? `share-${index + 1}`);
      shares.push({
        memberId,
        memberName: text.split('\n')[0]?.trim() || email || `Member ${index + 1}`,
        email,
      });
    }
    return shares;
  }

  async createSetlist(input: CreateSetlistInput): Promise<PrimeSetlist> {
    if (input.tracks.length > 0) this.requireAuthCapability('add_track');
    if (input.shares.length > 0) this.requireAuthCapability('share_member');
    const page = await this.assertAuthenticated();
    await this.goto(page, 'setlists');
    const selectors = requireSelectors(
      this.config,
      ['createSetlistButton', 'setlistNameInput', 'createSetlistSubmitButton'],
      'create_setlist',
    );
    await page.locator(selectors.createSetlistButton).first().click();
    await page.locator(selectors.setlistNameInput).first().fill(input.name);
    await page.locator(selectors.createSetlistSubmitButton).first().click();
    await page.waitForLoadState('domcontentloaded');

    const match = (await this.listSetlists()).find(
      (setlist) => normalizeSongName(setlist.name) === normalizeSongName(input.name),
    );
    if (!match) {
      throw new PrimeVerificationError(
        `Created a setlist but it is not visible on the setlists page yet. Expected "${input.name}". Verify in the browser; the sync engine stopped to avoid duplicates.`,
      );
    }
    const created = await this.getSetlist(match.id);
    return created;
  }

  async addTrack(setlistId: string, input: { trackId: string; position: number; key: string | null }): Promise<void> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    const selectors = requireSelectors(
      this.config,
      ['trackSearchInput', 'trackSearchResult', 'trackSearchResultTitle', 'trackSearchAddButton'],
      'add_track',
    );

    if (this.config.selectors.trackSearchOpenButton) {
      await page.locator(this.config.selectors.trackSearchOpenButton).first().click();
    }
    const search = page.locator(selectors.trackSearchInput).first();
    await search.waitFor({ state: 'visible' });
    await search.fill(input.trackId);
    await search.press('Enter');

    const results = page.locator(selectors.trackSearchResult);
    await results.first().waitFor({ state: 'visible' });
    const count = Math.min(await results.count(), 50);
    let chosen: number | null = null;
    for (let index = 0; index < count; index += 1) {
      const id = await this.readId(results.nth(index), this.config.attributes?.trackId, 'trackSearchResult').catch(
        () => null,
      );
      if (id === input.trackId) {
        chosen = index;
        break;
      }
    }
    if (chosen === null) {
      throw new PrimeActionError(
        `Could not find Prime track ${input.trackId} in the search results. No track was added.`,
      );
    }
    const result = results.nth(chosen);
    const addButton = result.locator(selectors.trackSearchAddButton).first();
    if (await addButton.count()) await addButton.click();
    else await result.click();
    await page.waitForLoadState('domcontentloaded');

    const after = await this.getSetlist(setlistId);
    const added = after.tracks.find((track) => track.trackId === input.trackId);
    if (!added) {
      throw new PrimeVerificationError(
        `Track ${input.trackId} is not visible in setlist ${setlistId} after adding it. Stopping to avoid duplicates.`,
      );
    }

    // Apply the Planning Center key through the same visible key control used by
    // setTrackKey. Never touch BPM, tempo or mix settings.
    if (input.key && this.capabilities().some((c) => c.capability === 'change_key' && c.supported === 'yes')) {
      await this.setTrackKey(setlistId, added.setlistTrackId, input.key);
    }
  }

  async removeTrack(setlistId: string, setlistTrackId: string): Promise<void> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    const selectors = requireSelectors(
      this.config,
      ['setlistTrackItem', 'trackRemoveButton'],
      'remove_track',
    );
    const item = await this.findTrackItem(page, setlistTrackId);
    await item.locator(selectors.trackRemoveButton).first().click();
    if (this.config.selectors.trackConfirmButton) {
      await page.locator(this.config.selectors.trackConfirmButton).first().click().catch(() => undefined);
    }
    await page.waitForLoadState('domcontentloaded');

    const after = await this.getSetlist(setlistId);
    if (after.tracks.some((track) => track.setlistTrackId === setlistTrackId)) {
      throw new PrimeVerificationError(`Track ${setlistTrackId} is still present after removing it.`);
    }
  }

  private async findTrackItem(page: Page, setlistTrackId: string): Promise<ReturnType<Page['locator']>> {
    const itemSelector = requireSelectors(this.config, ['setlistTrackItem'], 'remove_track').setlistTrackItem!;
    const items = page.locator(itemSelector);
    const count = await items.count();
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const id = await this.readId(item, this.config.attributes?.setlistTrackId, 'setlistTrackItem').catch(
        () => null,
      );
      if (id === setlistTrackId) return item;
    }
    throw new PrimeActionError(`Track ${setlistTrackId} is not visible in the setlist`);
  }

  async reorderTracks(setlistId: string, orderedSetlistTrackIds: string[]): Promise<void> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    requireSelectors(
      this.config,
      ['setlistTrackItem', 'trackMoveUpButton', 'trackMoveDownButton'],
      'reorder_tracks',
    );

    // Move each track into place from the top using the site's own move controls.
    for (let targetIndex = 0; targetIndex < orderedSetlistTrackIds.length; targetIndex += 1) {
      const desiredId = orderedSetlistTrackIds[targetIndex]!;
      for (let guard = 0; guard < 100; guard += 1) {
        const current = await this.readOpenSetlist(page, setlistId);
        const currentIndex = current.tracks.findIndex((track) => track.setlistTrackId === desiredId);
        if (currentIndex === -1) {
          throw new PrimeVerificationError(`Cannot reorder: track ${desiredId} disappeared from the setlist.`);
        }
        if (currentIndex === targetIndex) break;
        const item = await this.findTrackItem(page, desiredId);
        const moveButton =
          currentIndex > targetIndex
            ? this.config.selectors.trackMoveUpButton!
            : this.config.selectors.trackMoveDownButton!;
        await item.locator(moveButton).first().click();
        await page.waitForTimeout(300);
      }
    }

    const after = await this.getSetlist(setlistId);
    const order = after.tracks.map((track) => track.setlistTrackId);
    const expected = orderedSetlistTrackIds.filter((id) => order.includes(id));
    const actual = order.filter((id) => expected.includes(id));
    if (expected.join('|') !== actual.join('|')) {
      throw new PrimeVerificationError(
        'Setlist track order does not match the desired order after reordering. Check whether the site uses drag-and-drop only.',
      );
    }
  }

  async setTrackKey(setlistId: string, setlistTrackId: string, key: string): Promise<void> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    requireSelectors(this.config, ['setlistTrackItem', 'trackKeyButton', 'trackKeyOption'], 'change_key');

    const item = await this.findTrackItem(page, setlistTrackId);
    await item.locator(this.config.selectors.trackKeyButton!).first().click();
    const option = page
      .locator(this.config.selectors.trackKeyOption!)
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(key)}\\s*$`, 'i') })
      .first();
    if (!(await option.count())) {
      throw new PrimeActionError(
        `The Loop key control does not offer "${key}" for this track. The key was NOT changed.`,
      );
    }
    await option.click();
    if (this.config.selectors.trackKeySaveButton) {
      await page.locator(this.config.selectors.trackKeySaveButton).first().click().catch(() => undefined);
    }
    await page.waitForLoadState('domcontentloaded');

    const after = await this.getSetlist(setlistId);
    const track = after.tracks.find((candidate) => candidate.setlistTrackId === setlistTrackId);
    if (!track) throw new PrimeVerificationError('Track disappeared while changing its key.');
    if (track.key && normalizeSongName(track.key) !== normalizeSongName(key)) {
      throw new PrimeVerificationError(
        `Setlist track key still reads "${track.key}" after setting "${key}".`,
      );
    }
  }

  async shareMember(setlistId: string, memberId: string): Promise<void> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    const selectors = requireSelectors(
      this.config,
      ['shareOpenButton', 'shareSearchInput', 'shareMemberOption', 'shareConfirmButton'],
      'share_member',
    );
    await page.locator(selectors.shareOpenButton).first().click();
    const search = page.locator(selectors.shareSearchInput).first();
    await search.waitFor({ state: 'visible' });
    await search.fill(memberId);
    await page.waitForTimeout(400);

    const options = page.locator(selectors.shareMemberOption);
    await options.first().waitFor({ state: 'visible' });
    const count = Math.min(await options.count(), 50);
    let clicked = false;
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      if ((await option.innerText().catch(() => '')).toLowerCase().includes(memberId.toLowerCase())) {
        await option.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      throw new PrimeActionError(`Prime team member ${memberId} was not offered by the share dialog.`);
    }
    await page.locator(selectors.shareConfirmButton).first().click();
    await page.waitForLoadState('domcontentloaded');

    const after = await this.getSetlist(setlistId);
    if (!after.shares.some((share) => share.memberId === memberId)) {
      throw new PrimeVerificationError(`Member ${memberId} is not listed as shared after the share action.`);
    }
  }

  async unshareMember(setlistId: string, memberId: string): Promise<void> {
    const page = await this.assertAuthenticated();
    await this.openSetlist(page, setlistId);
    const selectors = requireSelectors(
      this.config,
      ['shareList', 'shareMemberItem', 'shareRemoveButton'],
      'unshare_member',
    );
    if (!(await page.locator(selectors.shareList).first().isVisible().catch(() => false))) {
      throw new PrimeActionError('Prime does not show a share list for this setlist, so sharing cannot be removed.');
    }
    const items = page.locator(selectors.shareMemberItem);
    const count = await items.count();
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const id = await this.readId(
        item,
        this.config.attributes?.memberId,
        'shareMemberItem',
      ).catch(() => null);
      if (id !== memberId) continue;
      await item.locator(selectors.shareRemoveButton).first().click();
      await page.waitForLoadState('domcontentloaded');
      const after = await this.getSetlist(setlistId);
      if (after.shares.some((share) => share.memberId === memberId)) {
        throw new PrimeVerificationError(`Member ${memberId} is still shared after removing them.`);
      }
      return;
    }
    // Not shared in the UI already: nothing to do, but do not claim success.
    throw new PrimeActionError(`Member ${memberId} is not listed in the setlist's share list.`);
  }

  async listTeamMembers(): Promise<PrimeTeamMember[]> {
    const page = await this.assertAuthenticated();
    await this.goto(page, 'teamMembers');
    const selectors = requireSelectors(this.config, ['teamMemberItem', 'teamMemberEmail'], 'list_team_members');
    const items = page.locator(selectors.teamMemberItem);
    await items.first().waitFor({ state: 'visible' });
    const count = Math.min(await items.count(), 500);
    const members: PrimeTeamMember[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const rawEmail =
        (await this.textOf(item, selectors.teamMemberEmail)) ??
        (await item.innerText().catch(() => '')).match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0] ??
        null;
      if (!rawEmail) continue;
      const email = normalizeEmail(rawEmail);
      const name = this.config.selectors.teamMemberName
        ? await this.textOf(item, this.config.selectors.teamMemberName)
        : (await item.innerText().catch(() => '')).split('\n')[0] ?? null;
      const memberId = await this.readId(
        item,
        this.config.attributes?.memberId,
        'teamMemberItem',
      ).catch(() => email);
      members.push({ id: memberId, name: name?.trim() || email, email, rawEmail: rawEmail.trim(), role: null });
    }
    return members;
  }

  async listTracks(query: string): Promise<PrimeTrack[]> {
    const page = await this.assertAuthenticated();
    await this.goto(page, 'trackSearch');
    const selectors = requireSelectors(
      this.config,
      ['trackSearchInput', 'trackSearchResult', 'trackSearchResultTitle'],
      'search_tracks',
    );
    const search = page.locator(selectors.trackSearchInput).first();
    await search.waitFor({ state: 'visible' });
    await search.fill(query);
    await search.press('Enter');
    await page.waitForTimeout(800);

    const results = page.locator(selectors.trackSearchResult);
    if (!(await results.first().isVisible().catch(() => false))) return [];
    const count = Math.min(await results.count(), 50);
    const tracks: PrimeTrack[] = [];
    for (let index = 0; index < count; index += 1) {
      const result = results.nth(index);
      const title = await this.textOf(result, selectors.trackSearchResultTitle);
      if (!title) continue;
      const id = await this.readId(result, this.config.attributes?.trackId, 'trackSearchResult');
      tracks.push({
        id,
        title: title.trim(),
        subtitle: null,
        arrangements: [],
        availableKeys: [],
        url: await result.getAttribute('href').catch(() => null),
      });
    }
    return tracks;
  }

  private requireAuthCapability(capability?: PrimeCapability): void {
    if (!capability) return;
    const reports = this.capabilities();
    const report = reports.find((entry) => entry.capability === capability);
    if (report && report.supported === 'no') {
      throw new PrimeUnsupportedError(
        `Loop Prime operation "${capability}" is not supported by the configured automation: ${report.note}`,
        capability,
      );
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
