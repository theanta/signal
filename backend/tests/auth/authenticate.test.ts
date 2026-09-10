import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { authenticate, ctxOf } from '../../api/middleware/auth';
import { signLoginToken } from '../helpers/context';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

interface Captured {
  status?: number;
  body?: unknown;
}

function run(req: Partial<Request>): { req: Request; res: Captured; nextCalls: number } {
  const captured: Captured = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;

  let nextCalls = 0;
  const next: NextFunction = () => {
    nextCalls += 1;
  };

  const request = { headers: {}, ...req } as Request;
  authenticate(request, res, next);
  return { req: request, res: captured, nextCalls };
}

describe('authenticate', () => {
  it('refuses a request with no Authorization header, and attaches no ctx', () => {
    const { req, res, nextCalls } = run({});
    expect(res.status).toBe(401);
    expect(req.ctx).toBeUndefined();
    expect(nextCalls).toBe(0);
  });

  it('refuses a token signed with the wrong secret', () => {
    const forged = jwt.sign({ sub: USER, org_id: ORG_A, role: 'admin' }, 'not-the-login-secret');
    const { req, res, nextCalls } = run({ headers: { authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
    expect(req.ctx).toBeUndefined();
    expect(nextCalls).toBe(0);
  });

  it('refuses a pre-cutover token that carries no org_id, rather than defaulting one', () => {
    const token = signLoginToken({ sub: USER, org_id: undefined });
    const { req, res, nextCalls } = run({ headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
    expect(req.ctx).toBeUndefined();
    expect(nextCalls).toBe(0);
  });

  it('refuses a malformed org_id claim rather than passing it through', () => {
    for (const bad of ['not-a-uuid', '', `${ORG_A} OR 1=1`, '../../etc/passwd']) {
      const token = signLoginToken({ sub: USER, org_id: bad });
      const { req, res, nextCalls } = run({ headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(401);
      expect(req.ctx).toBeUndefined();
      expect(nextCalls).toBe(0);
    }
  });

  it('mints a ctx from the verified token', () => {
    const token = signLoginToken({ sub: USER, org_id: ORG_A });
    const { req, nextCalls } = run({ headers: { authorization: `Bearer ${token}` } });
    expect(nextCalls).toBe(1);
    expect(req.ctx?.orgId).toBe(ORG_A);
    expect(req.ctx?.userId).toBe(USER);
  });

  it('surfaces a missing SUPABASE_JWT_SECRET as a 500, distinct from a bad org id, and logs once without the value of any secret', () => {
    const savedSecret = process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const token = signLoginToken({ sub: USER, org_id: ORG_A });
      const { req, res, nextCalls } = run({ headers: { authorization: `Bearer ${token}` } });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false });
      expect(req.ctx).toBeUndefined();
      expect(nextCalls).toBe(0);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0].join(' ');
      expect(logged).toMatch(/SUPABASE_JWT_SECRET/);
      // The log names the missing variable, never a secret's value. There is
      // no secret value in scope for this case (the var is unset), but assert
      // the shape stays a static message rather than an interpolated one.
      expect(logged).not.toMatch(/Bearer /);
      expect(logged).not.toContain(token);
    } finally {
      if (savedSecret === undefined) {
        delete process.env.SUPABASE_JWT_SECRET;
      } else {
        process.env.SUPABASE_JWT_SECRET = savedSecret;
      }
      errorSpy.mockRestore();
    }
  });

  it('ignores an org id supplied in the body, query or a header', () => {
    const token = signLoginToken({ sub: USER, org_id: ORG_A });
    const { req } = run({
      headers: { authorization: `Bearer ${token}`, 'x-org-id': ORG_B },
      body: { org_id: ORG_B, orgId: ORG_B },
      query: { org_id: ORG_B },
    } as Partial<Request>);
    // The only org id that can reach createTenantContext is the token's.
    expect(req.ctx?.orgId).toBe(ORG_A);
  });
});

describe('ctxOf', () => {
  it('throws rather than returning a context for an unauthenticated request', () => {
    const bare = { headers: {} } as Request;
    expect(() => ctxOf(bare)).toThrow(/authenticate middleware/);
  });

  it('returns the context the middleware attached', () => {
    const token = signLoginToken({ sub: USER, org_id: ORG_A });
    const { req } = run({ headers: { authorization: `Bearer ${token}` } });
    expect(ctxOf(req).orgId).toBe(ORG_A);
  });
});
