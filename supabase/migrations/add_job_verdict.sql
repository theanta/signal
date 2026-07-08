-- ============================================================
-- Job triage fields + application-pipeline statuses.
--
-- `verdict` is the rule-based apply-worthiness triage computed at ingest
-- (apply / caution / skip) so the jobs list can sort and filter without
-- joining the analysis table. `posted_at` is parsed from `posted_at_raw`
-- for freshness sorting. Status gains the application pipeline stages
-- (applied → interviewing → placed / rejected).
-- ============================================================

ALTER TABLE jobs
  ADD COLUMN verdict         TEXT CHECK (verdict IN ('apply', 'caution', 'skip')),
  ADD COLUMN verdict_reasons TEXT[],
  ADD COLUMN posted_at       TIMESTAMPTZ;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN
  ('new', 'reviewed', 'applied', 'interviewing', 'placed', 'rejected', 'archived', 'converted'));

CREATE INDEX idx_jobs_verdict ON jobs(verdict);
CREATE INDEX idx_jobs_posted_at ON jobs(posted_at DESC NULLS LAST);
