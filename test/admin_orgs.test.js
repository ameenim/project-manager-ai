'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
let s, boss, owner, m1, wid, pid, proj;
const A = (m, p, b) => s.call(m, '/api/admin' + p, b, boss.token);

before(async () => {
  s = await start({ opsJobs: false });
  await s.app.ops.setConfig({ org_features: true }, null); await s.app.ops.config(true);
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id };
  owner = await s.user('Owner'); m1 = await s.user('Member');
  proj = await s.project(owner.token, 'Tower');
  wid = (await s.call('POST', '/api/orgs/convert', { name: 'Acme' }, owner.token)).data.id;
  pid = (await s.call('POST', `/api/orgs/${wid}/programs`, { name: 'Alpha Program' }, owner.token)).data.id;
});
after(() => s.close());

test('list shows organizations with totals and filters', async () => {
  const r = await A('GET', '/orgs');
  assert.equal(r.status, 200);
  const o = r.data.organizations.find((x) => x.name === 'Acme');
  assert.ok(o && o.projects >= 1 && o.programs === 1 && o.seats === 5);
  assert.equal(r.data.totals.organizations, 1);
  assert.equal((await A('GET', '/orgs?q=zzz')).data.organizations.length, 0);
  assert.equal((await A('GET', '/orgs?plan=enterprise')).data.organizations.length, 0);
  assert.equal((await A('GET', '/orgs?q=acme')).data.organizations.length, 1);
});
test('detail returns members, structure, projects, pool and audit', async () => {
  const d = (await A('GET', '/orgs/' + wid)).data;
  assert.equal(d.organization.name, 'Acme');
  assert.ok(d.members.some((x) => x.user_id === owner.id && x.type === 'admin'));
  assert.ok(d.structure.some((x) => x.name === 'Alpha Program'));
  assert.ok(d.projects.some((x) => x.name === 'Tower'));
  assert.ok(d.pool && Array.isArray(d.by_member));
});
test('update name, seats, plan, overage and AI policy', async () => {
  let r = await A('PUT', '/orgs/' + wid, { name: 'Acme Global', seats: 8, overage_policy: 'capped', overage_cap: 500 });
  assert.equal(r.status, 200); assert.equal(r.data.organization.name, 'Acme Global'); assert.equal(r.data.organization.seats, 8); assert.equal(r.data.pool.policy, 'capped');
  assert.equal((await A('PUT', '/orgs/' + wid, { ai_policy: { enabled: true, member_cap_units: 10 } })).status, 403);
  r = await A('PUT', '/orgs/' + wid, { plan: 'enterprise', ai_policy: { enabled: true, member_cap_units: 10 }, units_purchased: 1000 });
  assert.equal(r.status, 200); assert.equal(r.data.organization.plan, 'enterprise'); assert.equal(r.data.ai_policy.member_cap_units, 10); assert.equal(r.data.pool.purchased, 1000);
  assert.equal((await A('PUT', '/orgs/' + wid, { seats: 0 })).status, 400);
});
test('add, change and remove members', async () => {
  let r = await A('POST', `/orgs/${wid}/members`, { user_id: m1.id, type: 'project_manager' });
  assert.equal(r.status, 200); assert.ok(r.data.members.some((x) => x.user_id === m1.id && x.type === 'project_manager'));
  r = await A('PUT', `/orgs/${wid}/members/${m1.id}`, { type: 'program_manager', program_id: pid });
  assert.equal(r.status, 200); assert.equal(r.data.members.find((x) => x.user_id === m1.id).program, 'Alpha Program');
  assert.equal((await A('POST', `/orgs/${wid}/members`, { email: 'nobody@test.co', type: 'viewer' })).status, 404);
  assert.equal((await A('POST', `/orgs/${wid}/members`, { user_id: m1.id, type: 'super_admin' })).status, 400);
  r = await A('DELETE', `/orgs/${wid}/members/${m1.id}`);
  assert.equal(r.status, 200); assert.ok(!r.data.members.some((x) => x.user_id === m1.id));
  assert.equal((await A('DELETE', `/orgs/${wid}/members/${owner.id}`)).status, 409);
});
test('removing a project manager creates a handover that the platform owner can transfer', async () => {
  await A('POST', `/orgs/${wid}/members`, { user_id: m1.id, type: 'project_manager' });
  const p2 = await s.project(owner.token, 'Bridge');
  await s.app.db.query('UPDATE projects SET workspace_id = $2 WHERE id = $1', [p2.id, wid]);
  await s.app.db.query("INSERT INTO project_members(project_id, user_id, role) VALUES ($1,$2,'manager') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'manager'", [p2.id, m1.id]);
  await s.app.db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [p2.id, owner.id]);
  const r = await A('DELETE', `/orgs/${wid}/members/${m1.id}`);
  assert.equal(r.data.handovers.length, 1);
  const h = r.data.handovers[0];
  const t = await A('POST', `/orgs/${wid}/handovers/${h.id}/transfer`, { to_user_id: owner.id });
  assert.equal(t.status, 200); assert.equal(t.data.handovers.length, 0);
});
test('move a project out of an organization and back in', async () => {
  const p3 = await s.project(m1.token, 'Solo');
  let r = await A('POST', `/projects/${p3.id}/organization`, { organization_id: wid });
  assert.equal(r.status, 200);
  assert.ok((await A('GET', '/orgs/' + wid)).data.projects.some((x) => x.id === Number(p3.id)));
  const lst = (await A('GET', `/projects?organization_id=${wid}`)).data.projects;
  assert.ok(lst.some((x) => x.id === Number(p3.id) && x.organization === 'Acme Global'));
  assert.ok(!(await A('GET', '/projects?organization_id=none')).data.projects.some((x) => x.id === Number(p3.id)));
  r = await A('POST', `/projects/${p3.id}/organization`, { organization_id: 0 });
  assert.equal(r.status, 200);
  assert.ok(!(await A('GET', '/orgs/' + wid)).data.projects.some((x) => x.id === Number(p3.id)));
});
test('users can be filtered by organization and type', async () => {
  await A('POST', `/orgs/${wid}/members`, { user_id: m1.id, type: 'viewer' });
  const inOrg = (await A('GET', `/users?organization_id=${wid}`)).data.users;
  assert.ok(inOrg.some((u) => u.id === m1.id) && inOrg.every((u) => u.organizations.includes('Acme Global')));
  assert.ok((await A('GET', '/users?type=viewer')).data.users.every((u) => u.type === 'viewer'));
  assert.ok((await A('GET', '/users?type=individual')).data.users.every((u) => u.type === 'individual'));
  assert.ok((await A('GET', '/users?type=super_admin')).data.users.some((u) => u.id === boss.id));
});
test('overview, finance, AI, health carry organization data', async () => {
  assert.equal((await A('GET', '/overview')).data.organizations.organizations, 1);
  assert.ok((await A('GET', '/finance')).data.organizations.by_org);
  const ai = (await A('GET', '/ai?days=30')).data;
  assert.ok(Array.isArray(ai.by_organization) && ai.by_organization.some((x) => x.name === 'Acme Global'));
  assert.equal((await A('GET', '/health')).data.counts.organizations, 1);
});
test('organization audit trail records platform actions', async () => {
  const r = (await A('GET', '/org-audit')).data;
  assert.ok(r.entries.some((e) => e.action === 'platform.update' && e.organization === 'Acme Global'));
  assert.ok((await A('GET', `/org-audit?organization_id=${wid}&q=member`)).data.entries.every((e) => /member/.test(e.action)));
  assert.ok((await A('GET', '/audit')).data.entries.some((e) => e.action === 'org.update'));
});
test('reports download as CSV', async () => {
  const r = await s.call('GET', '/api/admin/orgs/export.csv', null, boss.token);
  assert.equal(r.status, 200); assert.match(r.buf.toString(), /Acme Global/);
  const m = await s.call('GET', `/api/admin/orgs/${wid}/members.csv`, null, boss.token);
  assert.match(m.buf.toString(), /owner/i);
  assert.equal((await s.call('GET', '/api/admin/org-usage/export.csv', null, boss.token)).status, 200);
});
test('create an organization for a person, then delete it and projects return home', async () => {
  const u = await s.user('Founder'); const pr = await s.project(u.token, 'Mine');
  const c = await A('POST', '/orgs', { name: 'Beta Co', owner_id: u.id, seats: 3 });
  assert.equal(c.status, 200);
  await A('POST', `/projects/${pr.id}/organization`, { organization_id: c.data.id });
  assert.equal((await A('DELETE', `/orgs/${c.data.id}?confirm=wrong`)).status, 400);
  const d = await A('DELETE', `/orgs/${c.data.id}?confirm=beta co`);
  assert.equal(d.status, 200); assert.equal(d.data.projects_returned, 1);
  assert.equal((await A('GET', '/orgs/' + c.data.id)).status, 404);
  const row = (await s.app.db.query('SELECT workspace_id FROM projects WHERE id = $1', [pr.id])).rows[0];
  assert.ok(row.workspace_id);
});
test('non super admins are refused', async () => {
  for (const [m, p] of [['GET', '/api/admin/orgs'], ['GET', '/api/admin/orgs/' + wid], ['DELETE', `/api/admin/orgs/${wid}?confirm=x`]]) assert.equal((await s.call(m, p, null, owner.token)).status, 403);
});
