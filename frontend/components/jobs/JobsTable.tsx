'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ChevronLeft, ChevronRight, Briefcase, UserPlus, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { TableRowSkeleton } from '@/components/ui/Skeleton';
import JobStatusBadge from '@/components/jobs/JobStatusBadge';
import JobVerdictBadge from '@/components/jobs/JobVerdictBadge';
import { convertJobToLead } from '@/services/jobs';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { Job } from '../../../shared/types';

const SOURCE_LABELS: Record<Job['source'], string> = {
  indeed:    'Indeed',
  linkedin:  'LinkedIn',
  remoteok:  'RemoteOK',
  remotive:  'Remotive',
};

interface JobsTableProps {
  jobs: Job[];
  total: number;
  page: number;
  totalPages: number;
  isLoading?: boolean;
  onPageChange: (p: number) => void;
}

export default function JobsTable({ jobs, total, page, totalPages, isLoading = false, onPageChange }: JobsTableProps) {
  const qc = useQueryClient();

  const convertMutation = useMutation({
    mutationFn: (id: string) => convertJobToLead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Converted to a lead');
    },
    onError: () => toast.error('Failed to convert job to a lead'),
  });

  const thCn = 'sticky top-0 bg-canvas z-10 border-b border-hairline px-4 py-2 text-left text-2xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap';

  if (isLoading) {
    return (
      <div className="card overflow-hidden">
        <table className="w-full">
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={9} />)}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={thCn}>Company</th>
              <th className={thCn}>Role</th>
              <th className={thCn}>Verdict</th>
              <th className={thCn}>Location</th>
              <th className={thCn}>Salary</th>
              <th className={thCn}>Source</th>
              <th className={thCn}>Posted</th>
              <th className={thCn}>Status</th>
              <th className={cn(thCn, 'w-10')} />
            </tr>
          </thead>

          <tbody className="divide-y divide-hairline">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-20 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-surface-strong flex items-center justify-center">
                      <Briefcase className="w-6 h-6 text-muted/40" />
                    </div>
                    <p className="text-body-sm font-medium text-muted">No job postings found</p>
                    <p className="text-xs text-muted/60">Try running a scrape or adjusting your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map(job => (
                <tr key={job.id} className="group hover:bg-surface-strong transition-colors">
                  {/* Company */}
                  <td className="px-4 py-1.5">
                    <Link href={`/jobs/${job.id}`} className="flex items-center gap-2.5 group/name">
                      <span className="w-7 h-7 rounded-lg bg-surface-strong flex items-center justify-center flex-shrink-0 text-2xs font-semibold text-muted">
                        {job.company_name.charAt(0).toUpperCase()}
                      </span>
                      <p className="text-body-sm font-medium text-ink truncate max-w-[180px] group-hover/name:text-brand-400 transition-colors">
                        {job.company_name}
                      </p>
                    </Link>
                  </td>

                  {/* Role */}
                  <td className="px-4 py-1.5 text-xs text-body max-w-[160px] truncate">
                    <Link href={`/jobs/${job.id}`} className="hover:text-ink transition-colors">
                      {job.job_title ?? '—'}
                    </Link>
                  </td>

                  {/* Verdict */}
                  <td className="px-4 py-1.5">
                    {job.verdict
                      ? <JobVerdictBadge verdict={job.verdict} reasons={job.verdict_reasons} />
                      : <span className="text-xs text-muted/50">—</span>}
                  </td>

                  {/* Location */}
                  <td className="px-4 py-1.5 text-xs text-body whitespace-nowrap max-w-[120px] truncate">
                    {job.location ?? '—'}
                  </td>

                  {/* Salary */}
                  <td className="px-4 py-1.5 text-xs text-body whitespace-nowrap">
                    {job.salary_text ?? '—'}
                  </td>

                  {/* Source */}
                  <td className="px-4 py-1.5 text-xs text-muted whitespace-nowrap">
                    {SOURCE_LABELS[job.source] ?? job.source}
                  </td>

                  {/* Posted */}
                  <td className="px-4 py-1.5 text-xs text-muted whitespace-nowrap">
                    {job.posted_at
                      ? formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })
                      : job.posted_at_raw ?? formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-1.5">
                    <JobStatusBadge status={job.status} />
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {job.source_url && (
                        <a
                          href={job.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View posting"
                          className="p-1.5 rounded-md hover:bg-canvas text-muted hover:text-ink transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {job.status === 'converted' ? (
                        <span title="Already converted to a lead" className="p-1.5 text-emerald-500">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <button
                          title="Convert to lead"
                          disabled={convertMutation.isPending}
                          onClick={() => convertMutation.mutate(job.id)}
                          className="p-1.5 rounded-md hover:bg-canvas text-muted hover:text-ink transition-colors disabled:opacity-50"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-hairline bg-surface-soft/50">
          <span className="text-xs text-muted">
            {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} postings
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-surface-strong"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>

            <span className="px-3 text-xs text-muted">
              Page {page} of {totalPages}
            </span>

            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-surface-strong"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
