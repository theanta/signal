import { afterAll, beforeAll, expect, it } from 'vitest';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

// The engine upserts jobs ON CONFLICT (org_id, external_id). These pin the
// constraint that makes that both legal and per-tenant.

let orgs: TwoOrgs;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

const insertJob = (orgId: string, externalId: string) => sql(
  `INSERT INTO jobs (company_name, job_title, status, external_id, org_id)
   VALUES ('Board Co', 'Engineer', 'new', $1, $2) RETURNING id`,
  [externalId, orgId],
);

it('lets two tenants hold the same posting', async () => {
  await insertJob(orgs.a.orgId, 'shared-posting');
  await expect(insertJob(orgs.b.orgId, 'shared-posting')).resolves.toBeTruthy();
});

it('still rejects the same posting twice within one tenant', async () => {
  await insertJob(orgs.a.orgId, 'dup-posting');
  await expect(insertJob(orgs.a.orgId, 'dup-posting')).rejects.toThrow(/jobs_org_external_id_key/);
});

it('accepts ON CONFLICT (org_id, external_id) as an upsert arbiter', async () => {
  await insertJob(orgs.a.orgId, 'upsert-posting');
  await sql(
    `INSERT INTO jobs (company_name, job_title, status, external_id, org_id)
     VALUES ('Board Co', 'Senior Engineer', 'new', 'upsert-posting', $1)
     ON CONFLICT (org_id, external_id) DO UPDATE SET job_title = EXCLUDED.job_title`,
    [orgs.a.orgId],
  );
  const { rows } = await sql(
    `SELECT job_title FROM jobs WHERE org_id = $1 AND external_id = 'upsert-posting'`, [orgs.a.orgId]);
  expect(rows).toEqual([{ job_title: 'Senior Engineer' }]);
});
