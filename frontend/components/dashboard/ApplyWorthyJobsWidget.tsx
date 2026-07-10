'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Target, ArrowRight, Briefcase } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fetchJobs } from '@/services/jobs';
import { cn } from '@/lib/utils';

export default function ApplyWorthyJobsWidget() {
  const { data } = useQuery({
    queryKey: ['apply-worthy-jobs'],
    queryFn: () => fetchJobs({
      verdict: 'apply',
      sort_by: 'posted_at',
      sort_order: 'desc',
      per_page: 7,
    }),
  });

  const jobs = data?.data ?? [];

  return (
    <div className="card-bento flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
            <Target className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h3 className="text-[13.5px] font-semibold text-ink">Apply-Worthy Jobs</h3>
          {data && (
            <span className="text-[11px] text-muted bg-white/5 px-1.5 py-0.5 rounded-full">
              {data.total} open
            </span>
          )}
        </div>
        <Link
          href="/jobs"
          className="flex items-center gap-1 text-[12px] text-brand-400 hover:text-brand-300 font-medium transition-colors"
        >
          All <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 text-center">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <Briefcase className="w-5 h-5 text-muted" />
            </div>
            <p className="text-[13px] font-medium text-muted">No apply-worthy jobs yet</p>
            <p className="text-[12px] text-muted/60 mt-1">Run a remote-jobs scrape to fill the queue</p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {jobs.map(job => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className={cn(
                    'flex items-center gap-3 px-5 py-3',
                    'hover:bg-white/5 transition-colors',
                    'group',
                  )}
                >
                  <div className="w-7 h-7 rounded-lg bg-surface-strong flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-muted group-hover:bg-emerald-500/10 group-hover:text-emerald-400 transition-colors">
                    {job.company_name.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate group-hover:text-brand-300 transition-colors">
                      {job.job_title ?? 'Untitled role'}
                    </p>
                    <p className="text-[11.5px] text-muted truncate">
                      {[
                        job.company_name,
                        job.salary_text,
                        job.posted_at
                          ? formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })
                          : job.posted_at_raw,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
