import { Router, Request, Response } from 'express';
import * as db from '../services/supabaseService';
import { generateFollowUp } from '../services/claudeService';
import { ctxOf } from '../api/middleware/auth';

const router = Router();

router.get('/queue', async (req: Request, res: Response) => {
  try {
    // Was an inline `db.supabase.from('leads')` query with no org scope. The
    // query itself now lives in getOutreachQueue, where the tenant filter and
    // the isolation suite can both reach it.
    const data = await db.getOutreachQueue(ctxOf(req));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/:leadId/messages', async (req: Request, res: Response) => {
  try {
    const messages = await db.getOutreachMessages(ctxOf(req), req.params.leadId);
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/:leadId/followup', async (req: Request, res: Response) => {
  try {
    const ctx = ctxOf(req);
    const lead = await db.getLeadById(ctx, req.params.leadId);
    if (!lead) {
      res.status(404).json({ success: false, error: 'Lead not found' });
      return;
    }

    const { original_message, days_since_sent = 5 } = req.body;
    const followUp = await generateFollowUp(ctx, lead, original_message, days_since_sent);

    const saved = await db.createOutreachMessage(ctx, {
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
    // req.body is written straight to the table, so an org_id in it used to be
    // whatever the client said. createOutreachHistory drops it and stamps the
    // context's org instead.
    const data = await db.createOutreachHistory(ctxOf(req), req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
