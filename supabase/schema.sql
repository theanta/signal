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
-- TABLE: jobs
-- ============================================================

CREATE TABLE jobs (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID NOT NULL REFERENCES organizations(id),
  external_id        TEXT,
  company_name       TEXT NOT NULL,
  job_title          TEXT,
  location           TEXT,
  employment_type    TEXT,
  salary_text        TEXT,
  posted_at_raw      TEXT,
  technologies       TEXT[],
  source_url         TEXT,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'new',
  converted_lead_id  UUID,
  scraped_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- source / verdict / verdict_reasons / posted_at were added by later
  -- migrations (add_source_to_jobs.sql, add_job_verdict.sql) and so sit
  -- after updated_at in the migration path; same order kept here.
  source             TEXT NOT NULL DEFAULT 'indeed',
  verdict            TEXT,
  verdict_reasons    TEXT[],
  posted_at          TIMESTAMPTZ,
  CONSTRAINT jobs_status_check CHECK (status IN
    ('new', 'reviewed', 'applied', 'interviewing', 'placed', 'rejected', 'archived', 'converted')),
  CONSTRAINT jobs_verdict_check CHECK (verdict IN ('apply', 'caution', 'skip')),
  -- A real UNIQUE constraint, not the original partial unique index: ON
  -- CONFLICT (external_id) cannot infer a partial index as its arbiter.
  -- See fix_jobs_external_id_unique_constraint.sql.
  CONSTRAINT jobs_external_id_key UNIQUE (external_id),
  CONSTRAINT jobs_id_org_uniq UNIQUE (id, org_id),
  -- converted_lead_id is a nullable sibling reference. MATCH SIMPLE (the
  -- default) skips the check when any referencing column is NULL, so an
  -- unconverted job stays legal and a converted one must name a lead in its
  -- own org.
  CONSTRAINT jobs_converted_lead_org_fkey
    FOREIGN KEY (converted_lead_id, org_id) REFERENCES leads (id, org_id)
);

CREATE INDEX idx_jobs_source_url ON jobs(source_url);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_company ON jobs(company_name);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX idx_jobs_source ON jobs(source);
CREATE INDEX idx_jobs_verdict ON jobs(verdict);
CREATE INDEX idx_jobs_posted_at ON jobs(posted_at DESC NULLS LAST);
CREATE INDEX idx_jobs_org ON jobs(org_id);

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
-- TABLE: job_signals
-- ============================================================

CREATE TABLE job_signals (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id               UUID NOT NULL REFERENCES organizations(id),
  job_id               UUID NOT NULL,
  seniority            TEXT,      -- junior | mid | senior | lead | unclear
  contract_type        TEXT,      -- full-time | contract | c2c | unclear
  contract_duration    TEXT,
  must_have_skills     TEXT[],
  nice_to_have_skills  TEXT[],
  ats_keywords         TEXT[],    -- ranked, exact JD phrasing
  salary_parsed        JSONB,     -- { min, max, currency, period, normalized_annual_usd }
  red_flags            TEXT[],
  timezone_note        TEXT,      -- IST-translated overlap requirement, if any
  resume_playbook      JSONB,
  summary              TEXT,      -- 2-sentence "what this role actually is"
  model_version        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_signals_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES jobs (id, org_id) ON DELETE CASCADE
);

CREATE INDEX idx_job_signals_job ON job_signals(job_id);
CREATE INDEX idx_job_signals_org ON job_signals(org_id);

-- ============================================================
-- TABLE: job_submissions
-- ============================================================

CREATE TABLE job_submissions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID NOT NULL REFERENCES organizations(id),
  job_id         UUID NOT NULL,
  profile_label  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN
                   ('submitted', 'screening', 'interviewing', 'offer', 'placed', 'rejected', 'withdrawn')),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_submissions_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES jobs (id, org_id) ON DELETE CASCADE
);

CREATE INDEX idx_job_submissions_job ON job_submissions(job_id);
CREATE INDEX idx_job_submissions_org ON job_submissions(org_id);

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

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER job_submissions_updated_at
  BEFORE UPDATE ON job_submissions
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
-- ROW LEVEL SECURITY (RLS) - enable for production
-- ============================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_submissions ENABLE ROW LEVEL SECURITY;

-- Policy: service role has full access (used by backend)
CREATE POLICY "service_role_all" ON leads
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON lead_signals
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON lead_scores
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON outreach_messages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON outreach_history
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON scraping_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON platform_config
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON users
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON refresh_tokens
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON jobs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON cron_job_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON job_signals
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON job_submissions
  FOR ALL USING (auth.role() = 'service_role');

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
-- Deliberately NOT granted:
--   * organizations  — RLS is not enabled on it, so a SELECT grant would let
--                      any logged-in user read every tenant's row. It gets
--                      grants together with its policy in Task 14.
--   * refresh_tokens — auth infrastructure, service-role only by design.
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
  jobs,
  scraping_logs,
  cron_job_logs,
  lead_signals,
  lead_scores,
  outreach_messages,
  outreach_history,
  job_signals,
  job_submissions,
  platform_config
TO authenticated;

