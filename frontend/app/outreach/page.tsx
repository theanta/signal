'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchOutreachQueue } from '@/services/outreach';
import { generateOutreach, updateLeadStatus } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ScoreBadge from '@/components/ui/ScoreBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Copy, CheckCircle, ExternalLink, Link2,
  MessageSquare, RefreshCw, Send,
} from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
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

  async function handleCopy(msg: QueueLead['outreach_messages'][0], leadId: string) {
    const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
    await navigator.clipboard.writeText(text);
    setCopied(leadId);
    setTimeout(() => setCopied(null), 2500);
  }

  const selectedLead = leads.find(l => l.id === selected);

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Outreach Queue"
        subtitle={`${leads.length} leads ready for outreach`}
      />

      <div className="p-8">
        {isLoading ? (
          <LoadingSpinner />
        ) : leads.length === 0 ? (
          <div className="card p-12 text-center">
            <Send className="w-10 h-10 text-surface-strong mx-auto mb-4" />
            <h3 className="text-ink font-medium mb-2">Outreach queue is empty</h3>
            <p className="text-muted text-sm mb-5">
              Leads with score ≥ 50 and status &quot;new&quot; or &quot;analyzed&quot; appear here.
            </p>
            <Link href="/dashboard" className="btn-primary">Run a Scrape</Link>
          </div>
        ) : (
          <div className="flex gap-5">
            {/* Lead list */}
            <div className="w-72 flex-shrink-0 space-y-1.5">
              {leads.map(lead => (
                <div
                  key={lead.id}
                  onClick={() => setSelected(lead.id)}
                  className={`card p-4 cursor-pointer transition-colors ${selected === lead.id ? 'border-ink bg-surface-soft' : 'hover:bg-surface-soft'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{lead.company_name}</p>
                      <p className="text-xs text-muted mt-0.5 truncate">{lead.location ?? ''}</p>
                    </div>
                    <ScoreBadge score={lead.lead_score} size="sm" />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={lead.status} />
                    {lead.outreach_messages.length > 0 && (
                      <span className="text-[10px] text-success bg-[#e8f5ec] border border-[#b3dcbe] px-1.5 py-0.5 rounded-full">
                        {lead.outreach_messages.length} msg
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Detail panel */}
            <div className="flex-1 min-w-0">
              {!selectedLead ? (
                <div className="card p-12 flex flex-col items-center justify-center text-center h-full">
                  <MessageSquare className="w-10 h-10 text-surface-strong mb-3" />
                  <p className="text-muted text-sm">Select a lead to view and manage outreach</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Lead info */}
                  <div className="card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Link href={`/leads/${selectedLead.id}`} className="text-lg font-medium text-ink hover:text-link transition-colors">
                            {selectedLead.company_name}
                          </Link>
                          <ScoreBadge score={selectedLead.lead_score} />
                        </div>
                        <p className="text-sm text-muted">{selectedLead.location} · {selectedLead.industry}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedLead.website && (
                          <a href={selectedLead.website} target="_blank" rel="noopener noreferrer" className="btn-secondary gap-1.5 text-xs">
                            <ExternalLink className="w-3.5 h-3.5" /> Site
                          </a>
                        )}
                        {selectedLead.linkedin_url && (
                          <a href={selectedLead.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn-secondary gap-1.5 text-xs">
                            <Link2 className="w-3.5 h-3.5" /> LinkedIn
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Status actions */}
                    <div className="flex items-center gap-2 mt-4 pt-4 border-t border-hairline">
                      <span className="text-xs text-muted">Mark as:</span>
                      <button
                        onClick={() => statusMutation.mutate({ id: selectedLead.id, status: 'contacted' })}
                        className="text-xs px-3 py-1.5 rounded-md border border-[#d4c3f5] bg-[#f0ebfb] text-[#6b3fbf] transition-colors"
                      >
                        Contacted
                      </button>
                      <button
                        onClick={() => statusMutation.mutate({ id: selectedLead.id, status: 'replied' })}
                        className="text-xs px-3 py-1.5 rounded-md border border-[#f0d990] bg-[#fdf3df] text-[#9a6b00] transition-colors"
                      >
                        Replied
                      </button>
                      <button
                        onClick={() => statusMutation.mutate({ id: selectedLead.id, status: 'meeting' })}
                        className="text-xs px-3 py-1.5 rounded-md border border-[#b3dcbe] bg-[#e8f5ec] text-success transition-colors"
                      >
                        Meeting Booked
                      </button>
                    </div>
                  </div>

                  {/* Outreach messages */}
                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium text-ink">Outreach Messages</h3>
                      <button
                        onClick={() => handleGenerate(selectedLead)}
                        disabled={generating === selectedLead.id}
                        className="btn-secondary gap-1.5 text-xs"
                      >
                        {generating === selectedLead.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5" />
                        )}
                        {generating === selectedLead.id ? 'Generating...' : 'Generate New'}
                      </button>
                    </div>

                    {selectedLead.outreach_messages.length === 0 ? (
                      <p className="text-sm text-muted text-center py-6">
                        No messages yet. Click &quot;Generate New&quot; to create outreach with Claude.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {selectedLead.outreach_messages.map(msg => (
                          <div key={msg.id} className="bg-surface-soft rounded-md p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                {msg.subject && (
                                  <p className="text-sm font-medium text-ink mb-2">
                                    Subject: {msg.subject}
                                  </p>
                                )}
                                <pre className="text-sm text-body whitespace-pre-wrap font-sans leading-relaxed">
                                  {msg.body}
                                </pre>
                              </div>
                              <button
                                onClick={() => handleCopy(msg, selectedLead.id)}
                                className="p-2 rounded-md hover:bg-surface-strong text-muted hover:text-ink transition-colors flex-shrink-0"
                                title="Copy to clipboard"
                              >
                                {copied === selectedLead.id ? (
                                  <CheckCircle className="w-4 h-4 text-success" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
