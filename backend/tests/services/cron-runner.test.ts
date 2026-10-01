import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import type { SignalAnalysisResult } from '../../../shared/types';

// Until the org_isolation policies exist (Task 14), a real scoped client sees
// nothing, so cron's contexts get the service-role client here — the same
// swap makeTestContext makes. The app-layer org filter is then the only thing
// keeping orgs apart, which is what these tests are about.
vi.mock('../../services/tenantContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../services/tenantContext')>();
  const { supabaseAdmin } = await import('../../services/supabaseAdmin');
  return {
    ...real,
    createTenantContext: (orgId: string, userId: string) => ({
      ...real.createTenantContext(orgId, userId),
      db: supabaseAdmin,
    }),
  };
});

vi.mock('../../services/signalEngineService', () => ({
  analyzeLeadSignals: vi.fn(),
  triggerScrape: vi.fn(),
  healthCheck: vi.fn(async () => true),
}));

vi.mock('../../services/claudeService', () => ({
  generateOutreach: vi.fn(async () => ({ subject: 's', body: 'b', model_version: 'test' })),
}));

import * as engine from '../../services/signalEngineService';
import {
  listActiveOrgContexts, runDailyScrape, runLeadAnalysis,
} from '../../services/cronRunner';

let orgs: TwoOrgs;
const triggerScrape = vi.mocked(engine.triggerScrape);
const analyzeLeadSignals = vi.mocked(engine.analyzeLeadSignals);

const ANALYSIS = {
  lead_score: 70,
  industry: 'Logistics',
  likely_pain_points: [],
  recommended_anta_service: '',
  outreach_angle: '',
  operational_maturity: '',
  growth_indicators: [],
  digital_maturity_score: 3,
  signal_type: 'hiring',
  confidence_score: 0.6,
  scoring_breakdown: { company_size_score: 0, hiring_urgency_score: 0, complexity_score: 0, digital_score: 0 },
  scoring_rationale: '',
  tech_stack: [],
  tech_gaps: [],
  contact: null,
} as unknown as SignalAnalysisResult;

async function cronLogs(orgId: string, jobName: string) {
  const { rows } = await sql(
    `SELECT status, trigger_type, error_message FROM cron_job_logs
     WHERE org_id = $1 AND job_name = $2 ORDER BY created_at`,
    [orgId, jobName],
  );
  return rows;
}

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

beforeEach(() => {
  triggerScrape.mockReset();
  analyzeLeadSignals.mockReset();
});

afterAll(async () => {
  await sql(`DELETE FROM users WHERE email = 'no-admin@example.test'`);
  await sql(`DELETE FROM organizations WHERE slug = 'cron-no-admin'`);
  await teardownSeed();
  await closePool();
});

describe('listActiveOrgContexts', () => {
  it('returns one context per active org', async () => {
    const ids = (await listActiveOrgContexts()).map(c => c.orgId as string);
    expect(ids).toContain(orgs.a.orgId);
    expect(ids).toContain(orgs.b.orgId);
  });

  it('uses an admin user of the org as the context user', async () => {
    const a = (await listActiveOrgContexts()).find(c => (c.orgId as string) === orgs.a.orgId)!;
    expect(a.userId).toBe(orgs.a.userId);
  });

  it('skips suspended orgs', async () => {
    await sql(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [orgs.b.orgId]);
    try {
      const ids = (await listActiveOrgContexts()).map(c => c.orgId as string);
      expect(ids).toContain(orgs.a.orgId);
      expect(ids).not.toContain(orgs.b.orgId);
    } finally {
      await sql(`UPDATE organizations SET status = 'active' WHERE id = $1`, [orgs.b.orgId]);
    }
  });

  it('skips an org with no active admin rather than running as nobody', async () => {
    const { rows } = await sql(
      `INSERT INTO organizations (name, slug) VALUES ('No Admin', 'cron-no-admin') RETURNING id`);
    await sql(
      `INSERT INTO users (email, password_hash, name, role, org_id)
       VALUES ('no-admin@example.test', 'x', 'Member', 'member', $1)`, [rows[0].id]);
    const ids = (await listActiveOrgContexts()).map(c => c.orgId as string);
    expect(ids).not.toContain(rows[0].id);
    expect(ids).toContain(orgs.a.orgId);
  });
});

describe('scheduled runs', () => {
  it('scrapes once per org, each with its own org, and audits into each org', async () => {
    triggerScrape.mockResolvedValue({ job_id: 'j', status: 'running', sources: [] });
    await runDailyScrape('scheduled');

    const scrapedOrgs = triggerScrape.mock.calls.map(([ctx]) => ctx.orgId as string);
    expect(scrapedOrgs.filter(o => o === orgs.a.orgId)).toHaveLength(1);
    expect(scrapedOrgs.filter(o => o === orgs.b.orgId)).toHaveLength(1);

    expect(await cronLogs(orgs.a.orgId, 'daily_scrape')).toEqual([
      { status: 'success', trigger_type: 'scheduled', error_message: null },
    ]);
    expect(await cronLogs(orgs.b.orgId, 'daily_scrape')).toEqual([
      { status: 'success', trigger_type: 'scheduled', error_message: null },
    ]);
  });

  it('one org failing does not stop the next org', async () => {
    triggerScrape.mockImplementation(async (ctx) => {
      if ((ctx.orgId as string) === orgs.a.orgId) throw new Error('apify down');
      return { job_id: 'j', status: 'running', sources: [] };
    });
    await runDailyScrape('scheduled');

    expect((await cronLogs(orgs.a.orgId, 'daily_scrape')).at(-1))
      .toMatchObject({ status: 'failed', error_message: 'apify down' });
    expect((await cronLogs(orgs.b.orgId, 'daily_scrape')).at(-1))
      .toMatchObject({ status: 'success' });
  });

  it('analyzes each org’s new leads inside that org', async () => {
    await sql(`UPDATE leads SET status = 'new' WHERE id = ANY($1)`, [[orgs.a.leadId, orgs.b.leadId]]);
    analyzeLeadSignals.mockResolvedValue(ANALYSIS);

    await runLeadAnalysis('scheduled');

    // Every engine call carried the org of the lead it was analyzing.
    const { rows } = await sql(`SELECT company_name, org_id FROM leads WHERE id = ANY($1)`,
      [[orgs.a.leadId, orgs.b.leadId]]);
    const orgOf = Object.fromEntries(rows.map(r => [r.company_name, r.org_id]));
    const calls = analyzeLeadSignals.mock.calls.filter(([, lead]) => lead.company_name in orgOf);
    expect(calls).toHaveLength(2);
    for (const [ctx, lead] of calls) {
      expect(ctx.orgId).toBe(orgOf[lead.company_name]);
    }

    const after = await sql(`SELECT status FROM leads WHERE id = ANY($1)`, [[orgs.a.leadId, orgs.b.leadId]]);
    expect(after.rows.map(r => r.status)).toEqual(['analyzed', 'analyzed']);
  });
});

describe('manual runs', () => {
  it('cover only the caller’s org', async () => {
    triggerScrape.mockResolvedValue({ job_id: 'j', status: 'running', sources: [] });
    const bLogsBefore = (await cronLogs(orgs.b.orgId, 'biweekly_scrape')).length;

    const { runBiweeklyScrape } = await import('../../services/cronRunner');
    await runBiweeklyScrape('manual', orgs.a.ctx);

    expect(triggerScrape.mock.calls.map(([ctx]) => ctx.orgId)).toEqual([orgs.a.orgId]);
    expect((await cronLogs(orgs.a.orgId, 'biweekly_scrape')).at(-1))
      .toMatchObject({ status: 'success', trigger_type: 'manual' });
    expect(await cronLogs(orgs.b.orgId, 'biweekly_scrape')).toHaveLength(bLogsBefore);
  });
});
