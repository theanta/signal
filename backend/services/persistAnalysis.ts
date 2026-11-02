import * as db from './supabaseService';
import { blend, engagementScore, normalizeWeights } from './scoringService';
import type { TenantContext } from './tenantContext';
import type { Lead, LeadSignal, SignalAnalysisResult } from '../../shared/types';

/**
 * The one place analysis results are written to the database.
 *
 * This logic previously existed twice — leadsController's
 * _persistAnalysisResult and an inline copy in routes/cron.ts — which is how
 * the contact_email_confidence bug survived in both: confidence was written
 * only inside the email branches, so a re-analysis returning a different person
 * with no email left the previous address in place, still badged 'verified'.
 * Here the contact block is always written as a whole, so a fresh analysis
 * cannot leave half of a previous one behind.
 */
export async function persistAnalysis(
  ctx: TenantContext,
  lead: Lead,
  existingSignals: LeadSignal[],
  signals: SignalAnalysisResult,
): Promise<void> {
  // The engine scored fit, intent and the AI judgment; engagement is added
  // here, from outreach already logged against this lead (a re-analysis of a
  // lead that has replied must keep that credit).
  const scores = signals.scores;
  let overall = signals.lead_score;
  let engagement = null;
  if (scores && !scores.disqualified) {
    engagement = engagementScore(await db.getOutreachHistory(ctx, lead.id), lead.status);
    overall = blend(scores.weights, {
      fit: scores.fit?.score ?? null,
      intent: scores.intent?.score ?? null,
      ai: scores.ai?.score ?? null,
      engagement: engagement?.score ?? null,
    });
  }

  const leadUpdate: Record<string, unknown> = {
    lead_score: overall,
    status: 'analyzed',
    analyzed_at: new Date().toISOString(),
  };
  if (signals.industry)         leadUpdate.industry = signals.industry;
  if (signals.verified_website) leadUpdate.website  = signals.verified_website;

  // The contact block is written atomically. An analysis that returns a
  // contact defines every contact field, including the absence of an email.
  if (signals.contact) {
    leadUpdate.contact_name         = signals.contact.name || null;
    leadUpdate.contact_title        = signals.contact.title || null;
    leadUpdate.contact_linkedin_url = signals.contact.linkedin_url || null;

    if (signals.contact.email) {
      leadUpdate.contact_email            = signals.contact.email;
      leadUpdate.contact_email_confidence = signals.contact.email_confidence ?? 'unknown';
    } else if (signals.contact.fallback_generic_email) {
      // No personal inbox found — a generic one (info@ …) is still a usable
      // point of contact for small businesses that expose nothing else.
      leadUpdate.contact_email            = signals.contact.fallback_generic_email;
      leadUpdate.contact_email_confidence = 'generic';
    } else {
      leadUpdate.contact_email            = null;
      leadUpdate.contact_email_confidence = null;
    }
  }

  const latestSignal = existingSignals[0];
  const signalPayload = {
    lead_id: lead.id,
    signal_type: signals.signal_type,
    confidence_score: signals.confidence_score,
    likely_pain_points: signals.likely_pain_points,
    recommended_anta_service: signals.recommended_anta_service,
    outreach_angle: signals.outreach_angle,
    operational_maturity: signals.operational_maturity,
    growth_indicators: signals.growth_indicators,
    digital_maturity_score: signals.digital_maturity_score,
    tech_stack: signals.tech_stack ?? [],
    tech_gaps: signals.tech_gaps ?? [],
  };

  // The lead update runs last and is awaited separately: the signal and score
  // writes are best-effort (a duplicate from a partially-succeeded prior run
  // must not permanently lock the lead as 'new'), but the status change is not.
  const secondary = await Promise.allSettled([
    latestSignal?.signal_type === signals.signal_type
      ? db.updateLeadSignal(ctx, latestSignal.id, { ...signalPayload, detected_at: new Date().toISOString() })
      : db.createLeadSignal(ctx, signalPayload),
    db.upsertLeadScore(ctx, {
      lead_id: lead.id,
      overall_score: overall,
      company_size_score: signals.scoring_breakdown.company_size_score,
      hiring_urgency_score: signals.scoring_breakdown.hiring_urgency_score,
      complexity_score: signals.scoring_breakdown.complexity_score,
      digital_score: signals.scoring_breakdown.digital_score,
      scoring_rationale: signals.scoring_rationale,
      ...(scores ? {
        fit_score: scores.fit?.score ?? null,
        intent_score: scores.intent?.score ?? null,
        ai_score: scores.ai?.score ?? null,
        ai_reason: scores.ai?.reason ?? null,
        engagement_score: engagement?.score ?? null,
        weights: normalizeWeights(scores.weights),
        breakdown: { ...scores, engagement, overall },
      } : {}),
    }),
  ]);

  for (const r of secondary) {
    if (r.status === 'rejected') {
      console.error(`[persistAnalysis] secondary write failed for lead ${lead.id}:`, r.reason);
    }
  }

  await db.updateLead(ctx, lead.id, leadUpdate);
}
