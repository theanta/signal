import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppShell } from '@/components/ui/AppShell';
import QueryProvider from '@/components/ui/QueryProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'ANTA Lead Radar',
  description: 'AI-powered lead generation and outreach intelligence',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden">
        <QueryProvider>
          <AuthProvider>
            <ToastProvider>
              <AppShell>{children}</AppShell>
            </ToastProvider>
          </AuthProvider>
        </QueryProvider>
        <Toaster
          position="bottom-right"
          richColors
          toastOptions={{
            style: { fontFamily: 'Inter, sans-serif', fontSize: '13.5px' },
          }}
        />
      </body>
    </html>
  );
}
