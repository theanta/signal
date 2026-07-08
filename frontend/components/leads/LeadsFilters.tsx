'use client';

import { Search, X, Columns3, ChevronDown } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import { cn } from '@/lib/utils';
import type { LeadFilters, LeadStatus } from '../../../shared/types';

const STATUSES: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];
const SOURCES = ['linkedin', 'job_board', 'crunchbase', 'local_business', 'manual'];

export const TOGGLEABLE_COLS = [
  { id: 'location',   label: 'Location' },
  { id: 'industry',   label: 'Industry / Role' },
  { id: 'signal',     label: 'Signal' },
  { id: 'discovered', label: 'Discovered' },
] as const;

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

interface FilterSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
}

function FilterSelect({ value, onValueChange, placeholder, children }: FilterSelectProps) {
  return (
    <Select.Root value={value || undefined} onValueChange={onValueChange}>
      <Select.Trigger className={selectTriggerCn}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown className="w-3.5 h-3.5 text-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={selectContentCn} position="popper" sideOffset={6}>
          <Select.Viewport className="p-1">
            {children}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function FilterSelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Select.Item value={value} className={selectItemCn}>
      <Select.ItemText>{children}</Select.ItemText>
    </Select.Item>
  );
}

interface LeadsFiltersProps {
  filters: LeadFilters;
  onChange: (f: Partial<LeadFilters>) => void;
  hideSource?: boolean;
  hiddenCols?: Set<string>;
  onToggleCol?: (col: string) => void;
}

export default function LeadsFilters({
  filters, onChange, hideSource = false, hiddenCols = new Set(), onToggleCol,
}: LeadsFiltersProps) {
  const hasFilters = !!(filters.status || filters.source || filters.search || filters.min_score);
  const hiddenCount = hiddenCols.size;

  return (
    <div className="flex items-center gap-2 flex-wrap">

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search companies…"
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
      <FilterSelect
        value={filters.status ?? 'all'}
        onValueChange={v => onChange({ status: (v === 'all' ? undefined : v as LeadStatus), page: 1 })}
        placeholder="All statuses"
      >
        <FilterSelectItem value="all">All statuses</FilterSelectItem>
        {STATUSES.map(s => (
          <FilterSelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</FilterSelectItem>
        ))}
      </FilterSelect>

      {/* Source */}
      {!hideSource && (
        <FilterSelect
          value={filters.source ?? 'all'}
          onValueChange={v => onChange({ source: (v === 'all' ? undefined : v as LeadFilters['source']), page: 1 })}
          placeholder="All sources"
        >
          <FilterSelectItem value="all">All sources</FilterSelectItem>
          {SOURCES.map(s => (
            <FilterSelectItem key={s} value={s}>
              {s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </FilterSelectItem>
          ))}
        </FilterSelect>
      )}

      {/* Score */}
      <FilterSelect
        value={filters.min_score ? String(filters.min_score) : 'all'}
        onValueChange={v => onChange({ min_score: v === 'all' ? undefined : Number(v), page: 1 })}
        placeholder="Any score"
      >
        <FilterSelectItem value="all">Any score</FilterSelectItem>
        <FilterSelectItem value="70">Hot (≥ 70)</FilterSelectItem>
        <FilterSelectItem value="55">Warm (≥ 55)</FilterSelectItem>
        <FilterSelectItem value="35">Cool (≥ 35)</FilterSelectItem>
      </FilterSelect>

      <div className="flex-1" />

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={() => onChange({ status: undefined, source: undefined, search: undefined, min_score: undefined, page: 1 })}
          className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear filters
        </button>
      )}

      {/* Columns */}
      {onToggleCol && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className={cn(
              'relative flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium',
              'bg-canvas border border-hairline rounded-lg',
              'hover:bg-surface-strong hover:border-border-strong transition-colors',
              'text-muted',
            )}>
              <Columns3 className="w-3.5 h-3.5" />
              <span>Columns</span>
              {hiddenCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-brand text-[#04130b] text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {hiddenCount}
                </span>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className={cn(
                'w-48 bg-canvas border border-hairline rounded-xl shadow-card-lg p-2',
                'animate-scale-in z-50',
              )}
            >
              <p className="text-[10.5px] font-semibold text-muted uppercase tracking-wider px-2 pb-1.5">
                Toggle columns
              </p>
              {TOGGLEABLE_COLS.map(col => {
                const visible = !hiddenCols.has(col.id);
                return (
                  <button
                    key={col.id}
                    onClick={() => onToggleCol(col.id)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-strong transition-colors"
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                      visible
                        ? 'bg-brand border-brand'
                        : 'border-hairline bg-surface-strong',
                    )}>
                      {visible && (
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                          <path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="text-[13px] text-ink">{col.label}</span>
                  </button>
                );
              })}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
