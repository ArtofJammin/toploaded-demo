// Outbound email via Resend (https://resend.com — free tier is plenty for a shop).
// Without RESEND_API_KEY the message is logged and {sent:false} is returned, so
// every flow still works in dev and the submission is always kept in KV.
export async function sendEmail(env, { to, subject, text, html, replyTo }) {
  const dest = to || env.NOTIFY_EMAIL;
  if (!dest) return { sent: false, reason: 'no recipient' };
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dry-run] to=${dest} subject=${subject}\n${text || ''}`);
    return { sent: false, reason: 'RESEND_API_KEY not set', dryRun: true };
  }
  const from = env.EMAIL_FROM || 'Top Loaded Website <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [dest], subject, text, html, reply_to: replyTo }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.log(`[email] resend failed ${r.status}: ${body}`);
    return { sent: false, reason: `resend ${r.status}` };
  }
  const data = await r.json().catch(() => ({}));
  return { sent: true, id: data.id };
}
