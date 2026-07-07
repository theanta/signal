import { api } from '@/lib/api';
import type { Job, JobFilters, Lead, PaginatedResponse } from '../../shared/types';

export async function fetchJobs(filters: JobFilters = {}): Promise<PaginatedResponse<Job>> {
  const { data } = await api.get('/jobs', { params: filters });
  return { data: data.data, total: data.total, page: data.page, per_page: data.per_page, total_pages: data.total_pages };
}

export async function updateJobStatus(id: string, status: Job['status']): Promise<Job> {
  const { data } = await api.patch(`/jobs/${id}`, { status });
  return data.data;
}

export async function convertJobToLead(id: string): Promise<Lead> {
  const { data } = await api.post(`/jobs/${id}/convert-to-lead`);
  return data.data;
}
