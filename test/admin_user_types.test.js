'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
let s, boss, owner, wid, pid;
const A = (m, p, b) => s.call(m, '/api/admin' + p, b, boss.token);

before(async () => {
  s = await start({ opsJobs: false });
  await s.app.ops.setConfig({ org_features: true }, null); await s.app.ops.config(true);
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id };
  owner = await s.user('Owner');
  wid = (await s.call('POST', '/api/orgs/convert', { name: 'Acme' }, owner.token)).data.id;
  pid = (await s.call('POST', `/api/orgs/${wid}/programs`, { name: 'Alpha Program' }, owner.token)).data.id;
});
after(() => s.close());

const mk = (type, extra = {}) => A('POST', '/users', { name: 'New ' + type, email: `${type}${Math.random().toString(36).slice(2, 7)}@test.co`, password: 'Pm-Test-4821', type, ...extra });

test('user types and organizations are listed for the dropdowns', async () => {
  const r = await A('GET', '/user-types');
  assert.equal(r.status, 200);
  assert.ok(r.data.types.includes('pmo_director') && r.data.enabled);
  const o = r.data.organizations.find((x) => x.name === 'Acme');
  assert.ok(o && o.programs.some((p) => p.name === 'Alpha Program'));
});
test('add a user with each type', async () => {
  const sa = await mk('super_admin'); assert.equal(sa.status, 200); assert.equal(sa.data.user.is_super, true);
  const ind = await mk('individual'); assert.equal(ind.status, 200);
  const pm = await mk('project_manager', { organization_id: wid }); assert.equal(pm.status, 200);
  const v = await mk('viewer', { organization_id: wid }); assert.equal(v.status, 200);
  const d = await A('GET', '/users/' + pm.data.user.id);
  assert.equal(d.data.user.type, 'project_manager');
  assert.equal(d.data.user.memberships[0].name, 'Acme');
});
test('org types need an organization and program manager needs a program', async () => {
  assert.equal((await mk('pmo_director')).status, 400);
  assert.equal((await mk('program_manager', { organization_id: wid })).status, 400);
  const ok = await mk('program_manager', { organization_id: wid, program_id: pid });
  assert.equal(ok.status, 200);
  assert.equal((await mk('nonsense')).status, 400);
});
test('auditor needs the Enterprise plan', async () => {
  assert.equal((await mk('auditor', { organization_id: wid })).status, 403);
});
test('seat limit applies to paid roles but not viewers', async () => {
  await s.app.db.query("UPDATE workspaces SET settings = settings || '{\"seats\":2}'::jsonb WHERE id = $1", [wid]).catch(async () => {
    const w = (await s.app.db.query('SELECT settings FROM workspaces WHERE id = $1', [wid])).rows[0];
    const st = typeof w.settings === 'string' ? JSON.parse(w.settings) : w.settings; st.seats = 2;
    await s.app.db.query('UPDATE workspaces SET settings = $2 WHERE id = $1', [wid, JSON.stringify(st)]);
  });
  const used = (await A('GET', '/user-types')).data.organizations.find((x) => x.id === wid).seats_used;
  for (let i = used; i < 2; i++) assert.equal((await mk('project_manager', { organization_id: wid })).status, 200);
  assert.equal((await mk('project_manager', { organization_id: wid })).status, 409);
  assert.equal((await mk('viewer', { organization_id: wid })).status, 200);
});
test('edit a type, then back to individual removes the organization roles', async () => {
  await s.app.db.query("UPDATE workspaces SET settings = settings || '{\"seats\":50}'::jsonb WHERE id = $1", [wid]);
  const u = (await mk('viewer', { organization_id: wid })).data.user;
  assert.equal((await A('PUT', '/users/' + u.id, { type: 'pmo_director', organization_id: wid })).status, 200);
  assert.equal((await A('GET', '/users/' + u.id)).data.user.type, 'pmo_director');
  const r = await A('PUT', '/users/' + u.id, { type: 'individual' });
  assert.equal(r.status, 200);
  assert.equal((await A('GET', '/users/' + u.id)).data.user.type, 'individual');
});
test('cannot demote yourself or remove the only organization admin', async () => {
  assert.equal((await A('PUT', '/users/' + boss.id, { type: 'individual' })).status, 400);
  assert.equal((await A('PUT', '/users/' + owner.id, { type: 'individual' })).status, 409);
});
test('delete a user across the platform, including organization members', async () => {
  const u = (await mk('viewer', { organization_id: wid })).data.user;
  assert.equal((await A('DELETE', '/users/' + u.id)).status, 200);
  assert.equal((await s.app.db.query('SELECT 1 FROM workspace_members WHERE user_id = $1', [u.id])).rows.length, 0);
});
test('only a super admin can use these routes', async () => {
  assert.equal((await s.call('GET', '/api/admin/user-types', null, owner.token)).status, 403);
  assert.equal((await s.call('POST', '/api/admin/users', { name: 'x', email: 'x@test.co', password: 'Pm-Test-4821', type: 'super_admin' }, owner.token)).status, 403);
});
