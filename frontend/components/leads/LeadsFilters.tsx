'use client';

import { Search, X } from 'lucide-react';
import type { LeadFilters, LeadStatus } from '../../../shared/types';

const STATUSES: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];
const SOURCES = ['linkedin', 'job_board', 'crunchbase', 'local_business', 'manual'];

interface LeadsFiltersProps {
  filters: LeadFilters;
  onChange: (f: Partial<LeadFilters>) => void;
  hideSource?: boolean;
}

export default function LeadsFilters({ filters, onChange, hideSource = false }: LeadsFiltersProps) {
  const hasFilters = filters.status || filters.source || filters.search || filters.min_score;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
        <input
          type="text"
          placeholder="Search companies..."
          value={filters.search ?? ''}
          onChange={e => onChange({ search: e.target.value || undefined, page: 1 })}
          className="input pl-9 w-52"
        />
      </div>

      {/* Status filter */}
      <select
        value={filters.status ?? ''}
        onChange={e => onChange({ status: (e.target.value as LeadStatus) || undefined, page: 1 })}
        className="input"
      >
        <option value="">All statuses</option>
        {STATUSES.map(s => (
          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
        ))}
      </select>

      {/* Source filter — hidden when a tab already constrains the source */}
      {!hideSource && (
        <select
          value={filters.source ?? ''}
          onChange={e => onChange({ source: e.target.value as Parameters<typeof onChange>[0]['source'] || undefined, page: 1 })}
          className="input"
        >
          <option value="">All sources</option>
          {SOURCES.map(s => (
            <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
      )}

      {/* Min score filter */}
      <select
        value={filters.min_score ?? ''}
        onChange={e => onChange({ min_score: e.target.value ? Number(e.target.value) : undefined, page: 1 })}
        className="input"
      >
        <option value="">Any score</option>
        <option value="70">Hot (≥70)</option>
        <option value="55">Warm (≥55)</option>
        <option value="35">Cool (≥35)</option>
      </select>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={() => onChange({ status: undefined, source: undefined, search: undefined, min_score: undefined, page: 1 })}
          className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
