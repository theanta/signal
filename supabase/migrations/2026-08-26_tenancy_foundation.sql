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
