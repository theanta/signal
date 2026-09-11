import jwt from 'jsonwebtoken';
import { createTenantContext } from '../../services/tenantContext';
import type { TenantContext } from '../../services/tenantContext';

const ANY_USER = '00000000-0000-0000-0000-0000000000ff';

/**
 * Pull the scoped JWT off a TenantContext's Supabase client.
 *
 * The task brief assumed `client.rest.headers` was a plain
 * `Record<string, string>`. In the version of supabase-js this repo pins
 * (2.106.2) it is a WHATWG `Headers` instance, so an index access returns
 * `undefined` and every claim assertion fails with a misleading
 * "cannot read properties of undefined". Handle both shapes so this helper
 * survives a version bump in either direction.
 *
 * Test-only. Nothing in the app should ever read this token back out — it is
 * minted, attached and forgotten.
 */
export function scopedTokenOf(ctx: TenantContext): string {
  const headers = (ctx.db as unknown as { rest: { headers: unknown } }).rest.headers;

  let header: string | null | undefined;
  if (typeof (headers as Headers)?.get === 'function') {
    header = (headers as Headers).get('Authorization');
  } else {
    header = (headers as Record<string, string>)['Authorization'];
  }

  if (!header) {
    throw new Error('No Authorization header on the tenant client');
  }
  return header.replace('Bearer ', '');
}

/**
 * Sign a LOGIN token — the one the browser holds, signed with JWT_SECRET.
 *
 * Deliberately NOT the scoped token: this is what a client presents to
 * `authenticate`, which is the only thing allowed to turn it into a
 * TenantContext. `claims` is spread last so a test can omit `org_id`
 * (`{ org_id: undefined }`) to simulate a pre-cutover session.
 */
export function signLoginToken(claims: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    sub: '00000000-0000-4000-8000-000000000001',
    email: 'ctx@example.test',
    name: 'Ctx',
    role: 'member',
    ...claims,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
}

/**
 * Build a TenantContext for a seeded org.
 *
 * `userId` defaults to a fixed sentinel for tests that only care which org
 * they are acting as.
 */
export function makeTestContext(orgId: string, userId: string = ANY_USER): TenantContext {
  return createTenantContext(orgId, userId);
}
