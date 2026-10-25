import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  createOrganization, isPlatformAdmin, listOrganizations, PlatformAdminError,
} from '../../services/platformAdminService';
import { requirePlatformAdmin } from '../../api/middleware/platformAdmin';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import { DEFAULT_ORG_LIMITS } from '../../../shared/types';

const SLUG = 'admin-made-org';
const EMAIL = 'owner@admin-made-org.test';
let orgs: TwoOrgs;

async function cleanup() {
  await sql(`DELETE FROM platform_config WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)`, [SLUG]);
  await sql(`DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)`, [SLUG]);
  await sql(`DELETE FROM organizations WHERE slug = $1`, [SLUG]);
}

const INPUT = {
  name: 'Admin Made', slug: SLUG, agency_name: 'Admin Made Agency',
  admin_name: 'Owner', admin_email: EMAIL, admin_password: 'a-long-enough-password',
  ...DEFAULT_ORG_LIMITS,
};

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await teardownSeed();
  await closePool();
});

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('requirePlatformAdmin', () => {
  it('turns away an org admin who is not a platform admin', async () => {
    const res = mockRes();
    const next = vi.fn();
    await requirePlatformAdmin({ user: { sub: orgs.a.userId } } as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('lets a platform admin through, and stops them the moment the flag is removed', async () => {
    await sql(`UPDATE users SET is_platform_admin = true WHERE id = $1`, [orgs.a.userId]);
    try {
      const next = vi.fn();
      await requirePlatformAdmin({ user: { sub: orgs.a.userId } } as Request, mockRes(), next);
      expect(next).toHaveBeenCalled();
    } finally {
      await sql(`UPDATE users SET is_platform_admin = false WHERE id = $1`, [orgs.a.userId]);
    }
    expect(await isPlatformAdmin(orgs.a.userId)).toBe(false);
  });
});

describe('organizations', () => {
  it('creates the org, its admin, its settings and its limits, and lists it', async () => {
    const created = await createOrganization(INPUT);
    expect(created).toMatchObject({
      slug: SLUG, name: 'Admin Made', user_count: 1, lead_count: 0,
      lead_quota_daily: 20, lead_quota_weekly: 100, lead_quota_monthly: 400, monthly_scrape_cap: 60,
    });
    const admin = await sql(`SELECT role, org_id FROM users WHERE email = $1`, [EMAIL]);
    expect(admin.rows[0]).toMatchObject({ role: 'admin', org_id: created.id });
    const config = await sql(`SELECT config FROM platform_config WHERE org_id = $1`, [created.id]);
    expect(config.rows[0].config.agency_name).toBe('Admin Made Agency');

    const all = await listOrganizations();
    expect(all.map(o => o.slug)).toEqual(expect.arrayContaining([SLUG, 'iso-org-a', 'iso-org-b']));
  });

  it('refuses a slug or admin email that is already taken, with 409', async () => {
    await createOrganization(INPUT);
    await expect(createOrganization({ ...INPUT, admin_email: 'other@x.test' }))
      .rejects.toMatchObject({ status: 409 } satisfies Partial<PlatformAdminError>);
    await expect(createOrganization({ ...INPUT, slug: 'another-slug', admin_email: EMAIL }))
      .rejects.toMatchObject({ status: 409 });
  });
});
