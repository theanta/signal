'use client';

import { Copy, MailCheck } from 'lucide-react';
import { toast } from '@/lib/toast';

/** What to tell a newly added user, shown once: sent, a link to pass on, or a temporary password. */
export interface Issued {
  email: string;
  email_sent: boolean;
  invite_url?: string;
  password?: string;
}

export default function IssuedCredentials({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success('Copied'); };
  if (issued.email_sent) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs flex items-center gap-2">
        <MailCheck className="w-4 h-4 text-emerald-400" />
        <span className="text-ink">Invite emailed to {issued.email}. The link works for 7 days.</span>
        <button className="btn-ghost ml-auto" onClick={onDone}>Done</button>
      </div>
    );
  }
  const secret = issued.password ?? issued.invite_url ?? '';
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-2">
      <p className="text-ink font-medium">
        {issued.password
          ? `Share this temporary password with ${issued.email} privately. They choose their own at first sign-in. It is not shown again.`
          : `Email is not set up, so no invite was sent. Send ${issued.email} this link privately; it works for 7 days.`}
      </p>
      <div className="flex items-center gap-2">
        <code className="px-2 py-1 rounded bg-surface-strong text-ink break-all">{secret}</code>
        <button className="btn-ghost shrink-0" onClick={() => copy(secret)}><Copy className="w-3.5 h-3.5" /> Copy</button>
        <button className="btn-ghost ml-auto shrink-0" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
