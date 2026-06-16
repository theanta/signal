'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLead, analyzeLead, generateOutreach, updateLeadStatus } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ScoreBadge from '@/components/ui/ScoreBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Brain, Copy, CheckCircle, ExternalLink, Link2,
  Zap, Target, MessageSquare, RefreshCw, Monitor, User,
} from 'lucide-react';
import { useState } from 'react';
import type { LeadStatus, OutreachMessage } from '../../../../shared/types';
import { clsx } from 'clsx';

const STATUS_PIPELINE: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'outreach' | 'signals'>('overview');

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLead(id),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeLead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', id] }),
  });

  const outreachMutation = useMutation({
    mutationFn: (channel: 'email' | 'linkedin') => generateOutreach(id, channel),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', id] }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: LeadStatus) => updateLeadStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', id] }),
  });

  async function copyToClipboard(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }

  if (isLoading) return <LoadingSpinner className="h-screen" />;
  if (!lead) return (
    <div className="flex items-center justify-center h-screen text-muted">
      Lead not found
    </div>
  );

  const signals = lead.signals ?? [];
  const latestSignal = signals[0];
  const messages = lead.outreach_messages ?? [];

  return (
    <div className="min-h-screen">
      <PageHeader
        title={lead.company_name}
        subtitle={`${lead.location ?? ''} · ${lead.industry ?? 'Unknown industry'}`}
        actions={
          <div className="flex items-center gap-2">
            {lead.website && (
              <a href={lead.website} target="_blank" rel="noopener noreferrer" className="btn-secondary gap-2">
                <ExternalLink className="w-4 h-4" />
                Website
              </a>
            )}
            {lead.linkedin_url && (
              <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn-secondary gap-2">
                <Link2 className="w-4 h-4" />
                LinkedIn
              </a>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {/* Header card */}
        <div className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={lead.status} />
                <ScoreBadge score={lead.lead_score} />
                {lead.hiring_signal && (
                  <span className="badge bg-[#fdf3df] text-[#9a6b00] border border-[#f0d990] text-xs">
                    <Zap className="w-3 h-3" />
                    {lead.hiring_signal}
                  </span>
                )}
              </div>
              {lead.description && (
                <p className="text-sm text-body mt-3 leading-relaxed">{lead.description}</p>
              )}
            </div>

            {/* Status changer */}
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted text-right">Move to:</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {STATUS_PIPELINE.filter(s => s !== lead.status).map(s => (
                  <button
                    key={s}
                    onClick={() => statusMutation.mutate(s)}
                    className="text-xs px-2 py-1 rounded-md border border-hairline text-muted hover:border-ink hover:text-ink transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Meta details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-hairline">
            {[
              { label: 'Company Size', value: lead.company_size ?? 'Unknown' },
              { label: 'Source', value: lead.source?.replace('_', ' ') ?? 'Unknown' },
              { label: 'Job Role Hiring', value: lead.job_title ?? 'N/A' },
              { label: 'Scraped', value: lead.scraped_at ? new Date(lead.scraped_at).toLocaleDateString() : 'N/A' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-muted mb-0.5">{label}</p>
                <p className="text-sm text-ink font-medium capitalize">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-hairline">
          {(['overview', 'outreach', 'signals'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                activeTab === tab
                  ? 'text-ink border-ink'
                  : 'text-muted border-transparent'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {latestSignal ? (
              latestSignal.signal_type === 'disqualified' ? (
                /* Disqualified enterprise lead */
                <div className="card p-6 border-l-4 border-l-muted">
                  <div className="flex items-start gap-3">
                    <Target className="w-5 h-5 text-muted mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-ink">Lead Disqualified</p>
                      <p className="text-sm text-body mt-1">
                        {(latestSignal.raw_analysis?.disqualify_reason as string) ?? latestSignal.operational_maturity}
                      </p>
                      <p className="text-xs text-muted mt-2">
                        This company falls outside ANTA&apos;s SMB target market. No outreach will be generated.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Pain Points */}
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-sig-coral" />
                    <h3 className="text-sm font-medium text-ink">Likely Pain Points</h3>
                  </div>
                  <ul className="space-y-2">
                    {(latestSignal.likely_pain_points ?? []).map((pt, i) => (
                      <li key={i} className="text-sm text-body flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-sig-coral mt-1.5 flex-shrink-0" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Recommended Service */}
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4 text-info" />
                    <h3 className="text-sm font-medium text-ink">ANTA Recommendation</h3>
                  </div>
                  <p className="text-lg font-medium text-ink">{latestSignal.recommended_anta_service}</p>
                  <p className="text-sm text-body mt-2 leading-relaxed">{latestSignal.outreach_angle}</p>
                  <div className="mt-3 pt-3 border-t border-hairline">
                    <p className="text-xs text-muted">Digital Maturity</p>
                    <p className="text-sm text-ink mt-0.5">{latestSignal.operational_maturity}</p>
                  </div>
                </div>
              </div>
              )
            ) : (
              <div className="card p-8 text-center">
                <Brain className="w-10 h-10 text-surface-strong mx-auto mb-3" />
                <p className="text-muted text-sm mb-4">This lead hasn&apos;t been analyzed yet.</p>
                <button
                  onClick={() => analyzeMutation.mutate()}
                  disabled={analyzeMutation.isPending}
                  className="btn-primary gap-2 mx-auto"
                >
                  {analyzeMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                  {analyzeMutation.isPending ? 'Analyzing...' : 'Analyze with AI'}
                </button>
              </div>
            )}

            {/* Tech Stack */}
            {latestSignal && (latestSignal.tech_stack?.length || latestSignal.tech_gaps?.length) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {latestSignal.tech_stack && latestSignal.tech_stack.length > 0 && (
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Monitor className="w-4 h-4 text-info" />
                      <h3 className="text-sm font-medium text-ink">Detected Tech Stack</h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {latestSignal.tech_stack.map((tech, i) => (
                        <span key={i} className="badge bg-[#eaf0fb] text-info border border-[#c5d7f5] text-xs">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {latestSignal.tech_gaps && latestSignal.tech_gaps.length > 0 && (
                  <div className="card p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-sig-coral" />
                      <h3 className="text-sm font-medium text-ink">Tech Gaps (Opportunity)</h3>
                    </div>
                    <ul className="space-y-2">
                      {latestSignal.tech_gaps.map((gap, i) => (
                        <li key={i} className="text-sm text-body flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-sig-coral mt-1.5 flex-shrink-0" />
                          {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {/* Point of Contact */}
            {(lead.contact_name || lead.contact_email) && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-success" />
                  <h3 className="text-sm font-medium text-ink">Point of Contact</h3>
                </div>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    {lead.contact_name && (
                      <p className="text-sm font-medium text-ink">{lead.contact_name}</p>
                    )}
                    {lead.contact_title && (
                      <p className="text-xs text-muted mt-0.5">{lead.contact_title}</p>
                    )}
                    {lead.contact_email && (
                      <a
                        href={`mailto:${lead.contact_email}`}
                        className="text-xs text-link hover:text-link-active mt-1 block"
                      >
                        {lead.contact_email}
                      </a>
                    )}
                  </div>
                  {lead.contact_email && (
                    <button
                      onClick={() => copyToClipboard(lead.contact_email!, 'contact_email')}
                      className="p-1.5 rounded-md hover:bg-surface-soft text-muted hover:text-ink transition-colors"
                      title="Copy email"
                    >
                      {copied === 'contact_email'
                        ? <CheckCircle className="w-4 h-4 text-success" />
                        : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Score breakdown */}
            {lead.score_detail && (
              <div className="card p-5">
                <h3 className="text-sm font-medium text-ink mb-4">Score Breakdown</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {[
                    { label: 'Company Size', score: lead.score_detail.company_size_score, max: 25 },
                    { label: 'Hiring Urgency', score: lead.score_detail.hiring_urgency_score, max: 25 },
                    { label: 'Ops Complexity', score: lead.score_detail.complexity_score, max: 25 },
                    { label: 'Digital Gap', score: lead.score_detail.digital_score, max: 25 },
                  ].map(({ label, score, max }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs text-muted mb-1">
                        <span>{label}</span>
                        <span>{score ?? 0}/{max}</span>
                      </div>
                      <div className="h-1 bg-surface-strong rounded-full overflow-hidden">
                        <div
                          className="h-full bg-ink rounded-full"
                          style={{ width: `${((score ?? 0) / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {lead.score_detail.scoring_rationale && (
                  <p className="text-xs text-muted italic">{lead.score_detail.scoring_rationale}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab: Outreach */}
        {activeTab === 'outreach' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => outreachMutation.mutate('email')}
                disabled={outreachMutation.isPending}
                className="btn-primary gap-2"
              >
                {outreachMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Generate Cold Email
              </button>
              <button
                onClick={() => outreachMutation.mutate('linkedin')}
                disabled={outreachMutation.isPending}
                className="btn-secondary gap-2"
              >
                <Link2 className="w-4 h-4" />
                Generate LinkedIn
              </button>
            </div>

            {messages.length === 0 ? (
              <div className="card p-8 text-center">
                <MessageSquare className="w-10 h-10 text-surface-strong mx-auto mb-3" />
                <p className="text-muted text-sm">No outreach messages generated yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg: OutreachMessage) => (
                  <div key={msg.id} className="card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="badge bg-[#eaf0fb] text-info border border-[#c5d7f5] text-xs capitalize">
                            {msg.channel}
                          </span>
                          <span className="text-xs text-muted">
                            {new Date(msg.created_at).toLocaleDateString()}
                          </span>
                        </div>
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
                        onClick={() => {
                          const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
                          copyToClipboard(text, msg.id);
                        }}
                        className="p-2 rounded-md hover:bg-surface-soft text-muted hover:text-ink transition-colors flex-shrink-0"
                      >
                        {copied === msg.id ? (
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
        )}

        {/* Tab: Signals */}
        {activeTab === 'signals' && (
          <div className="space-y-3">
            {signals.length === 0 ? (
              <div className="card p-8 text-center">
                <Zap className="w-10 h-10 text-surface-strong mx-auto mb-3" />
                <p className="text-muted text-sm">No signals detected yet.</p>
              </div>
            ) : (
              signals.map(sig => (
                <div key={sig.id} className="card p-5">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted mb-1">Signal Type</p>
                      <p className="text-ink font-medium capitalize">{sig.signal_type?.replace(/_/g, ' ')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Confidence</p>
                      <p className="text-body">{sig.confidence_score ? `${Math.round(sig.confidence_score * 100)}%` : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Detected</p>
                      <p className="text-body">{new Date(sig.detected_at).toLocaleDateString()}</p>
                    </div>
                    {sig.growth_indicators && sig.growth_indicators.length > 0 && (
                      <div className="col-span-full">
                        <p className="text-xs text-muted mb-1">Growth Indicators</p>
                        <div className="flex flex-wrap gap-1.5">
                          {sig.growth_indicators.map((gi, i) => (
                            <span key={i} className="badge bg-[#e8f5ec] text-success border border-[#b3dcbe] text-xs">{gi}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
