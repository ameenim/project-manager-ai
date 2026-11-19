'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let s, owner, stranger;
const OWNER = 'ameenim@gmail.com';

before(async () => {
  s = await start({ opsJobs: false });
  await s.app.ops.setConfig({ org_features: true }, null); await s.app.ops.config(true);
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Ameen', email: OWNER, password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  owner = { token: r.data.token, id: r.data.user.id };
  stranger = await s.user('Stranger');
  await s.app.ops.testbed.seed();
});
after(() => s.close());

test('the seed builds the organization, all roles for the owner and one account per role', async () => {
  const q = (t, p) => s.app.db.query(t, p);
  const w = (await q("SELECT id, settings FROM workspaces WHERE kind = 'business' AND owner_id = $1", [owner.id])).rows;
  assert.equal(w.length, 1);
  const wid = w[0].id;
  const roles = (await q('SELECT DISTINCT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wid, owner.id])).rows.map((r) => r.role).sort();
  assert.deepEqual(roles, ['admin', 'auditor', 'pmo_director', 'program_manager', 'project_manager', 'viewer']);
  const users = (await q("SELECT u.email, array_agg(m.role) AS roles FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email LIKE 'ameenim+%' GROUP BY u.email", [wid])).rows;
  assert.equal(users.length, 6);
  assert.ok(users.find((u) => u.email === 'ameenim+pmo@gmail.com').roles.includes('pmo_director'));
  assert.equal((await q('SELECT count(*) AS n FROM projects WHERE workspace_id = $1', [wid])).rows[0].n, 11);
  assert.equal((await q('SELECT price_cents FROM billing_accounts WHERE workspace_id = $1', [wid])).rows[0].price_cents, 0);
});
test('seeding again changes nothing', async () => {
  const q = (t, p) => s.app.db.query(t, p);
  const before = [(await q('SELECT count(*) AS n FROM users')).rows[0].n, (await q('SELECT count(*) AS n FROM workspace_members')).rows[0].n, (await q('SELECT count(*) AS n FROM projects')).rows[0].n];
  await s.app.ops.testbed.seed();
  const after = [(await q('SELECT count(*) AS n FROM users')).rows[0].n, (await q('SELECT count(*) AS n FROM workspace_members')).rows[0].n, (await q('SELECT count(*) AS n FROM projects')).rows[0].n];
  assert.deepEqual(after, before);
});
test('only the owner sees the switcher', async () => {
  assert.equal((await s.call('GET', '/api/testbed', null, owner.token)).data.available, true);
  assert.equal((await s.call('GET', '/api/testbed', null, stranger.token)).data.available, false);
  assert.equal((await s.call('POST', '/api/testbed/switch', { role: 'admin' }, stranger.token)).status, 403);
});
test('the owner switches to each role and back', async () => {
  const sw = async (role, tok, cookie) => { const r = await fetch(s.base + '/api/testbed/switch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ role }) }); return { status: r.status, data: await r.json(), cookies: r.headers.getSetCookie() }; };
  const a = await sw('viewer', owner.token);
  assert.equal(a.status, 200); assert.equal(a.data.user.email, 'ameenim+viewer@gmail.com');
  const sid = a.cookies.find((c) => /^pm_sid=/.test(c)).split(';')[0].replace('pm_sid=', '');
  const tb = a.cookies.find((c) => /^pm_tb=/.test(c)).split(';')[0];
  const me = await fetch(s.base + '/api/me', { headers: { cookie: `pm_sid=${sid}` } });
  assert.equal((await me.json()).user.email, 'ameenim+viewer@gmail.com');
  // the viewer account alone cannot switch
  assert.equal((await sw('admin', sid)).status, 403);
  // with the owner cookie it can move to another role and back
  const b = await fetch(s.base + '/api/testbed/switch', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `pm_sid=${sid}; ${tb}` , 'x-csrf-token': require('../server/security').csrfFor(sid), origin: s.base }, body: JSON.stringify({ role: 'auditor' }) });
  assert.equal(b.status, 200);
  const sid2 = b.headers.getSetCookie().find((c) => /^pm_sid=/.test(c)).split(';')[0].replace('pm_sid=', '');
  const back = await fetch(s.base + '/api/testbed/switch', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `pm_sid=${sid2}; ${tb}`, 'x-csrf-token': require('../server/security').csrfFor(sid2), origin: s.base }, body: JSON.stringify({ role: 'owner' }) });
  assert.equal(back.status, 200); assert.equal((await back.json()).user.email, OWNER);
});
test('each role sees what it should', async () => {
  const q = (t, p) => s.app.db.query(t, p);
  const wid = (await q("SELECT id FROM workspaces WHERE kind = 'business' AND owner_id = $1", [owner.id])).rows[0].id;
  const tok = async (role) => { const r = await fetch(s.base + '/api/testbed/switch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + owner.token }, body: JSON.stringify({ role }) }); return r.headers.getSetCookie().find((c) => /^pm_sid=/.test(c)).split(';')[0].replace('pm_sid=', ''); };
  assert.equal((await s.call('GET', '/api/projects', null, await tok('project_manager'))).data.projects.length, 11);
  const prog = (await q("SELECT id FROM structure_nodes WHERE workspace_id = $1 AND kind = 'program'", [wid])).rows[0].id;
  const dash = async (role) => (await s.call('GET', `/api/orgs/${wid}/programs/${prog}/dashboard`, null, await tok(role))).data.totals.projects;
  assert.equal(await dash('pmo_director'), 3);
  assert.equal(await dash('program_manager'), 3);
  assert.equal(await dash('viewer'), 3);
  const audit = await s.call('GET', `/api/orgs/${wid}/audit`, null, await tok('auditor'));
  assert.equal(audit.status, 200);
  assert.equal((await s.call('GET', `/api/orgs/${wid}/audit`, null, await tok('viewer'))).status, 403);
});
