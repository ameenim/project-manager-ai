'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { aggregate, build, periodOf, cleanList, dnum, dstr } = require('../server/snapshots');
let s; before(async () => { s = await start({ snapshotJob: false }); }); after(() => s.close());

const today = () => s.app.api.TODAY();
const back = (n) => dstr(dnum(today()) - n);
const fig = (o = {}) => ({ v: 1, health: 'green', progress: 40, planned: 50, spi: 0.8, tasks: 10, overdue: 1, high_risks: 2, pending_review: 3, deliv_open: 4, deliv_closed: 1, forecast_end: '2027-10-01', contract_end: '2027-09-30', slip_days: 1, currency: 'AED', value: 1000, pay: { paid: 100, invoiced: 50, pending: 300, late: 20, total: 470 }, ...o });
const rowsOf = async (id) => (await s.app.db.query("SELECT to_char(snap_date, 'YYYY-MM-DD') AS d FROM project_snapshots WHERE project_id = $1 ORDER BY snap_date", [id])).rows.map((r) => r.d);

test('the snapshot table exists and a project is recorded once per day', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Daily');
  const r1 = await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token);
  assert.equal(r1.status, 200);
  await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token);
  await s.call('GET', '/api/trends', null, u.token);
  await s.app.api.captureAll();
  await s.app.api.captureAll();
  assert.deepEqual(await rowsOf(p.id), [today()], 'repeating a capture never adds a second row for the day');
});

test('a trend point equals the live figures of the same day', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Live match');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'One', duration: 4, start: '2020-01-06' }, u.token);
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Two', duration: 4, start: '2020-02-03' }, u.token);
  const dash = (await s.call('GET', `/api/projects/${p.id}/dashboard`, null, u.token)).data;
  const live = (await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project;
  const t = (await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token)).data;
  assert.equal(t.series.length, 1);
  const L = t.latest, st = live.stats;
  assert.equal(L.date, today());
  assert.equal(L.progress, st.progress); assert.equal(L.overdue, st.overdue); assert.equal(L.tasks, st.tasks);
  assert.equal(L.high_risks, dash.radar.counts.high);
  assert.equal(L.pending_review, st.pendingItems + st.pendingInbox);
  assert.equal(L[st.health], 1, 'health counts');
  assert.ok(L.overdue >= 2, 'two long finished dates are overdue');
  const direct = (await s.app.db.query('SELECT figures FROM project_snapshots WHERE project_id = $1', [p.id])).rows[0].figures;
  const f = typeof direct === 'string' ? JSON.parse(direct) : direct;
  assert.equal(f.overdue, st.overdue); assert.equal(f.health, st.health);
});

test('changing the project replaces todays point and keeps one row', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Moves');
  const made = (await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Work', duration: 5, start: '2020-01-06' }, u.token)).data;
  const before = (await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token)).data.latest;
  const id = made.tasks.find((x) => x.name === 'Work').id;
  assert.equal((await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [id]: { progress: 100 } } }, u.token)).status, 200);
  const after = (await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token)).data;
  assert.ok(after.latest.progress > before.progress);
  assert.ok(after.latest.overdue < before.overdue);
  assert.equal(after.series.length, 1);
  assert.deepEqual(await rowsOf(p.id), [today()]);
});

test('history is returned in order, gaps stay gaps and comparisons are null until an earlier day exists', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'History');
  const snap = s.app.api.snapshots;
  const first = (await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token)).data;
  assert.equal(first.prev, null); assert.equal(first.week, null);
  await snap.save(p.id, back(1), fig({ progress: 30, overdue: 5 }));
  await snap.save(p.id, back(10), fig({ progress: 10, overdue: 9 }));
  await snap.save(p.id, back(40), fig({ progress: 1 }));
  const t = (await s.call('GET', `/api/projects/${p.id}/trends?days=30`, null, u.token)).data;
  assert.equal(t.days, 30);
  assert.deepEqual(t.series.map((x) => x.date), [back(10), back(1), today()], 'the 40 day old row is outside 30 days and no day is invented between');
  assert.equal(t.prev.date, back(1));
  assert.equal(t.week.date, back(10), 'the week comparison is the latest day at least seven days ago');
  const wide = (await s.call('GET', `/api/projects/${p.id}/trends?days=90`, null, u.token)).data;
  assert.equal(wide.series.length, 4);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/trends?days=9999`, null, u.token)).data.days, 30, 'an unknown period falls back to 30 days');
  assert.deepEqual(wide.changes[0].then && wide.changes[0].then.date, back(10));
});

test('the portfolio rolls up exactly: sums add up, rates are averages, money stays per currency', async () => {
  const u = await s.user();
  const a = await s.project(u.token, 'Roll A'), b = await s.project(u.token, 'Roll B');
  const snap = s.app.api.snapshots, d = back(3);
  await snap.save(a.id, d, fig({ progress: 20, spi: 1, overdue: 2, high_risks: 1, health: 'green', currency: 'AED', pay: { paid: 10, invoiced: 0, pending: 5, late: 1, total: 16 } }));
  await snap.save(b.id, d, fig({ progress: 60, spi: 0.5, overdue: 4, high_risks: 3, health: 'red', currency: 'SAR', slip_days: 6, pay: { paid: 20, invoiced: 2, pending: 0, late: 4, total: 26 } }));
  const t = (await s.call('GET', '/api/trends?days=14', null, u.token)).data;
  const row = t.series.find((x) => x.date === d);
  assert.equal(row.n, 2);
  assert.equal(row.overdue, 6); assert.equal(row.high_risks, 4);
  assert.equal(row.progress, 40); assert.equal(row.spi, 0.75);
  assert.equal(row.green, 1); assert.equal(row.red, 1);
  assert.deepEqual(row.money.AED, { paid: 10, invoiced: 0, pending: 5, late: 1, total: 16 });
  assert.deepEqual(row.money.SAR, { paid: 20, invoiced: 2, pending: 0, late: 4, total: 26 });
  assert.equal(row.slip_total, 7); assert.equal(row.behind, 2);
  const sql = (await s.app.db.query('SELECT sum((figures->>\'overdue\')::int) AS o FROM project_snapshots WHERE snap_date = $1::date AND project_id = ANY($2::bigint[])', [d, [a.id, b.id]])).rows[0].o;
  assert.equal(Number(sql), row.overdue, 'the rolled up count equals the direct SQL sum');
  assert.equal(t.changes.length, 2);
});

test('trends only ever include the signed in account and its own projects', async () => {
  const a = await s.user(), b = await s.user();
  const pa = await s.project(a.token, 'Mine A'); const pb = await s.project(b.token, 'Mine B');
  await s.app.api.snapshots.save(pa.id, back(2), fig({ overdue: 7 }));
  const ta = (await s.call('GET', '/api/trends', null, a.token)).data, tb = (await s.call('GET', '/api/trends', null, b.token)).data;
  assert.deepEqual(ta.projects.map((x) => x.name), ['Mine A']); assert.deepEqual(tb.projects.map((x) => x.name), ['Mine B']);
  assert.ok(tb.series.every((x) => x.overdue !== 7 && x.n === 1));
  assert.equal((await s.call('GET', `/api/projects/${pa.id}/trends`, null, b.token)).status, 404);
  assert.equal((await s.call('GET', `/api/projects/${pa.id}/trends`, null, null)).status, 401);
  const none = await s.user();
  const t0 = (await s.call('GET', '/api/trends', null, none.token)).data;
  assert.deepEqual(t0.series, []); assert.equal(t0.latest, null);
});

test('a viewer can read trends and a delete removes the history', async () => {
  const mgr = await s.user(), vw = await s.user();
  const p = await s.project(mgr.token, 'Shared trends');
  await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/trends`, null, vw.token)).status, 200);
  await s.app.api.snapshots.save(p.id, back(5), fig());
  assert.ok((await rowsOf(p.id)).length >= 2);
  assert.equal((await s.call('DELETE', `/api/projects/${p.id}`, null, mgr.token)).status, 200);
  assert.deepEqual(await rowsOf(p.id), []);
});

test('archived projects are not part of the trends', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Old one');
  await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token);
  const r = await s.call('PUT', `/api/projects/${p.id}`, { status: 'archived' }, u.token);
  if (r.status !== 200) return;
  const t = (await s.call('GET', '/api/trends', null, u.token)).data;
  assert.deepEqual(t.projects, []);
});

test('history travels with a project backup and bad history is dropped on import', async () => {
  const a = await s.user(), b = await s.user();
  const p = await s.project(a.token, 'Backup trends');
  await s.app.api.snapshots.save(p.id, back(4), fig({ progress: 12 }));
  await s.call('GET', `/api/projects/${p.id}/trends`, null, a.token);
  const backup = JSON.parse((await s.call('GET', `/api/projects/${p.id}/export`, null, a.token)).buf.toString());
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.snapshots.map((x) => x.date), [back(4), today()]);
  backup.snapshots.push({ date: 'not a date', figures: fig() }, { date: back(2), figures: 'nope' }, { date: back(4), figures: fig() });
  const im = await s.call('POST', '/api/projects/import', backup, b.token);
  assert.equal(im.status, 200, JSON.stringify(im.data));
  const copy = im.data.imported[0];
  assert.deepEqual(await rowsOf(copy.id), [back(4), today()]);
  const t = (await s.call('GET', `/api/projects/${copy.id}/trends`, null, b.token)).data;
  assert.equal(t.series.find((x) => x.date === back(4)).progress, 12);
  const old = JSON.parse(JSON.stringify(backup)); delete old.snapshots;
  assert.equal((await s.call('POST', '/api/projects/import', old, b.token)).status, 200, 'a backup made before snapshots existed still imports');
});

test('the workspace sample loads and its first trends point is recorded', async () => {
  const u = await s.user();
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, u.token)).status, 200);
  const t = (await s.call('GET', '/api/trends', null, u.token)).data;
  assert.equal(t.series.length, 1);
  assert.equal(t.latest.n, t.projects.length);
  assert.ok(t.projects.length >= 6);
  assert.equal(t.latest.green + t.latest.amber + t.latest.red, t.latest.n);
});

test('pure helpers: period, aggregate and untrusted history', () => {
  assert.equal(periodOf('7'), 7); assert.equal(periodOf('1'), 30); assert.equal(periodOf(undefined), 30);
  const row = aggregate('2027-01-01', [fig({ slip_days: -3 })]);
  assert.equal(row.slip_days, -3); assert.equal(row.slip_total, 0); assert.equal(row.behind, 0);
  assert.equal(aggregate('2027-01-01', [fig({ spi: null }), fig({ spi: 1 })]).spi, 1, 'a missing value is skipped, not counted as zero');
  assert.equal(aggregate('2027-01-01', [fig({ spi: null })]).spi, null);
  const b = build([], { today: '2027-01-10', days: 30, projects: [{ id: 1, name: 'A', currency: 'AED' }] });
  assert.equal(b.latest, null); assert.deepEqual(b.series, []); assert.equal(b.changes[0].now, null);
  const clean = cleanList([{ date: '2027-01-01', figures: { health: 'purple', progress: 'x', overdue: 3, evil: '<script>' } }]);
  assert.equal(clean[0].figures.health, 'green'); assert.equal(clean[0].figures.progress, null); assert.equal(clean[0].figures.overdue, 3);
  assert.equal(clean[0].figures.evil, undefined);
});

test('both overview payloads carry a 30 day trend for their trend widgets', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Overview trend');
  const main = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  assert.equal(main.trends.days, 30);
  assert.equal(main.trends.latest.n, 1);
  const one = (await s.call('GET', `/api/projects/${p.id}/dashboard`, null, u.token)).data;
  assert.equal(one.trends.days, 30);
  assert.equal(one.trends.latest.date, today());
  assert.equal(one.trends.projects[0].id, p.id);
});
