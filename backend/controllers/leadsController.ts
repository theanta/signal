import { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/supabaseService';
import { analyzeLeadSignals } from '../services/signalEngineService';
import { generateOutreach, analyzeOpportunity } from '../services/claudeService';
import type { LeadFilters, LeadSource, OutreachChannel } from '../../shared/types';

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

    res.json({ success: true, data: { ...lead, signals, score_detail: score, outreach_messages } });
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
    const lead = await db.updateLead(req.params.id, req.body);
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function analyzeLead(req: Request, res: Response): Promise<void> {
  try {
    const lead = await db.getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const signals = await analyzeLeadSignals({
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

    // Build the lead update — include enrichment data when present
    const leadUpdate: Record<string, unknown> = {
      lead_score: signals.lead_score,
      status: 'analyzed',
      analyzed_at: new Date().toISOString(),
    };
    if (signals.verified_website) leadUpdate.website = signals.verified_website;
    if (signals.contact?.name)             leadUpdate.contact_name             = signals.contact.name;
    if (signals.contact?.email)            leadUpdate.contact_email            = signals.contact.email;
    if (signals.contact?.title)            leadUpdate.contact_title            = signals.contact.title;
    if (signals.contact?.linkedin_url)     leadUpdate.contact_linkedin_url     = signals.contact.linkedin_url;
    if (signals.contact?.email_confidence) leadUpdate.contact_email_confidence = signals.contact.email_confidence;

    await Promise.all([
      db.createLeadSignal({
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
        raw_analysis: signals as unknown as Record<string, unknown>,
      }),
      db.createLeadScore({
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

    res.json({ success: true, data: signals });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
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
      signalData = signals[0].raw_analysis as unknown;
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
