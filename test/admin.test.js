'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
let s, boss, alice, bob;
const A = (m, p, b, t) => s.call(m, p, b, t || boss.token);

before(async () => {
  s = await start({ opsJobs: false });
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id };
  alice = await s.user('Alice'); bob = await s.user('Bob');
});
after(() => s.close());

test('a reserved super admin address cannot be claimed by signing up', async () => {
  const r = await s.call('POST', '/api/auth/register', { name: 'Fake', email: 'BOSS@test.co', password: 'Pm-Test-4821' });
  assert.equal(r.status, 403);
});
test('the reserved account is promoted and sees the flag', async () => {
  const me = await s.call('GET', '/api/me', null, boss.token);
  assert.equal(me.data.user.is_super, true);
  assert.equal((await s.call('GET', '/api/me', null, alice.token)).data.user.is_super, false);
});
test('normal users and anonymous callers are refused', async () => {
  assert.equal((await s.call('GET', '/api/admin/overview')).status, 401);
  for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/finance', '/api/admin/errors', '/api/admin/config']) assert.equal((await A('GET', p, null, alice.token)).status, 403, p);
  assert.equal((await A('PUT', '/api/admin/config', { settings: { trial_days: 1 } }, alice.token)).status, 403);
});
test('overview, health, ai, config and audit load for the super admin', async () => {
  const o = await A('GET', '/api/admin/overview'); assert.equal(o.status, 200); assert.ok(o.data.users.total >= 3); assert.equal(o.data.series.tokens.length, 30);
  const h = await A('GET', '/api/admin/health'); assert.equal(h.status, 200); assert.equal(h.data.database.ok, true);
  assert.equal((await A('GET', '/api/admin/ai')).status, 200);
  const c = await A('GET', '/api/admin/config'); assert.equal(c.status, 200); assert.ok(c.data.settings.find((x) => x.key === 'trial_days'));
  assert.equal((await A('GET', '/api/admin/audit')).status, 200);
});
test('user management: create, edit, suspend, reset password, delete', async () => {
  const c = await A('POST', '/api/admin/users', { name: 'Carol', email: 'carol@test.co', password: 'Pm-Test-4821' }); assert.equal(c.status, 200);
  const id = c.data.user.id;
  assert.equal((await A('POST', '/api/admin/users', { name: 'Dup', email: 'carol@test.co', password: 'Pm-Test-4821' })).status, 409);
  const login = await s.call('POST', '/api/auth/login', { email: 'carol@test.co', password: 'Pm-Test-4821' }); assert.equal(login.status, 200);
  assert.equal((await A('PUT', `/api/admin/users/${id}`, { name: 'Carol B', status: 'suspended' })).status, 200);
  assert.equal((await s.call('GET', '/api/me', null, login.data.token)).status, 401, 'sessions end when suspended');
  assert.equal((await s.call('POST', '/api/auth/login', { email: 'carol@test.co', password: 'Pm-Test-4821' })).status, 403);
  await A('PUT', `/api/admin/users/${id}`, { status: 'active' });
  assert.equal((await A('POST', `/api/admin/users/${id}/password`, { password: 'newpassword1' })).status, 200);
  assert.equal((await s.call('POST', '/api/auth/login', { email: 'carol@test.co', password: 'newpassword1' })).status, 200);
  const d = await A('GET', `/api/admin/users/${id}`); assert.equal(d.data.user.name, 'Carol B'); assert.ok(d.data.subscription);
  assert.equal((await A('DELETE', `/api/admin/users/${id}`)).status, 200);
  assert.equal((await A('GET', `/api/admin/users/${id}`)).status, 404);
});
test('a super admin cannot lock themselves or the last admin out', async () => {
  assert.equal((await A('PUT', `/api/admin/users/${boss.id}`, { status: 'suspended' })).status, 400);
  assert.equal((await A('PUT', `/api/admin/users/${boss.id}`, { is_super: false })).status, 400);
  assert.equal((await A('DELETE', `/api/admin/users/${boss.id}`)).status, 400);
});
test('granting and revoking super admin takes effect at once', async () => {
  assert.equal((await A('PUT', `/api/admin/users/${bob.id}`, { is_super: true })).status, 200);
  assert.equal((await A('GET', '/api/admin/overview', null, bob.token)).status, 200);
  assert.equal((await A('PUT', `/api/admin/users/${bob.id}`, { is_super: false })).status, 200);
  assert.equal((await A('GET', '/api/admin/overview', null, bob.token)).status, 403);
});
test('deleting a person who owns projects needs confirmation', async () => {
  const u = await s.user('Owner'); await s.project(u.token, 'Owned');
  assert.equal((await A('DELETE', `/api/admin/users/${u.id}`)).status, 409);
  const r = await A('DELETE', `/api/admin/users/${u.id}?delete_projects=1`); assert.equal(r.status, 200); assert.equal(r.data.projects_deleted, 1);
});
test('projects can be listed, transferred and deleted', async () => {
  const p = await s.project(alice.token, 'Transfer me');
  const list = await A('GET', '/api/admin/projects?q=Transfer'); assert.equal(list.data.projects.length, 1);
  assert.equal((await A('PUT', `/api/admin/projects/${p.id}`, { owner_id: bob.id })).status, 200);
  assert.equal((await A('GET', `/api/admin/projects/${p.id}`)).data.project.owner_id, bob.id);
  assert.equal((await A('DELETE', `/api/admin/projects/${p.id}`)).status, 200);
});
test('subscriptions: activate with a payment, edit, and the person sees it', async () => {
  const sub = await A('GET', `/api/admin/users/${alice.id}`); assert.equal(sub.data.subscription.state, 'trial');
  const act = await A('POST', `/api/admin/subscriptions/${alice.id}/activate`, { days: 30, record_payment: true, amount_cents: 2500, method: 'bank transfer' });
  assert.equal(act.status, 200); assert.equal(act.data.subscription.state, 'active'); assert.equal(act.data.payment.amount_cents, 2500);
  assert.equal((await A('PUT', `/api/admin/subscriptions/${alice.id}`, { token_limit: 5000, plan: 'Pro' })).data.subscription.token_limit, 5000);
  assert.equal((await A('PUT', `/api/admin/subscriptions/${alice.id}`, { price_cents: -1 })).status, 400);
  const mine = await s.call('GET', '/api/billing', null, alice.token); assert.equal(mine.data.billing.state, 'active'); assert.equal(mine.data.billing.token_limit, 5000); assert.equal(mine.data.billing.invoices.length, 1);
  const list = await A('GET', '/api/admin/subscriptions?state=active'); assert.ok(list.data.subscriptions.some((x) => x.user_id === alice.id));
});
test('finance: ledger totals, refund, edit, delete, demo payments are not income, csv export', async () => {
  const before = (await A('GET', '/api/admin/finance')).data.totals;
  const p = await A('POST', '/api/admin/payments', { email: 'x@test.co', amount_cents: 10000, method: 'card', reference: 'INV-1' }); assert.equal(p.status, 200);
  await A('POST', '/api/admin/payments', { email: 'x@test.co', amount_cents: 2500, kind: 'refund' });
  assert.equal((await A('POST', '/api/admin/payments', { email: 'x@test.co', amount_cents: 0 })).status, 400);
  const f = (await A('GET', '/api/admin/finance')).data;
  assert.equal(f.totals.net_cents - before.net_cents, 7500);
  assert.equal((await A('PUT', `/api/admin/payments/${p.data.payment.id}`, { amount_cents: 20000 })).status, 200);
  assert.equal((await A('GET', '/api/admin/finance')).data.totals.net_cents - before.net_cents, 17500);
  const demo = await s.call('POST', '/api/billing/subscribe', {}, bob.token); assert.equal(demo.status, 200);
  const f2 = (await A('GET', '/api/admin/finance')).data; assert.equal(f2.totals.net_cents - before.net_cents, 17500); assert.ok(f2.totals.demo_cents >= 2500);
  const csv = await s.call('GET', '/api/admin/finance/export.csv', null, boss.token); assert.equal(csv.status, 200); assert.match(csv.buf.toString(), /INV-1/);
  assert.equal((await A('DELETE', `/api/admin/payments/${p.data.payment.id}`)).status, 200);
});
test('configuration is validated, saved and used', async () => {
  assert.equal((await A('PUT', '/api/admin/config', { settings: { trial_days: -3 } })).status, 400);
  assert.equal((await A('PUT', '/api/admin/config', { settings: { nope: 1 } })).status, 400);
  assert.equal((await A('PUT', '/api/admin/config', { settings: { signup_enabled: false } })).status, 200);
  assert.equal((await s.call('POST', '/api/auth/register', { name: 'Late', email: 'late@test.co', password: 'Pm-Test-4821' })).status, 403);
  await A('PUT', '/api/admin/config', { settings: { signup_enabled: true, maintenance_mode: true, maintenance_message: 'Back soon' } });
  assert.equal((await s.call('GET', '/api/projects', null, alice.token)).status, 503);
  assert.equal((await s.call('GET', '/api/projects', null, boss.token)).status, 200, 'super admins still work');
  await A('PUT', '/api/admin/config', { settings: { maintenance_mode: false } });
  assert.equal((await s.call('GET', '/api/projects', null, alice.token)).status, 200);
});
test('AI usage is metered and priced, and limits can be enforced', async () => {
  await s.app.ops.recordUsage({ userId: alice.id, source: 'document reading', model: 'm', input: 1000000, output: 100000 });
  const a = (await A('GET', '/api/admin/ai')).data;
  assert.ok(a.totals.input >= 1000000); assert.ok(a.totals.cost >= 3 + 1.5 - 0.001);
  assert.ok(a.top_users.some((u) => u.id === alice.id));
  await A('PUT', `/api/admin/subscriptions/${alice.id}`, { token_limit: 1000 });
  assert.equal(await s.app.ops.allowance({ id: alice.id }), null, 'not enforced by default');
  await A('PUT', '/api/admin/config', { settings: { enforce_limits: true } });
  assert.match(await s.app.ops.allowance({ id: alice.id }), /used all/);
  assert.equal(await s.app.ops.allowance({ id: alice.id, is_super: true }), null);
  await A('PUT', '/api/admin/config', { settings: { enforce_limits: false } });
});
test('error log: browser reports, server errors, filters, resolve, clear', async () => {
  const r = await s.call('POST', '/api/client-error', { message: 'TypeError: x is undefined', stack: 'at a.js:1', url: '/app.html#/p/1' }, alice.token); assert.equal(r.status, 200);
  await s.call('POST', '/api/client-error', { message: 'Anonymous problem' });
  const l = (await A('GET', '/api/admin/errors?kind=browser')).data; assert.ok(l.errors.length >= 2); assert.ok(l.errors.some((e) => e.email && e.message.startsWith('TypeError')));
  assert.equal((await A('GET', '/api/admin/errors?q=Anonymous')).data.errors.length, 1);
  const id = l.errors[0].id;
  assert.equal((await A('POST', `/api/admin/errors/${id}/resolve`, {})).status, 200);
  assert.ok((await A('GET', '/api/admin/errors?resolved=1')).data.errors.some((e) => e.id === id));
  assert.equal((await A('DELETE', '/api/admin/errors?resolved=1')).status, 200);
  assert.equal((await A('DELETE', '/api/admin/errors')).status, 400);
});
test('every admin change is in the audit log', async () => {
  const a = (await A('GET', '/api/admin/audit?size=100')).data; const kinds = new Set(a.entries.map((e) => e.action));
  for (const k of ['user.create', 'user.update', 'user.delete', 'subscription.activate', 'payment.create', 'config.update']) assert.ok(kinds.has(k), k);
});
test('heartbeat feeds uptime', async () => {
  await s.app.ops.beat();
  const h = (await A('GET', '/api/admin/health')).data; assert.ok(h.uptime.d1.beats >= 1); assert.ok(h.uptime.d1.pct > 0);
});
test('the admin page is served', async () => {
  const r = await fetch(s.base + '/admin'); assert.equal(r.status, 200); assert.match(await r.text(), /Super admin/);
});

// Ad blockers hide anything whose class or id starts with "ad-". The console once used that prefix and showed empty screens.
test('admin page files avoid class names that ad blockers hide', () => {
  const fs = require('fs'), path = require('path');
  for (const f of ['admin.html', 'admin.css', 'admin.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.ok(!/(^|[^a-z0-9])ad-[a-z]/i.test(src), `${f} must not use names that start with ad-`);
    assert.ok(!/[.#"' ](ads?|advert|sponsor|banner)[-_ "'{]/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), `${f} must not use ad like class names`);
  }
});
