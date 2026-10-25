-- ============================================================
-- Dashboard aggregates: counts, pipeline and score percentile as SQL
-- functions, correct at any number of leads.
--
-- Run after 2026-10-26_lead_quota.sql. One transaction. The same block,
-- minus BEGIN/COMMIT, closes supabase/schema.sql.
-- ============================================================

BEGIN;

-- Dashboard counts, computed in the database instead of by fetching every
-- lead into the backend (PostgREST returns at most 1,000 rows, so those
-- counts went wrong past 1,000 leads). SECURITY INVOKER: they run as the
-- caller, so RLS applies on top of the org filter.

CREATE OR REPLACE FUNCTION dashboard_metrics(p_org UUID, p_since TIMESTAMPTZ)
RETURNS TABLE (
  total_leads BIGINT, hot_leads BIGINT, contacted BIGINT, replied BIGINT,
  meetings BIGINT, clients BIGINT, new_today BIGINT, avg_score INT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE lead_score >= 70),
    count(*) FILTER (WHERE status = 'contacted'),
    count(*) FILTER (WHERE status = 'replied'),
    count(*) FILTER (WHERE status = 'meeting'),
    count(*) FILTER (WHERE status = 'client'),
    count(*) FILTER (WHERE created_at >= p_since),
    COALESCE(round(avg(lead_score) FILTER (WHERE lead_score > 0)), 0)::INT
  FROM leads
  WHERE org_id = p_org;
$$;

CREATE OR REPLACE FUNCTION lead_pipeline(p_org UUID)
RETURNS TABLE (status lead_status, count BIGINT, avg_score INT, last_added TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT status, count(*), COALESCE(round(avg(lead_score)), 0)::INT, max(created_at)
  FROM leads
  WHERE org_id = p_org
  GROUP BY status;
$$;

-- Where a lead's score sits among the org's scores, 0-100. 50 when there is
-- nothing to compare against.
CREATE OR REPLACE FUNCTION lead_score_percentile(p_org UUID, p_lead UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH s AS (SELECT overall_score FROM lead_scores WHERE org_id = p_org),
       me AS (SELECT overall_score FROM lead_scores
              WHERE org_id = p_org AND lead_id = p_lead LIMIT 1)
  SELECT CASE
    WHEN (SELECT count(*) FROM s) < 2 OR NOT EXISTS (SELECT 1 FROM me) THEN 50
    ELSE round(100.0 * (SELECT count(*) FROM s WHERE overall_score < (SELECT overall_score FROM me))
               / (SELECT count(*) FROM s))::INT
  END;
$$;

REVOKE ALL ON FUNCTION dashboard_metrics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lead_pipeline(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lead_score_percentile(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dashboard_metrics(UUID, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lead_pipeline(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lead_score_percentile(UUID, UUID) TO authenticated, service_role;

COMMIT;
