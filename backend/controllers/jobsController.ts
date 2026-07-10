import { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/supabaseService';
import { generateJobIntel, jobIntelToSignal } from '../services/claudeService';
import type { JobFilters } from '../../shared/types';

const JobFilterSchema = z.object({
  status: z.string().optional(),
  verdict: z.enum(['apply', 'caution', 'skip']).optional(),
  search: z.string().optional(),
  location: z.string().optional(),
  source: z.enum(['indeed', 'linkedin', 'remoteok', 'remotive']).optional(),
  posted_within_days: z.coerce.number().int().positive().optional(),
  technology: z.string().optional(),
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(25),
  sort_by: z.enum(['created_at', 'company_name', 'job_title', 'location', 'source', 'posted_at', 'status', 'verdict']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export async function listJobs(req: Request, res: Response): Promise<void> {
  try {
    const filters = JobFilterSchema.parse(req.query) as JobFilters;
    const result = await db.getJobs(filters);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
}

export async function getJob(req: Request, res: Response): Promise<void> {
  try {
    const job = await db.getJobWithIntel(req.params.id);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function updateJobStatus(req: Request, res: Response): Promise<void> {
  try {
    const job = await db.updateJob(req.params.id, req.body);
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function analyzeJob(req: Request, res: Response): Promise<void> {
  try {
    const job = await db.getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }
    if (!job.description && !job.job_title) {
      res.status(400).json({ success: false, error: 'Job has no description or title to analyze' });
      return;
    }

    const intel = await generateJobIntel(job);
    const signal = await db.createJobSignal(jobIntelToSignal(job.id, intel));

    // An analyzed job has, by definition, been looked at.
    if (job.status === 'new') {
      await db.updateJob(job.id, { status: 'reviewed' });
    }

    res.json({ success: true, data: signal });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

const SubmissionCreateSchema = z.object({
  profile_label: z.string().min(1),
  notes: z.string().optional(),
});

const SUBMISSION_STATUSES = ['submitted', 'screening', 'interviewing', 'offer', 'placed', 'rejected', 'withdrawn'] as const;

const SubmissionUpdateSchema = z.object({
  profile_label: z.string().min(1).optional(),
  status: z.enum(SUBMISSION_STATUSES).optional(),
  notes: z.string().nullable().optional(),
});

export async function createSubmission(req: Request, res: Response): Promise<void> {
  try {
    const job = await db.getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }
    const payload = SubmissionCreateSchema.parse(req.body);
    const submission = await db.createJobSubmission({ job_id: job.id, ...payload });

    // Submitting a profile means the job has been applied to.
    if (job.status === 'new' || job.status === 'reviewed') {
      await db.updateJob(job.id, { status: 'applied' });
    }

    res.json({ success: true, data: submission });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
}

export async function updateSubmission(req: Request, res: Response): Promise<void> {
  try {
    const updates = SubmissionUpdateSchema.parse(req.body);
    const submission = await db.updateJobSubmission(req.params.sid, updates as never);

    // A submission advancing pulls the job's pipeline stage along with it.
    if (updates.status) {
      const job = await db.getJobById(req.params.id);
      if (job) {
        const bump =
          updates.status === 'placed' ? 'placed' :
          ['screening', 'interviewing', 'offer'].includes(updates.status) &&
            ['new', 'reviewed', 'applied'].includes(job.status) ? 'interviewing' :
          null;
        if (bump && job.status !== bump) {
          await db.updateJob(job.id, { status: bump });
        }
      }
    }

    res.json({ success: true, data: submission });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
}

export async function deleteSubmission(req: Request, res: Response): Promise<void> {
  try {
    await db.deleteJobSubmission(req.params.sid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}

export async function convertJobToLead(req: Request, res: Response): Promise<void> {
  try {
    const job = await db.getJobById(req.params.id);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }
    if (job.status === 'converted') {
      res.status(400).json({ success: false, error: 'Job already converted to a lead' });
      return;
    }
    const lead = await db.convertJobToLead(job);
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}
