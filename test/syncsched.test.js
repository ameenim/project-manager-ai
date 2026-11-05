'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start({ noScheduler: true }); }); after(() => s.close());

test('the schedule is saved, validated and limited to editors', async () => {
  const mgr = await s.user(), vw = await s.user(); const p = await s.project(mgr.token, 'Sched');
  await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token);
  const get = (tok) => s.call('GET', `/api/projects/${p.id}/sync-history`, null, tok);
  const put = (b, tok) => s.call('PUT', `/api/projects/${p.id}/sync-schedule`, b, tok);
  let r = await get(mgr.token);
  assert.equal(r.status, 200); assert.deepEqual(r.data.history, []); assert.equal(r.data.last, null); assert.equal(r.data.schedule.mode, 'off'); assert.equal(r.data.next, null);
  assert.equal((await put({ mode: 'weekly' }, mgr.token)).status, 400);
  assert.equal((await put({ mode: 'daily', time: '25:00' }, mgr.token)).status, 400);
  assert.equal((await put({ mode: 'daily', time: '08:00' }, vw.token)).status, 403);
  assert.equal((await get((await s.user()).token)).status, 404);
  assert.equal((await get(vw.token)).status, 200, 'viewers can read the history');
  r = await put({ mode: 'daily', time: '08:30', tzo: -240 }, mgr.token);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.schedule.mode, 'daily'); assert.equal(r.data.schedule.time, '08:30');
  const next = new Date(r.data.next);
  assert.equal(next.getUTCHours(), 4); assert.equal(next.getUTCMinutes(), 30, '08:30 at UTC+4 is 04:30 UTC');
  assert.ok(next.getTime() > Date.now());
  r = await put({ mode: 'off' }, mgr.token);
  assert.equal(r.data.next, null);
});

test('a manual sync with nothing connected is not logged, a due scheduled one is', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Due');
  const m = await s.call('POST', `/api/projects/${p.id}/sync`, {}, u.token);
  assert.equal(m.status, 200); assert.equal(m.data.needs_connection, true);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/sync-history`, null, u.token)).data.history.length, 0);
  await s.call('PUT', `/api/projects/${p.id}/sync-schedule`, { mode: 'hourly' }, u.token);
  assert.equal(await s.app.api.runDueSyncs(), 0, 'not due yet');
  const P = s.app.store.cache.get(Number(p.id)).P; P.sync_cfg.set_at -= 2 * 3600e3; await s.app.store.save(P);
  assert.equal(await s.app.api.runDueSyncs(), 1);
  const h = (await s.call('GET', `/api/projects/${p.id}/sync-history`, null, u.token)).data;
  assert.equal(h.history.length, 1); assert.equal(h.history[0].trigger, 'scheduled'); assert.equal(h.history[0].ok, false);
  assert.ok(h.history[0].errors.connect); assert.equal(h.last, h.history[0].at);
  assert.equal(await s.app.api.runDueSyncs(), 0, 'the next run moves an hour ahead');
  assert.ok(new Date(h.next).getTime() > Date.now());
});
