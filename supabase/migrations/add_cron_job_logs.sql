CREATE TABLE IF NOT EXISTS cron_job_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        TEXT        NOT NULL,
  trigger_type    TEXT        NOT NULL DEFAULT 'scheduled' CHECK (trigger_type IN ('scheduled', 'manual')),
  status          TEXT        NOT NULL DEFAULT 'running'   CHECK (status        IN ('running', 'success', 'failed')),
  leads_processed INTEGER,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cron_job_logs_started_at_idx ON cron_job_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS cron_job_logs_job_name_idx   ON cron_job_logs (job_name);

ALTER TABLE cron_job_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON cron_job_logs
  FOR ALL USING (auth.role() = 'service_role');
