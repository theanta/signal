'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink, Copy, CheckCircle, ChevronUp, ChevronDown,
  Brain, Link2,
} from 'lucide-react';
import ScoreBadge from '@/components/ui/ScoreBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import { updateLeadStatus, generateOutreach } from '@/services/leads';
import type { Lead, LeadStatus } from '../../../shared/types';
import { clsx } from 'clsx';

const STATUS_PIPELINE: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];

interface LeadsTableProps {
  leads: Lead[];
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onSortChange: (col: string, dir: 'asc' | 'desc') => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export default function LeadsTable({
  leads, total, page, totalPages,
  onPageChange, onSortChange, sortBy, sortOrder,
}: LeadsTableProps) {
  const qc = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) => updateLeadStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  function handleSort(col: string) {
    onSortChange(col, sortBy === col && sortOrder === 'desc' ? 'asc' : 'desc');
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <ChevronUp className="w-3 h-3 opacity-25" />;
    return sortOrder === 'desc'
      ? <ChevronDown className="w-3 h-3 text-ink" />
      : <ChevronUp className="w-3 h-3 text-ink" />;
  }

  async function handleCopyOutreach(lead: Lead) {
    setGeneratingId(lead.id);
    try {
      const msg = await generateOutreach(lead.id, 'email') as { subject?: string; body: string };
      const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
      await navigator.clipboard.writeText(text);
      setCopiedId(lead.id);
      setTimeout(() => setCopiedId(null), 2500);
    } finally {
      setGeneratingId(null);
    }
  }

  function nextStatus(current: LeadStatus): LeadStatus | null {
    const idx = STATUS_PIPELINE.indexOf(current);
    return idx < STATUS_PIPELINE.length - 1 ? STATUS_PIPELINE[idx + 1] : null;
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-soft">
              {[
                { col: 'company_name', label: 'Company' },
                { col: 'location', label: 'Location' },
                { col: 'industry', label: 'Industry' },
                { col: null, label: 'Signal' },
                { col: 'lead_score', label: 'Score' },
                { col: null, label: 'Analysis' },
                { col: 'status', label: 'Status' },
                { col: null, label: 'Actions' },
              ].map(({ col, label }) => (
                <th
                  key={label}
                  className={clsx(
                    'text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider whitespace-nowrap',
                    col && 'cursor-pointer select-none'
                  )}
                  onClick={() => col && handleSort(col)}
                >
                  <div className="flex items-center gap-1">
                    {label}
                    {col && <SortIcon col={col} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-muted text-sm">
                  No leads found. Try running a scrape or adjusting your filters.
                </td>
              </tr>
            ) : (
              leads.map(lead => (
                <tr key={lead.id} className="table-row">
                  {/* Company */}
                  <td className="px-4 py-3">
                    <Link href={`/leads/${lead.id}`} className="font-medium text-ink hover:text-link transition-colors block truncate max-w-[180px]">
                      {lead.company_name}
                    </Link>
                    {lead.source && (
                      <span className="text-[10px] text-muted capitalize">{lead.source.replace('_', ' ')}</span>
                    )}
                  </td>

                  {/* Location */}
                  <td className="px-4 py-3 text-body whitespace-nowrap text-xs">
                    {lead.location ?? '—'}
                  </td>

                  {/* Industry */}
                  <td className="px-4 py-3 text-body text-xs max-w-[120px] truncate">
                    {lead.industry ?? '—'}
                  </td>

                  {/* Signal */}
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="text-xs text-body truncate" title={lead.hiring_signal ?? ''}>
                      {lead.hiring_signal ?? '—'}
                    </p>
                  </td>

                  {/* Score */}
                  <td className="px-4 py-3">
                    <ScoreBadge score={lead.lead_score} />
                  </td>

                  {/* Analysis */}
                  <td className="px-4 py-3 max-w-[200px]">
                    <Link href={`/leads/${lead.id}`} className="text-xs text-link hover:text-link-active truncate block">
                      View analysis →
                    </Link>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={lead.status} />
                      {nextStatus(lead.status) && (
                        <button
                          onClick={() => statusMutation.mutate({ id: lead.id, status: nextStatus(lead.status)! })}
                          className="text-[10px] text-muted hover:text-ink transition-colors"
                          title={`Move to ${nextStatus(lead.status)}`}
                        >
                          →
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopyOutreach(lead)}
                        disabled={generatingId === lead.id}
                        className="p-1.5 rounded-md hover:bg-surface-soft text-muted hover:text-ink transition-colors"
                        title="Copy outreach email"
                      >
                        {copiedId === lead.id ? (
                          <CheckCircle className="w-4 h-4 text-success" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>

                      <Link
                        href={`/leads/${lead.id}`}
                        className="p-1.5 rounded-md hover:bg-surface-soft text-muted hover:text-ink transition-colors"
                        title="View AI analysis"
                      >
                        <Brain className="w-4 h-4" />
                      </Link>

                      {lead.website && (
                        <a
                          href={lead.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-md hover:bg-surface-soft text-muted hover:text-ink transition-colors"
                          title="Open website"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}

                      {lead.linkedin_url && (
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-md hover:bg-surface-soft text-muted hover:text-link transition-colors"
                          title="View LinkedIn"
                        >
                          <Link2 className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-hairline">
          <span className="text-xs text-muted">
            Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} leads
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="btn-ghost px-2 py-1 disabled:opacity-30"
            >
              ←
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={clsx(
                    'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                    p === page ? 'bg-ink text-white' : 'btn-ghost'
                  )}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="btn-ghost px-2 py-1 disabled:opacity-30"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
