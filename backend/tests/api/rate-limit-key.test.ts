import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { rateLimitKey } from '../../api/middleware/rateLimitKey';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const req = (authorization?: string, ip = '10.0.0.1') =>
  ({ headers: authorization ? { authorization } : {}, ip }) as unknown as Request;

describe('rateLimitKey', () => {
  it('keys a signed-in request by its user, so users behind one proxy do not share a limit', () => {
    const token = jwt.sign({ sub: 'user-1' }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
    expect(rateLimitKey(req(`Bearer ${token}`))).toBe('user:user-1');
  });

  it('falls back to the IP for no token or a forged one', () => {
    expect(rateLimitKey(req())).toBe('ip:10.0.0.1');
    const forged = jwt.sign({ sub: 'user-1' }, 'not-the-secret', { algorithm: 'HS256' });
    expect(rateLimitKey(req(`Bearer ${forged}`))).toBe('ip:10.0.0.1');
  });
});
