'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, KeyRound, Plus, Shield } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import QueryError, { errorMessage } from '@/components/ui/QueryError';
import { createOrganization, fetchOrganizations } from '@/services/admin';
import { generatePassword } from '@/lib/password';
import { DEFAULT_ORG_LIMITS } from '../../../shared/types';
import type { CreateOrganizationInput } from '../../../shared/types';

/**
 * Platform admin: Signal's own operators create organizations (tenants), each
 * with its first admin and its limits. The org's admin then adds the rest of
 * the team from Settings → Team.
 */

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function emptyForm(): CreateOrganizationInput {
  return {
    name: '', slug: '', agency_name: '', admin_name: '', admin_email: '',
    admin_password: generatePassword(), ...DEFAULT_ORG_LIMITS,
  };
}

function Limit({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="space-y-1 block">
      <span className="text-2xs uppercase tracking-wider text-muted">{label}</span>
      <input className="input" type="number" min={0} placeholder="No limit" value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    </label>
  );
}

const limitText = (n: number | null) => (n === null ? '∞' : String(n));

export default function AdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const allowed = Boolean(user?.is_platform_admin);

  const { data: orgs = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-orgs'], queryFn: fetchOrganizations, enabled: allowed,
  });

  const [open, setOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState<CreateOrganizationInput>(emptyForm);
  const [created, setCreated] = useState<{ email: string; password: string; name: string } | null>(null);
  const set = (patch: Partial<CreateOrganizationInput>) => setForm(f => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () => createOrganization({ ...form, agency_name: form.agency_name || undefined }),
    onSuccess: org => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
      setCreated({ email: form.admin_email, password: form.admin_password, name: org.name });
      setForm(emptyForm());
      setSlugTouched(false);
      setOpen(false);
      toast.success(`${org.name} created`);
    },
    onError: err => toast.error(errorMessage(err)),
  });

  if (!allowed) {
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 text-muted">
        <Shield className="w-8 h-8" />
        <p className="text-sm">Platform admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader
        title="Platform admin"
        subtitle="Organizations (tenants) on Signal"
        icon={Shield}
        actions={!open && (
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" /> New organization
          </button>
        )}
      />

      <div className="px-6 py-5 space-y-5 max-w-6xl">
        {created && (
          <div className="card p-4 border-emerald-500/30 text-sm space-y-2">
            <p className="text-ink font-medium">
              {created.name} is ready. Send its admin these sign-in details privately; the password is not shown again.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <code className="px-2 py-1 rounded bg-surface-strong text-ink">{created.email}</code>
              <code className="px-2 py-1 rounded bg-surface-strong text-ink">{created.password}</code>
              <button className="btn-ghost" onClick={() => {
                navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
                toast.success('Copied');
              }}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button className="btn-ghost ml-auto" onClick={() => setCreated(null)}>Done</button>
            </div>
          </div>
        )}

        {open && (
          <form className="card p-5 space-y-5" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
            <div>
              <h3 className="text-sm font-semibold text-ink mb-3">Organization</h3>
              <div className="grid grid-cols-3 gap-3">
                <input className="input" placeholder="Organization name" required value={form.name}
                  onChange={e => set({ name: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })} />
                <input className="input font-mono" placeholder="slug" required value={form.slug}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Lowercase letters, digits and single hyphens"
                  onChange={e => { setSlugTouched(true); set({ slug: e.target.value }); }} />
                <input className="input" placeholder="Agency name in outreach (optional)" value={form.agency_name}
                  onChange={e => set({ agency_name: e.target.value })} />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink mb-3">First admin</h3>
              <div className="grid grid-cols-3 gap-3">
                <input className="input" placeholder="Full name" required value={form.admin_name}
                  onChange={e => set({ admin_name: e.target.value })} />
                <input className="input" type="email" placeholder="Email" required value={form.admin_email}
                  onChange={e => set({ admin_email: e.target.value })} />
                <div className="flex gap-2">
                  <input className="input flex-1 font-mono" required minLength={12} value={form.admin_password}
                    onChange={e => set({ admin_password: e.target.value })} />
                  <button type="button" className="btn-secondary" title="Generate a new password"
                    onClick={() => set({ admin_password: generatePassword() })}>
                    <KeyRound className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink mb-1">Limits</h3>
              <p className="text-xs text-muted mb-3">New leads analyzed per period, and scrape runs per month. Leave a lead limit empty for no limit.</p>
              <div className="grid grid-cols-4 gap-3">
                <Limit label="Leads / day" value={form.lead_quota_daily} onChange={v => set({ lead_quota_daily: v })} />
                <Limit label="Leads / week" value={form.lead_quota_weekly} onChange={v => set({ lead_quota_weekly: v })} />
                <Limit label="Leads / month" value={form.lead_quota_monthly} onChange={v => set({ lead_quota_monthly: v })} />
                <Limit label="Scrapes / month" value={form.monthly_scrape_cap}
                  onChange={v => set({ monthly_scrape_cap: v ?? 0 })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={create.isPending}>
                <Building2 className="w-4 h-4" /> {create.isPending ? 'Creating…' : 'Create organization'}
              </button>
            </div>
          </form>
        )}

        <div className="card overflow-hidden">
          {isError ? (
            <QueryError title="Could not load organizations" error={error} onRetry={() => refetch()} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wider text-muted border-b border-hairline">
                  <th className="px-4 py-2.5 font-medium">Organization</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Users</th>
                  <th className="px-4 py-2.5 font-medium text-right">Leads</th>
                  <th className="px-4 py-2.5 font-medium">Lead limit d / w / m</th>
                  <th className="px-4 py-2.5 font-medium text-right">Scrapes / mo</th>
                  <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted text-xs">Loading…</td></tr>}
                {orgs.map(o => (
                  <tr key={o.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-ink font-medium">{o.name}</div>
                      <div className="text-2xs text-muted font-mono">{o.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-2xs px-2 py-0.5 rounded-full border',
                        o.status === 'active' ? 'border-emerald-500/40 text-emerald-400' : 'border-rose-500/40 text-rose-400')}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-ink">{o.user_count}</td>
                    <td className="px-4 py-3 text-right text-ink">{o.lead_count}</td>
                    <td className="px-4 py-3 text-muted font-mono text-xs">
                      {limitText(o.lead_quota_daily)} / {limitText(o.lead_quota_weekly)} / {limitText(o.lead_quota_monthly)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted">{o.monthly_scrape_cap}</td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {o.last_login ? formatDistanceToNow(new Date(o.last_login), { addSuffix: true }) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
