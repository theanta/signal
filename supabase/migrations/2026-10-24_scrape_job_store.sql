-- ============================================================
-- Scrape runs in Postgres (Plan 3, task 3).
--
-- The signal engine kept scrape runs in a process-local dict: a restart lost
-- every run in flight, a second engine instance could not see the first's
-- runs, and nothing stopped one org from starting scrapes back to back.
--
-- A scrape RUN is one execution of POST /scrape. It is not a job posting.
--
-- Run after 2026-08-26_rls_policies.sql. One transaction. The same block,
-- minus BEGIN/COMMIT, closes supabase/schema.sql; change both or neither.
-- ============================================================

BEGIN;

CREATE TABLE scrape_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN
                 ('queued', 'running', 'finalizing', 'completed', 'failed')),
  sources      TEXT[] NOT NULL,
  -- Per-source progress: { "<source>": {status, leads_found, error} }.
  source_state JSONB NOT NULL DEFAULT '{}',
  -- The tenant's config as it was at enqueue; a Settings edit mid-run
  -- cannot change what this run does.
  config       JSONB NOT NULL,
  results      INT NOT NULL DEFAULT 0,
  error        TEXT,
  worker_id    TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  CONSTRAINT scrape_jobs_id_org_uniq UNIQUE (id, org_id)
);

-- One active run per org, enforced by the database. 'finalizing' counts as
-- active: the run is still writing leads, and a second run started then
-- would race it on the same companies.
CREATE UNIQUE INDEX one_active_scrape_per_org ON scrape_jobs (org_id)
  WHERE status IN ('queued', 'running', 'finalizing');
CREATE INDEX idx_scrape_jobs_org_created ON scrape_jobs (org_id, created_at DESC);

CREATE TABLE scrape_job_events (
  seq        BIGSERIAL PRIMARY KEY,
  job_id     UUID NOT NULL,
  org_id     UUID NOT NULL,
  event      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scrape_job_events_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES scrape_jobs (id, org_id) ON DELETE CASCADE
);
CREATE INDEX idx_scrape_job_events_job_seq ON scrape_job_events (job_id, seq);

-- Only the engine (service_role) writes runs. A tenant session may read its
-- own org's runs but never write them: deleting a run would lower the
-- monthly count the scrape cap is checked against.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['scrape_jobs', 'scrape_job_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "org_isolation" ON %I', t);
    EXECUTE format($p$
      CREATE POLICY "org_isolation" ON %I FOR SELECT TO authenticated
        USING (org_id = (SELECT (auth.jwt() ->> 'org_id')::uuid))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY "service_role_all" ON %I FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$, t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END
$$;
GRANT USAGE, SELECT ON SEQUENCE scrape_job_events_seq_seq TO service_role;

COMMIT;
