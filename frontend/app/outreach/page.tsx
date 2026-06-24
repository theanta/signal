'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOutreachQueue } from '@/services/outreach';
import { generateOutreach, updateLeadStatus } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import ScoreBadge from '@/components/ui/ScoreBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Copy, CheckCircle, ExternalLink, Link2,
  MessageSquare, RefreshCw, Send, ArrowUpRight,
} from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { LeadStatus } from '../../../shared/types';

interface QueueLead {
  id: string;
  company_name: string;
  location?: string;
  industry?: string;
  lead_score?: number;
  status: LeadStatus;
  website?: string;
  linkedin_url?: string;
  outreach_messages: Array<{ id: string; channel: string; subject?: string; body: string }>;
}

const STATUS_ACTIONS: { status: LeadStatus; label: string; className: string }[] = [
  {
    status: 'contacted',
    label: 'Contacted',
    className: 'border-status-contacted-border bg-status-contacted-bg text-status-contacted-text hover:bg-blue-100',
  },
  {
    status: 'replied',
    label: 'Replied',
    className: 'border-status-replied-border bg-status-replied-bg text-status-replied-text hover:bg-violet-100',
  },
  {
    status: 'meeting',
    label: 'Meeting Booked',
    className: 'border-status-meeting-border bg-status-meeting-bg text-status-meeting-text hover:bg-amber-100',
  },
];

function ListSkeleton() {
  return (
    <div className="space-y-1.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="card p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function OutreachQueuePage() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['outreach-queue'],
    queryFn: fetchOutreachQueue,
    refetchInterval: 30_000,
  }) as { data: QueueLead[]; isLoading: boolean };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) => updateLeadStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outreach-queue'] });
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
  });

  async function handleGenerate(lead: QueueLead) {
    setGenerating(lead.id);
    try {
      await generateOutreach(lead.id, 'email');
      qc.invalidateQueries({ queryKey: ['outreach-queue'] });
    } finally {
      setGenerating(null);
    }
  }

  async function handleCopy(msg: QueueLead['outreach_messages'][0], msgId: string) {
    const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
    await navigator.clipboard.writeText(text);
    setCopied(msgId);
    setTimeout(() => setCopied(null), 2500);
  }

  const selectedLead = leads.find(l => l.id === selected);

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        title="Outreach Queue"
        subtitle={isLoading ? undefined : `${leads.length} leads ready`}
        icon={Send}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Lead list (sticky, independently scrollable) ── */}
        <aside className="w-72 flex-shrink-0 border-r border-hairline overflow-y-auto bg-surface-soft">
          {isLoading ? (
            <div className="p-3">
              <ListSkeleton />
            </div>
          ) : leads.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">
              No leads in queue
            </div>
          ) : (
            <div className="p-3 space-y-1">
              {leads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => setSelected(lead.id)}
                  className={cn(
                    'w-full text-left p-3.5 rounded-xl border transition-all',
                    selected === lead.id
                      ? 'bg-white border-brand/30 shadow-card'
                      : 'bg-transparent border-transparent hover:bg-white hover:border-hairline hover:shadow-card',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className={cn(
                        'text-body-sm font-medium truncate',
                        selected === lead.id ? 'text-ink' : 'text-neutral-700',
                      )}>
                        {lead.company_name}
                      </p>
                      {lead.location && (
                        <p className="text-xs text-muted mt-0.5 truncate">{lead.location}</p>
                      )}
                    </div>
                    <ScoreBadge score={lead.lead_score} size="sm" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={lead.status} size="sm" />
                    {lead.outreach_messages.length > 0 && (
                      <span className="text-3xs font-semibold text-success bg-status-client-bg border border-status-client-border px-1.5 py-0.5 rounded-full">
                        {lead.outreach_messages.length} msg
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* ── Detail panel (independently scrollable) ── */}
        <main className="flex-1 overflow-y-auto">
          {!selectedLead ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-neutral-100 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-neutral-300" />
              </div>
              <p className="text-sm font-medium text-neutral-400">Select a lead to manage outreach</p>
              <p className="text-xs text-neutral-300 max-w-xs">
                Choose a lead from the list to view AI-generated messages and track status.
              </p>
            </div>
          ) : leads.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-neutral-100 flex items-center justify-center">
                <Send className="w-6 h-6 text-neutral-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500 mb-1">Outreach queue is empty</p>
                <p className="text-xs text-neutral-400">Leads with score ≥ 50 and status "new" or "analyzed" appear here.</p>
              </div>
              <Link href="/dashboard" className="btn-primary mt-1">Run a Scrape</Link>
            </div>
          ) : (
            <div className="p-6 space-y-4 max-w-3xl">

              {/* Lead header card */}
              <div className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <Link
                        href={`/leads/${selectedLead.id}`}
                        className="text-lg font-semibold text-ink hover:text-brand transition-colors flex items-center gap-1.5 group"
                      >
                        {selectedLead.company_name}
                        <ArrowUpRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-brand transition-colors" />
                      </Link>
                      <ScoreBadge score={selectedLead.lead_score} />
                    </div>
                    {(selectedLead.location || selectedLead.industry) && (
                      <p className="text-body-sm text-muted">
                        {[selectedLead.location, selectedLead.industry].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {selectedLead.website && (
                      <a
                        href={selectedLead.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary gap-1.5 text-xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Site
                      </a>
                    )}
                    {selectedLead.linkedin_url && (
                      <a
                        href={selectedLead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary gap-1.5 text-xs"
                      >
                        <Link2 className="w-3.5 h-3.5" /> LinkedIn
                      </a>
                    )}
                  </div>
                </div>

                {/* Pipeline status buttons */}
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-hairline flex-wrap">
                  <span className="text-xs text-muted font-medium">Move to:</span>
                  {STATUS_ACTIONS.map(({ status, label, className }) => (
                    <button
                      key={status}
                      onClick={() => statusMutation.mutate({ id: selectedLead.id, status })}
                      disabled={statusMutation.isPending || selectedLead.status === status}
                      className={cn(
                        'text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                        className,
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Outreach messages */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-body-sm font-semibold text-ink">Outreach Messages</h3>
                  <button
                    onClick={() => handleGenerate(selectedLead)}
                    disabled={generating === selectedLead.id}
                    className="btn-secondary gap-1.5 text-xs"
                  >
                    {generating === selectedLead.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <MessageSquare className="w-3.5 h-3.5" />
                    }
                    {generating === selectedLead.id ? 'Generating…' : 'Generate New'}
                  </button>
                </div>

                {selectedLead.outreach_messages.length === 0 ? (
                  <div className="py-8 text-center">
                    <div className="w-10 h-10 rounded-xl bg-brand/5 flex items-center justify-center mx-auto mb-3">
                      <MessageSquare className="w-5 h-5 text-brand/40" />
                    </div>
                    <p className="text-body-sm text-neutral-400 mb-1">No messages yet</p>
                    <p className="text-xs text-neutral-300">Click "Generate New" to create AI-powered outreach.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedLead.outreach_messages.map(msg => (
                      <div key={msg.id} className="bg-surface-soft rounded-xl border border-hairline p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2.5">
                              <span className={cn(
                                'inline-flex items-center px-2 py-0.5 text-2xs font-semibold rounded-full border capitalize',
                                msg.channel === 'email'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-indigo-50 text-indigo-700 border-indigo-200',
                              )}>
                                {msg.channel}
                              </span>
                            </div>
                            {msg.subject && (
                              <p className="text-body-sm font-semibold text-ink mb-2 pb-2 border-b border-neutral-200">
                                {msg.subject}
                              </p>
                            )}
                            <pre className="text-body-sm text-neutral-600 whitespace-pre-wrap font-sans leading-relaxed">
                              {msg.body}
                            </pre>
                          </div>
                          <button
                            onClick={() => handleCopy(msg, msg.id)}
                            className="p-1.5 rounded-lg hover:bg-neutral-200 text-neutral-400 hover:text-ink transition-colors flex-shrink-0 mt-0.5"
                            title="Copy to clipboard"
                          >
                            {copied === msg.id
                              ? <CheckCircle className="w-4 h-4 text-success" />
                              : <Copy className="w-4 h-4" />
                            }
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </main>
      </div>
    </div>
  );
}
