-- Migration: replace legacy lead_source enum values with current scraper sources
--
-- Legacy values (scrapers deleted): wellfound, product_hunt, detroit_business
-- New values needed: crunchbase, local_business
--
-- PostgreSQL does not support removing enum values directly, so we:
--   1. Migrate any legacy rows to 'other'
--   2. Create a new enum with the correct values
--   3. Swap the column types on leads and scraping_logs
--   4. Drop the old enum

BEGIN;

-- Step 1: remap any legacy rows so they survive the type swap
UPDATE leads
SET source = 'other'
WHERE source IN ('wellfound', 'product_hunt', 'detroit_business');

UPDATE scraping_logs
SET source = 'other'
WHERE source IN ('wellfound', 'product_hunt', 'detroit_business');

-- Step 2: build the new enum
CREATE TYPE lead_source_new AS ENUM (
  'linkedin',
  'job_board',
  'crunchbase',
  'local_business',
  'manual',
  'other'
);

-- Step 3: drop views that depend on leads.source
DROP VIEW IF EXISTS hot_leads;
DROP VIEW IF EXISTS lead_pipeline_summary;

-- Swap columns (cast via text)
-- Drop defaults first — PostgreSQL can't auto-cast a default expression to the new type
ALTER TABLE leads ALTER COLUMN source DROP DEFAULT;
ALTER TABLE leads
  ALTER COLUMN source TYPE lead_source_new
  USING source::text::lead_source_new;
ALTER TABLE leads ALTER COLUMN source SET DEFAULT 'other';

ALTER TABLE scraping_logs
  ALTER COLUMN source TYPE lead_source_new
  USING source::text::lead_source_new;

-- Recreate views
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

-- Step 4: replace the old type
DROP TYPE lead_source;
ALTER TYPE lead_source_new RENAME TO lead_source;

COMMIT;
