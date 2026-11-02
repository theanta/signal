-- ============================================================
-- Lead quota: a daily, weekly and monthly cap on newly analyzed leads.
--
-- A lead counts once, when it is first analyzed. Periods follow
-- CRON_TIMEZONE: the day starts at local midnight, the week on Monday, the
-- month on the 1st. Each org's limits are set by the operator (see
-- docs/runbooks/tenancy-cutover.md); new orgs start with no limit.
--
-- Run after 2026-10-25_scoring_model.sql. One transaction. The same block,
-- minus BEGIN/COMMIT, closes supabase/schema.sql.
-- ============================================================

BEGIN;

-- organizations: how many leads the org may have analyzed per day, week and
-- month. NULL means no limit at that level. Tenants can read these (the
-- organizations RLS policy is select-only) but never change them.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS lead_quota_daily   INT CHECK (lead_quota_daily >= 0),
  ADD COLUMN IF NOT EXISTS lead_quota_weekly  INT CHECK (lead_quota_weekly >= 0),
  ADD COLUMN IF NOT EXISTS lead_quota_monthly INT CHECK (lead_quota_monthly >= 0);

-- leads: when the lead was first analyzed. A lead uses one unit of quota,
-- once; re-analyzing it is free. analyzed_at moves on every re-analysis, so
-- the count needs its own column.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_analyzed_at TIMESTAMPTZ;
UPDATE leads SET first_analyzed_at = analyzed_at
  WHERE first_analyzed_at IS NULL AND analyzed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_org_first_analyzed ON leads (org_id, first_analyzed_at);

-- Set by the database, not by the app: it follows the first analyzed_at and
-- never changes after, whatever a client writes.
CREATE OR REPLACE FUNCTION set_first_analyzed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_analyzed_at := NEW.analyzed_at;
  ELSE
    NEW.first_analyzed_at := COALESCE(OLD.first_analyzed_at, NEW.analyzed_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_first_analyzed_at ON leads;
CREATE TRIGGER leads_first_analyzed_at
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_first_analyzed_at();

COMMIT;
