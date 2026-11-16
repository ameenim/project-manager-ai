'use strict';
// Filters for the portfolio overview and the project overview: year, quarter, month, status, health, currency, project and client.
// One place decides what a filter means, so the screens, the exported report and the Excel detail sheets always agree.
//
// What each filter reads:
//   period (y, q, m)  tasks by their dates (a task counts when it overlaps the period), payments and deliverables by due date,
//                     activity by time. Risks have no date, so a period never hides a risk.
//   status (s)        one of done, active, todo, late. A task is done at 100 percent, late when its finish date has passed,
//                     active when started, otherwise todo. A payment is done when paid, active when invoiced, todo while pending,
//                     late when pending past its due date. A deliverable is done when closed, late when open past its due date,
//                     otherwise active. A risk is done when mitigated or closed, otherwise active.
//   health (h)        the project health: green, amber or red.
//   currency (cur)    the contract currency of the project.
//   project (p)       a list of project ids.   client (c)  the client name.
const STATUSES = ['done', 'active', 'todo', 'late'];
const HEALTH = ['green', 'amber', 'red'];
const PERIOD_KEYS = ['y', 'q', 'm'];
const pad = (n) => String(n).padStart(2, '0');
const day = (v) => (v ? String(v).slice(0, 10) : '');
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

module.exports = function createOverviewFilter({ err, TODAY }) {
  // ---------- reading the query ----------
  // Anything that is not a valid value is a plain 400 sentence, so a bad link never silently shows other numbers.
  function parse(query) {
    const q = query || {}, f = {};
    const int = (v, lo, hi, what) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) throw err(400, `The ${what} filter is not valid`);
      return n;
    };
    const y = int(q.y, 2000, 2100, 'year'), qu = int(q.q, 1, 4, 'quarter'), m = int(q.m, 1, 12, 'month');
    if (y) f.y = y;
    // a quarter or a month on its own means that period in the current year
    if (m) f.m = m; else if (qu) f.q = qu;
    if ((f.m || f.q) && !f.y) f.y = Number(TODAY().slice(0, 4));
    if (q.s != null && q.s !== '') { if (!STATUSES.includes(String(q.s))) throw err(400, 'The status filter is not valid'); f.s = String(q.s); }
    if (q.h != null && q.h !== '') { if (!HEALTH.includes(String(q.h))) throw err(400, 'The health filter is not valid'); f.h = String(q.h); }
    if (q.cur != null && q.cur !== '') { const c = String(q.cur).trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) throw err(400, 'The currency filter is not valid'); f.cur = c; }
    if (q.p != null && q.p !== '') {
      const ids = String(q.p).split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
      if (!ids.length || ids.length > 200) throw err(400, 'The project filter is not valid');
      f.p = [...new Set(ids)];
    }
    if (q.c != null && String(q.c).trim()) f.c = String(q.c).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
    return f;
  }
  const hasPeriod = (f) => !!(f && f.y);
  const hasProject = (f) => !!(f && (f.p || f.c || f.cur || f.h));
  const active = (f) => !!(f && (f.y || f.s || f.p || f.c || f.cur || f.h));
  const range = (f) => {
    if (!f || !f.y) return null;
    let a = 1, b = 12;
    if (f.m) a = b = f.m; else if (f.q) { a = (f.q - 1) * 3 + 1; b = a + 2; }
    return { lo: `${f.y}-${pad(a)}-01`, hi: `${f.y}-${pad(b)}-${pad(new Date(Date.UTC(f.y, b, 0)).getUTCDate())}` };
  };
  // the same selection as a short sentence for the cover of a report
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STATUS_LABEL = { done: 'Done', active: 'In progress', todo: 'Not started', late: 'Late' };
  const HEALTH_LABEL = { green: 'On track', amber: 'Needs attention', red: 'At risk' };
  function describe(f, names) {
    const out = [];
    if (f.y) out.push(f.m ? `${MONTHS[f.m - 1]} ${f.y}` : f.q ? `Q${f.q} ${f.y}` : String(f.y));
    if (f.s) out.push(`Status: ${STATUS_LABEL[f.s]}`);
    if (f.h) out.push(`Health: ${HEALTH_LABEL[f.h]}`);
    if (f.cur) out.push(`Currency: ${f.cur}`);
    if (f.c) out.push(`Client: ${f.c}`);
    if (f.p) out.push(`Project: ${f.p.map((id) => (names && names.get(id)) || `#${id}`).join(', ')}`);
    return out;
  }

  // ---------- predicates ----------
  const inRange = (date, r) => !r || (!!date && day(date) >= r.lo && day(date) <= r.hi);
  const overlaps = (a, b, r) => !r || (!!(a || b) && day(a || b) <= r.hi && day(b || a) >= r.lo);
  const taskStatus = (r) => ((r.progress || 0) >= 100 ? 'done' : r.overdue ? 'late' : (r.progress || 0) > 0 ? 'active' : 'todo');
  const payStatus = (state, late) => (state === 'paid' ? 'done' : late ? 'late' : state === 'invoiced' ? 'active' : 'todo');
  const delStatus = (state, late) => (state === 'closed' ? 'done' : late ? 'late' : 'active');
  const riskStatus = (state) => (['mitigated', 'closed', 'resolved', 'done'].includes(norm(state)) ? 'done' : 'active');

  // ---------- project level ----------
  // Does a project pass the filters that describe the project itself? st is its stats.
  function projectPasses(P, st, f) {
    if (!f) return true;
    if (f.p && !f.p.includes(Number(P.id))) return false;
    if (f.c && norm(P.p.client) !== norm(f.c)) return false;
    if (f.cur && String(P.p.currency || '').toUpperCase() !== f.cur) return false;
    if (f.h && st.health !== f.h) return false;
    return true;
  }

  // ---------- item level ----------
  // The rows of one project that fall inside the period and status. rows are the progress rows of the schedule.
  // hit says whether anything dated or statused matched, which decides whether the project belongs in the view.
  function scope(P, f, rows, today) {
    const r = range(f), s = f && f.s;
    const keepTask = (x) => (!r || overlaps(x.start, x.finish, r)) && (!s || taskStatus(x) === s);
    const taskRows = rows.filter(keepTask);
    const items = [];
    let hit = taskRows.length > 0;
    for (const i of P.items) {
      if (i.status === 'ignored') continue;
      const d = i.data || {};
      if (i.kind === 'milestone') {
        const late = !!d.due_date && d.due_date < today && (i.state || 'pending') === 'pending';
        if ((!r || inRange(d.due_date, r)) && (!s || payStatus(i.state || 'pending', late) === s)) { items.push(i); hit = true; }
      } else if (i.kind === 'deliverable') {
        const late = !!d.due_date && d.due_date < today && i.state !== 'closed';
        if ((!r || inRange(d.due_date, r)) && (!s || delStatus(i.state, late) === s)) { items.push(i); hit = true; }
      } else if (i.kind === 'risk') {
        if (!s || riskStatus(i.state) === s) items.push(i);
      }
    }
    return { rows: taskRows, items, hit };
  }
  // Does the project belong in the view, once its own rows are narrowed? With a status the project needs a matching row. With only a
  // period it also belongs when its contract dates or forecast overlap the period.
  function includeProject(P, st, f, sc) {
    const r = range(f);
    if (!r && !(f && f.s)) return true;
    if (f.s) return sc.hit;
    return sc.hit || overlaps(P.p.start_date, P.p.end_date || st.forecast_end, r);
  }

  // The figures of one project inside the period and status that are picked. Progress, plan, schedule index, late tasks and
  // the review count are recomputed from the rows that match, so a tile never shows the whole life of a project while a filter is on.
  // Health stays the project's own health, because that is what the health filter reads.
  function scopedStats(st, sc, f) {
    if (!f || !(f.y || f.s)) return st;
    let w = 0, a = 0, pl = 0, base = 0, late = 0;
    for (const r of sc.rows) {
      const dur = Math.max(r.duration || 1, 1);
      w += dur; a += dur * (r.progress || 0);
      if (r.plannedPct != null) { pl += dur * r.plannedPct; base++; }
      if (r.overdue) late++;
    }
    const progress = w ? Math.round(a / w) : 0, planned = base && w ? Math.round(pl / w) : null;
    const spi = planned ? Math.round((progress / planned) * 100) / 100 : null;
    return { ...st, progress, planned, spi, overdue: late, tasks: sc.rows.length, pendingItems: sc.items.filter((i) => i.status === 'proposed').length };
  }

  // The tasks of a computed schedule that stay in a project view: every summary row (they carry the phases) and the leaf rows that match.
  function scheduleFor(sched, rows) {
    const keep = new Set(rows.map((x) => x.id));
    return sched.filter((t) => t.summary || keep.has(t.id));
  }

  // ---------- choices for the filter bar ----------
  // Built from every live project, never from the filtered view, so a choice never disappears after it is picked.
  function options(entries) {
    const years = new Set([Number(TODAY().slice(0, 4))]), clients = new Set(), currencies = new Set(), projects = [];
    const addYear = (v) => { const y = Number(String(v || '').slice(0, 4)); if (y >= 2000 && y <= 2100) years.add(y); };
    for (const { P, st } of entries) {
      projects.push({ id: P.id, name: P.p.name, client: P.p.client || '', currency: P.p.currency || '' });
      if (P.p.client) clients.add(P.p.client);
      if (P.p.currency) currencies.add(String(P.p.currency).toUpperCase());
      addYear(P.p.start_date); addYear(P.p.end_date); addYear(st && st.forecast_end);
      for (const i of P.items) { const d = i.data || {}; if ((i.kind === 'milestone' || i.kind === 'deliverable') && d.due_date) addYear(d.due_date); }
    }
    const by = (a, b) => String(a).localeCompare(String(b));
    return { years: [...years].sort((a, b) => a - b), clients: [...clients].sort(by), currencies: [...currencies].sort(by), projects: projects.sort((a, b) => by(a.name, b.name)) };
  }

  return { parse, active, hasPeriod, hasProject, range, describe, inRange, overlaps, taskStatus, payStatus, delStatus, riskStatus, projectPasses, scope, scopedStats, includeProject, scheduleFor, options, STATUSES, HEALTH, STATUS_LABEL, HEALTH_LABEL };
};
