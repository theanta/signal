import type {
  Lead, LeadFilters, LeadSignal, LeadScore,
  OutreachMessage, ScrapingLog, PaginatedResponse, DashboardMetrics, CronJobLog,
  Job, JobFilters, JobWithIntel, JobSignal, JobSubmission,
} from '../../shared/types';
import type { TenantContext } from './tenantContext';

// No ambient client and no exported client. Every function below is reachable
// only with a TenantContext, whose `db` already carries an org-scoped JWT — so
// the app-layer `.eq('org_id', ...)` filter and the RLS policy are always
// looking at the same org.

/**
 * Drop a caller-supplied `org_id` from a write payload.
 *
 * An update may not move a row between tenants — not even into its own — and
 * an insert's org comes from the context, never from the body. Every write
 * below funnels through here so the six call sites cannot drift apart.
 */
function stripOrgId<T extends object>(row: T): Omit<T, 'org_id'> {
  const safe = { ...row } as T & { org_id?: unknown };
  delete safe.org_id;
  return safe;
}

// ============================================================
// LEADS
// ============================================================

export async function getLeads(ctx: TenantContext, filters: LeadFilters = {}): Promise<PaginatedResponse<Lead>> {
  const {
    status, source, sources, min_score, industry, location, search,
    page = 1, per_page = 25,
    sort_by = 'created_at', sort_order = 'desc',
  } = filters;

  let query = ctx.db.from('leads').select('*', { count: 'exact' }).eq('org_id', ctx.orgId);

  if (status) query = query.eq('status', status);
  if (sources && sources.length > 0) {
    query = query.in('source', sources);
  } else if (source) {
    query = query.eq('source', source);
  }
  if (min_score !== undefined) query = query.gte('lead_score', min_score);
  if (industry) query = query.ilike('industry', `%${industry}%`);
  if (location) query = query.ilike('location', `%${location}%`);
  if (search) {
    query = query.or(`company_name.ilike.%${search}%,description.ilike.%${search}%`);
  }

  query = query.order(sort_by, { ascending: sort_order === 'asc' });
  query = query.range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`getLeads: ${error.message}`);

  return {
    data: (data ?? []) as Lead[],
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  };
}

export async function getLeadById(ctx: TenantContext, id: string): Promise<Lead | null> {
  const { data, error } = await ctx.db
    .from('leads').select('*').eq('id', id).eq('org_id', ctx.orgId).single();
  if (error) return null;
  return data as Lead;
}

export async function createLead(ctx: TenantContext, lead: Partial<Lead>): Promise<Lead> {
  // org_id is set from the context last, so a caller-supplied org_id — from a
  // request body, or a stale object copied between tenants — cannot win.
  const { data, error } = await ctx.db
    .from('leads').insert({ ...lead, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createLead: ${error.message}`);
  return data as Lead;
}

export async function updateLead(ctx: TenantContext, id: string, updates: Partial<Lead>): Promise<Lead> {
  const { data, error } = await ctx.db
    .from('leads').update(stripOrgId(updates)).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateLead: ${error.message}`);
  return data as Lead;
}

export async function upsertLeadByWebsite(
  ctx: TenantContext, lead: Partial<Lead>,
): Promise<{ lead: Lead; isNew: boolean }> {
  if (lead.website) {
    // Scoped by org: two tenants scraping the same company each keep their own
    // lead row, and neither can silently overwrite the other's.
    const { data: existing } = await ctx.db
      .from('leads').select('id').eq('website', lead.website).eq('org_id', ctx.orgId).single();
    if (existing) {
      const updated = await updateLead(ctx, existing.id, {
        ...lead, updated_at: new Date().toISOString(),
      });
      return { lead: updated, isNew: false };
    }
  }
  const created = await createLead(ctx, lead);
  return { lead: created, isNew: true };
}

// ============================================================
// JOBS
// ============================================================

export async function getJobs(ctx: TenantContext, filters: JobFilters = {}): Promise<PaginatedResponse<Job>> {
  const {
    status, verdict, search, location, source, posted_within_days, technology,
    page = 1, per_page = 25,
    sort_by = 'created_at', sort_order = 'desc',
  } = filters;

  let query = ctx.db.from('jobs').select('*', { count: 'exact' }).eq('org_id', ctx.orgId);

  if (status) query = query.eq('status', status);
  if (verdict) query = query.eq('verdict', verdict);
  if (source) query = query.eq('source', source);
  if (location) query = query.ilike('location', `%${location}%`);
  if (search) {
    query = query.or(`company_name.ilike.%${search}%,job_title.ilike.%${search}%,description.ilike.%${search}%`);
  }
  if (posted_within_days) {
    const cutoff = new Date(Date.now() - posted_within_days * 86_400_000).toISOString();
    // Jobs without a parsed posted_at fall back to when we scraped them
    query = query.or(`posted_at.gte.${cutoff},and(posted_at.is.null,created_at.gte.${cutoff})`);
  }
  if (technology) {
    // Tags arrive lowercase from remoteok/remotive but arbitrary-case from
    // config, and Postgres array contains is case-sensitive — try variants.
    const t = technology.trim().replace(/["{},]/g, '');
    if (t) {
      const variants = [...new Set([t, t.toLowerCase(), t.toUpperCase(), t[0].toUpperCase() + t.slice(1).toLowerCase()])];
      query = query.or(variants.map(v => `technologies.cs.{"${v}"}`).join(','));
    }
  }

  query = query.order(sort_by, { ascending: sort_order === 'asc', nullsFirst: false });
  query = query.range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`getJobs: ${error.message}`);

  return {
    data: (data ?? []) as Job[],
    total: count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  };
}

export async function getJobById(ctx: TenantContext, id: string): Promise<Job | null> {
  const { data, error } = await ctx.db
    .from('jobs').select('*').eq('id', id).eq('org_id', ctx.orgId).single();
  if (error) return null;
  return data as Job;
}

// Tolerates the table not existing yet (job_signals / job_submissions
// migrations pending) — the detail page degrades to empty sections.
async function safeList<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

export async function getJobWithIntel(ctx: TenantContext, id: string): Promise<JobWithIntel | null> {
  const job = await getJobById(ctx, id);
  if (!job) return null;

  const [signals, submissions, companyJobs] = await Promise.all([
    safeList<JobSignal>(
      ctx.db.from('job_signals').select('*')
        .eq('job_id', id).eq('org_id', ctx.orgId)
        .order('created_at', { ascending: false }),
    ),
    safeList<JobSubmission>(
      ctx.db.from('job_submissions').select('*')
        .eq('job_id', id).eq('org_id', ctx.orgId)
        .order('submitted_at', { ascending: false }),
    ),
    // Company-name matching across the whole table is the leak this scope
    // closes: two tenants hiring at the same company must not see each
    // other's postings in "related".
    safeList<Job>(
      ctx.db.from('jobs').select('*')
        .eq('org_id', ctx.orgId)
        .eq('company_name', job.company_name).neq('id', id)
        .order('created_at', { ascending: false }).limit(10),
    ),
  ]);

  const companyJobIds = companyJobs.map(j => j.id);
  const [companySubmissions, leadRows] = await Promise.all([
    companyJobIds.length
      ? safeList<JobSubmission>(
          ctx.db.from('job_submissions').select('*')
            .eq('org_id', ctx.orgId)
            .in('job_id', companyJobIds).order('submitted_at', { ascending: false }),
        )
      : Promise.resolve([] as JobSubmission[]),
    safeList<{ id: string }>(
      ctx.db.from('leads').select('id')
        .eq('org_id', ctx.orgId)
        .ilike('company_name', job.company_name).limit(1),
    ),
  ]);

  return {
    ...job,
    signals,
    submissions,
    related: {
      company_jobs: companyJobs,
      company_submissions: companySubmissions,
      lead_id: job.converted_lead_id ?? leadRows[0]?.id,
    },
  };
}

export async function updateJob(ctx: TenantContext, id: string, updates: Partial<Job>): Promise<Job> {
  const { data, error } = await ctx.db
    .from('jobs').update(stripOrgId(updates)).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateJob: ${error.message}`);
  return data as Job;
}

export async function createJobSignal(ctx: TenantContext, signal: Partial<JobSignal>): Promise<JobSignal> {
  const { data, error } = await ctx.db
    .from('job_signals').insert({ ...stripOrgId(signal), org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createJobSignal: ${error.message}`);
  return data as JobSignal;
}

export async function createJobSubmission(ctx: TenantContext, sub: Partial<JobSubmission>): Promise<JobSubmission> {
  const { data, error } = await ctx.db
    .from('job_submissions').insert({ ...stripOrgId(sub), org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createJobSubmission: ${error.message}`);
  return data as JobSubmission;
}

export async function updateJobSubmission(
  ctx: TenantContext, id: string, updates: Partial<JobSubmission>,
): Promise<JobSubmission> {
  const { data, error } = await ctx.db
    .from('job_submissions').update(stripOrgId(updates))
    .eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateJobSubmission: ${error.message}`);
  return data as JobSubmission;
}

export async function deleteJobSubmission(ctx: TenantContext, id: string): Promise<void> {
  const { error } = await ctx.db
    .from('job_submissions').delete().eq('id', id).eq('org_id', ctx.orgId);
  if (error) throw new Error(`deleteJobSubmission: ${error.message}`);
}

export async function convertJobToLead(ctx: TenantContext, job: Job): Promise<Lead> {
  const lead = await createLead(ctx, {
    company_name: job.company_name,
    location: job.location,
    job_title: job.job_title,
    description: job.description,
    source_url: job.source_url,
    source: 'manual',
    hiring_signal: job.job_title ? `Hiring ${job.job_title} (remote)` : undefined,
  });
  await updateJob(ctx, job.id, { status: 'converted', converted_lead_id: lead.id });
  return lead;
}

// ============================================================
// SIGNALS
// ============================================================

export async function createLeadSignal(ctx: TenantContext, signal: Partial<LeadSignal>): Promise<LeadSignal> {
  const { data, error } = await ctx.db
    .from('lead_signals').insert({ ...signal, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createLeadSignal: ${error.message}`);
  return data as LeadSignal;
}

export async function updateLeadSignal(
  ctx: TenantContext, id: string, updates: Partial<LeadSignal>,
): Promise<LeadSignal> {
  const { data, error } = await ctx.db
    .from('lead_signals').update(stripOrgId(updates)).eq('id', id).eq('org_id', ctx.orgId).select().single();
  if (error) throw new Error(`updateLeadSignal: ${error.message}`);
  return data as LeadSignal;
}

export async function getLeadSignals(ctx: TenantContext, leadId: string): Promise<LeadSignal[]> {
  const { data, error } = await ctx.db
    .from('lead_signals').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('detected_at', { ascending: false });
  if (error) throw new Error(`getLeadSignals: ${error.message}`);
  return (data ?? []) as LeadSignal[];
}

// ============================================================
// SCORES
// ============================================================

export async function createLeadScore(ctx: TenantContext, score: Partial<LeadScore>): Promise<LeadScore> {
  const { data, error } = await ctx.db
    .from('lead_scores').insert({ ...score, org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createLeadScore: ${error.message}`);
  return data as LeadScore;
}

export async function upsertLeadScore(
  ctx: TenantContext, score: Partial<LeadScore> & { lead_id: string },
): Promise<LeadScore> {
  const existing = await getLeadScore(ctx, score.lead_id);
  if (existing) {
    const { data, error } = await ctx.db
      .from('lead_scores').update(stripOrgId(score)).eq('id', existing.id).eq('org_id', ctx.orgId).select().single();
    if (error) throw new Error(`upsertLeadScore: ${error.message}`);
    return data as LeadScore;
  }
  return createLeadScore(ctx, score);
}

export async function getLeadScore(ctx: TenantContext, leadId: string): Promise<LeadScore | null> {
  const { data } = await ctx.db
    .from('lead_scores').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('scored_at', { ascending: false }).limit(1).single();
  return data as LeadScore | null;
}

export async function getScorePercentile(ctx: TenantContext, score: number): Promise<number> {
  const { data, error } = await ctx.db
    .from('lead_scores').select('overall_score').eq('org_id', ctx.orgId);
  if (error || !data || data.length < 2) return 50;
  const scores = (data as { overall_score: number }[]).map(r => r.overall_score);
  const below = scores.filter(s => s < score).length;
  return Math.round((below / scores.length) * 100);
}

// ============================================================
// OUTREACH
// ============================================================

export async function createOutreachMessage(
  ctx: TenantContext, msg: Partial<OutreachMessage>,
): Promise<OutreachMessage> {
  const { data, error } = await ctx.db
    .from('outreach_messages').insert({ ...stripOrgId(msg), org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createOutreachMessage: ${error.message}`);
  return data as OutreachMessage;
}

export async function getOutreachMessages(ctx: TenantContext, leadId: string): Promise<OutreachMessage[]> {
  const { data, error } = await ctx.db
    .from('outreach_messages').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getOutreachMessages: ${error.message}`);
  return (data ?? []) as OutreachMessage[];
}

/** The outreach queue view: leads worth contacting, with their drafted messages. */
export async function getOutreachQueue(ctx: TenantContext): Promise<
  (Pick<Lead, 'id' | 'org_id' | 'company_name' | 'location' | 'industry' | 'lead_score' | 'status' | 'website'>
    & { outreach_messages: OutreachMessage[] })[]
> {
  const { data, error } = await ctx.db
    .from('leads')
    .select(`
      id, org_id, company_name, location, industry, lead_score, status, website, linkedin_url,
      outreach_messages(id, channel, subject, body, created_at, is_selected)
    `)
    .eq('org_id', ctx.orgId)
    .in('status', ['analyzed', 'new'])
    .gte('lead_score', 50)
    .order('lead_score', { ascending: false })
    .limit(50);
  if (error) throw new Error(`getOutreachQueue: ${error.message}`);
  return (data ?? []) as never;
}

export async function createOutreachHistory(
  ctx: TenantContext, row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.db
    .from('outreach_history').insert({ ...stripOrgId(row), org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createOutreachHistory: ${error.message}`);
  return data as Record<string, unknown>;
}

// ============================================================
// SCRAPING LOGS
// ============================================================

export async function createScrapingLog(ctx: TenantContext, log: Partial<ScrapingLog>): Promise<ScrapingLog> {
  const { data, error } = await ctx.db
    .from('scraping_logs').insert({ ...stripOrgId(log), org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createScrapingLog: ${error.message}`);
  return data as ScrapingLog;
}

export async function updateScrapingLog(
  ctx: TenantContext, id: string, updates: Partial<ScrapingLog>,
): Promise<void> {
  await ctx.db.from('scraping_logs').update(stripOrgId(updates)).eq('id', id).eq('org_id', ctx.orgId);
}

export async function getScrapingLogs(ctx: TenantContext, limit = 20): Promise<ScrapingLog[]> {
  const { data, error } = await ctx.db
    .from('scraping_logs').select('*').eq('org_id', ctx.orgId)
    .order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`getScrapingLogs: ${error.message}`);
  return (data ?? []) as ScrapingLog[];
}

// ============================================================
// CRON JOB LOGS
// ============================================================

export async function createCronJobLog(
  ctx: TenantContext, log: Omit<CronJobLog, 'id' | 'created_at' | 'org_id'>,
): Promise<CronJobLog> {
  const { data, error } = await ctx.db
    .from('cron_job_logs').insert({ ...stripOrgId(log), org_id: ctx.orgId }).select().single();
  if (error) throw new Error(`createCronJobLog: ${error.message}`);
  return data as CronJobLog;
}

export async function updateCronJobLog(
  ctx: TenantContext, id: string, updates: Partial<CronJobLog>,
): Promise<void> {
  await ctx.db.from('cron_job_logs').update(stripOrgId(updates)).eq('id', id).eq('org_id', ctx.orgId);
}

export async function getCronJobLogs(ctx: TenantContext, limit = 40): Promise<CronJobLog[]> {
  const { data, error } = await ctx.db
    .from('cron_job_logs').select('*').eq('org_id', ctx.orgId)
    .order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`getCronJobLogs: ${error.message}`);
  return (data ?? []) as CronJobLog[];
}

// ============================================================
// DASHBOARD METRICS
// ============================================================

export async function getDashboardMetrics(ctx: TenantContext): Promise<DashboardMetrics> {
  const scoped = () => ctx.db.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', ctx.orgId);

  const [
    { count: total },
    { count: hot },
    { count: contacted },
    { count: replied },
    { count: meetings },
    { count: clients },
    { data: avgData },
  ] = await Promise.all([
    scoped(),
    scoped().gte('lead_score', 70),
    scoped().eq('status', 'contacted'),
    scoped().eq('status', 'replied'),
    scoped().eq('status', 'meeting'),
    scoped().eq('status', 'client'),
    ctx.db.from('leads').select('lead_score').eq('org_id', ctx.orgId).not('lead_score', 'is', null),
  ]);

  const scores = (avgData ?? []).map((r: { lead_score: number }) => r.lead_score).filter(Boolean);
  const avg_score = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: new_today } = await scoped().gte('created_at', today.toISOString());

  return {
    total_leads: total ?? 0,
    hot_leads: hot ?? 0,
    contacted: contacted ?? 0,
    replied: replied ?? 0,
    meetings: meetings ?? 0,
    clients: clients ?? 0,
    new_today: new_today ?? 0,
    avg_score,
  };
}

/** Rows behind the pipeline chart. Shaping stays in the route; scoping lives here. */
export async function getPipelineRows(ctx: TenantContext): Promise<
  Pick<Lead, 'id' | 'org_id' | 'company_name' | 'location' | 'industry' | 'website' | 'lead_score' | 'status' | 'created_at'>[]
> {
  const { data, error } = await ctx.db
    .from('leads')
    .select('id, org_id, company_name, location, industry, website, lead_score, status, created_at')
    .eq('org_id', ctx.orgId);
  if (error) throw new Error(`getPipelineRows: ${error.message}`);
  return (data ?? []) as never;
}

export async function getHotLeads(ctx: TenantContext, limit = 10): Promise<Lead[]> {
  const { data, error } = await ctx.db
    .from('leads').select('*').eq('org_id', ctx.orgId)
    .gte('lead_score', 70).order('lead_score', { ascending: false }).limit(limit);
  if (error) throw new Error(`getHotLeads: ${error.message}`);
  return (data ?? []) as Lead[];
}
