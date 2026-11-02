import * as db from './supabaseService';
import { getConfig } from './configService';
import type { TenantContext } from './tenantContext';
import type {
  LeadScore, LeadStatus, OutreachHistory, RuleScore, ScoreFactor, ScoringWeights,
} from '../../shared/types';
import { DEFAULT_SCORING_WEIGHTS } from '../../shared/types';

/**
 * The scoring model's backend half. The engine scores fit, intent and the AI
 * judgment when it analyzes a lead; engagement can only be known here, from
 * outreach history and the lead's pipeline stage, and changes every time the
 * agency logs a send or a reply. The overall score is re-blended whenever it
 * does.
 */

type ScorePart = 'fit' | 'intent' | 'ai' | 'engagement';

/** The agency's weights, falling back per key to the defaults; negatives and
 *  junk are treated as zero / default. Mirrors scoring/model.py. */
export function normalizeWeights(weights?: Partial<ScoringWeights> | null): ScoringWeights {
  const out = { ...DEFAULT_SCORING_WEIGHTS };
  for (const k of Object.keys(DEFAULT_SCORING_WEIGHTS) as ScorePart[]) {
    const raw = (weights ?? {})[k];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    out[k] = Number.isFinite(n) ? Math.max(0, n) : DEFAULT_SCORING_WEIGHTS[k];
  }
  return out;
}

/** Weighted average of the parts that are present. A missing part (no
 *  engagement before outreach, no AI score when Groq was down) is left out and
 *  the other weights share its share. Mirrors scoring/model.py's blend(). */
export function blend(
  weights: Partial<ScoringWeights> | null | undefined,
  parts: Partial<Record<ScorePart, number | null | undefined>>,
): number {
  const w = normalizeWeights(weights);
  let total = 0;
  let sum = 0;
  for (const k of Object.keys(w) as ScorePart[]) {
    const v = parts[k];
    if (v === null || v === undefined || w[k] <= 0) continue;
    total += w[k];
    sum += w[k] * v;
  }
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round(sum / total)));
}

const STAGE_POINTS: Partial<Record<LeadStatus, number>> = { meeting: 20, proposal: 25, client: 30 };
const DAY_MS = 86_400_000;

/**
 * Engagement, 0-100, from what the prospect has done: sent 10, opened 20,
 * replied 40, and the pipeline stage (meeting 20, proposal 25, client 30).
 * Interest fades: no activity for 30 days halves it, 60 days quarters it
 * (a client never fades). Null until the first outreach is sent.
 */
export function engagementScore(
  history: OutreachHistory[], status: LeadStatus | undefined, now = new Date(),
): RuleScore | null {
  const sentRows = history.filter(h => h.sent_at || ['sent', 'opened', 'replied', 'bounced'].includes(h.status));
  const stagePoints = (status && STAGE_POINTS[status]) ?? 0;
  if (!sentRows.length && !stagePoints) return null;

  const opened = history.some(h => h.opened_at || h.status === 'opened' || h.status === 'replied');
  const replied = history.some(h => h.replied_at || h.status === 'replied');
  const allBounced = sentRows.length > 0 && sentRows.every(h => h.status === 'bounced');

  const factors: ScoreFactor[] = [
    { label: 'Outreach sent', points: sentRows.length && !allBounced ? 10 : 0, max: 10,
      detail: allBounced ? 'every send bounced' : sentRows.length ? `${sentRows.length} sent` : 'not sent yet' },
    { label: 'Opened', points: opened ? 20 : 0, max: 20, detail: opened ? 'opened' : 'not opened' },
    { label: 'Replied', points: replied ? 40 : 0, max: 40, detail: replied ? 'replied' : 'no reply' },
    { label: 'Pipeline stage', points: stagePoints, max: 30, detail: status ?? 'unknown' },
  ];
  let score = factors.reduce((n, f) => n + f.points, 0);

  const times = history
    .flatMap(h => [h.replied_at, h.opened_at, h.sent_at, h.created_at])
    .filter((t): t is string => Boolean(t))
    .map(t => new Date(t).getTime());
  if (times.length && status !== 'client') {
    const idleDays = Math.floor((now.getTime() - Math.max(...times)) / DAY_MS);
    const factor = idleDays >= 60 ? 0.25 : idleDays >= 30 ? 0.5 : 1;
    if (factor < 1) {
      score = Math.round(score * factor);
      factors.push({ label: 'Recency', points: 0, max: 0,
        detail: `no activity for ${idleDays} days, so engagement is ${factor === 0.5 ? 'halved' : 'quartered'}` });
    }
  }
  return { score, factors, unknown: [] };
}

/** The four parts of a stored score, as blend() takes them. */
function partsOf(row: Pick<LeadScore, 'fit_score' | 'intent_score' | 'ai_score'>) {
  return { fit: row.fit_score ?? null, intent: row.intent_score ?? null, ai: row.ai_score ?? null };
}

/**
 * Recompute the lead's engagement and overall score from what is stored now.
 * Called after outreach is logged and after a pipeline-stage change. A lead
 * that has not been analyzed under the scoring model yet is left alone: there
 * is nothing to blend engagement with.
 */
export async function rescoreLead(ctx: TenantContext, leadId: string): Promise<number | null> {
  const [lead, row] = await Promise.all([db.getLeadById(ctx, leadId), db.getLeadScore(ctx, leadId)]);
  if (!lead || !row) return null;
  const parts = partsOf(row);
  if (parts.fit === null && parts.intent === null && parts.ai === null) return null;

  const [history, config] = await Promise.all([db.getOutreachHistory(ctx, leadId), getConfig(ctx)]);
  const engagement = engagementScore(history, lead.status);
  const weights = normalizeWeights(config.scoring_weights);
  const overall = blend(weights, { ...parts, engagement: engagement?.score ?? null });

  await db.upsertLeadScore(ctx, {
    lead_id: leadId,
    overall_score: overall,
    engagement_score: engagement?.score ?? null,
    weights,
    breakdown: { ...(row.breakdown ?? {}), engagement, weights, overall },
  });
  await db.updateLead(ctx, leadId, { lead_score: overall });
  return overall;
}

/** rescoreLead for request paths: a scoring failure must not fail the write that triggered it. */
export async function rescoreLeadQuietly(ctx: TenantContext, leadId: string): Promise<void> {
  try {
    await rescoreLead(ctx, leadId);
  } catch (err) {
    console.error(`[scoring] rescore failed for lead ${leadId}:`, (err as Error).message);
  }
}
