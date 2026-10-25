import { supabaseAdmin } from './supabaseAdmin';
import { createTenantContext, TenantContext } from './tenantContext';
import * as db from './supabaseService';
import { persistAnalysis } from './persistAnalysis';
import { analyzeLeadSignals, triggerScrape, healthCheck } from './signalEngineService';
import { ScrapeAlreadyRunningError } from './engineErrors';
import { generateOutreach } from './claudeService';
import { getConfig } from './configService';
import type { Lead, LeadSignal, LeadSource, SignalAnalysisResult } from '../../shared/types';

/**
 * Scheduled work has no request and therefore no session, so this is one of
 * the sanctioned service-role callers. It uses that privilege for exactly one
 * thing — enumerating orgs — and then drops into a per-org TenantContext for
 * all actual work, so a bug here can only ever affect one tenant at a time.
 */

export type CronTrigger = 'scheduled' | 'manual';

export async function listActiveOrgContexts(): Promise<TenantContext[]> {
  const { data: orgs, error } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listActiveOrgContexts: ${error.message}`);

  const contexts: TenantContext[] = [];
  for (const org of orgs ?? []) {
    // The context needs a user id for the JWT's `sub`. Any active admin of the
    // org will do; an org with no admin cannot be operated on and is skipped
    // loudly rather than silently running as nobody.
    const { data: admin, error: adminError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', org.id)
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (adminError || !admin) {
      console.error(`[CRON] Org ${org.id} has no active admin — skipping`);
      continue;
    }
    contexts.push(createTenantContext(org.id, admin.id));
  }
  return contexts;
}

/**
 * A new context for the same org and user. The scoped token on a context
 * lives five minutes, and a cron batch can run far longer than that, so long
 * jobs re-mint per unit of work instead of carrying one context throughout.
 */
function renew(ctx: TenantContext): TenantContext {
  return createTenantContext(ctx.orgId, ctx.userId);
}

/**
 * Run `fn` and record it in the org's cron_job_logs. An audit-log failure is
 * logged and does not stop the job; a job failure is recorded and swallowed so
 * one org's failure never stops the next org's run.
 */
export async function withAudit(
  ctx: TenantContext,
  jobName: string,
  trigger: CronTrigger,
  fn: () => Promise<number | void>,
): Promise<void> {
  const startedAt = Date.now();
  let logId: string | null = null;
  try {
    const log = await db.createCronJobLog(ctx, {
      job_name: jobName,
      trigger_type: trigger,
      status: 'running',
      started_at: new Date(startedAt).toISOString(),
    });
    logId = log.id;
  } catch (auditErr) {
    console.error(`[CRON AUDIT] Failed to create log for ${jobName} (org ${ctx.orgId}):`, (auditErr as Error).message);
  }

  let leadsProcessed: number | undefined;
  let errorMessage: string | undefined;
  try {
    const result = await fn();
    if (typeof result === 'number') leadsProcessed = result;
  } catch (err) {
    errorMessage = (err as Error).message;
    console.error(`[CRON] ${jobName} failed for org ${ctx.orgId}:`, errorMessage);
  }

  if (logId) {
    const completedAt = Date.now();
    await db.updateCronJobLog(renew(ctx), logId, {
      status: errorMessage ? 'failed' : 'success',
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      leads_processed: leadsProcessed,
      error_message: errorMessage,
    }).catch((err: Error) => {
      console.error(`[CRON AUDIT] Failed to close log ${logId} for ${jobName}:`, err.message);
    });
  }
}

/**
 * How many orgs a scheduled run works on at once. Sequential orgs meant the
 * 07:00 analysis for the fifth tenant finished hours after the first's; one
 * org per slot keeps a slow org from holding up the rest.
 */
export const CRON_CONCURRENCY = {
  orgs: Math.max(1, Number(process.env.CRON_ORG_CONCURRENCY ?? 3)),
};

/** Run `work` for every item, at most `limit` at a time. */
async function inPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * Run `perOrg` for each target org, CRON_CONCURRENCY.orgs at a time.
 *
 * Scheduled runs target every active org. A manual run targets only the org of
 * the user who pressed the button: the trigger endpoints sit behind tenant
 * login, and one tenant must not be able to start (and spend scrape credits
 * on) another tenant's jobs.
 */
async function eachOrg(only: TenantContext | undefined, perOrg: (ctx: TenantContext) => Promise<void>): Promise<void> {
  const targets = only ? [only] : await listActiveOrgContexts();
  await inPool(targets, CRON_CONCURRENCY.orgs, perOrg);
}

/** One audited job per target org. withAudit never throws, so orgs are independent. */
async function forEachOrg(
  jobName: string,
  trigger: CronTrigger,
  only: TenantContext | undefined,
  fn: (ctx: TenantContext) => Promise<number | void>,
): Promise<void> {
  await eachOrg(only, ctx => withAudit(ctx, jobName, trigger, () => fn(ctx)));
}

/**
 * How long a scheduled scrape waits for the org's active run to finish, and
 * how often it retries. The engine allows one active run per org, and on the
 * 1st and 15th the daily and bi-weekly scrapes fire in the same minute.
 */
export const SCRAPE_RETRY = {
  attempts: Number(process.env.CRON_SCRAPE_RETRY_ATTEMPTS ?? 30),
  delayMs: Number(process.env.CRON_SCRAPE_RETRY_MS ?? 120_000),
};

/**
 * Start a scrape for the org. A scheduled trigger waits out a run already in
 * progress and then starts its own; a manual one fails at once, because the
 * person who pressed the button can see the run that is in the way.
 */
async function startScrape(ctx: TenantContext, sources: string[], trigger: CronTrigger): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await triggerScrape(ctx, sources);
      return;
    } catch (err) {
      const retry = err instanceof ScrapeAlreadyRunningError
        && trigger === 'scheduled' && attempt < SCRAPE_RETRY.attempts;
      if (!retry) throw err;
      await new Promise(resolve => setTimeout(resolve, SCRAPE_RETRY.delayMs));
    }
  }
}

export async function runDailyScrape(trigger: CronTrigger = 'scheduled', only?: TenantContext): Promise<void> {
  // LinkedIn hiring posts go stale within days, so it runs daily; Google Maps
  // changes slowly and runs bi-weekly. Indeed (job_board) and Crunchbase are
  // paused this phase — see ENABLED_SOURCES in shared/types.
  await forEachOrg('daily_scrape', trigger, only, async (ctx) => {
    await startScrape(ctx, ['linkedin'], trigger);
  });
}

export async function runBiweeklyScrape(trigger: CronTrigger = 'scheduled', only?: TenantContext): Promise<void> {
  await forEachOrg('biweekly_scrape', trigger, only, async (ctx) => {
    await startScrape(ctx, ['local_business'], trigger);
  });
}

/** The org's daily_analysis_limit setting, clamped to 1..100. */
export async function dailyAnalysisLimit(ctx: TenantContext): Promise<number> {
  const raw = Number((await getConfig(ctx)).daily_analysis_limit);
  if (!Number.isFinite(raw)) return DEFAULT_DAILY_ANALYSIS_LIMIT;
  return Math.min(MAX_DAILY_ANALYSIS_LIMIT, Math.max(1, Math.round(raw)));
}

export const DEFAULT_DAILY_ANALYSIS_LIMIT = 20;
export const MAX_DAILY_ANALYSIS_LIMIT = 100;

async function analyzeNewLeads(ctx: TenantContext): Promise<number> {
  const limit = await dailyAnalysisLimit(ctx);
  const { data: leads } = await db.getLeads(ctx, { status: 'new', per_page: limit });

  for (const lead of leads) {
    // Each analysis can take a minute; a fresh context keeps the scoped
    // token valid for the whole of this lead's writes.
    const leadCtx = renew(ctx);
    try {
      const signals = await analyzeLeadSignals(leadCtx, {
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
        source_count: lead.source_count ?? 1,
      });

      const writeCtx = renew(ctx);
      const existing = await db.getLeadSignals(writeCtx, lead.id);
      await persistAnalysis(writeCtx, lead, existing, signals);
    } catch (err) {
      console.error(`[CRON] Failed to analyze lead ${lead.id}:`, (err as Error).message);
    }
  }
  return leads.length;
}

/**
 * Analyze each org's new leads. A scheduled run then drafts that org's
 * outreach as soon as its own analysis finishes, rather than at a fixed hour
 * every org's analysis may not have reached; the 08:00 outreach job stays as
 * a catch-up for anything still missing a draft.
 */
export async function runLeadAnalysis(trigger: CronTrigger = 'scheduled', only?: TenantContext): Promise<void> {
  await eachOrg(only, async (ctx) => {
    await withAudit(ctx, 'analyze_leads', trigger, () => analyzeNewLeads(ctx));
    if (trigger === 'scheduled') {
      await withAudit(renew(ctx), 'generate_outreach', trigger, () => draftOutreach(renew(ctx)));
    }
  });
}

/**
 * Rebuild the analysis shape `claudeService` expects from what was persisted.
 *
 * The scoring breakdown is not stored per-signal, so it comes back as zeroes —
 * the outreach prompt reads the pain points, angle and maturity, not the
 * breakdown. Lifted from routes/cron.ts so behaviour is unchanged.
 */
function signalToAnalysisResult(lead: Lead, sig: LeadSignal): SignalAnalysisResult {
  return {
    lead_score: lead.lead_score ?? 0,
    industry: lead.industry,
    likely_pain_points: sig.likely_pain_points ?? [],
    recommended_anta_service: sig.recommended_anta_service ?? '',
    outreach_angle: sig.outreach_angle ?? '',
    operational_maturity: sig.operational_maturity ?? '',
    growth_indicators: sig.growth_indicators ?? [],
    digital_maturity_score: sig.digital_maturity_score ?? 0,
    signal_type: sig.signal_type,
    confidence_score: sig.confidence_score ?? 0,
    scoring_breakdown: {
      company_size_score: 0, hiring_urgency_score: 0,
      complexity_score: 0, digital_score: 0,
    },
    scoring_rationale: '',
    tech_stack: sig.tech_stack ?? [],
    tech_gaps: sig.tech_gaps ?? [],
    verified_website: lead.website,
    contact: lead.contact_email ? {
      name: lead.contact_name ?? '',
      title: lead.contact_title ?? '',
      email: lead.contact_email,
      linkedin_url: lead.contact_linkedin_url ?? '',
      email_confidence: lead.contact_email_confidence ?? 'unknown',
    } : null,
  } as SignalAnalysisResult;
}

/** Draft an email for each of the org's analyzed leads (score 65+) that has none yet. */
async function draftOutreach(ctx: TenantContext): Promise<number> {
  const { data: leads } = await db.getLeads(ctx, { status: 'analyzed', min_score: 65, per_page: 50 });

  for (const lead of leads) {
    const leadCtx = renew(ctx);
    try {
      const signals = await db.getLeadSignals(leadCtx, lead.id);
      if (signals.length === 0) continue;

      const existing = await db.getOutreachMessages(leadCtx, lead.id);
      if (existing.length > 0) continue;

      const outreach = await generateOutreach(leadCtx, lead, signalToAnalysisResult(lead, signals[0]), 'email');
      await db.createOutreachMessage(renew(ctx), {
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
  return leads.length;
}

export async function runOutreachGeneration(trigger: CronTrigger = 'scheduled', only?: TenantContext): Promise<void> {
  await forEachOrg('generate_outreach', trigger, only, draftOutreach);
}

export async function pingSignalEngine(): Promise<void> {
  const ok = await healthCheck();
  console.log(`[CRON] Signal engine ping: ${ok ? 'alive' : 'did not respond'}`);
}
