import type { Request } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Who a request counts against for rate limiting: the signed-in user when the
 * request carries a valid access token, otherwise the client IP.
 *
 * Behind Render's load balancer and the Next.js /api proxy, every user can
 * arrive from the same address, so an IP-only key made one shared allowance
 * for everyone. A forged or expired token falls back to the IP, so it cannot
 * be used to claim a fresh allowance.
 */
export function rateLimitKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ') && process.env.JWT_SECRET) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string };
      if (payload.sub) return `user:${payload.sub}`;
    } catch { /* fall through to the IP */ }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}
