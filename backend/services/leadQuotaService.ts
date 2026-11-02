import type { TenantContext } from './tenantContext';
import type { LeadQuota, QuotaPeriod, QuotaPeriodUsage } from '../../shared/types';

export type { LeadQuota, QuotaPeriod, QuotaPeriodUsage };

/**
 * The lead quota: how many leads an org may have analyzed for the first time
 * per day, week and month (organizations.lead_quota_*; NULL is no limit).
 *
 * A lead counts once, on its first analysis — leads.first_analyzed_at, which
 * the database sets and never moves. Re-analyzing a lead is free. Periods are
 * calendar periods in CRON_TIMEZONE: the day from local midnight, the week
 * from Monday, the month from the 1st.
 */

export const QUOTA_TIMEZONE = process.env.CRON_TIMEZONE ?? 'America/Detroit';

export class LeadQuotaReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadQuotaReachedError';
  }
}

// ---- calendar periods in a time zone ----

interface YMD { y: number; m: number; d: number }

function partsIn(instant: Date, tz: string): YMD & { weekday: number; hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map(p => [p.type, p.value]));
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

/** How far the zone's wall clock is ahead of UTC at `instantMs`. */
function offsetMs(instantMs: number, tz: string): number {
  const p = partsIn(new Date(instantMs), tz);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** Local midnight of a calendar date (day may overflow; Date.UTC normalizes it). */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second pass lands on the right side of a DST change
  return new Date(t);
}

export function periodBounds(now: Date, tz: string): Record<QuotaPeriod, { start: Date; end: Date }> {
  const { y, m, d, weekday } = partsIn(now, tz);
  const sinceMonday = (weekday + 6) % 7;
  return {
    day:   { start: zonedMidnight(y, m, d, tz), end: zonedMidnight(y, m, d + 1, tz) },
    week:  { start: zonedMidnight(y, m, d - sinceMonday, tz), end: zonedMidnight(y, m, d - sinceMonday + 7, tz) },
    month: { start: zonedMidnight(y, m, 1, tz), end: zonedMidnight(y, m + 1, 1, tz) },
  };
}

// ---- quota ----

const COLUMN: Record<QuotaPeriod, string> = {
  day: 'lead_quota_daily', week: 'lead_quota_weekly', month: 'lead_quota_monthly',
};
const PERIODS: QuotaPeriod[] = ['day', 'week', 'month'];

export async function getLeadQuota(ctx: TenantContext, now: Date = new Date()): Promise<LeadQuota> {
  const { data: org, error } = await ctx.db
    .from('organizations').select(Object.values(COLUMN).join(', ')).eq('id', ctx.orgId).single();
  if (error) throw new Error(`getLeadQuota: ${error.message}`);
  const limits = org as unknown as Record<string, number | null>;

  const bounds = periodBounds(now, QUOTA_TIMEZONE);
  const periods = await Promise.all(PERIODS.map(async (period): Promise<QuotaPeriodUsage> => {
    const { count, error: countError } = await ctx.db
      .from('leads').select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId)
      .gte('first_analyzed_at', bounds[period].start.toISOString());
    if (countError) throw new Error(`getLeadQuota: ${countError.message}`);
    const limit = limits[COLUMN[period]] ?? null;
    const used = count ?? 0;
    return {
      period, limit, used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      resets_at: bounds[period].end.toISOString(),
    };
  }));

  const limited = periods.filter(p => p.remaining !== null);
  const remaining = limited.length ? Math.min(...limited.map(p => p.remaining as number)) : null;
  const exhausted = periods.filter(p => p.remaining === 0);
  const blocked_until = exhausted.length
    ? exhausted.map(p => p.resets_at).sort().at(-1) as string
    : null;
  return { timezone: QUOTA_TIMEZONE, periods, remaining, blocked_until };
}

const LABEL: Record<QuotaPeriod, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

export function quotaMessage(quota: LeadQuota): string {
  const hit = quota.periods.filter(p => p.remaining === 0).sort((a, b) => b.resets_at.localeCompare(a.resets_at))[0];
  if (!hit) return 'Lead limit reached.';
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: quota.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(hit.resets_at));
  return `${LABEL[hit.period]} lead limit reached (${hit.used} of ${hit.limit}). `
    + `New leads can be analyzed again from ${when}.`;
}

/**
 * Refuse the first analysis of a lead once the quota is used up. A lead that
 * was analyzed before is always allowed: re-analysis is free.
 */
export async function assertCanAnalyze(
  ctx: TenantContext, lead: { first_analyzed_at?: string | null; analyzed_at?: string | null },
): Promise<void> {
  if (lead.first_analyzed_at || lead.analyzed_at) return;
  const quota = await getLeadQuota(ctx);
  if (quota.remaining === 0) throw new LeadQuotaReachedError(quotaMessage(quota));
}
