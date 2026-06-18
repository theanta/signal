'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useScrapeJob } from '@/hooks/useScrapeJob';
import PageHeader from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { RefreshCw, Zap, CheckCircle, XCircle, Clock, Activity } from 'lucide-react';
import { clsx } from 'clsx';
import type { ScrapingLog, LeadSource } from '../../../shared/types';
import { getSourceLabel } from '../../../shared/utils';

async function fetchLogs(): Promise<ScrapingLog[]> {
  const { data } = await api.get('/signals/logs?limit=30');
  return data.data;
}

async function fetchSignalHealth(): Promise<{ signal_engine_online: boolean }> {
  const { data } = await api.get('/signals/health');
  return data.data;
}

const ACTIVE_SOURCES: LeadSource[] = ['linkedin', 'job_board', 'crunchbase', 'local_business'];

export default function SignalsPage() {
  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['scraping-logs'],
    queryFn: fetchLogs,
    refetchInterval: 30_000,
  });

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['signal-health'],
    queryFn: fetchSignalHealth,
    refetchInterval: 90_000,
  });

  const { trigger: handleScrape, running: scraping } = useScrapeJob(refetch, refetch);

  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircle className="w-4 h-4 text-success" />;
    if (status === 'failed') return <XCircle className="w-4 h-4 text-sig-coral" />;
    if (status === 'running') return <RefreshCw className="w-4 h-4 text-info animate-spin" />;
    return <Clock className="w-4 h-4 text-sig-mustard" />;
  };

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Signals"
        subtitle="Scraping activity and signal detection logs"
        actions={
          <div className="flex items-center gap-3">
            <div className={clsx(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border',
              healthLoading
                ? 'text-muted border-hairline bg-surface-soft'
                : health?.signal_engine_online
                  ? 'text-success border-[#b3dcbe] bg-[#e8f5ec]'
                  : 'text-sig-coral border-[#f5c9b8] bg-[#fcede8]'
            )}>
              {healthLoading
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <Activity className="w-3.5 h-3.5" />}
              Signal Engine {healthLoading ? 'Warming up…' : health?.signal_engine_online ? 'Online' : 'Offline'}
            </div>
            <button
              onClick={handleScrape}
              disabled={scraping}
              className="btn-primary gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
              {scraping ? 'Scraping...' : 'Run Scrape'}
            </button>
          </div>
        }
      />

      <div className="p-8 space-y-5">
        {/* Source stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {ACTIVE_SOURCES.map((key) => {
            const sourceLogs = logs.filter((l: ScrapingLog) => l.source === key);
            const lastLog = sourceLogs[0];
            return (
              <div key={key} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-ink">{getSourceLabel(key)}</span>
                  <Zap className="w-3.5 h-3.5 text-sig-mustard" />
                </div>
                <p className="text-xl font-medium text-ink">
                  {sourceLogs.reduce((sum: number, l: ScrapingLog) => sum + (l.leads_new ?? 0), 0)}
                </p>
                <p className="text-xs text-muted mt-0.5">total new leads</p>
                {lastLog && (
                  <div className="flex items-center gap-1 mt-2">
                    {statusIcon(lastLog.status)}
                    <span className="text-[10px] text-muted">
                      {new Date(lastLog.started_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Logs table */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-hairline">
            <h3 className="text-sm font-medium text-ink">Scraping Activity Log</h3>
          </div>
          {isLoading ? (
            <LoadingSpinner />
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-muted text-sm">
              No scraping activity yet. Click &quot;Run Scrape&quot; to start.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-soft">
                    {['Status', 'Source', 'Found', 'New', 'Updated', 'Duration', 'Started'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(logs as ScrapingLog[]).map(log => (
                    <tr key={log.id} className="table-row">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {statusIcon(log.status)}
                          <span className={clsx('text-xs capitalize', {
                            'text-success':     log.status === 'completed',
                            'text-sig-coral':   log.status === 'failed',
                            'text-info':        log.status === 'running',
                            'text-sig-mustard': log.status === 'partial',
                          })}>
                            {log.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-body text-xs">
                        {getSourceLabel(log.source as LeadSource)}
                      </td>
                      <td className="px-4 py-2.5 text-body font-mono text-xs">{log.leads_found ?? 0}</td>
                      <td className="px-4 py-2.5 text-success font-mono text-xs">{log.leads_new ?? 0}</td>
                      <td className="px-4 py-2.5 text-info font-mono text-xs">{log.leads_updated ?? 0}</td>
                      <td className="px-4 py-2.5 text-muted text-xs">
                        {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted text-xs">
                        {new Date(log.started_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
