import { Router, Request, Response } from 'express';
import { triggerScrape, getScrapeStatus, getScrapeStreamResponse, healthCheck } from '../services/signalEngineService';
import { getScrapingLogs } from '../services/supabaseService';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const healthy = await healthCheck();
  res.json({ success: true, data: { signal_engine_online: healthy } });
});

router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const { sources = ['linkedin', 'crunchbase', 'job_board', 'local_business', 'remote_jobs'] } = req.body;
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

// Server-sent events: proxies the signal engine's live per-source scrape
// progress straight through to the browser (same pattern as leadsController's
// analyze/stream — the signal engine already formats complete SSE frames, so
// this is a raw byte passthrough with no server-side parsing needed).
router.get('/scrape/:jobId/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const pyResponse = await getScrapeStreamResponse(req.params.jobId, controller.signal);
    if (!pyResponse.ok || !pyResponse.body) {
      res.write(`data: ${JSON.stringify({ phase: 'error', message: 'Signal engine unavailable' })}\n\n`);
      res.end();
      return;
    }

    const reader = pyResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    res.end();
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (err as Error).message });
    } else {
      res.write(`data: ${JSON.stringify({ phase: 'error', message: (err as Error).message })}\n\n`);
      res.end();
    }
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
