'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import { useAuth } from '@/contexts/AuthContext';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, user } = useAuth();

  // Pages that work without a session, and render without the app chrome.
  const isAuthPage = pathname?.startsWith('/login') || pathname?.startsWith('/set-password');
  // A temporary or invited password must be replaced before anything else.
  const mustChange = Boolean(user?.must_change_password) && !isAuthPage;

  useEffect(() => {
    if (mustChange && pathname !== '/change-password') router.replace('/change-password');
  }, [mustChange, pathname, router]);

  if (isAuthPage) return <>{children}</>;
  // Only the change-password page renders: any other page would fire its API
  // calls, which the backend refuses until the password is changed.
  if (mustChange) return pathname === '/change-password' ? <>{children}</> : null;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f1117]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-brand/40 border-t-brand rounded-full animate-spin" />
          </div>
          <p className="text-[13px] text-[#5a6270]">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-soft">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
