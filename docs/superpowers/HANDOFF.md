# Signal Repo — Session Handoff

**Last updated:** 2026-08-27
**Branch:** `feat/multi-tenant-saas` (16 commits, unpushed, clean tree)

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
- **Plan 2:** `docs/superpowers/plans/2026-08-26-tenancy-foundation.md` — written,
  15 tasks, not started.
- Plan 3 is **not yet written**.

## The three plans

| Plan | Deliverable | Days | Status |
|---|---|---|---|
| 1. Signal engine authentication | Engine rejects unauthenticated calls | 2 | **Complete** |
| 2. Tenancy foundation | `org_id`, composite FKs, `TenantContext`, RLS, isolation suites | 18 | **In progress — 4 of 15 tasks** |
| 3. Job durability + metering | Postgres job store, reaper, usage events, scrape cap | 9 | Not written |

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

`ENGINE_API_KEY` must be set on **both** Render services, identical values.
Deploy the engine first — it starts rejecting immediately, and the old backend
will 401 until it follows. A key was added to the local `.env` (gitignored).

## Known issues not yet addressed

- **`signal-engine/venv` has stale shebangs.** Built when the project lived at
  `Projects/signal`; it is now `Projects/ANTA/signal`. `pip` and `uvicorn`
  scripts are broken; `./venv/bin/python -m <tool>` works. `npm run dev:signal`
  calls bare `uvicorn`, so it needs the venv activated. Recreate the venv when
  convenient.
- **`MILLIONVERIFIER_API_KEY` is not set locally**, so the pattern-email
  verification added in `b74cc84` is silently doing nothing.
- **Open code-review findings on `b74cc84`** (see the review section below).

## Open code-review findings (commit b74cc84)

Reviewed but NOT fixed, except where noted:

1. `signal-engine/main.py:268` — 45s `find_contact` budget vs ~100s worst case;
   on timeout the whole contact is discarded including the LinkedIn person.
2. `backend/controllers/leadsController.ts:118` and `backend/routes/cron.ts:112`
   — `contact_email_confidence` written only inside email branches, so a
   re-analysis returning a different person leaves a stale address badged
   `verified`. **Plan 2 fixes this** by collapsing both into `persistAnalysis`.
3. `contact_finder.py:373` — Stage 3a matches email to person by bare substring
   (`'dan' in 'danielle'`), assigning another employee's inbox at `verified`.
4. `contact_finder.py:189` — company guard is substring-based and short-circuits
   when `_company_tokens` is empty.
5. `contact_finder.py:262` — early break on first personal email aborts JSON-LD
   people collection, so contact gets an email but no name.
6. `contact_finder.py:395` — `break` on `unknown` also fires on a transient
   verifier 503, abandoning remaining candidates.
7. `.env.example` — **FIXED** in this branch.

## Pre-existing architecture drift (documented, not fixed)

- Only 3 of 9 backend route files use a controller; `cron.ts` holds 273 lines of
  orchestration inline and duplicates `leadsController`'s persistence logic.
- Three independent `createClient` calls (`supabaseService.ts:15`,
  `configService.ts:6`, `routes/health.ts:13`). Plan 2 consolidates these.
- 6 frontend files bypass `frontend/services/` and hit `@/lib/api` directly.
- God files: `frontend/app/jobs/[id]/page.tsx` (1127 lines),
  `frontend/app/leads/[id]/page.tsx` (1034), `signal-engine/main.py` (874).

## Plan 2 execution state (2026-08-27)

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
- **Task 4 implemented (`dd6f19f`) but its fix round is unfinished.** See below.
- **Tasks 5-15 not started.** Next after Task 4: Task 5, the `supabaseAdmin`
  split and the ESLint import fence.
- 68 tests passing at the stopping point; `npx tsc --noEmit` reports exactly 4
  errors, all object literals missing `org_id` in `authController.ts` and
  `routes/cron.ts`, which Tasks 7-11 fix.

### Open: `schema.sql` was never complete

Task 4 found that `supabase/schema.sql` only ever defined **7 of the 12**
org-scoped tables — `users`, `jobs`, `cron_job_logs`, `job_signals` and
`job_submissions` live only in migrations. Pre-existing drift, months old.

The committed state works around it by having `reset-test-db.sh` backfill those
five tables itself, which left `schema.sql` worse as a standalone artifact:
applied alone it now yields a database with `org_id NOT NULL` everywhere, an
empty `organizations` table so nothing can be inserted, and five tables missing.

**The decided fix, dispatched but not completed:** fold the five tables into
`schema.sql` with `org_id` from the start, then make `reset-test-db.sh` apply
`schema.sql` alone and stop replaying migrations — `schema.sql` builds a fresh
database, migrations upgrade an existing one. The acceptance gate is a
`pg_dump --schema-only` diff between a replay-built database and a
`schema.sql`-built one, driven to nothing but `org_id`'s column position. Also
pending: recreating the `hot_leads` view in the migration's Section F, since a
migration-upgraded database's copy lacks `org_id` while `schema.sql`'s has it.
Full instruction is in the ledger under the Task 4 ruling.

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
