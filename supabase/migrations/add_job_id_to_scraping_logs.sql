ALTER TABLE scraping_logs ADD COLUMN IF NOT EXISTS job_id UUID;

CREATE INDEX IF NOT EXISTS idx_scraping_logs_job_id ON scraping_logs(job_id);
