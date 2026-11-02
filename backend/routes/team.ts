import { Router, Request, Response } from 'express';
import { ctxOf, requireAdmin } from '../api/middleware/auth';
import {
  addTeamMember, listTeam, resendTeamInvite, TeamError, updateTeamMember,
} from '../services/teamService';
import { AddUserSchema, UpdateUserSchema } from './userSchemas';

/** The caller's own organization's users. Anyone can list; admins manage. */
const router = Router();

function fail(res: Response, err: unknown) {
  const status = err instanceof TeamError ? err.status : 500;
  res.status(status).json({ success: false, error: (err as Error).message });
}

router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await listTeam(ctxOf(req)) });
  } catch (err) { fail(res, err); }
});

router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const parsed = AddUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try {
    res.status(201).json({ success: true, data: await addTeamMember(ctxOf(req), parsed.data, req.user!.name) });
  } catch (err) { fail(res, err); }
});

router.patch('/:id', requireAdmin, async (req: Request, res: Response) => {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try {
    res.json({ success: true, data: await updateTeamMember(ctxOf(req), req.params.id, parsed.data) });
  } catch (err) { fail(res, err); }
});

router.post('/:id/resend-invite', requireAdmin, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await resendTeamInvite(ctxOf(req), req.params.id, req.user!.name) });
  } catch (err) { fail(res, err); }
});

export default router;
