import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { persistAnalysis } from '../../services/persistAnalysis';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';
import type { SignalAnalysisResult } from '../../../shared/types';

let orgs: TwoOrgs;

const BASE: SignalAnalysisResult = {
  lead_score: 72,
  industry: 'Logistics',
  likely_pain_points: ['manual BOL entry'],
  recommended_anta_service: 'document automation',
  outreach_angle: 'A/P admin posting',
  operational_maturity: 'growing',
  growth_indicators: ['hiring'],
  digital_maturity_score: 4,
  signal_type: 'hiring',
  confidence_score: 0.8, // 0–1, matching the lead_signals CHECK and the engine
  scoring_breakdown: {
    company_size_score: 20, hiring_urgency_score: 20,
    complexity_score: 20, digital_score: 12,
  },
  scoring_rationale: 'test',
  tech_stack: [],
  tech_gaps: [],
} as SignalAnalysisResult;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
});

beforeEach(async () => {
  await sql(
    `UPDATE leads SET contact_email = 'old@acme.test', contact_email_confidence = 'verified',
     contact_name = 'Old Person', status = 'new' WHERE id = ANY($1)`,
    [[orgs.a.leadId, orgs.b.leadId]],
  );
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

it('clears a stale email confidence when re-analysis finds no email', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], {
    ...BASE,
    contact: { name: 'New Person', title: 'Ops Lead', email: '', linkedin_url: '', email_confidence: 'unknown' },
  } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_name).toBe('New Person');
  // The old address must not survive as another person's "verified" inbox.
  expect(after.contact_email ?? null).toBeNull();
  expect(after.contact_email_confidence ?? null).toBeNull();
});

it('keeps a returned email and its confidence', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], {
    ...BASE,
    contact: { name: 'New Person', title: 'Ops Lead', email: 'new@acme.test', linkedin_url: '', email_confidence: 'verified' },
  } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_email).toBe('new@acme.test');
  expect(after.contact_email_confidence).toBe('verified');
});

it('records a generic fallback address as generic', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], {
    ...BASE,
    contact: { name: '', title: '', email: '', linkedin_url: '', email_confidence: 'unknown',
               fallback_generic_email: 'info@acme.test' },
  } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_email).toBe('info@acme.test');
  expect(after.contact_email_confidence).toBe('generic');
});

it('leaves the contact alone when the analysis returns no contact block', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  await persistAnalysis(orgs.a.ctx, lead, [], { ...BASE, contact: null } as SignalAnalysisResult);

  const after = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  expect(after.contact_email).toBe('old@acme.test');
  expect(after.status).toBe('analyzed');
});

it('writes the score and signal into the caller’s org', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  const before = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  await persistAnalysis(orgs.a.ctx, lead, [], BASE);

  const signals = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  // No existing signals were passed in, so a new row must have been written.
  expect(signals).toHaveLength(before.length + 1);
  expect(signals.every(s => s.org_id === orgs.a.orgId)).toBe(true);
  const score = await db.getLeadScore(orgs.a.ctx, orgs.a.leadId);
  expect(score!.org_id).toBe(orgs.a.orgId);
  expect(score!.overall_score).toBe(72);
});

it('updates the newest signal in place when the type is unchanged', async () => {
  const lead = (await db.getLeadById(orgs.a.ctx, orgs.a.leadId))!;
  const before = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  expect(before.length).toBeGreaterThan(0);
  await persistAnalysis(orgs.a.ctx, lead, before, BASE);
  const after = await db.getLeadSignals(orgs.a.ctx, orgs.a.leadId);
  expect(after).toHaveLength(before.length);
});

it('cannot persist onto another org’s lead', async () => {
  const foreign = { ...(await db.getLeadById(orgs.b.ctx, orgs.b.leadId))! };
  const signalsBefore = await sql(`SELECT COUNT(*)::int AS n FROM lead_signals WHERE lead_id = $1`, [orgs.b.leadId]);

  await expect(persistAnalysis(orgs.a.ctx, foreign, [], {
    ...BASE,
    contact: { name: 'Hijack', title: '', email: 'x@evil.test', linkedin_url: '', email_confidence: 'verified' },
  } as SignalAnalysisResult)).rejects.toThrow();

  const { rows } = await sql(`SELECT status, contact_email FROM leads WHERE id = $1`, [orgs.b.leadId]);
  expect(rows[0]).toMatchObject({ status: 'new', contact_email: 'old@acme.test' });
  const signalsAfter = await sql(`SELECT COUNT(*)::int AS n FROM lead_signals WHERE lead_id = $1`, [orgs.b.leadId]);
  expect(signalsAfter.rows[0].n).toBe(signalsBefore.rows[0].n);
});
