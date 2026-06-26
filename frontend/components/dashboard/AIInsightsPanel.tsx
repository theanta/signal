'use client';

import {
  Sparkles, TrendingUp, AlertCircle, Target,
  ArrowRight, Flame, Activity, Zap,
} from 'lucide-react';
import Link from 'next/link';
import type { Lead, PipelineSummary } from '../../../shared/types';
import { cn } from '@/lib/utils';

interface Metrics {
  total_leads?: number;
  hot_leads?: number;
  contacted?: number;
  replied?: number;
  meetings?: number;
  clients?: number;
  avg_score?: number;
  new_today?: number;
}

interface Insight {
  icon: React.ElementType;
  text: string;
  type: 'opportunity' | 'warning' | 'info' | 'success';
}

interface QuickAction {
  label: string;
  href: string;
  count?: number;
}

const INSIGHT_ICON_STYLES: Record<Insight['type'], string> = {
  opportunity: 'text-brand-400 bg-brand-500/10',
  warning:     'text-amber-400 bg-amber-500/10',
  info:        'text-sky-400   bg-sky-500/10',
  success:     'text-emerald-400 bg-emerald-500/10',
};

function deriveInsights(metrics?: Metrics, pipeline?: PipelineSummary[]): Insight[] {
  if (!metrics) return [];
  const {
    total_leads = 0, hot_leads = 0,
    contacted = 0, replied = 0,
    clients = 0, avg_score = 0,
  } = metrics;

  const insights: Insight[] = [];

  if (hot_leads > 0) {
    insights.push({
      icon: Flame,
      text: `${hot_leads} hot lead${hot_leads !== 1 ? 's' : ''} ready for outreach`,
      type: 'opportunity',
    });
  }

  if (contacted > 0 && replied > 0) {
    const replyRate = Math.round((replied / contacted) * 100);
    insights.push({
      icon: TrendingUp,
      text: `${replyRate}% reply rate on contacted leads`,
      type: replyRate >= 20 ? 'success' : 'info',
    });
  }

  const pipelineMap = Object.fromEntries((pipeline ?? []).map(p => [p.status, p.count]));
  const newCount = pipelineMap['new'] ?? 0;
  if (newCount > 3) {
    insights.push({
      icon: AlertCircle,
      text: `${newCount} leads awaiting AI analysis`,
      type: 'warning',
    });
  }

  if (clients > 0 && total_leads > 0) {
    const convRate = ((clients / total_leads) * 100).toFixed(1);
    insights.push({
      icon: Target,
      text: `${convRate}% pipeline conversion rate`,
      type: 'info',
    });
  }

  if (avg_score > 0) {
    insights.push({
      icon: Activity,
      text: `Avg lead quality score: ${Math.round(avg_score)}`,
      type: avg_score >= 60 ? 'success' : avg_score >= 40 ? 'info' : 'warning',
    });
  }

  return insights.slice(0, 4);
}

function deriveNarrative(metrics?: Metrics): string {
  if (!metrics) return 'Analyzing your pipeline data…';
  const { total_leads = 0, hot_leads = 0, new_today = 0, avg_score = 0 } = metrics;

  if (total_leads === 0) {
    return 'No leads in pipeline yet. Run a scrape to discover high-intent prospects.';
  }

  const hotPct = Math.round((hot_leads / total_leads) * 100);

  if (hot_leads > 5) {
    return `Strong pipeline with ${hot_leads} high-priority leads (${hotPct}% of total).${new_today > 0 ? ` ${new_today} new prospects discovered today.` : ''}`;
  }
  if (hot_leads > 0) {
    return `Pipeline active — ${hot_leads} high-score prospect${hot_leads !== 1 ? 's' : ''} need attention.${avg_score > 50 ? ' Lead quality is above average.' : ''}`;
  }
  return `${total_leads} leads tracked. Focus on ICP targeting to surface higher-quality signals.`;
}

function deriveActions(metrics?: Metrics): QuickAction[] {
  if (!metrics) return [{ label: 'Run First Scrape', href: '/signals' }];
  const { hot_leads = 0, replied = 0, meetings = 0 } = metrics;

  const actions: QuickAction[] = [];

  if (hot_leads > 0) {
    actions.push({ label: 'Start Outreach', href: '/outreach', count: hot_leads });
  }
  if (replied > meetings) {
    actions.push({ label: 'Book Meetings', href: '/leads', count: replied - meetings });
  }
  actions.push({ label: 'Run Scrape', href: '/signals' });

  return actions.slice(0, 3);
}

interface Props {
  metrics?: Metrics;
  pipeline?: PipelineSummary[];
  hotLeads?: Lead[];
}

export default function AIInsightsPanel({ metrics, pipeline, hotLeads = [] }: Props) {
  const insights = deriveInsights(metrics, pipeline);
  const narrative = deriveNarrative(metrics);
  const actions = deriveActions(metrics);
  const topLeads = hotLeads.slice(0, 3);

  return (
    <div className="flex flex-col gap-3">

      {/* ── Signal AI header card ── */}
      <div className="card-ai p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-violet-500/10 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <span className="text-[13px] font-semibold text-ink">Signal AI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ai-pulse inline-block" />
            <span className="text-[11px] text-muted">Live</span>
          </div>
        </div>
        <p className="text-[12.5px] text-body leading-relaxed">
          {narrative}
        </p>
      </div>

      {/* ── Key signals ── */}
      {insights.length > 0 && (
        <div className="card-bento p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Zap className="w-3 h-3 text-muted" />
            <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Key Signals
            </h4>
          </div>
          <div className="space-y-2.5">
            {insights.map((insight, i) => {
              const Icon = insight.icon;
              return (
                <div key={i} className="flex items-start gap-2.5">
                  <div className={cn(
                    'w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5',
                    INSIGHT_ICON_STYLES[insight.type],
                  )}>
                    <Icon className="w-3 h-3" />
                  </div>
                  <p className="text-[12.5px] text-body leading-snug">{insight.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Top opportunities ── */}
      {topLeads.length > 0 && (
        <div className="card-bento overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
            <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Top Opportunities
            </h4>
            <Link
              href="/leads"
              className="text-[11px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5 transition-colors"
            >
              All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <ul>
            {topLeads.map((lead, i) => (
              <li
                key={lead.id}
                className={cn(i < topLeads.length - 1 && 'border-b border-hairline')}
              >
                <Link
                  href={`/leads/${lead.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-surface-strong flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-muted group-hover:bg-brand-500/15 group-hover:text-brand-400 transition-colors">
                    {lead.company_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium text-ink truncate group-hover:text-brand-300 transition-colors">
                      {lead.company_name}
                    </p>
                    <p className="text-[11px] text-muted truncate">
                      {lead.industry || 'Unknown'}
                    </p>
                  </div>
                  <span className="text-[12px] font-semibold text-emerald-400 flex-shrink-0 tabular-nums">
                    {lead.lead_score}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Quick actions ── */}
      {actions.length > 0 && (
        <div className="card-bento p-4">
          <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
            Quick Actions
          </h4>
          <div className="space-y-1.5">
            {actions.map((action, i) => (
              <Link
                key={i}
                href={action.href}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-surface-strong hover:bg-white/10 transition-colors group"
              >
                <span className="text-[12.5px] font-medium text-ink group-hover:text-white transition-colors">
                  {action.label}
                </span>
                <div className="flex items-center gap-1.5">
                  {action.count !== undefined && (
                    <span className="text-[11px] font-semibold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded-full">
                      {action.count}
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-white transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
