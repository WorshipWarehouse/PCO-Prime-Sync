# Setup and installation

Target platform: macOS (Apple Silicon or Intel), Node.js 22+. Linux works too; only the launchd step is macOS-specific.

## 1. Install

```bash
git clone https://github.com/<you>/pco-prime-sync.git
cd pco-prime-sync
npm install
npx playwright install chromium
cp .env.example .env
chmod 600 .env
```

`better-sqlite3` builds a native module. If your npm version blocks install scripts, allow it explicitly:

```bash
npm rebuild better-sqlite3
```

## 2. Credentials

### Planning Center Personal Access Token

Create the token once:

1. Open <https://api.planningcenteronline.com/oauth/applications>.
2. Create a Personal Access Token with access to **Services**.
3. Keep the **Application ID** and **Secret** to hand.

Then enter it in the app (recommended, no restart needed):

1. Start the app (`npm run dev`) **without** `PCO_PRIME_SYNC_MOCK=1`.
2. Settings → **Planning Center credentials**: paste the application id and secret.
3. **Test connection** — Planning Center answers live and lists the service types the token can see. Nothing is stored at this point.
4. **Save and connect** — the token is validated again, written to `.env` with `0600` permissions, and the running server switches to the real adapter immediately.
5. Pick the service types from the list, then **Load teams from Planning Center**.

Prefer the terminal? Add the same values to `.env` yourself and restart the server:

```dotenv
PCO_APP_ID=your-application-id
PCO_SECRET=your-secret
```

The secret is never stored in SQLite, never returned by the API and never logged.

### Optional: macOS Keychain instead of .env

```bash
security add-generic-password -a "$USER" -s pco-prime-sync -w '<paste secret here>'
```

Then in `.env`:

```dotenv
PCO_SECRET_KEYCHAIN_SERVICE=pco-prime-sync
PCO_SECRET_KEYCHAIN_ACCOUNT=$USER
PCO_APP_ID=your-application-id
```

The server reads the secret from the Keychain on start (macOS only). The dashboard shows which source is in use (`env`, `keychain` or `missing`).

## 3. Start the app

```bash
npm run dev
```

- API: <http://127.0.0.1:5178>
- Dashboard: <http://127.0.0.1:3000>

For a production-style local run:

```bash
npm run build
npm start        # serves the built dashboard and API on 127.0.0.1:5178
```

The server binds to loopback only. Do not expose it to the internet.

## 4. Configure Planning Center

1. Open the dashboard → **Settings**.
2. Enter one or more **service type IDs** (comma separated). The service type ID is the number in a Services URL, e.g. `https://services.planningcenteronline.com/services/123456/plans` → `123456`.
3. Save, then click **Load teams from Planning Center**.
4. Under **Worship teams**, tick only the teams whose scheduled members should receive the Loop setlist (for example *Worship Team*, *Vocalists*, *Band*). Leave **Audio**, **Camera**, **Livestream**, **Production** and similar teams unticked. Only ticked teams are ever shared with.
5. Open **Service plans** after a preview to see the imported plans, songs, arrangements, keys and scheduled worship musicians.

Songs are matched to multitracks the moment plan data is imported. Unique matches are saved automatically; ambiguous or missing matches appear under **Song matching**.

## 5. Connect Loop Community Prime

1. **Overview → Log in to Loop**. A visible Chromium window opens on the Prime app (`https://loopcommunity.com/prime-multitrack-app`) using the persistent profile in `profiles/prime` (git-ignored, owner-only permissions). The site then redirects itself to WorshipTools' shared sign-in — that redirect is the only correct way in, because the auth host needs parameters the site generates.
2. Log in yourself, including any 2FA. The app never asks for your password and never bypasses security controls.
3. Close the window or press Enter in `npm run prime:login` if you used the CLI.
4. **Overview** should now show the Loop session as authenticated when login indicators are configured (see next step).

### Derive the selector contract

Loop has no public API, so the automation needs to know how the real site is structured:

```bash
npm run prime:explore
```

Log in, navigate to your Prime setlists, press Enter in the terminal to capture the page, and repeat for the setlist view, the multitrack search and the Prime Team list. Captures land in `artifacts/prime-discovery/` (git-ignored).

Copy `config/prime-selectors.example.json` to `config/prime-selectors.json` (git-ignored) and fill it in from those captures. Then test the operations manually before setting `"verified": true`.

Details, including the key-editing limitation: [LOOP-AUTOMATION.md](LOOP-AUTOMATION.md).

## 6. Confirm mappings

**Song matching**: for each unmatched or ambiguous song, search the Loop account and choose the multitrack. Mappings are saved and reused on every future run; the app never purchases tracks.

**Team matching**: load Prime Team members, then confirm the member for each scheduled musician. Matching is by email only; ambiguous or missing emails are never guessed and no invitations are sent.

## 7. Run a synchronization

1. **Synchronization → Preview pending changes** — read the operations per plan.
2. **Dry run** — records a `dry_run` entry in history without touching Loop.
3. **Sync now** — executes and verifies the operations.
4. Review **Sync history → Details** and **Errors and warnings**.

The first run creates one setlist per plan and shares it with the matched worship musicians. Running it again must report zero changes (idempotent) — if it does not, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 8. Daily schedule

Default: every day at **03:00 America/New_York**, synchronizing the next **21 days**. Both are configurable in **Settings → Daily schedule**.

### Recommended: launchd (runs even when the dashboard is closed)

```bash
npm run schedule:install
launchctl print gui/$(id -u)/com.pcoprimesync.daily
npm run schedule:uninstall     # to remove
```

The plist is written to `~/Library/LaunchAgents/com.pcoprimesync.daily.plist`, uses the hour/minute/timezone from the database, sets `TZ`, and logs to `logs/sync.log` / `logs/sync.error.log`.

### Alternative: in-process scheduler

With **automatic synchronization** enabled, the running server checks the clock every 30 seconds and fires once per day at the configured local time (DST-safe via `Intl`). This only works while the server is running.

## 9. Backups

Everything is in one SQLite file (`data/pco-prime-sync.sqlite` by default) plus the Loop browser profile (`profiles/prime`). Back both up together; the profile is as sensitive as a password.

## 10. Verification checklist

- [ ] `npm test` passes
- [ ] Settings *Test connection* lists the expected service types
- [ ] Overview shows Planning Center connected and Loop authenticated
- [ ] Service plans show songs, keys, arrangements and only worship-team musicians
- [ ] Song and team mappings are confirmed
- [ ] Dry run lists exactly the operations you expect
- [ ] First real sync creates one setlist per plan with correct order and keys
- [ ] Second sync reports zero changes
- [ ] launchd job installed and `logs/sync.log` shows a scheduled run

## Mock/demo mode

To explore the UI with generated data and no credentials:

```bash
PCO_PRIME_SYNC_MOCK=1 npm run dev
```

Use mock mode to prove the app works locally before adding real credentials. When you are ready for the real thing, stop it and run `npm run dev` without the flag: the dashboard then accepts the Personal Access Token and the Loop login window. Mock mode refuses credential saving with `mock_mode` on purpose, so a demo server can never hold a real secret.

This never contacts Planning Center or Loop. Mock adapters are never selected implicitly, and the in-memory mock Loop keeps its setlists only for the life of that server process — which is exactly why repeated syncs in one session demonstrate idempotency (the second run reports zero changes).
