/* In-browser stand-in for the Project Manager AI server.
   It answers the same /api routes from memory and reuses the real scheduling engine,
   report generator and rule based document reader, so behavior matches the product. */
(function () {
  'use strict';
  const S = window.__Sched, R = window.__Reports, AI = window.__AI; let Pipe = window.__Pipe;
  // If the analysis module is missing from the page it is loaded when the analysis starts.
  async function ensurePipe() {
    if (window.__Pipe) { Pipe = window.__Pipe; return; }
    await new Promise((ok) => { const sc = document.createElement('script'); sc.src = 'extract2.js?r=' + Date.now(); sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); });
    Pipe = window.__Pipe || null;
  }
  // The demo follows the real calendar: today is the viewer's date, and the sample project dates move with it in whole weeks so working days stay aligned.
  const RAW = window.DEMO_SEED;
  const TODAY = new Date().toLocaleDateString('en-CA');
  const DAYMS = 86400000, dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAYMS;
  const SHIFT = Math.round((dnum(TODAY) - dnum(RAW.today)) / 7) * 7;
  const dstr = (n) => new Date(n * DAYMS).toISOString().slice(0, 10);
  const moveDates = (v) => {
    if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}(?:[ T].{0,13})?$/.test(v) ? dstr(dnum(v) + SHIFT) + v.slice(10) : v;
    if (Array.isArray(v)) return v.map(moveDates);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = k === 'docTexts' || k === 'skeletons' || k === 'templates' ? v[k] : moveDates(v[k]); return o; }
    return v;
  };
  const SEED = moveDates(RAW);
  SEED.today = TODAY;
  window.DEMO_TODAY = TODAY;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let seq = 5000;
  const nid = () => ++seq;
  const nowTs = () => `${TODAY} ${new Date().toTimeString().slice(0, 5)}`;
  const ACTOR = SEED.user.name;
  const err = (status, message) => { const e = new Error(message); e.status = status; return e; };

  const DB = { user: clone(SEED.user), templates: clone(SEED.templates), projects: {}, order: [] };

  // ---------- project containers ----------
  function makeProject(id, p) {
    return { id, p, items: [], tasks: [], resources: [], inbox: [], documents: [], texts: {}, generated: [], audit: [] };
  }
  (function seedFirst() {
    const P = makeProject(1, clone(SEED.project));
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
    DB.projects[1] = P; DB.order.push(1);
  })();


  const P_ = (id) => { const P = DB.projects[Number(id)]; if (!P) throw err(404, 'Project not found'); return P; };
  const rawProject = (P) => ({ ...P.p, work_days: JSON.stringify(P.p.work_days), holidays: JSON.stringify(P.p.holidays) });

  // ---------- five more projects, one per currency ----------
  (function seedPortfolio() {
    window.__Portfolio.build(TODAY).forEach((spec) => {
      const id = nid();
      const P = makeProject(id, { id, owner_id: 1, name: spec.name, code: spec.code, client: spec.client, client_logo: null, currency: spec.currency, value: spec.value, start_date: spec.start, end_date: spec.end, work_days: [1, 2, 3, 4, 5], work_start: '08:00', work_end: '17:00', holidays: [], status: 'active', wizard_done: 1, analyzing: 0, impact_check: 1, auto_apply: 0, auto_threshold: 0.9, jira_key: spec.code || null, sharepoint_url: spec.code ? `https://contoso.sharepoint.com/sites/${String(spec.code).toLowerCase()}` : null, jira_url: spec.code ? `https://contoso.atlassian.net/browse/${spec.code}` : null, teams_channel: null, created_at: `${TODAY} 08:00:00` });
      const ids = {};
      spec.tasks.forEach((t, i) => { ids[t.lid] = nid(); });
      spec.tasks.forEach((t, i) => {
        P.tasks.push({ id: ids[t.lid], parent_id: t.parent ? ids[t.parent] : null, position: i, name: t.name, start: spec.start, duration: t.summary ? 1 : t.duration, progress: t.progress || 0, assignee: t.assignee || null, deps: (t.deps || []).map((d) => ({ id: ids[d], lag: 0 })), deliverable_id: null, b_start: null, b_end: null, notes: null, is_milestone: t.milestone ? 1 : 0, jira_key: null, color: null });
      });
      S.schedule(P.tasks, rawProject(P)).forEach((c) => { const t = P.tasks.find((x) => x.id === c.id); t.start = c.start; t.b_start = c.start; t.b_end = c.finish; });
      P.resources = spec.team.map(([name, role]) => ({ id: nid(), project_id: id, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, role, jira_account: null, teams_name: name }));
      const item = (kind, title, description, data, state) => P.items.push({ id: nid(), project_id: id, kind, title, description, data, status: 'confirmed', state, confidence: 0.9, doc_id: null, quote: '', evidence_doc_id: null, created_at: `${TODAY} 08:00:00`, doc_name: null, evidence_name: null });
      const tk = (lid) => P.tasks.find((t) => t.id === ids[lid]);
      const dids = [];
      spec.deliverables.forEach((x) => { item('deliverable', x.title, '', { due_date: x.due }, x.state); const it = P.items[P.items.length - 1]; dids.push(it.id); if (x.task && tk(x.task)) tk(x.task).deliverable_id = it.id; });
      spec.payments.forEach((x) => { item('milestone', x.title, '', { percent: x.percent, amount: x.amount, due_date: x.due, ...(x.deliv != null ? { deliverable_id: dids[x.deliv] } : {}) }, x.state); const it = P.items[P.items.length - 1]; if (x.task && tk(x.task)) (tk(x.task).links = tk(x.task).links || []).push(it.id); });
      spec.risks.forEach((x) => { item('risk', x.title, `${x.title} (${x.probability}). Mitigation: ${x.mitigation}`, { probability: x.probability, impact: x.impact, mitigation: x.mitigation }, 'open'); const it = P.items[P.items.length - 1]; if (x.task && tk(x.task)) (tk(x.task).links = tk(x.task).links || []).push(it.id); });
      DB.projects[id] = P; DB.order.push(id);
    });
  })();


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
    mode: t.mode === 'manual' ? 'manual' : 'auto', flag: t.flag ? 1 : 0, conflict: t.conflict ? 1 : 0, links: Array.isArray(t.links) ? t.links : [],
  });
  function scheduleResponse(P) {
    const computed = S.schedule(P.tasks, rawProject(P));
    return {
      tasks: computed.map(taskView),
      calendar: { work_days: P.p.work_days, holidays: P.p.holidays },
      impact_check: !!P.p.impact_check, today: TODAY, has_baseline: computed.some((t) => t.b_start),
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
  const V = window.__Versions;
  const projEnd = (P) => S.schedule(P.tasks, rawProject(P)).reduce((m, t) => (!t.summary && t.finish && (!m || t.finish > m) ? t.finish : m), null);
  const vmeta = (d, a, b, names) => ({ added: d.added.length, removed: d.removed.length, changed: d.changed.length, reordered: d.reordered, end_from: a, end_to: b, names });
  function ensureVersion(P) {
    P.versions = P.versions || [];
    if (P.versions.length || !P.tasks.length) return;
    P.versions.push({ id: nid(), version: 'v1.0.0', level: 'major', source: 'initial', label: null, meta: { added: P.tasks.length, removed: 0, changed: 0 }, author: 'System', project_end: projEnd(P), task_count: P.tasks.length, snapshot: V.snap(P.tasks), created_at: `${TODAY} 08:00:00` });
  }
  function recordVersion(P, source = 'edit', label = null) {
    ensureVersion(P);
    const last = P.versions[P.versions.length - 1], now = V.snap(P.tasks), end = projEnd(P);
    if (!last) { if (!P.tasks.length) return; P.versions.push({ id: nid(), version: 'v1.0.0', level: 'major', source: 'initial', label, meta: { added: P.tasks.length, removed: 0, changed: 0 }, author: ACTOR, project_end: end, task_count: P.tasks.length, snapshot: now, created_at: nowTs() }); return; }
    const d = V.diff(last.snapshot, now);
    if (!d.count && !label) return;
    const level = label && !d.count ? 'patch' : V.levelFor(d, last.project_end, end, source);
    const names = [...d.added, ...d.removed, ...d.changed].slice(0, 3).map((x) => x.name);
    if (!label && level === 'patch' && last.level === 'patch' && last.source === 'edit' && source === 'edit' && P.versions.length > 1) {
      const before = P.versions[P.versions.length - 2], d2 = V.diff(before.snapshot, now);
      Object.assign(last, { meta: vmeta(d2, before.project_end, end, [...d2.added, ...d2.removed, ...d2.changed].slice(0, 3).map((x) => x.name)), project_end: end, task_count: P.tasks.length, snapshot: now, created_at: nowTs() });
      return;
    }
    P.versions.push({ id: nid(), version: V.nextVersion(last.version, level), level, source, label, meta: vmeta(d, last.project_end, end, names), author: ACTOR, project_end: end, task_count: P.tasks.length, snapshot: now, created_at: nowTs() });
    if (P.versions.length > 60) P.versions.splice(1, 1);
  }
  const versionView = (v, cur) => { const { snapshot, ...o } = v; return { ...clone(o), current: v.id === cur }; };
  const listVersions = (P) => { ensureVersion(P); const cur = P.versions.length ? P.versions[P.versions.length - 1].id : null; return P.versions.slice().reverse().map((v) => versionView(v, cur)); };
  function stats(P) {
    const m = S.progressMetrics(P.tasks, rawProject(P), TODAY);
    const pendingItems = P.items.filter((i) => i.status === 'proposed').length;
    const pendingInbox = P.inbox.filter((r) => r.status === 'pending').length;
    let health = 'green';
    if (m.spi != null) health = m.spi >= 0.95 ? 'green' : m.spi >= 0.8 ? 'amber' : 'red';
    if (m.overdue >= 3) health = 'red'; else if (m.overdue >= 1 && health === 'green') health = 'amber';
    const sched = S.schedule(P.tasks, rawProject(P));
    const end = sched.reduce((mx, t) => (t.finish && t.finish > mx ? t.finish : mx), '');
    return { progress: m.actualPct, planned: m.plannedPct, spi: m.spi, overdue: m.overdue, tasks: m.taskCount, pendingItems, pendingInbox, health, forecast_end: end || null, today: TODAY };
  }
  const projectView = (P) => ({ ...clone(P.p), stats: stats(P), analysis: P.analysis ? clone(P.analysis) : null });

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
      const start = S.nextWork(s0 || P.p.start_date || TODAY, c);
      let dur = d.duration_days || 1;
      if (s0 && e0) dur = Math.max(1, S.countWork(s0, e0, c));
      if (d.level === 'milestone') dur = 1;
      const topName = (nm) => [...P.tasks].reverse().find((t) => similarity(t.name, nm) >= 0.9 && similarity(nm, t.name) >= 0.9);
      const mkTask = (o) => { const t = { id: nid(), parent_id: null, position: P.tasks.reduce((m, x) => Math.max(m, x.position ?? 0), 0) + 1, name: '', start, duration: 1, progress: 0, assignee: null, deps: [], deliverable_id: null, b_start: null, b_end: null, notes: null, is_milestone: 0, jira_key: null, color: null, ...o }; P.tasks.push(t); return t; };
      let parent = null;
      if (d.phase) parent = topName(d.phase) || mkTask({ name: d.phase, duration: 1 });
      const dupe = d.level === 'phase' && !d.phase ? topName(item.title) : null;
      const t = dupe || mkTask({ name: item.title, parent_id: parent ? parent.id : null, duration: dur, is_milestone: d.level === 'milestone' ? 1 : 0, notes: [d.note, d.type && d.type !== 'task' && d.type !== 'milestone' ? `Type: ${d.type}.` : null, d.owner ? `Owner: ${d.owner}.` : null, d.implied ? 'Added by the AI as an expected project step.' : item.quote ? `Source: "${item.quote}"` : null].filter(Boolean).join(' ') || null });
      if (dupe) { t.start = start; t.duration = dur; }
      const deps = [];
      for (const nm of d.depends_on || []) {
        const pred = P.tasks.find((x) => x.id !== t.id && similarity(x.name, nm) >= 0.85 && similarity(nm, x.name) >= 0.85);
        if (pred && !deps.some((x) => x.id === pred.id) && !wouldLoop(P.tasks, t.id, [{ id: pred.id }])) deps.push({ id: pred.id, lag: 0, type: 'FS' });
      }
      t.deps = deps;
      d.task_id = t.id;
      try { recalc(P); } catch (e) { /* schedule engine will rebuild on next read */ }
      note = `Added "${item.title}" to the schedule${parent ? ` under ${parent.name}` : ''}`;
    } else if (item.kind === 'milestone') {
      if (d.amount == null && d.percent != null && P.p.value) d.amount = Math.round((P.p.value * d.percent) / 100);
    }
    item.status = 'confirmed';
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
    } else throw err(400, 'Unknown action type');
    audit(P, actor, 'task_update', { summary, action: action.type });
    return { prev, summary };
  }
  function undoAction(P, action) {
    const p = action.prev || {};
    if (p.task) { const t = P.tasks.find((x) => x.id === p.task.id); if (t) { t.progress = p.task.progress; t.start = p.task.start; t.assignee = p.task.assignee; } recalc(P); }
    if (p.item) { const it = P.items.find((x) => x.id === p.item.id); if (it) { it.state = p.item.state; it.evidence_doc_id = p.item.evidence_doc_id; } }
    if (p.tasks && p.tasks.length) { for (const x of p.tasks) { const t = P.tasks.find((y) => y.id === x.id); if (t) t.progress = x.progress; } recalc(P); }
    if (p.created_item) P.items = P.items.filter((i) => i.id !== p.created_item);
    audit(P, 'PM', 'undo', { summary: `Undid: ${action.summary || action.type}` });
  }
  function resolveResource(P, sender, hint) {
    const s = (sender || '').toLowerCase(), h = (hint || '').toLowerCase();
    const r = P.resources.find((x) => (x.email && s.includes(x.email.toLowerCase())) || (x.teams_name && s.includes(x.teams_name.toLowerCase())) || (x.name && (s.includes(x.name.toLowerCase()) || (h && h.includes(x.name.toLowerCase())))));
    return r ? r.name : hint || null;
  }
  function addInbox(P, o) {
    const row = { id: nid(), owner_id: 1, project_id: P.id, source: o.source, ext_id: null, sender: o.sender || null, subject: o.subject || null, body: (o.body || '').slice(0, 4000), resource: o.resource || null, action: o.action || null, summary: o.summary || null, confidence: o.confidence ?? null, status: o.status || 'pending', doc_id: o.doc_id ?? null, created_at: nowTs(), applied_at: null };
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
    const dedupe = (kind, rows, text, threshold, make, enrich) => {
      const ex = live(kind);
      for (const r of rows || []) {
        const t = text(r); if (!t) continue;
        const dup = ex.find((x) => similarity(x.title + ' ' + x.description, t) >= threshold || similarity(x.title, t) >= threshold);
        if (dup) { addSource(dup, label); if (enrich) enrich(dup, r); counts.merged++; continue; }
        ex.push(insertItem(P, kind, make(r), doc.id)); counts[kind]++;
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
    if (status === 'active') { st.started = Date.now(); P.analysis.stage = key; }
  }
  const refreshConfidence = (P) => { P.analysis.confidence = Pipe.confidence(P.items, P.analysis.docs); };
  const countIn = (c) => c.deliverable + c.requirement + c.risk + c.milestone + c.schedule + c.field;

  async function analyzeDocs(P, docs) {
    const run = { at: nowTs(), finished: false, show_summary: false, stage: 'ingest', stages: STAGES.map(([key, label]) => ({ key, label, status: 'waiting', detail: '' })), confidence: { overall: null, by: {}, coverage: null }, filled: null, docs: docs.map((d) => ({ id: d.id, filename: d.filename, status: 'waiting', message: '', counts: null, coverage: null, engine: null, progress: '', role: null, role_label: null })) };
    P.analysis = run;
    P.p.analyzing = 1;
    const rowOf = (d) => run.docs.find((r) => r.id === d.id);
    try {
      await ensurePipe();
      if (!Pipe || !Pipe.detectRole || !AI || !AI.splitParts) throw Object.assign(new Error('analysis module missing'), { code: 'pipe' });
      // 1. Ingestion and parsing
      setStage(P, 'ingest', 'active', `Reading ${docs.length} file${docs.length === 1 ? '' : 's'}`);
      let n = 0;
      for (const doc of docs) {
        const st = rowOf(doc);
        const f = P._files && P._files[doc.id];
        if (f) {
          st.status = 'reading'; st.progress = 'reading the file';
          const r = await readFile(f);
          P.texts[doc.id] = r.text || '';
          doc.chars = (r.text || '').length; doc.pages = r.pages || null; doc.read_error = r.error || null; doc.ocr = !!r.ocr;
          doc.kind = AI.classify(doc.filename, r.text || '');
          delete P._files[doc.id];
          audit(P, ACTOR, 'document_uploaded', { summary: `Uploaded ${doc.filename} (${doc.kind})` });
        }
        n++;
        run.stages[0].detail = `${n} of ${docs.length} files read${doc.pages ? `, ${doc.pages} pages` : ''}`;
        const text = P.texts[doc.id] || '';
        if (!text.trim()) { st.status = 'failed'; st.message = doc.read_error || 'No text could be read from this file.'; audit(P, 'AI', 'document_failed', { summary: `Could not read ${doc.filename}. ${st.message}` }); }
        else st.status = 'waiting';
      }
      const readable = docs.filter((d) => (P.texts[d.id] || '').trim());
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
      for (const doc of readable) {
        const st = rowOf(doc);
        const text = P.texts[doc.id];
        docNo++;
        st.status = 'reading';
        try {
          let a, scope = Pipe.SCOPE[doc.role] || Pipe.SCOPE.other;
          if (doc.role === 'schedule') {
            const m = Pipe.scheduleFromMsp(text);
            a = { engine: 'msp', fields: [m.start ? { field: 'start_date', value: m.start, confidence: 0.98, quote: m.items[0].quote } : null, m.end ? { field: 'end_date', value: m.end, confidence: 0.98, quote: m.items[m.items.length - 1].quote } : null].filter(Boolean), schedule: m.items, deliverables: [], requirements: [], milestones: [], coverage: { chars_total: text.length, chars_sent: text.length, parts: 1, parts_read: 1, parts_failed: 0, dropped_no_quote: 0 } };
            doc.summary = `Microsoft Project schedule with ${m.items.length} tasks, ${m.start} to ${m.end}.`;
          } else if (aiOn && !aiError) {
            a = await Pipe.extractDoc({ text, filename: doc.filename, role: doc.role, onProgress: (p) => { st.progress = `part ${p.done} of ${p.total}`; } });
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
          else if (!found && !c.merged) { st.status = 'empty'; st.message = 'The document was read in full but nothing it is allowed to supply was found in it.'; }
          else st.status = 'done';
          refreshConfidence(P);
          run.stages[3].detail = `Document ${docNo} of ${readable.length}: ${P.items.filter((i) => i.status !== 'ignored').length} items found so far`;
          audit(P, 'AI', 'document_analyzed', { summary: `Analyzed ${doc.filename} as ${Pipe.ROLE_LABEL[doc.role]}: ${c.deliverable} deliverables, ${c.requirement} requirements, ${c.milestone} payment milestones, ${c.schedule} schedule lines${a.coverage ? `. Read ${a.coverage.chars_sent.toLocaleString('en-US')} of ${a.coverage.chars_total.toLocaleString('en-US')} characters` : ''}` });
        } catch (e) {
          console.error(e);
          st.status = 'failed'; st.progress = '';
          st.message = e.code && AI_REASON[e.code] ? AI_REASON[e.code] : 'Something went wrong while analyzing this file. Use Reanalyze to try again.';
          audit(P, 'AI', 'document_failed', { summary: `Analysis failed for ${doc.filename}` });
        }
      }
      setStage(P, 'analyze', 'done', `${P.items.filter((i) => i.status !== 'ignored').length} items extracted from ${readable.length} documents`);

      // 5. Response generation: one schedule, project risks, consistency checks
      setStage(P, 'generate', 'active', 'Building the schedule');
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
      P.p.analyzing = 0;
      run.finished = true;
      run.show_summary = true;
      for (const st of run.stages) if (st.status === 'active') st.status = 'done'; else if (st.status === 'waiting') st.status = 'skipped';
    }
  }

  // Puts the extracted data into the project. High confidence items are confirmed, the rest wait for review.
  function autofill(P) {
    const authority = (it) => { const d = P.documents.find((x) => x.id === it.doc_id); return (d && Pipe.AUTHORITY[d.role]) || 1; };
    const out = { confirmed: 0, review: 0, kinds: {}, conflicts: [] };
    // Only items read by the AI or taken from a schedule file are filled in. The rule based fallback is never trusted on its own.
    const trusted = new Set(((P.analysis && P.analysis.docs) || []).filter((d) => d.engine === 'claude' || d.engine === 'msp').map((d) => d.id));
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
    const hasSchedFile = docs.some((d) => d.role === 'schedule');
    const syn = hasSchedFile ? null : await AI.synthesizeSchedule({ docs, items: view(), anchor, project: proj() }).catch(() => null);
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
      out.summary = syn.summary; out.notes = syn.notes; out.engine = 'claude';
    }
    P.analysis.stages.find((x) => x.key === 'generate').detail = 'Running consistency checks';
    const checks = AI.runChecks({ items: view(), project: proj(), docs: (P.analysis && P.analysis.docs) || [] });
    // Project risks are analysed from the whole document set
    P.items = P.items.filter((i) => !(i.kind === 'risk' && i.data && i.data.analysis && i.status === 'proposed'));
    if (AI.hasKey() && docs.length) {
      P.analysis.stages.find((x) => x.key === 'generate').detail = 'Analyzing project risks';
      const rdocs = docs.map((d) => ({ id: d.id, filename: d.filename, role: d.role, summary: d.summary }));
      const risks = await Pipe.analyzeRisks({ project: proj(), docs: rdocs, items: view(), text: P.texts, checks }).catch((e) => { console.error('risk analysis', e); return []; });
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
    if (/\.(txt|md|csv|tsv|json|eml|html?|xml)$/.test(n)) return { text: await f.text() };
    if (/\.(pdf|docx|pptx|xlsx|xls|png|jpe?g|webp|gif|mpp|doc|ppt)$/.test(n)) {
      try {
        const r = await fetch('/srv/extract?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
        let j = null;
        try { j = await r.json(); } catch (e) { /* not json */ }
        if (!r.ok) return { text: '', error: (j && j.error) || `The server could not read this file (${r.status}).` };
        return { text: (j && j.text) || '', pages: (j && j.pages) || null, ocr: !!(j && j.ocr) };
      } catch (e) {
        return { text: '', error: 'The server could not be reached to read this file.' };
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
      const d = { id: nid(), filename: f.name, kind, summary: '', uploaded_by: ACTOR, created_at: nowTs(), chars: text.length, pages: r.pages || null, read_error: r.error || null };
      P.documents.push(d); P.texts[d.id] = text; docs.push(d);
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
  function reportInputs(P, today, periodDays) {
    return {
      project: rawProject(P), user: DB.user, tasks: P.tasks, items: P.items.map((i) => ({ ...i, data: JSON.stringify(i.data) })), resources: P.resources,
      docs: P.documents.map((d) => ({ id: d.id, filename: d.filename, kind: d.kind, summary: d.summary, text: P.texts[d.id] || '' })),
      audit: P.audit.map((a) => ({ ...a, detail: JSON.stringify(a.detail) })), inbox: P.inbox.map((r) => ({ status: r.status })), today, periodDays,
    };
  }

  // ---------- dashboard ----------
  function dashboard() {
    const projects = DB.order.map((id) => DB.projects[id]).filter((P) => P.p.status !== 'archived').reverse();
    const cards = [], payments = [], overdue = [], radarEntries = [];
    const next60 = S.addDays(TODAY, 60);
    let pendingInbox = 0, pendingItems = 0;
    for (const P of projects) {
      const st = stats(P); pendingInbox += st.pendingInbox; pendingItems += st.pendingItems;
      cards.push({ ...clone(P.p), stats: st });
      radarEntries.push({ p: { ...clone(P.p), id: P.id }, stats: st, items: P.items.filter((i) => i.kind === 'risk' || i.kind === 'milestone' || i.kind === 'deliverable').map((i) => ({ ...i, data: i.data || {} })), rows: S.progressMetrics(P.tasks, rawProject(P), TODAY).rows, sched: S.schedule(P.tasks, rawProject(P)) });
      for (const m of P.items.filter((i) => i.kind === 'milestone' && i.status !== 'ignored' && i.state !== 'paid')) {
        const d = m.data;
        if (d.due_date) {
          const amount = d.amount ?? (d.percent != null && P.p.value ? Math.round((P.p.value * d.percent) / 100) : null);
          payments.push({ item_id: m.id, project_id: P.id, project: P.p.name, currency: P.p.currency, title: m.title, due: d.due_date, amount, state: m.state, late: d.due_date < TODAY && m.state === 'pending' });
        }
      }
      const mm = S.progressMetrics(P.tasks, rawProject(P), TODAY);
      for (const r of mm.rows) if (r.overdue) overdue.push({ task_id: r.id, project_id: P.id, project: P.p.name, task: r.name, finish: r.finish, progress: r.progress, assignee: r.assignee });
    }
    payments.sort((a, b) => a.due.localeCompare(b.due));
    const soon = payments.filter((x) => x.due <= next60);
    const shown = soon.length >= 4 ? soon : payments.slice(0, 5);
    overdue.sort((a, b) => a.finish.localeCompare(b.finish));
    const activity = [];
    for (const P of projects) for (const a of P.audit) activity.push({ ...clone(a), project: P.p.name });
    activity.sort((a, b) => (b.ts || '').localeCompare(a.ts || '') || b.id - a.id);
    const totalValue = {};
    for (const P of projects) if (P.p.value) totalValue[P.p.currency] = (totalValue[P.p.currency] || 0) + P.p.value;
    return {
      today: TODAY, radar: window.__Radar.buildRadar(radarEntries, TODAY), analytics: window.__Analytics.buildAnalytics(radarEntries, TODAY), projects: cards, payments: shown.slice(0, 10), overdue: overdue.slice(0, 12), activity: activity.slice(0, 12), pendingInbox, pendingItems, totalValue, unassigned: 0,
      counts: { active: projects.filter((p) => p.p.status === 'active').length, red: cards.filter((c) => c.stats.health === 'red').length, amber: cards.filter((c) => c.stats.health === 'amber').length, green: cards.filter((c) => c.stats.health === 'green').length },
    };
  }

  const fileToDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

  // ---------- routes ----------
  const routes = [];
  const on = (method, re, fn) => routes.push([method, new RegExp('^' + re + '$'), fn]);

  on('POST', '/api/auth/(login|register)', async () => ({ token: 'demo-token', user: DB.user }));
  const CONN = { jira: null, outlook: null };
  const connView = () => ({ jira: { connected: !!CONN.jira, label: CONN.jira, managed: false }, outlook: { connected: !!CONN.outlook, label: CONN.outlook, managed: false } });
  on('GET', '/api/me', async () => ({ user: DB.user, status: { ...SEED.status, jira: !!CONN.jira, graph: !!CONN.outlook } }));
  on('GET', '/api/connections', async () => ({ connections: connView() }));
  on('POST', '/api/connections/(jira|outlook)', async (mm, q, body) => {
    if (mm[1] === 'jira') {
      if (!/^https:\/\/[\w.-]+\.[a-z]{2,}/i.test(body.base_url || '')) throw err(400, 'Enter your Jira address, for example https://yourcompany.atlassian.net');
      if (!body.email || !body.token) throw err(400, 'Enter the account email and the API token');
      CONN.jira = `${body.email} at ${body.base_url.replace(/^https:\/\//, '').replace(/\/$/, '')}`;
    } else {
      if (!body.token || body.token.length < 20) throw err(400, 'Paste the access token from Microsoft Graph');
      CONN.outlook = 'demo.user@company.com';
    }
    return { connections: connView() };
  });
  on('DELETE', '/api/connections/(jira|outlook)', async (mm) => { CONN[mm[1]] = null; return { connections: connView() }; });
  on('PUT', '/api/me', async (m, q, b) => { if (b.language) DB.user.language = b.language; if (b.theme) DB.user.theme = b.theme; if (b.name) DB.user.name = b.name; if ('dash_layout' in b) DB.user.dash_layout = b.dash_layout; return { user: DB.user }; });
  on('POST', '/api/me/avatar', async (m, q, b) => { const f = b.get('file'); if (!f) throw err(400, 'No image received'); DB.user.avatar = await fileToDataUrl(f); return { user: DB.user }; });
  on('POST', '/api/me/password', async (m, q, b) => { if (!b.next || b.next.length < 8) throw err(400, 'New password must be at least 8 characters'); return { ok: true }; });
  on('POST', '/api/me/ingest-key', async () => { DB.user.ingest_key = Math.random().toString(16).slice(2).padEnd(32, 'a').slice(0, 32); return { ingest_key: DB.user.ingest_key }; });


  on('GET', '/api/calendar', async () => {
    const tasks = [], payments = [], list = DB.order.map((id) => DB.projects[id]).filter((P) => P.p.status !== 'archived');
    for (const P of list) {
      for (const t of S.schedule(P.tasks, rawProject(P))) {
        tasks.push({ id: t.id, project_id: P.id, summary: !!t.summary, name: t.name, start: t.start, finish: t.finish, progress: t.progress || 0, milestone: !!t.is_milestone, assignee: t.assignee || null, late: (t.progress || 0) < 100 && t.finish < TODAY });
      }
      for (const i of P.items) if (i.kind === 'milestone' && i.status !== 'ignored' && i.data && i.data.due_date) payments.push({ id: i.id, project_id: P.id, title: i.title, due: i.data.due_date, state: i.state, amount: i.data.amount != null ? i.data.amount : null });
    }
    return { today: TODAY, projects: list.map((P) => ({ id: P.id, name: P.p.name, currency: P.p.currency })), tasks, payments };
  });
  on('GET', '/api/dashboard', async () => dashboard());
  // one project's dashboard: radar, schedule and critical path, deliverables, payments and cash flow
  on('GET', '/api/projects/(\\d+)/dashboard', async (mm) => {
    const P = P_(mm[1]), raw = rawProject(P), st = stats(P);
    const sched = S.schedule(P.tasks, raw);
    const items = P.items.map((i) => ({ ...i, data: i.data || {} }));
    const entry = { p: { ...clone(P.p), id: P.id }, stats: st, items: items.filter((i) => i.status !== 'ignored' && ['risk', 'milestone', 'deliverable'].includes(i.kind)), rows: S.progressMetrics(P.tasks, raw, TODAY).rows, sched };
    const audit = P.audit.slice(0, 12).map((a) => ({ ...a, detail: a.detail || {} }));
    return { project: { ...projectView(P) }, radar: window.__Radar.buildRadar([entry], TODAY), analytics: window.__Analytics.buildAnalytics([entry], TODAY),
      ...window.__ProjDash.buildProjectDash({ project: raw, tasks: sched, items, inbox: P.inbox, audit, today: TODAY }) };
  });
  on('GET', '/api/projects', async () => ({ projects: DB.order.map((id) => DB.projects[id]).reverse().map(projectView) }));
  on('POST', '/api/projects', async (m, q, fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) throw err(400, 'Give the project a name');
    const id = nid();
    const P = makeProject(id, { id, owner_id: 1, name, code: null, client: null, client_logo: null, currency: null, value: null, start_date: null, end_date: null, work_days: [1, 2, 3, 4, 5], work_start: '08:00', work_end: '17:00', holidays: [], status: 'active', wizard_done: 0, analyzing: 0, impact_check: 1, auto_apply: 0, auto_threshold: 0.9, jira_key: null, teams_channel: null, created_at: nowTs() });
    DB.projects[id] = P; DB.order.push(id);
    let files = fd.getAll('files').filter((f) => f && f.name);
    let docs;
    if (files.length) { docs = []; P._files = {}; for (const f of files) { const d = { id: nid(), filename: f.name, kind: AI.classify(f.name, ''), summary: '', uploaded_by: ACTOR, created_at: nowTs(), chars: 0, pages: null, read_error: null }; P.documents.push(d); P.texts[d.id] = ''; P._files[d.id] = f; docs.push(d); } }
    else { docs = []; for (const n of ['Proposal_Smart_Portal.txt', 'Contract_Smart_Portal.txt', 'PO_4500123.txt']) { const d = { id: nid(), filename: n, kind: AI.classify(n, SEED.docTexts[n]), summary: '', uploaded_by: ACTOR, created_at: nowTs(), chars: SEED.docTexts[n].length }; P.documents.push(d); P.texts[d.id] = SEED.docTexts[n]; docs.push(d); } }
    audit(P, ACTOR, 'project_created', { summary: `Project "${name}" created with ${docs.length} document${docs.length === 1 ? '' : 's'}` });
    analyzeDocs(P, docs).catch((e) => console.error(e));
    return { project: clone(P.p) };
  });
  on('GET', '/api/projects/(\\d+)', async (m) => ({ project: projectView(P_(m[1])) }));
  on('PUT', '/api/projects/(\\d+)', async (m, q, b) => {
    const P = P_(m[1]);
    for (const k of ['name', 'code', 'client', 'currency', 'start_date', 'end_date', 'work_start', 'work_end', 'jira_key', 'teams_channel', 'status', 'sharepoint_url', 'jira_url']) if (k in b) P.p[k] = b[k] === '' ? null : b[k];
    for (const k of ['sharepoint_url', 'jira_url']) if (b[k] && !/^https?:\/\/\S+$/i.test(String(b[k]).trim())) throw err(400, 'Enter a full link that starts with http or https');
    if ('name' in b && !String(b.name).trim()) throw err(400, 'The project needs a name');
    if ('value' in b) P.p.value = b.value === '' || b.value == null ? null : Number(b.value);
    for (const k of ['impact_check', 'auto_apply']) if (k in b) P.p[k] = b[k] ? 1 : 0;
    if ('auto_threshold' in b) P.p.auto_threshold = Math.min(1, Math.max(0.5, Number(b.auto_threshold) || 0.9));
    if ('work_days' in b) { const d = (b.work_days || []).map(Number).filter((n) => n >= 0 && n <= 6); if (!d.length) throw err(400, 'Choose at least one working day'); P.p.work_days = [...new Set(d)].sort(); }
    if ('holidays' in b) P.p.holidays = [...new Set((b.holidays || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    if ('work_days' in b || 'holidays' in b) recalc(P);
    audit(P, ACTOR, 'settings_changed', { summary: 'Project settings updated' });
    return { project: projectView(P) };
  });
  on('POST', '/api/projects/(\\d+)/logo', async (m, q, b) => { const P = P_(m[1]); const f = b.get('file'); if (!f) throw err(400, 'No image received'); P.p.client_logo = await fileToDataUrl(f); return { project: clone(P.p) }; });
  on('DELETE', '/api/projects/(\\d+)', async (m) => { const id = Number(m[1]); P_(id); delete DB.projects[id]; DB.order = DB.order.filter((x) => x !== id); return { ok: true }; });

  on('GET', '/api/projects/(\\d+)/documents', async (m) => ({ documents: P_(m[1]).documents.map(clone) }));
  on('POST', '/api/projects/(\\d+)/documents', async (m, q, fd) => {
    const P = P_(m[1]); const mode = fd.get('purpose') || 'auto';
    const files = fd.getAll('files').filter((f) => f && f.name);
    const out = [], src = [];
    for (const d of await addDocuments(P, files)) {
      audit(P, ACTOR, 'document_uploaded', { summary: `Uploaded ${d.filename} (${d.kind})` });
      if (d.read_error) { out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'failed', error: d.read_error }); continue; }
      const asSource = mode === 'source' || (mode === 'auto' && ['proposal', 'contract', 'po'].includes(d.kind));
      if (asSource) { src.push(d); out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'extraction' }); }
      else { const n = await processEvidence(P, d); out.push({ id: d.id, filename: d.filename, kind: d.kind, handled: 'progress', suggestions: n }); }
    }
    if (src.length) analyzeDocs(P, src).catch((e) => console.error(e));
    return { results: out };
  });
  on('POST', '/api/projects/(\\d+)/documents/(\\d+)/link', async (m, q, b) => {
    const P = P_(m[1]); const d = P.documents.find((x) => x.id === Number(m[2])); const it = P.items.find((x) => x.id === Number(b.deliverable_id) && x.kind === 'deliverable');
    if (!d || !it) throw err(404, 'Document or deliverable not found');
    return { ok: true, summary: applyAction(P, { type: 'close_deliverable', deliverable_id: it.id }, ACTOR, d.id).summary };
  });
  on('DELETE', '/api/projects/(\\d+)/documents/(\\d+)', async (m) => {
    const P = P_(m[1]); const id = Number(m[2]);
    P.documents = P.documents.filter((d) => d.id !== id); delete P.texts[id];
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
    return { items: rows.sort((a, b) => a.id - b.id).map((i) => itemView(P, i)) };
  });
  on('POST', '/api/projects/(\\d+)/items', async (m, q, b) => {
    const P = P_(m[1]);
    if (!['deliverable', 'requirement', 'risk', 'milestone'].includes(b.kind)) throw err(400, 'Unsupported item type');
    if (!String(b.title || '').trim()) throw err(400, 'A title is required');
    const it = { id: nid(), project_id: P.id, kind: b.kind, title: b.title.trim(), description: b.description || '', data: b.data || {}, status: 'confirmed', state: b.state || (b.kind === 'milestone' ? 'pending' : 'open'), confidence: null, doc_id: null, quote: '', evidence_doc_id: null, created_at: nowTs() };
    P.items.push(it); audit(P, ACTOR, 'item_added', { summary: `Added ${b.kind} "${it.title}"` });
    return { item: itemView(P, it) };
  });
  on('POST', '/api/projects/(\\d+)/items/bulk', async (m, q, b) => {
    const P = P_(m[1]);
    if (!Array.isArray(b.ids) || !['confirm', 'ignore'].includes(b.action)) throw err(400, 'Provide ids and an action');
    let n = 0;
    for (const id of b.ids) { const it = P.items.find((x) => x.id === Number(id)); if (!it) continue; if (b.action === 'confirm') confirmItem(P, it, ACTOR); else it.status = 'ignored'; n++; }
    return { changed: n };
  });
  const findItem = (id) => { for (const k of DB.order) { const P = DB.projects[k]; const it = P && P.items.find((x) => x.id === Number(id)); if (it) return [P, it]; } throw err(404, 'Not found'); };
  on('PUT', '/api/items/(\\d+)', async (m, q, b) => {
    const [P, it] = findItem(m[1]);
    if (b.title != null) it.title = b.title; if (b.description != null) it.description = b.description;
    it.data = { ...it.data, ...(b.data || {}) };
    if (b.state && b.state !== it.state) { it.state = b.state; audit(P, ACTOR, 'item_state', { summary: `${it.kind} "${it.title}" set to ${b.state}` }); }
    return { item: itemView(P, it) };
  });
  on('POST', '/api/items/(\\d+)/(confirm|ignore|reopen)', async (m) => {
    const [P, it] = findItem(m[1]);
    if (m[2] === 'confirm') confirmItem(P, it, ACTOR);
    else { it.status = m[2] === 'ignore' ? 'ignored' : 'proposed'; audit(P, ACTOR, 'item_' + m[2], { summary: `${m[2] === 'ignore' ? 'Ignored' : 'Reopened'} ${it.kind} "${it.title}"` }); }
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
    const r = { id: nid(), project_id: P.id, name: b.name.trim(), email: b.email || null, role: b.role || null, jira_account: b.jira_account || null, teams_name: b.teams_name || null };
    P.resources.push(r); return { resource: r };
  });
  on('DELETE', '/api/projects/(\\d+)/resources/(\\d+)', async (m) => { const P = P_(m[1]); P.resources = P.resources.filter((r) => r.id !== Number(m[2])); return { ok: true }; });

  on('GET', '/api/projects/(\\d+)/schedule', async (m) => { const P = P_(m[1]); ensureVersion(P); return scheduleResponse(P); });
  on('GET', '/api/projects/(\\d+)/schedule/validate', async (m) => {
    const P = P_(m[1]);
    return S.checkSchedule(P.tasks, rawProject(P), { items: linkItems(P), today: TODAY, hasBaseline: P.tasks.some((t) => t.b_start) });
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
    recalc(P); audit(P, ACTOR, 'schedule_restore', { summary: `Restored schedule ${v.version}` });
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
    audit(P, ACTOR, 'msproject_export', { summary: `Exported ${computed.length} tasks to Microsoft Project XML` });
    return { xml: window.__MSP.toXml(rawProject(P), computed), filename: `${P.p.name.replace(/[^\w .-]/g, '_')}.xml` };
  });
  on('POST', '/api/projects/(\\d+)/msproject/import', async (m, q, b) => {
    const P = P_(m[1]); const mode = b.mode === 'merge' ? 'merge' : 'replace';
    let parsed; try { parsed = window.__MSP.parse(b.xml); } catch (e) { throw err(400, e.message); }
    const plan = window.__MSP.plan(P.tasks, parsed, mode);
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
    audit(P, ACTOR, 'msproject_import', { summary: `Microsoft Project ${mode === 'merge' ? 'sync' : 'import'}: ${plan.summary.added} added, ${plan.summary.updated} updated` });
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
        P.tasks = P.tasks.filter((x) => x !== t); audit(P, ACTOR, 'task_deleted', { summary: `Deleted task "${t.name}"` }); continue;
      }
      const bits = [];
      if (ch.start && ch.start !== t.start) bits.push(`start ${t.start} to ${ch.start}`);
      if (ch.duration != null && ch.duration !== t.duration) bits.push(`duration ${t.duration} to ${ch.duration} days`);
      if (ch.progress != null && ch.progress !== t.progress) bits.push(`progress ${t.progress || 0}% to ${ch.progress}%`);
      for (const k of TASK_FIELDS) if (k in ch) t[k] = ch[k];
      if ('deps' in ch) t.deps = ch.deps;
      if (ch._asap) t.start = ch._asap;
      if (bits.length) audit(P, ACTOR, 'task_update', { summary: `Task "${t.name}": ${bits.join(', ')}` });
    }
    P.tasks.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    recalc(P); recordVersion(P, 'edit');
    return scheduleResponse(P);
  });
  on('POST', '/api/projects/(\\d+)/tasks', async (m, q, b) => {
    const P = P_(m[1]);
    if (!String(b.name || '').trim()) throw err(400, 'Task name is required');
    const c = S.calendar(rawProject(P));
    let start = b.start;
    if (!start) { const last = P.tasks.slice().sort((a, z) => z.start.localeCompare(a.start))[0]; start = P.p.start_date || (last && last.start) || TODAY; }
    start = S.nextWork(start, c);
    let position;
    if (b.after_id) { const a = P.tasks.find((x) => x.id === Number(b.after_id)); position = (a ? a.position : 0) + 1; for (const t of P.tasks) if ((t.position ?? 0) >= position) t.position = (t.position ?? 0) + 1; }
    else position = P.tasks.reduce((mx, t) => Math.max(mx, t.position ?? 0), 0) + 1;
    const dur = b.is_milestone ? 0 : Math.max(1, Math.round(Number(b.duration) || 1));
    const id = nid();
    P.tasks.push({ id, parent_id: b.parent_id ? Number(b.parent_id) : null, position, name: b.name.trim(), start, duration: dur, progress: 0, assignee: b.assignee || null, deps: b.deps || [], deliverable_id: b.deliverable_id || null, b_start: null, b_end: null, notes: null, is_milestone: b.is_milestone ? 1 : 0, jira_key: null, color: null, mode: b.mode === 'manual' ? 'manual' : 'auto', flag: 0 });
    P.tasks.sort((a, z) => (a.position ?? 0) - (z.position ?? 0) || a.id - z.id);
    recalc(P); audit(P, ACTOR, 'task_added', { summary: `Added task "${b.name.trim()}"` }); recordVersion(P, 'edit');
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
    for (const c of computed) { const t = P.tasks.find((x) => x.id === c.id); if (t) { t.b_start = c.start; t.b_end = c.finish; } }
    audit(P, ACTOR, 'baseline_set', { summary: `Baseline set for ${computed.length} tasks` });
    recordVersion(P, 'baseline');
    return scheduleResponse(P);
  });

  on('GET', '/api/projects/(\\d+)/inbox', async (m) => { const P = P_(m[1]); return { inbox: P.inbox.map((r) => inboxView(P, r)) }; });
  on('GET', '/api/inbox/unassigned', async () => ({ inbox: [] }));
  const findRow = (id) => { for (const k of DB.order) { const P = DB.projects[k]; const r = P && P.inbox.find((x) => x.id === Number(id)); if (r) return [P, r]; } throw err(404, 'Not found'); };
  on('POST', '/api/inbox/(\\d+)/apply', async (m, q, b) => {
    const [P, r] = findRow(m[1]);
    if (r.status !== 'pending') throw err(400, 'This suggestion was already handled');
    const action = { ...(r.action || {}), ...((b && b.override) || {}) };
    const out = applyAction(P, action, ACTOR, r.doc_id);
    r.status = 'applied'; r.applied_at = nowTs(); r.action = { ...action, prev: out.prev, summary: out.summary };
    return { ok: true, summary: out.summary };
  });
  on('POST', '/api/inbox/(\\d+)/dismiss', async (m) => { const [, r] = findRow(m[1]); r.status = 'dismissed'; return { ok: true }; });
  on('POST', '/api/inbox/(\\d+)/restore', async (m) => { const [, r] = findRow(m[1]); if (!['dismissed', 'undone'].includes(r.status)) throw err(400, 'Nothing to restore'); r.status = 'pending'; return { ok: true }; });
  on('POST', '/api/inbox/(\\d+)/undo', async (m) => {
    const [P, r] = findRow(m[1]);
    if (!['applied', 'auto_applied'].includes(r.status)) throw err(400, 'Nothing to undo');
    undoAction(P, r.action || {}); r.status = 'undone'; return { ok: true };
  });
  on('POST', '/api/projects/(\\d+)/messages', async (m, q, b) => {
    const P = P_(m[1]);
    if (!String(b.body || '').trim()) throw err(400, 'Paste the message text');
    const text = `${b.subject || ''}\n${b.body}`.trim();
    const deliverables = P.items.filter((i) => i.kind === 'deliverable' && i.status !== 'ignored');
    const result = await AI.interpretMessage({ text, sender: b.sender, tasks: P.tasks, resources: P.resources, deliverables });
    const who = resolveResource(P, b.sender, result.resource);
    const base = { source: b.source || 'manual', sender: b.sender || null, subject: b.subject || null, body: text, resource: who };
    if (!result.updates.length) { addInbox(P, { ...base, status: 'no_action', summary: 'No project status information found in this message.' }); return { rows: 1 }; }
    for (const u of result.updates) addInbox(P, { ...base, action: u, summary: describeAction(P, u), confidence: u.confidence ?? 0.5 });
    return { rows: result.updates.length };
  });
  on('POST', '/api/projects/(\\d+)/sync', async () => ({ report: {}, errors: { demo: 'Teams, Outlook and Jira are not connected in this demo. In the real app you set the connection keys in Settings, or push messages to the webhook URLs.' } }));

  on('GET', '/api/doc-types', async () => ({ types: SEED.docTypes }));
  on('GET', '/api/templates', async () => ({ templates: DB.templates.map((t) => ({ id: t.id, doc_type: t.doc_type, name: t.name, created_at: t.created_at })) }));
  on('GET', '/api/templates/skeleton/([a-z_]+)', async (m) => { if (!SEED.skeletons[m[1]]) throw err(404, 'Unknown document type'); return { body: SEED.skeletons[m[1]] }; });
  on('POST', '/api/templates', async (m, q, fd) => {
    const name = fd.get('name'), doc_type = fd.get('doc_type');
    if (!name || !SEED.skeletons[doc_type]) throw err(400, 'Choose a document type and give the template a name');
    let body = fd.get('body') || '';
    const f = fd.get('file');
    if (f && f.name) { if (/\.(md|txt)$/i.test(f.name)) body = await f.text(); else throw err(400, 'The demo reads Markdown or text templates. The full app also reads Word files.'); }
    if (!R.parseTemplate(body).length) throw err(400, 'No section headings found. Use lines starting with "# " in text.');
    const t = { id: nid(), owner_id: 1, doc_type, name: String(name).trim(), body, created_at: nowTs() };
    DB.templates.push(t);
    return { template: { id: t.id, doc_type, name: t.name, created_at: t.created_at }, sections: R.parseTemplate(body).map((s) => s.heading) };
  });
  on('DELETE', '/api/templates/(\\d+)', async (m) => { DB.templates = DB.templates.filter((t) => t.id !== Number(m[1])); return { ok: true }; });

  on('POST', '/api/projects/(\\d+)/generate', async (m, q, b) => {
    const P = P_(m[1]);
    const def = R.DEFAULTS[b.type]; if (!def) throw err(400, 'Choose a document type');
    const tpl = b.template_id ? DB.templates.find((t) => t.id === Number(b.template_id)) : null;
    if (b.template_id && !tpl) throw err(404, 'Template not found');
    const today = b.as_of && /^\d{4}-\d{2}-\d{2}$/.test(b.as_of) ? b.as_of : TODAY;
    const ctx = R.buildContext(reportInputs(P, today, Number(b.period_days) || def.period || 7));
    const out = await R.generate({ type: b.type, templateBody: tpl ? tpl.body : null, templateName: tpl ? tpl.name : null, ctx, useAI: false });
    const g = { id: nid(), project_id: P.id, doc_type: b.type, title: out.title, template: out.template, content: out.markdown, created_at: nowTs() };
    P.generated.unshift(g);
    audit(P, ACTOR, 'document_generated', { summary: `Generated ${out.title}${tpl ? ` from template "${tpl.name}"` : ''}` });
    return { generated: clone(g), engine: out.engine, unconfirmed: ctx.unconfirmed };
  });
  on('GET', '/api/projects/(\\d+)/generated', async (m) => ({ generated: P_(m[1]).generated.map((g) => ({ id: g.id, doc_type: g.doc_type, title: g.title, template: g.template, created_at: g.created_at })) }));
  const findGen = (id) => { for (const k of DB.order) { const P = DB.projects[k]; const g = P && P.generated.find((x) => x.id === Number(id)); if (g) return [P, g]; } throw err(404, 'Not found'); };
  on('GET', '/api/generated/(\\d+)', async (m) => ({ generated: clone(findGen(m[1])[1]) }));
  on('PUT', '/api/generated/(\\d+)', async (m, q, b) => { const [, g] = findGen(m[1]); if (b.title != null) g.title = b.title; if (b.content != null) g.content = b.content; return { generated: clone(g) }; });
  on('DELETE', '/api/generated/(\\d+)', async (m) => { const [P, g] = findGen(m[1]); P.generated = P.generated.filter((x) => x !== g); return { ok: true }; });
  on('GET', '/api/projects/(\\d+)/audit', async (m) => ({ audit: P_(m[1]).audit.slice(0, 200).map(clone) }));

  // ---------- fetch override ----------
  const realFetch = window.fetch.bind(window);
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!/^\/api\//.test(url)) return realFetch(input, init);
    const [path, qs] = url.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = init && init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    else if (body == null) body = {};
    for (const [mth, re, fn] of routes) {
      if (mth !== method) continue;
      const m = path.match(re);
      if (!m) continue;
      try { return json(200, await fn(m, query, body)); }
      catch (e) { if (!e.status) console.error(e); return json(e.status || 500, { error: e.message || 'Something went wrong' }); }
    }
    return json(404, { error: 'Not available in the demo' });
  };
})();
