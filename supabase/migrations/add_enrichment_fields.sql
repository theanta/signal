-- Add tech stack enrichment columns to lead_signals
ALTER TABLE lead_signals
  ADD COLUMN IF NOT EXISTS tech_stack TEXT[],
  ADD COLUMN IF NOT EXISTS tech_gaps  TEXT[];
