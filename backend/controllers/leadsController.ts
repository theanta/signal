import { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/supabaseService';
import { analyzeLeadSignals } from '../services/signalEngineService';
import { generateOutreach, analyzeOpportunity } from '../services/claudeService';
import type { Lead, LeadFilters, LeadSignal, LeadSource, OutreachChannel, SignalAnalysisResult } from '../../shared/types';

const SIGNAL_ENGINE_URL = process.env.SIGNAL_ENGINE_URL ?? 'http://localhost:8001';

const LeadFilterSchema = z.object({
  status: z.string().optional(),
  source: z.string().optional(),
  sources: z.string().optional().transform(v => v ? v.split(',') as LeadSource[] : undefined),
  min_score: z.coerce.number().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(25),
  sort_by: z.enum(['lead_score', 'created_at', 'company_name']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export async function listLeads(req: Request, res: Response): Promise<void> {
  try {
    const filters = LeadFilterSchema.parse(req.query) as LeadFilters;
    const result = await db.getLeads(filters);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
}

export async function getLead(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const lead = await db.getLeadById(id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const [signals, score, outreach_messages] = await Promise.all([
      db.getLeadSignals(id),
      db.getLeadScore(id),
      db.getOutreachMessages(id),
    ]);

    let score_detail = score;
    if (score) {
      const percentile = await db.getScorePercentile(score.overall_score);
      score_detail = { ...score, score_percentile: percentile };
    }

    res.json({ success: true, data: { ...lead, signals, score_detail, outreach_messages } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function createLead(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.createLead({ ...req.body, source: req.body.source ?? 'manual' });
    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function updateLead(req: Request, res: Response): Promise<void> {
  try {
    const updates = { ...req.body };
    if (updates.status === 'contacted' && !updates.contacted_at) {
      updates.contacted_at = new Date().toISOString();
    }
    const lead = await db.updateLead(req.params.id, updates);
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

// Shared helper: write analysis results to DB. Used by both analyzeLead and streamAnalyzeLead.
async function _persistAnalysisResult(
  lead: Lead,
  existingSignals: LeadSignal[],
  signals: SignalAnalysisResult,
): Promise<void> {
  const leadUpdate: Record<string, unknown> = {
    lead_score: signals.lead_score,
    status: 'analyzed',
    analyzed_at: new Date().toISOString(),
  };
  if (signals.industry)                  leadUpdate.industry                 = signals.industry;
  if (signals.verified_website)          leadUpdate.website                  = signals.verified_website;
  if (signals.contact?.name)             leadUpdate.contact_name             = signals.contact.name;
  if (signals.contact?.email)            leadUpdate.contact_email            = signals.contact.email;
  if (signals.contact?.title)            leadUpdate.contact_title            = signals.contact.title;
  if (signals.contact?.linkedin_url)     leadUpdate.contact_linkedin_url     = signals.contact.linkedin_url;
  if (signals.contact?.email_confidence) leadUpdate.contact_email_confidence = signals.contact.email_confidence;

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

  await Promise.all([
    latestSignal?.signal_type === signals.signal_type
      ? db.updateLeadSignal(latestSignal.id, { ...signalPayload, detected_at: new Date().toISOString() })
      : db.createLeadSignal(signalPayload),
    db.upsertLeadScore({
      lead_id: lead.id,
      overall_score: signals.lead_score,
      company_size_score: signals.scoring_breakdown.company_size_score,
      hiring_urgency_score: signals.scoring_breakdown.hiring_urgency_score,
      complexity_score: signals.scoring_breakdown.complexity_score,
      digital_score: signals.scoring_breakdown.digital_score,
      scoring_rationale: signals.scoring_rationale,
    }),
    db.updateLead(lead.id, leadUpdate),
  ]);
}

// Build the ScrapedLeadRaw payload for the signal engine from a stored lead + existing signals.
function _buildLeadPayload(lead: Lead, existingSignals: LeadSignal[]) {
  const cachedSignal = existingSignals[0];
  const cachedContact = lead.contact_email ? {
    name: lead.contact_name ?? '',
    title: lead.contact_title ?? '',
    email: lead.contact_email,
    linkedin_url: lead.contact_linkedin_url ?? '',
    email_confidence: (lead.contact_email_confidence ?? 'unknown') as import('../../shared/types').EmailConfidence,
  } : null;

  return {
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
    cached_tech_stack: cachedSignal?.tech_stack?.length ? cachedSignal.tech_stack : undefined,
    cached_tech_gaps: cachedSignal?.tech_gaps?.length ? cachedSignal.tech_gaps : undefined,
    cached_contact: cachedContact,
    cached_verified_website: cachedSignal ? (lead.website ?? undefined) : undefined,
  };
}

export async function analyzeLead(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const existingSignals = await db.getLeadSignals(lead.id);
    const signals = await analyzeLeadSignals(_buildLeadPayload(lead, existingSignals));
    await _persistAnalysisResult(lead, existingSignals, signals);

    res.json({ success: true, data: signals });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function streamAnalyzeLead(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const existingSignals = await db.getLeadSignals(lead.id);
    const leadPayload = _buildLeadPayload(lead, existingSignals);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const pyResponse = await fetch(`${SIGNAL_ENGINE_URL}/analyze/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead: leadPayload }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!pyResponse.ok || !pyResponse.body) {
      res.write(`data: ${JSON.stringify({ phase: 'error', message: 'Signal engine unavailable' })}\n\n`);
      res.end();
      return;
    }

    const reader = pyResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on SSE event boundary (double newline)
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          if (!event.trim()) continue;
          res.write(event + '\n\n');

          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(line.slice(6)) as { phase: string; result?: SignalAnalysisResult };
              if (parsed.phase === 'complete' && parsed.result) {
                // Non-blocking DB write — don't delay the stream closing
                _persistAnalysisResult(lead, existingSignals, parsed.result).catch(err =>
                  console.error('[streamAnalyzeLead] DB persist failed:', err)
                );
              }
            } catch { /* malformed JSON — skip */ }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (err as Error).message });
    } else {
      res.write(`data: ${JSON.stringify({ phase: 'error', message: (err as Error).message })}\n\n`);
      res.end();
    }
  }
}

export async function generateLeadOutreach(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const channel: OutreachChannel = req.body.channel ?? 'email';
    const signals = await db.getLeadSignals(lead.id);

    let signalData;
    if (signals.length > 0) {
      const sig = signals[0];
      signalData = {
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
        scoring_breakdown: { company_size_score: 0, hiring_urgency_score: 0, complexity_score: 0, digital_score: 0 },
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
      };
    } else {
      signalData = await analyzeLeadSignals({
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
    }

    const outreach = await generateOutreach(lead, signalData as Parameters<typeof generateOutreach>[1], channel);

    const saved = await db.createOutreachMessage({
      lead_id: lead.id,
      channel,
      subject: outreach.subject,
      body: outreach.body,
      generated_by: 'claude',
      model_version: outreach.model_version,
    });

    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function getLeadAnalysis(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const analysis = await analyzeOpportunity(lead);
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}
