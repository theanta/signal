'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { tokenStore } from '@/lib/api';
import { toast } from '@/lib/toast';
import PasswordForm from '@/components/ui/PasswordForm';

/** Change your own password. Required first, when it was set by someone else. */
export default function ChangePasswordPage() {
  const { user, applySession, logout } = useAuth();
  const router = useRouter();
  const forced = Boolean(user?.must_change_password);

  async function submit(current: string, next: string) {
    const token = tokenStore.getToken();
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Could not change the password');
    applySession(body.data.user, body.data.accessToken);
    toast.success('Password changed');
    router.replace('/dashboard');
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-surface-soft px-4">
      <div className="w-full max-w-md space-y-3">
        <PasswordForm
          title={forced ? 'Choose your own password' : 'Change password'}
          subtitle={forced
            ? 'Your current password was set by someone else. Replace it to continue.'
            : 'Other signed-in devices will be signed out.'}
          askCurrent
          submitLabel="Save password"
          onSubmit={submit}
        />
        {forced && (
          <button className="btn-ghost w-full justify-center" onClick={async () => { await logout(); router.replace('/login'); }}>
            Sign out instead
          </button>
        )}
      </div>
    </div>
  );
}
