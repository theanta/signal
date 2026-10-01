import bcrypt from 'bcryptjs';
import { afterAll, afterEach, expect, it } from 'vitest';
import { createOrg } from '../../scripts/create-org';
import { createTenantContext } from '../../services/tenantContext';
import { getConfig } from '../../services/configService';
import { closePool, sql } from '../helpers/db';

const SLUG = 'partner-one';
const EMAIL = 'admin@partner-one.test';

async function cleanup() {
  await sql(`DELETE FROM platform_config WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)`, [SLUG]);
  await sql(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  await sql(`DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)`, [SLUG]);
  await sql(`DELETE FROM organizations WHERE slug = $1`, [SLUG]);
}

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

const INPUT = {
  name: 'Partner One',
  slug: SLUG,
  adminEmail: EMAIL,
  adminName: 'Partner Admin',
  adminPassword: 'a-long-enough-password',
  agencyName: 'Partner One Consulting',
};

it('creates the org, an admin user and a config row', async () => {
  const { orgId, userId } = await createOrg(INPUT);

  const org = await sql(`SELECT slug, status, monthly_scrape_cap FROM organizations WHERE id = $1`, [orgId]);
  expect(org.rows[0]).toMatchObject({ slug: SLUG, status: 'active', monthly_scrape_cap: 100 });

  const user = await sql(`SELECT email, role, org_id, password_hash FROM users WHERE id = $1`, [userId]);
  expect(user.rows[0].role).toBe('admin');
  expect(user.rows[0].org_id).toBe(orgId);
  expect(await bcrypt.compare(INPUT.adminPassword, user.rows[0].password_hash)).toBe(true);

  const cfg = await sql(`SELECT config FROM platform_config WHERE org_id = $1`, [orgId]);
  expect(cfg.rows).toHaveLength(1);
  expect(cfg.rows[0].config.agency_name).toBe('Partner One Consulting');
});

it('leaves the partner seeing their own identity through the real scoped path', async () => {
  const { orgId, userId } = await createOrg(INPUT);
  const cfg = await getConfig(createTenantContext(orgId, userId));
  expect(cfg.agency_name).toBe('Partner One Consulting');
});

it('never stores the password in plaintext', async () => {
  const { userId } = await createOrg(INPUT);
  const user = await sql(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  expect(user.rows[0].password_hash).not.toContain(INPUT.adminPassword);
});

it('refuses a duplicate slug rather than adopting the existing org', async () => {
  await createOrg(INPUT);
  await expect(createOrg({ ...INPUT, adminEmail: 'other@partner-one.test' })).rejects.toThrow(/slug/i);
  await sql(`DELETE FROM users WHERE email = 'other@partner-one.test'`);
});

it('refuses an email that already belongs to a user, and creates no org', async () => {
  await sql(`INSERT INTO organizations (name, slug) VALUES ('Squatter', 'squatter-org')`);
  await sql(
    `INSERT INTO users (email, password_hash, name, role, org_id)
     SELECT $1, 'x', 'Existing', 'admin', id FROM organizations WHERE slug = 'squatter-org'`, [EMAIL]);
  try {
    await expect(createOrg(INPUT)).rejects.toThrow(/email/i);
    const { rows } = await sql(`SELECT COUNT(*)::int AS n FROM organizations WHERE slug = $1`, [SLUG]);
    expect(rows[0].n).toBe(0);
  } finally {
    await sql(`DELETE FROM users WHERE email = $1`, [EMAIL]);
    await sql(`DELETE FROM organizations WHERE slug = 'squatter-org'`);
  }
});

it('rejects a password shorter than 12 characters', async () => {
  await expect(createOrg({ ...INPUT, adminPassword: 'short' })).rejects.toThrow(/12/);
});

it('rejects a slug that is not lowercase-hyphenated', async () => {
  await expect(createOrg({ ...INPUT, slug: 'Partner One' })).rejects.toThrow(/slug/i);
});
