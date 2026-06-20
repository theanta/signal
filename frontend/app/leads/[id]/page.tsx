'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLead, analyzeLead, generateOutreach, updateLeadStatus } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import ScoreBadge from '@/components/ui/ScoreBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  Brain, Copy, CheckCircle, ExternalLink, Link2,
  Zap, Target, MessageSquare, RefreshCw, Monitor, User,
  Building2, MapPin, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { LeadStatus, OutreachMessage } from '../../../../shared/types';

const STATUS_PIPELINE: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];

const STATUS_COLORS: Record<LeadStatus, string> = {
  new:       'bg-slate-100 text-slate-600 border-slate-200',
  analyzed:  'bg-blue-50 text-blue-600 border-blue-200',
  contacted: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  replied:   'bg-violet-50 text-violet-600 border-violet-200',
  meeting:   'bg-amber-50 text-amber-700 border-amber-200',
  proposal:  'bg-orange-50 text-orange-700 border-orange-200',
  client:    'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function CompanyAvatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand font-semibold text-lg flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, className }: {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-white border border-neutral-200 rounded-xl shadow-card p-5', className)}>
      {title && (
        <div className="flex items-center gap-2 mb-4">
          {Icon && <Icon className="w-4 h-4 text-neutral-400" />}
          <h3 className="text-[11.5px] font-semibold text-neutral-400 uppercase tracking-wider">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-neutral-100 last:border-0">
      <span className="text-[12px] text-neutral-400 font-medium flex-shrink-0">{label}</span>
      <span className="text-[13px] text-ink text-right capitalize">{value}</span>
    </div>
  );
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round(((score ?? 0) / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11.5px]">
        <span className="text-neutral-400">{label}</span>
        <span className="font-medium text-ink">
          {score ?? 0}<span className="text-neutral-300">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: pct >= 70 ? '#10b981' : pct >= 45 ? '#f59e0b' : '#94a3b8',
          }}
        />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-8 py-6 grid grid-cols-3 gap-6 animate-fade-in">
      <div className="col-span-2 space-y-5">
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-xl" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="flex gap-2 pt-3 border-t border-neutral-100">
            <Skeleton className="h-8 w-36 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
          <Skeleton className="h-3 w-24 mb-4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
          <Skeleton className="h-3 w-28 mb-4" />
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLead(id),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeLead(id),
    onMutate: () => toast.loading('Analyzing lead with AI…') as unknown as string | number,
    onSuccess: (_data, _vars, ctx) => {
      toast.resolve(ctx as string | number, 'success', 'Analysis complete');
      qc.invalidateQueries({ queryKey: ['lead', id] });
    },
    onError: (_err, _vars, ctx) => {
      toast.resolve(ctx as string | number, 'error', 'Analysis failed');
    },
  });

  const outreachMutation = useMutation({
    mutationFn: (channel: 'email' | 'linkedin') => generateOutreach(id, channel),
    onMutate: () => toast.loading('Generating outreach message…') as unknown as string | number,
    onSuccess: (_data, _vars, ctx) => {
      toast.resolve(ctx as string | number, 'success', 'Outreach generated');
      qc.invalidateQueries({ queryKey: ['lead', id] });
    },
    onError: (_err, _vars, ctx) => {
      toast.resolve(ctx as string | number, 'error', 'Failed to generate outreach');
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: LeadStatus) => updateLeadStatus(id, status),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['lead', id] });
    },
    onError: () => toast.error('Failed to update status'),
  });

  async function copyToClipboard(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }

  if (isLoading) return <DetailSkeleton />;
  if (!lead) return (
    <div className="flex flex-col items-center justify-center h-screen gap-3 text-neutral-400">
      <Building2 className="w-10 h-10" />
      <p className="text-sm">Lead not found</p>
    </div>
  );

  const signals = lead.signals ?? [];
  const latestSignal = signals[0];
  const messages = (lead.outreach_messages ?? []).slice().reverse();
  const isDisqualified = latestSignal?.signal_type === 'disqualified';

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader
        title={lead.company_name}
        subtitle={[lead.industry, lead.location].filter(Boolean).join(' · ') || 'Lead detail'}
        breadcrumbs={[
          { label: 'Leads', href: '/leads' },
          { label: lead.company_name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {lead.website && (
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Website
              </a>
            )}
            {lead.linkedin_url && (
              <a
                href={lead.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600"
              >
                <Link2 className="w-3.5 h-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        }
      />

      <div className="px-8 py-6 grid grid-cols-3 gap-6 items-start">

        {/* ═══════════════════════════════════════
            LEFT COLUMN — col-span-2
        ═══════════════════════════════════════ */}
        <div className="col-span-2 space-y-5">

          {/* Header card */}
          <div className="bg-white border border-neutral-200 rounded-xl shadow-card p-5">
            <div className="flex items-start gap-4">
              <CompanyAvatar name={lead.company_name} />
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold text-ink leading-tight">{lead.company_name}</h1>
                <div className="flex items-center gap-2 mt-1 text-[13px] text-neutral-400 flex-wrap">
                  {lead.industry && (
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {lead.industry}
                    </span>
                  )}
                  {lead.industry && lead.location && (
                    <span className="text-neutral-200">·</span>
                  )}
                  {lead.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {lead.location}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <StatusBadge status={lead.status} />
                  <ScoreBadge score={lead.lead_score} />
                  {lead.hiring_signal && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                      <Zap className="w-3 h-3" />
                      {lead.hiring_signal}
                    </span>
                  )}
                </div>
                {lead.description && (
                  <p className="text-[13px] text-neutral-500 mt-3 leading-relaxed border-t border-neutral-100 pt-3">
                    {lead.description}
                  </p>
                )}
              </div>
            </div>

            {/* Action row */}
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-neutral-100">
              <button
                onClick={() => outreachMutation.mutate('email')}
                disabled={outreachMutation.isPending}
                className="inline-flex items-center gap-1.5 h-8 px-4 text-[13px] font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                {outreachMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <MessageSquare className="w-3.5 h-3.5" />}
                Generate Email
              </button>
              <button
                onClick={() => outreachMutation.mutate('linkedin')}
                disabled={outreachMutation.isPending}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600 disabled:opacity-50"
              >
                <Link2 className="w-3.5 h-3.5" />
                LinkedIn Message
              </button>
              <button
                onClick={() => statusMutation.mutate('contacted')}
                disabled={statusMutation.isPending || lead.status === 'contacted'}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600 disabled:opacity-40"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Mark Contacted
              </button>
            </div>
          </div>

          {/* AI Analysis */}
          {!latestSignal ? (
            <div className="bg-white border border-neutral-200 rounded-xl shadow-card p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-neutral-50 flex items-center justify-center mx-auto mb-3">
                <Brain className="w-6 h-6 text-neutral-300" />
              </div>
              <p className="text-[13px] text-neutral-400 mb-4">This lead hasn&apos;t been analyzed yet.</p>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="inline-flex items-center gap-2 h-9 px-5 text-[13px] font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors mx-auto disabled:opacity-50"
              >
                {analyzeMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Brain className="w-3.5 h-3.5" />}
                {analyzeMutation.isPending ? 'Analyzing…' : 'Analyze with AI'}
              </button>
            </div>
          ) : isDisqualified ? (
            <div className="bg-white border border-neutral-200 border-l-4 border-l-neutral-300 rounded-xl shadow-card p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center flex-shrink-0">
                  <Target className="w-4 h-4 text-neutral-400" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-ink">Lead Disqualified</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">
                    {(latestSignal.raw_analysis?.disqualify_reason as string) ?? latestSignal.operational_maturity}
                  </p>
                  <p className="text-[12px] text-neutral-400 mt-2">
                    Falls outside ANTA&apos;s SMB target market. No outreach will be generated.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <SectionCard title="Pain Points" icon={Target}>
                  <ul className="space-y-2">
                    {(latestSignal.likely_pain_points ?? []).length > 0
                      ? latestSignal.likely_pain_points!.map((pt, i) => (
                        <li key={i} className="text-[13px] text-neutral-600 flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 flex-shrink-0" />
                          {pt}
                        </li>
                      ))
                      : <li className="text-[13px] text-neutral-400">No pain points identified.</li>
                    }
                  </ul>
                </SectionCard>

                <SectionCard title="ANTA Recommendation" icon={Brain}>
                  {latestSignal.recommended_anta_service && (
                    <p className="text-[15px] font-semibold text-ink mb-2">
                      {latestSignal.recommended_anta_service}
                    </p>
                  )}
                  {latestSignal.outreach_angle && (
                    <p className="text-[13px] text-neutral-500 leading-relaxed">
                      {latestSignal.outreach_angle}
                    </p>
                  )}
                  {latestSignal.operational_maturity && (
                    <div className="mt-3 pt-3 border-t border-neutral-100">
                      <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-0.5">
                        Digital Maturity
                      </p>
                      <p className="text-[13px] text-neutral-600">{latestSignal.operational_maturity}</p>
                    </div>
                  )}
                </SectionCard>
              </div>

              {(latestSignal.tech_stack?.length || latestSignal.tech_gaps?.length) ? (
                <div className="grid grid-cols-2 gap-4">
                  {latestSignal.tech_stack && latestSignal.tech_stack.length > 0 && (
                    <SectionCard title="Tech Stack" icon={Monitor}>
                      <div className="flex flex-wrap gap-1.5">
                        {latestSignal.tech_stack.map((tech, i) => (
                          <span key={i} className="inline-flex items-center px-2 py-0.5 text-[11.5px] font-medium rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                            {tech}
                          </span>
                        ))}
                      </div>
                    </SectionCard>
                  )}
                  {latestSignal.tech_gaps && latestSignal.tech_gaps.length > 0 && (
                    <SectionCard title="Tech Gaps — Opportunity" icon={Zap}>
                      <ul className="space-y-2">
                        {latestSignal.tech_gaps.map((gap, i) => (
                          <li key={i} className="text-[13px] text-neutral-600 flex items-start gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </SectionCard>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Point of Contact */}
          {(lead.contact_name || lead.contact_email) && (
            <SectionCard title="Point of Contact" icon={User}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-[13px] font-medium text-neutral-500">
                    {(lead.contact_name ?? '?')[0].toUpperCase()}
                  </div>
                  <div>
                    {lead.contact_name && (
                      <p className="text-[13px] font-medium text-ink">{lead.contact_name}</p>
                    )}
                    {lead.contact_title && (
                      <p className="text-[12px] text-neutral-400">{lead.contact_title}</p>
                    )}
                    {lead.contact_email && (
                      <a href={`mailto:${lead.contact_email}`}
                        className="text-[12px] text-brand hover:text-brand/80 mt-0.5 block">
                        {lead.contact_email}
                      </a>
                    )}
                  </div>
                </div>
                {lead.contact_email && (
                  <button
                    onClick={() => copyToClipboard(lead.contact_email!, 'contact_email')}
                    className="p-1.5 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-ink transition-colors"
                    title="Copy email"
                  >
                    {copied === 'contact_email'
                      ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                      : <Copy className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </SectionCard>
          )}

          {/* Outreach Messages */}
          {messages.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11.5px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Outreach Messages
                </h3>
                <span className="text-[12px] text-neutral-400">{messages.length} generated</span>
              </div>
              {messages.map((msg: OutreachMessage) => (
                <div key={msg.id} className="bg-white border border-neutral-200 rounded-xl shadow-card p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border capitalize',
                        msg.channel === 'email'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200',
                      )}>
                        {msg.channel}
                      </span>
                      <span className="text-[11.5px] text-neutral-400">
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
                        copyToClipboard(text, msg.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-ink transition-colors flex-shrink-0"
                      title="Copy message"
                    >
                      {copied === msg.id
                        ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                        : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  {msg.subject && (
                    <p className="text-[13px] font-medium text-ink mb-2 pb-2 border-b border-neutral-100">
                      {msg.subject}
                    </p>
                  )}
                  <pre className="text-[13px] text-neutral-600 whitespace-pre-wrap font-sans leading-relaxed">
                    {msg.body}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-neutral-50 flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="w-5 h-5 text-neutral-300" />
              </div>
              <p className="text-[13px] text-neutral-400 mb-3">No outreach messages generated yet.</p>
              <button
                onClick={() => outreachMutation.mutate('email')}
                disabled={outreachMutation.isPending}
                className="inline-flex items-center gap-1.5 h-8 px-4 text-[12.5px] font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Generate Cold Email
              </button>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════
            RIGHT COLUMN — sticky sidebar
        ═══════════════════════════════════════ */}
        <div className="sticky top-6 space-y-4">

          {/* Company details */}
          <SectionCard title="Company Details">
            <div>
              <DetailRow label="Size" value={lead.company_size ?? <span className="text-neutral-300">Unknown</span>} />
              <DetailRow label="Industry" value={lead.industry ?? <span className="text-neutral-300">Unknown</span>} />
              <DetailRow label="Location" value={lead.location ?? <span className="text-neutral-300">Unknown</span>} />
              <DetailRow
                label="Source"
                value={lead.source?.replace('_', ' ') ?? 'Unknown'}
              />
              {lead.job_title && (
                <DetailRow label="Hiring For" value={lead.job_title} />
              )}
              <DetailRow
                label="Discovered"
                value={
                  lead.scraped_at
                    ? formatDistanceToNow(new Date(lead.scraped_at), { addSuffix: true })
                    : <span className="text-neutral-300">N/A</span>
                }
              />
            </div>
          </SectionCard>

          {/* Score breakdown */}
          {lead.score_detail && (
            <SectionCard title="Score Breakdown">
              <div className="space-y-3 mb-4">
                {[
                  { label: 'Company Size',   score: lead.score_detail.company_size_score  ?? 0, max: 25 },
                  { label: 'Hiring Urgency', score: lead.score_detail.hiring_urgency_score ?? 0, max: 25 },
                  { label: 'Ops Complexity', score: lead.score_detail.complexity_score     ?? 0, max: 25 },
                  { label: 'Digital Gap',    score: lead.score_detail.digital_score        ?? 0, max: 25 },
                ].map(item => <ScoreBar key={item.label} {...item} />)}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-neutral-100">
                <span className="text-[12px] text-neutral-400 font-medium">Total Score</span>
                <span className="text-[22px] font-bold text-ink">{lead.lead_score ?? 0}</span>
              </div>
              {lead.score_detail.scoring_rationale && (
                <p className="text-[11.5px] text-neutral-400 italic mt-2 leading-relaxed">
                  {lead.score_detail.scoring_rationale}
                </p>
              )}
            </SectionCard>
          )}

          {/* Status changer */}
          <SectionCard title="Pipeline Stage">
            <div className="space-y-1">
              {STATUS_PIPELINE.map(s => (
                <button
                  key={s}
                  onClick={() => s !== lead.status && statusMutation.mutate(s)}
                  disabled={statusMutation.isPending}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-all',
                    s === lead.status
                      ? cn('border cursor-default', STATUS_COLORS[s])
                      : 'text-neutral-500 hover:bg-neutral-50 hover:text-ink border border-transparent hover:border-neutral-200',
                  )}
                >
                  <span className="capitalize">{s}</span>
                  {s === lead.status
                    ? <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Current</span>
                    : <ChevronRight className="w-3.5 h-3.5 opacity-40" />
                  }
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Signal history (if multiple) */}
          {signals.length > 1 && (
            <SectionCard title="Signal History">
              <div className="space-y-2">
                {signals.slice(0, 5).map((sig, i) => (
                  <div key={sig.id} className={cn('flex items-start gap-2', i > 0 && 'pt-2 border-t border-neutral-100')}>
                    <div className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-[12px] font-medium text-ink capitalize">
                        {sig.signal_type?.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        {sig.confidence_score
                          ? `${Math.round(sig.confidence_score * 100)}% confidence · `
                          : ''}
                        {formatDistanceToNow(new Date(sig.detected_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
