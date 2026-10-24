import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import type { TenantContext } from '../../services/tenantContext';

// The controller imports the engine and Groq clients, which read their keys at load.
process.env.ENGINE_API_KEY = process.env.ENGINE_API_KEY || 'test-engine-key';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-groq-key';

let orgs: TwoOrgs;
let updateLead: typeof import('../../controllers/leadsController').updateLead;

beforeAll(async () => {
  ({ updateLead } = await import('../../controllers/leadsController'));
  orgs = await seedTwoOrgs();
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

async function patchLead(ctx: TenantContext, id: string, body: object) {
  let status = 200;
  let payload: unknown;
  const res = {
    status(code: number) { status = code; return this; },
    json(body: unknown) { payload = body; return this; },
  } as unknown as Response;
  await updateLead({ ctx, params: { id }, body } as unknown as Request, res);
  return { status, payload };
}

describe('PATCH /api/leads/:id', () => {
  it('updates the caller’s own lead', async () => {
    const { status } = await patchLead(orgs.a.ctx, orgs.a.leadId, { notes: 'mine' });
    expect(status).toBe(200);
  });

  it('is a 404, not a 500, for another org’s lead — and leaves it untouched', async () => {
    const { status, payload } = await patchLead(orgs.a.ctx, orgs.b.leadId, { notes: 'not mine' });
    expect(status).toBe(404);
    expect(payload).toEqual({ success: false, error: 'Lead not found' });
    const { rows } = await sql(`SELECT notes FROM leads WHERE id = $1`, [orgs.b.leadId]);
    expect(rows[0].notes).not.toBe('not mine');
  });

  it('is the same 404 for an id that does not exist anywhere', async () => {
    const { status, payload } = await patchLead(orgs.a.ctx, '00000000-0000-0000-0000-000000000000', { notes: 'x' });
    expect(status).toBe(404);
    expect(payload).toEqual({ success: false, error: 'Lead not found' });
  });

  it('is still a 500 for a genuine failure', async () => {
    const { status } = await patchLead(orgs.a.ctx, orgs.a.leadId, { status: 'not-a-status' });
    expect(status).toBe(500);
  });
});
