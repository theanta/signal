# ANTA Lead Radar — Multi-Tenant SaaS Foundation

**Date:** 2026-08-26
**Status:** Approved design, pending implementation plan
**Scope:** Sub-project A (tenancy) + minimum slice of B (job durability)

---

## Problem

ANTA Lead Radar is a single-user tool. Releasing it to paying tenants requires
tenant isolation that does not exist today:

- No `org_id` on any of the 13 tables.
- RLS is enabled but every policy is `service_role_all` (`supabase/schema.sql:314`),
  and the backend holds the service-role key. RLS is decorative; every logged-in
  user can read every row.
- `platform_config` is a global singleton hardcoded to ANTA's own identity
  (`supabase/schema.sql:267`). It drives both scraping targets and outreach
  generation.
- Scrape job state lives in a process dict (`signal-engine/main.py:108`). A
  redeploy vaporizes in-flight jobs, and only the process holding the dict can
  serve that job's SSE stream.
- The signal engine has no authentication and `allow_origins=["*"]`
  (`signal-engine/main.py:102`) while holding the Supabase service-role key and
  writing directly to `jobs` (`signal-engine/main.py:503`).
- External API keys (Apify, Serper, Groq, MillionVerifier) are global env vars
  with no per-tenant attribution or cap.
- No tests anywhere in the repo.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Launch shape | Design partners, manual onboarding, invoiced directly | No signup/billing surface to build or secure in month 1 |
| Isolation | Dual: typed app-layer scoping **and** enforcing RLS | Chosen deliberately over app-only; DB fails closed |
| Org membership | One org per user | No design partner needs multi-org; it doubles policy complexity |
| Child-table scoping | Denormalized `org_id` + composite FK | Identical index-backed policies; drift made unrepresentable |
| Job store | Postgres | Supabase already present; Redis/Celery is infra for a 20-scrape/day workload |
| RAG | Deferred to month 2; `pgvector` enabled now | Schema convention set so RAG is additive, no empty speculative tables |

## Out of scope (month 2+)

Self-serve signup, Stripe billing, plan tiers, quota tiers, cost dashboards,
a real worker pool, RAG ingestion and retrieval, multi-org membership.

---

## Section 1 — Tenancy data model

New root table `organizations`: `id`, `name`, `slug`, `plan`, `status`,
`monthly_scrape_cap`, `created_at`.

`users` gains `org_id UUID NOT NULL REFERENCES organizations(id)`. The existing
`role` (`admin`/`member`) becomes org-scoped rather than global.

### org_id placement

| Tables | Treatment |
|---|---|
| `leads`, `jobs`, `scraping_logs`, `cron_job_logs`, `users` | `org_id NOT NULL`, owned directly |
| `lead_signals`, `lead_scores`, `outreach_messages`, `outreach_history`, `job_signals`, `job_submissions` | `org_id NOT NULL`, denormalized from parent |
| `platform_config` | `org_id UNIQUE NOT NULL`; singleton becomes one row per tenant |
| `refresh_tokens` | No `org_id` — auth infrastructure, scoped by `user_id`. Adding one creates a second source of truth for a session's org |

Denormalizing `org_id` onto child tables keeps all 12 RLS policies byte-identical
and index-backed. Joining up to the parent in a policy is slower and produces a
differently-written policy per table.

### Drift is made impossible by the database

```sql
ALTER TABLE leads ADD CONSTRAINT leads_id_org_uniq UNIQUE (id, org_id);

ALTER TABLE lead_signals
  DROP CONSTRAINT lead_signals_lead_id_fkey,
  ADD CONSTRAINT lead_signals_lead_org_fkey
    FOREIGN KEY (lead_id, org_id)
    REFERENCES leads (id, org_id) ON DELETE CASCADE;
```

Same pattern for all six child tables (`lead_signals`, `lead_scores`,
`outreach_messages`, `outreach_history` → `leads`; `job_signals`,
`job_submissions` → `jobs`). A child row whose org disagrees with its parent
becomes unrepresentable rather than merely discouraged.

`outreach_history.message_id → outreach_messages(id)` is a nullable
same-org reference and gets the same composite treatment.

### Backfill

Exactly one tenant exists today, so the backfill is one-shot: create the `ANTA`
org, `UPDATE ... SET org_id = <anta_id>` on every table, then `SET NOT NULL`.
The existing `platform_config` row becomes ANTA's row unchanged.

### RAG readiness

Enable the `pgvector` extension in this migration. Do **not** create
`documents`/`document_chunks` tables yet. When RAG lands it follows the same
`org_id` + composite-FK convention and is purely additive.

---

## Section 2 — Dual-enforcement request flow

### Prerequisite: authenticate the signal engine

Shipped standalone before any schema work. Add a shared-secret `X-Engine-Key`
header check as a FastAPI dependency on every route, and replace
`allow_origins=["*"]` with the backend origin. Without this, any party who
finds the Render URL can write into any org once tenancy exists.

### Two clients, structurally separated

```
backend/services/supabaseAdmin.ts    → service-role client. Imported ONLY by
                                       authController, cron, engine callbacks.
backend/services/supabaseService.ts  → tenant-scoped functions only.
                                       Never exports a raw client.
```

An ESLint `no-restricted-imports` rule forbidding `supabaseAdmin` from
`controllers/**` makes the boundary a CI failure rather than a matter of
memory. This also removes the current three-independent-`createClient` problem
(`supabaseService.ts:15`, `configService.ts:6`, `routes/health.ts:13`).

### TenantContext

An `orgId: string` parameter is easy to satisfy with the wrong string. The
scoped client travels *with* the org id so the two cannot be mismatched:

```ts
// shared/types
export type OrgId = string & { readonly __brand: 'OrgId' };

export interface TenantContext {
  orgId: OrgId;
  userId: string;
  db: SupabaseClient;   // already carries the org-scoped JWT
}
```

```ts
// supabaseService.ts — no ambient client, no optional org
export async function getLeads(ctx: TenantContext, filters?: LeadFilters) {
  return ctx.db.from('leads').select('*').eq('org_id', ctx.orgId) /* … */;
}
```

Only the auth middleware mints a `TenantContext`.

### Scoped JWT minting

The login JWT gains an `org_id` claim. `authenticate` verifies it as today, then
builds the context with a short-lived Supabase-compatible token:

```ts
const token = jwt.sign(
  { sub: userId, org_id: orgId, role: 'authenticated' },
  process.env.SUPABASE_JWT_SECRET!, { expiresIn: '5m' }
);
req.ctx = { orgId, userId, db: createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } } }) };
```

### RLS backstop

Two policies per table, identical across all 12:

```sql
CREATE POLICY "org_isolation" ON leads FOR ALL TO authenticated
  USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
CREATE POLICY "service_role_all" ON leads FOR ALL TO service_role USING (true);
```

### Python engine

Stays on service-role. `org_id` becomes a required field on `/analyze` and
`/scrape` request bodies, validated against the caller's `TenantContext` in
`signalEngineService` before the request goes out. The engine writes `org_id`
onto every row it persists. It never determines an org itself — it is told one
by an authenticated backend.

### Folded-in refactor

The analysis-persistence logic duplicated between `routes/cron.ts:112` and
`controllers/leadsController.ts:118` collapses into a single
`persistAnalysis(ctx, …)`. Both call sites now require org scoping, and scoping
the same logic in two places is how one gets missed. This also closes the known
`contact_email_confidence` staleness bug in both locations.

---

## Section 3 — Job durability and metering floor

### Postgres as the job store

```sql
CREATE TABLE scrape_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  status       TEXT NOT NULL CHECK (status IN
                 ('queued','running','finalizing','completed','failed')),
  sources      TEXT[] NOT NULL,
  config       JSONB NOT NULL,   -- snapshot; a config edit mid-run cannot alter it
  worker_id    TEXT,
  claimed_at   TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scrape_job_events (
  job_id  UUID NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  seq     BIGSERIAL PRIMARY KEY,
  org_id  UUID NOT NULL,
  event   JSONB NOT NULL
);
```

Events move from `scrape_jobs[job_id]["events"].append(...)` to inserts. The SSE
endpoint streams from Postgres by polling `seq > last_seen`, so any engine
instance can serve any job's stream and a dropped client reconnects with
`Last-Event-ID` instead of losing the run.

Execution stays in-process (`BackgroundTasks`). A real worker pool is month 2 and
is not needed at 5–10 tenants.

### Concurrency control

```sql
CREATE UNIQUE INDEX one_active_scrape_per_org ON scrape_jobs (org_id)
  WHERE status IN ('queued','running');
```

One active scrape per tenant, enforced by the database. No coordination logic to
write, and one tenant cannot starve the others.

### Orphan reaping

The engine writes `heartbeat_at` during a run; a sweep marks anything stale past
15 minutes as `failed`. Required — without it the partial unique index becomes a
permanent lock on any tenant whose job died during a deploy.

### Metering floor

```sql
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL, job_id UUID,
  provider TEXT NOT NULL,     -- apify | serper | groq | millionverifier
  units INT NOT NULL, cost_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

One insert per external call site. Attribution only, not billing — it gives
month 2's quota work real data.

Plus a hard guard: `organizations.monthly_scrape_cap` (default 100) checked
before enqueue. Roughly ten lines, and the only thing between an enthusiastic
design partner and an uncapped Apify bill.

---

## Section 4 — Testing, migration sequencing, cutover

### The dual-enforcement testing constraint

With both app-layer scoping and RLS active, a completely broken RLS policy is
invisible: the app filter already returned the correct rows. **Each layer must
be tested with the other disabled.** This is a design constraint of the chosen
isolation model, not a preference.

| Suite | Runner | Proves |
|---|---|---|
| Cross-tenant isolation | Vitest | Table-driven over every exported `supabaseService` function: seed orgs A and B, call as A, assert B's rows are never returned or mutated |
| RLS in isolation | Vitest, raw client | Org-scoped JWT with no app filter; the policy alone must block |
| Composite FK | SQL/Vitest | A child row whose `org_id` disagrees with its parent fails at the database |
| Engine auth | pytest | Unauthenticated and wrong-key requests to `/analyze` and `/scrape` are rejected |

Test target is a dedicated Supabase project rather than local Docker, so RLS
behavior matches production.

### Sequencing

Single tenant today, so no expand/contract ceremony. Take a maintenance window.

1. **Engine auth**, shipped standalone — independent, live security hole, no schema change.
2. **One migration:** `organizations`; nullable `org_id` everywhere; backfill ANTA; `SET NOT NULL`; composite FKs; partial unique indexes; enable `pgvector`.
3. **Code cutover:** admin/service client split, `TenantContext`, `org_id` login claim, `persistAnalysis` consolidation.
4. **RLS switched on last** — deliberately. A wrong policy that is the only thing standing locks you out of your own data with no app-layer path to debug through. Prove app scoping first, enable the backstop, then run the RLS-in-isolation suite.
5. **Job store + engine cutover**, then delete the `scrape_jobs` dict.
6. **`scripts/create-org.ts`** — creates org, admin user, default `platform_config` row. This is the onboarding product for design partners.

At step 3, existing JWTs carry no `org_id` claim: purge `refresh_tokens` and
force re-login. Trivial at one user; a surprise at fifty.

### Effort

| Piece | Estimate |
|---|---|
| Engine auth (prereq) | 2 days |
| Schema + migration + backfill | 4 days |
| Client split, `TenantContext`, service refactor (~18 files) | 6 days |
| RLS policies + enabling | 3 days |
| Test suites (all four) | 5 days |
| Job store + SSE-from-Postgres + reaper | 6 days |
| Metering floor + scrape cap | 2 days |
| `create-org` script + runbook | 1 day |
| **Total** | **~29 working days ≈ 6 weeks solo** |

Design partner #1 onboards early week 6, not week 4. If week 5 is a hard
deadline, the compressible items are SSE-from-Postgres (keep the dict for reads
only) and the metering floor — together about one week.

## Risks

- **Six weeks against a one-month expectation.** Stated and accepted; the
  compressible slice is identified above.
- **Dual enforcement doubles the surface to keep in sync.** Mitigated by the
  RLS-in-isolation suite, which is the only thing that detects divergence.
- **First tests in the repo are being written against the security boundary.**
  Correct priority, but there is no existing harness, so suite setup cost is
  real and included in the 5-day estimate.
- **Composite FK migration rewrites six foreign keys** on tables with existing
  data. Low risk at current row counts; must be run in the maintenance window.
