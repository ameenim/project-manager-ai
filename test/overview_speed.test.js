'use strict';
// Overview actions on a large project: the schedule engine stays exact and fast, the overview actions get a slim answer,
// and opening a dashboard does not recompute figures that have not changed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { start } = require('./helpers');
let s; before(async () => { s = await start({ snapshotJob: false }); }); after(() => s.close());

const win = {}; vm.createContext(win); win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/engine.js'), 'utf8'), win);
const S = win.__Sched;

// the plain way, one Date and one text conversion per calendar day: what the fast path must always agree with
const DAY = 86400000;
const par = (x) => { const [y, m, d] = x.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fm = (d) => d.toISOString().slice(0, 10);
const okDay = (d, c) => c.days.has(d.getUTCDay()) && !c.holidays.has(fm(d));
const refNext = (x, c) => { let d = par(x); for (let g = 0; g < 800 && !okDay(d, c); g++) d = new Date(d.getTime() + DAY); return fm(d); };
const refAdd = (x, n, c) => { let d = par(refNext(x, c)); while (n > 0) { d = new Date(d.getTime() + DAY); if (okDay(d, c)) n--; } return fm(d); };
const refShift = (x, n, c) => { if (n >= 0) return refAdd(x, n, c); let d = par(refNext(x, c)); while (n < 0) { d = new Date(d.getTime() - DAY); if (okDay(d, c)) n++; } return fm(d); };
const refCount = (a, b, c) => { let d = par(a), n = 0; const e = par(b); while (d <= e) { if (okDay(d, c)) n++; d = new Date(d.getTime() + DAY); } return n; };

test('working day helpers give the same dates as counting day by day', () => {
  const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * DAY).toISOString().slice(0, 10);
  for (const work of [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]]) {
    const c = S.calendar({ work_days: JSON.stringify(work), holidays: JSON.stringify([day(3), day(10), day(11), day(40), '2026-1-9', 'bad']) });
    for (let n = -20; n < 420; n += 7) for (const k of [0, 1, 4, 9, 33]) {
      const a = day(n + 30), b = day(n + 30 + k * 3);
      assert.equal(S.nextWork(a, c), refNext(a, c));
      assert.equal(S.addWork(a, k, c), refAdd(a, k, c));
      assert.equal(S.shiftWork(a, k, c), refShift(a, k, c));
      assert.equal(S.shiftWork(a, -k, c), refShift(a, -k, c));
      assert.equal(S.countWork(a, b, c), refCount(a, b, c));
      assert.equal(S.addDays(a, k - 5), fm(new Date(par(a).getTime() + (k - 5) * DAY)));
    }
  }
  assert.throws(() => S.nextWork('', S.calendar({})), (e) => e.name === 'RangeError', 'an empty date still fails the way it always did');
});

test('a thousand task schedule is exact on a fresh run and on a repeat, and fast', () => {
  const tasks = [];
  for (let i = 1; i <= 1000; i++) tasks.push({ id: i, parent_id: i % 50 === 1 || i === 1 ? null : i - (i % 50 || 50) + 1 > 0 ? Math.floor((i - 1) / 50) * 50 + 1 : null, position: i, name: 'T' + i, start: '2026-02-01', duration: 1 + (i % 9), progress: i % 4 ? 0 : 50, deps: i % 50 > 2 ? [{ id: i - 1, lag: 0, type: 'FS' }] : [], is_milestone: 0 });
  const project = { work_days: '[0,1,2,3,4]', holidays: '["2026-03-05","2026-03-06"]' };
  const t0 = Date.now();
  const first = JSON.stringify(S.schedule(tasks, project));
  const again = JSON.stringify(S.schedule(tasks, project));
  const ms = Date.now() - t0;
  assert.equal(first, again);
  assert.ok(ms < 2000, `two runs of 1000 tasks took ${ms} ms`);
  const rows = S.schedule(tasks, project);
  const leaf = rows.find((t) => !t.summary && t.id % 50 === 10);
  assert.equal(leaf.finish, refAdd(leaf.start, leaf.duration - 1, S.calendar(project)), 'a finish date is the start plus its working days');
});

test('the overview actions get a slim answer and the schedule editor still gets the full one', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Slim');
  const a = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'One', duration: 4, start: '2020-01-06' }, u.token);
  const id = a.data.created;
  const slim = await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [id]: { progress: 100 } }, slim: true }, u.token);
  assert.equal(slim.status, 200);
  assert.equal(slim.data.ok, true);
  assert.equal(slim.data.tasks, undefined, 'no task list in the slim answer');
  const full = await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [id]: { progress: 40 } } }, u.token);
  assert.equal(full.status, 200);
  assert.equal(full.data.tasks.find((x) => x.id === id).progress, 40);
  const sched = (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data;
  assert.equal(sched.tasks.find((x) => x.id === id).progress, 40, 'the change was saved');
});

test('a dashboard does not rewrite figures that did not change, and always leaves today with a row', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Skip');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'One', duration: 4, start: '2020-01-06' }, u.token);
  const q = () => s.app.db.query("SELECT taken_at, figures FROM project_snapshots WHERE project_id = $1", [p.id]).then((r) => r.rows);
  await s.call('GET', `/api/projects/${p.id}/dashboard`, null, u.token);
  const first = await q();
  assert.equal(first.length, 1);
  await s.call('GET', `/api/projects/${p.id}/dashboard`, null, u.token);
  await s.call('GET', '/api/dashboard', null, u.token);
  const second = await q();
  assert.equal(String(second[0].taken_at), String(first[0].taken_at), 'an unchanged project is not recorded again');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Two', duration: 2, start: '2020-02-03' }, u.token);
  const tr = (await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token)).data;
  assert.equal(tr.latest.tasks, 2, 'a change is recorded the next time a screen opens');
  await s.app.db.query('DELETE FROM project_snapshots WHERE project_id = $1', [p.id]);
  const tr2 = (await s.call('GET', `/api/projects/${p.id}/trends`, null, u.token)).data;
  assert.equal(tr2.series.length, 1, 'a removed row for today is recorded again');
});
