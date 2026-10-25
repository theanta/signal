import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../api/middleware/auth';
import { addTeamMember, listTeam, TeamError } from '../services/teamService';

/** The caller's own organization's users. Anyone can list; admins add. */
const router = Router();

const AddMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Email is not valid'),
  role: z.enum(['admin', 'member']).default('member'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
});

router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await listTeam(ctxOf(req)) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const parsed = AddMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try {
    res.status(201).json({ success: true, data: await addTeamMember(ctxOf(req), parsed.data) });
  } catch (err) {
    const status = err instanceof TeamError ? err.status : 500;
    res.status(status).json({ success: false, error: (err as Error).message });
  }
});

export default router;
