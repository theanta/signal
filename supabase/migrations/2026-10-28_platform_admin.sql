-- ============================================================
-- Platform admin: the flag that opens the Platform admin page, and the
-- per-organization overview it shows.
--
-- Make yourself a platform admin after running it:
--   UPDATE users SET is_platform_admin = true WHERE email = '<you>';
--
-- Run after 2026-10-27_dashboard_aggregates.sql. One transaction. The same
-- block, minus BEGIN/COMMIT, closes supabase/schema.sql.
-- ============================================================

BEGIN;

-- users.is_platform_admin: Signal's own operators (you), across every org.
-- Set only by hand in SQL; never granted to tenant sessions, so no tenant
-- can read or set it through PostgREST.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- One row per organization for the platform admin page. SECURITY INVOKER and
-- executable by service_role only: the backend calls it after checking the
-- caller is a platform admin. (A tenant session could not execute it, and RLS
-- would limit it to its own org if it could.)
CREATE OR REPLACE FUNCTION admin_org_overview()
RETURNS TABLE (
  id UUID, name TEXT, slug TEXT, plan TEXT, status TEXT, created_at TIMESTAMPTZ,
  monthly_scrape_cap INT, lead_quota_daily INT, lead_quota_weekly INT, lead_quota_monthly INT,
  user_count BIGINT, lead_count BIGINT, last_login TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT o.id, o.name, o.slug, o.plan, o.status, o.created_at, o.monthly_scrape_cap,
         o.lead_quota_daily, o.lead_quota_weekly, o.lead_quota_monthly,
         (SELECT count(*) FROM users u WHERE u.org_id = o.id),
         (SELECT count(*) FROM leads l WHERE l.org_id = o.id),
         (SELECT max(u.last_login) FROM users u WHERE u.org_id = o.id)
  FROM organizations o
  ORDER BY o.created_at;
$$;

REVOKE ALL ON FUNCTION admin_org_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_org_overview() TO service_role;

COMMIT;
