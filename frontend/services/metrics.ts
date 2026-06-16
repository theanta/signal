import { api } from '@/lib/api';
import type { DashboardMetrics, PipelineSummary, Lead } from '../../shared/types';

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const { data } = await api.get('/metrics/dashboard');
  return data.data;
}

export async function fetchPipeline(): Promise<PipelineSummary[]> {
  const { data } = await api.get('/metrics/pipeline');
  return data.data;
}

export async function fetchHotLeads(): Promise<Lead[]> {
  const { data } = await api.get('/metrics/hot-leads');
  return data.data;
}

export interface AllDashboardData {
  metrics: DashboardMetrics;
  pipeline: PipelineSummary[];
  hotLeads: Lead[];
}

export async function fetchAllDashboard(): Promise<AllDashboardData> {
  const { data } = await api.get('/metrics/all');
  return data.data;
}
