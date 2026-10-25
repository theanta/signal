'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, UserPlus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import { addTeamMember, fetchTeam } from '@/services/team';
import { generatePassword } from '@/lib/password';
import QueryError, { errorMessage } from '@/components/ui/QueryError';
import type { UserRole } from '../../../shared/types';

/**
 * The organization's users. Everyone sees the list; admins add members with
 * a temporary password, shown once to copy and share.
 */
export default function TeamPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const { data: team = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['team'], queryFn: fetchTeam });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'member' as UserRole, password: generatePassword() });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const add = useMutation({
    mutationFn: () => addTeamMember(form),
    onSuccess: member => {
      qc.invalidateQueries({ queryKey: ['team'] });
      setCreated({ email: member.email, password: form.password });
      setForm({ name: '', email: '', role: 'member', password: generatePassword() });
      setOpen(false);
      toast.success(`${member.name} added`);
    },
    onError: err => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Team</h3>
            <p className="text-xs text-muted mt-0.5">
              {isAdmin ? 'People who can sign in to this organization.' : 'Only admins can add people.'}
            </p>
          </div>
          {isAdmin && !open && (
            <button className="btn-primary" onClick={() => setOpen(true)}>
              <UserPlus className="w-4 h-4" /> Add member
            </button>
          )}
        </div>

        {created && (
          <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1.5">
            <p className="text-ink font-medium">Share these sign-in details with {created.email} privately. The password is not shown again.</p>
            <div className="flex items-center gap-2">
              <code className="px-2 py-1 rounded bg-surface-strong text-ink">{created.password}</code>
              <button className="btn-ghost" onClick={() => { navigator.clipboard.writeText(created.password); toast.success('Copied'); }}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button className="btn-ghost ml-auto" onClick={() => setCreated(null)}>Done</button>
            </div>
          </div>
        )}

        {open && (
          <form
            className="mb-5 grid grid-cols-2 gap-3 rounded-md border border-hairline p-4"
            onSubmit={e => { e.preventDefault(); add.mutate(); }}
          >
            <input className="input" placeholder="Full name" required value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input" placeholder="Email" type="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <select className="input" value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}>
              <option value="member">Member: works leads and outreach</option>
              <option value="admin">Admin: also manages the team</option>
            </select>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono" value={form.password} minLength={12} required
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <button type="button" className="btn-secondary" title="Generate a new password"
                onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}>
                <KeyRound className="w-4 h-4" />
              </button>
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={add.isPending}>
                <Plus className="w-4 h-4" /> {add.isPending ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </form>
        )}

        {isError ? (
          <QueryError title="Could not load the team" error={error} onRetry={() => refetch()} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-muted border-b border-hairline">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="py-6 text-center text-muted text-xs">Loading…</td></tr>}
              {team.map(m => (
                <tr key={m.id} className="border-b border-hairline last:border-0">
                  <td className="py-2.5 text-ink">
                    {m.name}{m.id === user?.id && <span className="text-muted text-xs"> (you)</span>}
                    {!m.is_active && <span className="ml-2 text-2xs text-rose-400">inactive</span>}
                  </td>
                  <td className="py-2.5 text-muted">{m.email}</td>
                  <td className="py-2.5">
                    <span className={cn('text-2xs px-2 py-0.5 rounded-full border',
                      m.role === 'admin' ? 'border-brand/40 text-brand' : 'border-hairline text-muted')}>
                      {m.role}
                    </span>
                  </td>
                  <td className="py-2.5 text-muted text-xs">
                    {m.last_login ? formatDistanceToNow(new Date(m.last_login), { addSuffix: true }) : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
