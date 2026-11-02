import { api } from '@/lib/api';
import type { AddTeamMemberInput, AddTeamMemberResult, TeamMember, UserRole } from '../../shared/types';

export interface InviteResult { email_sent: boolean; invite_url?: string }

export async function fetchTeam(): Promise<TeamMember[]> {
  const { data } = await api.get('/team');
  return data.data;
}

export async function addTeamMember(input: AddTeamMemberInput): Promise<AddTeamMemberResult> {
  const { data } = await api.post('/team', input);
  return data.data;
}

export async function updateTeamMember(id: string, patch: { role?: UserRole; is_active?: boolean }): Promise<TeamMember> {
  const { data } = await api.patch(`/team/${id}`, patch);
  return data.data;
}

export async function resendTeamInvite(id: string): Promise<InviteResult> {
  const { data } = await api.post(`/team/${id}/resend-invite`);
  return data.data;
}
