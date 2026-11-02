import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import { recordUsage } from '../../services/usageService';
import type { TenantContext } from '../../services/tenantContext';

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

describe('recordUsage', () => {
  it('writes one row in the tenant’s org', async () => {
    await recordUsage(orgs.a.ctx, { provider: 'groq', operation: 'cold_email', units: 812 });
    const { rows } = await sql(
      `SELECT org_id, provider, operation, units FROM usage_events WHERE operation = 'cold_email'`);
    expect(rows).toEqual([{ org_id: orgs.a.orgId, provider: 'groq', operation: 'cold_email', units: 812 }]);
  });

  it('never throws when the write fails', async () => {
    const broken = {
      ...orgs.a.ctx,
      db: { from: () => { throw new Error('db down'); } },
    } as unknown as TenantContext;
    await expect(recordUsage(broken, { provider: 'groq', operation: 'x', units: 1 })).resolves.toBeUndefined();
  });

  it('rejects an unknown provider at the database, without throwing', async () => {
    await recordUsage(orgs.a.ctx, { provider: 'openai' as never, operation: 'bad-provider', units: 1 });
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM usage_events WHERE operation = 'bad-provider'`);
    expect(rows[0].n).toBe(0);
  });
});
