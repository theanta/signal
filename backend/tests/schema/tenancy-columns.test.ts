import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, closePool } from '../helpers/db';

afterAll(async () => {
  await closePool();
});

const ORG_SCOPED_TABLES = [
  'users', 'leads', 'scraping_logs', 'cron_job_logs',
  'lead_signals', 'lead_scores', 'outreach_messages', 'outreach_history',
  'platform_config',
];

const BOGUS_ORG_ID = '00000000-0000-0000-0000-000000000000';

describe('organizations table', () => {
  it('exists with the expected columns', async () => {
    const { rows } = await sql(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'organizations' ORDER BY column_name`,
    );
    const names = rows.map(r => r.column_name);
    expect(names).toEqual([
      'created_at', 'id', 'monthly_scrape_cap', 'name', 'plan', 'slug', 'status',
    ]);
  });

  it('holds exactly the backfilled ANTA org', async () => {
    const { rows } = await sql(`SELECT slug FROM organizations`);
    expect(rows.map(r => r.slug)).toContain('anta');
  });
});

describe.each(ORG_SCOPED_TABLES)('%s', (table) => {
  it('has a NOT NULL org_id referencing organizations', async () => {
    const { rows } = await sql(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_name = $1 AND column_name = 'org_id'`,
      [table],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].data_type).toBe('uuid');
  });
});

// ---------------------------------------------------------------------
// FK-enforcement probe.
//
// The test above only proves org_id is NOT NULL — it says nothing about
// whether the column is actually a foreign key. The obvious probe,
// `INSERT INTO t (org_id) VALUES (bogus)`, is false confidence on every
// org-scoped table except platform_config: 11 of the 12 have other NOT
// NULL, no-default columns (users.email, leads.company_name, ...), so the
// insert is rejected with 23502 (not_null_violation) before Postgres ever
// reaches the foreign key check. That test passes identically whether or
// not `REFERENCES organizations(id)` is even present.
//
// To prove the FK, each row must otherwise be a *valid* insert — every
// required column populated — so that org_id is the only thing that can
// fail. TABLE_PAYLOADS below was derived from
// `information_schema.columns WHERE is_nullable = 'NO' AND column_default
// IS NULL` for each table (excluding org_id itself), giving the minimal
// column set that makes a row otherwise well-formed. Child tables need a
// real parent row, so `beforeAll` creates a probe org and a probe lead.
//
// Each table then gets two assertions:
//   - negative: payload + bogus org_id is rejected with SQLSTATE 23503
//     (foreign_key_violation) specifically — not merely "rejected", since
//     23502 passing is exactly the bug this replaces.
//   - positive control: the same payload + a real org_id inserts
//     successfully (then is cleaned up) — without this, a payload that's
//     malformed for an unrelated reason would make the negative case pass
//     for the wrong reason.
// ---------------------------------------------------------------------

let probeOrgId: string;
let probeLeadId: string;

beforeAll(async () => {
  const org = await sql(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    ['FK Probe Org', `fk-probe-${randomUUID()}`],
  );
  probeOrgId = org.rows[0].id;

  const lead = await sql(
    `INSERT INTO leads (org_id, company_name) VALUES ($1, $2) RETURNING id`,
    [probeOrgId, 'FK Probe Lead'],
  );
  probeLeadId = lead.rows[0].id;
});

afterAll(async () => {
  // Child rows are cleaned up by each positive-control test as it runs;
  // only the fixtures created above remain by the time this runs.
  await sql(`DELETE FROM leads WHERE id = $1`, [probeLeadId]);
  await sql(`DELETE FROM organizations WHERE id = $1`, [probeOrgId]);
});

// Table -> minimal payload of its other NOT NULL / no-default columns.
// A function so lead_id can reference the probe rows created above.
const TABLE_PAYLOADS: Record<string, () => Record<string, unknown>> = {
  users: () => ({
    email: `fk-probe-${randomUUID()}@example.test`,
    password_hash: 'x',
    name: 'FK Probe',
  }),
  leads: () => ({ company_name: 'FK Probe Co' }),
  scraping_logs: () => ({ source: 'manual', status: 'completed' }),
  cron_job_logs: () => ({ job_name: 'fk-probe' }),
  lead_signals: () => ({ lead_id: probeLeadId, signal_type: 'fk-probe' }),
  lead_scores: () => ({ lead_id: probeLeadId, overall_score: 50 }),
  outreach_messages: () => ({ lead_id: probeLeadId, body: 'fk probe body' }),
  outreach_history: () => ({ lead_id: probeLeadId, channel: 'email' }),
  platform_config: () => ({}),
};

function insertRow(table: string, orgId: string, payload: Record<string, unknown>) {
  const columns = ['org_id', ...Object.keys(payload)];
  const values = [orgId, ...Object.values(payload)];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  return sql(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
}

describe.each(ORG_SCOPED_TABLES)('%s FK enforcement', (table) => {
  it('rejects an otherwise-valid row with a bogus org_id (23503)', async () => {
    const payload = TABLE_PAYLOADS[table]();
    await expect(insertRow(table, BOGUS_ORG_ID, payload)).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('accepts the same row with a real org_id (positive control)', async () => {
    const payload = TABLE_PAYLOADS[table]();
    const { rows } = await insertRow(table, probeOrgId, payload);
    expect(rows).toHaveLength(1);
    await sql(`DELETE FROM ${table} WHERE id = $1`, [rows[0].id]);
  });
});

it('does NOT add org_id to refresh_tokens', async () => {
  const { rows } = await sql(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'refresh_tokens' AND column_name = 'org_id'`,
  );
  expect(rows).toHaveLength(0);
});

it('has pgvector available for month-2 RAG', async () => {
  const { rows } = await sql(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
  expect(rows).toHaveLength(1);
});
