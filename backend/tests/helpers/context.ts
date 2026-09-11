import jwt from 'jsonwebtoken';
import { createTenantContext } from '../../services/tenantContext';
import { supabaseAdmin } from '../../services/supabaseAdmin';
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
 * Build a TenantContext for a seeded org, for the isolation suites.
 *
 * DELIBERATELY NOT `createTenantContext`'s client. The brief specified
 * `return createTenantContext(orgId, userId)`, which mints an anon-key client
 * carrying a scoped JWT — the `authenticated` Postgres role. But RLS is
 * already ENABLED on all 12 org-scoped tables (supabase/schema.sql, "ROW
 * LEVEL SECURITY" section) and the only policies that exist so far are
 * `service_role_all`. Section H grants `authenticated` table privileges but
 * no policy admits it, so through that client every read returns [] and every
 * write is refused with "new row violates row-level security policy".
 *
 * That makes the scoped client useless as an isolation harness *today*: the
 * reads would pass vacuously (A cannot see B because A cannot see anything)
 * and the writes cannot run at all. The org_isolation policies that make the
 * scoped client work arrive in Task 14.
 *
 * A service-role client is the correct harness for what Task 7 actually
 * proves. Service role bypasses RLS entirely, so the database filters
 * nothing — the ONLY thing that can keep org A out of org B's rows is the
 * application-layer `.eq('org_id', ctx.orgId)` in supabaseService. An
 * unfiltered query here genuinely returns both orgs' rows, so these tests
 * fail if the app-layer filter is dropped. Through the scoped client they
 * would not.
 *
 * `orgId` still goes through `createTenantContext` so the OrgId branding and
 * validation on the real path are exercised; only `db` is swapped.
 *
 * When Task 14 lands, flipping this back to `createTenantContext`'s own
 * client should leave every assertion in tests/isolation/ green — at that
 * point they assert defence in depth rather than the app layer alone.
 */
export function makeTestContext(orgId: string, userId: string = ANY_USER): TenantContext {
  return { ...createTenantContext(orgId, userId), db: supabaseAdmin };
}
