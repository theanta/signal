import { Router, Request, Response } from 'express';
import * as db from '../services/supabaseService';
import { generateFollowUp } from '../services/claudeService';

const router = Router();

router.get('/queue', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await db.supabase
      .from('leads')
      .select(`
        id, company_name, location, industry, lead_score, status, website, linkedin_url,
        outreach_messages(id, channel, subject, body, created_at, is_selected)
      `)
      .in('status', ['analyzed', 'new'])
      .gte('lead_score', 50)
      .order('lead_score', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ success: true, data: data ?? [] });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/:leadId/messages', async (req: Request, res: Response) => {
  try {
    const messages = await db.getOutreachMessages(req.params.leadId);
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/:leadId/followup', async (req: Request, res: Response) => {
  try {
    const lead = await db.getLeadById(req.params.leadId);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const { original_message, days_since_sent = 5 } = req.body;
    const followUp = await generateFollowUp(lead, original_message, days_since_sent);

    const saved = await db.createOutreachMessage({
      lead_id: lead.id,
      channel: 'email',
      subject: followUp.subject,
      body: followUp.body,
      generated_by: 'claude',
    });

    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/history', async (req: Request, res: Response) => {
  try {
    const { data, error } = await db.supabase
      .from('outreach_history')
      .insert(req.body)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
