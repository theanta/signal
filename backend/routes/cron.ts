import { Router, Request, Response } from 'express';
import cron from 'node-cron';
import { triggerScrape } from '../services/signalEngineService';
import { getLeads, updateLead } from '../services/supabaseService';
import { analyzeLeadSignals } from '../services/signalEngineService';
import { generateOutreach } from '../services/claudeService';
import * as db from '../services/supabaseService';
import type { LeadSource, SignalAnalysisResult } from '../../shared/types';

function isSignalAnalysisResult(v: unknown): v is SignalAnalysisResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.lead_score === 'number' &&
    Array.isArray(r.likely_pain_points) &&
    typeof r.recommended_anta_service === 'string' &&
    typeof r.outreach_angle === 'string' &&
    typeof r.signal_type === 'string'
  );
}

const router = Router();

// ---- Job state ----
let jobs: Record<string, cron.ScheduledTask> = {};

// ---- Audit helpers ----
async function withAudit(
  jobName: string,
  triggerType: 'scheduled' | 'manual',
  fn: () => Promise<number | void>,
): Promise<void> {
  const startedAt = Date.now();
  let logId: string | null = null;
  try {
    const log = await db.createCronJobLog({
      job_name: jobName,
      trigger_type: triggerType,
      status: 'running',
      started_at: new Date(startedAt).toISOString(),
    });
    logId = log.id;
  } catch {
    // audit failure must not block the job
  }

  let leadsProcessed: number | undefined;
  let errorMessage: string | undefined;

  try {
    const result = await fn();
    if (typeof result === 'number') leadsProcessed = result;
  } catch (err) {
    errorMessage = (err as Error).message;
    console.error(`[CRON] ${jobName} failed:`, errorMessage);
  }

  if (logId) {
    const completedAt = Date.now();
    await db.updateCronJobLog(logId, {
      status: errorMessage ? 'failed' : 'success',
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      leads_processed: leadsProcessed,
      error_message: errorMessage,
    }).catch(() => {});
  }
}

async function runDailyScrape(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  console.log('[CRON] Starting daily scrape...');
  await withAudit('daily_scrape', trigger, async () => {
    await triggerScrape(['linkedin', 'job_board']);
    console.log('[CRON] Daily scrape triggered successfully');
  });
}

async function pingSignalEngine(): Promise<void> {
  const { healthCheck } = await import('../services/signalEngineService');
  const ok = await healthCheck();
  console.log(`[CRON] Signal engine ping: ${ok ? 'alive' : 'did not respond'}`);
}

async function runBiweeklyScrape(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  console.log('[CRON] Starting bi-weekly scrape (crunchbase + local_business)...');
  await withAudit('biweekly_scrape', trigger, async () => {
    await triggerScrape(['crunchbase', 'local_business']);
    console.log('[CRON] Bi-weekly scrape triggered successfully');
  });
}

async function runLeadAnalysis(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  console.log('[CRON] Running lead analysis batch...');
  await withAudit('analyze_leads', trigger, async () => {
    const { data: leads } = await getLeads({ status: 'new', per_page: 20 });

    for (const lead of leads) {
      try {
        const signals = await analyzeLeadSignals({
          company_name: lead.company_name,
          website: lead.website,
          location: lead.location,
          job_title: lead.job_title,
          hiring_signal: lead.hiring_signal,
          source_url: lead.source_url ?? '',
          source: lead.source as LeadSource,
          scraped_at: lead.scraped_at ?? new Date().toISOString(),
          description: lead.description,
          industry: lead.industry,
          company_size: lead.company_size,
        });

        await Promise.all([
          db.createLeadSignal({
            lead_id: lead.id,
            signal_type: signals.signal_type,
            confidence_score: signals.confidence_score,
            likely_pain_points: signals.likely_pain_points,
            recommended_anta_service: signals.recommended_anta_service,
            outreach_angle: signals.outreach_angle,
            operational_maturity: signals.operational_maturity,
            growth_indicators: signals.growth_indicators,
            digital_maturity_score: signals.digital_maturity_score,
            raw_analysis: signals as unknown as Record<string, unknown>,
          }),
          db.createLeadScore({
            lead_id: lead.id,
            overall_score: signals.lead_score,
            company_size_score: signals.scoring_breakdown.company_size_score,
            hiring_urgency_score: signals.scoring_breakdown.hiring_urgency_score,
            complexity_score: signals.scoring_breakdown.complexity_score,
            digital_score: signals.scoring_breakdown.digital_score,
            scoring_rationale: signals.scoring_rationale,
          }),
          updateLead(lead.id, {
            lead_score: signals.lead_score,
            status: 'analyzed',
            analyzed_at: new Date().toISOString(),
          }),
        ]);
      } catch (err) {
        console.error(`[CRON] Failed to analyze lead ${lead.id}:`, (err as Error).message);
      }
    }
    console.log(`[CRON] Analyzed ${leads.length} leads`);
    return leads.length;
  });
}

async function runOutreachGeneration(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  console.log('[CRON] Generating outreach for top leads...');
  await withAudit('generate_outreach', trigger, async () => {
    const { data: leads } = await getLeads({ status: 'analyzed', min_score: 65, per_page: 10 });

    for (const lead of leads) {
      try {
        const signals = await db.getLeadSignals(lead.id);
        if (signals.length === 0) continue;

        const existing = await db.getOutreachMessages(lead.id);
        if (existing.length > 0) continue;

        const raw = signals[0].raw_analysis;
        if (!isSignalAnalysisResult(raw)) {
          console.error(`[CRON] raw_analysis for signal ${signals[0].id} has unexpected shape, skipping`);
          continue;
        }
        const outreach = await generateOutreach(lead, raw, 'email');

        await db.createOutreachMessage({
          lead_id: lead.id,
          channel: 'email',
          subject: outreach.subject,
          body: outreach.body,
          generated_by: 'claude',
          model_version: outreach.model_version,
        });
      } catch (err) {
        console.error(`[CRON] Failed outreach for ${lead.id}:`, (err as Error).message);
      }
    }
    console.log(`[CRON] Outreach generation complete for ${leads.length} leads`);
    return leads.length;
  });
}

// ---- Initialize cron jobs ----
export function initCronJobs(): void {
  const scrapeSchedule = process.env.CRON_DAILY_SCRAPE ?? '0 6 * * *';
  const analyzeSchedule = process.env.CRON_ANALYZE_LEADS ?? '0 7 * * *';
  const outreachSchedule = process.env.CRON_GENERATE_OUTREACH ?? '0 8 * * *';
  const biweeklySchedule = process.env.CRON_BIWEEKLY_SCRAPE ?? '0 6 1,15 * *';

  jobs['daily_scrape'] = cron.schedule(scrapeSchedule, () => runDailyScrape('scheduled'), { timezone: 'America/Detroit' });
  jobs['analyze_leads'] = cron.schedule(analyzeSchedule, () => runLeadAnalysis('scheduled'), { timezone: 'America/Detroit' });
  jobs['generate_outreach'] = cron.schedule(outreachSchedule, () => runOutreachGeneration('scheduled'), { timezone: 'America/Detroit' });
  jobs['biweekly_scrape'] = cron.schedule(biweeklySchedule, () => runBiweeklyScrape('scheduled'), { timezone: 'America/Detroit' });
  jobs['signal_engine_ping'] = cron.schedule('*/14 * * * *', pingSignalEngine);

  console.log('[CRON] Jobs initialized:', Object.keys(jobs).join(', '));
}

// ---- Manual trigger endpoints ----
router.post('/run/scrape', async (_req: Request, res: Response) => {
  runDailyScrape('manual').catch(console.error);
  res.json({ success: true, message: 'Scrape job triggered' });
});

router.post('/run/analyze', async (_req: Request, res: Response) => {
  runLeadAnalysis('manual').catch(console.error);
  res.json({ success: true, message: 'Analysis job triggered' });
});

router.post('/run/outreach', async (_req: Request, res: Response) => {
  runOutreachGeneration('manual').catch(console.error);
  res.json({ success: true, message: 'Outreach generation triggered' });
});

router.post('/run/biweekly', async (_req: Request, res: Response) => {
  runBiweeklyScrape('manual').catch(console.error);
  res.json({ success: true, message: 'Bi-weekly scrape triggered' });
});

router.get('/logs', async (_req: Request, res: Response) => {
  try {
    const logs = await db.getCronJobLogs(40);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: { active_jobs: Object.keys(jobs) } });
});

export default router;
