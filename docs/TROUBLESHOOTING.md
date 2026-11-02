# Troubleshooting

Everything below refers to the local app. Errors are also visible in **Synchronization → Errors and warnings** with a stable `code`.

## Dashboard

**`PCO Prime Sync could not start in this browser` and the error names `/main.tsx`**
`/main.tsx` is the development entry point, so the page you loaded is the unbuilt `client/index.html`, and whatever answered on port 3000 did not compile TypeScript. `npm run dev` puts Vite on port 3000; if that port was already held by an older process (a previous run, a static file server, `vite preview`), Vite used to give the port up silently and the old process kept answering with the raw source file. Find it and stop it:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN    # note the PID, then
kill <PID>
npm run dev                        # dashboard: http://127.0.0.1:3000
```

Vite now fails with `Port 3000 is already in use` instead of quietly moving to 3001, so this cannot happen unnoticed again. The `Failed to load …` line under **Browser:** states the HTTP status and content type, which separates a stale server (HTML or the wrong type on that port) from a missing file (404).

A 404 on one client module is enough to kill the whole page: the browser console shows `Failed to load resource … 404` for that file and the entry never runs. The dev proxy used to swallow the client's own `/api.ts` because its key was the bare prefix `/api`; it is now anchored to `/api/`, so only real API calls are forwarded.

**Blank page with the correct title and no message**
That means the module bundle was rejected before the app could run. Reload with the cache disabled, restart `npm run dev` (or re-run `npm run build` for `npm start`), and check the browser console. For a production run, confirm you are on the URL `npm start` prints — the server rejects writes from a different host or port.

## Planning Center

**`Planning Center credentials are not configured`**
No token is stored. Open Settings, paste the Personal Access Token, press *Test connection*, then *Save and connect*. (You can still add `PCO_APP_ID` / `PCO_SECRET` to `.env` and restart instead. If you use the Keychain, check `PCO_SECRET_KEYCHAIN_SERVICE` and that you are on macOS.)

**`mock_mode` when saving a token**
The server is running with `PCO_PRIME_SYNC_MOCK=1`. Stop it and start `npm run dev` without the flag — a demo server intentionally refuses to store real credentials.

**The token tests fine but plan import fails**
`Test connection` only proves the token can read service types. Confirm the token has **Services** access, that the service type ids are the numeric ids from the Services URL, and check **Errors and warnings** for the exact PCO failure.

**Saving the token did not require a restart — is that expected?**
Yes. The server revalidates the token, writes `.env` (mode `0600`), reloads its environment and swaps the Planning Center adapter in place.

**`Planning Center rejected the credentials` (401/403)**
Regenerate the Personal Access Token, make sure it has Services access, and verify the app ID belongs to the same token. Secrets are read once at startup — restart after changing them.

**`No Planning Center service types are selected`**
Add service type IDs in Settings (the number in a Services URL).

**Plans are missing**
Plans are listed by `sort_date` inside the configured window (default today + 21 days). Increase *Future days to synchronize* if the plan is further out. Plans without items are imported but produce no setlist.

**Musicians are missing**
Only people scheduled on teams ticked under **Worship teams** are included, and declined volunteers are excluded. Add the team in Settings (Save → *Load teams*). If PCO has no email for a person, they appear under **Team matching** as needing review instead of being matched by name.

**Rate limiting / slow first preview**
The PCO client throttles to ~1 request per 650 ms and retries 429/5xx with backoff. A first import of several plans can take a minute; subsequent runs reuse caches and are much faster.

## Loop Community Prime

**`Loop Community Prime session is not authenticated` / `needs_login`**
Click **Overview → Log in to Loop**, log in in the window (including 2FA), then sync again. The session is stored in the persistent profile; it survives restarts but not a manual sign-out or a Loop-side expiry.

**`Log in to Loop` reports it cannot open a window**
The browser opens on the machine that runs the server, so a remote or headless host cannot show it — this is common when the app runs in a container or on another box. The message now includes the real reason. Run `npm run dev` on your own Mac to log in; the session is stored in `profiles/prime` on that machine. A missing Chromium also produces this error: run `npx playwright install chromium`.

**`Log in to Loop` lands on WorshipTools' home page**
Loop Community is part of WorshipTools and signs in through its shared identity service. The window opens `https://auth.worshiptools.com/login` and stays on whatever page the site sends it to; the response reports the final URL and how many email and password fields it found. If you would rather start at the page that presents a form, set `PRIME_LOGIN_URL=https://loopcommunity.com/prime-multitrack-app`.

**`Login state cannot be detected yet`**
No `loggedInIndicator`/`loggedOutIndicator` selector is configured. Run `npm run prime:explore` and fill `config/prime-selectors.json`. The login window still saves the Loop session cookies into the profile — closing it after signing in is enough for the next stage; only the *reported* state waits for selectors.

**`Loop Prime website layout is not configured for …: missing selector(s) …`**
Expected until the selector contract is filled from the real site. Run the explorer, add the selectors, and re-test. The app intentionally refuses to guess.

**`The Loop key control does not offer "X" for this track`**
The track may not support that key. Nothing was changed. Adjust the key in Loop manually, or fix the PCO key.

**Key changes never apply, only `flag_review` entries**
Key editing is not verified for your Loop layout. See [LOOP-AUTOMATION.md](LOOP-AUTOMATION.md#key-editing-an-investigated-limitation-not-a-workaround). Everything else still syncs.

**`Prime does not show a share list … sharing cannot be removed`**
Removing an individual member is not supported by the visible interface for your account. Remove them manually in Loop; the app will keep flagging it rather than pretending.

**`A setlist was created but it is not visible … stopping to avoid duplicates`**
The run stopped after a verification failure. Open Loop, confirm whether the setlist exists, then run a preview. If you deleted your local database while setlists exist in Loop, the app will try to create duplicates — do not reset the database casually.

## Synchronization

**Second run still shows changes**
Check whether the Loop state can be read back: if `setlistTrackKey` or `setlistTrackItem` selectors are wrong or the site renames tracks, the diff cannot converge. Open **Sync history → Details** and look for repeated `key_change` or `add_track` entries.

**A plan is `blocked`**
At least one song is unmatched/ambiguous, no Default/Original arrangement exists, or the setlist disappeared from Loop. Resolve it under **Song matching**, or decide manually whether the setlist should be recreated (the app never recreates automatically).

**A plan is `missing_in_pco`**
Planning Center no longer returns the plan. Its Prime setlist was intentionally left in place. Delete it manually in Loop if it is truly obsolete.

**`stopped after an unverified change (remote state uncertain)`**
A browser action could not be verified. Review the affected setlist in Loop, fix anything obviously wrong, then run a dry run; do not let the scheduler fire again until the state is understood.

**`Sync now` does nothing / "already running"**
Only one run is allowed at a time. Check `GET /api/sync/status` or refresh the Synchronization tab.

**BPM changed in Planning Center and Loop did not**
Correct — BPM is deliberately ignored. The app has no code path to write BPM, tempo, mix or volume.

## Scheduling

**The daily job never fires**
`npm run schedule:install` requires macOS. Confirm the agent exists:

```bash
launchctl print gui/$(id -u)/com.pcoprimesync.daily
tail -50 logs/sync.error.log
```

launchd runs the job at the configured hour/minute in the configured timezone; if the Mac is asleep, it runs when it wakes. The in-process scheduler only works while `npm start`/`npm run dev` is running.

**Sync fails only when run from launchd**
launchd has a minimal environment: absolute paths are required (the generated plist uses the current Node binary path and `WorkingDirectory`). If you upgrade Node, re-run `npm run schedule:install`.

## Security-related

**`Missing x-pco-prime-sync header`**
Mutating API calls must come from the dashboard. If you script against the API, send `x-pco-prime-sync: 1`; when `ADMIN_TOKEN` is set, also send `x-admin-token`.

**`Cross-origin request rejected`**
The server only accepts writes from its own origin. Open the dashboard at the URL printed by `npm start` rather than a different host/port.

**I think my Loop profile leaked**
Sign out of Loop Community in a normal browser, then delete `profiles/prime` and log in again with `npm run prime:login`. Deleting the profile invalidates the stored session cookies.
