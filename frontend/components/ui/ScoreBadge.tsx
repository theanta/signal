import { cn, scoreTier } from '@/lib/utils';

interface ScoreBadgeProps {
  score: number | undefined | null;
  size?: 'sm' | 'md';
  variant?: 'pill' | 'dot';
}

const TIER_STYLES = {
  hot:  'bg-score-hot-bg  text-score-hot-text  border-score-hot-border',
  warm: 'bg-score-warm-bg text-score-warm-text border-score-warm-border',
  cold: 'bg-score-cold-bg text-score-cold-text border-score-cold-border',
};

const TEXT_STYLES = {
  hot:  'text-score-hot-text',
  warm: 'text-score-warm-text',
  cold: 'text-score-cold-text',
};

const DOT_STYLES = {
  hot:  'bg-emerald-400',
  warm: 'bg-amber-400',
  cold: 'bg-slate-500',
};

export default function ScoreBadge({ score, size = 'md', variant = 'pill' }: ScoreBadgeProps) {
  if (score === undefined || score === null) {
    if (variant === 'dot') return <span className="text-xs text-muted">—</span>;
    return (
      <span className={cn(
        'inline-flex items-center rounded-full border font-medium',
        'bg-score-cold-bg text-score-cold-text border-score-cold-border',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-0.5',
      )}>
        —
      </span>
    );
  }

  const tier = scoreTier(score);

  if (variant === 'dot') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold font-mono', TEXT_STYLES[tier])}>
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', DOT_STYLES[tier])} />
        {score}
      </span>
    );
  }

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
