import { api } from '@/lib/api';
import type {
  AddTeamMemberInput, AddTeamMemberResult, AdminOrganization, CreateOrganizationInput,
  CreateOrganizationResult, TeamMember, UpdateOrganizationInput, UserRole,
} from '../../shared/types';
import type { InviteResult } from './team';

export async function fetchOrganizations(): Promise<AdminOrganization[]> {
  const { data } = await api.get('/admin/organizations');
  return data.data;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  const { data } = await api.post('/admin/organizations', input);
  return data.data;
}

export async function updateOrganization(id: string, patch: UpdateOrganizationInput): Promise<AdminOrganization> {
  const { data } = await api.patch(`/admin/organizations/${id}`, patch);
  return data.data;
}

export async function fetchOrgUsers(orgId: string): Promise<TeamMember[]> {
  const { data } = await api.get(`/admin/organizations/${orgId}/users`);
  return data.data;
}

export async function addOrgUser(orgId: string, input: AddTeamMemberInput): Promise<AddTeamMemberResult> {
  const { data } = await api.post(`/admin/organizations/${orgId}/users`, input);
  return data.data;
}

export async function updateOrgUser(orgId: string, userId: string, patch: { role?: UserRole; is_active?: boolean }): Promise<TeamMember> {
  const { data } = await api.patch(`/admin/organizations/${orgId}/users/${userId}`, patch);
  return data.data;
}

export async function resendOrgInvite(orgId: string, userId: string): Promise<InviteResult> {
  const { data } = await api.post(`/admin/organizations/${orgId}/users/${userId}/resend-invite`);
  return data.data;
}
