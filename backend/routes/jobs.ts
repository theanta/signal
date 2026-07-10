import { Router } from 'express';
import {
  listJobs,
  getJob,
  updateJobStatus,
  analyzeJob,
  createSubmission,
  updateSubmission,
  deleteSubmission,
  convertJobToLead,
} from '../controllers/jobsController';

const router = Router();

router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id', updateJobStatus);
router.post('/:id/analyze', analyzeJob);
router.post('/:id/submissions', createSubmission);
router.patch('/:id/submissions/:sid', updateSubmission);
router.delete('/:id/submissions/:sid', deleteSubmission);
router.post('/:id/convert-to-lead', convertJobToLead);

export default router;
