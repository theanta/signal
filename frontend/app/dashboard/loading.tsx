export default function DashboardLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      {/* Header skeleton */}
      <div className="px-8 py-6 border-b border-hairline flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-32 bg-surface-strong rounded" />
          <div className="h-4 w-64 bg-surface-strong rounded" />
        </div>
        <div className="h-9 w-28 bg-surface-strong rounded-md" />
      </div>

      <div className="p-8 space-y-6">
        {/* Metric cards row 1 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="h-4 w-20 bg-surface-strong rounded" />
              <div className="h-8 w-16 bg-surface-strong rounded" />
            </div>
          ))}
        </div>

        {/* Metric cards row 2 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="h-4 w-20 bg-surface-strong rounded" />
              <div className="h-8 w-16 bg-surface-strong rounded" />
            </div>
          ))}
        </div>

        {/* Pipeline + Hot Leads */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5 space-y-3">
            <div className="h-4 w-24 bg-surface-strong rounded" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 bg-surface-strong rounded" />
            ))}
          </div>
          <div className="card p-5 space-y-3">
            <div className="h-4 w-24 bg-surface-strong rounded" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-surface-strong rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
