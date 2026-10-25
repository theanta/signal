import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeamMember, listTeam } from '../../services/teamService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

let orgs: TwoOrgs;
const NEW_EMAIL = 'new.member@iso-org-a.test';

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});
afterAll(async () => {
  await sql(`DELETE FROM users WHERE email = $1`, [NEW_EMAIL]);
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

  it('adds a member to the caller’s org with a hashed password', async () => {
    const member = await addTeamMember(orgs.a.ctx, {
      name: 'New Member', email: ' New.Member@iso-org-a.test ', role: 'member', password: 'temporary-password-1',
    });
    expect(member).toMatchObject({ email: NEW_EMAIL, role: 'member', is_active: true });
    const row = await sql(`SELECT org_id, password_hash FROM users WHERE email = $1`, [NEW_EMAIL]);
    expect(row.rows[0].org_id).toBe(orgs.a.orgId);
    expect(row.rows[0].password_hash).not.toContain('temporary-password-1');
    expect((await listTeam(orgs.a.ctx)).map(m => m.email)).toContain(NEW_EMAIL);
  });

  it('refuses an email that already exists, with 409', async () => {
    await expect(addTeamMember(orgs.b.ctx, {
      name: 'Dup', email: NEW_EMAIL, role: 'member', password: 'temporary-password-1',
    })).rejects.toMatchObject({ status: 409 });
  });
});
