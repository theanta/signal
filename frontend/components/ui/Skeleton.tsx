import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('skeleton', className)} />
  );
}

// ── Preset layouts ──

export function MetricCardSkeleton() {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="w-8 h-8 rounded-md" />
      </div>
      <Skeleton className="h-8 w-16 rounded" />
      <Skeleton className="h-3 w-32 rounded" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={`h-4 rounded ${i === 0 ? 'w-32' : i === cols - 1 ? 'w-16' : 'w-24'}`} />
        </td>
      ))}
    </tr>
  );
}

export function LeadsTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRowSkeleton key={i} cols={7} />
      ))}
    </>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 card p-5 space-y-3">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
        <div className="col-span-2 card p-5 space-y-3">
          <Skeleton className="h-4 w-28 rounded" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-7 h-7 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-36 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
              </div>
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
