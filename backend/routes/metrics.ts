import { Router, Request, Response } from 'express';
import { getDashboardMetrics, supabase } from '../services/supabaseService';

const router = Router();

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Single endpoint returning all dashboard data to avoid 3 round trips on initial load
router.get('/all', async (_req: Request, res: Response) => {
  try {
    const [metrics, leadsRows] = await Promise.all([
      getDashboardMetrics(),
      supabase.from('leads').select('id, company_name, location, industry, website, lead_score, status, created_at'),
    ]);

    if (leadsRows.error) throw leadsRows.error;
    const rows = leadsRows.data ?? [];

    const grouped: Record<string, { count: number; scores: number[]; dates: string[] }> = {};
    for (const row of rows) {
      if (!grouped[row.status]) grouped[row.status] = { count: 0, scores: [], dates: [] };
      grouped[row.status].count++;
      if (row.lead_score != null) grouped[row.status].scores.push(row.lead_score);
      if (row.created_at) grouped[row.status].dates.push(row.created_at);
    }
    const pipeline = Object.entries(grouped).map(([status, g]) => ({
      status,
      count: g.count,
      avg_score: g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : 0,
      last_added: g.dates.sort().at(-1) ?? '',
    }));

    const hotLeads = rows
      .filter(r => (r.lead_score ?? 0) >= 70)
      .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
      .slice(0, 10);

    res.json({ success: true, data: { metrics, pipeline, hotLeads } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/pipeline', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('status, lead_score, created_at');
    if (error) throw error;

    const grouped: Record<string, { count: number; scores: number[]; dates: string[] }> = {};
    for (const row of (data ?? [])) {
      if (!grouped[row.status]) grouped[row.status] = { count: 0, scores: [], dates: [] };
      grouped[row.status].count++;
      if (row.lead_score != null) grouped[row.status].scores.push(row.lead_score);
      if (row.created_at) grouped[row.status].dates.push(row.created_at);
    }

    const summary = Object.entries(grouped).map(([status, g]) => ({
      status,
      count: g.count,
      avg_score: g.scores.length
        ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length)
        : 0,
      last_added: g.dates.sort().at(-1) ?? '',
    }));

    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/hot-leads', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .gte('lead_score', 70)
      .order('lead_score', { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json({ success: true, data: data ?? [] });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
