import { cn } from '@/lib/utils';
import type { JobStatus } from '../../../shared/types';

export const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  new:          'bg-status-new-bg text-status-new-text border-status-new-border',
  reviewed:     'bg-status-contacted-bg text-status-contacted-text border-status-contacted-border',
  applied:      'bg-status-replied-bg text-status-replied-text border-status-replied-border',
  interviewing: 'bg-status-meeting-bg text-status-meeting-text border-status-meeting-border',
  placed:       'bg-status-client-bg text-status-client-text border-status-client-border',
  rejected:     'bg-status-rejected-bg text-status-rejected-text border-status-rejected-border',
  archived:     'bg-surface-strong text-muted border-hairline',
  converted:    'bg-status-client-bg text-status-client-text border-status-client-border',
};

export default function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border font-medium text-xs px-2.5 py-0.5 capitalize',
      JOB_STATUS_STYLES[status],
      className,
    )}>
      {status}
    </span>
  );
}
