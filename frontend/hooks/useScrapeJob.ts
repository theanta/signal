'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { triggerScrape } from '@/services/outreach';
import { tokenStore } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { ScrapeSourceState, ScrapeStreamEvent } from '../../shared/types';

const JOB_TIMEOUT_MS = 5 * 60_000;

export function useScrapeJob(onComplete?: () => void, onProgress?: () => void) {
  const [running, setRunning] = useState(false);
  const [sources, setSources] = useState<Record<string, ScrapeSourceState>>({});

  const abortRef     = useRef<AbortController | null>(null);
  const timeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback(async () => {
    if (running) return;

    abortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setRunning(true);
    const toastId = toast.loading('Scrape started — monitoring job…');

    let jobId: string;
    try {
      const result = await triggerScrape();
      jobId = result.job_id;
      setSources(Object.fromEntries(
        result.sources.map(s => [s, { status: 'pending' } as ScrapeSourceState]),
      ));
      onProgressRef.current?.();
    } catch {
      toast.resolve(toastId, 'error', 'Failed to start scrape', 'Is the signal engine online?');
      setRunning(false);
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    function finish(type: 'success' | 'error', message: string, description?: string) {
      abort.abort();
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setRunning(false);
      toast.resolve(toastId, type, message, description);
      if (type === 'success') onCompleteRef.current?.();
    }

    timeoutRef.current = setTimeout(() => {
      finish('error', 'Scrape timed out after 5 minutes');
    }, JOB_TIMEOUT_MS);

    const token = tokenStore.getToken();

    fetch(`/api/signals/scrape/${jobId}/stream`, {
      signal: abort.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(response => {
        if (!response.ok || !response.body) throw new Error('Stream failed');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) return;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const event of events) {
              for (const line of event.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const data = JSON.parse(line.slice(6)) as ScrapeStreamEvent;

                  if (data.phase === 'snapshot') {
                    setSources(prev => ({ ...prev, ...data.sources }));
                    // A client that connects (or reconnects) after the job already
                    // finished won't get a separate 'complete' event — this is it.
                    if (data.overall_status !== 'running') {
                      finish(
                        data.overall_status === 'completed' ? 'success' : 'error',
                        data.overall_status === 'completed' ? 'Scrape complete' : 'Scrape job failed',
                      );
                      return;
                    }
                  } else if (data.phase === 'source') {
                    setSources(prev => ({
                      ...prev,
                      [data.source]: { status: data.status, leads_found: data.leads_found, error: data.error },
                    }));
                    onProgressRef.current?.();
                  } else if (data.phase === 'complete') {
                    const n = data.results ?? 0;
                    finish(
                      data.status === 'completed' ? 'success' : 'error',
                      data.status === 'completed'
                        ? `Scrape complete — ${n} lead${n !== 1 ? 's' : ''} found`
                        : 'Scrape job failed',
                    );
                    return;
                  } else if (data.phase === 'error') {
                    finish('error', 'Scrape job failed', data.message);
                    return;
                  }
                } catch { /* malformed event */ }
              }
            }
            return pump();
          });

        return pump();
      })
      .catch(err => {
        if ((err as Error).name !== 'AbortError') {
          finish('error', 'Scrape job failed', 'Lost connection to signal engine');
        }
      });
  }, [running]);

  return { trigger, running, sources };
}
