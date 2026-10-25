import { supabaseAdmin } from './supabaseAdmin';
import { createOrg } from '../scripts/create-org';
import type { AdminOrganization, CreateOrganizationInput } from '../../shared/types';

/**
 * Signal's own operators: listing and creating organizations across tenants.
 *
 * Every function here runs as service_role and sees every org, so the routes
 * that call it sit behind requirePlatformAdmin, which re-reads the flag from
 * the database on every request (a revoked operator loses access at once,
 * not when their token expires).
 */

export class PlatformAdminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PlatformAdminError';
  }
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('users').select('is_platform_admin, is_active').eq('id', userId).maybeSingle();
  if (error) throw new Error(`isPlatformAdmin: ${error.message}`);
  return Boolean(data?.is_platform_admin && data?.is_active);
}

export async function listOrganizations(): Promise<AdminOrganization[]> {
  const { data, error } = await supabaseAdmin.rpc('admin_org_overview');
  if (error) throw new Error(`listOrganizations: ${error.message}`);
  return ((data ?? []) as AdminOrganization[]).map(o => ({
    ...o, user_count: Number(o.user_count), lead_count: Number(o.lead_count),
  }));
}

/**
 * A new tenant: the org, its first admin and its settings row (createOrg,
 * which undoes itself on a partial failure), then its limits.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<AdminOrganization> {
  let orgId: string;
  try {
    ({ orgId } = await createOrg({
      name: input.name,
      slug: input.slug,
      agencyName: input.agency_name,
      adminName: input.admin_name,
      adminEmail: input.admin_email,
      adminPassword: input.admin_password,
    }));
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('already exists')) throw new PlatformAdminError(409, message);
    if (/must be|required/.test(message)) throw new PlatformAdminError(400, message);
    throw err;
  }

  const { error } = await supabaseAdmin.from('organizations').update({
    lead_quota_daily: input.lead_quota_daily,
    lead_quota_weekly: input.lead_quota_weekly,
    lead_quota_monthly: input.lead_quota_monthly,
    monthly_scrape_cap: input.monthly_scrape_cap,
  }).eq('id', orgId);
  if (error) {
    // The tenant exists and can log in; only its limits are missing. Say so
    // rather than pretend the whole creation failed.
    throw new PlatformAdminError(500, `Organization created, but setting its limits failed: ${error.message}`);
  }

  const created = (await listOrganizations()).find(o => o.id === orgId);
  if (!created) throw new Error('Organization created but not found');
  return created;
}
