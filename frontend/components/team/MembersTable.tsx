'use client';

import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { TeamMember, UserRole } from '../../../shared/types';

export type MemberStatus = 'active' | 'invited' | 'inactive';

export function memberStatus(m: TeamMember): MemberStatus {
  if (!m.is_active) return 'inactive';
  if (m.must_change_password && !m.last_login) return 'invited';
  return 'active';
}

const STATUS_STYLE: Record<MemberStatus, string> = {
  active: 'border-emerald-500/40 text-emerald-400',
  invited: 'border-amber-400/40 text-amber-400',
  inactive: 'border-rose-500/40 text-rose-400',
};

/**
 * A team's users. With `canManage`, each row other than the viewer's own can
 * change role, be deactivated or reactivated, and (if still invited) get a
 * new invite.
 */
export default function MembersTable({ members, currentUserId, canManage, busyId, onUpdate, onResend }: {
  members: TeamMember[];
  currentUserId?: string;
  canManage: boolean;
  busyId?: string | null;
  onUpdate: (id: string, patch: { role?: UserRole; is_active?: boolean }) => void;
  onResend: (id: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-2xs uppercase tracking-wider text-muted border-b border-hairline">
          <th className="py-2 font-medium">Name</th>
          <th className="py-2 font-medium">Email</th>
          <th className="py-2 font-medium">Role</th>
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Last sign-in</th>
          {canManage && <th className="py-2 font-medium text-right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {members.map(m => {
          const self = m.id === currentUserId;
          const status = memberStatus(m);
          const busy = busyId === m.id;
          return (
            <tr key={m.id} className={cn('border-b border-hairline last:border-0', busy && 'opacity-60')}>
              <td className="py-2.5 text-ink">{m.name}{self && <span className="text-muted text-xs"> (you)</span>}</td>
              <td className="py-2.5 text-muted">{m.email}</td>
              <td className="py-2.5">
                {canManage && !self ? (
                  <select className="input py-1 text-xs w-auto" value={m.role} disabled={busy}
                    onChange={e => onUpdate(m.id, { role: e.target.value as UserRole })}>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                ) : (
                  <span className={cn('text-2xs px-2 py-0.5 rounded-full border',
                    m.role === 'admin' ? 'border-brand/40 text-brand' : 'border-hairline text-muted')}>{m.role}</span>
                )}
              </td>
              <td className="py-2.5">
                <span className={cn('text-2xs px-2 py-0.5 rounded-full border', STATUS_STYLE[status])}>{status}</span>
              </td>
              <td className="py-2.5 text-muted text-xs">
                {m.last_login ? formatDistanceToNow(new Date(m.last_login), { addSuffix: true }) : 'Never'}
              </td>
              {canManage && (
                <td className="py-2.5 text-right whitespace-nowrap space-x-1">
                  {!self && status === 'invited' && (
                    <button className="btn-ghost text-xs" disabled={busy} onClick={() => onResend(m.id)}>Resend invite</button>
                  )}
                  {!self && (
                    <button className={cn('btn-ghost text-xs', m.is_active ? 'text-rose-400' : 'text-emerald-400')}
                      disabled={busy} onClick={() => onUpdate(m.id, { is_active: !m.is_active })}>
                      {m.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
