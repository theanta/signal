'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { triggerScrape, getScrapeStatus } from '@/services/outreach';
import { toast } from '@/lib/toast';

const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS  = 5 * 60_000;

export function useScrapeJob(onComplete?: () => void, onProgress?: () => void) {
  const [running, setRunning] = useState(false);

  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current)  clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback(async () => {
    if (running) return;

    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current)  clearTimeout(timeoutRef.current);

    setRunning(true);
    const toastId = toast.loading('Scrape started — monitoring job…');

    let jobId: string;
    try {
      const result = await triggerScrape();
      jobId = result.job_id;
      onProgress?.();
    } catch {
      toast.resolve(toastId, 'error', 'Failed to start scrape', 'Is the signal engine online?');
      setRunning(false);
      return;
    }

    function finish(type: 'success' | 'error', message: string) {
      if (intervalRef.current) { clearInterval(intervalRef.current);  intervalRef.current = null; }
      if (timeoutRef.current)  { clearTimeout(timeoutRef.current);    timeoutRef.current  = null; }
      setRunning(false);
      toast.resolve(toastId, type, message);
      if (type === 'success') onCompleteRef.current?.();
    }

    intervalRef.current = setInterval(async () => {
      try {
        const status = await getScrapeStatus(jobId);
        onProgress?.();
        if (status.status === 'completed') {
          const n = status.results ?? 0;
          finish('success', `Scrape complete — ${n} lead${n !== 1 ? 's' : ''} found`);
        } else if (status.status === 'failed') {
          finish('error', 'Scrape job failed');
        }
      } catch {
        // ignore transient network errors during polling
      }
    }, POLL_INTERVAL_MS);

    timeoutRef.current = setTimeout(() => {
      finish('error', 'Scrape timed out after 5 minutes');
    }, JOB_TIMEOUT_MS);
  }, [running, onProgress]);

  return { trigger, running };
}
