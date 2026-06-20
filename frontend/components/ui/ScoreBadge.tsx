import { cn, scoreTier } from '@/lib/utils';

interface ScoreBadgeProps {
  score: number | undefined | null;
  size?: 'sm' | 'md';
}

const TIER_STYLES = {
  hot:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  warm: 'bg-amber-50  text-amber-700  border-amber-200',
  cold: 'bg-slate-100 text-slate-500  border-slate-200',
};

const DOT_STYLES = {
  hot:  'bg-emerald-500',
  warm: 'bg-amber-500',
  cold: 'bg-slate-400',
};

export default function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  if (score === undefined || score === null) {
    return (
      <span className={cn(
        'inline-flex items-center rounded-full border font-medium',
        'bg-slate-100 text-slate-400 border-slate-200',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-0.5',
      )}>
        —
      </span>
    );
  }

  const tier = scoreTier(score);

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border font-semibold font-mono',
      TIER_STYLES[tier],
      size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-0.5',
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', DOT_STYLES[tier])} />
      {score}
    </span>
  );
}
