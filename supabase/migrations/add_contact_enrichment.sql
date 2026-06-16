-- Add contact enrichment columns for LinkedIn URL and email confidence tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_linkedin_url     TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_email_confidence TEXT;
