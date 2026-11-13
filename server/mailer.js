// Sends the few emails the app needs (today: password reset links).
// It uses the Resend HTTP API, so there is nothing to install. Three settings turn it on:
//   RESEND_API_KEY  the API key
//   MAIL_FROM       the sender, for example "Project Manager AI <no-reply@yourdomain.com>"
//   SITE_URL        the public https address, used to build the link. The request address is never trusted for this.
// Without all three, status().configured is false and the sign in page keeps the "ask support" route.
'use strict';

const status = () => {
  const key = process.env.RESEND_API_KEY || '', from = process.env.MAIL_FROM || '';
  const siteUrl = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return { configured: !!(key && from && /^https:\/\/[^/\s]+$/i.test(siteUrl)), siteUrl };
};

// tests replace this to capture a message without a network call
const api = { transport: null };

async function send({ to, subject, text }) {
  if (api.transport) return api.transport({ to, subject, text });
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10e3);
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: ctl.signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text }) });
    if (!r.ok) throw new Error('The mail service answered ' + r.status);
    return { sent: true };
  } finally { clearTimeout(timer); }
}

module.exports = { status, send, api };
