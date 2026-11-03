# Loop Community Prime automation

There is no public Loop Community API. PCO Prime Sync drives the **visible website** with Playwright, using a persistent Chromium profile and a selector contract that must be derived from a real, logged-in session. This document states exactly what is implemented, what is verified, and what is still unknown.

## Principles

- Only the visible website is used: no undocumented endpoints, no request replay, no reverse-engineered internals.
- CAPTCHA, two-factor authentication and other security controls are never bypassed. If Loop asks for them, a human completes them.
- The browser runs visibly by default (`PRIME_HEADLESS=false`).
- Any operation whose control cannot be found fails loudly instead of guessing.
- A mutation is only reported as successful after the resulting state is visible in the browser.
- Tracks are never purchased, and no Prime team member is ever invited.

## What is implemented

| Capability | Application code | Verified against live Loop? |
| --- | --- | --- |
| Persistent profile + manual login | `PrimeBrowserSession`, `npm run prime:login`, dashboard button | Depends on your environment — the app never stores your password |
| Session detection | `loggedInIndicator` / `loggedOutIndicator` selectors | Requires configured selectors |
| List setlists | `PlaywrightPrimeAdapter.listSetlists` | Requires configured selectors |
| Search owned multitracks | `listTracks` | Requires configured selectors |
| Create setlist | `createSetlist` (verifies the new name is visible) | Requires configured selectors |
| Rename setlist | `renameSetlist` (verifies the displayed name) | Requires configured selectors |
| Add track (+ key) | `addTrack` (verifies the track appears) | Requires configured selectors and a key control |
| Remove track | `removeTrack` (verifies it is gone) | Requires configured selectors |
| Reorder tracks | `reorderTracks` via move up/down controls | Requires configured selectors |
| Change key | `setTrackKey` (verifies the displayed key) | **Unknown until tested** — see below |
| Share with a member | `shareMember` (verifies the share list) | Requires configured selectors |
| Unshare a member | `unshareMember` | **Unknown until tested** |
| Read Prime Team members | `listTeamMembers` | Requires configured selectors |
| Delete setlist | Not implemented on purpose | Never |

## Sign-in: Loop Community uses WorshipTools' shared identity

Loop Community is part of WorshipTools, and Prime signs in through its shared identity service. That is why the login window opens a Loop page instead of an auth URL: the sign-in form only appears when an app requests it with parameters it generates.

`https://auth.worshiptools.com/login` on its own answers `302 → https://www.worshiptools.com`, WorshipTools' corporate home, which contains no form — measured in a clean Chromium profile: zero password fields, zero email fields, with and without the common `redirect`/`returnTo`/`app`/`client_id` parameters. The login window opens the shared sign-in URL itself, and the response reports where the site lands it — `https://loopcommunity.com/prime-multitrack-app` answers `200` and presents an email field for comparison.

`PRIME_LOGIN_URL` overrides the window's start page, which is what the administrator asked for, so the window is never moved anywhere else. If the configured page lands on the WorshipTools home page, the response says so and reports how many email and password fields that page actually had, rather than silently relocating or claiming a working sign-in page.

## Discovering the real UI

```bash
npm run prime:login     # opens the Prime app, which redirects to the sign-in; session saved in the profile
npm run prime:explore   # capture pages while you navigate as a normal user
```

The explorer writes `artifacts/prime-discovery/capture-*.json|html|png` containing the URL, page title, visible text, HTML and every interactive element (tag, role, accessible name). Use it to write real selectors into `config/prime-selectors.json` (start from `config/prime-selectors.example.json`; the real file is git-ignored).

Pages worth capturing:

1. the Prime setlists list (setlist list + create button + name field)
2. an open setlist (track list, track key control, share control)
3. the "add song / discover tracks" search
4. the Prime Team member list

## The selector contract

`config/prime-selectors.json`:

```jsonc
{
  "version": 1,
  "verified": false,          // flip to true only after manual testing
  "urls": {
    "setlists": "/my-prime/setlists",
    "trackSearch": "/...",     // page used to search the account's multitracks
    "teamMembers": "/..."
  },
  "selectors": {
    "loggedInIndicator": "…",
    "setlistList": "…",
    "setlistListItem": "…",
    "setlistTrackItem": "…",
    "setlistTrackTitle": "…",
    "setlistTrackKey": "…",
    "trackKeyButton": "…",
    "trackKeyOption": "…"
    // …see config/prime-selectors.example.json for the full list
  },
  "attributes": {
    "setlistId": "data-setlist-id",   // or leave empty to read ids from links
    "trackId": "…",
    "setlistTrackId": "…",
    "memberId": "…"
  },
  "capabilityNotes": {
    "change_key": "How the visible UI changes a setlist track key (verified on <date>)"
  }
}
```

Capability status on the dashboard is derived from this file:

- all required selectors present **and** `verified: true` → `yes`
- selectors present but unverified → `unknown`
- selectors missing → `unknown` (never a false `yes`)

Stable ids are read from the configured attributes, then `data-id`/`data-testid`, then the last segment of a link. If none can be read, the operation fails with a message asking for an attribute name rather than proceeding with an unstable identifier.

## Key editing: an investigated limitation, not a workaround

Planning Center owns the key. The adapter offers `setTrackKey(setlistId, setlistTrackId, key)` and the sync engine records `key_change` operations when the PCO key differs.

Key editing through the visible Loop interface has **not been confirmed**. Until it is:

- `change_key` reports `unknown` on the dashboard;
- pending key changes are recorded as `flag_review` entries and `sync_errors` rows (`prime_capability_unsupported`) with the exact from/to keys;
- everything else (setlist creation, tracks, order, sharing) continues to work;
- the engine never writes BPM, tempo, time signature, volume or mix settings.

To enable key sync later:

1. Inspect a real setlist in `npm run prime:explore` and find the key control (if one exists).
2. Fill `trackKeyButton`, `trackKeyOption` (and optionally `trackKeySaveButton`).
3. Test `setTrackKey` manually on a scratch setlist.
4. Set `verified: true` and note it in `capabilityNotes.change_key`.

If Loop does not allow changing a setlist track's key through the website, leave the selectors empty: the app will keep reporting the limitation and never fake it.

## Sharing and unsharing

Sharing requires `shareOpenButton`, `shareSearchInput`, `shareMemberOption`, `shareConfirmButton`; verification reads the setlist's share list (`shareList`, `shareMemberItem`). Removing an individual member from an existing setlist is a separate capability (`shareRemoveButton`); if Prime does not expose it, unshares are recorded as unsupported rather than claimed.

Sharing is idempotent: the engine diffs the currently shared members against the desired worship musicians before acting, and a person scheduled on several teams is shared with once.

## Reordering

Reordering uses the site's own move up/down controls (`trackMoveUpButton`, `trackMoveDownButton`), moving each track into place and then verifying the resulting order. Drag-and-drop-only interfaces are not simulated: if no move control exists, reorder is reported as unsupported.

## Failure handling

| Error | Meaning | Engine behaviour |
| --- | --- | --- |
| `PrimeSessionExpiredError` | Not logged in / session expired | Pause the run, record the error, ask for manual login |
| `PrimeSelectorMissingError` | A configured control was not found | Stop that plan, keep other plans working |
| `PrimeActionError` | An expected control existed but the action was refused (e.g., key not offered) | Stop that plan, record the error |
| `PrimeUnsupportedError` | Capability explicitly unsupported | Record the limitation, continue |
| `PrimeVerificationError` | The site does not show the expected result | Stop the whole run — remote state is uncertain |

No destructive action is retried after an unverified result; the administrator reviews the setlist in the browser and resolves the error in the dashboard.

## Testing checklist for a real church

1. `npm run prime:login` works and the dashboard shows `authenticated`.
2. `listSetlists`, `listTracks`, `listTeamMembers` return real data (Song/Team matching pages).
3. Dry run produces a preview that matches what you see in Loop.
4. Real sync on a single test plan creates the setlist with the right name, tracks and order.
5. Change the PCO key, sync again, and confirm the key changed in Prime (or confirm the recorded limitation).
6. Add/remove a worship musician in PCO, sync, and confirm sharing.
7. Run the sync twice and confirm the second run reports zero changes.
8. Only then set `verified: true` in `config/prime-selectors.json`.

Record the Loop plan/account layout and the date of the test in `capabilityNotes` so future maintainers know what was verified.
