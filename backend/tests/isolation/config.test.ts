import { afterAll, beforeAll, expect, it } from 'vitest';
import { getConfig, saveConfig } from '../../services/configService';
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

it('returns defaults for an org with no config row', async () => {
  const cfg = await getConfig(orgs.a.ctx);
  expect(cfg.agency_name).toBe('ANTA');
});

it('saving for org A does not change org B', async () => {
  await saveConfig(orgs.a.ctx, { agency_name: 'Alpha Consulting', sign_off: 'Alpha' });
  await saveConfig(orgs.b.ctx, { agency_name: 'Bravo Partners', sign_off: 'Bravo' });

  expect((await getConfig(orgs.a.ctx)).agency_name).toBe('Alpha Consulting');
  expect((await getConfig(orgs.b.ctx)).agency_name).toBe('Bravo Partners');
});

it('each org’s row carries its own org_id', async () => {
  const { rows } = await sql(
    `SELECT org_id, config->>'agency_name' AS name FROM platform_config WHERE org_id = ANY($1)`,
    [[orgs.a.orgId, orgs.b.orgId]],
  );
  const byOrg = Object.fromEntries(rows.map(r => [r.org_id, r.name]));
  expect(byOrg[orgs.a.orgId]).toBe('Alpha Consulting');
  expect(byOrg[orgs.b.orgId]).toBe('Bravo Partners');
});

it('writes exactly one row per org, not one per save', async () => {
  await saveConfig(orgs.a.ctx, { cta_style: '20-min call' });
  await saveConfig(orgs.a.ctx, { cta_style: '30-min call' });
  const { rows } = await sql(
    `SELECT COUNT(*)::int AS n FROM platform_config WHERE org_id = $1`, [orgs.a.orgId]);
  expect(rows[0].n).toBe(1);
});

it('merges partial updates rather than replacing the config', async () => {
  await saveConfig(orgs.a.ctx, { agency_name: 'Alpha Consulting' });
  await saveConfig(orgs.a.ctx, { cta_style: '15-min call' });
  const cfg = await getConfig(orgs.a.ctx);
  expect(cfg.agency_name).toBe('Alpha Consulting');
  expect(cfg.cta_style).toBe('15-min call');
});

it('deduplicates active_sources', async () => {
  const saved = await saveConfig(orgs.a.ctx, { active_sources: ['linkedin', 'linkedin', 'job_board'] });
  expect(saved.active_sources).toEqual(['linkedin', 'job_board']);
});
