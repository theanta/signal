import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantContext } from '../../services/tenantContext';
import { sql, closePool } from '../helpers/db';
import { scopedTokenOf } from '../helpers/context';

let orgId: string;
let userId: string;

beforeAll(async () => {
  const org = await sql(
    `INSERT INTO organizations (name, slug) VALUES ('Ctx Org', 'ctx-org')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  orgId = org.rows[0].id;
  const user = await sql(
    `INSERT INTO users (email, password_hash, name, org_id)
     VALUES ('ctx@example.test', 'x', 'Ctx', $1)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [orgId],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await sql(`DELETE FROM users WHERE email = 'ctx@example.test'`);
  await sql(`DELETE FROM organizations WHERE slug = 'ctx-org'`);
  await closePool();
});

describe('createTenantContext', () => {
  it('rejects an orgId that is not a UUID', () => {
    expect(() => createTenantContext('nope', userId)).toThrow(/OrgId/);
  });

  it('returns a context whose orgId is the one asked for', () => {
    const ctx = createTenantContext(orgId, userId);
    expect(ctx.orgId).toBe(orgId);
    expect(ctx.userId).toBe(userId);
  });

  it('gives the client a JWT whose org_id claim matches ctx.orgId', () => {
    const ctx = createTenantContext(orgId, userId);
    const token = scopedTokenOf(ctx);
    const claims = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as Record<string, unknown>;
    expect(claims.org_id).toBe(orgId);
    expect(claims.role).toBe('authenticated');
    expect(claims.sub).toBe(userId);
  });

  it('gives that JWT a short life', () => {
    const ctx = createTenantContext(orgId, userId);
    const claims = jwt.decode(scopedTokenOf(ctx)) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  // `leads`, not `organizations`: Section H of the tenancy migration grants
  // the `authenticated` role DML on the twelve org-scoped tables only.
  // `organizations` has no RLS yet, so granting SELECT on it would let any
  // logged-in user read every tenant's row — it gets its grant alongside its
  // policy in Task 14. `leads` proves the same thing this test is for: the
  // scoped token is accepted, and the request reaches the table as
  // `authenticated` rather than being refused at the schema.
  it('can actually read through PostgREST with that token', async () => {
    const ctx = createTenantContext(orgId, userId);
    const { data, error } = await ctx.db.from('leads').select('id').limit(1);
    expect(error).toBeNull();
    // Until Task 14 the only policy is service_role_all, so an authenticated
    // request is authorized to ask and entitled to nothing. That is the
    // pre-RLS state this task must leave behind, asserted rather than assumed.
    expect(data).toEqual([]);
  });

  it('does not mint a context for a malformed org id', () => {
    expect(() => createTenantContext('', userId)).toThrow(/OrgId/);
    expect(() => createTenantContext('../../etc/passwd', userId)).toThrow(/OrgId/);
    expect(() => createTenantContext(`${orgId} OR 1=1`, userId)).toThrow(/OrgId/);
  });
});
