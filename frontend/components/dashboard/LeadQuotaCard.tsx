'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLeadQuota } from '@/services/metrics';
import type { QuotaPeriodUsage } from '../../../shared/types';

/**
 * How many new leads the org has had analyzed today, this week and this
 * month, against its lead quota. Re-analyzing a lead does not count.
 */

const LABEL: Record<QuotaPeriodUsage['period'], string> = { day: 'Today', week: 'This week', month: 'This month' };

function resetsText(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(iso));
}

export default function LeadQuotaCard() {
  const { data: quota } = useQuery({ queryKey: ['lead-quota'], queryFn: fetchLeadQuota, refetchInterval: 60_000 });
  if (!quota || quota.periods.every(p => p.limit === null)) return null;

  return (
    <div className="card-bento p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13.5px] font-semibold text-ink flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted" />
          Lead quota
        </h3>
        <span className={cn('text-2xs', quota.remaining === 0 ? 'text-rose-400 font-medium' : 'text-muted')}>
          {quota.remaining === 0 && quota.blocked_until
            ? `Limit reached · resumes ${resetsText(quota.blocked_until, quota.timezone)}`
            : quota.remaining !== null ? `${quota.remaining} new leads left now` : ''}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {quota.periods.map(p => {
          const pct = p.limit ? Math.min(100, Math.round((100 * p.used) / p.limit)) : 0;
          return (
            <div key={p.period} className="space-y-1.5">
              <div className="flex justify-between text-2xs">
                <span className="text-muted">{LABEL[p.period]}</span>
                <span className="font-medium text-ink">
                  {p.used}<span className="text-muted/50">{p.limit === null ? ' · no limit' : `/${p.limit}`}</span>
                </span>
              </div>
              {p.limit !== null && (
                <div className="h-1.5 bg-surface-strong rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500',
                      pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-2xs text-muted/70 mt-3">
        A lead counts once, when it is first analyzed. Re-analyzing is free.
      </p>
    </div>
  );
}
