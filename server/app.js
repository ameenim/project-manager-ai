// The web server: static pages, sign in, and the authenticated /api. createApp() builds everything around a
// database so tests can run the real thing on a throwaway one.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Workspaces } = require('./workspaces');
const { Ledger } = require('./ledger');
const { Scope } = require('./scope');
const { Rollups } = require('./rollups');
const { Orgs } = require('./orgs');
const { Programs } = require('./programs');
const { Portfolios } = require('./portfolios');
const { Scim } = require('./scim');
const zlib = require('zlib');
const Busboy = require('busboy');
const dbm = require('./db');
const { Store } = require('./store');
const authm = require('./auth');
const { clientIp } = require('./net');
const sec = require('./security');
const trace = require('./trace');
const { Connectors } = require('./connectors');
const createApi = require('./api');
const { MODEL } = require('./claude');
const { createChat } = require('./chat/chat');
const { createNotifications } = require('./notifications');
const { Ops } = require('./ops');
const createAdmin = require('./admin');
const { Testbed } = require('./testbed');
const { createUsage } = require('./usage');
const { Tickets } = require('./tickets');

const ROOT = path.join(__dirname, '..', 'public');
const PKG = require('../package.json');
const STARTED = new Date().toISOString();
const MAX_UPLOAD = 40 * 1024 * 1024;       // one file
const MAX_JSON = 8 * 1024 * 1024;          // a normal JSON request
const MAX_IMPORT = 64 * 1024 * 1024;       // a backup file, which can carry original documents
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8' };

// The Content Security Policy tells the browser which sources a page may load from, so an injected script cannot run
// or send data anywhere else. Styles allow inline because the screens set colors with style attributes. Fonts come from
// Google Fonts. Set CSP_MODE=report-only to watch for problems without blocking, or CSP_MODE=off to remove it.
// Optional CDN. Set CDN_URL to the address of a content delivery network that pulls from this server (for example
// https://cdn.example.com) and the scripts and styles of every page are named from there, with the same versioned names, so the
// network can keep them for a year. Fonts come from there too, since the styles ask for them by address. Leave it unset and
// everything is served from this server as before.
const CDN = (() => { try { const u = new URL(process.env.CDN_URL || ''); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch (e) { return ''; } })();
const withCdn = (src) => (CDN ? `${src} ${CDN}` : src);
const CSP = [
  "default-src 'self'",
  withCdn("script-src 'self'"),
  withCdn("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"),
  withCdn("font-src 'self' https://fonts.gstatic.com data:"),
  withCdn("img-src 'self' data: blob:"),
  "media-src 'self' blob: data:",
  withCdn("connect-src 'self'"),
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(sec.isProduction() ? ['upgrade-insecure-requests'] : []),
].join('; ');
const cspMode = String(process.env.CSP_MODE || 'on').toLowerCase();
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'X-Permitted-Cross-Domain-Policies': 'none',
  ...(cspMode === 'off' ? {} : { [cspMode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy']: CSP }),
};

// Answers over about 1.4 KB are sent compressed when the browser accepts it: brotli when it can, gzip otherwise. A project or
// schedule answer is mostly repeated field names, so it shrinks to a fraction, and that is the part of a slow screen that no
// amount of server speed fixes. Brotli at a low quality is close to gzip in speed and smaller on the wire.
const json = (res, status, data, extra) => {
  const body = JSON.stringify(data);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...(extra || {}) };
  const accepts = String((res.req && res.req.headers['accept-encoding']) || '');
  const enc = body.length > 1400 ? (/\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null) : null;
  if (enc) {
    const done = (e, z) => {
      if (res.writableEnded || res.destroyed) return;
      if (e) { res.writeHead(status, headers); return res.end(body); }
      res.writeHead(status, { ...headers, 'Content-Encoding': enc, Vary: 'Accept-Encoding', 'Content-Length': z.length });
      res.end(z);
    };
    if (enc === 'br') return zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, done);
    return zlib.gzip(body, { level: 4 }, done);
  }
  res.writeHead(status, headers);
  res.end(body);
};
const bearer = (req) => { const h = String(req.headers.authorization || ''); return /^Bearer /i.test(h) ? h.slice(7).trim() : null; };
// A request carries its session either in an Authorization header (scripts and tests) or in the session cookie (the web
// app). Only the cookie needs CSRF protection, because a browser adds a cookie to a request on its own and never a header.
const credentials = (req) => { const b = bearer(req); if (b) return { token: b, via: 'bearer' }; const c = sec.sessionCookieOf(req); return c ? { token: c, via: 'cookie' } : { token: null, via: null }; };
const UNSAFE = (m) => m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';

// A simple allowance per address and minute, so one visitor cannot flood the server.
function limiter(max, windowMs) {
  const hits = new Map();
  const t = setInterval(() => { const now = Date.now(); for (const [k, l] of hits) { const keep = l.filter((x) => now - x < windowMs); if (keep.length) hits.set(k, keep); else hits.delete(k); } }, windowMs).unref();
  return (key) => { const now = Date.now(); const l = (hits.get(key) || []).filter((x) => now - x < windowMs); l.push(now); hits.set(key, l); return l.length > max; };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    // Too large: keep reading and throw the data away, then answer 413. Destroying the socket here made the
    // hosting proxy show a bare Bad Gateway instead of our message.
    let over = false;
    req.on('data', (c) => { size += c.length; if (size > limit) { over = true; chunks.length = 0; if (size > limit * 4) { reject(Object.assign(new Error('The request is too large'), { status: 413 })); req.destroy(); } return; } chunks.push(c); });
    req.on('end', () => (over ? reject(Object.assign(new Error('The request is too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

// multipart form data into something with get() and getAll(), the way a browser FormData behaves
function readMultipart(req, limit) {
  return new Promise((resolve, reject) => {
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD, files: 30, fields: 60, fieldSize: 2 * 1024 * 1024 } }); } catch (e) { return reject(Object.assign(new Error('The upload could not be read'), { status: 400 })); }
    const fields = [];
    let total = 0, failed = false;
    const fail = (e) => { if (failed) return; failed = true; reject(e); try { req.unpipe(bb); } catch (x) { /* already closed */ } req.resume(); };
    bb.on('field', (name, value) => fields.push([name, value]));
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => { total += c.length; if (total > limit) return fail(Object.assign(new Error('The upload is too large'), { status: 413 })); chunks.push(c); });
      stream.on('limit', () => fail(Object.assign(new Error(`${info.filename || 'A file'} is larger than 40 MB`), { status: 413 })));
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (!info.filename && !buffer.length) return;
        const filename = path.basename(String(info.filename || '').replace(/\\/g, '/')).slice(0, 250);
        fields.push([name, { name: filename, type: info.mimeType || 'application/octet-stream', size: buffer.length, buffer, text: async () => buffer.toString('utf8') }]);
      });
    });
    bb.on('error', (e) => fail(Object.assign(new Error('The upload could not be read'), { status: 400, cause: e })));
    bb.on('filesLimit', () => fail(Object.assign(new Error('Too many files in one upload'), { status: 413 })));
    bb.on('close', () => { if (!failed) resolve({ get: (k) => { const f = fields.find((x) => x[0] === k); return f ? f[1] : null; }, getAll: (k) => fields.filter((x) => x[0] === k).map((x) => x[1]) }); });
    req.pipe(bb);
  });
}

async function createApp(opts = {}) {
  const stage = opts.onStartupStage || (() => {});
  stage('database open');
  const db = trace.shared.instrumentDb(opts.db || (await dbm.open(opts.dbOptions || {})));
  stage('database ready; store init');
  const store = new Store(db);
  try { await store.init(); }
  catch (error) { await db.close().catch(() => {}); throw error; }
  stage('store ready');
  let ops = null;
  const production = opts.production !== undefined ? opts.production : sec.isProduction();
  const secLog = sec.createSecurityLog({ db, store });
  const auth = authm.make(db, async () => (ops ? (await ops.config()).session_minutes : 60), { event: (type, o) => secLog.log(type, o) });
  ops = new Ops(db, store);
  ops.security = secLog;
  const envChecks = () => sec.checkEnvironment(process.env, production);
  if (production || opts.envReport) for (const c of envChecks()) if (c.level !== 'ok') console.warn(`SECURITY CHECK [${c.level}] ${c.id}: ${c.message}`);
  await ops.backfillSubscriptions();
  const workspaces = new Workspaces(db, store);
  workspaces.currency = async () => (await ops.config()).currency || 'USD';
  await workspaces.init();
  ops.ledger = new Ledger(db, store, workspaces, ops);
  const scope = new Scope(db, workspaces, ops);
  const rollups = new Rollups(db, store, workspaces);
  const orgs = new Orgs({ db, store, workspaces, scope, ops });
  ops.orgs = orgs;
  const programs = new Programs({ db, store, orgs });
  ops.programs = programs;
  ops.portfolios = new Portfolios({ db, store, orgs, programs });
  const scim = new Scim({ db, store, orgs, auth });
  ops.scim = scim;
  store.onCreate = (P, ownerId) => workspaces.stampProject(P.id, ownerId);
  store.afterSave = (P, ver) => rollups.write(P, ver);
  if (workspaces.ready && opts.workspaceBackfill !== false) workspaces.backfillAll().catch((e) => console.error('workspace backfill', e.message));
  await ops.bootstrapSuperAdmins();
  if (opts.opsJobs !== false) ops.start();
  // Support tickets. opts.ticketAi and opts.ticketDispatcher let tests replace the Claude call and the GitHub dispatch.
  const tickets = new Tickets({ db, store, ops, ai: opts.ticketAi, dispatcher: opts.ticketDispatcher, version: PKG.version });
  const usage = createUsage({ db, store });
  const admin = createAdmin({ db, store, auth, ops, usage, tickets, secLog, envChecks });
  const connectors = new Connectors(db, opts.connectorOptions || {});
  const api = createApi(store, auth, connectors, ops);
  rollups.statsFn = (P) => api.stats(P);
  const testbed = new Testbed({ db, store, auth, ops, orgs, workspaces, api });
  ops.testbed = testbed;
  if (opts.testbed !== false) await testbed.seed().catch((e) => console.error('test organization', e.message));
  // The Project Chat. opts.chatModel lets tests replace the model with a scripted one.
  const chat = createChat({ db, store, api, auth, ops, model: opts.chatModel });
  const notifications = createNotifications({ db, store, api });
  require('./chat/tools').useServices({ notifications, tickets });
  const apiLimit = limiter(Number(process.env.API_RATE || 900), 60e3);
  const signupLimit = limiter(30, 3600e3);
  const clientErrLimit = limiter(30, 60e3);
  const usageLimit = limiter(120, 60e3);
  // Sign in, sign up and reset links are limited per address on top of the lockouts, and the costly routes per person.
  const authLimit = limiter(Number(opts.authRate || process.env.AUTH_RATE || 40), 60e3);
  const adminLimit = limiter(300, 60e3);
  const uploadLimit = limiter(Number(opts.uploadRate || 60), 60e3);
  const sessionSeconds = async () => { let m = 60; try { m = Number((await ops.config()).session_minutes) || 60; } catch (e) { /* default */ } return Math.min(30 * 86400, Math.max(60, m * 60)); };
  const origin = (req) => (process.env.SITE_URL || `${sec.isSecure(req) ? 'https' : 'http'}://${sec.hostOf(req)}`).replace(/\/+$/, '');

  // The optional demo account. It is off unless asked for, because everyone who knows its password shares its data.
  if (opts.demoAccount || process.env.DEMO_ACCOUNT === '1') {
    if (process.env.REPLIT_DEPLOYMENT) console.warn('SECURITY: DEMO_ACCOUNT is on in a live deployment. Its password is public, so anyone can sign in to it. Remove DEMO_ACCOUNT unless this is a demo site.');
    const exists = await store.userByEmail('pm@example.com');
    if (!exists) {
      const r = await auth.register({ name: 'Demo Project Manager', email: 'pm@example.com', password: 'demo1234' }, { skipPolicy: true });
      const u = await auth.userForToken(r.token);
      await api.handle({ user: u, method: 'POST', path: '/api/workspace/sample', query: {}, body: {} });
    }
  }
  if (!opts.noScheduler) { const tick = setInterval(() => api.runDueSyncs().catch((e) => console.error('sync tick', e.message)), 60e3); tick.unref(); }
  setInterval(() => { auth.purgeExpired().catch(() => {}); auth.purgeResets(); }, 3600e3).unref();
  if (opts.opsJobs !== false) { usage.prune(); setInterval(() => usage.prune(), 6 * 3600e3).unref(); secLog.prune(); setInterval(() => secLog.prune(), 6 * 3600e3).unref(); }

  // Daily snapshots of every project's key figures. The first capture runs shortly after start, then every hour.
  // A later capture on the same day replaces that day's row, so each day ends with its latest figures, and a
  // repeated run never adds a second row. Pass snapshotJob: false to turn the timer off (tests do).
  let snapRun = Promise.resolve();
  const snapTimers = [];
  if (opts.snapshotJob !== false) {
    const run = () => { snapRun = api.captureAll().catch((e) => console.error('daily snapshot failed', e.message)); return snapRun; };
    snapTimers.push(setTimeout(run, 8000), setInterval(run, 3600e3));
    snapTimers.forEach((x) => x.unref());
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    const p = url.pathname;
    const ip = clientIp(req);
    if (apiLimit(ip)) { secLog.log('rate_limited', { ip, path: p, throttleMs: 60e3, key: 'api' }); return json(res, 429, { error: 'Too many requests. Wait a moment and try again.' }); }
    const tooFast = () => { if (!authLimit(ip)) return false; secLog.log('rate_limited', { ip, path: p, throttleMs: 60e3, key: 'auth' }); return true; };

    // ----- sign in, no token needed
    if (method === 'POST' && /^\/api\/auth\/(login|register|logout|reset|forgot|session)$/.test(p)) {
      const kind = p.split('/')[3];
      if (kind === 'logout') {
        const c = credentials(req);
        // a page on another site must not be able to sign a person out
        if (c.via === 'cookie' && !sec.fromOwnSite(req)) { secLog.log('origin_blocked', { ip, path: p, throttleMs: 60e3 }); return json(res, 403, { error: 'This request did not come from the app.' }); }
        await auth.logout(c.token);
        return json(res, 200, { ok: true }, { 'Set-Cookie': sec.clearCookies(req) });
      }
      if (tooFast()) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
      // a browser that signed in before cookies existed trades its old stored token for a cookie, once
      if (kind === 'session') {
        const old = bearer(req); const u = await auth.userForToken(old);
        if (!u) return json(res, 401, { error: 'Your session has expired. Sign in again.' });
        secLog.log('session_upgraded', { ip, userId: u.id, path: p });
        return json(res, 200, { ok: true, user: api.userView(u) }, { 'Set-Cookie': sec.sessionCookies(req, old, await sessionSeconds()) });
      }
      if (kind === 'register' && signupLimit(ip)) return json(res, 429, { error: 'Too many new accounts from this address. Try again later.' });
      let body; try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch (e) { return json(res, e.status || 400, { error: e.status === 413 ? 'The request is too large' : 'Invalid request' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Invalid request' });
      if (kind === 'reset') return json(res, 200, await auth.resetPassword(body.token, body.password, ip));
      if (kind === 'forgot') return json(res, 200, await auth.requestReset(body.email, ip));
      if (kind === 'register') {
        if (!(await ops.config()).signup_enabled) return json(res, 403, { error: 'New sign ups are paused right now. Please try again later.' });
        // a super admin address cannot be claimed by signing up, so nobody can take the admin account by registering first
        if (ops.isReservedEmail(body && body.email) && process.env.SUPER_ADMIN_ALLOW_REGISTER !== '1') { secLog.log('reserved_email', { ip, path: p, throttleMs: 60e3 }); return json(res, 403, { error: 'This email address is reserved. Contact the administrator.' }); }
      }
      const r = kind === 'register' ? await auth.register(body) : await auth.login(body, ip);
      if (kind === 'register') { const u0 = await auth.userForToken(r.token); await ops.ensureSubscription(u0.id); await ops.bootstrapSuperAdmins(); secLog.log('register', { ip, userId: u0.id, path: p }); }
      const user = await auth.userForToken(r.token);
      // The web app sends X-Session-Mode: cookie and never receives the token itself. Scripts without that header get it as before.
      const web = String(req.headers['x-session-mode'] || '').toLowerCase() === 'cookie';
      return json(res, 200, web ? { user: api.userView(user) } : { token: r.token, user: api.userView(user) }, { 'Set-Cookie': sec.sessionCookies(req, r.token, await sessionSeconds()) });
    }

    // browser error reports. Anyone may send one, a signed in person is attached to it.
    if (method === 'POST' && p === '/api/client-error') {
      if (clientErrLimit(clientIp(req))) return json(res, 429, { error: 'Too many reports' });
      let b = {}; try { b = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid request' }); }
      const who = await auth.userForToken(credentials(req).token).catch(() => null);
      await ops.logError({ kind: 'browser', userId: who && who.id, path: b.url, message: b.message || 'Unknown error', stack: b.stack, agent: req.headers['user-agent'] });
      return json(res, 200, { ok: true });
    }

    // identity provider provisioning, signed with an organization token instead of a sign in
    if (p.startsWith('/scim/v2/')) { if (await scim.handle(req, res, url, { json, readBody, SECURITY })) return; }

    // the fix job calls these with a signature instead of a sign in
    if (p.startsWith('/api/hooks/tickets/')) { await tickets.hook(req, res, url, { json, readBody, SECURITY }); return; }

    const cred = credentials(req);
    const user = await auth.userForToken(cred.token);
    if (!user) {
      if (cred.token) secLog.log('session_invalid', { ip, path: p, throttleMs: 300e3, key: cred.via });
      return json(res, 401, { error: 'Your session has expired. Sign in again.' }, cred.via === 'cookie' ? { 'Set-Cookie': sec.clearCookies(req) } : undefined);
    }
    if (user.status === 'suspended') return json(res, 403, { error: 'This account is suspended. Contact support.' });
    // A request that changes something and rides on the cookie has to prove it came from our own page: the right origin,
    // and the CSRF token that only a page that could read our cookie knows.
    if (cred.via === 'cookie' && UNSAFE(method)) {
      if (!sec.fromOwnSite(req)) { secLog.log('origin_blocked', { ip, userId: user.id, path: p, throttleMs: 60e3 }); return json(res, 403, { error: 'This request did not come from the app. Reload the page and try again.' }); }
      if (!sec.safeEqual(req.headers['x-csrf-token'], sec.csrfFor(cred.token))) { secLog.log('csrf_blocked', { ip, userId: user.id, path: p, throttleMs: 60e3 }); return json(res, 403, { error: 'Your session could not be verified. Reload the page and try again.' }); }
    }
    ops.touchSeen(user.id);
    // usage steps from the browser (screen names and action names only). Never fails the page that sends them.
    if (method === 'POST' && p === '/api/usage') {
      if (usageLimit(clientIp(req))) return json(res, 429, { error: 'Too many reports' });
      let b = {}; try { b = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8') || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid request' }); }
      return json(res, 200, await usage.ingest(user, b));
    }
    if (p.startsWith('/api/admin') && adminLimit(user.id)) { secLog.log('rate_limited', { ip, userId: user.id, path: p, throttleMs: 60e3, key: 'admin' }); return json(res, 429, { error: 'Too many requests. Wait a moment and try again.' }); }
    if (await admin.route(req, res, url, user, { json, readBody, SECURITY, origin, event: (type, o) => secLog.log(type, { ip, ...o }) })) return;
    if (p.startsWith('/api/testbed') && (await testbed.route(req, res, url, user, cred, { json, readBody, SECURITY, sessionSeconds, userView: api.userView }))) return;
    if (!user.is_super && (await ops.config()).maintenance_mode && !/^\/api\/(me|billing)/.test(p)) return json(res, 503, { error: (await ops.config()).maintenance_message });

    if (p.startsWith('/api/tickets') && (await tickets.route(req, res, url, user, { json, readBody, SECURITY }))) return;
    if (p.startsWith('/api/chat') && (await chat.route(req, res, url, user, { json, readBody, SECURITY }))) return;
    if (p.startsWith('/api/notifications') && (await notifications.route(req, res, url, user, { json, readBody, SECURITY }))) return;

    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const ct = String(req.headers['content-type'] || '');
      const big = /\/api\/(projects|workspace)\/import$/.test(p) || /\/api\/projects\/\d+\/msproject\/import$/.test(p);
      if (ct.startsWith('multipart/form-data')) {
        if (uploadLimit(user.id)) { secLog.log('rate_limited', { ip, userId: user.id, path: p, throttleMs: 60e3, key: 'upload' }); return json(res, 429, { error: 'Too many uploads in a short time. Wait a minute and try again.' }); }
        body = await readMultipart(req, big ? MAX_IMPORT : MAX_UPLOAD * 4);
      }
      else {
        const raw = await readBody(req, big ? MAX_IMPORT : MAX_JSON);
        if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return json(res, 400, { error: 'The request body is not valid JSON' }); } }
        // a body is an object or a list, never a bare number, string or true/false
        if (body !== undefined && body !== null && typeof body !== 'object') return json(res, 400, { error: 'The request body must be a JSON object' });
      }
    }
    let out = await api.handle({ user, method, path: p, query: Object.fromEntries(url.searchParams), body, origin: origin(req), ip });
    // a password change signs every device out and hands this one a new session, so the cookie is replaced
    let cookies;
    if (p === '/api/me/password' && out && out.token) { cookies = sec.sessionCookies(req, out.token, await sessionSeconds()); if (cred.via === 'cookie') { out = { ...out }; delete out.token; } }
    if (out instanceof api.StreamResult) {
      const name = encodeURIComponent(out.filename).replace(/['()]/g, escape), gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
      res.writeHead(200, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${name}`, 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}), ...SECURITY });
      const sink = gz ? zlib.createGzip({ level: 4 }) : res;
      if (gz) sink.pipe(res);
      const wait = () => new Promise((ok) => sink.once('drain', ok));
      try {
        for await (const piece of out.parts()) { if (!sink.write(piece)) await wait(); }
        sink.end();
      } catch (e) { console.error('export stream', e.message); res.destroy(e); }
      return;
    }
    if (out instanceof api.FileResult) {
      const name = encodeURIComponent(out.filename).replace(/['()]/g, escape);
      res.writeHead(200, { 'Content-Type': out.type, 'Content-Length': out.buffer.length, 'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${name}`, 'Cache-Control': 'no-store', ...SECURITY });
      return res.end(out.buffer);
    }
    return json(res, 200, out, cookies ? { 'Set-Cookie': cookies } : undefined);
  }

  // The service sends the person back here after they allow access. This page needs no sign in: the one time state
  // value that was made when the connection started says who it belongs to.
  async function oauthCallback(req, res, url) {
    const kind = url.pathname.split('/')[3];
    const back = (ok, msg) => { res.writeHead(302, { Location: `/oauth-done.html?kind=${kind}&ok=${ok ? 1 : 0}${msg ? '&msg=' + encodeURIComponent(msg) : ''}`, 'Cache-Control': 'no-store', ...SECURITY }); res.end(); };
    if (apiLimit(clientIp(req))) return back(false, 'Too many attempts. Wait a moment and try again.');
    if (url.searchParams.get('error')) return back(false, url.searchParams.get('error') === 'access_denied' ? 'Access was not allowed, so nothing was connected.' : 'The service did not complete the sign in.');
    try {
      const r = await connectors.finish(kind, url.searchParams.get('code'), url.searchParams.get('state'));
      await connectors.saveFor(r.userId, kind, r);
      return back(true);
    } catch (e) {
      if (!e.status || e.status >= 500) console.error('oauth callback', kind, e.message);
      return back(false, e.status && e.status < 500 ? e.message : 'The connection could not be completed. Try again.');
    }
  }

  // ---------- static files ----------
  // Every file is read once and kept (checked against its modified time on each request, so an edit shows at once). It is
  // sent with an ETag, so a repeat visit gets a tiny "not modified" instead of the whole file, and text files are sent
  // compressed (brotli or gzip, made once and kept). Pages name their scripts and styles with a version taken from the file
  // itself, and a file asked for with that version is cached by the browser for a year, because a changed file gets a new
  // version and with it a new address.
  const assets = new Map();                 // file path to { mtimeMs, size, etag, buf }
  const compCache = new Map();              // key to a promise of the compressed bytes
  const COMPRESS = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt', '.xml']);
  const MEDIA = new Set(['.webp', '.avif', '.png', '.jpg', '.svg', '.ico', '.mp4']);
  const KEEP_BYTES = 3 * 1024 * 1024;
  async function assetOf(file) {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) { const e = new Error('not a file'); e.code = 'ENOENT'; throw e; }
    let a = assets.get(file);
    if (!a || a.mtimeMs !== st.mtimeMs || a.size !== st.size) {
      a = { mtimeMs: st.mtimeMs, size: st.size, etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`, buf: null };
      assets.set(file, a);
    }
    if (!a.buf) { const buf = await fs.promises.readFile(file); if (buf.length <= KEEP_BYTES) a.buf = buf; else return { ...a, buf }; }
    return a;
  }
  function compressed(key, enc, buf) {
    const k = key + '|' + enc;
    let p = compCache.get(k);
    if (!p) {
      p = new Promise((ok, no) => {
        const done = (e, r) => (e ? no(e) : ok(r));
        if (enc === 'br') zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, done);
        else zlib.gzip(buf, { level: 6 }, done);
      });
      compCache.set(k, p);
      if (compCache.size > 300) compCache.delete(compCache.keys().next().value);
      p.catch(() => compCache.delete(k));
    }
    return p;
  }
  const notModified = (req, etag) => String(req.headers['if-none-match'] || '').split(',').some((x) => x.trim().replace(/^W\//, '') === etag);
  async function sendBytes(req, res, { key, buf, type, etag, cache, compressible, shared }) {
    // with a CDN in front, scripts, styles and fonts must be readable from the page's other address
    const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': cache, Vary: 'Accept-Encoding', ...SECURITY, ...(CDN && shared ? { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' } : {}) };
    if (notModified(req, etag)) { res.writeHead(304, headers); return res.end(); }
    let body = buf;
    const accepts = String(req.headers['accept-encoding'] || '');
    const enc = compressible && buf.length > 1024 ? (/\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null) : null;
    if (enc) { try { body = await compressed(key + '|' + etag, enc, buf); headers['Content-Encoding'] = enc; } catch (e) { body = buf; } }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  // a page with its scripts and styles given a version taken from each file, kept for a few seconds
  const pages = new Map();
  async function pageHtml(file) {
    const hit = pages.get(file);
    if (hit && Date.now() - hit.at < 5000) return hit.html;
    let html = await fs.promises.readFile(file, 'utf8');
    const refs = [...new Set([...html.matchAll(/\s(?:src|href)="([^"#?:]+?\.(?:js|css))"/g)].map((m) => m[1]).filter((r) => !r.startsWith('/') && !r.includes('..')))];
    const ver = new Map();
    await Promise.all(refs.map(async (r) => { try { const a = await assetOf(path.join(ROOT, r)); ver.set(r, crypto.createHash('sha1').update(a.etag).digest('hex').slice(0, 10)); } catch (e) { /* left as it was */ } }));
    html = html.replace(/(\s(?:src|href)=")([^"#?:]+?\.(?:js|css))(")/g, (m, a, r, c) => (ver.has(r) ? `${a}${CDN ? CDN + '/' : ''}${r}?v=${ver.get(r)}${c}` : m));
    pages.set(file, { at: Date.now(), html });
    return html;
  }
  async function sendPage(req, res, file, extra) {
    let html;
    try { html = await pageHtml(file); } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }); return res.end('Not found'); }
    if (extra) html = extra(html);
    const buf = Buffer.from(html, 'utf8');
    const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"';
    return sendBytes(req, res, { key: file, buf, type: TYPES['.html'], etag, cache: 'no-cache', compressible: true });
  }

  async function serveStatic(req, res, url) {
    const o = origin(req);
    if (req.method === 'GET' && url.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY }); return res.end('User-agent: *\nAllow: /\nDisallow: /app.html\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ' + o + '/sitemap.xml\n'); }
    if (req.method === 'GET' && url.pathname === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY }); return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>' + o + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n'); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY }); return res.end(); }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const tags = '<link rel="canonical" href="' + o + '/">\n<meta property="og:url" content="' + o + '/">\n<meta property="og:image" content="' + o + '/brand/mark-512.png">\n<meta name="twitter:image" content="' + o + '/brand/mark-512.png">\n';
      return sendPage(req, res, path.join(ROOT, 'index.html'), (html) => html.replace('</head>', tags + '</head>'));
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') return sendPage(req, res, path.join(ROOT, 'admin.html'));
    const probe = (why) => secLog.log('suspicious_request', { ip: clientIp(req), path: url.pathname, detail: { why }, throttleMs: 60e3, key: why });
    let urlPath; try { urlPath = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400, SECURITY); return res.end('Bad request'); }
    if (urlPath.includes('\0')) { probe('null byte'); res.writeHead(400, SECURITY); return res.end('Bad request'); }
    const file = path.normalize(path.join(ROOT, urlPath));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { probe('path traversal'); res.writeHead(403, SECURITY); return res.end('Forbidden'); }
    // Only the file types the site actually serves are sent, and never a hidden file or folder (.env, .git and so on).
    if (urlPath.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known' && seg !== '')) { probe('hidden file'); res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    if (!TYPES[ext]) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }); return res.end('Not found'); }
    if (ext === '.html') return sendPage(req, res, file);
    let a;
    try { a = await assetOf(file); } catch (err) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }); return res.end('Not found'); }
    // a file asked for by the version a page named is the one that version stands for, so it never needs checking again
    const versioned = url.searchParams.has('v') && (ext === '.js' || ext === '.css');
    // Fonts and pictures do not change with a release and have no version in their name, so they are kept by the browser for
    // a while instead of being asked about on every page (the ETag still lets a changed file through when the time is up). A
    // picture may be shown from the kept copy for a week while a fresh one is fetched in the background.
    const cache = versioned ? 'public, max-age=31536000, immutable' : ext === '.woff2' ? 'public, max-age=2592000' : MEDIA.has(ext) ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-cache';
    return sendBytes(req, res, { key: file, buf: a.buf, type: TYPES[ext] || 'application/octet-stream', etag: a.etag, cache, compressible: COMPRESS.has(ext), shared: versioned || ext === '.woff2' || MEDIA.has(ext) });
  }

  // A change sent from the browser carries a request id. If the connection drops after the server did the work, the browser
  // sends the same change again with the same id, and the server answers with the first result instead of doing it twice.
  const IDEM_MS = 120e3, IDEM_MAX_BYTES = 1024 * 1024, idem = new Map();   // key to { at, done: promise of the saved answer or null }
  setInterval(() => { const n = Date.now(); for (const [k, v] of idem) if (n - v.at > IDEM_MS) idem.delete(k); }, 30e3).unref();
  async function idempotent(req, res, url, run) {
    const id = String(req.headers['x-request-id'] || '');
    if (req.method === 'GET' || req.method === 'HEAD' || !/^[\w-]{8,64}$/.test(id)) return run();
    const key = id + '|' + String(req.headers.authorization || sec.sessionCookieOf(req) || '');
    const prior = idem.get(key);
    if (prior) {
      const r = await prior.done;
      if (r) { res.writeHead(r.status, r.headers); return res.end(r.body); }
      return run();
    }
    let settle; const entry = { at: Date.now(), done: new Promise((ok) => { settle = ok; }) };
    idem.set(key, entry);
    const forgetIt = () => { if (idem.get(key) === entry) idem.delete(key); settle(null); };
    let status = 0, headers = null, size = 0, keep = true; const chunks = [];
    const wh = res.writeHead.bind(res), wr = res.write.bind(res), en = res.end.bind(res);
    const grab = (c) => { if (c == null || typeof c === 'function') return; const b = Buffer.isBuffer(c) ? c : Buffer.from(c); size += b.length; if (size > IDEM_MAX_BYTES) keep = false; else chunks.push(b); };
    res.writeHead = (s, h, ...rest) => { status = s; headers = h && typeof h === 'object' ? { ...h } : null; if (!headers || !/json/i.test(String(headers['Content-Type'] || '')) || s >= 500) keep = false; return wh(s, h, ...rest); };
    res.write = (c, ...rest) => { grab(c); return wr(c, ...rest); };
    res.end = (c, ...rest) => {
      grab(c);
      if (keep && status) { settle({ status, headers, body: Buffer.concat(chunks) }); } else forgetIt();
      return en(c, ...rest);
    };
    res.on('close', () => { if (!res.writableEnded) forgetIt(); });
    try { return await run(); } catch (e) { forgetIt(); throw e; }
  }

  // Each request runs inside a trace (see trace.js): Server-Timing on the answer, a log line when it is slow, and optional
  // OpenTelemetry export.
  const onRequest = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    ops.counters.requests++;
    try {
      // In production every page and call must use HTTPS. The proxy tells us how the person arrived. The health check is
      // exempt because the host's own probe may use plain http.
      if (production && sec.isPlainHttp(req) && url.pathname !== '/healthz') {
        const host = (process.env.SITE_URL && sec.cleanHost(new URL(process.env.SITE_URL).host)) || sec.hostOf(req);
        res.writeHead(308, { Location: `https://${host}${req.url.startsWith('/') ? req.url : '/'}`, 'Cache-Control': 'no-store', ...SECURITY });
        return res.end();
      }
      if (url.pathname === '/healthz') { await db.query('SELECT 1'); return json(res, 200, { ok: true, version: PKG.version, started: STARTED, admin: true }); }
      if (req.method === 'GET' && url.pathname === '/srv/ai/status') return json(res, 200, { configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
      if (req.method === 'GET' && /^\/oauth\/callback\/(jira|outlook)$/.test(url.pathname)) return await oauthCallback(req, res, url);
      if (url.pathname.startsWith('/scim/v2/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/api/')) return await idempotent(req, res, url, () => handleApi(req, res, url));
      return await serveStatic(req, res, url);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status >= 500 && !e.expose) { const id = crypto.randomBytes(4).toString('hex'); console.error(`[${id}] ${req.method} ${url.pathname}`, e); const rec = { kind: 'server', status, method: req.method, path: url.pathname, message: e.message, stack: e.stack, ref: id }; ops.logError(rec).then(() => tickets.noteServerError(rec)); if (!res.headersSent) return json(res, 500, { error: `Something went wrong on the server (reference ${id}). Try again.`, ref: id }); return res.end(); }
      if (!res.headersSent) return json(res, status, { error: e.message });
      res.end();
    }
  };
  const server = http.createServer((req, res) => trace.shared.request(req, res, () => onRequest(req, res)));
  // Cloud Run and Replit keep idle connections open for several minutes. If this server closes an idle connection first,
  // the browser's next request on it fails with "Cannot reach the server", so this server must be the last to let go.
  server.requestTimeout = 5 * 60e3;
  server.keepAliveTimeout = 650e3;
  server.headersTimeout = 660e3;

  async function close() {
    snapTimers.forEach((x) => { clearTimeout(x); clearInterval(x); });
    ops.stop();
    await new Promise((ok) => server.close(ok));
    await snapRun;
    await tickets.idle();
    await store.flush();
    await db.close();
  }
  return { server, store, db, auth, api, chat, ops, admin, tickets, workspaces, scope, rollups, orgs, programs, close };
}

module.exports = { createApp };
