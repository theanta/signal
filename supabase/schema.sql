-- ============================================================
-- ANTA Lead Radar - Supabase Schema
-- Run this in your Supabase SQL editor to set up the database
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector is enabled now, with no tables, so that month-2 RAG is purely
-- additive and follows the same org_id convention as everything else.
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TABLE: organizations (the tenancy root)
-- ============================================================

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

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE lead_status AS ENUM (
  'new',
  'analyzed',
  'contacted',
  'replied',
  'meeting',
  'proposal',
  'client'
);

CREATE TYPE lead_source AS ENUM (
  'linkedin',
  'job_board',
  'crunchbase',
  'local_business',
  'manual',
  'other',
  -- Appended, not inserted: add_remote_jobs_source.sql adds this value with
  -- ALTER TYPE ... ADD VALUE, which always lands last. Keeping the same
  -- position here keeps schema.sql and the migration path byte-identical.
  'remote_jobs'
);

CREATE TYPE outreach_channel AS ENUM (
  'email',
  'linkedin',
  'phone',
  'other'
);

CREATE TYPE outreach_status AS ENUM (
  'draft',
  'sent',
  'opened',
  'replied',
  'bounced'
);

-- ============================================================
-- TABLE: leads
-- ============================================================

CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  company_name    TEXT NOT NULL,
  website         TEXT,
  linkedin_url    TEXT,
  location        TEXT,
  industry        TEXT,
  company_size    TEXT,
  description     TEXT,
  status          lead_status NOT NULL DEFAULT 'new',
  source          lead_source NOT NULL DEFAULT 'other',
  source_url      TEXT,
  lead_score      INTEGER CHECK (lead_score >= 0 AND lead_score <= 100),
  hiring_signal   TEXT,
  job_title       TEXT,
  contact_name              TEXT,
  contact_email             TEXT,
  contact_title             TEXT,
  contact_linkedin_url      TEXT,
  contact_email_confidence  TEXT,
  notes           TEXT,
  scraped_at      TIMESTAMPTZ,
  analyzed_at     TIMESTAMPTZ,
  contacted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Multi-source corroboration (add_lead_source_count.sql). Declared after
  -- updated_at, not beside `source`, so the column order here matches what
  -- the migration path produces.
  source_count           INTEGER NOT NULL DEFAULT 1,
  contributing_sources   TEXT[]  NOT NULL DEFAULT '{}',
  CONSTRAINT leads_id_org_uniq UNIQUE (id, org_id)
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_score ON leads(lead_score DESC);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
CREATE INDEX idx_leads_company ON leads(company_name);
CREATE INDEX idx_leads_org ON leads(org_id);

-- ============================================================
-- TABLE: lead_signals
-- ============================================================

CREATE TABLE lead_signals (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                    UUID NOT NULL REFERENCES organizations(id),
  lead_id                   UUID NOT NULL,
  signal_type               TEXT NOT NULL,
  signal_value              TEXT,
  confidence_score          FLOAT CHECK (confidence_score >= 0 AND confidence_score <= 1),
  likely_pain_points        TEXT[],
  recommended_anta_service  TEXT,
  outreach_angle            TEXT,
  operational_maturity      TEXT,
  growth_indicators         TEXT[],
  digital_maturity_score    INTEGER CHECK (digital_maturity_score >= 0 AND digital_maturity_score <= 10),
  tech_stack                TEXT[],
  tech_gaps                 TEXT[],
  raw_analysis              JSONB,
  detected_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_signals_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE
);

CREATE INDEX idx_lead_signals_lead ON lead_signals(lead_id);
CREATE INDEX idx_lead_signals_type ON lead_signals(signal_type);
CREATE INDEX idx_lead_signals_org ON lead_signals(org_id);

-- ============================================================
-- TABLE: lead_scores
-- ============================================================

CREATE TABLE lead_scores (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                UUID NOT NULL REFERENCES organizations(id),
  lead_id               UUID NOT NULL,
  overall_score         INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  company_size_score    INTEGER CHECK (company_size_score >= 0 AND company_size_score <= 25),
  hiring_urgency_score  INTEGER CHECK (hiring_urgency_score >= 0 AND hiring_urgency_score <= 25),
  complexity_score      INTEGER CHECK (complexity_score >= 0 AND complexity_score <= 25),
  digital_score         INTEGER CHECK (digital_score >= 0 AND digital_score <= 25),
  scoring_rationale     TEXT,
  scored_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_scores_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE
);

CREATE INDEX idx_lead_scores_lead ON lead_scores(lead_id);
CREATE INDEX idx_lead_scores_overall ON lead_scores(overall_score DESC);
CREATE INDEX idx_lead_scores_org ON lead_scores(org_id);

-- ============================================================
-- TABLE: outreach_messages
-- ============================================================

CREATE TABLE outreach_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  lead_id           UUID NOT NULL,
  channel           outreach_channel NOT NULL DEFAULT 'email',
  subject           TEXT,
  body              TEXT NOT NULL,
  tone              TEXT DEFAULT 'consultative',
  generated_by      TEXT DEFAULT 'claude',
  model_version     TEXT,
  prompt_version    TEXT,
  is_selected       BOOLEAN DEFAULT FALSE,
  personalization   JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outreach_messages_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT outreach_messages_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE
);

CREATE INDEX idx_outreach_messages_lead ON outreach_messages(lead_id);
CREATE INDEX idx_outreach_messages_channel ON outreach_messages(channel);
CREATE INDEX idx_outreach_messages_org ON outreach_messages(org_id);

-- ============================================================
-- TABLE: outreach_history
-- ============================================================

CREATE TABLE outreach_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  lead_id       UUID NOT NULL,
  message_id    UUID,
  channel       outreach_channel NOT NULL,
  status        outreach_status NOT NULL DEFAULT 'draft',
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  replied_at    TIMESTAMPTZ,
  reply_body    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outreach_history_lead_org_fkey
    FOREIGN KEY (lead_id, org_id) REFERENCES leads (id, org_id) ON DELETE CASCADE,
  -- message_id is nullable. MATCH SIMPLE (the default) skips the check when
  -- any referencing column is NULL, which is exactly the wanted behaviour:
  -- history rows with no generated message stay legal, and ones that name a
  -- message must name a message in their own org.
  --
  -- ON DELETE CASCADE, unlike the default NO ACTION it carried until Task 8:
  -- outreach_messages are only ever deleted when their lead is, and that same
  -- delete reaches this row through outreach_history_lead_org_fkey. Left at NO
  -- ACTION, the two paths race inside one statement and any teardown that
  -- deletes outreach_messages before outreach_history fails outright. SET NULL
  -- is unavailable: it would null org_id too, which is NOT NULL.
  CONSTRAINT outreach_history_message_org_fkey
    FOREIGN KEY (message_id, org_id) REFERENCES outreach_messages (id, org_id)
      ON DELETE CASCADE
);

CREATE INDEX idx_outreach_history_lead ON outreach_history(lead_id);
CREATE INDEX idx_outreach_history_status ON outreach_history(status);
CREATE INDEX idx_outreach_history_sent ON outreach_history(sent_at DESC);
CREATE INDEX idx_outreach_history_org ON outreach_history(org_id);

-- ============================================================
-- TABLE: scraping_logs
-- ============================================================

CREATE TABLE scraping_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  source          lead_source NOT NULL,
  status          TEXT NOT NULL,
  leads_found     INTEGER DEFAULT 0,
  leads_new       INTEGER DEFAULT 0,
  leads_updated   INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  config          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_id          UUID,
  -- Named explicitly because add_finalizing_scraping_status.sql drops the
  -- auto-named constraint and re-adds it under this name.
  CONSTRAINT scraping_logs_status_check
    CHECK (status IN ('running', 'finalizing', 'completed', 'failed', 'partial'))
);

CREATE INDEX idx_scraping_logs_source ON scraping_logs(source);
CREATE INDEX idx_scraping_logs_job_id ON scraping_logs(job_id);
CREATE INDEX idx_scraping_logs_status ON scraping_logs(status);
CREATE INDEX idx_scraping_logs_started ON scraping_logs(started_at DESC);
CREATE INDEX idx_scraping_logs_org ON scraping_logs(org_id);


-- ============================================================
-- TABLE: users  (+ refresh_tokens, which is deliberately NOT org-scoped)
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org ON users(org_id);

-- refresh_tokens deliberately gets no org_id: it is auth infrastructure
-- scoped by user_id, and a second source of truth for a session's org is
-- precisely the drift this design exists to prevent.
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ============================================================
-- TABLE: cron_job_logs
-- ============================================================

CREATE TABLE cron_job_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id),
  job_name        TEXT        NOT NULL,
  trigger_type    TEXT        NOT NULL DEFAULT 'scheduled' CHECK (trigger_type IN ('scheduled', 'manual')),
  status          TEXT        NOT NULL DEFAULT 'running'   CHECK (status       IN ('running', 'success', 'failed')),
  leads_processed INTEGER,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX cron_job_logs_started_at_idx ON cron_job_logs (started_at DESC);
CREATE INDEX cron_job_logs_job_name_idx   ON cron_job_logs (job_name);
CREATE INDEX idx_cron_job_logs_org ON cron_job_logs(org_id);

-- ============================================================
-- TRIGGERS: updated_at auto-update
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER outreach_messages_updated_at
  BEFORE UPDATE ON outreach_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER outreach_history_updated_at
  BEFORE UPDATE ON outreach_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VIEWS: useful aggregations
-- ============================================================

CREATE VIEW lead_pipeline_summary AS
SELECT
  status,
  COUNT(*) AS count,
  AVG(lead_score)::INTEGER AS avg_score,
  MAX(created_at) AS last_added
FROM leads
GROUP BY status
ORDER BY
  CASE status
    WHEN 'new' THEN 1
    WHEN 'analyzed' THEN 2
    WHEN 'contacted' THEN 3
    WHEN 'replied' THEN 4
    WHEN 'meeting' THEN 5
    WHEN 'proposal' THEN 6
    WHEN 'client' THEN 7
  END;

CREATE VIEW hot_leads AS
SELECT
  l.*,
  ls.overall_score,
  ls.scoring_rationale,
  array_agg(DISTINCT lsig.signal_type) AS signal_types,
  array_agg(DISTINCT unnested_pain) AS all_pain_points
FROM leads l
LEFT JOIN lead_scores ls ON ls.lead_id = l.id
LEFT JOIN lead_signals lsig ON lsig.lead_id = l.id
LEFT JOIN LATERAL unnest(lsig.likely_pain_points) AS unnested_pain ON TRUE
WHERE l.lead_score >= 70
  AND l.status NOT IN ('client', 'proposal')
GROUP BY l.id, ls.overall_score, ls.scoring_rationale
ORDER BY l.lead_score DESC;

-- ============================================================
-- TABLE: platform_config
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_config (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id),
  config     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- platform_config is one row per tenant, not a global singleton.
  CONSTRAINT platform_config_org_uniq UNIQUE (org_id)
);

-- No seed row here: platform_config is now tenant-scoped (org_id NOT NULL,
-- UNIQUE (org_id)), and schema.sql deliberately creates no organizations row
-- (see the organizations table above) — a fresh multi-tenant project has no
-- tenant yet for a config row to belong to. The ANTA design-partner org and
-- its config are seeded by the caller after schema.sql runs (see
-- backend/tests/reset-test-db.sh), not hardcoded into the generic schema.

CREATE TRIGGER platform_config_updated_at
  BEFORE UPDATE ON platform_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
-- The org_isolation policies are at the end of this file, after the
-- privileges they depend on. See "ROW LEVEL SECURITY: org isolation" below.

-- ============================================================
-- SEED: Example lead for development
-- ============================================================
-- Removed: leads.org_id is now NOT NULL and schema.sql deliberately seeds no
-- organizations row (see the organizations table above), so there is no
-- tenant for a demo lead to belong to at schema-creation time. Insert a demo
-- lead against a real org_id after creating one, if a local example is
-- wanted.

-- ============================================================
-- PRIVILEGES
-- ============================================================

-- ---- Section H: privileges for the `authenticated` role ----
--
-- Task 6 mints short-lived Supabase JWTs whose `role` claim is `authenticated`,
-- so PostgREST executes those requests as the `authenticated` database role.
-- That role had NO privileges at all in this project, so every scoped request
-- failed at the authorization step (42501, "permission denied for schema
-- public") long before any RLS policy was consulted. Grants are what make the
-- policies reachable; the policies themselves arrive in Task 14.
--
-- Granting now is safe and non-exposing: all twelve tables below already have
-- RLS ENABLED with a single `service_role_all` policy, so until Task 14 adds
-- the org_isolation policies an `authenticated` request sees zero rows and can
-- write none. The grant changes the failure from "permission denied" to
-- "empty result", which is what the RLS work in Task 14 then narrows to the
-- caller's own org.
--
-- organizations, refresh_tokens and the users column list are granted (or
-- revoked) together with their policies in the RLS section below.
--
-- The role is a Supabase platform role; a plain local postgres (the
-- schema-parity harness) has no such role, so create it there if absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  leads,
  scraping_logs,
  cron_job_logs,
  lead_signals,
  lead_scores,
  outreach_messages,
  outreach_history,
  platform_config
TO authenticated;

-- ============================================================
-- ROW LEVEL SECURITY: org isolation
-- ============================================================
-- Identical to supabase/migrations/2026-08-26_rls_policies.sql (minus its
-- transaction wrapper), so a fresh project comes up with isolation already
-- on. Change both or neither; run supabase/schema-parity-check.sh after.

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
    'leads', 'scraping_logs', 'cron_job_logs',
    'lead_signals', 'lead_scores', 'outreach_messages', 'outreach_history',
    'platform_config'
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

-- ============================================================
-- TABLES: scrape runs (Plan 3)
-- ============================================================
-- Identical to supabase/migrations/2026-10-24_scrape_job_store.sql (minus its
-- transaction wrapper). Change both or neither; run schema-parity-check.sh.

CREATE TABLE scrape_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN
                 ('queued', 'running', 'finalizing', 'completed', 'failed')),
  sources      TEXT[] NOT NULL,
  -- Per-source progress: { "<source>": {status, leads_found, error} }.
  source_state JSONB NOT NULL DEFAULT '{}',
  -- The tenant's config as it was at enqueue; a Settings edit mid-run
  -- cannot change what this run does.
  config       JSONB NOT NULL,
  results      INT NOT NULL DEFAULT 0,
  error        TEXT,
  worker_id    TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  CONSTRAINT scrape_jobs_id_org_uniq UNIQUE (id, org_id)
);

-- One active run per org, enforced by the database. 'finalizing' counts as
-- active: the run is still writing leads, and a second run started then
-- would race it on the same companies.
CREATE UNIQUE INDEX one_active_scrape_per_org ON scrape_jobs (org_id)
  WHERE status IN ('queued', 'running', 'finalizing');
CREATE INDEX idx_scrape_jobs_org_created ON scrape_jobs (org_id, created_at DESC);

CREATE TABLE scrape_job_events (
  seq        BIGSERIAL PRIMARY KEY,
  job_id     UUID NOT NULL,
  org_id     UUID NOT NULL,
  event      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scrape_job_events_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES scrape_jobs (id, org_id) ON DELETE CASCADE
);
CREATE INDEX idx_scrape_job_events_job_seq ON scrape_job_events (job_id, seq);

-- Only the engine (service_role) writes runs. A tenant session may read its
-- own org's runs but never write them: deleting a run would lower the
-- monthly count the scrape cap is checked against.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['scrape_jobs', 'scrape_job_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);
    EXECUTE format($p$
      CREATE POLICY "org_isolation" ON %I FOR SELECT TO authenticated
        USING (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY "service_role_all" ON %I FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$, t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END
$$;
GRANT USAGE, SELECT ON SEQUENCE scrape_job_events_seq_seq TO service_role;

-- ============================================================
-- TABLES: usage metering (Plan 3)
-- ============================================================
-- Identical to supabase/migrations/2026-10-24_usage_events.sql (minus its
-- transaction wrapper). Change both or neither; run schema-parity-check.sh.

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

-- ============================================================
-- COLUMNS: scoring model (fit, intent, AI judgment, engagement)
-- ============================================================
-- Identical to supabase/migrations/2026-10-25_scoring_model.sql (minus its
-- transaction wrapper). Change both or neither; run schema-parity-check.sh.

ALTER TABLE lead_scores
  ADD COLUMN IF NOT EXISTS fit_score        INTEGER CHECK (fit_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS intent_score     INTEGER CHECK (intent_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_score         INTEGER CHECK (ai_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS engagement_score INTEGER CHECK (engagement_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_reason        TEXT,
  -- {fit: {score, factors[], unknown[]}, intent: {...}, engagement: {...}}
  ADD COLUMN IF NOT EXISTS breakdown        JSONB NOT NULL DEFAULT '{}',
  -- The weights the overall score was blended with.
  ADD COLUMN IF NOT EXISTS weights          JSONB NOT NULL DEFAULT '{}';

-- ============================================================
-- COLUMNS: lead quota
-- ============================================================
-- Identical to supabase/migrations/2026-10-26_lead_quota.sql (minus its
-- transaction wrapper). Change both or neither; run schema-parity-check.sh.

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

-- ============================================================
-- FUNCTIONS: dashboard aggregates
-- ============================================================
-- Identical to supabase/migrations/2026-10-27_dashboard_aggregates.sql (minus
-- its transaction wrapper). Change both or neither; run schema-parity-check.sh.

-- Dashboard counts, computed in the database instead of by fetching every
-- lead into the backend (PostgREST returns at most 1,000 rows, so those
-- counts went wrong past 1,000 leads). SECURITY INVOKER: they run as the
-- caller, so RLS applies on top of the org filter.

CREATE OR REPLACE FUNCTION dashboard_metrics(p_org UUID, p_since TIMESTAMPTZ)
RETURNS TABLE (
  total_leads BIGINT, hot_leads BIGINT, contacted BIGINT, replied BIGINT,
  meetings BIGINT, clients BIGINT, new_today BIGINT, avg_score INT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE lead_score >= 70),
    count(*) FILTER (WHERE status = 'contacted'),
    count(*) FILTER (WHERE status = 'replied'),
    count(*) FILTER (WHERE status = 'meeting'),
    count(*) FILTER (WHERE status = 'client'),
    count(*) FILTER (WHERE created_at >= p_since),
    COALESCE(round(avg(lead_score) FILTER (WHERE lead_score > 0)), 0)::INT
  FROM leads
  WHERE org_id = p_org;
$$;

CREATE OR REPLACE FUNCTION lead_pipeline(p_org UUID)
RETURNS TABLE (status lead_status, count BIGINT, avg_score INT, last_added TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT status, count(*), COALESCE(round(avg(lead_score)), 0)::INT, max(created_at)
  FROM leads
  WHERE org_id = p_org
  GROUP BY status;
$$;

-- Where a lead's score sits among the org's scores, 0-100. 50 when there is
-- nothing to compare against.
CREATE OR REPLACE FUNCTION lead_score_percentile(p_org UUID, p_lead UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH s AS (SELECT overall_score FROM lead_scores WHERE org_id = p_org),
       me AS (SELECT overall_score FROM lead_scores
              WHERE org_id = p_org AND lead_id = p_lead LIMIT 1)
  SELECT CASE
    WHEN (SELECT count(*) FROM s) < 2 OR NOT EXISTS (SELECT 1 FROM me) THEN 50
    ELSE round(100.0 * (SELECT count(*) FROM s WHERE overall_score < (SELECT overall_score FROM me))
               / (SELECT count(*) FROM s))::INT
  END;
$$;

REVOKE ALL ON FUNCTION dashboard_metrics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lead_pipeline(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lead_score_percentile(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dashboard_metrics(UUID, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lead_pipeline(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lead_score_percentile(UUID, UUID) TO authenticated, service_role;
