import { Request, Response } from 'express';
import { z } from 'zod';
import * as db from '../services/supabaseService';
import type { JobFilters } from '../../shared/types';

const JobFilterSchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  location: z.string().optional(),
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(25),
  sort_by: z.enum(['created_at', 'company_name']).default('created_at'),
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
    const job = await db.getJobById(req.params.id);
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
