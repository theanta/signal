import crypto from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { createOrg } from '../scripts/create-org';
import { revokeSessions, sendInvite } from './accountService';
import type {
  AdminOrganization, CreateOrganizationInput, CreateOrganizationResult, UpdateOrganizationInput,
} from '../../shared/types';

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
 * which undoes itself on a partial failure), then its limits. The admin is
 * invited by email, or given a temporary password; either way they choose
 * their own at first sign-in.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  if (input.admin_mode === 'password' && (input.admin_password ?? '').length < 12) {
    throw new PlatformAdminError(400, 'Admin password must be at least 12 characters');
  }
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await createOrg({
      name: input.name,
      slug: input.slug,
      agencyName: input.agency_name,
      adminName: input.admin_name,
      adminEmail: input.admin_email,
      // Invited: a random password nobody knows until the admin sets theirs.
      adminPassword: input.admin_mode === 'password' ? input.admin_password! : crypto.randomBytes(32).toString('hex'),
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
    // The tenant exists; only its limits are missing. Say so rather than
    // pretend the whole creation failed.
    throw new PlatformAdminError(500, `Organization created, but setting its limits failed: ${error.message}`);
  }
  await supabaseAdmin.from('users').update({ must_change_password: true }).eq('id', userId);

  const organization = await getOrganization(orgId);
  if (input.admin_mode === 'password') return { organization, email_sent: false };
  const invite = await sendInvite(
    { id: userId, email: input.admin_email.toLowerCase().trim(), name: input.admin_name.trim() }, organization.name,
  );
  return { organization, ...invite };
}

export async function getOrganization(orgId: string): Promise<AdminOrganization> {
  const org = (await listOrganizations()).find(o => o.id === orgId);
  if (!org) throw new PlatformAdminError(404, 'Organization not found');
  return org;
}

/**
 * Change an org's name, limits or status. Suspending ends every session of
 * its users now, and sign-in stays blocked until it is reactivated. A
 * platform admin cannot suspend their own org (they would lock themselves out).
 */
export async function updateOrganization(
  orgId: string, actorOrgId: string, patch: UpdateOrganizationInput,
): Promise<AdminOrganization> {
  await getOrganization(orgId);
  if (patch.status === 'suspended' && orgId === actorOrgId) {
    throw new PlatformAdminError(400, 'You cannot suspend your own organization');
  }
  const { error } = await supabaseAdmin.from('organizations').update(patch).eq('id', orgId);
  if (error) throw new Error(`updateOrganization: ${error.message}`);
  if (patch.status === 'suspended') {
    const { data: users } = await supabaseAdmin.from('users').select('id').eq('org_id', orgId);
    await revokeSessions((users ?? []).map(u => u.id as string));
  }
  return getOrganization(orgId);
}
