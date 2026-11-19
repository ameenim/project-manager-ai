'use strict';
// The project API. This is the scheduling, document analysis, review, reporting and dashboard logic of the app,
// running on the server with real storage, accounts and roles. Every request runs with the signed in person's own
// view of the data: only the projects they are a member of exist for them, and what they may change depends on
// their role in each project (manager, editor, viewer).
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { extractText } = require('./extract');
const filesig = require('./filesig');
const security = require('./security');
const { callClaude, MODEL } = require('./claude');
const { RANK } = require('./store');
const exporter = require('./exporter');
const brandLib = require('./brand');
const importer = require('./importer');
const { Snapshots, build: buildTrends, periodOf } = require('./snapshots');
const { Meetings, SECTIONS: MEETING_SECTIONS, mmss: meetingTime } = require('./meetings');
const stt = require('./stt');
const { LiveHub } = require('./live');
const meetingExport = require('./meetings_export');
const teamExtract = require('./team_extract');

const PUB = path.join(__dirname, '..', 'public');
const TZ = process.env.APP_TZ || 'Asia/Dubai';
const als = new AsyncLocalStorage();
const ctx = () => { const c = als.getStore(); if (!c) throw new Error('No request context'); return c; };
const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
// upload routes need a multipart form; a JSON or empty body is a client mistake (400), not a server fault
const needForm = (b) => { if (!b || typeof b.get !== 'function') throw err(400, 'Send this as a form upload'); return b; };
const clone = (x) => JSON.parse(JSON.stringify(x));
// Building a date formatter is slow (about a tenth of a millisecond each), and these run once per task and per audit
// entry, so the two formatters are built once. The text they give is the same as toLocaleDateString and toLocaleTimeString.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dateIn = (d = new Date()) => DAY_FMT.format(d);
const TODAY = () => dateIn();
const nowTs = () => `${TODAY()} ${TIME_FMT.format(new Date())}`;

// A result that is a file instead of JSON (downloads).
class FileResult { constructor(buffer, type, filename) { this.buffer = buffer; this.type = type; this.filename = filename; } }
// A download written piece by piece, so a large export never has to sit in memory as one block. parts() yields strings.
class StreamResult { constructor(parts, type, filename) { this.parts = parts; this.type = type; this.filename = filename; } }

// The browser bundles (scheduling engine, report writer, AI helpers, document analysis) run here unchanged.
function loadBundles() {
  const win = { console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextDecoder, TextEncoder, AbortSignal, Date, JSON, Math, Promise, Intl, Buffer, structuredClone };
  win.window = win; win.self = win;
  win.addEventListener = () => {}; win.dispatchEvent = () => {}; win.removeEventListener = () => {};
  win.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
  const res = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  // the AI helpers ask "/srv/ai", which is answered here in process, with the key that only the server holds
  win.fetch = async (url, init) => {
    if (url === '/srv/ai/status') return res(200, { configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
    if (url === '/srv/ai') {
      if (!process.env.ANTHROPIC_API_KEY) return res(503, { error: 'ANTHROPIC_API_KEY is not set on the server', code: 'no_key' });
      let payload; try { payload = JSON.parse(init.body); } catch (e) { return res(400, { error: 'Invalid request' }); }
      payload.max_tokens = Math.min(Math.max(parseInt(payload.max_tokens, 10) || 4000, 200), 32000);
      try {
        if (meter) { const stop = await meter.before(); if (stop) return res(402, { error: stop, code: 'limit' }); }
        const r = await callClaude(payload);
        if (meter) await meter.after('document reading', r);
        return res(200, r);
      } catch (e) {
        const code = e.status === 401 ? 'bad_key' : e.status === 429 ? 'rate' : e.status === 400 && /credit|billing|balance/i.test(e.message) ? 'budget' : 'upstream';
        return res(502, { error: code === 'bad_key' ? 'The Anthropic API key was rejected' : code === 'budget' ? 'The Anthropic account has no credit left' : 'Claude could not be reached', code, status: e.status || null });
      }
    }
    return res(404, { error: 'Not found' });
  };
  vm.createContext(win);
  for (const [dir, f] of [[PUB, 'engine.js'], [PUB, 'visuals.js'], [PUB, 'widgetspec.js'], [__dirname, 'seed.js'], [__dirname, 'extract2.js']]) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), win, { filename: f });
  return win;
}
// set by createApi so the in process AI calls are metered per person
let meter = null;
const win = loadBundles();

module.exports = function createApi(store, auth, connectors, ops) {
  const S = win.__Sched, R = win.__Reports, AI = win.__AI, Pipe = win.__Pipe;
  // every in process AI call is recorded against the signed in person, and can be refused when limits are enforced
  const who = () => { try { return ctx().DB.user; } catch (e) { return null; } };
  meter = ops ? {
    before: async () => { const u = who(); return u ? ops.allowance(u) : null; },
    after: async (source, r) => { const u = who(); await ops.recordUsage({ userId: u && u.id, source, model: MODEL, input: r.usage && r.usage.input_tokens, output: r.usage && r.usage.output_tokens }); },
  } : null;
  const RAW = win.DEMO_SEED;
  const nid = () => store.nid();
  // Optional paging for a long list. Without ?limit the whole list comes back as it always did. With ?limit=N (up to 500) and
  // ?offset=M the answer holds that slice plus total, offset and has_more, so a screen can offer "Show more" and never has to
  // download the whole history just to show the newest part. The view function runs only on the rows that are sent.
  const paged = (list, q, field, view, maxLimit = 500) => {
    const map = view || ((x) => x);
    const limit = parseInt(q && q.limit, 10);
    if (!(limit > 0)) return { [field]: list.map(map) };
    const lim = Math.min(limit, maxLimit), off = Math.max(0, parseInt(q.offset, 10) || 0);
    return { [field]: list.slice(off, off + lim).map(map), total: list.length, offset: off, has_more: off + lim < list.length };
  };
  const ensurePipe = async () => {};
  const ACTOR = () => ctx().DB.user.name;
  const running = new Set(); // projects whose analysis is running in this process

  // ---------- the signed in person's view of the data ----------
  const DB = new Proxy({}, { get: (_, k) => ctx().DB[k], set: (_, k, v) => { ctx().DB[k] = v; return true; } });
  const CONN = new Proxy({}, { get: (_, k) => (ctx().DB.connections || {})[k] || null, set: (_, k, v) => { const c = ctx().DB; c.connections = c.connections || {}; c.connections[k] = v; return true; } });
  const need = (P, level) => {
    const role = ctx().roles[P.id];
    if (!role) throw err(404, 'Project not found');
    if (RANK[role] < RANK[level]) throw err(403, level === 'manager' ? 'Only the project manager can do this' : 'You have view only access to this project');
    // A closed project is read only. Routes that need the project manager (reopen, closure, delete, access) are not blocked.
    if (level === 'editor' && P.p.status === 'closed') throw err(409, 'This project is closed. Reopen it from the Closure tab to make changes.');
  };
  // A project that is archived or closed is out of the dashboards, the calendar, the trends and the alerts.
  const isLive = (P) => P.p.status !== 'archived' && P.p.status !== 'closed';
  const touch = (P) => ctx().touched.add(P);
  const roleOf = (P) => ctx().roles[P.id] || null;
  const canDelete = (P) => roleOf(P) === 'manager';

  // ---------- sample data (dates move to the current week so the demo always looks current) ----------
  const DAYMS = 86400000, dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAYMS;
  const dstr = (n) => new Date(n * DAYMS).toISOString().slice(0, 10);
  function seedData() {
    const today = TODAY();
    const shift = Math.round((dnum(today) - dnum(RAW.today)) / 7) * 7;
    const move = (v) => {
      // a date with a time is something that already happened (activity, created at), so it never lands after today
      if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}(?:[ T].{0,13})?$/.test(v) ? (v.length > 10 && dnum(v) + shift > dnum(today) ? today : dstr(dnum(v) + shift)) + v.slice(10) : v;
      if (Array.isArray(v)) return v.map(move);
      if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = k === 'docTexts' || k === 'skeletons' || k === 'templates' ? v[k] : move(v[k]); return o; }
      return v;
    };
    const SEED = move(RAW); SEED.today = today; return SEED;
  }

  // ---------- project containers ----------
  function makeProject(id, p) {
    return { id, p, items: [], tasks: [], resources: [], inbox: [], documents: [], texts: {}, generated: [], folders: [], audit: [] };
  }

  function seedFirst(ownerId) {
    const SEED = seedData();
    const P = makeProject(1, clone(SEED.project)); P.p.owner_id = ownerId;
    delete P.p.stats;
    P.p.sharepoint_url = P.p.sharepoint_url || 'https://contoso.sharepoint.com/sites/chatbot'; P.p.jira_url = P.p.jira_url || 'https://contoso.atlassian.net/browse/CHAT';
    P.items = clone(SEED.items);
    const strip = ['finish', 'summary', 'critical'];
    P.tasks = clone(SEED.schedule.tasks).map((t) => { strip.forEach((k) => delete t[k]); return t; });
    // show a five level work breakdown: project, phase, work package, workstream, task
    (function wbs() {
      const mk = (name, parent) => ({ id: nid(), parent_id: parent, position: 0, name, start: '2027-01-11', duration: 1, progress: 0, assignee: null, deps: [], deliverable_id: null, b_start: null, b_end: null, notes: null, is_milestone: 0, jira_key: null, color: null });
      const T = (id) => P.tasks.find((t) => t.id === id);
      const s1 = mk('Smart Portal Rollout', null), s2 = mk('Plan and Design', s1.id), s3 = mk('Requirements', s2.id), s4 = mk('Discovery', s3.id), s5 = mk('Build', s1.id), s6 = mk('Deliver', s1.id);
      T(1).parent_id = s4.id; T(2).parent_id = s2.id; T(3).parent_id = s5.id; T(4).parent_id = s5.id; T(5).parent_id = s6.id; T(6).parent_id = s6.id;
      P.tasks.push(s1, s2, s3, s4, s5, s6);
      const order = [s1, s2, s3, s4, T(1), T(2), s5, T(3), T(4), s6, T(5), T(6)];
      order.forEach((t, i) => (t.position = i));
      P.tasks.sort((a, z) => a.position - z.position);
    })();
    P.resources = clone(SEED.resources);
    P.inbox = clone(SEED.inbox);
    P.documents = clone(SEED.documents);
    for (const d of P.documents) P.texts[d.id] = SEED.docTexts[d.filename] || '';
    P.generated = clone(SEED.generated);
    P.audit = clone(SEED.audit);
    // connect the first project's deliverables, payments, requirements and risks to tasks (two requirements stay unlinked on purpose)
    const TK = (id) => P.tasks.find((t) => t.id === id), IT = (id) => P.items.find((i) => i.id === id);
    [[6, 1], [7, 2], [8, 3], [9, 4], [10, 5], [11, 6]].forEach(([d, t]) => { TK(t).deliverable_id = d; });
    [[28, 6], [29, 7], [30, 8], [31, 9], [32, 11]].forEach(([m, d]) => { IT(m).data.deliverable_id = d; });
    [[2, 12], [3, 13], [5, 14], [3, 17]].forEach(([t, i]) => { TK(t).links = [...(TK(t).links || []), i]; });
    return P;
  }

  const P_ = (id, level) => { const P = DB.projects[Number(id)]; if (!P) throw err(404, 'Project not found'); need(P, level || ctx().level); if (!P.folders) P.folders = []; if (!P.generated) P.generated = []; touch(P); return P; };
  const rawProject = (P) => ({ ...P.p, work_days: JSON.stringify(P.p.work_days), holidays: JSON.stringify(P.p.holidays) });

  // ---------- five more projects, one per currency ----------
  function seedPortfolio(ownerId) {
    const out = [];
    win.__Portfolio.build(TODAY()).forEach((spec) => {
      const id = nid();
      const P = makeProject(id, { id, owner_id: ownerId, name: spec.name, code: spec.code, client: spec.client, client_logo: null, currency: spec.currency, value: spec.value, start_date: spec.start, end_date: spec.end, work_days: [1, 2, 3, 4, 5], work_start: '08:00', work_end: '17:00', holidays: [], status: 'active', wizard_done: 1, analyzing: 0, impact_check: 1, auto_apply: 0, auto_threshold: 0.9, jira_key: spec.code || null, sharepoint_url: spec.code ? `https://contoso.sharepoint.com/sites/${String(spec.code).toLowerCase()}` : null, jira_url: spec.code ? `https://contoso.atlassian.net/browse/${spec.code}` : null, teams_channel: null, created_at: `${TODAY()} 08:00:00` });
      const ids = {};
      spec.tasks.forEach((t, i) => { ids[t.lid] = nid(); });
      spec.tasks.forEach((t, i) => {
        P.tasks.push({ id: ids[t.lid], parent_id: t.parent ? ids[t.parent] : null, position: i, name: t.name, start: spec.start, duration: t.summary ? 1 : t.duration, progress: t.progress || 0, assignee: t.assignee || null, deps: (t.deps || []).map((d) => ({ id: ids[d], lag: 0 })), deliverable_id: null, b_start: null, b_end: null, notes: null, is_milestone: t.milestone ? 1 : 0, jira_key: null, color: null });
      });
      S.schedule(P.tasks, rawProject(P)).forEach((c) => { const t = P.tasks.find((x) => x.id === c.id); t.start = c.start; t.b_start = c.start; t.b_end = c.finish; });
      P.resources = spec.team.map(([name, role]) => ({ id: nid(), project_id: id, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, role, jira_account: null, teams_name: name }));
      const item = (kind, title, description, data, state) => P.items.push({ id: nid(), project_id: id, kind, title, description, data, status: 'confirmed', state, confidence: 0.9, doc_id: null, quote: '', evidence_doc_id: null, created_at: `${TODAY()} 08:00:00`, doc_name: null, evidence_name: null });
      const tk = (lid) => P.tasks.find((t) => t.id === ids[lid]);
      const dids = [];
      spec.deliverables.forEach((x) => { item('deliverable', x.title, '', { due_date: x.due }, x.state); const it = P.items[P.items.length - 1]; dids.push(it.id); if (x.task && tk(x.task)) tk(x.task).deliverable_id = it.id; });
      spec.payments.forEach((x) => { item('milestone', x.title, '', { percent: x.percent, amount: x.amount, due_date: x.due, ...(x.deliv != null ? { deliverable_id: dids[x.deliv] } : {}) }, x.state); const it = P.items[P.items.length - 1]; if (x.task && tk(x.task)) (tk(x.task).links = tk(x.task).links || []).push(it.id); });
      spec.risks.forEach((x) => { item('risk', x.title, `${x.title} (${x.probability}). Mitigation: ${x.mitigation}`, { probability: x.probability, impact: x.impact, mitigation: x.mitigation }, 'open'); const it = P.items[P.items.length - 1]; if (x.task && tk(x.task)) (tk(x.task).links = tk(x.task).links || []).push(it.id); });
      out.push(P);
    });
    return out;
  }

  const audit = (P, actor, action, detail) => P.audit.unshift({ id: nid(), project_id: P.id, actor, action, detail, ts: nowTs() });
  const docName = (P, id) => { const d = P.documents.find((x) => x.id === id); return d ? d.filename : null; };
  const itemView = (P, i) => ({ ...clone(i), doc_name: docName(P, i.doc_id) || i.doc_name || null, evidence_name: docName(P, i.evidence_doc_id) });
  const inboxView = (P, r) => ({ ...clone(r), doc_name: docName(P, r.doc_id) || r.doc_name || null });

  // ---------- scheduling ----------
  function recalc(P) {
    const computed = S.schedule(P.tasks, rawProject(P));
    for (const c of computed) { const t = P.tasks.find((x) => x.id === c.id); if (t) { t.start = c.start; t.duration = c.duration; t.progress = c.progress || 0; } }
    return computed;
  }
  const taskView = (t) => ({
    id: t.id, parent_id: t.parent_id, position: t.position, name: t.name, start: t.start, finish: t.finish, duration: t.duration,
    progress: t.progress || 0, assignee: t.assignee, deps: t.deps, deliverable_id: t.deliverable_id, b_start: t.b_start, b_end: t.b_end,
    notes: t.notes, is_milestone: t.is_milestone, jira_key: t.jira_key, color: t.color, summary: t.summary, critical: t.critical,
    mode: t.mode === 'manual' ? 'manual' : 'auto', source: t.source || null, meeting_id: t.meeting_id || null, flag: t.flag ? 1 : 0, conflict: t.conflict ? 1 : 0, links: Array.isArray(t.links) ? t.links : [],
  });
  // Every Set baseline press keeps its own copy of the task dates, so the table can show the start and finish of every earlier baseline.
  // A project that only has the old single baseline gets it as Baseline 1.
  const MAX_BASELINES = 11;
  function ensureBaselines(P) {
    if (!Array.isArray(P.baselines)) P.baselines = [];
    if (!P.baselines.length && P.tasks.some((t) => t.b_start)) {
      const tasks = {};
      for (const t of P.tasks) if (t.b_start && t.b_end) tasks[t.id] = [t.b_start, t.b_end];
      P.baselines.push({ n: 1, at: null, tasks });
    }
    return P.baselines;
  }
  function scheduleResponse(P) {
    const computed = S.schedule(P.tasks, rawProject(P));
    const bls = ensureBaselines(P);
    return {
      baselines: bls.map((b) => ({ n: b.n, at: b.at })),
      tasks: computed.map((t) => ({ ...taskView(t), bl: bls.map((b) => b.tasks[t.id] || null) })),
      calendar: { work_days: P.p.work_days, holidays: P.p.holidays },
      impact_check: !!P.p.impact_check, today: TODAY(), has_baseline: computed.some((t) => t.b_start),
      deliverables: P.items.filter((i) => i.kind === 'deliverable' && i.status !== 'ignored').map((i) => ({ id: i.id, title: i.title })),
      items: linkItems(P),
      resources: P.resources.map((r) => r.name),
    };
  }
  function linkItems(P) {
    return P.items.filter((i) => ['deliverable', 'milestone', 'requirement', 'risk'].includes(i.kind) && i.status !== 'ignored')
      .map((i) => { const d = i.data || {}; return { id: i.id, kind: i.kind, title: i.title, state: i.state, status: i.status, data: { due_date: d.due_date || null, amount: d.amount ?? null, percent: d.percent ?? null, deliverable_id: d.deliverable_id || null } }; });
  }
  // ---------- schedule versions ----------
  const V = win.__Versions;
  const projEnd = (P) => S.schedule(P.tasks, rawProject(P)).reduce((m, t) => (!t.summary && t.finish && (!m || t.finish > m) ? t.finish : m), null);
  const vmeta = (d, a, b, names) => ({ added: d.added.length, removed: d.removed.length, changed: d.changed.length, reordered: d.reordered, end_from: a, end_to: b, names });
  function ensureVersion(P) {
    P.versions = P.versions || [];
    if (P.versions.length || !P.tasks.length) return;
    P.versions.push({ id: nid(), version: 'v1.0.0', level: 'major', source: 'initial', label: null, meta: { added: P.tasks.length, removed: 0, changed: 0 }, author: 'System', project_end: projEnd(P), task_count: P.tasks.length, snapshot: V.snap(P.tasks), created_at: `${TODAY()} 08:00:00` });
  }
  function recordVersion(P, source = 'edit', label = null) {
    ensureVersion(P);
    const last = P.versions[P.versions.length - 1], now = V.snap(P.tasks), end = projEnd(P);
    if (!last) { if (!P.tasks.length) return; P.versions.push({ id: nid(), version: 'v1.0.0', level: 'major', source: 'initial', label, meta: { added: P.tasks.length, removed: 0, changed: 0 }, author: ACTOR(), project_end: end, task_count: P.tasks.length, snapshot: now, created_at: nowTs() }); return; }
    const d = V.diff(last.snapshot, now);
    if (!d.count && !label) return;
    const level = label && !d.count ? 'patch' : V.levelFor(d, last.project_end, end, source);
    const names = [...d.added, ...d.removed, ...d.changed].slice(0, 3).map((x) => x.name);
    if (!label && level === 'patch' && last.level === 'patch' && last.source === 'edit' && source === 'edit' && P.versions.length > 1) {
      const before = P.versions[P.versions.length - 2], d2 = V.diff(before.snapshot, now);
      Object.assign(last, { meta: vmeta(d2, before.project_end, end, [...d2.added, ...d2.removed, ...d2.changed].slice(0, 3).map((x) => x.name)), project_end: end, task_count: P.tasks.length, snapshot: now, created_at: nowTs() });
      return;
    }
    P.versions.push({ id: nid(), version: V.nextVersion(last.version, level), level, source, label, meta: vmeta(d, last.project_end, end, names), author: ACTOR(), project_end: end, task_count: P.tasks.length, snapshot: now, created_at: nowTs() });
    if (P.versions.length > 60) P.versions.splice(1, 1);
  }
  const versionView = (v, cur) => { const { snapshot, ...o } = v; return { ...clone(o), current: v.id === cur }; };
  const listVersions = (P) => { ensureVersion(P); const cur = P.versions.length ? P.versions[P.versions.length - 1].id : null; return P.versions.slice().reverse().map((v) => versionView(v, cur)); };
  function stats(P) {
    const m = S.progressMetrics(P.tasks, rawProject(P), TODAY());
    const pendingItems = P.items.filter((i) => i.status === 'proposed').length;
    const pendingInbox = P.inbox.filter((r) => r.status === 'pending').length;
    let health = 'green';
    if (m.spi != null) health = m.spi >= 0.95 ? 'green' : m.spi >= 0.8 ? 'amber' : 'red';
    if (m.overdue >= 3) health = 'red'; else if (m.overdue >= 1 && health === 'green') health = 'amber';
    const sched = S.schedule(P.tasks, rawProject(P));
    const end = sched.reduce((mx, t) => (t.finish && t.finish > mx ? t.finish : mx), '');
    return { progress: m.actualPct, planned: m.plannedPct, spi: m.spi, overdue: m.overdue, tasks: m.taskCount, pendingItems, pendingInbox, health, forecast_end: end || null, today: TODAY() };
  }
  // stats runs a full schedule pass over every task, so the project list (one call per app boot) paid for every project each
  // time. The result only changes when the project is saved (the saved version moves) or the day rolls over. A project changed
  // in this request, or waiting on a delayed save, is always computed fresh.
  const statsMemo = new Map();
  function statsFor(P) {
    const c = store.cache.get(P.id);
    if (!c || c.P !== P || ctx().touched.has(P) || store.timers.has(P.id)) return stats(P);
    const key = c.version + '|' + TODAY();
    const hit = statsMemo.get(P.id);
    if (hit && hit.key === key) return { ...hit.value };
    const value = stats(P);
    statsMemo.set(P.id, { key, value });
    return { ...value };
  }
  const projectView = (P) => ({ ...clone(P.p), stats: statsFor(P), analysis: P.analysis ? clone(P.analysis) : null, role: roleOf(P), can_delete: canDelete(P), can_edit: !!roleOf(P) && RANK[roleOf(P)] >= RANK.editor });

  function sanitizeChange(ch) {
    const o = {};
    if (ch.start != null) { if (!/^\d{4}-\d{2}-\d{2}$/.test(ch.start)) throw err(400, 'Invalid start date'); o.start = ch.start; }
    if (ch.duration != null) o.duration = Math.max(0, Math.round(Number(ch.duration)) || 0);
    if (ch.progress != null) o.progress = Math.max(0, Math.min(100, Math.round(Number(ch.progress)) || 0));
    if (ch.deps != null) o.deps = (Array.isArray(ch.deps) ? ch.deps : []).map((d) => ({ id: Number(d.id), lag: Math.round(Number(d.lag) || 0), type: S.DEP_TYPES.includes(String(d.type || 'FS').toUpperCase()) ? String(d.type || 'FS').toUpperCase() : 'BAD' })).filter((d) => d.id);
    for (const k of ['name', 'assignee', 'notes', 'jira_key', 'color']) if (ch[k] !== undefined) o[k] = ch[k] === '' ? null : String(ch[k]);
    if (ch.is_milestone !== undefined) o.is_milestone = ch.is_milestone ? 1 : 0;
    if (ch.mode !== undefined) o.mode = ch.mode === 'manual' ? 'manual' : 'auto';
    if (ch.flag !== undefined) o.flag = ch.flag ? 1 : 0;
    if (ch.links !== undefined) o.links = [...new Set((Array.isArray(ch.links) ? ch.links : []).map(Number).filter(Boolean))];
    if (ch.deliverable_id !== undefined) o.deliverable_id = ch.deliverable_id ? Number(ch.deliverable_id) : null;
    if (ch.parent_id !== undefined) o.parent_id = ch.parent_id ? Number(ch.parent_id) : null;
    if (ch.position !== undefined) o.position = Number(ch.position) || 0;
    if (ch.deleted) o.deleted = true;
    return o;
  }
  function normalizeChanges(P, changes) {
    const out = {};
    for (const [id, ch] of Object.entries(changes || {})) { const t = P.tasks.find((x) => x.id === Number(id)); if (t) out[t.id] = sanitizeChange(ch); }
    const withDeps = Object.values(out).filter((ch) => ch.deps && ch.deps.length && ch.start == null);
    if (withDeps.length) { const anchor = S.asapAnchor(P.tasks, rawProject(P)); if (anchor) for (const ch of withDeps) ch._asap = anchor; }
    return out;
  }
  function wouldLoop(tasks, id, deps) {
    const map = new Map(tasks.map((t) => [t.id, t.deps]));
    map.set(id, deps);
    const seen = new Set();
    const dfs = (n) => { if (n === id && seen.size) return true; if (seen.has(n)) return false; seen.add(n); return (map.get(n) || []).some((d) => dfs(d.id)); };
    return (deps || []).some((d) => d.id === id || dfs(d.id));
  }
  const TASK_FIELDS = ['name', 'start', 'duration', 'progress', 'assignee', 'notes', 'is_milestone', 'jira_key', 'color', 'deliverable_id', 'parent_id', 'position', 'mode', 'flag', 'links'];

  // ---------- items ----------
  const FIELD_LABEL = { start_date: 'Start date', end_date: 'End date', award_date: 'Award date', value: 'Project value', currency: 'Currency', client: 'Client' };
  function confirmItem(P, item, actor) {
    const d = item.data;
    let note = null;
    if (item.kind === 'field') {
      const col = d.field;
      if (FIELD_LABEL[col]) {
        P.p[col] = d.value;
        for (const o of P.items) if (o.kind === 'field' && o.status === 'proposed' && o.id !== item.id && o.data.field === col) o.status = 'ignored';
        note = `Project ${FIELD_LABEL[col].toLowerCase()} set to ${d.value}`;
      }
    } else if (item.kind === 'schedule') {
      const c = S.calendar(rawProject(P));
      const anchor = P.p.start_date || P.p.award_date || null;
      let s0 = d.start || null, e0 = d.end || null;
      if (!s0 && d.start_week && anchor) { const w = AI.weeksToDates(anchor, d.start_week, d.end_week); s0 = w.start; e0 = e0 || w.end; }
      const start = S.nextWork(s0 || P.p.start_date || TODAY(), c);
      let dur = d.duration_days || 1;
      if (s0 && e0) dur = Math.max(1, S.countWork(s0, e0, c));
      if (d.level === 'milestone') dur = 1;
      // Tasks are matched by their exact name. A looser match would treat "UAT planning" as the phase "UAT".
      const nrm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const sameName = (a, b) => nrm(a) === nrm(b) || AI.tokens(a).sort().join(' ') === AI.tokens(b).sort().join(' ') && AI.tokens(a).length > 0;
      const topName = (nm) => [...P.tasks].reverse().find((t) => sameName(t.name, nm));
      const mkTask = (o) => { const t = { id: nid(), parent_id: null, position: P.tasks.reduce((m, x) => Math.max(m, x.position ?? 0), 0) + 1, name: '', start, duration: 1, progress: 0, assignee: null, deps: [], deliverable_id: null, b_start: null, b_end: null, notes: null, is_milestone: 0, jira_key: null, color: null, ...o }; P.tasks.push(t); return t; };
      let parent = null;
      // A milestone can share its name with the phase it closes. It is never chosen as a parent.
      if (d.phase) parent = [...P.tasks].reverse().find((t) => sameName(t.name, d.phase) && !t.is_milestone) || topName(d.phase) || mkTask({ name: d.phase, duration: 1 });
      const dupe = d.level === 'phase' && !d.phase ? topName(item.title) : null;
      const t = dupe || mkTask({ name: item.title, parent_id: parent ? parent.id : null, duration: dur, is_milestone: d.level === 'milestone' ? 1 : 0, notes: [d.note, d.type && d.type !== 'task' && d.type !== 'milestone' ? `Type: ${d.type}.` : null, d.owner ? `Owner: ${d.owner}.` : null, d.implied ? 'Added by the AI as an expected project step.' : item.quote ? `Source: "${item.quote}"` : null].filter(Boolean).join(' ') || null });
      if (dupe) { t.start = start; t.duration = dur; }
      const deps = [];
      for (const nm of d.depends_on || []) {
        const pred = [...P.tasks].reverse().find((x) => x.id !== t.id && sameName(x.name, nm));
        if (pred && !deps.some((x) => x.id === pred.id) && !wouldLoop(P.tasks, t.id, [{ id: pred.id }])) deps.push({ id: pred.id, lag: 0, type: 'FS' });
      }
      t.deps = deps;
      d.task_id = t.id;
      try { recalc(P); } catch (e) { /* schedule engine will rebuild on next read */ }
      note = `Added "${item.title}" to the schedule${parent ? ` under ${parent.name}` : ''}`;
    } else if (item.kind === 'milestone') {
      if (d.amount == null && d.percent != null && P.p.value) d.amount = Math.round((P.p.value * d.percent) / 100);
    }
    item.status = 'confirmed'; item.decided_by = actor === 'AI' ? 'AI' : 'user';
    audit(P, actor, 'item_confirmed', { summary: note || `Confirmed ${item.kind} "${item.title}"`, id: item.id });
  }

  // ---------- inbox actions ----------
  function describeAction(P, a) {
    if (a.type === 'update_task') {
      const t = P.tasks.find((x) => x.id === a.task_id);
      if (!t) return 'Update a task that no longer exists';
      const parts = [];
      if (a.progress != null) parts.push(`progress ${t.progress || 0}% to ${a.progress}%`);
      if (a.delay_days) parts.push(`start moves ${a.delay_days} working day${a.delay_days === 1 ? '' : 's'} later`);
      if (a.assignee) parts.push(`owner ${a.assignee}`);
      return `Task "${t.name}": ${parts.join(', ') || 'note recorded'}`;
    }
    if (a.type === 'close_deliverable') { const i = P.items.find((x) => x.id === a.deliverable_id); return `Close deliverable "${i ? i.title : '?'}"${a.evidence ? ` with evidence ${a.evidence}` : ''}`; }
    if (a.type === 'milestone_invoiced' || a.type === 'milestone_paid') { const i = P.items.find((x) => x.id === a.milestone_id); return `Mark payment milestone "${i ? i.title : '?'}" as ${a.type === 'milestone_paid' ? 'paid' : 'invoiced'}`; }
    if (a.type === 'flag_issue') return `Log an issue${a.task_id ? ' on a task' : ''}: ${(a.note || '').slice(0, 100)}`;
    if (a.type === 'create_item') return `Log ${a.kind || 'item'}: ${String(a.title || '').slice(0, 100)}`;
    if (a.type === 'create_task') return `Add task "${String(a.title || '').slice(0, 100)}"${a.assignee ? ' for ' + a.assignee : ''}`;
    return a.note || a.type;
  }
  function applyAction(P, action, actor, docId) {
    const prev = {};
    let summary = '';
    if (action.type === 'update_task') {
      const t = P.tasks.find((x) => x.id === action.task_id);
      if (!t) throw err(400, 'The task no longer exists');
      prev.task = { id: t.id, progress: t.progress, start: t.start, assignee: t.assignee };
      if (action.delay_days) t.start = S.addWork(t.start, action.delay_days, S.calendar(rawProject(P)));
      const progress = action.progress != null ? Math.max(0, Math.min(100, Math.round(action.progress))) : t.progress;
      summary = describeAction(P, { ...action, progress: action.progress != null ? progress : null });
      t.progress = progress; t.assignee = action.assignee || t.assignee;
      recalc(P);
    } else if (action.type === 'close_deliverable') {
      const it = P.items.find((x) => x.id === action.deliverable_id);
      if (!it) throw err(400, 'The deliverable no longer exists');
      prev.item = { id: it.id, state: it.state, evidence_doc_id: it.evidence_doc_id };
      prev.tasks = [];
      it.state = 'closed'; it.evidence_doc_id = docId ?? it.evidence_doc_id ?? null;
      for (const t of P.tasks.filter((x) => x.deliverable_id === it.id)) { prev.tasks.push({ id: t.id, progress: t.progress }); t.progress = 100; }
      if (prev.tasks.length) recalc(P);
      summary = `Deliverable "${it.title}" closed${docId ? ' with attached evidence' : ''}`;
    } else if (action.type === 'milestone_invoiced' || action.type === 'milestone_paid') {
      const it = P.items.find((x) => x.id === action.milestone_id);
      if (!it) throw err(400, 'The payment milestone no longer exists');
      prev.item = { id: it.id, state: it.state, evidence_doc_id: it.evidence_doc_id };
      it.state = action.type === 'milestone_paid' ? 'paid' : 'invoiced'; it.evidence_doc_id = docId ?? it.evidence_doc_id ?? null;
      summary = `Payment milestone "${it.title}" marked ${it.state}`;
    } else if (action.type === 'flag_issue') {
      const title = (action.note || 'Issue reported').slice(0, 140);
      const id = nid();
      P.items.push({ id, project_id: P.id, kind: 'risk', title, description: action.note || '', data: { probability: 'High', impact: 'Medium', mitigation: '', issue: true, task_id: action.task_id || null }, status: 'confirmed', state: 'open', confidence: action.confidence ?? null, doc_id: null, quote: '', evidence_doc_id: null, created_at: nowTs() });
      prev.created_item = id;
      summary = `Issue logged: ${title}`;
    } else if (action.type === 'create_item') {
      const kind = ['action', 'decision', 'risk', 'requirement', 'deliverable'].includes(action.kind) ? action.kind : 'action';
      const title = String(action.title || '').trim().slice(0, 200);
      if (!title) throw err(400, 'The item needs a title');
      const id = nid();
      P.items.push({ id, project_id: P.id, kind, title, description: action.description || '', data: { ...(action.data || {}) }, status: 'confirmed', state: kind === 'decision' ? 'active' : 'open', confidence: action.confidence ?? null, doc_id: null, quote: String(action.quote || '').slice(0, 300), evidence_doc_id: null, created_at: nowTs(), doc_name: null, evidence_name: null, meeting_id: action.meeting_id || null });
      prev.created_item = id;
      summary = `Logged ${kind}: ${title}`;
    } else if (action.type === 'create_task') {
      const name = String(action.title || '').trim().slice(0, 200);
      if (!name) throw err(400, 'The task needs a name');
      const c = S.calendar(rawProject(P));
      const today = TODAY();
      const due = /^\d{4}-\d{2}-\d{2}$/.test(action.due_date || '') ? action.due_date : null;
      const start = S.nextWork(due && due < today ? due : today, c);
      const dur = due && due > start ? Math.max(1, S.countWork(start, due, c)) : 1;
      const top = () => P.tasks.reduce((m, x) => Math.max(m, x.position ?? 0), 0) + 1;
      let group = P.tasks.find((x) => !x.parent_id && x.name === 'Meeting actions');
      if (!group) {
        group = { id: nid(), parent_id: null, position: top(), name: 'Meeting actions', start, duration: 1, progress: 0, assignee: null, deps: [], deliverable_id: null, b_start: null, b_end: null, notes: 'Tasks created from meeting minutes.', is_milestone: 0, jira_key: null, color: null };
        P.tasks.push(group); prev.created_group = group.id;
      }
      const id = nid();
      P.tasks.push({ id, parent_id: group.id, position: top(), name, start, duration: dur, progress: 0, assignee: action.assignee || null, deps: [], deliverable_id: null, b_start: null, b_end: null, notes: ['From a meeting.', due ? null : 'No due date was given.', action.note || null].filter(Boolean).join(' '), is_milestone: 0, jira_key: null, color: null, source: 'meeting', meeting_id: action.meeting_id || null, links: [] });
      P.tasks.sort((a, z) => (a.position ?? 0) - (z.position ?? 0) || a.id - z.id);
      prev.created_task = id;
      recalc(P); recordVersion(P, 'edit');
      summary = `Task "${name}" added to the schedule${due ? ` (due ${due})` : ''}`;
    } else throw err(400, 'Unknown action type');
    audit(P, actor, 'task_update', { summary, action: action.type });
    return { prev, summary };
  }
  function undoAction(P, action) {
    const p = action.prev || {};
    if (p.task) { const t = P.tasks.find((x) => x.id === p.task.id); if (t) { t.progress = p.task.progress; t.start = p.task.start; t.assignee = p.task.assignee; } recalc(P); }
    if (p.item) { const it = P.items.find((x) => x.id === p.item.id); if (it) { it.state = p.item.state; it.evidence_doc_id = p.item.evidence_doc_id; } }
    if (p.tasks && p.tasks.length) { for (const x of p.tasks) { const t = P.tasks.find((y) => y.id === x.id); if (t) t.progress = x.progress; } recalc(P); }
    if (p.created_item) { P.items = P.items.filter((i) => i.id !== p.created_item); for (const t of P.tasks) if (Array.isArray(t.links)) t.links = t.links.filter((x) => x !== p.created_item); }
    if (p.created_task) {
      P.tasks = P.tasks.filter((t) => t.id !== p.created_task);
      if (p.created_group && !P.tasks.some((t) => t.parent_id === p.created_group)) P.tasks = P.tasks.filter((t) => t.id !== p.created_group);
      recalc(P); recordVersion(P, 'edit');
    }
    audit(P, 'PM', 'undo', { summary: `Undid: ${action.summary || action.type}` });
  }
  function resolveResource(P, sender, hint) {
    const s = (sender || '').toLowerCase(), h = (hint || '').toLowerCase();
    const r = P.resources.find((x) => (x.email && s.includes(x.email.toLowerCase())) || (x.teams_name && s.includes(x.teams_name.toLowerCase())) || (x.name && (s.includes(x.name.toLowerCase()) || (h && h.includes(x.name.toLowerCase())))));
    return r ? r.name : hint || null;
  }
  function addInbox(P, o) {
    const row = { id: nid(), owner_id: DB.user.id, project_id: P.id, source: o.source, ext_id: o.ext_id || null, sender: o.sender || null, subject: o.subject || null, body: (o.body || '').slice(0, 4000), resource: o.resource || null, action: o.action || null, summary: o.summary || null, confidence: o.confidence ?? null, status: o.status || 'pending', doc_id: o.doc_id ?? null, created_at: nowTs(), applied_at: null };
    P.inbox.unshift(row);
    if (row.status === 'pending' && P.p.auto_apply && row.action && row.action.type !== 'flag_issue' && (row.confidence ?? 0) >= (P.p.auto_threshold ?? 0.9)) {
      try { const r = applyAction(P, row.action, `AI (${row.source})`, row.doc_id); row.status = 'auto_applied'; row.action = { ...row.action, prev: r.prev, summary: r.summary }; } catch (e) { /* stays pending */ }
    }
    return row;
  }
  // Phase 1 and Phase 2 are different things, so titles whose numbers differ never count as the same item.
  const numSet = (x) => [...new Set(String(x || '').match(/\d+/g) || [])].sort().join(',');
  const similarity = (a, b) => {
    const na = numSet(a), nb = numSet(b);
    if (na && nb && na !== nb) return 0;
    return Math.max(AI.similarity(a, b), AI.similarity(b, a));
  };

  // ---------- extraction (port of insertExtracted) ----------
  function insertItem(P, kind, o, docId) {
    const it = { id: nid(), project_id: P.id, kind, title: o.title || '', description: o.description || '', data: o.data || {}, status: 'proposed', state: kind === 'milestone' ? 'pending' : 'open', confidence: o.confidence ?? null, doc_id: docId ?? null, quote: (o.quote || '').slice(0, 300), evidence_doc_id: null, created_at: nowTs() };
    P.items.push(it); return it;
  }
  function addSource(it, name) { it.data.also_in = [...new Set([...(it.data.also_in || []), name])]; }
  function insertExtracted(P, doc, a) {
    const live = (kind) => P.items.filter((i) => i.kind === kind && i.status !== 'ignored');
    const counts = { field: 0, deliverable: 0, requirement: 0, risk: 0, milestone: 0, schedule: 0, merged: 0 };
    const label = doc.filename;
    const fields = live('field');
    for (const f of a.fields || []) {
      if (!FIELD_LABEL[f.field] || f.value == null || f.value === '') continue;
      const value = f.field === 'value' ? Number(f.value) : String(f.value);
      if (f.field === 'value' && !(value > 0)) continue;
      const same = fields.find((x) => x.data.field === f.field && String(x.data.value).toLowerCase() === String(value).toLowerCase());
      if (same) { addSource(same, label); counts.merged++; continue; }
      const it = insertItem(P, 'field', { title: FIELD_LABEL[f.field], data: { field: f.field, value }, confidence: f.confidence, quote: f.quote }, doc.id);
      const rivals = fields.filter((x) => x.data.field === f.field);
      if (rivals.length) for (const r of [...rivals, it]) r.data.conflict = true;
      fields.push(it); counts.field++;
    }
    // A schedule file or plan workbook lists every row on purpose. Its own rows are never merged with each other.
    const exact = a.engine === 'plan' || a.engine === 'msp';
    const dedupe = (kind, rows, text, threshold, make, enrich) => {
      const ex = live(kind).filter((x) => !(exact && x.doc_id === doc.id));
      const mine = [];
      // Rows of an exact source are compared with this document's own earlier rows as a count, so a second run adds nothing
      // while a row that really appears twice in the file is still kept twice.
      const ik = (o) => `${o.title}|${o.data && o.data.start}|${o.data && o.data.end}|${kind === 'risk' ? o.description : ''}`;
      const have = new Map();
      if (exact) for (const x of live(kind).filter((y) => y.doc_id === doc.id)) have.set(ik(x), (have.get(ik(x)) || 0) + 1);
      for (const r of rows || []) {
        const t = text(r); if (!t) continue;
        if (exact) { const k = ik(make(r)); if (have.get(k) > 0) { have.set(k, have.get(k) - 1); counts.merged++; continue; } }
        const dup = ex.find((x) => similarity(x.title + ' ' + x.description, t) >= threshold || similarity(x.title, t) >= threshold);
        if (dup) { addSource(dup, label); if (enrich) enrich(dup, r); counts.merged++; continue; }
        (exact ? mine : ex).push(insertItem(P, kind, make(r), doc.id)); counts[kind]++;
      }
    };
    dedupe('deliverable', a.deliverables, (r) => r.title, 0.8, (r) => ({ title: r.title, description: [r.ref ? `Ref ${r.ref}.` : '', r.description || '', r.acceptance ? `Acceptance: ${r.acceptance}.` : ''].filter(Boolean).join(' '), data: { ref: r.ref || null, phase: r.phase || null, acceptance: r.acceptance || null, due_date: r.due_date || null, due_dates: r.due_date ? [r.due_date] : [], amount: Number(r.amount) > 0 ? Number(r.amount) : null, category: r.category || null, week: r.week ?? null }, confidence: r.confidence, quote: r.quote }), (dup, r) => {
      if (r.ref && !dup.data.ref) dup.data.ref = r.ref;
      if (r.phase && !dup.data.phase) dup.data.phase = r.phase;
      if (r.acceptance && !dup.data.acceptance) { dup.data.acceptance = r.acceptance; dup.description = `${dup.description} Acceptance: ${r.acceptance}.`.trim(); }
      if (r.due_date) { dup.data.due_dates = [...new Set([...(dup.data.due_dates || (dup.data.due_date ? [dup.data.due_date] : [])), r.due_date])]; if (!dup.data.due_date) dup.data.due_date = r.due_date; }
      if (Number(r.amount) > 0 && !dup.data.amount) dup.data.amount = Number(r.amount);
    });
    dedupe('requirement', a.requirements, (r) => r.description || r.title, 0.8, (r) => ({ title: (r.title || '').slice(0, 120), description: [r.description || r.title, r.verification ? `Verified by: ${r.verification}.` : ''].filter(Boolean).join(' '), data: { priority: r.priority || 'Should', type: r.type || null, ref: r.ref || null, verification: r.verification || null }, confidence: r.confidence, quote: r.quote }));
    dedupe('risk', a.risks, (r) => r.title, 0.7, (r) => ({ title: r.title, description: r.description || '', data: { probability: r.probability || 'Medium', impact: r.impact || 'Medium', mitigation: r.mitigation || '', owner: r.owner || null, stated: true }, confidence: r.confidence, quote: r.quote }));
    dedupe('schedule', a.schedule, (r) => r.name, 0.85, (r) => ({ title: r.name, data: { start: r.start || null, end: r.end || null, duration_days: r.duration_days || null, level: r.level || 'task', type: r.type || null, owner: r.owner || null, phase: r.phase || null, start_week: r.start_week ?? null, end_week: r.end_week ?? null, depends_on: Array.isArray(r.depends_on) ? r.depends_on : [] }, confidence: r.confidence, quote: r.quote }));
    const ms = live('milestone');
    for (const m of a.milestones || []) {
      if (!m.title) continue;
      const dup = ms.find((x) => { if (m.amount != null && x.data.amount != null && Math.round(m.amount) !== Math.round(x.data.amount)) return false; const s = similarity(x.title, m.title); return s >= 0.7 || (m.percent != null && x.data.percent === m.percent && s >= 0.4); });
      if (dup) {
        addSource(dup, label);
        if (dup.data.due_date == null && m.due_date) dup.data.due_date = m.due_date;
        if (dup.data.amount == null && m.amount != null) dup.data.amount = m.amount;
        if (!dup.data.deliverable && m.deliverable) dup.data.deliverable = m.deliverable;
        if (!dup.data.terms_days && m.terms_days) dup.data.terms_days = m.terms_days;
        counts.merged++; continue;
      }
      ms.push(insertItem(P, 'milestone', { title: m.title, data: { percent: m.percent ?? null, amount: m.amount ?? null, due_date: m.due_date || null, trigger: m.trigger || null, deliverable: m.deliverable || null, ref: m.ref || null, terms_days: m.terms_days || null }, confidence: m.confidence, quote: m.quote }, doc.id)); counts.milestone++;
    }
    return counts;
  }
  // Plain language reason shown to the person when the AI could not be used for a file.
  const AI_REASON = {
    no_key: 'The AI is not connected because the server has no ANTHROPIC_API_KEY. Only a basic rule based reading was done.',
    bad_key: 'The Anthropic API key was rejected. Open Secrets in Replit, set ANTHROPIC_API_KEY to a valid key (it starts with sk-ant-), restart the app and use Analyze again. Only a basic rule based reading was done.',
    budget: 'The Anthropic account behind this key has no credit left. Add credit under Plans and Billing in the Anthropic Console (console.anthropic.com), then use Analyze again. Only a basic rule based reading was done.',
    rate: 'The AI is busy right now (rate limit). Use Reanalyze in a few minutes. Only a basic rule based reading was done.',
    network: 'The server could not be reached. Only a basic rule based reading was done.',
    badjson: 'The AI reply could not be read. Use Reanalyze to try again. Only a basic rule based reading was done.',
    cutoff: 'The AI reply could not be read. Use Reanalyze to try again. Only a basic rule based reading was done.',
    upstream: 'The AI service could not be reached. Use Reanalyze to try again. Only a basic rule based reading was done.',
    timeout: 'The AI took too long to answer. Use Analyze again to try again.',
  };
  // Plain language reason for a run that stopped before it finished.
  const failText = (e) => (e && e.code === 'pipe' ? 'The analysis module did not load in this browser tab. Refresh the page and use Analyze again.' : e && AI_REASON[e.code] ? AI_REASON[e.code] : `The analysis stopped before it finished${e && e.message ? ` (${String(e.message).slice(0, 160)})` : ''}. Use Analyze again.`);
  // ---------- analysis pipeline ----------
  // Six visible stages. The Review tab shows them while P.p.analyzing is on.
  const STAGES = [['ingest', 'Ingestion and Parsing'], ['retrieve', 'Retrieval'], ['context', 'Contextual Analysis'], ['analyze', 'Analyzing'], ['generate', 'Response Generation'], ['fill', 'Filling project data']];
  const FILL_AT = 0.8;
  function setStage(P, key, status, detail) {
    const st = P.analysis.stages.find((x) => x.key === key);
    if (!st) return;
    st.status = status;
    if (detail != null) st.detail = detail;
    if (status === 'active') { st.started = Date.now(); P.analysis.stage = key; st.frac = 0.1; }
    P.analysis.pct = progressOf(P);
    announce(P, 'progress');
  }
  // How long the run will take, shown to the person so they can keep working meanwhile.
  function etaFor(chars, docs) {
    const lo = Math.max(2, Math.round(chars / 45000) + 2);
    return { low: lo, high: lo + 3, docs, chars };
  }
  const refreshConfidence = (P) => { P.analysis.confidence = Pipe.confidence(P.items, P.analysis.docs); };
  // Share of the run each stage stands for. The Analyzing and Response Generation stages take most of the time.
  const STAGE_W = { ingest: 4, retrieve: 2, context: 8, analyze: 46, generate: 34, fill: 6 };
  function progressOf(P) {
    const run = P.analysis; if (!run) return 0;
    let sum = 0;
    for (const st of run.stages) {
      const w = STAGE_W[st.key] || 0;
      if (st.status === 'done' || st.status === 'skipped' || st.status === 'failed') sum += w;
      else if (st.status === 'active') sum += w * Math.max(0, Math.min(0.95, st.frac || 0.1));
    }
    return Math.min(99, Math.round(sum));
  }
  // The rest of the app listens to this to show a progress chip and a ready for review pop-up on any screen.
  function announce(P, type) {
    try {
      const run = P.analysis || {};
      const detail = { type, id: P.p.id, name: P.p.name, pct: type === 'done' ? 100 : progressOf(P), stage: run.stage, eta: run.eta || null, failed: !!run.failed, warning: run.warning || null, filled: run.filled || null };
      store.pushEvent(null, P.id, detail);
      store.saveSoon(P, type === 'done' ? 0 : 700);
    } catch (e) { /* notifications are best effort */ }
  }
  const countIn = (c) => c.deliverable + c.requirement + c.risk + c.milestone + c.schedule + c.field;

  async function analyzeDocs(P, docs) {
    const run = { at: nowTs(), finished: false, show_summary: false, stage: 'ingest', stages: STAGES.map(([key, label]) => ({ key, label, status: 'waiting', detail: '' })), confidence: { overall: null, by: {}, coverage: null }, filled: null, docs: docs.map((d) => ({ id: d.id, filename: d.filename, status: 'waiting', message: '', counts: null, coverage: null, engine: null, progress: '', role: null, role_label: null })) };
    P.analysis = run;
    P.p.analyzing = 1; running.add(P.id);
    announce(P, 'start');
    const rowOf = (d) => run.docs.find((r) => r.id === d.id);
    try {
      await ensurePipe();
      if (!Pipe || !Pipe.detectRole || !AI || !AI.splitParts) throw Object.assign(new Error('analysis module missing'), { code: 'pipe' });
      // 1. Ingestion and parsing
      setStage(P, 'ingest', 'active', `Reading ${docs.length} file${docs.length === 1 ? '' : 's'}`);
      let n = 0;
      for (const doc of docs) {
        const st = rowOf(doc);
        const f = doc.unread ? await store.getFile(P.id, doc.id) : null;
        if (f) {
          st.status = 'reading'; st.progress = 'reading the file';
          const r = await readFile({ name: doc.filename, buffer: f.buffer });
          P.texts[doc.id] = r.text || '';
          doc.chars = (r.text || '').length; doc.pages = r.pages || null; doc.read_error = r.error || null; doc.ocr = !!r.ocr;
          doc.kind = AI.classify(doc.filename, r.text || '');
          doc.unread = false;
          audit(P, ACTOR(), 'document_uploaded', { summary: `Uploaded ${doc.filename} (${doc.kind})` });
        } else if (doc.unread) { doc.unread = false; doc.read_error = doc.read_error || 'The original file is no longer stored. Upload it again.'; }
        n++;
        run.stages[0].detail = `${n} of ${docs.length} files read${doc.pages ? `, ${doc.pages} pages` : ''}`;
        const text = P.texts[doc.id] || '';
        if (!text.trim()) { st.status = 'failed'; st.message = doc.read_error || 'No text could be read from this file.'; audit(P, 'AI', 'document_failed', { summary: `Could not read ${doc.filename}. ${st.message}` }); }
        else st.status = 'waiting';
      }
      const readable = docs.filter((d) => (P.texts[d.id] || '').trim());
      run.eta = etaFor(readable.reduce((a, d) => a + (d.chars || 0), 0), readable.length);
      setStage(P, 'ingest', 'done', `${readable.length} of ${docs.length} files read, ${readable.reduce((a, d) => a + (d.chars || 0), 0).toLocaleString('en-US')} characters`);

      // 2. Retrieval: decide what each document may supply and pull out the passages that matter
      setStage(P, 'retrieve', 'active', 'Matching documents to the data they can supply');
      let passageCount = 0;
      for (const doc of readable) {
        const text = P.texts[doc.id];
        const r = Pipe.detectRole(doc.filename, text);
        doc.role = r.role; doc.role_conf = r.confidence;
        const st = rowOf(doc); st.role = r.role; st.role_label = Pipe.ROLE_LABEL[r.role];
        passageCount += Pipe.passages(text).length;
      }
      setStage(P, 'retrieve', 'done', `${readable.map((d) => Pipe.ROLE_LABEL[d.role]).join(', ') || 'No documents'}. ${passageCount} passages about assumptions and dependencies indexed`);

      // 3. Contextual analysis: confirm the role and summarize each document
      setStage(P, 'context', 'active', 'Understanding each document');
      await AI.ready();
      const aiOn = AI.hasKey();
      let aiError = null;
      if (aiOn) {
        await Promise.all(readable.filter((d) => d.role !== 'schedule').map(async (doc) => {
          try {
            const c = await Pipe.context(doc, P.texts[doc.id], doc.role);
            doc.role = c.role; doc.summary = c.summary || doc.summary || ''; if (c.project_name && !P.p.ai_name) P.p.ai_name = c.project_name;
            const st = rowOf(doc); st.role = doc.role; st.role_label = Pipe.ROLE_LABEL[doc.role];
          } catch (e) { aiError = aiError || { code: e.code || 'upstream', message: e.message }; }
        }));
      }
      // If the AI could not be used the person is told clearly, with the reason and a way to try again.
      if (!aiOn || aiError) { const code = aiOn ? aiError.code : 'no_key'; run.warning = { code, message: AI_REASON[code] || AI_REASON.upstream }; }
      setStage(P, 'context', aiOn && !aiError ? 'done' : 'failed', aiOn && !aiError ? readable.map((d) => `${d.filename}: ${Pipe.ROLE_LABEL[d.role]}`).join('. ') : `The AI could not be used. ${run.warning.message}`);

      // 4. Analyzing: read every part of every document with the prompt that fits its role
      setStage(P, 'analyze', 'active', 'Reading every page');
      let docNo = 0;
      // Every document is read at the same time. The shared request limit keeps the load sensible.
      await Promise.all(readable.map(async (doc) => {
        const st = rowOf(doc);
        const text = P.texts[doc.id];
        st.status = 'reading';
        try {
          let a, scope = Pipe.SCOPE[doc.role] || Pipe.SCOPE.other;
          // The schedule role is for Microsoft Project XML only. Anything else with that label is read as a plan or by the AI.
          if (doc.role === 'schedule' && !Pipe.isMspXml(text)) { doc.role = Pipe.planFromText(text).found ? 'plan' : 'other'; st.role = doc.role; st.role_label = Pipe.ROLE_LABEL[doc.role]; scope = Pipe.SCOPE[doc.role]; }
          if (doc.role === 'plan') {
            // A workbook with a plan table and a risk table is read row by row in code, so no row is skipped or reworded.
            a = Pipe.extractPlan({ text });
            // A plan with dates on Sunday and none on Friday or Saturday is a Sunday to Thursday week. Only a project that still has
            // the default calendar and no tasks is changed, so dates and durations land on the same days as in the plan.
            const days = a.schedule.flatMap((t) => [t.start, t.end]).filter(Boolean).map((d) => new Date(d + 'T00:00:00Z').getUTCDay());
            if (JSON.stringify(P.p.work_days) === '[1,2,3,4,5]' && !P.tasks.length && days.some((d) => d === 0) && !days.some((d) => d === 5 || d === 6)) {
              P.p.work_days = [0, 1, 2, 3, 4];
              audit(P, 'AI', 'calendar_set', { summary: `Working week set to Sunday to Thursday because the plan in ${doc.filename} has dates on Sundays and none on Fridays or Saturdays` });
            }
            if (a.project_name && !P.p.ai_name) P.p.ai_name = a.project_name;
            if (!doc.summary) doc.summary = `Project plan workbook with ${a.schedule.length} schedule lines${a.risks.length ? ` and ${a.risks.length} listed risks` : ''}${a.fields.length ? `, ${a.fields[0].value} to ${a.fields[1].value}` : ''}.`;
          } else if (doc.role === 'schedule') {
            const m = Pipe.scheduleFromMsp(text);
            a = { engine: 'msp', fields: [m.start ? { field: 'start_date', value: m.start, confidence: 0.98, quote: m.items[0].quote } : null, m.end ? { field: 'end_date', value: m.end, confidence: 0.98, quote: m.items[m.items.length - 1].quote } : null].filter(Boolean), schedule: m.items, deliverables: [], requirements: [], milestones: [], coverage: { chars_total: text.length, chars_sent: text.length, parts: 1, parts_read: 1, parts_failed: 0, dropped_no_quote: 0 } };
            doc.summary = `Microsoft Project schedule with ${m.items.length} tasks, ${m.start} to ${m.end}.`;
          } else if (aiOn && !aiError) {
            a = await Pipe.extractDoc({ text, filename: doc.filename, role: doc.role, onProgress: (p) => { st.progress = `part ${p.done} of ${p.total}`; st.pd = p.done; st.pt = p.total; const tot = run.docs.reduce((n, d) => n + (d.pt || 1), 0); const dn = run.docs.reduce((n, d) => n + (d.status === 'done' || d.status === 'partial' || d.status === 'failed' ? (d.pt || 1) : (d.pd || 0)), 0); const as = run.stages[3]; as.frac = tot ? dn / tot : 0.1; run.pct = progressOf(P); announce(P, 'progress'); } });
          } else {
            a = await AI.analyzeDocument({ text, filename: doc.filename, onProgress: () => {} });
            const keep = { deliverables: 'deliverables', requirements: 'requirements', milestones: 'payments', schedule: 'schedule', fields: 'info' };
            for (const [k, sec] of Object.entries(keep)) { if (!scope.includes(sec)) a[k] = []; else a[k] = (a[k] || []).slice(0, 40); }
            a.risks = [];
            if (!a.ai_error && aiError) a.ai_error = aiError;
          }
          if (!doc.summary) doc.summary = a.summary || '';
          const c = insertExtracted(P, doc, a);
          const found = countIn(c);
          st.counts = c; st.coverage = a.coverage || null; st.engine = a.engine; st.progress = '';
          if (a.engine === 'rules') { st.status = 'basic'; st.message = AI_REASON[(a.ai_error && a.ai_error.code) || 'upstream'] || AI_REASON.upstream; }
          else if (a.coverage && a.coverage.parts_failed) { st.status = 'partial'; st.message = `Part of this document could not be read by the AI (${a.coverage.parts_failed} of ${a.coverage.parts} parts). Use Reanalyze to try again.`; }
          else if (a.engine === 'plan' && !found && !c.merged) { st.status = 'empty'; st.message = 'A plan table was found but every row was already in the project.'; }
          else if (!found && !c.merged) { st.status = 'empty'; st.message = 'The document was read in full but nothing it is allowed to supply was found in it.'; }
          else st.status = 'done';
          if (a.engine === 'plan' && a.sheets_skipped && a.sheets_skipped.length) st.message = `Read as tables: ${a.sheets_read.join(', ')}. Not read as a table: ${a.sheets_skipped.join(', ')}. A month grid drawn with colored cells has no dates in it, so the dates come from the plan table.`;
          refreshConfidence(P);
          docNo++; run.stages[3].detail = `Document ${docNo} of ${readable.length}: ${P.items.filter((i) => i.status !== 'ignored').length} items found so far`;
          audit(P, 'AI', 'document_analyzed', { summary: `Analyzed ${doc.filename} as ${Pipe.ROLE_LABEL[doc.role]}: ${c.deliverable} deliverables, ${c.requirement} requirements, ${c.milestone} payment milestones, ${c.schedule} schedule lines${a.coverage ? `. Read ${a.coverage.chars_sent.toLocaleString('en-US')} of ${a.coverage.chars_total.toLocaleString('en-US')} characters` : ''}` });
        } catch (e) {
          console.error(e);
          st.status = 'failed'; st.progress = '';
          st.message = e.code && AI_REASON[e.code] ? AI_REASON[e.code] : 'Something went wrong while analyzing this file. Use Reanalyze to try again.';
          audit(P, 'AI', 'document_failed', { summary: `Analysis failed for ${doc.filename}` });
        }
      }));
      setStage(P, 'analyze', 'done', `${P.items.filter((i) => i.status !== 'ignored').length} items extracted from ${readable.length} documents`);

      // 5. Response generation: one schedule, project risks, consistency checks
      setStage(P, 'generate', 'active', 'Building the schedule and analyzing risks');
      try { if (readable.length) await reconcile(P); } catch (e) { console.error('reconcile failed', e); }
      refreshConfidence(P);
      setStage(P, 'generate', 'done', P.analysis.synthesis ? `${P.analysis.synthesis.checks.length} checks run, ${P.analysis.synthesis.phases} phases planned` : 'Checks run');

      // 6. Fill the project
      setStage(P, 'fill', 'active', 'Filling project data');
      const filled = autofill(P);
      refreshConfidence(P);
      run.filled = filled;
      setStage(P, 'fill', 'done', `${filled.confirmed} items filled in, ${filled.review} left for your review`);
    } catch (e) {
      // Never end silently. The person sees what stopped and gets an Analyze again button.
      console.error('analysis failed', e);
      const message = failText(e);
      run.failed = { message, detail: String((e && e.message) || e) };
      for (const st of run.stages) if (st.status === 'active') { st.status = 'failed'; st.detail = message; }
      for (const d of run.docs) if (d.status === 'waiting' || d.status === 'reading') { d.status = 'failed'; d.progress = ''; d.message = message; }
      try { audit(P, 'AI', 'analysis_failed', { summary: `Analysis stopped. ${message}` }); } catch (x) { /* audit is best effort */ }
    } finally {
      P.p.analyzing = 0; running.delete(P.id);
      run.finished = true;
      run.show_summary = true;
      run.pct = 100;
      for (const st of run.stages) if (st.status === 'active') st.status = 'done'; else if (st.status === 'waiting') st.status = 'skipped';
      announce(P, 'done');
    }
  }

  // Puts the extracted data into the project. High confidence items are confirmed, the rest wait for review.
  function autofill(P) {
    const authority = (it) => { const d = P.documents.find((x) => x.id === it.doc_id); return (d && Pipe.AUTHORITY[d.role]) || 1; };
    const out = { confirmed: 0, review: 0, kinds: {}, conflicts: [] };
    // Only items read by the AI or taken from a schedule file are filled in. The rule based fallback is never trusted on its own.
    const trusted = new Set(((P.analysis && P.analysis.docs) || []).filter((d) => d.engine === 'claude' || d.engine === 'msp' || d.engine === 'plan').map((d) => d.id));
    const ok = (it) => it.doc_id == null || trusted.has(it.doc_id);
    const bump = (kind) => { out.confirmed++; out.kinds[kind] = (out.kinds[kind] || 0) + 1; };
    for (const col of Object.keys(FIELD_LABEL)) {
      const c = P.items.filter((i) => i.kind === 'field' && i.status === 'proposed' && i.data.field === col && ok(i)).sort((a, b) => authority(b) - authority(a) || (b.confidence || 0) - (a.confidence || 0));
      if (!c.length || (c[0].confidence || 0) < 0.7) continue;
      const alts = [...new Set(c.slice(1).map((x) => String(x.data.value)).filter((v) => v !== String(c[0].data.value)))];
      if (alts.length) { c[0].data.alternatives = alts; out.conflicts.push(`${FIELD_LABEL[col]}: using ${c[0].data.value}, other documents say ${alts.join(', ')}`); }
      confirmItem(P, c[0], 'AI'); bump('field');
    }
    for (const kind of ['deliverable', 'requirement', 'milestone', 'risk']) {
      for (const it of P.items.filter((i) => i.kind === kind && i.status === 'proposed' && ok(i))) if ((it.confidence || 0) >= FILL_AT) { confirmItem(P, it, 'AI'); bump(kind); }
    }
    if (!P.tasks.length) {
      for (const it of P.items.filter((i) => i.kind === 'schedule' && i.status === 'proposed' && ok(i)).sort((a, b) => a.id - b.id)) if ((it.confidence || 0) >= 0.7) { confirmItem(P, it, 'AI'); bump('schedule'); }
    }
    // Project dates the documents did not state are taken from the schedule that was built.
    const dated = P.items.filter((i) => i.kind === 'schedule' && i.status === 'confirmed' && i.data.start && !i.data.note);
    if (dated.length) {
      const starts = dated.map((i) => i.data.start).sort(), ends = dated.map((i) => i.data.end || i.data.start).sort();
      if (!P.p.start_date) { P.p.start_date = starts[0]; out.conflicts.push(`Start date taken from the schedule: ${starts[0]}`); }
      if (!P.p.end_date) { P.p.end_date = ends[ends.length - 1]; out.conflicts.push(`End date taken from the schedule: ${ends[ends.length - 1]}`); }
    }
    out.review = P.items.filter((i) => i.status === 'proposed').length;
    audit(P, 'AI', 'project_filled', { summary: `Filled the project: ${out.confirmed} items confirmed, ${out.review} waiting for review` });
    return out;
  }
  // After every file is read: put weeks on the calendar, build one consolidated schedule, and run the plain code checks.
  async function reconcile(P) {
    const docs = P.documents.filter((d) => (P.texts[d.id] || '').trim() && (d.summary || P.items.some((i) => i.doc_id === d.id)));
    const view = () => P.items.map((i) => itemView(P, i));
    const fld = (f) => { const it = P.items.find((i) => i.kind === 'field' && i.data.field === f && i.status !== 'ignored'); return it ? it.data.value : null; };
    const proj = () => ({ start_date: P.p.start_date || fld('start_date'), end_date: P.p.end_date || fld('end_date'), award_date: P.p.award_date || fld('award_date'), value: P.p.value || Number(fld('value')) || null, currency: P.p.currency || fld('currency') });
    const anchor = proj().start_date || proj().award_date || null;
    for (const i of P.items) {
      if (i.kind === 'schedule' && i.status === 'proposed' && !i.data.start && i.data.start_week && anchor) { const w = AI.weeksToDates(anchor, i.data.start_week, i.data.end_week); i.data.start = w.start; i.data.end = i.data.end || w.end; i.data.from_weeks = true; }
    }
    const out = { at: nowTs(), summary: '', notes: [], anchor, anchor_basis: P.p.start_date ? 'project start date' : proj().award_date ? 'award date' : proj().start_date ? 'start date in the documents' : null, engine: 'rules', phases: 0, checks: [] };
    P.items = P.items.filter((i) => !(i.data && i.data.synthesized && i.status === 'proposed'));
    for (const i of P.items) if (i.data && i.data.superseded && i.status === 'ignored') { i.status = 'proposed'; delete i.data.superseded; }
    // A schedule file, or a plan workbook whose rows were read, is the schedule. It is never replaced by a generated one.
    const hasSchedFile = docs.some((d) => d.role === 'schedule' || (d.role === 'plan' && P.items.some((i) => i.doc_id === d.id && i.kind === 'schedule')));
    // The schedule and the risk analysis are independent, so both AI calls run at the same time.
    const gen = P.analysis.stages.find((x) => x.key === 'generate');
    const synP = hasSchedFile ? Promise.resolve(null) : Pipe.buildSchedule({ docs, items: view(), anchor, project: proj(), texts: P.texts, onProgress: (label, frac) => { gen.detail = label; if (frac != null) gen.frac = frac; P.analysis.pct = progressOf(P); announce(P, 'progress'); } }).catch((e) => ({ failed: true, reason: (e && e.message) || 'unknown', plan: [], notes: [], summary: '' }));
    let riskP = Promise.resolve(null);
    if (AI.hasKey() && docs.length) {
      const preChecks = AI.runChecks({ items: view(), project: proj(), docs: (P.analysis && P.analysis.docs) || [] });
      const rdocs = docs.map((d) => ({ id: d.id, filename: d.filename, role: d.role, summary: d.summary }));
      riskP = Pipe.analyzeRisks({ project: proj(), docs: rdocs, items: view(), text: P.texts, checks: preChecks }).catch((e) => { console.error('risk analysis', e); return []; });
    }
    const syn = await synP;
    if (syn && syn.failed) out.notes.push('The schedule was only partly built. Use Analyze again to rebuild it.');
    if (syn && syn.failed && P.analysis && !P.analysis.warning) P.analysis.warning = { code: 'schedule', message: 'The documents were read and the items were filled in, but the schedule was only partly built. Use Analyze again to rebuild it.' };
    if (syn && syn.plan.length >= 3) {
      for (const i of P.items) if (i.kind === 'schedule' && i.status === 'proposed') { i.status = 'ignored'; i.data.superseded = true; }
      const cal = S.calendar(rawProject(P));
      for (const r of syn.plan) {
        let note = null;
        // Rows without dates carry a working day number counted from the anchor. The calendar of the project turns it into dates.
        if (!r.start && r.start_day && anchor) {
          r.start = S.addWork(anchor, r.start_day - 1, cal);
          r.end = r.level === 'milestone' || !(r.duration_days > 1) ? r.start : S.addWork(r.start, r.duration_days - 1, cal);
        } else if (r.start && !r.end && r.duration_days > 1 && r.level !== 'milestone') r.end = S.addWork(r.start, r.duration_days - 1, cal);
        // A source date earlier than the award cannot be delivered. It is parked at the anchor with a visible note.
        if (anchor && r.level !== 'phase' && ((r.start && r.start < anchor) || (r.end && r.end < anchor))) { note = `Source date ${r.start || r.end} is before the award date ${anchor}. Re baseline with the client.`; r.start = anchor; r.end = anchor; }
        if (!note && r.implied && r.assumption) note = r.assumption;
        const it = insertItem(P, 'schedule', { title: r.name, data: { note, start: r.start, end: r.end, duration_days: r.duration_days || null, level: r.level, type: r.type, owner: r.owner, implied: r.implied, phase: r.phase, start_week: r.start_week, end_week: r.end_week, depends_on: r.depends_on, synthesized: true, refs: r.refs, also_in: r.source_docs }, confidence: r.implied ? 0.75 : 0.8, quote: r.quote }, null);
        it.doc_id = (P.items.find((x) => x.id === r.refs[0]) || {}).doc_id ?? null;
        out.phases += r.level === 'phase' ? 1 : 0;
      }
      out.summary = syn.summary; out.notes = out.notes.concat(syn.notes); out.engine = 'claude';
    }
    P.analysis.stages.find((x) => x.key === 'generate').detail = 'Running consistency checks';
    const checks = AI.runChecks({ items: view(), project: proj(), docs: (P.analysis && P.analysis.docs) || [] });
    // Project risks are analysed from the whole document set
    P.items = P.items.filter((i) => !(i.kind === 'risk' && i.data && i.data.analysis && i.status === 'proposed'));
    if (AI.hasKey() && docs.length) {
      const risks = (await riskP) || [];
      const ex = P.items.filter((i) => i.kind === 'risk' && i.status !== 'ignored');
      for (const r of risks) {
        if (ex.some((x) => similarity(x.title, r.title) >= 0.7)) continue;
        const it = insertItem(P, 'risk', { title: r.title, description: r.description, data: { probability: r.probability, impact: r.impact, mitigation: r.mitigation, category: r.category, owner: r.owner, response: r.response, analysis: true, inferred: r.inferred }, confidence: r.confidence, quote: r.quote }, null);
        ex.push(it);
      }
      out.risks = risks.length;
    }
    out.checks = checks;
    if (!out.summary) out.summary = [...new Set(docs.map((d) => d.summary).filter(Boolean))].join(' ').slice(0, 600);
    if (!P.analysis) P.analysis = { docs: [], stages: [] };
    P.analysis.synthesis = out;
    audit(P, 'AI', 'project_reconciled', { summary: `Cross checked ${docs.length} documents: ${out.checks.filter((c) => c.status === 'Pass').length} passed, ${out.checks.filter((c) => c.status === 'Warn').length} warnings, ${out.checks.filter((c) => c.status === 'Fail').length} failed${out.phases ? `. Built a schedule with ${out.phases} phases` : ''}` });
  }
  // Returns { text, error, pages, ocr }. Plain text and XML are read here. Everything else is read by the server.
  async function readFile(f) {
    const n = (f.name || '').toLowerCase();
    if (/\.(txt|md|csv|tsv|json|eml|html?|xml)$/.test(n)) return { text: f.buffer.toString('utf8') };
    if (/\.(pdf|docx|pptx|xlsx|xls|png|jpe?g|webp|gif|mpp|doc|ppt)$/.test(n)) {
      try {
        const out = await extractText(f.buffer, f.name);
        const text = String(out.text || '').replace(/\u0000/g, '').trim();
        if (!text) return { text: '', error: out.ocr ? 'The AI could not find any readable text in this file.' : 'No text found in this file.' };
        return { text, pages: out.pages || out.slides || null, ocr: !!out.ocr };
      } catch (e) {
        const missing = e && e.code === 'MODULE_NOT_FOUND';
        return { text: '', error: missing ? 'File reading is not installed on the server. Run npm install.' : `Could not read ${f.name || 'the file'}: ${e.message}` };
      }
    }
    return { text: '', error: 'This file type is not supported. Use PDF, Word, PowerPoint, Excel, pictures, Project XML or text files.' };
  }
  async function addDocuments(P, files) {
    const docs = [];
    for (const f of files) {
      const r = await readFile(f);
      const text = r.text || '';
      const kind = AI.classify(f.name, text);
      const d = { id: nid(), filename: f.name, kind, summary: '', uploaded_by: ACTOR(), created_at: nowTs(), chars: text.length, pages: r.pages || null, read_error: r.error || null };
      P.documents.push(d); P.texts[d.id] = text; docs.push(d);
      await store.putFile(P.id, d.id, f); // the original is kept so it can be downloaded again
    }
    return docs;
  }
  async function processEvidence(P, doc) {
    const deliverables = P.items.filter((i) => i.kind === 'deliverable' && i.status !== 'ignored');
    const milestones = P.items.filter((i) => i.kind === 'milestone' && i.status !== 'ignored');
    const r = await AI.interpretEvidence({ doc: { ...doc, text: P.texts[doc.id] || '' }, deliverables, tasks: P.tasks, milestones, projectName: P.p.name });
    const base = { source: 'upload', sender: 'Uploaded document', subject: doc.filename, body: (doc.summary || P.texts[doc.id] || '').slice(0, 500), doc_id: doc.id };
    if (!r.updates.length) { addInbox(P, { ...base, status: 'no_action', summary: `No matching deliverable or task found in ${doc.filename}. You can link it manually from the Documents tab.` }); return 1; }
    for (const u of r.updates) { const action = { ...u, evidence: doc.filename }; addInbox(P, { ...base, action, summary: describeAction(P, action), confidence: u.confidence ?? 0.5 }); }
    return r.updates.length;
  }

  // ---------- reports ----------
  function reportInputs(P, today, periodDays, lastWeek) {
    return {
      project: rawProject(P), user: DB.user, tasks: P.tasks, items: P.items.map((i) => ({ ...i, data: JSON.stringify(i.data) })), resources: P.resources,
      docs: P.documents.map((d) => ({ id: d.id, filename: d.filename, kind: d.kind, summary: d.summary, text: P.texts[d.id] || '' })),
      audit: P.audit.map((a) => ({ ...a, detail: JSON.stringify(a.detail) })), inbox: P.inbox.map((r) => ({ status: r.status })), today, periodDays, lastWeek: lastWeek || null,
      closure: P.closure ? { accepted_by: P.closure.accepted_by || '', accepted_on: P.closure.accepted_on || '', closed_at: P.closure.closed_at || null } : {},
    };
  }

  // ---------- dashboard ----------
  // f holds the overview filters (see overview_filter.js). Without any filter the answer is the whole portfolio, as it always was.
  // Project level numbers (health, progress, SPI) always describe the whole project. The period and the status narrow the rows
  // under them: tasks, payments, deliverables, risks, the late list and the activity.
  function dashboard(f) {
    f = f || {};
    const all = DB.order.map((id) => DB.projects[id]).filter(isLive).reverse();
    const cards = [], payments = [], overdue = [], radarEntries = [], kept = [], scs = new Map();
    const next60 = S.addDays(TODAY(), 60);
    const range = OF.range(f), scoped = !!(f.y || f.s), inView = {};
    let pendingInbox = 0, pendingItems = 0;
    const entries = all.map((P) => ({ P, st: stats(P) }));
    for (const { P, st } of entries) {
      if (!OF.projectPasses(P, st, f)) continue;
      const mm = S.progressMetrics(P.tasks, rawProject(P), TODAY()); // once per project, the radar and the late list read the same rows
      const sc = OF.scope(P, f, mm.rows, TODAY());
      if (!OF.includeProject(P, st, f, sc)) continue;
      kept.push(P);
      const ss = OF.scopedStats(st, sc, f); // the figures inside the picked period and status
      pendingInbox += ss.pendingInbox; pendingItems += ss.pendingItems;
      cards.push({ ...clone(P.p), stats: ss });
      scs.set(P.id, sc);
      // with a period or status on, the value tile adds up the payments inside it instead of the whole contract
      if (scoped) for (const m of sc.items) if (m.kind === 'milestone') { const dd = m.data || {}, amt = dd.amount ?? (dd.percent != null && P.p.value ? Math.round((P.p.value * dd.percent) / 100) : 0); if (amt) inView[P.p.currency] = (inView[P.p.currency] || 0) + amt; }
      radarEntries.push({ p: { ...clone(P.p), id: P.id }, stats: ss, items: sc.items.map((i) => ({ ...i, data: i.data || {} })), rows: sc.rows, sched: S.schedule(P.tasks, rawProject(P)) });
      for (const m of sc.items.filter((i) => i.kind === 'milestone' && (i.state !== 'paid' || f.s === 'done'))) {
        const d = m.data;
        if (d.due_date) {
          const amount = d.amount ?? (d.percent != null && P.p.value ? Math.round((P.p.value * d.percent) / 100) : null);
          payments.push({ item_id: m.id, project_id: P.id, project: P.p.name, currency: P.p.currency, title: m.title, due: d.due_date, amount, state: m.state, late: d.due_date < TODAY() && m.state === 'pending' });
        }
      }
      for (const r of sc.rows) if (r.overdue) overdue.push({ task_id: r.id, project_id: P.id, project: P.p.name, task: r.name, finish: r.finish, progress: r.progress, assignee: r.assignee });
    }
    payments.sort((a, b) => a.due.localeCompare(b.due));
    const soon = payments.filter((x) => x.due <= next60);
    const shown = OF.active(f) ? payments : (soon.length >= 4 ? soon : payments.slice(0, 5));
    overdue.sort((a, b) => a.finish.localeCompare(b.finish));
    const activity = [];
    for (const P of kept) for (const a of P.audit) if (OF.inRange(String(a.ts || a.created_at || '').slice(0, 10), range)) activity.push({ ...clone(a), project: P.p.name });
    activity.sort((a, b) => (b.ts || '').localeCompare(a.ts || '') || b.id - a.id);
    const totalValue = {};
    for (const P of kept) if (P.p.value) totalValue[P.p.currency] = (totalValue[P.p.currency] || 0) + P.p.value;
    return {
      today: TODAY(), radar: win.__Radar.buildRadar(radarEntries, TODAY()), analytics: (() => { const A = win.__Analytics.buildAnalytics(radarEntries, TODAY()); OF.fitTimeline(A.timeline, f, scs); return A; })(), projects: cards, payments: shown.slice(0, 10), overdue: overdue.slice(0, 12), overdueTotal: overdue.length, payments_all: payments.slice(0, 500), overdue_all: overdue.slice(0, 500), activity: activity.slice(0, 12), pendingInbox, pendingItems, totalValue: scoped ? inView : totalValue, valueScoped: scoped, unassigned: 0,
      counts: { active: kept.filter((p) => p.p.status === 'active').length, red: cards.filter((c) => c.stats.health === 'red').length, amber: cards.filter((c) => c.stats.health === 'amber').length, green: cards.filter((c) => c.stats.health === 'green').length },
      filters: f, filter_options: OF.options(entries), kept,
    };
  }

  // ---------- daily snapshots ----------
  // The key figures of one project today. This is the only place the snapshot figures are defined. Every number is
  // read from the same functions the live dashboards use (stats, radar, analytics), so a trend point and the
  // dashboard tile of that day agree.
  function snapshotFigures(P) {
    const today = TODAY(), raw = rawProject(P), st = stats(P), sched = S.schedule(P.tasks, raw);
    const items = P.items.map((i) => ({ ...i, data: i.data || {} }));
    const entry = { p: { ...P.p, id: P.id }, stats: st, items: items.filter((i) => ['risk', 'milestone', 'deliverable'].includes(i.kind)), rows: S.progressMetrics(P.tasks, raw, today).rows, sched };
    const radar = win.__Radar.buildRadar([entry], today), A = win.__Analytics.buildAnalytics([entry], today);
    const dl = A.deliverables[0] || { open: 0, closed: 0 }, pay = A.payments[0] || {};
    const fe = st.forecast_end || null, ce = P.p.end_date || null;
    return {
      v: 1, health: st.health, progress: st.progress, planned: st.planned, spi: st.spi,
      tasks: st.tasks, overdue: st.overdue, high_risks: radar.counts.high, pending_review: st.pendingItems + st.pendingInbox,
      deliv_open: dl.open, deliv_closed: dl.closed,
      forecast_end: fe, contract_end: ce, slip_days: fe && ce ? Math.round(dnum(fe) - dnum(ce)) : null,
      currency: P.p.currency || '', value: P.p.value || 0,
      pay: { paid: pay.paid || 0, invoiced: pay.invoiced || 0, pending: pay.pending || 0, late: pay.late || 0, total: pay.total || 0 },
    };
  }
  const snapshots = new Snapshots(store.db);
  // Records today's row for each project (archived projects are left out, like on the dashboards). One broken
  // project never stops the others.
  // A project that has not been saved since its last capture today would produce the same figures, so opening a
  // dashboard does not recompute and rewrite it. Pass force to record every project regardless.
  const lastCapture = new Map();
  async function capture(list, force) {
    const date = TODAY();
    let saved = 0;
    for (const P of list) {
      if (!P || !P.p || !isLive(P)) continue;
      const c = store.cache.get(P.id), stamp = c ? `${c.version}|${date}` : null;
      if (!force && stamp && lastCapture.get(P.id) === stamp) continue;
      try { await snapshots.save(P.id, date, snapshotFigures(P)); saved++; if (stamp) lastCapture.set(P.id, stamp); } catch (e) { lastCapture.delete(P.id); console.error('snapshot failed for project', P.id, e.message); }
    }
    return saved;
  }
  // The daily job: every project in the database, in small groups so a large workspace never loads at once.
  // Projects already in memory are used as they are because they hold changes that are not saved yet.
  async function captureAll() {
    const ids = (await store.db.query('SELECT id FROM projects ORDER BY id')).rows.map((r) => r.id);
    let saved = 0;
    for (let i = 0; i < ids.length; i += 20) {
      const list = [], need = [];
      for (const id of ids.slice(i, i + 20)) { const c = store.cache.get(id); if (c && c.P) list.push(c.P); else need.push(id); }
      if (need.length) for (const row of await store.readRows(need)) { if (row.data && row.data.id == null) row.data.id = row.id; list.push(row.data); }
      saved += await capture(list, true);
      await new Promise((ok) => setImmediate(ok));
    }
    return saved;
  }
  // Opening a trends screen first records today's point, so the newest point is never older than the screen.
  // The trend widgets read the daily snapshots. With a period on the overview they read the days of that period instead of the last
  // days, and a period that has not started yet has no history to draw.
  async function trendsFor(list, days, range) {
    const real = TODAY();
    await capture(list);
    let from = dstr(dnum(real) - days), to = real;
    if (range) { from = range.lo; to = range.hi < real ? range.hi : real; days = Math.max(1, Math.round(dnum(to) - dnum(from))); }
    const ids = list.map((P) => P.id), pj = list.map((P) => ({ id: P.id, name: P.p.name, currency: P.p.currency }));
    if (from > to) return buildTrends([], { today: to, days, projects: pj });
    let rows = await snapshots.range(ids, from, to);
    // a skipped capture must never leave today without a row (for example after the rows were removed): record those now
    if (to === real) {
      const have = new Set(rows.filter((r) => r.date === real).map((r) => r.project_id));
      const missing = list.filter((P) => P && P.p && isLive(P) && !have.has(Number(P.id)));
      if (missing.length) { await capture(missing, true); rows = await snapshots.range(ids, from, to); }
    }
    return buildTrends(rows, { today: to, days, projects: pj });
  }

  // The type a browser reports for an upload is only what the sender says. The first bytes of the file say what it is.
  const imageMatchesType = (b, type) => {
    const head = b.subarray(0, 16);
    if (/^image\/png$/.test(type)) return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (/^image\/jpe?g$/.test(type)) return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (/^image\/gif$/.test(type)) return /^GIF8[79]a/.test(head.toString('latin1', 0, 6));
    if (/^image\/webp$/.test(type)) return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
    if (/^image\/svg\+xml$/.test(type)) { const t = b.toString('utf8', 0, Math.min(b.length, 4096)).replace(/^\uFEFF/, ''); return /<svg[\s>]/i.test(t) && !/<script|\son\w+\s*=|javascript:/i.test(b.toString('utf8')); }
    return false;
  };

  const fileToDataUrl = async (f, maxBytes = 1.5 * 1024 * 1024) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(f.type || '')) throw err(400, 'Choose a picture in PNG, JPG, WebP, GIF or SVG format');
    if (f.buffer.length > maxBytes) throw err(413, 'The picture is too large. Use one under 1.5 MB.');
    if (!imageMatchesType(f.buffer, f.type)) throw err(400, 'This file is not really a picture of that kind. Choose a PNG, JPG, WebP, GIF or SVG file.');
    return `data:${f.type};base64,${f.buffer.toString('base64')}`;
  };

  // Every uploaded document is checked before anything is stored: the type must be on the list, the first bytes must match
  // the type, and a refusal is written to the security log.
  const assertUploadable = (files, where) => {
    for (const f of files) {
      const why = filesig.check(f.name, f.buffer);
      if (why) {
        if (ops && ops.security) ops.security.log('upload_rejected', { userId: ctx().user.id, ip: ctx().ip, path: where, detail: { name: String(f.name || '').slice(0, 80), size: f.buffer ? f.buffer.length : 0 } });
        throw err(415, why);
      }
    }
  };
  // Until a payment processor is connected a paid period cannot be bought, so self service is off on the live site.
  const paymentsOpen = () => !security.isProduction() || process.env.DEMO_BILLING === '1';

  // ---------- routes ----------
  const routes = [];
  const on = (method, re, fn) => routes.push([method, new RegExp('^' + re + '$'), fn]);

  const KINDS = ['jira', 'outlook'];
  const connView = () => {
    const out = {}, meta = (ctx().user.prefs || {}).conn_meta || {};
    for (const k of KINDS) out[k] = { connected: !!CONN[k], label: CONN[k], managed: false, configured: connectors.configured(k), setup: connectors.configured(k) ? null : connectors.setupInfo(k, ctx().origin), sites: (meta[k] && meta[k].sites) || [], site_id: (meta[k] && meta[k].site_id) || null, token_ok: k === 'jira' };
    return out;
  };
  on('GET', '/api/me', async () => ({ user: DB.user, status: { org: !!(ops.orgs && await ops.orgs.enabled()), jira: !!CONN.jira, graph: !!CONN.outlook, claude: !!process.env.ANTHROPIC_API_KEY, model: MODEL } }));
  // ---------- plan, tokens and invoices (the person's own view of their subscription) ----------
  const DAYMS2 = 86400000;
  async function billingView() {
    const uid = ctx().user.id; const cfg = await ops.config();
    await ops.ensureSubscription(uid);
    const s = (await ops.q('SELECT * FROM subscriptions WHERE user_id = $1', [uid])).rows[0];
    const since = ops.periodStart(s);
    const used = await ops.tokensUsedSince(uid, since);
    const days = (await ops.q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, SUM(n) AS n FROM (
      SELECT created_at, input_tokens + output_tokens AS n FROM ai_usage WHERE user_id = $1 AND created_at >= $2
      UNION ALL SELECT created_at, input_tokens + output_tokens FROM chat_log WHERE user_id = $1 AND billable AND created_at >= $2) t GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, [uid, since])).rows;
    const pays = (await ops.q("SELECT id, amount_cents, currency, kind, status, paid_at FROM payments WHERE user_id = $1 AND kind = 'payment' ORDER BY paid_at ASC, id ASC", [uid])).rows;
    const t = (v) => (v ? new Date(v).getTime() : null);
    return {
      state: ops.constructor.state(s), status: s.status, plan: s.plan, price_cents: Number(s.price_cents), currency: cfg.currency, token_limit: Number(s.token_limit), tokens_used: used,
      trial_start: t(s.trial_start), trial_end: t(s.trial_end), period_start: t(s.period_start), period_end: t(s.period_end), auto_renew: !!s.auto_renew, period_days: cfg.period_days, trial_days: cfg.trial_days, self_serve: !!cfg.self_serve_subscribe && paymentsOpen(),
      usage: Object.fromEntries(days.map((r) => [r.d, Number(r.n)])),
      invoices: pays.map((p, i) => ({ no: 'PM-' + (1001 + i), at: t(p.paid_at), amount_cents: Number(p.amount_cents), currency: p.currency, demo: p.status === 'demo' })).reverse(),
    };
  }
  on('GET', '/api/billing', async () => ({ billing: await billingView() }));
  on('POST', '/api/billing/auto-renew', async (m, q, b) => { await ops.ensureSubscription(ctx().user.id); await ops.q('UPDATE subscriptions SET auto_renew = $2, updated_at = now() WHERE user_id = $1', [ctx().user.id, !!b.auto]); return { billing: await billingView() }; });
  // No payment processor is connected, so this records a demo payment. Demo payments never count as income.
  on('POST', '/api/billing/subscribe', async () => {
    const cfg = await ops.config(); const uid = ctx().user.id;
    if (!cfg.self_serve_subscribe) throw err(403, 'Subscriptions are set up by our team. Contact support to subscribe.');
    if (!paymentsOpen()) { if (ops.security) ops.security.log('subscribe_blocked', { userId: uid, ip: ctx().ip, path: '/api/billing/subscribe' }); throw err(403, 'Online payment is not connected yet, so plans are set up by our team. Contact support to subscribe.'); }
    await ops.ensureSubscription(uid);
    const cur = (await ops.q('SELECT * FROM subscriptions WHERE user_id = $1', [uid])).rows[0];
    const from = cur.status === 'active' && cur.period_end && new Date(cur.period_end) > new Date() ? new Date(cur.period_end) : new Date();
    await ops.q("UPDATE subscriptions SET status = 'active', period_start = $2, period_end = $3, auto_renew = true, updated_at = now() WHERE user_id = $1", [uid, from, new Date(from.getTime() + cfg.period_days * DAYMS2)]);
    await ops.q("INSERT INTO payments(id, user_id, email, amount_cents, currency, kind, status, method, note) VALUES ($1,$2,$3,$4,$5,'payment','demo','in app demo','Subscribed in the app')", [nid(), uid, ctx().user.email, Number(cur.price_cents), cfg.currency]);
    return { billing: await billingView() };
  });
  on('GET', '/api/connections', async () => { await connectors.loadConfig(); return { connections: connView() }; });
  // Shared OAuth credentials affect every account, so only a super admin may change them.
  on('POST', '/api/connections/(jira|outlook)/setup', async (mm, q, b) => {
    if (!ctx().user.is_super) throw err(403, 'Only super admins can configure shared integrations.');
    await connectors.saveConfig(mm[1], b.client_id, b.client_secret);
    return { connections: connView() };
  });
  // starts the sign in at the service. The browser opens the returned address in a new window.
  on('POST', '/api/connections/(jira|outlook)/start', async (mm) => ({ url: await connectors.begin(ctx().user.id, mm[1], ctx().origin) }));
  // saves a finished connection into this request's view of the person's settings
  const keep = async (kind, result) => {
    const c = ctx(); c.user.prefs = await connectors.apply(c.user.prefs, kind, result);
    c.DB.connections = { ...(c.DB.connections || {}), [kind]: result.label };
    await saveUser();
  };
  on('POST', '/api/connections/jira/token', async (mm, q, b) => { await keep('jira', await connectors.identifyToken(b.base_url, b.email, b.token)); return { connections: connView() }; });
  on('POST', '/api/connections/(jira|outlook)/test', async (mm) => {
    const kind = mm[1], sealed = ((ctx().user.prefs || {}).conn_secrets || {})[kind];
    if (!sealed) throw err(404, 'This service is not connected yet');
    const r = await connectors.retest(sealed, kind); await keep(kind, r);
    return { ok: true, label: r.label, connections: connView() };
  });
  on('POST', '/api/connections/jira/site', async (mm, q, b) => {
    const sealed = ((ctx().user.prefs || {}).conn_secrets || {}).jira;
    if (!sealed) throw err(404, 'Jira is not connected yet');
    const secret = await connectors.open(sealed);
    if (secret.basic) throw err(400, 'This connection uses one Jira address');
    const r = await connectors.identify('jira', secret, String(b.site_id || '')); await keep('jira', r);
    return { connections: connView() };
  });
  on('DELETE', '/api/connections/(jira|outlook)', async (mm) => {
    const c = ctx(); c.user.prefs = connectors.remove(c.user.prefs, mm[1]); c.DB.connections = { ...(c.DB.connections || {}) }; delete c.DB.connections[mm[1]];
    await saveUser(); return { connections: connView() };
  });
  on('PUT', '/api/me', async (m, q, b) => {
    if (b.language) { if (!['en', 'ar'].includes(b.language)) throw err(400, 'Choose English or Arabic'); DB.user.language = b.language; }
    if (b.theme) { if (!['light', 'dark'].includes(b.theme)) throw err(400, 'Choose a light or dark theme'); DB.user.theme = b.theme; }
    if ('name' in b) { const n = String(b.name || '').trim(); if (!n) throw err(400, 'Enter your name'); if (n.length > 120) throw err(400, 'The name is too long'); DB.user.name = n; }
    if ('dash_layout' in b) DB.user.dash_layout = b.dash_layout;
    await saveUser();
    return { user: DB.user };
  });
  // Saved views of the Logs table (columns, filters, search, sort). They belong to the person, so they follow them across projects.
  const LV = { kinds: ['deliverable', 'requirement', 'milestone', 'risk'], cols: ['type', 'item', 'description', 'status', 'review', 'owner', 'due', 'amount', 'percent', 'prob', 'imp', 'mitigation', 'linked', 'conf', 'doc', 'quote', 'created'], levels: ['', 'Low', 'Medium', 'High'], dues: ['', 'over', '7', '30', 'none'], rs: ['live', 'confirmed', 'proposed', 'ignored', 'all'], sizes: [20, 50, 100] };
  function cleanLogViews(list) {
    if (!Array.isArray(list)) throw err(400, 'Send the saved views as a list');
    if (list.length > 30) throw err(400, 'You can keep up to 30 saved views');
    const seen = new Set(), out = [];
    for (const v of list) {
      const name = String((v && v.name) || '').trim().slice(0, 60), id = String((v && v.id) || '');
      if (!name) throw err(400, 'Give the view a name');
      if (!/^[\w-]{1,40}$/.test(id)) throw err(400, 'This view has an invalid id');
      if (seen.has(name.toLowerCase())) throw err(400, `There is already a view called "${name}"`);
      seen.add(name.toLowerCase());
      const c = v.cfg || {}, cols = LV.cols.filter((k) => k === 'item' || (Array.isArray(c.cols) && c.cols.includes(k)));
      out.push({ id, name, cfg: {
        cols: cols.length > 1 ? cols : ['type', 'item', 'status', 'owner', 'due', 'amount'],
        kinds: Array.isArray(c.kinds) ? LV.kinds.filter((k) => c.kinds.includes(k)) : [],
        st: /^(deliverable|requirement|milestone|risk)\|[a-z]{3,12}$/.test(c.st || '') ? c.st : '',
        prob: LV.levels.includes(c.prob) ? c.prob : '', imp: LV.levels.includes(c.imp) ? c.imp : '', due: LV.dues.includes(c.due) ? c.due : '',
        rs: LV.rs.includes(c.rs) ? c.rs : 'live', q: String(c.q || '').slice(0, 200), sort: LV.cols.includes(c.sort) ? c.sort : 'type', dir: c.dir === -1 ? -1 : 1, size: LV.sizes.includes(c.size) ? c.size : 20,
      } });
    }
    return out;
  }
  on('GET', '/api/me/log-views', async () => ({ views: Array.isArray((ctx().user.prefs || {}).log_views) ? ctx().user.prefs.log_views : [] }));
  on('PUT', '/api/me/log-views', async (m, q, b) => {
    const views = cleanLogViews(b && b.views);
    const c = ctx(); c.user.prefs = { ...(c.user.prefs || {}), log_views: views };
    await store.db.query('UPDATE users SET prefs = $2::jsonb WHERE id = $1', [c.user.id, JSON.stringify(c.user.prefs)]);
    return { views };
  });
  on('POST', '/api/me/avatar', async (m, q, b) => { needForm(b); const f = b.get('file'); if (!f) throw err(400, 'No image received'); DB.user.avatar = await fileToDataUrl(f, 600 * 1024); await saveUser(); return { user: DB.user }; });
  on('POST', '/api/me/password', async (m, q, b) => { const token = await ctx().auth.changePassword(ctx().user.id, b.current, b.next); return { ok: true, token }; });
  on('POST', '/api/me/ingest-key', async () => { DB.user.ingest_key = require('crypto').randomBytes(16).toString('hex'); await saveUser(); return { ingest_key: DB.user.ingest_key }; });


  on('GET', '/api/calendar', async () => {
    const tasks = [], payments = [], list = DB.order.map((id) => DB.projects[id]).filter(isLive);
    for (const P of list) {
      for (const t of S.schedule(P.tasks, rawProject(P))) {
        tasks.push({ id: t.id, project_id: P.id, summary: !!t.summary, name: t.name, start: t.start, finish: t.finish, progress: t.progress || 0, milestone: !!t.is_milestone, assignee: t.assignee || null, late: (t.progress || 0) < 100 && t.finish < TODAY() });
      }
      for (const i of P.items) if (i.kind === 'milestone' && i.status !== 'ignored' && i.data && i.data.due_date) payments.push({ id: i.id, project_id: P.id, title: i.title, due: i.data.due_date, state: i.state, amount: i.data.amount != null ? i.data.amount : null });
    }
    return { today: TODAY(), projects: list.map((P) => ({ id: P.id, name: P.p.name, currency: P.p.currency })), tasks, payments };
  });
  // the overview carries a 30 day trend so its trend widgets draw from the same response
  const activeList = () => DB.order.map((id) => DB.projects[id]).filter(isLive);
  // the widget marketplace. The overviews also carry the custom widgets the person added and the data those read.
  const OF = require('./overview_filter')({ err, TODAY });
  const OR = require('./overview_rows')({ OF, S, rawProject, TODAY });
  const WIDGETS = require('./widgets')({ OF, on, ctx, err, store, WS: win.__WidgetSpec, S, rawProject, stats, TODAY, P_, activeList });
  on('GET', '/api/dashboard', async (m, q) => {
    const f = OF.parse(q), { kept, ...d } = dashboard(f);
    return { ...d, trends: await trendsFor(kept, 30, OF.range(f)), ...(await WIDGETS.extras('portfolio', kept, f)) };
  });
  // The row level data behind the overview, for the Excel report. It reads the same filters as the screen.
  on('GET', '/api/dashboard/report-data', async (m, q) => {
    const f = OF.parse(q), { kept } = dashboard(f);
    const names = new Map(activeList().map((P) => [P.id, P.p.name]));
    return { scope: 'portfolio', filters: f, filter_text: OF.describe(f, names).join(', '), ...OR.build(kept.map((P) => ({ P, st: stats(P) })), f) };
  });
  // one project's dashboard: radar, schedule and critical path, deliverables, payments and cash flow
  on('GET', '/api/projects/(\\d+)/dashboard', async (mm, q) => {
    const P = P_(mm[1]), raw = rawProject(P), st = stats(P);
    // a project overview reads the period and the status. The portfolio filters (project, client, currency, health) have no meaning here.
    const f = OF.parse(q); delete f.p; delete f.c; delete f.cur; delete f.h;
    const sched = S.schedule(P.tasks, raw), today = TODAY(), range = OF.range(f);
    const sc = OF.scope(P, f, S.progressMetrics(P.tasks, raw, today).rows, today);
    const all = P.items.map((i) => ({ ...i, data: i.data || {} }));
    // the filtered items feed the dashboard. Decisions and other kinds keep their place, the review list reads them.
    const keep = new Set(sc.items.map((i) => i.id));
    const items = all.filter((i) => !['risk', 'milestone', 'deliverable'].includes(i.kind) || keep.has(i.id));
    const entry = { p: { ...clone(P.p), id: P.id }, stats: OF.scopedStats(st, sc, f), items: items.filter((i) => i.status !== 'ignored' && ['risk', 'milestone', 'deliverable'].includes(i.kind)), rows: sc.rows, sched };
    const audit = P.audit.filter((a) => OF.inRange(String(a.ts || a.created_at || '').slice(0, 10), range)).slice(0, 12).map((a) => ({ ...a, detail: a.detail || {} }));
    const entries = [{ P, st }];
    const dash = win.__ProjDash.buildProjectDash({ project: raw, tasks: OF.active(f) ? OF.scheduleFor(sched, sc.rows) : sched, items, inbox: P.inbox, audit, today });
    if (range || f.s) dash.phases = dash.phases.filter((ph) => OF.overlaps(ph.start, ph.finish, range) && (!f.s || sc.rows.some((x) => OF.overlaps(x.start, x.finish, { lo: String(ph.start).slice(0, 10), hi: String(ph.finish).slice(0, 10) }))));
    return { project: { ...projectView(P) }, radar: win.__Radar.buildRadar([entry], today), analytics: (() => { const A = win.__Analytics.buildAnalytics([entry], today); OF.fitTimeline(A.timeline, f, new Map([[P.id, sc]])); return A; })(), ...dash,
      filters: f, filter_empty: OF.active(f) && !sc.rows.length && !sc.items.length, filter_options: OF.options(entries), trends: await trendsFor([P], 30, range), ...(await WIDGETS.extras('project', [P], f)) };
  });
  on('GET', '/api/projects/(\\d+)/report-data', async (mm, q) => {
    const P = P_(mm[1]), f = OF.parse(q); delete f.p; delete f.c; delete f.cur; delete f.h;
    return { scope: 'project', filters: f, filter_text: OF.describe(f).join(', '), ...OR.build([{ P, st: stats(P) }], f) };
  });
  // trends over time, drawn only from the daily snapshots. days is one of 7, 14, 30, 90, 180, 365.
  on('GET', '/api/trends', async (m, q) => trendsFor(DB.order.map((id) => DB.projects[id]).filter(isLive), periodOf(q.days)));
  on('GET', '/api/projects/(\\d+)/trends', async (m, q) => trendsFor([P_(m[1])], periodOf(q.days)));
  on('GET', '/api/projects', async () => ({ projects: DB.order.map((id) => DB.projects[id]).reverse().map(projectView) }));
  on('POST', '/api/projects', async (m, q, fd) => {
    const get = (k) => (typeof fd.get === 'function' ? fd.get(k) : fd[k]);
    const files = (typeof fd.getAll === 'function' ? fd.getAll('files') : []).filter((f) => f && f.name);
    const name = String(get('name') || '').trim();
    if (!name) throw err(400, 'Give the project a name');
    if (name.length > 200) throw err(400, 'The project name is too long');
    if (files.length > 12) throw err(400, 'Attach at most 12 files when creating a project');
    assertUploadable(files, '/api/projects');
    const id = nid();
    const P = makeProject(id, { id, owner_id: DB.user.id, name, code: null, client: null, client_logo: null, currency: null, value: null, start_date: null, end_date: null, work_days: [1, 2, 3, 4, 5], work_start: '08:00', work_end: '17:00', holidays: [], status: 'active', wizard_done: 0, analyzing: 0, impact_check: 1, auto_apply: 0, auto_threshold: 0.9, jira_key: null, teams_channel: null, created_at: nowTs() });
    P.p.wizard_done = files.length ? 0 : 1; // a project with no documents has nothing to review yet
    const docs = [];
    for (const f of files) { const d = { id: nid(), filename: f.name, kind: AI.classify(f.name, ''), summary: '', uploaded_by: ACTOR(), created_at: nowTs(), chars: 0, pages: null, read_error: null, unread: true }; P.documents.push(d); P.texts[d.id] = ''; docs.push([d, f]); }
    audit(P, ACTOR(), 'project_created', { summary: `Project "${name}" created with ${docs.length} document${docs.length === 1 ? '' : 's'}` });
    await store.create(P, DB.user.id);
    for (const [d, f] of docs) await store.putFile(P.id, d.id, f);
    DB.projects[id] = P; DB.order.push(id); ctx().roles[id] = 'manager'; touch(P);
    if (docs.length) analyzeDocs(P, docs.map((x) => x[0])).catch((e) => console.error('analysis failed', e));
    return { project: projectView(P) };
  });
  on('GET', '/api/projects/(\\d+)', async (m) => ({ project: projectView(P_(m[1])) }));
  on('PUT', '/api/projects/(\\d+)', async (m, q, b) => {
    const P = P_(m[1]);
    // Closing and reopening go through the closure routes, which check that the project is ready.
    if ('status' in b && (b.status === 'closed' || P.p.status === 'closed') && b.status !== P.p.status) throw err(400, 'Close or reopen a project from the Closure tab');
    for (const k of ['name', 'code', 'client', 'currency', 'start_date', 'end_date', 'work_start', 'work_end', 'jira_key', 'teams_channel', 'status', 'sharepoint_url', 'jira_url']) if (k in b) P.p[k] = b[k] === '' ? null : b[k];
    for (const k of ['sharepoint_url', 'jira_url']) if (b[k] && !/^https?:\/\/\S+$/i.test(String(b[k]).trim())) throw err(400, 'Enter a full link that starts with http or https');
    if ('name' in b && !String(b.name).trim()) throw err(400, 'The project needs a name');
    if ('value' in b) P.p.value = b.value === '' || b.value == null ? null : Number(b.value);
    for (const k of ['impact_check', 'auto_apply']) if (k in b) P.p[k] = b[k] ? 1 : 0;
    if ('auto_threshold' in b) P.p.auto_threshold = Math.min(1, Math.max(0.5, Number(b.auto_threshold) || 0.9));
    if ('work_days' in b) { const d = (b.work_days || []).map(Number).filter((n) => n >= 0 && n <= 6); if (!d.length) throw err(400, 'Choose at least one working day'); P.p.work_days = [...new Set(d)].sort(); }
    if ('holidays' in b) P.p.holidays = [...new Set((b.holidays || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    if ('work_days' in b || 'holidays' in b) recalc(P);
    audit(P, ACTOR(), 'settings_changed', { summary: 'Project settings updated' });
    return { project: projectView(P) };
  });
  on('POST', '/api/projects/(\\d+)/logo', async (m, q, b) => { const P = P_(m[1]); const f = typeof b.get === 'function' ? b.get('file') : null; if (!f) throw err(400, 'No image received'); P.p.client_logo = await fileToDataUrl(f); return { project: clone(P.p) }; });
  on('DELETE', '/api/projects/(\\d+)', async (m) => {
    const id = Number(m[1]);
    P_(id, 'manager'); // only a project manager of this project may delete it
    await store.remove(id); statsMemo.delete(id);
    delete DB.projects[id]; DB.order = DB.order.filter((x) => x !== id); delete ctx().roles[id];
    ctx().touched.clear();
    return { ok: true };
  });


  // ---------- project closure ----------
  // A project can be closed when every approved deliverable and requirement is closed (delivered, or not delivered with a
  // reason), a lessons learned report and a certificate of completion were written after that, and the client acceptance
  // is recorded. The two documents carry a stamp of the outcomes they were written from, so a later change makes them stale.
  const CLOSE_DOCS = ['lessons_learned', 'completion_certificate'];
  function closureScope(P) {
    const rows = []; let pending = 0;
    for (const i of P.items) {
      if (!['deliverable', 'requirement'].includes(i.kind) || i.status === 'ignored') continue;
      if (i.status === 'proposed') { pending++; continue; }
      const d = i.data || {};
      const outcome = i.state === 'closed' ? (d.outcome === 'not_delivered' ? 'not_delivered' : 'delivered') : 'open';
      rows.push({ id: i.id, kind: i.kind, title: i.kind === 'requirement' ? (i.description || i.title) : i.title, state: i.state || 'open', outcome, reason: outcome === 'not_delivered' ? String(d.not_delivered_reason || '') : '', due: d.due_date || null, priority: d.priority || null, evidence: i.evidence_doc_id || null });
    }
    const counts = { delivered: 0, not_delivered: 0, open: 0, total: rows.length };
    for (const r of rows) counts[r.outcome]++;
    return { rows, counts, pending };
  }
  // The stamp does not use record ids, so a project keeps its closure documents when it is exported and imported again.
  function stampOf(P, type) {
    const sc = closureScope(P), cl = P.closure || {};
    const base = sc.rows.map((r) => `${r.kind}|${r.title}|${r.outcome}|${r.reason}`).sort().join('\n');
    return crypto.createHash('md5').update(base + (type === 'completion_certificate' ? `\n${cl.accepted_by || ''}|${cl.accepted_on || ''}` : '')).digest('hex');
  }
  function closureState(P) {
    const sc = closureScope(P), cl = P.closure || {};
    const docs = {};
    for (const type of CLOSE_DOCS) {
      const g = (P.generated || []).find((x) => x.doc_type === type);
      docs[type] = g ? { id: g.id, title: g.title, created_at: g.created_at, current: g.closure_stamp === stampOf(P, type) } : null;
    }
    const noReason = sc.rows.filter((r) => r.outcome === 'not_delivered' && r.reason.trim().length < 3).length;
    const checks = [
      { code: 'items_open', required: true, ok: sc.counts.open === 0, n: sc.counts.open },
      { code: 'reasons', required: true, ok: noReason === 0, n: noReason },
      { code: 'items_review', required: false, ok: sc.pending === 0, n: sc.pending },
      { code: 'll', required: false, ok: !!(docs.lessons_learned && docs.lessons_learned.current), n: 0, missing: !docs.lessons_learned },
      { code: 'cert', required: false, ok: !!(docs.completion_certificate && docs.completion_certificate.current), n: 0, missing: !docs.completion_certificate },
      { code: 'acceptance', required: false, ok: !!(cl.accepted_by && cl.accepted_on), n: 0 },
    ];
    const live = (k) => P.items.filter((i) => i.kind === k && i.status === 'confirmed');
    const leaf = S.schedule(P.tasks, rawProject(P)).filter((t) => !t.summary);
    return {
      status: P.p.status === 'closed' ? 'closed' : P.p.status === 'archived' ? 'archived' : 'active',
      closed_at: P.p.closed_at || null, closed_by: P.p.closed_by || null,
      accepted_by: cl.accepted_by || '', accepted_on: cl.accepted_on || '', note: cl.note || '',
      scope: sc, documents: docs, checks, ready: checks.every((c) => c.ok || !c.required), skipped: checks.filter((c) => !c.required && !c.ok).map((c) => c.code),
      heads_up: { unpaid: live('milestone').filter((i) => i.state !== 'paid').length, open_risks: live('risk').filter((i) => i.state === 'open').length, open_tasks: leaf.filter((t) => (t.progress || 0) < 100).length },
      history: (cl.history || []).slice(-20).reverse(),
      can_manage: roleOf(P) === 'manager',
    };
  }
  on('GET', '/api/projects/(\\d+)/closure', async (m) => closureState(P_(m[1])));
  on('PUT', '/api/projects/(\\d+)/closure', async (m, q, b) => {
    const P = P_(m[1], 'manager');
    if (P.p.status === 'closed') throw err(409, 'This project is closed. Reopen it to change the acceptance details.');
    const cl = P.closure = P.closure || {};
    if ('accepted_by' in b) cl.accepted_by = cleanName(b.accepted_by, 120);
    if ('accepted_on' in b) {
      if (b.accepted_on && !/^\d{4}-\d{2}-\d{2}$/.test(b.accepted_on)) throw err(400, 'Enter the acceptance date as a valid date');
      cl.accepted_on = b.accepted_on || '';
    }
    if ('note' in b) cl.note = cleanName(b.note, 600);
    audit(P, ACTOR(), 'closure_details', { summary: 'Closure acceptance details updated' });
    return closureState(P);
  });
  on('POST', '/api/projects/(\\d+)/close', async (m) => {
    const P = P_(m[1], 'manager');
    if (P.p.status === 'closed') throw err(409, 'This project is already closed');
    if (P.p.status === 'archived') throw err(409, 'This project is archived. Restore it before closing it.');
    const st = closureState(P);
    if (!st.ready) {
      const say = { items_open: (n) => `${n} deliverable${n === 1 ? '' : 's'} or requirement${n === 1 ? '' : 's'} still open`, items_review: (n) => `${n} item${n === 1 ? '' : 's'} waiting for review`, reasons: (n) => `${n} not delivered item${n === 1 ? '' : 's'} without a reason`, ll: () => 'the lessons learned report is missing or out of date', cert: () => 'the certificate of completion is missing or out of date', acceptance: () => 'the client acceptance details are missing' };
      throw err(400, `The project is not ready to close: ${st.checks.filter((c) => c.required && !c.ok).map((c) => say[c.code](c.n)).join(', ')}.`);
    }
    const cl = P.closure = P.closure || {};
    P.p.status = 'closed'; P.p.closed_at = nowTs(); P.p.closed_by = ACTOR();
    cl.history = [...(cl.history || []), { action: 'closed', at: P.p.closed_at, by: ACTOR(), delivered: st.scope.counts.delivered, not_delivered: st.scope.counts.not_delivered, skipped: st.skipped }];
    audit(P, ACTOR(), 'project_closed', { summary: `Project closed with ${st.scope.counts.delivered} delivered and ${st.scope.counts.not_delivered} not delivered` });
    return { project: projectView(P), closure: closureState(P) };
  });
  on('POST', '/api/projects/(\\d+)/reopen', async (m, q, b) => {
    const P = P_(m[1], 'manager');
    if (P.p.status !== 'closed') throw err(409, 'This project is not closed');
    const reason = cleanName(b && b.reason, 400);
    if (reason.length < 3) throw err(400, 'Say why you are reopening the project');
    const cl = P.closure = P.closure || {};
    P.p.status = 'active'; delete P.p.closed_at; delete P.p.closed_by;
    cl.history = [...(cl.history || []), { action: 'reopened', at: nowTs(), by: ACTOR(), reason }];
    audit(P, ACTOR(), 'project_reopened', { summary: `Project reopened: ${reason.slice(0, 120)}` });
    return { project: projectView(P), closure: closureState(P) };
  });

  on('GET', '/api/projects/(\\d+)/documents', async (m, q) => paged(P_(m[1]).documents, q, 'documents', clone));
  on('POST', '/api/projects/(\\d+)/documents', async (m, q, fd) => {
    const P = P_(m[1]); const mode = fd.get('purpose') || 'auto';
    const files = fd.getAll('files').filter((f) => f && f.name);
    if (!files.length) throw err(400, 'Choose at least one file to upload');
    assertUploadable(files, '/api/projects/documents');
    const out = [], src = [];
    for (const d of await addDocuments(P, files)) {
      audit(P, ACTOR(), 'document_uploaded', { summary: `Uploaded ${d.filename} (${d.kind})` });
      // the Thinking Area only stores the file and reads its text. Nothing is analyzed and no suggestion is created.
      if (mode === 'store') { out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'stored', ...(d.read_error ? { error: d.read_error } : {}) }); continue; }
      if (d.read_error) { out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'failed', error: d.read_error }); continue; }
      const asSource = mode === 'source' || (mode === 'auto' && ['proposal', 'contract', 'po'].includes(d.kind));
      if (asSource) { src.push(d); out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'extraction' }); }
      else { const n = await processEvidence(P, d); out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'progress', suggestions: n }); }
    }
    if (src.length) analyzeDocs(P, src).catch((e) => console.error(e));
    return { results: out };
  });
  // The text of one stored document, a page at a time, so the Thinking Area can read it before writing something related.
  on('GET', '/api/projects/(\\d+)/documents/(\\d+)/text', async (m, q) => {
    const P = P_(m[1]); const d = P.documents.find((x) => x.id === Number(m[2])); if (!d) throw err(404, 'Document not found');
    const text = String(P.texts[d.id] || ''); const off = Math.max(0, Number(q.offset) || 0); const size = 6000;
    return { id: d.id, filename: d.filename, kind: d.kind, total: text.length, offset: off, text: text.slice(off, off + size), next: off + size < text.length ? off + size : null };
  });
  // Finds the passages of stored document text that match a question, with the file name and the exact sentence.
  const SEARCH_STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'is', 'are', 'was', 'what', 'does', 'do', 'say', 'says', 'about', 'my', 'our', 'this', 'that', 'with', 'by', 'it', 'at', 'as', 'be', 'any', 'there', 'contract', 'document', 'من', 'في', 'على', 'ما', 'هو', 'هي', 'عن', 'هل', 'الى', 'إلى', 'و', 'ماذا', 'يقول']);
  const searchTokens = (s) => [...new Set((String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 && !SEARCH_STOP.has(w)))];
  const wordHit = (w, tok) => w === tok || (tok.length >= 4 && w.length >= 4 && (w.startsWith(tok.slice(0, Math.max(4, tok.length - 2))) || tok.startsWith(w.slice(0, Math.max(4, w.length - 2)))));
  on('GET', '/api/projects/(\\d+)/documents/search', async (m, q) => {
    const P = P_(m[1]); const qs = searchTokens(q.q).slice(0, 12);
    if (!qs.length) throw err(400, 'Type what to look for');
    const need = Math.max(1, Math.ceil(qs.length * 0.5)), found = [];
    for (const d of P.documents) {
      const text = String(P.texts[d.id] || ''); if (!text) continue;
      const parts = text.split(/(?<=[.!?؟])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3);
      for (let i = 0; i < parts.length; i++) {
        const words = searchTokens(parts[i]);
        const score = qs.filter((tok) => words.some((w) => wordHit(w, tok))).length;
        if (score >= need) found.push({ doc_id: d.id, filename: d.filename, quote: parts[i].slice(0, 400), score, at: i });
      }
    }
    found.sort((a, z) => z.score - a.score || a.at - z.at);
    return { query: String(q.q).slice(0, 200), found: found.length > 0, passages: found.slice(0, 5).map(({ at, ...x }) => x) };
  });
  on('POST', '/api/projects/(\\d+)/documents/(\\d+)/link', async (m, q, b) => {
    const P = P_(m[1]); const d = P.documents.find((x) => x.id === Number(m[2])); const it = P.items.find((x) => x.id === Number(b.deliverable_id) && x.kind === 'deliverable');
    if (!d || !it) throw err(404, 'Document or deliverable not found');
    return { ok: true, summary: applyAction(P, { type: 'close_deliverable', deliverable_id: it.id }, ACTOR(), d.id).summary };
  });
  on('DELETE', '/api/projects/(\\d+)/documents/(\\d+)', async (m) => {
    const P = P_(m[1]); const id = Number(m[2]);
    P.documents = P.documents.filter((d) => d.id !== id); delete P.texts[id]; await store.deleteFiles(P.id, id);
    for (const i of P.items) { if (i.doc_id === id) i.doc_id = null; if (i.evidence_doc_id === id) i.evidence_doc_id = null; }
    return { ok: true };
  });
  on('POST', '/api/projects/(\\d+)/analyze', async (m) => {
    const P = P_(m[1]);
    analyzeDocs(P, P.documents.slice()).catch((e) => console.error(e));
    return { results: [] };
  });

  on('GET', '/api/projects/(\\d+)/items', async (m, q) => {
    const P = P_(m[1]);
    let rows = P.items.slice();
    if (q.kind) rows = rows.filter((i) => i.kind === q.kind);
    if (q.status) rows = rows.filter((i) => i.status === q.status);
    if (q.state) rows = rows.filter((i) => i.state === q.state);
    if (q.q) rows = rows.filter((i) => (i.title + ' ' + i.description).toLowerCase().includes(String(q.q).toLowerCase()));
    return paged(rows.sort((a, b) => a.id - b.id), q, 'items', (i) => itemView(P, i));
  });
  on('POST', '/api/projects/(\\d+)/items', async (m, q, b) => {
    const P = P_(m[1]);
    if (!['deliverable', 'requirement', 'risk', 'milestone', 'action', 'decision'].includes(b.kind)) throw err(400, 'Unsupported item type');
    if (!String(b.title || '').trim()) throw err(400, 'A title is required');
    const it = { id: nid(), project_id: P.id, kind: b.kind, title: b.title.trim(), description: b.description || '', data: b.data || {}, status: 'confirmed', state: b.state || (b.kind === 'milestone' ? 'pending' : b.kind === 'decision' ? 'active' : 'open'), confidence: null, doc_id: null, quote: '', evidence_doc_id: null, created_at: nowTs() };
    P.items.push(it); audit(P, ACTOR(), 'item_added', { summary: `Added ${b.kind} "${it.title}"` });
    return { item: itemView(P, it) };
  });
  on('POST', '/api/projects/(\\d+)/items/bulk', async (m, q, b) => {
    const P = P_(m[1]);
    if (!Array.isArray(b.ids) || !['confirm', 'ignore'].includes(b.action)) throw err(400, 'Provide ids and an action');
    let n = 0;
    for (const id of b.ids) { const it = P.items.find((x) => x.id === Number(id)); if (!it) continue; if (b.action === 'confirm') confirmItem(P, it, ACTOR()); else it.status = 'ignored'; n++; }
    return { changed: n };
  });
  // A deliverable or requirement is closed as delivered or as not delivered. Not delivered needs a reason, and a reopened
  // item loses its outcome, so the lessons learned report never carries a stale reason.
  const outcomeKinds = ['deliverable', 'requirement'];
  const cleanReason = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 600);
  function checkOutcome(it, b) {
    if (!(b.data && b.data.outcome === 'not_delivered')) return;
    if (!outcomeKinds.includes(it.kind)) throw err(400, 'Only a deliverable or a requirement can be closed as not delivered');
    if (cleanReason(b.data.not_delivered_reason != null ? b.data.not_delivered_reason : (it.data || {}).not_delivered_reason).length < 3) throw err(400, 'Say why it was not delivered');
  }
  function applyOutcome(P, it, b, prevState) {
    const d = it.data = it.data || {};
    if (outcomeKinds.includes(it.kind) && b.data && b.data.outcome === 'not_delivered') {
      d.outcome = 'not_delivered'; d.not_delivered_reason = cleanReason(d.not_delivered_reason); it.state = 'closed';
      audit(P, ACTOR(), 'item_not_delivered', { summary: `${it.kind} "${it.title}" closed as not delivered: ${d.not_delivered_reason.slice(0, 120)}` });
      return;
    }
    const keep = outcomeKinds.includes(it.kind) && it.state === 'closed' && prevState === it.state && d.outcome === 'not_delivered' && !(b.data && b.data.outcome === 'delivered');
    if (!keep) { delete d.outcome; delete d.not_delivered_reason; }
  }
  const findItem = (id) => { for (const k of DB.order) { const P = DB.projects[k]; const it = P && P.items.find((x) => x.id === Number(id)); if (it) { need(P, ctx().level); touch(P); return [P, it]; } } throw err(404, 'Not found'); };
  on('PUT', '/api/items/(\\d+)', async (m, q, b) => {
    const [P, it] = findItem(m[1]);
    checkOutcome(it, b);
    const prevState = it.state;
    if (b.title != null) it.title = b.title; if (b.description != null) it.description = b.description;
    it.data = { ...it.data, ...(b.data || {}) };
    if (b.state && b.state !== it.state) { it.state = b.state; audit(P, ACTOR(), 'item_state', { summary: `${it.kind} "${it.title}" set to ${b.state}` }); }
    applyOutcome(P, it, b, prevState);
    return { item: itemView(P, it) };
  });
  on('POST', '/api/items/(\\d+)/(confirm|ignore|reopen)', async (m) => {
    const [P, it] = findItem(m[1]);
    if (m[2] === 'confirm') confirmItem(P, it, ACTOR());
    else { it.status = m[2] === 'ignore' ? 'ignored' : 'proposed'; audit(P, ACTOR(), 'item_' + m[2], { summary: `${m[2] === 'ignore' ? 'Ignored' : 'Reopened'} ${it.kind} "${it.title}"` }); }
    return { item: itemView(P, it), project: clone(P.p) };
  });
  on('DELETE', '/api/items/(\\d+)', async (m) => { const [P, it] = findItem(m[1]); P.items = P.items.filter((x) => x !== it); return { ok: true }; });
  on('GET', '/api/projects/(\\d+)/wizard', async (m) => {
    const P = P_(m[1]);
    const order = ['field', 'deliverable', 'requirement', 'milestone', 'risk', 'schedule'];
    const rows = P.items.filter((i) => i.status === 'proposed').map((i) => itemView(P, i));
    rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id - b.id);
    const siblings = {};
    for (const r of rows) if (r.kind === 'field' && r.data.conflict) (siblings[r.data.field] = siblings[r.data.field] || []).push(r.id);
    return { items: rows, analyzing: !!P.p.analyzing, wizard_done: !!P.p.wizard_done, conflicts: siblings };
  });
  on('POST', '/api/projects/(\\d+)/wizard/finish', async (m) => { P_(m[1]).p.wizard_done = 1; return { ok: true }; });

  on('GET', '/api/projects/(\\d+)/resources', async (m) => ({ resources: P_(m[1]).resources.slice().sort((a, b) => a.name.localeCompare(b.name)).map(clone) }));
  on('POST', '/api/projects/(\\d+)/resources', async (m, q, b) => {
    const P = P_(m[1]); if (!String(b.name || '').trim()) throw err(400, 'Name is required');
    const r = { id: nid(), project_id: P.id, name: b.name.trim(), email: b.email || null, role: b.role || null, organization: String(b.organization || '').trim().slice(0, 80) || null, jira_account: b.jira_account || null, teams_name: b.teams_name || null };
    P.resources.push(r); return { resource: r };
  });
  on('PUT', '/api/projects/(\\d+)/resources/(\\d+)', async (m, q, b) => {
    const P = P_(m[1]); const r = P.resources.find((x) => x.id === Number(m[2])); if (!r) throw err(404, 'Person not found');
    if ('name' in b) { const n = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (!n) throw err(400, 'Name is required'); r.name = n; }
    for (const [k, len] of [['role', 80], ['organization', 80], ['email', 120], ['teams_name', 120], ['jira_account', 120]]) if (k in b) r[k] = String(b[k] || '').trim().slice(0, len) || null;
    return { resource: clone(r) };
  });
  // The people named in the schedule's Owner column, as suggestions for the team.
  on('GET', '/api/projects/(\\d+)/team/from-schedule', async (m) => {
    const P = P_(m[1]);
    return { people: teamExtract.fromSchedule(P.tasks, P.resources), owned_tasks: P.tasks.filter((t) => String(t.assignee || '').trim()).length };
  });
  on('POST', '/api/projects/(\\d+)/team/from-schedule', async (m, q, b) => {
    const P = P_(m[1]);
    const list = Array.isArray(b.people) ? b.people.slice(0, 300) : [];
    if (!list.length) throw err(400, 'Choose at least one person');
    const have = new Set(P.resources.map((r) => teamExtract.keyOf(r.name)));
    const added = [];
    for (const x of list) {
      const name = String((x && x.name) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const k = teamExtract.keyOf(name);
      if (!name || !k || have.has(k)) continue;
      have.add(k);
      const r = { id: nid(), project_id: P.id, name, email: null, role: null, organization: String((x && x.organization) || '').trim().slice(0, 80) || null, jira_account: null, teams_name: null };
      P.resources.push(r); added.push(r);
    }
    audit(P, ACTOR(), 'team_extracted', { summary: `Added ${added.length} ${added.length === 1 ? 'person' : 'people'} to the team from the schedule owners` });
    return { added, skipped: list.length - added.length };
  });
  on('DELETE', '/api/projects/(\\d+)/resources/(\\d+)', async (m) => { const P = P_(m[1]); P.resources = P.resources.filter((r) => r.id !== Number(m[2])); return { ok: true }; });

  on('GET', '/api/projects/(\\d+)/schedule', async (m) => { const P = P_(m[1]); ensureVersion(P); return scheduleResponse(P); });
  on('GET', '/api/projects/(\\d+)/schedule/validate', async (m) => {
    const P = P_(m[1]);
    return S.checkSchedule(P.tasks, rawProject(P), { items: linkItems(P), today: TODAY(), hasBaseline: P.tasks.some((t) => t.b_start) });
  });
  // ----- AI assistant for the schedule check -----
  // It reads the open findings, applies what it is sure about and suggests the rest. Every applied change can be undone.
  const AUTO_AT = 0.85;
  const ASSIST_SYSTEM = `You are a senior project manager repairing the traceability of a project schedule.
You get unlinked contract items (deliverables, payment milestones, requirements, risks), tasks that have no predecessor or successor, and the list of leaf tasks.
Return one JSON object: {"links":[{"item_id":number,"task_ids":[number],"confidence":number,"reason":string}],"deps":[{"task_id":number,"pred_id":number,"confidence":number,"reason":string}]}
Rules:
- links: tie each item to the task or tasks that deliver or complete it. A payment milestone belongs to the task that triggers the payment (acceptance, approval, go live, handover, delivery) and its due date should be close to that task finish. A deliverable belongs to the tasks that produce or hand it over. A requirement belongs to the tasks that build or verify it. A risk belongs to a task that mitigates it or the phase it threatens.
- deps: only for the listed tasks that lack a predecessor or a successor. pred_id must be a task that really has to finish first (same phase, earlier step, matching hand over). Never invent a link just to fill the gap. No loops. Never link a task to itself.
- confidence is 0 to 1. Use 0.85 or more only when the names clearly match and the dates agree. Use 0.5 to 0.84 when it is a sensible guess. Skip anything below 0.5.
- reason is one short plain sentence a project manager can check. Do not use dashes or semicolons.
- Use only ids from the input. Use US English.`;
  const assistTokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const assistSim = (a, b) => { const A = assistTokens(a), B = assistTokens(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => B.has(w) && n++); return n / Math.min(A.size, B.size); };
  function assistWbs(P) {
    const ids = new Set(P.tasks.map((x) => x.id)); const by = new Map();
    for (const x of P.tasks) { const k = x.parent_id && ids.has(x.parent_id) ? x.parent_id : 0; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    for (const a of by.values()) a.sort((p, q) => (p.position ?? 0) - (q.position ?? 0) || p.id - q.id);
    const map = new Map(); const walk = (pid, pre) => (by.get(pid) || []).forEach((x, i) => { const w = pre ? `${pre}.${i + 1}` : `${i + 1}`; map.set(x.id, w); walk(x.id, w); }); walk(0, '');
    return map;
  }
  function assistState(P) {
    const comp = S.schedule(P.tasks, rawProject(P)); const by = new Map(comp.map((t) => [t.id, t])); const wbs = assistWbs(P);
    const phaseOf = (t) => { let c = P.tasks.find((x) => x.id === t.parent_id), top = null; while (c) { top = c; c = P.tasks.find((x) => x.id === c.parent_id); } return top ? top.name : ''; };
    return { comp, by, wbs, phaseOf, leaves: comp.filter((t) => !t.summary) };
  }
  function assistView(P, a, st) {
    const tn = (id) => { const t = st.by.get(id); return t ? t.name : '?'; };
    const o = { ...a };
    if (a.item_id) { const it = P.items.find((x) => x.id === a.item_id); o.item_title = it ? it.title : ''; o.kind = it ? it.kind : ''; }
    if (a.task_ids) o.task_names = a.task_ids.map(tn);
    if (a.task_id) o.task_name = tn(a.task_id);
    if (a.pred_id) o.pred_name = tn(a.pred_id);
    return o;
  }
  // Applies one action. Returns the undo record, or null when it is no longer valid.
  function assistApply(P, a) {
    if (a.type === 'link') {
      const it = P.items.find((x) => x.id === a.item_id && x.status !== 'ignored'); if (!it) return null;
      const rec = { type: 'link', tasks: [] };
      for (const id of a.task_ids || []) {
        const t = P.tasks.find((x) => x.id === id); if (!t) continue;
        const had = t.deliverable_id === it.id || (Array.isArray(t.links) && t.links.includes(it.id)); if (had) continue;
        rec.tasks.push({ id: t.id, deliverable_id: t.deliverable_id || null, links: Array.isArray(t.links) ? [...t.links] : [] });
        if (it.kind === 'deliverable' && !t.deliverable_id) t.deliverable_id = it.id; else t.links = [...(Array.isArray(t.links) ? t.links : []), it.id];
      }
      if (!rec.tasks.length) return null;
      audit(P, ACTOR(), 'ai_link', { summary: `AI linked ${it.kind} "${it.title}" to ${rec.tasks.length} task${rec.tasks.length > 1 ? 's' : ''}` });
      return rec;
    }
    if (a.type === 'dep') {
      const t = P.tasks.find((x) => x.id === a.task_id), p = P.tasks.find((x) => x.id === a.pred_id); if (!t || !p || t.id === p.id) return null;
      if ((t.deps || []).some((d) => d.id === p.id)) return null;
      const nd = [...(t.deps || []), { id: p.id, type: 'FS', lag: 0 }];
      if (wouldLoop(P.tasks, t.id, nd) || S.validateLinks(P.tasks, t.id, nd).length) return null;
      const rec = { type: 'dep', id: t.id, deps: clone(t.deps || []), start: t.start }; t.deps = nd;
      audit(P, ACTOR(), 'ai_dep', { summary: `AI made "${t.name}" follow "${p.name}"` });
      return rec;
    }
    if (a.type === 'close') {
      const it = P.items.find((x) => x.id === a.item_id); if (!it || it.state === 'closed') return null;
      const rec = { type: 'close', id: it.id, state: it.state }; it.state = 'closed';
      audit(P, ACTOR(), 'ai_close', { summary: `AI closed ${it.kind} "${it.title}"` }); return rec;
    }
    if (a.type === 'duration') {
      const t = P.tasks.find((x) => x.id === a.task_id); if (!t || !(t.duration > 0)) return null;
      const rec = { type: 'duration', id: t.id, duration: t.duration }; t.duration = 0;
      audit(P, ACTOR(), 'ai_duration', { summary: `AI set milestone "${t.name}" to zero days` }); return rec;
    }
    if (a.type === 'unlink') {
      const t = P.tasks.find((x) => x.id === a.task_id); if (!t) return null; const ids = new Set(P.items.map((x) => x.id));
      const rec = { type: 'unlink', tasks: [{ id: t.id, deliverable_id: t.deliverable_id || null, links: Array.isArray(t.links) ? [...t.links] : [] }] };
      if (t.deliverable_id && !ids.has(t.deliverable_id)) t.deliverable_id = null;
      t.links = (t.links || []).filter((x) => ids.has(x));
      if (rec.tasks[0].deliverable_id === (t.deliverable_id || null) && rec.tasks[0].links.length === t.links.length) return null;
      audit(P, ACTOR(), 'ai_unlink', { summary: `AI removed a broken link from "${t.name}"` }); return rec;
    }
    return null;
  }
  function assistUndo(P, recs) {
    for (const r of recs.slice().reverse()) {
      if (r.type === 'link' || r.type === 'unlink') for (const x of r.tasks) { const t = P.tasks.find((y) => y.id === x.id); if (t) { t.deliverable_id = x.deliverable_id; t.links = x.links; } }
      else if (r.type === 'dep') { const t = P.tasks.find((y) => y.id === r.id); if (t) { t.deps = r.deps; if (r.start) t.start = r.start; } }
      else if (r.type === 'close') { const it = P.items.find((y) => y.id === r.id); if (it) it.state = r.state; }
      else if (r.type === 'duration') { const t = P.tasks.find((y) => y.id === r.id); if (t) t.duration = r.duration; }
    }
    recalc(P);
  }
  async function assistPlan(P) {
    const st = assistState(P);
    const chk = S.checkSchedule(P.tasks, rawProject(P), { items: linkItems(P), today: TODAY(), hasBaseline: P.tasks.some((t) => t.b_start) });
    const out = []; let engine = 'rules', note = null;
    for (const i of chk.issues) {
      if (i.code === 'ready_to_close' && i.item_id) out.push({ type: 'close', item_id: i.item_id, confidence: 0.95, reason: 'Every task behind it is 100 percent done.' });
      else if (i.code === 'milestone_duration' && i.task_id) out.push({ type: 'duration', task_id: i.task_id, confidence: 0.95, reason: 'A milestone has no duration.' });
      else if (i.code === 'broken_link' && i.task_id && !out.some((o) => o.type === 'unlink' && o.task_id === i.task_id)) out.push({ type: 'unlink', task_id: i.task_id, confidence: 0.95, reason: 'The linked item no longer exists.' });
    }
    const unl = chk.issues.filter((i) => i.item_id && ['del_unlinked', 'pay_unlinked', 'req_unlinked', 'risk_unlinked'].includes(i.code)).slice(0, 40);
    const need = chk.issues.filter((i) => ['isolated', 'no_pred', 'no_succ'].includes(i.code) && i.task_id).slice(0, 40);
    const leaves = st.leaves.slice(0, 260);
    const itemRows = unl.map((i) => { const it = P.items.find((x) => x.id === i.item_id); const d = (it && it.data) || {}; return { item_id: i.item_id, kind: i.kind, title: i.item_title, description: String((it && it.description) || '').slice(0, 220), due_date: d.due_date || null, amount: d.amount ?? null, percent: d.percent ?? null }; });
    const needRows = need.map((i) => ({ task_id: i.task_id, lacks: i.code === 'no_succ' ? 'successor' : i.code === 'no_pred' ? 'predecessor' : 'predecessor and successor' }));
    let ai = null;
    if ((itemRows.length || needRows.length) && leaves.length) {
      const taskRows = leaves.map((t) => ({ id: t.id, wbs: st.wbs.get(t.id), name: t.name, phase: st.phaseOf(t), start: t.start, finish: t.finish, milestone: !!t.is_milestone }));
      const user = `Project: ${P.p.name}. Contract end: ${P.p.end_date || 'unknown'}.\nUnlinked items:\n${JSON.stringify(itemRows)}\nTasks needing a link:\n${JSON.stringify(needRows)}\nLeaf tasks:\n${JSON.stringify(taskRows)}`;
      try { ai = await AI.claudeJSON(ASSIST_SYSTEM, user, 12000); if (ai) engine = 'claude'; else note = 'unavailable'; }
      catch (e) { note = ['bad_key', 'budget'].includes(e.code) ? e.code : 'unavailable'; }
    }
    const leafIds = new Set(leaves.map((t) => t.id));
    const unlIds = new Set(itemRows.map((r) => r.item_id));
    const seenItem = new Set(), seenDep = new Set();
    const conf = (c) => Math.max(0, Math.min(1, Number(c) || 0));
    if (ai) {
      for (const l of ai.links || []) {
        const ids = [...new Set((l.task_ids || []).map(Number))].filter((id) => leafIds.has(id));
        if (!unlIds.has(Number(l.item_id)) || !ids.length || seenItem.has(Number(l.item_id)) || conf(l.confidence) < 0.5) continue;
        seenItem.add(Number(l.item_id)); out.push({ type: 'link', item_id: Number(l.item_id), task_ids: ids.slice(0, 4), confidence: conf(l.confidence), reason: String(l.reason || '').slice(0, 240) });
      }
      const needIds = new Set(needRows.map((r) => r.task_id));
      for (const d of ai.deps || []) {
        const tid = Number(d.task_id), pid = Number(d.pred_id), k = tid + ':' + pid;
        if (!needIds.has(tid) || !leafIds.has(pid) || tid === pid || seenDep.has(k) || conf(d.confidence) < 0.5) continue;
        seenDep.add(k); out.push({ type: 'dep', task_id: tid, pred_id: pid, confidence: conf(d.confidence), reason: String(d.reason || '').slice(0, 240) });
      }
    } else {
      // without the AI only name matching is used, and it is always a suggestion
      for (const r of itemRows) {
        let best = null; const dv = (P.items.find((x) => x.id === r.item_id).data || {}).deliverable_id;
        for (const t of leaves) { const sc = assistSim(r.title + ' ' + r.description, t.name); if (!best || sc > best.sc) best = { t, sc }; }
        if (best && best.sc >= 0.5) out.push({ type: 'link', item_id: r.item_id, task_ids: [best.t.id], confidence: Math.min(0.78, 0.5 + best.sc * 0.3), reason: 'The names are similar.' });
        else if (dv) { const lt = leaves.filter((t) => t.deliverable_id === Number(dv) || (t.links || []).includes(Number(dv))).sort((a, b) => (b.finish || '').localeCompare(a.finish || ''))[0]; if (lt) out.push({ type: 'link', item_id: r.item_id, task_ids: [lt.id], confidence: 0.7, reason: 'It belongs to the deliverable these tasks produce.' }); }
      }
      for (const r of needRows) {
        if (r.lacks === 'successor') continue;
        const t = st.by.get(r.task_id); const sibs = leaves.filter((x) => x.parent_id === t.parent_id && x.id !== t.id && (x.position ?? 0) < (t.position ?? 0)).sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
        if (sibs[0]) out.push({ type: 'dep', task_id: t.id, pred_id: sibs[0].id, confidence: 0.6, reason: 'It is the step right before it in the same phase.' });
      }
    }
    // a new predecessor must be valid, and it is only applied alone when it does not move any date
    for (const a of out.slice()) {
      if (a.type !== 'dep') continue;
      const t = P.tasks.find((x) => x.id === a.task_id), p = P.tasks.find((x) => x.id === a.pred_id);
      const nd = [...(t.deps || []), { id: p.id, type: 'FS', lag: 0 }];
      if (wouldLoop(P.tasks, t.id, nd) || S.validateLinks(P.tasks, t.id, nd).length) { out.splice(out.indexOf(a), 1); continue; }
      const pf = (st.by.get(p.id) || {}).finish, ts = (st.by.get(t.id) || {}).start;
      if (pf && ts && pf >= ts) { a.moves = true; a.confidence = Math.min(a.confidence, 0.8); a.start_from = ts; }
    }
    // a payment due before the task it is tied to finishes needs a person
    for (const a of out) {
      if (a.type !== 'link') continue;
      const it = P.items.find((x) => x.id === a.item_id), due = it && it.data && it.data.due_date;
      if (it && it.kind === 'milestone' && due) { const fin = a.task_ids.map((id) => (st.by.get(id) || {}).finish).filter(Boolean).sort().pop(); if (fin && fin > due) { a.confidence = Math.min(a.confidence, 0.8); a.reason = (a.reason + ` The task finishes ${fin}, after the payment due date ${due}.`).trim(); } }
    }
    return { out, engine, note };
  }
  const assistStore = (P, recs) => { const token = String(nid()); P.assist_undo = P.assist_undo || {}; P.assist_undo[token] = recs; const ks = Object.keys(P.assist_undo); if (ks.length > 10) delete P.assist_undo[ks[0]]; return token; };
  on('POST', '/api/projects/(\\d+)/schedule/assist', async (m) => {
    const P = P_(m[1]);
    const plan = await assistPlan(P);
    const auto = plan.out.filter((a) => a.confidence >= AUTO_AT), rest = plan.out.filter((a) => a.confidence < AUTO_AT);
    const recs = [], applied = [];
    for (const a of auto) { const r = assistApply(P, a); if (r) { recs.push(r); applied.push(a); } }
    let token = null;
    if (recs.length) { recalc(P); recordVersion(P, 'edit'); token = assistStore(P, recs); }
    const st = assistState(P);
    return { engine: plan.engine, note: plan.note, token, applied: applied.map((a) => assistView(P, a, st)), suggestions: rest.sort((a, b) => b.confidence - a.confidence).map((a, i) => ({ ...assistView(P, a, st), key: 's' + i })), ...scheduleResponse(P) };
  });
  on('POST', '/api/projects/(\\d+)/schedule/assist/apply', async (m, q, b) => {
    const P = P_(m[1]); const recs = [];
    for (const a of (b.actions || []).slice(0, 100)) { const r = assistApply(P, a); if (r) recs.push(r); }
    let token = null;
    if (recs.length) { recalc(P); recordVersion(P, 'edit'); token = assistStore(P, recs); }
    return { applied: recs.length, token, ...scheduleResponse(P) };
  });
  on('POST', '/api/projects/(\\d+)/schedule/assist/undo', async (m, q, b) => {
    const P = P_(m[1]); const recs = (P.assist_undo || {})[String(b.token)]; if (!recs) throw err(404, 'Nothing to undo');
    assistUndo(P, recs); delete P.assist_undo[String(b.token)]; recordVersion(P, 'edit'); audit(P, ACTOR(), 'ai_undo', { summary: 'Undid the AI schedule fixes' });
    return scheduleResponse(P);
  });
  on('GET', '/api/projects/(\\d+)/schedule/versions', async (m) => ({ versions: listVersions(P_(m[1])) }));
  on('POST', '/api/projects/(\\d+)/schedule/versions', async (m, q, b) => {
    const P = P_(m[1]); const label = String((b && b.label) || '').trim().slice(0, 80); if (!label) throw err(400, 'Name this version');
    recordVersion(P, 'manual', label); return { versions: listVersions(P) };
  });
  on('GET', '/api/projects/(\\d+)/schedule/versions/(\\d+)/diff', async (m) => {
    const P = P_(m[1]); ensureVersion(P); const v = P.versions.find((x) => x.id === Number(m[2])); if (!v) throw err(404, 'Version not found');
    const d = V.diff(v.snapshot, V.snap(P.tasks));
    return { version: versionView(v), end_then: v.project_end, end_now: projEnd(P), added: d.added.length, removed: d.removed.length, changed: d.changed.length, reordered: d.reordered,
      added_names: d.added.slice(0, 50).map((x) => x.name), removed_names: d.removed.slice(0, 50).map((x) => x.name), changes: d.changed.slice(0, 50).map((x) => ({ id: x.id, name: x.name, fields: x.fields, from: x.from, to: x.to })) };
  });
  on('POST', '/api/projects/(\\d+)/schedule/versions/(\\d+)/restore', async (m) => {
    const P = P_(m[1]); ensureVersion(P); const v = P.versions.find((x) => x.id === Number(m[2])); if (!v) throw err(404, 'Version not found');
    recordVersion(P, 'edit');
    P.tasks = clone(v.snapshot).map((t) => ({ ...t, start: t.start, finish: undefined, progress: t.progress || 0 }));
    P.tasks.sort((a, z) => (a.position ?? 0) - (z.position ?? 0) || a.id - z.id);
    recalc(P); audit(P, ACTOR(), 'schedule_restore', { summary: `Restored schedule ${v.version}` });
    recordVersion(P, 'restore', v.version);
    return { ...scheduleResponse(P), versions: listVersions(P) };
  });
  // ----- Microsoft Project exchange -----
  function assignUids(P) { let next = P.tasks.reduce((mx, t) => Math.max(mx, Number(t.ext_uid) || 0), 0) + 1; for (const t of P.tasks) if (!t.ext_uid) t.ext_uid = String(next++); }
  on('GET', '/api/projects/(\\d+)/msproject/export', async (m) => {
    const P = P_(m[1]); if (!P.tasks.length) throw err(400, 'There are no tasks to export yet');
    assignUids(P);
    const uid = new Map(P.tasks.map((t) => [t.id, t.ext_uid]));
    const computed = S.schedule(P.tasks, rawProject(P)).map((t) => ({ ...t, ext_uid: uid.get(t.id) }));
    audit(P, ACTOR(), 'msproject_export', { summary: `Exported ${computed.length} tasks to Microsoft Project XML` });
    return { xml: win.__MSP.toXml(rawProject(P), computed), filename: `${P.p.name.replace(/[^\w .-]/g, '_')}.xml` };
  });
  on('POST', '/api/projects/(\\d+)/msproject/import', async (m, q, b) => {
    const P = P_(m[1]); const mode = b.mode === 'merge' ? 'merge' : 'replace';
    let parsed; try { parsed = win.__MSP.parse(win.__MSP.slim(b.xml)); } catch (e) { throw err(400, e.message); }
    const plan = win.__MSP.plan(P.tasks, parsed, mode);
    if (b.preview) return { summary: plan.summary, mode, missing: plan.missing.map((t) => t.name).slice(0, 20) };
    const idOf = new Map();
    if (mode === 'replace') P.tasks = [];
    const hasPos = P.tasks.reduce((mx, t) => Math.max(mx, t.position ?? 0), -1) + 1;
    for (const r of plan.rows) {
      let t = r.existing_id && P.tasks.find((x) => x.id === r.existing_id);
      if (t) Object.assign(t, { name: r.name, start: r.start, duration: r.duration, progress: r.progress, assignee: r.owner || t.assignee, notes: r.notes || t.notes, is_milestone: r.milestone ? 1 : 0, position: r.position, ext_uid: r.uid });
      else { t = { id: nid(), parent_id: null, position: (mode === 'merge' ? hasPos : 0) + r.position, name: r.name, start: r.start, duration: r.duration, progress: r.progress, assignee: r.owner, deps: [], deliverable_id: null, b_start: r.b_start, b_end: r.b_end, notes: r.notes, is_milestone: r.milestone ? 1 : 0, jira_key: null, color: null, ext_uid: r.uid }; P.tasks.push(t); }
      idOf.set(r.uid, t.id);
    }
    for (const r of plan.rows) { const t = P.tasks.find((x) => x.id === idOf.get(r.uid)); t.parent_id = r.parent_uid ? idOf.get(r.parent_uid) : null; t.deps = r.preds.map((p) => ({ id: idOf.get(p.uid), type: p.type, lag: p.lag })).filter((d) => d.id); }
    if (mode === 'replace' && parsed.calendar) { P.p.work_days = parsed.calendar.work_days; P.p.holidays = parsed.calendar.holidays; }
    P.tasks.sort((a, z) => (a.position ?? 0) - (z.position ?? 0) || a.id - z.id);
    recalc(P);
    audit(P, ACTOR(), 'msproject_import', { summary: `Microsoft Project ${mode === 'merge' ? 'sync' : 'import'}: ${plan.summary.added} added, ${plan.summary.updated} updated` });
    const issues = S.validateSchedule(P.tasks, rawProject(P)).filter((i) => i.severity === 'error');
    return { ...scheduleResponse(P), summary: plan.summary, issues };
  });
  on('POST', '/api/projects/(\\d+)/schedule/preview', async (m, q, b) => {
    const P = P_(m[1]); const changes = normalizeChanges(P, b.changes);
    for (const [id, ch] of Object.entries(changes)) if (ch.deps) { const errs = S.validateLinks(P.tasks, Number(id), ch.deps); if (errs.length) throw err(400, errs[0]); }
    const p = S.preview(P.tasks, rawProject(P), changes);
    return { impacts: p.impacts, constrained: p.constrained, projectEnd: p.projectEnd };
  });
  on('POST', '/api/projects/(\\d+)/schedule/apply', async (m, q, b) => {
    const P = P_(m[1]); const changes = normalizeChanges(P, b.changes);
    for (const [id, ch] of Object.entries(changes)) if (ch.deps) { const errs = S.validateLinks(P.tasks, Number(id), ch.deps); if (errs.length) throw err(400, errs[0]); }
    for (const [id, ch] of Object.entries(changes)) {
      const t = P.tasks.find((x) => x.id === Number(id)); if (!t) continue;
      if (ch.deleted) {
        for (const o of P.tasks) { if (o.parent_id === t.id) o.parent_id = t.parent_id ?? null; o.deps = o.deps.filter((d) => d.id !== t.id); }
        P.tasks = P.tasks.filter((x) => x !== t); audit(P, ACTOR(), 'task_deleted', { summary: `Deleted task "${t.name}"` }); continue;
      }
      const bits = [];
      if (ch.start && ch.start !== t.start) bits.push(`start ${t.start} to ${ch.start}`);
      if (ch.duration != null && ch.duration !== t.duration) bits.push(`duration ${t.duration} to ${ch.duration} days`);
      if (ch.progress != null && ch.progress !== t.progress) bits.push(`progress ${t.progress || 0}% to ${ch.progress}%`);
      for (const k of TASK_FIELDS) if (k in ch) t[k] = ch[k];
      if ('deps' in ch) t.deps = ch.deps;
      if (ch._asap) t.start = ch._asap;
      if (bits.length) audit(P, ACTOR(), 'task_update', { summary: `Task "${t.name}": ${bits.join(', ')}` });
    }
    P.tasks.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    recalc(P); recordVersion(P, 'edit');
    // the overview actions only need to know it worked, so they skip the full task list
    if (b.slim) return { ok: true, tasks_changed: Object.keys(changes).length };
    return scheduleResponse(P);
  });
  on('POST', '/api/projects/(\\d+)/tasks', async (m, q, b) => {
    const P = P_(m[1]);
    if (!String(b.name || '').trim()) throw err(400, 'Task name is required');
    const c = S.calendar(rawProject(P));
    let start = b.start;
    if (!start) { const last = P.tasks.slice().sort((a, z) => z.start.localeCompare(a.start))[0]; start = P.p.start_date || (last && last.start) || TODAY(); }
    start = S.nextWork(start, c);
    let position;
    if (b.after_id) { const a = P.tasks.find((x) => x.id === Number(b.after_id)); position = (a ? a.position : 0) + 1; for (const t of P.tasks) if ((t.position ?? 0) >= position) t.position = (t.position ?? 0) + 1; }
    else position = P.tasks.reduce((mx, t) => Math.max(mx, t.position ?? 0), 0) + 1;
    const dur = b.is_milestone ? 0 : Math.max(1, Math.round(Number(b.duration) || 1));
    const id = nid();
    P.tasks.push({ id, parent_id: b.parent_id ? Number(b.parent_id) : null, position, name: b.name.trim(), start, duration: dur, progress: 0, assignee: b.assignee || null, deps: b.deps || [], deliverable_id: b.deliverable_id || null, b_start: null, b_end: null, notes: null, is_milestone: b.is_milestone ? 1 : 0, jira_key: null, color: null, mode: b.mode === 'manual' ? 'manual' : 'auto', flag: 0 });
    P.tasks.sort((a, z) => (a.position ?? 0) - (z.position ?? 0) || a.id - z.id);
    recalc(P); audit(P, ACTOR(), 'task_added', { summary: `Added task "${b.name.trim()}"` }); recordVersion(P, 'edit');
    return { ...scheduleResponse(P), created: id };
  });
  on('POST', '/api/projects/(\\d+)/schedule/reorder', async (m, q, b) => {
    const P = P_(m[1]);
    const test = P.tasks.map((t) => { const o = (b.order || []).find((x) => Number(x.id) === t.id); return o ? { ...t, parent_id: o.parent_id ? Number(o.parent_id) : null } : t; });
    const H = S.hierarchy(test);
    for (const t of test) {
      if (H.ancestors(t.id).has(t.id) || H.level(t.id) > S.MAX_LEVEL) throw err(400, `Tasks can be nested up to ${S.MAX_LEVEL} levels`);
      const errs = S.validateLinks(test, t.id, t.deps).filter((e) => /same branch/.test(e)); if (errs.length) throw err(400, `${t.name}: ${errs[0]}`);
    }
    (b.order || []).forEach((o, i) => { const t = P.tasks.find((x) => x.id === Number(o.id)); if (t) { t.parent_id = o.parent_id ? Number(o.parent_id) : null; t.position = i; } });
    P.tasks.sort((a, z) => (a.position ?? 0) - (z.position ?? 0) || a.id - z.id);
    recalc(P); recordVersion(P, 'edit'); return scheduleResponse(P);
  });
  on('POST', '/api/projects/(\\d+)/schedule/baseline', async (m) => {
    const P = P_(m[1]); const computed = S.schedule(P.tasks, rawProject(P));
    const bls = ensureBaselines(P), snap = {};
    for (const c of computed) { const t = P.tasks.find((x) => x.id === c.id); if (t) { t.b_start = c.start; t.b_end = c.finish; if (c.start && c.finish) snap[t.id] = [c.start, c.finish]; } }
    bls.push({ n: (bls.length ? bls[bls.length - 1].n : 0) + 1, at: nowTs(), tasks: snap });
    while (bls.length > MAX_BASELINES) bls.shift();
    audit(P, ACTOR(), 'baseline_set', { summary: `Baseline set for ${computed.length} tasks` });
    recordVersion(P, 'baseline');
    return scheduleResponse(P);
  });

  on('GET', '/api/projects/(\\d+)/inbox', async (m, q) => { const P = P_(m[1]); return paged(P.inbox, q, 'inbox', (r) => inboxView(P, r)); });
  on('GET', '/api/inbox/unassigned', async () => ({ inbox: [] }));
  const findRow = (id) => { for (const k of DB.order) { const P = DB.projects[k]; const r = P && P.inbox.find((x) => x.id === Number(id)); if (r) { need(P, ctx().level); touch(P); return [P, r]; } } throw err(404, 'Not found'); };
  on('POST', '/api/inbox/(\\d+)/apply', async (m, q, b) => {
    const [P, r] = findRow(m[1]);
    if (r.status !== 'pending') throw err(400, 'This suggestion was already handled');
    const action = { ...(r.action || {}), ...((b && b.override) || {}) };
    const out = applyAction(P, action, ACTOR(), r.doc_id);
    r.status = 'applied'; r.applied_at = nowTs(); r.action = { ...action, prev: out.prev, summary: out.summary };
    await meetingInboxSync(r, 'apply');
    return { ok: true, summary: out.summary };
  });
  on('POST', '/api/inbox/(\\d+)/dismiss', async (m) => { const [, r] = findRow(m[1]); r.status = 'dismissed'; return { ok: true }; });
  on('POST', '/api/inbox/(\\d+)/restore', async (m) => { const [, r] = findRow(m[1]); if (!['dismissed', 'undone'].includes(r.status)) throw err(400, 'Nothing to restore'); r.status = 'pending'; return { ok: true }; });
  on('POST', '/api/inbox/(\\d+)/undo', async (m) => {
    const [P, r] = findRow(m[1]);
    if (!['applied', 'auto_applied'].includes(r.status)) throw err(400, 'Nothing to undo');
    undoAction(P, r.action || {}); r.status = 'undone'; await meetingInboxSync(r, 'undo'); return { ok: true };
  });
  // one message in, suggestions out (used by pasted messages, webhooks and the sync button)
  async function ingestMessage(P, b) {
    const text = `${b.subject || ''}\n${b.body}`.trim();
    const deliverables = P.items.filter((i) => i.kind === 'deliverable' && i.status !== 'ignored');
    const result = await AI.interpretMessage({ text, sender: b.sender, tasks: P.tasks, resources: P.resources, deliverables });
    const who = resolveResource(P, b.sender, result.resource);
    const base = { source: b.source || 'manual', sender: b.sender || null, subject: b.subject || null, body: text, resource: who, ext_id: b.ext_id || null };
    if (!result.updates.length) { addInbox(P, { ...base, status: 'no_action', summary: 'No project status information found in this message.' }); return { rows: 1 }; }
    for (const u of result.updates) addInbox(P, { ...base, action: u, summary: describeAction(P, u), confidence: u.confidence ?? 0.5 });
    return { rows: result.updates.length };
  }
  on('POST', '/api/projects/(\\d+)/messages', async (m, q, b) => {
    const P = P_(m[1]);
    if (!String(b.body || '').trim()) throw err(400, 'Paste the message text');
    return ingestMessage(P, b);
  });
  // reads new mail and Jira work for this project from the connected accounts and turns each into suggestions
  const projectKey = (P) => {
    const u = String(P.p.jira_url || ''), m = /\/(?:browse|projects)\/([A-Za-z][A-Za-z0-9_]+)/.exec(u) || /[?&]projectKey=([A-Za-z][A-Za-z0-9_]+)/.exec(u);
    if (m) return m[1].toUpperCase();
    const counts = {}; for (const t of P.tasks) { const k = /^([A-Z][A-Z0-9_]+)-\d+/.exec(t.jira_key || ''); if (k) counts[k[1]] = (counts[k[1]] || 0) + 1; }
    return Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0] || null;
  };
  const mentions = (P, text) => {
    const hay = String(text || '').toLowerCase(), name = String(P.p.name || '').toLowerCase().trim();
    if (name.length >= 4 && hay.includes(name)) return true;
    const code = String(P.p.code || '').toLowerCase().trim();
    if (code.length >= 3 && hay.includes(code)) return true;
    const toks = name.split(/[^a-z0-9؀-ۿ]+/).filter((w) => w.length > 3);
    return toks.length >= 2 && toks.length <= 3 && toks.every((w) => hay.includes(w));
  };
  // ---------- sync history and the automatic schedule ----------
  const SCHEDULES = ['off', 'hourly', 'every4h', 'daily', 'weekdays'];
  const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  // when the next automatic sync is due: hourly styles count from the last run, daily styles use the person's clock time
  function nextSync(cfg) {
    if (!cfg || !SCHEDULES.includes(cfg.mode) || cfg.mode === 'off') return null;
    const base = Math.max(cfg.last_run || 0, cfg.set_at || 0) || Date.now();
    if (cfg.mode === 'hourly') return base + 3600e3;
    if (cfg.mode === 'every4h') return base + 4 * 3600e3;
    const [H, M] = String(cfg.time || '08:00').split(':').map(Number), tzo = Number(cfg.tzo) || 0;
    const local = new Date(base - tzo * 60000);
    for (let i = 0; i < 9; i++) {
      const cand = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i, H, M) + tzo * 60000;
      const wd = new Date(cand - tzo * 60000).getUTCDay();
      if (cfg.mode === 'weekdays' && (wd === 0 || wd === 6)) continue;
      if (cand > base) return cand;
    }
    return null;
  }
  const syncInfo = (P) => {
    const cfg = P.sync_cfg || {}, next = nextSync(cfg), log = P.sync_log || [];
    return { last: log.length ? log[0].at : null, last_ok: log.length ? log[0].ok : null, schedule: { mode: SCHEDULES.includes(cfg.mode) ? cfg.mode : 'off', time: cfg.time || '08:00' }, next: next ? new Date(next).toISOString() : null, history: log };
  };
  on('GET', '/api/projects/(\\d+)/sync-history', async (m) => syncInfo(P_(m[1])));
  on('PUT', '/api/projects/(\\d+)/sync-schedule', async (m, q, b) => {
    const P = P_(m[1], 'editor'), c = ctx();
    const mode = String((b && b.mode) || 'off'), time = String((b && b.time) || '08:00');
    if (!SCHEDULES.includes(mode)) throw err(400, 'Choose off, hourly, every 4 hours, daily or weekdays');
    if (!HHMM.test(time)) throw err(400, 'Use a time like 08:00');
    const tzo = Math.max(-840, Math.min(840, Math.round(Number(b && b.tzo) || 0)));
    P.sync_cfg = { mode, time, tzo, user_id: c.user.id, set_at: Date.now(), last_run: (P.sync_cfg && P.sync_cfg.last_run) || 0 };
    touch(P); audit(P, ACTOR(), 'sync_schedule', { summary: mode === 'off' ? 'Turned off automatic sync' : `Set automatic sync to ${mode}` });
    return syncInfo(P);
  });
  const MAXLOG = 50;
  function logSync(P, entry) {
    P.sync_log = P.sync_log || [];
    P.sync_log.unshift({ id: nid(), at: new Date().toISOString(), ...entry });
    if (P.sync_log.length > MAXLOG) P.sync_log.length = MAXLOG;
  }
  on('POST', '/api/projects/(\\d+)/sync', async (m) => {
    const P = P_(m[1]), c = ctx(), report = {}, errors = {}, trigger = c.scheduled ? 'scheduled' : 'manual', t0 = Date.now();
    const prefs = c.user.prefs || {}, secrets = prefs.conn_secrets || {};
    const kinds = ['outlook', 'jira'].filter((k) => secrets[k]);
    if (!kinds.length) {
      const errors = { connect: 'Connect Outlook or Jira first. Then Sync now brings in new mail and Jira updates.' };
      if (trigger === 'scheduled') { logSync(P, { trigger, actor: ACTOR(), ok: false, found: 0, report: {}, errors, ms: Date.now() - t0 }); touch(P); }
      return { report, errors, needs_connection: true };
    }
    P.sync = P.sync || {};
    const known = new Set(P.inbox.map((r) => r.ext_id).filter(Boolean));
    let changedPrefs = prefs;
    for (const kind of kinds) {
      try {
        const f = await connectors.fresh(changedPrefs, kind);
        if (f.changed) changedPrefs = await connectors.apply(changedPrefs, kind, { label: (prefs.connections || {})[kind], secret: f.secret, meta: (prefs.conn_meta || {})[kind] });
        const since = P.sync[kind] || new Date(Date.now() - 14 * 864e5).toISOString();
        let list;
        if (kind === 'outlook') list = (await connectors.outlookMail(f.secret, since)).filter((x) => mentions(P, `${x.subject}\n${x.body.slice(0, 1500)}`));
        else {
          const key = projectKey(P);
          if (!key) { errors.jira = 'Add the Jira project link in the project settings so we know which Jira project to read.'; continue; }
          list = await connectors.jiraIssues(f.secret, key);
        }
        const fresh = list.filter((x) => !known.has(x.ext_id)).slice(0, 15);
        let n = 0;
        for (const x of fresh) { const r = await ingestMessage(P, { ...x, source: kind }); n += r.rows; known.add(x.ext_id); }
        report[kind] = fresh.length ? n : 0;
        P.sync[kind] = new Date().toISOString();
      } catch (e) { errors[kind] = e.expose || e.status < 500 ? e.message : 'The sync could not finish. Try again in a moment.'; if (!e.status || e.status >= 500) console.error('sync', kind, e); }
    }
    if (changedPrefs !== prefs) { c.user.prefs = changedPrefs; await saveUser(); }
    logSync(P, { trigger, actor: ACTOR(), ok: !Object.keys(errors).length, found: Object.values(report).reduce((a, v) => a + v, 0), report, errors, ms: Date.now() - t0 });
    touch(P);
    return { report, errors };
  });

  // Read from the live report engine, so a new document type shows up without regenerating the demo seed.
  on('GET', '/api/doc-types', async () => ({ types: R.DOC_TYPES }));
  // A template is one of three modes. design: colors, fonts, logo, styles and intro page for every document type.
  // structure: the section list of one document type. both: the design and the structure of one document type.
  const MODES = ['design', 'structure', 'both'];
  // Templates saved before modes existed keep working exactly as they did: a look plus sections is both, a look alone is design.
  const modeOf = (t) => (MODES.includes(t.mode) ? t.mode : t.brand || t.layout ? (R.parseTemplate(t.body || '').length ? 'both' : 'design') : 'structure');
  const usesDesign = (t) => modeOf(t) !== 'structure';
  const usesStructure = (t) => modeOf(t) !== 'design';
  on('GET', '/api/templates', async () => ({ templates: DB.templates.map((t) => ({ id: t.id, doc_type: t.doc_type, mode: modeOf(t), name: t.name, created_at: t.created_at, has_layout: !!t.layout && usesDesign(t), ...(t.brand && usesDesign(t) ? { brand: { colors: t.brand.colors, fonts: t.brand.fonts, has_logo: !!t.brand.logo, source: t.brand.source || null } } : {}), sections: usesStructure(t) ? R.parseTemplate(t.body || '').length : 0 })) }));
  on('GET', '/api/templates/skeleton/([a-z_]+)', async (m) => { if (!RAW.skeletons[m[1]]) throw err(404, 'Unknown document type'); return { body: RAW.skeletons[m[1]] }; });
  on('POST', '/api/templates', async (m, q, fd) => {
    needForm(fd);
    const name = fd.get('name'), doc_type = fd.get('doc_type');
    if (!name || !(doc_type === '*' || RAW.skeletons[doc_type])) throw err(400, 'Choose a document type and give the template a name');
    let body = fd.get('body') || '';
    const f = fd.get('file');
    if (f && f.name) {
      if (/\.(md|txt)$/i.test(f.name)) body = await f.text();
      else if (/\.docx$/i.test(f.name)) { try { body = (await extractText(f.buffer, f.name)).text || ''; } catch (e) { throw err(400, `Could not read the Word file: ${e.message}`); } }
      else throw err(400, 'Upload a Markdown, text or Word (.docx) template');
    }
    if (!R.parseTemplate(body).length) throw err(400, 'No section headings found. Use lines starting with "# " in text.');
    let layout = null;
    const rawLay = fd.get('layout');
    if (rawLay) { try { layout = cleanLayout(JSON.parse(rawLay)); } catch (e) { throw err(400, 'Page layout is not valid'); } }
    let brand = null;
    const rawBrand = fd.get('brand');
    if (rawBrand) { try { brand = brandLib.cleanBrand(JSON.parse(rawBrand)); } catch (e) { throw err(e.status || 400, e.status ? e.message : 'The brand is not valid'); } }
    if (DB.templates.length >= 60) throw err(400, 'You have 60 templates. Delete one before adding another.');
    const t = { id: nid(), owner_id: DB.user.id, doc_type, mode: layout || brand ? 'both' : 'structure', name: String(name).trim().slice(0, 120), body: String(body).slice(0, 400000), created_at: nowTs(), ...(layout ? { layout } : {}), ...(brand ? { brand } : {}) };
    DB.templates.push(t); await saveUser();
    return { template: { id: t.id, doc_type, mode: t.mode, name: t.name, created_at: t.created_at, has_layout: !!layout, has_brand: !!brand }, sections: R.parseTemplate(body).map((s) => s.heading) };
  });
  // ---------- client templates: the style of a client's own Word or PowerPoint file ----------
  const tplFull = (t) => ({ id: t.id, doc_type: t.doc_type, mode: modeOf(t), name: t.name, created_at: t.created_at, has_layout: !!t.layout && usesDesign(t), layout: usesDesign(t) ? t.layout || null : null, brand: usesDesign(t) ? t.brand || null : null, sections: usesStructure(t) ? R.parseTemplate(t.body || '').map((x) => x.heading) : [] });
  const bodyOf = (heads, old) => {
    const prev = new Map(R.parseTemplate(old || '').map((x) => [x.heading.toLowerCase(), x.body]));
    return heads.map((h) => `# ${h}\n\n${prev.get(h.toLowerCase()) || ''}`.trimEnd()).join('\n\n') + (heads.length ? '\n' : '');
  };
  // The PM chooses what to take from the uploaded Word, PowerPoint or Excel file.
  // design: the look (logo, fonts, colors, styles, intro page, header and footer) for every document type, so no type is asked for.
  // structure or both: the document type is required, because the sections belong to one type.
  on('POST', '/api/templates/client', async (m, q, fd) => {
    needForm(fd);
    const f = fd.get('file');
    if (!f || !f.name || !f.buffer || !f.buffer.length) throw err(400, 'Choose the template file');
    const mode = String(fd.get('mode') || '');
    if (!MODES.includes(mode)) throw err(400, 'Choose what to take from the file: the design pattern, the document structure or both');
    let doc_type = '*';
    if (mode !== 'design') {
      doc_type = String(fd.get('doc_type') || '');
      if (!doc_type || doc_type === '*') throw err(400, 'Choose the document type. It is required when the structure is used.');
      if (!RAW.skeletons[doc_type]) throw err(400, 'Choose a valid document type');
    }
    if (DB.templates.length >= 60) throw err(400, 'You have 60 templates. Delete one before adding another.');
    const ai = process.env.ANTHROPIC_API_KEY ? (payload) => callClaude(payload) : null;
    let r;
    try { r = await brandLib.extract(f.buffer, f.name, { ai }); } catch (e) { throw err(e.status || 400, e.message); }
    const name = cleanName(fd.get('name'), 120) || r.name;
    if (mode !== 'design' && !r.headings.length) throw err(400, 'No section headings were found in this file. Use the design pattern only, or upload a file with at least two headings (sheet names for Excel).');
    const t = { id: nid(), owner_id: DB.user.id, doc_type, mode, name, body: mode === 'design' ? '' : bodyOf(r.headings, ''), created_at: nowTs() };
    if (mode !== 'structure') {
      t.layout = cleanLayout({
        v: 1, logo: { cover: (r.intro && r.intro.logo) || 'left', header: 'left' },
        header: { left: '', center: '', right: cleanName(r.header, 160) || '{{project}}\n{{client}}' },
        footer: { left: cleanName(r.footer, 160) || '{{title}}  \u00b7  {{date}}', center: '', right: 'Page {{page}} of {{pages}}' },
      });
      t.brand = brandLib.cleanBrand(r.brand);
    }
    DB.templates.push(t); await saveUser();
    return { template: tplFull(t), engine: r.engine, warnings: r.warnings, found: { headings: mode === 'design' ? 0 : r.headings.length, logo: !!(t.brand && t.brand.logo), header: !!r.header, footer: !!r.footer, intro: !!(r.intro && r.intro.found), intro_logo: (r.intro && r.intro.logo) || 'left', kind: r.brand.source.kind } };
  });
  on('GET', '/api/templates/(\\d+)', async (m) => { const t = DB.templates.find((x) => x.id === Number(m[1])); if (!t) throw err(404, 'Template not found'); return { template: tplFull(t) }; });
  on('PUT', '/api/templates/(\\d+)', async (m, q, b) => {
    const t = DB.templates.find((x) => x.id === Number(m[1])); if (!t) throw err(404, 'Template not found');
    b = b || {};
    if (b.name != null) { const v = cleanName(b.name, 120); if (!v) throw err(400, 'Give the template a name'); t.name = v; }
    const tm = modeOf(t);
    if ('brand' in b && tm !== 'structure') { try { const nbr = brandLib.cleanBrand(b.brand, t.brand); if (nbr) t.brand = nbr; else delete t.brand; } catch (e) { throw err(e.status || 400, e.message); } }
    if ('layout' in b && tm !== 'structure') { const lay = cleanLayout(b.layout); if (lay) t.layout = lay; else delete t.layout; }
    if (Array.isArray(b.sections) && tm !== 'design') {
      const all = b.sections.map((x) => cleanName(x && typeof x === 'object' ? x.heading : x, 100)).filter(Boolean);
      const seen = new Set(), list = all.filter((h) => { const k = h.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
      if (!list.length) throw err(400, 'A template needs at least one section');
      t.body = bodyOf(list, t.body);
    }
    await saveUser();
    return { template: tplFull(t) };
  });
  on('DELETE', '/api/templates/(\\d+)', async (m) => { DB.templates = DB.templates.filter((t) => t.id !== Number(m[1])); await saveUser(); return { ok: true }; });

  const FORMATS = ['docx', 'xlsx', 'pptx'];
  const cleanName = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  // The facts printed on every page of an exported file, and the chart data behind its visuals
  const docMeta = (P, today, pm) => ({ client: P.p.client || '', project: P.p.name, code: P.p.code || '', date: today, pm: pm || DB.user.name, currency: P.p.currency || '', client_logo: P.p.client_logo || null });
  function snapshot(P, type, today, periodDays, lastWeek) {
    const ctx = R.buildContext(reportInputs(P, today, periodDays, lastWeek));
    const progress = R.DEFAULTS[type] ? type.startsWith('progress') : false;
    return { ctx, visuals: win.__Visuals ? win.__Visuals.fromContext(ctx, progress) : null };
  }
  // Documents made before formats existed get a format and chart data the first time they are read
  function complete(P, g) {
    if (!g.format) g.format = 'docx';
    if (!g.meta) g.meta = docMeta(P, String(g.created_at || TODAY()).slice(0, 10));
    if (!g.visuals && R.DEFAULTS[g.doc_type]) g.visuals = snapshot(P, g.doc_type, TODAY(), R.DEFAULTS[g.doc_type].period || 7).visuals;
    return g;
  }
  // Page layout of a document: where the logo sits and what the header and footer say.
  const POS = ['left', 'center', 'right', 'hidden'];
  function cleanLayout(l) {
    if (l == null) return null;
    if (typeof l !== 'object' || Array.isArray(l)) throw err(400, 'Page layout is not valid');
    const txt = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').split(/\r?\n/).slice(0, 3).map((x) => x.trim().slice(0, 160)).join('\n').trim();
    const pos = (v, d) => (POS.includes(v) ? v : d);
    const part = (o) => ({ left: txt(o && o.left), center: txt(o && o.center), right: txt(o && o.right) });
    let logoImg = null;
    if (l.logoImg) {
      const li = l.logoImg;
      if (typeof li.dataUrl !== 'string' || !/^data:image\/(png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(li.dataUrl)) throw err(400, 'The logo must be a PNG, JPEG, GIF or SVG image');
      if (li.dataUrl.length > 1000000) throw err(413, 'The logo is too large. Use an image under 700 KB.');
      logoImg = { dataUrl: li.dataUrl, w: Math.max(0, Math.min(10000, Number(li.w) || 0)), h: Math.max(0, Math.min(10000, Number(li.h) || 0)) };
    }
    return { v: 1, logo: { cover: pos(l.logo && l.logo.cover, 'left'), header: pos(l.logo && l.logo.header, 'left') }, header: part(l.header), footer: part(l.footer), ...(logoImg ? { logoImg } : {}) };
  }
  const folderOk = (P, id) => id == null || id === '' || P.folders.some((f) => f.id === Number(id));
  const gSummary = (g) => ({ id: g.id, doc_type: g.doc_type, title: g.title, template: g.template, created_at: g.created_at, format: g.format || 'docx', folder_id: g.folder_id == null ? null : g.folder_id, custom: !!g.custom, branded: !!g.brand });

  // ---------- custom documents: analyze the need, then generate from the chosen sections ----------
  const LIBKEYS = new Set(R.GENERATOR_KEYS);
  const cleanSections = (list) => {
    const seen = new Set(), out = [];
    for (const s of Array.isArray(list) ? list : []) {
      const heading = cleanName(s && s.heading, 120); if (!heading || seen.has(heading.toLowerCase())) continue;
      seen.add(heading.toLowerCase());
      out.push({ heading, key: s.key && LIBKEYS.has(s.key) ? s.key : null, guidance: cleanName(s.guidance, 300) });
      if (out.length >= 20) break;
    }
    return out;
  };
  // Claude reads the brief and picks the sections. Any failure falls back to the rule based suggestion.
  async function aiPlan(P, inp) {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    const types = Object.entries(R.DEFAULTS).filter(([, d]) => !d.oneSlide).map(([id, d]) => `${id}: ${d.title}`).join('\n');
    const lib = R.LIBRARY.map(([k, h, about]) => `${k}: ${h}. ${about}`).join('\n');
    const system = 'You plan professional project management documents. Reply with one JSON object only, with no prose and no code fences. Write in US English. Do not use dashes as punctuation and do not use semicolons.';
    const user = `Project: ${P.p.name}${P.p.client ? ` for ${P.p.client}` : ''}\nDocument name: ${inp.name}\nAudience: ${inp.audience}\nDescription: ${inp.description}\n\nStandard templates:\n${types}\n\nSections the system can fill from project data (key: heading. what it holds):\n${lib}\n\nReturn {"base_type":"<one template id>","summary":"<one or two plain sentences on what the document is for and why these sections fit this audience>","sections":[{"heading":"...","key":"<library key or null>","guidance":"<one sentence on what the section will say>"}]}. Use 5 to 12 sections in reading order. Use a library key whenever a section matches one. Use null for a section that has to be written from the brief.`;
    if (meter) { const stop = await meter.before(); if (stop) return null; }
    const r = await callClaude({ system, user, max_tokens: 1800 });
    if (meter) await meter.after('document planning', r);
    const a = r.text.indexOf('{'), z = r.text.lastIndexOf('}');
    if (a < 0 || z < a) return null;
    const j = JSON.parse(r.text.slice(a, z + 1));
    const sections = cleanSections(j.sections);
    if (sections.length < 3) return null;
    return { base_type: R.DEFAULTS[j.base_type] ? j.base_type : null, summary: cleanName(j.summary, 500), sections };
  }
  on('POST', '/api/projects/(\\d+)/doc-plan', async (m, q, b) => {
    const P = P_(m[1]);
    const inp = { name: cleanName(b.name, 120), audience: cleanName(b.audience, 160), description: cleanName(b.description, 1200) };
    if (!inp.name) throw err(400, 'Give the document a name');
    if (!inp.audience) throw err(400, 'Say who the document is for');
    if (inp.description.length < 10) throw err(400, 'Describe what the document is for in a sentence or two');
    const plan = R.suggestPlan(inp);
    let ai = null;
    try { ai = await aiPlan(P, inp); } catch (e) { console.error('Document plan by Claude failed:', e.message); }
    if (ai) { plan.sections = ai.sections; plan.summary = ai.summary; plan.engine = 'claude'; if (ai.base_type) { plan.base_type = ai.base_type; plan.base_title = R.DEFAULTS[ai.base_type].title; } }
    return { plan };
  });

  // Overall progress recorded by the daily snapshots 7 to 14 days before the report date. No row means no figure.
  async function lastWeekOf(P, today) {
    try {
      const rows = await snapshots.range([P.id], dstr(dnum(today) - 14), dstr(dnum(today) - 7));
      const row = rows[rows.length - 1];
      return row && row.figures && row.figures.progress != null ? { date: row.date, progress: row.figures.progress } : null;
    } catch (e) { return null; }
  }

  on('POST', '/api/projects/(\\d+)/generate', async (m, q, b) => {
    const P = P_(m[1]);
    let cu = null;
    if (b.custom) {
      cu = { name: cleanName(b.custom.name, 120), audience: cleanName(b.custom.audience, 160), description: cleanName(b.custom.description, 1200), sections: cleanSections(b.custom.sections) };
      if (!cu.name) throw err(400, 'Give the document a name');
      if (!cu.sections.length) throw err(400, 'Choose at least one section');
    }
    const def = R.DEFAULTS[b.type]; if (!def) throw err(400, 'Choose a document type');
    if (def.closure) {
      const sc = closureScope(P);
      if (sc.counts.open) throw err(400, `Close or mark as not delivered the ${sc.counts.open} deliverable${sc.counts.open === 1 ? '' : 's'} and requirement${sc.counts.open === 1 ? '' : 's'} still open before writing this document`);
    }
    // The one slide status report is a single PowerPoint slide, so it has no other format.
    const format = def.oneSlide && !cu ? 'pptx' : FORMATS.includes(b.format) ? b.format : 'docx';
    const tpl = !cu && b.template_id ? DB.templates.find((t) => t.id === Number(b.template_id) && (modeOf(t) === 'design' || t.doc_type === '*' || t.doc_type === b.type)) : null;
    if (!cu && b.template_id && !tpl) throw err(404, 'Template not found');
    if (!folderOk(P, b.folder_id)) throw err(404, 'Folder not found');
    const today = b.as_of && /^\d{4}-\d{2}-\d{2}$/.test(b.as_of) ? b.as_of : TODAY();
    const periodDays = Number(b.period_days) || def.period || 7;
    const snap = snapshot(P, b.type, today, periodDays, def.oneSlide && !cu ? await lastWeekOf(P, today) : null);
    const out = await R.generate(cu
      ? { type: b.type, templateName: 'Custom document', ctx: snap.ctx, useAI: true, sections: cu.sections, title: cu.name, brief: `Audience: ${cu.audience}. ${cu.description}` }
      : { type: b.type, templateBody: tpl && usesStructure(tpl) && R.parseTemplate(tpl.body || '').length ? tpl.body : null, templateName: tpl ? tpl.name : null, ctx: snap.ctx, useAI: false });
    const g = { id: nid(), project_id: P.id, doc_type: b.type, title: cleanName(b.title, 120) || out.title, template: out.template, content: out.markdown, created_at: nowTs(), format, folder_id: b.folder_id ? Number(b.folder_id) : null, meta: { ...docMeta(P, today), ...(cu ? { audience: cu.audience } : {}) }, ...(tpl && usesDesign(tpl) && tpl.layout ? { layout: tpl.layout } : {}), ...(tpl && usesDesign(tpl) && tpl.brand ? { brand: clone(tpl.brand) } : {}), visuals: snap.visuals };
    if (cu) g.custom = { audience: cu.audience, description: cu.description };
    if (def.closure && !cu) g.closure_stamp = stampOf(P, b.type);
    // A draft is built the same way but not filed. The Thinking Area keeps it on its card until the manager saves it to the project.
    if (b.draft === true) return { generated: clone(g), engine: out.engine, unconfirmed: snap.ctx.unconfirmed, draft: true };
    P.generated.unshift(g);
    audit(P, ACTOR(), 'document_generated', { summary: `Generated ${g.title}${tpl ? ` from template "${tpl.name}"` : cu ? ' as a custom document' : ''}` });
    return { generated: clone(g), engine: out.engine, unconfirmed: snap.ctx.unconfirmed };
  });

  // ---------- portfolio documents: a document that covers several projects and belongs to none ----------
  // The facts come from the same figures the dashboards and the daily snapshots use. The document is returned, never filed,
  // because it has no project to be filed in. The Thinking Area keeps it on its card.
  const fmtMoney = (v, cur) => (v == null || v === '' ? 'n/a' : `${Number(v).toLocaleString('en-US')}${cur ? ' ' + cur : ''}`);
  function portfolioFacts(live) {
    const rows = live.slice(0, 40).map((P) => ({ P, f: snapshotFigures(P) }));
    const head = '| Project | Client | Status | Health | Progress | Planned | SPI | Open overdue tasks | High risks | Forecast end | Contract end | Slip days | Late payments |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
    const cell = (v) => String(v == null ? '' : v).replace(/[|\r\n]+/g, ' ').trim();
    const line = ({ P, f }) => `| ${cell(P.p.name)} | ${cell(P.p.client)} | ${P.p.status || ''} | ${f.health} | ${f.progress}% | ${f.planned != null ? f.planned + '%' : 'n/a'} | ${f.spi != null ? f.spi : 'n/a'} | ${f.overdue} | ${f.high_risks} | ${f.forecast_end || 'n/a'} | ${f.contract_end || 'n/a'} | ${f.slip_days != null ? f.slip_days : 'n/a'} | ${f.pay.late} |`;
    const table = [head, ...rows.map(line)].join('\n');
    const dash = dashboard({});
    const lines = [`Date: ${TODAY()}`, `Projects in the portfolio: ${live.length}${live.length > rows.length ? ` (the ${rows.length} newest are listed)` : ''}`, `Health: ${dash.counts.green} green, ${dash.counts.amber} amber, ${dash.counts.red} red`, `Waiting for review: ${dash.pendingItems} items and ${dash.pendingInbox} updates`];
    const totals = Object.entries(dash.totalValue || {}).map(([c, v]) => fmtMoney(v, c));
    if (totals.length) lines.push(`Contract value by currency: ${totals.join(', ')}`);
    const late = (dash.payments_all || []).filter((x) => x.late).slice(0, 12).map((x) => `- ${cell(x.project)}: ${cell(x.title)}, due ${x.due}, ${fmtMoney(x.amount, x.currency)}`);
    const over = (dash.overdue_all || []).slice(0, 12).map((x) => `- ${cell(x.project)}: ${cell(x.task)}, finish ${x.finish}, ${x.progress || 0}% done${x.assignee ? ', ' + x.assignee : ''}`);
    return { table, summary: lines.join('\n'), late, over, count: live.length };
  }
  async function portfolioSection(facts, name, audience, brief, s) {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    const system = 'You write sections of professional portfolio reports for project managers in US English. Use only the supplied facts. Do not invent figures, dates or names. Do not do your own arithmetic, quote the figures as given. Write concise, specific, plain prose. Use markdown tables or bullets where they help. Do not use dashes as punctuation and do not use semicolons. Output only the section body, no heading.';
    const user = `Document: ${name}\nAudience: ${audience}\n${brief ? `Brief from the project manager:\n${brief}\n` : ''}Section: ${s.heading}\n${s.guidance ? `What the section must cover: ${s.guidance}\n` : ''}\nPortfolio facts:\n${facts.summary}\n\nProjects:\n${facts.table}\n\nOverdue tasks:\n${facts.over.join('\n') || '(none)'}\n\nLate payments:\n${facts.late.join('\n') || '(none)'}`;
    try {
      if (meter) { const stop = await meter.before(); if (stop) return null; }
      const r = await callClaude({ system, user, max_tokens: 1500 });
      if (meter) await meter.after('portfolio document', r);
      return r.text && r.text.trim() ? r.text.trim() : null;
    } catch (e) { console.error('Portfolio section by Claude failed:', e.message); return null; }
  }
  on('POST', '/api/portfolio/generate', async (m, q, b) => {
    const c = b.custom || {};
    const cu = { name: cleanName(c.name, 120), audience: cleanName(c.audience, 160), description: cleanName(c.description, 1200), sections: cleanSections(c.sections) };
    if (!cu.name) throw err(400, 'Give the document a name');
    if (!cu.sections.length) throw err(400, 'Choose at least one section');
    const live = DB.order.map((id) => DB.projects[id]).filter((P) => P && isLive(P)).reverse();
    if (!live.length) throw err(400, 'Create a project first. A portfolio document is written from your projects.');
    const format = FORMATS.includes(b.format) ? b.format : 'docx';
    const facts = portfolioFacts(live);
    const parts = new Array(cu.sections.length);
    let next = 0;
    const worker = async () => {
      while (next < cu.sections.length) {
        const i = next++; const s = cu.sections[i];
        const body = await portfolioSection(facts, cu.name, cu.audience, cu.description, s);
        parts[i] = `# ${s.heading}\n\n${body || `${s.guidance ? `_${s.guidance}_\n\n` : ''}${i === 0 ? facts.table : '_To be completed by the project manager._'}`}`;
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    const today = TODAY();
    const g = { id: nid(), project_id: null, doc_type: 'pm_plan', title: cu.name, template: 'Custom document', content: parts.join('\n\n'), created_at: nowTs(), format, folder_id: null, meta: { client: '', project: 'Portfolio', code: '', date: today, pm: DB.user.name, currency: '', client_logo: null, audience: cu.audience }, visuals: null, custom: { audience: cu.audience, description: cu.description }, portfolio: true };
    return { generated: clone(g), engine: process.env.ANTHROPIC_API_KEY ? 'claude' : 'rules', draft: true };
  });
  on('GET', '/api/projects/(\\d+)/generated', async (m, q) => paged(P_(m[1]).generated, q, 'generated', gSummary));
  const findGen = (id) => { for (const k of DB.order) { const P = DB.projects[k]; const g = P && P.generated.find((x) => x.id === Number(id)); if (g) { need(P, ctx().level); touch(P); return [P, g]; } } throw err(404, 'Not found'); };
  on('GET', '/api/generated/(\\d+)', async (m) => { const [P, g] = findGen(m[1]); return { generated: clone(complete(P, g)) }; });
  on('PUT', '/api/generated/(\\d+)', async (m, q, b) => {
    const [P, g] = findGen(m[1]);
    if (b.title != null) { const v = cleanName(b.title, 120); if (!v) throw err(400, 'Give the document a name'); g.title = v; }
    if (b.content != null) g.content = String(b.content).slice(0, 400000);
    if ('layout' in b) { const lay = cleanLayout(b.layout); if (lay) g.layout = lay; else delete g.layout; }
    if ('folder_id' in b) { if (!folderOk(P, b.folder_id)) throw err(404, 'Folder not found'); g.folder_id = b.folder_id == null || b.folder_id === '' ? null : Number(b.folder_id); }
    return { generated: gSummary(g) };
  });
  on('DELETE', '/api/generated/(\\d+)', async (m) => { const [P, g] = findGen(m[1]); P.generated = P.generated.filter((x) => x !== g); return { ok: true }; });

  // ---------- folders for generated documents ----------
  const folderRow = (P, f) => ({ id: f.id, name: f.name, created_at: f.created_at, count: P.generated.filter((g) => g.folder_id === f.id).length });
  const folderName = (P, v, selfId) => {
    const n = cleanName(v, 60);
    if (!n) throw err(400, 'Give the folder a name');
    if (P.folders.some((f) => f.id !== selfId && f.name.toLowerCase() === n.toLowerCase())) throw err(409, 'A folder with this name already exists');
    return n;
  };
  on('GET', '/api/projects/(\\d+)/folders', async (m) => { const P = P_(m[1]); return { folders: P.folders.map((f) => folderRow(P, f)) }; });
  on('POST', '/api/projects/(\\d+)/folders', async (m, q, b) => {
    const P = P_(m[1]);
    const f = { id: b.id && !P.folders.some((x) => x.id === Number(b.id)) ? Number(b.id) : nid(), name: folderName(P, b.name), created_at: nowTs() };
    P.folders.push(f);
    return { folder: folderRow(P, f) };
  });
  on('PUT', '/api/folders/(\\d+)', async (m, q, b) => {
    for (const k of DB.order) { const P = DB.projects[k]; const f = P && P.folders && P.folders.find((x) => x.id === Number(m[1])); if (f) { need(P, ctx().level); touch(P); f.name = folderName(P, b.name, f.id); return { folder: folderRow(P, f) }; } }
    throw err(404, 'Folder not found');
  });
  // Documents in a deleted folder move to Unfiled. They are never deleted.
  on('DELETE', '/api/folders/(\\d+)', async (m) => {
    for (const k of DB.order) { const P = DB.projects[k]; const f = P && P.folders && P.folders.find((x) => x.id === Number(m[1])); if (f) { need(P, ctx().level); touch(P); const moved = P.generated.filter((g) => g.folder_id === f.id).map((g) => g.id); P.generated.forEach((g) => { if (g.folder_id === f.id) g.folder_id = null; }); P.folders = P.folders.filter((x) => x !== f); return { ok: true, moved }; } }
    throw err(404, 'Folder not found');
  });
  on('GET', '/api/projects/(\\d+)/audit', async (m, q) => paged(P_(m[1]).audit.slice(0, 200), q, 'audit', clone));


  // ---------- members ----------
  const memberView = (m) => ({ user_id: m.user_id, name: m.name, email: m.email, role: m.role });
  on('GET', '/api/projects/(\\d+)/members', async (m) => { const P = P_(m[1]); return { members: (await store.members(P.id)).map(memberView), role: roleOf(P) }; });
  on('POST', '/api/projects/(\\d+)/members', async (m, q, b) => {
    const P = P_(m[1], 'manager');
    const u = await store.userByEmail(b.email);
    if (!u) throw err(404, 'No account found for this email. Ask them to create an account first.');
    if (await store.roleOf(P.id, u.id)) throw err(409, 'That person is already on this project');
    await store.setMember(P.id, u.id, b.role || 'editor');
    audit(P, ACTOR(), 'member_added', { summary: `Added ${u.name} as ${b.role || 'editor'}` });
    return { members: (await store.members(P.id)).map(memberView) };
  });
  on('PUT', '/api/projects/(\\d+)/members/(\\d+)', async (m, q, b) => {
    const P = P_(m[1], 'manager');
    if (!(await store.roleOf(P.id, Number(m[2])))) throw err(404, 'That person is not on this project');
    await store.setMember(P.id, Number(m[2]), b.role);
    audit(P, ACTOR(), 'member_role_changed', { summary: `Changed a member role to ${b.role}` });
    return { members: (await store.members(P.id)).map(memberView) };
  });
  on('DELETE', '/api/projects/(\\d+)/members/(\\d+)', async (m) => {
    const P = P_(m[1], Number(m[2]) === ctx().user.id ? 'viewer' : 'manager'); // anyone may leave a project
    await store.removeMember(P.id, Number(m[2]));
    return { members: (await store.members(P.id)).map(memberView) };
  });

  // ---------- organizations (Team plan, behind org_features) ----------
  const O = () => ops.orgs, UID = () => ctx().user.id, app_programs = () => ops.programs;
  on('GET', '/api/orgs', async () => ({ organizations: await O().list(UID()), invites: await O().myInvites(UID()) }));
  on('POST', '/api/orgs', async (m, q, b) => O().create(UID(), b && b.name));
  on('POST', '/api/orgs/convert', async (m, q, b) => O().convert(UID(), b && b.name));
  on('POST', '/api/orgs/invites/(\\d+)/accept', async (m) => O().accept(UID(), m[1]));
  on('GET', '/api/orgs/(\\d+)', async (m) => O().overview(UID(), m[1]));
  on('PUT', '/api/orgs/(\\d+)', async (m, q, b) => { await O().rename(UID(), m[1], b && b.name); return O().overview(UID(), m[1]); });
  on('PUT', '/api/orgs/(\\d+)/seats', async (m, q, b) => O().setSeats(UID(), m[1], b && b.seats));
  on('PUT', '/api/orgs/(\\d+)/overage', async (m, q, b) => O().setOverage(UID(), m[1], b && b.policy, b && b.cap_units));
  on('GET', '/api/orgs/(\\d+)/members', async (m) => O().members(UID(), m[1]));
  on('POST', '/api/orgs/(\\d+)/invites', async (m, q, b) => O().invite(UID(), m[1], b && b.email, b && b.role, b && b.program_id));
  on('DELETE', '/api/orgs/(\\d+)/invites/(\\d+)', async (m) => { await O().revoke(UID(), m[1], m[2]); return { ok: true }; });
  on('PUT', '/api/orgs/(\\d+)/members/(\\d+)', async (m, q, b) => { await O().changeRole(UID(), m[1], Number(m[2]), b && b.role); return O().members(UID(), m[1]); });
  on('DELETE', '/api/orgs/(\\d+)/members/(\\d+)', async (m) => O().remove(UID(), m[1], Number(m[2])));
  on('GET', '/api/orgs/(\\d+)/handovers', async (m) => ({ handovers: await O().queue(UID(), m[1]) }));
  on('POST', '/api/orgs/(\\d+)/handovers/(\\d+)/transfer', async (m, q, b) => O().transfer(UID(), m[1], m[2], b && b.user_id));
  const PG = () => app_programs();
  on('GET', '/api/orgs/(\\d+)/programs', async (m) => ({ programs: await PG().list(UID(), m[1]) }));
  on('POST', '/api/orgs/(\\d+)/programs', async (m, q, b) => PG().create(UID(), m[1], b && b.name));
  on('PUT', '/api/orgs/(\\d+)/programs/(\\d+)', async (m, q, b) => { await PG().rename(UID(), m[1], m[2], b && b.name); return { ok: true }; });
  on('DELETE', '/api/orgs/(\\d+)/programs/(\\d+)', async (m) => { await PG().archive(UID(), m[1], m[2]); return { ok: true }; });
  on('GET', '/api/orgs/(\\d+)/projects', async (m) => ({ projects: await PG().projects(UID(), m[1]) }));
  on('GET', '/api/orgs/(\\d+)/programs/(\\d+)/dashboard', async (m) => PG().dashboard(UID(), m[1], m[2]));
  on('PUT', '/api/orgs/(\\d+)/projects/(\\d+)/program', async (m, q, b) => PG().assign(UID(), m[1], m[2], b && b.program_id != null ? b.program_id : null));
  on('POST', '/api/orgs/(\\d+)/members/(\\d+)/grants', async (m, q, b) => { await PG().grant(UID(), m[1], Number(m[2]), b && b.role, b && b.program_id); return O().members(UID(), m[1]); });
  on('DELETE', '/api/orgs/(\\d+)/members/(\\d+)/grants', async (m, q, b) => { await PG().revoke(UID(), m[1], Number(m[2]), q.role, q.program_id); return O().members(UID(), m[1]); });
  on('POST', '/api/projects/(\\d+)/move', async (m, q, b) => { P_(m[1], 'manager'); return O().moveProject(UID(), Number(m[1]), b && b.organization_id); });

  // ---------- sample projects ----------
  on('POST', '/api/workspace/sample', async () => {
    if (DB.user.sample_loaded) throw err(409, 'The sample projects are already in your workspace');
    const made = [seedFirst(DB.user.id), ...seedPortfolio(DB.user.id)];
    const created = [];
    for (const P of made) {
      const oldId = P.id, id = nid();
      P.id = id; P.p.id = id;
      for (const k of ['items', 'resources', 'inbox', 'audit', 'documents', 'generated']) for (const r of P[k] || []) if (r && r.project_id === oldId) r.project_id = id;
      await store.create(P, DB.user.id);
      DB.projects[id] = P; DB.order.push(id); ctx().roles[id] = 'manager';
      created.push(id);
    }
    DB.user.sample_loaded = true; await saveUser();
    return { projects: created.length };
  });

  // ---------- export and import ----------
  on('GET', '/api/projects/(\\d+)/export', async (m, q) => {
    const P = P_(m[1]);
    const files = q.files === '1' ? await store.filesOf(P.id) : [];
    const out = exporter.projectBackup(P, { files, by: DB.user.email, snapshots: await snapshots.all(P.id) });
    return new FileResult(Buffer.from(JSON.stringify(out)), 'application/json', `${safeName(P.p.name)}.pmai.json`);
  });
  on('GET', '/api/workspace/export', async () => {
    // One project at a time: each backup is turned into text and let go before the next one is made.
    const mine = DB.order.filter((id) => RANK[roleOf(DB.projects[id])] >= RANK.editor).map((id) => DB.projects[id]), by = DB.user.email, templates = DB.templates; // read now, while the request is still running
    async function* parts() {
      yield `{"format":"pmai-workspace","version":${JSON.stringify(exporter.VERSION)},"exported_at":${JSON.stringify(new Date().toISOString())},"projects":[`;
      let first = true;
      for (const P of mine) {
        yield (first ? '' : ',') + exporter.projectBackupJson(P, { by, snapshots: await snapshots.all(P.id) });
        first = false;
      }
      yield `],"templates":${JSON.stringify(templates === undefined ? null : templates)}}`;
    }
    return new StreamResult(parts, 'application/json', 'project-manager-ai-workspace.pmai.json');
  });
  async function importOne(backup) {
    const checked = importer.prepare(backup, nid, { S });
    const P = checked.P;
    const clash = DB.order.some((id) => DB.projects[id].p.name === P.p.name);
    if (clash) P.p.name = `${P.p.name} (imported)`;
    P.p.owner_id = DB.user.id; P.p.status = P.p.status === 'archived' || P.p.status === 'closed' ? P.p.status : 'active'; P.p.analyzing = 0; P.analysis = null;
    await store.create(P, DB.user.id);
    await snapshots.restore(P.id, checked.snapshots);
    for (const f of checked.files) { const d = P.documents.find((x) => x.id === f.doc_id); if (d) await store.putFile(P.id, d.id, { name: f.filename, type: f.mime, buffer: f.buffer }); }
    DB.projects[P.id] = P; DB.order.push(P.id); ctx().roles[P.id] = 'manager';
    audit(P, ACTOR(), 'project_imported', { summary: `Imported from a backup made ${checked.exported_at || 'earlier'}` });
    touch(P);
    return { id: P.id, name: P.p.name, tasks: P.tasks.length, items: P.items.length, documents: P.documents.length, warnings: checked.warnings };
  }
  on('POST', '/api/projects/import', async (m, q, b) => {
    let data = b;
    if (b && typeof b.get === 'function') { const f = b.get('file'); if (!f || !f.name) throw err(400, 'Choose a backup file to import'); try { data = JSON.parse(f.buffer.toString('utf8')); } catch (e) { throw err(400, 'This file is not a valid backup. It could not be read as JSON.'); } }
    if (data && data.format === 'pmai-workspace') {
      if (!Array.isArray(data.projects) || !data.projects.length) throw err(400, 'The workspace backup has no projects');
      if (data.projects.length > 200) throw err(400, 'The workspace backup has too many projects');
      const results = [];
      for (const one of data.projects) results.push(await importOne(one));
      if (Array.isArray(data.templates)) for (const t of data.templates.slice(0, 100)) if (t && t.name && (t.doc_type === '*' || RAW.skeletons[t.doc_type]) && typeof t.body === 'string') DB.templates.push({ id: nid(), owner_id: DB.user.id, doc_type: t.doc_type, ...(MODES.includes(t.mode) ? { mode: t.mode } : {}), name: String(t.name).slice(0, 120), body: t.body, created_at: nowTs(), ...(t.layout ? (() => { try { return { layout: cleanLayout(t.layout) }; } catch (e) { return {}; } })() : {}), ...(t.brand ? (() => { try { return { brand: brandLib.cleanBrand(t.brand) }; } catch (e) { return {}; } })() : {}) });
      await saveUser();
      return { imported: results };
    }
    return { imported: [await importOne(data)] };
  });
  const safeName = (n) => String(n || 'project').replace(/[^\w .-]+/g, '_').trim().slice(0, 80) || 'project';
  on('GET', '/api/projects/(\\d+)/schedule/export', async (m, q) => {
    const P = P_(m[1]);
    const computed = S.schedule(P.tasks, rawProject(P));
    const fmt = q.format === 'csv' ? 'csv' : 'xlsx';
    const buf = fmt === 'csv' ? exporter.scheduleCsv(P, computed) : exporter.scheduleXlsx(P, computed);
    return new FileResult(buf, fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${safeName(P.p.name)} schedule.${fmt}`);
  });
  on('GET', '/api/generated/(\\d+)/(docx|xlsx|pptx|md)', async (m) => {
    const [P, g] = findGen(m[1]);
    const { buffer, type } = await exporter.report(g, P, m[2]);
    return new FileResult(buffer, type, `${safeName(g.title || 'report')}.${m[2]}`);
  });
  on('GET', '/api/projects/(\\d+)/documents/(\\d+)/file', async (m) => {
    const P = P_(m[1]);
    const d = P.documents.find((x) => x.id === Number(m[2]));
    if (!d) throw err(404, 'Document not found');
    const f = await store.getFile(P.id, d.id);
    if (f) return new FileResult(f.buffer, filesig.safeType(d.filename), d.filename);
    // files added before originals were kept still have their text
    return new FileResult(Buffer.from(P.texts[d.id] || '', 'utf8'), 'text/plain; charset=utf-8', `${d.filename}.txt`);
  });

  // ---------- meetings ----------
  // A meeting belongs to one project and follows that project's roles: editors and managers capture and change,
  // viewers only read. The work itself (transcription, minutes) is in server/meetings.js.
  const meetings = new Meetings(store.db, store, ops);
  const live = new LiveHub(meetings, ops);
  const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const meetingCtx = (P) => ({
    today: TODAY(),
    project: { name: P.p.name, client: P.p.client || '' },
    people: P.resources.map((r) => r.name).slice(0, 60),
    tasks: P.tasks.filter((t) => (t.progress || 0) < 100 && !P.tasks.some((c) => c.parent_id === t.id)).slice(0, 120).map((t) => ({ id: t.id, name: t.name, assignee: t.assignee || null, progress: t.progress || 0 })),
  });
  const MT = async (id, level) => { const r = await meetings.row(id); if (!r) throw err(404, 'Meeting not found'); const P = P_(r.project_id, level); return [P, r]; };
  const meetingBusy = (r) => meetings.running.has(r.id) || ['transcribing', 'summarizing'].includes(r.status);
  const meetingStatus = () => ({ ...stt.status(), claude: !!process.env.ANTHROPIC_API_KEY, live: live.available() });
  // keeps the "sent to the project" marks of a meeting in step when its rows are applied or undone in the Updates inbox
  async function meetingInboxSync(r, how) {
    const m = /^meeting:(\d+):([a-z]\d+):(log|task|update)$/.exec(r.ext_id || '');
    if (!m) return;
    try {
      if (how === 'undo') await meetings.clearApplied(Number(m[1]), m[2], m[3]);
      else await meetings.markApplied(Number(m[1]), m[2], { [m[3]]: { inbox_id: r.id, pending: false } });
    } catch (e) { console.error('meeting sync', e.message); }
  }
  on('GET', '/api/projects/(\\d+)/meetings', async (m, q) => { const P = P_(m[1]); return { ...(await meetings.page(P.id, q)), stt: meetingStatus(), attendees: P.resources.map((r) => ({ name: r.name, email: r.email || null, role: r.role || null })) }; });
  // A transcript or minutes file (Word, PDF, text, or Teams and Zoom caption files) becomes a meeting with minutes.
  on('POST', '/api/projects/(\\d+)/meetings/document', async (m, q, b) => {
    const P = P_(m[1]);
    const f = b && typeof b.get === 'function' ? b.get('file') : null;
    if (!f || !f.buffer || !f.buffer.length) throw err(400, 'Choose a transcript or minutes file');
    const name = f.name || 'meeting.txt';
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    let text;
    if (['.vtt', '.srt'].includes(ext)) { if (f.buffer.subarray(0, 8192).includes(0)) throw err(415, `${name.slice(0, 80)} is not a text file.`); text = f.buffer.toString('utf8'); }
    else { assertUploadable([{ name, buffer: f.buffer }], '/api/meetings/document'); text = (await extractText(f.buffer, name)).text; }
    const raw = meetings.parseDocument(text, { name, as: b.get('kind') });
    let attendees = []; try { attendees = JSON.parse(b.get('attendees') || '[]'); } catch { attendees = [b.get('attendees')]; }
    const title = txt(b.get('title'), 140) || name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    const stop = await ops.allowance(ctx().user); if (stop) throw err(402, stop);
    const id = await meetings.create({ projectId: P.id, ownerId: ctx().user.id, title, meeting_at: b.get('meeting_at') || undefined, attendees, language: b.get('language'), minutes_lang: b.get('minutes_lang'), source: 'document', notes: b.get('notes') });
    await meetings.setTranscript(id, raw, true);
    await meetings.setStatus(id, 'summarizing', 'Writing the minutes');
    meetings.start(id, { userId: ctx().user.id, user: ctx().user, ctx: meetingCtx(P), from: 'transcript' });
    audit(P, ACTOR(), 'meeting_added', { summary: `Added meeting "${title}" from ${name}` });
    return { meeting: await meetings.get(id) };
  });
  on('POST', '/api/projects/(\\d+)/meetings', async (m, q, b) => {
    const P = P_(m[1]);
    const source = ['recording', 'upload', 'text', 'document'].includes(b.source) ? b.source : 'upload';
    const raw = source === 'text' ? meetings.parseText(b.transcript_text) : null;
    const id = await meetings.create({ projectId: P.id, ownerId: ctx().user.id, title: b.title, meeting_at: b.meeting_at, attendees: b.attendees, language: b.language, minutes_lang: b.minutes_lang, source, notes: b.notes });
    if (raw) {
      const stop = await ops.allowance(ctx().user); if (stop) throw err(402, stop);
      await meetings.setTranscript(id, raw, true);
      await meetings.setStatus(id, 'summarizing', 'Writing the minutes');
      meetings.start(id, { userId: ctx().user.id, user: ctx().user, ctx: meetingCtx(P), from: 'transcript' });
    }
    audit(P, ACTOR(), 'meeting_added', { summary: `Added meeting "${txt(b.title, 140)}"` });
    return { meeting: await meetings.get(id) };
  });
  on('GET', '/api/meetings/(\\d+)', async (m) => {
    const [P, r] = await MT(m[1]);
    return { meeting: meetings.view(r, true), project: { id: P.id, name: P.p.name }, has_audio: await meetings.hasAudio(r.id), stt: meetingStatus(), attendees: P.resources.map((x) => ({ name: x.name, email: x.email || null, role: x.role || null })) };
  });
  on('PUT', '/api/meetings/(\\d+)', async (m, q, b) => { const [, r] = await MT(m[1]); await meetings.update(r.id, b); return { meeting: await meetings.get(r.id) }; });
  on('DELETE', '/api/meetings/(\\d+)', async (m) => { const [P, r] = await MT(m[1]); live.stopNow(r.id); if (meetingBusy(r)) throw err(409, 'Wait until this meeting has finished processing'); await meetings.remove(r.id); audit(P, ACTOR(), 'meeting_deleted', { summary: `Deleted meeting "${r.title}"` }); return { ok: true }; });
  on('POST', '/api/meetings/(\\d+)/audio', async (m, q, b) => {
    const [P, r] = await MT(m[1]);
    if (!stt.configured()) throw err(503, 'GEMINI_API_KEY is not set on the server. Add it to the server settings, then try again.');
    const f = b && typeof b.get === 'function' ? b.get('file') : null;
    if (!f || !f.buffer || !f.buffer.length) throw err(400, 'Choose a recording');
    if (!stt.cleanMime(f.type, f.name)) throw err(400, 'This file type cannot be transcribed. Use MP3, WAV, M4A, AAC, OGG, FLAC or WebM audio.');
    if (meetingBusy(r)) throw err(409, 'This meeting is already being processed');
    const stop = await ops.allowance(ctx().user); if (stop) throw err(402, stop);
    const dur = b.get('duration_sec'); if (dur) await meetings.update(r.id, { duration_sec: dur });
    await meetings.saveAudio(r.id, f);
    await meetings.setStatus(r.id, 'uploaded', 'Recording received');
    meetings.start(r.id, { userId: ctx().user.id, user: ctx().user, ctx: meetingCtx(P), from: 'audio' });
    return { meeting: await meetings.get(r.id) };
  });
  // Live transcription: the browser streams 16 kHz mono PCM here and polls for new lines.
  on('POST', '/api/meetings/(\\d+)/live', async (m, q, b) => {
    const [P, r] = await MT(m[1]);
    if (meetingBusy(r)) throw err(409, 'This meeting is already being processed');
    if (!live.available()) throw err(503, 'Live transcription is not available on this server. The recording can still be transcribed after the meeting.');
    const stop = await ops.allowance(ctx().user); if (stop) throw err(402, stop);
    const c = meetingCtx(P);
    return { live: live.start(r.id, { userId: ctx().user.id, projectId: P.id, language: r.language, vocabulary: [c.project.name, c.project.client, ...(r.attendees || []).map((x) => x.name), ...c.people] }) };
  });
  on('POST', '/api/meetings/(\\d+)/live/audio', async (m, q, b) => {
    const [, r] = await MT(m[1]);
    const raw = typeof (b && b.pcm) === 'string' ? Buffer.from(b.pcm, 'base64') : null;
    if (!raw || !raw.length || raw.length > 400000) throw err(400, 'Send a short chunk of audio');
    const v = live.push(r.id, raw);
    if (!v) throw err(409, 'Live transcription is not running for this meeting');
    return { live: v };
  });
  on('GET', '/api/meetings/(\\d+)/live', async (m, q) => { const [, r] = await MT(m[1]); return { live: live.poll(r.id, q.after) }; });
  on('POST', '/api/meetings/(\\d+)/live/stop', async (m) => { const [, r] = await MT(m[1]); return { live: await live.stop(r.id) }; });
  on('POST', '/api/meetings/(\\d+)/retry', async (m) => {
    const [P, r] = await MT(m[1]);
    if (meetingBusy(r)) throw err(409, 'This meeting is already being processed');
    const from = (await meetings.hasAudio(r.id)) ? 'audio' : (r.transcript || []).length ? 'transcript' : null;
    if (!from) throw err(400, 'There is nothing to retry. Upload the recording again.');
    if (from === 'audio' && !stt.configured()) throw err(503, 'GEMINI_API_KEY is not set on the server. Add it to the server settings, then try again.');
    const stop = await ops.allowance(ctx().user); if (stop) throw err(402, stop);
    await meetings.setStatus(r.id, from === 'audio' ? 'uploaded' : 'summarizing', from === 'audio' ? 'Recording received' : 'Writing the minutes');
    meetings.start(r.id, { userId: ctx().user.id, user: ctx().user, ctx: meetingCtx(P), from });
    return { meeting: await meetings.get(r.id) };
  });
  on('POST', '/api/meetings/(\\d+)/speakers', async (m, q, b) => { const [, r] = await MT(m[1]); await meetings.editSpeakers(r.id, b || {}); return { meeting: await meetings.get(r.id) }; });
  on('PUT', '/api/meetings/(\\d+)/segments/(\\d+)', async (m, q, b) => { const [, r] = await MT(m[1]); await meetings.editSegment(r.id, m[2], b || {}); return { meeting: await meetings.get(r.id) }; });
  on('DELETE', '/api/meetings/(\\d+)/segments/(\\d+)', async (m) => { const [, r] = await MT(m[1]); await meetings.deleteSegment(r.id, m[2]); return { meeting: await meetings.get(r.id) }; });
  on('PUT', '/api/meetings/(\\d+)/minutes', async (m, q, b) => { const [P, r] = await MT(m[1]); await meetings.saveMinutes(r.id, b && b.minutes, meetingCtx(P)); return { meeting: await meetings.get(r.id) }; });
  on('POST', '/api/meetings/(\\d+)/regenerate', async (m, q, b) => {
    const [P, r] = await MT(m[1]);
    if (meetingBusy(r)) throw err(409, 'This meeting is already being processed');
    if (!(r.transcript || []).length) throw err(400, 'There is no transcript to write minutes from');
    const stop = await ops.allowance(ctx().user); if (stop) throw err(402, stop);
    const section = b && b.section;
    if (section && MEETING_SECTIONS.includes(section)) {
      if (!r.minutes) throw err(400, 'Write the full minutes first');
      await meetings.writeMinutes(r.id, { userId: ctx().user.id, ctx: meetingCtx(P), section, instructions: b.instructions });
      return { meeting: await meetings.get(r.id) };
    }
    await meetings.setStatus(r.id, 'summarizing', 'Writing the minutes');
    meetings.start(r.id, { userId: ctx().user.id, user: ctx().user, ctx: meetingCtx(P), from: 'transcript', instructions: b && b.instructions });
    return { meeting: await meetings.get(r.id) };
  });
  // Sends reviewed items from the minutes to the project. Each part becomes a row in the Updates inbox with the source
  // "meeting". mode "now" applies it straight away (with Undo in the inbox), mode "inbox" leaves it waiting for review.
  on('POST', '/api/meetings/(\\d+)/apply', async (m, q, b) => {
    const [P, r] = await MT(m[1]);
    const mins = r.minutes; if (!mins) throw err(400, 'There are no minutes yet');
    const list = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
    if (!list.length) throw err(400, 'Choose at least one item');
    const results = [];
    for (const sel of list) {
      const key = txt(sel.id, 12);
      const found = ['actions', 'decisions', 'risks', 'updates'].map((sec) => [sec, (mins[sec] || []).find((x) => x.id === key)]).find((x) => x[1]);
      if (!found) { results.push({ id: key, error: 'This item is no longer in the minutes' }); continue; }
      const [section, it] = found;
      const parts = (Array.isArray(sel.to) && sel.to.length ? sel.to : section === 'updates' ? ['update'] : section === 'actions' ? ['log', 'task'] : ['log']).filter((x) => (section === 'updates' ? x === 'update' : section === 'actions' ? ['log', 'task'].includes(x) : x === 'log'));
      const mode = sel.mode === 'inbox' ? 'inbox' : 'now';
      const owner = txt(sel.owner != null ? sel.owner : it.owner, 80) || null;
      const title = txt(sel.title != null ? sel.title : it.title || it.text, 200);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(sel.due_date || it.due_date || '') ? (sel.due_date || it.due_date) : null;
      const done = {};
      for (const part of parts) {
        if (((r.applied || {})[key] || {})[part]) { results.push({ id: key, part, skipped: 'Already sent to the project' }); continue; }
        let action;
        if (part === 'log' && section === 'actions') action = { type: 'create_item', kind: 'action', title, quote: it.quote, meeting_id: r.id, data: { owner, due_date: due, meeting_id: r.id, meeting_time: it.time || null } };
        else if (part === 'log' && section === 'decisions') action = { type: 'create_item', kind: 'decision', title: title.slice(0, 200), description: it.text, quote: '', meeting_id: r.id, data: { owner, meeting_id: r.id, meeting_time: it.time || null } };
        else if (part === 'log' && section === 'risks') action = { type: 'create_item', kind: 'risk', title, quote: '', meeting_id: r.id, data: { probability: it.probability, impact: it.impact, mitigation: it.mitigation || '', owner, meeting_id: r.id, meeting_time: it.time || null } };
        else if (part === 'task') action = { type: 'create_task', title, assignee: owner ? resolveResource(P, '', owner) : null, due_date: due, note: it.quote ? `Said in the meeting: "${it.quote}"` : '', meeting_id: r.id };
        else if (part === 'update') action = { type: 'update_task', task_id: it.task_id, progress: it.progress, delay_days: it.delay_days, note: it.note };
        else continue;
        try {
          const row = addInbox(P, { source: 'meeting', ext_id: `meeting:${r.id}:${key}:${part}`, sender: r.title, subject: r.title, body: it.quote || it.text || it.title || it.note || title, resource: owner, action, summary: describeAction(P, action), confidence: null });
          if (mode === 'now') {
            const out = applyAction(P, row.action, ACTOR(), null);
            row.status = 'applied'; row.applied_at = nowTs(); row.action = { ...row.action, prev: out.prev, summary: out.summary };
          }
          done[part] = { inbox_id: row.id, pending: mode === 'inbox', summary: row.action.summary || row.summary, item_id: (row.action.prev || {}).created_item || null, task_id: (row.action.prev || {}).created_task || null };
          results.push({ id: key, part, ok: true, mode });
        } catch (e) { results.push({ id: key, part, error: e.expose || e.status < 500 ? e.message : 'This item could not be sent to the project' }); }
      }
      // an action sent as both a log entry and a task keeps the two linked
      if (done.log && done.task && done.log.item_id && done.task.task_id) {
        const t = P.tasks.find((x) => x.id === done.task.task_id), it2 = P.items.find((x) => x.id === done.log.item_id);
        if (t) t.links = [...(Array.isArray(t.links) ? t.links : []), done.log.item_id];
        if (it2) it2.data = { ...(it2.data || {}), task_id: done.task.task_id };
      }
      if (Object.keys(done).length) await meetings.markApplied(r.id, key, done);
    }
    return { results, meeting: await meetings.get(r.id) };
  });
  on('GET', '/api/meetings/(\\d+)/export', async (m, q) => {
    const [P, r] = await MT(m[1]);
    const full = meetings.view(r, true);
    if (!full.minutes) throw err(400, 'There are no minutes to export yet');
    const withTranscript = q.transcript === '1';
    const base = safeName(`${r.title} minutes`);
    if (q.format === 'md') return new FileResult(meetingExport.markdown(full, P.p.name, withTranscript), 'text/markdown; charset=utf-8', `${base}.md`);
    return new FileResult(await meetingExport.docx(full, P.p.name, withTranscript), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `${base}.docx`);
  });

  // The minutes as a generated document, so the browser builds the Word file with the same design as every other report.
  on('GET', '/api/meetings/(\\d+)/report', async (m, q) => {
    const [P, r] = await MT(m[1]);
    const full = meetings.view(r, true);
    if (!full.minutes) throw err(400, 'There are no minutes to export yet');
    const day = (() => { try { return new Date(r.meeting_at).toLocaleDateString('en-CA', { timeZone: process.env.APP_TZ || 'Asia/Dubai' }); } catch (e) { return TODAY(); } })();
    const g = { id: `minutes-${r.id}`, project_id: P.id, doc_type: 'minutes', type_title: 'Minutes of meeting', title: (full.minutes.title || r.title || 'Minutes of meeting').slice(0, 120), template: null, content: meetingExport.reportMarkdown(full, P.p.name, q.transcript === '1'), created_at: nowTs(), format: 'docx', meta: docMeta(P, day) };
    return { document: g };
  });

  // ---------- analysis progress, polled by the browser ----------
  on('GET', '/api/analysis/events', async (m, q) => {
    const since = Number(q.since) || 0;
    return { events: store.eventsFor(DB.order, since).map((e) => ({ seq: e.seq, ...e.detail })), seq: store.evSeq };
  });

  // ---------- dispatcher ----------
  // A project left "analyzing" by a server restart can never finish, so it is settled with a clear message.
  function settleInterrupted(P) {
    if (running.has(P.id)) return;
    if (!P.p.analyzing && !(P.analysis && !P.analysis.finished)) return;
    P.p.analyzing = 0;
    const run = P.analysis; if (!run) { store.saveSoon(P); return; }
    const message = 'The server restarted while this file was being read. Use Reanalyze to run it again.';
    run.finished = true; run.show_summary = true; run.pct = 100; run.failed = run.failed || { message, detail: 'interrupted' };
    for (const st of run.stages || []) { if (st.status === 'active') { st.status = 'failed'; st.detail = message; } else if (st.status === 'waiting') st.status = 'skipped'; }
    for (const d of run.docs || []) if (d.status === 'waiting' || d.status === 'reading') { d.status = 'failed'; d.progress = ''; d.message = message; }
    store.saveSoon(P);
  }

  const userView = (u) => ({ id: u.id, name: u.name, email: u.email, language: (u.prefs && u.prefs.language) || 'en', theme: (u.prefs && u.prefs.theme) || 'light', avatar: u.avatar || null, ingest_key: (u.prefs && u.prefs.ingest_key) || null, dash_layout: (u.prefs && u.prefs.dash_layout) || null, sample_loaded: !!(u.prefs && u.prefs.sample_loaded), is_super: !!u.is_super, session_expires_at: u.session_expires_at || null });
  async function saveUser() {
    const c = ctx(), u = c.DB.user;
    const prefs = { ...(c.user.prefs || {}), language: u.language, theme: u.theme, dash_layout: u.dash_layout || null, ingest_key: u.ingest_key || null, templates: c.DB.templates, connections: c.DB.connections || {}, sample_loaded: !!u.sample_loaded };
    c.user.prefs = prefs; c.user.name = u.name; c.user.avatar = u.avatar;
    await store.db.query('UPDATE users SET name = $2, avatar = $3, prefs = $4::jsonb WHERE id = $1', [u.id, u.name, u.avatar, JSON.stringify(prefs)]);
  }

  async function makeCtx(user, origin, level, scheduled) {
    const { projects, roles, order } = await store.forUser(user.id);
    for (const id of order) settleInterrupted(projects[id]);
    const prefs = user.prefs || {};
    const view = userView(user);
    if (!view.ingest_key) view.ingest_key = require('crypto').randomBytes(16).toString('hex');
    return { scheduled: !!scheduled, origin: origin || 'http://localhost', user, store, auth, roles, touched: new Set(), level, DB: { user: view, templates: Array.isArray(prefs.templates) ? prefs.templates : [], connections: prefs.connections || {}, projects, order: order.slice() } };
  }
  async function dispatch(c, method, p, query, body) {
    for (const [mth, re, fn] of routes) {
      if (mth !== method) continue;
      const m = p.match(re);
      if (!m) continue;
      c.level = method === 'GET' ? 'viewer' : 'editor';
      return fn(m, query || {}, body == null ? {} : body);
    }
    throw err(404, 'Not found');
  }

  async function handle({ user, method, path: p, query, body, origin, scheduled, ip }) {
    const c = await makeCtx(user, origin, method === 'GET' ? 'viewer' : 'editor', scheduled);
    c.ip = ip || '';
    return als.run(c, async () => {
      const out = await dispatch(c, method, p, query, body);
      // a change is saved before the answer is sent, so "saved" on screen always means saved in the database
      if (method !== 'GET') for (const P of c.touched) if (c.DB.projects[P.id]) await store.save(P);
      return out;
    });
  }

  // The Project Chat works through the same routes and helpers as the screens, as the signed in person. A run that
  // changes data either saves everything or nothing: the touched projects are put back as they were when anything fails.
  const NO_SNAP = new Set(['texts', 'generated', 'documents']);
  // The version history is the largest part of a project and is only ever appended to, except that the newest entry can be
  // updated in place. So it is kept by reference with a copy of the newest entry, not deep cloned on every chat change.
  const snapOf = (P) => {
    const o = {};
    for (const k of Object.keys(P)) if (!k.startsWith('_') && !NO_SNAP.has(k) && k !== 'versions') o[k] = P[k];
    const snap = JSON.parse(JSON.stringify(o));
    if (Array.isArray(P.versions)) { const v = P.versions.slice(); if (v.length) v[v.length - 1] = { ...v[v.length - 1] }; snap.versions = v; }
    return snap;
  };
  function putBack(P, snap) {
    const { versions, ...rest } = snap;
    for (const k of Object.keys(P)) if (!k.startsWith('_') && !NO_SNAP.has(k)) delete P[k];
    Object.assign(P, JSON.parse(JSON.stringify(rest)));
    if (versions) P.versions = versions.slice();
  }
  async function runAs({ user, fn, write = false, origin }) {
    const c = await makeCtx(user, origin, write ? 'editor' : 'viewer');
    return als.run(c, async () => {
      const snaps = new Map();
      const h = {
        user: c.DB.user, roles: c.roles, order: c.DB.order, projects: c.DB.projects, S, TODAY, clone, nid, nowTs, audit, recalc, recordVersion, scheduleResponse, itemView, taskView, rawProject, stats, projectView, ACTOR,
        P(id, level) { const P = P_(id, level || (write ? 'editor' : 'viewer')); if (write && !snaps.has(P)) snaps.set(P, snapOf(P)); return P; },
        call(method, p, body, query) { return dispatch(c, method, p, query, body); },
      };
      try {
        const out = await fn(h);
        if (write) for (const P of c.touched) if (c.DB.projects[P.id]) await store.save(P);
        return out;
      } catch (e) {
        for (const [P, snap] of snaps) putBack(P, snap);
        throw e;
      }
    });
  }

  // Runs every automatic sync that is due, as the person who set it up. Safe to call often.
  const syncing = new Set();
  async function runDueSyncs(now = Date.now()) {
    const rows = (await store.db.query("SELECT id, data->'sync_cfg' AS cfg FROM projects WHERE data->'sync_cfg'->>'mode' IS NOT NULL AND data->'sync_cfg'->>'mode' <> 'off'")).rows;
    let ran = 0;
    for (const r of rows) {
      const cfg = r.cfg || {}, due = nextSync(cfg);
      if (!due || due > now || syncing.has(r.id)) continue;
      syncing.add(r.id);
      try {
        const u = (await store.db.query('SELECT id, name, email, prefs, avatar FROM users WHERE id = $1', [cfg.user_id])).rows[0];
        if (!u) continue;
        const { projects } = await store.forUser(u.id), P = projects[r.id];
        if (!P) continue;
        P.sync_cfg = { ...(P.sync_cfg || cfg), last_run: now };
        await store.save(P);
        await handle({ user: u, method: 'POST', path: `/api/projects/${r.id}/sync`, query: {}, body: {}, scheduled: true });
        ran++;
      } catch (e) { console.error('scheduled sync', r.id, e.message); }
      finally { syncing.delete(r.id); }
    }
    return ran;
  }

  return { handle, stats, runAs, runDueSyncs, FileResult, StreamResult, userView, saveUserFor: null, running, TODAY, captureAll, snapshots };
};
module.exports.FileResult = FileResult;
module.exports.StreamResult = StreamResult;
