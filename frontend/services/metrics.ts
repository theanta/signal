import { api } from '@/lib/api';
import type { DashboardMetrics, PipelineSummary } from '../../shared/types';

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const { data } = await api.get('/metrics/dashboard');
  return data.data;
}

export async function fetchPipeline(): Promise<PipelineSummary[]> {
  const { data } = await api.get('/metrics/pipeline');
  return data.data;
}

export async function fetchHotLeads(): Promise<unknown[]> {
  const { data } = await api.get('/metrics/hot-leads');
  return data.data;
}
