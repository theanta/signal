import type { TenantContext } from './tenantContext';
import {
  createUserInOrg, InviteOutcome, MEMBER_COLUMNS, resendInvite, updateMember,
} from './accountService';
import type { AddTeamMemberInput, AddTeamMemberResult, TeamMember, UserRole } from '../../shared/types';

/**
 * An organization's own users. Listing goes through the tenant's scoped
 * client (RLS: own org only, no password hashes). Changes go through
 * accountService with the caller's own org — from the verified token, never
 * from the request.
 */

export { AccountError as TeamError } from './accountService';

export async function listTeam(ctx: TenantContext): Promise<TeamMember[]> {
  const { data, error } = await ctx.db
    .from('users').select(MEMBER_COLUMNS).eq('org_id', ctx.orgId).order('created_at');
  if (error) throw new Error(`listTeam: ${error.message}`);
  return (data ?? []) as TeamMember[];
}

export function addTeamMember(
  ctx: TenantContext, input: AddTeamMemberInput, invitedBy?: string,
): Promise<AddTeamMemberResult> {
  return createUserInOrg(ctx.orgId, input, invitedBy);
}

export function updateTeamMember(
  ctx: TenantContext, memberId: string, patch: { role?: UserRole; is_active?: boolean },
): Promise<TeamMember> {
  return updateMember(ctx.orgId, ctx.userId, memberId, patch);
}

export function resendTeamInvite(ctx: TenantContext, memberId: string, invitedBy?: string): Promise<InviteOutcome> {
  return resendInvite(ctx.orgId, memberId, invitedBy);
}
