import { Router, Request, Response } from 'express';
import { triggerScrape, getScrapeStatus, healthCheck } from '../services/signalEngineService';
import { getScrapingLogs } from '../services/supabaseService';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const healthy = await healthCheck();
  res.json({ success: true, data: { signal_engine_online: healthy } });
});

router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const { sources = ['linkedin', 'crunchbase', 'job_board', 'local_business'] } = req.body;
    const result = await triggerScrape(sources);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/scrape/:jobId', async (req: Request, res: Response) => {
  try {
    const result = await getScrapeStatus(req.params.jobId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const logs = await getScrapingLogs(limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
