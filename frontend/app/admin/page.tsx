'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment } from 'react';
import { Building2, ChevronDown, ChevronRight, KeyRound, Mail, Plus, Shield } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import QueryError, { errorMessage } from '@/components/ui/QueryError';
import { createOrganization, fetchOrganizations } from '@/services/admin';
import OrgManager from '@/components/admin/OrgManager';
import IssuedCredentials, { Issued } from '@/components/team/IssuedCredentials';
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
    admin_mode: 'invite', admin_password: generatePassword(), ...DEFAULT_ORG_LIMITS,
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
  const [issued, setIssued] = useState<Issued | null>(null);
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const set = (patch: Partial<CreateOrganizationInput>) => setForm(f => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () => createOrganization({
      ...form,
      agency_name: form.agency_name || undefined,
      admin_password: form.admin_mode === 'password' ? form.admin_password : undefined,
    }),
    onSuccess: ({ organization: org, email_sent, invite_url }) => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
      setIssued({
        email: form.admin_email, email_sent, invite_url,
        password: form.admin_mode === 'password' ? form.admin_password : undefined,
      });
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
        {issued && <IssuedCredentials issued={issued} onDone={() => setIssued(null)} />}

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
                <div className="flex rounded-md border border-hairline overflow-hidden text-xs">
                  {([['invite', Mail, 'Email invite'], ['password', KeyRound, 'Temporary password']] as const).map(([m, Icon, label]) => (
                    <button key={m} type="button" onClick={() => set({ admin_mode: m })}
                      className={cn('flex-1 flex items-center justify-center gap-1.5 py-2',
                        form.admin_mode === m ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink')}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
                {form.admin_mode === 'password' && (
                  <div className="col-span-3 flex gap-2">
                    <input className="input flex-1 font-mono" required minLength={12} value={form.admin_password}
                      onChange={e => set({ admin_password: e.target.value })} />
                    <button type="button" className="btn-secondary" title="Generate a new password"
                      onClick={() => set({ admin_password: generatePassword() })}>
                      <KeyRound className="w-4 h-4" />
                    </button>
                  </div>
                )}
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
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted text-xs">Loading…</td></tr>}
                {orgs.map(o => (
                  <Fragment key={o.id}>
                  <tr className="border-b border-hairline last:border-0 cursor-pointer hover:bg-surface-strong/40"
                    onClick={() => setOpenOrg(openOrg === o.id ? null : o.id)}>
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
                    <td className="px-4 py-3 text-right text-xs text-brand whitespace-nowrap">
                      {openOrg === o.id ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />} Manage
                    </td>
                  </tr>
                  {openOrg === o.id && (
                    <tr className="border-b border-hairline">
                      <td colSpan={9} className="p-0">
                        <OrgManager key={`${o.id}-${o.status}`} org={o} isOwnOrg={o.id === user?.org_id} currentUserId={user?.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
