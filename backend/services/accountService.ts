import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { appUrl, inviteEmail, sendEmail } from './emailService';
import type { AddTeamMemberInput, TeamMember, UserRole } from '../../shared/types';

/**
 * User accounts across orgs: creating users, invite links, password changes
 * and ending sessions. Runs as service_role (tenant sessions can never write
 * users). Callers decide the org: a tenant route passes its own ctx.orgId, a
 * platform admin route the org it is managing — never a value from a request
 * body.
 */

export class AccountError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

export const MIN_PASSWORD_LENGTH = 12;
const INVITE_DAYS = 7;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const MEMBER_COLUMNS = 'id, email, name, role, is_active, must_change_password, last_login, created_at';

export interface InviteOutcome {
  /** Whether the invite email went out. */
  email_sent: boolean;
  /** Only when it did not (email not set up): the link, for the admin to pass on. */
  invite_url?: string;
}

/** End every session of these users: their refresh tokens stop working now. */
export async function revokeSessions(userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  const { error } = await supabaseAdmin.from('refresh_tokens').delete().in('user_id', userIds);
  if (error) throw new Error(`revokeSessions: ${error.message}`);
}

/** A fresh one-time link; any earlier unused link for the user stops working. */
async function issuePasswordLink(userId: string): Promise<string> {
  await supabaseAdmin.from('password_tokens').delete().eq('user_id', userId).is('used_at', null);
  const raw = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await supabaseAdmin.from('password_tokens').insert({
    user_id: userId, token_hash: sha256(raw), purpose: 'invite', expires_at: expires.toISOString(),
  });
  if (error) throw new Error(`issuePasswordLink: ${error.message}`);
  return `${appUrl()}/set-password?token=${raw}`;
}

export async function sendInvite(
  user: { id: string; email: string; name: string }, orgName: string, invitedBy?: string,
): Promise<InviteOutcome> {
  const url = await issuePasswordLink(user.id);
  const sent = await sendEmail({ to: user.email, ...inviteEmail({ name: user.name, orgName, invitedBy, url }) });
  if (!sent) {
    console.log(`[invite] Email not sent (RESEND_API_KEY not set or refused). Link for ${user.email}: ${url}`);
    return { email_sent: false, invite_url: url };
  }
  return { email_sent: true };
}

async function orgName(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('organizations').select('name').eq('id', orgId).single();
  return (data?.name as string | undefined) ?? 'your organization';
}

/**
 * Add a user to an org. Either way they must choose their own password:
 * 'invite' emails them a link (no one else ever knows a password), 'password'
 * sets a temporary one the admin passes on, to be changed at first sign-in.
 */
export async function createUserInOrg(
  orgId: string, input: AddTeamMemberInput, invitedBy?: string,
): Promise<{ member: TeamMember } & InviteOutcome> {
  const email = input.email.toLowerCase().trim();
  const { data: taken, error: lookupError } = await supabaseAdmin
    .from('users').select('id').eq('email', email).maybeSingle();
  if (lookupError) throw new Error(`createUserInOrg: ${lookupError.message}`);
  // Emails are globally unique (one org per user); the message does not say whose.
  if (taken) throw new AccountError(409, 'A user with that email already exists');

  if (input.mode === 'password' && (input.password ?? '').length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  // An invited user gets a random password nobody knows until they set theirs.
  const password = input.mode === 'password' ? input.password! : crypto.randomBytes(32).toString('hex');

  const { data, error } = await supabaseAdmin.from('users').insert({
    org_id: orgId,
    email,
    name: input.name.trim(),
    role: input.role,
    password_hash: await bcrypt.hash(password, 12),
    must_change_password: true,
  }).select(MEMBER_COLUMNS).single();
  if (error) throw new Error(`createUserInOrg: ${error.message}`);
  const member = data as TeamMember;

  if (input.mode === 'password') return { member, email_sent: false };
  return { member, ...(await sendInvite(member, await orgName(orgId), invitedBy)) };
}

export async function listOrgMembers(orgId: string): Promise<TeamMember[]> {
  const { data, error } = await supabaseAdmin
    .from('users').select(MEMBER_COLUMNS).eq('org_id', orgId).order('created_at');
  if (error) throw new Error(`listOrgMembers: ${error.message}`);
  return (data ?? []) as TeamMember[];
}

async function memberOf(orgId: string, memberId: string): Promise<TeamMember> {
  const { data, error } = await supabaseAdmin
    .from('users').select(MEMBER_COLUMNS).eq('id', memberId).eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`memberOf: ${error.message}`);
  if (!data) throw new AccountError(404, 'User not found');
  return data as TeamMember;
}

/**
 * Change a member's role or access. An org always keeps at least one active
 * admin, and an admin cannot demote or deactivate themselves (so nobody
 * locks themselves out by accident). Deactivation ends their sessions now.
 */
export async function updateMember(
  orgId: string, actorId: string | null, memberId: string,
  patch: { role?: UserRole; is_active?: boolean },
): Promise<TeamMember> {
  const member = await memberOf(orgId, memberId);
  if (actorId === memberId) throw new AccountError(400, 'You cannot change your own role or access');

  const losesAdmin = member.role === 'admin' && member.is_active
    && (patch.role === 'member' || patch.is_active === false);
  if (losesAdmin) {
    const { count } = await supabaseAdmin.from('users').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('role', 'admin').eq('is_active', true).neq('id', memberId);
    if (!count) throw new AccountError(400, 'An organization needs at least one active admin');
  }

  const { data, error } = await supabaseAdmin.from('users').update(patch)
    .eq('id', memberId).eq('org_id', orgId).select(MEMBER_COLUMNS).single();
  if (error) throw new Error(`updateMember: ${error.message}`);
  if (patch.is_active === false) await revokeSessions([memberId]);
  return data as TeamMember;
}

/** A new invite link for someone who has not set their password yet. */
export async function resendInvite(orgId: string, memberId: string, invitedBy?: string): Promise<InviteOutcome> {
  const member = await memberOf(orgId, memberId);
  if (!member.must_change_password || member.last_login) {
    throw new AccountError(400, 'This user has already set their password');
  }
  if (!member.is_active) throw new AccountError(400, 'Reactivate this user before inviting them again');
  return sendInvite(member, await orgName(orgId), invitedBy);
}

// ---- links and passwords (the user themselves) ----

async function findLink(raw: string) {
  const { data } = await supabaseAdmin.from('password_tokens')
    .select('id, user_id, expires_at, used_at, users(email, name, is_active, organizations(name, status))')
    .eq('token_hash', sha256(raw)).maybeSingle();
  const row = data as unknown as {
    id: string; user_id: string; expires_at: string; used_at: string | null;
    users: { email: string; name: string; is_active: boolean; organizations: { name: string; status: string } };
  } | null;
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
  if (!row.users?.is_active || row.users.organizations?.status !== 'active') return null;
  return row;
}

/** What the set-password page shows, or null for a bad, used or expired link. */
export async function describeLink(raw: string): Promise<{ email: string; name: string; org_name: string } | null> {
  const row = await findLink(raw);
  return row ? { email: row.users.email, name: row.users.name, org_name: row.users.organizations.name } : null;
}

/** Use a link: set the password, once. Returns the user id to sign in. */
export async function setPasswordWithLink(raw: string, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const row = await findLink(raw);
  if (!row) throw new AccountError(400, 'This link is invalid or has expired. Ask your admin for a new invite.');
  // Mark used first and only if still unused, so the same link cannot be spent twice.
  const { data: claimed } = await supabaseAdmin.from('password_tokens')
    .update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id');
  if (!claimed?.length) throw new AccountError(400, 'This link has already been used');
  const { error } = await supabaseAdmin.from('users')
    .update({ password_hash: await bcrypt.hash(password, 12), must_change_password: false })
    .eq('id', row.user_id);
  if (error) throw new Error(`setPasswordWithLink: ${error.message}`);
  return row.user_id;
}

/** The signed-in user changes their password; every other session ends. */
export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  if (next.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (next === current) throw new AccountError(400, 'Choose a password different from the current one');
  const { data: user } = await supabaseAdmin.from('users').select('password_hash').eq('id', userId).single();
  if (!user || !(await bcrypt.compare(current, user.password_hash as string))) {
    throw new AccountError(400, 'Current password is incorrect');
  }
  const { error } = await supabaseAdmin.from('users')
    .update({ password_hash: await bcrypt.hash(next, 12), must_change_password: false }).eq('id', userId);
  if (error) throw new Error(`changePassword: ${error.message}`);
  await revokeSessions([userId]);
}
