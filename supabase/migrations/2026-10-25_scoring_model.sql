-- ============================================================
-- Scoring model: fit, intent, AI judgment and engagement.
--
-- lead_scores keeps its original four 0-25 columns (the legacy points model)
-- and gains the four 0-100 scores the overall score now blends, the AI's
-- reason, the itemized rules behind each score, and the weights used.
-- leads.lead_score holds the blended overall score, which drives sorting,
-- the outreach threshold and hot leads.
--
-- Run after 2026-10-24_usage_events.sql. One transaction. The same block,
-- minus BEGIN/COMMIT, closes supabase/schema.sql.
-- ============================================================

BEGIN;

ALTER TABLE lead_scores
  ADD COLUMN IF NOT EXISTS fit_score        INTEGER CHECK (fit_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS intent_score     INTEGER CHECK (intent_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_score         INTEGER CHECK (ai_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS engagement_score INTEGER CHECK (engagement_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ai_reason        TEXT,
  -- {fit: {score, factors[], unknown[]}, intent: {...}, engagement: {...}}
  ADD COLUMN IF NOT EXISTS breakdown        JSONB NOT NULL DEFAULT '{}',
  -- The weights the overall score was blended with.
  ADD COLUMN IF NOT EXISTS weights          JSONB NOT NULL DEFAULT '{}';

COMMIT;
