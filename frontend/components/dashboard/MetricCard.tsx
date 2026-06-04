import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color?: 'coral' | 'forest' | 'ink' | 'mustard' | 'info' | 'neutral';
  sublabel?: string;
}

const COLOR_MAP: Record<NonNullable<MetricCardProps['color']>, { bg: string; text: string }> = {
  coral:   { bg: 'bg-[#fcede8]', text: 'text-sig-coral' },
  forest:  { bg: 'bg-[#e8f0e8]', text: 'text-sig-forest' },
  ink:     { bg: 'bg-surface-strong', text: 'text-ink' },
  mustard: { bg: 'bg-[#fdf3df]', text: 'text-sig-mustard' },
  info:    { bg: 'bg-[#eaf0fb]', text: 'text-info' },
  neutral: { bg: 'bg-surface-soft', text: 'text-muted' },
};

export default function MetricCard({ label, value, icon: Icon, color = 'ink', sublabel }: MetricCardProps) {
  const { bg, text } = COLOR_MAP[color];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-medium text-ink mt-1.5 leading-none">{value}</p>
          {sublabel && <p className="text-xs text-muted mt-1.5">{sublabel}</p>}
        </div>
        <div className={`w-9 h-9 rounded-md flex items-center justify-center ${bg}`}>
          <Icon className={`w-4 h-4 ${text}`} />
        </div>
      </div>
    </div>
  );
}
