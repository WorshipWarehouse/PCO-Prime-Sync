# PCO Prime Sync

Local, open-source synchronization between **Planning Center Services** and **Loop Community Prime** setlists.

PCO Prime Sync reads your church's service plans from Planning Center, matches each song to multitracks that already exist in your Loop Prime account, builds one Prime setlist per plan, applies the Planning Center key, and shares the setlist with the worship musicians who are scheduled. It runs on your Mac, stores everything in a local SQLite database, and reconciles changes once a day.

- Planning Center is the **source of truth** for song names, order, keys and scheduled worship musicians.
- Loop Prime is only ever changed through its **visible website** via Playwright. No private APIs, no CAPTCHA/2FA bypasses, no purchases.
- No cloud services, no paid APIs, no AI. Internet is needed only to reach Planning Center and Loop Community.

---

## Status (read this first)

This repository is a working application with honest boundaries. What that means today:

| Area | State |
| --- | --- |
| Local dashboard, SQLite schema, mappings, change detection, idempotency, scheduler, tests | **Implemented and tested** (100 Vitest tests, mocked adapters) |
| Planning Center reads (plans, items, arrangements, keys, team members, emails) | **Implemented against the official Services API v2 documentation**, not yet exercised against a live account from this workspace |
| Planning Center credentials | Required to fetch real data — see [docs/SETUP.md](docs/SETUP.md) |
| Loop Prime setlist creation, adding tracks, reordering, sharing | **Structured but unverified**: driven by a selector contract that must be filled from a real, logged-in Loop session (`npm run prime:explore`) |
| Renaming a Prime setlist when the plan title changes | **Implemented** through the same selector contract (`rename_setlist`), verified by re-reading the displayed name; needs those selectors before it runs against real Loop |
| Loop key editing | **Unknown until inspected.** If the visible Loop interface cannot change a setlist track key, the app records the limitation and leaves the rest working (see [docs/LOOP-AUTOMATION.md](docs/LOOP-AUTOMATION.md)) |
| Removing an individual member from a Prime setlist | **Unknown until inspected** — reported as a limitation rather than faked |
| Deleting Prime setlists | **Never done automatically** by design |

Nothing in this app invents selectors, endpoints or successful browser actions. Every Loop operation requires configured, verified selectors; otherwise it stops and records an error, and the dashboard shows the capability as `unknown`.

To exercise the whole pipeline without credentials:

```bash
npm install
PCO_PRIME_SYNC_MOCK=1 npm run dev     # dashboard with in-memory demo data
PCO_PRIME_SYNC_MOCK=1 npm run sync    # end-to-end mock sync in the terminal
```

The mock adapters are never used automatically in production: they require `--mock` / `PCO_PRIME_SYNC_MOCK=1` / `new Services({ mock: true })`.

Mock Loop state lives in memory for the lifetime of one process. In the dev server this makes repeated syncs idempotent (run twice and the second run applies zero changes); the one-shot `npm run sync -- --mock` CLI starts a fresh mock Loop each time, so a second invocation correctly reports the previously recorded setlists as missing. Use the dev server for a repeatable demo.

### Test locally in three stages

The order matters, because each stage isolates one kind of failure:

1. **App runs, no credentials** — `PCO_PRIME_SYNC_MOCK=1 npm run dev`. Confirm the dashboard, plan import, matching screens, preview, dry run and a second sync with zero changes. Nothing outside your Mac is touched.
2. **Real token and real Loop login** — restart without the mock flag (`npm run dev`), then in **Settings** paste the PCO Personal Access Token, press *Test connection* (Planning Center answers with the service types the token can see), *Save and connect*, choose the service types and load teams. Then **Overview → Log in to Loop** and sign in by hand in the Chromium window. This stage proves credentials and the session without writing a single setlist.
3. **Real setlists** — `npm run prime:explore` to fill `config/prime-selectors.json` from the real Loop UI, verify one plan manually, then preview → dry run → sync. This is the first stage that can change Loop, and it only starts after the earlier stages are green.

Each stage keeps the next one's failure understandable: a bad token never looks like a broken selector, and an unauthenticated Loop session never looks like a PCO problem.

---

## Requirements

- macOS (Apple Silicon supported) or Linux; Node.js **22+**
- A Planning Center **Personal Access Token** with Services access
- A Loop Community account with Prime setlists and Prime Teams
- Chromium installed for Playwright (`npx playwright install chromium`)

## Quick start

```bash
git clone https://github.com/<you>/pco-prime-sync.git
cd pco-prime-sync
npm install
npx playwright install chromium

cp .env.example .env
chmod 600 .env         # optional — you can also paste the token in Settings

npm run dev            # API on 127.0.0.1:5178 + dashboard on 127.0.0.1:3000
```

Then in the dashboard:

1. **Settings → Planning Center**: paste the Personal Access Token → *Test connection* (it lists the service types that token can see) → *Save and connect* → pick service types → *Load teams from Planning Center*.
2. Select only the **worship teams** (not audio, camera, livestream, production).
3. **Overview → Log in to Loop** and sign in manually in the Chromium window.
4. `npm run prime:explore` to derive the selector contract from the real Loop site, then fill `config/prime-selectors.json`.
5. **Song matching / Team matching**: confirm mappings.
6. **Synchronization → Preview pending changes**, then *Dry run*, then *Sync now*.
7. Install the daily job: `npm run schedule:install` (launchd, America/New_York by default).

Full instructions: [docs/SETUP.md](docs/SETUP.md).

## How synchronization behaves

| Planning Center change | Loop Prime action |
| --- | --- |
| New service plan | Create a setlist named `<Plan name> — <Month D, YYYY>` |
| Plan title changed | Rename the existing setlist in place; it is never recreated |
| New song | Add the matched multitrack |
| Song removed | Remove the corresponding setlist track |
| Song reordered | Reorder the setlist |
| Song key changed | Change the key (only the key) |
| BPM changed | **Nothing** |
| Musician added (worship team) | Share the setlist |
| Musician removed | Unshare, if the visible site supports it |
| Plan deleted in PCO | Flag for review; **never delete the setlist** |

Safety rules encoded and tested:

- A plan with an unmatched or ambiguous song is **not written at all** — no partial setlists.
- Ambiguous multitrack matches are never auto-picked; ambiguous emails are never guessed.
- Every mutation is followed by a verification read; an unverifiable result stops the run.
- An expired Loop session pauses the run instead of retrying destructive actions.
- Tracks are never purchased, and settings unrelated to the sync (BPM, tempo, mix, volume) are never touched.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + Vite dashboard (development) |
| `npm run build` | Typecheck and build the dashboard into `dist/client` |
| `npm start` | Run the API and serve the built dashboard |
| `npm test` | Vitest suite (normalization, matching, planner, engine, scheduler) |
| `npm run sync` | One-shot sync (add `-- --dry-run`, `-- --mock`) |
| `npm run prime:login` | Open the persistent Loop browser profile for manual login |
| `npm run prime:explore` | Capture the real Loop UI to fill the selector contract |
| `npm run schedule:install` | Install the macOS launchd daily job |
| `npm run schedule:uninstall` | Remove the launchd job |
| `npm run db:reset -- --yes` | Delete the local database |

## Security

- Credentials live only in `.env` (git-ignored, `0600`) or the macOS Keychain, and are never sent back to the browser. The Settings form tests the token against Planning Center before writing it and never stores it in SQLite.
- Browser profile directories are git-ignored and created with owner-only permissions.
- The server binds to `127.0.0.1` by default, rejects cross-origin mutations, requires an explicit `x-pco-prime-sync` header on writes, and supports an optional `ADMIN_TOKEN`.
- Logs never include tokens, cookies or passwords.

See [docs/SETUP.md § Credentials](docs/SETUP.md#credentials) and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, database schema, matching and safety model
- [docs/SETUP.md](docs/SETUP.md) — installation, credentials, daily schedule
- [docs/LOOP-AUTOMATION.md](docs/LOOP-AUTOMATION.md) — exactly how the Loop automation works, what is verified, and what is still unknown
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common failures and recovery

## Contributing

Contributions are welcome — especially Loop selector verification from real churches running different Prime layouts. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 WorshipWarehouse

This project is not affiliated with Planning Center or Loop Community.
