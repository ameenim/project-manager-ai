'use strict';
// Security hardening: cookie sessions, CSRF, HTTPS, headers, static files, rate limits, the security log, reset links,
// upload checks and the billing gate. Each test runs the real server on a throwaway database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start } = require('./helpers');
const sec = require('../server/security');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
let s, boss, alice, bob;
const JSON_H = { 'content-type': 'application/json' };

function raw(method, path, { headers = {}, body } = {}, base = s.base) {
  return new Promise((ok, no) => {
    const u = new URL(base + path);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let data = null; try { data = JSON.parse(buf.toString()); } catch { /* not json */ } ok({ status: res.statusCode, headers: res.headers, buf, data, cookies: res.headers['set-cookie'] || [] }); });
    });
    req.on('error', no); if (body) req.write(body); req.end();
  });
}
const jar = (cookies) => Object.fromEntries(cookies.map((c) => { const [k, ...v] = c.split(';')[0].split('='); return [k, v.join('=')]; }));
async function cookieLogin(u, extra = {}) {
  const r = await raw('POST', '/api/auth/login', { headers: { ...JSON_H, 'x-session-mode': 'cookie', ...extra }, body: JSON.stringify({ email: u.email, password: 'Pm-Test-4821' }) });
  const j = jar(r.cookies);
  const sid = j.pm_sid || j['__Host-pm_sid'], csrf = j.pm_csrf || j['__Host-pm_csrf'];
  return { r, sid, csrf, cookie: `pm_sid=${sid}; pm_csrf=${csrf}` };
}
const events = async (type) => (await s.app.db.query('SELECT * FROM security_events WHERE type = $1 ORDER BY created_at DESC', [type])).rows;
const waitEvent = (type, n = 1) => s.until(async () => { const e = await events(type); return e.length >= n ? e : null; }, 5000);

before(async () => {
  s = await start({ opsJobs: false, snapshotJob: false, noScheduler: true, authRate: 1000 });
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id, email: 'boss@test.co' };
  alice = await s.user('Alice'); bob = await s.user('Bob');
});
after(() => s.close());

// ---------- cookie sessions ----------
test('the web sign in sets an HttpOnly SameSite=Strict session cookie and never returns the token', async () => {
  const { r, sid, csrf } = await cookieLogin(alice);
  assert.equal(r.status, 200);
  assert.equal(r.data.token, undefined, 'the token must not be in the body');
  assert.match(sid, /^[0-9a-f]{64}$/);
  const sidCookie = r.cookies.find((c) => /^pm_sid=/.test(c)), csrfCookie = r.cookies.find((c) => /^pm_csrf=/.test(c));
  assert.match(sidCookie, /HttpOnly/); assert.match(sidCookie, /SameSite=Strict/); assert.match(sidCookie, /Path=\//);
  assert.doesNotMatch(csrfCookie, /HttpOnly/, 'the page must be able to read the CSRF token');
  assert.equal(csrf, sec.csrfFor(sid), 'the CSRF token is tied to the session');
});
test('scripts that do not ask for cookie mode still get the token', async () => {
  const r = await s.call('POST', '/api/auth/login', { email: alice.email, password: 'Pm-Test-4821' });
  assert.match(r.data.token, /^[0-9a-f]{64}$/);
});
test('behind HTTPS the cookies are Secure and use the __Host- prefix', async () => {
  const { r } = await cookieLogin(alice, { 'x-forwarded-proto': 'https' });
  const sidCookie = r.cookies.find((c) => /^__Host-pm_sid=/.test(c));
  assert.ok(sidCookie, 'prefixed cookie'); assert.match(sidCookie, /; Secure/); assert.doesNotMatch(sidCookie, /Domain=/);
});
test('a cookie session can read, and a bad or forged cookie is refused and cleared', async () => {
  const { cookie } = await cookieLogin(alice);
  const ok = await raw('GET', '/api/me', { headers: { cookie } }); assert.equal(ok.status, 200); assert.equal(ok.data.user.email, alice.email);
  const bad = await raw('GET', '/api/me', { headers: { cookie: 'pm_sid=' + 'a'.repeat(64) } });
  assert.equal(bad.status, 401); assert.ok(bad.cookies.some((c) => /^pm_sid=;/.test(c) && /Max-Age=0/.test(c)));
  assert.equal((await raw('GET', '/api/me', { headers: { cookie: 'pm_sid=not-a-token' } })).status, 401);
});

// ---------- CSRF ----------
const CHANGE = '/api/billing/auto-renew';
test('a change by cookie needs the CSRF token', async () => {
  const { cookie, csrf } = await cookieLogin(alice);
  const none = await raw('POST', CHANGE, { headers: { ...JSON_H, cookie, origin: s.base }, body: '{"auto":true}' }); assert.equal(none.status, 403);
  const wrong = await raw('POST', CHANGE, { headers: { ...JSON_H, cookie, origin: s.base, 'x-csrf-token': 'f'.repeat(64) }, body: '{"auto":true}' }); assert.equal(wrong.status, 403);
  const good = await raw('POST', CHANGE, { headers: { ...JSON_H, cookie, origin: s.base, 'x-csrf-token': csrf }, body: '{"auto":true}' }); assert.equal(good.status, 200);
  assert.ok((await waitEvent('csrf_blocked')).length >= 1, 'blocked requests are logged (repeats in one minute are folded into one entry)');
});
test('a CSRF token from one session does not work for another', async () => {
  const a = await cookieLogin(alice), b = await cookieLogin(bob);
  const r = await raw('POST', CHANGE, { headers: { ...JSON_H, cookie: a.cookie, origin: s.base, 'x-csrf-token': b.csrf }, body: '{"auto":true}' });
  assert.equal(r.status, 403);
});
test('a change from another site is refused even with a valid CSRF token', async () => {
  const { cookie, csrf } = await cookieLogin(alice);
  const h = { ...JSON_H, cookie, 'x-csrf-token': csrf };
  assert.equal((await raw('POST', CHANGE, { headers: { ...h, origin: 'https://evil.example' }, body: '{"auto":true}' })).status, 403);
  assert.equal((await raw('POST', CHANGE, { headers: { ...h, origin: 'null' }, body: '{"auto":true}' })).status, 403);
  assert.equal((await raw('POST', CHANGE, { headers: { ...h, origin: s.base, 'sec-fetch-site': 'cross-site' }, body: '{"auto":true}' })).status, 403);
  assert.equal((await raw('POST', CHANGE, { headers: { ...h, referer: 'https://evil.example/x' }, body: '{"auto":true}' })).status, 403);
  assert.equal((await raw('POST', CHANGE, { headers: { ...h, origin: s.base, 'sec-fetch-site': 'same-origin' }, body: '{"auto":true}' })).status, 200);
  assert.ok((await waitEvent('origin_blocked')).length >= 1);
});
test('bearer token requests from scripts need no CSRF token', async () => {
  assert.equal((await s.call('POST', CHANGE, { auto: true }, alice.token)).status, 200);
});
test('logging out by cookie from another site is refused, from our own page it ends the session', async () => {
  const { cookie, csrf } = await cookieLogin(alice);
  assert.equal((await raw('POST', '/api/auth/logout', { headers: { cookie, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw('GET', '/api/me', { headers: { cookie } })).status, 200, 'still signed in');
  const out = await raw('POST', '/api/auth/logout', { headers: { cookie, origin: s.base, 'x-csrf-token': csrf } });
  assert.equal(out.status, 200); assert.ok(out.cookies.some((c) => /^pm_sid=;/.test(c) && /Max-Age=0/.test(c)));
  assert.equal((await raw('GET', '/api/me', { headers: { cookie } })).status, 401);
});
test('an old stored token can be traded for a cookie once', async () => {
  const u = await s.user('Legacy');
  const r = await raw('POST', '/api/auth/session', { headers: { authorization: 'Bearer ' + u.token, 'x-session-mode': 'cookie' } });
  assert.equal(r.status, 200); assert.equal(r.data.token, undefined);
  const j = jar(r.cookies); assert.equal(j.pm_sid, u.token);
  assert.equal((await raw('POST', '/api/auth/session', { headers: { authorization: 'Bearer ' + 'b'.repeat(64) } })).status, 401);
});
test('changing the password by cookie rotates the cookie and returns no token', async () => {
  const u = await s.user('Rot');
  const { cookie, csrf } = await cookieLogin(u);
  const r = await raw('POST', '/api/me/password', { headers: { ...JSON_H, cookie, origin: s.base, 'x-csrf-token': csrf }, body: JSON.stringify({ current: 'Pm-Test-4821', next: 'Another-Pass-7733' }) });
  assert.equal(r.status, 200); assert.equal(r.data.token, undefined);
  const j = jar(r.cookies); assert.match(j.pm_sid, /^[0-9a-f]{64}$/);
  assert.equal((await raw('GET', '/api/me', { headers: { cookie } })).status, 401, 'old session is gone');
  assert.equal((await raw('GET', '/api/me', { headers: { cookie: 'pm_sid=' + j.pm_sid } })).status, 200, 'new session works');
});
test('two people sending the same request id never see each other\'s answer', async () => {
  const a = await cookieLogin(alice), b = await cookieLogin(bob);
  const id = 'same-request-id-12345';
  const ra = await raw('GET', '/api/me', { headers: { cookie: a.cookie, 'x-request-id': id } });
  const rb = await raw('POST', CHANGE, { headers: { ...JSON_H, cookie: b.cookie, origin: s.base, 'x-csrf-token': b.csrf, 'x-request-id': id }, body: '{"auto":true}' });
  assert.equal(ra.status, 200); assert.equal(rb.status, 200); assert.notDeepEqual(ra.data, rb.data);
});

// ---------- transport, headers and files ----------
test('every response carries the security headers', async () => {
  for (const path of ['/', '/api/me', '/login.html']) {
    const r = await raw('GET', path);
    assert.match(r.headers['strict-transport-security'], /includeSubDomains/, path);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', path);
    assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin-allow-popups', path);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/, path);
    assert.match(r.headers['content-security-policy'], /object-src 'none'/, path);
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', path);
  }
});
test('hidden files, unlisted types and folder escapes are not served', async () => {
  for (const p of ['/.env', '/.git/config', '/vendor/README.md', '/%2e%2e/package.json', '/..%2fserver%2fapp.js', '/app.js%00.png', '/.hidden/x.js']) {
    const r = await raw('GET', p); assert.ok([400, 403, 404].includes(r.status), `${p} gave ${r.status}`);
    assert.doesNotMatch(r.buf.toString(), /"dependencies"|createServer/, p);
  }
  assert.equal((await raw('GET', '/app.js')).status, 200);
  assert.ok((await waitEvent('suspicious_request')).length >= 1);
});
test('a forged Host or X-Forwarded-Host never ends up in a link', async () => {
  for (const h of [{ 'x-forwarded-host': 'evil.example/<script>' }, { 'x-forwarded-host': 'evil.example, attacker.example"' }, { 'x-forwarded-host': 'a b' }]) {
    const r = await raw('GET', '/robots.txt', { headers: h });
    assert.doesNotMatch(r.buf.toString(), /script|attacker|a b|"/i, JSON.stringify(h));
  }
});
test('in production plain http is sent to https and the health check is exempt', async () => {
  const p = await start({ production: true, opsJobs: false, snapshotJob: false, noScheduler: true });
  try {
    const r = await raw('GET', '/login.html?x=1', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'app.example.com' } }, p.base);
    assert.equal(r.status, 308); assert.equal(r.headers.location, 'https://app.example.com/login.html?x=1');
    assert.equal((await raw('GET', '/login.html', { headers: { 'x-forwarded-proto': 'https' } }, p.base)).status, 200);
    assert.equal((await raw('GET', '/healthz', { headers: { 'x-forwarded-proto': 'http' } }, p.base)).status, 200);
    assert.equal((await raw('POST', '/api/auth/login', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'a.example.com' }, body: '{}' }, p.base)).status, 308);
    const r2 = await raw('GET', '//evil.example/x', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'app.example.com' } }, p.base);
    assert.match(r2.headers.location, /^https:\/\/app\.example\.com\//);
    // in production the cookies are always Secure
    const u = await p.user('Prod'); const l = await raw('POST', '/api/auth/login', { headers: { ...JSON_H, 'x-forwarded-proto': 'https', 'x-session-mode': 'cookie' }, body: JSON.stringify({ email: u.email, password: 'Pm-Test-4821' }) }, p.base);
    assert.ok(l.cookies.some((c) => /^__Host-pm_sid=/.test(c) && /; Secure/.test(c)));
  } finally { await p.close(); }
});

// ---------- rate limits and the security log ----------
test('failed sign ins are logged with the address, and a non email never reaches the log', async () => {
  const bad = await raw('POST', '/api/auth/login', { headers: JSON_H, body: JSON.stringify({ email: alice.email, password: 'wrong-password-1' }) });
  assert.equal(bad.status, 401);
  await raw('POST', '/api/auth/login', { headers: JSON_H, body: JSON.stringify({ email: 'My-Secret-Pass-99!', password: 'x' }) });
  const ev = await waitEvent('login_failed', 2);
  assert.ok(ev.some((e) => e.email === alice.email && e.detail.reason === 'wrong_password'));
  assert.ok(ev.some((e) => e.email === '[not an email]'));
  assert.ok(!JSON.stringify(ev).includes('My-Secret-Pass-99'));
  assert.ok(!JSON.stringify(ev).includes('wrong-password-1'));
});
test('guessing a password locks the sign in and raises an alert', async () => {
  const u = await s.user('Target');
  let last;
  for (let i = 0; i < 12; i++) last = await raw('POST', '/api/auth/login', { headers: JSON_H, body: JSON.stringify({ email: u.email, password: 'guess-' + i + '-aaaa' }) });
  assert.equal(last.status, 429);
  assert.equal((await raw('POST', '/api/auth/login', { headers: JSON_H, body: JSON.stringify({ email: u.email, password: 'Pm-Test-4821' }) })).status, 429, 'even the right password waits');
  assert.ok((await waitEvent('login_locked')).length >= 1);
  assert.ok((await waitEvent('bruteforce_suspected')).length >= 1);
});
test('the sign in route has its own address limit', async () => {
  const p = await start({ authRate: 5, opsJobs: false, snapshotJob: false, noScheduler: true });
  try {
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await raw('POST', '/api/auth/login', { headers: JSON_H, body: JSON.stringify({ email: 'nobody@test.co', password: 'x' }) }, p.base)).status);
    assert.ok(codes.slice(0, 5).every((c) => c === 401), codes.join()); assert.ok(codes.slice(5).every((c) => c === 429), codes.join());
    const ev = (await p.app.db.query("SELECT 1 FROM security_events WHERE type = 'rate_limited'")).rows; await p.until(async () => (await p.app.db.query("SELECT 1 FROM security_events WHERE type = 'rate_limited'")).rows.length, 5000); assert.ok(ev !== null);
  } finally { await p.close(); }
});
test('uploads are limited per person', async () => {
  const p = await start({ uploadRate: 3, opsJobs: false, snapshotJob: false, noScheduler: true });
  try {
    const u = await p.user('Up'); const codes = [];
    for (let i = 0; i < 5; i++) { const fd = new FormData(); fd.append('name', 'P' + i); codes.push((await p.call('POST', '/api/projects', fd, u.token)).status); }
    assert.deepEqual(codes.slice(0, 3), [200, 200, 200]); assert.deepEqual(codes.slice(3), [429, 429]);
  } finally { await p.close(); }
});
test('a normal user hitting the admin area is refused and logged, admins see the security feed', async () => {
  assert.equal((await s.call('GET', '/api/admin/security', null, alice.token)).status, 403);
  assert.ok((await waitEvent('admin_denied')).length >= 1);
  const r = await s.call('GET', '/api/admin/security', null, boss.token);
  assert.equal(r.status, 200); assert.ok(r.data.total > 0); assert.ok(r.data.summary.high >= 1);
  assert.ok(Array.isArray(r.data.checks)); assert.ok(r.data.events.every((e) => e.type && e.severity && e.at));
  const f = await s.call('GET', '/api/admin/security?severity=high&type=admin_denied&q=' + encodeURIComponent("' OR 1=1 --"), null, boss.token);
  assert.equal(f.status, 200); assert.equal(f.data.events.length, 0);
  const o = await s.call('GET', '/api/admin/overview', null, boss.token); assert.ok(o.data.security24.high >= 1);
});

// ---------- injection ----------
test('search boxes and names treat quotes and SQL as plain text', async () => {
  const evil = "x'); DROP TABLE users; --";
  for (const p of ['/api/admin/users?q=', '/api/admin/projects?q=', '/api/admin/audit?q=', '/api/admin/errors?q=']) {
    const r = await s.call('GET', p + encodeURIComponent(evil), null, boss.token); assert.equal(r.status, 200, p);
  }
  assert.equal((await s.call('GET', '/api/admin/users?page=1;DROP&size=abc', null, boss.token)).status, 200);
  const fd = new FormData(); fd.append('name', evil);
  const pr = await s.call('POST', '/api/projects', fd, alice.token); assert.equal(pr.status, 200); assert.equal(pr.data.project.name, evil);
  assert.equal((await s.call('GET', '/api/admin/users', null, boss.token)).status, 200, 'users table still there');
});
test('errors never show a stack trace', async () => {
  const r = await s.call('POST', '/api/projects', '{not json', alice.token, { 'content-type': 'application/json' });
  assert.ok(r.status >= 400 && r.status < 500); assert.doesNotMatch(r.buf.toString(), /at .*\.js:\d+|node_modules|\/home\//);
  const nf = await s.call('GET', '/api/projects/999999999/tasks', null, alice.token); assert.doesNotMatch(nf.buf.toString(), /at .*\.js:\d+|node_modules/);
});

// ---------- password reset links ----------
test('a reset link works once, only for the right person, and expires', async () => {
  const u = await s.user('Forgot');
  const old = await cookieLogin(u);
  assert.equal((await s.call('POST', `/api/admin/users/${u.id}/reset-link`, {}, alice.token)).status, 403, 'only admins make links');
  const mk = await s.call('POST', `/api/admin/users/${u.id}/reset-link`, {}, boss.token);
  assert.equal(mk.status, 200); assert.equal(mk.data.minutes, 30);
  assert.match(mk.data.url, /\/login\.html#reset=[0-9a-f]{64}$/);
  const token = mk.data.url.split('#reset=')[1];
  const row = (await s.app.db.query('SELECT * FROM password_resets WHERE user_id = $1', [u.id])).rows;
  assert.equal(row.length, 1); assert.notEqual(row[0].token_hash, token, 'only a hash is stored'); assert.ok(!JSON.stringify(row).includes(token));
  const left = new Date(row[0].expires_at) - Date.now(); assert.ok(left > 28 * 60e3 && left <= 30 * 60e3, 'expires in about 30 minutes');
  // a weak password is refused and does not burn the link
  assert.equal((await raw('POST', '/api/auth/reset', { headers: JSON_H, body: JSON.stringify({ token, password: 'password1' }) })).status, 400);
  const done = await raw('POST', '/api/auth/reset', { headers: JSON_H, body: JSON.stringify({ token, password: 'Brand-New-Pass-5521' }) });
  assert.equal(done.status, 200); assert.equal(done.data.token, undefined, 'a reset does not sign anyone in');
  assert.equal((await raw('POST', '/api/auth/reset', { headers: JSON_H, body: JSON.stringify({ token, password: 'Second-Try-Pass-5521' }) })).status, 400, 'used once');
  assert.equal((await raw('GET', '/api/me', { headers: { cookie: old.cookie } })).status, 401, 'old sessions end');
  assert.equal((await s.call('POST', '/api/auth/login', { email: u.email, password: 'Pm-Test-4821' })).status, 401);
  assert.equal((await s.call('POST', '/api/auth/login', { email: u.email, password: 'Brand-New-Pass-5521' })).status, 200);
  assert.ok((await waitEvent('password_reset_used')).length >= 1);
});
test('an expired, replaced, forged or malformed link is refused', async () => {
  const u = await s.user('Late');
  const t1 = (await s.call('POST', `/api/admin/users/${u.id}/reset-link`, {}, boss.token)).data.url.split('#reset=')[1];
  await s.app.db.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [u.id]);
  const body = (token) => JSON.stringify({ token, password: 'Fresh-Pass-Word-1234' });
  assert.equal((await raw('POST', '/api/auth/reset', { headers: JSON_H, body: body(t1) })).status, 400, 'expired');
  const t2 = (await s.call('POST', `/api/admin/users/${u.id}/reset-link`, {}, boss.token)).data.url.split('#reset=')[1];
  const t3 = (await s.call('POST', `/api/admin/users/${u.id}/reset-link`, {}, boss.token)).data.url.split('#reset=')[1];
  assert.equal((await raw('POST', '/api/auth/reset', { headers: JSON_H, body: body(t2) })).status, 400, 'replaced by a newer link');
  for (const bad of ['', 'abc', 'f'.repeat(64), null, { a: 1 }, "' OR 1=1 --"]) assert.equal((await raw('POST', '/api/auth/reset', { headers: JSON_H, body: JSON.stringify({ token: bad, password: 'Fresh-Pass-Word-1234' }) })).status, 400);
  assert.equal((await raw('POST', '/api/auth/reset', { headers: JSON_H, body: body(t3) })).status, 200);
  assert.ok((await waitEvent('password_reset_failed')).length >= 1);
});
test('guessing reset links is rate limited', async () => {
  let last; for (let i = 0; i < 14; i++) last = await raw('POST', '/api/auth/reset', { headers: JSON_H, body: JSON.stringify({ token: i.toString(16).padStart(64, '0'), password: 'Fresh-Pass-Word-1234' }) });
  assert.equal(last.status, 429);
});

// ---------- uploads ----------
const form = (name, bytes, type = 'application/octet-stream', extra = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(extra)) fd.append(k, v); fd.append('files', new Blob([bytes], { type }), name); return fd; };
test('uploads must be an allowed type whose first bytes match', async () => {
  const p = await s.project(alice.token, 'Uploads');
  const docs = async () => (await s.call('GET', '/api/projects/' + p.id, null, alice.token));
  const bad = [['setup.exe', 'MZ\x90\x00'], ['page.svg', '<svg onload=alert(1)>'], ['fake.pdf', 'MZ not a pdf'], ['fake.docx', 'just text'], ['fake.png', 'GIF89a...'], ['notes.txt', Buffer.from([0x68, 0, 0x69, 0])], ['empty.txt', ''], ['archive.zip', 'PK\x03\x04'], ['x.html.exe', 'MZ']];
  for (const [name, bytes] of bad) {
    const r = await s.call('POST', `/api/projects/${p.id}/documents`, form(name, bytes, 'application/pdf', { purpose: 'store' }), alice.token);
    assert.equal(r.status, 415, `${name} gave ${r.status}`);
  }
  const mk = await s.call('POST', '/api/projects', form('contract.exe', 'MZ', 'application/octet-stream', { name: 'Has a bad file' }), alice.token); assert.equal(mk.status, 415);
  const noProject = await s.call('GET', '/api/projects', null, alice.token); assert.ok(!noProject.data.projects.some((x) => x.name === 'Has a bad file'), 'no project is created when a file is refused');
  assert.ok((await waitEvent('upload_rejected')).length >= 1);
  const ok = await s.call('POST', `/api/projects/${p.id}/documents`, form('notes.txt', 'hello world', 'text/html', { purpose: 'store' }), alice.token);
  assert.equal(ok.status, 200); assert.equal(ok.data.results.length, 1);
  const pdf = await s.call('POST', `/api/projects/${p.id}/documents`, form('real.pdf', '%PDF-1.4\n%%EOF', 'application/pdf', { purpose: 'store' }), alice.token);
  assert.equal(pdf.status, 200);
  assert.ok((await docs()).status === 200);
});
test('a stored file is sent back with a type chosen by the server, as a download', async () => {
  const p = await s.project(alice.token, 'Download');
  const up = await s.call('POST', `/api/projects/${p.id}/documents`, form('note.txt', '<script>alert(1)</script>', 'text/html', { purpose: 'store' }), alice.token);
  const id = up.data.results[0].id;
  const r = await s.call('GET', `/api/projects/${p.id}/documents/${id}/file`, null, alice.token);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/plain/); assert.match(r.headers.get('content-disposition'), /^attachment/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

// ---------- payments ----------
test('on the live site nobody can start a paid period without paying', async () => {
  const before = process.env.REPLIT_DEPLOYMENT; process.env.REPLIT_DEPLOYMENT = '1';
  try {
    const u = await s.user('Cheat');
    const r = await s.call('POST', '/api/billing/subscribe', {}, u.token);
    assert.equal(r.status, 403); assert.match(r.data.error, /not connected/i);
    const b = await s.call('GET', '/api/billing', null, u.token); assert.equal(b.data.billing.state, 'trial'); assert.equal(b.data.billing.self_serve, false);
    assert.ok((await waitEvent('subscribe_blocked')).length >= 1);
    // a client can never choose the price or the amount
    assert.equal((await s.call('POST', '/api/billing/subscribe', { price_cents: 1, amount_cents: 1, status: 'active' }, u.token)).status, 403);
    process.env.DEMO_BILLING = '1';
    assert.equal((await s.call('POST', '/api/billing/subscribe', { price_cents: 1 }, u.token)).status, 200, 'the demo switch still works when set on purpose');
    const paid = await s.app.db.query("SELECT amount_cents, status FROM payments WHERE user_id = $1", [u.id]);
    assert.equal(paid.rows[0].status, 'demo'); assert.notEqual(Number(paid.rows[0].amount_cents), 1, 'the price comes from the server');
  } finally { delete process.env.DEMO_BILLING; if (before === undefined) delete process.env.REPLIT_DEPLOYMENT; else process.env.REPLIT_DEPLOYMENT = before; }
});
test('outside production the demo checkout still works', async () => {
  const u = await s.user('Demo'); assert.equal((await s.call('POST', '/api/billing/subscribe', {}, u.token)).status, 200);
});

// ---------- environment checks ----------
test('the environment check flags the settings that matter on the live site', () => {
  const bad = sec.checkEnvironment({ DEMO_ACCOUNT: '1', SUPER_ADMIN_ALLOW_REGISTER: '1', CSP_MODE: 'off', APP_SECRET: 'short', DATABASE_URL: 'postgres://u:p@db.example.com/x', SITE_URL: 'http://x.example.com', DEMO_BILLING: '1' }, true);
  const lv = (id) => (bad.find((c) => c.id === id) || {}).level;
  for (const id of ['DEMO_ACCOUNT', 'SUPER_ADMIN_ALLOW_REGISTER', 'CSP_MODE', 'APP_SECRET', 'SITE_URL']) assert.equal(lv(id), 'error', id);
  assert.equal(lv('DATABASE_URL'), 'warn'); assert.equal(lv('DEMO_BILLING'), 'warn');
  const good = sec.checkEnvironment({ APP_SECRET: 'x'.repeat(40), SITE_URL: 'https://app.example.com', SUPER_ADMIN_EMAILS: 'a@b.co', DATABASE_URL: 'postgres://u:p@db.example.com/x?sslmode=require', TRUST_PROXY_HOPS: '1' }, true);
  assert.deepEqual(good.filter((c) => c.level !== 'ok'), []);
});
test('cookie and host helpers reject odd input', () => {
  assert.equal(sec.cleanHost('app.example.com:8080'), 'app.example.com:8080'); assert.equal(sec.cleanHost('evil.com/x'), null); assert.equal(sec.cleanHost('a b'), null); assert.equal(sec.cleanHost('a"b'), null);
  assert.deepEqual(sec.parseCookies('a=1; b=%20x; a=2; =bad'), { a: '1', b: ' x' });
});

test('a request body that is not an object is refused with 400, never a 500', async () => {
  for (const body of ['5', '"text"', 'true']) {
    const r = await raw('PUT', '/api/me', { headers: { ...JSON_H, authorization: `Bearer ${alice.token}` }, body });
    assert.equal(r.status, 400, body);
  }
  const p = await s.project(alice.token, 'Logo probe', 'Scope: portal.');
  const r = await raw('POST', `/api/projects/${p.id}/logo`, { headers: { ...JSON_H, authorization: `Bearer ${alice.token}` }, body: '{}' });
  assert.equal(r.status, 400);
});
