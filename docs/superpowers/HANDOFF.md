# Signal Repo — Session Handoff

**Last updated:** 2026-10-24
**Branch:** `claude/multi-tenant-saas-review-rfyb78-jyplbj`. Plans 1, 2 and 3
are complete; the multi-tenant foundation is built. What remains is the
manual list in `docs/superpowers/DEV-LOOP.md` (hosted test run, production
project, Render settings, cutover, merge to `main`, first design partner).

## What changed direction

ANTA Lead Radar is being converted from a solo-built single-user tool into a
multi-tenant SaaS, with RAG added later. This branch starts that work.

**Launch shape decided:** design partners with manual onboarding, invoiced
directly. No self-serve signup, no Stripe, next month. Rejected the public
self-serve option because it would have required cutting the tenancy test
suite on the exact boundary where a bug leaks one customer's leads to another.

**Timeline reality:** the foundation is ~29 working days (~6 weeks solo),
against an original one-month expectation. Stated and accepted, not padded to
fit. Design partner #1 realistically onboards early week 6. The compressible
week is SSE-from-Postgres plus the metering floor.

**RAG:** deferred to month 2. Corpus will be both tenant-uploaded sales
material (case studies, proposals, winning emails) *and* the existing scraped
lead/job data, tenant docs first. `pgvector` gets enabled in the tenancy
migration so RAG is purely additive later. No speculative empty tables.

## Documents

- **Spec:** `docs/superpowers/specs/2026-08-26-multi-tenant-saas-design.md`
  Full design — data model, dual enforcement, job store, testing, sequencing.
- **Plan 1:** `docs/superpowers/plans/2026-08-26-signal-engine-auth.md` — DONE
- **Plan 2:** `docs/superpowers/plans/2026-08-26-tenancy-foundation.md` — DONE
  (15 of 15). Where the code departs from the plan's text, the commit message
  and "Plan 2 completion" below say why; trust the code.
- **Plan 3:** `docs/superpowers/plans/2026-10-24-job-durability-and-metering.md`
  — DONE (tasks 2-10). See "Plan 3 completion" below.
- **Runbook:** `docs/runbooks/tenancy-cutover.md` — deploy, rollback, onboarding.
- **Loop ledger:** `docs/superpowers/DEV-LOOP.md` — each Plan 3 task with its
  commit, and the manual checklist that is left.

## The three plans

| Plan | Deliverable | Days | Status |
|---|---|---|---|
| 1. Signal engine authentication | Engine rejects unauthenticated calls | 2 | **Complete** |
| 2. Tenancy foundation | `org_id`, composite FKs, `TenantContext`, RLS, isolation suites | 18 | **Complete** |
| 3. Job durability + metering | Postgres run store, resumable SSE, reaper, usage events, scrape cap, job-postings module removed, tenant-neutral engine, parallel cron, contact_finder fixes | ~15 | **Complete** |

## Decided 2026-10-24: the job-postings module leaves Signal

Remote job postings, their apply/caution/skip verdicts and submission tracking
are a staff-augmentation workflow. They move to a separate product, so Signal
drops the **whole module** as part of Plan 3 (about 2 extra days). Signal is
lead generation only.

**Stays:** the `linkedin` and `job_board` lead sources. They read job postings
only to find companies that are hiring, and emit *leads* (`leads.job_title`,
"Currently Hiring For"). They never touch the `jobs` table.

**Goes:**
- Database: `jobs`, `job_signals`, `job_submissions` and anything that depends
  on them (views, RLS policies, the cutover runbook's rollback table list); the
  `remote_*` columns on `platform_config`. Change `schema.sql` and add a drop
  migration, then re-run `schema-parity-check.sh`. The `'remote_jobs'` value of
  `lead_source` stays: Postgres cannot drop an enum value without rebuilding
  the type, and nothing will write it.
- Engine: `scrapers/remote_jobs.py`, `analyzers/job_qualifier.py`,
  `_persist_job_postings` and the `job_scrapers` branch in `main.py`,
  `remote_jobs` in the default source lists, `scripts/backfill_job_verdicts.py`,
  and their tests.
- Backend: `controllers/jobsController.ts`, the jobs routes, the JOBS section
  of `supabaseService.ts` (including job→lead conversion),
  `claudeService.generateJobIntel`, `tests/isolation/jobs.test.ts`, and the job
  rows in the seed, schema and RLS tests.
- Frontend: the **Jobs** entry in the sidebar (`components/ui/Sidebar.tsx`)
  and any `/jobs` breadcrumb in `TopBar.tsx`; `app/jobs/` (including the
  1127-line detail page),
  `components/jobs/`, `ApplyWorthyJobsWidget`, the Remote Jobs source and
  `remote_*` fields in Settings, and the job types in `shared/types`.

If the cutover runs before Plan 3, production is built with these tables and
the drop migration removes them later. No partner data is at stake, because
nothing in the product will write them.

Plan 3's "jobs" (`scrape_jobs`, `scrape_job_events`) are scrape runs, not job
postings, and are unaffected.

## Key architectural decisions (locked)

- **Isolation is dual:** typed app-layer scoping AND enforcing RLS. Chosen over
  app-only. Consequence: each layer must be tested with the other disabled, or
  a broken RLS policy is invisible behind a working app filter.
- **One org per user.** No multi-org membership. It doubles policy complexity
  and no design partner will ask for it.
- **`org_id` denormalized onto child tables**, with composite foreign keys
  (`FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id)`) so a child
  row disagreeing with its parent is unrepresentable at the database.
- **Postgres as the job store.** No Redis, no Celery — that is infrastructure
  for a 20-scrape/day workload.
- **RLS is switched on LAST**, after app scoping is proven. A wrong policy that
  is the only thing standing locks you out of your own data with no app-layer
  path to debug through.
- **Not on Supabase Auth.** Custom `users` table, bcrypt, own JWTs. So
  `auth.uid()` RLS is not free — org-scoped Supabase-compatible JWTs must be
  minted with `SUPABASE_JWT_SECRET`.

## What Plan 1 actually shipped

The signal engine had **no authentication at all** and `allow_origins=["*"]`
while holding `SUPABASE_SERVICE_ROLE_KEY` and writing directly to `jobs`.

- `signal-engine/auth.py` — `require_engine_key` dependency, constant-time
  `hmac.compare_digest`, missing and wrong key indistinguishable.
- All 5 engine routes protected; `/health` deliberately left open for Render.
- `CORSMiddleware` removed entirely — the engine is server-to-server only.
- Engine refuses to boot without `ENGINE_API_KEY` (via `lifespan`, not the
  deprecated `on_event`).
- Backend sends `X-Engine-Key` from all 4 call sites, including the
  easily-missed `fetch`-based SSE one.
- **First tests in the repo:** `signal-engine/tests/`, 13 passing.

## Before deploying this branch

Follow `docs/runbooks/tenancy-cutover.md`. In short:

- `ENGINE_API_KEY` on **both** Render services, identical values.
- `SUPABASE_ANON_KEY` and `SUPABASE_JWT_SECRET` on the Render backend. Without
  the JWT secret the backend cannot mint org-scoped clients and every
  authenticated request returns 500.
- The engine needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` too: scrape
  runs, their events and usage rows are written there now.
- `MILLIONVERIFIER_API_KEY` on the engine, or pattern emails are never
  verified (and so never returned).
- Deploy the backend and engine **together**: the engine 422s any `/analyze`
  or `/scrape` without an `org_id` **and a `config`**, and an old backend
  sends neither.
- The production Supabase project is gone, so the real path is the runbook's
  Path A: build a fresh project from `schema.sql` alone (it includes the RLS
  policies), then `npm run create-org` for ANTA.

## Known issues not yet addressed

- **`signal-engine/venv` has stale shebangs.** Built when the project lived at
  `Projects/signal`; it is now `Projects/ANTA/signal`. `pip` and `uvicorn`
  scripts are broken; `./venv/bin/python -m <tool>` works. `npm run dev:signal`
  calls bare `uvicorn`, so it needs the venv activated. Recreate the venv when
  convenient.
- **`MILLIONVERIFIER_API_KEY` is not set locally**, so pattern emails are
  never verified there. Since task 9 a missing key is reported as
  `no_verifier` and no guessed address is ever returned.
- The `b74cc84` review findings are all closed (see below).

## Open code-review findings (commit b74cc84)

All closed:

1. **FIXED** (Plan 3 task 9) — `find_contact` takes a budget, skips later
   stages once it is spent and returns the person found so far.
2. **FIXED** (Task 11) — `contact_email_confidence` was written only inside
   the email branches, in two copies of the persistence code. Both are now
   `backend/services/persistAnalysis.ts`, which writes the contact block as a
   whole and clears a stale email.
3. **FIXED** (Plan 3 task 9) — Stage 3a matches name tokens and the usual
   patterns, never substrings.
4. **FIXED** (Plan 3 task 9) — whole-word company guard; empty tokens fail
   closed.
5. **FIXED** (Plan 3 task 9) — the early stop needs an email and a person.
6. **FIXED** (Plan 3 task 9) — the verifier reports `error` and `no_verifier`
   separately; only a missing key stops the candidate loop.
7. `.env.example` — **FIXED** in this branch.

## Pre-existing architecture drift (documented, not fixed)

- Only 3 of 9 backend route files use a controller.
- ~~`cron.ts` inline orchestration~~ — RESOLVED: job bodies live in
  `services/cronRunner.ts` (Task 13); `routes/cron.ts` is HTTP wiring only.
- ~~Three independent `createClient` calls~~ — RESOLVED: one `supabaseAdmin`
  (Task 5); `configService` now uses the tenant's scoped client (Task 9).
- 6 frontend files bypass `frontend/services/` and hit `@/lib/api` directly.
- God files: `frontend/app/leads/[id]/page.tsx` (1034 lines),
  `signal-engine/main.py` (~1000). The 1127-line jobs page went with the
  job-postings module.

## Plan 3 completion (2026-10-24)

Worked as a loop, one task per iteration, each committed and ticked in
`docs/superpowers/DEV-LOOP.md` with its hash. Final state: backend 211 tests
under the app harness and 115 again through the RLS-scoped client; engine 85;
`npx tsc --noEmit` clean in `backend/` and `frontend/`; `npm run lint` clean;
`schema-parity-check.sh` shows only the `org_id` ordinal hunks.

**Where these were verified.** Not against `anta-signal-test` — the session
container could not reach it. The suites ran against a local stand-in
(Postgres 16 + pgvector with SSL, the Supabase roles, `auth.jwt()`, Supabase's
default grants on `public`, PostgREST 12.2.3 behind a `/rest/v1` proxy). The
run store, reaper, cap and metering were also exercised against that Postgres
directly, and the engine's resumable stream end to end over HTTP. **Run the
suites against the hosted test project before cutover**, after applying every
migration listed in the runbook.

### What shipped

| Task | Commit | Summary |
|---|---|---|
| 2 | `aced26f` | Job-postings module removed end to end; `2026-10-24_drop_job_postings.sql` |
| 3 | `6db2ee0` | `scrape_jobs` / `scrape_job_events`; one active run per org (409); status and stream org-scoped; in-memory dict gone |
| 4 | `6c9c5a0` | SSE ids + `Last-Event-ID` resume, keep-alive pings, browser reconnects |
| 5 | `c0cbff2` | Heartbeat every 60s; reaper fails runs stale > 15 min; terminal runs ignore straggler writes |
| 6 | `7c5e1c5` | `usage_events` at every paid call site; `monthly_scrape_cap` → 429 |
| 7 | `08be953` | Engine and outreach tenant-neutral; `target_roles`; neutral default config; ANTA's settings only for the `anta` slug |
| 8 | `1458c77` | Cron runs `CRON_ORG_CONCURRENCY` orgs at once; outreach chained per org; `daily_analysis_limit` |
| 9 | `b2b1d61` | contact_finder #1, #3, #4, #5, #6 |
| 10 | `9f2d465` | 404, not 500, for a lead that is not the caller's |

### Departures from the plan, and why

- **`finalizing` counts as an active run** (task 3). The spec's index left it
  out, which would let a second run start while the first is writing leads.
- **Scheduled scrapes wait out an active run** (task 3). The daily and
  bi-weekly scrapes fire in the same minute on the 1st and 15th, and the
  one-active-run index would otherwise refuse the second every time. Manual
  triggers fail at once with 409.
- **Tenants can read scrape runs but never write them** (task 3): deleting a
  run would lower the count the scrape cap is checked against. Usage events
  are insert-and-read for tenants (the backend records its own Groq calls
  through the scoped client), never update or delete.
- **Failed runs count toward the cap** (task 6): they spent credits.
- **Config is required on every engine call** (task 7), and the shared
  `DEFAULT_PLATFORM_CONFIG` is neutral. `getConfig` merges a tenant's row over
  the defaults, so ANTA-valued defaults would have leaked ANTA's targets into
  any tenant missing a key.
- **A tenant with no target locations cannot scrape** (task 7): the engine
  returns 400 `not_configured` rather than scraping someone else's market.
- **The analysis limit lives in config, not on `organizations`** (task 8), so
  a tenant can tune it in Settings; it is clamped to 1-100.
- **A bare first-name inbox is no longer matched to a person with a last
  name** (task 9). Fewer `verified` emails, none of them someone else's.

### Open after Plan 3 (for Anadi to decide)

- The product is still branded ANTA on the login page ("Internal tool · ANTA
  Software") and in the sidebar.
- `lead_signals.recommended_anta_service` keeps its name; renaming it is a
  schema change with no behavior.
- One cron schedule and time zone (`CRON_TIMEZONE`) for every tenant.
- The local-business scraper's fallback industry terms (used when a tenant
  lists no industries) still lean toward software, manufacturing and
  logistics; the rule-based pain-point fallback (used only when Groq is
  down) is operations-flavoured. Neither names ANTA.
- Three orgs all waiting on an active scrape occupy every cron lane.
- `frontend` has no ESLint config, so `next lint` cannot run.

## Plan 2 completion (2026-10-01)

The Task 8 follow-up through Task 15 landed on top of `20743ef`. `npx tsc --noEmit` is
clean, `npm run lint` exits 0, and `npm test` runs every suite under the app
harness (215 tests) and then the isolation, service and RLS suites again
through the real RLS-scoped client (106 tests). Engine: 21 pytest tests.

**Where these were verified.** Not against `anta-signal-test` — its
credentials were not available in that session. The suites ran against a
local stand-in: Postgres 16 + pgvector, PostgREST 12.2.3 behind a `/rest/v1`
proxy, the Supabase roles (`anon`, `authenticated`, `service_role` with
BYPASSRLS), `auth.jwt()`, and Supabase's default grants on `public`. That is
the same supabase-js → PostgREST → RLS path, but **run `npm test` against the
hosted test project once before cutover**, after applying
`2026-08-26_rls_policies.sql` to it.

The backend was also booted against that stand-in and driven over HTTP as a
partner created by `create-org`: own leads only, a body-supplied `org_id`
ignored, another org's lead 404 by id and untouched by PATCH, own config and
metrics, a manual cron run logged only in the partner's org. The runbook's RLS
rollback and re-apply were exercised the same way.

### Departures from the plan, and why

- **`claudeService` takes the tenant (Task 10).** The plan missed it: every
  outreach generator reads `platform_config` for agency name, tone and
  sign-off. Its `loadConfig` also no longer swallows errors into ANTA's
  defaults, which would have sent one tenant's outreach under ANTA's name.
- **`getConfig` throws on a query error (Task 9)** instead of returning
  defaults, so a failed read can't be merged and saved over a real config.
- **Streaming analysis sent no engine key** (fixed separately, `d319aa0`):
  `streamAnalyzeLead` used a bare `fetch` without `X-Engine-Key`, so it has
  401'd since Plan 1. It now goes through `signalEngineService`.
- **`jobs_external_id_key` (Task 12).** The plan named a partial index that no
  longer exists. The real constraint became `jobs_org_external_id_key UNIQUE
  (org_id, external_id)` in both `schema.sql` and the tenancy migration, and
  the engine upserts on `org_id,external_id`. Parity check clean. This settles
  the "Task 12 owes this file a debt" item from Task 4.
- **Manual cron triggers run only for the caller's org (Task 13).** The plan
  ran them for every org; they sit behind tenant login, so one tenant could
  have started (and spent scrape credits on) everyone's jobs.
- **Cron re-mints its context per lead (Task 13).** The scoped token lives five
  minutes, and a 20-lead analysis batch runs far longer.
- **RLS is tighter than the plan (Task 14)**, because Supabase grants every
  `public` table and view to `anon` and `authenticated` by default:
  `organizations` had RLS off (readable with the anon key) and is now
  SELECT-only, so a tenant cannot lift its own cap; `users` is SELECT-only
  without `password_hash`; `hot_leads` and `lead_pipeline_summary` ran with
  owner rights and returned every tenant's data to any session, anon
  included, and are now `security_invoker`; `anon` has no access to tenant
  data.
- **`create-org` rolls back on a failed config insert (Task 15)** — otherwise
  the partner logs in with ANTA's identity from the defaults. It also refuses
  an email already in use and validates the slug.

### Known, not fixed

- ~~A PATCH to a lead id that isn't yours returns 500, not 404~~ — FIXED in
  Plan 3 task 10 (`NotFoundError`, same 404 for missing and foreign ids).
- ~~Scrape job status has no org check~~ — FIXED in Plan 3 task 3 (runs live
  in Postgres; status and stream require the caller's org).
- `backend/.eslintrc.cjs` still ignores `tests/` (deferred minor from Task 7).
- ~~The open `contact_finder.py` findings~~ — closed in Plan 3 task 9.

## Earlier Plan 2 notes (2026-09-14)

Kept for the record. Where they conflict with the section above, the section
above is current — in particular, the branch typechecks again and Task 8 is
done.

### Plan 2 execution state (2026-09-14)

Being executed task-by-task with fresh subagents and a review after each. The
ledger — completed tasks with commit ranges, every ruling, every deferred
finding — is `.superpowers/sdd/2026-08-26-tenancy-foundation/progress.md`
(git-ignored). **Read it before resuming; trust it and `git log` over memory,
and do not re-run tasks it marks complete.**

- **Tasks 1-3 complete.** Vitest + `pg` harness against a dedicated test
  project, with a guard that refuses to run when the test project ref matches
  production's. The tenancy migration (`organizations`, `org_id` on all 12
  tables, backfill, `pgvector`). Composite foreign keys making org drift
  unrepresentable, plus `backend/tests/reset-test-db.sh`.
- **Task 4 complete** (`dd6f19f..f12e080`, review clean, 5 minors deferred).
  See "What Task 4 closed" below.
- **Task 5 complete** (`f4dda76..7cbe76a`, review clean). One `supabaseAdmin` replaces
  three scattered `createClient` calls, and the service-role import boundary is
  an ESLint failure. Two fence bypasses (`.js` specifier, dynamic `import()`)
  were found and closed; the fence is verified across 8 import shapes and
  confirmed not to over-block the four allowed service-role locations.
- **Task 6 complete.** `TenantContext`, `ctxOf(req)`, org-scoped Supabase JWTs,
  and the tenantContext import fence. `SUPABASE_TEST_JWT_SECRET` was corrected
  as part of it.
- **Task 7 complete** (`005fa1d..118cc1a` + review addendum, reviewed
  2026-09-14). The leads/signals/scores half of `supabaseService` takes a
  `TenantContext` first, the raw `supabase` export is gone, and
  `tests/isolation/leads.test.ts` holds a 12-test cross-tenant suite.
  **110/110 passing.**
- **Task 8 is next, and must follow immediately** — the branch does not
  typecheck until it lands. See the sanctioned-breakage note below.

### Task 7 review outcome (2026-09-14)

Verdict: proceed with fixes, no Critical issues. All four flagged concerns were
accepted — the `supabaseAdmin` harness swap is the correct reading of the
dual-isolation decision, `reset-test-db.sh`'s Task 3 guards survived the edit
intact (26 insertions, 0 deletions, all additive after the guards), and all 61
tsc errors trace to a sanctioned cause.

**The one real finding, fixed in the addendum:** nine of the eleven tests passed
when the org scope matched *nothing*. The suite could not tell correct isolation
from total blindness — which is precisely what a wrong RLS policy produces in
Task 14. Every test now carries an "A can still reach A" positive control, and
`updateLeadSignal` (an id-addressed write the plan's own test list omitted) is
now covered. Mutation-verified both directions:

| Mutation | Before | After |
|---|---|---|
| Strip `.eq('org_id', ctx.orgId)` | 9 of 11 fail | 10 of 12 fail |
| Scope matches nothing (nil org) | 2 of 11 fail | **12 of 12 fail** |

The two survivors of the first mutation are legitimate and should stay:
`createLead stamps the caller's org` tests spread order, not filtering, and
`createLeadSignal ... composite FK` asserts the database layer deliberately.

Three obligations were written into Task 14 in the plan (flip the harness only
after positive controls exist; re-run isolation through the scoped client; keep
a service-role variant so the app layer stays independently testable). Task 8's
blast radius was corrected in the plan too — `routes/outreach.ts:9` and `:63`
call `db.supabase` inline and need rewriting, not just re-pointing.

**Known, not fixed** (deferred minors from the review): `backend/.eslintrc.cjs:9`
ignores `tests/`, so "lint exit 0" does not cover any test file — and
`tests/helpers/context.ts` importing `supabaseAdmin` is outside the fence by
accident rather than by decision; `schema.sql:224`'s
`outreach_history_message_org_fkey` has no `ON DELETE` action, which will bite
`teardownSeed` once Task 8 seeds history rows; and the `delete safe.org_id`
dance is repeated three times and wants a `stripOrgId` helper in Task 8.

### The branch does not typecheck between Tasks 7 and 8 — by design

`npx tsc --noEmit` reports **61 errors**. This is sanctioned: the JOBS, OUTREACH,
LOGS and METRICS sections of `supabaseService.ts` still reference the deleted
`supabase` binding, and Task 8 closes them. Verified attribution: 60 are caused
by Task 7, and exactly 1 (`routes/cron.ts:24`) predates it. Do not "fix" these
individually — run Task 8.

### Environment restored 2026-09-09 — one item outstanding

`anta-signal-test` (`yvukeeszxokhrkjcstds`) is **live again at the same project
ref**, and the suite runs: **77/77 passing**. Correcting the earlier entry in
this file: the project had been **paused, not deleted**. Supabase drops DNS for
a paused project, so the NXDOMAIN on both the project host and the `db.` host
was not the proof of deletion it was recorded as. Restoring it brought the same
ref back.

`SUPABASE_JWT_SECRET` is now set in `.env` (88 chars, opaque — the right shape).

**`SUPABASE_TEST_JWT_SECRET` — RESOLVED (verified 2026-09-14).** This file
previously recorded it as holding the service-role API key rather than the
signing secret. It was corrected during Task 6 and nobody updated this entry.
It is now 88 characters and opaque (the right shape), and distinct from
`SUPABASE_TEST_SERVICE_ROLE_KEY`, which is a 219-character JWT. Task 6's suite
passes against PostgREST, which is the real proof. No action needed.

### The test project's DB host is IPv6-only (found 2026-09-14)

`db.yvukeeszxokhrkjcstds.supabase.co` now resolves to an **AAAA record only**.
On an IPv4-only network the `pg` harness cannot connect and every DB-backed
suite times out — a bare `npx vitest run` reports something like
`1 failed | 31 passed | 75 skipped`, which looks like a test failure and is not
one. The REST endpoint is unaffected (it answers over IPv4 through the CDN), so
the project is fine.

**Workaround — the IPv4 session pooler. APPLIED 2026-09-14, and it needed a
code fix to work.** `.env.test` now uses the pooler URL. Two things were wrong
when it was first applied: the URL had never actually been switched (it still
named the direct host, which is why runs kept timing out), and `projectRef()`'s
pooler branch anchored on the FIRST `@` — this project's DB password contains a
literal `@`, so the ref came back null and `setup.ts` fail-closed on every
DB-backed suite. The pattern is greedy now (last `@` = the real separator) and
`setup-guard.test.ts` covers an `@`-bearing password in both directions. Full
suite: **111/111 passing over the pooler.**

Point `SUPABASE_TEST_DB_URL` at
`postgresql://postgres.<ref>:<pw>@aws-0-us-east-2.pooler.supabase.com:5432/postgres`.
Note the ref moves out of the hostname and into the username. `projectRef()` in
`backend/tests/setup.ts` now parses that third shape, so the
production-collision guard stays armed instead of failing closed on an
unparseable ref; `tests/setup-guard.test.ts` covers it, including that a
non-Supabase pooler host and a ref-less username still return null.

**`reset-test-db.sh` still cannot run on an IPv4-only network.** Its `ref_of`
deliberately refuses pooler URLs, and that guard was *not* loosened — it is the
only destructive script in the repo. If the pooler becomes the normal path,
extend `ref_of` the same way `projectRef` was extended rather than relaxing it.

Also note: run vitest from `backend/`, not the repo root. The config lives at
`backend/vitest.config.ts` and a root-level run silently skips `setupFiles`,
which surfaces as `Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`.

The app's own project (`lgendecyizgfyajaooud`) is still gone. `.env` still names
it, which is deliberate — `backend/tests/setup.ts`'s guard compares the test ref
against it, the two differ, and the guard is armed (`tests/setup-guard.test.ts`
passes).

### What Task 4 closed: `schema.sql` was never complete

Task 4 found that `supabase/schema.sql` only ever defined **7 of the 12**
org-scoped tables — `users`, `jobs`, `cron_job_logs`, `job_signals` and
`job_submissions` lived only in migrations. Pre-existing drift, months old.

Fixed at the root in `f12e080` rather than worked around: the five tables are
folded into `schema.sql` with `org_id` from the start, and `reset-test-db.sh`
now applies `schema.sql` **alone** and no longer replays migrations. That is
the correct split — `schema.sql` builds a fresh database, migrations upgrade an
existing one — and it deleted the scaffolding, the chronological-order
dependency, the `add_platform_config.sql` skip, the dedup and the benign-error
filter in one move. `hot_leads` is recreated in the migration's Section G so
the upgrade path converges with `schema.sql`.

Closing the five-table gap surfaced more old drift that had to go for the paths
to converge: a missing `'remote_jobs'` enum value, `leads.source_count` and
`contributing_sources`, `scraping_logs.job_id` and its `'finalizing'` status,
and a `jobs` partial index where the real database has a `UNIQUE (external_id)`
constraint. `refresh_tokens` was added too (no `org_id` — it is auth
infrastructure scoped by `user_id`).

**The parity gate:** `supabase/schema-parity-check.sh` builds two throwaway
local-postgres databases — one by replaying migrations, one from `schema.sql`
alone — and diffs `pg_dump --schema-only`. It converges to nothing but
`org_id`'s column ordinal position. It never touches a Supabase project. Note
it always exits non-zero (the expected `org_id` divergence guarantees it), so
it is an eyeball aid, not a CI assertion.

**Task 12 owes this file a debt:** it org-scopes `jobs_external_id_key`, and
must change **both** `schema.sql` and the migration, then re-run the parity
script. Nothing in CI enforces that.

## Environment: the app's Supabase project was deleted

On 2026-08-26 the app's Supabase project (`lgendecyizgfyajaooud`) was deleted
and its data lost. `anta-signal-test` (`yvukeeszxokhrkjcstds`) is the **test**
database only, named by `.env.test`.

`.env`, `signal-engine/.env` and `frontend/.env.local` deliberately still hold
the deleted project's credentials, each marked with a header comment. They give
`backend/tests/setup.ts`'s guard a production reference to compare against, and
they differ from the test project's, so the guard stays armed. Do **not** copy
the test project's credentials into `.env` — that makes the refs identical and
the guard correctly refuses to run anything.

Still to do when convenient: recreate the app's Supabase project and rebuild it
from `schema.sql`; `SUPABASE_JWT_SECRET` is not set in `.env` and Task 6 needs
it; `.env.test`'s DB password contains a literal `@`, which `psql` mis-parses
(node-postgres is fine) and which `reset-test-db.sh` works around.
