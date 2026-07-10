'use client';

import { Search, X, ChevronDown, SlidersHorizontal } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import type { JobFilters, JobStatus, JobVerdict, JobSource } from '../../../shared/types';

const STATUSES: JobStatus[] = ['new', 'reviewed', 'applied', 'interviewing', 'placed', 'rejected', 'archived', 'converted'];
const VERDICTS: JobVerdict[] = ['apply', 'caution', 'skip'];

const SOURCE_OPTIONS: { value: JobSource; label: string }[] = [
  { value: 'indeed',   label: 'Indeed' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'remoteok', label: 'RemoteOK' },
  { value: 'remotive', label: 'Remotive' },
];

const POSTED_OPTIONS: { value: number; label: string }[] = [
  { value: 1,  label: 'Last 24 hours' },
  { value: 3,  label: 'Last 3 days' },
  { value: 7,  label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
];

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

const inputCn = cn(
  'h-9 px-3 text-[13px] text-ink bg-canvas',
  'border border-hairline rounded-lg',
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10',
  'placeholder:text-muted',
);

interface FilterSelectProps {
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (v: string | undefined) => void;
  className?: string;
  /** Render the dropdown inline instead of portaled — required inside a Popover,
      where a portaled dropdown registers as an outside click and closes it. */
  inline?: boolean;
}

function FilterSelect({ value, allLabel, options, onChange, className, inline = false }: FilterSelectProps) {
  const content = (
    <Select.Content className={selectContentCn} position="popper" sideOffset={6}>
      <Select.Viewport className="p-1">
        <Select.Item value="all" className={selectItemCn}>
          <Select.ItemText>{allLabel}</Select.ItemText>
        </Select.Item>
        {options.map(o => (
          <Select.Item key={o.value} value={o.value} className={selectItemCn}>
            <Select.ItemText>{o.label}</Select.ItemText>
          </Select.Item>
        ))}
      </Select.Viewport>
    </Select.Content>
  );

  return (
    <Select.Root value={value} onValueChange={v => onChange(v === 'all' ? undefined : v)}>
      <Select.Trigger className={cn(selectTriggerCn, className)}>
        <Select.Value placeholder={allLabel} />
        <Select.Icon>
          <ChevronDown className="w-3.5 h-3.5 text-muted" />
        </Select.Icon>
      </Select.Trigger>
      {inline ? content : <Select.Portal>{content}</Select.Portal>}
    </Select.Root>
  );
}

interface JobsFiltersProps {
  filters: JobFilters;
  onChange: (f: Partial<JobFilters>) => void;
}

export default function JobsFilters({ filters, onChange }: JobsFiltersProps) {
  const advancedCount = [filters.source, filters.posted_within_days, filters.technology].filter(Boolean).length;
  const hasFilters = !!(filters.status || filters.verdict || filters.search) || advancedCount > 0;

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
          className={cn(inputCn, 'pl-9 w-60')}
        />
      </div>

      {/* Status */}
      <FilterSelect
        value={filters.status ?? 'all'}
        allLabel="All statuses"
        options={STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
        onChange={v => onChange({ status: v as JobStatus | undefined, page: 1 })}
      />

      {/* Verdict */}
      <FilterSelect
        value={filters.verdict ?? 'all'}
        allLabel="All verdicts"
        options={VERDICTS.map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))}
        onChange={v => onChange({ verdict: v as JobVerdict | undefined, page: 1 })}
      />

      {/* Advanced filters */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button className={cn(selectTriggerCn, 'gap-1.5', advancedCount > 0 && 'border-brand/40 text-brand-400')}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {advancedCount > 0 && (
              <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand/15 text-brand-400 text-2xs font-semibold">
                {advancedCount}
              </span>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className={cn(
              'w-64 p-4 bg-canvas border border-hairline rounded-xl shadow-card-lg',
              'animate-scale-in z-40 space-y-3',
            )}
          >
            <div className="space-y-1.5">
              <label className="text-2xs font-semibold text-muted uppercase tracking-wider">Source</label>
              <FilterSelect
                value={filters.source ?? 'all'}
                allLabel="All sources"
                options={SOURCE_OPTIONS}
                onChange={v => onChange({ source: v as JobSource | undefined, page: 1 })}
                className="w-full"
                inline
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-2xs font-semibold text-muted uppercase tracking-wider">Posted</label>
              <FilterSelect
                value={filters.posted_within_days ? String(filters.posted_within_days) : 'all'}
                allLabel="Any time"
                options={POSTED_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))}
                onChange={v => onChange({ posted_within_days: v ? Number(v) : undefined, page: 1 })}
                className="w-full"
                inline
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-2xs font-semibold text-muted uppercase tracking-wider">Technology</label>
              <input
                type="text"
                placeholder="e.g. React, Python…"
                value={filters.technology ?? ''}
                onChange={e => onChange({ technology: e.target.value || undefined, page: 1 })}
                className={cn(inputCn, 'w-full')}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className="flex-1" />

      {hasFilters && (
        <button
          onClick={() => onChange({
            status: undefined, verdict: undefined, search: undefined,
            source: undefined, posted_within_days: undefined, technology: undefined,
            page: 1,
          })}
          className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
