import { sql } from './db';
import { makeTestContext } from './context';
import type { TenantContext } from '../../services/tenantContext';

export interface SeededOrg {
  orgId: string;
  userId: string;
  leadId: string;
  jobId: string;
  messageId: string;
  signalId: string;
  // Added for Task 8: every id-addressed write in the jobs/outreach/logs half
  // needs the *other* org's row id to attack it with, and every scoped read
  // needs a row of its own to prove it is not merely blind.
  submissionId: string;
  scrapingLogId: string;
  cronLogId: string;
  ctx: TenantContext;
}

export interface TwoOrgs {
  a: SeededOrg;
  b: SeededOrg;
}

const SLUGS = ['iso-org-a', 'iso-org-b'];

async function seedOrg(slug: string, label: string): Promise<SeededOrg> {
  const org = await sql(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [label, slug],
  );
  const orgId = org.rows[0].id as string;

  const user = await sql(
    `INSERT INTO users (email, password_hash, name, role, org_id)
     VALUES ($1, 'x', $2, 'admin', $3) RETURNING id`,
    [`${slug}@example.test`, label, orgId],
  );

  const lead = await sql(
    `INSERT INTO leads (company_name, website, source, lead_score, status, org_id)
     VALUES ($1, $2, 'manual', 80, 'new', $3) RETURNING id`,
    [`${label} Co`, `https://${slug}.example.test`, orgId],
  );
  const leadId = lead.rows[0].id as string;

  const job = await sql(
    `INSERT INTO jobs (company_name, job_title, status, org_id)
     VALUES ($1, 'Engineer', 'new', $2) RETURNING id`,
    [`${label} Co`, orgId],
  );

  const message = await sql(
    `INSERT INTO outreach_messages (lead_id, channel, subject, body, org_id)
     VALUES ($1, 'email', $2, 'body', $3) RETURNING id`,
    [leadId, `${label} subject`, orgId],
  );

  // Returned as signalId: updateLeadSignal is an id-addressed write, so the
  // isolation suite needs B's signal id to attack it with.
  const signal = await sql(
    `INSERT INTO lead_signals (lead_id, signal_type, signal_value, confidence_score, org_id)
     VALUES ($1, 'hiring', $2, 0.7, $3) RETURNING id`,
    [leadId, `${label} signal`, orgId],
  );

  await sql(
    `INSERT INTO lead_scores (lead_id, overall_score, org_id) VALUES ($1, 80, $2)`,
    [leadId, orgId],
  );

  const submission = await sql(
    `INSERT INTO job_submissions (job_id, profile_label, org_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [job.rows[0].id, `${label} profile`, orgId],
  );

  const scrapingLog = await sql(
    `INSERT INTO scraping_logs (source, status, org_id)
     VALUES ('manual', 'completed', $1) RETURNING id`,
    [orgId],
  );

  const cronLog = await sql(
    `INSERT INTO cron_job_logs (job_name, status, org_id)
     VALUES ($1, 'success', $2) RETURNING id`,
    [`${label.toLowerCase()}_job`, orgId],
  );

  return {
    orgId,
    userId: user.rows[0].id,
    leadId,
    jobId: job.rows[0].id,
    messageId: message.rows[0].id,
    signalId: signal.rows[0].id,
    submissionId: submission.rows[0].id,
    scrapingLogId: scrapingLog.rows[0].id,
    cronLogId: cronLog.rows[0].id,
    ctx: makeTestContext(orgId, user.rows[0].id),
  };
}

/** Two structurally identical tenants. Every isolation test acts as A and asserts B is untouched. */
export async function seedTwoOrgs(): Promise<TwoOrgs> {
  await teardownSeed();
  return {
    a: await seedOrg(SLUGS[0], 'Alpha'),
    b: await seedOrg(SLUGS[1], 'Bravo'),
  };
}

export async function teardownSeed(): Promise<void> {
  // Children cascade from leads/jobs; users and configs are deleted explicitly
  // because organizations is only referenced, not cascaded from.
  //
  // outreach_history goes first and explicitly. Its rows cascade from leads,
  // but they also reference outreach_messages, which cascade from the same
  // delete — leaving teardown's success dependent on Postgres checking that
  // NO ACTION constraint at end-of-statement. Deleting them up front makes
  // teardown independent of that ordering subtlety.
  await sql(
    `DELETE FROM outreach_history WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  // jobs before leads: a converted job references its lead through
  // jobs_converted_lead_org_fkey, which is NO ACTION, so the lead cannot go
  // first.
  await sql(
    `DELETE FROM jobs WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM leads WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM scraping_logs WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM cron_job_logs WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM platform_config WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(
    `DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`, [SLUGS]);
  await sql(`DELETE FROM organizations WHERE slug = ANY($1)`, [SLUGS]);
}
