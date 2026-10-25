'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import axios from 'axios';
import { cn } from '@/lib/utils';

/** The server's own message when it sent one, else the network error. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const serverMessage = (error.response?.data as { error?: string } | undefined)?.error;
    if (serverMessage) return serverMessage;
    if (!error.response) return 'Cannot reach the server. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

/**
 * Shown instead of an empty state when a request failed, so "no data" and
 * "could not load the data" never look the same.
 */
export default function QueryError({ error, onRetry, title = 'Could not load this', className }: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 p-8 text-center', className)}>
      <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center">
        <AlertTriangle className="w-5 h-5 text-rose-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-ink mb-1">{title}</p>
        <p className="text-xs text-muted max-w-sm">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      )}
    </div>
  );
}
