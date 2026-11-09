window.__Sched=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return {}};
// Scheduling engine: working calendar, dependency propagation, roll ups,
// driving path (critical path), impact preview and baseline math.
const DAY = 86400000;
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d) => d.toISOString().slice(0, 10);

// Hot path. Schedules touch the same few hundred dates millions of times, so dates are handled as whole day numbers
// (days since 1970-01-01) and the text form is converted once and remembered. Results are identical to going through Date.
const dayCache = new Map(), strCache = new Map();
const dayOf = (s) => {
  let n = dayCache.get(s);
  if (n === undefined) {
    const [y, m, d] = s.split('-').map(Number);
    n = Date.UTC(y, m - 1, d) / DAY;
    if (dayCache.size > 20000) dayCache.clear();
    dayCache.set(s, n);
  }
  return n;
};
const strOf = (n) => {
  let s = strCache.get(n);
  if (s === undefined) {
    s = new Date(n * DAY).toISOString().slice(0, 10); // throws on an invalid date, like fmt did
    if (Number.isInteger(n)) { if (strCache.size > 20000) strCache.clear(); strCache.set(n, s); }
  }
  return s;
};
const addDays = (s, n) => strOf(dayOf(s) + n);

function calendar(project) {
  let days, holidays;
  try { days = JSON.parse(project.work_days || '[1,2,3,4,5]'); } catch { days = [1, 2, 3, 4, 5]; }
  try { holidays = JSON.parse(project.holidays || '[]'); } catch { holidays = []; }
  if (!days.length) days = [1, 2, 3, 4, 5];
  return { days: new Set(days), holidays: new Set(holidays) };
}

// day number based working day test; the weekday and holiday lookups are prepared once per calendar object
const prep = (c) => {
  if (!c._dow) {
    c._dow = [0, 1, 2, 3, 4, 5, 6].map((k) => c.days.has(k));
    c._wk = c._dow.filter(Boolean).length;
    const h = new Set();
    for (const x of c.holidays) if (/^\d{4}-\d{2}-\d{2}$/.test(x)) { const n = dayOf(x); if (n === n) h.add(n); }
    c._hol = h;
  }
  return c;
};
// 1970-01-01 was a Thursday (4)
const workDay = (n, c) => c._dow[(((n + 4) % 7) + 7) % 7] === true && !c._hol.has(n);
const isWork = (d, c) => c.days.has(d.getUTCDay()) && !c.holidays.has(fmt(d));

function nextWorkN(n, c) {
  prep(c);
  for (let g = 0; g < 800 && !workDay(n, c); g++) n++;
  return n;
}
function nextWork(s, c) { return strOf(nextWorkN(dayOf(s), c)); }

function nextWorkAfter(s, c) {
  return nextWork(addDays(s, 1), c);
}

// s must be (or will be snapped to) a working day. Adds n working days.
function addWork(s, n, c) {
  let d = nextWorkN(dayOf(s), c);
  while (n > 0) {
    d++;
    if (workDay(d, c)) n--;
  }
  return strOf(d);
}

// Inclusive count of working days between two dates.
// Whole weeks are counted by arithmetic, the few left over days one by one, and the holidays that fall on a working
// weekday inside the range are taken off. Gives exactly what counting every day gave, but the cost no longer grows
// with the length of the range (a project that runs for years used to loop over every day, for every summary task).
function countWork(a, b, c) {
  prep(c);
  const lo = dayOf(a), hi = dayOf(b);
  if (!(lo <= hi)) return 0;           // reversed range, or a date that could not be read
  const dow = c._dow;
  const full = Math.floor((hi - lo + 1) / 7);
  let n = full * c._wk;
  for (let d = lo + full * 7; d <= hi; d++) if (dow[(((d + 4) % 7) + 7) % 7]) n++;
  for (const h of c._hol) if (h >= lo && h <= hi && dow[(((h + 4) % 7) + 7) % 7]) n--;
  return n;
}

function finishOf(t, c) {
  const s = nextWork(t.start, c);
  if (t.is_milestone || t.duration <= 0) return s;
  return addWork(s, t.duration - 1, c);
}

// Moves n working days forward (n >= 0) or back (n < 0) from s.
function shiftWork(s, n, c) {
  if (n >= 0) return addWork(s, n, c);
  let d = nextWorkN(dayOf(s), c);
  while (n < 0) {
    d--;
    if (workDay(d, c)) n++;
  }
  return strOf(d);
}

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

// Earliest start a task may have because of one link, for all four MS Project link types.
function linkStart(t, d, p, c) {
  const type = DEP_TYPES.includes(d.type) ? d.type : 'FS';
  const lag = d.lag || 0;
  const span = t.is_milestone || (t.duration || 0) <= 0 ? 0 : Math.max(t.duration, 1) - 1;
  if (type === 'FS') return shiftWork(nextWorkAfter(finishOf(p, c), c), lag, c);
  if (type === 'SS') return shiftWork(nextWork(p.start, c), lag, c);
  const f = shiftWork(type === 'FF' ? finishOf(p, c) : nextWork(p.start, c), lag, c);
  return shiftWork(f, -span, c);
}

const depsOf = (t) => {
  if (Array.isArray(t.deps)) return t.deps;
  try { return JSON.parse(t.deps || '[]'); } catch { return []; }
};

// Runs the schedule. Dependencies push tasks later but never pull them earlier,
// so a stored start behaves as a "start no earlier than" constraint.
// The same task list is scheduled again and again: once for the project card, again for the dashboard, again for the
// progress figures, again for the check. The answer depends only on the tasks and the working calendar, so the last few
// answers are kept under a key made from exactly those, and every caller gets its own copy to change as it likes.
const SCHED_KEEP = 6, SCHED_MAX_KEY = 3e6, schedMemo = new Map();
const copyRow = (t) => ({ ...t, deps: Array.isArray(t.deps) ? t.deps.map((d) => ({ ...d })) : t.deps });
function schedule(tasks, project) {
  let key = null;
  try { key = String(project.work_days || '') + '|' + String(project.holidays || '') + '|' + JSON.stringify(tasks); } catch (e) { key = null; }
  if (key && key.length <= SCHED_MAX_KEY) {
    const hit = schedMemo.get(key);
    if (hit) { schedMemo.delete(key); schedMemo.set(key, hit); return hit.map(copyRow); }
  } else key = null;
  const out = scheduleRaw(tasks, project);
  if (key) {
    schedMemo.set(key, out.map(copyRow));
    while (schedMemo.size > SCHED_KEEP) schedMemo.delete(schedMemo.keys().next().value);
  }
  return out;
}
function scheduleRaw(tasks, project) {
  const c = calendar(project);
  const byId = new Map();
  for (const t of tasks) byId.set(t.id, { ...t, deps: depsOf(t) });
  const children = new Map();
  for (const t of byId.values()) {
    if (t.parent_id && byId.has(t.parent_id)) {
      if (!children.has(t.parent_id)) children.set(t.parent_id, []);
      children.get(t.parent_id).push(t.id);
    }
  }
  const isSummary = (t) => children.has(t.id);

  const roll = (t) => {
    const kids = children.get(t.id).map((id) => byId.get(id));
    for (const k of kids) if (isSummary(k)) roll(k);
    let s = null, f = null, w = 0, p = 0;
    for (const k of kids) {
      const kf = finishOf(k, c);
      const ks = nextWork(k.start, c);
      if (!s || ks < s) s = ks;
      if (!f || kf > f) f = kf;
      // weight every leaf task by its duration, so a summary shows the same value as the dashboards
      if (isSummary(k)) { w += k._w || 0; p += k._p || 0; }
      else { const dur = Math.max(k.duration || 1, 1); w += dur; p += dur * (k.progress || 0); }
    }
    t._w = w; t._p = p;
    t.start = s;
    t.duration = countWork(s, f, c);
    t.progress = w ? Math.round(p / w) : 0;
  };

  const limit = tasks.length + 3;
  for (let iter = 0; iter < limit; iter++) {
    let changed = false;
    for (const t of byId.values()) {
      if (isSummary(t) || !t.start) continue;
      let s = nextWork(t.start, c);
      if (t.mode !== 'manual') {
        for (const d of t.deps) {
          const p = byId.get(d.id);
          if (!p || !p.start || p.id === t.id) continue;
          const cand = linkStart(t, d, p, c);
          if (cand > s) s = cand;
        }
      }
      if (s !== t.start) { t.start = s; changed = true; }
    }
    // roll() walks every summary below the one it is given, so only the top ones are started here (a summary whose
    // parent is missing counts as a top one). Rolling the lower ones again would only repeat the same sums.
    for (const t of byId.values()) if (isSummary(t) && (!t.parent_id || !byId.has(t.parent_id))) roll(t);
    if (!changed) break;
  }

  const out = [];
  for (const t of byId.values()) {
    t.summary = isSummary(t) ? 1 : 0;
    t.finish = t.start ? finishOf(t, c) : null;
    t.conflict = 0;
    out.push(t);
  }
  // a manual task keeps the dates you typed, so show when its links say it should start later
  for (const t of out) {
    if (t.mode !== 'manual' || t.summary || !t.start) continue;
    for (const d of t.deps) { const p = byId.get(d.id); if (p && p.start && p.id !== t.id && linkStart(t, d, p, c) > nextWork(t.start, c)) { t.conflict = 1; break; } }
  }

  // Driving path: walk back from the last finishing task through predecessors
  // that determine the start date.
  const leaves = out.filter((t) => !t.summary && t.start);
  const critical = new Set();
  if (leaves.length) {
    const maxF = leaves.reduce((m, t) => (t.finish > m ? t.finish : m), '');
    const walk = (t) => {
      if (critical.has(t.id)) return;
      critical.add(t.id);
      for (const d of t.deps) {
        const p = byId.get(d.id);
        if (!p || !p.start) continue;
        const cand = linkStart(t, d, p, c);
        if (cand === t.start) {
          p.finish = finishOf(p, c);
          walk(p);
        }
      }
    };
    for (const t of leaves) if (t.finish === maxF) walk(t);
  }
  for (const t of out) t.critical = critical.has(t.id) ? 1 : 0;
  return out;
}

// When links on a task change, it is rescheduled as soon as its links allow, like Microsoft Project.
// Returns the date to restart from, or null when the task should stay where it is.
function asapAnchor(tasks, project) {
  const c = calendar(project);
  const starts = tasks.filter((t) => t.start && !t.is_milestone).map((t) => t.start).sort();
  const base = project.start_date || starts[0];
  return base ? nextWork(base, c) : null;
}

// changes: { [taskId]: { start?, duration?, deps?, deleted? } }
function preview(tasks, project, changes) {
  const before = schedule(tasks, project);
  const beforeMap = new Map(before.map((t) => [t.id, t]));
  const modified = [];
  const deletedIds = new Set();
  for (const t of tasks) {
    const ch = changes[t.id];
    if (ch && ch.deleted) { deletedIds.add(t.id); continue; }
    modified.push(ch ? { ...t, ...ch } : { ...t });
  }
  for (const m of modified) {
    if (changes[m.id] && changes[m.id]._asap) m.start = changes[m.id]._asap;
    m.deps = depsOf(m).filter((d) => !deletedIds.has(d.id));
    if (m.parent_id && deletedIds.has(m.parent_id)) m.parent_id = null;
  }
  const after = schedule(modified, project);
  const impacts = [];
  const requested = [];
  for (const a of after) {
    const b = beforeMap.get(a.id);
    const direct = !!changes[a.id];
    const moved = !b || a.start !== b.start || a.finish !== b.finish;
    if (direct) {
      const want = changes[a.id];
      if (want.start && want.start !== a.start) {
        requested.push({ id: a.id, name: a.name, requested: want.start, actual: a.start });
      }
    }
    if (moved && !a.summary) {
      impacts.push({
        id: a.id,
        name: a.name,
        direct,
        before: b ? { start: b.start, finish: b.finish } : null,
        after: { start: a.start, finish: a.finish },
      });
    }
  }
  const beforeEnd = before.reduce((m, t) => (t.finish && t.finish > m ? t.finish : m), '');
  const afterEnd = after.reduce((m, t) => (t.finish && t.finish > m ? t.finish : m), '');
  return { impacts, constrained: requested, projectEnd: { before: beforeEnd, after: afterEnd }, result: after, deleted: [...deletedIds] };
}

// Baseline math
function plannedPercent(t, today, c) {
  if (!t.b_start || !t.b_end) return null;
  if (today < t.b_start) return 0;
  if (today >= t.b_end) return 100;
  const total = countWork(t.b_start, t.b_end, c);
  const done = countWork(t.b_start, today, c);
  return Math.min(100, Math.round((done / Math.max(total, 1)) * 100));
}

function progressMetrics(tasks, project, today) {
  const c = calendar(project);
  const sched = schedule(tasks, project).filter((t) => !t.summary);
  let w = 0, planned = 0, actual = 0, late = 0, base = 0;
  const rows = [];
  for (const t of sched) {
    const dur = Math.max(t.duration || 1, 1);
    w += dur;
    actual += dur * (t.progress || 0);
    const pp = plannedPercent(t, today, c);
    if (pp !== null) { planned += dur * pp; base++; }
    const variance = t.b_end ? countWork(t.b_end < t.finish ? t.b_end : t.finish, t.b_end < t.finish ? t.finish : t.b_end, c) - 1 : null;
    const slip = t.b_end ? (t.finish > t.b_end ? variance : t.finish < t.b_end ? -variance : 0) : null;
    const overdue = t.finish < today && (t.progress || 0) < 100;
    if (overdue) late++;
    rows.push({ ...t, plannedPct: pp, slipDays: slip, overdue });
  }
  const actualPct = w ? Math.round(actual / w) : 0;
  const plannedPct = base && w ? Math.round(planned / w) : null;
  const spi = plannedPct ? Math.round((actualPct / plannedPct) * 100) / 100 : null;
  return { actualPct, plannedPct, spi, overdue: late, taskCount: sched.length, rows };
}


// ---------- validation ----------
const MAX_LEVEL = 10;
function hierarchy(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = new Map();
  for (const t of tasks) if (t.parent_id && byId.has(t.parent_id)) { if (!kids.has(t.parent_id)) kids.set(t.parent_id, []); kids.get(t.parent_id).push(t.id); }
  const ancestors = (id) => { const out = new Set(); let p = byId.get(id) && byId.get(id).parent_id; let g = 0; while (p && byId.has(p) && g++ < 50) { out.add(p); p = byId.get(p).parent_id; } return out; };
  const level = (id) => ancestors(id).size + 1;
  return { byId, kids, ancestors, level };
}

// Would giving task `id` these predecessors create a loop?
function wouldLoop(tasks, id, deps, linkMap) {
  // linkMap lets a caller that checks every task share one map of the links instead of rebuilding it each time
  const map = linkMap || new Map(tasks.map((t) => [t.id, depsOf(t)]));
  const had = map.has(id), prev = map.get(id);
  map.set(id, deps);
  try {
    const seen = new Set();
    const dfs = (n) => {
      if (n === id) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      return (map.get(n) || []).some((d) => dfs(d.id));
    };
    return (deps || []).some((d) => d.id === id || dfs(d.id));
  } finally { if (linkMap) { if (had) map.set(id, prev); else map.delete(id); } }
}

// Returns a list of plain English problems with a proposed predecessor list. Empty means valid.
function validateLinks(tasks, id, deps, shared) {
  const H = (shared && shared.H) || hierarchy(tasks);
  const t = H.byId.get(id);
  const errs = [];
  if (!t) return ['Task not found'];
  if (H.kids.has(id) && (deps || []).length) errs.push('A summary task takes its dates from its sub tasks, so link its sub tasks instead');
  const seen = new Set();
  const anc = H.ancestors(id);
  for (const d of deps || []) {
    const p = H.byId.get(d.id);
    const label = p ? `"${p.name}"` : `task ${d.id}`;
    if (d.id === id) { errs.push('A task cannot depend on itself'); continue; }
    if (!p) { errs.push(`Predecessor ${label} does not exist`); continue; }
    if (seen.has(d.id)) errs.push(`${label} is linked twice`);
    seen.add(d.id);
    if (d.type && !DEP_TYPES.includes(d.type)) errs.push(`Link type "${d.type}" is not valid. Use FS, SS, FF or SF`);
    if (!Number.isFinite(Number(d.lag || 0)) || Math.abs(d.lag || 0) > 365) errs.push(`Lag for ${label} must be between -365 and 365 days`);
    if (anc.has(d.id) || H.ancestors(d.id).has(id)) errs.push(`${label} and this task are in the same branch, so they cannot be linked`);
  }
  if (!errs.length && wouldLoop(tasks, id, deps, shared && shared.links)) errs.push('That link would create a circular dependency');
  return errs;
}

// Whole schedule health check.
function validateSchedule(tasks, project) {
  const H = hierarchy(tasks);
  const issues = [];
  const add = (severity, task, code, message) => issues.push({ severity, task_id: task ? task.id : null, task: task ? task.name : null, code, message });
  const succ = new Map();
  for (const t of tasks) for (const d of depsOf(t)) { if (!succ.has(d.id)) succ.set(d.id, []); succ.get(d.id).push(t.id); }
  // the outline and the map of links are the same for every task, so they are built once for the whole check
  const shared = { H, links: new Map(tasks.map((t) => [t.id, depsOf(t)])) };
  for (const t of tasks) {
    const deps = depsOf(t);
    for (const e of validateLinks(tasks, t.id, deps, shared)) add('error', t, 'link', e);
    if (H.level(t.id) > MAX_LEVEL) add('error', t, 'depth', `Nested deeper than ${MAX_LEVEL} levels`);
    if (!t.is_milestone && !H.kids.has(t.id) && (t.duration || 0) <= 0) add('warn', t, 'duration', 'No duration. Set a duration or mark it as a milestone');
    if (!t.start) add('warn', t, 'start', 'No start date');
  }
  const leaves = tasks.filter((t) => !H.kids.has(t.id));
  if (leaves.length > 1) for (const t of leaves) if (!depsOf(t).length && !succ.has(t.id)) add('info', t, 'unlinked', 'Not linked to any other task');
  if (project && project.end_date) {
    const c = calendar(project);
    for (const t of schedule(tasks, project)) if (!t.summary && t.start && t.finish > project.end_date) add('warn', t, 'late', `Finishes ${t.finish}, after the contract end ${project.end_date}`);
  }
  const rank = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return issues;
}


// Full schedule check: logic, links to deliverables, payments, requirements and risks, and overall health.
// ctx = { items: [{id,kind,title,state,status,data}], today, hasBaseline }
function checkSchedule(tasks, project, ctx = {}) {
  const base = validateSchedule(tasks, project).filter((i) => i.code !== 'unlinked');
  const issues = base.map((i) => ({ ...i, params: i.params || {} }));
  const items = (ctx.items || []).filter((i) => i.status !== 'ignored');
  const today = ctx.today || null;
  const add = (severity, task, code, params = {}, extra = {}) => issues.push({ severity, task_id: task ? task.id : null, task: task ? task.name : null, code, params, ...extra });
  const comp = schedule(tasks, project);
  const by = new Map(comp.map((t) => [t.id, t]));
  const leaves = comp.filter((t) => !t.summary);
  const succ = new Map();
  for (const t of tasks) for (const d of depsOf(t)) { if (!succ.has(d.id)) succ.set(d.id, []); succ.get(d.id).push(t.id); }
  const startOf = leaves.reduce((m, t) => (t.start && (!m || t.start < m) ? t.start : m), null);
  const endOf = leaves.reduce((m, t) => (t.finish && (!m || t.finish > m) ? t.finish : m), null);

  // ----- logic -----
  let withPred = 0, withSucc = 0;
  for (const t of leaves) {
    const hasP = depsOf(t).length > 0;
    const hasS = succ.has(t.id);
    if (hasP) withPred++; if (hasS) withSucc++;
    if (leaves.length < 2) continue;
    if (!hasP && !hasS) add('warn', t, 'isolated');
    else if (!hasP && t.start > startOf) add('warn', t, 'no_pred');
    else if (!hasS && t.finish < endOf) add('warn', t, 'no_succ');
    if (t.is_milestone && (t.duration || 0) > 0) add('warn', t, 'milestone_duration');
    for (const d of depsOf(t)) {
      if ((d.lag || 0) > 30) add('info', t, 'long_lag', { lag: d.lag });
      if ((d.lag || 0) < 0 && d.type === 'FS') add('info', t, 'negative_lag', { lag: d.lag });
    }
    if (t.conflict) add('warn', t, 'conflict');
    if (today && t.finish && t.finish < today && (t.progress || 0) < 100) add('warn', t, 'overdue', { pct: t.progress || 0, finish: t.finish });
    if (today && t.start && t.start < today && !t.progress && t.finish >= today) add('info', t, 'not_started', { start: t.start });
    if ((t.progress || 0) >= 100) for (const d of depsOf(t)) { const p = by.get(d.id); if (p && !p.summary && (p.progress || 0) < 100) { add('info', t, 'out_of_sequence', { pred: p.name }); break; } }
  }
  const noOwner = leaves.filter((t) => !t.assignee && (t.progress || 0) < 100);
  if (noOwner.length) add('info', null, 'no_owner', { count: noOwner.length });

  // ----- links to deliverables, payments, requirements, risks -----
  const linksOf = (t) => new Set([...(t.deliverable_id ? [t.deliverable_id] : []), ...(Array.isArray(t.links) ? t.links : [])]);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const tasksOfItem = new Map();
  for (const t of tasks) for (const id of linksOf(t)) { if (!tasksOfItem.has(id)) tasksOfItem.set(id, []); tasksOfItem.get(id).push(t); }
  for (const t of tasks) for (const id of linksOf(t)) if (!itemsById.has(id)) add('warn', t, 'broken_link', { item: id });
  const dataOf = (i) => (typeof i.data === 'string' ? (() => { try { return JSON.parse(i.data); } catch { return {}; } })() : i.data || {});
  const covered = (i) => {
    if ((tasksOfItem.get(i.id) || []).length) return true;
    if (i.kind === 'milestone') { const dv = dataOf(i).deliverable_id; return !!(dv && (tasksOfItem.get(Number(dv)) || []).length); }
    return false;
  };
  const kinds = { deliverable: 'del_unlinked', milestone: 'pay_unlinked', requirement: 'req_unlinked', risk: 'risk_unlinked' };
  const cov = {};
  for (const [kind, code] of Object.entries(kinds)) {
    let list = items.filter((i) => i.kind === kind);
    if (kind === 'milestone') list = list.filter((i) => i.state === 'pending');
    if (kind === 'deliverable') list = list.filter((i) => i.state !== 'closed');
    if (kind === 'risk') list = list.filter((i) => i.state !== 'closed' && i.state !== 'mitigated' && i.state !== 'transferred');
    let ok = 0;
    for (const i of list) { if (covered(i)) ok++; else add(kind === 'risk' ? 'info' : 'warn', null, code, { title: i.title }, { item_id: i.id, item_title: i.title, kind }); }
    cov[kind] = { total: list.length, linked: ok };
  }
  // payment due before the work behind it finishes
  for (const i of items.filter((x) => x.kind === 'milestone' && x.state === 'pending')) {
    const due = dataOf(i).due_date; if (!due) continue;
    const ts = [...(tasksOfItem.get(i.id) || []), ...(dataOf(i).deliverable_id ? tasksOfItem.get(Number(dataOf(i).deliverable_id)) || [] : [])];
    const fin = ts.map((t) => by.get(t.id)).filter(Boolean).reduce((m, t) => (t.finish && (!m || t.finish > m) ? t.finish : m), null);
    if (fin && fin > due) add('warn', null, 'pay_late_work', { title: i.title, due, finish: fin }, { item_id: i.id, item_title: i.title, kind: 'milestone' });
  }
  // deliverable state against the tasks behind it
  for (const i of items.filter((x) => x.kind === 'deliverable')) {
    const ts = (tasksOfItem.get(i.id) || []).map((t) => by.get(t.id)).filter(Boolean).filter((t) => !t.summary);
    if (!ts.length) continue;
    const done = ts.every((t) => (t.progress || 0) >= 100);
    if (i.state === 'closed' && !done) add('warn', null, 'closed_open_tasks', { title: i.title }, { item_id: i.id, item_title: i.title, kind: 'deliverable' });
    if (i.state !== 'closed' && done) add('info', null, 'ready_to_close', { title: i.title }, { item_id: i.id, item_title: i.title, kind: 'deliverable' });
  }

  // ----- overall -----
  if (project && project.end_date && endOf && endOf > project.end_date) add('error', null, 'over_contract', { finish: endOf, end: project.end_date });
  if (!ctx.hasBaseline && leaves.length > 4) add('info', null, 'no_baseline');
  const crit = leaves.filter((t) => t.critical).length;
  if (leaves.length > 6 && crit / leaves.length > 0.6) add('info', null, 'too_critical', { pct: Math.round(crit / leaves.length * 100) });
  const rank = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const n = leaves.length || 1;
  const count = (sev) => issues.filter((i) => i.severity === sev).length;
  const pen = count('error') * 12 + Math.min(40, count('warn') * 2) + Math.min(10, count('info') * 0.5);
  const stats = {
    tasks: leaves.length, with_pred: withPred, with_succ: withSucc, critical: crit, start: startOf, finish: endOf, contract_end: project && project.end_date || null,
    coverage: cov, logic_ok: leaves.length < 2 ? 100 : Math.round(100 * leaves.filter((t) => (depsOf(t).length || t.start <= startOf) && (succ.has(t.id) || t.finish >= endOf)).length / n),
    score: Math.max(0, Math.round(100 - pen)),
  };
  return { issues, stats, errors: count('error'), warnings: count('warn'), infos: count('info') };
}

module.exports = {
  checkSchedule, asapAnchor, wouldLoop, validateLinks, validateSchedule, hierarchy, MAX_LEVEL,
  parse, fmt, addDays, calendar, isWork, nextWork, nextWorkAfter, addWork, countWork,
  finishOf, schedule, preview, shiftWork, linkStart, DEP_TYPES, progressMetrics, plannedPercent, depsOf,
};
;return module.exports})();
window.__Radar=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return {}};
// Risk radar: turns risks, late work, money and review backlogs into one ranked list.
// Pure functions so the server and the browser demo share the same scoring.
const LV = { High: 3, Medium: 2, Low: 1 };
const sevOf = (score) => (score >= 6 ? 'high' : score >= 3 ? 'med' : 'low');
// Which part of the project a signal belongs to, used by the radar's dimension chart.
const DIMS = ['schedule', 'financial', 'scope', 'resources', 'technical', 'governance'];
function dimOf(x) {
  if (x.type === 'overdue' || x.type === 'behind' || x.type === 'forecast') return 'schedule';
  if (x.type === 'payment') return 'financial';
  if (x.type === 'review' || x.type === 'updates') return 'governance';
  const t = `${x.title} ${x.mitigation || ''}`.toLowerCase();
  if (/scope|requirement|change|creep|ambigu/.test(t)) return 'scope';
  if (/cost|budget|payment|invoice|financ|penalt|currency|price/.test(t)) return 'financial';
  if (/resource|staff|team|availab|skill|ramadan|leave|turnover|capacity/.test(t)) return 'resources';
  if (/integration|technical|security|hosting|infrastructure|performance|data|api|access|system|identity|sandbox|migration|quality|test/.test(t)) return 'technical';
  if (/delay|late|schedule|timeline|deadline|dependen/.test(t)) return 'schedule';
  return 'governance';
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function buildRadar(entries, today) {
  const items = [];
  const add = (o) => items.push({ ...o, sev: sevOf(o.score), dim: dimOf(o) });
  for (const { p, items: its, rows, stats } of entries) {
    const base = { project_id: p.id, project: p.name };
    for (const i of its) {
      if (i.kind === 'risk' && i.status !== 'ignored' && (i.state || 'open') === 'open') {
        const probability = i.data.probability || 'Medium', impact = i.data.impact || 'Medium';
        add({ ...base, key: `risk-${i.id}`, type: 'risk', title: i.title, mitigation: i.data.mitigation || '', probability, impact, score: (LV[probability] || 2) * (LV[impact] || 2), item_id: i.id, state: i.state, unconfirmed: i.status === 'proposed', issue: !!i.data.issue });
      }
      if (i.kind === 'milestone' && i.status !== 'ignored' && i.state !== 'paid' && i.data.due_date) {
        const amount = i.data.amount ?? (i.data.percent != null && p.value ? Math.round((p.value * i.data.percent) / 100) : null);
        const late = days(i.data.due_date, today);
        if (late > 0) add({ ...base, key: `pay-${i.id}`, type: 'payment', title: i.title, due: i.data.due_date, late_days: late, amount, currency: p.currency, item_id: i.id, state: i.state, score: late > 14 ? 9 : 6 });
        else if (late >= -14 && i.state === 'pending') add({ ...base, key: `pay-${i.id}`, type: 'payment', title: i.title, due: i.data.due_date, late_days: late, amount, currency: p.currency, item_id: i.id, state: i.state, score: 3 });
      }
    }
    for (const r of rows || []) {
      if (!r.overdue) continue;
      const late = days(r.finish, today);
      add({ ...base, key: `task-${r.id}`, type: 'overdue', title: r.name, task_id: r.id, late_days: late, progress: r.progress || 0, assignee: r.assignee || null, score: late > 14 ? 9 : 6 });
    }
    if (stats.spi != null && stats.spi < 0.95) add({ ...base, key: `spi-${p.id}`, type: 'behind', title: p.name, spi: stats.spi, progress: stats.progress, planned: stats.planned, score: stats.spi < 0.8 ? 9 : 6 });
    if (stats.forecast_end && p.end_date && stats.forecast_end > p.end_date) {
      const late = days(p.end_date, stats.forecast_end);
      add({ ...base, key: `end-${p.id}`, type: 'forecast', title: p.name, forecast_end: stats.forecast_end, contract_end: p.end_date, late_days: late, score: late > 14 ? 9 : 6 });
    }
    if (stats.pendingItems > 0) add({ ...base, key: `review-${p.id}`, type: 'review', title: p.name, count: stats.pendingItems, score: 3 });
    if (stats.pendingInbox > 0) add({ ...base, key: `updates-${p.id}`, type: 'updates', title: p.name, count: stats.pendingInbox, score: 3 });
  }
  const order = { risk: 0, overdue: 1, payment: 2, forecast: 3, behind: 4, review: 5, updates: 6 };
  items.sort((a, b) => b.score - a.score || order[a.type] - order[b.type] || a.title.localeCompare(b.title));
  return { items, counts: { high: items.filter((x) => x.sev === 'high').length, med: items.filter((x) => x.sev === 'med').length, low: items.filter((x) => x.sev === 'low').length } };
}

module.exports = { buildRadar, sevOf, DIMS };
;return module.exports})();
window.__Analytics=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return window.__Sched};
// Portfolio analytics for the overview dashboard. Pure functions shared by the server and the browser demo.
const S = require('./schedule');

function buildAnalytics(entries, today) {
  const health = { green: 0, amber: 0, red: 0 };
  const projects = [];
  const timeline = [];
  const money = {};
  const owners = new Map();
  const deliverables = [];
  const status = { done: 0, active: 0, todo: 0, late: 0 };
  let min = null, max = null;

  for (const { p, stats, items, rows, sched } of entries) {
    health[stats.health] = (health[stats.health] || 0) + 1;
    projects.push({ id: p.id, name: p.name, client: p.client || '', progress: stats.progress, planned: stats.planned, health: stats.health, spi: stats.spi, overdue: stats.overdue, value: p.value || 0, currency: p.currency || '' });

    // workload and status come from leaf tasks
    for (const r of rows || []) {
      const st = (r.progress || 0) >= 100 ? 'done' : r.overdue ? 'late' : (r.progress || 0) > 0 ? 'active' : 'todo';
      status[st]++;
      const who = r.assignee || 'Unassigned';
      if (!owners.has(who)) owners.set(who, { name: who, done: 0, active: 0, todo: 0, late: 0, total: 0 });
      const o = owners.get(who);
      o[st]++; o.total++;
    }

    // timeline: phases are the children of a single root summary, otherwise the top level rows
    const all = sched || [];
    const byParent = new Map();
    for (const t of all) { const k = t.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(t); }
    const order = (a, b) => (a.position - b.position) || (a.id - b.id);
    let level = (byParent.get(0) || []).sort(order);
    if (level.length === 1 && level[0].summary) level = (byParent.get(level[0].id) || []).sort(order);
    const phases = level.filter((t) => t.start && t.finish).slice(0, 8).map((t) => ({ id: t.id, name: t.name, start: t.start, finish: t.finish, progress: t.progress || 0, summary: !!t.summary }));
    const leafs = all.filter((t) => !t.summary && t.start && t.finish);
    const start = leafs.length ? leafs.reduce((m, t) => (t.start < m ? t.start : m), leafs[0].start) : p.start_date;
    const forecast = leafs.length ? leafs.reduce((m, t) => (t.finish > m ? t.finish : m), leafs[0].finish) : p.end_date;
    const pays = (items || []).filter((i) => i.kind === 'milestone' && i.status !== 'ignored' && i.data && i.data.due_date).map((i) => {
      const amount = i.data.amount ?? (i.data.percent != null && p.value ? Math.round((p.value * i.data.percent) / 100) : null);
      return { title: i.title, due: i.data.due_date, state: i.state || 'pending', amount };
    });
    for (const x of pays) {
      const cur = p.currency || '';
      if (!money[cur]) money[cur] = { currency: cur, paid: 0, invoiced: 0, pending: 0, late: 0, total: 0 };
      const m = money[cur];
      const amt = x.amount || 0;
      const bucket = x.state === 'paid' ? 'paid' : x.state === 'invoiced' ? 'invoiced' : x.due < today ? 'late' : 'pending';
      m[bucket] += amt; m.total += amt;
    }
    const d = (items || []).filter((i) => i.kind === 'deliverable' && i.status !== 'ignored');
    deliverables.push({ id: p.id, name: p.name, open: d.filter((i) => i.state !== 'closed').length, closed: d.filter((i) => i.state === 'closed').length });
    for (const v of [start, p.start_date]) if (v && (!min || v < min)) min = v;
    for (const v of [forecast, p.end_date]) if (v && (!max || v > max)) max = v;
    timeline.push({ id: p.id, name: p.name, health: stats.health, progress: stats.progress, planned: stats.planned, start, forecast, contract_end: p.end_date || null, phases, payments: pays.filter((x) => x.due).slice(0, 12), currency: p.currency || '' });
  }
  return {
    health, projects, status,
    timeline: { min, max, today, projects: timeline },
    payments: Object.values(money),
    workload: [...owners.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    workloadTotal: owners.size,
    deliverables,
  };
}

module.exports = { buildAnalytics };
;return module.exports})();
window.__Portfolio=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return {}};
'use strict';
// Sample portfolio used by `npm run seed` and by the browser demo.
// Five extra projects, each in its own currency. Dates are relative to the day you run it.

const add = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// leaf: [name, workdays, progress, owner, flags] where flags can be 'par' (runs beside the previous task) or 'ms' (milestone)
const L = (n, d, p, a, f) => ({ n, d, p, a, f });
const G = (n, ...kids) => ({ n, kids });


// A large program: 8 phases x 6 work packages x 22 tasks, plus phase gates (1,100+ rows in total).
function bigProgram() {
  const phases = ['Mobilization', 'Requirements', 'Architecture', 'Core build', 'Integration', 'Testing', 'Pilot', 'Rollout'];
  const packages = ['Signalling', 'Ticketing', 'Passenger information', 'Control center', 'Data platform', 'Cyber security'];
  const verbs = ['Plan', 'Specify', 'Design', 'Review', 'Build', 'Configure', 'Integrate', 'Test', 'Fix defects', 'Document', 'Approve'];
  const owners = ['Omar Haddad', 'Sara Mitchell', 'Daniel Ortiz', 'Mei Lin', 'Yusuf Karim', 'Hannah Weber', 'Ali Rahman', 'Priya Nair'];
  const out = []; let n = 0, gate = null;
  const root = ++n; out.push({ lid: root, parent: null, name: 'Gulf Rail Digital Backbone', depth: 0, summary: true });
  phases.forEach((ph, pi) => {
    const pid = ++n; out.push({ lid: pid, parent: root, name: `Phase ${pi + 1}: ${ph}`, depth: 1, summary: true });
    const lasts = [];
    packages.forEach((pk, ki) => {
      const wid = ++n; out.push({ lid: wid, parent: pid, name: `${pk} (${ph.toLowerCase()})`, depth: 2, summary: true });
      let prev = gate;
      for (let k = 0; k < 22; k++) {
        const id = ++n;
        const done = pi < 2 || (pi === 2 && k < 13);
        const progress = done ? 100 : pi === 2 && k === 13 ? 60 : 0;
        out.push({ lid: id, parent: wid, name: `${verbs[k % 11]} ${pk.toLowerCase()} ${k < 11 ? 'baseline' : 'release'}`, depth: 3, duration: 1 + ((k + ki + pi) % 3), progress, assignee: owners[(k + ki * 3 + pi) % owners.length], milestone: false, deps: prev ? [prev] : [] });
        prev = id;
      }
      lasts.push(prev);
    });
    const g = ++n;
    out.push({ lid: g, parent: pid, name: `Gate ${pi + 1}: ${ph} accepted`, depth: 2, duration: 0, progress: pi < 2 ? 100 : 0, assignee: 'Omar Haddad', milestone: true, deps: lasts });
    gate = g;
  });
  return out;
}

// Connect deliverables, payments and risks to the tasks that deliver them, by matching words in the titles.
// Some are left unlinked on purpose so the schedule check has something to report.
const STOP = new Set(['report', 'document', 'release', 'plan', 'accepted', 'acceptance', 'complete', 'final', 'with', 'and', 'the', 'for', 'sign', 'pack', 'delayed', 'not', 'ready', 'below', 'target']);
const words = (x) => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
function best(title, list, key) {
  const w = new Set(words(title)); let top = null, score = 0;
  for (const it of list) { const n = words(key(it)).filter((x) => w.has(x)).length; if (n > score) { score = n; top = it; } }
  return top;
}
function linkSpec(p) {
  const leaves = p.tasks.filter((t) => !t.summary);
  p.deliverables.forEach((d) => { const t = best(d.title, leaves, (x) => x.name); if (t) d.task = t.lid; });
  p.payments.forEach((m) => {
    const di = p.deliverables.findIndex((d) => d === best(m.title, p.deliverables, (x) => x.title));
    if (di >= 0) m.deliv = di;
    else { const t = best(m.title, leaves, (x) => x.name) || (/acceptance|go live/i.test(m.title) ? leaves.filter((x) => x.milestone).pop() : null); if (t) m.task = t.lid; }
  });
  p.risks.forEach((r, i) => { const t = best(r.title + ' ' + r.mitigation, leaves, (x) => x.name); if (t && i % 2 === 0) r.task = t.lid; });
}

function build(today) {
  const D = (n) => add(today, n);
  const projects = [
    {
      name: 'Fleet Telematics Platform', code: 'MOT-FTP-01', client: 'Ministry of Transport', currency: 'SAR', value: 4800000, start: D(-110), end: D(150),
      team: [['Khalid Mansour', 'Project Manager'], ['Reem Alotaibi', 'Solution Architect'], ['Faisal Qahtani', 'Lead Developer'], ['Noura Saad', 'QA Lead']],
      tree: G('Fleet Telematics Platform',
        G('Initiation', L('Kickoff and charter', 3, 100, 'Khalid Mansour'), L('Stakeholder workshops', 8, 100, 'Reem Alotaibi')),
        G('Design', G('Architecture', L('Platform architecture', 10, 100, 'Reem Alotaibi'), L('Device protocol specification', 7, 100, 'Faisal Qahtani')), L('UX prototypes', 8, 90, 'Noura Saad')),
        G('Build', G('Core services', L('Telemetry ingestion service', 45, 70, 'Faisal Qahtani'), L('Alerts and rules engine', 14, 0, 'Faisal Qahtani')), L('Fleet dashboard', 50, 45, 'Reem Alotaibi', 'par'), L('Driver mobile app', 55, 15, 'Noura Saad', 'par')),
        G('Launch', L('User acceptance testing', 10, 0, 'Noura Saad'), L('Operator training', 5, 0, 'Khalid Mansour'), L('Go live', 0, 0, 'Khalid Mansour', 'ms'))),
      payments: [['Advance payment', 20, -108, 'paid'], ['Design sign off', 20, -45, 'paid'], ['Core services delivered', 25, 12, 'invoiced'], ['User acceptance', 20, 95, 'pending'], ['Final acceptance', 15, 150, 'pending']],
      risks: [['Vehicle device firmware not ready for pilot', 'Medium', 'High', 'Agree a pilot fleet and firmware freeze date'], ['Data residency approval delayed', 'Low', 'High', 'Submit the hosting request before design sign off']],
      deliverables: [['Architecture document', -90, 'closed'], ['Fleet dashboard release 1', 40, 'open'], ['Training pack', 120, 'open']],
    },
    {
      name: 'National e-Archive', code: 'KGA-ARC-02', client: 'Kuwait Government Authority', currency: 'KWD', value: 620000, start: D(-75), end: D(240),
      team: [['Fatima Al Sabah', 'Project Manager'], ['Yousef Al Ali', 'Technical Lead'], ['Dana Al Rashed', 'Business Analyst'], ['Hamad Al Mutairi', 'QA Lead']],
      tree: G('National e-Archive',
        G('Discovery', L('Records inventory', 15, 100, 'Dana Al Rashed'), L('Retention policy mapping', 10, 60, 'Dana Al Rashed')),
        G('Platform', G('Repository', L('Storage and indexing design', 12, 40, 'Yousef Al Ali'), L('Ingestion pipeline', 25, 5, 'Yousef Al Ali')), L('Search and retrieval', 18, 0, 'Hamad Al Mutairi'), L('Access control and audit', 12, 0, 'Yousef Al Ali', 'par')),
        G('Migration', L('Pilot migration wave', 15, 0, 'Hamad Al Mutairi'), L('Full migration waves', 40, 0, 'Fatima Al Sabah')),
        G('Close out', L('Handover and training', 8, 0, 'Fatima Al Sabah'), L('Final acceptance', 0, 0, 'Fatima Al Sabah', 'ms'))),
      payments: [['Advance payment', 15, -70, 'paid'], ['Inventory report accepted', 15, -20, 'invoiced'], ['Pilot migration complete', 25, 120, 'pending'], ['Final acceptance', 45, 240, 'pending']],
      risks: [['Scanned records quality below target', 'High', 'Medium', 'Add an image quality gate to the ingestion pipeline'], ['Retention rules not signed off', 'High', 'High', 'Escalate to the steering committee this month']],
      deliverables: [['Records inventory report', -30, 'closed'], ['Retention policy matrix', 5, 'open'], ['Pilot migration report', 125, 'open']],
    },
    {
      name: 'Smart Courts Case Tracker', code: 'QMJ-SCT-03', client: 'Qatar Ministry of Justice', currency: 'QAR', value: 3150000, start: D(-150), end: D(30),
      team: [['Mariam Al Thani', 'Project Manager'], ['Hassan Al Kuwari', 'Technical Lead'], ['Aisha Al Naimi', 'Business Analyst'], ['Omar Al Mohannadi', 'QA Lead']],
      tree: G('Smart Courts Case Tracker',
        G('Plan', L('Project plan and governance', 5, 100, 'Mariam Al Thani'), L('Requirements baseline', 12, 100, 'Aisha Al Naimi')),
        G('Build', L('Case workflow engine', 40, 100, 'Hassan Al Kuwari'), L('Hearing scheduler', 25, 100, 'Hassan Al Kuwari'), L('Citizen portal', 30, 100, 'Aisha Al Naimi', 'par'), L('Reporting module', 20, 100, 'Omar Al Mohannadi')),
        G('Deploy', L('Security testing', 12, 60, 'Omar Al Mohannadi'), L('Court staff training', 8, 0, 'Mariam Al Thani'), L('Go live', 0, 0, 'Mariam Al Thani', 'ms'))),
      payments: [['Advance payment', 20, -145, 'paid'], ['Requirements accepted', 15, -120, 'paid'], ['Workflow engine accepted', 25, -50, 'paid'], ['Portal accepted', 20, -10, 'paid'], ['Go live', 20, 30, 'pending']],
      risks: [['Court staff availability for training', 'Medium', 'Medium', 'Book sessions with the registrar office early']],
      deliverables: [['Workflow engine', -55, 'closed'], ['Citizen portal', -12, 'closed'], ['Training material', 18, 'open']],
    },
    {
      name: 'Citizen Service Chatbot', code: 'JDE-CSB-04', client: 'Ministry of Digital Economy', currency: 'JOD', value: 410000, start: D(21), end: D(210),
      team: [['Lina Haddad', 'Project Manager'], ['Tariq Nasser', 'AI Engineer'], ['Rana Khoury', 'Business Analyst'], ['Samer Odeh', 'QA Lead']],
      tree: G('Citizen Service Chatbot',
        G('Mobilize', L('Kickoff and planning', 4, 0, 'Lina Haddad'), L('Service catalog analysis', 12, 0, 'Rana Khoury')),
        G('Build', L('Arabic intent model', 25, 0, 'Tariq Nasser'), L('Knowledge base integration', 18, 0, 'Tariq Nasser'), L('Voice channel', 15, 0, 'Samer Odeh', 'par'), L('Admin console', 14, 0, 'Rana Khoury')),
        G('Release', L('Pilot with 3 services', 12, 0, 'Samer Odeh'), L('National rollout', 20, 0, 'Lina Haddad'), L('Final acceptance', 0, 0, 'Lina Haddad', 'ms'))),
      payments: [['Advance payment', 25, 25, 'pending'], ['Model accepted', 25, 100, 'pending'], ['Pilot accepted', 25, 150, 'pending'], ['Final acceptance', 25, 210, 'pending']],
      risks: [['Service owners slow to share content', 'Medium', 'Medium', 'Appoint a content owner per service at kickoff']],
      deliverables: [['Service catalog report', 40, 'open'], ['Pilot report', 150, 'open']],
    },
    {
      name: 'Records Migration Program', code: 'OMN-RMP-05', client: 'Oman National Records Authority', currency: 'OMR', value: 540000, start: D(-40), end: D(120),
      team: [['Salim Al Harthy', 'Project Manager'], ['Badriya Al Busaidi', 'Technical Lead'], ['Khalfan Al Rawahi', 'Data Analyst'], ['Huda Al Lawati', 'QA Lead']],
      tree: G('Records Migration Program',
        G('Prepare', L('Data profiling', 10, 100, 'Khalfan Al Rawahi'), L('Mapping rules', 12, 90, 'Khalfan Al Rawahi')),
        G('Migrate', G('Wave 1', L('Wave 1 load', 10, 50, 'Badriya Al Busaidi'), L('Wave 1 validation', 6, 10, 'Huda Al Lawati')), G('Wave 2', L('Wave 2 load', 12, 0, 'Badriya Al Busaidi'), L('Wave 2 validation', 6, 0, 'Huda Al Lawati'))),
        G('Close', L('Reconciliation report', 6, 0, 'Salim Al Harthy'), L('Sign off', 0, 0, 'Salim Al Harthy', 'ms'))),
      payments: [['Advance payment', 20, -38, 'paid'], ['Mapping rules accepted', 20, -2, 'invoiced'], ['Wave 1 complete', 30, 35, 'pending'], ['Final sign off', 30, 120, 'pending']],
      risks: [['Legacy data owners unavailable', 'Medium', 'High', 'Name a data owner per system in the project charter']],
      deliverables: [['Data profiling report', -20, 'closed'], ['Mapping rules', 0, 'open'], ['Reconciliation report', 110, 'open']],
    },
    {
      name: 'Gulf Rail Digital Backbone', code: 'GRA-DBB-06', client: 'Gulf Rail Authority', currency: 'USD', value: 18500000, start: D(-170), end: D(360),
      team: [['Omar Haddad', 'Program Director'], ['Sara Mitchell', 'Delivery Manager'], ['Daniel Ortiz', 'Chief Architect'], ['Mei Lin', 'QA Lead']],
      big: true,
      payments: [['Advance payment', 10, -168, 'paid'], ['Phase 2 accepted', 15, -50, 'paid'], ['Phase 3 accepted', 15, 20, 'invoiced'], ['Phase 5 accepted', 20, 140, 'pending'], ['Pilot accepted', 20, 250, 'pending'], ['Final acceptance', 20, 360, 'pending']],
      risks: [['Track access windows shorter than planned', 'High', 'High', 'Book night possessions for the whole pilot at the start of phase 4'], ['Signalling vendor delivery slips', 'Medium', 'High', 'Hold weekly vendor reviews and keep a second source approved'], ['Cyber security certification delayed', 'Medium', 'Medium', 'Start the certification pre assessment during design']],
      deliverables: [['Architecture baseline', -40, 'closed'], ['Control center release 1', 60, 'open'], ['Integration test report', 180, 'open'], ['Pilot readiness review', 240, 'open']],
    },
    {
      name: 'Smart Grid Metering', code: 'BUA-SGM-07', client: 'Bahrain Utilities Authority', currency: 'BHD', value: 1200000, start: D(-90), end: D(150),
      team: [['Jassim Al Khalifa', 'Project Manager'], ['Noor Al Zayani', 'Solution Architect'], ['Ebrahim Fakhro', 'Field Lead'], ['Layla Janahi', 'QA Lead']],
      tree: G('Smart Grid Metering',
        G('Prepare', L('Site survey', 12, 100, 'Ebrahim Fakhro'), L('Meter specification', 8, 100, 'Noor Al Zayani')),
        G('Deploy', L('Pilot district install', 25, 100, 'Ebrahim Fakhro'), L('Data collection platform', 30, 80, 'Noor Al Zayani', 'par'), L('District 2 to 5 install', 40, 25, 'Ebrahim Fakhro')),
        G('Operate', L('Billing integration', 20, 0, 'Noor Al Zayani'), L('Customer portal', 15, 0, 'Layla Janahi', 'par'), L('Handover', 5, 0, 'Jassim Al Khalifa'), L('Final acceptance', 0, 0, 'Jassim Al Khalifa', 'ms'))),
      payments: [['Advance payment', 20, -88, 'paid'], ['Pilot accepted', 30, -15, 'paid'], ['District rollout', 30, 80, 'pending'], ['Final acceptance', 20, 150, 'pending']],
      risks: [['Meter supply delay at port', 'Medium', 'High', 'Order the second batch before pilot sign off']],
      deliverables: [['Pilot report', -14, 'closed'], ['Billing integration spec', 40, 'open']],
    },
    {
      name: 'Health Records Exchange', code: 'EHD-HRX-08', client: 'European Health Data Office', currency: 'EUR', value: 2750000, start: D(-30), end: D(300),
      team: [['Elena Rossi', 'Project Manager'], ['Lukas Meyer', 'Integration Lead'], ['Sofia Petrova', 'Compliance Lead'], ['Marc Dubois', 'QA Lead']],
      tree: G('Health Records Exchange',
        G('Foundation', L('Privacy impact assessment', 15, 100, 'Sofia Petrova'), L('Interoperability design', 20, 70, 'Lukas Meyer')),
        G('Build', G('Core exchange', L('Patient index service', 30, 0, 'Lukas Meyer'), L('Consent management', 25, 0, 'Sofia Petrova')), L('Hospital connectors', 40, 0, 'Lukas Meyer', 'par')),
        G('Adopt', L('Pilot hospitals', 20, 0, 'Marc Dubois'), L('Regional rollout', 45, 0, 'Elena Rossi'), L('Final acceptance', 0, 0, 'Elena Rossi', 'ms'))),
      payments: [['Advance payment', 15, -28, 'paid'], ['Design approved', 20, 20, 'pending'], ['Core exchange live', 30, 140, 'pending'], ['Pilot accepted', 20, 220, 'pending'], ['Final acceptance', 15, 300, 'pending']],
      risks: [['Consent rules differ between regions', 'High', 'Medium', 'Model consent per region in the design phase']],
      deliverables: [['Privacy impact assessment', -10, 'closed'], ['Interoperability design', 12, 'open'], ['Pilot report', 230, 'open']],
    },
    {
      name: 'Public Transport App', code: 'MCC-PTA-09', client: 'Metro City Council', currency: 'GBP', value: 960000, start: D(-120), end: D(-5),
      team: [['Oliver Grant', 'Project Manager'], ['Amelia Hughes', 'Mobile Lead'], ['Harry Collins', 'Backend Lead'], ['Grace Bennett', 'QA Lead']],
      tree: G('Public Transport App',
        G('Discover', L('User research', 10, 100, 'Grace Bennett'), L('Journey planner design', 12, 100, 'Amelia Hughes')),
        G('Build', L('Mobile app', 35, 100, 'Amelia Hughes'), L('Live arrivals service', 25, 100, 'Harry Collins', 'par'), L('Ticketing integration', 20, 100, 'Harry Collins')),
        G('Launch', L('Beta with 2,000 riders', 12, 100, 'Grace Bennett'), L('Public launch', 0, 100, 'Oliver Grant', 'ms'))),
      payments: [['Advance payment', 20, -118, 'paid'], ['App beta accepted', 40, -40, 'paid'], ['Public launch', 30, -5, 'paid'], ['Warranty release', 10, 25, 'pending']],
      risks: [['Ridership feedback requires a fast patch', 'Low', 'Medium', 'Keep two weeks of capacity for post launch fixes']],
      deliverables: [['Beta report', -45, 'closed'], ['Launch report', -3, 'closed']],
    },
    {
      name: 'Customs Clearance Portal', code: 'MOT-CCP-10', client: 'Ministry of Trade', currency: 'EGP', value: 85000000, start: D(-55), end: D(230),
      team: [['Mostafa Hassan', 'Project Manager'], ['Dina Farouk', 'Business Analyst'], ['Karim Soliman', 'Technical Lead'], ['Nour Adel', 'QA Lead']],
      tree: G('Customs Clearance Portal',
        G('Analysis', L('Process mapping', 14, 100, 'Dina Farouk'), L('Tariff rules catalog', 18, 55, 'Dina Farouk')),
        G('Build', L('Declaration workflow', 35, 15, 'Karim Soliman'), L('Risk scoring engine', 30, 0, 'Karim Soliman'), L('Broker portal', 25, 0, 'Nour Adel', 'par'), L('Payment gateway link', 15, 0, 'Karim Soliman')),
        G('Go live', L('Port pilot', 15, 0, 'Nour Adel'), L('National rollout', 30, 0, 'Mostafa Hassan'), L('Final acceptance', 0, 0, 'Mostafa Hassan', 'ms'))),
      payments: [['Advance payment', 15, -50, 'paid'], ['Process maps accepted', 15, -18, 'invoiced'], ['Workflow accepted', 30, 100, 'pending'], ['Final acceptance', 40, 230, 'pending']],
      risks: [['Tariff rules change during build', 'High', 'Medium', 'Keep the rules in configuration and review them monthly'], ['Broker adoption is slow', 'Medium', 'Medium', 'Run training roadshows before the pilot']],
      deliverables: [['Process maps', -20, 'closed'], ['Tariff catalog', 15, 'open'], ['Pilot report', 150, 'open']],
    },
  ];

  // flatten each tree into ordered tasks with local ids and finish to start links
  for (const p of projects) {
    if (p.big) { p.tasks = bigProgram(); delete p.big; }
    else {
    const tasks = []; let lastLeaf = null, prevPred = null, n = 0;
    const walk = (node, parent, depth) => {
      const id = ++n;
      if (node.kids) {
        tasks.push({ lid: id, parent, name: node.n, depth, summary: true });
        node.kids.forEach((k) => walk(k, id, depth + 1));
      } else {
        const t = { lid: id, parent, name: node.n, depth, duration: node.d, progress: node.p, assignee: node.a, milestone: node.f === 'ms', deps: [] };
        if (lastLeaf) t.deps = node.f === 'par' && prevPred != null ? [prevPred] : [lastLeaf];
        prevPred = lastLeaf; lastLeaf = id;
        tasks.push(t);
      }
    };
    walk(p.tree, null, 0);
    p.tasks = tasks; delete p.tree;
    }
    p.payments = p.payments.map(([title, pct, off, state]) => ({ title, percent: pct, amount: Math.round((p.value * pct) / 100), due: D(off), state }));
    p.risks = p.risks.map(([title, probability, impact, mitigation]) => ({ title, probability, impact, mitigation }));
    p.deliverables = p.deliverables.map(([title, off, state]) => ({ title, due: D(off), state }));
    linkSpec(p);
  }
  return projects;
}

module.exports = { build };
;return module.exports})();
window.__ProjDash=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return window.__Sched};
'use strict';
// Numbers behind the project overview dashboards. Pure, so the server and the browser demo share it.

const DAY = 864e5;
const n = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const ymd = (x) => new Date(x * DAY).toISOString().slice(0, 10);

function amountOf(it, project) {
  const d = it.data || {};
  if (d.amount != null) return Number(d.amount);
  if (d.percent != null && project.value) return Math.round((project.value * d.percent) / 100);
  return 0;
}

// tasks: computed schedule rows. items: all project items. inbox: pending inbox rows. audit: recent rows.
function buildProjectDash({ project, tasks, items, inbox, audit, today }) {
  const leaf = tasks.filter((t) => !t.summary);
  const live = items.filter((i) => i.status !== 'ignored');

  // task status
  const status = { done: 0, active: 0, todo: 0, late: 0 };
  for (const t of leaf) {
    const p = t.progress || 0;
    if (p >= 100) status.done++;
    else if (t.finish < today) status.late++;
    else if (p > 0) status.active++;
    else status.todo++;
  }

  // phases: children of a single root, otherwise the top level
  const roots = tasks.filter((t) => !t.parent_id);
  const top = roots.length === 1 && roots[0].summary ? tasks.filter((t) => t.parent_id === roots[0].id) : roots;
  const phases = top.map((t) => ({ id: t.id, name: t.name, start: t.start, finish: t.finish, progress: t.progress || 0, summary: !!t.summary }));

  // critical path: leaf tasks on it, unfinished first by date
  const critical = leaf.filter((t) => t.critical).map((t) => ({ id: t.id, name: t.name, start: t.start, finish: t.finish, progress: t.progress || 0, assignee: t.assignee || null, late: (t.progress || 0) < 100 && t.finish < today, milestone: !!t.is_milestone }))
    .sort((a, b) => ((a.progress >= 100) - (b.progress >= 100)) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const criticalOpen = critical.filter((t) => t.progress < 100).length;

  // progress curve (planned vs actual), weighted by duration
  let curve = null;
  if (leaf.length) {
    const w = leaf.map((t) => Math.max(1, t.duration || 1));
    const total = w.reduce((a, b) => a + b, 0);
    const lo = Math.min(...leaf.map((t) => n(t.start))), hi = Math.max(...leaf.map((t) => n(t.finish)));
    const steps = 36, pts = [];
    const A = leaf.map((t, i) => [n(t.start), n(t.finish) + 1, w[i]]);
    for (let k = 0; k <= steps; k++) {
      const d = lo + ((hi + 1 - lo) * k) / steps;
      let s = 0;
      for (const [a, b, wi] of A) s += wi * Math.min(1, Math.max(0, (d - a) / (b - a)));
      pts.push({ d: ymd(Math.round(d)), planned: Math.round((s / total) * 1000) / 10 });
    }
    const actual = Math.round((leaf.reduce((s, t, i) => s + w[i] * ((t.progress || 0) / 100), 0) / total) * 1000) / 10;
    const td = n(today);
    let planned = 0;
    for (const [a, b, wi] of A) planned += wi * Math.min(1, Math.max(0, (td + 1 - a) / (b - a)));
    // use the same definitions as the overview and the schedule: duration weighted, planned from the baseline when there is one
    const Sc = require('./schedule'), cal = Sc.calendar(project);
    let bp = 0, bn = 0;
    leaf.forEach((t, i) => { const pp = Sc.plannedPercent(t, today, cal); if (pp !== null) { bp += w[i] * pp; bn++; } });
    const plannedNow = bn ? Math.round(bp / total) : Math.round((planned / total) * 100);
    curve = { points: pts, today, actual: Math.round(actual), plannedToday: plannedNow, min: ymd(lo), max: ymd(hi) };
  }

  // deliverables
  const deliverables = live.filter((i) => i.kind === 'deliverable').map((i) => ({ id: i.id, title: i.title, due: (i.data || {}).due_date || null, state: i.state, late: i.state !== 'closed' && !!(i.data || {}).due_date && i.data.due_date < today }))
    .sort((a, b) => ((a.state === 'closed') - (b.state === 'closed')) || String(a.due || '9999').localeCompare(String(b.due || '9999')));

  // payments and cash flow
  const payments = live.filter((i) => i.kind === 'milestone').map((i) => {
    const d = i.data || {};
    return { id: i.id, title: i.title, due: d.due_date || null, amount: amountOf(i, project), percent: d.percent ?? null, state: i.state, late: i.state === 'pending' && !!d.due_date && d.due_date < today };
  }).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
  const sums = { paid: 0, invoiced: 0, pending: 0, late: 0, total: 0 };
  for (const p of payments) { sums.total += p.amount; if (p.state === 'paid') sums.paid += p.amount; else if (p.state === 'invoiced') sums.invoiced += p.amount; else if (p.late) sums.late += p.amount; else sums.pending += p.amount; }
  const dated = payments.filter((p) => p.due);
  let cash = null;
  if (dated.length) {
    const ms = dated.map((p) => p.due.slice(0, 7)).sort();
    const [y0, m0] = ms[0].split('-').map(Number), [y1, m1] = ms[ms.length - 1].split('-').map(Number);
    const months = [];
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m++) { if (m > 12) { m = 1; y++; if (y > y1) break; } months.push(`${y}-${String(m).padStart(2, '0')}`); }
    const rows = months.map((m) => ({ m, paid: 0, invoiced: 0, pending: 0, late: 0 }));
    for (const p of dated) { const r = rows.find((x) => x.m === p.due.slice(0, 7)); if (!r) continue; r[p.state === 'paid' ? 'paid' : p.state === 'invoiced' ? 'invoiced' : p.late ? 'late' : 'pending'] += p.amount; }
    let planned = 0, received = 0;
    for (const r of rows) { planned += r.paid + r.invoiced + r.pending + r.late; received += r.paid; r.cumPlanned = planned; r.cumReceived = received; }
    cash = { months: rows, thisMonth: today.slice(0, 7) };
  }

  // owners
  const byOwner = new Map();
  for (const t of leaf) {
    const k = t.assignee || null;
    if (!byOwner.has(k)) byOwner.set(k, { name: k, done: 0, active: 0, todo: 0, late: 0, total: 0 });
    const o = byOwner.get(k), p = t.progress || 0;
    o.total++;
    if (p >= 100) o.done++; else if (t.finish < today) o.late++; else if (p > 0) o.active++; else o.todo++;
  }
  const owners = [...byOwner.values()].sort((a, b) => b.total - a.total).slice(0, 12);

  // waiting for a decision
  const review = items.filter((i) => i.status === 'proposed').slice(0, 30).map((i) => ({ id: i.id, kind: i.kind, title: i.title, confidence: i.confidence ?? null }));
  const updates = (inbox || []).filter((r) => r.status === 'pending').slice(0, 30).map((r) => ({ id: r.id, source: r.source, summary: r.summary || r.subject || '', sender: r.sender || r.resource || '' }));

  return {
    today,
    project: { id: project.id, name: project.name, client: project.client, currency: project.currency, value: project.value, start: project.start_date, end: project.end_date },
    taskCount: leaf.length, status, phases, critical: critical.slice(0, 80), criticalTotal: critical.length, criticalOpen, curve, deliverables, payments, paymentSums: sums, cash, owners, review, updates,
    activity: (audit || []).slice(0, 12).map((a) => ({ ts: a.ts || a.created_at, actor: a.actor, action: a.action, summary: (a.detail && a.detail.summary) || a.action })),
  };
}

module.exports = { buildProjectDash };
;return module.exports})();
window.__Versions=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return {}};
'use strict';
// Schedule version control. Pure functions, shared by the server and the demo.
const FIELDS = ['parent_id', 'name', 'start', 'duration', 'progress', 'assignee', 'deps', 'deliverable_id', 'notes', 'is_milestone', 'jira_key', 'color', 'mode', 'flag', 'links', 'b_start', 'b_end'];
const norm = (v) => (v === undefined || v === '' ? null : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

function snap(tasks) {
  return tasks.map((t) => {
    const o = { id: t.id, position: t.position };
    for (const f of FIELDS) o[f] = f === 'deps' || f === 'links' ? (t[f] || []) : norm(t[f]);
    return o;
  });
}

// What changed between an older snapshot and a newer one
function diff(oldS, newS) {
  const o = new Map(oldS.map((t) => [t.id, t])), n = new Map(newS.map((t) => [t.id, t]));
  const added = [], removed = [], changed = [];
  for (const t of newS) if (!o.has(t.id)) added.push({ id: t.id, name: t.name });
  for (const t of oldS) if (!n.has(t.id)) removed.push({ id: t.id, name: t.name });
  for (const t of newS) {
    const p = o.get(t.id); if (!p) continue;
    const fields = FIELDS.filter((f) => !same(p[f], t[f]));
    if (fields.length) changed.push({ id: t.id, name: t.name, fields, from: Object.fromEntries(fields.map((f) => [f, p[f]])), to: Object.fromEntries(fields.map((f) => [f, t[f]])) });
  }
  const seqO = oldS.filter((t) => n.has(t.id)).sort((a, b) => a.position - b.position).map((t) => t.id).join();
  const seqN = newS.filter((t) => o.has(t.id)).sort((a, b) => a.position - b.position).map((t) => t.id).join();
  const reordered = seqO !== seqN;
  return { added, removed, changed, reordered, count: added.length + removed.length + changed.length + (reordered && !changed.length && !added.length && !removed.length ? 1 : 0) };
}

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Level by size of the change: major, minor or patch
function levelFor(d, endFrom, endTo, source) {
  if (source === 'restore' || source === 'import' || source === 'baseline') return 'major';
  const endMoved = endFrom && endTo ? Math.abs(days(endFrom, endTo)) : 0;
  if (d.count >= 10 || d.removed.length >= 5 || endMoved >= 14) return 'major';
  if (d.count >= 3 || d.removed.length >= 1 || d.added.length >= 2 || endMoved >= 1) return 'minor';
  return 'patch';
}

function nextVersion(prev, level) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(prev || '');
  let [a, b, c] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  if (!m) return 'v1.0.0';
  if (level === 'major') { a++; b = 0; c = 0; } else if (level === 'minor') { b++; c = 0; } else c++;
  return `v${a}.${b}.${c}`;
}

module.exports = { FIELDS, snap, diff, levelFor, nextVersion };
;return module.exports})();
window.__MSP=(function(){var module={exports:{}};var exports=module.exports;var require=function(){return window.__Sched};
// Microsoft Project exchange (MSPDI XML). Pure functions, shared by the server and the browser demo.
// Export writes a file Microsoft Project opens directly. Import reads files saved from Microsoft Project
// ("Save As, XML Format") including the outline, link types, lags, baseline and calendar.
const S = require('./schedule');

const NS = 'http://schemas.microsoft.com/project';
const x = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const LINK_CODE = { FF: 0, FS: 1, SF: 2, SS: 3 };
const LINK_NAME = ['FF', 'FS', 'SF', 'SS'];
const MIN_DAY = 480;

// ---------------- export ----------------
// tasks: output of schedule() with extra fields (ext_uid assigned by the caller, wbs added here)
function toXml(project, tasks) {
  const c = S.calendar(project);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = new Map();
  for (const t of tasks) if (t.parent_id && byId.has(t.parent_id)) { if (!kids.has(t.parent_id)) kids.set(t.parent_id, []); kids.get(t.parent_id).push(t); }
  const roots = tasks.filter((t) => !t.parent_id || !byId.has(t.parent_id));
  const order = (a, b) => (a.position - b.position) || (a.id - b.id);
  const flat = [];
  const walk = (list, level, prefix) => list.sort(order).forEach((t, i) => {
    const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    flat.push({ t, level, wbs });
    walk(kids.get(t.id) || [], level + 1, wbs);
  });
  walk(roots, 1, '');
  const idx = new Map(flat.map((f, i) => [f.t.id, i + 1]));
  const dt = (d, end) => `${d}T${end ? '17:00:00' : '08:00:00'}`;
  const dur = (days) => `PT${Math.max(days, 0) * 8}H0M0S`;
  const starts = tasks.filter((t) => t.start).map((t) => t.start).sort();
  const ends = tasks.filter((t) => t.finish).map((t) => t.finish).sort();
  const resources = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))];
  const assignments = [];
  let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="${NS}">\n`;
  out += `<SaveVersion>14</SaveVersion><Name>${x(project.name)}</Name><Title>${x(project.name)}</Title><CreationDate>${new Date().toISOString().slice(0, 19)}</CreationDate>\n`;
  out += `<ScheduleFromStart>1</ScheduleFromStart><StartDate>${dt(starts[0] || project.start_date || new Date().toISOString().slice(0, 10))}</StartDate><FinishDate>${dt(ends[ends.length - 1] || project.end_date || new Date().toISOString().slice(0, 10), 1)}</FinishDate>\n`;
  out += `<CalendarUID>1</CalendarUID><DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><MinutesPerDay>${MIN_DAY}</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>\n`;
  out += `<DurationFormat>7</DurationFormat><WorkFormat>2</WorkFormat><CurrencyCode>${x(project.currency || 'USD')}</CurrencyCode>\n`;
  // calendar
  out += `<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>`;
  for (let d = 0; d < 7; d++) {
    const on = c.days.has(d);
    out += `<WeekDay><DayType>${d + 1}</DayType><DayWorking>${on ? 1 : 0}</DayWorking>${on ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>' : ''}</WeekDay>`;
  }
  out += `</WeekDays>`;
  const hol = [...c.holidays].sort();
  if (hol.length) {
    out += `<Exceptions>`;
    hol.forEach((h, i) => { out += `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${h}T00:00:00</FromDate><ToDate>${h}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>Holiday ${i + 1}</Name><Type>1</Type><DayWorking>0</DayWorking></Exception>`; });
    out += `</Exceptions>`;
  }
  out += `</Calendar></Calendars>\n<Tasks>`;
  // project summary task
  out += `<Task><UID>0</UID><ID>0</ID><Name>${x(project.name)}</Name><Type>1</Type><IsNull>0</IsNull><WBS>0</WBS><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>`;
  for (const { t, level, wbs } of flat) {
    const summary = !!t.summary;
    const ms = !!t.is_milestone || (!summary && (t.duration || 0) <= 0);
    out += `<Task><UID>${t.ext_uid}</UID><ID>${idx.get(t.id)}</ID><Name>${x(t.name)}</Name><Type>0</Type><IsNull>0</IsNull><WBS>${wbs}</WBS><OutlineNumber>${wbs}</OutlineNumber><OutlineLevel>${level}</OutlineLevel><Priority>500</Priority>`;
    if (t.start) out += `<Start>${dt(t.start)}</Start><Finish>${dt(t.finish || t.start, 1)}</Finish>`;
    out += `<Duration>${dur(ms ? 0 : t.duration)}</Duration><DurationFormat>7</DurationFormat><PercentComplete>${t.progress || 0}</PercentComplete><Summary>${summary ? 1 : 0}</Summary><Milestone>${ms ? 1 : 0}</Milestone><Critical>${t.critical ? 1 : 0}</Critical>`;
    if (t.notes) out += `<Notes>${x(t.notes)}</Notes>`;
    for (const d of S.depsOf(t)) {
      const p = byId.get(d.id);
      if (!p) continue;
      out += `<PredecessorLink><PredecessorUID>${p.ext_uid}</PredecessorUID><Type>${LINK_CODE[d.type] ?? 1}</Type><CrossProject>0</CrossProject><LinkLag>${(d.lag || 0) * MIN_DAY * 10}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`;
    }
    if (t.b_start && t.b_end) out += `<Baseline><Number>0</Number><Start>${dt(t.b_start)}</Start><Finish>${dt(t.b_end, 1)}</Finish></Baseline>`;
    out += `</Task>`;
    if (t.assignee && !summary) assignments.push({ task: t.ext_uid, res: resources.indexOf(t.assignee) + 1 });
  }
  out += `</Tasks>\n<Resources><Resource><UID>0</UID><ID>0</ID><Type>1</Type><IsNull>0</IsNull></Resource>`;
  resources.forEach((r, i) => { out += `<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${x(r)}</Name><Type>1</Type><IsNull>0</IsNull></Resource>`; });
  out += `</Resources>\n<Assignments>`;
  assignments.forEach((a, i) => { out += `<Assignment><UID>${i + 1}</UID><TaskUID>${a.task}</TaskUID><ResourceUID>${a.res}</ResourceUID><PercentWorkComplete>0</PercentWorkComplete></Assignment>`; });
  out += `</Assignments>\n</Project>\n`;
  return out;
}

// ---------------- import ----------------
// Tiny XML reader: elements, text, CDATA, entities. Attributes and namespaces are ignored.
function readXml(src) {
  const decode = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
  const root = { name: '#root', kids: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.\-:]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const cur = stack[stack.length - 1];
    if (m[1] !== undefined) cur.text += m[1];
    else if (m[3]) {
      const name = m[3].replace(/^.*:/, '');
      if (m[2]) { if (stack.length > 1) stack.pop(); }
      else {
        const el = { name, kids: [], text: '' };
        cur.kids.push(el);
        if (!m[5]) stack.push(el);
      }
    } else if (m[6] !== undefined) cur.text += decode(m[6]);
  }
  return root.kids[0] || null;
}
const kid = (el, n) => (el.kids || []).find((k) => k.name === n);
const kids = (el, n) => (el.kids || []).filter((k) => k.name === n);
const val = (el, n) => { const k = kid(el, n); return k ? k.text.trim() : ''; };
const dayPart = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : null);
// ISO 8601 duration like PT40H0M0S or P5D to working days
function durDays(s, minPerDay) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(s || '');
  if (!m) return null;
  const mins = (Number(m[1] || 0) * minPerDay) + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return Math.round((mins / minPerDay) * 100) / 100;
}

function parse(xml) {
  const root = readXml(String(xml || '').replace(/^﻿/, ''));
  if (!root || root.name !== 'Project' || !kid(root, 'Tasks')) throw new Error('This does not look like a Microsoft Project XML file. In Project use File, Save As, and choose XML Format.');
  const warnings = [];
  const minDay = Number(val(root, 'MinutesPerDay')) || MIN_DAY;
  // resources and assignments
  const resName = new Map();
  for (const r of kids(kid(root, 'Resources') || { kids: [] }, 'Resource')) if (val(r, 'Name')) resName.set(val(r, 'UID'), val(r, 'Name'));
  const owner = new Map();
  for (const a of kids(kid(root, 'Assignments') || { kids: [] }, 'Assignment')) {
    const n = resName.get(val(a, 'ResourceUID'));
    const k = val(a, 'TaskUID');
    if (n) owner.set(k, owner.has(k) ? `${owner.get(k)}, ${n}` : n);
  }
  // calendar
  let calendar = null;
  const calUid = val(root, 'CalendarUID');
  const cals = kids(kid(root, 'Calendars') || { kids: [] }, 'Calendar');
  const cal = cals.find((k) => val(k, 'UID') === calUid) || cals.find((k) => val(k, 'IsBaseCalendar') === '1') || cals[0];
  if (cal) {
    const days = [];
    for (const w of kids(kid(cal, 'WeekDays') || { kids: [] }, 'WeekDay')) if (val(w, 'DayType') >= 1 && val(w, 'DayType') <= 7 && val(w, 'DayWorking') === '1') days.push(Number(val(w, 'DayType')) - 1);
    const holidays = [];
    for (const e of kids(kid(cal, 'Exceptions') || { kids: [] }, 'Exception')) {
      if (val(e, 'DayWorking') !== '0') continue;
      const tp = kid(e, 'TimePeriod');
      const a = tp && dayPart(val(tp, 'FromDate')), b = tp && dayPart(val(tp, 'ToDate'));
      if (!a || !b) continue;
      for (let d = a, n = 0; d <= b && n < 400; d = S.addDays(d, 1), n++) if (!holidays.includes(d)) holidays.push(d);
    }
    if (days.length) calendar = { work_days: days.sort(), holidays: holidays.sort() };
  }
  const tasks = [];
  for (const t of kids(kid(root, 'Tasks'), 'Task')) {
    const uid = val(t, 'UID');
    if (!uid || uid === '0' && val(t, 'OutlineLevel') === '0') continue;
    if (val(t, 'IsNull') === '1') continue;
    const level = Number(val(t, 'OutlineLevel')) || 1;
    if (level < 1) continue;
    const summary = val(t, 'Summary') === '1';
    const milestone = val(t, 'Milestone') === '1';
    const start = dayPart(val(t, 'Start')), finish = dayPart(val(t, 'Finish'));
    let days = durDays(val(t, 'Duration'), minDay);
    if (days == null) days = start && finish ? S.countWork(start, finish, S.calendar({})) : 1;
    const preds = kids(t, 'PredecessorLink').map((l) => {
      const typeCode = val(l, 'Type') === '' ? 1 : Number(val(l, 'Type'));
      const lagRaw = Number(val(l, 'LinkLag')) || 0;
      const fmtCode = Number(val(l, 'LagFormat')) || 7;
      let lag = lagRaw / 10 / minDay; // tenths of a minute to days
      if (fmtCode === 19 || fmtCode === 20) lag = 0; // percent lags are not supported
      if (val(l, 'CrossProject') === '1') { warnings.push(`Task ${uid} has a link to another project file, skipped`); return null; }
      return { uid: val(l, 'PredecessorUID'), type: LINK_NAME[typeCode] || 'FS', lag: Math.round(lag) };
    }).filter(Boolean);
    const b0 = kids(t, 'Baseline').find((b) => val(b, 'Number') === '0');
    tasks.push({
      uid, name: val(t, 'Name') || `Task ${uid}`, level, summary, milestone, start, finish,
      duration: milestone ? 0 : Math.max(Math.round(days), summary ? 0 : 1), progress: Math.max(0, Math.min(100, Number(val(t, 'PercentComplete')) || 0)),
      preds, notes: val(t, 'Notes') || null, owner: owner.get(uid) || null,
      b_start: b0 ? dayPart(val(b0, 'Start')) : null, b_end: b0 ? dayPart(val(b0, 'Finish')) : null,
    });
  }
  if (!tasks.length) throw new Error('No tasks were found in this file.');
  // parent by outline level
  const stack = [];
  tasks.forEach((t, i) => {
    while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    t.parent_uid = stack.length ? stack[stack.length - 1].uid : null;
    t.position = i;
    stack.push(t);
  });
  const uids = new Set(tasks.map((t) => t.uid));
  for (const t of tasks) t.preds = t.preds.filter((p) => { const ok = uids.has(p.uid) && p.uid !== t.uid; if (!ok) warnings.push(`"${t.name}": link to a missing task was skipped`); return ok; });
  const maxLevel = tasks.reduce((m, t) => Math.max(m, t.level), 1);
  if (maxLevel > S.MAX_LEVEL) warnings.push(`The outline goes ${maxLevel} levels deep. The web app supports up to ${S.MAX_LEVEL}.`);
  return { name: val(root, 'Title') || val(root, 'Name') || null, calendar, tasks, warnings, maxLevel };
}

// Works out what an import would do. existing: current tasks with ext_uid. mode: 'replace' or 'merge'.
function plan(existing, parsed, mode) {
  const byUid = new Map(existing.filter((t) => t.ext_uid != null && t.ext_uid !== '').map((t) => [String(t.ext_uid), t]));
  const rows = parsed.tasks.map((t) => {
    const match = mode === 'merge' ? byUid.get(t.uid) || null : null;
    return { ...t, existing_id: match ? match.id : null };
  });
  const seen = new Set(rows.filter((r) => r.existing_id).map((r) => r.existing_id));
  const missing = mode === 'merge' ? existing.filter((t) => t.ext_uid != null && t.ext_uid !== '' && !seen.has(t.id)) : [];
  const added = rows.filter((r) => !r.existing_id).length;
  const links = rows.reduce((n, r) => n + r.preds.length, 0);
  return {
    rows, missing,
    summary: { tasks: rows.length, added, updated: rows.length - added, missing: missing.length, links, levels: parsed.maxLevel, summaries: rows.filter((r) => r.summary).length, calendar: !!parsed.calendar, baseline: rows.some((r) => r.b_start), warnings: parsed.warnings },
  };
}

// Files saved from Microsoft Project can carry megabytes the import never reads (timephased data, per day
// assignment detail, extended attributes, indentation). Keep only what parse() uses so the upload stays small.
function slim(xml) {
  let s = String(xml || '').replace(/^\uFEFF/, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<TimephasedData>[\s\S]*?<\/TimephasedData>/g, '');
  s = s.replace(/<ExtendedAttribute>[\s\S]*?<\/ExtendedAttribute>/g, '');
  s = s.replace(/<Assignment>([\s\S]*?)<\/Assignment>/g, (m, inner) => {
    const t = /<TaskUID>([^<]*)<\/TaskUID>/.exec(inner), r = /<ResourceUID>([^<]*)<\/ResourceUID>/.exec(inner);
    return t && r ? `<Assignment><TaskUID>${t[1]}</TaskUID><ResourceUID>${r[1]}</ResourceUID></Assignment>` : '';
  });
  return s.replace(/>\s+</g, '><');
}
module.exports = { toXml, parse, plan, readXml, slim };
;return module.exports})();
window.__AI=(function(){var module={exports:{}};var exports=module.exports;var process={env:{}};var require=function(){return {}};
// AI layer: document reading, extraction, update interpretation and drafting.
// Uses the Claude API when ANTHROPIC_API_KEY is set, otherwise a rule based fallback.
const fs = require('fs');
const path = require('path');

// The browser never sees the API key. It asks the server (/srv/ai) which holds ANTHROPIC_API_KEY.
const MODEL = 'claude-sonnet-5-5';
const aiState = { configured: false, model: MODEL };
const aiReady = (typeof window !== 'undefined' && typeof fetch === 'function')
  ? fetch('/srv/ai/status').then((r) => r.json()).then((j) => { aiState.configured = !!j.configured; if (j.model) aiState.model = j.model; }).catch(() => {})
  : Promise.resolve();
const hasKey = () => aiState.configured;

// Only a few AI requests run at the same time, so a big project does not flood the server or the browser.
const AI_SLOTS = 5;
let aiActive = 0;
const aiQueue = [];
const aiStats = { active: 0, queued: 0, done: 0 };
function takeSlot() {
  return new Promise((ok) => {
    const go = () => { aiActive++; aiStats.active = aiActive; ok(); };
    if (aiActive < AI_SLOTS) go(); else { aiQueue.push(go); aiStats.queued = aiQueue.length; }
  });
}
function freeSlot() {
  aiActive--; aiStats.active = aiActive; aiStats.done++;
  const n = aiQueue.shift(); aiStats.queued = aiQueue.length;
  if (n) n();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claudeOnce(system, user, maxTokens) {
  let res;
  try {
    res = await fetch('/srv/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, user, max_tokens: maxTokens }), signal: AbortSignal.timeout(660000) });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw Object.assign(new Error('The AI took too long to answer'), { code: 'timeout' });
    throw Object.assign(new Error('Could not reach the server'), { code: 'network' });
  }
  let j = null;
  try { j = await res.json(); } catch (e) { /* not json, or the connection dropped while the answer was coming */ if (res.ok) throw Object.assign(new Error('The connection dropped before the answer arrived'), { code: 'network' }); }
  if (!res.ok || (j && j.failed)) throw Object.assign(new Error((j && j.error) || `Claude request failed (${res.status})`), { code: (j && j.code) || (res.status >= 500 ? 'network' : 'upstream') });
  return { text: (j && j.text) || '', stop: (j && j.stop_reason) || null };
}

// One call with automatic retries. A restart of the server, a dropped connection or a busy moment is retried quietly.
async function claudeRaw(system, user, maxTokens = 4000) {
  await aiReady;
  if (!aiState.configured) return null;
  await takeSlot();
  try {
    const waits = [2000, 6000, 15000];
    for (let attempt = 0; ; attempt++) {
      try { return await claudeOnce(system, user, maxTokens); }
      catch (e) {
        const again = ['network', 'rate'].includes(e.code) || (e.code === 'upstream' && attempt < 1);
        if (!again || attempt >= waits.length) throw e;
        await sleep(waits[attempt]);
      }
    }
  } finally { freeSlot(); }
}

async function claude(system, user, maxTokens = 4000) {
  const r = await claudeRaw(system, user, maxTokens);
  return r == null ? null : r.text;
}

// Parses the model reply. Empty, cut off or invalid output is reported as a normal error, never a crash.
async function claudeJSON(system, user, maxTokens = 6000) {
  const r = await claudeRaw(system + '\nReply with one JSON object only. No prose, no code fences.', user, maxTokens);
  if (r == null) return null;
  const txt = r.text || '';
  if (r.stop === 'max_tokens') throw Object.assign(new Error('Model reply was cut off'), { code: 'cutoff', text: txt });
  const a = txt.indexOf('{');
  const b = txt.lastIndexOf('}');
  if (a < 0 || b < a) throw Object.assign(new Error('Model did not return JSON'), { code: 'badjson' });
  try { return JSON.parse(txt.slice(a, b + 1)); } catch (e) { throw Object.assign(new Error('Model returned invalid JSON'), { code: 'badjson' }); }
}

// ---------- text extraction ----------
async function extractText(file) {
  const ext = path.extname(file.originalname || file.stored || '').toLowerCase();
  const buf = fs.readFileSync(file.path);
  try {
    if (ext === '.pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const r = await parser.getText();
        return r.text || '';
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ buffer: buf });
      return r.value || '';
    }
    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
      const parts = [];
      for (const name of wb.SheetNames.slice(0, 12)) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        parts.push(`${name}`);
        for (const r of rows.slice(0, 600)) {
          if (r.some((c) => String(c).trim() !== '')) parts.push('| ' + r.map((c) => String(c).trim()).join(' | ') + ' |');
        }
        parts.push('');
      }
      return parts.join('\n');
    }
  } catch (e) {
    return `[Could not read ${ext} file: ${e.message}]`;
  }
  if (['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.eml'].includes(ext) || !ext) return buf.toString('utf8');
  return '';
}

// ---------- document classification ----------
function classify(filename, text) {
  const f = (filename || '').toLowerCase();
  const t = (text || '').slice(0, 6000).toLowerCase();
  const rules = [
    ['po', /purchase[\s_-]*order|(^|[^a-z])po([^a-z]|$)|p\.o\./],
    ['boq', /bill[\s_-]*of[\s_-]*quantit|(^|[^a-z])boq([^a-z]|$)/],
    ['invoice', /invoice/],
    ['evidence', /acceptance|handover|delivery[\s_-]*note|completion[\s_-]*certificate|sign[\s_-]*off|uat[\s_-]*report|go[\s_-]*live/],
    ['minutes', /minutes|(^|[^a-z])mom([^a-z]|$)/],
    ['contract', /agreement|contract/],
    ['proposal', /proposal|offer|quotation|tender|rfp|rft/],
  ];
  for (const [k, re] of rules) if (re.test(f)) return k;
  for (const [k, re] of rules) if (re.test(t.slice(0, 1500))) return k;
  for (const [k, re] of rules) if (re.test(t)) return k;
  return 'other';
}

// ---------- parsing helpers ----------
const CURRENCIES = ['AED', 'USD', 'SAR', 'KWD', 'QAR', 'OMR', 'JOD', 'BHD', 'EUR', 'GBP', 'EGP'];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] || (m && MONTHS[m[2].slice(0, 3).toLowerCase()])) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()] || MONTHS[m[2].slice(0, 4).toLowerCase()];
    return `${m[3]}-${pad(mo)}-${pad(m[1])}`;
  }
  m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  return null;
}

function parseAmount(s) {
  if (!s) return null;
  const m = String(s).match(/(\d[\d,]*(?:\.\d+)?)\s*(million|mn|m|k|thousand)?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  const u = (m[2] || '').toLowerCase();
  if (u === 'million' || u === 'mn' || u === 'm') n *= 1e6;
  if (u === 'k' || u === 'thousand') n *= 1e3;
  return n;
}

function findCurrency(s) {
  if (!s) return null;
  const up = s.toUpperCase();
  for (const c of CURRENCIES) if (new RegExp(`\\b${c}\\b`).test(up)) return c;
  if (/\$/.test(s)) return 'USD';
  if (/€/.test(s)) return 'EUR';
  if (/£/.test(s)) return 'GBP';
  if (/د\.إ|درهم/.test(s)) return 'AED';
  return null;
}

const SECTION_DEFS = [
  ['deliverable', /^(?:\d+(?:\.\d+)*[.)]?\s*)?(deliverables?|scope of (?:work|supply|services)|key deliverables|bill of quantities|boq|items? supplied)\b[^.]{0,40}:?\s*$/i],
  ['requirement', /^(?:\d+(?:\.\d+)*[.)]?\s*)?((?:functional |non[- ]functional |technical |business )?requirements?|specifications?)\b[^.]{0,40}:?\s*$/i],
  ['risk', /^(?:\d+(?:\.\d+)*[.)]?\s*)?(risks?|risk register|project risks|assumptions and risks)\b[^.]{0,40}:?\s*$/i],
  ['milestone', /^(?:\d+(?:\.\d+)*[.)]?\s*)?(payment (?:milestones|schedule|terms|plan)|milestone payments|invoicing schedule)\b[^.]{0,40}:?\s*$/i],
  ['schedule', /^(?:\d+(?:\.\d+)*[.)]?\s*)?(project (?:schedule|timeline|plan)|timeline|implementation (?:plan|schedule)|work plan|phases|schedule)\b[^.]{0,40}:?\s*$/i],
  ['stop', /^(?:\d+(?:\.\d+)*[.)]?\s*)?(terms and conditions|general terms|signatures?|appendix|confidentiality|governing law|notes?|assumptions|exclusions|team|about us|introduction|background|overview|company profile|acceptance)\b[^.]{0,40}:?\s*$/i],
];

function sectionOf(line) {
  const l = line.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '');
  if (!l || l.length > 90) return null;
  for (const [k, re] of SECTION_DEFS) if (re.test(l)) return k;
  return null;
}

const bulletRe = /^\s*(?:[-*•–]|\d+[.)]|\(\w\)|[a-z][.)])\s+(.*)$/;

function cleanTitle(s) {
  return s.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/^[\s|:.-]+|[\s|:.-]+$/g, '').trim();
}

function parseTableRow(line) {
  if (!line.includes('|')) return null;
  const cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
  if (cells.length < 2 || cells.every((c) => /^[-: ]+$/.test(c))) return null;
  return cells;
}

function levelOf(text) {
  const t = text.toLowerCase();
  if (/\bhigh\b|\bcritical\b|\bsevere\b/.test(t)) return 'High';
  if (/\bmedium\b|\bmoderate\b/.test(t)) return 'Medium';
  if (/\blow\b|\bminor\b/.test(t)) return 'Low';
  return null;
}

function heuristicExtract(text, filename) {
  const lines = text.split(/\r?\n/);
  const out = { fields: [], deliverables: [], requirements: [], risks: [], milestones: [], schedule: [] };
  const push = (arr, o) => arr.push(o);

  // Field extraction
  const labelRules = [
    ['start_date', /(?:project\s+)?(?:start|commencement|kick[\s-]?off|effective)\s*date\s*[:\-–]?\s*(.+)/i],
    ['end_date', /(?:project\s+)?(?:end|completion|finish|expiry|final delivery)\s*date\s*[:\-–]?\s*(.+)/i],
    ['value', /(?:total\s+|grand\s+total\s*|contract\s+|project\s+|order\s+|proposal\s+)?(?:value|price|amount|sum|cost)\s*(?:\([^)]*\))?\s*[:\-–]\s*(.+)/i],
    ['client', /(?:client|customer|buyer|purchaser|issued to|employer)\s*[:\-–]\s*(.+)/i],
  ];
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*•]\s*/, '').replace(/\|/g, ' ').trim();
    if (!line || line.length > 220) continue;
    for (const [field, re] of labelRules) {
      const m = line.match(re);
      if (!m) continue;
      if (field === 'start_date' || field === 'end_date') {
        const d = parseDate(m[1]);
        if (d && !seen.has(field + d)) { seen.add(field + d); push(out.fields, { field, value: d, confidence: 0.82, quote: line }); }
      } else if (field === 'value') {
        const amt = parseAmount(m[1]);
        const cur = findCurrency(m[1]) || findCurrency(line);
        if (amt && amt > 0 && !seen.has('value' + amt)) {
          seen.add('value' + amt);
          push(out.fields, { field: 'value', value: amt, confidence: 0.78, quote: line });
          if (cur && !seen.has('cur' + cur)) { seen.add('cur' + cur); push(out.fields, { field: 'currency', value: cur, confidence: 0.85, quote: line }); }
        }
      } else if (field === 'client') {
        const v = cleanTitle(m[1]).slice(0, 120);
        if (v.length > 2 && !seen.has('client' + v)) { seen.add('client' + v); push(out.fields, { field: 'client', value: v, confidence: 0.7, quote: line }); }
      }
    }
  }

  // Section extraction
  let cur = null;
  let table = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    const sec = sectionOf(line);
    if (sec) { cur = sec === 'stop' ? null : sec; table = null; continue; }
    if (!cur) continue;

    const cells = parseTableRow(line);
    if (cells) {
      if (!table) { table = cells.map((c) => c.toLowerCase()); if (cells.some((c) => /\d/.test(c)) === false) continue; }
      const row = cells;
      handleRow(cur, row, table, line, out);
      continue;
    }
    const b = line.match(bulletRe);
    const body = cleanTitle((b ? b[1] : line).replace(/\*\*/g, ''));
    if (!b && body.length > 160) continue;
    if (!b && /[.:]$/.test(body) && body.length < 3) continue;
    handleLine(cur, body, line, out);
  }

  return out;
}

function handleRow(kind, cells, header, quote, out) {
  const joined = cells.join(' | ');
  const idx = (re) => header.findIndex((h) => re.test(h));
  const get = (re) => { const i = idx(re); return i >= 0 ? cells[i] : null; };
  const title = get(/item|deliverable|description|task|milestone|phase|name|activity|risk|requirement/) || cells[0];
  if (kind === 'deliverable') out.deliverables.push({ title: cleanTitle(title), description: joined, due_date: parseDate(get(/due|date|delivery/)) || parseDate(joined), confidence: 0.7, quote: quote });
  else if (kind === 'requirement') out.requirements.push({ title: cleanTitle(title).slice(0, 120), description: joined, priority: /shall|must/i.test(joined) ? 'Must' : 'Should', confidence: 0.65, quote });
  else if (kind === 'risk') out.risks.push({ title: cleanTitle(title).slice(0, 140), description: joined, probability: levelOf(get(/probab|likelihood/) || '') || 'Medium', impact: levelOf(get(/impact|severity/) || '') || 'Medium', mitigation: get(/mitigation|response/) || '', confidence: 0.65, quote });
  else if (kind === 'milestone') {
    const amtCell = get(/amount|value|price/);
    const pct = (get(/%|percent|share/) || joined).match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    const amount = amtCell && !/^\s*\d{1,3}(?:\.\d+)?\s*%\s*$/.test(amtCell) ? parseAmount(amtCell) : null;
    out.milestones.push({ title: cleanTitle(title).slice(0, 140), percent: pct ? parseFloat(pct[1]) : null, amount, due_date: parseDate(get(/due|date/)) || parseDate(joined), confidence: 0.68, quote });
  } else if (kind === 'schedule') {
    const ds = [...joined.matchAll(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{4}/g)].map((m) => parseDate(m[0]));
    const dur = joined.match(/(\d+)\s*(weeks?|days?|months?)/i);
    const start = parseDate(get(/start|from/)) || ds[0] || null;
    const end = parseDate(get(/end|finish|to|due/)) || ds[1] || null;
    out.schedule.push({ name: cleanTitle(title).slice(0, 120), start, end, duration_days: dur ? durToDays(dur) : null, confidence: 0.68, quote });
  }
}

function durToDays(m) {
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  if (u.startsWith('week')) return n * 5;
  if (u.startsWith('month')) return n * 21;
  return n;
}

function handleLine(kind, body, quote, out) {
  if (body.length < 3) return;
  if (kind === 'deliverable') {
    const [t] = body.split(/\s+[-–:]\s+|:\s+/);
    out.deliverables.push({ title: cleanTitle(t).slice(0, 140), description: body, due_date: parseDate(body), confidence: 0.72, quote });
  } else if (kind === 'requirement') {
    out.requirements.push({ title: body.slice(0, 120), description: body, priority: /\b(shall|must)\b/i.test(body) ? 'Must' : /\bshould\b/i.test(body) ? 'Should' : 'Could', confidence: 0.7, quote });
  } else if (kind === 'risk') {
    const mit = body.match(/mitigation\s*[:\-–]\s*(.+)$/i);
    const head = body.replace(/mitigation\s*[:\-–].+$/i, '').replace(/\((?:high|medium|low)[^)]*\)/gi, '');
    out.risks.push({ title: cleanTitle(head).slice(0, 140), description: body, probability: levelOf(body) || 'Medium', impact: levelOf(body) || 'Medium', mitigation: mit ? mit[1] : '', confidence: 0.68, quote });
  } else if (kind === 'milestone') {
    const pct = body.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    const rest = body.replace(/(\d{1,3}(?:\.\d+)?)\s*%/, '');
    const amt = /(AED|USD|SAR|KWD|QAR|OMR|JOD|EUR|GBP|\$|€|£)\s*[\d,]+|[\d,]{4,}/i.test(rest) ? parseAmount(rest.match(/[\d,]{3,}(?:\.\d+)?(?:\s*(?:million|m|k))?/i)?.[0]) : null;
    const t = cleanTitle(body.split(/\s+[-–:]\s+|:\s+/)[0]).slice(0, 140);
    out.milestones.push({ title: t, percent: pct ? parseFloat(pct[1]) : null, amount: amt, due_date: parseDate(body), confidence: 0.7, quote });
  } else if (kind === 'schedule') {
    const ds = [...body.matchAll(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/g)].map((m) => parseDate(m[0])).filter(Boolean);
    const dur = body.match(/(\d+)\s*(weeks?|days?|months?)/i);
    const name = cleanTitle(body.split(/\s*[:\-–(]\s*(?=\d|[A-Za-z]{3,9}\s\d)/)[0] || body).slice(0, 120);
    if (ds.length || dur) out.schedule.push({ name, start: ds[0] || null, end: ds[1] || null, duration_days: dur ? durToDays(dur) : null, confidence: 0.66, quote });
  }
}

// ---------- main document analysis ----------
const EXTRACT_SYSTEM = `You are a senior project manager reading one part of a project document (proposal, award letter, financial offer, contract or similar). Extract structured data.
Return JSON with this shape:
{
 "kind": "proposal|contract|po|boq|invoice|evidence|minutes|other",
 "summary": "two sentence summary of what this document is and what it commits to",
 "fields": [{"field":"start_date|end_date|award_date|value|currency|client","value":"...","confidence":0.0-1.0,"quote":"short source text"}],
 "deliverables": [{"title":"","description":"","due_date":"YYYY-MM-DD or null","amount":number or null,"confidence":0.0,"quote":""}],
 "requirements": [{"title":"","description":"","priority":"Must|Should|Could","confidence":0.0,"quote":""}],
 "risks": [{"title":"","description":"","probability":"Low|Medium|High","impact":"Low|Medium|High","mitigation":"","confidence":0.0,"quote":""}],
 "milestones": [{"title":"","percent":number or null,"amount":number or null,"due_date":"YYYY-MM-DD or null","confidence":0.0,"quote":""}],
 "schedule": [{"name":"","level":"phase|task|milestone","phase":"parent phase name or null","start":"YYYY-MM-DD or null","end":"YYYY-MM-DD or null","start_week":number or null,"end_week":number or null,"duration_days":number or null,"depends_on":["name of predecessor"],"confidence":0.0,"quote":""}]
}
Rules:
1. Only extract what the text supports. Every item needs a quote copied exactly, word for word, from the text you were given, about 8 to 25 words. Never rewrite or translate a quote. Skip any item you cannot quote.
2. value is a number without currency symbols, currency is an ISO code. award_date is the date a contract or award letter was issued. Dates are ISO. Never guess a date. If the text gives only relative timing such as Week 1 to Week 6 or Month 3, fill start_week and end_week (weeks, counted from project start) and leave start and end null. A month or year with no day is not a date, convert only when the text says the exact day.
3. Schedule means project delivery work: phases, activities, release gates and delivery dates. Use level phase for a named stage that contains work, task for work inside a phase, milestone for a gate or go-live. Set phase on tasks and milestones. Fill depends_on only when the text states or clearly implies the order (for example UAT follows build).
4. Deliverables are things handed to the client. Where a price is shown next to a deliverable, put it in amount as a number.
5. Payment milestones are invoicing or payment events, not delivery tasks. Keep percent and amount exact as written.
6. List each fact once. Do not repeat the same deliverable, phase or risk from different parts of the text. Tables of risks, dependencies and assumptions are risks. If a part has no relevant facts return empty lists.`;

// The whole document is read. Long text is split into parts at paragraph breaks and every part is sent.
const PART_SIZE = 40000;
const PART_MIN = 8000;
const PART_CONCURRENCY = 3;
const LIST_KEYS = ['deliverables', 'requirements', 'risks', 'milestones', 'schedule'];

function splitParts(text, size = PART_SIZE) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const floor = i + Math.floor(size * 0.6);
      const p = text.lastIndexOf('\n\n', end);
      const n = text.lastIndexOf('\n', end);
      end = p > floor ? p : n > floor ? n : end;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

const normQuote = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// A fact is kept only when its quote really appears in the part it came from.
function quoteFound(quote, hay) {
  const q = normQuote(quote);
  if (q.length < 6) return false;
  return hay.includes(q) || (q.length > 50 && (hay.includes(q.slice(0, 40)) || hay.includes(q.slice(-40))));
}

async function extractPart(part, label, depth = 0, retry = false) {
  try {
    const j = await claudeJSON(EXTRACT_SYSTEM, `${label}\n\nDocument text:\n${part}`, 12000);
    return { j, failed: 0 };
  } catch (e) {
    if (e.code === 'bad_key' || e.code === 'budget' || e.code === 'rate' || e.code === 'network') throw e;
    // A reply that was cut off means the part holds too many facts, so it is read again as two halves.
    if (e.code === 'cutoff' && depth < 2 && part.length > PART_MIN * 2) {
      const mid = part.lastIndexOf('\n', Math.floor(part.length / 2));
      const cut = mid > PART_MIN ? mid : Math.floor(part.length / 2);
      const a = await extractPart(part.slice(0, cut), label + ' (first half)', depth + 1);
      const b = await extractPart(part.slice(cut), label + ' (second half)', depth + 1);
      const halves = [a.j, b.j].filter(Boolean);
      return { j: halves.length ? { _halves: halves } : null, failed: a.failed + b.failed, error: a.error || b.error };
    }
    // An empty or invalid reply is tried once more on the same part.
    if (e.code === 'badjson' && !retry) return extractPart(part, label, depth, true);
    return { j: null, failed: 1, error: e.message, code: e.code };
  }
}

async function analyzeDocument({ text, filename, onProgress }) {
  const kind = classify(filename, text);
  let aiError = null;
  await aiReady;
  if (hasKey()) {
    try {
      const parts = splitParts(text);
      const results = new Array(parts.length);
      let next = 0;
      let done = 0;
      let lastError = null;
      let lastCode = null;
      const worker = async () => {
        while (next < parts.length) {
          const idx = next++;
          const r = await extractPart(parts[idx], `Filename: ${filename}. Part ${idx + 1} of ${parts.length}. Extract only what this part states.`);
          results[idx] = r;
          if (r.error) { lastError = r.error; lastCode = r.code || lastCode; }
          done++;
          if (onProgress) onProgress({ done, total: parts.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker));

      const merged = { kind: null, summary: '', fields: [], deliverables: [], requirements: [], risks: [], milestones: [], schedule: [] };
      let ok = 0, failed = 0, dropped = 0, charsSent = 0;
      const seen = new Set();
      const take = (j, partText, partIdx) => {
        if (!j) return;
        const hay = normQuote(partText);
        if (!merged.kind && j.kind) merged.kind = j.kind;
        if (!merged.summary && j.summary && partIdx === 0) merged.summary = String(j.summary);
        for (const k of ['fields', ...LIST_KEYS]) {
          for (const it of Array.isArray(j[k]) ? j[k] : []) {
            if (!it || typeof it !== 'object') continue;
            if (!quoteFound(it.quote, hay)) { dropped++; continue; }
            const sig = k + '|' + normQuote(it.title || it.name || it.field) + '|' + normQuote(it.value || it.due_date || it.start || it.percent);
            if (seen.has(sig)) continue;
            seen.add(sig);
            merged[k].push(it);
          }
        }
      };
      results.forEach((r, i) => {
        if (r.failed) failed++;
        if (r.j) {
          ok++;
          charsSent += parts[i].length;
          if (r.j._halves) r.j._halves.forEach((h) => take(h, parts[i], i));
          else take(r.j, parts[i], i);
        }
      });
      if (!ok) throw Object.assign(new Error(lastError || 'Claude returned nothing usable'), { code: lastCode || 'badjson' });
      merged.kind = merged.kind || kind;
      merged.engine = 'claude';
      merged.coverage = { chars_total: text.length, chars_sent: charsSent, parts: parts.length, parts_read: ok, parts_failed: failed, dropped_no_quote: dropped };
      if (!merged.summary) merged.summary = `Read ${filename} (${text.length.toLocaleString('en-US')} characters).`;
      return merged;
    } catch (e) {
      aiError = { code: e.code || 'upstream', message: e.message };
      console.error('AI extraction failed, using fallback:', e.message);
    }
  } else {
    aiError = { code: 'no_key', message: 'The Anthropic API key is not set on the server' };
  }
  const h = heuristicExtract(text, filename);
  const n = h.deliverables.length + h.requirements.length + h.risks.length + h.milestones.length + h.schedule.length + h.fields.length;
  return { kind, summary: `Rule based reading of ${filename}. Found ${n} candidate items.`, ...h, engine: 'rules', ai_error: aiError, coverage: { chars_total: text.length, chars_sent: text.length, parts: 1, parts_read: 1, parts_failed: 0, dropped_no_quote: 0 } };
}

// ---------- cross document reading ----------
const isoAdd = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validIso = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x));
// Turns Week 3 to Week 6 into real dates from an anchor day. Week 1 starts on the anchor.
function weeksToDates(anchor, sw, ew) {
  if (!validIso(anchor) || sw == null || !(sw >= 1)) return { start: null, end: null };
  const e = ew != null && ew >= sw ? ew : sw;
  return { start: isoAdd(anchor, (Math.round(sw) - 1) * 7), end: isoAdd(anchor, Math.round(e) * 7 - 3) };
}

// Plain code checks. Nothing here depends on the AI, so the verdicts can be trusted.
// input: { items:[{kind,title,data,doc,status}], project:{start_date,end_date,value,award_date}, docs:[{filename,status,coverage}] }
function runChecks({ items, project, docs }) {
  const live = items.filter((i) => i.status !== 'ignored');
  const by = (k) => live.filter((i) => i.kind === k);
  const checks = [];
  const add = (id, status, title, detail) => checks.push({ id, status, title, detail });
  const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fieldVals = (f) => by('field').filter((i) => i.data.field === f);

  // Coverage
  const unread = (docs || []).filter((d) => d.status && d.status !== 'done' && d.status !== 'empty');
  if ((docs || []).length) add('coverage', unread.length ? 'Warn' : 'Pass', 'Every document was read in full', unread.length ? `${unread.map((d) => d.filename).join(', ')} was not read completely, so some facts may be missing.` : 'All pages of all documents were read and each fact is tied to a quote.');

  // Contract value consistency
  const values = fieldVals('value').map((i) => ({ v: Number(i.data.value), doc: i.doc_name || '' })).filter((x) => x.v > 0);
  const priced = by('deliverable').filter((i) => i.data.amount > 0);
  const pricedSum = priced.reduce((a, i) => a + Number(i.data.amount), 0);
  const payAmt = by('milestone').filter((i) => i.data.amount > 0).reduce((a, i) => a + Number(i.data.amount), 0);
  const distinct = [...new Set(values.map((x) => Math.round(x.v * 100)))];
  if (distinct.length > 1) add('value', 'Fail', 'Contract value is the same in every document', `Documents state different values: ${[...new Set(values.map((x) => money(x.v)))].join(' and ')}. Confirm which one is binding. The award letter outranks the proposals.`);
  else if (distinct.length === 1) add('value', 'Pass', 'Contract value is the same in every document', `Stated value is ${money(values[0].v)}.`);
  const ref = distinct.length ? values[0].v : Number(project.value) || 0;
  if (ref && priced.length) {
    const diff = Math.abs(pricedSum - ref);
    add('sum', diff < 1 ? 'Pass' : diff / ref < 0.01 ? 'Warn' : 'Fail', 'Deliverable prices add up to the contract value', diff < 1 ? `${priced.length} priced deliverables add up to ${money(pricedSum)}, matching the contract value.` : `${priced.length} priced deliverables add up to ${money(pricedSum)} but the contract value is ${money(ref)}. Difference ${money(pricedSum - ref)}.`);
  }
  if (ref && payAmt) {
    const diff = Math.abs(payAmt - ref);
    add('pay', diff < 1 ? 'Pass' : 'Warn', 'Payment milestones add up to the contract value', diff < 1 ? `Payments total ${money(payAmt)}.` : `Payment milestones total ${money(payAmt)} against ${money(ref)}.`);
  }
  const pct = by('milestone').filter((i) => i.data.percent != null).reduce((a, i) => a + Number(i.data.percent), 0);
  if (by('milestone').some((i) => i.data.percent != null) && !(payAmt && ref && Math.abs(payAmt - ref) < 1)) add('pct', Math.abs(pct - 100) < 0.01 ? 'Pass' : 'Warn', 'Payment percentages add up to 100%', `Payment shares total ${Math.round(pct * 100) / 100}%.`);

  // Every payment line should match a deliverable in the proposal
  const dels = by('deliverable'), pays = by('milestone');
  if (dels.length && pays.length) {
    const numSet = (x) => [...new Set(String(x || '').match(/\d+/g) || [])].sort().join(',');
    const match = (a, b) => { const na = numSet(a), nb = numSet(b); if (na && nb && na !== nb) return false; return similarity(a, b) >= 0.5 || similarity(b, a) >= 0.5; };
    const orphan = pays.filter((m) => !dels.some((d) => match(m.title.replace(/^payment[:\s-]*/i, ''), d.title)));
    add('map', orphan.length ? 'Warn' : 'Pass', 'Every payment milestone matches a deliverable', orphan.length ? `${orphan.length} payment lines have no matching deliverable in the technical proposal: ${orphan.slice(0, 3).map((x) => x.title).join(', ')}.` : 'Each payment line is tied to a deliverable.');
  }

  // Dates
  const award = (fieldVals('award_date')[0] || {}).data;
  const awardIso = award && validIso(award.value) ? award.value : validIso(project.award_date) ? project.award_date : null;
  if (awardIso) {
    const early = [];
    for (const i of live) {
      const ds = i.kind === 'deliverable' || i.kind === 'milestone' ? (i.data.due_dates && i.data.due_dates.length ? i.data.due_dates : [i.data.due_date]) : i.kind === 'schedule' ? [i.data.end || i.data.start] : [];
      for (const d of ds) if (validIso(d) && d < awardIso && !(i.kind === 'schedule' && i.data.level === 'phase') && !early.includes(`${i.title} (${d})`)) early.push(`${i.title} (${d})`);
    }
    add('early', early.length ? 'Fail' : 'Pass', 'No delivery date falls before the award date', early.length ? `Award date is ${awardIso}. These dates are earlier: ${early.slice(0, 4).join(', ')}. The proposal dates were set before the award and need to be re baselined.` : `Award date is ${awardIso} and every dated item is after it.`);
  }
  // Go live before staging inside one release
  const rel = by('deliverable').concat(by('milestone')).filter((i) => validIso(i.data.due_date)).map((i) => ({ ...i, data: { ...i.data, due_date: i.data.due_dates && i.data.due_dates.length ? i.data.due_dates.slice().sort()[0] : i.data.due_date } }));
  const bad = [];
  for (const g of rel.filter((i) => /go[\s-]?live/i.test(i.title))) {
    const ph = (g.title.match(/phase\s*(\d)/i) || [])[1];
    for (const s of rel.filter((i) => /staging/i.test(i.title) && (i.title.match(/phase\s*(\d)/i) || [])[1] === ph && ph)) if (g.data.due_date < s.data.due_date) bad.push(`Phase ${ph} go live ${g.data.due_date} is before staging ${s.data.due_date}`);
  }
  if (rel.some((i) => /go[\s-]?live/i.test(i.title))) add('order', bad.length ? 'Fail' : 'Pass', 'Staging comes before go live', bad.length ? bad.join('. ') + '. Labels in the source table are inconsistent, confirm the real sequence with the client.' : 'Go live dates follow staging dates.');

  // Project window
  const sd = validIso(project.start_date) ? project.start_date : null;
  const ed = validIso(project.end_date) ? project.end_date : null;
  const ends = by('schedule').map((i) => i.data.end).filter(validIso).sort();
  if (ed && ends.length) {
    const last = ends[ends.length - 1];
    add('window', last > ed ? 'Warn' : 'Pass', 'Schedule finishes inside the project end date', last > ed ? `Schedule runs to ${last} but the project end date is ${ed}.` : `Last scheduled finish is ${last}, project ends ${ed}.`);
  }
  if (!sd && !awardIso && by('schedule').some((i) => i.data.start_week != null && !i.data.start)) add('anchor', 'Warn', 'A start date is needed to place the weeks on the calendar', 'The plan is written as Week 1 to Week N. Confirm the project start date so the weeks can be turned into dates.');
  // Competing schedule models
  const wk = by('schedule').filter((i) => i.data.end_week != null).map((i) => Number(i.data.end_week));
  const wkMax = wk.length ? Math.max(...wk) : 0;
  if (wkMax && ends.length && (sd || awardIso)) {
    const a = sd || awardIso;
    const weeksByDates = Math.round((Date.parse((ends[ends.length - 1])) - Date.parse(a)) / (7 * 86400e3));
    const gap = Math.abs(weeksByDates - wkMax);
    add('models', gap > 4 ? 'Warn' : 'Pass', 'Week plan and calendar dates agree', gap > 4 ? `The week plan runs ${wkMax} weeks but the dated windows run about ${weeksByDates} weeks from ${a}. The documents describe two different timelines.` : 'The week plan and the dated windows span a similar length.');
  }
  return checks;
}

const SYNTH_SYSTEM = `You are a principal project manager with more than twenty years of delivery experience on government and enterprise technology programs. You hold PMP and PRINCE2 qualifications and you work to PMBOK and ISO 21502. You are building the baseline delivery schedule for a project from several documents, the way you would enter it in MS Project before the kick off. You receive numbered items already extracted and verified from the documents (phases, tasks, milestones, deliverables with prices and dates, payment milestones), plus the anchor date.

Your job is to turn the stated plan into a complete, workable schedule, not to copy a table. Think like the person accountable for delivery:
1. Keep every stated phase, task, gate and date. These are basis "stated" and they cite their items.
2. Add the work that a real project needs but the documents do not list. These are basis "implied". For every deliverable and gate add the steps in between: prepare or draft it, client review, approval or sign off, and the invoice trigger when a payment depends on it. Add mobilization and contract steps, kick off, governance setup, requirements workshops, design reviews, security and architecture reviews, sprint build with demo and acceptance when the approach is agile, system and integration testing, UAT planning, UAT cycles, defect fixing, security testing, CAB or change approval, deployment and rollback rehearsal, go live verification, hypercare, training, handover and closure, and recurring governance such as the weekly status meeting and the monthly steering committee.
3. Give every task a realistic duration in working days. Use typical durations unless the documents state one: client review of plans and governance 3 days, requirements 5 days, designs 3 days, security architecture review 4 days, sprint demo and review 2 days, UAT cycle 5 to 8 days, CAB review 2 days, approval 1 day after the review. Show the review and the approval as separate lines, with type review and type approval, owned by the client. These client lines are where schedule risk sits, so never skip them.
4. Link everything. Give depends_on for every row that follows other work, naming predecessors exactly as they are named in the plan. List rows so that a predecessor always appears before its successors. Every phase after the first and every gate depends on the work before it.
5. Tie money to the plan. Each payment milestone must be triggered by an approval line for its deliverable, followed by a milestone line for the invoice.

Return JSON: {"summary":"3 to 5 sentences: what is being delivered, for whom, the contract value, the overall duration and the main risk to the dates","plan":[{"level":"phase|task|milestone","type":"task|review|approval|milestone","name":"","phase":"parent phase name or null","start":"YYYY-MM-DD or null","end":"YYYY-MM-DD or null","start_week":number or null,"end_week":number or null,"start_day":number or null,"duration_days":number or null,"owner":"role or party","depends_on":["predecessor name"],"basis":"stated|implied","assumption":"for implied rows, one sentence on why it is needed and where the duration comes from","refs":[item numbers]}],"notes":["one line per conflict, gap or assumption the project manager must resolve"]}

Timing rules. Never invent calendar dates. Use explicit start and end dates only when an item states them. A phase with week numbers gets start_week and end_week, where week 1 starts on the anchor date. For every other row use start_day, the working day number counted from the anchor date where day 1 is the anchor day, and duration_days. Week n starts on working day (n minus 1) times 5 plus 1. A milestone has start_day and no duration. A dependent row never starts before its predecessors end.

Evidence rules. Stated rows cite the items they come from in refs. Implied rows cite the item of the phase, deliverable or gate they support, so every row has at least one valid ref. Merge duplicates that describe the same work from different documents. Order the plan so that phases come before their tasks. Documents rank: award letter, then financial offer, then technical proposal. When documents disagree on a date, value or scope, schedule the higher ranked one and list the disagreement in notes. Also list in notes every date that falls before the award date, every go live dated before its staging, and any gap between the week plan and the dated windows. State your assumptions in notes, including review durations and holidays. Aim for 50 to 90 rows. Keep each name under 60 characters and keep assumption text to one short sentence. Write all text as plain sentences without dashes or semicolons.`;

async function synthesizeSchedule({ docs, items, anchor, project }) {
  await aiReady;
  if (!hasKey()) return null;
  const rows = items.filter((i) => i.status !== 'ignored' && ['schedule', 'deliverable', 'milestone'].includes(i.kind));
  if (!rows.length) return null;
  const list = rows.slice(0, 220).map((i, n) => ({ n: n + 1, kind: i.kind, doc: i.doc_name || '', ref: i.data.ref || null, name: i.title, level: i.data.level || null, type: i.data.type || null, phase: i.data.phase || null, owner: i.data.owner || null, start: i.data.start || i.data.due_date || null, end: i.data.end || null, start_week: i.data.start_week ?? null, end_week: i.data.end_week ?? null, days: i.data.duration_days ?? null, amount: i.data.amount ?? null, percent: i.data.percent ?? null, trigger: i.data.trigger || null, acceptance: i.data.acceptance || null, depends_on: i.data.depends_on || null }));
  const userMsg = `Anchor date for Week 1: ${anchor || 'unknown'}\nProject: ${JSON.stringify({ value: project.value, currency: project.currency, award_date: project.award_date || null, start_date: project.start_date || null, end_date: project.end_date || null })}\nDocuments: ${JSON.stringify(docs.map((d) => ({ file: d.filename, kind: d.kind, summary: d.summary })))}\nItems: ${JSON.stringify(list)}`;
  try {
    let j;
    // Part of the reply budget goes to the model's own reasoning, so a long plan can be cut off. Keep every complete row that arrived.
    const salvage = (txt) => {
      const a = txt.indexOf('"plan"');
      if (a < 0) return null;
      const open = txt.indexOf('[', a);
      for (let i = txt.length; i > open; i--) {
        if (txt[i - 1] !== '}') continue;
        try { const arr = JSON.parse(txt.slice(open, i) + ']'); if (Array.isArray(arr) && arr.length >= 3) return { summary: '', plan: arr, notes: ['The schedule was long and was cut off, so the last rows may be missing. Use Analyze again to rebuild it.'] }; } catch (e) { /* keep scanning back */ }
      }
      return null;
    };
    try { j = await claudeJSON(SYNTH_SYSTEM, userMsg, 30000); }
    catch (e) {
      if (e.code !== 'cutoff') throw e;
      j = salvage(e.text || '');
      if (!j) j = await claudeJSON(SYNTH_SYSTEM + '\nThe plan must fit in the reply: use 40 to 60 rows, keep names short, and leave out assumption text for rows whose duration is a standard one.', userMsg, 30000);
    }
    if (!j || !Array.isArray(j.plan)) return null;
    const plan = [];
    const refsByName = new Map();
    let lastRefs = [];
    for (const r of j.plan) {
      if (!r || !String(r.name || '').trim()) continue;
      const implied = r.basis === 'implied';
      let refs = (Array.isArray(r.refs) ? r.refs : []).map((n) => rows[Number(n) - 1]).filter(Boolean);
      // An implied row supports a phase, deliverable or gate. If the model forgot the reference, inherit it from its phase.
      if (!refs.length && implied) refs = refsByName.get(String(r.phase || '').trim().toLowerCase()) || lastRefs;
      if (!refs.length) continue;
      let start = validIso(r.start) ? r.start : null;
      let end = validIso(r.end) ? r.end : null;
      const sw = r.start_week != null ? Number(r.start_week) : null;
      const ew = r.end_week != null ? Number(r.end_week) : null;
      if (!start && sw) { const w = weeksToDates(anchor, sw, ew); start = w.start; end = end || w.end; }
      const level = ['phase', 'task', 'milestone'].includes(r.level) ? r.level : 'task';
      const type = ['task', 'review', 'approval', 'milestone'].includes(r.type) ? r.type : level === 'milestone' ? 'milestone' : 'task';
      const sd = Number(r.start_day) > 0 ? Math.round(Number(r.start_day)) : null;
      const dd = Number(r.duration_days) > 0 ? Math.round(Number(r.duration_days)) : null;
      const name = String(r.name).trim().slice(0, 140);
      refsByName.set(name.toLowerCase(), refs);
      lastRefs = refs;
      plan.push({ level, type, name, phase: r.phase ? String(r.phase).slice(0, 140) : null, start, end, start_week: sw, end_week: ew, start_day: start ? null : sd, duration_days: dd, owner: r.owner ? String(r.owner).slice(0, 80) : null, implied, assumption: implied && r.assumption ? String(r.assumption).slice(0, 240) : null, depends_on: (Array.isArray(r.depends_on) ? r.depends_on : []).map(String).filter(Boolean), refs: refs.map((x) => x.id), quote: (refs[0].quote || '').slice(0, 300), source_docs: [...new Set(refs.map((x) => x.doc_name).filter(Boolean))] });
    }
    return { summary: String(j.summary || ''), plan, notes: (Array.isArray(j.notes) ? j.notes : []).map(String).filter(Boolean).slice(0, 16) };
  } catch (e) {
    console.error('Synthesis failed:', e.message);
    return { failed: true, reason: e.message, code: e.code || null, plan: [], notes: [], summary: '' };
  }
}

// ---------- matching helpers ----------
const STOP = new Set('the a an of and or to for in on at by with from is are was were be been this that it as we i you our your will has have had done complete completed finished update status task'.split(' '));
function tokens(s) {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}
function similarity(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  const overlapOfTask = hit / ta.size;
  const al = (a || '').toLowerCase();
  const bl = (b || '').toLowerCase();
  const sub = bl.includes(al) || (al.length > 5 && al.includes(bl)) ? 1 : 0;
  return Math.max(overlapOfTask, sub);
}

// Interpret an incoming message (Teams, email, Jira) against project data.
async function interpretMessage({ text, sender, tasks, resources, deliverables }) {
  await aiReady;
  if (hasKey()) {
    try {
      const j = await claudeJSON(
        `You read project communications and decide which project records they update.
Return {"updates":[{"type":"update_task|close_deliverable|flag_issue","task_id":number|null,"deliverable_id":number|null,"progress":0-100|null,"delay_days":number|null,"assignee":string|null,"note":"short","confidence":0.0-1.0}],"resource":"name of the person reporting or null"}.
Use only ids from the lists. Do not invent updates. If the message contains no project status information return {"updates":[]}.`,
        `Sender: ${sender}\nMessage: ${text}\n\nTasks: ${JSON.stringify(tasks.map((t) => ({ id: t.id, name: t.name, progress: t.progress, assignee: t.assignee })))}\nDeliverables: ${JSON.stringify(deliverables.map((d) => ({ id: d.id, title: d.title })))}\nResources: ${JSON.stringify(resources.map((r) => r.name))}`,
        2000
      );
      if (j) return { updates: j.updates || [], resource: j.resource || null, engine: 'claude' };
    } catch (e) {
      console.error('AI interpret failed:', e.message);
    }
  }
  return heuristicInterpret({ text, sender, tasks, resources, deliverables });
}

function heuristicInterpret({ text, sender, tasks, resources, deliverables }) {
  const lower = text.toLowerCase();
  let resource = null;
  for (const r of resources) {
    const nm = r.name.toLowerCase();
    if ((sender && (sender.toLowerCase().includes(nm) || nm.includes(sender.toLowerCase()) || (r.email && sender.toLowerCase().includes(r.email.toLowerCase())))) || lower.includes(nm)) { resource = r.name; break; }
  }
  // find the best matching task by name
  let best = null, bestScore = 0;
  for (const t of tasks) {
    const s = similarity(t.name, text);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  let bestD = null, bestDScore = 0;
  for (const d of deliverables) {
    const s = similarity(d.title, text);
    if (s > bestDScore) { bestDScore = s; bestD = d; }
  }
  const updates = [];
  const pct = lower.match(/(\d{1,3})\s*(?:%|per\s?cent)/);
  const doneWord = /\b(done|completed?|finished|closed|delivered|signed off|accepted|resolved|deployed|live)\b/.test(lower);
  const done = doneWord && (!pct || parseInt(pct[1], 10) >= 100);
  const started = /\b(started|kicked off|begun|began|in progress|working on)\b/.test(lower);
  const delay = lower.match(/(?:delay(?:ed)?|slip(?:ped)?|push(?:ed)? back|late)\D{0,20}(\d+)\s*(day|week)/);
  const blocked = /\b(blocked|blocker|stuck|waiting on|on hold)\b/.test(lower);

  if (best && bestScore >= 0.5) {
    const conf = Math.min(0.95, 0.5 + bestScore * 0.45);
    if (pct) updates.push({ type: 'update_task', task_id: best.id, progress: Math.min(100, parseInt(pct[1], 10)), note: text.slice(0, 160), confidence: conf });
    else if (done) updates.push({ type: 'update_task', task_id: best.id, progress: 100, note: text.slice(0, 160), confidence: conf });
    else if (started && (best.progress || 0) === 0) updates.push({ type: 'update_task', task_id: best.id, progress: 10, note: text.slice(0, 160), confidence: conf - 0.1 });
    if (delay) {
      const n = parseInt(delay[1], 10) * (delay[2] === 'week' ? 5 : 1);
      updates.push({ type: 'update_task', task_id: best.id, delay_days: n, note: text.slice(0, 160), confidence: conf - 0.1 });
    }
    if (blocked) updates.push({ type: 'flag_issue', task_id: best.id, note: text.slice(0, 200), confidence: conf - 0.05 });
  }
  if (bestD && bestDScore >= 0.6 && done) {
    updates.push({ type: 'close_deliverable', deliverable_id: bestD.id, note: text.slice(0, 160), confidence: Math.min(0.9, 0.5 + bestDScore * 0.4) });
  }
  return { updates, resource, engine: 'rules' };
}

// Interpret an uploaded document as progress evidence.
async function interpretEvidence({ doc, deliverables, tasks, milestones, projectName }) {
  await aiReady;
  if (hasKey()) {
    try {
      const j = await claudeJSON(
        `A project manager uploaded a document during project execution. Decide which project records it updates.
Return {"updates":[{"type":"close_deliverable|update_task|milestone_invoiced|milestone_paid","deliverable_id":number|null,"task_id":number|null,"milestone_id":number|null,"progress":0-100|null,"note":"short reason","confidence":0.0-1.0}]}.
Use only ids from the lists. A BOQ, delivery note, handover or acceptance record can close the deliverable it covers. An invoice relates to a payment milestone. If nothing matches return {"updates":[]}.`,
        `Filename: ${doc.filename}\nDetected type: ${doc.kind}\nText:\n${doc.text.slice(0, 100000)}\n\nDeliverables: ${JSON.stringify(deliverables.map((d) => ({ id: d.id, title: d.title, state: d.state })))}\nTasks: ${JSON.stringify(tasks.map((t) => ({ id: t.id, name: t.name, progress: t.progress })))}\nPayment milestones: ${JSON.stringify(milestones.map((m) => ({ id: m.id, title: m.title, state: m.state })))}`,
        3000
      );
      if (j) return { updates: j.updates || [], engine: 'claude' };
    } catch (e) {
      console.error('AI evidence failed:', e.message);
    }
  }
  const hay = `${doc.filename}\n${doc.text}`;
  const updates = [];
  const ignore = new Set(tokens(projectName || ''));
  // Whole title present = strong match. All distinctive words present = good match.
  // Partial overlap never counts, and words from the project name are ignored.
  const score = (title) => {
    const tt = tokens(title).filter((w) => !ignore.has(w));
    if (!tt.length) return 0;
    if (hay.toLowerCase().includes(String(title).toLowerCase())) return 1;
    const hs = new Set(tokens(hay));
    const hit = tt.filter((w) => hs.has(w)).length;
    if (hit === tt.length) return tt.length >= 2 ? 0.85 : 0.7;
    return (hit / tt.length) * 0.5;
  };
  const evidenceKinds = ['boq', 'evidence', 'minutes', 'other', 'po', 'contract', 'proposal'];
  if (evidenceKinds.includes(doc.kind)) {
    for (const d of deliverables) {
      if (d.state === 'closed') continue;
      const s = score(d.title);
      if (s >= 0.7) updates.push({ type: 'close_deliverable', deliverable_id: d.id, note: `Referenced in ${doc.filename}`, confidence: Math.min(0.92, 0.45 + s * 0.47) });
    }
  }
  if (doc.kind === 'invoice') {
    for (const m of milestones) {
      if (m.state !== 'pending') continue;
      const s = score(m.title);
      const md = JSON.parse(m.data || '{}');
      const amt = md.amount ? hay.replace(/,/g, '').includes(String(Math.round(md.amount))) : false;
      if (s >= 0.7 || amt) updates.push({ type: 'milestone_invoiced', milestone_id: m.id, note: `Invoice ${doc.filename}`, confidence: amt ? 0.85 : 0.6 });
    }
  }
  return { updates, engine: 'rules' };
}

module.exports = { aiStats, hasKey, claude, claudeJSON, splitParts, quoteFound, normQuote, ready: () => aiReady, extractText, classify, analyzeDocument, runChecks, synthesizeSchedule, weeksToDates, interpretMessage, interpretEvidence, similarity, tokens, parseDate, parseAmount, findCurrency, MODEL };
;return module.exports})();
window.__Reports=(function(){var module={exports:{}};var exports=module.exports;var process={env:{}};var require=function(n){if(n==='./schedule')return window.__Sched;if(n==='./ai')return window.__AI;if(n==='docx')return new Proxy({},{get:function(){return function(){}}});return {}};
// Report and document generation: default and custom templates, progress reports
// against baseline, DOCX export. Uses Claude to draft sections when a key is set.
const fs = require('fs');
const path = require('path');
const AI = require('./ai');
const S = require('./schedule');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  Footer, Header, PageNumber, AlignmentType, ShadingType, ImageRun, BorderStyle,
} = require('docx');

const money = (n, cur) => (n == null || n === '' ? 'To be confirmed' : `${cur || ''} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`.trim());
const esc = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const md = {
  table(headers, rows) {
    if (!rows.length) return '_No records yet._';
    return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
  },
  bullets: (arr) => (arr.length ? arr.map((a) => `- ${a}`).join('\n') : '_None recorded._'),
};

const DEFAULTS = {
  charter: {
    title: 'Project Charter',
    sections: [
      ['Project Purpose and Justification', 'purpose'], ['Objectives', 'objectives'], ['Scope and Deliverables', 'deliverables'],
      ['Out of Scope', 'outofscope'], ['Requirements Summary', 'requirements'], ['Milestones and Timeline', 'timeline'],
      ['Budget and Payment Milestones', 'budget'], ['Key Risks', 'risks'], ['Assumptions and Constraints', 'assumptions'],
      ['Team and Stakeholders', 'team'], ['Governance and Reporting', 'governance'], ['Approval', 'approval'],
    ],
  },
  pm_plan: {
    title: 'Project Management Plan',
    sections: [
      ['Introduction', 'purpose'], ['Scope Management', 'scope_mgmt'], ['Schedule Management', 'schedule_mgmt'],
      ['Cost Management', 'budget'], ['Quality Management', 'quality_mgmt'], ['Resource Management', 'team'],
      ['Communications Management', 'comms_matrix'], ['Risk Management', 'risk_mgmt'], ['Procurement Management', 'procurement_mgmt'],
      ['Stakeholder Management', 'team'], ['Change Management', 'change_mgmt'], ['Project Baselines', 'timeline'], ['Approval', 'approval'],
    ],
  },
  risk_plan: {
    title: 'Risk Management Plan',
    sections: [
      ['Purpose and Scope', 'risk_purpose'], ['Roles and Responsibilities', 'risk_roles'], ['Risk Assessment Method', 'risk_method'],
      ['Risk Register', 'risks'], ['Risk Exposure Summary', 'risk_matrix'], ['Response Strategies', 'risk_responses'],
      ['Monitoring and Reporting', 'risk_monitoring'], ['Escalation', 'escalation'],
    ],
  },
  comms_plan: {
    title: 'Communications Management Plan',
    sections: [
      ['Purpose', 'comms_purpose'], ['Stakeholders and Team', 'team'], ['Communication Matrix', 'comms_matrix'],
      ['Reporting', 'governance'], ['Escalation', 'escalation'], ['Approval', 'approval'],
    ],
  },
  governance: {
    title: 'Project Governance Document',
    sections: [
      ['Governance Structure', 'gov_structure'], ['Decision Rights', 'gov_decisions'], ['Meeting Cadence', 'comms_matrix'],
      ['Change Control Process', 'change_mgmt'], ['Escalation Path', 'escalation'], ['Reporting', 'governance'], ['Approval', 'approval'],
    ],
  },
  quality_plan: {
    title: 'Quality Management Plan',
    sections: [
      ['Quality Objectives', 'quality_obj'], ['Quality Standards and Acceptance Criteria', 'requirements'],
      ['Deliverable Acceptance', 'deliverables'], ['Quality Assurance Activities', 'quality_mgmt'], ['Approval', 'approval'],
    ],
  },
  progress_weekly: {
    title: 'Weekly Progress Report', period: 7,
    sections: [
      ['Executive Summary', 'p_summary'], ['Progress Against Baseline', 'p_metrics'], ['Activity This Period', 'p_activity'],
      ['Schedule Variance', 'p_variance'], ['Planned Next Period', 'p_next'], ['Deliverables Status', 'p_deliverables'],
      ['Payment Milestones', 'p_payments'], ['Risks and Issues', 'p_risks'], ['Decisions and Support Needed', 'p_actions'],
    ],
  },
  progress_biweekly: {
    title: 'Bi-weekly Progress Report', period: 14,
    sections: [
      ['Executive Summary', 'p_summary'], ['Progress Against Baseline', 'p_metrics'], ['Activity This Period', 'p_activity'],
      ['Schedule Variance', 'p_variance'], ['Planned Next Period', 'p_next'], ['Deliverables Status', 'p_deliverables'],
      ['Payment Milestones', 'p_payments'], ['Risks and Issues', 'p_risks'], ['Decisions and Support Needed', 'p_actions'],
    ],
  },
  // One slide in PowerPoint. The slide is drawn from the data in visuals.js. These sections are the text behind it.
  progress_onepager: {
    title: 'One Slide Status Report', period: 7, oneSlide: true,
    sections: [
      ['Executive Summary', 'p_summary'], ['Progress Against Baseline', 'p_metrics'], ['Achievements This Period', 'p_activity'],
      ['Planned Next Period', 'p_next'], ['Reasons for Delay', 'p_variance'], ['Risks and Issues', 'p_risks'], ['Decisions and Support Needed', 'p_actions'],
    ],
  },
};

const DOC_TYPES = Object.entries(DEFAULTS).map(([id, d]) => ({ id, title: d.title, progress: id.startsWith('progress'), oneSlide: !!d.oneSlide, sections: d.sections.map((s) => s[0]) }));

const SYN = [
  ['p_summary', /executive summary|summary|overview of progress/], ['p_metrics', /progress|baseline|performance|status/],
  ['p_activity', /activity|accomplish|completed|achievement/], ['p_variance', /variance|slippage|delay/],
  ['p_next', /next period|upcoming|look ahead|planned/], ['p_deliverables', /deliverable/], ['p_payments', /payment|invoice|financ/],
  ['p_risks', /risk|issue/], ['p_actions', /decision|support|action|escalat/],
  ['purpose', /purpose|justification|background|introduction|overview/], ['objectives', /objective|goal/],
  ['outofscope', /out of scope|exclusion/], ['deliverables', /deliverable|scope/], ['requirements', /requirement/],
  ['timeline', /timeline|schedule|milestone/], ['budget', /budget|cost|payment/], ['risks', /risk/], ['assumptions', /assumption|constraint/],
  ['team', /team|stakeholder|resource|roles/], ['governance', /governance|reporting/], ['comms_matrix', /communication/],
  ['escalation', /escalation/], ['change_mgmt', /change/], ['approval', /approval|sign/],
];

// ---------- context ----------
function buildContext({ project, user, tasks, items, resources, docs, audit, inbox, today, periodDays, lastWeek }) {
  const live = items.filter((i) => i.status !== 'ignored').map((i) => ({ ...i, d: safe(i.data) }));
  const by = (k) => live.filter((i) => i.kind === k);
  const sched = S.schedule(tasks, project);
  const metrics = S.progressMetrics(tasks, project, today);
  const hasBaseline = tasks.some((t) => t.b_start);
  const start = S.addDays(today, -(periodDays || 7) + 1);
  const next = S.addDays(today, periodDays || 7);
  return {
    project, user, today, tasks: sched, metrics, hasBaseline, resources, docs, inbox, lastWeek: lastWeek || null,
    deliverables: by('deliverable'), requirements: by('requirement'), risks: by('risk'), milestones: by('milestone'),
    audit: audit.filter((a) => a.ts.slice(0, 10) >= start && a.ts.slice(0, 10) <= today),
    unconfirmed: live.filter((i) => i.status === 'proposed').length,
    period: { start, end: today, next, days: periodDays || 7 },
  };
}
const safe = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// ---------- generators ----------
// Lines shared by the progress reports and the one slide status report.
function activityLines(c, n) {
  return c.audit.filter((a) => /task|deliverable|milestone/.test(a.action)).slice(0, n).map((a) => ({ date: a.ts.slice(0, 10), text: summarizeAudit(a) }));
}
function nextRows(c, n) {
  return c.tasks.filter((t) => !t.summary && (t.progress || 0) < 100 && t.start <= c.period.next && t.finish >= c.today).slice(0, n);
}
function decisionLines(c) {
  const items = [];
  const late = c.metrics.rows.filter((r) => r.overdue).slice(0, 5);
  for (const r of late) items.push(`Recovery plan needed for overdue task: ${r.name}.`);
  const pend = (c.inbox || []).filter((i) => i.status === 'pending').length;
  if (pend) items.push(`${pend} project update suggestion${pend === 1 ? '' : 's'} waiting for confirmation.`);
  if (c.unconfirmed) items.push(`${c.unconfirmed} extracted item${c.unconfirmed === 1 ? '' : 's'} not yet confirmed.`);
  return items;
}

const G = {
  purpose: (c) => {
    // Only genuine summaries go into client facing text, never the internal rule engine notes.
    const sums = c.docs.filter((d) => d.summary && !/^Rule based reading/.test(d.summary) && ['proposal', 'contract'].includes(d.kind)).slice(0, 2).map((d) => d.summary);
    const p = c.project;
    return [
      `${p.name} is a project delivered for ${p.client || 'the client'}${p.value ? ` with a contract value of ${money(p.value, p.currency)}` : ''}. It runs from ${p.start_date || 'a date to be confirmed'} to ${p.end_date || 'a date to be confirmed'}.`,
      ...sums,
    ].join('\n\n');
  },
  objectives: (c) => md.bullets([
    `Deliver all ${c.deliverables.length} agreed deliverables by ${c.project.end_date || 'the contract end date'}.`,
    c.project.value ? `Complete the work within the contract value of ${money(c.project.value, c.project.currency)}.` : 'Complete the work within the agreed budget.',
    `Satisfy the ${c.requirements.length} documented requirements and obtain client acceptance for each deliverable.`,
    'Keep risks visible and managed through a regular review cycle.',
  ]),
  deliverables: (c) => md.table(['Deliverable', 'Description', 'Due Date', 'Status'], c.deliverables.map((d) => [d.title, (d.description || '').slice(0, 140), d.d.due_date || 'TBC', d.state === 'closed' ? 'Closed' : 'Open'])),
  outofscope: () => 'Any work that is not listed under deliverables or requirements is out of scope and is handled through the change control process. Exclusions stated in the contract take precedence over this summary and should be added here during review.',
  requirements: (c) => md.table(['Ref', 'Requirement', 'Priority'], c.requirements.map((r, i) => [`R${String(i + 1).padStart(2, '0')}`, r.description || r.title, r.d.priority || 'Should'])),
  timeline: (c) => {
    const rows = c.tasks.filter((t) => !t.parent_id || t.summary).map((t) => [t.name, t.start, t.finish, `${t.duration} working days`, `${t.progress || 0}%`]);
    return md.table(['Phase or Task', 'Start', 'Finish', 'Duration', 'Progress'], rows.slice(0, 40));
  },
  budget: (c) => {
    const p = c.project;
    const rows = c.milestones.map((m) => [m.title, m.d.percent != null ? `${m.d.percent}%` : '', m.d.amount != null ? money(m.d.amount, p.currency) : (m.d.percent != null && p.value ? money(p.value * m.d.percent / 100, p.currency) : 'TBC'), m.d.due_date || 'TBC', m.state === 'paid' ? 'Paid' : m.state === 'invoiced' ? 'Invoiced' : 'Pending']);
    return `Contract value: **${money(p.value, p.currency)}**\n\n${md.table(['Payment Milestone', 'Share', 'Amount', 'Due', 'Status'], rows)}`;
  },
  risks: (c) => md.table(['Risk', 'Probability', 'Impact', 'Mitigation', 'Status'], c.risks.map((r) => [r.title, r.d.probability || 'Medium', r.d.impact || 'Medium', r.d.mitigation || 'To be defined', r.state || 'open'])),
  assumptions: (c) => md.bullets([
    `Working week: ${workDaysLabel(c.project)}, ${c.project.work_start} to ${c.project.work_end}.`,
    `Contract currency: ${c.project.currency}.`,
    'The client provides timely access, information and approvals as required by the schedule.',
    'Changes to scope, schedule or cost follow the change control process.',
    'Dependencies on third parties are tracked in the schedule and the risk register.',
  ]),
  team: (c) => (c.resources.some((r) => r.organization) ? md.table(['Name', 'Role', 'Organization', 'Email'], c.resources.map((r) => [r.name, r.role || '', r.organization || '', r.email || ''])) : md.table(['Name', 'Role', 'Email'], c.resources.map((r) => [r.name, r.role || '', r.email || '']))) + (c.resources.length ? '' : '\n\nTeam members are added under project settings.'),
  governance: (c) => md.bullets([
    'Weekly progress report issued to the client project sponsor.',
    'Bi-weekly steering review covering progress against baseline, risks and change requests.',
    'Monthly executive summary for senior stakeholders.',
    `Progress is measured against the approved baseline. Current baseline: ${c.hasBaseline ? 'set' : 'not yet set'}.`,
  ]),
  approval: (c) => md.table(['Role', 'Name', 'Signature', 'Date'], [['Project Manager', c.user?.name || '', '', ''], ['Client Sponsor', c.project.client || '', '', ''], ['Executive Sponsor', '', '', '']]),
  scope_mgmt: (c) => `Scope is defined by ${c.deliverables.length} deliverables and ${c.requirements.length} requirements extracted from the contract documents. Each deliverable is closed only with documented evidence of delivery or acceptance. Any addition or removal follows change control.`,
  schedule_mgmt: (c) => `The schedule contains ${c.tasks.filter((t) => !t.summary).length} tasks on a ${workDaysLabel(c.project)} calendar. Progress is updated from team reports and uploaded evidence and measured against the approved baseline.\n\n${G.timeline(c)}`,
  quality_mgmt: () => md.bullets(['Each deliverable has agreed acceptance criteria before work starts.', 'Peer review before any client submission.', 'Defects are logged, prioritized and tracked to closure.', 'Quality is reviewed at every milestone.']),
  quality_obj: (c) => md.bullets([`Meet all ${c.requirements.length} requirements.`, 'First time acceptance of deliverables.', 'No open critical defects at handover.']),
  procurement_mgmt: () => 'Procurement of third party licenses, services or hardware follows company policy and is recorded with the supplier, cost and delivery date. Items on the critical path are ordered early.',
  change_mgmt: () => md.bullets(['A change request is raised with description, reason, and impact on scope, schedule and cost.', 'The project manager assesses impact and prepares options.', 'The change board approves or rejects. Approved changes update the baseline.', 'All changes are logged with decision date and owner.']),
  comms_matrix: () => md.table(['Communication', 'Audience', 'Frequency', 'Owner', 'Channel'], [
    ['Progress report', 'Client sponsor', 'Weekly', 'Project manager', 'Email and portal'], ['Steering review', 'Steering committee', 'Bi-weekly', 'Project manager', 'Meeting'],
    ['Team stand up', 'Delivery team', 'Daily or twice weekly', 'Team lead', 'Teams'], ['Risk review', 'Project team', 'Bi-weekly', 'Project manager', 'Meeting'],
    ['Executive summary', 'Senior management', 'Monthly', 'Project manager', 'Email']]),
  escalation: () => md.table(['Level', 'Who', 'When'], [['1', 'Project manager', 'Issue cannot be resolved by the team in two working days'], ['2', 'Program or delivery director', 'Issue affects a milestone or budget'], ['3', 'Executive sponsor', 'Issue threatens contract objectives']]),
  comms_purpose: (c) => `This plan describes how information flows between the ${c.project.name} team, the client and other stakeholders.`,
  gov_structure: (c) => md.table(['Body', 'Members', 'Purpose'], [['Steering committee', `${c.project.client || 'Client'} sponsor, executive sponsor, project manager`, 'Direction, approvals and escalations'], ['Project team', c.resources.map((r) => r.name).join(', ') || 'Delivery team', 'Execution and reporting']]),
  gov_decisions: () => md.table(['Decision', 'Decided by', 'Consulted'], [['Scope change', 'Steering committee', 'Project manager'], ['Schedule baseline change', 'Steering committee', 'Project manager'], ['Deliverable acceptance', 'Client sponsor', 'Project manager'], ['Day to day task decisions', 'Project manager', 'Team']]),
  risk_purpose: (c) => `This plan defines how risks for ${c.project.name} are identified, assessed, responded to and monitored. It currently covers ${c.risks.length} registered risks.`,
  risk_roles: () => md.bullets(['Project manager owns the risk register and the review cycle.', 'Risk owners are named per risk and report status.', 'Steering committee decides on risks above agreed tolerance.']),
  risk_method: () => md.table(['Level', 'Probability', 'Impact'], [['Low', 'Unlikely, under 20%', 'Minor effect on schedule or cost'], ['Medium', 'Possible, 20 to 60%', 'Noticeable effect, recoverable'], ['High', 'Likely, over 60%', 'Threatens a milestone or budget']]),
  risk_matrix: (c) => {
    const lv = ['High', 'Medium', 'Low'];
    const rows = lv.map((p) => [p, ...lv.map((i) => String(c.risks.filter((r) => (r.d.probability || 'Medium') === p && (r.d.impact || 'Medium') === i).length))]);
    return md.table(['Probability / Impact', 'High', 'Medium', 'Low'], rows);
  },
  risk_responses: () => md.bullets(['Avoid: change the plan to remove the risk.', 'Mitigate: reduce probability or impact.', 'Transfer: shift the impact to a third party.', 'Accept: monitor and keep a contingency.']),
  risk_monitoring: () => 'The register is reviewed at every bi-weekly meeting. New risks found in communications are proposed in the inbox for the project manager to accept.',

  // Progress report
  p_summary: (c) => {
    const m = c.metrics;
    const state = m.spi == null ? 'No baseline is set, so progress is reported against the current plan only.' : m.spi >= 0.95 ? 'The project is on track against baseline.' : m.spi >= 0.8 ? 'The project is slightly behind baseline.' : 'The project is significantly behind baseline.';
    return `Reporting period ${c.period.start} to ${c.period.end}. Overall completion is **${m.actualPct}%**${m.plannedPct != null ? ` against **${m.plannedPct}%** planned` : ''}. ${state} ${m.overdue} task${m.overdue === 1 ? ' is' : 's are'} overdue.`;
  },
  p_metrics: (c) => {
    const m = c.metrics;
    return md.table(['Measure', 'Value'], [['Actual progress', `${m.actualPct}%`], ['Planned progress (baseline)', m.plannedPct != null ? `${m.plannedPct}%` : 'No baseline'], ['Schedule performance index', m.spi != null ? String(m.spi) : 'Not available'], ['Tasks overdue', String(m.overdue)], ['Total tasks', String(m.taskCount)]]);
  },
  p_activity: (c) => {
    return md.bullets(activityLines(c, 25).map((a) => `${a.date}: ${a.text}`));
  },
  p_variance: (c) => {
    const rows = c.metrics.rows.filter((r) => (r.slipDays && r.slipDays !== 0) || r.overdue).sort((a, b) => (b.slipDays || 0) - (a.slipDays || 0)).slice(0, 15);
    return md.table(['Task', 'Baseline Finish', 'Forecast Finish', 'Variance (working days)', 'Progress'], rows.map((r) => [r.name, r.b_end || 'No baseline', r.finish, r.slipDays != null ? (r.slipDays > 0 ? `+${r.slipDays}` : String(r.slipDays)) : '', `${r.progress || 0}%`]));
  },
  p_next: (c) => {
    const rows = nextRows(c, 20);
    return md.table(['Task', 'Start', 'Finish', 'Owner', 'Progress'], rows.map((t) => [t.name, t.start, t.finish, t.assignee || '', `${t.progress || 0}%`]));
  },
  p_deliverables: (c) => md.table(['Deliverable', 'Due', 'Status', 'Evidence'], c.deliverables.map((d) => [d.title, d.d.due_date || 'TBC', d.state === 'closed' ? 'Closed' : (d.d.due_date && d.d.due_date < c.today ? 'Overdue' : 'Open'), d.evidence_doc_id ? `Document ${d.evidence_doc_id}` : ''])),
  p_payments: (c) => md.table(['Milestone', 'Amount', 'Due', 'Status'], c.milestones.map((m) => [m.title, m.d.amount != null ? money(m.d.amount, c.project.currency) : (m.d.percent != null && c.project.value ? money(c.project.value * m.d.percent / 100, c.project.currency) : 'TBC'), m.d.due_date || 'TBC', m.state === 'paid' ? 'Paid' : m.state === 'invoiced' ? 'Invoiced' : 'Pending'])),
  p_risks: (c) => md.table(['Risk or Issue', 'Probability', 'Impact', 'Status'], c.risks.filter((r) => r.state !== 'closed').map((r) => [r.title, r.d.probability || 'Medium', r.d.impact || 'Medium', r.state || 'open'])),
  p_actions: (c) => {
    const items = decisionLines(c);
    return md.bullets(items.length ? items : ['No decisions are required this period.']);
  },
};

function summarizeAudit(a) {
  let d = {};
  try { d = JSON.parse(a.detail); } catch { /* plain text */ }
  return d.summary || d.note || `${a.action.replace(/_/g, ' ')}${d.name ? ' ' + d.name : ''}`;
}
function workDaysLabel(p) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let d = [];
  try { d = JSON.parse(p.work_days || '[1,2,3,4,5]'); } catch { d = [1, 2, 3, 4, 5]; }
  return d.map((i) => names[i]).join(', ');
}

// ---------- templates ----------
function parseTemplate(body) {
  const lines = body.split(/\r?\n/);
  let level = lines.some((l) => /^#\s+\S/.test(l)) ? 1 : 2;
  const re = new RegExp(`^#{${level}}\\s+(.*)$`);
  const sections = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(re);
    if (m) { cur = { heading: m[1].replace(/[*_]/g, '').trim(), body: [] }; sections.push(cur); } else if (cur) cur.body.push(l);
  }
  return sections.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() }));
}

function matchGenerator(heading, type) {
  const isProgress = type.startsWith('progress');
  for (const [key, re] of SYN) {
    if (key.startsWith('p_') !== isProgress) continue;
    if (re.test(heading.toLowerCase())) return key;
  }
  return null;
}

// ---------- custom documents ----------
// Every section the system can fill from project data: [generator key, heading, what it holds, words in a brief that call for it].
const LIBRARY = [
  ['p_summary', 'Executive Summary', 'A short summary of where the project stands, for busy readers.', /summary|overview|status|brief|update/],
  ['purpose', 'Purpose and Background', 'Why the project exists, who it is for and the contract basis.', /purpose|background|context|introduc|why/],
  ['objectives', 'Objectives', 'What the project must achieve.', /objective|goal|outcome|target/],
  ['deliverables', 'Scope and Deliverables', 'What will be delivered and when.', /scope|deliverable|output/],
  ['outofscope', 'Out of Scope', 'What is not included and how changes are handled.', /out of scope|exclusion|not included/],
  ['requirements', 'Requirements', 'The confirmed requirements with priority.', /requirement|specification|acceptance|criteria/],
  ['timeline', 'Timeline and Milestones', 'Phases and tasks with start, finish and progress.', /timeline|schedule|milestone|roadmap|plan(?:ned)? dates|phase/],
  ['budget', 'Budget and Payments', 'Contract value and the payment milestones.', /budget|cost|payment|invoice|financ|money|value/],
  ['risks', 'Key Risks', 'The open risks with probability, impact and mitigation.', /risk|threat|concern/],
  ['assumptions', 'Assumptions and Constraints', 'What the plan assumes and what limits it.', /assumption|constraint|dependenc/],
  ['team', 'Team and Stakeholders', 'Who is involved and in what role.', /team|stakeholder|resource|people|roles/],
  ['governance', 'Governance and Reporting', 'How the project is governed and reported.', /governance|reporting|steering|oversight/],
  ['comms_matrix', 'Communication Plan', 'Who gets which information, how often and by what channel.', /communicat|meeting|cadence/],
  ['change_mgmt', 'Change Control', 'How scope, time and cost changes are approved.', /change request|change control|change management/],
  ['escalation', 'Escalation Path', 'Who to go to when an issue cannot be solved at the working level.', /escalat/],
  ['quality_obj', 'Quality Objectives', 'The quality targets and how they are checked.', /quality|testing|standard/],
  ['p_metrics', 'Progress Against Baseline', 'Planned and actual progress and schedule performance.', /progress|baseline|performance|variance|spi/],
  ['p_activity', 'Recent Activity', 'What happened in the period.', /activity|accomplish|completed|achievement|done/],
  ['p_variance', 'Schedule Variance', 'Tasks that are late or ahead of the baseline.', /variance|slippage|delay|late/],
  ['p_next', 'Planned Next Period', 'What is planned next.', /next|upcoming|look ahead|coming/],
  ['p_deliverables', 'Deliverables Status', 'Each deliverable with due date and status.', /deliverable status|handover|handoff/],
  ['p_payments', 'Payment Milestones', 'Each milestone with amount, due date and status.', /payment status|invoice|milestone payment/],
  ['p_risks', 'Risks and Issues', 'Open risks and issues with probability and impact.', /issue|blocker/],
  ['p_actions', 'Decisions and Support Needed', 'What the audience needs to decide or unblock.', /decision|support|approval needed|ask/],
  ['approval', 'Approval', 'Names, roles and signatures.', /approval|sign.?off|authoriz/],
];
const LIB = Object.fromEntries(LIBRARY.map(([key, heading, about, re]) => [key, { key, heading, about, re }]));
const TYPE_HINTS = {
  charter: /charter|kick.?off|initiat|authoriz|launch|justif|approve the project/,
  pm_plan: /management plan|how the project will be managed|pmp|ways of working/,
  risk_plan: /risk/,
  comms_plan: /communicat|stakeholder engagement|meeting cadence/,
  governance: /governance|steering|decision right|escalat|oversight/,
  quality_plan: /quality|acceptance|testing|assurance/,
  progress_weekly: /week|status|progress|update|report|sprint|highlights/,
  progress_biweekly: /bi.?weekly|fortnight|two weeks|every 2 weeks|2 weeks/,
};
const AUDIENCES = [
  ['exec', /exec|sponsor|board|ceo|cto|cfo|steering|director|leadership|senior|minister|management|committee/],
  ['tech', /technical|engineer|developer|delivery|team|architect|analyst|qa|test/],
  ['client', /client|customer|vendor|partner|external|supplier|government|authority/],
];
const entry = (key) => ({ heading: LIB[key].heading, key, guidance: LIB[key].about });
// Rule based suggestion: the closest standard template, then sections from that template plus the ones the brief and the audience call for.
function suggestPlan({ name = '', audience = '', description = '' }) {
  const nm = String(name).toLowerCase(), ds = String(description).toLowerCase(), au = String(audience).toLowerCase();
  const score = (re) => (re.test(nm) ? 2 : 0) + (re.test(ds) ? 1 : 0);
  let best = null, top = 0;
  for (const id of Object.keys(TYPE_HINTS)) { const s = score(TYPE_HINTS[id]); if (s > top) { top = s; best = id; } }
  if (best === 'progress_weekly' && /bi.?weekly|fortnight|two weeks|2 weeks/.test(`${nm} ${ds}`)) best = 'progress_biweekly';
  const base = best || 'charter';
  const list = DEFAULTS[base].sections.filter(([, k]) => G[k]).map(([h, k]) => (LIB[k] ? { ...entry(k), heading: h } : { heading: h, key: k, guidance: '' }));
  const have = new Set(list.map((s) => s.key));
  const extras = [];
  const text = `${nm} ${ds}`;
  const at = (s) => { const i = list.findIndex((x) => x.key === 'approval'); if (i >= 0) list.splice(i, 0, s); else list.push(s); have.add(s.key); extras.push(s.heading); };
  for (const [key] of LIBRARY) if (!have.has(key) && key !== 'approval' && G[key] && LIB[key].re.test(text)) at(entry(key));
  const aud = (AUDIENCES.find(([, re]) => re.test(au)) || [null])[0];
  if (aud === 'exec' && !have.has('p_summary')) { list.unshift(entry('p_summary')); have.add('p_summary'); extras.push(LIB.p_summary.heading); }
  if (aud === 'tech') for (const k of ['requirements', 'timeline']) if (!have.has(k) && G[k]) at(entry(k));
  if (aud === 'client' && !have.has('deliverables') && G.deliverables) at(entry('deliverables'));
  return { base_type: base, base_title: DEFAULTS[base].title, matched: top > 0, audience_note: aud, extras, sections: list.slice(0, 20), engine: 'rules' };
}

function replaceVars(text, c) {
  const p = c.project, m = c.metrics;
  const map = {
    'project.name': p.name, 'project.client': p.client || '', 'project.value': money(p.value, p.currency), 'project.currency': p.currency,
    'project.start_date': p.start_date || '', 'project.end_date': p.end_date || '', 'project.code': p.code || '', date: c.today,
    'period.start': c.period.start, 'period.end': c.period.end, 'pm.name': c.user?.name || '',
    'progress.actual': `${m.actualPct}%`, 'progress.planned': m.plannedPct != null ? `${m.plannedPct}%` : 'n/a', 'progress.spi': m.spi != null ? String(m.spi) : 'n/a',
  };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (k in map ? map[k] : `{{${k}}}`));
}

async function aiDraft(c, docTitle, heading, facts, guidance, brief) {
  if (!AI.hasKey()) return null;
  const excerpts = c.docs.filter((d) => ['proposal', 'contract', 'po'].includes(d.kind)).map((d) => `[${d.filename}]\n${d.text.slice(0, 6000)}`).join('\n\n').slice(0, 18000);
  try {
    const out = await AI.claude(
      `You write sections of professional project management documents in US English. Use only the supplied facts and document excerpts. Do not invent figures, dates or names. Write concise, specific, plain prose. Use markdown tables or bullets where they help. Do not use dashes as punctuation and do not use semicolons. Output only the section body, no heading.`,
      `Document: ${docTitle}\n${brief ? `Brief from the project manager:\n${brief}\n` : ''}Section: ${heading}\n${guidance ?`Template guidance for this section:\n${guidance}\n` : ''}\nFacts already compiled for this section:\n${facts || '(none)'}\n\nProject: ${c.project.name} for ${c.project.client || 'client'}. Dates ${c.project.start_date || 'TBC'} to ${c.project.end_date || 'TBC'}. Value ${money(c.project.value, c.project.currency)}.\n\nSource document excerpts:\n${excerpts}`,
      1800
    );
    return out && out.trim() ? out.trim() : null;
  } catch (e) {
    console.error('AI draft failed:', e.message);
    return null;
  }
}

// A custom document passes its own sections (and a title and a brief). Sections with no data behind them are written from the brief when the AI is on.
async function generate({ type, templateBody, templateName, ctx, useAI = true, sections: given, title: customTitle, brief }) {
  const def = DEFAULTS[type];
  if (!def) throw new Error('Unknown document type');
  const sections = [];
  const custom = Array.isArray(given) && given.length > 0;
  const fallback = (s) => (custom ? `${s.guidance ? `_${s.guidance}_\n\n` : ''}_To be completed by the project manager._` : s.guidance || '_To be completed by the project manager._');
  if (custom) {
    for (const s of given) sections.push({ heading: s.heading, key: s.key && G[s.key] ? s.key : null, guidance: s.guidance || '' });
  } else if (templateBody) {
    const parsed = parseTemplate(templateBody);
    if (!parsed.length) throw new Error('The custom template has no headings. Use "# Heading" lines or Heading 1 styles to mark sections.');
    for (const s of parsed) {
      // A section marked as fixed keeps the text the project manager wrote. The others are refreshed from project data.
      const fixed = /^<!--\s*fixed\s*-->/i.test(s.body);
      const body = fixed ? s.body.replace(/^<!--\s*fixed\s*-->\s*/i, '') : s.body;
      sections.push({ heading: s.heading, key: fixed ? null : matchGenerator(s.heading, type), guidance: replaceVars(body, ctx) });
    }
  } else {
    for (const [h, k] of def.sections) sections.push({ heading: h, key: k, guidance: '' });
  }
  const results = new Array(sections.length);
  let idx = 0;
  const worker = async () => {
    while (idx < sections.length) {
      const i = idx++;
      const s = sections[i];
      let facts = s.key && G[s.key] ? G[s.key](ctx) : '';
      let body = facts;
      if (useAI && AI.hasKey()) {
        const drafted = await aiDraft(ctx, customTitle || def.title, s.heading, facts, s.guidance, brief);
        if (drafted) body = drafted;
        else if (!facts) body = fallback(s);
      } else if (!facts) body = fallback(s);
      if (!body) body = fallback(s);
      results[i] = `# ${s.heading}\n\n${replaceVars(body, ctx)}`;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const title = customTitle || `${def.title}`;
  return { title, markdown: results.join('\n\n'), template: templateName || 'System default', engine: useAI && AI.hasKey() ? 'claude' : 'rules', defaultPeriod: def.period || null };
}

// ---------- DOCX ----------
const NAVY = '1F3A5F';

function inlineRuns(text, base = {}) {
  const runs = [];
  // Underscore emphasis only counts at word boundaries so file names like Plan_v2_final.docx stay intact.
  const parts = String(text).split(/(\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|(?<!\w)_[^_]+_(?!\w))/g).filter((s) => s !== '');
  for (const p of parts) {
    if (/^\*\*[^*]+\*\*$/.test(p)) runs.push(new TextRun({ ...base, text: p.slice(2, -2), bold: true }));
    else if (/^__[^_]+__$/.test(p)) runs.push(new TextRun({ ...base, text: p.slice(2, -2), bold: true }));
    else if (/^_[^_]+_$/.test(p)) runs.push(new TextRun({ ...base, text: p.slice(1, -1), italics: true }));
    else runs.push(new TextRun({ ...base, text: p }));
  }
  return runs.length ? runs : [new TextRun({ ...base, text: '' })];
}

function mdToBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let firstH1 = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    let m;
    if ((m = l.match(/^#\s+(.*)$/))) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: m[1], bold: true, color: NAVY, size: 32, font: 'Calibri' })], spacing: { after: 200 } }));
      firstH1 = false;
    } else if ((m = l.match(/^##\s+(.*)$/))) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: m[1], bold: true, color: NAVY, size: 26, font: 'Calibri' })], spacing: { before: 200, after: 120 } }));
    } else if ((m = l.match(/^###\s+(.*)$/))) {
      blocks.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: m[1], bold: true, size: 22, font: 'Calibri' })], spacing: { before: 160, after: 80 } }));
    } else if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      const cells = rows.map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const body = cells.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      if (body.length) blocks.push(buildTable(body));
      blocks.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    } else if ((m = l.match(/^\s*[-*]\s+(.*)$/))) {
      blocks.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(m[1], { size: 22, font: 'Calibri' }), spacing: { after: 60 } }));
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) {
      blocks.push(new Paragraph({ numbering: undefined, children: inlineRuns(l.trim(), { size: 22, font: 'Calibri' }), spacing: { after: 60 }, indent: { left: 360 } }));
    } else {
      blocks.push(new Paragraph({ children: inlineRuns(l.trim(), { size: 22, font: 'Calibri' }), spacing: { after: 120 } }));
    }
  }
  return blocks;
}

function buildTable(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFC8D6' };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: cols }, (_, ci) => new TableCell({
        borders,
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' } : (ri % 2 === 0 ? { type: ShadingType.CLEAR, fill: 'F3F6FA', color: 'auto' } : undefined),
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: inlineRuns(r[ci] || '', { size: 20, font: 'Calibri', color: ri === 0 ? 'FFFFFF' : undefined, bold: ri === 0 ? true : undefined }) })],
      })),
    })),
  });
}

async function toDocx({ title, markdown, project, user, today, logoPath }) {
  const cover = [];
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      const ext = path.extname(logoPath).toLowerCase().replace('.', '');
      const type = ext === 'jpg' ? 'jpg' : ext;
      if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(type)) {
        cover.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new ImageRun({ type: type === 'jpeg' ? 'jpg' : type, data: fs.readFileSync(logoPath), transformation: { width: 140, height: 60 } })], spacing: { after: 600 } }));
      }
    } catch { /* logo is optional */ }
  }
  cover.push(new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: title, bold: true, size: 56, color: NAVY, font: 'Calibri' })] }));
  cover.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: project.name, size: 36, font: 'Calibri' })] }));
  if (project.client) cover.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `Prepared for ${project.client}`, size: 26, color: '555555', font: 'Calibri' })] }));
  cover.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `Date: ${today}`, size: 24, color: '555555', font: 'Calibri' })] }));
  if (user?.name) cover.push(new Paragraph({ children: [new TextRun({ text: `Prepared by ${user.name}`, size: 24, color: '555555', font: 'Calibri' })] }));

  const doc = new Document({
    creator: user?.name || 'Project Manager',
    title: `${title} ${project.name}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${project.name}  |  ${title}`, size: 18, color: '777777' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 18, color: '777777' }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '777777' })] })] }) },
      children: [...cover, ...mdToBlocks(markdown)],
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { DEFAULTS, DOC_TYPES, LIBRARY, GENERATOR_KEYS: Object.keys(G), activityLines, nextRows, decisionLines, buildContext, generate, suggestPlan, toDocx, parseTemplate, replaceVars, matchGenerator };
;return module.exports})();
