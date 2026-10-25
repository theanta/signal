import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requirePlatformAdmin } from '../api/middleware/platformAdmin';
import {
  createOrganization, getOrganization, listOrganizations, PlatformAdminError, updateOrganization,
} from '../services/platformAdminService';
import {
  AccountError, createUserInOrg, listOrgMembers, resendInvite, updateMember,
} from '../services/accountService';
import { DEFAULT_ORG_LIMITS } from '../../shared/types';
import { AddUserSchema, UpdateUserSchema } from './userSchemas';

/** Platform admin: Signal's operators managing organizations (tenants) and their users. */
const router = Router();
router.use(requirePlatformAdmin);

const limit = z.number().int().min(0).nullable();
const uuid = z.string().uuid();

const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, digits and single hyphens'),
  agency_name: z.string().trim().optional(),
  admin_name: z.string().trim().min(1, 'Admin name is required'),
  admin_email: z.string().trim().email('Admin email is not valid'),
  admin_mode: z.enum(['invite', 'password']).default('invite'),
  admin_password: z.string().optional(),
  lead_quota_daily: limit.default(DEFAULT_ORG_LIMITS.lead_quota_daily),
  lead_quota_weekly: limit.default(DEFAULT_ORG_LIMITS.lead_quota_weekly),
  lead_quota_monthly: limit.default(DEFAULT_ORG_LIMITS.lead_quota_monthly),
  monthly_scrape_cap: z.number().int().min(0).default(DEFAULT_ORG_LIMITS.monthly_scrape_cap),
});

const UpdateOrganizationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  lead_quota_daily: limit.optional(),
  lead_quota_weekly: limit.optional(),
  lead_quota_monthly: limit.optional(),
  monthly_scrape_cap: z.number().int().min(0).optional(),
}).strict();

const issues = (e: z.ZodError) => e.issues.map(i => i.message).join('; ');

function fail(res: Response, err: unknown) {
  const status = err instanceof PlatformAdminError || err instanceof AccountError ? err.status : 500;
  res.status(status).json({ success: false, error: (err as Error).message });
}

router.get('/organizations', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await listOrganizations() });
  } catch (err) { fail(res, err); }
});

router.post('/organizations', async (req: Request, res: Response) => {
  const parsed = CreateOrganizationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: issues(parsed.error) }); return; }
  try {
    res.status(201).json({ success: true, data: await createOrganization(parsed.data) });
  } catch (err) { fail(res, err); }
});

router.patch('/organizations/:id', async (req: Request, res: Response) => {
  const parsed = UpdateOrganizationSchema.safeParse(req.body);
  if (!parsed.success || !uuid.safeParse(req.params.id).success) {
    res.status(400).json({ success: false, error: parsed.success ? 'Invalid organization id' : issues(parsed.error) });
    return;
  }
  try {
    res.json({ success: true, data: await updateOrganization(req.params.id, req.user!.org_id, parsed.data) });
  } catch (err) { fail(res, err); }
});

router.get('/organizations/:id/users', async (req: Request, res: Response) => {
  try {
    await getOrganization(req.params.id);
    res.json({ success: true, data: await listOrgMembers(req.params.id) });
  } catch (err) { fail(res, err); }
});

router.post('/organizations/:id/users', async (req: Request, res: Response) => {
  const parsed = AddUserSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: issues(parsed.error) }); return; }
  try {
    await getOrganization(req.params.id);
    res.status(201).json({ success: true, data: await createUserInOrg(req.params.id, parsed.data, 'The Signal team') });
  } catch (err) { fail(res, err); }
});

router.patch('/organizations/:id/users/:userId', async (req: Request, res: Response) => {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: issues(parsed.error) }); return; }
  try {
    res.json({ success: true, data: await updateMember(req.params.id, req.user!.sub, req.params.userId, parsed.data) });
  } catch (err) { fail(res, err); }
});

router.post('/organizations/:id/users/:userId/resend-invite', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await resendInvite(req.params.id, req.params.userId, 'The Signal team') });
  } catch (err) { fail(res, err); }
});

export default router;
