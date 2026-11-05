// Daily snapshots of each project's key figures. The dashboards are computed live from the current state of a
// project, so history only exists because one row per project per day is kept here. Past days are never
// rebuilt or estimated: a day with no row is a day nothing was recorded.
//
// This file holds the storage and the roll up rules. The figures themselves are produced by snapshotFigures()
// in api.js, which reuses the same scheduling, radar and analytics code the live dashboards use, so a trend point
// and the dashboard tile of the same day always agree.
'use strict';

const DAY = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY;
const dstr = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const PERIODS = [7, 14, 30, 90, 180, 365];
const sum = (list, k) => list.reduce((a, f) => a + (Number.isFinite(f[k]) ? f[k] : 0), 0);

// Only the periods the screen offers are accepted, anything else falls back to 30 days.
function periodOf(v) {
  const n = Number(v);
  return PERIODS.includes(n) ? n : 30;
}

class Snapshots {
  constructor(db) { this.db = db; }

  // One row per project per day. Saving again on the same day replaces that day's row, so the last capture of the
  // day is the one that stays, and running a capture twice never creates a second row.
  async save(projectId, date, figures) {
    if (!DATE.test(date)) throw new Error('Invalid snapshot date');
    await this.db.query(
      'INSERT INTO project_snapshots(project_id, snap_date, figures) VALUES ($1, $2::date, $3::jsonb) ON CONFLICT (project_id, snap_date) DO UPDATE SET figures = EXCLUDED.figures, taken_at = now()',
      [projectId, date, JSON.stringify(figures)],
    );
  }

  async range(projectIds, from, to) {
    if (!projectIds.length) return [];
    const r = await this.db.query(
      "SELECT project_id, to_char(snap_date, 'YYYY-MM-DD') AS date, figures FROM project_snapshots WHERE project_id = ANY($1::bigint[]) AND snap_date >= $2::date AND snap_date <= $3::date ORDER BY snap_date, project_id",
      [projectIds, from, to],
    );
    return r.rows.map((x) => ({ project_id: Number(x.project_id), date: x.date, figures: typeof x.figures === 'string' ? JSON.parse(x.figures) : x.figures }));
  }

  async count(projectId) {
    return Number((await this.db.query('SELECT count(*) AS c FROM project_snapshots WHERE project_id = $1', [projectId])).rows[0].c);
  }

  // The whole history of one project, for a backup.
  async all(projectId) {
    const r = await this.db.query("SELECT to_char(snap_date, 'YYYY-MM-DD') AS date, figures FROM project_snapshots WHERE project_id = $1 ORDER BY snap_date", [projectId]);
    return r.rows.map((x) => ({ date: x.date, figures: typeof x.figures === 'string' ? JSON.parse(x.figures) : x.figures }));
  }

  // Puts imported history under a new project id. A day that already has a row is left alone.
  async restore(projectId, list) {
    if (!list.length) return 0;
    await this.db.tx(async (t) => {
      for (const s of list) await t.query('INSERT INTO project_snapshots(project_id, snap_date, figures) VALUES ($1, $2::date, $3::jsonb) ON CONFLICT (project_id, snap_date) DO NOTHING', [projectId, s.date, JSON.stringify(s.figures)]);
    });
    return list.length;
  }
}

// A backup file is untrusted, so only known fields of the right type are kept.
const NUM_KEYS = ['progress', 'planned', 'spi', 'tasks', 'overdue', 'high_risks', 'pending_review', 'deliv_open', 'deliv_closed', 'slip_days', 'value'];
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function cleanFigures(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const out = { v: 1, health: ['green', 'amber', 'red'].includes(f.health) ? f.health : 'green' };
  for (const k of NUM_KEYS) out[k] = num(f[k]);
  for (const k of ['tasks', 'overdue', 'high_risks', 'pending_review', 'deliv_open', 'deliv_closed', 'value']) if (out[k] == null) out[k] = 0;
  for (const k of ['forecast_end', 'contract_end']) out[k] = typeof f[k] === 'string' && DATE.test(f[k]) ? f[k] : null;
  out.currency = typeof f.currency === 'string' ? f.currency.slice(0, 8) : '';
  const p = f.pay && typeof f.pay === 'object' ? f.pay : {};
  out.pay = {};
  for (const k of ['paid', 'invoiced', 'pending', 'late', 'total']) out.pay[k] = num(p[k]) || 0;
  return out;
}
const MAX_KEPT = 800;
function cleanList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const s of raw.slice(0, MAX_KEPT)) {
    if (!s || typeof s.date !== 'string' || !DATE.test(s.date) || seen.has(s.date)) continue;
    const figures = cleanFigures(s.figures);
    if (!figures) continue;
    seen.add(s.date); out.push({ date: s.date, figures });
  }
  return out;
}

// One day of the portfolio, from the figures of every project that has a snapshot that day.
// Counts and money are sums. Progress, planned and SPI are the plain average of the projects, the same
// definition the overview dashboard tiles use, so the two can be compared. n says how many projects are inside.
function aggregate(date, list) {
  const n = list.length;
  const avg = (k) => {
    const v = list.map((f) => f[k]).filter((x) => x != null && Number.isFinite(x));
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
  };
  const money = {};
  for (const f of list) {
    const cur = f.currency || '';
    const p = f.pay || {};
    if (!cur && !['paid', 'invoiced', 'pending', 'late', 'total'].some((k) => Number(p[k]))) continue; // no currency and no money, nothing to show
    const m = money[cur] || (money[cur] = { paid: 0, invoiced: 0, pending: 0, late: 0, total: 0 });
    for (const k of ['paid', 'invoiced', 'pending', 'late', 'total']) m[k] += Number(p[k]) || 0;
  }
  const slips = list.map((f) => f.slip_days).filter((x) => x != null && Number.isFinite(x));
  return {
    date, n,
    progress: avg('progress'), planned: avg('planned'), spi: avg('spi'),
    tasks: sum(list, 'tasks'), overdue: sum(list, 'overdue'), high_risks: sum(list, 'high_risks'), pending_review: sum(list, 'pending_review'),
    deliv_open: sum(list, 'deliv_open'), deliv_closed: sum(list, 'deliv_closed'),
    green: list.filter((f) => f.health === 'green').length, amber: list.filter((f) => f.health === 'amber').length, red: list.filter((f) => f.health === 'red').length,
    behind: slips.filter((x) => x > 0).length, slip_total: slips.reduce((a, x) => a + (x > 0 ? x : 0), 0), slip_n: slips.length,
    slip_days: n === 1 && list[0].slip_days != null ? list[0].slip_days : null,
    forecast_end: n === 1 ? list[0].forecast_end || null : null,
    money,
  };
}

// Turns stored rows into what the trends screens draw: one aggregated row per day that has data, the latest day,
// the day before it, the latest day at least a week before today, and for every project its latest figures next
// to its figures a week ago. A comparison that has no earlier snapshot is null, never zero.
function build(rows, { today, days, projects }) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r.figures);
  }
  const series = [...byDate.keys()].sort().map((d) => aggregate(d, byDate.get(d)));
  const latest = series.length ? series[series.length - 1] : null;
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const weekDate = dstr(dnum(today) - 7);
  let week = null;
  for (const s of series) if (s.date <= weekDate && latest && s.date < latest.date) week = s;

  const changes = [];
  const mine = new Map();
  for (const r of rows) {
    if (!mine.has(r.project_id)) mine.set(r.project_id, []);
    mine.get(r.project_id).push(r);
  }
  for (const p of projects) {
    const list = (mine.get(p.id) || []).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) { changes.push({ id: p.id, name: p.name, currency: p.currency || '', now: null, then: null }); continue; }
    const now = list[list.length - 1];
    let then = null;
    for (const r of list) if (r.date <= weekDate && r.date < now.date) then = r;
    changes.push({ id: p.id, name: p.name, currency: p.currency || '', now: { date: now.date, ...now.figures }, then: then ? { date: then.date, ...then.figures } : null });
  }
  return { today, days, from: dstr(dnum(today) - days), projects: projects.map((p) => ({ id: p.id, name: p.name, currency: p.currency || '' })), series, latest, prev, week, changes };
}

module.exports = { Snapshots, aggregate, build, periodOf, cleanList, PERIODS, dnum, dstr };
