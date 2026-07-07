-- Add a 'finalizing' scraping_logs status: a source's own scrape can finish (and get
-- logged) well before the job's cross-source merge + lead persistence phase runs, since
-- all sources scrape sequentially first and the DB writes happen once at the very end.
-- Writing 'completed' immediately made the Activity Log show a false-final state with
-- placeholder leads_new/leads_updated = 0 during that window. Now a successful scrape
-- is logged as 'finalizing' and only promoted to 'completed' (with real counts) once
-- the leads are actually persisted.
ALTER TABLE scraping_logs DROP CONSTRAINT IF EXISTS scraping_logs_status_check;
ALTER TABLE scraping_logs ADD CONSTRAINT scraping_logs_status_check
  CHECK (status IN ('running', 'finalizing', 'completed', 'failed', 'partial'));
