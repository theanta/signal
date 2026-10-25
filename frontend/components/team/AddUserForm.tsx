'use client';

import { useState } from 'react';
import { KeyRound, Mail, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generatePassword } from '@/lib/password';
import type { AddTeamMemberInput, AddUserMode, UserRole } from '../../../shared/types';

/** Name, email, role, and how they get in: an emailed invite or a temporary password. */
export default function AddUserForm({ busy, onSubmit, onCancel, submitLabel = 'Add member' }: {
  busy: boolean;
  onSubmit: (input: AddTeamMemberInput) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [mode, setMode] = useState<AddUserMode>('invite');
  const [password, setPassword] = useState(generatePassword);

  return (
    <form
      className="grid grid-cols-2 gap-3 rounded-md border border-hairline p-4"
      onSubmit={e => {
        e.preventDefault();
        onSubmit({ name, email, role, mode, ...(mode === 'password' ? { password } : {}) });
      }}
    >
      <input className="input" placeholder="Full name" required value={name} onChange={e => setName(e.target.value)} />
      <input className="input" placeholder="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
      <select className="input" value={role} onChange={e => setRole(e.target.value as UserRole)}>
        <option value="member">Member: works leads and outreach</option>
        <option value="admin">Admin: also manages the team</option>
      </select>
      <div className="flex rounded-md border border-hairline overflow-hidden text-xs">
        {([['invite', Mail, 'Email invite'], ['password', KeyRound, 'Temporary password']] as const).map(([m, Icon, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={cn('flex-1 flex items-center justify-center gap-1.5 py-2',
              mode === m ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink')}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {mode === 'password' && (
        <div className="col-span-2 flex gap-2">
          <input className="input flex-1 font-mono" value={password} minLength={12} required
            onChange={e => setPassword(e.target.value)} />
          <button type="button" className="btn-secondary" title="Generate a new password"
            onClick={() => setPassword(generatePassword())}>
            <KeyRound className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="col-span-2 flex items-center justify-between gap-2">
        <p className="text-2xs text-muted">
          {mode === 'invite'
            ? 'They get a link to set their own password.'
            : 'They must replace it with their own at first sign-in.'}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            <Plus className="w-4 h-4" /> {busy ? 'Adding…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
