'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLeads } from '@/services/leads';
import LeadsTable from '@/components/leads/LeadsTable';
import LeadsFilters from '@/components/leads/LeadsFilters';
import PageHeader from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import type { LeadFilters, LeadTab } from '../../../shared/types';
import { HIRING_SOURCES, DISCOVERY_SOURCES } from '../../../shared/types';
import { Plus } from 'lucide-react';
import { clsx } from 'clsx';

const TABS: { id: LeadTab; label: string; description: string }[] = [
  { id: 'all', label: 'All Leads', description: 'Every lead across all sources' },
  { id: 'hiring', label: 'Hiring Signals', description: 'LinkedIn & Indeed — companies actively hiring' },
  { id: 'discovery', label: 'Company Discovery', description: 'Crunchbase & Google Maps — local and funded companies' },
];

function tabToSources(tab: LeadTab): LeadFilters['sources'] {
  if (tab === 'hiring') return HIRING_SOURCES;
  if (tab === 'discovery') return DISCOVERY_SOURCES;
  return undefined;
}

export default function LeadsPage() {
  const [activeTab, setActiveTab] = useState<LeadTab>('all');
  const [filters, setFilters] = useState<LeadFilters>({
    page: 1,
    per_page: 25,
    sort_by: 'lead_score',
    sort_order: 'desc',
  });

  const effectiveFilters: LeadFilters = {
    ...filters,
    sources: tabToSources(activeTab),
    source: undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['leads', effectiveFilters],
    queryFn: () => fetchLeads(effectiveFilters),
    placeholderData: prev => prev,
  });

  function updateFilters(updates: Partial<LeadFilters>) {
    setFilters(f => ({ ...f, ...updates }));
  }

  function switchTab(tab: LeadTab) {
    setActiveTab(tab);
    setFilters(f => ({ ...f, page: 1, source: undefined }));
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Leads"
        subtitle={data ? `${data.total} total leads` : 'Manage and qualify your prospects'}
        actions={
          <a href="/leads/new" className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Lead
          </a>
        }
      />

      <div className="px-8 pt-6 pb-0">
        {/* Tabs */}
        <div className="flex items-end gap-1 border-b border-hairline">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              title={tab.description}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:text-body'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8 space-y-4">
        <LeadsFilters filters={filters} onChange={updateFilters} hideSource={activeTab !== 'all'} />

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <LeadsTable
            leads={data?.data ?? []}
            total={data?.total ?? 0}
            page={filters.page ?? 1}
            totalPages={data?.total_pages ?? 1}
            tab={activeTab}
            onPageChange={p => updateFilters({ page: p })}
            onSortChange={(col, dir) => updateFilters({ sort_by: col as LeadFilters['sort_by'], sort_order: dir })}
            sortBy={filters.sort_by ?? 'lead_score'}
            sortOrder={filters.sort_order ?? 'desc'}
          />
        )}
      </div>
    </div>
  );
}
