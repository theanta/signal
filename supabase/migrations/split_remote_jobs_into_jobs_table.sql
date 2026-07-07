-- ============================================================
-- Split remote job postings out of `leads` into their own table.
--
-- Remote job postings previously became `leads` rows (source='remote_jobs',
-- one per company, most fields discarded). They're now a first-class entity:
-- one row per posting, browsable independently of the leads pipeline.
-- ============================================================

CREATE TABLE jobs (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'archived', 'converted')),
  converted_lead_id  UUID REFERENCES leads(id),
  scraped_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_jobs_external_id ON jobs(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_jobs_source_url ON jobs(source_url);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_company ON jobs(company_name);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON jobs
  FOR ALL USING (auth.role() = 'service_role');

-- ---- Backfill: move existing remote_jobs-sourced leads into `jobs` ----
INSERT INTO jobs (company_name, job_title, location, source_url, description, status, scraped_at, created_at, updated_at)
SELECT company_name, job_title, location, source_url, description, 'new', scraped_at, created_at, updated_at
FROM leads
WHERE source = 'remote_jobs';

DELETE FROM leads WHERE source = 'remote_jobs';
