import type {
  Lead, LeadFilters, LeadSignal, LeadScore,
  OutreachMessage, OutreachHistory, ScrapingLog, PaginatedResponse, DashboardMetrics, CronJobLog,
  PipelineSummary,
} from '../../shared/types';
import type { TenantContext } from './tenantContext';
import { periodBounds, QUOTA_TIMEZONE } from './leadQuotaService';

// No ambient client and no exported client. Every function below is reachable
// only with a TenantContext, whose `db` already carries an org-scoped JWT — so
// the app-layer `.eq('org_id', ...)` filter and the RLS policy are always
// looking at the same org.

/**
 * Drop a caller-supplied `org_id` from a write payload.
 *
 * An update may not move a row between tenants, not even its own, so a
 * caller-supplied org_id is dropped rather than forwarded. All five updates
 * below funnel through here so the call sites cannot drift apart.
 *
 * Inserts do not need it — they spread the payload first and set
 * `org_id: ctx.orgId` last, so the context always wins. createOutreachHistory
 * is the exception: its payload is an untyped req.body passed straight
 * through, and stripping first means the org can never reach the insert at
 * all, rather than being overwritten on the way past.
 */
/**
 * An id-addressed write matched no row in the caller's org: the id does not
 * exist, or it belongs to another org. The two are deliberately one error —
 * telling them apart would confirm that another tenant's id exists.
 */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

// PostgREST's code for .single() matching zero rows.
const NO_ROWS = 'PGRST116';
// Postgres' code for text that is not a valid UUID.
const BAD_UUID = '22P02';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);

/** A value quoted for PostgREST's or()/and() filter syntax. */
export function orFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

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
    // Quoted, so a comma or bracket in the search text stays text instead of
    // breaking PostgREST's or() syntax.
    const pattern = orFilterValue(`%${search}%`);
    query = query.or(`company_name.ilike.${pattern},description.ilike.${pattern}`);
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
  // Only "no such lead in this org" is a miss; a database failure is an error,
  // not a 404.
  // (22P02: the id is not a UUID at all, so no lead can have it.)
  if (error?.code === NO_ROWS || error?.code === BAD_UUID) return null;
  if (error) throw new Error(`getLeadById: ${error.message}`);
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
  if (error?.code === NO_ROWS) throw new NotFoundError('Lead');
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
  if (error?.code === NO_ROWS) throw new NotFoundError('Lead signal');
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

/** Where the lead's score sits among the org's scores, 0-100 (50 with nothing to compare). */
export async function getScorePercentile(ctx: TenantContext, leadId: string): Promise<number> {
  const { data, error } = await ctx.db.rpc('lead_score_percentile', { p_org: ctx.orgId, p_lead: leadId });
  if (error) throw new Error(`getScorePercentile: ${error.message}`);
  return (data as number | null) ?? 50;
}

// ============================================================
// OUTREACH
// ============================================================

export async function createOutreachMessage(
  ctx: TenantContext, msg: Partial<OutreachMessage>,
): Promise<OutreachMessage> {
  const { data, error } = await ctx.db
    .from('outreach_messages').insert({ ...msg, org_id: ctx.orgId }).select().single();
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

export async function getOutreachHistory(ctx: TenantContext, leadId: string): Promise<OutreachHistory[]> {
  const { data, error } = await ctx.db
    .from('outreach_history').select('*')
    .eq('lead_id', leadId).eq('org_id', ctx.orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getOutreachHistory: ${error.message}`);
  return (data ?? []) as OutreachHistory[];
}

// ============================================================
// SCRAPING LOGS
// ============================================================

export async function createScrapingLog(ctx: TenantContext, log: Partial<ScrapingLog>): Promise<ScrapingLog> {
  const { data, error } = await ctx.db
    .from('scraping_logs').insert({ ...log, org_id: ctx.orgId }).select().single();
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
    .from('cron_job_logs').insert({ ...log, org_id: ctx.orgId }).select().single();
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
  // "New today" counts from midnight in the agency's time zone, not the server's.
  const since = periodBounds(new Date(), QUOTA_TIMEZONE).day.start.toISOString();
  const { data, error } = await ctx.db.rpc('dashboard_metrics', { p_org: ctx.orgId, p_since: since });
  if (error) throw new Error(`getDashboardMetrics: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<keyof DashboardMetrics, number | null> | undefined;
  const n = (k: keyof DashboardMetrics) => Number(row?.[k] ?? 0);
  return {
    total_leads: n('total_leads'),
    hot_leads: n('hot_leads'),
    contacted: n('contacted'),
    replied: n('replied'),
    meetings: n('meetings'),
    clients: n('clients'),
    new_today: n('new_today'),
    avg_score: n('avg_score'),
  };
}

/** Lead count, average score and newest lead per status. */
export async function getPipelineSummary(ctx: TenantContext): Promise<PipelineSummary[]> {
  const { data, error } = await ctx.db.rpc('lead_pipeline', { p_org: ctx.orgId });
  if (error) throw new Error(`getPipelineSummary: ${error.message}`);
  return ((data ?? []) as { status: PipelineSummary['status']; count: number; avg_score: number; last_added: string | null }[])
    .map(r => ({ status: r.status, count: Number(r.count), avg_score: Number(r.avg_score), last_added: r.last_added ?? '' }));
}

export async function getHotLeads(ctx: TenantContext, limit = 10): Promise<Lead[]> {
  const { data, error } = await ctx.db
    .from('leads').select('*').eq('org_id', ctx.orgId)
    .gte('lead_score', 70).order('lead_score', { ascending: false }).limit(limit);
  if (error) throw new Error(`getHotLeads: ${error.message}`);
  return (data ?? []) as Lead[];
}
