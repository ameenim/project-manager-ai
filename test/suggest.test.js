'use strict';
// Proactive suggestions: plain rules, no AI call, dismiss until the condition changes, snooze for 7 days.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { rulesFor } = require('../server/chat/suggest');

let s;
before(async () => { delete process.env.ANTHROPIC_API_KEY; s = await start(); });
after(() => s.close());

const get = (tok, pid) => s.call('GET', '/api/chat/suggestions' + (pid ? '?project_id=' + pid : ''), null, tok);
const rules = (r) => r.data.items.map((x) => x.rule).sort();

test('the rules read plain data and need no model', () => {
  const sc = { tasks: [{ id: 1, finish: '2026-01-10', progress: 20 }, { id: 2, finish: '2026-03-01', progress: 0, deliverable_id: 9 }], has_baseline: false };
  const p = { end_date: '2026-02-01', stats: { spi: 0.7, forecast_end: '2026-03-01' } };
  const items = [{ id: 9, kind: 'deliverable', state: 'pending', data: { due_date: '2026-02-03' } }, { id: 8, kind: 'deliverable', state: 'pending', data: { due_date: '2026-02-04' } }, { id: 7, kind: 'milestone', state: 'pending', data: { due_date: '2026-01-01' } }];
  const out = rulesFor(p, sc, items, [{ id: 5, status: 'pending' }], '2026-02-01').map((x) => x.rule).sort();
  assert.deepEqual(out, ['deliverable_no_task', 'forecast_late', 'late_payments', 'late_tasks', 'low_spi', 'no_baseline', 'waiting_updates']);
  const calm = rulesFor({ end_date: '2026-09-01', stats: { spi: 1, forecast_end: '2026-08-01' } }, { tasks: [{ id: 1, finish: '2026-08-01', progress: 0 }], has_baseline: true }, [], [], '2026-02-01');
  assert.deepEqual(calm, []);
});

test('a late task shows a suggestion, dismiss hides it until the condition changes, snooze hides it for 7 days', async () => {
  const u = await s.user('Suggest'); const p = await s.project(u.token, 'Late project');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', duration: 2, start: '2020-01-06' }, u.token);
  let r = await get(u.token, p.id);
  assert.equal(r.status, 200);
  assert.ok(rules(r).includes('late_tasks'));
  assert.equal(r.data.count, r.data.items.length);
  const late = r.data.items.find((x) => x.rule === 'late_tasks');
  assert.equal(late.n, 1);
  // the all projects view counts the same suggestion
  assert.ok(rules(await get(u.token)).includes('late_tasks'));
  // dismiss
  const d = await s.call('POST', '/api/chat/suggestions/dismiss', { project_id: p.id, rule: 'late_tasks', mode: 'dismiss' }, u.token);
  assert.equal(d.status, 200);
  assert.ok(!rules(await get(u.token, p.id)).includes('late_tasks'));
  // another task goes late, so the condition changed and the suggestion returns
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Older task', duration: 2, start: '2020-02-03' }, u.token);
  r = await get(u.token, p.id);
  assert.equal(r.data.items.find((x) => x.rule === 'late_tasks').n, 2);
  // snooze hides it even though the condition keeps changing
  const z = await s.call('POST', '/api/chat/suggestions/dismiss', { project_id: p.id, rule: 'late_tasks', mode: 'snooze' }, u.token);
  assert.equal(z.data.mode, 'snooze'); assert.ok(z.data.until);
  assert.ok(!rules(await get(u.token, p.id)).includes('late_tasks'));
});

test('the choice belongs to the person and other people keep their own list', async () => {
  const a = await s.user('Owner'); const b = await s.user('Stranger');
  const p = await s.project(a.token, 'Own project');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', duration: 2, start: '2020-01-06' }, a.token);
  await s.call('POST', '/api/chat/suggestions/dismiss', { project_id: p.id, rule: 'late_tasks' }, a.token);
  // a person without access gets a not found, never the data
  assert.equal((await get(b.token, p.id)).status, 404);
  assert.equal((await s.call('POST', '/api/chat/suggestions/dismiss', { project_id: p.id, rule: 'late_tasks' }, b.token)).status, 404);
  // the stranger sees nothing from this project in the all projects list
  assert.ok(!(await get(b.token)).data.items.some((x) => x.project_id === p.id));
  assert.equal((await s.call('GET', '/api/chat/suggestions')).status, 401);
});

test('a condition that is gone cannot be dismissed and a plain project has no schedule suggestions', async () => {
  const u = await s.user('Calm'); const p = await s.project(u.token, 'Calm project');
  const r = await get(u.token, p.id);
  assert.ok(!rules(r).includes('late_tasks') && !rules(r).includes('no_baseline'));
  const d = await s.call('POST', '/api/chat/suggestions/dismiss', { project_id: p.id, rule: 'late_tasks' }, u.token);
  assert.equal(d.data.gone, true);
});
