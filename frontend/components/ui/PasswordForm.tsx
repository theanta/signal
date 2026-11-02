'use client';

import { useState, FormEvent } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';

export const MIN_PASSWORD_LENGTH = 12;

/**
 * New password + confirmation, and optionally the current one. Shared by the
 * change-password and invite (set-password) pages.
 */
export default function PasswordForm({ title, subtitle, askCurrent, submitLabel, onSubmit }: {
  title: string;
  subtitle?: React.ReactNode;
  askCurrent?: boolean;
  submitLabel: string;
  onSubmit: (current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      await onSubmit(current, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className="card w-full max-w-md p-7 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand/15 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-brand" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {askCurrent && (
        <input className="input" type="password" placeholder="Current password" autoComplete="current-password"
          required value={current} onChange={e => setCurrent(e.target.value)} />
      )}
      <input className="input" type="password" placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
        autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} />
      <input className="input" type="password" placeholder="Confirm new password" autoComplete="new-password"
        required value={confirm} onChange={e => setConfirm(e.target.value)} />
      {error && (
        <p className="flex items-center gap-2 text-xs text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{error}</p>
      )}
      <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
