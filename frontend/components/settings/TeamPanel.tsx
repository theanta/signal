'use client';

import { useAuth } from '@/contexts/AuthContext';
import TeamManager from '@/components/team/TeamManager';
import { addTeamMember, fetchTeam, resendTeamInvite, updateTeamMember } from '@/services/team';

const TEAM_API = { list: fetchTeam, add: addTeamMember, update: updateTeamMember, resend: resendTeamInvite };

/** Settings → Team: everyone sees the team; admins add people and manage roles and access. */
export default function TeamPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  return (
    <div className="card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-ink">Team</h3>
        <p className="text-xs text-muted mt-0.5">
          {isAdmin
            ? 'People who can sign in to this organization. Deactivated people are signed out within 15 minutes.'
            : 'People who can sign in to this organization. Only admins can make changes.'}
        </p>
      </div>
      <TeamManager queryKey={['team']} canManage={isAdmin} currentUserId={user?.id} api={TEAM_API} />
    </div>
  );
}
