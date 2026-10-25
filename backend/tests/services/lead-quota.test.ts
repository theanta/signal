import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertCanAnalyze, getLeadQuota, LeadQuotaReachedError, periodBounds,
} from '../../services/leadQuotaService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

describe('periodBounds', () => {
  it('uses local midnight, Monday and the 1st, across a DST change', () => {
    // Thu 29 Oct 2026, 11:00 in Detroit (EDT, UTC-4). DST ends Sun 1 Nov.
    const b = periodBounds(new Date('2026-10-29T15:00:00Z'), 'America/Detroit');
    expect(b.day.start.toISOString()).toBe('2026-10-29T04:00:00.000Z');
    expect(b.day.end.toISOString()).toBe('2026-10-30T04:00:00.000Z');
    expect(b.week.start.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(b.week.end.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // EST by then
    expect(b.month.start.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(b.month.end.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('counts a Sunday as the end of the week, not the start', () => {
    const b = periodBounds(new Date('2026-11-01T18:00:00Z'), 'America/Detroit');
    expect(b.week.start.toISOString()).toBe('2026-10-26T04:00:00.000Z');
  });
});

describe('lead quota', () => {
  let orgs: TwoOrgs;
  const fresh: string[] = [];

  async function newLead(name: string): Promise<string> {
    const r = await sql(`INSERT INTO leads (company_name, source, org_id) VALUES ($1, 'manual', $2) RETURNING id`,
      [name, orgs.a.orgId]);
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    orgs = await seedTwoOrgs();
  });

  beforeEach(async () => {
    await sql(`DELETE FROM leads WHERE id = ANY($1)`, [fresh.splice(0)]);
    await sql(`UPDATE leads SET analyzed_at = NULL, first_analyzed_at = NULL WHERE org_id IN ($1, $2)`,
      [orgs.a.orgId, orgs.b.orgId]);
    await sql(`UPDATE organizations SET lead_quota_daily = NULL, lead_quota_weekly = NULL,
      lead_quota_monthly = NULL WHERE id IN ($1, $2)`, [orgs.a.orgId, orgs.b.orgId]);
  });

  afterAll(async () => {
    await teardownSeed();
    await closePool();
  });

  it('has no limit until one is set', async () => {
    const q = await getLeadQuota(orgs.a.ctx);
    expect(q.remaining).toBeNull();
    expect(q.blocked_until).toBeNull();
  });

  it('counts leads by their first analysis, in this org only', async () => {
    for (const name of ['One', 'Two']) {
      const id = await newLead(name);
      fresh.push(id);
      await sql(`UPDATE leads SET analyzed_at = NOW() WHERE id = $1`, [id]);
    }
    await sql(`UPDATE leads SET analyzed_at = NOW() WHERE id = $1`, [orgs.b.leadId]);
    await sql(`UPDATE organizations SET lead_quota_daily = 5, lead_quota_monthly = 3 WHERE id = $1`, [orgs.a.orgId]);

    const q = await getLeadQuota(orgs.a.ctx);
    expect(q.periods.map(p => [p.period, p.used, p.limit])).toEqual([
      ['day', 2, 5], ['week', 2, null], ['month', 2, 3],
    ]);
    expect(q.remaining).toBe(1);
  });

  it('keeps the first analysis time through re-analysis and client writes', async () => {
    const id = await newLead('Steady');
    fresh.push(id);
    await sql(`UPDATE leads SET analyzed_at = '2026-10-01T12:00:00Z' WHERE id = $1`, [id]);
    await sql(`UPDATE leads SET analyzed_at = NOW(), first_analyzed_at = NULL WHERE id = $1`, [id]);
    const r = await sql(`SELECT first_analyzed_at FROM leads WHERE id = $1`, [id]);
    expect(new Date(r.rows[0].first_analyzed_at).toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('refuses a new lead at the limit, but not a re-analysis', async () => {
    const done = await newLead('Done');
    fresh.push(done);
    await sql(`UPDATE leads SET analyzed_at = NOW() WHERE id = $1`, [done]);
    await sql(`UPDATE organizations SET lead_quota_daily = 1 WHERE id = $1`, [orgs.a.orgId]);

    await expect(assertCanAnalyze(orgs.a.ctx, { analyzed_at: null, first_analyzed_at: null }))
      .rejects.toThrow(LeadQuotaReachedError);
    await expect(assertCanAnalyze(orgs.a.ctx, { analyzed_at: null, first_analyzed_at: null }))
      .rejects.toThrow(/Daily lead limit reached \(1 of 1\)/);
    await expect(assertCanAnalyze(orgs.a.ctx, { first_analyzed_at: new Date().toISOString() }))
      .resolves.toBeUndefined();
    // Another org's limit is its own.
    await expect(assertCanAnalyze(orgs.b.ctx, { analyzed_at: null })).resolves.toBeUndefined();
  });
});
