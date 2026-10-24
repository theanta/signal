-- ============================================================
-- Remove the job-postings module (decided 2026-10-24).
--
-- Remote job postings, their apply/caution/skip verdicts and submission
-- tracking move to a separate product. Signal keeps the `linkedin` and
-- `job_board` lead sources, which read job adverts only to find hiring
-- companies and write `leads`, never `jobs`.
--
-- Run after 2026-08-26_tenancy_foundation.sql and before
-- 2026-08-26_rls_policies.sql (whose table list no longer names these
-- tables). One transaction: if it aborts, nothing changed.
--
-- `lead_source` keeps its 'remote_jobs' value. Postgres cannot drop an enum
-- value without rebuilding the type, and nothing writes it any more.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS job_submissions;
DROP TABLE IF EXISTS job_signals;
DROP TABLE IF EXISTS jobs;

-- Stale settings: the remote_* keys and the remote_jobs source toggle.
UPDATE platform_config
SET config = config - 'remote_job_roles' - 'remote_experience_level'
                    - 'remote_technologies' - 'remote_regions'
WHERE config ?| ARRAY['remote_job_roles', 'remote_experience_level',
                      'remote_technologies', 'remote_regions'];

UPDATE platform_config
SET config = jsonb_set(config, '{active_sources}', COALESCE(
      (SELECT jsonb_agg(s)
         FROM jsonb_array_elements_text(config -> 'active_sources') AS s
        WHERE s <> 'remote_jobs'),
      '[]'::jsonb))
WHERE config -> 'active_sources' ? 'remote_jobs';

COMMIT;
