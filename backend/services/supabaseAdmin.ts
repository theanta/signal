import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * The one service-role client in the process.
 *
 * Service-role bypasses RLS entirely, so this client sees every tenant's rows.
 * It exists for the three jobs that legitimately have no tenant context:
 * authentication (finding a user before an org is known), the cron runner
 * (iterating orgs), and engine callbacks. Everything else goes through a
 * TenantContext.
 *
 * The ESLint no-restricted-imports rule in .eslintrc.cjs keeps controllers and
 * routes from importing this. Widen that rule only with a reason.
 */
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
