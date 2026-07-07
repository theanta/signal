-- Add 'remote_jobs' as a lead_source: postings from the new remote-job scraper
-- (Indeed, filtered to remote-only, <=3 days old, citizenship/residency-restricted
-- postings excluded).
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'remote_jobs';
