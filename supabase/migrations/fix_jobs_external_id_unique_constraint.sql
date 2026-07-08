-- ============================================================
-- Fix: remote-job upserts fail with "42P10: there is no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- `_persist_job_postings` upserts with ON CONFLICT (external_id), but the
-- original table only had a *partial* unique index
-- (`... WHERE external_id IS NOT NULL`). Postgres won't use a partial index as
-- an ON CONFLICT arbiter unless the statement repeats that predicate, which the
-- supabase-py client can't express — so every remote-job scrape failed to persist.
--
-- Replace the partial index with a real UNIQUE constraint. A plain UNIQUE
-- constraint still permits multiple NULL external_id rows (standard Postgres
-- NULL-distinctness), preserving the original intent for postings whose source
-- returned no id, while giving ON CONFLICT an inferrable arbiter.
-- ============================================================

DROP INDEX IF EXISTS idx_jobs_external_id;

ALTER TABLE jobs ADD CONSTRAINT jobs_external_id_key UNIQUE (external_id);
