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
--
-- Replaying this file against a database bootstrapped from schema.sql plus
-- the rest of this directory? See ./README.md first — migration order and
-- a platform_config double-seed both bite before this file even runs.
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

COMMIT;
