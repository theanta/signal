import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantContext } from '../../services/tenantContext';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

// Every query below deliberately omits `.eq('org_id', ...)`. With the app
// filter present, a policy that does nothing at all still looks correct — so
// these tests remove the filter and let the policies stand on their own.
//
// They also use the real scoped client from createTenantContext, never
// makeTestContext (which swaps in the service-role client and so bypasses RLS).
//
// Every "B is invisible" assertion is paired with an "A is visible" one: a
// policy that returns nothing to anybody must fail here, not pass.

let orgs: TwoOrgs;
let dbA: SupabaseClient;
let dbB: SupabaseClient;

const TENANT_TABLES = [
  'leads', 'lead_signals', 'lead_scores', 'outreach_messages',
  'outreach_history', 'scraping_logs', 'cron_job_logs', 'platform_config',
  'users', 'scrape_jobs', 'scrape_job_events',
];

/** A client signed with the project's JWT secret, carrying arbitrary claims. */
function clientWithClaims(claims: Record<string, unknown>): SupabaseClient {
  const token = jwt.sign(claims, process.env.SUPABASE_JWT_SECRET!, { expiresIn: 300 });
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const anonClient = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

beforeAll(async () => {
  orgs = await seedTwoOrgs();
  // The shared seed leaves four tables empty; fill them for both orgs so each
  // table's "A sees its own rows" control has something to see.
  for (const org of [orgs.a, orgs.b]) {
    await sql(
      `INSERT INTO outreach_history (lead_id, message_id, channel, org_id)
       VALUES ($1, $2, 'email', $3)`, [org.leadId, org.messageId, org.orgId]);
    await sql(`INSERT INTO platform_config (org_id, config) VALUES ($1, '{}')`, [org.orgId]);
    const run = await sql(
      `INSERT INTO scrape_jobs (org_id, status, sources, config)
       VALUES ($1, 'completed', '{linkedin}', '{}') RETURNING id`, [org.orgId]);
    await sql(`INSERT INTO scrape_job_events (job_id, org_id, event) VALUES ($1, $2, '{"phase":"complete"}')`,
      [run.rows[0].id, org.orgId]);
  }
  dbA = createTenantContext(orgs.a.orgId, orgs.a.userId).db;
  dbB = createTenantContext(orgs.b.orgId, orgs.b.userId).db;
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

describe.each(TENANT_TABLES)('%s', (table) => {
  it('returns exactly the JWT org’s rows with no app filter applied', async () => {
    const { data, error } = await dbA.from(table).select('org_id');
    expect(error).toBeNull();
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM ${table} WHERE org_id = $1`, [orgs.a.orgId]);
    expect(rows[0].n).toBeGreaterThan(0);
    expect(data).toHaveLength(rows[0].n);
    expect(data!.every(r => r.org_id === orgs.a.orgId)).toBe(true);
  });

  it('returns nothing when explicitly asking for the other org', async () => {
    const { data, error } = await dbA.from(table).select('org_id').eq('org_id', orgs.b.orgId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('writes', () => {
  it('can insert a row into its own org', async () => {
    const { data, error } = await dbA.from('leads')
      .insert({ company_name: 'Own Co', source: 'manual', org_id: orgs.a.orgId }).select('id').single();
    expect(error).toBeNull();
    await sql(`DELETE FROM leads WHERE id = $1`, [data!.id]);
  });

  it('cannot insert a row into another org', async () => {
    const { error } = await dbA.from('leads')
      .insert({ company_name: 'Smuggled', source: 'manual', org_id: orgs.b.orgId });
    expect(error).not.toBeNull();
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM leads WHERE company_name = 'Smuggled'`);
    expect(rows[0].n).toBe(0);
  });

  it('cannot insert a child row into another org', async () => {
    const { error } = await dbA.from('lead_signals').insert({
      lead_id: orgs.b.leadId, signal_type: 'hiring', confidence_score: 0.5, org_id: orgs.b.orgId,
    });
    expect(error).not.toBeNull();
  });

  it('can update its own row by primary key', async () => {
    const { error } = await dbA.from('leads').update({ notes: 'touched by A' }).eq('id', orgs.a.leadId);
    expect(error).toBeNull();
    const { rows } = await sql(`SELECT notes FROM leads WHERE id = $1`, [orgs.a.leadId]);
    expect(rows[0].notes).toBe('touched by A');
  });

  it('cannot update another org’s row even by primary key', async () => {
    await dbA.from('leads').update({ status: 'archived' }).eq('id', orgs.b.leadId);
    const { rows } = await sql(`SELECT status FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].status).toBe('new');
  });

  it('cannot move its own row into another org', async () => {
    const { error } = await dbA.from('leads').update({ org_id: orgs.b.orgId }).eq('id', orgs.a.leadId);
    expect(error).not.toBeNull();
    const { rows } = await sql(`SELECT org_id FROM leads WHERE id = $1`, [orgs.a.leadId]);
    expect(rows[0].org_id).toBe(orgs.a.orgId);
  });

  it('cannot delete another org’s row', async () => {
    await dbA.from('leads').delete().eq('id', orgs.b.leadId);
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].n).toBe(1);
  });
});

describe('scrape runs', () => {
  // Only the engine (service_role) writes runs. A tenant that could delete its
  // own runs would lower the monthly count its scrape cap is checked against.
  it('a tenant cannot start a run, even in its own org', async () => {
    const { error } = await dbA.from('scrape_jobs')
      .insert({ org_id: orgs.a.orgId, sources: ['linkedin'], config: {} });
    expect(error).not.toBeNull();
  });

  it('a tenant cannot delete or rewrite its own runs', async () => {
    const { rows: before } = await sql(
      `SELECT COUNT(*)::int AS n FROM scrape_jobs WHERE org_id = $1`, [orgs.a.orgId]);
    await dbA.from('scrape_jobs').delete().eq('org_id', orgs.a.orgId);
    await dbA.from('scrape_jobs').update({ status: 'failed' }).eq('org_id', orgs.a.orgId);
    const { rows: after } = await sql(
      `SELECT COUNT(*)::int AS n, bool_and(status = 'completed') AS unchanged
       FROM scrape_jobs WHERE org_id = $1`, [orgs.a.orgId]);
    expect(after[0].n).toBe(before[0].n);
    expect(after[0].unchanged).toBe(true);
  });

  it('anon sees no runs', async () => {
    const { data } = await anonClient().from('scrape_jobs').select('id');
    expect(data ?? []).toEqual([]);
  });
});

describe('organizations', () => {
  it('a tenant sees only its own organization row', async () => {
    const { data, error } = await dbA.from('organizations').select('id');
    expect(error).toBeNull();
    expect((data ?? []).map(r => r.id)).toEqual([orgs.a.orgId]);
  });

  it('a tenant cannot change its own plan, status or cap', async () => {
    await dbA.from('organizations').update({ monthly_scrape_cap: 999999, status: 'active' }).eq('id', orgs.a.orgId);
    const { rows } = await sql(`SELECT monthly_scrape_cap FROM organizations WHERE id = $1`, [orgs.a.orgId]);
    expect(rows[0].monthly_scrape_cap).toBe(100);
  });
});

describe('users', () => {
  it('lists its own org’s users', async () => {
    const { data, error } = await dbA.from('users').select('id, email');
    expect(error).toBeNull();
    expect((data ?? []).map(r => r.id)).toEqual([orgs.a.userId]);
  });

  it('can never read a password hash', async () => {
    const { data, error } = await dbA.from('users').select('password_hash');
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('cannot create a user, even in its own org', async () => {
    const { error } = await dbA.from('users').insert({
      email: 'escalate@example.test', password_hash: 'x', name: 'x', role: 'admin', org_id: orgs.a.orgId,
    });
    expect(error).not.toBeNull();
  });

  it('cannot promote itself', async () => {
    await sql(`UPDATE users SET role = 'member' WHERE id = $1`, [orgs.a.userId]);
    try {
      await dbA.from('users').update({ role: 'admin' }).eq('id', orgs.a.userId);
      const { rows } = await sql(`SELECT role FROM users WHERE id = $1`, [orgs.a.userId]);
      expect(rows[0].role).toBe('member');
    } finally {
      await sql(`UPDATE users SET role = 'admin' WHERE id = $1`, [orgs.a.userId]);
    }
  });
});

describe('refresh_tokens', () => {
  it('is unreachable by an authenticated tenant session', async () => {
    const { data, error } = await dbA.from('refresh_tokens').select('id');
    // Session material is auth infrastructure: no grant, no policy.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe('views', () => {
  it('hot_leads shows the caller’s hot leads and not the other org’s', async () => {
    // Both seeded leads score 80 and are 'new', so both qualify as hot.
    const { data, error } = await dbA.from('hot_leads').select('id, org_id');
    expect(error).toBeNull();
    const ids = (data ?? []).map(r => r.id);
    expect(ids).toContain(orgs.a.leadId);
    expect(ids).not.toContain(orgs.b.leadId);
  });

  it('lead_pipeline_summary counts only the caller’s leads', async () => {
    const { data, error } = await dbB.from('lead_pipeline_summary').select('status, count');
    expect(error).toBeNull();
    const total = (data ?? []).reduce((n, r) => n + Number(r.count), 0);
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM leads WHERE org_id = $1`, [orgs.b.orgId]);
    expect(rows[0].n).toBeGreaterThan(0);
    expect(total).toBe(rows[0].n);
  });
});

describe('sessions without a usable org', () => {
  it('the anon key reads no tenant data, from tables or views', async () => {
    for (const rel of ['leads', 'organizations', 'hot_leads', 'lead_pipeline_summary', 'users']) {
      const { data } = await anonClient().from(rel).select('*');
      expect(data ?? [], rel).toEqual([]);
    }
  });

  it('an authenticated token with no org_id claim sees nothing', async () => {
    const db = clientWithClaims({ role: 'authenticated', aud: 'authenticated', sub: orgs.a.userId });
    const { data, error } = await db.from('leads').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('a malformed org_id claim fails closed', async () => {
    const db = clientWithClaims({ role: 'authenticated', aud: 'authenticated', org_id: 'anta' });
    const { data } = await db.from('leads').select('id');
    expect(data ?? []).toEqual([]);
  });
});
