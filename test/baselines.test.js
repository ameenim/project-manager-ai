'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start({ noScheduler: true }); }); after(() => s.close());

test('every Set baseline keeps its own dates and the schedule lists them all', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Baselines');
  const url = (x) => `/api/projects/${p.id}/${x}`;
  let r = await s.call('POST', url('tasks'), { name: 'Build', start: '2027-03-01', duration: 5 }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.created;
  assert.deepEqual(r.data.baselines, [], 'no baseline before the first Set baseline');
  r = await s.call('POST', url('schedule/baseline'), {}, u.token);
  assert.equal(r.status, 200); assert.equal(r.data.baselines.length, 1); assert.equal(r.data.baselines[0].n, 1);
  const first = r.data.tasks.find((t) => t.id === id);
  assert.equal(first.bl.length, 1); assert.deepEqual(first.bl[0], [first.start, first.finish]);
  // move the task, set the baseline again: the first one must not change
  r = await s.call('POST', url('schedule/apply'), { changes: { [id]: { start: '2027-04-05', duration: 8 } } }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const moved = r.data.tasks.find((t) => t.id === id);
  assert.notEqual(moved.start, first.start);
  r = await s.call('POST', url('schedule/baseline'), {}, u.token);
  assert.deepEqual(r.data.baselines.map((b) => b.n), [1, 2]);
  assert.ok(r.data.baselines[1].at, 'the new baseline has a date');
  const t2 = r.data.tasks.find((t) => t.id === id);
  assert.deepEqual(t2.bl[0], first.bl[0], 'Baseline 1 keeps the old dates');
  assert.deepEqual(t2.bl[1], [moved.start, moved.finish], 'Baseline 2 has the new dates');
  assert.equal(t2.b_start, moved.start, 'the bar still draws the latest baseline');
  // a task added later has no dates in the earlier baselines
  r = await s.call('POST', url('tasks'), { name: 'Late task', start: '2027-05-03', duration: 2 }, u.token);
  const late = r.data.tasks.find((t) => t.id === r.data.created);
  assert.deepEqual(late.bl, [null, null]);
  // it survives a reload of the schedule
  r = await s.call('GET', url('schedule'), null, u.token);
  assert.deepEqual(r.data.baselines.map((b) => b.n), [1, 2]);
  assert.deepEqual(r.data.tasks.find((t) => t.id === id).bl[0], first.bl[0]);
});

test('only the latest 11 baselines are kept and the numbers keep counting', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Many');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'T', start: '2027-03-01', duration: 2 }, u.token);
  let r;
  for (let i = 0; i < 13; i++) r = await s.call('POST', `/api/projects/${p.id}/schedule/baseline`, {}, u.token);
  assert.equal(r.data.baselines.length, 11);
  assert.deepEqual(r.data.baselines.map((b) => b.n), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(r.data.tasks[0].bl.length, 11);
});
