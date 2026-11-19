// Shared security helpers: session cookies, the CSRF token, origin checks, host name checks, the startup environment
// checks and the security event log. Nothing here talks to a person. app.js calls it.
'use strict';
const crypto = require('crypto');
const { trustProxy } = require('./net');

const isProduction = () => process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';

// ---------- cookies ----------
// The session lives in an HttpOnly cookie, so a script injected into a page cannot read it. SameSite=Strict keeps the
// browser from sending it on requests started by other sites. On HTTPS the __Host- prefix also stops a sub domain from
// planting a cookie. The second cookie holds the CSRF token. It is readable on purpose, because the page copies it into
// a header, and it is useless without the session cookie because the server checks it against the session.
const BASE_SID = 'pm_sid';
const BASE_CSRF = 'pm_csrf';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch (e) { /* keep the raw value */ }
    if (!(k in out)) out[k] = v;
  }
  return out;
}

// True when the person reached us over HTTPS. Behind our own proxy the proxy says so in X-Forwarded-Proto.
function isSecure(req) {
  if (req.socket && req.socket.encrypted) return true;
  if (!trustProxy()) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}
// Only an explicit plain http from our proxy counts as insecure. No header at all means TLS ends further out.
const isPlainHttp = (req) => !(req.socket && req.socket.encrypted) && trustProxy() && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'http';

const names = (secure) => (secure ? { sid: '__Host-' + BASE_SID, csrf: '__Host-' + BASE_CSRF } : { sid: BASE_SID, csrf: BASE_CSRF });

const sessionCookieOf = (req) => { const c = parseCookies(req.headers.cookie); return c['__Host-' + BASE_SID] || c[BASE_SID] || null; };

// The CSRF token is tied to the session token, so it cannot be guessed or reused for another session.
const csrfFor = (sessionToken) => crypto.createHmac('sha256', String(sessionToken)).update('pm-csrf-v1').digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

function sessionCookies(req, token, maxAgeSec) {
  const secure = isSecure(req) || isProduction();
  const n = names(secure);
  const common = `Path=/; SameSite=Strict; Max-Age=${Math.max(60, Math.floor(maxAgeSec))}${secure ? '; Secure' : ''}`;
  return [`${n.sid}=${token}; HttpOnly; ${common}`, `${n.csrf}=${csrfFor(token)}; ${common}`];
}
function clearCookies(req) {
  const out = [];
  for (const secure of [true, false]) {
    const n = names(secure);
    const common = `Path=/; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`;
    out.push(`${n.sid}=; HttpOnly; ${common}`, `${n.csrf}=; ${common}`, `pm_tb=; HttpOnly; ${common}`);
  }
  return out;
}

// ---------- host names and origins ----------
const HOST_RE = /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?$/i;
// The Host header is written by the sender, so it is never used in a link unless it looks like a real host name.
function cleanHost(h) {
  const v = String(h || '').split(',')[0].trim();
  return v.length <= 255 && HOST_RE.test(v) ? v.toLowerCase() : null;
}
function hostOf(req) {
  const fwd = trustProxy() ? cleanHost(req.headers['x-forwarded-host']) : null;
  return fwd || cleanHost(req.headers.host) || 'localhost';
}
const siteHost = () => { try { return process.env.SITE_URL ? new URL(process.env.SITE_URL).host.toLowerCase() : null; } catch (e) { return null; } };
function allowedHosts(req) {
  const s = new Set([hostOf(req)]);
  const h = cleanHost(req.headers.host); if (h) s.add(h);
  const sh = siteHost(); if (sh) s.add(sh);
  return s;
}
// A request that changes something must come from our own pages. Browsers add Sec-Fetch-Site and Origin to such requests.
// A request with neither is not from a browser page, and the CSRF token still has to match.
function fromOwnSite(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const o = req.headers.origin;
  if (o && o !== 'null') { try { return allowedHosts(req).has(new URL(o).host.toLowerCase()); } catch (e) { return false; } }
  if (o === 'null') return false;
  const ref = req.headers.referer;
  if (!o && ref) { try { return allowedHosts(req).has(new URL(ref).host.toLowerCase()); } catch (e) { return false; } }
  return true;
}

// ---------- startup checks ----------
// Each check says what is wrong and what to do. level is error (fix before going live), warn (worth fixing) or ok.
function checkEnvironment(env = process.env, production = isProduction()) {
  const out = [];
  const add = (id, level, message) => out.push({ id, level, message });
  const set = (k) => env[k] != null && String(env[k]) !== '';
  if (!set('APP_SECRET')) add('APP_SECRET', production ? 'error' : 'warn', 'APP_SECRET is not set. Saved Jira and Outlook tokens are encrypted with a key stored in the same database. Set it to a random value of 32 characters or more.');
  else if (String(env.APP_SECRET).length < 32) add('APP_SECRET', 'error', 'APP_SECRET is shorter than 32 characters. Use a long random value.');
  else add('APP_SECRET', 'ok', 'APP_SECRET is set.');
  if (production) {
    if (!set('SITE_URL')) add('SITE_URL', 'warn', 'SITE_URL is not set. Links and sign in redirects are built from the request host. Set it to the public https address.');
    else if (!/^https:\/\//i.test(env.SITE_URL)) add('SITE_URL', 'error', 'SITE_URL does not start with https://.');
    else add('SITE_URL', 'ok', 'SITE_URL is set to an https address.');
    if (!set('SUPER_ADMIN_EMAILS')) add('SUPER_ADMIN_EMAILS', 'warn', 'SUPER_ADMIN_EMAILS is not set, so no account can be a super admin.');
    if (env.DEMO_ACCOUNT === '1') add('DEMO_ACCOUNT', 'error', 'DEMO_ACCOUNT is on. Its password is public, so anyone can sign in to it.');
    if (env.SUPER_ADMIN_ALLOW_REGISTER === '1') add('SUPER_ADMIN_ALLOW_REGISTER', 'error', 'SUPER_ADMIN_ALLOW_REGISTER is on, so anyone can register a super admin address first.');
    if (env.DEMO_BILLING === '1') add('DEMO_BILLING', 'warn', 'DEMO_BILLING is on, so people can start a paid period without paying.');
    if (env.NOTIFY_DEBUG) add('NOTIFY_DEBUG', 'warn', 'NOTIFY_DEBUG is on and writes extra error detail to the server log.');
    if (!set('DATABASE_URL')) add('DATABASE_URL', 'error', 'DATABASE_URL is not set.');
    else if (!/sslmode=(require|verify-full|verify-ca)/i.test(env.DATABASE_URL) && !/@(localhost|127\.0\.0\.1|helium)(:|\/)/i.test(env.DATABASE_URL)) add('DATABASE_URL', 'warn', 'DATABASE_URL has no sslmode=require, so the database connection may not be encrypted.');
    else add('DATABASE_URL', 'ok', 'The database connection is set up for an encrypted or private link.');
    if (set('TICKET_WEBHOOK_SECRET') && String(env.TICKET_WEBHOOK_SECRET).length < 32) add('TICKET_WEBHOOK_SECRET', 'warn', 'TICKET_WEBHOOK_SECRET is shorter than 32 characters.');
    if (!set('TRUST_PROXY_HOPS')) add('TRUST_PROXY_HOPS', 'warn', 'TRUST_PROXY_HOPS is not set, so one proxy is assumed. Set it to the real number of proxies in front of the app.');
  }
  const csp = String(env.CSP_MODE || 'on').toLowerCase();
  if (csp !== 'on') add('CSP_MODE', production ? 'error' : 'warn', `CSP_MODE is ${csp}, so the Content Security Policy is not enforced.`);
  return out;
}

// ---------- the security event log ----------
const SEVERITY = { login_success: 'info', register: 'info', logout: 'info', password_changed: 'info', password_reset_issued: 'warn', password_reset_used: 'warn', password_reset_failed: 'warn',
  login_failed: 'warn', login_locked: 'high', bruteforce_suspected: 'high', session_invalid: 'info', csrf_blocked: 'high', origin_blocked: 'high', admin_denied: 'high', rate_limited: 'warn',
  upload_rejected: 'warn', suspicious_request: 'warn', subscribe_blocked: 'warn', reserved_email: 'high', session_upgraded: 'info' };
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

function createSecurityLog({ db, store }) {
  const recent = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, t] of recent) if (now - t > 120e3) recent.delete(k); }, 60e3); timer.unref();
  // The same event from the same place is written at most once in the window, so an attack cannot fill the table.
  const quiet = (key, ms) => { const now = Date.now(); const last = recent.get(key); if (last && now - last < ms) return true; recent.set(key, now); return false; };

  async function log(type, o = {}) {
    const severity = o.severity || SEVERITY[type] || 'info';
    if (o.throttleMs && quiet(`${type}|${o.ip || ''}|${o.userId || ''}|${o.key || ''}`, o.throttleMs)) return;
    const rec = { type, severity, user_id: o.userId || null, ip: clip(o.ip, 64), path: clip(o.path, 200), email: o.email ? clip(o.email, 200) : null, detail: o.detail || {} };
    if (severity !== 'info') console.warn('SECURITY', JSON.stringify({ type, severity, ip: rec.ip, path: rec.path, user_id: rec.user_id }));
    try {
      await db.query('INSERT INTO security_events(id, type, severity, user_id, email, ip, path, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [store.nid(), type, severity, rec.user_id, rec.email, rec.ip, rec.path, JSON.stringify(rec.detail)]);
      if (type === 'login_failed' && rec.ip) await watchGuessing(rec.ip);
    } catch (e) { if (!/security_events/.test(e.message)) console.error('security log', e.message); }
  }
  // Ten failed sign ins from one address in ten minutes is raised as its own high severity event, once per ten minutes.
  async function watchGuessing(ip) {
    const n = Number((await db.query("SELECT count(*) AS c FROM security_events WHERE type = 'login_failed' AND ip = $1 AND created_at > now() - interval '10 minutes'", [ip])).rows[0].c);
    if (n >= 10 && !quiet(`bruteforce|${ip}`, 600e3)) await log('bruteforce_suspected', { ip, detail: { failures_in_10_min: n } });
  }
  const prune = () => db.query("DELETE FROM security_events WHERE created_at < now() - interval '180 days'").catch(() => {});

  async function summary(hours = 24) {
    const h = Math.min(24 * 90, Math.max(1, Number(hours) || 24));
    const rows = (await db.query("SELECT type, severity, count(*) AS n FROM security_events WHERE created_at > now() - ($1 || ' hours')::interval GROUP BY type, severity", [String(h)])).rows;
    const by = {}; let high = 0, warn = 0;
    for (const r of rows) { by[r.type] = (by[r.type] || 0) + Number(r.n); if (r.severity === 'high') high += Number(r.n); else if (r.severity === 'warn') warn += Number(r.n); }
    const ips = (await db.query("SELECT ip, count(*) AS n FROM security_events WHERE severity IN ('warn','high') AND ip <> '' AND created_at > now() - ($1 || ' hours')::interval GROUP BY ip ORDER BY n DESC LIMIT 5", [String(h)])).rows;
    return { hours: h, by_type: by, high, warn, top_addresses: ips.map((r) => ({ ip: r.ip, events: Number(r.n) })) };
  }
  return { log, prune, summary, SEVERITY };
}

module.exports = { isProduction, parseCookies, isSecure, isPlainHttp, sessionCookieOf, csrfFor, safeEqual, sessionCookies, clearCookies, cleanHost, hostOf, fromOwnSite, checkEnvironment, createSecurityLog, SEVERITY, BASE_SID, BASE_CSRF };
