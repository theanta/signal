export default function LeadsLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      {/* Header skeleton */}
      <div className="px-8 py-6 border-b border-hairline flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-20 bg-surface-strong rounded" />
          <div className="h-4 w-48 bg-surface-strong rounded" />
        </div>
        <div className="h-9 w-24 bg-surface-strong rounded-md" />
      </div>

      {/* Tab bar */}
      <div className="px-8 pt-6 pb-0 flex gap-4 border-b border-hairline">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-28 bg-surface-strong rounded" />
        ))}
      </div>

      <div className="p-8 space-y-4">
        {/* Filters */}
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 w-32 bg-surface-strong rounded-md" />
          ))}
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="h-10 bg-surface-strong border-b border-hairline" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-hairline last:border-0">
              <div className="h-4 w-40 bg-surface-strong rounded" />
              <div className="h-4 w-24 bg-surface-strong rounded" />
              <div className="h-4 w-20 bg-surface-strong rounded" />
              <div className="ml-auto h-6 w-12 bg-surface-strong rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
