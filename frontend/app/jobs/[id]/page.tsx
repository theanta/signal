'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJob, analyzeJob, updateJobStatus, convertJobToLead } from '@/services/jobs';
import PageHeader from '@/components/ui/PageHeader';
import JobStatusBadge from '@/components/jobs/JobStatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  Briefcase, Building2, MapPin, ExternalLink, Check, CheckCircle2,
  AlertTriangle, XCircle, Clock, DollarSign, UserPlus, Archive,
  RotateCcw, ChevronDown, Ban, Users, ArrowUpRight,
  Brain, RefreshCw, Copy, FileText, ListChecks, Lightbulb, ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { JobStatus, JobVerdict, Job, JobSignal, SalaryParsed } from '../../../../shared/types';

const STATUS_PIPELINE: JobStatus[] = ['new', 'reviewed', 'applied', 'interviewing', 'placed'];

const SOURCE_LABELS: Record<Job['source'], string> = {
  indeed:   'Indeed',
  linkedin: 'LinkedIn',
  remoteok: 'RemoteOK',
  remotive: 'Remotive',
};

function getJobAge(job: Job): number | null {
  const basis = job.posted_at ?? (job.posted_at_raw ? null : job.created_at);
  if (!basis) return null;
  return Math.floor((Date.now() - new Date(basis).getTime()) / 86400000);
}

// RemoteOK (and occasionally other sources) ship HTML descriptions —
// flatten to readable plain text, preserving paragraph/list structure.
function descriptionToText(raw: string): string {
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;
  const withBreaks = raw
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? raw).replace(/\n{3,}/g, '\n\n').trim();
}

function CompanyAvatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-400 font-semibold text-lg flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-hairline last:border-0">
      <span className="text-xs text-muted font-medium flex-shrink-0">{label}</span>
      <span className="text-body-sm text-ink text-right">{value}</span>
    </div>
  );
}

const VERDICT_STYLES: Record<JobVerdict, { banner: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  apply:   { banner: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', icon: CheckCircle2,  label: 'Apply' },
  caution: { banner: 'bg-amber-500/10 border-amber-500/20 text-amber-400',       icon: AlertTriangle, label: 'Caution' },
  skip:    { banner: 'bg-rose-500/10 border-rose-500/20 text-rose-400',          icon: XCircle,       label: 'Skip' },
};

function VerdictBanner({ verdict, reasons }: { verdict: JobVerdict; reasons?: string[] }) {
  const { banner, icon: Icon, label } = VERDICT_STYLES[verdict];
  return (
    <div className={cn('flex items-start gap-3 px-4 py-3 rounded-lg border', banner)}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-body-sm font-semibold">
          {label}
          {verdict === 'apply' && <span className="font-normal"> — no blockers detected for agency applications</span>}
        </p>
        {reasons && reasons.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {reasons.map((r, i) => (
              <li key={i} className="text-body-sm opacity-90">· {r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PipelineStepper({ stages, current, onSelect, disabled }: {
  stages: JobStatus[];
  current: JobStatus;
  onSelect: (s: JobStatus) => void;
  disabled: boolean;
}) {
  const currentIndex = stages.indexOf(current);
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto">
      {stages.map((stage, i) => {
        const isPast = currentIndex >= 0 && i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={stage} className="flex items-center flex-1 min-w-[92px]">
            <button
              onClick={() => !isCurrent && onSelect(stage)}
              disabled={disabled}
              className={cn(
                'group flex flex-col items-center gap-1.5 flex-1 px-2 py-2 rounded-lg transition-all disabled:opacity-50',
                isCurrent ? 'bg-brand/5 cursor-default' : 'hover:bg-surface-strong',
              )}
            >
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-3xs font-bold transition-all',
                isPast ? 'bg-emerald-500/10 text-emerald-400' :
                isCurrent ? 'bg-brand text-[#04130b] shadow-[0_0_10px_rgba(50,213,131,0.4)]' :
                'bg-surface-strong text-muted',
              )}>
                {isPast ? <Check className="w-3.5 h-3.5" /> : <span>{i + 1}</span>}
              </div>
              <span className={cn(
                'text-2xs capitalize text-center leading-tight',
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
            {i < stages.length - 1 && (
              <div className={cn(
                'h-px flex-1 min-w-[8px] -mx-1',
                currentIndex >= 0 && i < currentIndex ? 'bg-emerald-500/30' : 'bg-hairline',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DescriptionCard({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = descriptionToText(description);
  const isLong = text.length > 1200;

  return (
    <div className="bg-canvas border border-hairline rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="w-4 h-4 text-muted" />
        <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider">Job Description</h3>
      </div>
      <div className="relative">
        <pre className={cn(
          'text-body-sm text-body whitespace-pre-wrap font-sans leading-relaxed overflow-hidden',
          isLong && !expanded && 'max-h-[420px]',
        )}>
          {text}
        </pre>
        {isLong && !expanded && (
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-canvas to-transparent pointer-events-none" />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 mt-2 text-xs font-medium text-brand hover:text-brand/80 transition-colors"
        >
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : 'Show full description'}
        </button>
      )}
    </div>
  );
}

function formatSalary(parsed: SalaryParsed | undefined): string | null {
  if (!parsed) return null;
  if (parsed.normalized_annual_usd) {
    return `≈ $${Math.round(parsed.normalized_annual_usd / 1000)}k/yr`;
  }
  if (parsed.min || parsed.max) {
    const cur = parsed.currency ?? 'USD';
    const per = parsed.period ? `/${parsed.period === 'year' ? 'yr' : parsed.period === 'month' ? 'mo' : 'hr'}` : '';
    const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
    if (parsed.min && parsed.max) return `${cur} ${fmt(parsed.min)}–${fmt(parsed.max)}${per}`;
    return `${cur} ${fmt(parsed.min ?? parsed.max!)}${per}`;
  }
  return null;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }
  return { copied, copy };
}

function CopyIconButton({ onCopy, isCopied, title }: { onCopy: () => void; isCopied: boolean; title?: string }) {
  return (
    <button
      onClick={onCopy}
      title={title ?? 'Copy'}
      className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-ink transition-colors flex-shrink-0"
    >
      {isCopied
        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function ChipList({ items, tone }: { items: string[]; tone: 'emerald' | 'blue' | 'muted' | 'amber' }) {
  const toneCn = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
    muted:   'bg-surface-strong text-muted border-hairline',
    amber:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }[tone];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className={cn('inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border', toneCn)}>
          {item}
        </span>
      ))}
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-2xs rounded-full border bg-surface-strong border-hairline">
      <span className="text-muted font-medium uppercase tracking-wide text-3xs">{label}</span>
      <span className="text-ink font-medium capitalize">{value}</span>
    </span>
  );
}

function JobIntelligenceCard({ signal, onReanalyze, isAnalyzing }: {
  signal: JobSignal;
  onReanalyze: () => void;
  isAnalyzing: boolean;
}) {
  const { copied, copy } = useCopy();
  const salary = formatSalary(signal.salary_parsed);
  const warnings = [
    ...(signal.timezone_note ? [signal.timezone_note] : []),
    ...(signal.red_flags ?? []),
  ];

  return (
    <div className="bg-canvas border border-hairline rounded-lg overflow-hidden">
      <div className="h-0.5 bg-gradient-to-r from-brand/70 via-brand/20 to-transparent" />

      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-brand/60" />
          <h3 className="text-2xs font-semibold text-brand/70 uppercase tracking-wider">Job Intelligence</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-3xs text-muted">
            {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
          </span>
          <button
            onClick={onReanalyze}
            disabled={isAnalyzing}
            title="Re-analyze"
            className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-ink transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isAnalyzing && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {signal.seniority && signal.seniority !== 'unclear' && <MetaChip label="Level" value={signal.seniority} />}
          {signal.contract_type && signal.contract_type !== 'unclear' && <MetaChip label="Type" value={signal.contract_type} />}
          {signal.contract_duration && <MetaChip label="Duration" value={signal.contract_duration} />}
          {salary && <MetaChip label="Salary" value={salary} />}
        </div>

        {signal.summary && (
          <p className="text-body-sm text-body leading-relaxed">{signal.summary}</p>
        )}

        {(signal.must_have_skills?.length || signal.nice_to_have_skills?.length) ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider mb-2">Must Have</h4>
              {signal.must_have_skills?.length
                ? <ChipList items={signal.must_have_skills} tone="emerald" />
                : <p className="text-2xs text-muted/60">None stated</p>}
            </div>
            <div>
              <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider mb-2">Nice to Have</h4>
              {signal.nice_to_have_skills?.length
                ? <ChipList items={signal.nice_to_have_skills} tone="blue" />
                : <p className="text-2xs text-muted/60">None stated</p>}
            </div>
          </div>
        ) : null}

        {signal.ats_keywords && signal.ats_keywords.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider">
                ATS Keywords <span className="normal-case font-normal">(exact posting phrasing, ranked)</span>
              </h4>
              <CopyIconButton
                onCopy={() => copy(signal.ats_keywords!.join(', '), 'ats')}
                isCopied={copied === 'ats'}
                title="Copy all keywords"
              />
            </div>
            <ChipList items={signal.ats_keywords} tone="muted" />
          </div>
        )}

        {warnings.length > 0 && (
          <div className="border-t border-hairline pt-3 space-y-1.5">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-body leading-relaxed">{w}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResumePlaybookCard({ signal }: { signal: JobSignal }) {
  const { copied, copy } = useCopy();
  const [checkedKeywords, setCheckedKeywords] = useState<Set<number>>(new Set());
  const playbook = signal.resume_playbook;
  if (!playbook) return null;

  const toggleKeyword = (i: number) => {
    setCheckedKeywords(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <div className="bg-canvas border border-hairline rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline">
        <FileText className="w-4 h-4 text-muted" />
        <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider">Resume Playbook</h3>
        <span className="text-3xs text-muted/60 ml-1">applies to every profile submitted to this job</span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {playbook.headline && (
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface-strong border border-hairline">
            <div className="min-w-0">
              <p className="text-3xs font-semibold text-muted uppercase tracking-wide mb-0.5">Resume Headline</p>
              <p className="text-body-sm font-medium text-ink truncate">{playbook.headline}</p>
            </div>
            <CopyIconButton
              onCopy={() => copy(playbook.headline!, 'headline')}
              isCopied={copied === 'headline'}
            />
          </div>
        )}

        {(playbook.lead_with?.length || playbook.demote?.length) ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider mb-2">Lead With</h4>
              {playbook.lead_with?.length
                ? <ChipList items={playbook.lead_with} tone="emerald" />
                : <p className="text-2xs text-muted/60">—</p>}
            </div>
            <div>
              <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider mb-2">Demote / Drop</h4>
              {playbook.demote?.length
                ? <ChipList items={playbook.demote} tone="muted" />
                : <p className="text-2xs text-muted/60">—</p>}
            </div>
          </div>
        ) : null}

        {playbook.keyword_checklist && playbook.keyword_checklist.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5 text-muted" />
                <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider">Keyword Checklist</h4>
                <span className="text-3xs text-muted/60">
                  {checkedKeywords.size}/{playbook.keyword_checklist.length}
                </span>
              </div>
              <CopyIconButton
                onCopy={() => copy(playbook.keyword_checklist!.join(', '), 'checklist')}
                isCopied={copied === 'checklist'}
                title="Copy all"
              />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {playbook.keyword_checklist.map((kw, i) => (
                <button
                  key={i}
                  onClick={() => toggleKeyword(i)}
                  className="flex items-center gap-2 py-1 text-left group"
                >
                  <span className={cn(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                    checkedKeywords.has(i)
                      ? 'bg-brand border-brand text-[#04130b]'
                      : 'border-border-strong group-hover:border-brand/50',
                  )}>
                    {checkedKeywords.has(i) && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className={cn(
                    'text-xs transition-colors',
                    checkedKeywords.has(i) ? 'text-muted line-through' : 'text-body',
                  )}>
                    {kw}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {playbook.framing_tips && playbook.framing_tips.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Lightbulb className="w-3.5 h-3.5 text-muted" />
              <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider">Framing Tips</h4>
            </div>
            <ul className="space-y-1.5">
              {playbook.framing_tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-body leading-relaxed">
                  <span className="w-1 h-1 rounded-full bg-brand mt-1.5 flex-shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {playbook.sample_bullets && playbook.sample_bullets.length > 0 && (
          <div>
            <h4 className="text-3xs font-semibold text-muted uppercase tracking-wider mb-2">Sample Bullet Patterns</h4>
            <div className="space-y-1.5">
              {playbook.sample_bullets.map((bullet, i) => (
                <div key={i} className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg bg-surface-strong/60 border border-hairline">
                  <p className="text-xs text-body leading-relaxed">{bullet}</p>
                  <CopyIconButton
                    onCopy={() => copy(bullet, `bullet-${i}`)}
                    isCopied={copied === `bullet-${i}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {playbook.screening_risks && playbook.screening_risks.length > 0 && (
          <div className="border-t border-hairline pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <h4 className="text-3xs font-semibold text-amber-400 uppercase tracking-wider">Screening Risks</h4>
              <span className="text-3xs text-muted/60">claims must survive a live screen</span>
            </div>
            <ul className="space-y-1.5">
              {playbook.screening_risks.map((risk, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-body leading-relaxed">
                  <span className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                  {risk}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: job, isLoading } = useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id),
  });

  const statusMutation = useMutation({
    mutationFn: (status: JobStatus) => updateJobStatus(id, status),
    onSuccess: () => {
      toast.success('Status updated');
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => toast.error('Failed to update status'),
  });

  const convertMutation = useMutation({
    mutationFn: () => convertJobToLead(id),
    onSuccess: () => {
      toast.success('Converted to a lead');
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => toast.error('Failed to convert job to a lead'),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeJob(id),
    onMutate: () => toast.loading('Decoding job posting…') as unknown as string | number,
    onSuccess: (_data, _vars, ctx) => {
      toast.resolve(ctx as string | number, 'success', 'Analysis complete');
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (_err, _vars, ctx) => {
      toast.resolve(ctx as string | number, 'error', 'Analysis failed');
    },
  });

  if (isLoading) return <DetailSkeleton />;
  if (!job) return (
    <div className="flex flex-col items-center justify-center h-screen gap-3 text-muted">
      <Briefcase className="w-10 h-10" />
      <p className="text-sm">Job not found</p>
    </div>
  );

  const title = job.job_title ?? 'Untitled role';
  const latestSignal = job.signals?.[0];
  const jobAge = getJobAge(job);
  const isOffPipeline = !STATUS_PIPELINE.includes(job.status);
  const related = job.related;
  const companySubmissionCount = related?.company_submissions.length ?? 0;
  const postedLabel = job.posted_at
    ? formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })
    : job.posted_at_raw ?? formatDistanceToNow(new Date(job.created_at), { addSuffix: true });

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: 'Jobs', href: '/jobs' },
          { label: `${job.company_name} — ${title}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {job.source_url && (
              <a
                href={job.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Posting
              </a>
            )}
            {job.status === 'converted' && job.converted_lead_id ? (
              <Link
                href={`/leads/${job.converted_lead_id}`}
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-brand/20 rounded-lg hover:bg-surface-strong transition-colors text-brand"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                View Lead
              </Link>
            ) : (
              <button
                onClick={() => convertMutation.mutate()}
                disabled={convertMutation.isPending}
                className="flex items-center gap-1.5 h-8 px-3 text-body-sm font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted disabled:opacity-50"
                title="Create an agency-prospect lead from this posting"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Convert to Lead
              </button>
            )}
          </div>
        }
      />

      {/* Application pipeline */}
      <div className="px-6 pt-4">
        <div className="bg-canvas border border-hairline rounded-lg px-4 py-3">
          {isOffPipeline ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                  Pipeline
                </h3>
                <JobStatusBadge status={job.status} />
                <span className="text-body-sm text-muted">
                  {job.status === 'converted'
                    ? 'This posting was converted to a lead.'
                    : 'This posting is out of the application pipeline.'}
                </span>
              </div>
              {job.status !== 'converted' && (
                <button
                  onClick={() => statusMutation.mutate('reviewed')}
                  disabled={statusMutation.isPending}
                  className="flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium border border-hairline rounded-lg hover:bg-surface-strong transition-colors text-muted disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reopen
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                Pipeline
              </h3>
              <div className="flex-1 min-w-0">
                <PipelineStepper
                  stages={STATUS_PIPELINE}
                  current={job.status}
                  onSelect={s => statusMutation.mutate(s)}
                  disabled={statusMutation.isPending}
                />
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => statusMutation.mutate('rejected')}
                  disabled={statusMutation.isPending}
                  title="Mark rejected"
                  className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-rose-400 transition-colors disabled:opacity-50"
                >
                  <Ban className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => statusMutation.mutate('archived')}
                  disabled={statusMutation.isPending}
                  title="Archive"
                  className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-ink transition-colors disabled:opacity-50"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-4 grid grid-cols-3 gap-5 items-start">

        {/* LEFT COLUMN */}
        <div className="col-span-2 space-y-3">

          {/* Triage verdict — populated by the ingest qualifier */}
          {job.verdict && <VerdictBanner verdict={job.verdict} reasons={job.verdict_reasons} />}

          {/* Header card */}
          <div className="bg-canvas border border-hairline rounded-lg p-4">
            <div className="flex items-start gap-4">
              <CompanyAvatar name={job.company_name} />
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold text-ink leading-tight">{title}</h1>
                <div className="flex items-center gap-2 mt-1 text-body-sm text-muted flex-wrap">
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    {job.company_name}
                  </span>
                  {job.location && (
                    <>
                      <span className="text-muted/30">·</span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {job.location}
                      </span>
                    </>
                  )}
                  <span className="text-muted/30">·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {postedLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <JobStatusBadge status={job.status} />
                  {job.employment_type && (
                    <span className="inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border bg-surface-strong text-body border-hairline capitalize">
                      {job.employment_type}
                    </span>
                  )}
                  {job.salary_text && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-medium rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      <DollarSign className="w-3 h-3" />
                      {job.salary_text}
                    </span>
                  )}
                </div>
                {job.technologies && job.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-hairline">
                    {job.technologies.map((tech, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/20">
                        {tech}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Freshness — applicant volume compounds fast on remote postings */}
          {jobAge !== null && jobAge >= 10 && !['placed', 'rejected', 'archived', 'converted'].includes(job.status) && (
            <div className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-lg border text-body-sm',
              jobAge >= 21
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400',
            )}>
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>
                Posted <strong>{jobAge} days ago</strong> — applicant volume is likely heavy by now.{' '}
                {jobAge >= 21
                  ? 'Direct outreach to the hiring team beats the apply button at this age.'
                  : 'Prioritize this one or pair the application with direct outreach.'}
              </span>
            </div>
          )}

          {/* Job Intelligence + Resume Playbook */}
          {latestSignal ? (
            <>
              <JobIntelligenceCard
                signal={latestSignal}
                onReanalyze={() => analyzeMutation.mutate()}
                isAnalyzing={analyzeMutation.isPending}
              />
              <ResumePlaybookCard signal={latestSignal} />
            </>
          ) : (
            <div className="bg-canvas border border-hairline rounded-lg p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-surface-strong flex items-center justify-center mx-auto mb-3">
                <Brain className={cn('w-6 h-6', analyzeMutation.isPending ? 'text-brand/40' : 'text-muted/50')} />
              </div>
              <p className="text-body-sm text-muted mb-1">This posting hasn&apos;t been decoded yet.</p>
              <p className="text-xs text-muted/60 mb-4">
                Extracts must-have skills, ATS keywords, salary, red flags, and a resume-tailoring playbook in one pass.
              </p>
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="inline-flex items-center gap-2 h-9 px-5 text-body-sm font-semibold bg-brand text-[#04130b] rounded-lg hover:bg-[#4be09a] hover:shadow-[0_0_16px_rgba(50,213,131,0.3)] transition-all mx-auto disabled:opacity-50"
              >
                {analyzeMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Brain className="w-3.5 h-3.5" />}
                {analyzeMutation.isPending ? 'Decoding…' : 'Decode with AI'}
              </button>
            </div>
          )}

          {/* Description */}
          {job.description ? (
            <DescriptionCard description={job.description} />
          ) : (
            <div className="bg-canvas border border-hairline rounded-lg p-6 text-center">
              <p className="text-body-sm text-muted">No description was captured for this posting.</p>
              {job.source_url && (
                <a
                  href={job.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-brand hover:text-brand/80"
                >
                  <ExternalLink className="w-3 h-3" />
                  Read it at the source
                </a>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — sticky sidebar */}
        <div className="sticky top-6">
          <div className="bg-canvas border border-hairline rounded-lg divide-y divide-hairline overflow-hidden">

            {/* Quick facts */}
            <div className="p-4">
              <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Posting</h3>
              {job.salary_text && <DetailRow label="Salary" value={job.salary_text} />}
              {job.employment_type && <DetailRow label="Type" value={<span className="capitalize">{job.employment_type}</span>} />}
              {job.location && <DetailRow label="Location" value={job.location} />}
              <DetailRow label="Source" value={SOURCE_LABELS[job.source] ?? job.source} />
              <DetailRow
                label="Posted"
                value={
                  <span className={cn(
                    'flex items-center gap-1.5 justify-end',
                    jobAge !== null && jobAge >= 21 ? 'text-rose-400' :
                    jobAge !== null && jobAge >= 10 ? 'text-amber-400' : '',
                  )}>
                    {jobAge !== null && jobAge >= 10 && <Clock className="w-3 h-3 flex-shrink-0" />}
                    {postedLabel}
                  </span>
                }
              />
              {job.scraped_at && (
                <DetailRow label="Discovered" value={formatDistanceToNow(new Date(job.scraped_at), { addSuffix: true })} />
              )}
            </div>

            {/* Red flags from triage */}
            {job.verdict && job.verdict !== 'apply' && job.verdict_reasons && job.verdict_reasons.length > 0 && (
              <div className="p-4">
                <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">Red Flags</h3>
                <div className="space-y-2">
                  {job.verdict_reasons.map((reason, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle className={cn(
                        'w-3.5 h-3.5 mt-0.5 flex-shrink-0',
                        job.verdict === 'skip' ? 'text-rose-400' : 'text-amber-400',
                      )} />
                      <p className="text-xs text-body leading-relaxed">{reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Same company — dedupe guard + cross-links */}
            {related && (related.company_jobs.length > 0 || related.lead_id || companySubmissionCount > 0) && (
              <div className="p-4">
                <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider mb-3">
                  Same Company
                </h3>

                {companySubmissionCount > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Users className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-400 leading-relaxed">
                      {companySubmissionCount} profile{companySubmissionCount > 1 ? 's' : ''} already submitted to{' '}
                      other {job.company_name} postings — check before submitting again.
                    </p>
                  </div>
                )}

                {related.lead_id && (
                  <Link
                    href={`/leads/${related.lead_id}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 mb-3 rounded-lg border border-brand/20 hover:bg-surface-strong transition-colors group"
                  >
                    <span className="text-xs text-brand font-medium">Already in your leads pipeline</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-brand group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                )}

                {related.company_jobs.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-3xs font-semibold text-muted uppercase tracking-wide">
                      Other postings ({related.company_jobs.length})
                    </p>
                    {related.company_jobs.map(other => (
                      <Link
                        key={other.id}
                        href={`/jobs/${other.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 border-b border-hairline last:border-0 group"
                      >
                        <span className="text-xs text-body group-hover:text-ink transition-colors truncate">
                          {other.job_title ?? 'Untitled role'}
                        </span>
                        <JobStatusBadge status={other.status} className="text-3xs px-2 flex-shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
