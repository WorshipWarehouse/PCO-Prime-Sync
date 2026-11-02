# Contributing

Thanks for helping improve PCO Prime Sync. This project deals with church credentials and live service plans, so correctness and safety beat speed every time.

## Getting started

```bash
npm install
npx playwright install chromium
cp .env.example .env      # placeholders only
npm run dev               # API + dashboard
npm test
```

You do **not** need Planning Center or Loop credentials to work on most of the codebase: the test suite uses `MockPcoAdapter` and `MockPrimeAdapter`, and `PCO_PRIME_SYNC_MOCK=1 npm run dev` gives you a populated dashboard.

## Ground rules

1. **Never commit secrets.** No tokens, passwords, cookies, profile directories, `config/prime-selectors.json` or `.env`. Use `.env.example` for placeholders.
2. **Never invent integration behaviour.** Planning Center endpoints must come from the official docs; Loop steps must be observed in the real UI. Do not add undocumented/private endpoints or bypass CAPTCHA, 2FA or other controls.
3. **Do not claim success that was not verified.** A browser mutation must be verified by reading the resulting state.
4. **Do not touch BPM, tempo, mix or volume.** The only musical value the app writes is the key.
5. **Never delete a Prime setlist automatically**, and never purchase tracks or invite members.
6. **Ambiguity is a human decision.** No auto-picking between multiple song or member matches.

## Where changes belong

| Change | Location |
| --- | --- |
| Matching rules | `src/server/matching/` (+ tests) |
| Diff/operation rules | `src/server/sync/planner.ts` |
| Execution/verification | `src/server/sync/engine.ts` |
| Planning Center API | `src/server/pco/` |
| Loop browser automation | `src/server/prime/playwright/` |
| HTTP API | `src/server/app.ts` |
| Dashboard | `client/` |
| Schema | `src/server/db/schema.sql` + repository methods |

## Tests

```bash
npm test
npm run test:watch
npm run typecheck
```

Guidelines:

- Every matching/planning rule needs a unit test, including the negative case (ambiguous, unmatched, unsupported capability).
- Engine changes should keep the "run twice → zero changes" idempotency test green.
- Add a mock adapter capability/behaviour rather than mocking Playwright internals.
- Do not weaken assertions to make a failing test pass.

## Adding a Loop capability

1. Add selectors to `PRIME_SELECTOR_KEYS`, `CAPABILITY_SELECTORS` and `config/prime-selectors.example.json`.
2. Implement the method in `PlaywrightPrimeAdapter` with a verification read.
3. Implement the same method in `MockPrimeAdapter` with real in-memory state changes and a capability flag.
4. Teach the planner to emit the operation (or a `flag_review` when unsupported) and the engine to execute it.
5. Test: supported path, unsupported path, verification failure, and idempotency.
6. Document what you actually observed in `docs/LOOP-AUTOMATION.md`, with the date and account layout, and only then consider `"verified": true`.

## Reporting a Loop layout change

If a valid selector stops working, include: the captured page from `npm run prime:explore` (redact personal data), the failing capability, and the error code from **Synchronization → Errors**. Do not attach cookies, tokens or screenshots showing account secrets.

## Commit and PR style

- Keep commits focused; explain *why* in the message.
- Describe the verification you performed (tests run, plus manual Loop/PCO checks if applicable).
- Note any behaviour that remains unverified — reviewers rely on that honesty.

## License

By contributing you agree that your work is licensed under the MIT License.
