'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fetchConfig, saveConfig } from '@/services/config';
import PageHeader from '@/components/ui/PageHeader';
import {
  RefreshCw, CheckCircle, Settings, Zap, Brain,
  Building2, MessageSquare, MapPin, Users, ToggleLeft, ToggleRight, Save, X, Plus,
} from 'lucide-react';
import type { PlatformConfig } from '../../../shared/types';
import { clsx } from 'clsx';

const TABS = [
  { id: 'agency',   label: 'Agency Profile',  icon: Building2 },
  { id: 'voice',    label: 'Brand Voice',      icon: MessageSquare },
  { id: 'targeting',label: 'Targeting',        icon: MapPin },
  { id: 'icp',      label: 'ICP',              icon: Users },
  { id: 'sources',  label: 'Sources',          icon: Zap },
  { id: 'system',   label: 'System',           icon: Settings },
] as const;

type TabId = typeof TABS[number]['id'];

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const ALL_SOURCES = [
  { id: 'linkedin',       label: 'LinkedIn Jobs',    desc: 'Job postings filtered to your target locations — last 24 h' },
  { id: 'job_board',      label: 'Job Boards',       desc: 'Indeed — operational & tech hiring signals' },
  { id: 'crunchbase',     label: 'Crunchbase',       desc: 'Recently funded startups matching your target locations' },
  { id: 'local_business', label: 'Local Business',   desc: 'Google Maps — companies in your target locations & industries' },
];

// ---- small reusable input ----
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value, onChange, placeholder, className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={clsx(
        'w-full px-3 py-2 text-sm text-ink bg-canvas border border-hairline rounded-md',
        'focus:outline-none focus:border-info-border focus:ring-1 focus:ring-info-border',
        'placeholder:text-muted',
        className,
      )}
    />
  );
}

function TextArea({
  value, onChange, placeholder, rows = 3,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm text-ink bg-canvas border border-hairline rounded-md resize-none focus:outline-none focus:border-info-border focus:ring-1 focus:ring-info-border placeholder:text-muted"
    />
  );
}

// ---- tag-list editor (services / locations / industries) ----
function TagList({
  label, values, onChange, placeholder,
}: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');

  function add() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  }

  function remove(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="flex items-center gap-1 text-xs bg-surface-soft border border-hairline text-ink rounded px-2 py-1">
            {v}
            <button onClick={() => remove(i)} className="text-muted hover:text-sig-coral ml-0.5">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-muted italic">No items added</span>}
      </div>
      <div className="flex gap-2">
        <TextInput
          value={input}
          onChange={setInput}
          placeholder={placeholder}
          className="flex-1"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="btn-secondary gap-1 px-3 py-2 text-xs disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </Field>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('agency');
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [jobDone, setJobDone] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState<'saved' | 'error' | null>(null);
  const [draft, setDraft] = useState<PlatformConfig | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['platform-config'],
    queryFn: fetchConfig,
  });

  // Initialise draft once config loads
  useEffect(() => {
    if (config && !draft) setDraft({ ...config });
  }, [config, draft]);

  const mutation = useMutation({
    mutationFn: saveConfig,
    onSuccess: (saved) => {
      queryClient.setQueryData(['platform-config'], saved);
      setSaveToast('saved');
      setTimeout(() => setSaveToast(null), 3000);
    },
    onError: () => {
      setSaveToast('error');
      setTimeout(() => setSaveToast(null), 3000);
    },
  });

  function patch(updates: Partial<PlatformConfig>) {
    setDraft(prev => prev ? { ...prev, ...updates } : updates as PlatformConfig);
  }

  function toggleSource(id: string) {
    if (!draft) return;
    const active = draft.active_sources.includes(id)
      ? draft.active_sources.filter(s => s !== id)
      : [...draft.active_sources, id];
    patch({ active_sources: active });
  }

  function toggleSize(size: string) {
    if (!draft) return;
    const sizes = draft.target_company_sizes.includes(size)
      ? draft.target_company_sizes.filter(s => s !== size)
      : [...draft.target_company_sizes, size];
    patch({ target_company_sizes: sizes });
  }

  async function triggerJob(job: string) {
    setRunningJob(job);
    setJobDone(null);
    try {
      await api.post(`/cron/run/${job}`);
      setJobDone(job);
      setTimeout(() => setJobDone(null), 3000);
    } finally {
      setRunningJob(null);
    }
  }

  const isDirty = draft && config && JSON.stringify(draft) !== JSON.stringify(config);

  if (isLoading || !draft) {
    return (
      <div className="min-h-screen">
        <PageHeader title="Settings" subtitle="Configure your platform" />
        <div className="p-8 flex items-center justify-center h-64">
          <RefreshCw className="w-5 h-5 animate-spin text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Settings"
        subtitle="Customize your agency identity, targeting, and automation"
        actions={
          isDirty ? (
            <button
              onClick={() => mutation.mutate(draft)}
              disabled={mutation.isPending}
              className="btn-primary gap-2"
            >
              {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          ) : saveToast === 'saved' ? (
            <div className="flex items-center gap-2 text-success text-sm">
              <CheckCircle className="w-4 h-4" /> Saved
            </div>
          ) : null
        }
      />

      {saveToast === 'error' && (
        <div className="mx-8 mb-0 mt-[-8px] p-3 bg-[#fcede8] border border-[#f5c9b8] rounded-md text-sm text-sig-coral">
          Failed to save — check the backend is running.
        </div>
      )}

      <div className="flex min-h-[calc(100vh-120px)]">
        {/* Tab rail */}
        <nav className="w-48 flex-shrink-0 border-r border-hairline pt-6 pb-8 px-3 space-y-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left transition-colors',
                activeTab === id
                  ? 'bg-surface-strong text-ink font-medium'
                  : 'text-muted hover:text-ink hover:bg-surface-soft',
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <main className="flex-1 p-8 max-w-2xl space-y-6">

          {/* ── AGENCY PROFILE ── */}
          {activeTab === 'agency' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5">Agency Profile</h2>
                <p className="text-xs text-muted">Used in all AI-generated outreach and opportunity analysis.</p>
              </div>
              <div className="card p-5 space-y-4">
                <Field label="Agency Name">
                  <TextInput
                    value={draft.agency_name}
                    onChange={v => patch({ agency_name: v })}
                    placeholder="ANTA"
                  />
                </Field>
                <Field label="Location">
                  <TextInput
                    value={draft.agency_location}
                    onChange={v => patch({ agency_location: v })}
                    placeholder="Detroit, Michigan"
                  />
                </Field>
                <Field label="Website">
                  <TextInput
                    value={draft.agency_website}
                    onChange={v => patch({ agency_website: v })}
                    placeholder="https://yoursite.com"
                  />
                </Field>
                <Field label="Tagline">
                  <TextInput
                    value={draft.agency_tagline}
                    onChange={v => patch({ agency_tagline: v })}
                    placeholder="What you do in one sentence"
                  />
                </Field>
                <TagList
                  label="Services"
                  values={draft.services}
                  onChange={v => patch({ services: v })}
                  placeholder="e.g. React/Next.js SaaS development"
                />
              </div>
            </section>
          )}

          {/* ── BRAND VOICE ── */}
          {activeTab === 'voice' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5">Brand Voice</h2>
                <p className="text-xs text-muted">Controls tone, CTA style, and sign-off in all generated outreach.</p>
              </div>
              <div className="card p-5 space-y-4">
                <Field label="Outreach Tone">
                  <TextArea
                    value={draft.outreach_tone}
                    onChange={v => patch({ outreach_tone: v })}
                    placeholder="e.g. intelligent, consultative, NOT salesy, operationally focused"
                    rows={2}
                  />
                </Field>
                <Field label="CTA Style">
                  <TextInput
                    value={draft.cta_style}
                    onChange={v => patch({ cta_style: v })}
                    placeholder="e.g. 15-min call"
                  />
                  <p className="text-xs text-muted mt-1">Phrase that appears in the low-friction call to action.</p>
                </Field>
                <Field label="Sign-off Name">
                  <TextInput
                    value={draft.sign_off}
                    onChange={v => patch({ sign_off: v })}
                    placeholder="e.g. ANTA Team"
                  />
                  <p className="text-xs text-muted mt-1">How emails are signed off.</p>
                </Field>
              </div>

              <div className="card p-4 bg-surface-soft border-hairline">
                <p className="text-xs text-muted font-medium uppercase tracking-wide mb-2">Preview</p>
                <p className="text-xs text-body leading-relaxed">
                  Tone: <span className="text-ink">{draft.outreach_tone || '—'}</span><br />
                  CTA: <span className="text-ink">Book a {draft.cta_style || '—'}</span><br />
                  Sign-off: <span className="text-ink">{draft.sign_off || '—'}</span> · {draft.agency_location}
                </p>
              </div>
            </section>
          )}

          {/* ── TARGETING ── */}
          {activeTab === 'targeting' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5">Target Geography</h2>
                <p className="text-xs text-muted">Locations fed to scrapers and used to boost lead scores. Add cities, states, or abbreviations.</p>
              </div>
              <div className="card p-5 space-y-4">
                <TagList
                  label="Target Locations"
                  values={draft.target_locations}
                  onChange={v => patch({ target_locations: v })}
                  placeholder="e.g. Chicago, Illinois, IL"
                />
                <div className="pt-1 border-t border-hairline">
                  <p className="text-xs text-muted">
                    Leads matching any of these locations get a +5 score bonus and higher confidence signal.
                    Scrapers use the first two locations as their primary search geography.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ── ICP ── */}
          {activeTab === 'icp' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5">Ideal Customer Profile</h2>
                <p className="text-xs text-muted">Shapes scoring weights and analysis framing.</p>
              </div>
              <div className="card p-5 space-y-5">
                <Field label="Target Company Sizes">
                  <p className="text-xs text-muted mb-2">Selected sizes score higher. Deselect to penalise.</p>
                  <div className="flex flex-wrap gap-2">
                    {COMPANY_SIZES.map(size => {
                      const on = draft.target_company_sizes.includes(size);
                      return (
                        <button
                          key={size}
                          onClick={() => toggleSize(size)}
                          className={clsx(
                            'px-3 py-1.5 text-xs rounded-md border font-medium transition-colors',
                            on
                              ? 'bg-ink text-canvas border-ink'
                              : 'bg-canvas text-muted border-hairline hover:border-border-strong hover:text-ink',
                          )}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <TagList
                  label="Target Industries (optional)"
                  values={draft.target_industries}
                  onChange={v => patch({ target_industries: v })}
                  placeholder="e.g. Logistics, Healthcare, Manufacturing"
                />
                <p className="text-xs text-muted -mt-2">
                  Leave empty to target all industries. When set, leads outside these industries will score lower.
                </p>
              </div>
            </section>
          )}

          {/* ── SOURCES ── */}
          {activeTab === 'sources' && (
            <section className="space-y-5">
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5">Data Sources</h2>
                <p className="text-xs text-muted">Toggle which scrapers run during each scrape job.</p>
              </div>
              <div className="card divide-y divide-hairline">
                {ALL_SOURCES.map(({ id, label, desc }) => {
                  const on = draft.active_sources.includes(id);
                  return (
                    <div key={id} className="flex items-center justify-between px-5 py-4">
                      <div>
                        <p className="text-sm font-medium text-ink">{label}</p>
                        <p className="text-xs text-muted mt-0.5">{desc}</p>
                      </div>
                      <button
                        onClick={() => toggleSource(id)}
                        className={clsx(
                          'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                          on
                            ? 'bg-[#e8f5ec] text-success border-[#b3dcbe]'
                            : 'bg-surface-soft text-muted border-hairline',
                        )}
                      >
                        {on
                          ? <><ToggleRight className="w-4 h-4" /> Active</>
                          : <><ToggleLeft className="w-4 h-4" /> Disabled</>
                        }
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted px-1">
                {draft.active_sources.length} of {ALL_SOURCES.length} sources active.
                Changes take effect on the next scrape run.
              </p>
            </section>
          )}

          {/* ── SYSTEM ── */}
          {activeTab === 'system' && (
            <section className="space-y-5">
              {/* Manual triggers */}
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5">Manual Job Triggers</h2>
                <p className="text-xs text-muted">Run pipeline steps on demand.</p>
              </div>
              <div className="card p-5 space-y-2">
                {[
                  { job: 'scrape',    label: 'Run Daily Scrape',       desc: 'Scrape LinkedIn and job boards now' },
                  { job: 'biweekly', label: 'Run Bi-weekly Scrape',   desc: 'Scrape Crunchbase and local business sources now' },
                  { job: 'analyze',  label: 'Analyze New Leads',      desc: 'Run signal detection on unanalyzed leads (batch of 20)' },
                  { job: 'outreach', label: 'Generate Outreach',      desc: 'Generate cold emails for top-scored analyzed leads' },
                ].map(({ job, label, desc }) => (
                  <div key={job} className="flex items-center justify-between p-4 bg-surface-soft rounded-md">
                    <div>
                      <p className="text-sm font-medium text-ink">{label}</p>
                      <p className="text-xs text-muted mt-0.5">{desc}</p>
                    </div>
                    <button
                      onClick={() => triggerJob(job)}
                      disabled={runningJob !== null}
                      className="btn-secondary gap-2 ml-4 flex-shrink-0"
                    >
                      {runningJob === job ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : jobDone === job ? <CheckCircle className="w-4 h-4 text-success" />
                        : <RefreshCw className="w-4 h-4" />}
                      {runningJob === job ? 'Running...' : jobDone === job ? 'Triggered!' : 'Run Now'}
                    </button>
                  </div>
                ))}
              </div>

              {/* Automation schedule */}
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5 mt-2">Automation Schedule</h2>
                <p className="text-xs text-muted">Configured via environment variables.</p>
              </div>
              <div className="card p-5">
                <div className="space-y-0">
                  {[
                    { label: 'Daily Scrape',        schedule: '6:00 AM EST', env: 'CRON_DAILY_SCRAPE' },
                    { label: 'Lead Analysis',       schedule: '7:00 AM EST', env: 'CRON_ANALYZE_LEADS' },
                    { label: 'Outreach Generation', schedule: '8:00 AM EST', env: 'CRON_GENERATE_OUTREACH' },
                  ].map(({ label, schedule, env }) => (
                    <div key={label} className="flex items-center justify-between py-2.5 border-b border-hairline last:border-0">
                      <div>
                        <p className="text-sm text-ink">{label}</p>
                        <p className="text-xs text-muted font-mono">{env}</p>
                      </div>
                      <span className="text-sm text-info font-mono">{schedule}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Integration status */}
              <div>
                <h2 className="text-sm font-medium text-ink mb-0.5 mt-2">Integration Status</h2>
              </div>
              <div className="card p-5 space-y-0">
                {[
                  { label: 'Supabase Database',    key: 'SUPABASE_URL' },
                  { label: 'AI Model (Groq)',       key: 'GROQ_API_KEY' },
                  { label: 'Signal Engine',         key: 'SIGNAL_ENGINE_URL' },
                ].map(({ label, key }) => (
                  <div key={key} className="flex items-center justify-between py-2.5 border-b border-hairline last:border-0">
                    <div>
                      <p className="text-sm text-ink">{label}</p>
                      <p className="text-xs text-muted font-mono">{key}</p>
                    </div>
                    <span className="text-xs text-muted">Check .env</span>
                  </div>
                ))}
              </div>

              {/* About */}
              <div className="card p-5 space-y-1.5 text-sm text-body">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-muted" />
                  <span className="text-sm font-medium text-ink">About</span>
                </div>
                <p><span className="text-ink font-medium">Platform:</span> Lead Radar v1.0.0</p>
                <p><span className="text-ink font-medium">AI Model:</span> Groq / llama-3.3-70b-versatile</p>
                <p><span className="text-ink font-medium">Agency:</span> {draft.agency_name} · {draft.agency_location}</p>
                <p><span className="text-ink font-medium">Stack:</span> Next.js 14 · Node.js · Python FastAPI · Supabase</p>
              </div>
            </section>
          )}

          {/* Floating save bar when dirty */}
          {isDirty && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-ink text-canvas text-sm px-5 py-3 rounded-xl shadow-lg z-50">
              <span className="text-canvas/70">You have unsaved changes</span>
              <button
                onClick={() => setDraft({ ...config! })}
                className="text-canvas/60 hover:text-canvas text-xs underline"
              >
                Discard
              </button>
              <button
                onClick={() => mutation.mutate(draft)}
                disabled={mutation.isPending}
                className="bg-canvas text-ink text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 disabled:opacity-50"
              >
                {mutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
