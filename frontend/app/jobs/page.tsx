'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJobs } from '@/services/jobs';
import JobsTable from '@/components/jobs/JobsTable';
import JobsFilters from '@/components/jobs/JobsFilters';
import PageHeader from '@/components/ui/PageHeader';
import type { JobFilters } from '../../../shared/types';
import { Briefcase } from 'lucide-react';

export default function JobsPage() {
  const [filters, setFilters] = useState<JobFilters>({
    page:       1,
    per_page:   25,
    sort_by:    'created_at',
    sort_order: 'desc',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', filters],
    queryFn:  () => fetchJobs(filters),
    placeholderData: prev => prev,
  });

  function updateFilters(updates: Partial<JobFilters>) {
    setFilters(f => ({ ...f, ...updates }));
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader
        title="Jobs"
        subtitle={data ? `${data.total} remote job postings` : 'Remote job postings scraped from job boards'}
        icon={Briefcase}
      />

      <div className="px-8 pt-5 pb-8 space-y-3">
        <JobsFilters filters={filters} onChange={updateFilters} />

        <JobsTable
          jobs={data?.data ?? []}
          total={data?.total ?? 0}
          page={filters.page ?? 1}
          totalPages={data?.total_pages ?? 1}
          isLoading={isLoading}
          onPageChange={p => updateFilters({ page: p })}
        />
      </div>
    </div>
  );
}
