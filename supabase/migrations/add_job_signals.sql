-- ============================================================
-- AI analysis results for job postings — the jobs-side counterpart
-- of `lead_signals`. One row per analysis pass (JD decode, salary parse,
-- ATS keywords, resume playbook). Latest row wins in the UI.
-- ============================================================

CREATE TABLE job_signals (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seniority            TEXT,      -- junior | mid | senior | lead | unclear
  contract_type        TEXT,      -- full-time | contract | c2c | unclear
  contract_duration    TEXT,
  must_have_skills     TEXT[],
  nice_to_have_skills  TEXT[],
  ats_keywords         TEXT[],    -- ranked, exact JD phrasing
  salary_parsed        JSONB,     -- { min, max, currency, period, normalized_annual_usd }
  red_flags            TEXT[],
  timezone_note        TEXT,      -- IST-translated overlap requirement, if any
  resume_playbook      JSONB,     -- { headline, lead_with[], demote[], keyword_checklist[], framing_tips[], sample_bullets[], screening_risks[] }
  summary              TEXT,      -- 2-sentence "what this role actually is"
  model_version        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_signals_job ON job_signals(job_id);

ALTER TABLE job_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON job_signals
  FOR ALL USING (auth.role() = 'service_role');
