import { cn } from '@/lib/utils';
import type { LeadStatus } from '../../../shared/types';

const STATUS_CONFIG: Record<LeadStatus, { label: string; styles: string; dot: string }> = {
  new:       { label: 'New',       styles: 'bg-status-new-bg       text-status-new-text       border-status-new-border',       dot: 'bg-slate-500'   },
  analyzed:  { label: 'Analyzed',  styles: 'bg-status-contacted-bg  text-status-contacted-text  border-status-contacted-border',  dot: 'bg-blue-400'    },
  contacted: { label: 'Contacted', styles: 'bg-status-contacted-bg  text-status-contacted-text  border-status-contacted-border',  dot: 'bg-blue-400'    },
  replied:   { label: 'Replied',   styles: 'bg-status-replied-bg    text-status-replied-text    border-status-replied-border',    dot: 'bg-violet-400'  },
  meeting:   { label: 'Meeting',   styles: 'bg-status-meeting-bg    text-status-meeting-text    border-status-meeting-border',    dot: 'bg-amber-400'   },
  proposal:  { label: 'Proposal',  styles: 'bg-[#1a1208] text-orange-400 border-[#3a2010]',                                      dot: 'bg-orange-400'  },
  client:    { label: 'Client',    styles: 'bg-status-client-bg     text-status-client-text     border-status-client-border',     dot: 'bg-emerald-400' },
};

interface StatusBadgeProps {
  status: LeadStatus;
  size?: 'sm' | 'md';
  variant?: 'pill' | 'dot';
}

export default function StatusBadge({ status, size = 'md', variant = 'pill' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    styles: 'bg-status-new-bg text-status-new-text border-status-new-border',
    dot: 'bg-slate-500',
  };

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-body">
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', config.dot)} />
        {config.label}
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center rounded-full border font-medium',
      config.styles,
      size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-0.5',
    )}>
      {config.label}
    </span>
  );
}
