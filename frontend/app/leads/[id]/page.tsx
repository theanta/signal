'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLead, analyzeLead, generateOutreach, updateLeadStatus } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  Brain, Copy, Check, CheckCircle, ExternalLink, Link2,
  Zap, Target, MessageSquare, RefreshCw, Monitor, User,
  Building2, MapPin, TrendingUp, ShieldCheck, ShieldAlert, ShieldQuestion,
  Clock,
} from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { LeadStatus, OutreachMessage } from '../../../../shared/types';

const STATUS_PIPELINE: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];

function getLeadAge(scrapedAt: string | null | undefined): number {
  if (!scrapedAt) return 0;
  return Math.floor((Date.now() - new Date(scrapedAt).getTime()) / 86400000);
}

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
          <h3 className="text-2xs font-semibold text-neutral-400 uppercase tracking-wider">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-neutral-100 last:border-0">
      <span className="text-xs text-neutral-400 font-medium flex-shrink-0">{label}</span>
      <span className="text-body-sm text-ink text-right capitalize">{value}</span>
    </div>
  );
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round(((score ?? 0) / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-2xs">
        <span className="text-neutral-400">{label}</span>
        <span className="font-medium text-ink">
          {score ?? 0}<span className="text-neutral-300">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500',
            pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-400' : 'bg-neutral-300'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PipelineStepper({ stages, current, onSelect, disabled }: {
  stages: LeadStatus[];
  current: LeadStatus;
  onSelect: (s: LeadStatus) => void;
  disabled: boolean;
}) {
  const currentIndex = stages.indexOf(current);
  return (
    <div className="space-y-0.5">
      {stages.map((stage, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <button
            key={stage}
            onClick={() => !isCurrent && onSelect(stage)}
            disabled={disabled}
            className={cn(
              'w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-all text-left disabled:opacity-50',
              isCurrent ? 'bg-brand/5 cursor-default' : 'hover:bg-neutral-50',
            )}
          >
            <div className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-3xs font-bold transition-all',
              isPast ? 'bg-emerald-100 text-emerald-600' :
              isCurrent ? 'bg-brand text-white' :
              'bg-neutral-100 text-neutral-400',
            )}>
              {isPast ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
            </div>
            <span className={cn(
              'text-body-sm capitalize flex-1',
              isCurrent ? 'font-semibold text-ink' :
              isPast ? 'text-neutral-400' :
              'text-neutral-500',
            )}>
              {stage}
            </span>
            {isCurrent && (
              <span className="text-3xs font-semibold text-brand uppercase tracking-wide">
                Current
              </span>
            )}
          </button>
        );
      })}
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
  const leadAge = getLeadAge(lead.scraped_at);
  const isStale = leadAge >= 7 && ['new', 'analyzed'].includes(lead.status);

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
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600"
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
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600"
              >
                <Link2 className="w-3.5 h-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        }
      />

      <div className="px-8 py-6 grid grid-cols-3 gap-6 items-start">

        {/* LEFT COLUMN */}
        <div className="col-span-2 space-y-5">

          {/* Header card */}
          <div className="bg-white border border-neutral-200 rounded-xl shadow-card p-5">
            <div className="flex items-start gap-4">
              <CompanyAvatar name={lead.company_name} />
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold text-ink leading-tight">{lead.company_name}</h1>
                <div className="flex items-center gap-2 mt-1 text-body-sm text-neutral-400 flex-wrap">
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
                  {lead.hiring_signal && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                      <Zap className="w-3 h-3" />
                      {lead.hiring_signal}
                    </span>
                  )}
                </div>
                {lead.description && (
                  <p className="text-body-sm text-neutral-500 mt-3 leading-relaxed border-t border-neutral-100 pt-3">
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
                className="inline-flex items-center gap-1.5 h-8 px-4 text-body-sm font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                {outreachMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <MessageSquare className="w-3.5 h-3.5" />}
                Generate Email
              </button>
              <button
                onClick={() => outreachMutation.mutate('linkedin')}
                disabled={outreachMutation.isPending}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600 disabled:opacity-50"
              >
                <Link2 className="w-3.5 h-3.5" />
                LinkedIn Message
              </button>
              <button
                onClick={() => statusMutation.mutate('contacted')}
                disabled={statusMutation.isPending || lead.status === 'contacted'}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600 disabled:opacity-40"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Mark Contacted
              </button>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className={cn(
                  'inline-flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border rounded-lg transition-colors disabled:opacity-40 ml-auto',
                  latestSignal
                    ? 'border-neutral-200 hover:bg-neutral-50 text-neutral-400 hover:text-ink'
                    : 'border-brand/30 bg-brand/5 text-brand hover:bg-brand/10',
                )}
                title={latestSignal ? 'Re-run AI analysis to refresh tech stack and enrichment data' : 'Run AI analysis on this lead'}
              >
                {analyzeMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : latestSignal
                    ? <RefreshCw className="w-3.5 h-3.5" />
                    : <Brain className="w-3.5 h-3.5" />}
                {analyzeMutation.isPending ? 'Analyzing…' : latestSignal ? 'Re-analyze' : 'Analyze'}
              </button>
            </div>
          </div>

          {/* Staleness banner — surfaces urgency before the user scrolls */}
          {isStale && (
            <div className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border text-body-sm',
              leadAge >= 14
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-amber-50 border-amber-200 text-amber-700',
            )}>
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>
                This lead is <strong>{leadAge} days old</strong> and hasn&apos;t been contacted yet.{' '}
                {leadAge >= 14
                  ? 'Older leads convert at lower rates — reach out now.'
                  : 'Reach out soon while the signal is fresh.'}
              </span>
            </div>
          )}

          {/* Outreach CTA — promoted above the fold when no messages exist yet */}
          {messages.length === 0 && latestSignal && !isDisqualified && (
            <div className="bg-white border border-brand/20 rounded-xl shadow-card p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink mb-1">Ready to reach out?</p>
                  <p className="text-body-sm text-neutral-500 mb-4 leading-relaxed">
                    Generate a personalized cold email or LinkedIn message based on the analysis below.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => outreachMutation.mutate('email')}
                      disabled={outreachMutation.isPending}
                      className="inline-flex items-center gap-1.5 h-8 px-4 text-body-sm font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50"
                    >
                      {outreachMutation.isPending
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <MessageSquare className="w-3.5 h-3.5" />}
                      Generate Email
                    </button>
                    <button
                      onClick={() => outreachMutation.mutate('linkedin')}
                      disabled={outreachMutation.isPending}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors text-neutral-600 disabled:opacity-50"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      LinkedIn Message
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {!latestSignal ? (
            <div className="bg-white border border-neutral-200 rounded-xl shadow-card p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-neutral-50 flex items-center justify-center mx-auto mb-3">
                <Brain className="w-6 h-6 text-neutral-300" />
              </div>
              <p className="text-body-sm text-neutral-400 mb-4">This lead hasn&apos;t been analyzed yet.</p>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="inline-flex items-center gap-2 h-9 px-5 text-body-sm font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors mx-auto disabled:opacity-50"
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
                  <p className="text-body-sm font-medium text-ink">Lead Disqualified</p>
                  <p className="text-body-sm text-neutral-500 mt-1 leading-relaxed">
                    {latestSignal.operational_maturity}
                  </p>
                  <p className="text-xs text-neutral-400 mt-2">
                    Falls outside ANTA&apos;s SMB target market. No outreach will be generated.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">

              {/* ANTA Recommendation — hero card, full width, visually primary */}
              <div className="bg-white border border-brand/20 rounded-xl shadow-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Brain className="w-4 h-4 text-brand/60" />
                  <h3 className="text-2xs font-semibold text-brand/70 uppercase tracking-wider">ANTA Recommendation</h3>
                </div>
                {latestSignal.recommended_anta_service && (
                  <p className="text-base font-semibold text-ink mb-2">
                    {latestSignal.recommended_anta_service}
                  </p>
                )}
                {latestSignal.outreach_angle && (
                  <p className="text-body-sm text-neutral-500 leading-relaxed">
                    {latestSignal.outreach_angle}
                  </p>
                )}
                {latestSignal.operational_maturity && (
                  <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center gap-2">
                    <span className="text-2xs font-semibold text-neutral-400 uppercase tracking-wide">
                      Digital Maturity
                    </span>
                    <span className="text-xs text-neutral-600">{latestSignal.operational_maturity}</span>
                  </div>
                )}
              </div>

              {/* Pain Points — full width, secondary priority */}
              <SectionCard title="Pain Points" icon={Target}>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {(latestSignal.likely_pain_points ?? []).length > 0
                    ? latestSignal.likely_pain_points!.map((pt, i) => (
                      <li key={i} className="text-body-sm text-neutral-600 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 flex-shrink-0" />
                        {pt}
                      </li>
                    ))
                    : <li className="text-body-sm text-neutral-400 col-span-2">No pain points identified.</li>
                  }
                </ul>
              </SectionCard>

              {/* Tech Stack + Gaps — tertiary, 2-col detail row */}
              {(latestSignal.tech_stack?.length || latestSignal.tech_gaps?.length) ? (
                <div className="grid grid-cols-2 gap-4">
                  {latestSignal.tech_stack && latestSignal.tech_stack.length > 0 && (
                    <SectionCard title="Tech Stack" icon={Monitor}>
                      <div className="flex flex-wrap gap-1.5">
                        {latestSignal.tech_stack.map((tech, i) => (
                          <span key={i} className="inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border bg-blue-50 text-blue-700 border-blue-200">
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
                          <li key={i} className="text-body-sm text-neutral-600 flex items-start gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </SectionCard>
                  )}
                </div>
              ) : null}

              {latestSignal.growth_indicators && latestSignal.growth_indicators.length > 0 && (
                <SectionCard title="Growth Signals" icon={TrendingUp}>
                  <div className="flex flex-wrap gap-1.5">
                    {latestSignal.growth_indicators.map((indicator, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                        {indicator}
                      </span>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
          )}

          {/* Point of Contact */}
          {(lead.contact_name || lead.contact_email) && (
            <SectionCard title="Point of Contact" icon={User}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-body-sm font-medium text-neutral-500">
                    {(lead.contact_name ?? '?')[0].toUpperCase()}
                  </div>
                  <div>
                    {lead.contact_name && (
                      <p className="text-body-sm font-medium text-ink">{lead.contact_name}</p>
                    )}
                    {lead.contact_title && (
                      <p className="text-xs text-neutral-400">{lead.contact_title}</p>
                    )}
                    {lead.contact_email && (
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <a href={`mailto:${lead.contact_email}`}
                          className="text-xs text-brand hover:text-brand/80">
                          {lead.contact_email}
                        </a>
                        {lead.contact_email_confidence === 'verified' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-3xs font-medium rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            verified
                          </span>
                        )}
                        {lead.contact_email_confidence === 'catch_all' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-3xs font-medium rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                            <ShieldAlert className="w-2.5 h-2.5" />
                            catch-all
                          </span>
                        )}
                        {(lead.contact_email_confidence === 'pattern_inferred' || lead.contact_email_confidence === 'unknown') && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-3xs font-medium rounded-full bg-neutral-50 text-neutral-400 border border-neutral-200">
                            <ShieldQuestion className="w-2.5 h-2.5" />
                            unverified
                          </span>
                        )}
                      </div>
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

          {/* Outreach Messages — shown when populated */}
          {messages.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-2xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Outreach Messages
                </h3>
                <span className="text-xs text-neutral-400">{messages.length} generated</span>
              </div>
              {messages.map((msg: OutreachMessage) => (
                <div key={msg.id} className="bg-white border border-neutral-200 rounded-xl shadow-card p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border capitalize',
                        msg.channel === 'email'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200',
                      )}>
                        {msg.channel}
                      </span>
                      <span className="text-2xs text-neutral-400">
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
                    <p className="text-body-sm font-medium text-ink mb-2 pb-2 border-b border-neutral-100">
                      {msg.subject}
                    </p>
                  )}
                  <pre className="text-body-sm text-neutral-600 whitespace-pre-wrap font-sans leading-relaxed">
                    {msg.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — sticky sidebar */}
        <div className="sticky top-6 space-y-4">

          {/* Score breakdown — first in sidebar, canonical home for the score */}
          {lead.score_detail && (
            <SectionCard title="Score Breakdown">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-neutral-100">
                <span className="text-xs text-neutral-400 font-medium">Lead Score</span>
                <span className={cn(
                  'text-[28px] font-bold leading-none',
                  (lead.lead_score ?? 0) >= 70 ? 'text-emerald-600' :
                  (lead.lead_score ?? 0) >= 45 ? 'text-amber-600' :
                  'text-neutral-400',
                )}>
                  {lead.lead_score ?? 0}
                  <span className="text-sm font-normal text-neutral-300">/100</span>
                </span>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Company Size',   score: lead.score_detail.company_size_score  ?? 0, max: 25 },
                  { label: 'Hiring Urgency', score: lead.score_detail.hiring_urgency_score ?? 0, max: 25 },
                  { label: 'Ops Complexity', score: lead.score_detail.complexity_score     ?? 0, max: 25 },
                  { label: 'Digital Gap',    score: lead.score_detail.digital_score        ?? 0, max: 25 },
                ].map(item => <ScoreBar key={item.label} {...item} />)}
              </div>
              {lead.score_detail.scoring_rationale && (
                <p className="text-2xs text-neutral-400 italic mt-3 leading-relaxed">
                  {lead.score_detail.scoring_rationale}
                </p>
              )}
            </SectionCard>
          )}

          {/* Company details — unknown fields hidden, not shown as noise */}
          <SectionCard title="Company Details">
            <div>
              {lead.company_size && (
                <DetailRow label="Size" value={lead.company_size} />
              )}
              {lead.industry && (
                <DetailRow label="Industry" value={lead.industry} />
              )}
              {lead.location && (
                <DetailRow label="Location" value={lead.location} />
              )}
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
                  lead.scraped_at ? (
                    <span className={cn(
                      'flex items-center gap-1.5 justify-end',
                      leadAge >= 14 && isStale ? 'text-rose-600' :
                      isStale ? 'text-amber-600' : '',
                    )}>
                      {isStale && <Clock className="w-3 h-3 flex-shrink-0" />}
                      {formatDistanceToNow(new Date(lead.scraped_at), { addSuffix: true })}
                    </span>
                  ) : <span className="text-neutral-300">N/A</span>
                }
              />
            </div>
          </SectionCard>

          {/* Pipeline Stage — visual stepper, not a settings list */}
          <SectionCard title="Pipeline Stage">
            <PipelineStepper
              stages={STATUS_PIPELINE}
              current={lead.status}
              onSelect={(s) => statusMutation.mutate(s)}
              disabled={statusMutation.isPending}
            />
          </SectionCard>

          {/* Signal history */}
          {signals.length > 1 && (
            <SectionCard title="Signal History">
              <div className="space-y-2">
                {signals.slice(0, 5).map((sig, i) => (
                  <div key={sig.id} className={cn('flex items-start gap-2', i > 0 && 'pt-2 border-t border-neutral-100')}>
                    <div className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-ink capitalize">
                        {sig.signal_type?.replace(/_/g, ' ')}
                      </p>
                      <p className="text-2xs text-neutral-400">
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
