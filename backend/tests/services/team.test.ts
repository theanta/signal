import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addTeamMember, listTeam, resendTeamInvite, updateTeamMember,
} from '../../services/teamService';
import {
  changePassword, describeLink, setPasswordWithLink,
} from '../../services/accountService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;
const NEW_EMAIL = 'new.member@iso-org-a.test';
const INVITED = 'invited@iso-org-a.test';

const tokenOf = (url?: string) => new URL(url!).searchParams.get('token')!;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});
beforeEach(async () => {
  await sql(`DELETE FROM users WHERE email IN ($1, $2)`, [NEW_EMAIL, INVITED]);
});
afterAll(async () => {
  await sql(`DELETE FROM users WHERE email IN ($1, $2)`, [NEW_EMAIL, INVITED]);
  await teardownSeed();
  await closePool();
});

describe('team', () => {
  it('lists only the caller’s own org, without password hashes', async () => {
    const team = await listTeam(orgs.a.ctx);
    expect(team.map(m => m.id)).toContain(orgs.a.userId);
    expect(team.map(m => m.id)).not.toContain(orgs.b.userId);
    expect(team[0]).not.toHaveProperty('password_hash');
  });

  it('adds a member with a temporary password that must be changed', async () => {
    const { member } = await addTeamMember(orgs.a.ctx, {
      name: 'New Member', email: ' New.Member@iso-org-a.test ', role: 'member', mode: 'password', password: 'temporary-password-1',
    });
    expect(member).toMatchObject({ email: NEW_EMAIL, role: 'member', is_active: true, must_change_password: true });
    const row = await sql(`SELECT org_id, password_hash FROM users WHERE email = $1`, [NEW_EMAIL]);
    expect(row.rows[0].org_id).toBe(orgs.a.orgId);
    expect(row.rows[0].password_hash).not.toContain('temporary-password-1');
  });

  it('refuses an email that already exists, with 409', async () => {
    await addTeamMember(orgs.a.ctx, { name: 'N', email: NEW_EMAIL, role: 'member', mode: 'password', password: 'temporary-password-1' });
    await expect(addTeamMember(orgs.b.ctx, {
      name: 'Dup', email: NEW_EMAIL, role: 'member', mode: 'password', password: 'temporary-password-1',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('changes a role and deactivates, ending the member’s sessions', async () => {
    const { member } = await addTeamMember(orgs.a.ctx, { name: 'N', email: NEW_EMAIL, role: 'member', mode: 'password', password: 'temporary-password-1' });
    await sql(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, 'h-new-member', NOW() + interval '1 day')`, [member.id]);
    expect((await updateTeamMember(orgs.a.ctx, member.id, { role: 'admin' })).role).toBe('admin');
    expect((await updateTeamMember(orgs.a.ctx, member.id, { is_active: false })).is_active).toBe(false);
    const left = await sql(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1`, [member.id]);
    expect(left.rows[0].n).toBe(0);
  });

  it('will not change yourself, a user of another org, or the last active admin', async () => {
    await expect(updateTeamMember(orgs.a.ctx, orgs.a.userId, { role: 'member' })).rejects.toMatchObject({ status: 400 });
    await expect(updateTeamMember(orgs.a.ctx, orgs.b.userId, { is_active: false })).rejects.toMatchObject({ status: 404 });
    // Org A's only admin, changed by another admin who is then the only one left... is still guarded:
    const { member: other } = await addTeamMember(orgs.a.ctx, { name: 'N', email: NEW_EMAIL, role: 'admin', mode: 'password', password: 'temporary-password-1' });
    const asOther = { ...orgs.a.ctx, userId: other.id };
    await sql(`UPDATE users SET role = 'member' WHERE id = $1`, [other.id]);
    await expect(updateTeamMember(asOther, orgs.a.userId, { role: 'member' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('invites and passwords', () => {
  it('an invite link sets the password once, then stops working', async () => {
    const { member, email_sent, invite_url } = await addTeamMember(orgs.a.ctx, {
      name: 'Invited', email: INVITED, role: 'member', mode: 'invite',
    }, 'Alpha Admin');
    expect(email_sent).toBe(false);
    expect(member.must_change_password).toBe(true);
    const token = tokenOf(invite_url);
    expect(await describeLink(token)).toMatchObject({ email: INVITED, name: 'Invited', org_name: 'Alpha' });

    await expect(setPasswordWithLink(token, 'short')).rejects.toMatchObject({ status: 400 });
    expect(await setPasswordWithLink(token, 'my-own-password-1')).toBe(member.id);
    const row = await sql(`SELECT must_change_password FROM users WHERE id = $1`, [member.id]);
    expect(row.rows[0].must_change_password).toBe(false);
    expect(await describeLink(token)).toBeNull();
    await expect(setPasswordWithLink(token, 'another-password-1')).rejects.toMatchObject({ status: 400 });
  });

  it('resending replaces the old link', async () => {
    const first = await addTeamMember(orgs.a.ctx, { name: 'Invited', email: INVITED, role: 'member', mode: 'invite' });
    const second = await resendTeamInvite(orgs.a.ctx, first.member.id);
    expect(await describeLink(tokenOf(first.invite_url))).toBeNull();
    expect(await describeLink(tokenOf(second.invite_url))).not.toBeNull();
  });

  it('a link stops working while the org is suspended', async () => {
    const { invite_url } = await addTeamMember(orgs.a.ctx, { name: 'Invited', email: INVITED, role: 'member', mode: 'invite' });
    await sql(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [orgs.a.orgId]);
    try {
      expect(await describeLink(tokenOf(invite_url))).toBeNull();
    } finally {
      await sql(`UPDATE organizations SET status = 'active' WHERE id = $1`, [orgs.a.orgId]);
    }
  });

  it('changing a password needs the current one and clears the flag', async () => {
    const { member } = await addTeamMember(orgs.a.ctx, { name: 'N', email: NEW_EMAIL, role: 'member', mode: 'password', password: 'temporary-password-1' });
    await expect(changePassword(member.id, 'wrong-password-1', 'new-password-123')).rejects.toMatchObject({ status: 400 });
    await expect(changePassword(member.id, 'temporary-password-1', 'temporary-password-1')).rejects.toMatchObject({ status: 400 });
    await changePassword(member.id, 'temporary-password-1', 'new-password-123');
    const row = await sql(`SELECT must_change_password FROM users WHERE id = $1`, [member.id]);
    expect(row.rows[0].must_change_password).toBe(false);
  });
});
