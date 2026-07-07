-- ============================================================
-- `jobs` previously only ever came from one provider (Indeed), so nothing
-- recorded which source a posting came from. Now that remote_jobs pulls
-- from Indeed, LinkedIn, RemoteOK, and Remotive, each row needs to say which.
-- ============================================================

ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'indeed';

CREATE INDEX idx_jobs_source ON jobs(source);
