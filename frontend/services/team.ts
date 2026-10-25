import { api } from '@/lib/api';
import type { AddTeamMemberInput, TeamMember } from '../../shared/types';

export async function fetchTeam(): Promise<TeamMember[]> {
  const { data } = await api.get('/team');
  return data.data;
}

export async function addTeamMember(input: AddTeamMemberInput): Promise<TeamMember> {
  const { data } = await api.post('/team', input);
  return data.data;
}
