import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppShell } from '@/components/ui/AppShell';
import QueryProvider from '@/components/ui/QueryProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { Toaster } from 'sonner';

// The app sits behind a login and has nothing to rank; search traffic goes to
// the marketing page on theanta.com instead. Keep every app URL (beta and
// staging) out of search results.
export const metadata: Metadata = {
  title: 'Intentlark by ANTA',
  description: 'Buyer intent signals, lead scoring and outreach for agencies',
  robots: { index: false, follow: false },
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
