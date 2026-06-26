'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHotLeads } from '@/services/metrics';
import Link from 'next/link';
import ScoreBadge from '@/components/ui/ScoreBadge';
import { Flame, ArrowRight, ExternalLink } from 'lucide-react';
import type { Lead } from '../../../shared/types';
import { cn } from '@/lib/utils';

interface Props {
  leads?: Lead[];
}

export default function HotLeadsWidget({ leads: leadsProp }: Props) {
  const { data: fetched = [] } = useQuery({
    queryKey: ['hot-leads'],
    queryFn: fetchHotLeads,
    enabled: leadsProp === undefined,
  });

  const leads = (leadsProp ?? fetched) as Lead[];

  return (
    <div className="card-bento flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-rose-500/10 flex items-center justify-center">
            <Flame className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <h3 className="text-[13.5px] font-semibold text-ink">Hot Leads</h3>
          <span className="text-[11px] text-muted bg-white/5 px-1.5 py-0.5 rounded-full">
            Score ≥ 70
          </span>
        </div>
        <Link
          href="/leads"
          className="flex items-center gap-1 text-[12px] text-brand-400 hover:text-brand-300 font-medium transition-colors"
        >
          All <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 text-center">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <Flame className="w-5 h-5 text-muted" />
            </div>
            <p className="text-[13px] font-medium text-muted">No hot leads yet</p>
            <p className="text-[12px] text-muted/60 mt-1">Run a scrape to find high-score prospects</p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {leads.slice(0, 7).map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/leads/${lead.id}`}
                  className={cn(
                    'flex items-center gap-3 px-5 py-3',
                    'hover:bg-white/5 transition-colors',
                    'group',
                  )}
                >
                  {/* Company initial */}
                  <div className="w-7 h-7 rounded-lg bg-surface-strong flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-muted group-hover:bg-brand-500/10 group-hover:text-brand-400 transition-colors">
                    {lead.company_name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate group-hover:text-brand-300 transition-colors">
                      {lead.company_name}
                    </p>
                    <p className="text-[11.5px] text-muted truncate">
                      {[lead.industry, lead.location].filter(Boolean).join(' · ') || 'Unknown'}
                    </p>
                  </div>

                  {/* Score + external link */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ScoreBadge score={lead.lead_score} size="sm" />
                    {lead.website && (
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-muted hover:text-ink transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
