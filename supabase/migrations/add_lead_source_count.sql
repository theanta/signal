-- Add multi-source corroboration tracking to leads.
--
-- lead_merger.py combines leads seen on multiple scrapers (e.g. LinkedIn + Indeed)
-- into one row. leads.source stays a single lead_source enum value (the
-- highest-priority contributing source) — it cannot hold a comma-joined
-- composite value. source_count / contributing_sources carry the full
-- multi-source signal instead, so the scorer's corroboration bonus survives
-- both the initial scrape insert and later re-analysis.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS contributing_sources TEXT[] NOT NULL DEFAULT '{}';
