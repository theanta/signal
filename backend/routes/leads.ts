import { Router } from 'express';
import {
  listLeads,
  getLead,
  createLead,
  updateLead,
  analyzeLead,
  streamAnalyzeLead,
  generateLeadOutreach,
  getLeadAnalysis,
} from '../controllers/leadsController';

const router = Router();

router.get('/', listLeads);
router.post('/', createLead);
router.get('/:id', getLead);
router.patch('/:id', updateLead);
router.post('/:id/analyze', analyzeLead);
router.get('/:id/analyze/stream', streamAnalyzeLead);
router.post('/:id/outreach', generateLeadOutreach);
router.get('/:id/analysis', getLeadAnalysis);

export default router;
