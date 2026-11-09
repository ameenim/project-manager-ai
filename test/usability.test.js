'use strict';
// The usability report: steps from several project managers come in through /api/usage and the super admin sees
// numbers and suggestions built from them.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
let s, boss, pms;
const A = (m, p, b, t) => s.call(m, p, b, t || boss.token);
const send = (u, sid, events, device) => s.call('POST', '/api/usage', { sid, device: device || 'desktop', events }, u.token);
const flow = (screens) => screens.map((x, i) => ({ k: 'view', s: x, ago: (screens.length - i) * 1000 }));

before(async () => {
  s = await start({ opsJobs: false });
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id };
  pms = [await s.user('Pm One'), await s.user('Pm Two'), await s.user('Pm Three')];
});
after(() => s.close());

test('the report is for super admins only and is empty before any usage', async () => {
  assert.equal((await A('GET', '/api/admin/usability', null, pms[0].token)).status, 403);
  const r = await A('GET', '/api/admin/usability');
  assert.equal(r.status, 200);
  assert.equal(r.data.empty, true);
  assert.equal(r.data.suggestions.length, 0);
});

test('the intake accepts steps, drops bad ones and keeps names clean', async () => {
  const bad = await send(pms[0], 'sess-bad', [{ k: 'nope', s: 'x' }, { k: 'view', s: '<script>alert(1)</script>' }, { k: 'view' }, null, { k: 'view', s: 'dashboard', ago: 5000 }]);
  assert.equal(bad.status, 200);
  assert.equal(bad.data.saved, 1);
  assert.equal((await s.call('POST', '/api/usage', { sid: '', events: [{ k: 'view', s: 'dashboard' }] }, pms[0].token)).data.saved, 0);
  assert.equal((await s.call('POST', '/api/usage', { sid: 'a', events: 'not a list' }, pms[0].token)).data.saved, 0);
  assert.equal((await s.call('POST', '/api/usage', { sid: 'a', events: [{ k: 'view', s: 'dashboard' }] })).status, 401);
});

test('patterns from several project managers become suggestions with evidence', async () => {
  let n = 0;
  for (const u of pms) {
    n++;
    // a loop between schedule and review, a quick exit from logs, a long first session
    await send(u, 'sess-' + n, [
      ...flow(['dashboard', 'project:schedule', 'project:review', 'project:schedule', 'project:review', 'project:schedule', 'project:logs']),
      { k: 'dwell', s: 'project:logs', ms: 1200 }, { k: 'dwell', s: 'project:logs', ms: 900 }, { k: 'dwell', s: 'project:schedule', ms: 60000 },
      { k: 'act', s: 'project:schedule', a: 'chat_send' },
      { k: 'rage', s: 'project:schedule', a: 'apply' },
      { k: 'fail', s: 'project:schedule', a: 'projects/:id/tasks', ms: 300 },
      { k: 'slow', s: 'project:schedule', a: 'projects/:id/tasks', ms: 4200 },
    ]);
    await send(u, 'sess-' + n, [{ k: 'slow', s: 'project:schedule', a: 'projects/:id/tasks', ms: 4200 }, { k: 'slow', s: 'project:schedule', a: 'projects/:id/tasks', ms: 4000 }], 'phone');
  }
  const r = (await A('GET', '/api/admin/usability?days=30')).data;
  assert.equal(r.empty, undefined);
  assert.equal(r.kpis.users, 3);
  assert.equal(r.kpis.sessions, 3 + 1, 'three real sessions plus the early dropped test session');
  assert.ok(r.screens.find((x) => x.screen === 'project:schedule').views >= 9);
  assert.ok(r.loops.find((x) => x.users === 3 && x.count >= 3), 'loop between schedule and review');
  assert.ok(r.friction.rage.some((x) => x.target === 'apply' && x.users === 3));
  assert.ok(r.friction.fail.some((x) => x.target === 'projects/:id/tasks' && x.users === 3));
  assert.ok(r.friction.slow[0].avg_s >= 4);
  const ids = r.suggestions.map((x) => x.id);
  for (const want of ['fail:projects/:id/tasks', 'slow:projects/:id/tasks', 'rage:Scheduleapply']) assert.ok(ids.includes(want), want + ' in ' + ids.join(', '));
  assert.ok(ids.some((x) => x.startsWith('loop:')));
  for (const x of r.suggestions) { assert.ok(x.title && x.evidence && x.action); assert.ok(['high', 'medium', 'low'].includes(x.priority)); assert.doesNotMatch(x.title + x.evidence + x.action, /[;]|[–—]/); }
  assert.equal(r.suggestions[0].priority, 'high', 'most urgent first');
  assert.equal(r.people.length, 3);
  assert.ok(r.devices.find((x) => x.device === 'phone'));
});

test('one person alone never creates a pattern suggestion', async () => {
  const lone = await s.user('Lone Wolf');
  await send(lone, 'lone-1', [{ k: 'rage', s: 'project:risks', a: 'lonely_button' }, { k: 'rage', s: 'project:risks', a: 'lonely_button' }]);
  const r = (await A('GET', '/api/admin/usability')).data;
  assert.ok(!r.suggestions.some((x) => x.id.includes('lonely_button')));
});

test('the range is limited to known values and old steps are left out', async () => {
  const r = await A('GET', '/api/admin/usability?days=9999');
  assert.equal(r.data.days, 30);
  await s.app.db.query("UPDATE usage_events SET created_at = now() - interval '40 days'");
  assert.equal((await A('GET', '/api/admin/usability?days=30')).data.empty, true);
  assert.ok((await A('GET', '/api/admin/usability?days=60')).data.kpis.users >= 3);
});
