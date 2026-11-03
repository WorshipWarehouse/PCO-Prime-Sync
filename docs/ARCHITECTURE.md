# Architecture

PCO Prime Sync is a single Node.js process plus a static React dashboard, both local. There is no server-side hosting requirement and no external database.

```
┌─────────────────────────── Mac (localhost) ────────────────────────────┐
│                                                                        │
│  React dashboard (Vite)          Express API (/api)                    │
│        │                              │                                │
│        └───────────►  SQLite  ◄───────┤                                │
│                     (better-sqlite3)  │                                │
│                                       ├── PCO adapter ──► api.planningcenteronline.com/services/v2 (REST)
│                                       └── Prime adapter ──► Playwright persistent profile ──► loopcommunity.com
│                                                                        │
│  DailyScheduler (in-process) + launchd agent (recommended)             │
└────────────────────────────────────────────────────────────────────────┘
```

## Modules

| Path | Responsibility |
| --- | --- |
| `src/shared/types.ts` | Domain types shared by server and dashboard |
| `src/shared/naming.ts` | Song-name/email normalization, setlist naming, timezone-safe dates |
| `src/shared/keys.ts` | Key parsing/comparison (enharmonics, minor/major) |
| `src/server/db/` | Schema, migration, `Repository` (all persistence) |
| `src/server/pco/client.ts` | Minimal PCO JSON:API client: Basic auth, throttling, retries, typed errors |
| `src/server/pco/adapter.ts` | PCO adapter interface + `HttpPcoAdapter` |
| `src/server/pco/mock.ts` | Mock PCO adapter and fixtures (tests/demo only) |
| `src/server/prime/adapter.ts` | Loop Prime adapter interface + error taxonomy |
| `src/server/prime/playwright/` | Session/profile management, selector contract, browser adapter, discovery tool |
| `src/server/prime/mock.ts` | In-memory Prime adapter with real state transitions (tests/demo only) |
| `src/server/matching/` | Song, musician and arrangement selection rules |
| `src/server/sync/resolve.ts` | Turn a PCO plan into a desired Prime state, persisting snapshots |
| `src/server/sync/planner.ts` | Diff desired vs. actual Prime state into safe operations |
| `src/server/sync/engine.ts` | Execute operations, verify, persist, record history |
| `src/server/sync/scheduler.ts` | Next-run calculation, launchd plist, in-process fallback |
| `src/server/app.ts` | HTTP API, security middleware, static dashboard |
| `src/server/services.ts` | Composition root (DB, adapters, engine, scheduler, run manager) |
| `src/cli/` | `sync`, `prime-login`, `prime-explore`, `db-reset` |

## Data flow of one synchronization

1. **Settings and window** — plan window = today..today+N days in the configured timezone (`America/New_York` by default), computed with `Intl` so DST is handled.
2. **Planning Center read** (`HttpPcoAdapter`)
   - `GET /services/v2/service_types/{id}/plans?order=-sort_date` (paged; stops once past the window)
   - `GET .../plans/{plan}/items?include=arrangement,key,song`
   - `GET .../plans/{plan}/team_members?include=person,team`
   - `GET /services/v2/songs/{song}/arrangements?include=keys`
   - `GET /services/v2/people?where[id]=…&include=emails`
3. **Resolution** (`resolve.ts`) — for every song item: choose the arrangement (Default → Original → manual review), read the PCO key from the plan item, look up a saved mapping, otherwise search the Prime library and apply exact-name matching; for every scheduled person on a configured worship team: look up a saved email mapping, otherwise read Prime Team members and match by normalized email.
4. **Planning** (`planner.ts`) — pair desired tracks with the tracks Prime currently shows, then emit only the needed operations: create setlist, add/remove track, reorder, key change, share/unshare, or `flag_review`. Plans with unmatched/ambiguous songs are blocked, never partially written.
5. **Execution** (`engine.ts`) — ordered per plan: create → rename → removals → additions → reorder → key changes → shares → unshares. Each adapter method verifies its own post-condition in the browser; the engine then re-reads the setlist, persists the verified state and tracks per-song/per-musician identity.
6. **History** — `sync_history`, `sync_changes`, `sync_errors` record what was planned, applied, blocked or failed. The verified Loop state in `prime_setlists.state_json` is what makes the next run idempotent.

## Database schema

`src/server/db/schema.sql` creates exactly the tables the project requires:

- `church_settings` (single row, non-secret configuration)
- `pco_team_configuration` (which teams count as worship teams)
- `service_plans` (PCO plan identity + sync status)
- `song_mappings` (normalized PCO title → Prime multitrack, with arrangement identity)
- `plan_songs` (per-plan song order, PCO arrangement/key/BPM, match state, Prime tracking)
- `team_member_mappings` (normalized email → Prime team member)
- `prime_setlists` (PCO plan → Prime setlist, last verified state JSON)
- `sync_history`, `sync_changes`, `sync_errors`

Plus `plan_musicians`, which stores the resolved scheduled-musician state per plan (needed for sharing and change detection).

Stable identifiers are stored whenever they exist: `pco_plan_id`, `pco_item_id`, `pco_song_id`, `pco_person_id`, `prime_track_id`, `prime_setlist_id`, `setlist_track_id`, member ids. Display names are only used for human-facing labels and are never the basis of a confirmed mapping.

## Matching rules

**Songs** (`matching/songs.ts`): normalize (lowercase, trim, strip punctuation, collapse whitespace, fold accents), then compare to multitrack titles only.

- exactly one → matched (mapping saved, reusable forever)
- more than one → ambiguous (administrator decides; never auto-picked)
- zero → unmatched (flagged; no purchase)

**Arrangements** (`matching/arrangements.ts`): `Default` if present, else `Original`, else manual review. Never any other arrangement. Key selection is separate and always comes from the plan item.

**Musicians** (`matching/musicians.ts`): normalized email equality only. Missing/invalid email → review; duplicate emails → ambiguous. No invites are ever sent.

## Safety model

- Plans are blocked (no writes at all) when any song is unmatched/ambiguous.
- A setlist recorded in the database but missing from Loop is **not** recreated; it is flagged.
- Plans that vanish from Planning Center are flagged, never deleted in Loop.
- Destructive actions are not retried when the outcome is unknown: `PrimeVerificationError` stops the run.
- Session expiry (`PrimeSessionExpiredError`) pauses the run and asks for a manual login.
- Unsupported capabilities degrade to a recorded limitation (`flag_review` + `sync_errors`), keeping the rest functional.
- The engine has no BPM/tempo/mix API and never calls one.

## Adapter boundaries

`PcoAdapter` and `PrimeAdapter` are the only integration surfaces. The engine knows nothing about HTTP or browsers, which is what makes the mock-based test suite meaningful and the Loop limitation isolatable.
