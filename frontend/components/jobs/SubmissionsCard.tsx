'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Select from '@radix-ui/react-select';
import { Users, Plus, Trash2, ChevronDown, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { createSubmission, updateSubmission, deleteSubmission } from '@/services/jobs';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { JobSubmission, SubmissionStatus } from '../../../shared/types';

const SUBMISSION_STATUSES: SubmissionStatus[] = [
  'submitted', 'screening', 'interviewing', 'offer', 'placed', 'rejected', 'withdrawn',
];

const STATUS_STYLES: Record<SubmissionStatus, string> = {
  submitted:    'bg-status-new-bg text-status-new-text border-status-new-border',
  screening:    'bg-status-contacted-bg text-status-contacted-text border-status-contacted-border',
  interviewing: 'bg-status-meeting-bg text-status-meeting-text border-status-meeting-border',
  offer:        'bg-status-replied-bg text-status-replied-text border-status-replied-border',
  placed:       'bg-status-client-bg text-status-client-text border-status-client-border',
  rejected:     'bg-status-rejected-bg text-status-rejected-text border-status-rejected-border',
  withdrawn:    'bg-surface-strong text-muted border-hairline',
};

function StatusSelect({ value, onChange, disabled }: {
  value: SubmissionStatus;
  onChange: (s: SubmissionStatus) => void;
  disabled: boolean;
}) {
  return (
    <Select.Root value={value} onValueChange={v => onChange(v as SubmissionStatus)} disabled={disabled}>
      <Select.Trigger className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium text-xs px-2.5 py-0.5 capitalize',
        'outline-none cursor-pointer disabled:opacity-50 transition-colors',
        STATUS_STYLES[value],
      )}>
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="overflow-hidden bg-canvas border border-hairline rounded-xl shadow-card-lg animate-scale-in z-50"
          position="popper"
          sideOffset={6}
        >
          <Select.Viewport className="p-1">
            {SUBMISSION_STATUSES.map(s => (
              <Select.Item
                key={s}
                value={s}
                className="relative flex items-center h-8 px-3 text-[13px] text-ink rounded-lg mx-1 outline-none cursor-pointer select-none capitalize data-[highlighted]:bg-surface-strong"
              >
                <Select.ItemText>{s}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export default function SubmissionsCard({ jobId, submissions }: {
  jobId: string;
  submissions: JobSubmission[];
}) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [profileLabel, setProfileLabel] = useState('');
  const [notes, setNotes] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['job', jobId] });
    qc.invalidateQueries({ queryKey: ['jobs'] });
  };

  const createMutation = useMutation({
    mutationFn: () => createSubmission(jobId, {
      profile_label: profileLabel.trim(),
      notes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Submission recorded');
      setProfileLabel('');
      setNotes('');
      setFormOpen(false);
      invalidate();
    },
    onError: () => toast.error('Failed to record submission'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubmissionStatus }) =>
      updateSubmission(jobId, id, { status }),
    onSuccess: () => {
      toast.success('Submission updated');
      invalidate();
    },
    onError: () => toast.error('Failed to update submission'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSubmission(jobId, id),
    onSuccess: () => {
      toast.success('Submission removed');
      invalidate();
    },
    onError: () => toast.error('Failed to remove submission'),
  });

  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="bg-canvas border border-hairline rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted" />
          <h3 className="text-2xs font-semibold text-muted uppercase tracking-wider">Submissions</h3>
          {submissions.length > 0 && (
            <span className="text-3xs text-muted bg-surface-strong px-1.5 py-0.5 rounded-full">
              {submissions.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setFormOpen(o => !o)}
          className={cn(
            'flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-lg border transition-colors',
            formOpen
              ? 'border-hairline text-muted hover:bg-surface-strong'
              : 'border-brand/20 text-brand hover:bg-surface-strong',
          )}
        >
          {formOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {formOpen ? 'Cancel' : 'Add Submission'}
        </button>
      </div>

      {formOpen && (
        <form
          onSubmit={e => {
            e.preventDefault();
            if (profileLabel.trim()) createMutation.mutate();
          }}
          className="px-4 py-3 border-b border-hairline bg-surface-soft/40 space-y-2"
        >
          <input
            autoFocus
            type="text"
            placeholder="Profile label — e.g. “Ravi K — React Sr.”"
            value={profileLabel}
            onChange={e => setProfileLabel(e.target.value)}
            className="w-full h-9 px-3 text-[13px] text-ink bg-canvas border border-hairline rounded-lg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 placeholder:text-muted"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Notes (optional) — resume variant, rate quoted…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="flex-1 h-9 px-3 text-[13px] text-ink bg-canvas border border-hairline rounded-lg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!profileLabel.trim() || createMutation.isPending}
              className="h-9 px-4 text-body-sm font-semibold bg-brand text-[#04130b] rounded-lg hover:bg-[#4be09a] transition-all disabled:opacity-50 flex-shrink-0"
            >
              {createMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {submissions.length === 0 && !formOpen ? (
        <div className="px-4 py-6 text-center">
          <p className="text-body-sm text-muted">No profiles submitted to this job yet.</p>
          <p className="text-xs text-muted/60 mt-1">Track every resume you send so nobody double-submits.</p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {submissions.map(sub => (
            <li key={sub.id} className="flex items-center gap-3 px-4 py-2.5 group">
              <div className="w-7 h-7 rounded-full bg-surface-strong flex items-center justify-center text-2xs font-semibold text-muted flex-shrink-0">
                {sub.profile_label.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-medium text-ink truncate">{sub.profile_label}</p>
                <p className="text-2xs text-muted truncate">
                  {formatDistanceToNow(new Date(sub.submitted_at), { addSuffix: true })}
                  {sub.notes ? ` · ${sub.notes}` : ''}
                </p>
              </div>
              <StatusSelect
                value={sub.status}
                onChange={status => updateMutation.mutate({ id: sub.id, status })}
                disabled={isBusy}
              />
              <button
                onClick={() => deleteMutation.mutate(sub.id)}
                disabled={isBusy}
                title="Remove submission"
                className="p-1.5 rounded-lg hover:bg-surface-strong text-muted hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
