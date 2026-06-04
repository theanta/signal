'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchPipeline } from '@/services/metrics';
import type { PipelineSummary } from '../../../shared/types';
import StatusBadge from '@/components/ui/StatusBadge';

const STATUS_ORDER = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'] as const;

export default function PipelineBar() {
  const { data: pipeline = [] } = useQuery({
    queryKey: ['pipeline'],
    queryFn: fetchPipeline,
  });

  const pipelineMap = Object.fromEntries((pipeline as PipelineSummary[]).map(p => [p.status, p]));
  const total = (pipeline as PipelineSummary[]).reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="card p-5">
      <h3 className="text-sm font-medium text-ink mb-4">Lead Pipeline</h3>
      <div className="space-y-3">
        {STATUS_ORDER.map(status => {
          const item = pipelineMap[status];
          const count = item?.count ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <div key={status} className="flex items-center gap-3">
              <div className="w-20 flex-shrink-0">
                <StatusBadge status={status} />
              </div>
              <div className="flex-1 h-1 bg-surface-strong rounded-full overflow-hidden">
                <div
                  className="h-full bg-ink rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm font-medium text-body w-8 text-right">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
