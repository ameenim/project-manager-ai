// The web server: static pages, sign in, and the authenticated /api. createApp() builds everything around a
// database so tests can run the real thing on a throwaway one.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const dbm = require('./db');
const { Store } = require('./store');
const authm = require('./auth');
const { Connectors } = require('./connectors');
const createApi = require('./api');
const { MODEL } = require('./claude');
const { createChat } = require('./chat/chat');

const ROOT = path.join(__dirname, '..', 'public');
const MAX_UPLOAD = 40 * 1024 * 1024;       // one file
const MAX_JSON = 8 * 1024 * 1024;          // a normal JSON request
const MAX_IMPORT = 64 * 1024 * 1024;       // a backup file, which can carry original documents
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8' };

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const json = (res, status, data, extra) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...(extra || {}) });
  res.end(body);
};
const bearer = (req) => { const h = String(req.headers.authorization || ''); return /^Bearer /i.test(h) ? h.slice(7).trim() : null; };
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// A simple allowance per address and minute, so one visitor cannot flood the server.
function limiter(max, windowMs) {
  const hits = new Map();
  const t = setInterval(() => { const now = Date.now(); for (const [k, l] of hits) { const keep = l.filter((x) => now - x < windowMs); if (keep.length) hits.set(k, keep); else hits.delete(k); } }, windowMs).unref();
  return (key) => { const now = Date.now(); const l = (hits.get(key) || []).filter((x) => now - x < windowMs); l.push(now); hits.set(key, l); return l.length > max; };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('The request is too large'), { status: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
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
  const db = opts.db || (await dbm.open(opts.dbOptions || {}));
  stage('database ready; store init');
  const store = new Store(db);
  try { await store.init(); }
  catch (error) { await db.close().catch(() => {}); throw error; }
  stage('store ready');
  const auth = authm.make(db);
  const connectors = new Connectors(db, opts.connectorOptions || {});
  const api = createApi(store, auth, connectors);
  // The Project Chat. opts.chatModel lets tests replace the model with a scripted one.
  const chat = createChat({ db, store, api, auth, model: opts.chatModel });
  const apiLimit = limiter(Number(process.env.API_RATE || 900), 60e3);
  const signupLimit = limiter(30, 3600e3);
  const origin = (req) => { const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim(); return (process.env.SITE_URL || `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost'}`).replace(/\/+$/, ''); };

  // The optional demo account. It is off unless asked for, because everyone who knows its password shares its data.
  if (opts.demoAccount || process.env.DEMO_ACCOUNT === '1') {
    const exists = await store.userByEmail('pm@example.com');
    if (!exists) {
      const r = await auth.register({ name: 'Demo Project Manager', email: 'pm@example.com', password: 'demo1234' });
      const u = await auth.userForToken(r.token);
      await api.handle({ user: u, method: 'POST', path: '/api/workspace/sample', query: {}, body: {} });
    }
  }
  if (!opts.noScheduler) { const tick = setInterval(() => api.runDueSyncs().catch((e) => console.error('sync tick', e.message)), 60e3); tick.unref(); }
  setInterval(() => auth.purgeExpired().catch(() => {}), 3600e3).unref();

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
    if (apiLimit(clientIp(req))) return json(res, 429, { error: 'Too many requests. Wait a moment and try again.' });

    // ----- sign in, no token needed
    if (method === 'POST' && /^\/api\/auth\/(login|register|logout)$/.test(p)) {
      const kind = p.split('/')[3];
      if (kind === 'logout') { await auth.logout(bearer(req)); return json(res, 200, { ok: true }); }
      if (kind === 'register' && signupLimit(clientIp(req))) return json(res, 429, { error: 'Too many new accounts from this address. Try again later.' });
      let body; try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch (e) { return json(res, e.status || 400, { error: e.status === 413 ? 'The request is too large' : 'Invalid request' }); }
      const r = kind === 'register' ? await auth.register(body) : await auth.login(body, clientIp(req));
      const user = await auth.userForToken(r.token);
      return json(res, 200, { token: r.token, user: api.userView(user) });
    }

    const token = bearer(req);
    const user = await auth.userForToken(token);
    if (!user) return json(res, 401, { error: 'Your session has expired. Sign in again.' });

    if (p.startsWith('/api/chat') && (await chat.route(req, res, url, user, { json, readBody, SECURITY }))) return;

    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const ct = String(req.headers['content-type'] || '');
      const big = /\/api\/(projects|workspace)\/import$/.test(p);
      if (ct.startsWith('multipart/form-data')) body = await readMultipart(req, big ? MAX_IMPORT : MAX_UPLOAD * 4);
      else {
        const raw = await readBody(req, big ? MAX_IMPORT : MAX_JSON);
        if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return json(res, 400, { error: 'The request body is not valid JSON' }); } }
      }
    }
    const out = await api.handle({ user, method, path: p, query: Object.fromEntries(url.searchParams), body, origin: origin(req) });
    if (out instanceof api.FileResult) {
      const name = encodeURIComponent(out.filename).replace(/['()]/g, escape);
      res.writeHead(200, { 'Content-Type': out.type, 'Content-Length': out.buffer.length, 'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${name}`, 'Cache-Control': 'no-store', ...SECURITY });
      return res.end(out.buffer);
    }
    return json(res, 200, out);
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

  function serveStatic(req, res, url) {
    const o = origin(req);
    if (req.method === 'GET' && url.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY }); return res.end('User-agent: *\nAllow: /\nDisallow: /app.html\nDisallow: /api/\n\nSitemap: ' + o + '/sitemap.xml\n'); }
    if (req.method === 'GET' && url.pathname === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY }); return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>' + o + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n'); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY }); return res.end(); }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return fs.readFile(path.join(ROOT, 'index.html'), 'utf8', (err, html) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
        const tags = '<link rel="canonical" href="' + o + '/">\n<meta property="og:url" content="' + o + '/">\n<meta property="og:image" content="' + o + '/brand/mark-512.png">\n<meta name="twitter:image" content="' + o + '/brand/mark-512.png">\n';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY });
        res.end(html.replace('</head>', tags + '</head>'));
      });
    }
    let urlPath; try { urlPath = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
    if (urlPath.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
    const file = path.normalize(path.join(ROOT, urlPath));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz') { await db.query('SELECT 1'); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/srv/ai/status') return json(res, 200, { configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
      if (req.method === 'GET' && /^\/oauth\/callback\/(jira|outlook)$/.test(url.pathname)) return await oauthCallback(req, res, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status >= 500 && !e.expose) { const id = crypto.randomBytes(4).toString('hex'); console.error(`[${id}] ${req.method} ${url.pathname}`, e); if (!res.headersSent) return json(res, 500, { error: `Something went wrong on the server (reference ${id}). Try again.` }); return res.end(); }
      if (!res.headersSent) return json(res, status, { error: e.message });
      res.end();
    }
  });
  server.requestTimeout = 5 * 60e3;
  server.headersTimeout = 30e3;
  server.keepAliveTimeout = 65e3;

  async function close() {
    snapTimers.forEach((x) => { clearTimeout(x); clearInterval(x); });
    await new Promise((ok) => server.close(ok));
    await snapRun;
    await store.flush();
    await db.close();
  }
  return { server, store, db, auth, api, chat, close };
}

module.exports = { createApp };
