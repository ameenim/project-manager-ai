#!/usr/bin/env node
// Performance benchmark. Seeds a realistic workspace on a throwaway embedded database, then times what each screen
// and each action asks the server for. Run it with:  node scripts/perf-bench.js [label]
// It writes bench-results/<label>.json. Use "pre" before a change and "post" after, then compare the two files.
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { start } = require('../test/helpers');
const { seed } = require('./perf-seed');

const LABEL = process.argv[2] || 'run';
const RUNS = Number(process.env.BENCH_RUNS || 7);
const BIG = Number(process.env.BENCH_TASKS || 600);

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };

async function main() {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  let Q = 0; const LAT = Number(process.env.BENCH_DB_LATENCY_MS || 0);
  const rawQuery = s.app.db.query.bind(s.app.db);
  s.app.db.query = async (...a) => { Q++; if (LAT) await new Promise((r) => setTimeout(r, LAT)); return rawQuery(...a); };
  if (s.app.db.tx) { const rawTx = s.app.db.tx.bind(s.app.db); s.app.db.tx = async (fn) => { Q++; if (LAT) await new Promise((r) => setTimeout(r, LAT)); return rawTx(fn); }; }
  const out = { label: LABEL, dbLatencyMs: LAT, runs: RUNS, bigTasks: BIG, when: new Date().toISOString(), node: process.version, results: [], static: [], seed: {} };
  const u = await s.user('Bench');
  const tok = u.token;
  const call = async (m, p, b) => { const _t = Date.now(); const r = await s.call(m, p, b, tok); if (r.status >= 400) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`); if (process.env.BENCH_TRACE && Date.now() - _t > 1500) console.log('SLOW', m, p, Date.now() - _t, 'ms'); return r; };

  // ---------- seed ----------
  const sd = await seed(s, tok, BIG);
  out.seed = { ms: sd.ms, projects: sd.projects, bigTasks: BIG };
  const first = sd.first, big = sd.big;
  const tasks = (await call('GET', `/api/projects/${big}/schedule`)).data.tasks;
  const leaf = tasks.find((t) => !t.summary) || tasks[5];
  const items = (await call('GET', `/api/projects/${big}/items`)).data.items;
  const risk = items.find((i) => i.kind === 'risk') || items[0];

  // ---------- helpers ----------
  async function time(screen, action, method, p, body, opt = {}) {
    const ms = [], qs = []; let bytes = 0, status = 0;
    for (let i = 0; i < RUNS + 1; i++) {
      const b = typeof body === 'function' ? body(i) : body;
      const q0 = Q; const t = process.hrtime.bigint();
      const r = await s.call(method, typeof p === 'function' ? p(i) : p, b, tok);
      const d = Number(process.hrtime.bigint() - t) / 1e6;
      status = r.status; bytes = r.buf.length;
      if (i > 0) { ms.push(d); qs.push(Q - q0); } // the first call warms caches and is not counted
      if (opt.each) await opt.each(r, i);
    }
    out.results.push({ screen, action, call: `${method} ${typeof p === 'function' ? p(0) : p}`, status, kb: +(bytes / 1024).toFixed(1), median: +median(ms).toFixed(1), p95: +p95(ms).toFixed(1), queries: median(qs), min: +Math.min(...ms).toFixed(1), max: +Math.max(...ms).toFixed(1) });
  }
  const T = time;

  // ---------- opening each screen (the calls the browser makes) ----------
  await T('Shell', 'Boot: me', 'GET', '/api/me');
  await T('Shell', 'Boot: projects list', 'GET', '/api/projects');
  await T('Shell', 'Notifications and inbox', 'GET', `/api/projects/${big}/inbox`);
  await T('Shell', 'Analysis events poll', 'GET', '/api/analysis/events?since=0');
  await T('Portfolio', 'Open portfolio dashboard', 'GET', '/api/dashboard');
  await T('Portfolio', 'Open portfolio trends', 'GET', '/api/trends?days=30');
  await T('Portfolio', 'Calendar', 'GET', '/api/calendar');
  await T('Portfolio', 'Widgets installed', 'GET', '/api/widgets/installed?scope=portfolio');
  await T('Project overview', 'Open project (small)', 'GET', `/api/projects/${first}`);
  await T('Project overview', 'Open project (large)', 'GET', `/api/projects/${big}`);
  await T('Project overview', 'Project dashboard (large)', 'GET', `/api/projects/${big}/dashboard`);
  await T('Project overview', 'Project trends (large)', 'GET', `/api/projects/${big}/trends?days=30`);
  await T('Project overview', 'Widgets installed (project)', 'GET', `/api/widgets/installed?scope=project`);
  await T('Schedule', 'Open schedule (large)', 'GET', `/api/projects/${big}/schedule`);
  await T('Schedule', 'Validate schedule', 'GET', `/api/projects/${big}/schedule/validate`);
  await T('Schedule', 'Versions list', 'GET', `/api/projects/${big}/schedule/versions`);
  await T('Logs and risks', 'Open items list', 'GET', `/api/projects/${big}/items`);
  await T('Documents', 'Open documents', 'GET', `/api/projects/${big}/documents`);
  await T('Documents', 'Search documents', 'GET', `/api/projects/${big}/documents/search?q=acceptance`);
  await T('Reports', 'Open generated documents', 'GET', `/api/projects/${big}/generated`);
  await T('Reports', 'Folders', 'GET', `/api/projects/${big}/folders`);
  await T('Reports', 'Templates', 'GET', '/api/templates');
  await T('Reports', 'Doc types', 'GET', '/api/doc-types');
  await T('Resources', 'Open resources', 'GET', `/api/projects/${big}/resources`);
  await T('Meetings', 'Open meetings', 'GET', `/api/projects/${big}/meetings`);
  await T('Settings', 'Members', 'GET', `/api/projects/${big}/members`);
  await T('Settings', 'Audit trail', 'GET', `/api/projects/${big}/audit`);
  await T('Settings', 'Connections', 'GET', '/api/connections');
  await T('Settings', 'Billing', 'GET', '/api/billing');
  await T('Widgets', 'Marketplace list', 'GET', '/api/widgets?');
  await T('Widgets', 'Datasets', 'GET', `/api/widgets/datasets?project=${big}`);
  await T('Chat', 'Open chat history', 'GET', '/api/chat?');

  // ---------- actions (writes) ----------
  await T('Schedule', 'Edit task progress (full answer)', 'POST', `/api/projects/${big}/schedule/apply`, (i) => ({ changes: { [leaf.id]: { progress: (i * 7) % 100 } } }));
  await T('Schedule', 'Edit task progress (slim answer)', 'POST', `/api/projects/${big}/schedule/apply`, (i) => ({ changes: { [leaf.id]: { progress: (i * 9) % 100 } }, slim: true }));
  await T('Schedule', 'Change task duration', 'POST', `/api/projects/${big}/schedule/apply`, (i) => ({ changes: { [leaf.id]: { duration: 3 + (i % 4) } } }));
  await T('Schedule', 'Preview a change', 'POST', `/api/projects/${big}/schedule/preview`, (i) => ({ changes: { [leaf.id]: { duration: 4 + (i % 3) } } }));
  await T('Schedule', 'Add a task', 'POST', `/api/projects/${big}/tasks`, (i) => ({ name: 'Bench task ' + i, duration: 3 }));
  await T('Schedule', 'Save a version', 'POST', `/api/projects/${big}/schedule/versions`, (i) => ({ label: 'Bench ' + i }));
  await T('Schedule', 'Set baseline', 'POST', `/api/projects/${big}/schedule/baseline`, {});
  await T('Logs and risks', 'Edit a risk', 'PUT', `/api/items/${risk.id}`, (i) => ({ title: 'Edited risk ' + i }));
  await T('Logs and risks', 'Add an item', 'POST', `/api/projects/${big}/items`, (i) => ({ kind: 'action', title: 'Bench action ' + i }));
  await T('Logs and risks', 'Confirm / reopen item', 'POST', (i) => `/api/items/${risk.id}/${i % 2 ? 'reopen' : 'confirm'}`, {});
  await T('Project overview', 'Edit project field', 'PUT', `/api/projects/${big}`, (i) => ({ name: 'Bench Large Project', client: 'Client ' + i }));
  await T('Resources', 'Add resource', 'POST', `/api/projects/${big}/resources`, (i) => ({ name: 'Person ' + i, role: 'Engineer' }));
  await T('Settings', 'Save profile', 'PUT', '/api/me', (i) => ({ theme: i % 2 ? 'dark' : 'light' }));
  await T('Portfolio', 'Save dashboard layout', 'PUT', '/api/me', (i) => ({ dash_layout: { order: ['a', 'b', String(i)] } }));

  // ---------- static assets (what a page load downloads) ----------
  const base = s.base;
  const pubdir = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pubdir, 'app.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((x) => !/^https?:/.test(x));
  const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
  const files = ['app.html', ...css, ...scripts];
  async function fetchAsset(f, headers) {
    const t = process.hrtime.bigint();
    const r = await fetch(`${base}/${f}`, { headers: { ...headers } });
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: b.length, ms: Number(process.hrtime.bigint() - t) / 1e6, enc: r.headers.get('content-encoding') || '', cc: r.headers.get('cache-control') || '', etag: r.headers.get('etag') || '' };
  }
  let firstBytes = 0, repeatBytes = 0, firstMs = 0, repeatMs = 0, enc = 0;
  for (const f of files) {
    const a = await fetchAsset(f, {});
    firstBytes += a.bytes; firstMs += a.ms; if (a.enc) enc++;
    // a repeat visit: send back whatever the server gave for validation
    const h = a.etag ? { 'If-None-Match': a.etag } : {};
    const b = await fetchAsset(f, h);
    repeatBytes += b.status === 304 ? 0 : b.bytes; repeatMs += b.ms;
    out.static.push({ file: f, kb: +(a.bytes / 1024).toFixed(1), encoding: a.enc || 'none', cache: a.cc, etag: !!a.etag, repeatStatus: b.status });
  }
  // compressed estimate in case the server sends them raw
  let gz = 0; for (const f of files) gz += zlib.gzipSync(fs.readFileSync(path.join(pubdir, f))).length;
  out.pageLoad = { files: files.length, firstLoadKB: +(firstBytes / 1024).toFixed(0), repeatLoadKB: +(repeatBytes / 1024).toFixed(0), gzipEstimateKB: +(gz / 1024).toFixed(0), compressedFiles: enc, firstMs: +firstMs.toFixed(0), repeatMs: +repeatMs.toFixed(0) };

  // ---------- concurrent: a screen opens several calls at once ----------
  const t1 = process.hrtime.bigint();
  await Promise.all([`/api/projects/${big}`, `/api/projects/${big}/schedule`, `/api/projects/${big}/items`, `/api/projects/${big}/dashboard`, '/api/dashboard', '/api/me'].map((p) => s.call('GET', p, null, tok)));
  out.concurrentOpen = +(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(1);

  fs.mkdirSync(path.join(__dirname, '..', 'bench-results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'bench-results', `${LABEL}.json`), JSON.stringify(out, null, 2));
  const w = (x, n) => String(x).padEnd(n);
  console.log(w('Screen', 18) + w('Action', 36) + w('median ms', 11) + w('p95 ms', 9) + w('queries', 9) + 'KB');
  for (const r of out.results) console.log(w(r.screen, 18) + w(r.action, 36) + w(r.median, 11) + w(r.p95, 9) + w(r.queries, 9) + r.kb + (r.status >= 400 ? '  STATUS ' + r.status : ''));
  console.log('\nPage load', JSON.stringify(out.pageLoad), 'concurrent open ms', out.concurrentOpen);
  await s.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
