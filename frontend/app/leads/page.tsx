'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLeads } from '@/services/leads';
import LeadsTable from '@/components/leads/LeadsTable';
import LeadsFilters from '@/components/leads/LeadsFilters';
import PageHeader from '@/components/ui/PageHeader';
import type { LeadFilters, LeadTab } from '../../../shared/types';
import { HIRING_SOURCES, DISCOVERY_SOURCES } from '../../../shared/types';
import { Plus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const TABS: { id: LeadTab; label: string; description: string }[] = [
  { id: 'all',       label: 'All Leads',          description: 'Every lead across all sources' },
  { id: 'hiring',    label: 'Hiring Signals',      description: 'LinkedIn & Indeed — companies actively hiring' },
  { id: 'discovery', label: 'Company Discovery',   description: 'Crunchbase & Google Maps — local and funded companies' },
];

function tabToSources(tab: LeadTab): LeadFilters['sources'] {
  if (tab === 'hiring')    return HIRING_SOURCES;
  if (tab === 'discovery') return DISCOVERY_SOURCES;
  return undefined;
}

export default function LeadsPage() {
  const [activeTab, setActiveTab]   = useState<LeadTab>('all');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [filters, setFilters]       = useState<LeadFilters>({
    page:       1,
    per_page:   25,
    sort_by:    'lead_score',
    sort_order: 'desc',
  });

  const effectiveFilters: LeadFilters = {
    ...filters,
    sources: tabToSources(activeTab),
    source:  undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['leads', effectiveFilters],
    queryFn:  () => fetchLeads(effectiveFilters),
    placeholderData: prev => prev,
  });

  function updateFilters(updates: Partial<LeadFilters>) {
    setFilters(f => ({ ...f, ...updates }));
  }

  function switchTab(tab: LeadTab) {
    setActiveTab(tab);
    setFilters(f => ({ ...f, page: 1, source: undefined }));
  }

  function toggleCol(col: string) {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader
        title="Leads"
        subtitle={data ? `${data.total} total leads` : 'Manage and qualify your prospects'}
        icon={Users}
        actions={
          <Link href="/leads/new" className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Lead
          </Link>
        }
      />

      <div className="px-8 pt-5 pb-0">
        {/* ── Pill tabs ── */}
        <div className="flex items-center gap-1 p-1 bg-surface-strong rounded-full w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              title={tab.description}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all duration-150',
                activeTab === tab.id
                  ? 'bg-canvas text-ink shadow-sm'
                  : 'text-muted hover:text-ink',
              )}
            >
              {tab.label}
              {activeTab === tab.id && data?.total != null && (
                <span className="text-[11px] bg-brand-500/10 text-brand-400 px-1.5 py-0.5 rounded-full font-semibold leading-none">
                  {data.total}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 pt-4 pb-8 space-y-3">
        <LeadsFilters
          filters={filters}
          onChange={updateFilters}
          hideSource={activeTab !== 'all'}
          hiddenCols={hiddenCols}
          onToggleCol={toggleCol}
        />

        <LeadsTable
          leads={data?.data ?? []}
          total={data?.total ?? 0}
          page={filters.page ?? 1}
          totalPages={data?.total_pages ?? 1}
          tab={activeTab}
          isLoading={isLoading}
          onPageChange={p => updateFilters({ page: p })}
          onSortChange={(col, dir) => updateFilters({ sort_by: col as LeadFilters['sort_by'], sort_order: dir })}
          sortBy={filters.sort_by ?? 'lead_score'}
          sortOrder={filters.sort_order ?? 'desc'}
          hiddenCols={hiddenCols}
        />
      </div>
    </div>
  );
}
