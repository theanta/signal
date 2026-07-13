'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fetchConfig } from '@/services/config';
import {
  RefreshCw, CheckCircle, XCircle, Activity, Wifi, WifiOff, Brain,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import type { CronJobLog } from '../../../shared/types';
import { cn } from '@/lib/utils';

export default function SystemPage() {
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [jobDone, setJobDone] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ['platform-config'],
    queryFn: fetchConfig,
  });

  const { data: healthData, isLoading: healthLoading } = useQuery<Record<string, 'ok' | 'error'>>({
    queryKey: ['integration-health'],
    queryFn: async () => {
      const { data } = await api.get('/health');
      return data;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const { data: cronLogs = [], isError: cronLogsError, refetch: refetchCronLogs } = useQuery<CronJobLog[]>({
    queryKey: ['cron-logs'],
    queryFn: async () => {
      const { data } = await api.get('/cron/logs');
      return data.data;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  async function triggerJob(job: string) {
    setRunningJob(job);
    setJobDone(null);
    try {
      await api.post(`/cron/run/${job}`);
      setJobDone(job);
      setTimeout(() => setJobDone(null), 3000);
      setTimeout(() => refetchCronLogs(), 1500);
    } finally {
      setRunningJob(null);
    }
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader title="System" icon={Activity} />

      <main className="p-8 max-w-2xl space-y-6">
        {/* Automation schedule */}
        <div>
          <h2 className="text-sm font-medium text-ink mb-0.5 mt-2">Automation Schedule</h2>
          <p className="text-xs text-muted">Configured via environment variables.</p>
        </div>
        <div className="card p-5">
          <div className="space-y-0">
            {[
              { label: 'Daily Scrape',        schedule: '6:00 AM EST', env: 'CRON_DAILY_SCRAPE' },
              { label: 'Lead Analysis',       schedule: '7:00 AM EST', env: 'CRON_ANALYZE_LEADS' },
              { label: 'Outreach Generation', schedule: '8:00 AM EST', env: 'CRON_GENERATE_OUTREACH' },
            ].map(({ label, schedule, env }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-hairline last:border-0">
                <div>
                  <p className="text-sm text-ink">{label}</p>
                  <p className="text-xs text-muted font-mono">{env}</p>
                </div>
                <span className="text-sm text-info font-mono">{schedule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Manual triggers */}
        <div>
          <h2 className="text-sm font-medium text-ink mb-0.5">Manual Job Triggers</h2>
          <p className="text-xs text-muted">Run pipeline steps on demand.</p>
        </div>
        <div className="card p-5 space-y-2">
          {[
            { job: 'scrape',    label: 'Run Daily Scrape',       desc: 'Scrape LinkedIn and job boards now' },
            { job: 'biweekly', label: 'Run Bi-weekly Scrape',   desc: 'Scrape Crunchbase and local business sources now' },
            { job: 'analyze',  label: 'Analyze New Leads',      desc: 'Run signal detection on unanalyzed leads (batch of 20)' },
            { job: 'outreach', label: 'Generate Outreach',      desc: 'Generate cold emails for top-scored analyzed leads' },
          ].map(({ job, label, desc }) => (
            <div key={job} className="flex items-center justify-between p-4 bg-surface-soft rounded-md">
              <div>
                <p className="text-sm font-medium text-ink">{label}</p>
                <p className="text-xs text-muted mt-0.5">{desc}</p>
              </div>
              <button
                onClick={() => triggerJob(job)}
                disabled={runningJob !== null}
                className="btn-secondary gap-2 ml-4 flex-shrink-0"
              >
                {runningJob === job ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : jobDone === job ? <CheckCircle className="w-4 h-4 text-success" />
                  : <RefreshCw className="w-4 h-4" />}
                {runningJob === job ? 'Running...' : jobDone === job ? 'Triggered!' : 'Run Now'}
              </button>
            </div>
          ))}
        </div>

        {/* Job run history */}
        <div className="flex items-center justify-between mt-2">
          <div>
            <h2 className="text-sm font-medium text-ink mb-0.5">Job Run History</h2>
            <p className="text-xs text-muted">Last 40 scheduled and manual runs.</p>
          </div>
          <button onClick={() => refetchCronLogs()} className="btn-secondary gap-1.5 text-xs py-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        <div className="card overflow-hidden">
          {cronLogsError ? (
            <div className="py-10 text-center text-sm">
              <XCircle className="w-5 h-5 text-error mx-auto mb-2" />
              <p className="text-error font-medium">Failed to load job history</p>
              <p className="text-muted mt-1 text-xs">The <code className="font-mono">cron_job_logs</code> table may not exist yet — run the migration in your Supabase SQL editor.</p>
            </div>
          ) : cronLogs.length === 0 ? (
            <div className="py-10 text-center text-muted text-sm">
              No job runs recorded yet. Runs will appear here once jobs execute.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-soft">
                    {['Status', 'Job', 'Trigger', 'Leads', 'Duration', 'Started'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cronLogs.map((log: CronJobLog) => (
                    <tr key={log.id} className="border-b border-hairline last:border-0 hover:bg-surface-soft transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {log.status === 'success'  && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                          {log.status === 'failed'   && <XCircle    className="w-3.5 h-3.5 text-error" />}
                          {log.status === 'running'  && <Activity   className="w-3.5 h-3.5 text-info animate-pulse" />}
                          <span className={cn('text-xs capitalize', {
                            'text-success':   log.status === 'success',
                            'text-error': log.status === 'failed',
                            'text-info':      log.status === 'running',
                          })}>
                            {log.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink font-medium whitespace-nowrap">
                        {({
                          daily_scrape:      'Daily Scrape',
                          biweekly_scrape:   'Bi-weekly Scrape',
                          analyze_leads:     'Lead Analysis',
                          generate_outreach: 'Outreach Generation',
                        } as Record<string, string>)[log.job_name] ?? log.job_name}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', {
                          'bg-surface-soft text-muted border-hairline': log.trigger_type === 'scheduled',
                          'bg-status-active-bg text-success border-status-active-border': log.trigger_type === 'manual',
                        })}>
                          {log.trigger_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-body">
                        {log.leads_processed != null ? log.leads_processed : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted font-mono">
                        {log.duration_ms != null ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                        {new Date(log.started_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Integration status */}
        <div className="flex items-center justify-between mt-2">
          <h2 className="text-sm font-medium text-ink mb-0.5">Integration Status</h2>
          {healthLoading && (
            <RefreshCw className="w-3.5 h-3.5 text-muted animate-spin" />
          )}
        </div>
        <div className="card p-5 space-y-0">
          {([
            { label: 'Supabase Database', env: 'SUPABASE_URL',      key: 'supabase' },
            { label: 'AI Model (Groq)',    env: 'GROQ_API_KEY',      key: 'groq' },
            { label: 'Signal Engine',      env: 'SIGNAL_ENGINE_URL', key: 'signal_engine' },
          ] as const).map(({ label, env, key }) => {
            const status = healthData?.[key];
            return (
              <div key={key} className="flex items-center justify-between py-2.5 border-b border-hairline last:border-0">
                <div>
                  <p className="text-sm text-ink">{label}</p>
                  <p className="text-xs text-muted font-mono">{env}</p>
                </div>
                {healthLoading || !healthData ? (
                  <span className="text-xs text-muted">Checking…</span>
                ) : status === 'ok' ? (
                  <span className="flex items-center gap-1.5 text-xs text-success font-medium">
                    <Wifi className="w-3.5 h-3.5" /> Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-error font-medium">
                    <WifiOff className="w-3.5 h-3.5" /> Error
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* About */}
        <div className="card p-5 space-y-1.5 text-sm text-body">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-muted" />
            <span className="text-sm font-medium text-ink">About</span>
          </div>
          <p><span className="text-ink font-medium">Platform:</span> Lead Radar v1.0.0</p>
          <p><span className="text-ink font-medium">AI Model:</span> Groq / llama-3.3-70b-versatile</p>
          <p><span className="text-ink font-medium">Agency:</span> {config ? `${config.agency_name} · ${config.agency_location}` : '—'}</p>
          <p><span className="text-ink font-medium">Stack:</span> Next.js 14 · Node.js · Python FastAPI · Supabase</p>
        </div>
      </main>
    </div>
  );
}
