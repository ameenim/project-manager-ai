'use strict';
// Pins the behavior of the speed pass: compressed answers, the trace header and slow request log, opt-in paging, the cache
// policy of fonts and pictures, the optional CDN, real user speed readings, the new indexes and the lazy screens.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { start } = require('./helpers');
const { createTracer, routeOf } = require('../server/trace');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
let s, boss, pm;
const PUB = path.join(__dirname, '..', 'public');

const raw = (p, headers = {}, token) => new Promise((ok, no) => {
  const port = s.app.server.address().port;
  http.get({ host: 'localhost', port, path: p, headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) } }, (r) => {
    const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) }));
  }).on('error', no);
});

before(async () => {
  s = await start({ opsJobs: false });
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id };
  pm = await s.user('Speed');
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, pm.token)).status, 200);
});
after(() => s.close());

test('a large API answer is sent with brotli when accepted, gzip otherwise, and decodes to the same JSON', async () => {
  const plain = await raw('/api/projects', {}, pm.token);
  assert.equal(plain.status, 200);
  assert.ok(!plain.headers['content-encoding'], 'no encoding without Accept-Encoding');
  const want = plain.body.toString();
  assert.ok(want.length > 1400, 'the sample answer is large enough to compress');
  const br = await raw('/api/projects', { 'accept-encoding': 'br, gzip' }, pm.token);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), want);
  const gz = await raw('/api/projects', { 'accept-encoding': 'gzip' }, pm.token);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), want);
  assert.match(br.headers.vary, /Accept-Encoding/);
});

test('every API answer carries a Server-Timing header with the app time and the database time', async () => {
  const r = await raw('/api/projects', {}, pm.token);
  assert.match(r.headers['server-timing'], /app;dur=[\d.]+, db;dur=[\d.]+;desc="\d+ queries"/);
  assert.match((await raw('/healthz')).headers['server-timing'], /app;dur=/);
});

test('the tracer names routes without ids, logs a slow request with its slowest queries and exports OTLP spans', async () => {
  assert.equal(routeOf('/api/projects/123/items/45?x=1'), '/api/projects/:id/items/:id');
  const logs = [], sent = [];
  const tracer = createTracer({
    config: { url: 'http://collector.test/v1/traces', headers: { 'x-key': 'k' }, service: 'svc', ratio: 0, slowMs: 50, off: false },
    log: (l) => logs.push(l),
    fetch: async (url, init) => { sent.push({ url, init }); return { status: 200 }; },
  });
  const db = tracer.instrumentDb({ kind: 'fake', query: async (t) => { await new Promise((r) => setTimeout(r, 70)); return { rows: [{ t }] }; }, tx: async (fn) => fn({ query: async () => ({ rows: [] }) }), close: () => 'closed' });
  assert.equal(db.kind, 'fake'); assert.equal(db.close(), 'closed');
  const srv = http.createServer((req, res) => tracer.request(req, res, async () => { await db.query('SELECT   secret_col\n FROM t WHERE x = $1', ['do not log me']); await db.tx((t) => t.query('SELECT 1')); res.writeHead(200); res.end('ok'); }));
  await new Promise((ok) => srv.listen(0, ok));
  const r = await new Promise((ok) => http.get({ port: srv.address().port, path: '/api/projects/77/schedule?token=abc' }, (x) => { x.resume(); x.on('end', () => ok(x)); }));
  assert.match(r.headers['server-timing'], /db;dur=[\d.]+;desc="2 queries"/);
  await new Promise((ok) => setTimeout(ok, 50));
  srv.close();
  assert.equal(logs.length, 1);
  const line = JSON.parse(logs[0]);
  assert.equal(line.slow_request, 'GET /api/projects/:id/schedule');
  assert.equal(line.db_queries, 2);
  assert.equal(line.worst_queries[0].sql, 'SELECT secret_col FROM t WHERE x = $1');
  assert.ok(!logs[0].includes('do not log me') && !logs[0].includes('abc'), 'no parameters or query strings in the log');
  await tracer.flush();
  assert.equal(sent.length, 1, 'a slow request is exported even at a share of zero');
  assert.equal(sent[0].init.headers['x-key'], 'k');
  const spans = JSON.parse(sent[0].init.body).resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find((x) => x.name.startsWith('GET '));
  assert.ok(root && spans.filter((x) => x.name === 'db.query').every((x) => x.parentSpanId === root.spanId && x.traceId === root.traceId));
  assert.equal(JSON.parse(sent[0].init.body).resourceSpans[0].resource.attributes[0].value.stringValue, 'svc');
});

test('without a collector the tracer exports nothing and a failing collector never breaks a request', async () => {
  const off = createTracer({ config: { url: '', headers: {}, service: 'x', ratio: 1, slowMs: 1, off: false }, log: () => {} });
  assert.equal(off.enabled(), false);
  const bad = createTracer({ config: { url: 'http://down.test/v1/traces', headers: {}, service: 'x', ratio: 1, slowMs: 5000, off: false }, log: () => {}, fetch: async () => { throw new Error('down'); } });
  const srv = http.createServer((req, res) => bad.request(req, res, async () => { res.writeHead(200); res.end('fine'); }));
  await new Promise((ok) => srv.listen(0, ok));
  const body = await new Promise((ok) => http.get({ port: srv.address().port, path: '/x' }, (x) => { const p = []; x.on('data', (c) => p.push(c)); x.on('end', () => ok(Buffer.concat(p).toString())); }));
  assert.equal(body, 'fine');
  await bad.flush();
  srv.close();
});

test('lists are paged only when asked, and a page says how many there are and whether more follow', async () => {
  const projects = (await s.call('GET', '/api/projects', null, pm.token)).data.projects;
  const id = projects[0].id;
  const all = (await s.call('GET', `/api/projects/${id}/items`, null, pm.token)).data;
  assert.ok(Array.isArray(all.items) && all.items.length >= 3, 'the sample project has several log items');
  assert.equal(all.total, undefined, 'no paging fields without a limit');
  const p1 = (await s.call('GET', `/api/projects/${id}/items?limit=2`, null, pm.token)).data;
  assert.equal(p1.items.length, 2); assert.equal(p1.total, all.items.length); assert.equal(p1.has_more, true); assert.equal(p1.offset, 0);
  const p2 = (await s.call('GET', `/api/projects/${id}/items?limit=2&offset=2`, null, pm.token)).data;
  assert.deepEqual(p1.items.concat(p2.items).map((x) => x.id), all.items.slice(0, p1.items.length + p2.items.length).map((x) => x.id));
  const last = (await s.call('GET', `/api/projects/${id}/items?limit=500&offset=${all.items.length - 1}`, null, pm.token)).data;
  assert.equal(last.items.length, 1); assert.equal(last.has_more, false);
  assert.equal((await s.call('GET', `/api/projects/${id}/items?limit=-4`, null, pm.token)).data.items.length, all.items.length, 'a bad limit means no paging');
  const m = (await s.call('GET', `/api/projects/${id}/meetings?limit=5`, null, pm.token)).data;
  assert.ok(Array.isArray(m.meetings) && m.total === 0 && m.has_more === false);
  for (const sub of ['inbox', 'documents', 'audit', 'generated']) {
    const r = (await s.call('GET', `/api/projects/${id}/${sub}?limit=1`, null, pm.token)).data;
    assert.ok(Array.isArray(r[sub]) && r[sub].length <= 1 && typeof r.total === 'number', sub);
  }
});

test('fonts and pictures are kept by the browser, scripts and styles keep their year long version cache', async () => {
  const font = await raw('/fonts/tajawal-latin-500-normal.woff2');
  assert.equal(font.status, 200); assert.match(font.headers['cache-control'], /max-age=2592000/);
  const pic = await raw('/landing/en-light-hero.webp');
  assert.equal(pic.status, 200); assert.match(pic.headers['cache-control'], /max-age=86400.*stale-while-revalidate/);
  assert.equal((await raw('/fonts/tajawal-latin-500-normal.woff2', { 'if-none-match': font.headers.etag })).status, 304);
  assert.equal((await raw('/fonts/tajawal-arabic-800-normal.woff2')).status, 404, 'the unused weight is gone');
  const page = (await raw('/app.html')).body.toString();
  assert.match(page, /rel="preload" href="\/fonts\/tajawal-latin-500-normal\.woff2" as="font"/);
  assert.equal(/font-weight: 800/.test(fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8')), false);
});

test('screens that most visits never open are not loaded at start and each one has a real, versioned file', async () => {
  const page = (await raw('/app.html')).body.toString();
  const lazy = [...page.matchAll(/<script type="pm\/lazy" data-group="(\w+)" src="([^"]+)"/g)];
  assert.deepEqual([...new Set(lazy.map((m) => m[1]))].sort(), ['brand', 'closure', 'connect', 'docs', 'meetings', 'org']);
  for (const m of lazy) {
    assert.match(m[2], /\.js\?v=[0-9a-f]{10}$/);
    const r = await raw('/' + m[2]);
    assert.equal(r.status, 200, m[2]); assert.match(r.headers['cache-control'], /immutable/);
  }
  const eager = [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
  for (const f of ['app_meetings.js', 'app_closure.js', 'app_brand.js', 'app_connect.js', 'app_editor.js', 'app_clienttpl.js', 'app_org.js']) assert.ok(!eager.includes(f), f + ' is not loaded eagerly');
  for (const f of ['app.js', 'app_logs.js', 'app_review.js', 'app_chat.js']) assert.ok(eager.includes(f), f + ' still loads at start');
});

test('every stub for a lazy screen is replaced by the real code, so nothing can call itself forever', () => {
  const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
  assert.match(read('app_meetings.js'), /PM\.views\.tab_meetings\s*=/);
  assert.match(read('app_closure.js'), /PM\.views\.tab_closure\s*=/);
  assert.match(read('app_closure.js'), /PM\.askNotDelivered\s*=/);
  assert.match(read('app_brand.js'), /PM\.views\.brand\s*=/);
  assert.match(read('app_org.js'), /PM\.views\.organization\s*=/);
  assert.match(read('app_connect.js'), /PM\.connect\s*=\s*\{[^}]*wizard[^}]*mountRows/);
  assert.match(read('app_clienttpl.js'), /PM\.clientTpl\s*=\s*\{[^}]*upload[^}]*open[^}]*readLogo/);
  assert.match(read('app_editor.js'), /PM\.docEditor\s*=\s*\{\s*open/);
});

test('real user speed readings are stored, summarized by the slowest quarter and rated', async () => {
  const send = (events, device) => s.call('POST', '/api/usage', { sid: 'vit-' + Math.random().toString(36).slice(2, 8), device: device || 'desktop', events }, pm.token);
  for (const lcp of [1200, 1800, 2200, 3000, 5200, 6100]) assert.equal((await send([{ k: 'vital', s: 'dashboard', a: 'lcp', ms: lcp }, { k: 'vital', s: 'dashboard', a: 'cls', ms: 40 }, { k: 'vital', s: 'dashboard', a: 'ttfb', ms: 300 }])).data.saved, 3);
  assert.equal((await send([{ k: 'vital', s: 'dashboard', a: 'lcp', ms: 900 }], 'phone')).data.saved, 1);
  const r = (await s.call('GET', '/api/admin/usability?days=7', null, boss.token)).data;
  assert.ok(r.vitals, 'the report has a vitals section');
  const lcp = r.vitals.metrics.find((x) => x.metric === 'lcp' && x.device === 'desktop');
  assert.equal(lcp.samples, 6); assert.ok(lcp.p75 >= 3000 && lcp.p75 <= 5200); assert.ok(['needs work', 'poor'].includes(lcp.rating));
  const cls = r.vitals.metrics.find((x) => x.metric === 'cls');
  assert.equal(cls.p75, 0.04); assert.equal(cls.rating, 'good');
  assert.ok(r.vitals.slowest_screens.some((x) => x.screen === 'dashboard' && x.samples >= 6));
  assert.ok(r.devices.every((d) => d.friction_pct <= 100), 'speed readings do not count as steps in the friction share');
});

test('the migration adds the indexes the common lookups need and the app starts on a database that has them', async () => {
  const names = (await s.app.db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map((r) => r.indexname);
  for (const n of ['projects_owner_idx', 'sessions_expires_idx', 'chat_log_time_idx', 'error_log_ref_idx', 'meeting_audio_created_idx', 'projects_sync_idx']) assert.ok(names.includes(n), n);
});

test('notifications are brought up to date with few queries, and nothing changes when nothing changed', async () => {
  const a = (await s.call('GET', '/api/notifications', null, pm.token)).data;
  const b = (await s.call('GET', '/api/notifications', null, pm.token)).data;
  assert.deepEqual(b.items.map((x) => [x.id, x.read]), a.items.map((x) => [x.id, x.read]));
  assert.equal(b.unread, a.unread);
});

test('with CDN_URL set, pages name their scripts and styles from the CDN, which may read them and is allowed by the policy', async () => {
  const saved = process.env.CDN_URL;
  process.env.CDN_URL = 'https://cdn.example.com/';
  for (const k of Object.keys(require.cache)) if (/[\\/]server[\\/]app\.js$/.test(k)) delete require.cache[k];
  const { start: startAgain } = (() => { delete require.cache[require.resolve('./helpers')]; return require('./helpers'); })();
  const s2 = await startAgain({ opsJobs: false, noScheduler: true, snapshotJob: false });
  try {
    const get = (p) => new Promise((ok, no) => http.get({ host: 'localhost', port: s2.app.server.address().port, path: p }, (r) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) })); }).on('error', no));
    const page = await get('/app.html');
    assert.match(page.body.toString(), /<script src="https:\/\/cdn\.example\.com\/app\.js\?v=[0-9a-f]{10}"/);
    assert.match(page.headers['content-security-policy'], /script-src 'self' https:\/\/cdn\.example\.com/);
    assert.match(page.headers['content-security-policy'], /font-src 'self'[^;]*https:\/\/cdn\.example\.com/);
    assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin', 'the page itself stays same origin');
    const js = await get('/app.js?v=abc');
    assert.equal(js.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal(js.headers['access-control-allow-origin'], '*');
    const font = await get('/fonts/tajawal-latin-500-normal.woff2');
    assert.equal(font.headers['access-control-allow-origin'], '*');
  } finally {
    await s2.close();
    if (saved === undefined) delete process.env.CDN_URL; else process.env.CDN_URL = saved;
    for (const k of Object.keys(require.cache)) if (/[\\/]server[\\/]app\.js$/.test(k)) delete require.cache[k];
  }
});

test('the skeleton markup and styles exist for both text directions and reduced motion', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.sk::after \{[^}]*animation: sk-sweep/);
  assert.match(css, /\[dir="rtl"\] \.sk::after/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.sk::after \{ animation: none/);
  const js = fs.readFileSync(path.join(PUB, 'app_loader.js'), 'utf8');
  for (const k of ['list', 'cards', 'table', 'page']) assert.match(js, new RegExp(k + ':'));
  assert.match(js, /role="status" aria-busy="true"/);
});

test('every interface weight is Tajawal Medium, only formatted bold in documents and answers stays Bold', () => {
  const dir = PUB;
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
  for (const f of css) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f === 'tokens.css') continue;
    assert.equal(/font-weight\s*:[ \t]*(?![ \t])(?!var\(--fw\)|var\(--fw-strong\))/.test(src), false, `${f} sets a raw font weight`);
  }
  const tokens = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8');
  assert.match(tokens, /--fw:\s*500/);
  for (const f of ['site.css', 'styles.css']) assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /\nbody \{[^}]*font: var\(--fw\) /, `${f} body shorthand keeps Medium`);
  assert.equal(/font-weight:\s*400/.test(tokens), false, 'the Regular weight is gone');
  assert.equal(fs.existsSync(path.join(dir, 'fonts', 'tajawal-latin-400-normal.woff2')), false);
});
