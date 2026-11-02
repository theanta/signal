import { Router, Request, Response } from 'express';
import { getDashboardMetrics, getPipelineSummary, getHotLeads } from '../services/supabaseService';
import { ctxOf } from '../api/middleware/auth';
import { getLeadQuota } from '../services/leadQuotaService';

const router = Router();

// Counts, pipeline and hot leads are computed in the database (see
// 2026-10-27_dashboard_aggregates.sql), so they stay right at any number of leads.

router.get('/lead-quota', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await getLeadQuota(ctxOf(req)) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics(ctxOf(req));
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Single endpoint returning all dashboard data to avoid 3 round trips on initial load
router.get('/all', async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const [metrics, pipeline, hotLeads] = await Promise.all([
      getDashboardMetrics(ctx),
      getPipelineSummary(ctx),
      getHotLeads(ctx),
    ]);

    res.json({ success: true, data: { metrics, pipeline, hotLeads } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/pipeline', async (req: Request, res: Response) => {
  try {
    const summary = await getPipelineSummary(ctxOf(req));
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/hot-leads', async (req: Request, res: Response) => {
  try {
    const data = await getHotLeads(ctxOf(req));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
