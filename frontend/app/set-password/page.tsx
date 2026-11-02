'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import PasswordForm from '@/components/ui/PasswordForm';

interface Invite { email: string; name: string; org_name: string }

/** Where an invite link lands: the invited user sets their password and is signed in. */
function SetPassword() {
  const token = useSearchParams().get('token') ?? '';
  const { applySession } = useAuth();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setError('This link is incomplete. Open the link from your invite email again.'); return; }
    fetch(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? 'This link is invalid or has expired.');
        setInvite(body.data);
      })
      .catch(e => setError((e as Error).message));
  }, [token]);

  async function submit(_current: string, password: string) {
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Could not set the password');
    applySession(body.data.user, body.data.accessToken);
    router.replace('/dashboard');
  }

  if (error) {
    return (
      <div className="card w-full max-w-md p-7 space-y-3 text-center">
        <p className="text-sm text-ink">{error}</p>
        <Link href="/login" className="btn-secondary inline-flex">Go to sign in</Link>
      </div>
    );
  }
  if (!invite) return <p className="text-sm text-muted">Checking your invite…</p>;
  return (
    <PasswordForm
      title={`Welcome, ${invite.name}`}
      subtitle={<>Set a password for <strong>{invite.email}</strong> to join {invite.org_name}.</>}
      submitLabel="Set password and sign in"
      onSubmit={submit}
    />
  );
}

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-surface-soft px-4">
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <SetPassword />
      </Suspense>
    </div>
  );
}
