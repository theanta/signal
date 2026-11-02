import crypto from 'crypto';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { refresh } from '../../controllers/authController';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;
const RAW = crypto.randomBytes(32).toString('hex');
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

beforeAll(async () => {
  orgs = await seedTwoOrgs();
  await sql(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + interval '30 days')`,
    [orgs.a.userId, hash(RAW)]);
});
afterAll(async () => {
  await teardownSeed();
  await closePool();
});

async function callRefresh(raw: string) {
  const out: { status: number; cookie?: string } = { status: 200 };
  const res = {
    status(code: number) { out.status = code; return this; },
    json() { return this; },
    cookie(_name: string, value: string) { out.cookie = value; return this; },
    clearCookie() { return this; },
  } as unknown as Response;
  await refresh({ cookies: { refreshToken: raw } } as unknown as Request, res);
  return out;
}

it('a refresh whose response was lost does not sign the user out', async () => {
  // Two refreshes with the same cookie: a cancelled request, or two tabs at once.
  const first = await callRefresh(RAW);
  const second = await callRefresh(RAW);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.cookie).toBeTruthy();
  expect(first.cookie).not.toBe(second.cookie);

  // The old token is only kept for the grace window, not its old 30 days.
  const old = await sql(`SELECT expires_at FROM refresh_tokens WHERE token_hash = $1`, [hash(RAW)]);
  expect(new Date(old.rows[0].expires_at).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
});

it('a suspended org cannot refresh', async () => {
  await sql(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [orgs.a.orgId]);
  try {
    expect((await callRefresh(RAW)).status).toBe(401);
  } finally {
    await sql(`UPDATE organizations SET status = 'active' WHERE id = $1`, [orgs.a.orgId]);
  }
});
