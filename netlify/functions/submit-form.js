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
    return json(200, { ok: true, status: res.status });
  } catch (err) {
    console.error(`Could not forward "${formName}":`, err.message);
    return json(502, { error: 'failed', message: EMAIL_PROBLEM_MESSAGES.failed });
  }
};
