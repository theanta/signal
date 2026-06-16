-- ============================================================
-- Migration: Add platform_config table
-- Run this in your Supabase SQL editor
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_config (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the single config row with ANTA defaults
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
  "active_sources": ["wellfound", "product_hunt", "job_board", "detroit_business"]
}')
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON platform_config
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger to keep updated_at fresh
CREATE TRIGGER platform_config_updated_at
  BEFORE UPDATE ON platform_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
