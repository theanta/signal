import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

/**
 * Cross-tenant isolation for the outreach, logs and metrics half of
 * supabaseService.
 *
 * Same discipline as tests/isolation/leads.test.ts: each test proves org A
 * cannot reach org B's row AND that org A can still reach its own, so no
 * assertion here is satisfied by a scope that sees nothing at all.
 * Mutation-tested both ways: deleting `.eq('org_id', ctx.orgId)` fails these,
 * and pointing ctx.orgId at a nonexistent org fails these.
 */

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

describe('outreach', () => {
  it('getOutreachMessages returns nothing for another org’s lead', async () => {
    const mine = await db.getOutreachMessages(orgs.a.ctx, orgs.a.leadId);
    expect(mine.map(m => m.id)).toContain(orgs.a.messageId);

    expect(await db.getOutreachMessages(orgs.a.ctx, orgs.b.leadId)).toEqual([]);
  });

  it('createOutreachMessage on another org’s lead is rejected', async () => {
    await expect(
      db.createOutreachMessage(orgs.a.ctx, { lead_id: orgs.a.leadId, channel: 'email', body: 'hi' }),
    ).resolves.toMatchObject({ org_id: orgs.a.orgId });

    // On the constraint NAME: `body` is NOT NULL and `channel` is an enum, so
    // a malformed payload would throw here too and leave the test claiming a
    // tenancy check it never exercised.
    await expect(
      db.createOutreachMessage(orgs.a.ctx, { lead_id: orgs.b.leadId, channel: 'email', body: 'hi' }),
    ).rejects.toThrow(/outreach_messages_lead_org_fkey|foreign key/i);

    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM outreach_messages WHERE lead_id = $1 AND org_id = $2`,
      [orgs.b.leadId, orgs.a.orgId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('getOutreachQueue contains only the caller org’s leads', async () => {
    const queue = await db.getOutreachQueue(orgs.a.ctx);
    // Both seeded leads are score 80 / status 'new', so both qualify for the
    // queue on merit — only the org scope separates them.
    expect(queue.map(r => r.id)).toContain(orgs.a.leadId);
    expect(queue.map(r => r.id)).not.toContain(orgs.b.leadId);
    expect(queue.every(r => r.org_id === orgs.a.orgId)).toBe(true);
  });

  it('getOutreachQueue does not attach another org’s messages to a lead', async () => {
    // The embedded `outreach_messages(...)` resource is a second read with its
    // own scope. A row-level filter on leads alone would still hand A every
    // message hanging off its own lead — including one written by B if the
    // composite FK ever let that happen.
    const queue = await db.getOutreachQueue(orgs.a.ctx);
    const mine = queue.find(r => r.id === orgs.a.leadId);
    expect(mine!.outreach_messages.map(m => m.id)).toContain(orgs.a.messageId);
    expect(mine!.outreach_messages.map(m => m.id)).not.toContain(orgs.b.messageId);
  });

  it('createOutreachHistory referencing another org’s message is rejected', async () => {
    await expect(
      db.createOutreachHistory(orgs.a.ctx, {
        lead_id: orgs.a.leadId, message_id: orgs.a.messageId, channel: 'email',
      }),
    ).resolves.toMatchObject({ org_id: orgs.a.orgId });

    await expect(
      db.createOutreachHistory(orgs.a.ctx, {
        lead_id: orgs.a.leadId, message_id: orgs.b.messageId, channel: 'email',
      }),
    ).rejects.toThrow(/outreach_history_message_org_fkey|foreign key/i);
  });

  it('createOutreachHistory stamps the caller’s org over a payload org_id', async () => {
    const row = await db.createOutreachHistory(orgs.a.ctx, {
      lead_id: orgs.a.leadId, channel: 'email', org_id: orgs.b.orgId,
    });
    expect(row.org_id).toBe(orgs.a.orgId);
  });
});

describe('logs', () => {
  it('getScrapingLogs returns only the caller org’s logs', async () => {
    const logs = await db.getScrapingLogs(orgs.a.ctx);
    expect(logs.map(l => l.id)).toContain(orgs.a.scrapingLogId);
    expect(logs.map(l => l.id)).not.toContain(orgs.b.scrapingLogId);
    expect(logs.every(l => l.org_id === orgs.a.orgId)).toBe(true);
  });

  it('createScrapingLog stamps the caller’s org', async () => {
    const log = await db.createScrapingLog(orgs.a.ctx, {
      source: 'manual', status: 'running', org_id: orgs.b.orgId,
    });
    expect(log.org_id).toBe(orgs.a.orgId);
  });

  it('updateScrapingLog cannot touch another org’s log', async () => {
    // updateScrapingLog swallows its error and returns void, so the only
    // observable difference between "scoped" and "unscoped" is the row itself.
    await db.updateScrapingLog(orgs.a.ctx, orgs.a.scrapingLogId, { leads_found: 7 });
    const mine = await sql(`SELECT leads_found FROM scraping_logs WHERE id = $1`, [orgs.a.scrapingLogId]);
    expect(mine.rows[0].leads_found).toBe(7);

    await db.updateScrapingLog(orgs.a.ctx, orgs.b.scrapingLogId, { leads_found: 999 });
    const theirs = await sql(`SELECT leads_found FROM scraping_logs WHERE id = $1`, [orgs.b.scrapingLogId]);
    expect(theirs.rows[0].leads_found).toBe(0);
  });

  it('getCronJobLogs returns only the caller org’s logs', async () => {
    const logs = await db.getCronJobLogs(orgs.a.ctx);
    expect(logs.map(l => l.id)).toContain(orgs.a.cronLogId);
    expect(logs.map(l => l.id)).not.toContain(orgs.b.cronLogId);
    expect(logs.every(l => l.org_id === orgs.a.orgId)).toBe(true);
  });

  it('createCronJobLog stamps the caller’s org, and updateCronJobLog cannot cross orgs', async () => {
    const log = await db.createCronJobLog(orgs.a.ctx, {
      job_name: 'scoped_probe', trigger_type: 'manual', status: 'running',
      started_at: new Date().toISOString(),
    });
    expect(log.org_id).toBe(orgs.a.orgId);

    await db.updateCronJobLog(orgs.a.ctx, log.id, { status: 'success' });
    const mine = await sql(`SELECT status FROM cron_job_logs WHERE id = $1`, [log.id]);
    expect(mine.rows[0].status).toBe('success');

    await db.updateCronJobLog(orgs.a.ctx, orgs.b.cronLogId, { status: 'failed' });
    const theirs = await sql(`SELECT status FROM cron_job_logs WHERE id = $1`, [orgs.b.cronLogId]);
    expect(theirs.rows[0].status).toBe('success');
  });
});

describe('metrics', () => {
  it('getDashboardMetrics counts only the caller org’s leads', async () => {
    const metrics = await db.getDashboardMetrics(orgs.a.ctx);
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM leads WHERE org_id = $1`, [orgs.a.orgId]);
    expect(rows[0].n).toBeGreaterThan(0);
    expect(metrics.total_leads).toBe(rows[0].n);
    // Both orgs seed one lead, so an unscoped count is strictly larger.
    const all = await sql(`SELECT COUNT(*)::int AS n FROM leads`);
    expect(all.rows[0].n).toBeGreaterThan(rows[0].n);
  });

  it('getDashboardMetrics does not average in another org’s scores', async () => {
    // B's lead is dropped to 10 so an unscoped average (45) differs from the
    // scoped one (80). Without this the two orgs' identical seed scores make
    // the average blind to the scope.
    await sql(`UPDATE leads SET lead_score = 10 WHERE org_id = $1`, [orgs.b.orgId]);
    const metrics = await db.getDashboardMetrics(orgs.a.ctx);
    expect(metrics.avg_score).toBe(80);
    expect(metrics.hot_leads).toBe(1);
    await sql(`UPDATE leads SET lead_score = 80 WHERE org_id = $1`, [orgs.b.orgId]);
  });

  it('getPipelineRows returns only the caller org’s leads', async () => {
    const rows = await db.getPipelineRows(orgs.a.ctx);
    expect(rows.map(r => r.id)).toContain(orgs.a.leadId);
    expect(rows.map(r => r.id)).not.toContain(orgs.b.leadId);
    expect(rows.every(r => r.org_id === orgs.a.orgId)).toBe(true);
  });

  it('getHotLeads returns only the caller org’s leads', async () => {
    const hot = await db.getHotLeads(orgs.a.ctx);
    expect(hot.map(l => l.id)).toContain(orgs.a.leadId);
    expect(hot.map(l => l.id)).not.toContain(orgs.b.leadId);
    expect(hot.every(l => l.org_id === orgs.a.orgId)).toBe(true);
  });
});
