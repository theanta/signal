import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

describe('reads', () => {
  it('getLeads returns only the caller org’s leads', async () => {
    const { data } = await db.getLeads(orgs.a.ctx);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(l => l.org_id === orgs.a.orgId)).toBe(true);
    expect(data.map(l => l.id)).not.toContain(orgs.b.leadId);
  });

  it('getLeads honours filters without widening the org scope', async () => {
    const { data } = await db.getLeads(orgs.a.ctx, { min_score: 1, search: 'Bravo' });
    expect(data).toHaveLength(0);
  });

  it('getLeadById refuses another org’s lead', async () => {
    expect(await db.getLeadById(orgs.a.ctx, orgs.b.leadId)).toBeNull();
  });

  it('getLeadSignals returns nothing for another org’s lead', async () => {
    expect(await db.getLeadSignals(orgs.a.ctx, orgs.b.leadId)).toEqual([]);
  });

  it('getLeadScore returns null for another org’s lead', async () => {
    expect(await db.getLeadScore(orgs.a.ctx, orgs.b.leadId)).toBeNull();
  });

  it('getScorePercentile does not average in the other org’s scores', async () => {
    // Org A gets a second score of 80 so the scoped sample clears
    // getScorePercentile's "fewer than two scores, return 50" guard — without
    // it this assertion could never distinguish a correct scope from the
    // guard firing. Org B gets a 5.
    //
    // Scoped, A sees [80, 80]: nothing below 80, so 0.
    // Unscoped it would see [80, 80, 80, 5]: one below 80, so 25.
    await sql(
      `INSERT INTO lead_scores (lead_id, overall_score, org_id) VALUES ($1, 80, $2)`,
      [orgs.a.leadId, orgs.a.orgId],
    );
    await sql(
      `INSERT INTO lead_scores (lead_id, overall_score, org_id) VALUES ($1, 5, $2)`,
      [orgs.b.leadId, orgs.b.orgId],
    );
    expect(await db.getScorePercentile(orgs.a.ctx, 80)).toBe(0);
  });
});

describe('writes', () => {
  it('createLead stamps the caller’s org, ignoring any org_id in the payload', async () => {
    const lead = await db.createLead(orgs.a.ctx, {
      company_name: 'Injected',
      source: 'manual',
      org_id: orgs.b.orgId,
    } as never);
    expect(lead.org_id).toBe(orgs.a.orgId);
  });

  it('updateLead cannot touch another org’s lead', async () => {
    // 'contacted', not the brief's 'archived': 'archived' is not a member of
    // the lead_status enum, so that version of this test passed on a type
    // violation whether or not updateLead scoped by org — it stayed green
    // with the .eq('org_id', ...) filter deleted. A valid status makes the
    // org scope the only thing standing between org A and org B's row.
    await expect(
      db.updateLead(orgs.a.ctx, orgs.b.leadId, { status: 'contacted' }),
    ).rejects.toThrow();

    const { rows } = await sql(`SELECT status FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].status).toBe('new');
  });

  it('upsertLeadByWebsite does not adopt another org’s lead by URL collision', async () => {
    const { lead, isNew } = await db.upsertLeadByWebsite(orgs.a.ctx, {
      company_name: 'Collider',
      website: 'https://iso-org-b.example.test',
      source: 'manual',
    });
    expect(isNew).toBe(true);
    expect(lead.org_id).toBe(orgs.a.orgId);
    expect(lead.id).not.toBe(orgs.b.leadId);
  });

  it('createLeadSignal for another org’s lead is rejected by the composite FK', async () => {
    await expect(
      db.createLeadSignal(orgs.a.ctx, { lead_id: orgs.b.leadId, signal_type: 'hiring' }),
    ).rejects.toThrow();
  });

  it('upsertLeadScore for another org’s lead is rejected', async () => {
    await expect(
      db.upsertLeadScore(orgs.a.ctx, { lead_id: orgs.b.leadId, overall_score: 99 }),
    ).rejects.toThrow();
  });
});
