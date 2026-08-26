import { afterAll, describe, expect, it } from 'vitest';
import { sql, closePool } from '../helpers/db';

afterAll(async () => {
  await closePool();
});

const ORG_SCOPED_TABLES = [
  'users', 'leads', 'jobs', 'scraping_logs', 'cron_job_logs',
  'lead_signals', 'lead_scores', 'outreach_messages', 'outreach_history',
  'job_signals', 'job_submissions', 'platform_config',
];

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

  it('rejects a row with an org_id that is not a real organization', async () => {
    await expect(
      sql(`INSERT INTO ${table} (org_id) VALUES ('00000000-0000-0000-0000-000000000000')`),
    ).rejects.toThrow();
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
