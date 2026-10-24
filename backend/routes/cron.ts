import { Router, Request, Response } from 'express';
import cron from 'node-cron';
import {
  runDailyScrape, runBiweeklyScrape, runLeadAnalysis,
  runOutreachGeneration, pingSignalEngine,
} from '../services/cronRunner';
import { getCronJobLogs } from '../services/supabaseService';
import { ctxOf } from '../api/middleware/auth';

// HTTP wiring only. The job bodies live in services/cronRunner.ts, which
// enumerates orgs and runs each one inside its own TenantContext.

const router = Router();

// ---- Job state ----
const jobs: Record<string, cron.ScheduledTask> = {};

// One schedule for every tenant, in this time zone. Per-tenant schedules
// (each agency's own morning) are not built yet.
const CRON_TIMEZONE = process.env.CRON_TIMEZONE ?? 'America/Detroit';

// ---- Initialize cron jobs ----
export function initCronJobs(): void {
  const scrapeSchedule = process.env.CRON_DAILY_SCRAPE ?? '0 6 * * *';
  const analyzeSchedule = process.env.CRON_ANALYZE_LEADS ?? '0 7 * * *';
  const outreachSchedule = process.env.CRON_GENERATE_OUTREACH ?? '0 8 * * *';
  const biweeklySchedule = process.env.CRON_BIWEEKLY_SCRAPE ?? '0 6 1,15 * *';

  jobs['daily_scrape'] = cron.schedule(scrapeSchedule, () => runDailyScrape('scheduled').catch(console.error), { timezone: CRON_TIMEZONE });
  jobs['analyze_leads'] = cron.schedule(analyzeSchedule, () => runLeadAnalysis('scheduled').catch(console.error), { timezone: CRON_TIMEZONE });
  jobs['generate_outreach'] = cron.schedule(outreachSchedule, () => runOutreachGeneration('scheduled').catch(console.error), { timezone: CRON_TIMEZONE });
  jobs['biweekly_scrape'] = cron.schedule(biweeklySchedule, () => runBiweeklyScrape('scheduled').catch(console.error), { timezone: CRON_TIMEZONE });
  jobs['signal_engine_ping'] = cron.schedule('*/14 * * * *', pingSignalEngine);

  console.log('[CRON] Jobs initialized:', Object.keys(jobs).join(', '));
}

// ---- Manual trigger endpoints ----
// These sit behind tenant login, so a manual run covers only the caller's org.
// Scheduled runs (above) cover every active org.
router.post('/run/scrape', async (req: Request, res: Response) => {
  runDailyScrape('manual', ctxOf(req)).catch(console.error);
  res.json({ success: true, message: 'Scrape job triggered' });
});

router.post('/run/analyze', async (req: Request, res: Response) => {
  runLeadAnalysis('manual', ctxOf(req)).catch(console.error);
  res.json({ success: true, message: 'Analysis job triggered' });
});

router.post('/run/outreach', async (req: Request, res: Response) => {
  runOutreachGeneration('manual', ctxOf(req)).catch(console.error);
  res.json({ success: true, message: 'Outreach generation triggered' });
});

router.post('/run/biweekly', async (req: Request, res: Response) => {
  runBiweeklyScrape('manual', ctxOf(req)).catch(console.error);
  res.json({ success: true, message: 'Bi-weekly scrape triggered' });
});

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const logs = await getCronJobLogs(ctxOf(req), 40);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: { active_jobs: Object.keys(jobs) } });
});

export default router;
