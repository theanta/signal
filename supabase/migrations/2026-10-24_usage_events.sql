-- ============================================================
-- Usage metering (Plan 3, task 6).
--
-- One row per call to a paid external service, attributed to the org that
-- caused it. Attribution only, not billing: it gives the quota and pricing
-- work real numbers per tenant.
--
-- Run after 2026-10-24_scrape_job_store.sql. One transaction. The same
-- block, minus BEGIN/COMMIT, closes supabase/schema.sql.
-- ============================================================

BEGIN;

CREATE TABLE usage_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id),
  -- The scrape run that made the call, when there is one. Not a foreign key:
  -- a usage row must outlive the run it was attributed to.
  job_id     UUID,
  provider   TEXT NOT NULL CHECK (provider IN ('apify', 'serper', 'groq', 'millionverifier')),
  -- What was called, e.g. 'actor:compass/crawler-google-places', 'search',
  -- 'pain_points', 'cold_email', 'verify'.
  operation  TEXT NOT NULL,
  -- Items returned, queries made, tokens used or emails verified.
  units      INT NOT NULL CHECK (units >= 0),
  -- Only when the provider reports a cost (Apify does).
  cost_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_usage_events_org_created ON usage_events (org_id, created_at);

-- The engine writes as service_role. The backend records its own Groq calls
-- through the tenant's scoped client, so a tenant may insert into its own
-- org and read its own rows. It can never change or delete them.
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON usage_events;
DROP POLICY IF EXISTS "org_isolation_select" ON usage_events;
DROP POLICY IF EXISTS "org_isolation_insert" ON usage_events;
CREATE POLICY "org_isolation_select" ON usage_events FOR SELECT TO authenticated
  USING (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid));
CREATE POLICY "org_isolation_insert" ON usage_events FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid));
CREATE POLICY "service_role_all" ON usage_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON usage_events FROM anon, authenticated;
GRANT SELECT, INSERT ON usage_events TO authenticated;
GRANT ALL ON usage_events TO service_role;

COMMIT;
