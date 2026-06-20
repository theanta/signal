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

const COLOR_MAP: Record<NonNullable<MetricCardProps['color']>, { icon: string }> = {
  coral:   { icon: 'bg-rose-50    text-rose-500' },
  forest:  { icon: 'bg-emerald-50 text-emerald-600' },
  ink:     { icon: 'bg-slate-100  text-slate-600' },
  mustard: { icon: 'bg-amber-50   text-amber-600' },
  info:    { icon: 'bg-blue-50    text-blue-600' },
  neutral: { icon: 'bg-slate-50   text-slate-400' },
};

export default function MetricCard({
  label, value, icon: Icon, color = 'ink', sublabel, trend,
}: MetricCardProps) {
  const { icon: iconCn } = COLOR_MAP[color];

  return (
    <div className="card p-5 hover:shadow-card-md transition-shadow duration-150">
      {/* Top row: label + icon */}
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
          {label}
        </p>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', iconCn)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {/* Value */}
      <p className="text-[32px] font-semibold text-ink leading-none mt-3 tracking-tight">
        {value}
      </p>

      {/* Bottom row: sublabel + trend */}
      <div className="flex items-center justify-between mt-2">
        {sublabel ? (
          <p className="text-[12px] text-neutral-400">{sublabel}</p>
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
      <span className="flex items-center gap-0.5 text-[11px] font-medium text-neutral-400">
        <Minus className="w-3 h-3" /> flat
      </span>
    );
  }

  const isUp = direction === 'up';
  return (
    <span className={cn(
      'flex items-center gap-0.5 text-[11px] font-semibold',
      isUp ? 'text-emerald-600' : 'text-rose-500',
    )}>
      {isUp
        ? <TrendingUp className="w-3 h-3" />
        : <TrendingDown className="w-3 h-3" />
      }
      {Math.abs(value)}%
    </span>
  );
}
