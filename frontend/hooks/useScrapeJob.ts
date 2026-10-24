'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { triggerScrape } from '@/services/outreach';
import { tokenStore } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { ScrapeSourceState, ScrapeStreamEvent } from '../../shared/types';

const JOB_TIMEOUT_MS = 5 * 60_000;
// A dropped stream (deploy, proxy idle timeout, flaky network) reconnects
// with Last-Event-ID and resumes where it left off.
const MAX_RECONNECTS = 5;
const RECONNECT_DELAY_MS = 2_000;
// A run is still in progress in any of these; 'finalizing' means its
// scrapers are done and its leads are being written.
const ACTIVE_STATUSES = new Set(['queued', 'running', 'finalizing']);

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
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
      if (res?.status === 409) {
        toast.resolve(toastId, 'error', 'A scrape is already running', 'Wait for it to finish, then try again.');
      } else {
        toast.resolve(toastId, 'error', 'Failed to start scrape', 'Is the signal engine online?');
      }
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

    let done = false;
    let lastEventId: string | null = null;
    let reconnects = 0;

    function end(type: 'success' | 'error', message: string, description?: string) {
      done = true;
      finish(type, message, description);
    }

    function handle(data: ScrapeStreamEvent) {
      if (data.phase === 'snapshot') {
        setSources(prev => ({ ...prev, ...data.sources }));
        // A client that connects (or reconnects) after the job already
        // finished won't get a separate 'complete' event — this is it.
        if (!ACTIVE_STATUSES.has(data.overall_status)) {
          end(
            data.overall_status === 'completed' ? 'success' : 'error',
            data.overall_status === 'completed' ? 'Scrape complete' : 'Scrape job failed',
          );
        }
      } else if (data.phase === 'source') {
        setSources(prev => ({
          ...prev,
          [data.source]: { status: data.status, leads_found: data.leads_found, error: data.error },
        }));
        onProgressRef.current?.();
      } else if (data.phase === 'complete') {
        const n = data.results ?? 0;
        end(
          data.status === 'completed' ? 'success' : 'error',
          data.status === 'completed'
            ? `Scrape complete — ${n} lead${n !== 1 ? 's' : ''} found`
            : 'Scrape job failed',
        );
      } else if (data.phase === 'error') {
        end('error', 'Scrape job failed', data.message);
      }
    }

    async function connect(): Promise<void> {
      const token = tokenStore.getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;

      const response = await fetch(`/api/signals/scrape/${jobId}/stream`, {
        signal: abort.signal,
        headers,
      });
      if (!response.ok || !response.body) throw new Error('Stream failed');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) return;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (line.startsWith('id: ')) {
              lastEventId = line.slice(4).trim();
            } else if (line.startsWith('data: ')) {
              try {
                handle(JSON.parse(line.slice(6)) as ScrapeStreamEvent);
              } catch { /* malformed event */ }
              if (done) return;
            }
          }
        }
      }
    }

    (async () => {
      while (!done) {
        try {
          await connect();
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
        }
        if (done || abort.signal.aborted) return;
        // The stream closed before the run did. Resume after the last event seen.
        if (++reconnects > MAX_RECONNECTS) {
          end('error', 'Scrape job failed', 'Lost connection to signal engine');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
      }
    })();
  }, [running]);

  return { trigger, running, sources };
}
