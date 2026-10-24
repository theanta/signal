'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeadScore, RuleScore, ScoringWeights } from '../../../shared/types';
import { DEFAULT_SCORING_WEIGHTS } from '../../../shared/types';

/**
 * The lead's score under the scoring model: four 0-100 parts (fit, intent,
 * AI judgment, engagement), each with the rules or reason behind it, and how
 * the agency's weights blended them into the overall score.
 */

type Part = keyof ScoringWeights;

const PARTS: { key: Part; label: string; blurb: string }[] = [
  { key: 'fit',        label: 'Fit',         blurb: 'Is this your kind of client?' },
  { key: 'intent',     label: 'Intent',      blurb: 'Is there need or timing now?' },
  { key: 'ai',         label: 'AI Judgment', blurb: 'Would you win this deal?' },
  { key: 'engagement', label: 'Engagement',  blurb: 'Are they responding to you?' },
];

function tone(score: number) {
  return score >= 70 ? 'emerald' : score >= 45 ? 'amber' : 'muted';
}

function Bar({ value }: { value: number }) {
  const t = tone(value);
  return (
    <div className="h-1.5 bg-surface-strong rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500',
          t === 'emerald' ? 'bg-emerald-500' : t === 'amber' ? 'bg-amber-400' : 'bg-muted')}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function Factors({ rule }: { rule: RuleScore }) {
  return (
    <ul className="mt-2 space-y-1">
      {rule.factors.map(f => (
        <li key={f.label} className="flex justify-between gap-3 text-2xs">
          <span className="text-muted">
            {f.label}
            {f.detail && <span className="text-muted/70">: {f.detail}</span>}
          </span>
          {f.max > 0 && (
            <span className="font-medium text-ink whitespace-nowrap">
              {f.points}<span className="text-muted/50">/{f.max}</span>
            </span>
          )}
        </li>
      ))}
      {rule.unknown.map(u => (
        <li key={u} className="text-2xs text-muted/70 italic">Not counted: {u}</li>
      ))}
    </ul>
  );
}

export default function ScoreModelCard({ score, leadScore, percentile }: {
  score: LeadScore;
  leadScore: number;
  percentile?: number;
}) {
  const [open, setOpen] = useState<Part | null>(null);
  const b = score.breakdown ?? {};
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...(score.weights ?? b.weights ?? {}) };

  const values: Record<Part, number | null> = {
    fit: score.fit_score ?? null,
    intent: score.intent_score ?? null,
    ai: score.ai_score ?? null,
    engagement: score.engagement_score ?? null,
  };
  const counted = PARTS.filter(p => values[p.key] !== null && weights[p.key] > 0);
  const totalWeight = counted.reduce((n, p) => n + weights[p.key], 0);

  return (
    <div className="p-4">
      <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Score Breakdown</h3>

      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-hairline">
        <div>
          <span className="text-xs text-muted font-medium block">Lead Score</span>
          {percentile !== undefined && (
            <span className="text-2xs text-muted mt-0.5 block">Top {100 - percentile}% of leads</span>
          )}
        </div>
        <span className={cn('text-[28px] font-bold leading-none',
          tone(leadScore) === 'emerald' ? 'text-emerald-400' : tone(leadScore) === 'amber' ? 'text-amber-400' : 'text-muted')}>
          {leadScore}<span className="text-sm font-normal text-muted/50">/100</span>
        </span>
      </div>

      {b.disqualified ? (
        <p className="text-2xs text-muted">Disqualified: {b.disqualified}</p>
      ) : (
        <div className="space-y-3">
          {PARTS.map(p => {
            const v = values[p.key];
            const rule = p.key === 'ai' ? null : (b[p.key] as RuleScore | null | undefined);
            const expandable = p.key === 'ai' ? Boolean(score.ai_reason) : Boolean(rule?.factors?.length);
            const isOpen = open === p.key;
            return (
              <div key={p.key}>
                <button
                  type="button"
                  disabled={!expandable}
                  onClick={() => setOpen(isOpen ? null : p.key)}
                  className="w-full text-left space-y-1"
                >
                  <div className="flex justify-between text-2xs">
                    <span className="text-muted flex items-center gap-1">
                      {expandable && (isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
                      {p.label}
                      <span className="text-muted/50">· weight {Math.round(weights[p.key])}</span>
                    </span>
                    <span className="font-medium text-ink">
                      {v === null ? <span className="text-muted/70 font-normal">not yet</span> : <>{v}<span className="text-muted/50">/100</span></>}
                    </span>
                  </div>
                  {v !== null && <Bar value={v} />}
                </button>
                {isOpen && p.key === 'ai' && score.ai_reason && (
                  <p className="mt-2 text-2xs text-muted italic leading-relaxed">{score.ai_reason}</p>
                )}
                {isOpen && rule && <Factors rule={rule} />}
                {!isOpen && v === null && (
                  <p className="text-2xs text-muted/60 mt-0.5">
                    {p.key === 'engagement' ? 'Counts once outreach is sent.' :
                     p.key === 'ai' ? 'No AI judgment for this analysis.' : p.blurb}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!b.disqualified && counted.length > 0 && (
        <p className="text-2xs text-muted mt-3 pt-2.5 border-t border-hairline leading-relaxed">
          Overall = {counted.map(p => `${p.label} ${values[p.key]} × ${Math.round((100 * weights[p.key]) / totalWeight)}%`).join(' + ')}
          {counted.length < PARTS.length && ' (parts not yet known are left out and the rest share their weight)'}
        </p>
      )}
    </div>
  );
}
