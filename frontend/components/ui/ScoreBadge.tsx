import { clsx } from 'clsx';

interface ScoreBadgeProps {
  score: number | undefined | null;
  size?: 'sm' | 'md';
}

export default function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  if (score === undefined || score === null) {
    return (
      <span className="badge bg-surface-strong text-muted">—</span>
    );
  }

  const band = score >= 75 ? 'hot' : score >= 55 ? 'warm' : score >= 35 ? 'cool' : 'cold';

  return (
    <span
      className={clsx(
        'badge font-mono font-semibold',
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5',
        {
          'bg-[#fcede8] text-sig-coral border border-[#f5c9b8]': band === 'hot',
          'bg-[#fdf3df] text-sig-mustard border border-[#f0d990]': band === 'warm',
          'bg-[#eaf0fb] text-info border border-[#c5d7f5]':        band === 'cool',
          'bg-surface-strong text-muted':                          band === 'cold',
        }
      )}
    >
      {score}
    </span>
  );
}
