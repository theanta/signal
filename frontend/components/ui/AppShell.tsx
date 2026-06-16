'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useAuth } from '@/contexts/AuthContext';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading } = useAuth();
  const isAuthPage = pathname?.startsWith('/login');

  // Auth pages get no chrome at all
  if (isAuthPage) return <>{children}</>;

  // Show a minimal spinner while we're confirming the session from the cookie
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="w-5 h-5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </>
  );
}
