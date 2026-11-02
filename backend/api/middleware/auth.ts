import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../../shared/types';
import { createTenantContext, TenantContext } from '../../services/tenantContext';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      ctx?: TenantContext;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = header.slice(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    res.status(401).json({ success: false, error: 'Token expired or invalid' });
    return;
  }

  // Tokens minted before the tenancy cutover carry no org. There is no safe
  // default org to pick, so the session ends and the user logs in again.
  if (!payload.org_id) {
    res.status(401).json({ success: false, error: 'Session predates tenancy — please log in again' });
    return;
  }

  // Until a temporary or invited password is replaced, only the auth routes
  // (change password, me) answer.
  if (payload.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
    res.status(403).json({
      success: false, error: 'Choose a new password to continue', code: 'password_change_required',
    });
    return;
  }

  req.user = payload;
  try {
    // The org id comes from the verified token payload and from nowhere else.
    // Not req.body, not req.query, not a header — a client-supplied org id is
    // not an authenticated one.
    req.ctx = createTenantContext(payload.org_id, payload.sub);
  } catch (err) {
    // createTenantContext throws for two unrelated reasons, and only one of
    // them is the user's fault. `asOrgId` failing on a malformed org_id claim
    // is a bad-session problem (401, log-free — it's routine). Missing
    // SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_JWT_SECRET on this server is a
    // deploy/config problem (500, logged) — without this split, a missing
    // env var makes every authenticated request 401 "Invalid session
    // organization" with nothing logged anywhere, which reads as an auth-token
    // bug and sends whoever is on call looking in the wrong place entirely.
    //
    // Distinguished by message shape rather than a new error type so this
    // stays a middleware-only change: the thrown message already names the
    // missing variables without their values (see tenantContext.ts), so
    // logging it verbatim is safe — never interpolate the values here.
    const message = err instanceof Error ? err.message : '';
    if (message.startsWith('Missing SUPABASE_URL')) {
      console.error(`[auth] createTenantContext failed — server misconfigured: ${message}`);
      res.status(500).json({ success: false, error: 'Server configuration error' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid session organization' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
    return;
  }
  next();
}

/**
 * Narrow `req.ctx` for handlers running behind `authenticate`.
 *
 * Express types it optional because the middleware is not in the type system.
 * Every handler in this codebase runs behind `authenticate`, so a missing ctx
 * is a wiring bug, not a request the client can provoke.
 */
export function ctxOf(req: Request): TenantContext {
  if (!req.ctx) {
    throw new Error('No TenantContext on request — route is missing the authenticate middleware');
  }
  return req.ctx;
}
