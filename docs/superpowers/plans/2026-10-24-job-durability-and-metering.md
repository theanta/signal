# Plan 3 — Job durability, metering, and making the engine tenant-neutral

**Spec:** `docs/superpowers/specs/2026-08-26-multi-tenant-saas-design.md`,
Section 3, plus the decisions recorded in `docs/superpowers/HANDOFF.md`.
**Branch:** `claude/multi-tenant-saas-review-rfyb78-jyplbj`.
**Ledger:** `docs/superpowers/DEV-LOOP.md`. Tasks are numbered to match it.

Plan 2 made the data multi-tenant. Plan 3 makes the *work* multi-tenant:
scrape runs survive a restart and cannot collide, every external call is
attributed to the org that caused it, one org cannot spend another's budget,
and the engine stops assuming that every tenant is a Detroit software agency.

Naming, used throughout: a **scrape run** is one execution of `/scrape`
(table `scrape_jobs`). A **job posting** is a job advert (table `jobs`), which
task 2 removes. Code and prose never call a scrape run a "job" without the
qualifier.

## Ground rules (unchanged from Plan 2)

- Every new tenant table gets `org_id NOT NULL`, the `org_isolation` RLS
  policy and the `service_role_all` policy, in **both** `supabase/schema.sql`
  and a migration under `supabase/migrations/`. `schema-parity-check.sh` must
  show only the expected `org_id` ordinal hunks afterwards.
- The engine holds the service-role key. Every engine read and write filters
  or stamps `org_id` explicitly; it never infers one.
- Backend code reaches tenant data only through a `TenantContext`.
- Checks before each commit: `cd backend && npx tsc --noEmit && npm run lint
  && npm test`, `cd signal-engine && python -m pytest tests/ -v`.

---

## Task 2 — Remove the job-postings module

Scope is the list in HANDOFF "Decided 2026-10-24". Keep the `linkedin` and
`job_board` lead sources.

**Database.** New migration `2026-10-24_drop_job_postings.sql`, one
transaction: drop `job_submissions`, `job_signals`, `jobs` (in that order,
`CASCADE` only where a view depends on them), strip the `remote_*` keys from
every `platform_config.config`, and remove `remote_jobs` from each
`config->'active_sources'`. Mirror the drops in `schema.sql` (tables, indexes,
triggers, grants, RLS entries, the policy loop's table list).
`lead_source` keeps `'remote_jobs'` (see HANDOFF).

**Engine.** Delete `scrapers/remote_jobs.py`, `analyzers/job_qualifier.py`,
`scripts/backfill_job_verdicts.py`, `_persist_job_postings`, the
`job_scrapers` branch of `run_scrape_job`, the `remote_*` fields of
`PlatformConfig`, and `remote_jobs` from every default source list. Delete or
trim the tests that cover them.

**Backend.** Delete `controllers/jobsController.ts`, the `/api/jobs` mount in
`api/server.ts`, the JOBS section of `supabaseService.ts` (including
job→lead conversion), `claudeService.generateJobIntel`,
`tests/isolation/jobs.test.ts`, and job rows in `tests/helpers/seed.ts`,
`tests/schema/*`, `tests/rls/*`. `runDailyScrape` sends
`['linkedin', 'job_board']`. `routes/signals.ts`'s default sources lose
`remote_jobs`.

**Frontend and shared.** Delete `app/jobs/`, `components/jobs/`,
`components/dashboard/ApplyWorthyJobsWidget.tsx` and its dashboard slot, the
Sidebar and TopBar entries, the Remote Jobs source and `remote_*` fields in
Settings, the job services/types, and the `remote_*` keys of
`PlatformConfig` / `DEFAULT_PLATFORM_CONFIG`.

**Done when:** `grep -rn "remote_jobs\|job_submissions\|job_signals\|verdict"`
over source (not migrations, not the enum) returns nothing, all suites pass,
`npx tsc --noEmit` passes in `frontend/`, and parity is clean.

## Task 3 — Postgres scrape run store

```sql
CREATE TABLE scrape_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN
                 ('queued','running','finalizing','completed','failed')),
  sources      TEXT[] NOT NULL,
  source_state JSONB NOT NULL DEFAULT '{}',  -- per-source {status, leads_found, error}
  config       JSONB NOT NULL,                -- snapshot at enqueue
  results      INT NOT NULL DEFAULT 0,
  error        TEXT,
  worker_id    TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  CONSTRAINT scrape_jobs_id_org_uniq UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX one_active_scrape_per_org ON scrape_jobs (org_id)
  WHERE status IN ('queued','running','finalizing');

CREATE TABLE scrape_job_events (
  seq     BIGSERIAL PRIMARY KEY,
  job_id  UUID NOT NULL,
  org_id  UUID NOT NULL,
  event   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (job_id, org_id) REFERENCES scrape_jobs (id, org_id) ON DELETE CASCADE
);
CREATE INDEX scrape_job_events_job_seq ON scrape_job_events (job_id, seq);
```

Departure from the spec: `finalizing` is inside the active-run index. The spec
left it out, which would let a second run start while the first is still
writing leads.

**Engine.**
- New module `jobstore.py` (service-role client): `create_run(org_id,
  sources, config) -> id` (raises `ActiveRunExists` on the unique violation),
  `update_source(run_id, org_id, source, state)`, `finish(run_id, org_id,
  status, results, error)`, `append_event(run_id, org_id, event)`,
  `get_run(run_id, org_id)`, `events_after(run_id, org_id, seq)`.
- `POST /scrape` inserts the row before scheduling the background task and
  returns 409 `{"error": "scrape_already_running"}` when the index rejects it.
- `run_scrape_job` writes per-source state and events through `jobstore`.
  Delete `scrape_jobs` and `scrape_conditions` dicts.
- `GET /scrape/{id}` and `/scrape/{id}/stream` take a required `org_id`
  query parameter and 404 a run of another org. This closes the HANDOFF
  "no org check on scrape status" item.

**Backend.** `getScrapeStatus` and `getScrapeStreamResponse` take the
`TenantContext` and send `org_id`. The scrape route maps the engine's 409 to
409 with a readable message; `useScrapeJob` shows it as a toast.

**Tests.** pytest with a fake store: 409 on a second active run, 404 across
orgs. Backend RLS suite: `scrape_jobs` and `scrape_job_events` included in
the cross-tenant read checks.

## Task 4 — SSE from Postgres

The engine's stream polls `events_after(seq)` every second and emits each
event as `id: <seq>\ndata: <json>\n\n`. It opens with a `snapshot` built from
the run row, ends after a `complete` event or when the row is terminal, and
honours `Last-Event-ID` by starting from that seq instead of replaying. The
Express proxy forwards `Last-Event-ID` from the browser request. Any engine
instance can now serve any run's stream.

**Tests.** pytest: replay from zero, resume from a seq, terminate on a
terminal row with no `complete` event.

## Task 5 — Heartbeat and reaper

`run_scrape_job` bumps `heartbeat_at` on every source transition and at least
every 60 seconds while a scraper is running (an `asyncio` ticker task). The
engine's `lifespan` starts a reaper loop: every 5 minutes, any run in an
active status with `heartbeat_at < now() - 15 min` becomes `failed` with
`error = 'reaped: no heartbeat for 15 minutes'` and gets a terminal
`complete` event. Without this, a run killed by a deploy holds its org's
active-run slot forever.

**Tests.** pytest on the reaper's query function against the fake store:
stale active runs are failed, fresh and terminal runs are not.

## Task 6 — Metering and the scrape cap

```sql
CREATE TABLE usage_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id),
  job_id     UUID,             -- scrape run, when there is one
  provider   TEXT NOT NULL CHECK (provider IN ('apify','serper','groq','millionverifier')),
  operation  TEXT NOT NULL,    -- e.g. 'actor:compass/crawler-google-places', 'search', 'chat'
  units      INT NOT NULL,     -- items, queries, tokens, verifications
  cost_cents INT,              -- when the provider reports it
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX usage_events_org_created ON usage_events (org_id, created_at);
```

**Engine.** A `metering.py` with `record(org_id, provider, operation, units,
job_id=None, cost_cents=None)` that never raises (a metering failure must not
fail a scrape; it logs). The org reaches the call sites through a
`contextvars.ContextVar` set at the top of `run_scrape_job` and
`_analyze_lead_core`, so scraper and enrichment signatures do not change.
Call sites: `ApifyBaseScraper._run_actor` (items returned, plus the run's
`usageTotalUsd` when present), both Serper calls, `_verify_email`, and the
Groq call in `pain_point_analyzer`.

**Backend.** `claudeService` records Groq usage (prompt + completion tokens
from the response) through the tenant's scoped client.

**Cap.** `jobstore.create_run` counts this calendar month's runs for the org
and compares to `organizations.monthly_scrape_cap`; over the cap it raises
`ScrapeCapReached` and `POST /scrape` returns 429. The active-run index
already serialises enqueue per org, so the count-then-insert cannot race.
The backend maps 429 to a readable message.

**Tests.** pytest: cap reached → 429, metering failure does not raise.
Backend: `usage_events` in the cross-tenant RLS checks.

## Task 7 — Make the engine tenant-neutral

Every ANTA or Michigan assumption in the engine comes from the tenant's
`platform_config` instead.

- `config` becomes **required** on `/scrape`, `/analyze` and
  `/analyze/stream`. The engine's `PlatformConfig` loses its ANTA defaults;
  the backend always sends the tenant's config.
- `pain_point_analyzer`: the prompt names `config.agency_name`,
  `config.agency_location` and `config.agency_tagline`, and offers
  `config.services` as the service list. The partnership prompt does the same.
  The rule-based fallback's industry angles are rewritten without an agency
  name ("We build …"), and the Detroit local-angle line keys off
  `agency_location` instead of hardcoded cities.
- `_is_enterprise_company` and lead scorer rationale say "outside the target
  market", not "outside ANTA's".
- `lead_scorer` and `signal_detector` geo targets come from
  `config.target_locations` only; the hardcoded Michigan fallbacks go.
- New config key `target_roles: string[]` (the hiring roles that signal a
  need). `LinkedInJobsScraper` and `JobBoardScraper` search those roles across
  up to two of the tenant's locations. Crunchbase queries are built as
  `"<industry> <location>"` from `target_industries` × `target_locations`
  (capped at 5), falling back to `"<service keyword> <location>"`.
- `DEFAULT_PLATFORM_CONFIG` becomes neutral: empty agency identity, empty
  services, empty `target_locations` and `target_roles`. ANTA's current values
  move to a fixture used by `create-org` only when the slug is `anta`, so
  ANTA's cutover keeps its settings. Settings gets a "Hiring roles" field.
- Cron and manual scrapes refuse an org whose config has no
  `target_locations` (the cron logs "not configured — set Settings first";
  the manual trigger returns 400 with that message).

**Tests.** pytest: the pain-point prompt for a non-ANTA config contains that
agency's name and services and not "ANTA"; Crunchbase queries follow config;
scrape without config is a 422. Backend: an org without target locations is
skipped by the cron.

## Task 8 — Cron that scales past one org

- `forEachOrg` runs orgs with a concurrency limit (`CRON_ORG_CONCURRENCY`,
  default 3) instead of sequentially.
- The 07:00 analysis and 08:00 outreach become one per-org pipeline: an org's
  outreach runs as soon as its own analysis finishes. `CRON_GENERATE_OUTREACH`
  stays as a catch-up run that only drafts for leads still missing outreach.
- The daily analysis limit (currently 20) becomes `daily_analysis_limit` in
  `platform_config`, default 20, maximum 100.
- Each org's run is still audited separately in `cron_job_logs`.

**Tests.** Unit tests with fake org work: concurrency never exceeds the
limit, one org's failure does not stop the others, outreach for an org starts
only after that org's analysis resolves, the limit is read from config.

## Task 9 — contact_finder fixes

From the review of `b74cc84` (HANDOFF "Open code-review findings"):

- **#3** Stage 3a assigns an email to a person by bare substring
  (`'dan' in 'danielle'`). Match on the local part's tokens: exact first or
  last name, `first.last`, `flast`, `firstl`, `f.last`. No substring match.
- **#1** The 45-second budget discards the LinkedIn person found by Stage 1
  when later stages time out. Return the best partial contact on timeout.
- **#4** The company guard is substring-based and passes everything when
  `_company_tokens` is empty. Token-equality match; an empty token list fails
  closed.
- **#5** The early break on the first personal email aborts JSON-LD people
  collection. Collect people first, then emails.
- **#6** A `break` on `unknown` also fires on a transient verifier 503.
  Distinguish `unknown` from an error; retry the next candidate on error.

**Tests.** One pytest per finding, written failing first.

## Task 10 — 404 for a lead that is not yours

`updateLead`'s `.single()` error (PGRST116) maps to a `NotFoundError` that
the controller returns as 404. Same for any other id-addressed single-row
write that has the pattern. Isolation suite asserts 404, not 500.

## Task 11 — Documentation

HANDOFF: Plan 3 marked complete with departures; known-issues list updated.
Runbook: new migrations in Path B order, `scrape_jobs`/`usage_events` in the
rollback table list, 409/429 in the smoke test, the "configure Settings
before first scrape" step, and a reaper check.

## Effort

| Task | Days |
|---|---|
| 2 Remove job postings | 2 |
| 3 Run store | 2 |
| 4 SSE from Postgres | 1.5 |
| 5 Heartbeat + reaper | 1 |
| 6 Metering + cap | 2 |
| 7 Tenant-neutral engine | 2.5 |
| 8 Cron | 1.5 |
| 9 contact_finder | 1.5 |
| 10 404 | 0.5 |
| 11 Docs | 0.5 |
| **Total** | **~15** |
