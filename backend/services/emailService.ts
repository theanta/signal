/**
 * Transactional email through Resend (https://resend.com), over its HTTP API.
 *
 * Without RESEND_API_KEY (development, or before email is set up) nothing is
 * sent: the caller gets `false` and shows the link some other way. Never
 * throws — a failed email must not undo the user it was about.
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Where links in emails point: APP_URL, else the first FRONTEND_URL. */
export function appUrl(): string {
  const fromList = (process.env.FRONTEND_URL ?? '').split(',').map(s => s.trim()).filter(Boolean)[0];
  return (process.env.APP_URL || fromList || 'http://localhost:3000').replace(/\/+$/, '');
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Signal <onboarding@resend.dev>',
        to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[email] Resend refused the email to ${msg.to}: ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] sending to ${msg.to} failed:`, (err as Error).message);
    return false;
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function inviteEmail(p: { name: string; orgName: string; invitedBy?: string; url: string }) {
  const who = p.invitedBy ? `${p.invitedBy} has invited you` : 'You have been invited';
  const text = `Hi ${p.name},\n\n${who} to join ${p.orgName} on Signal.\n\n`
    + `Set your password to sign in (the link works for 7 days):\n${p.url}\n`;
  const html = `<p>Hi ${escape(p.name)},</p>`
    + `<p>${escape(who)} to join <strong>${escape(p.orgName)}</strong> on Signal.</p>`
    + `<p><a href="${escape(p.url)}">Set your password and sign in</a></p>`
    + `<p style="color:#666;font-size:13px">The link works for 7 days. If you were not expecting this, ignore this email.</p>`;
  return { subject: `You're invited to ${p.orgName} on Signal`, html, text };
}
