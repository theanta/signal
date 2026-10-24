import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { persistAnalysis } from '../../services/persistAnalysis';
import { saveConfig } from '../../services/configService';
import { blend, engagementScore, normalizeWeights, rescoreLead } from '../../services/scoringService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import type { OutreachHistory, ScoreBreakdown, SignalAnalysisResult } from '../../../shared/types';

// ---- Pure scoring maths (mirrors signal-engine/scoring/model.py) ----

describe('blend', () => {
  it('weights the parts that are present and skips missing ones', () => {
    const w = { fit: 30, intent: 30, ai: 25, engagement: 15 };
    expect(blend(w, { fit: 80, intent: 40, ai: 60, engagement: null }))
      .toBe(Math.round((30 * 80 + 30 * 40 + 25 * 60) / 85));
    expect(blend(w, { fit: 80, intent: 40, ai: 60, engagement: 100 }))
      .toBe(Math.round((30 * 80 + 30 * 40 + 25 * 60 + 15 * 100) / 100));
    expect(blend(w, {})).toBe(0);
  });

  it('agrees with the engine on the same inputs', () => {
    // Same cases as test_scoring_model.py::test_blend_uses_agency_weights_and_skips_missing_parts
    expect(blend({ fit: 100, intent: 0, ai: 0, engagement: 0 }, { fit: 70, intent: 10, ai: 90 })).toBe(70);
    // test_rounding_matches_the_backend_half_up: 82.5 → 83 on both sides.
    expect(blend({ fit: 40, intent: 40, ai: 0, engagement: 0 }, { fit: 100, intent: 65 })).toBe(83);
  });

  it('falls back per key and rejects junk weights', () => {
    expect(normalizeWeights({ fit: '50' as never, ai: -5, intent: 'lots' as never }))
      .toEqual({ fit: 50, intent: 30, ai: 0, engagement: 15 });
  });
});

const row = (o: Partial<OutreachHistory>): OutreachHistory =>
  ({ id: 'h', lead_id: 'l', channel: 'email', status: 'sent', created_at: new Date().toISOString(),
     updated_at: new Date().toISOString(), ...o }) as OutreachHistory;

describe('engagementScore', () => {
  it('is unknown until the first send', () => {
    expect(engagementScore([], 'analyzed')).toBeNull();
  });

  it('adds up sent, opened, replied and pipeline stage', () => {
    const now = new Date();
    const e = engagementScore([row({ status: 'sent' }), row({ status: 'replied' })], 'meeting', now)!;
    expect(e.score).toBe(10 + 20 + 40 + 20);
  });

  it('a client scores 100 and never fades', () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const e = engagementScore([row({ status: 'replied', created_at: old, replied_at: old })], 'client')!;
    expect(e.score).toBe(100);
  });

  it('fades with silence: halved after 30 days, quartered after 60', () => {
    const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    expect(engagementScore([row({ status: 'replied', created_at: at(40), replied_at: at(40) })], 'contacted')!.score)
      .toBe(Math.round(70 * 0.5));
    expect(engagementScore([row({ status: 'replied', created_at: at(70), replied_at: at(70) })], 'contacted')!.score)
      .toBe(Math.round(70 * 0.25));
  });

  it('bounced sends earn nothing', () => {
    expect(engagementScore([row({ status: 'bounced' })], 'contacted')!.score).toBe(0);
  });
});

// ---- Stored and re-blended against the database ----

let orgs: TwoOrgs;

const SCORES: ScoreBreakdown = {
  fit: { score: 80, factors: [{ label: 'Company size', points: 35, max: 35, detail: '51-200' }], unknown: [] },
  intent: { score: 40, factors: [], unknown: [] },
  ai: { score: 60, reason: 'clinic hiring a marketer' },
  engagement: null,
  weights: { fit: 30, intent: 30, ai: 25, engagement: 15 },
  overall: 60,
};

const RESULT = {
  lead_score: 60, industry: 'Healthcare', likely_pain_points: [], recommended_anta_service: 's',
  outreach_angle: 'a', operational_maturity: 'm', growth_indicators: [], digital_maturity_score: 5,
  signal_type: 'hiring', confidence_score: 0.6, scoring_rationale: 'r', tech_stack: [], tech_gaps: [],
  scoring_breakdown: { company_size_score: 10, hiring_urgency_score: 10, complexity_score: 10, digital_score: 8 },
  scores: SCORES,
} as SignalAnalysisResult;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

beforeEach(async () => {
  await sql(`DELETE FROM outreach_history WHERE org_id = $1`, [orgs.a.orgId]);
  await sql(`UPDATE leads SET status = 'new' WHERE id = $1`, [orgs.a.leadId]);
  await sql(`DELETE FROM platform_config WHERE org_id = $1`, [orgs.a.orgId]);
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

async function stored() {
  const { rows } = await sql(
    `SELECT s.overall_score, s.fit_score, s.intent_score, s.ai_score, s.engagement_score, s.ai_reason,
            s.breakdown, l.lead_score
     FROM lead_scores s JOIN leads l ON l.id = s.lead_id WHERE s.lead_id = $1`, [orgs.a.leadId]);
  return rows[0];
}

it('stores all four scores, the AI reason and the breakdown, and the blend as the lead score', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], RESULT);
  const s = await stored();
  expect(s).toMatchObject({ fit_score: 80, intent_score: 40, ai_score: 60, engagement_score: null,
                            ai_reason: 'clinic hiring a marketer', overall_score: 60, lead_score: 60 });
  expect(s.breakdown.fit.factors[0].label).toBe('Company size');
});

it('a logged reply raises the score, using the agency’s own weights', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], RESULT);
  await saveConfig(orgs.a.ctx, { scoring_weights: { fit: 0, intent: 0, ai: 0, engagement: 100 } });

  await db.createOutreachHistory(orgs.a.ctx, { lead_id: orgs.a.leadId, channel: 'email', status: 'replied',
    sent_at: new Date().toISOString(), replied_at: new Date().toISOString() });
  await sql(`UPDATE leads SET status = 'meeting' WHERE id = $1`, [orgs.a.leadId]);
  const overall = await rescoreLead(orgs.a.ctx, orgs.a.leadId);

  // Engagement only: sent 10 + opened 20 (a reply implies it) + replied 40 + meeting 20.
  expect(overall).toBe(90);
  const s = await stored();
  expect(s).toMatchObject({ engagement_score: 90, overall_score: 90, lead_score: 90 });
  expect(s.breakdown.engagement.factors.map((f: { label: string }) => f.label))
    .toContain('Replied');
});

it('leaves a lead that was never scored under the model alone', async () => {
  await sql(`UPDATE lead_scores SET fit_score = NULL, intent_score = NULL, ai_score = NULL WHERE lead_id = $1`,
    [orgs.a.leadId]);
  expect(await rescoreLead(orgs.a.ctx, orgs.a.leadId)).toBeNull();
});

it('rescoring is scoped to the caller’s org', async () => {
  expect(await rescoreLead(orgs.a.ctx, orgs.b.leadId)).toBeNull();
});
