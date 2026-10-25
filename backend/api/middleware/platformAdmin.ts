import { Request, Response, NextFunction } from 'express';
import { isPlatformAdmin } from '../../services/platformAdminService';

/**
 * Only Signal's own operators. Runs after `authenticate`, and reads the flag
 * from the database on every request rather than trusting the token, so
 * revoking it takes effect immediately.
 */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user && await isPlatformAdmin(req.user.sub)) {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'Platform admin access required' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}
