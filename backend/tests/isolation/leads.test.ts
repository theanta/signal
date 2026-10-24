import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

/**
 * Cross-tenant isolation for the leads/signals/scores half of supabaseService.
 *
 * Every test is the same shape: act as A, prove B is neither visible nor
 * touchable, AND prove A can still reach A. That second half is not padding.
 *
 * Without it these assertions pass just as well when the org scope matches
 * NOTHING — a scope of the wrong org id, a null orgId, or (the real risk) a
 * subtly wrong RLS policy in Task 14 that returns empty to everybody. A suite
 * that cannot tell correct isolation from total blindness would go green on
 * the Task 14 flip and prove nothing. Mutation-tested both ways: deleting
 * `.eq('org_id', ctx.orgId)` fails these, and pointing ctx.orgId at a
 * nonexistent org fails these.
 */

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
    // Positive control first: the same filter shape against A's own company
    // name must find A's lead. Otherwise the Bravo assertion below is also
    // satisfied by a scope that returns nothing to anyone.
    const mine = await db.getLeads(orgs.a.ctx, { min_score: 1, search: 'Alpha' });
    expect(mine.data.map(l => l.id)).toContain(orgs.a.leadId);

    const { data } = await db.getLeads(orgs.a.ctx, { min_score: 1, search: 'Bravo' });
    expect(data).toHaveLength(0);
  });

  it('getLeadById refuses another org’s lead', async () => {
    expect(await db.getLeadById(orgs.a.ctx, orgs.a.leadId)).not.toBeNull();
    expect(await db.getLeadById(orgs.a.ctx, orgs.b.leadId)).toBeNull();
  });

  it('getLeadSignals returns nothing for another org’s lead', async () => {
    expect(await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId)).not.toHaveLength(0);
    expect(await db.getLeadSignals(orgs.a.ctx, orgs.b.leadId)).toEqual([]);
  });

  it('getLeadScore returns null for another org’s lead', async () => {
    expect(await db.getLeadScore(orgs.a.ctx, orgs.a.leadId)).not.toBeNull();
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
    //
    // This test needs no separate positive control: an empty scope returns 50
    // from that same guard, which is neither 0 nor 25, so it already fails
    // closed in both mutation directions.
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
    const mine = await db.updateLead(orgs.a.ctx, orgs.a.leadId, { status: 'contacted' });
    expect(mine.status).toBe('contacted');

    await expect(
      db.updateLead(orgs.a.ctx, orgs.b.leadId, { status: 'contacted' }),
    ).rejects.toBeInstanceOf(db.NotFoundError);

    const { rows } = await sql(`SELECT status FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].status).toBe('new');
  });

  it('updateLeadSignal cannot touch another org’s signal', async () => {
    // The id-addressed write the brief's own test list omitted. B's signal id
    // is passed explicitly — that is the attack, not a typo.
    const mine = await db.updateLeadSignal(orgs.a.ctx, orgs.a.signalId, { signal_value: 'moved' });
    expect(mine.signal_value).toBe('moved');

    await expect(
      db.updateLeadSignal(orgs.a.ctx, orgs.b.signalId, { signal_value: 'moved' }),
    ).rejects.toThrow();

    const { rows } = await sql(`SELECT signal_value FROM lead_signals WHERE id = $1`, [orgs.b.signalId]);
    expect(rows[0].signal_value).toBe('Bravo signal');
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
      db.createLeadSignal(orgs.a.ctx, { lead_id: orgs.a.leadId, signal_type: 'hiring' }),
    ).resolves.toMatchObject({ org_id: orgs.a.orgId });

    // Asserted on the constraint NAME, not merely "it threw": this test's
    // whole claim is that the composite FK is what stops it. A NOT NULL
    // violation or a permission error would also throw, and would leave the
    // comment above lying about which layer caught the attack.
    await expect(
      db.createLeadSignal(orgs.a.ctx, { lead_id: orgs.b.leadId, signal_type: 'hiring' }),
    ).rejects.toThrow(/lead_signals_lead_org_fkey|foreign key/i);

    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM lead_signals WHERE lead_id = $1 AND org_id = $2`,
      [orgs.b.leadId, orgs.a.orgId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('upsertLeadScore for another org’s lead is rejected', async () => {
    await expect(
      db.upsertLeadScore(orgs.a.ctx, { lead_id: orgs.a.leadId, overall_score: 71 }),
    ).resolves.toMatchObject({ org_id: orgs.a.orgId });

    await expect(
      db.upsertLeadScore(orgs.a.ctx, { lead_id: orgs.b.leadId, overall_score: 99 }),
    ).rejects.toThrow();

    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM lead_scores WHERE lead_id = $1 AND overall_score = 99`,
      [orgs.b.leadId],
    );
    expect(rows[0].n).toBe(0);
  });
});
