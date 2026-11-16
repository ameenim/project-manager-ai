'use strict';
// Every widget follows the top filters: the project figures, the trends and the widgets a person added.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let s, u;
before(async () => {
  s = await start({ opsJobs: false });
  u = await s.user('Scope');
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, u.token)).status, 200);
  const SPEC = { dataset: 'tasks', viz: 'kpi', agg: 'count' };
  const w = await s.call('POST', '/api/widgets', { title: 'Task count', description: 'Counts tasks', group: 'overview', spec: SPEC }, u.token);
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.equal((await s.call('POST', `/api/widgets/${w.data.widget.id}/install`, { scope: 'portfolio' }, u.token)).status, 200);
});
after(() => s.close());
const dash = async (qs = '') => (await s.call('GET', '/api/dashboard' + qs, null, u.token)).data;

test('a period narrows the project figures, not only the list of projects', async () => {
  const all = await dash(), year = all.filter_options.years[all.filter_options.years.length - 1];
  const one = await dash('?y=' + year);
  const sig = (d) => JSON.stringify(d.projects.map((p) => [p.stats.progress, p.stats.planned, p.stats.overdue, p.stats.tasks]));
  assert.notEqual(sig(one), sig(all), 'progress, plan and late tasks are read inside the period');
  const tasksIn = (d) => d.projects.reduce((n, p) => n + p.stats.tasks, 0);
  assert.ok(tasksIn(one) < tasksIn(all));
  assert.equal(tasksIn(one), one.analytics.status.done + one.analytics.status.active + one.analytics.status.todo + one.analytics.status.late);
});

test('a status narrows the task count of every project', async () => {
  const all = await dash(), late = await dash('?s=late');
  assert.ok(late.projects.every((p) => p.stats.overdue === p.stats.tasks), 'only late tasks are left');
  assert.ok(late.projects.reduce((n, p) => n + p.stats.tasks, 0) <= all.projects.reduce((n, p) => n + p.stats.tasks, 0));
});

test('the widgets a person added read the filtered rows', async () => {
  const all = await dash(), year = all.filter_options.years[all.filter_options.years.length - 1];
  assert.ok(all.datasets.tasks.length > 0);
  const inYear = await dash('?y=' + year);
  assert.ok(inYear.datasets.tasks.length < all.datasets.tasks.length, 'tasks outside the period are not sent');
  const late = await dash('?s=late');
  assert.ok(late.datasets.tasks.length > 0 && late.datasets.tasks.every((t) => t.status === 'late'));
  assert.ok(late.datasets.payments.every((p) => p.state === 'pending' && p.late === 'yes'));
  const none = await dash('?y=2000');
  assert.equal(none.datasets.tasks.length, 0);
});

test('the trends read the days of the picked period', async () => {
  const all = await dash();
  const past = await dash('?y=2000');
  assert.equal(past.trends.series.length, 0);
  const cur = await dash('?y=' + all.today.slice(0, 4));
  assert.ok(cur.trends.from >= all.today.slice(0, 4) + '-01-01');
});

test('a custom widget redraws from the data of the latest load, not the first one', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'app_widgets.js'), 'utf8');
  assert.match(src, /render: \(body, dd, ctx, F\) => \{ if \(dd && dd\.datasets\) \{ pack\.datasets = dd\.datasets;/);
});

test('the schedule view takes the period as its axis and drops phases outside it', async () => {
  const all = await dash(), year = all.filter_options.years[all.filter_options.years.length - 1];
  const one = await dash('?y=' + year), T = one.analytics.timeline;
  assert.deepEqual(T.range, { lo: year + '-01-01', hi: year + '-12-31' });
  assert.equal(T.min, year + '-01-01'); assert.equal(T.max, year + '-12-31');
  const count = (d) => d.analytics.timeline.projects.reduce((n, p) => n + p.phases.length, 0);
  assert.ok(count(one) <= count(all));
  for (const p of T.projects) for (const ph of p.phases) assert.ok(ph.start <= T.max && ph.finish >= T.min, 'every phase overlaps the period');
  assert.equal(all.analytics.timeline.range, undefined);
});

test('the value tile adds up the payments inside the period and status', async () => {
  const all = await dash(), year = all.filter_options.years[all.filter_options.years.length - 1];
  assert.equal(all.valueScoped, false);
  const one = await dash('?y=' + year);
  assert.equal(one.valueScoped, true);
  const sum = (v) => Object.values(v).reduce((a, b) => a + b, 0);
  assert.equal(sum(one.totalValue), one.analytics.payments.reduce((n, m) => n + m.total, 0), 'same payments as the payments widget');
});
