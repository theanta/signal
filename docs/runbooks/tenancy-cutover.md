# Tenancy cutover runbook

Takes production onto the multi-tenant foundation: `org_id` on every tenant
table, the org-scoped backend, the org-required signal engine, the
`org_isolation` RLS policies, and Plan 3's scrape run store, usage metering
and monthly scrape cap.

There are two paths. **Path A is the one that applies today**: the app's
Supabase project (`lgendecyizgfyajaooud`) was deleted on 2026-08-26, so there is
no existing data to migrate. Path B is kept for any database that still has
pre-tenancy data.

## Before either path

- [ ] Backend and engine are deployed from the same commit. The engine
      rejects `/analyze` and `/scrape` without an `org_id` and the tenant's
      `config` (422), and an old backend sends neither.
- [ ] The full suite passes:
      `cd backend && npm test && npm run lint && npx tsc --noEmit` and
      `cd signal-engine && python -m pytest tests/ -v`.
      `npm test` runs the isolation suites twice — once with only the app
      filter, once through the real RLS-scoped client — plus `tests/rls/`.
- [ ] These are set on the **Render backend** service:
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (as before)
  - `SUPABASE_ANON_KEY` — Supabase → Project Settings → API
  - `SUPABASE_JWT_SECRET` — Supabase → Project Settings → API → JWT secret.
    Without it the backend cannot mint org-scoped clients and every
    authenticated request returns 500 "Server configuration error".
  - `JWT_SECRET` (login tokens; unrelated to the one above)
  - `ENGINE_API_KEY`
  - `GROQ_API_KEY` (outreach drafting)
  - Optional: `CRON_TIMEZONE` (default `America/Detroit`, one zone for every
    tenant) and `CRON_ORG_CONCURRENCY` (default 3)
- [ ] These are set on the **Render engine** service:
  - `ENGINE_API_KEY` — the **same value** as on the backend
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — the engine writes scrape
    runs, their progress events and usage rows
  - `GROQ_API_KEY`, `APIFY_API_TOKEN`, `SERPER_API_KEY`
  - `MILLIONVERIFIER_API_KEY` — without it pattern emails are never verified,
    so they are never returned

## Path A — fresh Supabase project (current situation)

1. Create the Supabase project. Note its URL, anon key, service-role key,
   JWT secret and database connection string.

2. Build the schema from `schema.sql` alone. It already contains the tenancy
   columns, the composite foreign keys, the RLS policies, the scrape run
   store and `usage_events` — do **not** also run the migrations in
   `supabase/migrations/`:

   ```bash
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
   ```

3. Create the ANTA tenant (this is the same script used for every design
   partner; see "Onboarding a design partner" below):

   ```bash
   cd backend
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
   ADMIN_PASSWORD='<generated, 12+ chars>' npm run create-org -- \
     "ANTA" anta <your@email> "<Your Name>" "ANTA"
   ```

   The `anta` slug starts with ANTA's own settings (Detroit-area targets,
   services, sign-off; see `backend/scripts/anta-config.ts`). Check them on
   the Settings page after logging in.

4. Point the Render services at the new project, deploy the engine and the
   backend, and run the smoke test below.

## Path B — upgrading a database that has pre-tenancy data

One maintenance window, roughly 30 minutes. There is one tenant at upgrade
time, so there is no expand/contract phase — the app is down while the schema
changes.

1. Take a manual backup. Do not rely on the nightly.
2. Confirm the migration has been applied to a scratch copy from a clean
   schema at least once (`backend/tests/reset-test-db.sh`), and that
   `supabase/schema-parity-check.sh` shows only the expected `org_id`
   column-position hunks.
3. Scale the Render backend and engine to zero. Nothing may write while the
   composite foreign keys are being built.
4. Apply the tenancy migration. It is one transaction; if it aborts, nothing
   changed — read the error, fix, re-run. Do not apply it in pieces.

   ```bash
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/2026-08-26_tenancy_foundation.sql
   ```

5. Check the backfill left nothing behind (the `SET NOT NULL` would have
   failed otherwise; this is belt and braces):

   ```sql
   SELECT COUNT(*) FROM leads WHERE org_id IS NULL;
   ```

   Then apply Plan 3's three migrations, each a single transaction. They
   must land before the deploy in step 7: the new engine writes every scrape
   to `scrape_jobs`, and the smoke test in step 9 runs one.

   ```bash
   # Drops the job-postings tables (they left Signal on 2026-10-24) and
   # strips the remote_* settings.
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/2026-10-24_drop_job_postings.sql
   # Scrape runs and their events; tenants may read their own, never write.
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/2026-10-24_scrape_job_store.sql
   # Usage metering.
   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/2026-10-24_usage_events.sql
   ```

   The two new tables carry their own policies from the start. Neither is
   read through a tenant session by the app (the engine writes them as
   service_role; the backend only inserts usage rows, and a failed usage
   write never fails a request), so "RLS last" is not at risk here.

6. Give the backfilled ANTA org an admin and a config row if it lacks them.
   Cron skips any org with no active admin:

   ```sql
   UPDATE users SET role = 'admin'
   WHERE org_id = (SELECT id FROM organizations WHERE slug = 'anta')
     AND email = '<your@email>';
   ```

7. Deploy the backend and the engine **together**.
8. Purge sessions. Every existing login token predates the `org_id` claim, and
   the middleware rejects tokens without one:

   ```sql
   DELETE FROM refresh_tokens;
   ```

9. Run the smoke test below.
10. Apply the RLS policies **only after the smoke test passes**:

    ```bash
    psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
      -f supabase/migrations/2026-08-26_rls_policies.sql
    ```

11. Run the smoke test again. Anything that worked in step 9 and fails now is
    a policy problem, not an app problem.

## Smoke test

Log in from the frontend as the ANTA admin, then:

- [ ] The dashboard loads and shows ANTA's numbers.
- [ ] Leads list and a lead detail page load. There is no Jobs entry in the
      sidebar.
- [ ] One lead analysis completes (exercises the engine's `org_id` and the
      engine key on the streaming call).
- [ ] Saving a Settings change sticks after a reload.
- [ ] One manual scrape from the System page completes and appears in the
      activity log. Starting a second while it runs shows "A scrape is
      already running".
- [ ] `SELECT provider, operation, units FROM usage_events ORDER BY created_at DESC LIMIT 10`
      shows the scrape's Apify rows and the analysis's Groq row, under ANTA's org.
- [ ] With the anon key, `GET $SUPABASE_URL/rest/v1/leads` and
      `.../rest/v1/organizations` both return `[]`.
- [ ] Settings shows Hiring Roles (Targeting) and Leads analyzed per day
      (Sources), with ANTA's values.

Then create a throwaway second tenant with `create-org` (see "Onboarding a
design partner") and, logged in as it:

- [ ] The dashboard and leads list are empty; Settings shows its own agency
      name and empty targeting, not ANTA's.
- [ ] A manual scrape is refused with "Set target locations in Settings
      before scraping".
- [ ] `PATCH /api/leads/<one of ANTA's lead ids>` returns 404, and the lead
      is unchanged when viewed as ANTA.

Delete the throwaway tenant afterwards, children first (the organizations
row is referenced, not cascaded from):

```sql
DO $$ DECLARE o UUID := (SELECT id FROM organizations WHERE slug = '<slug>'); BEGIN
  DELETE FROM usage_events    WHERE org_id = o;
  DELETE FROM scrape_jobs     WHERE org_id = o;  -- cascades its events
  DELETE FROM scraping_logs   WHERE org_id = o;
  DELETE FROM cron_job_logs   WHERE org_id = o;
  DELETE FROM platform_config WHERE org_id = o;
  DELETE FROM users           WHERE org_id = o;
  DELETE FROM organizations   WHERE id = o;
END $$;
```

## Rollback

- **Before RLS is applied (Path B step 10):** redeploy the previous backend
  and engine images, and restore the backup if the migration itself is the
  problem.
- **After RLS is applied:** replace each `org_isolation` policy with a
  permissive one. No data changes, and the app keeps working on its own org
  filter while the policy problem is fixed — which is exactly why RLS goes on
  last. (Simply *dropping* the policies is not a rollback: RLS stays enabled,
  only `service_role_all` remains, and the backend's scoped client then sees
  no rows at all.)

  ```sql
  DO $$ DECLARE t TEXT; BEGIN
    FOREACH t IN ARRAY ARRAY['leads','scraping_logs','cron_job_logs',
      'lead_signals','lead_scores','outreach_messages','outreach_history',
      'platform_config'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);
      EXECUTE format('CREATE POLICY "org_isolation" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END LOOP;
  END $$;
  ```

  This is a temporary state with one layer of isolation instead of two.
  Re-apply `2026-08-26_rls_policies.sql` once the fault is fixed — it drops
  and recreates every policy, so it is safe to re-run.

  `scrape_jobs`, `scrape_job_events` and `usage_events` need no rollback step:
  the app never reads them through a tenant session, so their policies cannot
  break a page.

## Operating notes

- **Monthly scrape cap.** `organizations.monthly_scrape_cap` (default 100)
  counts every run started this calendar month (UTC), failed ones included.
  Over it, scrapes are refused with "Monthly scrape limit reached". Raise it
  for an org with
  `UPDATE organizations SET monthly_scrape_cap = 200 WHERE slug = '<slug>';`
- **Stuck runs.** A run with no heartbeat for 15 minutes is failed by the
  engine's reaper (checked every 5 minutes), which frees the org to scrape
  again. A run that died in a deploy therefore clears itself within ~20
  minutes.
- **Cost per tenant.**
  `SELECT o.slug, u.provider, SUM(u.units) AS units, SUM(u.cost_cents) AS cents
   FROM usage_events u JOIN organizations o ON o.id = u.org_id
   WHERE u.created_at >= date_trunc('month', now())
   GROUP BY 1, 2 ORDER BY 1, 2;`
  Apify reports its own cost; Serper, Groq and MillionVerifier are counted in
  queries, tokens and verifications.

## Onboarding a design partner

```bash
cd backend
ADMIN_PASSWORD='<generated, 12+ chars>' npm run create-org -- \
  "Partner Name" partner-slug admin@partner.example "Admin Name" "Partner Consulting"
```

The script reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `../.env`
or the environment. It refuses a duplicate slug or an email that already
belongs to a user, and if any step fails it removes what it created, so a
failed run leaves nothing to clean up.

Send the credentials over a secure channel, then confirm the partner can log
in and sees an empty dashboard and their own agency name in Settings — not
ANTA's. A new partner starts with neutral settings: no services, no target
locations, no hiring roles. Scraping is refused (manual: "Set target locations
in Settings before scraping"; scheduled: a failed run in the activity log)
until they set target locations, and their analysis and outreach describe
them only through what they write in Settings. Have them fill in agency
details, services, target locations, industries and hiring roles before the
first scheduled scrape (06:00 in `CRON_TIMEZONE`, default America/Detroit).
