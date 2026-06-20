import { cn } from '@/lib/utils';
import type { LeadStatus } from '../../../shared/types';

const STATUS_CONFIG: Record<LeadStatus, { label: string; styles: string }> = {
  new:       { label: 'New',       styles: 'bg-slate-100  text-slate-600  border-slate-200' },
  analyzed:  { label: 'Analyzed',  styles: 'bg-blue-50    text-blue-700   border-blue-200' },
  contacted: { label: 'Contacted', styles: 'bg-indigo-50  text-indigo-700 border-indigo-200' },
  replied:   { label: 'Replied',   styles: 'bg-violet-50  text-violet-700 border-violet-200' },
  meeting:   { label: 'Meeting',   styles: 'bg-amber-50   text-amber-700  border-amber-200' },
  proposal:  { label: 'Proposal',  styles: 'bg-orange-50  text-orange-700 border-orange-200' },
  client:    { label: 'Client',    styles: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

interface StatusBadgeProps {
  status: LeadStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    styles: 'bg-slate-100 text-slate-500 border-slate-200',
  };

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
