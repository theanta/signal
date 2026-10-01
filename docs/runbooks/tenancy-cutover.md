# Tenancy cutover runbook

Takes production onto the multi-tenant foundation: `org_id` on every tenant
table, the org-scoped backend, the org-required signal engine, and the
`org_isolation` RLS policies.

There are two paths. **Path A is the one that applies today**: the app's
Supabase project (`lgendecyizgfyajaooud`) was deleted on 2026-08-26, so there is
no existing data to migrate. Path B is kept for any database that still has
pre-tenancy data.

## Before either path

- [ ] Backend and engine are deployed from the same commit. The engine now
      rejects `/analyze` and `/scrape` without an `org_id` (422), and an old
      backend does not send one.
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
- [ ] `ENGINE_API_KEY` is set to the **same value** on the Render engine service.

## Path A — fresh Supabase project (current situation)

1. Create the Supabase project. Note its URL, anon key, service-role key,
   JWT secret and database connection string.

2. Build the schema from `schema.sql` alone. It already contains the tenancy
   columns, the composite foreign keys and the RLS policies — do **not** also
   run the migrations in `supabase/migrations/`:

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

   Then set ANTA's own settings (target locations, services, sign-off) from
   the Settings page after logging in — `create-org` starts every tenant from
   the defaults with only the agency name changed.

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
   SELECT 'leads' AS t, COUNT(*) FROM leads WHERE org_id IS NULL
   UNION ALL SELECT 'jobs', COUNT(*) FROM jobs WHERE org_id IS NULL;
   ```

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
- [ ] Leads list, a lead detail page, and the jobs list load.
- [ ] One lead analysis completes (exercises the engine's `org_id` and the
      engine key on the streaming call).
- [ ] Saving a Settings change sticks after a reload.
- [ ] One manual scrape from the System page completes and appears in the
      activity log.
- [ ] With the anon key, `GET $SUPABASE_URL/rest/v1/leads` and
      `.../rest/v1/organizations` both return `[]`.

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
    FOREACH t IN ARRAY ARRAY['leads','jobs','scraping_logs','cron_job_logs',
      'lead_signals','lead_scores','outreach_messages','outreach_history',
      'job_signals','job_submissions','platform_config'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);
      EXECUTE format('CREATE POLICY "org_isolation" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END LOOP;
  END $$;
  ```

  This is a temporary state with one layer of isolation instead of two.
  Re-apply `2026-08-26_rls_policies.sql` once the fault is fixed — it drops
  and recreates every policy, so it is safe to re-run.

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
ANTA's. Have them set their target locations, services and sign-off in
Settings before the first scheduled scrape (06:00 America/Detroit), or it
will run with the default targets.
