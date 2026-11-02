# Tenancy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ANTA Lead Radar from a single-user tool into a multi-tenant system where one tenant's leads, jobs, outreach and config are unreachable from another tenant's session, enforced both by typed application-layer scoping and by Postgres row-level security.

**Architecture:** Every domain table gains a denormalized `org_id` and a composite foreign key to its parent (`(lead_id, org_id) REFERENCES leads (id, org_id)`), so a child row whose org disagrees with its parent cannot be stored. The Express backend splits into two clients: `supabaseAdmin` (service-role, importable only by auth/cron/engine-callback code, enforced by ESLint) and `supabaseService` (exports functions only, never a client). Each function takes a `TenantContext` — a branded `orgId` bundled with a Supabase client that already carries a 5-minute org-scoped JWT — minted only by the auth middleware. RLS policies matching `org_id` against that JWT claim are switched on **last**, after app scoping is proven, and are then tested with the app filter removed so a broken policy cannot hide behind a working filter.

**Tech Stack:** Postgres 15 (Supabase), Node 20 / Express 4 / TypeScript 5.6, `@supabase/supabase-js` 2.45, `jsonwebtoken` 9, Vitest 2 (new), `pg` 8 (new, test-only), ESLint 8 with `@typescript-eslint` (new), Python 3.11 / FastAPI (engine), pytest 8.

**Spec:** `docs/superpowers/specs/2026-08-26-multi-tenant-saas-design.md` (Sections 1, 2 and 4; Section 3 is Plan 3)

## Global Constraints

- **One org per user.** No multi-org membership anywhere in schema, types or policies.
- **`refresh_tokens` never gets an `org_id`.** It is auth infrastructure, scoped by `user_id`. A second source of truth for a session's org is exactly the bug this design avoids.
- **RLS is enabled LAST (Task 14), never earlier.** Every task before it runs with the existing `service_role_all`-only policies in place. A wrong policy that is the only thing standing between you and your data leaves no app-layer path to debug through.
- **`supabaseService.ts` must not export a raw client** once Task 7 lands. `export const supabase` is deleted; every consumer goes through a function taking `TenantContext`.
- **Service-role usage is confined to** `authController.ts`, `routes/cron.ts`, engine-callback paths and `backend/scripts/**`. Enforced by ESLint `no-restricted-imports`, not by memory.
- **Tests run against a dedicated Supabase project**, never local Docker and never the production project. RLS behaviour must match production exactly.
- **The tenancy migration is one file**, `supabase/migrations/2026-08-26_tenancy_foundation.sql`, applied in a maintenance window. Tasks 2, 3 and 4 each append a section to it; it is not split into several migrations.
- **The 12 org-scoped tables are:** `users`, `leads`, `jobs`, `scraping_logs`, `cron_job_logs`, `lead_signals`, `lead_scores`, `outreach_messages`, `outreach_history`, `job_signals`, `job_submissions`, `platform_config`. Whenever a step says "every org-scoped table", it means exactly this list.
- **At cutover, purge `refresh_tokens` and force re-login.** Existing JWTs carry no `org_id` claim.
- Never log, echo or commit `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` or `ENGINE_API_KEY`.
- The `signal-engine/venv` has stale shebangs from an old project path. Run Python tooling as `./venv/bin/python -m pytest`, never bare `pytest` or `pip`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/2026-08-26_tenancy_foundation.sql` (create) | The single tenancy migration: `organizations`, `org_id` columns, backfill, `NOT NULL`, composite constraints, `pgvector`. |
| `supabase/migrations/2026-08-26_rls_policies.sql` (create) | Org-isolation RLS policies. Applied only in Task 14. |
| `supabase/schema.sql` (modify) | Kept in sync so a fresh project can be built from it. |
| `shared/types/index.ts` (modify) | `OrgId`, `TenantContext`, `Organization`, `org_id` on `JwtPayload` and on row types. |
| `backend/services/supabaseAdmin.ts` (create) | The one service-role client. Sole owner of `SUPABASE_SERVICE_ROLE_KEY`. |
| `backend/services/tenantContext.ts` (create) | Mints the 5-minute Supabase-compatible org-scoped JWT and the client that carries it. |
| `backend/services/supabaseService.ts` (modify) | Tenant-scoped data functions only. No exported client. |
| `backend/services/configService.ts` (modify) | Per-org `platform_config` row; no more `createClient`. |
| `backend/services/persistAnalysis.ts` (create) | The single analysis-persistence path, replacing the copy in `leadsController` and the copy in `cron.ts`. |
| `backend/api/middleware/auth.ts` (modify) | Verifies the login JWT, builds `req.ctx`. |
| `backend/controllers/*.ts`, `backend/routes/*.ts` (modify) | Thread `req.ctx` through; remove direct `supabase` use from `routes/metrics.ts` and `routes/outreach.ts`. |
| `backend/routes/health.ts` (modify) | Use `supabaseAdmin` instead of its own `createClient`. |
| `backend/scripts/create-org.ts` (create) | Design-partner onboarding: org + admin user + default `platform_config`. |
| `backend/tests/helpers/*.ts` (create) | `pg` pool, seeding, context construction for tests. |
| `backend/tests/isolation/*.test.ts` (create) | Cross-tenant isolation over every exported service function. |
| `backend/tests/rls/*.test.ts` (create) | RLS proven with the app filter removed. |
| `backend/tests/schema/*.test.ts` (create) | Composite-FK and `NOT NULL` guarantees. |
| `backend/.eslintrc.cjs` (create) | The import boundary as a CI failure. |
| `signal-engine/main.py` (modify) | `org_id` required on `/analyze` and `/scrape`; written onto every persisted row. |
| `signal-engine/tests/test_org_scoping.py` (create) | Engine rejects org-less requests. |
| `docs/runbooks/tenancy-cutover.md` (create) | The maintenance-window procedure. |

---

### Task 1: Test harness against a dedicated Supabase project

Nothing in this plan can be proven without a database to prove it against. This
task creates the harness first: a second Supabase project, a `pg` connection for
DDL and raw-SQL assertions, and Vitest wired into the backend workspace. The
repo currently has no Vitest, no ESLint config (despite a `lint` script) and no
TypeScript tests at all.

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/tests/setup.ts`
- Create: `backend/tests/helpers/db.ts`
- Create: `backend/tests/smoke.test.ts`
- Create: `.env.test.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `sql(text: string, params?: unknown[]): Promise<QueryResult>` and `closePool(): Promise<void>` from `backend/tests/helpers/db.ts`; the npm script `npm run test --workspace @anta/backend`.

- [ ] **Step 1: Create the test Supabase project and record its credentials**

In the Supabase dashboard create a new project named `anta-lead-radar-test`.
From **Project Settings → API** copy the project URL, the `anon` key, the
`service_role` key and the JWT secret. From **Project Settings → Database** copy
the connection string (session mode, port 5432).

Create `.env.test` in the repo root (NOT committed) with those values:

```
SUPABASE_TEST_URL=https://<test-ref>.supabase.co
SUPABASE_TEST_ANON_KEY=<anon key>
SUPABASE_TEST_SERVICE_ROLE_KEY=<service role key>
SUPABASE_TEST_JWT_SECRET=<jwt secret>
SUPABASE_TEST_DB_URL=postgresql://postgres:<password>@db.<test-ref>.supabase.co:5432/postgres
```

Create `.env.test.example` in the repo root with the same keys and empty values,
plus this header:

```
# ============================================================
# Test-only Supabase project. NEVER point these at production —
# the suites in backend/tests/ truncate tables between runs.
# Copy to .env.test and fill in from the Supabase dashboard.
# ============================================================
SUPABASE_TEST_URL=
SUPABASE_TEST_ANON_KEY=
SUPABASE_TEST_SERVICE_ROLE_KEY=
SUPABASE_TEST_JWT_SECRET=
SUPABASE_TEST_DB_URL=
```

Append to `.gitignore`:

```
.env.test
```

- [ ] **Step 2: Add the test dependencies**

```bash
cd backend && npm install -D vitest@^2.1.0 pg@^8.13.0 @types/pg@^8.11.10 dotenv@^16.4.5
```

Add to the `scripts` block of `backend/package.json`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Write the Vitest config**

Create `backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Every suite shares one Supabase test project and truncates between
    // runs. Parallel files would delete each other's fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Write the setup file and DB helper**

Create `backend/tests/setup.ts`:

```ts
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../../.env.test') });

const REQUIRED = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_JWT_SECRET',
  'SUPABASE_TEST_DB_URL',
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(
      `${key} is not set. Copy .env.test.example to .env.test and fill it in ` +
      `from the anta-lead-radar-test Supabase project.`,
    );
  }
}

// Guard against ever running the destructive suites against production.
if (process.env.SUPABASE_URL && process.env.SUPABASE_TEST_URL === process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_TEST_URL equals SUPABASE_URL — refusing to run tests against production.');
}
```

Create `backend/tests/helpers/db.ts`:

```ts
import { Pool, QueryResult } from 'pg';

// supabase-js cannot run DDL, and the RLS suites need to assert against raw
// Postgres. A direct connection to the test project covers both.
const pool = new Pool({
  connectionString: process.env.SUPABASE_TEST_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

export function sql(text: string, params: unknown[] = []): Promise<QueryResult> {
  return pool.query(text, params);
}

export function closePool(): Promise<void> {
  return pool.end();
}
```

- [ ] **Step 5: Write the smoke test**

Create `backend/tests/smoke.test.ts`:

```ts
import { afterAll, expect, it } from 'vitest';
import { sql, closePool } from './helpers/db';

afterAll(async () => {
  await closePool();
});

it('connects to the test database', async () => {
  const result = await sql('SELECT current_database() AS db');
  expect(result.rows[0].db).toBe('postgres');
});

it('is not pointed at the production project', () => {
  expect(process.env.SUPABASE_TEST_URL).not.toBe(process.env.SUPABASE_URL);
});
```

- [ ] **Step 6: Run it**

Run: `cd backend && npm test`
Expected: 2 passing tests.

- [ ] **Step 7: Load the current schema into the test project**

The test project is empty. Apply the existing schema and every existing
migration so the tenancy migration has something to alter:

```bash
cd /Users/anadithakur/Documents/Claude/Projects/ANTA/signal
psql "$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)" -v ON_ERROR_STOP=1 -f supabase/schema.sql
# SUPERSEDED — see supabase/migrations/README.md. This glob replays in
# alphabetical order, which fails: migrations depending on `jobs` sort before
# the migration that creates it. Use the README's chronological list.
while read -r f; do
  [ -n "$f" ] && psql "$DBURL" -f "supabase/migrations/$f"
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)
```

Some migrations are already folded into `schema.sql` and will fail on
"already exists". That is expected: `schema.sql` is the base, migrations are
incremental. Re-run only the ones that error for a different reason and note any
that genuinely cannot apply.

Verify the 13 tables landed:

```bash
psql "$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)" -c "\dt"
```

Expected: `leads`, `lead_signals`, `lead_scores`, `outreach_messages`,
`outreach_history`, `scraping_logs`, `platform_config`, `users`,
`refresh_tokens`, `jobs`, `job_signals`, `job_submissions`, `cron_job_logs`.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.ts \
        backend/tests .env.test.example .gitignore
git commit -m "test: add Vitest harness against a dedicated Supabase test project"
```

---

### Task 2: `organizations` table, `org_id` columns, backfill

The migration file starts here. It creates the tenancy root, adds a nullable
`org_id` to all 12 tables, backfills the single existing tenant, then tightens
to `NOT NULL`. `pgvector` is enabled now so month-2 RAG is purely additive.

**Files:**
- Create: `supabase/migrations/2026-08-26_tenancy_foundation.sql`
- Create: `backend/tests/schema/tenancy-columns.test.ts`

**Interfaces:**
- Consumes: `sql()` from `backend/tests/helpers/db.ts` (Task 1).
- Produces: table `organizations (id, name, slug, plan, status, monthly_scrape_cap, created_at)`; a non-null `org_id UUID` on each of the 12 org-scoped tables; `platform_config.org_id` additionally `UNIQUE`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/schema/tenancy-columns.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { sql, closePool } from '../helpers/db';

afterAll(async () => {
  await closePool();
});

const ORG_SCOPED_TABLES = [
  'users', 'leads', 'jobs', 'scraping_logs', 'cron_job_logs',
  'lead_signals', 'lead_scores', 'outreach_messages', 'outreach_history',
  'job_signals', 'job_submissions', 'platform_config',
];

describe('organizations table', () => {
  it('exists with the expected columns', async () => {
    const { rows } = await sql(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'organizations' ORDER BY column_name`,
    );
    const names = rows.map(r => r.column_name);
    expect(names).toEqual([
      'created_at', 'id', 'monthly_scrape_cap', 'name', 'plan', 'slug', 'status',
    ]);
  });

  it('holds exactly the backfilled ANTA org', async () => {
    const { rows } = await sql(`SELECT slug FROM organizations`);
    expect(rows.map(r => r.slug)).toContain('anta');
  });
});

describe.each(ORG_SCOPED_TABLES)('%s', (table) => {
  it('has a NOT NULL org_id referencing organizations', async () => {
    const { rows } = await sql(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_name = $1 AND column_name = 'org_id'`,
      [table],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].data_type).toBe('uuid');
  });

  it('rejects a row with an org_id that is not a real organization', async () => {
    await expect(
      sql(`INSERT INTO ${table} (org_id) VALUES ('00000000-0000-0000-0000-000000000000')`),
    ).rejects.toThrow();
  });
});

it('does NOT add org_id to refresh_tokens', async () => {
  const { rows } = await sql(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'refresh_tokens' AND column_name = 'org_id'`,
  );
  expect(rows).toHaveLength(0);
});

it('has pgvector available for month-2 RAG', async () => {
  const { rows } = await sql(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/schema/tenancy-columns.test.ts`
Expected: FAIL — `organizations` does not exist, every `org_id` assertion returns zero rows.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/2026-08-26_tenancy_foundation.sql`:

```sql
-- ============================================================
-- Tenancy foundation.
--
-- Converts a single-tenant schema into a multi-tenant one in a single
-- maintenance window. Exactly one tenant exists today, so the backfill is
-- one-shot: create the ANTA org, stamp it on every row, then tighten to
-- NOT NULL. There is no expand/contract ceremony because there is nobody
-- to be compatible with.
--
-- Run inside a transaction. See docs/runbooks/tenancy-cutover.md.
-- ============================================================

BEGIN;

-- pgvector is enabled now, with no tables, so that month-2 RAG is purely
-- additive and follows the same org_id convention as everything else.
CREATE EXTENSION IF NOT EXISTS vector;

-- ---- Section A: the tenancy root ----

CREATE TABLE organizations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL,
  slug               TEXT UNIQUE NOT NULL,
  plan               TEXT NOT NULL DEFAULT 'design_partner',
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'suspended')),
  -- Read by Plan 3's enqueue guard. Present now so organizations has its
  -- final shape and Plan 3 needs no second migration on this table.
  monthly_scrape_cap INT  NOT NULL DEFAULT 100,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (name, slug) VALUES ('ANTA', 'anta');

-- ---- Section B: nullable org_id everywhere ----

ALTER TABLE users             ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE leads             ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE jobs              ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE scraping_logs     ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE cron_job_logs     ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE lead_signals      ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE lead_scores       ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE outreach_messages ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE outreach_history  ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE job_signals       ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE job_submissions   ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE platform_config   ADD COLUMN org_id UUID REFERENCES organizations(id);

-- refresh_tokens deliberately gets no org_id: it is auth infrastructure
-- scoped by user_id, and a second source of truth for a session's org is
-- precisely the drift this design exists to prevent.

-- ---- Section C: backfill the one existing tenant ----

DO $$
DECLARE anta UUID;
BEGIN
  SELECT id INTO STRICT anta FROM organizations WHERE slug = 'anta';

  UPDATE users             SET org_id = anta WHERE org_id IS NULL;
  UPDATE leads             SET org_id = anta WHERE org_id IS NULL;
  UPDATE jobs              SET org_id = anta WHERE org_id IS NULL;
  UPDATE scraping_logs     SET org_id = anta WHERE org_id IS NULL;
  UPDATE cron_job_logs     SET org_id = anta WHERE org_id IS NULL;
  UPDATE lead_signals      SET org_id = anta WHERE org_id IS NULL;
  UPDATE lead_scores       SET org_id = anta WHERE org_id IS NULL;
  UPDATE outreach_messages SET org_id = anta WHERE org_id IS NULL;
  UPDATE outreach_history  SET org_id = anta WHERE org_id IS NULL;
  UPDATE job_signals       SET org_id = anta WHERE org_id IS NULL;
  UPDATE job_submissions   SET org_id = anta WHERE org_id IS NULL;
  UPDATE platform_config   SET org_id = anta WHERE org_id IS NULL;
END $$;

-- ---- Section D: tighten ----

ALTER TABLE users             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE leads             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE jobs              ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE scraping_logs     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cron_job_logs     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE lead_signals      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE lead_scores       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE outreach_messages ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE outreach_history  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE job_signals       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE job_submissions   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE platform_config   ALTER COLUMN org_id SET NOT NULL;

-- platform_config stops being a global singleton and becomes one row per
-- tenant. The existing ANTA row is now ANTA's row, unchanged.
ALTER TABLE platform_config
  ADD CONSTRAINT platform_config_org_uniq UNIQUE (org_id);

-- ---- Section E: indexes ----
-- Every RLS policy and every app-layer filter is `org_id = ...`, so each of
-- these is on the hot path of every query the product makes.

CREATE INDEX idx_users_org             ON users(org_id);
CREATE INDEX idx_leads_org             ON leads(org_id);
CREATE INDEX idx_jobs_org              ON jobs(org_id);
CREATE INDEX idx_scraping_logs_org     ON scraping_logs(org_id);
CREATE INDEX idx_cron_job_logs_org     ON cron_job_logs(org_id);
CREATE INDEX idx_lead_signals_org      ON lead_signals(org_id);
CREATE INDEX idx_lead_scores_org       ON lead_scores(org_id);
CREATE INDEX idx_outreach_messages_org ON outreach_messages(org_id);
CREATE INDEX idx_outreach_history_org  ON outreach_history(org_id);
CREATE INDEX idx_job_signals_org       ON job_signals(org_id);
CREATE INDEX idx_job_submissions_org   ON job_submissions(org_id);

COMMIT;
```

- [ ] **Step 4: Apply it to the test project**

```bash
cd /Users/anadithakur/Documents/Claude/Projects/ANTA/signal
psql "$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/2026-08-26_tenancy_foundation.sql
```

Expected: `COMMIT`, no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/schema/tenancy-columns.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/2026-08-26_tenancy_foundation.sql backend/tests/schema
git commit -m "feat(db): add organizations and org_id to every tenant-scoped table"
```

---

### Task 3: Composite foreign keys make org drift unrepresentable

An `org_id` column that merely exists can disagree with its parent's. The
composite FK is what turns "a child row in the wrong org" from a bug you have to
remember to prevent into a row Postgres refuses to store.

Existing FK constraint names follow the Postgres default (`<table>_<column>_fkey`);
Step 1 verifies that before Step 3 drops them by name.

**Files:**
- Modify: `supabase/migrations/2026-08-26_tenancy_foundation.sql`
- Create: `backend/tests/schema/composite-fk.test.ts`

**Interfaces:**
- Consumes: the `org_id` columns and `organizations` table from Task 2.
- Produces: unique constraints `leads_id_org_uniq`, `jobs_id_org_uniq`, `outreach_messages_id_org_uniq`; composite FKs `lead_signals_lead_org_fkey`, `lead_scores_lead_org_fkey`, `outreach_messages_lead_org_fkey`, `outreach_history_lead_org_fkey`, `outreach_history_message_org_fkey`, `job_signals_job_org_fkey`, `job_submissions_job_org_fkey`, `jobs_converted_lead_org_fkey`.

- [ ] **Step 1: Confirm the existing constraint names**

```bash
psql "$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)" -c \
"SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
 WHERE contype = 'f'
   AND conrelid::regclass::text IN
     ('lead_signals','lead_scores','outreach_messages','outreach_history',
      'job_signals','job_submissions','jobs')
 ORDER BY 1, 2;"
```

Expected: `lead_signals_lead_id_fkey`, `lead_scores_lead_id_fkey`,
`outreach_messages_lead_id_fkey`, `outreach_history_lead_id_fkey`,
`outreach_history_message_id_fkey`, `job_signals_job_id_fkey`,
`job_submissions_job_id_fkey`, `jobs_converted_lead_id_fkey`.

If any name differs, use the actual name in Step 3's `DROP CONSTRAINT` and
change nothing else.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/schema/composite-fk.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, closePool } from '../helpers/db';

let orgA: string;
let orgB: string;
let leadA: string;
let jobA: string;

beforeAll(async () => {
  const a = await sql(
    `INSERT INTO organizations (name, slug) VALUES ('FK Org A', 'fk-org-a')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const b = await sql(
    `INSERT INTO organizations (name, slug) VALUES ('FK Org B', 'fk-org-b')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  orgA = a.rows[0].id;
  orgB = b.rows[0].id;

  const lead = await sql(
    `INSERT INTO leads (company_name, source, org_id) VALUES ('FK Co', 'manual', $1) RETURNING id`,
    [orgA],
  );
  leadA = lead.rows[0].id;

  const job = await sql(
    `INSERT INTO jobs (company_name, org_id) VALUES ('FK Co', $1) RETURNING id`,
    [orgA],
  );
  jobA = job.rows[0].id;
});

afterAll(async () => {
  await sql(`DELETE FROM leads WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM jobs  WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM organizations WHERE slug IN ('fk-org-a', 'fk-org-b')`);
  await closePool();
});

describe('lead children cannot disagree with their lead about org', () => {
  it('rejects a lead_signal in org B pointing at a lead in org A', async () => {
    await expect(
      sql(`INSERT INTO lead_signals (lead_id, signal_type, org_id) VALUES ($1, 'hiring', $2)`,
          [leadA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('accepts a lead_signal in the same org as its lead', async () => {
    const r = await sql(
      `INSERT INTO lead_signals (lead_id, signal_type, org_id) VALUES ($1, 'hiring', $2) RETURNING id`,
      [leadA, orgA],
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  it('rejects a lead_score in the wrong org', async () => {
    await expect(
      sql(`INSERT INTO lead_scores (lead_id, overall_score, org_id) VALUES ($1, 50, $2)`,
          [leadA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects an outreach_message in the wrong org', async () => {
    await expect(
      sql(`INSERT INTO outreach_messages (lead_id, channel, body, org_id)
           VALUES ($1, 'email', 'hi', $2)`, [leadA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects outreach_history in the wrong org', async () => {
    await expect(
      sql(`INSERT INTO outreach_history (lead_id, org_id) VALUES ($1, $2)`, [leadA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('job children cannot disagree with their job about org', () => {
  it('rejects a job_signal in the wrong org', async () => {
    await expect(
      sql(`INSERT INTO job_signals (job_id, org_id) VALUES ($1, $2)`, [jobA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects a job_submission in the wrong org', async () => {
    await expect(
      sql(`INSERT INTO job_submissions (job_id, profile_label, org_id)
           VALUES ($1, 'Someone', $2)`, [jobA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('cross-org references between siblings', () => {
  it('rejects a job in org B converted from a lead in org A', async () => {
    await expect(
      sql(`INSERT INTO jobs (company_name, converted_lead_id, org_id)
           VALUES ('X', $1, $2)`, [leadA, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects outreach_history pointing at another org’s message', async () => {
    const msg = await sql(
      `INSERT INTO outreach_messages (lead_id, channel, body, org_id)
       VALUES ($1, 'email', 'hi', $2) RETURNING id`, [leadA, orgA],
    );
    const leadB = await sql(
      `INSERT INTO leads (company_name, source, org_id) VALUES ('B Co', 'manual', $1) RETURNING id`,
      [orgB],
    );
    await expect(
      sql(`INSERT INTO outreach_history (lead_id, message_id, org_id) VALUES ($1, $2, $3)`,
          [leadB.rows[0].id, msg.rows[0].id, orgB]),
    ).rejects.toThrow(/foreign key/i);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/schema/composite-fk.test.ts`
Expected: FAIL — the cross-org inserts all succeed, because only the plain
single-column FKs exist.

- [ ] **Step 4: Append the composite constraints to the migration**

Insert this block into `supabase/migrations/2026-08-26_tenancy_foundation.sql`
immediately **before** the final `COMMIT;`:

```sql
-- ---- Section F: make org drift unrepresentable ----
--
-- A denormalized org_id that can disagree with its parent's is worse than no
-- org_id, because it looks correct. The composite FK removes the possibility
-- rather than discouraging it. Each parent first needs a UNIQUE (id, org_id)
-- for the composite reference to target.

ALTER TABLE leads
  ADD CONSTRAINT leads_id_org_uniq UNIQUE (id, org_id);
ALTER TABLE jobs
  ADD CONSTRAINT jobs_id_org_uniq UNIQUE (id, org_id);
ALTER TABLE outreach_messages
  ADD CONSTRAINT outreach_messages_id_org_uniq UNIQUE (id, org_id);

ALTER TABLE lead_signals
  DROP CONSTRAINT lead_signals_lead_id_fkey,
  ADD CONSTRAINT lead_signals_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE;

ALTER TABLE lead_scores
  DROP CONSTRAINT lead_scores_lead_id_fkey,
  ADD CONSTRAINT lead_scores_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE;

ALTER TABLE outreach_messages
  DROP CONSTRAINT outreach_messages_lead_id_fkey,
  ADD CONSTRAINT outreach_messages_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE;

ALTER TABLE outreach_history
  DROP CONSTRAINT outreach_history_lead_id_fkey,
  ADD CONSTRAINT outreach_history_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE;

-- message_id is nullable. MATCH SIMPLE (the default) skips the check when any
-- referencing column is NULL, which is exactly the wanted behaviour: history
-- rows with no generated message stay legal, and ones that name a message must
-- name a message in their own org.
ALTER TABLE outreach_history
  DROP CONSTRAINT outreach_history_message_id_fkey,
  ADD CONSTRAINT outreach_history_message_org_fkey
    FOREIGN KEY (message_id, org_id) REFERENCES outreach_messages (id, org_id);

ALTER TABLE job_signals
  DROP CONSTRAINT job_signals_job_id_fkey,
  ADD CONSTRAINT job_signals_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES jobs (id, org_id) ON DELETE CASCADE;

ALTER TABLE job_submissions
  DROP CONSTRAINT job_submissions_job_id_fkey,
  ADD CONSTRAINT job_submissions_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES jobs (id, org_id) ON DELETE CASCADE;

-- jobs.converted_lead_id is a sibling reference, also nullable, same treatment.
ALTER TABLE jobs
  DROP CONSTRAINT jobs_converted_lead_id_fkey,
  ADD CONSTRAINT jobs_converted_lead_org_fkey
    FOREIGN KEY (converted_lead_id, org_id) REFERENCES leads (id, org_id);
```

- [ ] **Step 5: Re-apply the migration to a clean test project**

The migration is not idempotent and Task 2 already ran it. Reset the test
project's schema and apply everything from scratch:

```bash
cd /Users/anadithakur/Documents/Claude/Projects/ANTA/signal
DBURL="$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)"
psql "$DBURL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
# Replay order is CHRONOLOGICAL, not alphabetical, and the difference is not
# cosmetic: migrations that depend on `jobs` sort before the migration that
# creates it. The authoritative ordered list, and the reasoning, are in
# supabase/migrations/README.md — keep this array in sync with it.
while read -r f; do
  [ -n "$f" ] && psql "$DBURL" -f "supabase/migrations/$f"
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)

# schema.sql and add_platform_config.sql both seed platform_config, and the
# pre-tenancy table has no unique constraint for their ON CONFLICT to match —
# so a replay leaves two rows and the tenancy migration's UNIQUE (org_id) then
# fails. Drop the duplicate before migrating. See README.md.
psql "$DBURL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config a USING platform_config b
   WHERE a.ctid < b.ctid;"
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/migrations/2026-08-26_tenancy_foundation.sql
```

Record this reset sequence — Tasks 4 and 14 reuse it. Save it as
`backend/tests/reset-test-db.sh` (mode `+x`) so it stops being retyped.

**This script is the only destructive operation in the plan, so it verifies its
own target before dropping anything.** Task 1's guard in `tests/setup.ts`
compares the test project against production, but it can only do that when a
repo-root `.env` exists to compare against — on a fresh checkout with no `.env`
there is no production reference and the guard skips. That is exactly the state
in which a mispasted connection string does damage here. The check below needs
no production reference at all: it refuses unless the DB URL and the API URL
name the *same* project, which a production connection string pasted beside a
test API URL cannot satisfy.

```bash
#!/usr/bin/env bash
# Resets the Supabase TEST project to a clean schema. Destructive by design.
#
# It cannot rely on tests/setup.ts's production guard: that guard compares
# against the repo-root .env, which need not exist. Instead this asserts the
# two test variables describe one and the same project — a production
# connection string beside a test API URL fails that, with no knowledge of
# what production is.
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env.test ] || { echo "No .env.test — see .env.test.example" >&2; exit 1; }
set -a; . ./.env.test; set +a

ref_of() { printf '%s' "$1" | sed -nE 's#.*[/@](db\.)?([a-z0-9]{16,})\.supabase\.(co|com).*#\2#p'; }

api_ref="$(ref_of "${SUPABASE_TEST_URL:-}")"
db_ref="$(ref_of "${SUPABASE_TEST_DB_URL:-}")"

[ -n "$api_ref" ] || { echo "Cannot parse a project ref from SUPABASE_TEST_URL" >&2; exit 1; }
[ -n "$db_ref" ]  || { echo "Cannot parse a project ref from SUPABASE_TEST_DB_URL" >&2; exit 1; }
[ "$api_ref" = "$db_ref" ] || {
  echo "REFUSING TO DROP: SUPABASE_TEST_DB_URL is project '$db_ref' but" >&2
  echo "SUPABASE_TEST_URL is project '$api_ref'. They must be the same project." >&2
  exit 1
}

echo "About to DROP SCHEMA public CASCADE on project: $api_ref"
psql "$SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
# Chronological order, per supabase/migrations/README.md — NOT alphabetical:
# jobs-dependent migrations sort before the one that creates `jobs`.
while read -r f; do
  [ -n "$f" ] && psql "$SUPABASE_TEST_DB_URL" -f "supabase/migrations/$f"
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)

# Both schema.sql and add_platform_config.sql seed platform_config, and the
# pre-tenancy table has no unique constraint for ON CONFLICT to bite on, so a
# replay leaves two rows and UNIQUE (org_id) below fails. See README.md.
psql "$SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config a USING platform_config b WHERE a.ctid < b.ctid;"
psql "$SUPABASE_TEST_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/2026-08-26_tenancy_foundation.sql
```

Prove the refusal works before trusting it: run it once with
`SUPABASE_TEST_DB_URL` temporarily pointed at a different project ref and
confirm it exits non-zero having dropped nothing.

While in this area, close the matching gap in `backend/tests/setup.ts`: when the
repo-root `.env` yields no `SUPABASE_URL`, fall back to the ambient
`process.env.SUPABASE_URL` before concluding there is no production reference,
so the guard still works in CI where secrets arrive as environment variables
rather than files.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx vitest run tests/schema/`
Expected: PASS, both schema suites.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/2026-08-26_tenancy_foundation.sql \
        backend/tests/schema/composite-fk.test.ts backend/tests/reset-test-db.sh
git commit -m "feat(db): composite foreign keys so a child row's org cannot drift from its parent's"
```

---

### Task 4: Shared tenancy types and `schema.sql` sync

The database now has tenancy; TypeScript does not know it. This task adds the
branded `OrgId`, the `TenantContext` shape every later task depends on, and
`org_id` on the row types — and folds the migration into `schema.sql` so a fresh
project (including a future second test project) can be built from one file.

The brand is the point: `orgId: string` is trivially satisfied by the wrong
string — a user id, a lead id, a request param. `OrgId` can only be produced by
`asOrgId`, which the auth middleware calls and nothing else should.

**Files:**
- Modify: `shared/types/index.ts`
- Modify: `supabase/schema.sql`
- Create: `backend/tests/types/org-id.test.ts`

**Interfaces:**
- Consumes: the migration from Tasks 2 and 3.
- Produces:
  - `type OrgId = string & { readonly __brand: 'OrgId' }`
  - `function asOrgId(value: string): OrgId`
  - `interface TenantContext { orgId: OrgId; userId: string; db: SupabaseClient }`
  - `interface Organization { id: string; name: string; slug: string; plan: string; status: 'active' | 'suspended'; monthly_scrape_cap: number; created_at: string }`
  - `JwtPayload` gains `org_id: string`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/types/org-id.test.ts`:

```ts
import { expect, it } from 'vitest';
import { asOrgId } from '../../../shared/types';

it('rejects a value that is not a UUID', () => {
  expect(() => asOrgId('not-a-uuid')).toThrow(/OrgId/);
});

it('rejects an empty string', () => {
  expect(() => asOrgId('')).toThrow(/OrgId/);
});

it('returns the same string for a valid UUID', () => {
  const uuid = '3f0a2c1e-9b6d-4f2a-8c1b-5d7e9a0b1c2d';
  expect(asOrgId(uuid)).toBe(uuid);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/types/org-id.test.ts`
Expected: FAIL — `asOrgId` is not exported from `shared/types`.

- [ ] **Step 3: Add the types**

Append to `shared/types/index.ts`:

```ts
// ============================================================
// TENANCY
// ============================================================

/**
 * A branded organization id.
 *
 * A plain `orgId: string` parameter is satisfied by any string in scope —
 * a user id, a lead id, a route param — and the compiler is happy while the
 * query returns another tenant's rows. Only `asOrgId` produces an `OrgId`,
 * and only the auth middleware should call it.
 */
export type OrgId = string & { readonly __brand: 'OrgId' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asOrgId(value: string): OrgId {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid OrgId: ${JSON.stringify(value)}`);
  }
  return value as OrgId;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'active' | 'suspended';
  monthly_scrape_cap: number;
  created_at: string;
}
```

Add `org_id: string;` as the first field of each of these existing interfaces in
`shared/types/index.ts`: `Lead`, `Job`, `LeadSignal`, `LeadScore`,
`OutreachMessage`, `ScrapingLog`, `CronJobLog`, `JobSignal`, `JobSubmission`,
`AuthUser`.

Add `org_id: string;` to `JwtPayload`, directly after `sub`:

```ts
export interface JwtPayload {
  sub: string;
  org_id: string;
  email: string;
  name: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
```

- [ ] **Step 4: Add `TenantContext`**

`TenantContext` carries a `SupabaseClient`, so it cannot live in the
dependency-free `shared/types/index.ts` without pulling `@supabase/supabase-js`
into the frontend bundle. Create it in the backend instead.

Create `backend/services/tenantContext.ts` with only the type for now (Task 6
adds the constructor):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgId } from '../../shared/types';

/**
 * Everything a request needs to touch tenant data, as one value.
 *
 * The org id and the client travel together deliberately: `db` already carries
 * a JWT whose `org_id` claim equals `orgId`, so app-layer filter and RLS policy
 * cannot be given different orgs by a caller who threads one and forgets the
 * other.
 */
export interface TenantContext {
  orgId: OrgId;
  userId: string;
  db: SupabaseClient;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/types/org-id.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Fold the migration into `schema.sql`**

`supabase/schema.sql` is the from-scratch build. Bring it in line so a new
project does not need the migration replayed:

1. After `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` (line 7) add
   `CREATE EXTENSION IF NOT EXISTS vector;`
2. Immediately after the extensions, add the `organizations` table definition
   verbatim from Section A of `2026-08-26_tenancy_foundation.sql` (the
   `CREATE TABLE organizations (...)` statement, not the `INSERT`).
3. Add `org_id UUID NOT NULL REFERENCES organizations(id),` as the second column
   of every one of the 12 org-scoped tables that `schema.sql` defines.
4. Replace each child table's inline `REFERENCES leads(id) ON DELETE CASCADE` /
   `REFERENCES jobs(id) ON DELETE CASCADE` with a table-level composite
   constraint matching Section F, and add the three `UNIQUE (id, org_id)`
   constraints to `leads`, `jobs` and `outreach_messages`.
5. Add the `idx_*_org` indexes from Section E.

Do **not** copy the RLS policies from Section F's file — `schema.sql` keeps its
existing `service_role_all` policies until Task 14 rewrites both together.

- [ ] **Step 7: Verify `schema.sql` still builds from empty**

```bash
cd /Users/anadithakur/Documents/Claude/Projects/ANTA/signal
DBURL="$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)"
psql "$DBURL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$DBURL" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO organizations (name, slug) VALUES ('ANTA', 'anta');"
# Replay order is CHRONOLOGICAL, not alphabetical, and the difference is not
# cosmetic: migrations that depend on `jobs` sort before the migration that
# creates it. The authoritative ordered list, and the reasoning, are in
# supabase/migrations/README.md — keep this array in sync with it.
while read -r f; do
  [ -n "$f" ] && psql "$DBURL" -f "supabase/migrations/$f"
done < <(grep -oE '^[A-Za-z0-9_.-]+\.sql$' supabase/migrations/README.md)

# schema.sql and add_platform_config.sql both seed platform_config, and the
# pre-tenancy table has no unique constraint for their ON CONFLICT to match —
# so a replay leaves two rows and the tenancy migration's UNIQUE (org_id) then
# fails. Drop the duplicate before migrating. See README.md.
psql "$DBURL" -v ON_ERROR_STOP=1 -c \
  "DELETE FROM platform_config a USING platform_config b
   WHERE a.ctid < b.ctid;"
cd backend && npx vitest run tests/schema/
```

Expected: `schema.sql` applies with no errors, and both schema suites pass
against a project built from `schema.sql` alone.

Update `backend/tests/reset-test-db.sh` to this shorter sequence (schema.sql +
the ANTA insert) now that `schema.sql` is complete.

- [ ] **Step 8: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit`
Expected: errors only in files that construct `Lead`/`Job`/etc. literals without
`org_id`. Those are fixed in Tasks 7–11; note the list and leave them.

```bash
git add shared/types/index.ts supabase/schema.sql backend/services/tenantContext.ts \
        backend/tests/types backend/tests/reset-test-db.sh
git commit -m "feat: add OrgId, TenantContext and Organization types; sync schema.sql"
```

---

### Task 5: Split the service-role client out and fence it with ESLint

Today three separate `createClient` calls hold the service-role key
(`supabaseService.ts:15`, `configService.ts:6`, `routes/health.ts:13`), and any
controller can import the one `supabaseService` exports. This task creates a
single admin client, points the stragglers at it, and makes importing it from a
controller a lint failure rather than something to remember.

`backend/package.json` has a `lint` script but the repo has no ESLint config at
all, so `npm run lint` currently fails in the backend. This task fixes that too.

**Files:**
- Create: `backend/services/supabaseAdmin.ts`
- Create: `backend/.eslintrc.cjs`
- Modify: `backend/package.json`
- Modify: `backend/routes/health.ts`
- Create: `backend/tests/lint/import-boundary.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `supabaseAdmin: SupabaseClient` from `backend/services/supabaseAdmin.ts`.

- [ ] **Step 1: Install ESLint**

```bash
cd backend && npm install -D eslint@^8.57.1 @typescript-eslint/parser@^8.8.0 \
  @typescript-eslint/eslint-plugin@^8.8.0
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/lint/import-boundary.test.ts`:

```ts
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, expect, it } from 'vitest';

const dir = mkdtempSync(path.join(tmpdir(), 'anta-lint-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function lint(relativePath: string, source: string): string {
  const file = path.join(__dirname, '../..', relativePath);
  writeFileSync(file, source);
  try {
    execFileSync('npx', ['eslint', '--format', 'json', file], {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
    });
    return '';
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? '');
  } finally {
    rmSync(file, { force: true });
  }
}

it('forbids importing supabaseAdmin from a controller', () => {
  const out = lint(
    'controllers/__lintProbe.ts',
    `import { supabaseAdmin } from '../services/supabaseAdmin';\nexport const x = supabaseAdmin;\n`,
  );
  expect(out).toMatch(/no-restricted-imports/);
});

it('forbids importing supabaseAdmin from a route', () => {
  const out = lint(
    'routes/__lintProbe.ts',
    `import { supabaseAdmin } from '../services/supabaseAdmin';\nexport const x = supabaseAdmin;\n`,
  );
  expect(out).toMatch(/no-restricted-imports/);
});

it('allows importing supabaseAdmin from a service', () => {
  const out = lint(
    'services/__lintProbe.ts',
    `import { supabaseAdmin } from './supabaseAdmin';\nexport const x = supabaseAdmin;\n`,
  );
  expect(out).not.toMatch(/no-restricted-imports/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/lint/import-boundary.test.ts`
Expected: FAIL — no ESLint config exists, so `eslint` errors out for an
unrelated reason and no `no-restricted-imports` message appears.

- [ ] **Step 4: Create the admin client**

Create `backend/services/supabaseAdmin.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * The one service-role client in the process.
 *
 * Service-role bypasses RLS entirely, so this client sees every tenant's rows.
 * It exists for the three jobs that legitimately have no tenant context:
 * authentication (finding a user before an org is known), the cron runner
 * (iterating orgs), and engine callbacks. Everything else goes through a
 * TenantContext.
 *
 * The ESLint no-restricted-imports rule in .eslintrc.cjs keeps controllers and
 * routes from importing this. Widen that rule only with a reason.
 */
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
```

- [ ] **Step 5: Write the ESLint config**

Create `backend/.eslintrc.cjs`:

```js
/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2020: true },
  ignorePatterns: ['dist/', 'node_modules/', 'tests/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // The service-role client bypasses RLS. Request-handling code must reach
      // the database through a TenantContext, never around it — this makes that
      // a CI failure instead of a code-review habit.
      files: ['controllers/**/*.ts', 'routes/**/*.ts', 'api/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['**/supabaseAdmin', '**/services/supabaseAdmin'],
            message:
              'supabaseAdmin bypasses RLS. Use a TenantContext-scoped function ' +
              'from supabaseService instead. Genuine exceptions (auth, cron, ' +
              'engine callbacks) belong in services/ or scripts/.',
          }],
        }],
      },
    },
  ],
};
```

`routes/cron.ts` needs no exception: it reaches the database through
`supabaseService`, not through a client of its own. It becomes a service-role
caller only in Task 13, and that is exactly why Task 13 moves its orchestration
into `backend/services/cronRunner.ts` rather than adding a disable comment here.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/lint/import-boundary.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Point `routes/health.ts` at the admin client**

Replace the body of the Supabase probe in `backend/routes/health.ts` so it stops
creating its own client:

```ts
import { Router } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { healthCheck as signalEngineHealthCheck } from '../services/signalEngineService';

const router = Router();

router.get('/', async (_req, res) => {
  const [supabaseResult, signalResult] = await Promise.allSettled([
    (async () => {
      const { error } = await supabaseAdmin.from('organizations').select('id').limit(1);
      if (error) throw error;
    })(),
    signalEngineHealthCheck(),
  ]);

  res.json({
    supabase: supabaseResult.status === 'fulfilled' ? 'ok' : 'error',
    groq: process.env.GROQ_API_KEY ? 'ok' : 'error',
    signal_engine:
      signalResult.status === 'fulfilled' && signalResult.value ? 'ok' : 'error',
  });
});

export default router;
```

The probe now reads `organizations` rather than `leads`: health should not
depend on a tenant table having rows, and this is the one table guaranteed
non-empty in any deployed environment.

Add the disable comment to the top of this file, since `routes/**` is fenced:

```ts
/* eslint-disable no-restricted-imports -- health probes the database itself,
   before and independent of any tenant session. */
```

- [ ] **Step 8: Verify lint passes on the real tree**

Run: `cd backend && npm run lint`
Expected: exit 0 (warnings from `no-explicit-any` are acceptable; errors are not).

- [ ] **Step 9: Commit**

```bash
git add backend/services/supabaseAdmin.ts backend/.eslintrc.cjs backend/package.json \
        backend/package-lock.json backend/routes/health.ts backend/tests/lint
git commit -m "refactor: single service-role client, fenced off from controllers by ESLint"
```

---

### Task 6: Mint org-scoped contexts in the auth middleware

This is the only place a `TenantContext` is created. The login token gains an
`org_id` claim; `authenticate` verifies it and builds a client carrying a
separate, short-lived, Supabase-compatible JWT whose `org_id` claim is what the
Task 14 RLS policies will read.

Two different tokens are in play and confusing them is the failure mode: the
**login token** is signed with `JWT_SECRET` and is what the browser holds; the
**scoped token** is signed with `SUPABASE_JWT_SECRET`, lives 5 minutes, never
leaves the server, and exists only so PostgREST will accept the request as the
`authenticated` role.

**Files:**
- Modify: `backend/services/tenantContext.ts`
- Modify: `backend/api/middleware/auth.ts`
- Modify: `backend/controllers/authController.ts`
- Modify: `backend/tests/setup.ts`
- Create: `backend/tests/helpers/context.ts`
- Create: `backend/tests/auth/tenant-context.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `TenantContext` and `asOrgId` (Task 4); `supabaseAdmin` (Task 5).
- Produces:
  - `createTenantContext(orgId: string, userId: string): TenantContext` from `backend/services/tenantContext.ts`
  - `req.ctx?: TenantContext` on Express `Request`
  - `ctxOf(req: Request): TenantContext` from `backend/api/middleware/auth.ts`

- [ ] **Step 1: Map the test env onto the real env names**

`tenantContext.ts` reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_JWT_SECRET`. Tests must exercise the real function, not a copy of it,
so the harness supplies the test project under those names — after the
production guard has already run.

Append to `backend/tests/setup.ts`:

```ts
// The production guard above has already run. Point the modules under test at
// the test project using the names they actually read.
process.env.SUPABASE_URL = process.env.SUPABASE_TEST_URL;
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_TEST_JWT_SECRET;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-login-jwt-secret';
```

Move the existing production-equality guard so it compares
`SUPABASE_TEST_URL` against the value loaded from `.env` **before** this
reassignment. Load `.env` explicitly for that comparison:

```ts
import { config } from 'dotenv';
import path from 'path';

const prod = config({ path: path.resolve(__dirname, '../../.env'), processEnv: {} });
config({ path: path.resolve(__dirname, '../../.env.test') });

// ... REQUIRED loop unchanged ...

if (prod.parsed?.SUPABASE_URL && prod.parsed.SUPABASE_URL === process.env.SUPABASE_TEST_URL) {
  throw new Error('SUPABASE_TEST_URL equals the production SUPABASE_URL — refusing to run.');
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/auth/tenant-context.test.ts`:

```ts
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantContext } from '../../services/tenantContext';
import { sql, closePool } from '../helpers/db';

let orgId: string;
let userId: string;

beforeAll(async () => {
  const org = await sql(
    `INSERT INTO organizations (name, slug) VALUES ('Ctx Org', 'ctx-org')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  orgId = org.rows[0].id;
  const user = await sql(
    `INSERT INTO users (email, password_hash, name, org_id)
     VALUES ('ctx@example.test', 'x', 'Ctx', $1)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [orgId],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await sql(`DELETE FROM users WHERE email = 'ctx@example.test'`);
  await sql(`DELETE FROM organizations WHERE slug = 'ctx-org'`);
  await closePool();
});

describe('createTenantContext', () => {
  it('rejects an orgId that is not a UUID', () => {
    expect(() => createTenantContext('nope', userId)).toThrow(/OrgId/);
  });

  it('returns a context whose orgId is the one asked for', () => {
    const ctx = createTenantContext(orgId, userId);
    expect(ctx.orgId).toBe(orgId);
    expect(ctx.userId).toBe(userId);
  });

  it('gives the client a JWT whose org_id claim matches ctx.orgId', () => {
    const ctx = createTenantContext(orgId, userId);
    const header = (ctx.db as unknown as {
      rest: { headers: Record<string, string> };
    }).rest.headers['Authorization'];
    const token = header.replace('Bearer ', '');
    const claims = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as Record<string, unknown>;
    expect(claims.org_id).toBe(orgId);
    expect(claims.role).toBe('authenticated');
    expect(claims.sub).toBe(userId);
  });

  it('gives that JWT a short life', () => {
    const ctx = createTenantContext(orgId, userId);
    const header = (ctx.db as unknown as {
      rest: { headers: Record<string, string> };
    }).rest.headers['Authorization'];
    const claims = jwt.decode(header.replace('Bearer ', '')) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  it('can actually read through PostgREST with that token', async () => {
    const ctx = createTenantContext(orgId, userId);
    const { error } = await ctx.db.from('organizations').select('id').limit(1);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/auth/tenant-context.test.ts`
Expected: FAIL — `createTenantContext` is not exported.

- [ ] **Step 4: Implement `createTenantContext`**

Replace `backend/services/tenantContext.ts` with:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { asOrgId } from '../../shared/types';
import type { OrgId } from '../../shared/types';

/**
 * Everything a request needs to touch tenant data, as one value.
 *
 * The org id and the client travel together deliberately: `db` already carries
 * a JWT whose `org_id` claim equals `orgId`, so app-layer filter and RLS policy
 * cannot be given different orgs by a caller who threads one and forgets the
 * other.
 */
export interface TenantContext {
  orgId: OrgId;
  userId: string;
  db: SupabaseClient;
}

const SCOPED_TOKEN_TTL_SECONDS = 300;

/**
 * Mint a request-scoped context.
 *
 * The token signed here is NOT the login token. It is a Supabase-compatible
 * JWT signed with SUPABASE_JWT_SECRET so PostgREST accepts the request as the
 * `authenticated` role and the org_isolation RLS policies can read its org_id
 * claim. It never leaves the server and lives five minutes.
 *
 * Called by the auth middleware and by scripts. Nothing else should call it —
 * an org id from a request body is not an authenticated org id.
 */
export function createTenantContext(orgId: string, userId: string): TenantContext {
  const branded = asOrgId(orgId);

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!url || !anonKey || !jwtSecret) {
    throw new Error(
      'Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_JWT_SECRET — ' +
      'cannot mint an org-scoped database client.',
    );
  }

  const token = jwt.sign(
    { sub: userId, org_id: branded, role: 'authenticated', aud: 'authenticated' },
    jwtSecret,
    { expiresIn: SCOPED_TOKEN_TTL_SECONDS },
  );

  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return { orgId: branded, userId, db };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/auth/tenant-context.test.ts`
Expected: PASS, 5 tests.

If the last test fails with a JWT error, the `SUPABASE_TEST_JWT_SECRET` in
`.env.test` does not match the test project's actual secret — fix the env, not
the code.

- [ ] **Step 6: Put `org_id` in the login token**

In `backend/controllers/authController.ts`:

Change `generateAccessToken` to carry the org:

```ts
function generateAccessToken(user: AuthUser): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    org_id: user.org_id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ACCESS_EXPIRY } as jwt.SignOptions);
}
```

In `login`, add `org_id` when building `authUser`:

```ts
  const authUser: AuthUser = {
    id: user.id,
    org_id: user.org_id,
    email: user.email,
    name: user.name,
    role: user.role,
    last_login: user.last_login,
    created_at: user.created_at,
  };
```

In `refresh`, the same, reading from `tokenRow.users.org_id`:

```ts
  const authUser: AuthUser = {
    id: tokenRow.users.id,
    org_id: tokenRow.users.org_id,
    email: tokenRow.users.email,
    name: tokenRow.users.name,
    role: tokenRow.users.role,
    last_login: tokenRow.users.last_login,
    created_at: tokenRow.users.created_at,
  };
```

In `me`, widen the select to include the column:

```ts
    .select('id, org_id, email, name, role, last_login, created_at')
```

In `register`, a new user joins the org of the admin creating them. Replace the
bootstrap/admin block's outcome so the org is resolved before the insert:

```ts
  // Bootstrap: the very first user creates nothing here — the org must already
  // exist, created by scripts/create-org.ts. Otherwise the caller's own org is
  // the org the new user joins; there is no cross-org user creation.
  let orgId: string;

  const { count } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true });

  const isBootstrap = count === 0;

  if (isBootstrap) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (!org) {
      res.status(409).json({
        success: false,
        error: 'No organization exists. Run scripts/create-org.ts first.',
      });
      return;
    }
    orgId = org.id;
  } else {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
      if (payload.role !== 'admin') {
        res.status(403).json({ success: false, error: 'Admin access required to create users' });
        return;
      }
      orgId = payload.org_id;
    } catch {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
  }
```

and add `org_id: orgId,` to the `users` insert payload, and `org_id` to its
`.select(...)` list.

Finally, switch this file's import from `supabaseService` to the admin client —
auth runs before any org is known:

```ts
import { supabaseAdmin } from '../services/supabaseAdmin';
```

and replace every `supabase.` in the file with `supabaseAdmin.`. This file is
under `controllers/`, so add at the top:

```ts
/* eslint-disable no-restricted-imports -- authentication necessarily runs
   before a tenant context exists: it is what produces one. */
```

- [ ] **Step 7: Build `req.ctx` in the middleware**

Replace `backend/api/middleware/auth.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../../shared/types';
import { createTenantContext, TenantContext } from '../../services/tenantContext';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      ctx?: TenantContext;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = header.slice(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    res.status(401).json({ success: false, error: 'Token expired or invalid' });
    return;
  }

  // Tokens minted before the tenancy cutover carry no org. There is no safe
  // default org to pick, so the session ends and the user logs in again.
  if (!payload.org_id) {
    res.status(401).json({ success: false, error: 'Session predates tenancy — please log in again' });
    return;
  }

  req.user = payload;
  try {
    req.ctx = createTenantContext(payload.org_id, payload.sub);
  } catch {
    res.status(401).json({ success: false, error: 'Invalid session organization' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

/**
 * Narrow `req.ctx` for handlers running behind `authenticate`.
 *
 * Express types it optional because the middleware is not in the type system.
 * Every handler in this codebase runs behind `authenticate`, so a missing ctx
 * is a wiring bug, not a request the client can provoke.
 */
export function ctxOf(req: Request): TenantContext {
  if (!req.ctx) {
    throw new Error('No TenantContext on request — route is missing the authenticate middleware');
  }
  return req.ctx;
}
```

- [ ] **Step 8: Document the new env var**

In `.env.example`, under the `# ---- Supabase ----` block, add:

```
# JWT secret from Supabase → Project Settings → API. Used to mint the
# short-lived org-scoped tokens the RLS policies read. NOT the same as
# JWT_SECRET, which signs the login token the browser holds.
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

Set a real value in the local `.env` from the production project's dashboard.

- [ ] **Step 9: Verify and commit**

Run: `cd backend && npx vitest run tests/auth/ && npm run lint`
Expected: 5 tests pass, lint exits 0.

```bash
git add backend/services/tenantContext.ts backend/api/middleware/auth.ts \
        backend/controllers/authController.ts backend/tests/setup.ts \
        backend/tests/auth .env.example
git commit -m "feat: mint org-scoped TenantContext in the auth middleware"
```

---

### Task 7: Tenant-scope the leads half of `supabaseService`

The exported `supabase` client disappears here and every leads-side function
takes a `TenantContext` as its first parameter. The isolation suite is written
first and is table-driven, so Task 8 extends it by adding rows rather than by
writing new tests.

The seed helper creates two complete orgs with the same-shaped data. Every
assertion is the same shape: act as A, never see or touch B.

**Three defects in this task's own reference code, found during execution and
fixed in the implementation — do not copy the snippets below verbatim into
Task 8:** (1) `'archived'` is not a member of the `lead_status` enum, so the
`updateLead` assertion passed on a type violation and survived mutation — use
`'contacted'`; (2) `getScorePercentile` cannot return 0 with one score per org,
because `data.length < 2` forces 50 — the scoped sample needs a second score;
(3) `lead_signals.confidence_score` is `FLOAT CHECK (>= 0 AND <= 1)`, so the
seed's `70` fails outright — use `0.7`. The test list below also omits
`updateLeadSignal`, an id-addressed write that is exactly the attack shape this
task defines; it is covered in the addendum.

**Files:**
- Create: `backend/tests/helpers/context.ts`
- Create: `backend/tests/helpers/seed.ts`
- Create: `backend/tests/isolation/leads.test.ts`
- Modify: `backend/services/supabaseService.ts`

**Interfaces:**
- Consumes: `createTenantContext` (Task 6); `sql` (Task 1).
- Produces:
  - `makeTestContext(orgId: string, userId?: string): TenantContext`
  - `seedTwoOrgs(): Promise<TwoOrgs>` where
    `interface TwoOrgs { a: SeededOrg; b: SeededOrg }` and
    `interface SeededOrg { orgId: string; userId: string; leadId: string; jobId: string; messageId: string; ctx: TenantContext }`
  - `teardownSeed(): Promise<void>`
  - Re-signatured service functions:
    `getLeads(ctx, filters?)`, `getLeadById(ctx, id)`, `createLead(ctx, lead)`,
    `updateLead(ctx, id, updates)`, `upsertLeadByWebsite(ctx, lead)`,
    `createLeadSignal(ctx, signal)`, `updateLeadSignal(ctx, id, updates)`,
    `getLeadSignals(ctx, leadId)`, `createLeadScore(ctx, score)`,
    `upsertLeadScore(ctx, score)`, `getLeadScore(ctx, leadId)`,
    `getScorePercentile(ctx, score)`.

- [ ] **Step 1: Write the seed helpers**

Create `backend/tests/helpers/context.ts`:

```ts
import { createTenantContext, TenantContext } from '../../services/tenantContext';

const ANY_USER = '00000000-0000-0000-0000-0000000000ff';

export function makeTestContext(orgId: string, userId: string = ANY_USER): TenantContext {
  return createTenantContext(orgId, userId);
}
```

Create `backend/tests/helpers/seed.ts`:

```ts
import { sql } from './db';
import { makeTestContext } from './context';
import type { TenantContext } from '../../services/tenantContext';

export interface SeededOrg {
  orgId: string;
  userId: string;
  leadId: string;
  jobId: string;
  messageId: string;
  ctx: TenantContext;
}

export interface TwoOrgs {
  a: SeededOrg;
  b: SeededOrg;
}

const SLUGS = ['iso-org-a', 'iso-org-b'];

async function seedOrg(slug: string, label: string): Promise<SeededOrg> {
  const org = await sql(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [label, slug],
  );
  const orgId = org.rows[0].id as string;

  const user = await sql(
    `INSERT INTO users (email, password_hash, name, role, org_id)
     VALUES ($1, 'x', $2, 'admin', $3) RETURNING id`,
    [`${slug}@example.test`, label, orgId],
  );

  const lead = await sql(
    `INSERT INTO leads (company_name, website, source, lead_score, status, org_id)
     VALUES ($1, $2, 'manual', 80, 'new', $3) RETURNING id`,
    [`${label} Co`, `https://${slug}.example.test`, orgId],
  );
  const leadId = lead.rows[0].id as string;

  const job = await sql(
    `INSERT INTO jobs (company_name, job_title, status, org_id)
     VALUES ($1, 'Engineer', 'new', $2) RETURNING id`,
    [`${label} Co`, orgId],
  );

  const message = await sql(
    `INSERT INTO outreach_messages (lead_id, channel, subject, body, org_id)
     VALUES ($1, 'email', $2, 'body', $3) RETURNING id`,
    [leadId, `${label} subject`, orgId],
  );

  await sql(
    `INSERT INTO lead_signals (lead_id, signal_type, confidence_score, org_id)
     VALUES ($1, 'hiring', 70, $2)`,
    [leadId, orgId],
  );

  await sql(
    `INSERT INTO lead_scores (lead_id, overall_score, org_id) VALUES ($1, 80, $2)`,
    [leadId, orgId],
  );

  await sql(
    `INSERT INTO scraping_logs (source, status, org_id) VALUES ('manual', 'completed', $1)`,
    [orgId],
  );

  return {
    orgId,
    userId: user.rows[0].id,
    leadId,
    jobId: job.rows[0].id,
    messageId: message.rows[0].id,
    ctx: makeTestContext(orgId, user.rows[0].id),
  };
}

/** Two structurally identical tenants. Every isolation test acts as A and asserts B is untouched. */
export async function seedTwoOrgs(): Promise<TwoOrgs> {
  await teardownSeed();
  return {
    a: await seedOrg(SLUGS[0], 'Alpha'),
    b: await seedOrg(SLUGS[1], 'Bravo'),
  };
}

export async function teardownSeed(): Promise<void> {
  // Children cascade from leads/jobs; users and configs are deleted explicitly
  // because organizations is only referenced, not cascaded from.
  await sql(
    `DELETE FROM leads WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM jobs WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM scraping_logs WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM cron_job_logs WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM platform_config WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(`DELETE FROM organizations WHERE slug = ANY($1)`, [SLUGS]);
}
```

- [ ] **Step 2: Write the failing isolation test**

Create `backend/tests/isolation/leads.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

describe('reads', () => {
  it('getLeads returns only the caller org’s leads', async () => {
    const { data } = await db.getLeads(orgs.a.ctx);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(l => l.org_id === orgs.a.orgId)).toBe(true);
    expect(data.map(l => l.id)).not.toContain(orgs.b.leadId);
  });

  it('getLeads honours filters without widening the org scope', async () => {
    const { data } = await db.getLeads(orgs.a.ctx, { min_score: 1, search: 'Bravo' });
    expect(data).toHaveLength(0);
  });

  it('getLeadById refuses another org’s lead', async () => {
    expect(await db.getLeadById(orgs.a.ctx, orgs.b.leadId)).toBeNull();
  });

  it('getLeadSignals returns nothing for another org’s lead', async () => {
    expect(await db.getLeadSignals(orgs.a.ctx, orgs.b.leadId)).toEqual([]);
  });

  it('getLeadScore returns null for another org’s lead', async () => {
    expect(await db.getLeadScore(orgs.a.ctx, orgs.b.leadId)).toBeNull();
  });

  it('getScorePercentile does not average in the other org’s scores', async () => {
    await sql(
      `INSERT INTO lead_scores (lead_id, overall_score, org_id) VALUES ($1, 5, $2)`,
      [orgs.b.leadId, orgs.b.orgId],
    );
    // Org A holds a single score of 80. A percentile computed over both orgs
    // would see a 5 below it and return something other than 0.
    expect(await db.getScorePercentile(orgs.a.ctx, 80)).toBe(0);
  });
});

describe('writes', () => {
  it('createLead stamps the caller’s org, ignoring any org_id in the payload', async () => {
    const lead = await db.createLead(orgs.a.ctx, {
      company_name: 'Injected',
      source: 'manual',
      org_id: orgs.b.orgId,
    } as never);
    expect(lead.org_id).toBe(orgs.a.orgId);
  });

  it('updateLead cannot touch another org’s lead', async () => {
    await expect(
      db.updateLead(orgs.a.ctx, orgs.b.leadId, { status: 'archived' }),
    ).rejects.toThrow();

    const { rows } = await sql(`SELECT status FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].status).toBe('new');
  });

  it('upsertLeadByWebsite does not adopt another org’s lead by URL collision', async () => {
    const { lead, isNew } = await db.upsertLeadByWebsite(orgs.a.ctx, {
      company_name: 'Collider',
      website: 'https://iso-org-b.example.test',
      source: 'manual',
    });
    expect(isNew).toBe(true);
    expect(lead.org_id).toBe(orgs.a.orgId);
    expect(lead.id).not.toBe(orgs.b.leadId);
  });

  it('createLeadSignal for another org’s lead is rejected by the composite FK', async () => {
    await expect(
      db.createLeadSignal(orgs.a.ctx, { lead_id: orgs.b.leadId, signal_type: 'hiring' }),
    ).rejects.toThrow();
  });

  it('upsertLeadScore for another org’s lead is rejected', async () => {
    await expect(
      db.upsertLeadScore(orgs.a.ctx, { lead_id: orgs.b.leadId, overall_score: 99 }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/isolation/leads.test.ts`
Expected: FAIL — every call is a type error / arity mismatch, because the
service functions do not take a context yet.

- [ ] **Step 4: Rewrite the leads half of `supabaseService.ts`**

Delete the module-level client and its export. Replace the top of
`backend/services/supabaseService.ts` with:

```ts
import type {
  Lead, LeadFilters, LeadSignal, LeadScore,
  OutreachMessage, ScrapingLog, PaginatedResponse, DashboardMetrics, CronJobLog,
  Job, JobFilters, JobWithIntel, JobSignal, JobSubmission,
} from '../../shared/types';
import type { TenantContext } from './tenantContext';

// No ambient client and no exported client. Every function below is reachable
// only with a TenantContext, whose `db` already carries an org-scoped JWT — so
// the app-layer `.eq('org_id', ...)` filter and the RLS policy are always
// looking at the same org.
```

Then replace the LEADS, SIGNALS and SCORES sections with:

```ts
// ============================================================
// LEADS
// ============================================================

export async function getLeads(ctx: TenantContext, filters: LeadFilters = {}): Promise<PaginatedResponse<Lead>> {
  const {
    status, source, sources, min_score, industry, location, search,
    page = 1, per_page = 25,
    sort_by = 'created_at', sort_order = 'desc',
  } = filters;

  let query = ctx.db.from('leads').select('*', { count: 'exact' }).eq('org_id', ctx.orgId);

  if (status) query = query.eq('status', status);
  if (sources && sources.length > 0) {
    query = query.in('source', sources);
  } else if (source) {
    query = query.eq('source', source);
  }
  if (min_score !== undefined) query = query.gte('lead_score', min_score);
  if (industry) query = query.ilike('industry', `%${industry}%`);
  if (location) query = query.ilike('location', `%${location}%`);
  if (search) {
    query = query.or(`company_name.ilike.%${search}%,description.ilike.%${search}%`);
  }

  query = query.order(sort_by, { ascending: sort_order === 'asc' });
  query = query.range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`getLeads: ${error.message}`);

  return {
    data: (data ?? []) as Lead[],
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  };
}

export async function getLeadById(ctx: TenantContext, id: string): Promise<Lead | null> {
  const { data, error } = await ctx.db
    .from('leads').select('*').eq('id', id).eq('org_id', ctx.orgId).single();
  if (error) return null;
  return data as Lead;
}

export async function createLead(ctx: TenantContext, lead: Partial<Lead>): Promise<Lead> {
  // org_id is set from the context last, so a caller-supplied org_id — from a
  // request body, or a stale object copied between tenants — cannot win.
  const { data, error } = await ctx.db
    .from('leads').insert({ ...lead, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createLead: ${error.message}`);
  return data as Lead;
}

export async function updateLead(ctx: TenantContext, id: string, updates: Partial<Lead>): Promise<Lead> {
  const { org_id: _ignored, ...safe } = updates as Partial<Lead> & { org_id?: string };
  const { data, error } = await ctx.db
    .from('leads').update(safe).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateLead: ${error.message}`);
  return data as Lead;
}

export async function upsertLeadByWebsite(
  ctx: TenantContext, lead: Partial<Lead>,
): Promise<{ lead: Lead; isNew: boolean }> {
  if (lead.website) {
    // Scoped by org: two tenants scraping the same company each keep their own
    // lead row, and neither can silently overwrite the other's.
    const { data: existing } = await ctx.db
      .from('leads').select('id').eq('website', lead.website).eq('org_id', ctx.orgId).single();
    if (existing) {
      const updated = await updateLead(ctx, existing.id, {
        ...lead, updated_at: new Date().toISOString(),
      });
      return { lead: updated, isNew: false };
    }
  }
  const created = await createLead(ctx, lead);
  return { lead: created, isNew: true };
}

// ============================================================
// SIGNALS
// ============================================================

export async function createLeadSignal(ctx: TenantContext, signal: Partial<LeadSignal>): Promise<LeadSignal> {
  const { data, error } = await ctx.db
    .from('lead_signals').insert({ ...signal, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createLeadSignal: ${error.message}`);
  return data as LeadSignal;
}

export async function updateLeadSignal(
  ctx: TenantContext, id: string, updates: Partial<LeadSignal>,
): Promise<LeadSignal> {
  const { org_id: _ignored, ...safe } = updates as Partial<LeadSignal> & { org_id?: string };
  const { data, error } = await ctx.db
    .from('lead_signals').update(safe).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateLeadSignal: ${error.message}`);
  return data as LeadSignal;
}

export async function getLeadSignals(ctx: TenantContext, leadId: string): Promise<LeadSignal[]> {
  const { data, error } = await ctx.db
    .from('lead_signals').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('detected_at', { ascending: false });
  if (error) throw new Error(`getLeadSignals: ${error.message}`);
  return (data ?? []) as LeadSignal[];
}

// ============================================================
// SCORES
// ============================================================

export async function createLeadScore(ctx: TenantContext, score: Partial<LeadScore>): Promise<LeadScore> {
  const { data, error } = await ctx.db
    .from('lead_scores').insert({ ...score, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createLeadScore: ${error.message}`);
  return data as LeadScore;
}

export async function upsertLeadScore(
  ctx: TenantContext, score: Partial<LeadScore> & { lead_id: string },
): Promise<LeadScore> {
  const existing = await getLeadScore(ctx, score.lead_id);
  if (existing) {
    const { org_id: _ignored, ...safe } = score as Partial<LeadScore> & { org_id?: string };
    const { data, error } = await ctx.db
      .from('lead_scores').update(safe).eq('id', existing.id).eq('org_id', ctx.orgId).select().single();
    if (error) throw new Error(`upsertLeadScore: ${error.message}`);
    return data as LeadScore;
  }
  return createLeadScore(ctx, score);
}

export async function getLeadScore(ctx: TenantContext, leadId: string): Promise<LeadScore | null> {
  const { data } = await ctx.db
    .from('lead_scores').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('scored_at', { ascending: false }).limit(1).single();
  return data as LeadScore | null;
}

export async function getScorePercentile(ctx: TenantContext, score: number): Promise<number> {
  const { data, error } = await ctx.db
    .from('lead_scores').select('overall_score').eq('org_id', ctx.orgId);
  if (error || !data || data.length < 2) return 50;
  const scores = (data as { overall_score: number }[]).map(r => r.overall_score);
  const below = scores.filter(s => s < score).length;
  return Math.round((below / scores.length) * 100);
}
```

Leave the JOBS, OUTREACH, LOGS and METRICS sections untouched for now — they
reference the deleted `supabase` binding and will not compile. Task 8 fixes
them; the isolation suite for leads can be run before then with
`npx vitest run` because Vitest transpiles per-file without typechecking.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/isolation/leads.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/services/supabaseService.ts backend/tests/helpers backend/tests/isolation
git commit -m "feat: tenant-scope the leads, signals and scores service functions"
```

---

### Task 8: Tenant-scope the jobs, outreach, logs and metrics functions

Same treatment, remaining half. `getJobWithIntel` needs particular care: it does
six queries including a `company_name` lookup across the whole table, which
without scoping shows a tenant every other tenant's postings at the same
company — the most plausible real leak in the file.

**Files:**
- Modify: `backend/services/supabaseService.ts`
- Modify: `backend/routes/outreach.ts`
- Create: `backend/tests/isolation/jobs.test.ts`
- Create: `backend/tests/isolation/outreach-and-logs.test.ts`

**Blast radius correction (from the Task 7 review, 2026-09-14).** Task 7's
dispatch sized the sanctioned breakage as "`routes/metrics.ts` imports the raw
client and will break; jobsController, leadsController, routes/outreach,
routes/cron and routes/signals import functions only." That was wrong in two
places, and this task is bigger than the sentence above implies:

- **`routes/outreach.ts:9` and `:63` call `db.supabase.from(...)` directly.**
  These are inline PostgREST queries, not function calls, so Task 8 has to
  rewrite them against a `TenantContext`, not merely re-point a call site.
- **`supabaseService.ts:243` is an intra-file break**: `convertJobToLead` calls
  the now-re-signatured `createLead` with one argument. Task 8's own file
  depends on Task 8's own changes; it is not purely caller-side.

The branch does not typecheck between Tasks 7 and 8 by design (61 errors, all
attributed in the Task 7 review). **Task 8 must follow Task 7 immediately** —
it is what closes the sanctioned broken window. Exactly one of the 61,
`routes/cron.ts:24` (`createCronJobLog` object literal missing `org_id`),
predates Task 7 and is fixed here too.

**Interfaces:**
- Consumes: `TenantContext` (Task 6); the seed helpers (Task 7).
- Produces: `getJobs(ctx, filters?)`, `getJobById(ctx, id)`, `getJobWithIntel(ctx, id)`,
  `updateJob(ctx, id, updates)`, `createJobSignal(ctx, signal)`,
  `createJobSubmission(ctx, sub)`, `updateJobSubmission(ctx, id, updates)`,
  `deleteJobSubmission(ctx, id)`, `convertJobToLead(ctx, job)`,
  `createOutreachMessage(ctx, msg)`, `getOutreachMessages(ctx, leadId)`,
  `getOutreachQueue(ctx)`, `createOutreachHistory(ctx, row)`,
  `createScrapingLog(ctx, log)`, `updateScrapingLog(ctx, id, updates)`,
  `getScrapingLogs(ctx, limit?)`, `createCronJobLog(ctx, log)`,
  `updateCronJobLog(ctx, id, updates)`, `getCronJobLogs(ctx, limit?)`,
  `getDashboardMetrics(ctx)`, `getPipelineRows(ctx)`, `getHotLeads(ctx, limit?)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/isolation/jobs.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
  // Both orgs now hold a job at a company with the same name, which is what
  // getJobWithIntel's related-jobs lookup keys on.
  await sql(`UPDATE jobs SET company_name = 'Shared Co' WHERE org_id IN ($1, $2)`,
    [orgs.a.orgId, orgs.b.orgId]);
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

it('getJobs returns only the caller org’s jobs', async () => {
  const { data } = await db.getJobs(orgs.a.ctx);
  expect(data.length).toBeGreaterThan(0);
  expect(data.every(j => j.org_id === orgs.a.orgId)).toBe(true);
});

it('getJobById refuses another org’s job', async () => {
  expect(await db.getJobById(orgs.a.ctx, orgs.b.jobId)).toBeNull();
});

it('getJobWithIntel does not surface another org’s job at the same company', async () => {
  await sql(
    `INSERT INTO jobs (company_name, job_title, org_id) VALUES ('Shared Co', 'Second', $1)`,
    [orgs.a.orgId],
  );
  const intel = await db.getJobWithIntel(orgs.a.ctx, orgs.a.jobId);
  expect(intel).not.toBeNull();
  expect(intel!.related.company_jobs.every(j => j.org_id === orgs.a.orgId)).toBe(true);
  expect(intel!.related.company_jobs.map(j => j.id)).not.toContain(orgs.b.jobId);
});

it('getJobWithIntel does not link to another org’s lead', async () => {
  await sql(`UPDATE leads SET company_name = 'Shared Co' WHERE org_id = $1`, [orgs.b.orgId]);
  const intel = await db.getJobWithIntel(orgs.a.ctx, orgs.a.jobId);
  expect(intel!.related.lead_id).not.toBe(orgs.b.leadId);
});

it('updateJob cannot touch another org’s job', async () => {
  await expect(db.updateJob(orgs.a.ctx, orgs.b.jobId, { status: 'archived' })).rejects.toThrow();
  const { rows } = await sql(`SELECT status FROM jobs WHERE id = $1`, [orgs.b.jobId]);
  expect(rows[0].status).toBe('new');
});

it('createJobSubmission on another org’s job is rejected', async () => {
  await expect(
    db.createJobSubmission(orgs.a.ctx, { job_id: orgs.b.jobId, profile_label: 'X' }),
  ).rejects.toThrow();
});

it('convertJobToLead produces a lead in the caller’s org', async () => {
  const job = await db.getJobById(orgs.a.ctx, orgs.a.jobId);
  const lead = await db.convertJobToLead(orgs.a.ctx, job!);
  expect(lead.org_id).toBe(orgs.a.orgId);
});
```

Create `backend/tests/isolation/outreach-and-logs.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

it('getOutreachMessages returns nothing for another org’s lead', async () => {
  expect(await db.getOutreachMessages(orgs.a.ctx, orgs.b.leadId)).toEqual([]);
});

it('createOutreachMessage on another org’s lead is rejected', async () => {
  await expect(
    db.createOutreachMessage(orgs.a.ctx, { lead_id: orgs.b.leadId, channel: 'email', body: 'hi' }),
  ).rejects.toThrow();
});

it('getOutreachQueue contains only the caller org’s leads', async () => {
  const queue = await db.getOutreachQueue(orgs.a.ctx);
  expect(queue.every(r => r.org_id === orgs.a.orgId)).toBe(true);
});

it('createOutreachHistory referencing another org’s message is rejected', async () => {
  await expect(
    db.createOutreachHistory(orgs.a.ctx, { lead_id: orgs.a.leadId, message_id: orgs.b.messageId }),
  ).rejects.toThrow();
});

it('getScrapingLogs returns only the caller org’s logs', async () => {
  const logs = await db.getScrapingLogs(orgs.a.ctx);
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.every(l => l.org_id === orgs.a.orgId)).toBe(true);
});

it('getCronJobLogs returns only the caller org’s logs', async () => {
  await sql(
    `INSERT INTO cron_job_logs (job_name, status, org_id) VALUES ('t', 'success', $1)`,
    [orgs.b.orgId],
  );
  const logs = await db.getCronJobLogs(orgs.a.ctx);
  expect(logs.every(l => l.org_id === orgs.a.orgId)).toBe(true);
});

it('getDashboardMetrics counts only the caller org’s leads', async () => {
  const metrics = await db.getDashboardMetrics(orgs.a.ctx);
  const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM leads WHERE org_id = $1`, [orgs.a.orgId]);
  expect(metrics.total_leads).toBe(rows[0].n);
});

it('getHotLeads returns only the caller org’s leads', async () => {
  const hot = await db.getHotLeads(orgs.a.ctx);
  expect(hot.every(l => l.org_id === orgs.a.orgId)).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx vitest run tests/isolation/jobs.test.ts tests/isolation/outreach-and-logs.test.ts`
Expected: FAIL — arity mismatches, and `getOutreachQueue`, `createOutreachHistory`,
`getPipelineRows`, `getHotLeads` do not exist at all.

- [ ] **Step 3: Rewrite the jobs section**

Replace the JOBS section of `backend/services/supabaseService.ts`:

```ts
// ============================================================
// JOBS
// ============================================================

export async function getJobs(ctx: TenantContext, filters: JobFilters = {}): Promise<PaginatedResponse<Job>> {
  const {
    status, verdict, search, location, source, posted_within_days, technology,
    page = 1, per_page = 25,
    sort_by = 'created_at', sort_order = 'desc',
  } = filters;

  let query = ctx.db.from('jobs').select('*', { count: 'exact' }).eq('org_id', ctx.orgId);

  if (status) query = query.eq('status', status);
  if (verdict) query = query.eq('verdict', verdict);
  if (source) query = query.eq('source', source);
  if (location) query = query.ilike('location', `%${location}%`);
  if (search) {
    query = query.or(`company_name.ilike.%${search}%,job_title.ilike.%${search}%,description.ilike.%${search}%`);
  }
  if (posted_within_days) {
    const cutoff = new Date(Date.now() - posted_within_days * 86_400_000).toISOString();
    // Jobs without a parsed posted_at fall back to when we scraped them
    query = query.or(`posted_at.gte.${cutoff},and(posted_at.is.null,created_at.gte.${cutoff})`);
  }
  if (technology) {
    // Tags arrive lowercase from remoteok/remotive but arbitrary-case from
    // config, and Postgres array contains is case-sensitive — try variants.
    const t = technology.trim().replace(/["{},]/g, '');
    if (t) {
      const variants = [...new Set([t, t.toLowerCase(), t.toUpperCase(), t[0].toUpperCase() + t.slice(1).toLowerCase()])];
      query = query.or(variants.map(v => `technologies.cs.{"${v}"}`).join(','));
    }
  }

  query = query.order(sort_by, { ascending: sort_order === 'asc', nullsFirst: false });
  query = query.range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`getJobs: ${error.message}`);

  return {
    data: (data ?? []) as Job[],
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  };
}

export async function getJobById(ctx: TenantContext, id: string): Promise<Job | null> {
  const { data, error } = await ctx.db
    .from('jobs').select('*').eq('id', id).eq('org_id', ctx.orgId).single();
  if (error) return null;
  return data as Job;
}

// Tolerates the table not existing yet (job_signals / job_submissions
// migrations pending) — the detail page degrades to empty sections.
async function safeList<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

export async function getJobWithIntel(ctx: TenantContext, id: string): Promise<JobWithIntel | null> {
  const job = await getJobById(ctx, id);
  if (!job) return null;

  const [signals, submissions, companyJobs] = await Promise.all([
    safeList<JobSignal>(
      ctx.db.from('job_signals').select('*')
        .eq('job_id', id).eq('org_id', ctx.orgId)
        .order('created_at', { ascending: false }),
    ),
    safeList<JobSubmission>(
      ctx.db.from('job_submissions').select('*')
        .eq('job_id', id).eq('org_id', ctx.orgId)
        .order('submitted_at', { ascending: false }),
    ),
    // Company-name matching across the whole table is the leak this scope
    // closes: two tenants hiring at the same company must not see each
    // other's postings in "related".
    safeList<Job>(
      ctx.db.from('jobs').select('*')
        .eq('org_id', ctx.orgId)
        .eq('company_name', job.company_name).neq('id', id)
        .order('created_at', { ascending: false }).limit(10),
    ),
  ]);

  const companyJobIds = companyJobs.map(j => j.id);
  const [companySubmissions, leadRows] = await Promise.all([
    companyJobIds.length
      ? safeList<JobSubmission>(
          ctx.db.from('job_submissions').select('*')
            .eq('org_id', ctx.orgId)
            .in('job_id', companyJobIds).order('submitted_at', { ascending: false }),
        )
      : Promise.resolve([] as JobSubmission[]),
    safeList<{ id: string }>(
      ctx.db.from('leads').select('id')
        .eq('org_id', ctx.orgId)
        .ilike('company_name', job.company_name).limit(1),
    ),
  ]);

  return {
    ...job,
    signals,
    submissions,
    related: {
      company_jobs: companyJobs,
      company_submissions: companySubmissions,
      lead_id: job.converted_lead_id ?? leadRows[0]?.id,
    },
  };
}

export async function updateJob(ctx: TenantContext, id: string, updates: Partial<Job>): Promise<Job> {
  const { org_id: _ignored, ...safe } = updates as Partial<Job> & { org_id?: string };
  const { data, error } = await ctx.db
    .from('jobs').update(safe).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateJob: ${error.message}`);
  return data as Job;
}

export async function createJobSignal(ctx: TenantContext, signal: Partial<JobSignal>): Promise<JobSignal> {
  const { data, error } = await ctx.db
    .from('job_signals').insert({ ...signal, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createJobSignal: ${error.message}`);
  return data as JobSignal;
}

export async function createJobSubmission(ctx: TenantContext, sub: Partial<JobSubmission>): Promise<JobSubmission> {
  const { data, error } = await ctx.db
    .from('job_submissions').insert({ ...sub, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createJobSubmission: ${error.message}`);
  return data as JobSubmission;
}

export async function updateJobSubmission(
  ctx: TenantContext, id: string, updates: Partial<JobSubmission>,
): Promise<JobSubmission> {
  const { org_id: _ignored, ...safe } = updates as Partial<JobSubmission> & { org_id?: string };
  const { data, error } = await ctx.db
    .from('job_submissions').update(safe).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateJobSubmission: ${error.message}`);
  return data as JobSubmission;
}

export async function deleteJobSubmission(ctx: TenantContext, id: string): Promise<void> {
  const { error } = await ctx.db
    .from('job_submissions').delete().eq('id', id).eq('org_id', ctx.orgId);
  if (error) throw new Error(`deleteJobSubmission: ${error.message}`);
}

export async function convertJobToLead(ctx: TenantContext, job: Job): Promise<Lead> {
  const lead = await createLead(ctx, {
    company_name: job.company_name,
    location: job.location,
    job_title: job.job_title,
    description: job.description,
    source_url: job.source_url,
    source: 'manual',
    hiring_signal: job.job_title ? `Hiring ${job.job_title} (remote)` : undefined,
  });
  await updateJob(ctx, job.id, { status: 'converted', converted_lead_id: lead.id });
  return lead;
}
```

- [ ] **Step 4: Rewrite the outreach, logs and metrics sections**

Replace everything from `// OUTREACH` to the end of the file:

```ts
// ============================================================
// OUTREACH
// ============================================================

export async function createOutreachMessage(
  ctx: TenantContext, msg: Partial<OutreachMessage>,
): Promise<OutreachMessage> {
  const { data, error } = await ctx.db
    .from('outreach_messages').insert({ ...msg, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createOutreachMessage: ${error.message}`);
  return data as OutreachMessage;
}

export async function getOutreachMessages(ctx: TenantContext, leadId: string): Promise<OutreachMessage[]> {
  const { data, error } = await ctx.db
    .from('outreach_messages').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getOutreachMessages: ${error.message}`);
  return (data ?? []) as OutreachMessage[];
}

/** The outreach queue view: leads worth contacting, with their drafted messages. */
export async function getOutreachQueue(ctx: TenantContext): Promise<
  (Pick<Lead, 'id' | 'org_id' | 'company_name' | 'location' | 'industry' | 'lead_score' | 'status' | 'website'>
    & { outreach_messages: OutreachMessage[] })[]
> {
  const { data, error } = await ctx.db
    .from('leads')
    .select(`
      id, org_id, company_name, location, industry, lead_score, status, website, linkedin_url,
      outreach_messages(id, channel, subject, body, created_at, is_selected)
    `)
    .eq('org_id', ctx.orgId)
    .in('status', ['analyzed', 'new'])
    .gte('lead_score', 50)
    .order('lead_score', { ascending: false })
    .limit(50);
  if (error) throw new Error(`getOutreachQueue: ${error.message}`);
  return (data ?? []) as never;
}

export async function createOutreachHistory(
  ctx: TenantContext, row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { org_id: _ignored, ...safe } = row;
  const { data, error } = await ctx.db
    .from('outreach_history').insert({ ...safe, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createOutreachHistory: ${error.message}`);
  return data as Record<string, unknown>;
}

// ============================================================
// SCRAPING LOGS
// ============================================================

export async function createScrapingLog(ctx: TenantContext, log: Partial<ScrapingLog>): Promise<ScrapingLog> {
  const { data, error } = await ctx.db
    .from('scraping_logs').insert({ ...log, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createScrapingLog: ${error.message}`);
  return data as ScrapingLog;
}

export async function updateScrapingLog(
  ctx: TenantContext, id: string, updates: Partial<ScrapingLog>,
): Promise<void> {
  await ctx.db.from('scraping_logs').update(updates).eq('id', id).eq('org_id', ctx.orgId);
}

export async function getScrapingLogs(ctx: TenantContext, limit = 20): Promise<ScrapingLog[]> {
  const { data, error } = await ctx.db
    .from('scraping_logs').select('*').eq('org_id', ctx.orgId)
    .order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`getScrapingLogs: ${error.message}`);
  return (data ?? []) as ScrapingLog[];
}

// ============================================================
// CRON JOB LOGS
// ============================================================

export async function createCronJobLog(
  ctx: TenantContext, log: Omit<CronJobLog, 'id' | 'created_at' | 'org_id'>,
): Promise<CronJobLog> {
  const { data, error } = await ctx.db
    .from('cron_job_logs').insert({ ...log, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createCronJobLog: ${error.message}`);
  return data as CronJobLog;
}

export async function updateCronJobLog(
  ctx: TenantContext, id: string, updates: Partial<CronJobLog>,
): Promise<void> {
  await ctx.db.from('cron_job_logs').update(updates).eq('id', id).eq('org_id', ctx.orgId);
}

export async function getCronJobLogs(ctx: TenantContext, limit = 40): Promise<CronJobLog[]> {
  const { data, error } = await ctx.db
    .from('cron_job_logs').select('*').eq('org_id', ctx.orgId)
    .order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`getCronJobLogs: ${error.message}`);
  return (data ?? []) as CronJobLog[];
}

// ============================================================
// DASHBOARD METRICS
// ============================================================

export async function getDashboardMetrics(ctx: TenantContext): Promise<DashboardMetrics> {
  const scoped = () => ctx.db.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', ctx.orgId);

  const [
    { count: total },
    { count: hot },
    { count: contacted },
    { count: replied },
    { count: meetings },
    { count: clients },
    { data: avgData },
  ] = await Promise.all([
    scoped(),
    scoped().gte('lead_score', 70),
    scoped().eq('status', 'contacted'),
    scoped().eq('status', 'replied'),
    scoped().eq('status', 'meeting'),
    scoped().eq('status', 'client'),
    ctx.db.from('leads').select('lead_score').eq('org_id', ctx.orgId).not('lead_score', 'is', null),
  ]);

  const scores = (avgData ?? []).map((r: { lead_score: number }) => r.lead_score).filter(Boolean);
  const avg_score = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: new_today } = await scoped().gte('created_at', today.toISOString());

  return {
    total_leads: total ?? 0,
    hot_leads: hot ?? 0,
    contacted: contacted ?? 0,
    replied: replied ?? 0,
    meetings: meetings ?? 0,
    clients: clients ?? 0,
    new_today: new_today ?? 0,
    avg_score,
  };
}

/** Rows behind the pipeline chart. Shaping stays in the route; scoping lives here. */
export async function getPipelineRows(ctx: TenantContext): Promise<
  Pick<Lead, 'id' | 'org_id' | 'company_name' | 'location' | 'industry' | 'website' | 'lead_score' | 'status' | 'created_at'>[]
> {
  const { data, error } = await ctx.db
    .from('leads')
    .select('id, org_id, company_name, location, industry, website, lead_score, status, created_at')
    .eq('org_id', ctx.orgId);
  if (error) throw new Error(`getPipelineRows: ${error.message}`);
  return (data ?? []) as never;
}

export async function getHotLeads(ctx: TenantContext, limit = 10): Promise<Lead[]> {
  const { data, error } = await ctx.db
    .from('leads').select('*').eq('org_id', ctx.orgId)
    .gte('lead_score', 70).order('lead_score', { ascending: false }).limit(limit);
  if (error) throw new Error(`getHotLeads: ${error.message}`);
  return (data ?? []) as Lead[];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run tests/isolation/`
Expected: PASS — 11 leads tests, 7 jobs tests, 8 outreach/logs tests.

- [ ] **Step 6: Confirm no raw client escapes the module**

Run: `cd backend && grep -n "export const supabase" services/supabaseService.ts`
Expected: no output.

Run: `cd backend && grep -rn "db.supabase\|from '../services/supabaseService'" routes/ controllers/ | grep -c supabase`
Expected: a non-zero count of call sites still to be updated — that is Task 10's
list. Record it.

- [ ] **Step 7: Commit**

```bash
git add backend/services/supabaseService.ts backend/tests/isolation
git commit -m "feat: tenant-scope the jobs, outreach, log and metrics service functions"
```

---

### Task 9: Per-tenant `platform_config`

`platform_config` is a global singleton hardcoded to ANTA's identity, and it
drives both what gets scraped and what the outreach copy says. Left as-is, every
design partner's outreach would sign off as ANTA and scrape ANTA's target
locations. `configService` also holds one of the three stray `createClient`
calls; it loses it here.

**Files:**
- Modify: `backend/services/configService.ts`
- Create: `backend/tests/isolation/config.test.ts`

**Interfaces:**
- Consumes: `TenantContext` (Task 6).
- Produces: `getConfig(ctx: TenantContext): Promise<PlatformConfig>` and
  `saveConfig(ctx: TenantContext, updates: Partial<PlatformConfig>): Promise<PlatformConfig>`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/isolation/config.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getConfig, saveConfig } from '../../services/configService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

it('returns defaults for an org with no config row', async () => {
  const cfg = await getConfig(orgs.a.ctx);
  expect(cfg.agency_name).toBe('ANTA');
});

it('saving for org A does not change org B', async () => {
  await saveConfig(orgs.a.ctx, { agency_name: 'Alpha Consulting', sign_off: 'Alpha' });
  await saveConfig(orgs.b.ctx, { agency_name: 'Bravo Partners', sign_off: 'Bravo' });

  expect((await getConfig(orgs.a.ctx)).agency_name).toBe('Alpha Consulting');
  expect((await getConfig(orgs.b.ctx)).agency_name).toBe('Bravo Partners');
});

it('writes exactly one row per org, not one per save', async () => {
  await saveConfig(orgs.a.ctx, { cta_style: '20-min call' });
  await saveConfig(orgs.a.ctx, { cta_style: '30-min call' });
  const { rows } = await sql(
    `SELECT COUNT(*)::int AS n FROM platform_config WHERE org_id = $1`, [orgs.a.orgId]);
  expect(rows[0].n).toBe(1);
});

it('merges partial updates rather than replacing the config', async () => {
  await saveConfig(orgs.a.ctx, { agency_name: 'Alpha Consulting' });
  await saveConfig(orgs.a.ctx, { cta_style: '15-min call' });
  const cfg = await getConfig(orgs.a.ctx);
  expect(cfg.agency_name).toBe('Alpha Consulting');
  expect(cfg.cta_style).toBe('15-min call');
});

it('deduplicates active_sources', async () => {
  const saved = await saveConfig(orgs.a.ctx, { active_sources: ['linkedin', 'linkedin', 'job_board'] });
  expect(saved.active_sources).toEqual(['linkedin', 'job_board']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/isolation/config.test.ts`
Expected: FAIL — `getConfig` takes no arguments and reads whichever row
`limit(1)` happens to return.

- [ ] **Step 3: Rewrite `configService.ts`**

Replace `backend/services/configService.ts` entirely:

```ts
import type { PlatformConfig } from '../../shared/types';
import { DEFAULT_PLATFORM_CONFIG } from '../../shared/types';
import type { TenantContext } from './tenantContext';

/**
 * platform_config was a global singleton holding ANTA's own identity, and it
 * feeds both scraping targets and outreach copy. It is now one row per org,
 * keyed by the UNIQUE (org_id) constraint from the tenancy migration — so an
 * upsert is a single statement with no read-then-write race.
 */

export async function getConfig(ctx: TenantContext): Promise<PlatformConfig> {
  const { data, error } = await ctx.db
    .from('platform_config')
    .select('config')
    .eq('org_id', ctx.orgId)
    .maybeSingle();

  if (error || !data) {
    // A newly onboarded org may have no row yet. Defaults keep the app usable
    // until create-org.ts or the settings page writes one.
    return { ...DEFAULT_PLATFORM_CONFIG };
  }

  const merged = { ...DEFAULT_PLATFORM_CONFIG, ...data.config } as PlatformConfig;
  merged.active_sources = [...new Set(merged.active_sources)];
  return merged;
}

export async function saveConfig(
  ctx: TenantContext,
  updates: Partial<PlatformConfig>,
): Promise<PlatformConfig> {
  const current = await getConfig(ctx);
  const merged = { ...current, ...updates };
  if (Array.isArray(merged.active_sources)) {
    merged.active_sources = [...new Set(merged.active_sources)];
  }

  const { error } = await ctx.db
    .from('platform_config')
    .upsert({ org_id: ctx.orgId, config: merged }, { onConflict: 'org_id' });

  if (error) throw new Error(`Config save failed: ${error.message}`);

  return merged;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/isolation/config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/configService.ts backend/tests/isolation/config.test.ts
git commit -m "feat: platform_config becomes one row per tenant"
```

---

### Task 10: Thread `req.ctx` through controllers and routes

Every call site updated at once. `routes/metrics.ts` and `routes/outreach.ts`
also stop reaching for a raw client — they use the functions Task 8 added. After
this task the backend compiles again and `npm run lint` passes with the import
fence active.

`routes/cron.ts` is deliberately excluded: it has no request context and is
Task 13's problem.

**Files:**
- Modify: `backend/controllers/leadsController.ts`
- Modify: `backend/controllers/jobsController.ts`
- Modify: `backend/routes/outreach.ts`
- Modify: `backend/routes/metrics.ts`
- Modify: `backend/routes/signals.ts`
- Modify: `backend/routes/config.ts`

**Interfaces:**
- Consumes: `ctxOf(req)` (Task 6); every re-signatured function from Tasks 7–9.
- Produces: no new exports. This task makes the tree compile.

- [ ] **Step 1: Update `leadsController.ts`**

Add the import:

```ts
import { ctxOf } from '../api/middleware/auth';
```

Then, in each handler, take the context once at the top and pass it first. The
four list/read/write handlers become:

```ts
export async function listLeads(req: Request, res: Response): Promise<void> {
  try {
    const filters = LeadFilterSchema.parse(req.query) as LeadFilters;
    const result = await db.getLeads(ctxOf(req), filters);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
}

export async function getLead(req: Request, res: Response): Promise<void> {
  try {
    const ctx = ctxOf(req);
    const { id } = req.params;
    const lead = await db.getLeadById(ctx, id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const [signals, score, outreach_messages] = await Promise.all([
      db.getLeadSignals(ctx, id),
      db.getLeadScore(ctx, id),
      db.getOutreachMessages(ctx, id),
    ]);

    let score_detail = score;
    if (score) {
      const percentile = await db.getScorePercentile(ctx, score.overall_score);
      score_detail = { ...score, score_percentile: percentile };
    }

    res.json({ success: true, data: { ...lead, signals, score_detail, outreach_messages } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function createLead(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.createLead(ctxOf(req), { ...req.body, source: req.body.source ?? 'manual' });
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function updateLead(req: Request, res: Response): Promise<void> {
  try {
    const updates = { ...req.body };
    if (updates.status === 'contacted' && !updates.contacted_at) {
      updates.contacted_at = new Date().toISOString();
    }
    const lead = await db.updateLead(ctxOf(req), req.params.id, updates);
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}
```

The file has four more exported handlers: `analyzeLead` (line 197),
`streamAnalyzeLead` (215), `generateLeadOutreach` (306) and `getLeadAnalysis`
(378). Each gets the same mechanical change: `const ctx = ctxOf(req);` as the
first line of its `try`, then `ctx` as the first argument to every `db.*` call,
to `getConfig`, and to `analyzeLeadSignals` (Task 12 adds that parameter — pass
it now and the arity will match once Task 12 lands; until then `tsc` reports it,
which is expected and noted in Step 6).

`_buildLeadPayload` and `isSocialUrl` are pure helpers over a `Lead` and need no
context — leave both unchanged.

- [ ] **Step 2: Update `jobsController.ts`**

Add `import { ctxOf } from '../api/middleware/auth';` and give every `db.*` call
in the file a `ctx` first argument, taking `const ctx = ctxOf(req);` at the top
of each handler's `try`. The affected calls are `getJobs`, `getJobWithIntel`,
`updateJob` (four sites), `getJobById` (four sites), `createJobSignal`,
`createJobSubmission`, `updateJobSubmission`, `deleteJobSubmission` and
`convertJobToLead`.

- [ ] **Step 3: Rewrite `routes/outreach.ts`**

```ts
import { Router, Request, Response } from 'express';
import * as db from '../services/supabaseService';
import { generateFollowUp } from '../services/claudeService';
import { ctxOf } from '../api/middleware/auth';

const router = Router();

router.get('/queue', async (req: Request, res: Response) => {
  try {
    const data = await db.getOutreachQueue(ctxOf(req));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/:leadId/messages', async (req: Request, res: Response) => {
  try {
    const messages = await db.getOutreachMessages(ctxOf(req), req.params.leadId);
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/:leadId/followup', async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const lead = await db.getLeadById(ctx, req.params.leadId);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const { original_message, days_since_sent = 5 } = req.body;
    const followUp = await generateFollowUp(lead, original_message, days_since_sent);

    const saved = await db.createOutreachMessage(ctx, {
      lead_id: lead.id,
      channel: 'email',
      subject: followUp.subject,
      body: followUp.body,
      generated_by: 'claude',
    });

    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/history', async (req: Request, res: Response) => {
  try {
    const data = await db.createOutreachHistory(ctxOf(req), req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
```

- [ ] **Step 4: Rewrite `routes/metrics.ts`**

```ts
import { Router, Request, Response } from 'express';
import { getDashboardMetrics, getPipelineRows, getHotLeads } from '../services/supabaseService';
import { ctxOf } from '../api/middleware/auth';

const router = Router();

interface PipelineRow {
  status: string;
  lead_score: number | null;
  created_at: string | null;
}

function summarize(rows: PipelineRow[]) {
  const grouped: Record<string, { count: number; scores: number[]; dates: string[] }> = {};
  for (const row of rows) {
    if (!grouped[row.status]) grouped[row.status] = { count: 0, scores: [], dates: [] };
    grouped[row.status].count++;
    if (row.lead_score != null) grouped[row.status].scores.push(row.lead_score);
    if (row.created_at) grouped[row.status].dates.push(row.created_at);
  }
  return Object.entries(grouped).map(([status, g]) => ({
    status,
    count: g.count,
    avg_score: g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : 0,
    last_added: g.dates.sort().at(-1) ?? '',
  }));
}

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics(ctxOf(req));
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Single endpoint returning all dashboard data to avoid 3 round trips on initial load
router.get('/all', async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const [metrics, rows] = await Promise.all([
      getDashboardMetrics(ctx),
      getPipelineRows(ctx),
    ]);

    const hotLeads = rows
      .filter(r => (r.lead_score ?? 0) >= 70)
      .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
      .slice(0, 10);

    res.json({ success: true, data: { metrics, pipeline: summarize(rows as never), hotLeads } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/pipeline', async (req: Request, res: Response) => {
  try {
    const rows = await getPipelineRows(ctxOf(req));
    res.json({ success: true, data: summarize(rows as never) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/hot-leads', async (req: Request, res: Response) => {
  try {
    const data = await getHotLeads(ctxOf(req));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
```

- [ ] **Step 5: Update `routes/config.ts` and `routes/signals.ts`**

In `routes/config.ts`, import `ctxOf` and pass the context:

```ts
import { ctxOf } from '../api/middleware/auth';
// ...
    const config = await getConfig(ctxOf(req));
// ...
    const saved = await saveConfig(ctxOf(req), updates);
```

The GET handler's parameter is currently `_req`; rename it to `req`.

In `routes/signals.ts`, the scraping-logs handler takes the context:

```ts
import { ctxOf } from '../api/middleware/auth';
// ...
    const logs = await getScrapingLogs(ctxOf(req));
```

`triggerScrape` gains an org argument in Task 12; leave those call sites alone
for now.

- [ ] **Step 6: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: the only remaining errors are in `routes/cron.ts` (Task 13) and around
`triggerScrape`/`analyzeLeadSignals` arity (Task 12). Everything else compiles.

- [ ] **Step 7: Lint**

Run: `cd backend && npm run lint`
Expected: exit 0. If `no-restricted-imports` fires anywhere other than the two
files with a documented `eslint-disable` (`authController.ts`, `health.ts`,
temporarily `cron.ts`), that import is a real boundary violation — fix the
import, not the rule.

- [ ] **Step 8: Commit**

```bash
git add backend/controllers backend/routes
git commit -m "refactor: thread TenantContext through every controller and route"
```

---

### Task 11: One `persistAnalysis`, one contact-confidence bug fixed

The analysis-persistence logic exists twice: `leadsController.ts:118`
(`_persistAnalysisResult`) and `routes/cron.ts:112` (inline). Both now need org
scoping, and scoping the same logic in two places is how one gets missed.

Both copies also carry an open review finding: `contact_email_confidence` is
written only inside the two email branches. A re-analysis that returns a
different person — new name, new title, no email — leaves the previous
address in place still badged `verified`. Collapsing to one function fixes it
in one edit.

**Files:**
- Create: `backend/services/persistAnalysis.ts`
- Modify: `backend/controllers/leadsController.ts`
- Create: `backend/tests/services/persist-analysis.test.ts`

**Interfaces:**
- Consumes: `TenantContext` (Task 6); `db.updateLead`, `db.createLeadSignal`, `db.updateLeadSignal`, `db.upsertLeadScore`, `db.getLeadSignals` (Tasks 7–8).
- Produces: `persistAnalysis(ctx: TenantContext, lead: Lead, existingSignals: LeadSignal[], signals: SignalAnalysisResult): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/persist-analysis.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { persistAnalysis } from '../../services/persistAnalysis';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import type { SignalAnalysisResult } from '../../../shared/types';

let orgs: TwoOrgs;

const BASE: SignalAnalysisResult = {
  lead_score: 72,
  industry: 'Logistics',
  likely_pain_points: ['manual BOL entry'],
  recommended_anta_service: 'document automation',
  outreach_angle: 'A/P admin posting',
  operational_maturity: 'growing',
  growth_indicators: ['hiring'],
  digital_maturity_score: 4,
  signal_type: 'hiring',
  confidence_score: 80,
  scoring_breakdown: {
    company_size_score: 20, hiring_urgency_score: 20,
    complexity_score: 20, digital_score: 12,
  },
  scoring_rationale: 'test',
  tech_stack: [],
  tech_gaps: [],
};

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

beforeEach(async () => {
  await sql(
    `UPDATE leads SET contact_email = 'old@acme.test', contact_email_confidence = 'verified',
     contact_name = 'Old Person' WHERE id = $1`,
    [orgs.a.leadId],
  );
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

it('clears a stale email confidence when re-analysis finds no email', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], {
    ...BASE,
    contact: { name: 'New Person', title: 'Ops Lead', email: '', linkedin_url: '', email_confidence: 'unknown' },
  } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_name).toBe('New Person');
  // The old address must not survive as another person's "verified" inbox.
  expect(after.contact_email ?? null).toBeNull();
  expect(after.contact_email_confidence ?? null).toBeNull();
});

it('keeps a returned email and its confidence', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], {
    ...BASE,
    contact: { name: 'New Person', title: 'Ops Lead', email: 'new@acme.test', linkedin_url: '', email_confidence: 'verified' },
  } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_email).toBe('new@acme.test');
  expect(after.contact_email_confidence).toBe('verified');
});

it('records a generic fallback address as generic', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], {
    ...BASE,
    contact: { name: '', title: '', email: '', linkedin_url: '', email_confidence: 'unknown',
               fallback_generic_email: 'info@acme.test' },
  } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_email).toBe('info@acme.test');
  expect(after.contact_email_confidence).toBe('generic');
});

it('writes the score and signal into the caller’s org', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], BASE);

  const signals = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  expect(signals.every(s => s.org_id === orgs.a.orgId)).toBe(true);
  const score = await db.getLeadScore(orgs.a.ctx, orgs.a.leadId);
  expect(score!.org_id).toBe(orgs.a.orgId);
  expect(score!.overall_score).toBe(72);
});

it('updates the newest signal in place when the type is unchanged', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  const before = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  await persistAnalysis(orgs.a.ctx, lead, before, BASE);
  const after = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  expect(after).toHaveLength(before.length);
});

it('cannot persist onto another org’s lead', async () => {
  const foreign = { ...(await db.getLeadById(orgs.b.ctx, orgs.b.leadId))! };
  await expect(persistAnalysis(orgs.a.ctx, foreign, [], BASE)).rejects.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/services/persist-analysis.test.ts`
Expected: FAIL — `backend/services/persistAnalysis.ts` does not exist.

- [ ] **Step 3: Write the single persistence path**

Create `backend/services/persistAnalysis.ts`:

```ts
import * as db from './supabaseService';
import type { TenantContext } from './tenantContext';
import type { Lead, LeadSignal, SignalAnalysisResult } from '../../shared/types';

/**
 * The one place analysis results are written to the database.
 *
 * This logic previously existed twice — leadsController's
 * _persistAnalysisResult and an inline copy in routes/cron.ts — which is how
 * the contact_email_confidence bug survived in both: confidence was written
 * only inside the email branches, so a re-analysis returning a different person
 * with no email left the previous address in place, still badged 'verified'.
 * Here the contact block is always written as a whole, so a fresh analysis
 * cannot leave half of a previous one behind.
 */
export async function persistAnalysis(
  ctx: TenantContext,
  lead: Lead,
  existingSignals: LeadSignal[],
  signals: SignalAnalysisResult,
): Promise<void> {
  const leadUpdate: Record<string, unknown> = {
    lead_score: signals.lead_score,
    status: 'analyzed',
    analyzed_at: new Date().toISOString(),
  };
  if (signals.industry)         leadUpdate.industry = signals.industry;
  if (signals.verified_website) leadUpdate.website  = signals.verified_website;

  // The contact block is written atomically. An analysis that returns a
  // contact defines every contact field, including the absence of an email.
  if (signals.contact) {
    leadUpdate.contact_name         = signals.contact.name || null;
    leadUpdate.contact_title        = signals.contact.title || null;
    leadUpdate.contact_linkedin_url = signals.contact.linkedin_url || null;

    if (signals.contact.email) {
      leadUpdate.contact_email            = signals.contact.email;
      leadUpdate.contact_email_confidence = signals.contact.email_confidence ?? 'unknown';
    } else if (signals.contact.fallback_generic_email) {
      // No personal inbox found — a generic one (info@ …) is still a usable
      // point of contact for small businesses that expose nothing else.
      leadUpdate.contact_email            = signals.contact.fallback_generic_email;
      leadUpdate.contact_email_confidence = 'generic';
    } else {
      leadUpdate.contact_email            = null;
      leadUpdate.contact_email_confidence = null;
    }
  }

  const latestSignal = existingSignals[0];
  const signalPayload = {
    lead_id: lead.id,
    signal_type: signals.signal_type,
    confidence_score: signals.confidence_score,
    likely_pain_points: signals.likely_pain_points,
    recommended_anta_service: signals.recommended_anta_service,
    outreach_angle: signals.outreach_angle,
    operational_maturity: signals.operational_maturity,
    growth_indicators: signals.growth_indicators,
    digital_maturity_score: signals.digital_maturity_score,
    tech_stack: signals.tech_stack ?? [],
    tech_gaps: signals.tech_gaps ?? [],
  };

  // The lead update runs last and is awaited separately: the signal and score
  // writes are best-effort (a duplicate from a partially-succeeded prior run
  // must not permanently lock the lead as 'new'), but the status change is not.
  const secondary = await Promise.allSettled([
    latestSignal?.signal_type === signals.signal_type
      ? db.updateLeadSignal(ctx, latestSignal.id, { ...signalPayload, detected_at: new Date().toISOString() })
      : db.createLeadSignal(ctx, signalPayload),
    db.upsertLeadScore(ctx, {
      lead_id: lead.id,
      overall_score: signals.lead_score,
      company_size_score: signals.scoring_breakdown.company_size_score,
      hiring_urgency_score: signals.scoring_breakdown.hiring_urgency_score,
      complexity_score: signals.scoring_breakdown.complexity_score,
      digital_score: signals.scoring_breakdown.digital_score,
      scoring_rationale: signals.scoring_rationale,
    }),
  ]);

  for (const r of secondary) {
    if (r.status === 'rejected') {
      console.error(`[persistAnalysis] secondary write failed for lead ${lead.id}:`, r.reason);
    }
  }

  await db.updateLead(ctx, lead.id, leadUpdate);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/services/persist-analysis.test.ts`
Expected: PASS, 6 tests.

The last test passes because `db.updateLead` scopes by org and `.single()`
returns an error when no row matches.

- [ ] **Step 5: Delete the copy in `leadsController.ts`**

Remove the whole `_persistAnalysisResult` function from
`backend/controllers/leadsController.ts` and import the shared one:

```ts
import { persistAnalysis } from '../services/persistAnalysis';
```

Replace both call sites (`analyzeLead` and `streamAnalyzeLead`) with:

```ts
    await persistAnalysis(ctx, lead, existingSignals, signals);
```

- [ ] **Step 6: Verify nothing still duplicates it**

Run: `cd backend && grep -rn "contact_email_confidence" --include='*.ts' . | grep -v dist | grep -v tests`
Expected: matches only in `services/persistAnalysis.ts` and in
`controllers/leadsController.ts`'s `_buildLeadPayload` (which reads it, not
writes it), plus `routes/cron.ts` — the last copy, deleted in Task 13.

- [ ] **Step 7: Commit**

```bash
git add backend/services/persistAnalysis.ts backend/controllers/leadsController.ts \
        backend/tests/services
git commit -m "refactor: one persistAnalysis path; fix stale contact_email_confidence"
```

---

### Task 12: `org_id` becomes required on every engine call

The engine holds the service-role key and writes directly to `leads`, `jobs` and
`scraping_logs`. It must never decide an org for itself — it is told one by an
authenticated backend, and it stamps that org onto every row it writes. Making
the field required (not optional-with-a-default) means a caller that forgets it
gets a 422, not somebody else's data.

**Files:**
- Modify: `signal-engine/main.py`
- Create: `signal-engine/tests/test_org_scoping.py`
- Modify: `backend/services/signalEngineService.ts`
- Modify: `backend/controllers/leadsController.ts`
- Modify: `backend/routes/signals.ts`

**Interfaces:**
- Consumes: `TenantContext` (Task 6); `require_engine_key` (Plan 1).
- Produces:
  - Engine: `AnalysisRequest.org_id: str`, `ScrapeRequest.org_id: str`, `run_scrape_job(job_id, org_id, sources, cfg)`, `_persist_job_postings(supabase, org_id, postings)`.
  - Backend: `analyzeLeadSignals(ctx, lead)`, `triggerScrape(ctx, sources)`.

- [ ] **Step 1: Write the failing engine test**

Create `signal-engine/tests/test_org_scoping.py`:

```python
"""The engine writes with the service-role key, so it can write into any org.
It must therefore never infer one: the org arrives from an authenticated
backend or the request is rejected."""
from tests.conftest import VALID_KEY

HEADERS = {"X-Engine-Key": VALID_KEY}

LEAD = {
    "company_name": "Acme",
    "website": "https://acme.test",
    "source_url": "https://acme.test/jobs",
    "source": "manual",
    "scraped_at": "2026-08-26T00:00:00Z",
}
ORG = "3f0a2c1e-9b6d-4f2a-8c1b-5d7e9a0b1c2d"


def test_analyze_without_org_id_is_rejected(client):
    r = client.post("/analyze", json={"lead": LEAD}, headers=HEADERS)
    assert r.status_code == 422
    assert "org_id" in r.text


def test_analyze_with_a_non_uuid_org_id_is_rejected(client):
    r = client.post("/analyze", json={"lead": LEAD, "org_id": "anta"}, headers=HEADERS)
    assert r.status_code == 422


def test_scrape_without_org_id_is_rejected(client):
    r = client.post("/scrape", json={"sources": ["linkedin"]}, headers=HEADERS)
    assert r.status_code == 422
    assert "org_id" in r.text


def test_org_id_does_not_bypass_the_engine_key(client):
    r = client.post("/scrape", json={"sources": ["linkedin"], "org_id": ORG})
    assert r.status_code == 401
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/test_org_scoping.py -v`
Expected: FAIL — requests without `org_id` currently return 200.

- [ ] **Step 3: Require `org_id` on the request models**

In `signal-engine/main.py`, add the import near the other pydantic imports:

```python
from uuid import UUID
```

Then change the two request models:

```python
class AnalysisRequest(BaseModel):
    lead: RawLead
    config: Optional[PlatformConfig] = None
    # Required, and a UUID: the engine holds the service-role key and can write
    # into any org, so it never picks one. An authenticated backend supplies it.
    org_id: UUID


class ScrapeRequest(BaseModel):
    sources: list[str] = ["linkedin", "crunchbase", "job_board", "local_business", "remote_jobs"]
    config: Optional[PlatformConfig] = None
    org_id: UUID
```

- [ ] **Step 4: Thread the org through the scrape path**

In `trigger_scrape` (`main.py:424`), carry the org into the job record and the
background task:

```python
    scrape_jobs[job_id] = {
        "status": "running",
        "org_id": str(request.org_id),
        "started_at": datetime.utcnow().isoformat(),
        "results": 0,
        "sources": {s: {"status": "pending"} for s in effective_sources},
        "events": [],
    }
    scrape_conditions[job_id] = asyncio.Condition()

    background_tasks.add_task(run_scrape_job, job_id, str(request.org_id), effective_sources, cfg)
```

Change the signature at `main.py:563`:

```python
async def run_scrape_job(job_id: str, org_id: str, sources: list[str], cfg: Optional[PlatformConfig] = None):
```

Inside `run_scrape_job`, every Supabase write and every dedupe read gains the
org. Specifically:

- The two `scraping_logs` inserts (`main.py:644`, `main.py:705`): add
  `"org_id": org_id` to the inserted dict.
- The `scraping_logs` update (`main.py:862`): add `.eq("org_id", org_id)` after
  `.eq("id", log_id)`.
- The existing-lead lookup (`main.py:756`): add `.eq("org_id", org_id)` to the
  `select`. Without this, one tenant's scrape silently skips a company because
  a *different* tenant already has it.
- The lead inserts (`main.py:807` chunked, `main.py:816` single-row fallback):
  stamp each row with `org_id` before inserting, e.g.
  `chunk = [{**row, "org_id": org_id} for row in chunk]`.
- The lead update in `_apply_update` (`main.py:832`): add
  `.eq("org_id", org_id)` after `.eq("id", existing_id)`.
- The `_persist_job_postings` call: pass the org.

Change `_persist_job_postings` (`main.py:509`) to take and apply the org:

```python
def _persist_job_postings(supabase, org_id: str, postings: list[dict]) -> tuple[int, int]:
```

Inside it:
- Stamp `org_id` on every dict passed to `upsert` / `insert` / `update`.
- Add `.eq("org_id", org_id)` to the `external_id` lookup (`main.py:529`) and
  the `source_url` lookup (`main.py:548`).
- The `jobs` upsert at `main.py:535` uses `on_conflict="external_id"`, which is
  a global unique index. Two tenants scraping the same board would collide on
  it. Change the index to be per-org by adding this to
  `supabase/migrations/2026-08-26_tenancy_foundation.sql`, before the final
  `COMMIT;`:

```sql
-- external_id is unique per tenant, not globally: two tenants scraping the
-- same job board must each get their own row for the same posting.
DROP INDEX idx_jobs_external_id;
CREATE UNIQUE INDEX idx_jobs_external_id ON jobs (org_id, external_id)
  WHERE external_id IS NOT NULL;
```

and change the upsert to `on_conflict="org_id,external_id"`.

Mirror that index change in `supabase/schema.sql`.

- [ ] **Step 5: Thread the org through the analyze path**

In `analyze_lead` (`main.py:375`) and `analyze_lead_stream` (`main.py:385`),
pass `str(request.org_id)` into `_analyze_lead_core` and add a matching
`org_id: str` parameter to it. `_analyze_lead_core` performs no writes today, so
the parameter exists so that any future write in it cannot forget the org; add
this comment at the parameter:

```python
    # Present so that any persistence added here inherits the caller's org
    # rather than reaching for a global default.
```

- [ ] **Step 6: Run the engine tests**

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/ -v`
Expected: PASS — the 13 auth tests from Plan 1 plus 4 new org-scoping tests.

- [ ] **Step 7: Send the org from the backend**

In `backend/services/signalEngineService.ts`, both mutating calls take a context:

```ts
import type { TenantContext } from './tenantContext';
// ...

export async function analyzeLeadSignals(
  ctx: TenantContext, lead: ScrapedLeadRaw,
): Promise<SignalAnalysisResult> {
  const { data } = await axios.post<SignalAnalysisResult>(
    `${SIGNAL_ENGINE_URL}/analyze`,
    { lead, org_id: ctx.orgId },
    { timeout: 60_000, headers: engineHeaders },
  );
  return data;
}

export async function triggerScrape(
  ctx: TenantContext, sources: string[],
): Promise<{ job_id: string; status: string; sources: string[] }> {
  // Forward the saved platform config so scraper settings (target locations,
  // remote job roles/technologies/regions, etc.) actually take effect —
  // without this every scrape silently falls back to hardcoded defaults.
  const config = await getConfig(ctx);
  const { data } = await axios.post(
    `${SIGNAL_ENGINE_URL}/scrape`,
    { sources, config, org_id: ctx.orgId },
    { timeout: 10_000, headers: engineHeaders },
  );
  return data;
}
```

The org comes from `ctx`, never from `req.body` — a client-supplied org id is
not an authenticated one.

Update the call sites: `analyzeLeadSignals(ctx, payload)` in
`leadsController.ts` (both `analyzeLead` and `streamAnalyzeLead`), and
`triggerScrape(ctxOf(req), sources)` in `routes/signals.ts`.

`getScrapeStatus` and `getScrapeStreamResponse` read a job by id and stay
unchanged; Plan 3 moves the job store into Postgres and scopes reads there.

- [ ] **Step 8: Verify and commit**

Run: `cd backend && npx tsc --noEmit`
Expected: remaining errors only in `routes/cron.ts` (Task 13).

```bash
git add signal-engine/main.py signal-engine/tests/test_org_scoping.py \
        supabase/migrations/2026-08-26_tenancy_foundation.sql supabase/schema.sql \
        backend/services/signalEngineService.ts backend/controllers/leadsController.ts \
        backend/routes/signals.ts
git commit -m "feat: require org_id on every signal-engine call and stamp it on every row"
```

---

### Task 13: Cron runs per organization

Cron has no request and therefore no `TenantContext`. It is one of the three
sanctioned service-role callers: it enumerates active orgs and mints a context
per org, then runs the existing work inside that context. This also moves 273
lines of orchestration out of `routes/cron.ts`, which lets the ESLint fence
apply to `routes/` with no exception left.

**Files:**
- Create: `backend/services/cronRunner.ts`
- Modify: `backend/routes/cron.ts`
- Create: `backend/tests/services/cron-runner.test.ts`

**Interfaces:**
- Consumes: `createTenantContext` (Task 6); `supabaseAdmin` (Task 5); `persistAnalysis` (Task 11); `triggerScrape`, `analyzeLeadSignals` (Task 12).
- Produces:
  - `listActiveOrgContexts(): Promise<TenantContext[]>`
  - `runDailyScrape(trigger?: 'scheduled' | 'manual'): Promise<void>`
  - `runBiweeklyScrape(trigger?)`, `runLeadAnalysis(trigger?)`, `runOutreachGeneration(trigger?)`, `pingSignalEngine()`
  - `withAudit(ctx: TenantContext, jobName: string, trigger: 'scheduled' | 'manual', fn: () => Promise<number | void>): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/cron-runner.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from 'vitest';
import { listActiveOrgContexts } from '../../services/cronRunner';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

it('returns one context per active org', async () => {
  const contexts = await listActiveOrgContexts();
  const ids = contexts.map(c => c.orgId as string);
  expect(ids).toContain(orgs.a.orgId);
  expect(ids).toContain(orgs.b.orgId);
});

it('each context is scoped to exactly its own org', async () => {
  const contexts = await listActiveOrgContexts();
  const a = contexts.find(c => (c.orgId as string) === orgs.a.orgId)!;
  const { data } = await a.db.from('leads').select('org_id').eq('org_id', a.orgId);
  expect((data ?? []).every(r => r.org_id === orgs.a.orgId)).toBe(true);
});

it('skips suspended orgs', async () => {
  await sql(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [orgs.b.orgId]);
  const ids = (await listActiveOrgContexts()).map(c => c.orgId as string);
  expect(ids).toContain(orgs.a.orgId);
  expect(ids).not.toContain(orgs.b.orgId);
  await sql(`UPDATE organizations SET status = 'active' WHERE id = $1`, [orgs.b.orgId]);
});

it('uses an admin user of the org as the context user', async () => {
  const contexts = await listActiveOrgContexts();
  const a = contexts.find(c => (c.orgId as string) === orgs.a.orgId)!;
  const { rows } = await sql(`SELECT org_id FROM users WHERE id = $1`, [a.userId]);
  expect(rows[0]?.org_id).toBe(orgs.a.orgId);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/services/cron-runner.test.ts`
Expected: FAIL — `backend/services/cronRunner.ts` does not exist.

- [ ] **Step 3: Write `cronRunner.ts`**

Create `backend/services/cronRunner.ts`:

```ts
import { supabaseAdmin } from './supabaseAdmin';
import { createTenantContext, TenantContext } from './tenantContext';
import * as db from './supabaseService';
import { persistAnalysis } from './persistAnalysis';
import { analyzeLeadSignals, triggerScrape, healthCheck } from './signalEngineService';
import { generateOutreach } from './claudeService';
import type { LeadSource } from '../../shared/types';

/**
 * Scheduled work has no request and therefore no session, so it is one of the
 * three sanctioned service-role callers. It uses that privilege for exactly one
 * thing — enumerating orgs — and then drops into a per-org TenantContext for
 * all actual work, so a bug here can only ever affect one tenant at a time.
 */
export async function listActiveOrgContexts(): Promise<TenantContext[]> {
  const { data: orgs, error } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('status', 'active');
  if (error) throw new Error(`listActiveOrgContexts: ${error.message}`);

  const contexts: TenantContext[] = [];
  for (const org of orgs ?? []) {
    // The context needs a user id for the JWT's `sub`. Any admin of the org
    // will do; an org with no admin cannot be operated on and is skipped
    // loudly rather than silently running as nobody.
    const { data: admin } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', org.id)
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!admin) {
      console.error(`[CRON] Org ${org.id} has no active admin — skipping`);
      continue;
    }
    contexts.push(createTenantContext(org.id, admin.id));
  }
  return contexts;
}

export async function withAudit(
  ctx: TenantContext,
  jobName: string,
  trigger: 'scheduled' | 'manual',
  fn: () => Promise<number | void>,
): Promise<void> {
  const started = Date.now();
  const log = await db.createCronJobLog(ctx, {
    job_name: jobName,
    trigger_type: trigger,
    status: 'running',
    started_at: new Date(started).toISOString(),
  } as never);

  try {
    const processed = await fn();
    await db.updateCronJobLog(ctx, log.id, {
      status: 'success',
      leads_processed: typeof processed === 'number' ? processed : undefined,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    });
  } catch (err) {
    await db.updateCronJobLog(ctx, log.id, {
      status: 'failed',
      error_message: (err as Error).message,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    });
    throw err;
  }
}

/** Run one job across every active org, isolating failures to the org that caused them. */
async function forEachOrg(
  jobName: string,
  trigger: 'scheduled' | 'manual',
  fn: (ctx: TenantContext) => Promise<number | void>,
): Promise<void> {
  for (const ctx of await listActiveOrgContexts()) {
    try {
      await withAudit(ctx, jobName, trigger, () => fn(ctx));
    } catch (err) {
      console.error(`[CRON] ${jobName} failed for org ${ctx.orgId}:`, (err as Error).message);
    }
  }
}

export async function runDailyScrape(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  // remote_jobs is date-filtered to <=3 days old, so it needs the frequent
  // (daily) cadence rather than the bi-weekly one
  await forEachOrg('daily_scrape', trigger, async (ctx) => {
    await triggerScrape(ctx, ['linkedin', 'job_board', 'remote_jobs']);
  });
}

export async function runBiweeklyScrape(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  await forEachOrg('biweekly_scrape', trigger, async (ctx) => {
    await triggerScrape(ctx, ['crunchbase', 'local_business']);
  });
}

export async function runLeadAnalysis(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  await forEachOrg('analyze_leads', trigger, async (ctx) => {
    const { data: leads } = await db.getLeads(ctx, { status: 'new', per_page: 20 });

    for (const lead of leads) {
      try {
        const signals = await analyzeLeadSignals(ctx, {
          company_name: lead.company_name,
          website: lead.website,
          location: lead.location,
          job_title: lead.job_title,
          hiring_signal: lead.hiring_signal,
          source_url: lead.source_url ?? '',
          source: lead.source as LeadSource,
          scraped_at: lead.scraped_at ?? new Date().toISOString(),
          description: lead.description,
          industry: lead.industry,
          company_size: lead.company_size,
          source_count: lead.source_count ?? 1,
        });

        const existing = await db.getLeadSignals(ctx, lead.id);
        await persistAnalysis(ctx, lead, existing, signals);
      } catch (err) {
        console.error(`[CRON] Failed to analyze lead ${lead.id}:`, (err as Error).message);
      }
    }
    return leads.length;
  });
}

export async function runOutreachGeneration(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  await forEachOrg('generate_outreach', trigger, async (ctx) => {
    const { data: leads } = await db.getLeads(ctx, { status: 'analyzed', min_score: 65, per_page: 50 });
    let generated = 0;

    for (const lead of leads) {
      try {
        const signals = await db.getLeadSignals(ctx, lead.id);
        if (signals.length === 0) continue;

        const existing = await db.getOutreachMessages(ctx, lead.id);
        if (existing.length > 0) continue;

        const outreach = await generateOutreach(lead, signalToAnalysisResult(lead, signals[0]), 'email');
        await db.createOutreachMessage(ctx, {
          lead_id: lead.id,
          channel: 'email',
          subject: outreach.subject,
          body: outreach.body,
          generated_by: 'claude',
          model_version: outreach.model_version,
        });
        generated++;
      } catch (err) {
        console.error(`[CRON] Failed to generate outreach for lead ${lead.id}:`, (err as Error).message);
      }
    }
    return generated;
  });
}

export async function pingSignalEngine(): Promise<void> {
  const ok = await healthCheck();
  console.log(`[CRON] Signal engine ping: ${ok ? 'alive' : 'did not respond'}`);
}
```

`generateOutreach(lead, signals, channel)` takes a full
`SignalAnalysisResult`, but what is stored is a `LeadSignal` row. `routes/cron.ts`
rebuilds one inline; that reconstruction moves into this file as a named helper
rather than changing `claudeService`'s interface. Add it above
`runOutreachGeneration`:

```ts
/**
 * Rebuild the analysis shape `claudeService` expects from what was persisted.
 *
 * The scoring breakdown is not stored per-signal, so it comes back as zeroes —
 * the outreach prompt reads the pain points, angle and maturity, not the
 * breakdown. Lifted verbatim from routes/cron.ts so behaviour is unchanged.
 */
function signalToAnalysisResult(lead: Lead, sig: LeadSignal): SignalAnalysisResult {
  return {
    lead_score: lead.lead_score ?? 0,
    industry: lead.industry,
    likely_pain_points: sig.likely_pain_points ?? [],
    recommended_anta_service: sig.recommended_anta_service ?? '',
    outreach_angle: sig.outreach_angle ?? '',
    operational_maturity: sig.operational_maturity ?? '',
    growth_indicators: sig.growth_indicators ?? [],
    digital_maturity_score: sig.digital_maturity_score ?? 0,
    signal_type: sig.signal_type,
    confidence_score: sig.confidence_score ?? 0,
    scoring_breakdown: {
      company_size_score: 0, hiring_urgency_score: 0,
      complexity_score: 0, digital_score: 0,
    },
    scoring_rationale: '',
    tech_stack: sig.tech_stack ?? [],
    tech_gaps: sig.tech_gaps ?? [],
    verified_website: lead.website,
    contact: lead.contact_email ? {
      name: lead.contact_name ?? '',
      title: lead.contact_title ?? '',
      email: lead.contact_email,
      linkedin_url: lead.contact_linkedin_url ?? '',
      email_confidence: lead.contact_email_confidence ?? 'unknown',
    } : null,
  };
}
```

and widen this file's type import:

```ts
import type { Lead, LeadSignal, LeadSource, SignalAnalysisResult } from '../../shared/types';
```

- [ ] **Step 4: Reduce `routes/cron.ts` to HTTP wiring**

`backend/routes/cron.ts` keeps its schedules and its manual-trigger endpoints
and nothing else. Delete the inline `withAudit` and the four inline job bodies;
import them from `cronRunner` instead:

```ts
import { Router, Request, Response } from 'express';
import cron from 'node-cron';
import {
  runDailyScrape, runBiweeklyScrape, runLeadAnalysis,
  runOutreachGeneration, pingSignalEngine,
} from '../services/cronRunner';
```

Keep `initCronJobs`, the `jobs` registry and all five `cron.schedule(...)`
registrations exactly as they are — they already call the four job functions and
`pingSignalEngine` by name, which now resolve to the imports.

Keep the five existing endpoints at their current paths and response bodies (the
frontend calls them), changing only what sits behind them:

```ts
router.post('/run/scrape', async (_req: Request, res: Response) => {
  runDailyScrape('manual').catch(console.error);
  res.json({ success: true, message: 'Scrape job triggered' });
});

router.post('/run/analyze', async (_req: Request, res: Response) => {
  runLeadAnalysis('manual').catch(console.error);
  res.json({ success: true, message: 'Analysis job triggered' });
});

router.post('/run/outreach', async (_req: Request, res: Response) => {
  runOutreachGeneration('manual').catch(console.error);
  res.json({ success: true, message: 'Outreach generation triggered' });
});

router.post('/run/biweekly', async (_req: Request, res: Response) => {
  runBiweeklyScrape('manual').catch(console.error);
  res.json({ success: true, message: 'Bi-weekly scrape triggered' });
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: { active_jobs: Object.keys(jobs) } });
});
```

`/logs` is the one that changes shape: it is a read on behalf of the logged-in
user, so it takes their context and returns only their org's log rows.

```ts
import { getCronJobLogs } from '../services/supabaseService';
import { ctxOf } from '../api/middleware/auth';

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const logs = await getCronJobLogs(ctxOf(req), 40);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});
```

Delete from this file: the `withAudit` helper (lines 16–58), `runDailyScrape`,
`pingSignalEngine`, `runBiweeklyScrape`, `runLeadAnalysis`,
`runOutreachGeneration` (lines 59–221), and the now-unused
`triggerScrape` / `getLeads` / `updateLead` / `analyzeLeadSignals` /
`generateOutreach` / `* as db` imports.

`routes/cron.ts` still needs no `eslint-disable`: the service-role access lives
in `services/cronRunner.ts`, on the allowed side of the fence.

- [ ] **Step 5: Run everything**

Run: `cd backend && npx tsc --noEmit`
Expected: clean, zero errors.

Run: `cd backend && npm run lint && npm test`
Expected: lint exits 0; every suite passes.

- [ ] **Step 6: Commit**

```bash
git add backend/services/cronRunner.ts backend/routes/cron.ts backend/tests/services
git commit -m "refactor: cron enumerates orgs and runs each in its own TenantContext"
```

---

### Task 14: Switch RLS on, and prove it alone

RLS goes last, deliberately. A wrong policy that is the only thing standing
between a request and the data locks you out of your own database with no
app-layer path to debug through. By now app scoping is proven, so if a policy
misbehaves the app still works while it gets fixed.

The suite here is the whole point of the dual-enforcement design: with both
layers active, a completely broken policy is invisible, because the app filter
already returned the right rows. **Every test in this task issues queries with
no `org_id` filter at all.** If a test in this file passes because of an app
filter, it is testing nothing.

**Files:**
- Create: `supabase/migrations/2026-08-26_rls_policies.sql`
- Modify: `supabase/schema.sql`
- Modify: `backend/tests/helpers/context.ts`
- Create: `backend/tests/rls/org-isolation.test.ts`

**Three obligations inherited from Task 7 (recorded 2026-09-14).** Task 7 could
not use the scoped client the plan specified for `makeTestContext`, because RLS
is already ENABLED with only `service_role_all` policies — through a scoped
client every read returns `[]` and every write is refused, so all eleven
isolation tests would have passed vacuously. It swapped `ctx.db` for
`supabaseAdmin` (service role, no DB filtering) so the app-layer filter is the
only thing under test. That was the right call, and it leaves three things
owed here. **All three, in this order:**

1. **Do not flip `makeTestContext` until the positive controls are confirmed
   present.** Task 7's addendum added an "A can still reach A" assertion to
   every test in `tests/isolation/leads.test.ts`, and Task 8 must carry the
   same pattern into `jobs.test.ts` and `outreach-and-logs.test.ts`. Without
   them, the negative assertions pass equally well when the scope matches
   *nothing* — which is exactly what a subtly wrong policy produces (wrong
   claim name, `USING` without a matching `WITH CHECK`, an `org_id` claim the
   policy reads from the wrong place). Flip first and the suite goes green on
   a policy that returns empty to everybody. Verify by mutation before
   flipping: point `makeTestContext` at a nonexistent org id and confirm
   **every** test in `tests/isolation/` fails. Task 7 verified this for
   `leads.test.ts` — 12 of 12 fail.
2. **Then flip `makeTestContext` back** to `createTenantContext(orgId, userId)`
   unchanged and re-run `tests/isolation/`. Every assertion must stay green.
   That run is the defence-in-depth proof: the same tests passing through the
   client the production path actually uses.
3. **Keep a service-role variant.** Do not simply replace the harness —
   parameterise it (`harness: 'app' | 'rls'`) and run the isolation files under
   both. Otherwise step 2 silently converts these tests from "the app layer
   works" into "something works", and a regression that drops
   `.eq('org_id', ctx.orgId)` becomes invisible behind a working policy. The
   dual-enforcement decision requires each layer to be testable with the other
   disabled; step 2 alone gives up that property.

**Interfaces:**
- Consumes: the org-scoped JWT from `createTenantContext` (Task 6); the seed helpers (Task 7).
- Produces: an `org_isolation` and a `service_role_all` policy on each of the 12 org-scoped tables plus `organizations`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rls/org-isolation.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

// Every query below deliberately omits `.eq('org_id', ...)`. With the app
// filter present, a policy that does nothing at all still looks correct — so
// these tests remove the filter and let the policy stand on its own.

const READ_TABLES = [
  'leads', 'jobs', 'lead_signals', 'lead_scores', 'outreach_messages',
  'outreach_history', 'scraping_logs', 'cron_job_logs', 'job_signals',
  'job_submissions', 'platform_config', 'users',
];

describe.each(READ_TABLES)('%s', (table) => {
  it('returns only the JWT org’s rows with no app filter applied', async () => {
    const { data, error } = await orgs.a.ctx.db.from(table).select('org_id');
    expect(error).toBeNull();
    expect((data ?? []).every(r => r.org_id === orgs.a.orgId)).toBe(true);
  });

  it('returns nothing when explicitly asking for the other org', async () => {
    const { data } = await orgs.a.ctx.db.from(table).select('org_id').eq('org_id', orgs.b.orgId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe('writes', () => {
  it('cannot insert a row into another org', async () => {
    const { error } = await orgs.a.ctx.db
      .from('leads')
      .insert({ company_name: 'Smuggled', source: 'manual', org_id: orgs.b.orgId });
    expect(error).not.toBeNull();
  });

  it('cannot update another org’s row even by primary key', async () => {
    await orgs.a.ctx.db.from('leads').update({ status: 'archived' }).eq('id', orgs.b.leadId);
    const { rows } = await sql(`SELECT status FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].status).toBe('new');
  });

  it('cannot delete another org’s row', async () => {
    await orgs.a.ctx.db.from('leads').delete().eq('id', orgs.b.leadId);
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].n).toBe(1);
  });
});

describe('organizations', () => {
  it('a tenant sees only its own organization row', async () => {
    const { data } = await orgs.a.ctx.db.from('organizations').select('id');
    expect((data ?? []).map(r => r.id)).toEqual([orgs.a.orgId]);
  });
});

describe('refresh_tokens', () => {
  it('is unreachable by an authenticated tenant session', async () => {
    const { data, error } = await orgs.a.ctx.db.from('refresh_tokens').select('id');
    // Session material is auth infrastructure. It has no org column and no
    // authenticated policy, so a tenant session gets nothing back.
    expect(error ?? (data ?? []).length === 0).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/rls/org-isolation.test.ts`
Expected: FAIL — the current policies are `service_role_all` only, so an
`authenticated` request either sees everything or nothing depending on table.
Record which it is before continuing.

- [ ] **Step 3: Write the policy migration**

Create `supabase/migrations/2026-08-26_rls_policies.sql`:

```sql
-- ============================================================
-- Org isolation as a database backstop.
--
-- Applied LAST, after app-layer scoping is proven. Every policy below is
-- byte-identical apart from the table name — which is the entire reason
-- org_id is denormalized onto child tables rather than joined up to a parent.
-- Each is index-backed by the idx_*_org indexes from the tenancy migration.
--
-- `org_id = (auth.jwt() ->> 'org_id')::uuid` reads the claim on the
-- short-lived token minted by backend/services/tenantContext.ts. This project
-- does not use Supabase Auth, so auth.uid() is not available and the org claim
-- is the only identity the policy can trust.
-- ============================================================

BEGIN;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON organizations;
CREATE POLICY "service_role_all" ON organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "org_isolation" ON organizations
  FOR ALL TO authenticated
  USING (id = (auth.jwt() ->> 'org_id')::uuid)
  WITH CHECK (id = (auth.jwt() ->> 'org_id')::uuid);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'leads', 'jobs', 'scraping_logs', 'cron_job_logs',
    'lead_signals', 'lead_scores', 'outreach_messages', 'outreach_history',
    'job_signals', 'job_submissions', 'platform_config'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);

    -- WITH CHECK matters as much as USING: without it a tenant can write a row
    -- stamped with another org's id, which it then cannot see or fix.
    EXECUTE format($p$
      CREATE POLICY "org_isolation" ON %I FOR ALL TO authenticated
        USING (org_id = (auth.jwt() ->> 'org_id')::uuid)
        WITH CHECK (org_id = (auth.jwt() ->> 'org_id')::uuid)
    $p$, t);

    EXECUTE format($p$
      CREATE POLICY "service_role_all" ON %I FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$, t);
  END LOOP;
END $$;

-- refresh_tokens gets a service_role policy and no authenticated policy at
-- all. With RLS enabled and no matching policy, an authenticated session sees
-- zero rows — which is correct: session material is reachable only by the auth
-- controller, which runs as service_role.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON refresh_tokens;
CREATE POLICY "service_role_all" ON refresh_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
```

- [ ] **Step 4: Apply it to the test project and run the suite**

```bash
cd /Users/anadithakur/Documents/Claude/Projects/ANTA/signal
psql "$(grep SUPABASE_TEST_DB_URL .env.test | cut -d= -f2-)" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/2026-08-26_rls_policies.sql
cd backend && npx vitest run tests/rls/org-isolation.test.ts
```

Expected: PASS — 24 read assertions plus the write, organizations and
refresh_tokens cases.

- [ ] **Step 5: Confirm the app suites still pass with RLS on**

Run: `cd backend && npm test`
Expected: every suite passes. The schema and seed helpers use `pg` as the
database owner and are unaffected; the isolation suites now pass for two
independent reasons, which is the design.

If a previously-passing isolation test now fails, RLS is rejecting something the
app is entitled to do. Fix the policy, not the test — and note which query
exposed it, because that is precisely the divergence this suite exists to catch.

- [ ] **Step 6: Update `schema.sql`**

Replace the seven `service_role_all` policies at `supabase/schema.sql:314-333`
with the full policy set from the migration, so a fresh project comes up with
isolation already on.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/2026-08-26_rls_policies.sql supabase/schema.sql backend/tests/rls
git commit -m "feat(db): enforce org isolation in RLS and prove it with the app filter removed"
```

---

### Task 15: `create-org` script and the cutover runbook

Manual onboarding is the launch shape, so this script *is* the onboarding
product. It is the one place allowed to create an organization, and it produces
everything a design partner needs to log in: an org, an admin user, and a
`platform_config` row carrying their identity rather than ANTA's.

**Files:**
- Create: `backend/scripts/create-org.ts`
- Modify: `backend/package.json`
- Create: `docs/runbooks/tenancy-cutover.md`
- Create: `backend/tests/scripts/create-org.test.ts`
- Modify: `docs/superpowers/HANDOFF.md`

**Interfaces:**
- Consumes: `supabaseAdmin` (Task 5); `DEFAULT_PLATFORM_CONFIG` (`shared/types`).
- Produces: `createOrg(input: CreateOrgInput): Promise<CreateOrgResult>` where
  `interface CreateOrgInput { name: string; slug: string; adminEmail: string; adminName: string; adminPassword: string; agencyName?: string }`
  and `interface CreateOrgResult { orgId: string; userId: string }`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/scripts/create-org.test.ts`:

```ts
import bcrypt from 'bcryptjs';
import { afterAll, afterEach, expect, it } from 'vitest';
import { createOrg } from '../../scripts/create-org';
import { closePool, sql } from '../helpers/db';

const SLUG = 'partner-one';

async function cleanup() {
  await sql(`DELETE FROM platform_config WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)`, [SLUG]);
  await sql(`DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)`, [SLUG]);
  await sql(`DELETE FROM organizations WHERE slug = $1`, [SLUG]);
}

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

const INPUT = {
  name: 'Partner One',
  slug: SLUG,
  adminEmail: 'admin@partner-one.test',
  adminName: 'Partner Admin',
  adminPassword: 'a-long-enough-password',
  agencyName: 'Partner One Consulting',
};

it('creates the org, an admin user and a config row', async () => {
  const { orgId, userId } = await createOrg(INPUT);

  const org = await sql(`SELECT slug, status, monthly_scrape_cap FROM organizations WHERE id = $1`, [orgId]);
  expect(org.rows[0]).toMatchObject({ slug: SLUG, status: 'active', monthly_scrape_cap: 100 });

  const user = await sql(`SELECT email, role, org_id, password_hash FROM users WHERE id = $1`, [userId]);
  expect(user.rows[0].role).toBe('admin');
  expect(user.rows[0].org_id).toBe(orgId);
  expect(await bcrypt.compare(INPUT.adminPassword, user.rows[0].password_hash)).toBe(true);

  const cfg = await sql(`SELECT config FROM platform_config WHERE org_id = $1`, [orgId]);
  expect(cfg.rows).toHaveLength(1);
  expect(cfg.rows[0].config.agency_name).toBe('Partner One Consulting');
});

it('never stores the password in plaintext', async () => {
  const { userId } = await createOrg(INPUT);
  const user = await sql(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  expect(user.rows[0].password_hash).not.toContain(INPUT.adminPassword);
});

it('refuses a duplicate slug rather than adopting the existing org', async () => {
  await createOrg(INPUT);
  await expect(createOrg(INPUT)).rejects.toThrow(/slug/i);
});

it('rejects a password shorter than 12 characters', async () => {
  await expect(createOrg({ ...INPUT, adminPassword: 'short' })).rejects.toThrow(/12/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/scripts/create-org.test.ts`
Expected: FAIL — `backend/scripts/create-org.ts` does not exist.

- [ ] **Step 3: Write the script**

Create `backend/scripts/create-org.ts`:

```ts
/* eslint-disable no-restricted-imports -- onboarding runs before any tenant
   exists; creating one is exactly what it does. */
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { DEFAULT_PLATFORM_CONFIG } from '../../shared/types';

export interface CreateOrgInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  agencyName?: string;
}

export interface CreateOrgResult {
  orgId: string;
  userId: string;
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * Onboard a design partner.
 *
 * The only sanctioned way to create an organization. It leaves the tenant able
 * to log in and immediately see their own identity rather than ANTA's — the
 * config row matters as much as the user row, because platform_config drives
 * both scraping targets and the sign-off on generated outreach.
 */
export async function createOrg(input: CreateOrgInput): Promise<CreateOrgResult> {
  if (input.adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Admin password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const { data: clash } = await supabaseAdmin
    .from('organizations').select('id').eq('slug', input.slug).maybeSingle();
  if (clash) {
    throw new Error(`An organization with slug "${input.slug}" already exists`);
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: input.name, slug: input.slug })
    .select('id')
    .single();
  if (orgError || !org) throw new Error(`Failed to create organization: ${orgError?.message}`);

  const passwordHash = await bcrypt.hash(input.adminPassword, 12);

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      email: input.adminEmail.toLowerCase().trim(),
      password_hash: passwordHash,
      name: input.adminName.trim(),
      role: 'admin',
      org_id: org.id,
    })
    .select('id')
    .single();

  if (userError || !user) {
    // Leave no half-built tenant behind: an org with no admin is invisible to
    // cron (which skips it) and unusable by the partner.
    await supabaseAdmin.from('organizations').delete().eq('id', org.id);
    throw new Error(`Failed to create admin user: ${userError?.message}`);
  }

  const { error: configError } = await supabaseAdmin
    .from('platform_config')
    .insert({
      org_id: org.id,
      config: { ...DEFAULT_PLATFORM_CONFIG, agency_name: input.agencyName ?? input.name },
    });
  if (configError) throw new Error(`Failed to create platform_config: ${configError.message}`);

  return { orgId: org.id, userId: user.id };
}

if (require.main === module) {
  const [name, slug, adminEmail, adminName, agencyName] = process.argv.slice(2);
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!name || !slug || !adminEmail || !adminName || !adminPassword) {
    console.error(
      'Usage: ADMIN_PASSWORD=<password> npm run create-org -- ' +
      '"<Org Name>" <slug> <admin@email> "<Admin Name>" ["<Agency Name>"]\n\n' +
      'The password comes from the environment so it stays out of shell history.',
    );
    process.exit(1);
  }

  createOrg({ name, slug, adminEmail, adminName, adminPassword, agencyName })
    .then(({ orgId, userId }) => {
      console.log(`Created org ${orgId} with admin user ${userId}.`);
      console.log('Send the partner their email and password over a secure channel.');
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
```

Add to `backend/package.json` scripts:

```json
    "create-org": "DOTENV_CONFIG_PATH=../.env ts-node -r dotenv/config scripts/create-org.ts"
```

If `ts-node` is not a direct dependency (only `ts-node-dev` is), install it:

```bash
cd backend && npm install -D ts-node@^10.9.2
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/scripts/create-org.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the cutover runbook**

Create `docs/runbooks/tenancy-cutover.md`:

```markdown
# Tenancy cutover runbook

Applies the tenancy foundation to production. One maintenance window,
roughly 30 minutes. There is exactly one tenant today, so there is no
expand/contract phase — the app is down while the schema changes.

## Before the window

- [ ] `SUPABASE_JWT_SECRET` is set on the Render backend service, taken from
      Supabase → Project Settings → API. The backend cannot mint scoped
      clients without it and every authenticated request will 401.
- [ ] `ENGINE_API_KEY` is set identically on both Render services (from Plan 1).
- [ ] The full suite passes against the test project: `cd backend && npm test`
      and `cd signal-engine && ./venv/bin/python -m pytest tests/ -v`.
- [ ] A fresh Supabase backup exists. Take one manually; do not rely on the
      nightly.
- [ ] The migration has been applied to the test project from a clean schema
      at least once (`backend/tests/reset-test-db.sh`).

## The window

1. Scale the Render backend and signal engine to zero, or enable maintenance
   mode. Nothing may write while the composite FKs are being rebuilt.

2. Apply the tenancy migration:

   ```bash
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/2026-08-26_tenancy_foundation.sql
   ```

   It runs in a single transaction. If it aborts, nothing changed — read the
   error, fix, re-run. Do not apply it in pieces.

3. Verify the backfill left nothing behind:

   ```sql
   SELECT 'leads' AS t, COUNT(*) FROM leads WHERE org_id IS NULL
   UNION ALL SELECT 'jobs', COUNT(*) FROM jobs WHERE org_id IS NULL;
   ```

   Expected: zero everywhere. (`SET NOT NULL` would have failed otherwise, so
   this is a belt-and-braces check.)

4. Deploy the backend and the signal engine together. The engine now requires
   `org_id` on `/analyze` and `/scrape`, and the old backend does not send it —
   a partial deploy means every scrape 422s.

5. Purge sessions. Every existing JWT predates the `org_id` claim, and the
   middleware rejects tokens without one:

   ```sql
   DELETE FROM refresh_tokens;
   ```

   Log in again from the frontend and confirm the dashboard loads.

6. Smoke test as the ANTA tenant: list leads, open a lead detail page, run one
   analysis, save a settings change, trigger one scrape.

7. Apply the RLS policies **only after step 6 passes**:

   ```bash
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/2026-08-26_rls_policies.sql
   ```

8. Repeat the step 6 smoke test. Anything that worked before and fails now is
   a policy problem, not an app problem.

## Rollback

Before step 7, rollback is: redeploy the previous backend and engine images,
and restore the backup if the migration itself is the problem. After step 7,
the policies can be dropped without touching data:

```sql
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','users','leads','jobs','scraping_logs',
    'cron_job_logs','lead_signals','lead_scores','outreach_messages',
    'outreach_history','job_signals','job_submissions','platform_config'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);
  END LOOP;
END $$;
```

The app keeps working on its own scoping, which is exactly why RLS went on
last.

## Onboarding a design partner

```bash
cd backend
ADMIN_PASSWORD='<generated>' npm run create-org -- \
  "Partner Name" partner-slug admin@partner.test "Admin Name" "Partner Consulting"
```

Send the credentials over a secure channel, then confirm the partner can log in
and sees an empty dashboard — not ANTA's.
```

- [ ] **Step 6: Run the whole suite one last time**

Run: `cd backend && npm test && npm run lint && npx tsc --noEmit`
Expected: all suites pass, lint exits 0, typecheck clean.

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/ -v`
Expected: 17 passing.

- [ ] **Step 7: Update the handoff**

In `docs/superpowers/HANDOFF.md`:
- Mark Plan 2 **Complete** in the plans table and add its path under Documents.
- Replace "Next step" with writing Plan 3 (job durability + metering).
- Move review finding #2 (`contact_email_confidence`) from open to fixed,
  naming `backend/services/persistAnalysis.ts`.
- Add to "Before deploying this branch": `SUPABASE_JWT_SECRET` must be set on
  the Render backend, and point at `docs/runbooks/tenancy-cutover.md`.
- Note that the three-`createClient` drift and the `cron.ts` inline
  orchestration listed under "Pre-existing architecture drift" are resolved.

- [ ] **Step 8: Commit**

```bash
git add backend/scripts backend/package.json backend/package-lock.json \
        backend/tests/scripts docs/runbooks/tenancy-cutover.md docs/superpowers/HANDOFF.md
git commit -m "feat: create-org onboarding script and tenancy cutover runbook"
```

---

## Not in this plan

Carried by Plan 3 (job durability + metering), per the spec's Section 3:
the `scrape_jobs` / `scrape_job_events` Postgres job store, SSE served from
Postgres, the orphan reaper, `usage_events`, and the `monthly_scrape_cap`
enqueue guard. The `monthly_scrape_cap` **column** ships in Task 2 so that
`organizations` has its final shape; nothing reads it until Plan 3.

Explicitly out of scope for the whole month: self-serve signup, Stripe billing,
plan tiers, cost dashboards, a real worker pool, RAG ingestion and retrieval,
and multi-org membership.
