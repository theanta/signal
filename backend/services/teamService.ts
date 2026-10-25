import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabaseAdmin';
import type { TenantContext } from './tenantContext';
import type { AddTeamMemberInput, TeamMember } from '../../shared/types';

/**
 * An organization's own users. Members are listed through the tenant's
 * scoped client (RLS: own org only, no password hashes). Adding one needs
 * service_role, because tenant sessions can never write users; the new user's
 * org is the caller's, from the verified token, never from the request.
 */

export class TeamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'TeamError';
  }
}

const MEMBER_COLUMNS = 'id, email, name, role, is_active, last_login, created_at';

export async function listTeam(ctx: TenantContext): Promise<TeamMember[]> {
  const { data, error } = await ctx.db
    .from('users').select(MEMBER_COLUMNS).eq('org_id', ctx.orgId).order('created_at');
  if (error) throw new Error(`listTeam: ${error.message}`);
  return (data ?? []) as TeamMember[];
}

export async function addTeamMember(ctx: TenantContext, input: AddTeamMemberInput): Promise<TeamMember> {
  const email = input.email.toLowerCase().trim();
  const { data: taken, error: lookupError } = await supabaseAdmin
    .from('users').select('id').eq('email', email).maybeSingle();
  if (lookupError) throw new Error(`addTeamMember: ${lookupError.message}`);
  // Emails are globally unique (one org per user). The message does not say
  // which org has it.
  if (taken) throw new TeamError(409, 'A user with that email already exists');

  const { data, error } = await supabaseAdmin.from('users').insert({
    org_id: ctx.orgId,
    email,
    name: input.name.trim(),
    role: input.role,
    password_hash: await bcrypt.hash(input.password, 12),
  }).select(MEMBER_COLUMNS).single();
  if (error) throw new Error(`addTeamMember: ${error.message}`);
  return data as TeamMember;
}
