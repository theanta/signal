'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLeads } from '@/services/leads';
import LeadsTable from '@/components/leads/LeadsTable';
import LeadsFilters from '@/components/leads/LeadsFilters';
import PageHeader from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import type { LeadFilters } from '../../../shared/types';
import { Plus } from 'lucide-react';

export default function LeadsPage() {
  const [filters, setFilters] = useState<LeadFilters>({
    page: 1,
    per_page: 25,
    sort_by: 'lead_score',
    sort_order: 'desc',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['leads', filters],
    queryFn: () => fetchLeads(filters),
    placeholderData: prev => prev,
  });

  function updateFilters(updates: Partial<LeadFilters>) {
    setFilters(f => ({ ...f, ...updates }));
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

      <div className="p-8 space-y-4">
        <LeadsFilters filters={filters} onChange={updateFilters} />

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <LeadsTable
            leads={data?.data ?? []}
            total={data?.total ?? 0}
            page={filters.page ?? 1}
            totalPages={data?.total_pages ?? 1}
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
