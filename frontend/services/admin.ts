import { api } from '@/lib/api';
import type { AdminOrganization, CreateOrganizationInput } from '../../shared/types';

export async function fetchOrganizations(): Promise<AdminOrganization[]> {
  const { data } = await api.get('/admin/organizations');
  return data.data;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<AdminOrganization> {
  const { data } = await api.post('/admin/organizations', input);
  return data.data;
}
