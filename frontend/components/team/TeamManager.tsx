'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { toast } from '@/lib/toast';
import QueryError, { errorMessage } from '@/components/ui/QueryError';
import AddUserForm from './AddUserForm';
import IssuedCredentials, { Issued } from './IssuedCredentials';
import MembersTable from './MembersTable';
import type { AddTeamMemberInput, AddTeamMemberResult, TeamMember, UserRole } from '../../../shared/types';
import type { InviteResult } from '@/services/team';

/**
 * Members, add, change and re-invite, for one org. Used by Settings → Team
 * (the org's own admins) and by Platform admin (any org), with their own API
 * calls.
 */
export default function TeamManager({ queryKey, canManage, currentUserId, api }: {
  queryKey: unknown[];
  canManage: boolean;
  currentUserId?: string;
  api: {
    list: () => Promise<TeamMember[]>;
    add: (input: AddTeamMemberInput) => Promise<AddTeamMemberResult>;
    update: (id: string, patch: { role?: UserRole; is_active?: boolean }) => Promise<TeamMember>;
    resend: (id: string) => Promise<InviteResult>;
  };
}) {
  const qc = useQueryClient();
  const { data: members = [], isLoading, isError, error, refetch } = useQuery({ queryKey, queryFn: api.list });
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey });

  const add = useMutation({
    mutationFn: (input: AddTeamMemberInput) => api.add(input),
    onSuccess: (result, input) => {
      refresh();
      setAdding(false);
      setIssued({ email: result.member.email, email_sent: result.email_sent, invite_url: result.invite_url, password: input.password });
      toast.success(`${result.member.name} added`);
    },
    onError: err => toast.error(errorMessage(err)),
  });

  async function update(id: string, patch: { role?: UserRole; is_active?: boolean }) {
    setBusyId(id);
    try {
      const m = await api.update(id, patch);
      toast.success(patch.role ? `${m.name} is now ${m.role}` : `${m.name} ${m.is_active ? 'reactivated' : 'deactivated'}`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function resend(id: string) {
    setBusyId(id);
    try {
      const r = await api.resend(id);
      const m = members.find(x => x.id === id);
      setIssued({ email: m?.email ?? '', ...r });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {canManage && !adding && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setAdding(true)}><UserPlus className="w-4 h-4" /> Add member</button>
        </div>
      )}
      {issued && <IssuedCredentials issued={issued} onDone={() => setIssued(null)} />}
      {adding && <AddUserForm busy={add.isPending} onSubmit={input => add.mutate(input)} onCancel={() => setAdding(false)} />}
      {isError ? (
        <QueryError title="Could not load the team" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <p className="py-6 text-center text-muted text-xs">Loading…</p>
      ) : (
        <MembersTable members={members} currentUserId={currentUserId} canManage={canManage}
          busyId={busyId} onUpdate={update} onResend={resend} />
      )}
    </div>
  );
}
