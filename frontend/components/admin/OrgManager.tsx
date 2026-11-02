'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, PlayCircle, Save } from 'lucide-react';
import { toast } from '@/lib/toast';
import { errorMessage } from '@/components/ui/QueryError';
import TeamManager from '@/components/team/TeamManager';
import { addOrgUser, fetchOrgUsers, resendOrgInvite, updateOrganization, updateOrgUser } from '@/services/admin';
import type { AdminOrganization, UpdateOrganizationInput } from '../../../shared/types';

function Limit({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="space-y-1 block">
      <span className="text-2xs uppercase tracking-wider text-muted">{label}</span>
      <input className="input" type="number" min={0} placeholder="No limit" value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    </label>
  );
}

/** One organization, opened from the Platform admin table: details, limits, status and users. */
export default function OrgManager({ org, isOwnOrg, currentUserId }: {
  org: AdminOrganization;
  isOwnOrg: boolean;
  currentUserId?: string;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<UpdateOrganizationInput>({
    name: org.name,
    lead_quota_daily: org.lead_quota_daily,
    lead_quota_weekly: org.lead_quota_weekly,
    lead_quota_monthly: org.lead_quota_monthly,
    monthly_scrape_cap: org.monthly_scrape_cap,
  });
  const set = (patch: UpdateOrganizationInput) => setDraft(d => ({ ...d, ...patch }));
  const dirty = draft.name !== org.name || draft.lead_quota_daily !== org.lead_quota_daily
    || draft.lead_quota_weekly !== org.lead_quota_weekly || draft.lead_quota_monthly !== org.lead_quota_monthly
    || draft.monthly_scrape_cap !== org.monthly_scrape_cap;

  const save = useMutation({
    mutationFn: (patch: UpdateOrganizationInput) => updateOrganization(org.id, patch),
    onSuccess: (updated, patch) => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
      toast.success(patch.status
        ? `${updated.name} ${updated.status === 'suspended' ? 'suspended: its users are signed out' : 'reactivated'}`
        : 'Saved');
    },
    onError: err => toast.error(errorMessage(err)),
  });

  const suspended = org.status === 'suspended';
  function toggleStatus() {
    if (!suspended && !window.confirm(`Suspend ${org.name}? Its users are signed out and cannot sign in until you reactivate it. Scheduled scrapes stop.`)) return;
    save.mutate({ status: suspended ? 'active' : 'suspended' });
  }

  return (
    <div className="space-y-6 p-5 bg-surface-soft/50">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-ink">Details and limits</h4>
          <div className="flex gap-2">
            <button className={suspended ? 'btn-secondary' : 'btn-ghost text-rose-400'}
              disabled={save.isPending || (isOwnOrg && !suspended)}
              title={isOwnOrg && !suspended ? 'You cannot suspend your own organization' : undefined}
              onClick={toggleStatus}>
              {suspended ? <><PlayCircle className="w-4 h-4" /> Reactivate</> : <><Ban className="w-4 h-4" /> Suspend</>}
            </button>
            <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <label className="space-y-1 block">
            <span className="text-2xs uppercase tracking-wider text-muted">Name</span>
            <input className="input" value={draft.name ?? ''} onChange={e => set({ name: e.target.value })} />
          </label>
          <Limit label="Leads / day" value={draft.lead_quota_daily ?? null} onChange={v => set({ lead_quota_daily: v })} />
          <Limit label="Leads / week" value={draft.lead_quota_weekly ?? null} onChange={v => set({ lead_quota_weekly: v })} />
          <Limit label="Leads / month" value={draft.lead_quota_monthly ?? null} onChange={v => set({ lead_quota_monthly: v })} />
          <Limit label="Scrapes / month" value={draft.monthly_scrape_cap ?? 0} onChange={v => set({ monthly_scrape_cap: v ?? 0 })} />
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-ink">Users</h4>
        <TeamManager
          queryKey={['admin-org-users', org.id]}
          canManage
          currentUserId={currentUserId}
          api={{
            list: () => fetchOrgUsers(org.id),
            add: input => addOrgUser(org.id, input).then(r => { qc.invalidateQueries({ queryKey: ['admin-orgs'] }); return r; }),
            update: (id, patch) => updateOrgUser(org.id, id, patch),
            resend: id => resendOrgInvite(org.id, id),
          }}
        />
      </section>
    </div>
  );
}
