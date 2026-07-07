'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Clock, RefreshCw, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScrapeSourceState, LeadSource } from '../../../shared/types';
import { getSourceLabel } from '../../../shared/utils';

interface ScrapeProgressPanelProps {
  running: boolean;
  sources: Record<string, ScrapeSourceState>;
}

export default function ScrapeProgressPanel({ running, sources }: ScrapeProgressPanelProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasRunningRef = useRef(running);

  const sourceNames = Object.keys(sources);
  const hasJob = sourceNames.length > 0;

  // Auto-open the instant a scrape starts; auto-collapse a few seconds after it ends.
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    if (running && !wasRunning) {
      setOpen(true);
    } else if (!running && wasRunning) {
      const t = setTimeout(() => setOpen(false), 4000);
      return () => clearTimeout(t);
    }
  }, [running]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  if (!hasJob) return null;

  // Sources run sequentially in the engine — while the job is running, the
  // first still-pending one is the one actively in progress right now.
  const activeIndex = running ? sourceNames.findIndex(s => sources[s].status === 'pending') : -1;
  const failedCount = sourceNames.filter(s => sources[s].status === 'failed').length;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg border transition-colors',
          running
            ? 'border-info-border bg-surface-strong text-info'
            : failedCount > 0
              ? 'border-error-border bg-surface-strong text-error'
              : 'border-hairline hover:bg-surface-strong text-muted',
        )}
        title="Scrape progress"
      >
        {running
          ? <RefreshCw className="w-4 h-4 animate-spin" />
          : failedCount > 0
            ? <XCircle className="w-4 h-4" />
            : <Activity className="w-4 h-4" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-canvas border border-hairline rounded-lg shadow-lg overflow-hidden w-64">
          <div className="px-3 py-2 border-b border-hairline">
            <p className="text-body-sm font-medium text-ink">Scrape progress</p>
          </div>
          {sourceNames.map((source, i) => {
            const state = sources[source];
            const isRunning = i === activeIndex;
            return (
              <div
                key={source}
                className="flex items-start gap-2.5 px-3 py-2 border-b border-hairline last:border-b-0"
              >
                {isRunning ? (
                  <RefreshCw className="w-3.5 h-3.5 text-info animate-spin flex-shrink-0 mt-0.5" />
                ) : state.status === 'completed' ? (
                  <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
                ) : state.status === 'failed' ? (
                  <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0 mt-0.5" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-muted flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm text-ink leading-tight">
                    {getSourceLabel(source as LeadSource)}
                  </p>
                  {state.status === 'completed' && (
                    <p className="text-2xs text-muted mt-0.5">
                      {state.leads_found ?? 0} lead{state.leads_found === 1 ? '' : 's'} found
                    </p>
                  )}
                  {state.status === 'failed' && (
                    <p className="text-2xs text-error mt-0.5 truncate" title={state.error ?? undefined}>
                      {state.error ?? 'Failed'}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
