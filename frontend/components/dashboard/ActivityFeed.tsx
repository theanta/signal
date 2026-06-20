'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle, XCircle, Loader, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScrapingLog } from '../../../shared/types';
import { getSourceLabel } from '../../../shared/utils';

async function fetchRecentLogs(): Promise<ScrapingLog[]> {
  const { data } = await api.get('/signals/logs?limit=5');
  return data.data;
}

const STATUS_CONFIG = {
  completed: { icon: CheckCircle, cn: 'text-emerald-500', dot: 'bg-emerald-400' },
  failed:    { icon: XCircle,     cn: 'text-rose-500',    dot: 'bg-rose-400'    },
  running:   { icon: Loader,      cn: 'text-blue-500 animate-spin', dot: 'bg-blue-400 animate-pulse-dot' },
  partial:   { icon: AlertCircle, cn: 'text-amber-500',   dot: 'bg-amber-400'   },
} as const;

export default function ActivityFeed() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: fetchRecentLogs,
    refetchInterval: 30_000,
  });

  return (
    <div className="card p-5">
      <h3 className="text-[13.5px] font-semibold text-ink mb-4">Recent Activity</h3>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton w-6 h-6 rounded-full" />
              <div className="skeleton h-3 flex-1 rounded" />
              <div className="skeleton h-3 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-[13px] text-neutral-400 text-center py-4">
          No scraping activity yet — run a scrape from the dashboard.
        </p>
      ) : (
        <ol className="relative border-l border-neutral-100 ml-3 space-y-0">
          {logs.map((log, i) => {
            const cfg = STATUS_CONFIG[log.status] ?? STATUS_CONFIG.partial;
            const Icon = cfg.icon;
            const isLast = i === logs.length - 1;

            return (
              <li key={log.id} className={cn('ml-4 pb-4', isLast && 'pb-0')}>
                {/* Timeline dot */}
                <span className={cn(
                  'absolute -left-[5px] w-2.5 h-2.5 rounded-full border-2 border-white',
                  cfg.dot,
                )} />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', cfg.cn)} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-ink truncate">
                        {getSourceLabel(log.source)} scrape
                      </p>
                      {log.leads_found > 0 && (
                        <p className="text-[11.5px] text-neutral-400">
                          {log.leads_found} lead{log.leads_found !== 1 ? 's' : ''} found
                          {log.leads_new > 0 && ` · ${log.leads_new} new`}
                        </p>
                      )}
                      {log.status === 'failed' && log.error_message && (
                        <p className="text-[11px] text-rose-500 truncate mt-0.5">
                          {log.error_message}
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="text-[11px] text-neutral-400 flex-shrink-0 whitespace-nowrap">
                    {formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
