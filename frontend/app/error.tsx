'use client';

import { useEffect } from 'react';
import QueryError from '@/components/ui/QueryError';

/** Catches a page that crashed while rendering, instead of a blank screen. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[page error]', error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <QueryError title="This page hit an error" error={error} onRetry={reset} />
    </div>
  );
}
