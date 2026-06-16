-- ============================================================
-- ANTA Lead Radar - Supabase Schema
-- Run this in your Supabase SQL editor to set up the database
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
  'other'
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
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_score ON leads(lead_score DESC);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
CREATE INDEX idx_leads_company ON leads(company_name);

-- ============================================================
-- TABLE: lead_signals
-- ============================================================

CREATE TABLE lead_signals (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id                   UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
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
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_signals_lead ON lead_signals(lead_id);
CREATE INDEX idx_lead_signals_type ON lead_signals(signal_type);

-- ============================================================
-- TABLE: lead_scores
-- ============================================================

CREATE TABLE lead_scores (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  overall_score         INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  company_size_score    INTEGER CHECK (company_size_score >= 0 AND company_size_score <= 25),
  hiring_urgency_score  INTEGER CHECK (hiring_urgency_score >= 0 AND hiring_urgency_score <= 25),
  complexity_score      INTEGER CHECK (complexity_score >= 0 AND complexity_score <= 25),
  digital_score         INTEGER CHECK (digital_score >= 0 AND digital_score <= 25),
  scoring_rationale     TEXT,
  scored_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_scores_lead ON lead_scores(lead_id);
CREATE INDEX idx_lead_scores_overall ON lead_scores(overall_score DESC);

-- ============================================================
-- TABLE: outreach_messages
-- ============================================================

CREATE TABLE outreach_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
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
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outreach_messages_lead ON outreach_messages(lead_id);
CREATE INDEX idx_outreach_messages_channel ON outreach_messages(channel);

-- ============================================================
-- TABLE: outreach_history
-- ============================================================

CREATE TABLE outreach_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  message_id    UUID REFERENCES outreach_messages(id),
  channel       outreach_channel NOT NULL,
  status        outreach_status NOT NULL DEFAULT 'draft',
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  replied_at    TIMESTAMPTZ,
  reply_body    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outreach_history_lead ON outreach_history(lead_id);
CREATE INDEX idx_outreach_history_status ON outreach_history(status);
CREATE INDEX idx_outreach_history_sent ON outreach_history(sent_at DESC);

-- ============================================================
-- TABLE: scraping_logs
-- ============================================================

CREATE TABLE scraping_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          lead_source NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  leads_found     INTEGER DEFAULT 0,
  leads_new       INTEGER DEFAULT 0,
  leads_updated   INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  config          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scraping_logs_source ON scraping_logs(source);
CREATE INDEX idx_scraping_logs_status ON scraping_logs(status);
CREATE INDEX idx_scraping_logs_started ON scraping_logs(started_at DESC);

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
  config     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_config (config) VALUES ('{
  "agency_name": "ANTA",
  "agency_location": "Detroit, Michigan",
  "agency_website": "",
  "agency_tagline": "Software consultancy specializing in operational modernization",
  "services": [
    "SaaS development and React/Next.js systems",
    "AI automation systems and intelligent workflows",
    "Operational dashboards and internal tools",
    "CRM systems and AI-powered operational software",
    "Startup MVP development",
    "Workflow automation and process optimization"
  ],
  "outreach_tone": "intelligent, consultative, NOT salesy, operationally focused",
  "cta_style": "15-min call",
  "sign_off": "ANTA Team",
  "target_locations": ["Detroit", "Michigan", "MI", "Dearborn", "Warren", "Troy", "Ann Arbor", "Livonia", "Sterling Heights"],
  "target_company_sizes": ["11-50", "51-200", "201-500"],
  "target_industries": [],
  "active_sources": ["linkedin", "crunchbase", "job_board", "local_business"]
}')
ON CONFLICT DO NOTHING;

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

-- ============================================================
-- SEED: Example lead for development
-- ============================================================

INSERT INTO leads (
  company_name, website, location, industry, company_size,
  description, status, source, source_url, lead_score,
  hiring_signal, job_title
) VALUES (
  'Acme Manufacturing Co.',
  'https://acmemanufacturing.example.com',
  'Detroit, MI',
  'Manufacturing',
  '51-200',
  'Mid-size Detroit manufacturer still running operations on spreadsheets and legacy systems. Actively hiring an "Operations Coordinator" and "Data Entry Specialist".',
  'new',
  'job_board',
  'https://indeed.com/example',
  82,
  'Hiring Operations Coordinator and Data Entry Specialist',
  'Operations Coordinator'
);
