-- ============================================================
-- Resume submissions per job. Agencies submit multiple profiles to the
-- same posting — one row per profile submitted. `profile_label` is free
-- text ("Ravi K — React Sr."), no candidate PII beyond what the agency
-- chooses to type.
-- ============================================================

CREATE TABLE job_submissions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id         UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_label  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN
                   ('submitted', 'screening', 'interviewing', 'offer', 'placed', 'rejected', 'withdrawn')),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_submissions_job ON job_submissions(job_id);

CREATE TRIGGER job_submissions_updated_at
  BEFORE UPDATE ON job_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE job_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON job_submissions
  FOR ALL USING (auth.role() = 'service_role');
