import { Router } from 'express';
import {
  listJobs,
  getJob,
  updateJobStatus,
  convertJobToLead,
} from '../controllers/jobsController';

const router = Router();

router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id', updateJobStatus);
router.post('/:id/convert-to-lead', convertJobToLead);

export default router;
