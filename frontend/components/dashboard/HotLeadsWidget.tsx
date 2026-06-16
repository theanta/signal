'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHotLeads } from '@/services/metrics';
import Link from 'next/link';
import ScoreBadge from '@/components/ui/ScoreBadge';
import { ExternalLink, Flame } from 'lucide-react';
import type { Lead } from '../../../shared/types';

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
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="w-4 h-4 text-sig-coral" />
        <h3 className="text-sm font-medium text-ink">Hot Leads</h3>
        <span className="ml-auto text-xs text-muted">Score ≥ 70</span>
      </div>

      {leads.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">No hot leads yet. Run a scrape to find prospects.</p>
      ) : (
        <div className="space-y-1">
          {leads.slice(0, 8).map((lead) => (
            <div key={lead.id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-surface-soft transition-colors">
              <div className="flex-1 min-w-0">
                <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-ink hover:text-link truncate block transition-colors">
                  {lead.company_name}
                </Link>
                <p className="text-xs text-muted truncate">{lead.location ?? 'Unknown'} · {lead.industry ?? 'Unknown'}</p>
              </div>
              <ScoreBadge score={lead.lead_score} size="sm" />
              {lead.website && (
                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <Link href="/leads?min_score=70" className="block text-center text-xs text-link hover:text-link-active mt-4 pt-4 border-t border-hairline transition-colors">
        View all hot leads →
      </Link>
    </div>
  );
}
