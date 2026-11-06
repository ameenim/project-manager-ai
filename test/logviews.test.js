'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

const view = (name, cfg = {}) => ({ id: 'v' + Math.random().toString(36).slice(2, 8), name, cfg });

test('saved log views start empty, save with their columns and filters, and belong to the person', async () => {
  const a = await s.user(), b = await s.user();
  assert.deepEqual((await s.call('GET', '/api/me/log-views', null, a.token)).data.views, []);
  const risk = view('Risk log', { cols: ['type', 'item', 'status', 'prob', 'imp'], kinds: ['risk'], rs: 'confirmed', sort: 'imp', dir: -1 });
  const pay = view('Payments', { cols: ['item', 'due', 'amount', 'percent'], kinds: ['milestone'], st: 'milestone|invoiced' });
  const put = await s.call('PUT', '/api/me/log-views', { views: [risk, pay] }, a.token);
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const got = (await s.call('GET', '/api/me/log-views', null, a.token)).data.views;
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].cfg.cols, ['type', 'item', 'status', 'prob', 'imp']);
  assert.deepEqual(got[0].cfg.kinds, ['risk']);
  assert.equal(got[0].cfg.sort, 'imp'); assert.equal(got[0].cfg.dir, -1);
  assert.equal(got[1].cfg.st, 'milestone|invoiced');
  assert.deepEqual((await s.call('GET', '/api/me/log-views', null, b.token)).data.views, []);
});

test('log views are cleaned and bad input is refused', async () => {
  const u = await s.user();
  const dirty = view('  Odd  ', { cols: ['prob', 'nonsense'], kinds: ['risk', 'x'], prob: 'Extreme', due: 'later', rs: 'bogus', size: 7, sort: 'nope', q: 'a'.repeat(500) });
  const r = (await s.call('PUT', '/api/me/log-views', { views: [dirty] }, u.token)).data.views[0];
  assert.equal(r.name, 'Odd');
  assert.deepEqual(r.cfg.cols, ['item', 'prob']);
  assert.deepEqual(r.cfg.kinds, ['risk']);
  assert.equal(r.cfg.prob, ''); assert.equal(r.cfg.due, ''); assert.equal(r.cfg.rs, 'live'); assert.equal(r.cfg.size, 20); assert.equal(r.cfg.sort, 'type'); assert.equal(r.cfg.q.length, 200);
  assert.equal((await s.call('PUT', '/api/me/log-views', { views: [view('')] }, u.token)).status, 400);
  assert.equal((await s.call('PUT', '/api/me/log-views', { views: [view('Same'), view('same')] }, u.token)).status, 400);
  assert.equal((await s.call('PUT', '/api/me/log-views', { views: [{ id: 'bad id!', name: 'X', cfg: {} }] }, u.token)).status, 400);
  assert.equal((await s.call('PUT', '/api/me/log-views', { views: 'no' }, u.token)).status, 400);
  assert.equal((await s.call('PUT', '/api/me/log-views', { views: Array.from({ length: 31 }, (_, i) => view('V' + i)) }, u.token)).status, 400);
  assert.equal((await s.call('PUT', '/api/me/log-views', { views: [] }, u.token)).data.views.length, 0);
});

test('saving log views keeps the rest of the person settings', async () => {
  const u = await s.user();
  await s.call('PUT', '/api/me', { theme: 'dark' }, u.token);
  await s.call('PUT', '/api/me/log-views', { views: [view('Keep me')] }, u.token);
  await s.call('PUT', '/api/me', { language: 'ar' }, u.token);
  const v = (await s.call('GET', '/api/me/log-views', null, u.token)).data.views;
  assert.equal(v.length, 1);
  assert.equal((await s.call('GET', '/api/me', null, u.token)).data.user.theme, 'dark');
});
