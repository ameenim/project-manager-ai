'use strict';
// The notification center: late tasks, late payments and the plan state, read, dismiss, and coming back only when the condition changes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const { planState } = require('../server/notifications');

let s;
before(async () => { delete process.env.ANTHROPIC_API_KEY; s = await start(); });
after(() => s.close());
const get = (tok) => s.call('GET', '/api/notifications', null, tok);
const post = (tok, path, body) => s.call('POST', '/api/notifications/' + path, body || {}, tok);
const kinds = (r) => r.data.items.map((x) => x.kind + (x.project_id ? ':' + x.project_id : '')).sort();

test('the plan state keeps the thresholds of the old ribbon', () => {
  const now = Date.now(); const base = { status: 'trial', period_start: null, state: 'trial', token_limit: 1000, tokens_used: 0, trial_end: now + 15 * 86400e3 };
  assert.equal(planState(base, now).sig, 'trial');
  assert.equal(planState({ ...base, trial_end: now + 5 * 86400e3 }, now).sig, 'trial_5');
  assert.equal(planState({ ...base, trial_end: now + 2 * 86400e3 }, now).sig, 'trial_3');
  assert.equal(planState({ ...base, tokens_used: 850 }, now).sig, 'tokens80');
  assert.equal(planState({ ...base, tokens_used: 1000 }, now).sig, 'tokens100');
  assert.equal(planState({ ...base, state: 'expired' }, now).sig, 'trial_over');
  const paid = { ...base, status: 'active', period_start: now - 1e9, period_end: now + 20 * 86400e3 };
  assert.equal(planState(paid, now).sig, null);
  assert.equal(planState({ ...paid, period_end: now + 2 * 86400e3 }, now).sig, 'paid_3');
});

test('a late task and the trial each make a notification, and the list says the center is available', async () => {
  const u = await s.user('Notify'); const p = await s.project(u.token, 'Late project');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', duration: 2, start: '2020-01-06' }, u.token);
  const r = await get(u.token);
  assert.equal(r.status, 200); assert.equal(r.data.available, true);
  assert.ok(kinds(r).includes('late_tasks:' + p.id));
  assert.ok(kinds(r).includes('plan'));
  const late = r.data.items.find((x) => x.kind === 'late_tasks');
  assert.equal(late.n, 1); assert.equal(late.project, 'Late project'); assert.equal(late.read, false);
  assert.equal(r.data.unread, r.data.items.length);
});

test('read, dismiss and mark all read, and a dismissed one returns only when the condition changes', async () => {
  const u = await s.user('Reader'); const p = await s.project(u.token, 'Reader project');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', duration: 2, start: '2020-01-06' }, u.token);
  let r = await get(u.token);
  const late = r.data.items.find((x) => x.kind === 'late_tasks');
  assert.equal((await post(u.token, 'read', { id: late.id })).status, 200);
  r = await get(u.token);
  assert.equal(r.data.items.find((x) => x.kind === 'late_tasks').read, true);
  assert.equal((await post(u.token, 'dismiss', { id: late.id })).status, 200);
  assert.ok(!kinds(await get(u.token)).includes('late_tasks:' + p.id));
  // the same condition stays dismissed
  assert.ok(!kinds(await get(u.token)).includes('late_tasks:' + p.id));
  // another task goes late, so the condition changed and it returns unread
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Older task', duration: 2, start: '2020-02-03' }, u.token);
  r = await get(u.token);
  const back = r.data.items.find((x) => x.kind === 'late_tasks');
  assert.ok(back); assert.equal(back.n, 2); assert.equal(back.read, false);
  assert.equal((await post(u.token, 'read', { all: true })).status, 200);
  assert.equal((await get(u.token)).data.unread, 0);
  assert.equal((await post(u.token, 'read', {})).status, 400);
});

test('a notification goes away when the condition is gone, and people only see their own', async () => {
  const a = await s.user('Owner'); const b = await s.user('Other');
  const p = await s.project(a.token, 'Own project');
  const t = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', duration: 2, start: '2020-01-06' }, a.token);
  assert.ok(kinds(await get(a.token)).includes('late_tasks:' + p.id));
  assert.ok(!kinds(await get(b.token)).some((k) => k.startsWith('late_tasks')));
  await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [t.data.created]: { progress: 100 } } }, a.token);
  assert.ok(!kinds(await get(a.token)).includes('late_tasks:' + p.id));
  // a person cannot dismiss someone else's notification
  const mine = (await get(a.token)).data.items[0];
  await post(b.token, 'dismiss', { id: mine.id });
  assert.ok((await get(a.token)).data.items.some((x) => x.id === mine.id));
  assert.equal((await s.call('GET', '/api/notifications')).status, 401);
});

test('without the table the list reports it is unavailable instead of failing', async () => {
  const u = await s.user('Lag');
  await s.app.db.query('DROP TABLE notifications');
  const r = await get(u.token);
  assert.equal(r.status, 200); assert.equal(r.data.available, false); assert.deepEqual(r.data.items, []);
  assert.equal((await post(u.token, 'read', { all: true })).status, 503);
});
