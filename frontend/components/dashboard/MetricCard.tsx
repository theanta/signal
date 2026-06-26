import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Trend {
  value: number;
  direction: 'up' | 'down' | 'flat';
}

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color?: 'coral' | 'forest' | 'ink' | 'mustard' | 'info' | 'neutral';
  sublabel?: string;
  trend?: Trend;
}

const COLOR_MAP: Record<NonNullable<MetricCardProps['color']>, { icon: string; glow: string }> = {
  coral:   { icon: 'bg-rose-500/10   text-rose-400',    glow: 'group-hover:shadow-[0_0_16px_rgba(244,63,94,0.12)]' },
  forest:  { icon: 'bg-emerald-500/10 text-emerald-400', glow: 'group-hover:shadow-[0_0_16px_rgba(52,211,153,0.12)]' },
  ink:     { icon: 'bg-surface-strong  text-slate-400',   glow: '' },
  mustard: { icon: 'bg-amber-500/10   text-amber-400',   glow: 'group-hover:shadow-[0_0_16px_rgba(251,191,36,0.12)]' },
  info:    { icon: 'bg-blue-500/10    text-blue-400',    glow: 'group-hover:shadow-[0_0_16px_rgba(96,165,250,0.12)]' },
  neutral: { icon: 'bg-surface-strong  text-slate-500',   glow: '' },
};

export default function MetricCard({
  label, value, icon: Icon, color = 'ink', sublabel, trend,
}: MetricCardProps) {
  const { icon: iconCn, glow } = COLOR_MAP[color];

  return (
    <div className={cn('card-bento p-5 group transition-all duration-200', glow)}>
      {/* Top row: label + icon */}
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          {label}
        </p>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', iconCn)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {/* Value — gradient text */}
      <p className="metric-value text-[32px] font-semibold leading-none mt-3 tracking-tight">
        {value}
      </p>

      {/* Bottom row: sublabel + trend */}
      <div className="flex items-center justify-between mt-2">
        {sublabel ? (
          <p className="text-[12px] text-muted">{sublabel}</p>
        ) : (
          <span />
        )}
        {trend && <TrendIndicator trend={trend} />}
      </div>
    </div>
  );
}

function TrendIndicator({ trend }: { trend: Trend }) {
  const { direction, value } = trend;

  if (direction === 'flat') {
    return (
      <span className="flex items-center gap-0.5 text-[11px] font-medium text-muted">
        <Minus className="w-3 h-3" /> flat
      </span>
    );
  }

  const isUp = direction === 'up';
  return (
    <span className={cn(
      'flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full',
      isUp
        ? 'text-emerald-400 bg-emerald-500/10'
        : 'text-rose-400 bg-rose-500/10',
    )}>
      {isUp
        ? <TrendingUp className="w-3 h-3" />
        : <TrendingDown className="w-3 h-3" />
      }
      {Math.abs(value)}%
    </span>
  );
}
