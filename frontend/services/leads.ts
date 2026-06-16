import { api } from '@/lib/api';
import type { Lead, LeadFilters, PaginatedResponse, LeadWithSignals } from '../../shared/types';

export async function fetchLeads(filters: LeadFilters = {}): Promise<PaginatedResponse<Lead>> {
  const { sources, ...rest } = filters;
  const params: Record<string, unknown> = { ...rest };
  if (sources && sources.length > 0) params.sources = sources.join(',');
  const { data } = await api.get('/leads', { params });
  return { data: data.data, total: data.total, page: data.page, per_page: data.per_page, total_pages: data.total_pages };
}

export async function fetchLead(id: string): Promise<LeadWithSignals> {
  const { data } = await api.get(`/leads/${id}`);
  return data.data;
}

export async function updateLeadStatus(id: string, status: Lead['status']): Promise<Lead> {
  const { data } = await api.patch(`/leads/${id}`, { status });
  return data.data;
}

export async function analyzeLead(id: string): Promise<unknown> {
  const { data } = await api.post(`/leads/${id}/analyze`);
  return data.data;
}

export async function generateOutreach(id: string, channel: 'email' | 'linkedin' = 'email'): Promise<unknown> {
  const { data } = await api.post(`/leads/${id}/outreach`, { channel });
  return data.data;
}

export async function getLeadAnalysis(id: string): Promise<unknown> {
  const { data } = await api.get(`/leads/${id}/analysis`);
  return data.data;
}

export async function createManualLead(lead: Partial<Lead>): Promise<Lead> {
  const { data } = await api.post('/leads', lead);
  return data.data;
}
