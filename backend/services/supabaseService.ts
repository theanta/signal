import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Lead, LeadFilters, LeadSignal, LeadScore,
  OutreachMessage, ScrapingLog, PaginatedResponse, DashboardMetrics, CronJobLog,
  Job, JobFilters, JobWithIntel, JobSignal, JobSubmission,
} from '../../shared/types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ============================================================
// LEADS
// ============================================================

export async function getLeads(filters: LeadFilters = {}): Promise<PaginatedResponse<Lead>> {
  const {
    status, source, sources, min_score, industry, location, search,
    page = 1, per_page = 25,
    sort_by = 'created_at', sort_order = 'desc',
  } = filters;

  let query = supabase.from('leads').select('*', { count: 'exact' });

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

export async function getLeadById(id: string): Promise<Lead | null> {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).single();
  if (error) return null;
  return data as Lead;
}

export async function createLead(lead: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase.from('leads').insert(lead).select().single();
  if (error) throw new Error(`createLead: ${error.message}`);
  return data as Lead;
}

export async function updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads').update(updates).eq('id', id).select().single();
  if (error) throw new Error(`updateLead: ${error.message}`);
  return data as Lead;
}

export async function upsertLeadByWebsite(lead: Partial<Lead>): Promise<{ lead: Lead; isNew: boolean }> {
  if (lead.website) {
    const { data: existing } = await supabase
      .from('leads').select('id').eq('website', lead.website).single();
    if (existing) {
      const updated = await updateLead(existing.id, { ...lead, updated_at: new Date().toISOString() });
      return { lead: updated, isNew: false };
    }
  }
  const created = await createLead(lead);
  return { lead: created, isNew: true };
}

// ============================================================
// JOBS
// ============================================================

export async function getJobs(filters: JobFilters = {}): Promise<PaginatedResponse<Job>> {
  const {
    status, verdict, search, location, source, posted_within_days, technology,
    page = 1, per_page = 25,
    sort_by = 'created_at', sort_order = 'desc',
  } = filters;

  let query = supabase.from('jobs').select('*', { count: 'exact' });

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

export async function getJobById(id: string): Promise<Job | null> {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single();
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

export async function getJobWithIntel(id: string): Promise<JobWithIntel | null> {
  const job = await getJobById(id);
  if (!job) return null;

  const [signals, submissions, companyJobs] = await Promise.all([
    safeList<JobSignal>(
      supabase.from('job_signals').select('*').eq('job_id', id).order('created_at', { ascending: false }),
    ),
    safeList<JobSubmission>(
      supabase.from('job_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false }),
    ),
    safeList<Job>(
      supabase.from('jobs').select('*')
        .eq('company_name', job.company_name).neq('id', id)
        .order('created_at', { ascending: false }).limit(10),
    ),
  ]);

  const companyJobIds = companyJobs.map(j => j.id);
  const [companySubmissions, leadRows] = await Promise.all([
    companyJobIds.length
      ? safeList<JobSubmission>(
          supabase.from('job_submissions').select('*')
            .in('job_id', companyJobIds).order('submitted_at', { ascending: false }),
        )
      : Promise.resolve([] as JobSubmission[]),
    safeList<{ id: string }>(
      supabase.from('leads').select('id').ilike('company_name', job.company_name).limit(1),
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

export async function updateJob(id: string, updates: Partial<Job>): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs').update(updates).eq('id', id).select().single();
  if (error) throw new Error(`updateJob: ${error.message}`);
  return data as Job;
}

export async function createJobSignal(signal: Partial<JobSignal>): Promise<JobSignal> {
  const { data, error } = await supabase.from('job_signals').insert(signal).select().single();
  if (error) throw new Error(`createJobSignal: ${error.message}`);
  return data as JobSignal;
}

export async function createJobSubmission(sub: Partial<JobSubmission>): Promise<JobSubmission> {
  const { data, error } = await supabase.from('job_submissions').insert(sub).select().single();
  if (error) throw new Error(`createJobSubmission: ${error.message}`);
  return data as JobSubmission;
}

export async function updateJobSubmission(id: string, updates: Partial<JobSubmission>): Promise<JobSubmission> {
  const { data, error } = await supabase
    .from('job_submissions').update(updates).eq('id', id).select().single();
  if (error) throw new Error(`updateJobSubmission: ${error.message}`);
  return data as JobSubmission;
}

export async function deleteJobSubmission(id: string): Promise<void> {
  const { error } = await supabase.from('job_submissions').delete().eq('id', id);
  if (error) throw new Error(`deleteJobSubmission: ${error.message}`);
}

export async function convertJobToLead(job: Job): Promise<Lead> {
  const lead = await createLead({
    company_name: job.company_name,
    location: job.location,
    job_title: job.job_title,
    description: job.description,
    source_url: job.source_url,
    source: 'manual',
    hiring_signal: job.job_title ? `Hiring ${job.job_title} (remote)` : undefined,
  });
  await updateJob(job.id, { status: 'converted', converted_lead_id: lead.id });
  return lead;
}

// ============================================================
// SIGNALS
// ============================================================

export async function createLeadSignal(signal: Partial<LeadSignal>): Promise<LeadSignal> {
  const { data, error } = await supabase.from('lead_signals').insert(signal).select().single();
  if (error) throw new Error(`createLeadSignal: ${error.message}`);
  return data as LeadSignal;
}

export async function updateLeadSignal(id: string, updates: Partial<LeadSignal>): Promise<LeadSignal> {
  const { data, error } = await supabase.from('lead_signals').update(updates).eq('id', id).select().single();
  if (error) throw new Error(`updateLeadSignal: ${error.message}`);
  return data as LeadSignal;
}

export async function getLeadSignals(leadId: string): Promise<LeadSignal[]> {
  const { data, error } = await supabase.from('lead_signals').select('*').eq('lead_id', leadId).order('detected_at', { ascending: false });
  if (error) throw new Error(`getLeadSignals: ${error.message}`);
  return (data ?? []) as LeadSignal[];
}

// ============================================================
// SCORES
// ============================================================

export async function createLeadScore(score: Partial<LeadScore>): Promise<LeadScore> {
  const { data, error } = await supabase.from('lead_scores').insert(score).select().single();
  if (error) throw new Error(`createLeadScore: ${error.message}`);
  return data as LeadScore;
}

export async function upsertLeadScore(score: Partial<LeadScore> & { lead_id: string }): Promise<LeadScore> {
  const existing = await getLeadScore(score.lead_id);
  if (existing) {
    const { data, error } = await supabase.from('lead_scores').update(score).eq('id', existing.id).select().single();
    if (error) throw new Error(`upsertLeadScore: ${error.message}`);
    return data as LeadScore;
  }
  return createLeadScore(score);
}

export async function getLeadScore(leadId: string): Promise<LeadScore | null> {
  const { data } = await supabase
    .from('lead_scores').select('*').eq('lead_id', leadId).order('scored_at', { ascending: false }).limit(1).single();
  return data as LeadScore | null;
}

export async function getScorePercentile(score: number): Promise<number> {
  const { data, error } = await supabase.from('lead_scores').select('overall_score');
  if (error || !data || data.length < 2) return 50;
  const scores = (data as { overall_score: number }[]).map(r => r.overall_score);
  const below = scores.filter(s => s < score).length;
  return Math.round((below / scores.length) * 100);
}

// ============================================================
// OUTREACH
// ============================================================

export async function createOutreachMessage(msg: Partial<OutreachMessage>): Promise<OutreachMessage> {
  const { data, error } = await supabase.from('outreach_messages').insert(msg).select().single();
  if (error) throw new Error(`createOutreachMessage: ${error.message}`);
  return data as OutreachMessage;
}

export async function getOutreachMessages(leadId: string): Promise<OutreachMessage[]> {
  const { data, error } = await supabase
    .from('outreach_messages').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
  if (error) throw new Error(`getOutreachMessages: ${error.message}`);
  return (data ?? []) as OutreachMessage[];
}

// ============================================================
// SCRAPING LOGS
// ============================================================

export async function createScrapingLog(log: Partial<ScrapingLog>): Promise<ScrapingLog> {
  const { data, error } = await supabase.from('scraping_logs').insert(log).select().single();
  if (error) throw new Error(`createScrapingLog: ${error.message}`);
  return data as ScrapingLog;
}

export async function updateScrapingLog(id: string, updates: Partial<ScrapingLog>): Promise<void> {
  await supabase.from('scraping_logs').update(updates).eq('id', id);
}

export async function getScrapingLogs(limit = 20): Promise<ScrapingLog[]> {
  const { data, error } = await supabase
    .from('scraping_logs').select('*').order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`getScrapingLogs: ${error.message}`);
  return (data ?? []) as ScrapingLog[];
}

// ============================================================
// CRON JOB LOGS
// ============================================================

export async function createCronJobLog(log: Omit<CronJobLog, 'id' | 'created_at'>): Promise<CronJobLog> {
  const { data, error } = await supabase.from('cron_job_logs').insert(log).select().single();
  if (error) throw new Error(`createCronJobLog: ${error.message}`);
  return data as CronJobLog;
}

export async function updateCronJobLog(id: string, updates: Partial<CronJobLog>): Promise<void> {
  await supabase.from('cron_job_logs').update(updates).eq('id', id);
}

export async function getCronJobLogs(limit = 40): Promise<CronJobLog[]> {
  const { data, error } = await supabase
    .from('cron_job_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getCronJobLogs: ${error.message}`);
  return (data ?? []) as CronJobLog[];
}

// ============================================================
// DASHBOARD METRICS
// ============================================================

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [
    { count: total },
    { count: hot },
    { count: contacted },
    { count: replied },
    { count: meetings },
    { count: clients },
    { data: avgData },
  ] = await Promise.all([
    supabase.from('leads').select('*', { count: 'exact', head: true }),
    supabase.from('leads').select('*', { count: 'exact', head: true }).gte('lead_score', 70),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'contacted'),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'replied'),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'meeting'),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'client'),
    supabase.from('leads').select('lead_score').not('lead_score', 'is', null),
  ]);

  const scores = (avgData ?? []).map((r: { lead_score: number }) => r.lead_score).filter(Boolean);
  const avg_score = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: new_today } = await supabase
    .from('leads').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString());

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
