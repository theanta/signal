import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobVerdict } from '../../../shared/types';

const VERDICT_STYLES: Record<JobVerdict, { cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  apply:   { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  caution: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20',       icon: AlertTriangle },
  skip:    { cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20',          icon: XCircle },
};

export default function JobVerdictBadge({ verdict, reasons, className }: {
  verdict: JobVerdict;
  reasons?: string[];
  className?: string;
}) {
  const { cls, icon: Icon } = VERDICT_STYLES[verdict];
  return (
    <span
      title={reasons?.join('\n')}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium text-xs px-2 py-0.5 capitalize',
        cls,
        className,
      )}
    >
      <Icon className="w-3 h-3" />
      {verdict}
    </span>
  );
}
