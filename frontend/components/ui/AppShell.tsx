'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useAuth } from '@/contexts/AuthContext';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading } = useAuth();

  const isAuthPage = pathname?.startsWith('/login');

  if (isAuthPage) return <>{children}</>;

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
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
