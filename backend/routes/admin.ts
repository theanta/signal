import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requirePlatformAdmin } from '../api/middleware/platformAdmin';
import {
  createOrganization, listOrganizations, PlatformAdminError,
} from '../services/platformAdminService';
import { DEFAULT_ORG_LIMITS } from '../../shared/types';

/** Platform admin: Signal's operators managing organizations (tenants). */
const router = Router();
router.use(requirePlatformAdmin);

const limit = z.number().int().min(0).nullable();

const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, digits and single hyphens'),
  agency_name: z.string().trim().optional(),
  admin_name: z.string().trim().min(1, 'Admin name is required'),
  admin_email: z.string().trim().email('Admin email is not valid'),
  admin_password: z.string().min(12, 'Admin password must be at least 12 characters'),
  lead_quota_daily: limit.default(DEFAULT_ORG_LIMITS.lead_quota_daily),
  lead_quota_weekly: limit.default(DEFAULT_ORG_LIMITS.lead_quota_weekly),
  lead_quota_monthly: limit.default(DEFAULT_ORG_LIMITS.lead_quota_monthly),
  monthly_scrape_cap: z.number().int().min(0).default(DEFAULT_ORG_LIMITS.monthly_scrape_cap),
});

router.get('/organizations', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await listOrganizations() });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/organizations', async (req: Request, res: Response) => {
  const parsed = CreateOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try {
    res.status(201).json({ success: true, data: await createOrganization(parsed.data) });
  } catch (err) {
    const status = err instanceof PlatformAdminError ? err.status : 500;
    res.status(status).json({ success: false, error: (err as Error).message });
  }
});

export default router;
