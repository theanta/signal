import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/ui/Sidebar';
import QueryProvider from '@/components/ui/QueryProvider';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'ANTA Lead Radar',
  description: 'AI-powered lead generation and outreach intelligence',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden bg-canvas">
        <QueryProvider>
          <ToastProvider>
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
