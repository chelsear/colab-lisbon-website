// Screens form submissions before they reach Netlify Forms.
// Pages post here instead of to "/"; good submissions are forwarded to "/" so they still show up in the
// Netlify dashboard and trigger the usual notifications. Bad email addresses get a 400 with a message.
const { checkEmailFields, suggestEmail, EMAIL_PROBLEM_MESSAGES } = require('../../email-check.js');

// Netlify Forms that this site renders; anything else is refused
const ALLOWED_FORMS = new Set(['newsletter', 'newsletter-pt', 'newsletter-claude-code', 'team-training', 'master-claude-plan']);

// Best-effort limit per IP. Kept in memory, so it only counts requests that land on the same warm
// function instance and resets on cold starts; it slows down a single noisy client, nothing more.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const recentByIp = new Map();

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const recent = (recentByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  recentByIp.set(ip, recent);
  if (recentByIp.size > 5000) recentByIp.clear();
  return recent.length > RATE_LIMIT;
}

// Whether the domain has a mail server (MX), or at least an address (A) mail can fall back to.
// Uses Cloudflare DNS-over-HTTPS; if the lookup itself fails, let the address through.
async function domainReceivesMail(domain) {
  const lookup = async (type) => {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`DNS ${res.status}`);
    const body = await res.json();
    return body.Status === 0 && Array.isArray(body.Answer) && body.Answer.length > 0;
  };
  try {
    return (await lookup('MX')) || (await lookup('A'));
  } catch (err) {
    console.error('DNS check skipped:', err.message);
    return true;
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Emails each accepted submission through Resend. Needs RESEND_API_KEY; the sender's domain must be
// verified in Resend. Failures are logged only, since the submission is already saved in Netlify Forms.
const NOTIFY_TO = process.env.NOTIFY_TO || 'chelsea@rustrum.com';
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'CoLab Lisbon Forms <forms@colablisbon.com>';
const SKIP_FIELDS = new Set(['form-name', 'bot-field']);

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function notifyByEmail(formName, params) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set; skipping email notification');
    return;
  }
  const fields = [...params.entries()].filter(([key, value]) => !SKIP_FIELDS.has(key) && value.trim());
  const who = params.get('company') || [params.get('firstName'), params.get('lastName')].filter(Boolean).join(' ') || params.get('email');
  const rows = fields
    .map(([key, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top"><b>${escapeHtml(key)}</b></td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`)
    .join('');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        reply_to: params.get('email') || undefined,
        subject: `[colablisbon.com] ${formName}${who ? ` – ${who}` : ''}`,
        html: `<p>New <b>${escapeHtml(formName)}</b> submission on colablisbon.com:</p><table>${rows}</table>`,
        text: fields.map(([key, value]) => `${key}: ${value}`).join('\n'),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`Resend rejected notification for "${formName}": ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`Could not send notification for "${formName}":`, err.message);
  }
}

const reject = (field, error, suggestion = null) =>
  json(error === 'rate_limited' ? 429 : 400, { error, field, message: EMAIL_PROBLEM_MESSAGES[error], suggestion });

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  const type = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (type.includes('application/json')) {
    const data = JSON.parse(raw || '{}');
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => params.append(key, value == null ? '' : String(value)));
    return params;
  }
  return new URLSearchParams(raw);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let params;
  try {
    params = parseBody(event);
  } catch {
    return json(400, { error: 'invalid_request', message: EMAIL_PROBLEM_MESSAGES.failed });
  }

  const formName = params.get('form-name');
  if (!ALLOWED_FORMS.has(formName)) return json(400, { error: 'invalid_form', message: EMAIL_PROBLEM_MESSAGES.failed });

  // Hidden field that people never see; bots fill it in. Pretend it worked and do nothing.
  if (params.get('bot-field')) return json(200, { ok: true });

  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (isRateLimited(ip)) return reject(null, 'rate_limited');

  // Tidy every email field, then screen them
  const emailFields = [...params.entries()].filter(([key]) => /email$/i.test(key)).map(([key, value]) => [key, value.trim()]);
  emailFields.forEach(([key, value]) => params.set(key, value));
  const problem = checkEmailFields(params);
  if (problem) return reject(problem.field, problem.error, problem.suggestion);

  const filled = emailFields.filter(([, value]) => value);
  const receives = await Promise.all(filled.map(([, value]) => domainReceivesMail(value.split('@')[1].toLowerCase())));
  const noMail = filled.find((_, i) => !receives[i]);
  if (noMail) return reject(noMail[0], 'no_mail_server', suggestEmail(noMail[1]));

  // Hand the submission to Netlify Forms, which accepts urlencoded posts to any static page
  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  try {
    const res = await fetch(`${siteUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'manual',
    });
    if (res.status >= 400) {
      console.error(`Netlify Forms rejected "${formName}" with status ${res.status}`);
      return json(502, { error: 'failed', message: EMAIL_PROBLEM_MESSAGES.failed, status: res.status });
    }
    await notifyByEmail(formName, params);
    return json(200, { ok: true, status: res.status });
  } catch (err) {
    console.error(`Could not forward "${formName}":`, err.message);
    return json(502, { error: 'failed', message: EMAIL_PROBLEM_MESSAGES.failed });
  }
};
