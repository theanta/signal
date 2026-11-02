# Development loop ledger

The loop works the DEV tasks in order, one per iteration, on branch
`claude/multi-tenant-saas-review-rfyb78-jyplbj`. Each task is ticked with its
commit and any notes. A task blocked on a manual item is marked **BLOCKED**
with the reason, and the loop moves on. The loop stops when every DEV task is
ticked or blocked. The MANUAL list is for Anadi and is never done by the loop.

Plan: `docs/superpowers/plans/2026-10-24-job-durability-and-metering.md`

## Test environment

The container has no access to `anta-signal-test`. Backend suites run against
a local stand-in built in the session scratchpad (`stack/up.sh`,
`stack/reset.sh`): Postgres 16 + pgvector with SSL, the Supabase roles,
`auth.jwt()`, Supabase's default grants, and PostgREST 12.2.3 behind a
`/rest/v1` proxy. Same supabase-js → PostgREST → RLS path; the hosted run is
on the MANUAL list. Baseline before task 2: 215 + 106 passing.

## DEV

- [x] 1. Write Plan 3 — `b6697d3`
- [x] 2. Remove the job-postings module — `aced26f`
      Backend 176 + 86 (RLS pass) green on the local stand-in; engine 19
      green; frontend `tsc` clean; parity diff is org_id positions only.
      `next lint` cannot run: the frontend has no ESLint config (pre-existing).
- [x] 3. Postgres scrape job store — `6db2ee0`
      Backend 186 + 96 green; engine 28 green; parity clean. Real JobStore
      exercised against the local Postgres (409 while running/finalizing,
      cross-org reads empty, cross-org event rejected by the composite FK).
      Scheduled scrapes now wait for an active run; until task 8 the orgs
      are still processed one after another, so a long wait delays later
      orgs.
- [x] 4. SSE from Postgres with Last-Event-ID reconnect — `6c9c5a0`
      Backend 189 + 99 green; engine 32 green; frontend tsc clean. Fixed a
      task 3 regression on the way: the browser treated a 'finalizing'
      snapshot as a failed run.
- [x] 5. Heartbeat and reaper — `c0cbff2`
      Engine 39 green; reaper checked against the local Postgres; backend
      unchanged. The reaper runs in every engine instance; the conditional
      UPDATE makes concurrent sweeps safe.
- [x] 6. Usage metering and the monthly scrape cap — `7c5e1c5`
      Backend 197 + 107 green; engine 47 green; parity clean. Found for
      task 7: the backend's buildAgencyContext also hardcodes "software
      consultancy" and a software-buyer audience, and analyzeLeadSignals
      sends no config to the engine.
- [x] 7. Remove ANTA/Michigan hardcoding from the engine — `08be953`
      Backend 202 + 110 green; engine 64 green; frontend tsc clean. Left
      for Anadi to decide: the product is still branded ANTA on the login
      page ("Internal tool · ANTA Software") and the sidebar; the
      lead_signals column is still named recommended_anta_service (rename
      is a schema change, no behavior); the cron schedule is one time zone
      for every tenant.
- [x] 8. Cron: parallel orgs, outreach chained to analysis, per-org analysis limit — `1458c77`
      Backend 207 + 115 green; frontend tsc clean. Resolves the task 3
      note: an org waiting out an active scrape now holds one lane, not
      the whole run. With 3 lanes, three orgs all waiting would still
      delay the rest.
- [x] 9. contact_finder fixes #3, #1, #4, #5, #6 — `b2b1d61`
      Engine 85 green; 19 of the 21 new tests fail on the old code. Bare
      first-name inboxes (dan@) are no longer matched when the person has a
      last name — fewer 'verified' emails, none of them someone else's.
- [x] 10. `updateLead` on a foreign or missing id returns 404 — `9f2d465`
      Backend 211 + 115 green.
- [x] 11. Update HANDOFF.md and the cutover runbook — `eb31384`
      Found and fixed a runbook ordering bug: Path B created the scrape run
      store after deploying the engine that needs it.

**Loop finished 2026-10-24.** All 11 DEV tasks done, none blocked. Final
checks: backend 211 + 115 (RLS pass), engine 85, backend and frontend `tsc`
clean, backend lint clean, schema parity clean — all on the local stand-in.

## MANUAL (Anadi, after the loop)

- [ ] Apply `supabase/migrations/2026-08-26_rls_policies.sql` and every Plan 3
      migration to `anta-signal-test`, then run `cd backend && npm test`
      against it.
- [ ] Create the production Supabase project.
- [ ] Set Render env vars: `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`,
      `ENGINE_API_KEY` (same value on both services), `MILLIONVERIFIER_API_KEY`.
- [ ] Upgrade Apify, Groq, Serper, Render and MillionVerifier to paid tiers
      before agency #2.
- [ ] Recreate `signal-engine/venv` on your machine.
- [ ] Cutover (runbook Path A): `schema.sql`, `create-org` for ANTA, deploy
      backend and engine together, smoke test, then a second test org.
- [ ] Open the PR to `main` and merge it.
- [ ] Onboard design partner #1.
