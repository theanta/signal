'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { triggerScrape, getScrapeStatus } from '@/services/outreach';
import { useToast } from '@/components/ui/Toast';

const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS = 5 * 60_000;

export function useScrapeJob(onComplete?: () => void) {
  const [running, setRunning] = useState(false);
  const { addToast, updateToast } = useToast();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback(async () => {
    if (running) return;

    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setRunning(true);
    const toastId = addToast({
      type: 'info',
      message: 'Scrape started — monitoring job…',
      persistent: true,
    });

    let jobId: string;
    try {
      const result = await triggerScrape();
      jobId = result.job_id;
    } catch {
      updateToast(toastId, {
        type: 'error',
        message: 'Failed to start scrape — is the signal engine online?',
        persistent: false,
      });
      setRunning(false);
      return;
    }

    function finish(type: 'success' | 'error', message: string) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setRunning(false);
      updateToast(toastId, { type, message, persistent: false });
      if (type === 'success') onCompleteRef.current?.();
    }

    intervalRef.current = setInterval(async () => {
      try {
        const status = await getScrapeStatus(jobId);
        if (status.status === 'completed') {
          const n = status.results ?? 0;
          finish('success', `Scrape complete — ${n} lead${n !== 1 ? 's' : ''} found`);
        } else if (status.status === 'failed') {
          finish('error', 'Scrape job failed');
        }
        // 'running' / unknown → keep polling
      } catch {
        // ignore transient network errors during polling
      }
    }, POLL_INTERVAL_MS);

    timeoutRef.current = setTimeout(() => {
      finish('error', 'Scrape timed out after 5 minutes');
    }, JOB_TIMEOUT_MS);
  }, [running, addToast, updateToast]);

  return { trigger, running };
}
