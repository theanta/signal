import { clsx } from 'clsx';
import type { LeadStatus } from '../../../shared/types';

const STATUS_CONFIG: Record<LeadStatus, { label: string; className: string }> = {
  new:       { label: 'New',       className: 'bg-surface-strong text-body' },
  analyzed:  { label: 'Analyzed',  className: 'bg-[#eaf0fb] text-info border border-[#c5d7f5]' },
  contacted: { label: 'Contacted', className: 'bg-[#f0ebfb] text-[#6b3fbf] border border-[#d4c3f5]' },
  replied:   { label: 'Replied',   className: 'bg-[#fdf3df] text-[#9a6b00] border border-[#f0d990]' },
  meeting:   { label: 'Meeting',   className: 'bg-[#e8f5ec] text-success border border-[#b3dcbe]' },
  proposal:  { label: 'Proposal',  className: 'bg-[#fff0e8] text-[#b84f00] border border-[#f5c9a8]' },
  client:    { label: 'Client',    className: 'bg-[#e6f2e6] text-success border border-[#a3cfaa]' },
};

export default function StatusBadge({ status }: { status: LeadStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-surface-strong text-body' };
  return <span className={clsx('badge text-xs', config.className)}>{config.label}</span>;
}
