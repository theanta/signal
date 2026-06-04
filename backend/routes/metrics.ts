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

router.get('/pipeline', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('lead_pipeline_summary').select('*');
    if (error) throw error;
    res.json({ success: true, data: data ?? [] });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/hot-leads', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('hot_leads').select('*').limit(10);
    if (error) throw error;
    res.json({ success: true, data: data ?? [] });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
