import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { asOrgId } from '../../shared/types';
import type { OrgId } from '../../shared/types';

/**
 * Everything a request needs to touch tenant data, as one value.
 *
 * The org id and the client travel together deliberately: `db` already carries
 * a JWT whose `org_id` claim equals `orgId`, so app-layer filter and RLS policy
 * cannot be given different orgs by a caller who threads one and forgets the
 * other.
 */
export interface TenantContext {
  orgId: OrgId;
  userId: string;
  db: SupabaseClient;
}

const SCOPED_TOKEN_TTL_SECONDS = 300;

/**
 * Mint a request-scoped context.
 *
 * The token signed here is NOT the login token. It is a Supabase-compatible
 * JWT signed with SUPABASE_JWT_SECRET so PostgREST accepts the request as the
 * `authenticated` role and the org_isolation RLS policies can read its org_id
 * claim. It never leaves the server and lives five minutes.
 *
 * Called by the auth middleware and by scripts. Nothing else should call it —
 * an org id from a request body is not an authenticated org id.
 */
export function createTenantContext(orgId: string, userId: string): TenantContext {
  const branded = asOrgId(orgId);

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!url || !anonKey || !jwtSecret) {
    throw new Error(
      'Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_JWT_SECRET — ' +
      'cannot mint an org-scoped database client.',
    );
  }

  const token = jwt.sign(
    { sub: userId, org_id: branded, role: 'authenticated', aud: 'authenticated' },
    jwtSecret,
    { expiresIn: SCOPED_TOKEN_TTL_SECONDS },
  );

  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return { orgId: branded, userId, db };
}
