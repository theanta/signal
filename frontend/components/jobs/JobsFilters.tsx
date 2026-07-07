'use client';

import { Search, X, ChevronDown } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import { cn } from '@/lib/utils';
import type { JobFilters, JobStatus } from '../../../shared/types';

const STATUSES: JobStatus[] = ['new', 'reviewed', 'archived', 'converted'];

const selectTriggerCn = cn(
  'flex items-center justify-between gap-2 h-9 pl-3 pr-2.5 text-[13px] text-ink bg-canvas',
  'border border-hairline rounded-lg outline-none',
  'data-[placeholder]:text-ink',
  'focus:border-brand focus:ring-2 focus:ring-brand/10',
  'cursor-pointer whitespace-nowrap',
);

const selectContentCn = cn(
  'overflow-hidden bg-canvas border border-hairline rounded-xl shadow-card-lg',
  'animate-scale-in z-50',
);

const selectItemCn = cn(
  'relative flex items-center h-8 px-3 text-[13px] text-ink rounded-lg mx-1',
  'outline-none cursor-pointer select-none',
  'data-[highlighted]:bg-surface-strong',
);

interface JobsFiltersProps {
  filters: JobFilters;
  onChange: (f: Partial<JobFilters>) => void;
}

export default function JobsFilters({ filters, onChange }: JobsFiltersProps) {
  const hasFilters = !!(filters.status || filters.search);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search company or role…"
          value={filters.search ?? ''}
          onChange={e => onChange({ search: e.target.value || undefined, page: 1 })}
          className={cn(
            'h-9 pl-9 pr-3 w-60 text-[13px] text-ink bg-canvas',
            'border border-hairline rounded-lg',
            'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10',
            'placeholder:text-muted',
          )}
        />
      </div>

      {/* Status */}
      <Select.Root
        value={filters.status ?? 'all'}
        onValueChange={v => onChange({ status: (v === 'all' ? undefined : v as JobStatus), page: 1 })}
      >
        <Select.Trigger className={selectTriggerCn}>
          <Select.Value placeholder="All statuses" />
          <Select.Icon>
            <ChevronDown className="w-3.5 h-3.5 text-muted" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className={selectContentCn} position="popper" sideOffset={6}>
            <Select.Viewport className="p-1">
              <Select.Item value="all" className={selectItemCn}>
                <Select.ItemText>All statuses</Select.ItemText>
              </Select.Item>
              {STATUSES.map(s => (
                <Select.Item key={s} value={s} className={selectItemCn}>
                  <Select.ItemText>{s.charAt(0).toUpperCase() + s.slice(1)}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      <div className="flex-1" />

      {hasFilters && (
        <button
          onClick={() => onChange({ status: undefined, search: undefined, page: 1 })}
          className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
