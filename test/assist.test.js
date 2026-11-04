'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

async function setup() {
  const u = await s.user(); const p = await s.project(u.token, 'Assist');
  const add = (body) => s.call('POST', `/api/projects/${p.id}/tasks`, body, u.token);
  await add({ name: 'Build', duration: 3, start: '2027-03-01' });
  const r = await add({ name: 'Final acceptance and go live', duration: 2, start: '2027-03-08' });
  const it = await s.call('POST', `/api/projects/${p.id}/items`, { kind: 'milestone', title: 'Final payment', data: { percent: 10 } }, u.token);
  await s.call('POST', `/api/items/${it.data.item.id}/confirm`, null, u.token);
  return { u, p, item: it.data.item, last: r.data.created };
}
test('without an AI key the assistant only suggests and never changes the plan', async () => {
  const { u, p } = await setup();
  const before = (await s.call('GET', `/api/projects/${p.id}/schedule/validate`, null, u.token)).data.issues.length;
  const r = await s.call('POST', `/api/projects/${p.id}/schedule/assist`, {}, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.applied.length, 0);
  assert.ok(r.data.suggestions.every((x) => x.confidence < 0.85));
  assert.equal((await s.call('GET', `/api/projects/${p.id}/schedule/validate`, null, u.token)).data.issues.length, before);
});
test('applying a suggestion links the payment and undo restores it', async () => {
  const { u, p, item, last } = await setup();
  const act = { type: 'link', item_id: item.id, task_ids: [last] };
  const ap = await s.call('POST', `/api/projects/${p.id}/schedule/assist/apply`, { actions: [act] }, u.token);
  assert.equal(ap.data.applied, 1);
  assert.ok(ap.data.tasks.find((t) => t.id === last).links.includes(item.id));
  const un = await s.call('POST', `/api/projects/${p.id}/schedule/assist/undo`, { token: ap.data.token }, u.token);
  assert.ok(!un.data.tasks.find((t) => t.id === last).links.includes(item.id));
  assert.equal((await s.call('POST', `/api/projects/${p.id}/schedule/assist/undo`, { token: 'x' }, u.token)).status, 404);
});
test('a link to a task from another project or a loop is refused', async () => {
  const { u, p, item } = await setup();
  const ap = await s.call('POST', `/api/projects/${p.id}/schedule/assist/apply`, { actions: [{ type: 'link', item_id: item.id, task_ids: [999999] }, { type: 'dep', task_id: 1, pred_id: 1 }] }, u.token);
  assert.equal(ap.data.applied, 0);
});
