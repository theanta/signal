'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { createManualLead } from '@/services/leads';
import PageHeader from '@/components/ui/PageHeader';
import type { Lead } from '../../../../shared/types';

const INDUSTRIES = [
  'Manufacturing', 'Logistics & Transportation', 'Healthcare', 'Construction',
  'Retail', 'Finance & Insurance', 'Technology', 'Professional Services',
  'Real Estate', 'Food & Beverage', 'Education', 'Other',
];

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'];

const SOURCES = [
  { value: 'manual', label: 'Manual entry' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'detroit_business', label: 'Detroit Business' },
  { value: 'job_board', label: 'Job Board' },
  { value: 'wellfound', label: 'Wellfound' },
  { value: 'product_hunt', label: 'Product Hunt' },
  { value: 'other', label: 'Other' },
] as const;

export default function NewLeadPage() {
  const router = useRouter();
  const [form, setForm] = useState<Partial<Lead>>({ source: 'manual' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () => createManualLead(form),
    onSuccess: (lead) => router.push(`/leads/${lead.id}`),
  });

  function set(field: keyof Lead, value: string) {
    setForm(prev => ({ ...prev, [field]: value || undefined }));
    setErrors(prev => { const e = { ...prev }; delete e[field]; return e; });
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!form.company_name?.trim()) e.company_name = 'Company name is required';
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    mutation.mutate();
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Add Lead"
        subtitle="Manually add a company to your pipeline"
      />

      <div className="p-8 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Company</h2>

            <div>
              <label className="block text-xs text-muted mb-1">Company Name *</label>
              <input
                className="input w-full"
                placeholder="Acme Manufacturing Co."
                value={form.company_name ?? ''}
                onChange={e => set('company_name', e.target.value)}
              />
              {errors.company_name && <p className="text-xs text-sig-coral mt-1">{errors.company_name}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1">Website</label>
                <input
                  className="input w-full"
                  placeholder="https://example.com"
                  value={form.website ?? ''}
                  onChange={e => set('website', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">LinkedIn URL</label>
                <input
                  className="input w-full"
                  placeholder="https://linkedin.com/company/..."
                  value={form.linkedin_url ?? ''}
                  onChange={e => set('linkedin_url', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1">Location</label>
                <input
                  className="input w-full"
                  placeholder="Detroit, MI"
                  value={form.location ?? ''}
                  onChange={e => set('location', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Company Size</label>
                <select className="input w-full" value={form.company_size ?? ''} onChange={e => set('company_size', e.target.value)}>
                  <option value="">Unknown</option>
                  {COMPANY_SIZES.map(s => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Industry</label>
              <select className="input w-full" value={form.industry ?? ''} onChange={e => set('industry', e.target.value)}>
                <option value="">Select industry...</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Description</label>
              <textarea
                className="input w-full resize-none"
                rows={3}
                placeholder="Brief description of the company and what they do..."
                value={form.description ?? ''}
                onChange={e => set('description', e.target.value)}
              />
            </div>
          </div>

          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Signal</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1">Hiring Signal</label>
                <input
                  className="input w-full"
                  placeholder="Hiring 5 engineers"
                  value={form.hiring_signal ?? ''}
                  onChange={e => set('hiring_signal', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Job Role Being Hired</label>
                <input
                  className="input w-full"
                  placeholder="Software Engineer"
                  value={form.job_title ?? ''}
                  onChange={e => set('job_title', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Source</label>
              <select className="input w-full" value={form.source ?? 'manual'} onChange={e => set('source', e.target.value)}>
                {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {mutation.error && (
            <p className="text-sm text-sig-coral">{(mutation.error as Error).message}</p>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? 'Saving...' : 'Add Lead'}
            </button>
            <button type="button" onClick={() => router.push('/leads')} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
