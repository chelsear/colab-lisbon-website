/* email-check.js — Email address screening, shared by the pages (instant feedback) and
 * netlify/functions/submit-form.js (the real check). Plain script with no imports or build step:
 * in the browser it sets window.EmailCheck, in Node it is a CommonJS module.
 * Rules mirror ColorSnapAI supabase/functions/_shared/emailCheck.ts; keep the two in sync. */
(function (root) {
  // Throwaway inbox services; mail to them is never read by a real person
  var DISPOSABLE_DOMAINS = new Set([
    '10minutemail.com', '20minutemail.com', 'anonaddy.me', 'burnermail.io', 'dispostable.com', 'dropmail.me',
    'emailondeck.com', 'fakeinbox.com', 'getairmail.com', 'getnada.com', 'guerrillamail.com', 'guerrillamail.net',
    'guerrillamailblock.com', 'grr.la', 'inboxkitten.com', 'mail.tm', 'maildrop.cc', 'mailinator.com', 'mailnesia.com',
    'mailpoof.com', 'mintemail.com', 'mohmal.com', 'moakt.com', 'mytemp.email', 'nada.email', 'sharklasers.com',
    'spam4.me', 'spamgourmet.com', 'temp-mail.io', 'temp-mail.org', 'tempail.com', 'tempmail.com', 'tempmail.net',
    'tempmailo.com', 'tempr.email', 'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'yopmail.com', 'yopmail.net'
  ]);

  // Common misspellings of big mail providers, mapped to what the person meant
  var DOMAIN_TYPOS = {
    'gnail.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com',
    'gmaill.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com',
    'gmail.cm': 'gmail.com', 'hotmail.co': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
    'hotmail.con': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
    'yhaoo.com': 'yahoo.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'iclod.com': 'icloud.com',
    'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com', 'aol.co': 'aol.com'
  };

  // Friendly message for each problem, shown under the email field
  var EMAIL_PROBLEM_MESSAGES = {
    format: 'Please enter a valid email address.',
    suspicious: "That email address doesn't look right. Please use the address you normally use.",
    disposable: 'Please use your real email address, not a temporary inbox.',
    typo: 'That email domain looks misspelled.',
    no_mail_server: "That email domain can't receive mail. Please check the spelling.",
    rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
    failed: 'Something went wrong. Please try again.'
  };

  function normalizeEmail(email) {
    return String(email == null ? '' : email).trim().toLowerCase();
  }

  // The corrected address when the domain is a known typo, e.g. "jane@gnail.com" -> "jane@gmail.com"
  function suggestEmail(raw) {
    var email = normalizeEmail(raw);
    var at = email.lastIndexOf('@');
    var fixed = at > 0 ? DOMAIN_TYPOS[email.slice(at + 1)] : undefined;
    return fixed ? email.slice(0, at) + '@' + fixed : null;
  }

  // Why an address should be refused ('format' | 'suspicious' | 'disposable' | 'typo'), or null when it
  // looks like a real person's. Real signups have at most 2 dots before the @ (e.g. "jane.m.doe"); bot
  // signups often spread dots through the name ("j.a.n.e.doe") to slip past duplicate checks.
  function checkEmailFormat(raw) {
    var email = normalizeEmail(raw);
    if (email.length > 254) return 'format';
    var match = /^([a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/.exec(email);
    if (!match) return 'format';

    var local = match[1];
    var domain = match[2];
    if (local.charAt(0) === '.' || local.slice(-1) === '.' || local.indexOf('..') !== -1) return 'format';
    if (domain.split('.').some(function (label) { return !label || label.charAt(0) === '-' || label.slice(-1) === '-'; })) return 'format';

    var name = local.split('+')[0];
    var dots = (name.match(/\./g) || []).length;
    var singleLetterParts = name.split('.').filter(function (part) { return part.length === 1; }).length;
    if (dots >= 3 || (dots >= 2 && singleLetterParts >= 2)) return 'suspicious';

    if (DOMAIN_TYPOS[domain]) return 'typo';

    var registrable = domain.split('.').slice(-2).join('.');
    if (DISPOSABLE_DOMAINS.has(domain) || DISPOSABLE_DOMAINS.has(registrable)) return 'disposable';

    return null;
  }

  // Form fields that hold an email address: "email", "teamMember1Email", ...
  function isEmailField(name) {
    return /email$/i.test(name);
  }

  // First problem among the filled-in email fields of a URLSearchParams, or null.
  // The "email" field itself must be present; other email fields are checked only when filled in.
  function checkEmailFields(params) {
    var fields = [];
    params.forEach(function (value, key) { if (isEmailField(key)) fields.push([key, value]); });
    if (!params.get('email')) return { field: 'email', error: 'format', suggestion: null };
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i][0];
      var value = fields[i][1];
      if (field !== 'email' && !String(value).trim()) continue;
      var problem = checkEmailFormat(value);
      if (problem) return { field: field, error: problem, suggestion: suggestEmail(value) };
    }
    return null;
  }

  var api = {
    DISPOSABLE_DOMAINS: DISPOSABLE_DOMAINS,
    DOMAIN_TYPOS: DOMAIN_TYPOS,
    EMAIL_PROBLEM_MESSAGES: EMAIL_PROBLEM_MESSAGES,
    normalizeEmail: normalizeEmail,
    suggestEmail: suggestEmail,
    checkEmailFormat: checkEmailFormat,
    isEmailField: isEmailField,
    checkEmailFields: checkEmailFields
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  /* ---------- Browser helpers ---------- */

  var ENDPOINT = '/.netlify/functions/submit-form';

  // Screens the form in the browser, then posts it through the screening function.
  // Resolves to { ok: true } or { ok: false, field, error, message, suggestion }.
  // messages: optional overrides for EMAIL_PROBLEM_MESSAGES (e.g. a translated page).
  api.submit = function (form, messages) {
    var text = Object.assign({}, EMAIL_PROBLEM_MESSAGES, messages || {});
    var params = new URLSearchParams(new FormData(form));
    var fail = function (field, error, suggestion) {
      return { ok: false, field: field, error: error, message: text[error] || text.failed, suggestion: suggestion || null };
    };

    var local = checkEmailFields(params);
    if (local) return Promise.resolve(fail(local.field, local.error, local.suggestion));

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }).then(function (res) {
      if (res.ok) return { ok: true };
      return res.json().catch(function () { return {}; }).then(function (body) {
        return fail(body.field || null, body.error || 'failed', body.suggestion);
      });
    }, function () {
      return fail(null, 'failed');
    });
  };

  // Shows (or clears, when result is null) the problem under an email input, with a
  // "Did you mean …?" link that fills the field. anchor: element to place the message after.
  api.showError = function (input, result, options) {
    var opts = options || {};
    var anchor = opts.anchor || input;
    var box = anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('email-check-error')
      ? anchor.nextElementSibling : null;
    if (!result) {
      if (box) box.remove();
      input.removeAttribute('aria-invalid');
      return;
    }
    if (!box) {
      box = document.createElement('p');
      box.className = 'email-check-error';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'flex-basis: 100%; margin: 8px 0 0; color: #b42318; font-family: inherit; font-size: 0.95rem; text-align: ' + (opts.align || 'inherit') + ';';
      anchor.insertAdjacentElement('afterend', box);
    }
    box.textContent = result.message + ' ';
    if (result.suggestion) {
      var link = document.createElement('a');
      link.href = '#';
      link.style.cssText = 'color: inherit; font-weight: 700; text-decoration: underline;';
      link.textContent = result.suggestion;
      link.addEventListener('click', function (e) {
        e.preventDefault();
        input.value = result.suggestion;
        api.showError(input, null, opts);
        input.focus();
      });
      box.appendChild(document.createTextNode(opts.didYouMean || 'Did you mean '));
      box.appendChild(link);
      box.appendChild(document.createTextNode('?'));
    }
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  root.EmailCheck = api;
})(typeof window !== 'undefined' ? window : this);
