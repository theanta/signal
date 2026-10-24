# Development loop ledger

The loop works the DEV tasks in order, one per iteration, on branch
`claude/multi-tenant-saas-review-rfyb78-jyplbj`. Each task is ticked with its
commit and any notes. A task blocked on a manual item is marked **BLOCKED**
with the reason, and the loop moves on. The loop stops when every DEV task is
ticked or blocked. The MANUAL list is for Anadi and is never done by the loop.

Plan: `docs/superpowers/plans/2026-10-24-job-durability-and-metering.md`

## DEV

- [x] 1. Write Plan 3 — `b6697d3`
- [ ] 2. Remove the job-postings module
- [ ] 3. Postgres scrape job store
- [ ] 4. SSE from Postgres with Last-Event-ID reconnect
- [ ] 5. Heartbeat and reaper
- [ ] 6. Usage metering and the monthly scrape cap
- [ ] 7. Remove ANTA/Michigan hardcoding from the engine
- [ ] 8. Cron: parallel orgs, outreach chained to analysis, per-org analysis limit
- [ ] 9. contact_finder fixes #3, #1, #4, #5, #6
- [ ] 10. `updateLead` on a foreign or missing id returns 404
- [ ] 11. Update HANDOFF.md and the cutover runbook

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
