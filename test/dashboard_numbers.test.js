'use strict';
// The overview numbers must agree with the data behind them. These checks recompute the key figures from the raw tasks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let s, u;
before(async () => {
  s = await start({ opsJobs: false });
  u = await s.user('Numbers');
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, u.token)).status, 200);
});
after(() => s.close());

test('the overdue total counts every late task, not only the rows the list shows', async () => {
  const d = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  const fromProjects = d.analytics.projects.reduce((a, p) => a + p.overdue, 0);
  assert.equal(d.overdueTotal, fromProjects, 'overdueTotal equals the sum of late tasks per project');
  assert.equal(d.overdueTotal, d.analytics.status.late, 'overdueTotal equals the late slice of the task status');
  assert.ok(d.overdue.length <= d.overdueTotal, 'the list is a slice of the total');
  assert.ok(d.overdue.length <= 12, 'the list stays short');
});

test('late, done and open tasks add up to the task count of every project and of the portfolio', async () => {
  const d = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  const st = d.analytics.status, total = st.done + st.active + st.todo + st.late;
  let tasks = 0;
  for (const p of d.projects) tasks += p.stats.tasks;
  assert.equal(total, tasks);
});

test('the workload list says how many owners exist when it shows only the top ones', async () => {
  const d = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  assert.ok(d.analytics.workloadTotal >= d.analytics.workload.length);
  assert.ok(d.analytics.workload.length <= 8);
  for (let i = 1; i < d.analytics.workload.length; i++) assert.ok(d.analytics.workload[i - 1].total >= d.analytics.workload[i].total, 'sorted by task count');
});

test('sample activity never lies in the future', async () => {
  const d = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  assert.ok(d.activity.length > 0);
  for (const a of d.activity) assert.ok(String(a.ts).slice(0, 10) <= d.today, `activity ${a.ts} is after today ${d.today}`);
});

test('each project overview matches the portfolio numbers for the same project', async () => {
  const d = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  for (const row of d.analytics.projects) {
    const pd = (await s.call('GET', `/api/projects/${row.id}/dashboard`, null, u.token)).data;
    assert.equal(pd.status.late, row.overdue, `${row.name} late tasks`);
    assert.equal(pd.taskCount, d.projects.find((p) => p.id === row.id).stats.tasks, `${row.name} task count`);
    const owned = pd.owners.reduce((a, o) => a + o.total, 0);
    assert.equal(owned, pd.taskCount, `${row.name} owners cover every task`);
  }
});
