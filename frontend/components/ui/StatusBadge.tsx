import { cn } from '@/lib/utils';
import type { LeadStatus } from '../../../shared/types';

const STATUS_CONFIG: Record<LeadStatus, { label: string; styles: string; dot: string }> = {
  new:       { label: 'New',       styles: 'bg-slate-100  text-slate-600  border-slate-200',    dot: 'bg-slate-400' },
  analyzed:  { label: 'Analyzed',  styles: 'bg-blue-50    text-blue-700   border-blue-200',     dot: 'bg-blue-500' },
  contacted: { label: 'Contacted', styles: 'bg-indigo-50  text-indigo-700 border-indigo-200',   dot: 'bg-indigo-500' },
  replied:   { label: 'Replied',   styles: 'bg-violet-50  text-violet-700 border-violet-200',   dot: 'bg-violet-500' },
  meeting:   { label: 'Meeting',   styles: 'bg-amber-50   text-amber-700  border-amber-200',    dot: 'bg-amber-500' },
  proposal:  { label: 'Proposal',  styles: 'bg-orange-50  text-orange-700 border-orange-200',   dot: 'bg-orange-500' },
  client:    { label: 'Client',    styles: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
};

interface StatusBadgeProps {
  status: LeadStatus;
  size?: 'sm' | 'md';
  variant?: 'pill' | 'dot';
}

export default function StatusBadge({ status, size = 'md', variant = 'pill' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    styles: 'bg-slate-100 text-slate-500 border-slate-200',
    dot: 'bg-slate-400',
  };

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
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
