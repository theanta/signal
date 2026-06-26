'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLead, generateOutreach, updateLeadStatus } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  Brain, Copy, Check, CheckCircle, ExternalLink, Link2,
  Zap, Target, MessageSquare, RefreshCw, Monitor, User,
  Building2, MapPin, TrendingUp, ShieldCheck, ShieldAlert, ShieldQuestion,
  Clock, ChevronDown, Clipboard, Mail,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { tokenStore } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import type { LeadStatus, OutreachMessage, LeadWithSignals, LeadSignal } from '../../../../shared/types';

const STATUS_PIPELINE: LeadStatus[] = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'];

function getLeadAge(scrapedAt: string | null | undefined): number {
  if (!scrapedAt) return 0;
  return Math.floor((Date.now() - new Date(scrapedAt).getTime()) / 86400000);
}

function CompanyAvatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-400 font-semibold text-lg flex items-center justify-center flex-shrink-0">
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
    <div className={cn('bg-canvas border border-hairline rounded-lg p-4', className)}>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {Icon && <Icon className="w-4 h-4 text-muted" />}
          <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-hairline last:border-0">
      <span className="text-xs text-muted font-medium flex-shrink-0">{label}</span>
      <span className="text-body-sm text-ink text-right capitalize">{value}</span>
    </div>
  );
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round(((score ?? 0) / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-2xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-ink">
          {score ?? 0}<span className="text-muted/50">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 bg-surface-strong rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500',
            pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-400' : 'bg-muted'
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
              'w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-all text-left disabled:opacity-50',
              isCurrent ? 'bg-brand/5 cursor-default' : 'hover:bg-surface-strong',
            )}
          >
            <div className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-3xs font-bold transition-all',
              isPast ? 'bg-emerald-500/10 text-emerald-400' :
              isCurrent ? 'bg-brand text-white' :
              'bg-surface-strong text-muted',
            )}>
              {isPast ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
            </div>
            <span className={cn(
              'text-body-sm capitalize flex-1',
              isCurrent ? 'font-semibold text-ink' :
              isPast ? 'text-muted' :
              'text-body',
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
    <div className="px-6 py-4 grid grid-cols-3 gap-5 animate-fade-in">
      <div className="col-span-2 space-y-3">
        <div className="bg-canvas border border-hairline rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-xl" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="flex gap-2 pt-3 border-t border-hairline">
            <Skeleton className="h-8 w-36 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
        <div className="bg-canvas border border-hairline rounded-lg p-4 space-y-3">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </div>
      <div className="bg-canvas border border-hairline rounded-lg divide-y divide-hairline overflow-hidden">
        <div className="p-4 space-y-3">
          <Skeleton className="h-3 w-28 mb-3" />
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      </div>
    </div>
  );
}

function useAnalysisStream(id: string) {
  const [phase, setPhase] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  const start = useCallback(() => {
    if (isStreaming) return;
    setIsStreaming(true);
    setPhase('Starting analysis…');

    const abort = new AbortController();
    abortRef.current = abort;
    const token = tokenStore.getToken();

    fetch(`/api/leads/${id}/analyze/stream`, {
      signal: abort.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(response => {
        if (!response.ok || !response.body) throw new Error('Stream failed');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              setIsStreaming(false);
              setPhase(null);
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const event of events) {
              for (const line of event.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const data = JSON.parse(line.slice(6)) as { phase: string; message?: string };
                  if (data.phase === 'complete') {
                    setIsStreaming(false);
                    setPhase(null);
                    qc.invalidateQueries({ queryKey: ['lead', id] });
                    toast.success('Analysis complete');
                    return;
                  }
                  if (data.phase === 'error') {
                    setIsStreaming(false);
                    setPhase(null);
                    toast.error('Analysis failed');
                    return;
                  }
                  if (data.message) setPhase(data.message);
                } catch { /* malformed event */ }
              }
            }
            return pump();
          });

        return pump();
      })
      .catch(err => {
        if ((err as Error).name !== 'AbortError') toast.error('Analysis failed');
        setIsStreaming(false);
        setPhase(null);
      });
  }, [id, isStreaming, qc]);

  return { phase, isStreaming, start };
}

function buildLeadContext(lead: LeadWithSignals, latestSignal: LeadSignal | undefined): string {
  const lines: string[] = [];
  lines.push(`# Lead Context: ${lead.company_name}`);
  lines.push('');
  lines.push('## Company');
  if (lead.industry)      lines.push(`- **Industry:** ${lead.industry}`);
  if (lead.location)      lines.push(`- **Location:** ${lead.location}`);
  if (lead.company_size)  lines.push(`- **Size:** ${lead.company_size}`);
  if (lead.website)       lines.push(`- **Website:** ${lead.website}`);
  if (lead.linkedin_url)  lines.push(`- **LinkedIn:** ${lead.linkedin_url}`);
  if (lead.description)   lines.push(`- **Description:** ${lead.description}`);
  if (lead.hiring_signal) lines.push(`- **Hiring Signal:** ${lead.hiring_signal}`);
  if (lead.job_title)     lines.push(`- **Currently Hiring For:** ${lead.job_title}`);

  if (latestSignal) {
    lines.push('');
    lines.push('## AI Analysis');
    if (latestSignal.recommended_anta_service) lines.push(`**Recommended Service:** ${latestSignal.recommended_anta_service}`);
    if (latestSignal.outreach_angle)           lines.push(`**Outreach Angle:** ${latestSignal.outreach_angle}`);
    if (latestSignal.operational_maturity)     lines.push(`**Digital Maturity:** ${latestSignal.operational_maturity}`);
    if (latestSignal.likely_pain_points?.length) {
      lines.push('');
      lines.push('### Pain Points');
      latestSignal.likely_pain_points.forEach(pt => lines.push(`- ${pt}`));
    }
    if (latestSignal.tech_stack?.length) {
      lines.push('');
      lines.push('### Tech Stack');
      lines.push(latestSignal.tech_stack.join(', '));
    }
    if (latestSignal.tech_gaps?.length) {
      lines.push('');
      lines.push('### Tech Gaps / Opportunities');
      latestSignal.tech_gaps.forEach(g => lines.push(`- ${g}`));
    }
    if (latestSignal.growth_indicators?.length) {
      lines.push('');
      lines.push('### Growth Signals');
      latestSignal.growth_indicators.forEach(g => lines.push(`- ${g}`));
    }
  }

  if (lead.lead_score !== undefined && lead.lead_score !== null) {
    lines.push('');
    lines.push(`## Lead Score: ${lead.lead_score}/100`);
    if (lead.score_detail?.scoring_rationale) lines.push(`*${lead.score_detail.scoring_rationale}*`);
  }

  if (lead.contact_name || lead.contact_email) {
    lines.push('');
    lines.push('## Point of Contact');
    if (lead.contact_name)  lines.push(`**Name:** ${lead.contact_name}`);
    if (lead.contact_title) lines.push(`**Title:** ${lead.contact_title}`);
    if (lead.contact_email) {
      const badge =
        lead.contact_email_confidence === 'verified'   ? ' (verified)' :
        lead.contact_email_confidence === 'catch_all'  ? ' (catch-all)' : '';
      lines.push(`**Email:** ${lead.contact_email}${badge}`);
    }
  }

  return lines.join('\n');
}

function emailPromptSuffix(lead: LeadWithSignals, latestSignal: LeadSignal | undefined): string {
  const contactLine = lead.contact_name
    ? `The lead context names **${lead.contact_name}**${lead.contact_title ? ` (${lead.contact_title})` : ''} as the point of contact. Confirm this is the right decision-maker for ops or tech. If not, identify a better fit from your research.`
    : `The lead context does not include a named contact. Identify the right person from your research — COO, Head of Operations, Founder, or VP of Technology, depending on company size.`;
  const websiteStep = lead.website
    ? `Visit **${lead.website}** and scan: (a) the About/Team page to confirm or find the right contact and their title; (b) the blog, news, or press section for recent updates, launches, or changes; (c) open job listings for hiring signals and operational gaps; (d) the product/service pages to understand their current tech posture.`
    : `Search for **${lead.company_name}** online and scan their public presence — team/leadership page, any news or blog posts, job listings, and product/service pages.`;
  const service = latestSignal?.recommended_anta_service;

  return `

---

**Research phase — complete this before writing anything:**

1. ${websiteStep}
2. **Contact:** ${contactLine}
3. **Find one anchor:** Extract a single specific, non-obvious observation from your research — a recent hire, a product update, a new location, a job post that reveals a gap, a blog post that signals a strategic shift. This becomes your opening line. It must prove you actually looked; "I noticed you're growing" does not qualify.

---

**Writing task — cold email, strictly under 150 words:**

Write to the identified contact at **${lead.company_name}**.

- **Opening line:** Lead with the specific observation from step 3. No "I hope this finds you well." No "I came across your company." No compliments.
- **Body (2–3 sentences):** Connect their situation to a concrete operational problem.${service ? ` Describe the outcome that **"${service}"** delivers — not the service name itself.` : ''} Be consultative, not promotional. One problem, one implication, nothing more.
- **CTA:** One sentence. Suggest a specific low-friction next step (e.g. "Worth a quick 15 min this week?"). Not "I'd love to learn more about your needs."
- **Tone rules:** Peer-to-peer, direct, intelligent. No buzzwords — ban: *synergy, leverage, streamline, transform, solutions, excited to share, reaching out because*. No feature lists. No mention of your company name in the opener.`;
}

function linkedinPromptSuffix(lead: LeadWithSignals): string {
  const contactLine = lead.contact_name
    ? `The lead context names **${lead.contact_name}**${lead.contact_title ? ` (${lead.contact_title})` : ''} — confirm this is the right decision-maker. If not, identify a better fit.`
    : `The lead context does not include a named contact. Identify the right person — COO, Head of Operations, Founder, or VP of Technology, depending on company size.`;
  const websiteStep = lead.website
    ? `Visit **${lead.website}** — specifically the About/Team or Leadership page — to identify or confirm the right contact. Also find one recent signal: a product update, new hire, funding news, or anything that shows what has changed recently at the company.`
    : `Search for **${lead.company_name}** online. Find the right contact from their team/leadership page, and one recent signal from their public presence.`;

  return `

---

**Research phase — complete this before writing anything:**

1. ${websiteStep}
2. **Contact:** ${contactLine}
3. **Find one anchor:** One specific, recent thing about this company you can reference that shows you actually paid attention — a launch, a hire, a strategic shift, a job posting that reveals a gap. Generic signals ("you're growing fast") do not count.

---

**Writing task — LinkedIn connection request, strictly under 300 characters:**

Write to the identified contact at **${lead.company_name}**.

- Reference the specific anchor from step 3 — it must be clear you looked at their company, not sent a template
- Sound like a curious peer, not a sales rep
- **Do not** mention your company name, your services, or what you sell
- **Do not** use: "I'd love to connect," "I came across your profile," "I wanted to reach out," or any variant
- The only goal is to earn the connection — save everything else for after they accept`;
}

function CopyContextDropdown({ lead, latestSignal }: {
  lead: LeadWithSignals;
  latestSignal: LeadSignal | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [copiedVariant, setCopiedVariant] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  async function handleCopy(variant: 'context' | 'email' | 'linkedin') {
    const base = buildLeadContext(lead, latestSignal);
    const text =
      variant === 'email'    ? base + emailPromptSuffix(lead, latestSignal) :
      variant === 'linkedin' ? base + linkedinPromptSuffix(lead) :
      base;
    await navigator.clipboard.writeText(text);
    setCopiedVariant(variant);
    setOpen(false);
    setTimeout(() => setCopiedVariant(null), 2500);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border rounded-lg transition-colors',
          copiedVariant
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-hairline hover:bg-surface-strong text-muted',
        )}
        title="Copy Lead Context"
      >
        {copiedVariant
          ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          : <Clipboard className="w-3.5 h-3.5" />}
        <span>{copiedVariant ? 'Copied!' : 'Copy Context'}</span>
        <ChevronDown className={cn('w-3 h-3 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-canvas border border-hairline rounded-lg shadow-lg overflow-hidden w-52">
          <button
            onClick={() => handleCopy('context')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body-sm text-ink hover:bg-surface-strong transition-colors text-left"
          >
            <Copy className="w-3.5 h-3.5 text-muted flex-shrink-0" />
            <div>
              <p className="font-medium leading-tight">Copy Context</p>
              <p className="text-2xs text-muted mt-0.5">Lead data only</p>
            </div>
          </button>
          <div className="border-t border-hairline" />
          <button
            onClick={() => handleCopy('email')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body-sm text-ink hover:bg-surface-strong transition-colors text-left"
          >
            <Mail className="w-3.5 h-3.5 text-muted flex-shrink-0" />
            <div>
              <p className="font-medium leading-tight">Copy + Email Prompt</p>
              <p className="text-2xs text-muted mt-0.5">Includes cold email task</p>
            </div>
          </button>
          <button
            onClick={() => handleCopy('linkedin')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-body-sm text-ink hover:bg-surface-strong transition-colors text-left"
          >
            <Link2 className="w-3.5 h-3.5 text-muted flex-shrink-0" />
            <div>
              <p className="font-medium leading-tight">Copy + LinkedIn Prompt</p>
              <p className="text-2xs text-muted mt-0.5">Includes connection message task</p>
            </div>
          </button>
        </div>
      )}
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

  const { phase: analysisPhase, isStreaming: isAnalyzing, start: startAnalysis } = useAnalysisStream(id);

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
    <div className="flex flex-col items-center justify-center h-screen gap-3 text-muted">
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
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted"
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
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted"
              >
                <Link2 className="w-3.5 h-3.5" />
                LinkedIn
              </a>
            )}
            <CopyContextDropdown lead={lead} latestSignal={latestSignal} />
          </div>
        }
      />

      <div className="px-6 py-4 grid grid-cols-3 gap-5 items-start">

        {/* LEFT COLUMN */}
        <div className="col-span-2 space-y-3">

          {/* Header card */}
          <div className="bg-canvas border border-hairline rounded-lg p-4">
            <div className="flex items-start gap-4">
              <CompanyAvatar name={lead.company_name} />
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold text-ink leading-tight">{lead.company_name}</h1>
                <div className="flex items-center gap-2 mt-1 text-body-sm text-muted flex-wrap">
                  {lead.industry && (
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {lead.industry}
                    </span>
                  )}
                  {lead.industry && lead.location && (
                    <span className="text-muted/30">·</span>
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
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
                      <Zap className="w-3 h-3" />
                      {lead.hiring_signal}
                    </span>
                  )}
                </div>
                {lead.description && (
                  <p className="text-body-sm text-body mt-3 leading-relaxed border-t border-hairline pt-3">
                    {lead.description}
                  </p>
                )}
              </div>
            </div>

            {/* Action row */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-hairline">
              {isAnalyzing && analysisPhase && (
                <span className="text-xs text-muted italic truncate max-w-xs">{analysisPhase}</span>
              )}
              {latestSignal && (
                <button
                  onClick={startAnalysis}
                  disabled={isAnalyzing}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted hover:text-ink disabled:opacity-40 ml-auto"
                  title="Refresh analysis data"
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', isAnalyzing && 'animate-spin')} />
                  {isAnalyzing ? 'Analysing…' : 'Refresh'}
                </button>
              )}
            </div>
          </div>

          {/* Staleness banner — surfaces urgency before the user scrolls */}
          {isStale && (
            <div className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-lg border text-body-sm',
              leadAge >= 14
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400',
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
            <div className="bg-canvas border border-brand/20 rounded-lg p-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink mb-1">Ready to reach out?</p>
                  <p className="text-body-sm text-body mb-3 leading-relaxed">
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
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted disabled:opacity-50"
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
            <div className="bg-canvas border border-hairline rounded-lg p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-surface-strong flex items-center justify-center mx-auto mb-3">
                <Brain className={cn('w-6 h-6', isAnalyzing ? 'text-brand/40' : 'text-muted/50')} />
              </div>
              <p className="text-body-sm text-muted mb-1">This lead hasn&apos;t been analysed yet.</p>
              <p className="text-xs text-muted/60 mb-4">Finds tech stack, contacts, pain points and score in one pass.</p>
              {isAnalyzing && analysisPhase && (
                <p className="text-xs text-brand/60 italic mb-3">{analysisPhase}</p>
              )}
              <button
                onClick={startAnalysis}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 h-9 px-5 text-body-sm font-medium bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors mx-auto disabled:opacity-50"
              >
                {isAnalyzing
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Brain className="w-3.5 h-3.5" />}
                {isAnalyzing ? 'Analysing…' : 'Analyse with AI'}
              </button>
            </div>
          ) : isDisqualified ? (
            <div className="bg-canvas border border-hairline border-l-4 border-l-muted rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-surface-strong flex items-center justify-center flex-shrink-0">
                  <Target className="w-4 h-4 text-muted" />
                </div>
                <div>
                  <p className="text-body-sm font-medium text-ink">Lead Disqualified</p>
                  <p className="text-body-sm text-body mt-1 leading-relaxed">
                    {latestSignal.operational_maturity}
                  </p>
                  <p className="text-xs text-muted mt-2">
                    Falls outside ANTA&apos;s SMB target market. No outreach will be generated.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">

              {/* ANTA Recommendation — hero card, full width, visually primary */}
              <div className="bg-canvas border border-brand/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-brand/60" />
                  <h3 className="text-2xs font-semibold text-brand/70 uppercase tracking-wider">ANTA Recommendation</h3>
                </div>
                {latestSignal.recommended_anta_service && (
                  <p className="text-base font-semibold text-ink mb-2">
                    {latestSignal.recommended_anta_service}
                  </p>
                )}
                {latestSignal.outreach_angle && (
                  <p className="text-body-sm text-body leading-relaxed">
                    {latestSignal.outreach_angle}
                  </p>
                )}
                {latestSignal.operational_maturity && (
                  <div className="mt-3 pt-3 border-t border-hairline flex items-center gap-2">
                    <span className="text-2xs font-semibold text-muted uppercase tracking-wide">
                      Digital Maturity
                    </span>
                    <span className="text-xs text-body">{latestSignal.operational_maturity}</span>
                  </div>
                )}
              </div>

              {/* Pain Points — full width, secondary priority */}
              <SectionCard title="Pain Points" icon={Target}>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {(latestSignal.likely_pain_points ?? []).length > 0
                    ? latestSignal.likely_pain_points!.map((pt, i) => (
                      <li key={i} className="text-body-sm text-body flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 flex-shrink-0" />
                        {pt}
                      </li>
                    ))
                    : <li className="text-body-sm text-muted col-span-2">No pain points identified.</li>
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
                          <span key={i} className="inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20">
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
                          <li key={i} className="text-body-sm text-body flex items-start gap-2">
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
                      <span key={i} className="inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
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
                  <div className="w-9 h-9 rounded-full bg-surface-strong flex items-center justify-center text-body-sm font-medium text-muted">
                    {(lead.contact_name ?? '?')[0].toUpperCase()}
                  </div>
                  <div>
                    {lead.contact_name && (
                      <p className="text-body-sm font-medium text-ink">{lead.contact_name}</p>
                    )}
                    {lead.contact_title && (
                      <p className="text-xs text-muted">{lead.contact_title}</p>
                    )}
                    {lead.contact_email && (
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <a href={`mailto:${lead.contact_email}`}
                          className="text-xs text-brand hover:text-brand/80">
                          {lead.contact_email}
                        </a>
                        {lead.contact_email_confidence === 'verified' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-3xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            verified
                          </span>
                        )}
                        {lead.contact_email_confidence === 'catch_all' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-3xs font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <ShieldAlert className="w-2.5 h-2.5" />
                            catch-all
                          </span>
                        )}
                        {(lead.contact_email_confidence === 'pattern_inferred' || lead.contact_email_confidence === 'unknown') && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-3xs font-medium rounded-full bg-surface-strong text-muted border border-hairline">
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
                    className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-ink transition-colors"
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
                <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider">
                  Outreach Messages
                </h3>
                <span className="text-xs text-muted">{messages.length} generated</span>
              </div>
              {messages.map((msg: OutreachMessage) => (
                <div key={msg.id} className="bg-canvas border border-hairline rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border capitalize',
                        msg.channel === 'email'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
                      )}>
                        {msg.channel}
                      </span>
                      <span className="text-2xs text-muted">
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const text = msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
                        copyToClipboard(text, msg.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-ink transition-colors flex-shrink-0"
                      title="Copy message"
                    >
                      {copied === msg.id
                        ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                        : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  {msg.subject && (
                    <p className="text-body-sm font-medium text-ink mb-2 pb-2 border-b border-hairline">
                      {msg.subject}
                    </p>
                  )}
                  <pre className="text-body-sm text-body whitespace-pre-wrap font-sans leading-relaxed">
                    {msg.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — sticky sidebar */}
        <div className="sticky top-6">
          <div className="bg-canvas border border-hairline rounded-lg divide-y divide-hairline overflow-hidden">

            {/* Score breakdown */}
            {lead.score_detail && (
              <div className="p-4">
                <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Score Breakdown</h3>
                <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-hairline">
                  <div>
                    <span className="text-xs text-muted font-medium block">Lead Score</span>
                    {lead.score_detail.score_percentile !== undefined && (
                      <span className="text-2xs text-muted mt-0.5 block">
                        Top {100 - lead.score_detail.score_percentile}% of leads
                      </span>
                    )}
                  </div>
                  <span className={cn(
                    'text-[28px] font-bold leading-none',
                    (lead.lead_score ?? 0) >= 70 ? 'text-emerald-400' :
                    (lead.lead_score ?? 0) >= 45 ? 'text-amber-400' :
                    'text-muted',
                  )}>
                    {lead.lead_score ?? 0}
                    <span className="text-sm font-normal text-muted/50">/100</span>
                  </span>
                </div>
                <div className="space-y-2.5">
                  {[
                    { label: 'Company Size',   score: lead.score_detail.company_size_score  ?? 0, max: 25 },
                    { label: 'Hiring Urgency', score: lead.score_detail.hiring_urgency_score ?? 0, max: 25 },
                    { label: 'Ops Complexity', score: lead.score_detail.complexity_score     ?? 0, max: 25 },
                    { label: 'Digital Gap',    score: lead.score_detail.digital_score        ?? 0, max: 25 },
                  ].map(item => <ScoreBar key={item.label} {...item} />)}
                </div>
                {lead.score_detail.scoring_rationale && (
                  <p className="text-2xs text-muted italic mt-3 leading-relaxed">
                    {lead.score_detail.scoring_rationale}
                  </p>
                )}
              </div>
            )}

            {/* Company details */}
            <div className="p-4">
              <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Company</h3>
              {lead.company_size && <DetailRow label="Size" value={lead.company_size} />}
              {lead.industry && <DetailRow label="Industry" value={lead.industry} />}
              {lead.location && <DetailRow label="Location" value={lead.location} />}
              <DetailRow label="Source" value={lead.source?.replace('_', ' ') ?? 'Unknown'} />
              {lead.job_title && <DetailRow label="Hiring For" value={lead.job_title} />}
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
                  ) : <span className="text-muted/50">N/A</span>
                }
              />
            </div>

            {/* Pipeline Stage */}
            <div className="p-4">
              <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Pipeline Stage</h3>
              <PipelineStepper
                stages={STATUS_PIPELINE}
                current={lead.status}
                onSelect={(s) => statusMutation.mutate(s)}
                disabled={statusMutation.isPending}
              />
            </div>

            {/* Signal history */}
            {signals.length > 1 && (
              <div className="p-4">
                <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Signal History</h3>
                <div className="space-y-2">
                  {signals.slice(0, 5).map((sig, i) => (
                    <div key={sig.id} className={cn('flex items-start gap-2', i > 0 && 'pt-2 border-t border-hairline')}>
                      <div className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-ink capitalize">
                          {sig.signal_type?.replace(/_/g, ' ')}
                        </p>
                        <p className="text-2xs text-muted">
                          {sig.confidence_score
                            ? `${Math.round(sig.confidence_score * 100)}% confidence · `
                            : ''}
                          {formatDistanceToNow(new Date(sig.detected_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
