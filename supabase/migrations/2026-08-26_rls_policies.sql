-- ============================================================
-- Org isolation as a database backstop.
--
-- Applied LAST, after app-layer scoping is proven (see
-- docs/runbooks/tenancy-cutover.md). If a policy here misbehaves, the app's
-- own org filter still holds while it gets fixed — and dropping the
-- org_isolation policies is a data-free rollback.
--
-- `org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid)` reads the claim on the
-- short-lived token minted by backend/services/tenantContext.ts. This project
-- does not use Supabase Auth, so auth.uid() names no real auth user and the
-- org claim is the only identity a policy can trust. The sub-SELECT makes
-- Postgres evaluate it once per statement instead of once per row; each
-- policy is backed by the idx_*_org indexes from the tenancy migration.
--
-- Supabase grants every table and view in `public` to `anon` and
-- `authenticated` by default, so RLS — not grants — is what restricts access.
-- This file therefore also closes what those default grants leave open:
-- organizations (RLS was off), the password_hash column, and two views that
-- ran with their owner's rights and so ignored RLS entirely.
--
-- Mirrored verbatim in supabase/schema.sql. Change both or neither; run
-- supabase/schema-parity-check.sh after.
-- ============================================================

BEGIN;

-- Supabase platform roles. A plain local postgres (the schema-parity harness)
-- has none of them, so create any that are missing.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END
$$;

-- ---- Tenant tables: full read/write within the caller's org ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leads', 'jobs', 'scraping_logs', 'cron_job_logs',
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
        USING (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid))
        WITH CHECK (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY "service_role_all" ON %I FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$, t);

    -- Tenant data is never public. anon gets nothing at all.
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END
$$;

-- ---- users: read-only, own org, no password hashes ----
-- Users are created and changed only by the auth controller and create-org,
-- both service_role. A tenant session may list its own org's members, but
-- never write them (that would be self-service privilege escalation) and never
-- read password_hash.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON users;
DROP POLICY IF EXISTS "org_isolation" ON users;
CREATE POLICY "org_isolation" ON users FOR SELECT TO authenticated
  USING (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid));
CREATE POLICY "service_role_all" ON users FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON users FROM anon, authenticated;
GRANT SELECT (id, org_id, email, name, role, is_active, created_at, last_login)
  ON users TO authenticated;

-- ---- organizations: read-only, own row ----
-- Read-only on purpose: status and monthly_scrape_cap live here, and a tenant
-- able to update its own row could unsuspend itself or lift its own cap.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON organizations;
DROP POLICY IF EXISTS "org_isolation" ON organizations;
CREATE POLICY "org_isolation" ON organizations FOR SELECT TO authenticated
  USING (id = (SELECT (auth.jwt() ->> 'org_id')::uuid));
CREATE POLICY "service_role_all" ON organizations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON organizations FROM anon, authenticated;
GRANT SELECT ON organizations TO authenticated;

-- ---- refresh_tokens: service_role only ----
-- Session material, reachable only by the auth controller. No authenticated
-- policy and no grant, so a tenant session cannot even name the table.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON refresh_tokens;
CREATE POLICY "service_role_all" ON refresh_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON refresh_tokens FROM anon, authenticated;

-- ---- Views: run as the caller so RLS applies ----
-- A view runs with its owner's privileges by default, and the owner bypasses
-- RLS — so through the API these returned every tenant's leads (hot_leads) and
-- cross-tenant counts (lead_pipeline_summary) to any session, anon included.
-- security_invoker (Postgres 15+) makes them evaluate RLS as the caller.
ALTER VIEW hot_leads SET (security_invoker = true);
ALTER VIEW lead_pipeline_summary SET (security_invoker = true);
REVOKE ALL ON hot_leads, lead_pipeline_summary FROM anon;
GRANT SELECT ON hot_leads, lead_pipeline_summary TO authenticated;

COMMIT;
