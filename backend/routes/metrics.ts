import { Router, Request, Response } from 'express';
import { getDashboardMetrics, getPipelineRows, getHotLeads } from '../services/supabaseService';
import { ctxOf } from '../api/middleware/auth';
import { getLeadQuota } from '../services/leadQuotaService';

const router = Router();

// The three inline `supabase.from('leads')` queries this file used to run are
// now getPipelineRows / getHotLeads in supabaseService, where the org scope
// lives with the query. The shaping below stays here — it is presentation.
interface PipelineRow {
  status: string;
  lead_score?: number;
  created_at: string;
}

function summarizePipeline(rows: PipelineRow[]) {
  const grouped: Record<string, { count: number; scores: number[]; dates: string[] }> = {};
  for (const row of rows) {
    if (!grouped[row.status]) grouped[row.status] = { count: 0, scores: [], dates: [] };
    grouped[row.status].count++;
    if (row.lead_score != null) grouped[row.status].scores.push(row.lead_score);
    if (row.created_at) grouped[row.status].dates.push(row.created_at);
  }
  return Object.entries(grouped).map(([status, g]) => ({
    status,
    count: g.count,
    avg_score: g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : 0,
    last_added: g.dates.sort().at(-1) ?? '',
  }));
}

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
    const [metrics, rows] = await Promise.all([
      getDashboardMetrics(ctx),
      getPipelineRows(ctx),
    ]);

    const pipeline = summarizePipeline(rows);
    const hotLeads = rows
      .filter(r => (r.lead_score ?? 0) >= 70)
      .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
      .slice(0, 10);

    res.json({ success: true, data: { metrics, pipeline, hotLeads } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/pipeline', async (req: Request, res: Response) => {
  try {
    const summary = summarizePipeline(await getPipelineRows(ctxOf(req)));
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
