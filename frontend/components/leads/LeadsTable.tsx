'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronUp, ChevronDown, MoreHorizontal,
  ExternalLink, Link2, Brain, Copy, CheckCircle,
  Users, ChevronLeft, ChevronRight,
  Send, UserCheck,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ScoreBadge from '@/components/ui/ScoreBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import { LeadsTableSkeleton } from '@/components/ui/Skeleton';
import { updateLeadStatus, generateOutreach } from '@/services/leads';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { Lead, LeadTab } from '../../../shared/types';
import type { LeadStatus } from '../../../shared/types';

interface LeadsTableProps {
  leads: Lead[];
  total: number;
  page: number;
  totalPages: number;
  tab?: LeadTab;
  isLoading?: boolean;
  onPageChange: (p: number) => void;
  onSortChange: (col: string, dir: 'asc' | 'desc') => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  hiddenCols?: Set<string>;
}

// ── Row action menu ──────────────────────────────────────────
interface RowMenuProps {
  lead: Lead;
  generating: boolean;
  copied: boolean;
  onGenerateOutreach: () => void;
  onMarkContacted: () => void;
}

function RowMenu({ lead, generating, copied, onGenerateOutreach, onMarkContacted }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 text-body-sm text-neutral-700 hover:bg-neutral-50 transition-colors text-left';
  const menuIcon = 'w-3.5 h-3.5 text-neutral-400 flex-shrink-0';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-30 w-48 bg-white border border-neutral-200 rounded-xl shadow-card-lg py-1.5 animate-scale-in">
          <button
            className={menuItem}
            onClick={() => { router.push(`/leads/${lead.id}`); setOpen(false); }}
          >
            <Brain className={menuIcon} /> View details
          </button>

          <button
            className={cn(menuItem, generating && 'opacity-50 cursor-not-allowed')}
            disabled={generating}
            onClick={() => { onGenerateOutreach(); setOpen(false); }}
          >
            {copied
              ? <CheckCircle className={cn(menuIcon, 'text-emerald-500')} />
              : <Copy className={menuIcon} />
            }
            {generating ? 'Generating…' : copied ? 'Copied!' : 'Copy outreach email'}
          </button>

          <button
            className={menuItem}
            onClick={() => { onMarkContacted(); setOpen(false); }}
          >
            <UserCheck className={menuIcon} /> Mark contacted
          </button>

          {(lead.website || lead.linkedin_url) && (
            <div className="my-1 border-t border-neutral-100" />
          )}

          {lead.website && (
            <a
              href={lead.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={menuItem}
            >
              <ExternalLink className={menuIcon} /> Website
            </a>
          )}

          {lead.linkedin_url && (
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={menuItem}
            >
              <Link2 className={menuIcon} /> LinkedIn
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sort header cell ──────────────────────────────────────────
function SortTh({
  col, label, sortBy, sortOrder, onSort, className,
}: {
  col: string | null; label: string; sortBy: string; sortOrder: 'asc' | 'desc';
  onSort: (col: string) => void; className?: string;
}) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-left text-2xs font-semibold text-neutral-400 uppercase tracking-wider whitespace-nowrap',
        col && 'cursor-pointer select-none hover:text-neutral-600 transition-colors',
        className,
      )}
      onClick={() => col && onSort(col)}
    >
      <div className="flex items-center gap-1">
        {label}
        {col && (
          sortBy === col
            ? sortOrder === 'desc'
              ? <ChevronDown className="w-3 h-3 text-brand" />
              : <ChevronUp className="w-3 h-3 text-brand" />
            : <ChevronUp className="w-3 h-3 opacity-20" />
        )}
      </div>
    </th>
  );
}

// ── Main component ────────────────────────────────────────────
export default function LeadsTable({
  leads, total, page, totalPages, tab = 'all',
  isLoading = false,
  onPageChange, onSortChange, sortBy, sortOrder,
  hiddenCols = new Set(),
}: LeadsTableProps) {
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Clear selection when leads change (page turn, filter)
  useEffect(() => { setSelected(new Set()); }, [leads]);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      updateLeadStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  function handleSort(col: string) {
    onSortChange(col, sortBy === col && sortOrder === 'desc' ? 'asc' : 'desc');
  }

  function toggleAll() {
    setSelected(selected.size === leads.length
      ? new Set()
      : new Set(leads.map(l => l.id)));
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerateOutreach(lead: Lead) {
    setGeneratingId(lead.id);
    const tid = toast.loading('Generating outreach…');
    try {
      const msg = await generateOutreach(lead.id, 'email') as { subject?: string; body: string };
      const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
      await navigator.clipboard.writeText(text);
      setCopiedId(lead.id);
      setTimeout(() => setCopiedId(null), 2500);
      toast.resolve(tid, 'success', 'Outreach copied to clipboard');
    } catch {
      toast.resolve(tid, 'error', 'Failed to generate outreach');
    } finally {
      setGeneratingId(null);
    }
  }

  async function bulkMarkContacted() {
    const ids = Array.from(selected);
    const tid = toast.loading(`Marking ${ids.length} leads as contacted…`);
    try {
      await Promise.all(ids.map(id => updateLeadStatus(id, 'contacted')));
      await qc.invalidateQueries({ queryKey: ['leads'] });
      setSelected(new Set());
      toast.resolve(tid, 'success', `${ids.length} lead${ids.length > 1 ? 's' : ''} marked as contacted`);
    } catch {
      toast.resolve(tid, 'error', 'Failed to update some leads');
    }
  }

  const col = (id: string) => !hiddenCols.has(id);

  const midLabel = tab === 'hiring' ? 'Role' : tab === 'discovery' ? 'Size' : 'Industry';

  const thCn = 'sticky top-0 bg-white z-10 border-b border-hairline';

  if (isLoading) {
    return (
      <div className="card overflow-hidden">
        <table className="w-full">
          <tbody>
            <LeadsTableSkeleton rows={8} />
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {/* Checkbox */}
                <th className={cn(thCn, 'px-4 py-3 w-10')}>
                  <input
                    type="checkbox"
                    checked={leads.length > 0 && selected.size === leads.length}
                    ref={el => {
                      if (el) el.indeterminate = selected.size > 0 && selected.size < leads.length;
                    }}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 accent-brand cursor-pointer"
                  />
                </th>

                <SortTh col="company_name" label="Company"  sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />
                {col('location')   && <SortTh col="location"     label="Location"   sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />}
                {col('industry')   && <SortTh col={null}         label={midLabel}   sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />}
                {col('signal')     && <SortTh col={null}         label="Signal"     sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />}
                <SortTh col="lead_score" label="Score"    sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />
                <SortTh col="status"     label="Status"   sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />
                {col('discovered') && <SortTh col="created_at"  label="Discovered" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className={thCn} />}
                <th className={cn(thCn, 'px-4 py-3 w-10')} />
              </tr>
            </thead>

            <tbody className="divide-y divide-hairline">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center">
                        <Users className="w-6 h-6 text-neutral-300" />
                      </div>
                      <p className="text-body-sm font-medium text-neutral-400">No leads found</p>
                      <p className="text-xs text-neutral-300">Try running a scrape or adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                leads.map(lead => {
                  const isSelected = selected.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className={cn(
                        'group transition-colors cursor-pointer',
                        isSelected ? 'bg-brand-50/50' : 'hover:bg-neutral-50',
                      )}
                      onClick={() => toggleRow(lead.id)}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(lead.id)}
                          className="w-3.5 h-3.5 accent-brand cursor-pointer"
                        />
                      </td>

                      {/* Company */}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <Link href={`/leads/${lead.id}`} className="flex items-center gap-2.5 group/name">
                          <span className="w-7 h-7 rounded-lg bg-neutral-100 group-hover/name:bg-brand-50 flex items-center justify-center flex-shrink-0 text-2xs font-semibold text-neutral-500 transition-colors">
                            {lead.company_name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-body-sm font-medium text-ink group-hover/name:text-brand-700 truncate max-w-[160px] transition-colors">
                              {lead.company_name}
                            </p>
                            <p className="text-2xs text-neutral-400 capitalize">
                              {lead.source?.replace('_', ' ')}
                            </p>
                          </div>
                        </Link>
                      </td>

                      {/* Location */}
                      {col('location') && (
                        <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap max-w-[120px] truncate">
                          {lead.location ?? '—'}
                        </td>
                      )}

                      {/* Industry / Role / Size */}
                      {col('industry') && (
                        <td className="px-4 py-3 text-xs text-neutral-500 max-w-[120px] truncate">
                          {tab === 'hiring'
                            ? (lead.job_title ?? '—')
                            : tab === 'discovery'
                            ? (lead.company_size ?? '—')
                            : (lead.industry ?? '—')}
                        </td>
                      )}

                      {/* Signal */}
                      {col('signal') && (
                        <td className="px-4 py-3 max-w-[180px]">
                          <p className="text-xs text-neutral-500 truncate" title={lead.hiring_signal ?? ''}>
                            {lead.hiring_signal ?? '—'}
                          </p>
                        </td>
                      )}

                      {/* Score */}
                      <td className="px-4 py-3">
                        <ScoreBadge score={lead.lead_score} size="sm" />
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={lead.status} size="sm" />
                      </td>

                      {/* Discovered */}
                      {col('discovered') && (
                        <td className="px-4 py-3 text-xs text-neutral-400 whitespace-nowrap">
                          {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                        </td>
                      )}

                      {/* Row menu */}
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <RowMenu
                          lead={lead}
                          generating={generatingId === lead.id}
                          copied={copiedId === lead.id}
                          onGenerateOutreach={() => handleGenerateOutreach(lead)}
                          onMarkContacted={() => statusMutation.mutate({ id: lead.id, status: 'contacted' })}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-hairline bg-neutral-50/50">
            <span className="text-xs text-neutral-400">
              {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} leads
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => onPageChange(page - 1)}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-neutral-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>

              <span className="px-3 text-xs text-neutral-400">
                Page {page} of {totalPages}
              </span>

              <button
                onClick={() => onPageChange(page + 1)}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-neutral-100"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      <div className={cn(
        'fixed bottom-6 inset-x-0 flex justify-center pointer-events-none z-40',
        'transition-all duration-200',
        selected.size > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none',
      )}>
        <div className="pointer-events-auto flex items-center gap-3 bg-[#0f1117] text-white px-5 py-3 rounded-2xl shadow-cmd animate-slide-in-from-bottom">
          <span className="text-body-sm font-medium text-white/90">
            {selected.size} selected
          </span>

          <div className="w-px h-4 bg-white/15" />

          <button
            onClick={bulkMarkContacted}
            className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5" />
            Mark contacted
          </button>

          <button
            onClick={() => {
              const outreachUrl = `/outreach`;
              window.location.href = outreachUrl;
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            View outreach
          </button>

          <div className="w-px h-4 bg-white/15" />

          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            ✕ Clear
          </button>
        </div>
      </div>
    </>
  );
}
