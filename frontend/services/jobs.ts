import { api } from '@/lib/api';
import type { Job, JobFilters, JobSignal, JobSubmission, JobWithIntel, Lead, PaginatedResponse } from '../../shared/types';

export async function fetchJobs(filters: JobFilters = {}): Promise<PaginatedResponse<Job>> {
  const { data } = await api.get('/jobs', { params: filters });
  return { data: data.data, total: data.total, page: data.page, per_page: data.per_page, total_pages: data.total_pages };
}

export async function fetchJob(id: string): Promise<JobWithIntel> {
  const { data } = await api.get(`/jobs/${id}`);
  return data.data;
}

export async function analyzeJob(id: string): Promise<JobSignal> {
  const { data } = await api.post(`/jobs/${id}/analyze`);
  return data.data;
}

export async function createSubmission(
  jobId: string,
  payload: { profile_label: string; notes?: string },
): Promise<JobSubmission> {
  const { data } = await api.post(`/jobs/${jobId}/submissions`, payload);
  return data.data;
}

export async function updateSubmission(
  jobId: string,
  submissionId: string,
  updates: Partial<Pick<JobSubmission, 'profile_label' | 'status' | 'notes'>>,
): Promise<JobSubmission> {
  const { data } = await api.patch(`/jobs/${jobId}/submissions/${submissionId}`, updates);
  return data.data;
}

export async function deleteSubmission(jobId: string, submissionId: string): Promise<void> {
  await api.delete(`/jobs/${jobId}/submissions/${submissionId}`);
}

export async function updateJobStatus(id: string, status: Job['status']): Promise<Job> {
  const { data } = await api.patch(`/jobs/${id}`, { status });
  return data.data;
}

export async function convertJobToLead(id: string): Promise<Lead> {
  const { data } = await api.post(`/jobs/${id}/convert-to-lead`);
  return data.data;
}
