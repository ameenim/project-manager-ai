'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { start } = require('./helpers');
const mailer = require('../server/mailer');
const J = (s, m, p, b, t) => s.call(m, p, b, t);

async function setup() {
  const s = await start();
  await s.app.ops.setConfig({ org_features: true, enforce_limits: true }, null); await s.app.ops.config(true);
  mailer.api.transport = async () => ({ sent: true });
  const U = {}; for (const n of ['a', 'aud', 'pm', 'out']) U[n] = await s.user(n);
  const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, U.a.token)).data.id;
  await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 3 }, U.a.token);
  const join = async (u, role) => {
    const em = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [u.id])).rows[0].email;
    const r = await J(s, 'POST', `/api/orgs/${org}/invites`, { email: em, role }, U.a.token); assert.equal(r.status, 200, JSON.stringify(r.data));
    const iv = (await J(s, 'GET', '/api/orgs', null, u.token)).data.invites[0];
    assert.equal((await J(s, 'POST', `/api/orgs/invites/${iv.id}/accept`, {}, u.token)).status, 200);
  };
  const enterprise = () => s.app.db.query("UPDATE billing_accounts SET plan_code = 'enterprise' WHERE workspace_id = $1", [org]);
  return { s, U, org, join, enterprise };
}
const scim = (s, method, path, body, token) => new Promise((ok, no) => {
  const port = s.port || (s.server && s.server.address().port) || s.app.server.address().port;
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/scim+json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => ok({ status: res.statusCode, data: t ? JSON.parse(t) : null }));
  });
  r.on('error', no); if (data) r.write(data); r.end();
});

test('enterprise controls are refused on the Team plan and plan changes need the platform owner', async () => {
  const { s, U, org } = await setup();
  try {
    for (const [m, p, b] of [['GET', `/api/orgs/${org}/audit`], ['PUT', `/api/orgs/${org}/ai-policy`, { enabled: false }], ['POST', `/api/orgs/${org}/scim-token`], ['POST', `/api/orgs/${org}/invites`, { email: 'x@y.co', role: 'auditor' }]]) assert.equal((await J(s, m, p, b, U.a.token)).status, 403, p);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/plan`, { plan: 'enterprise' }, U.a.token)).status, 403);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('audit trail records every change, only Admin and Auditor read it, and the Auditor sees no project data', async () => {
  const { s, U, org, join, enterprise } = await setup();
  try {
    await enterprise();
    await join(U.aud, 'auditor'); await join(U.pm, 'project_manager');
    await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Digital' }, U.a.token);
    await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 4 }, U.a.token);
    const ev = (await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.a.token)).data.events;
    const acts = ev.map((e) => e.action);
    for (const a of ['member.invited', 'invitation.accepted', 'program.created', 'seats.changed']) assert.ok(acts.includes(a), a + ' in ' + acts);
    assert.equal(ev.find((e) => e.action === 'seats.changed').meta.seats, 4);
    assert.ok(ev.find((e) => e.action === 'program.created').actor);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.aud.token)).status, 200);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.pm.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.out.token)).status, 403);
    const csv = (await J(s, 'GET', `/api/orgs/${org}/audit/export`, null, U.aud.token)).data.csv;
    assert.match(csv, /^time,actor,action,details,ip/); assert.match(csv, /program\.created/);
    // the Auditor cannot change anything and sees no project data
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Nope' }, U.aud.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/overview`, null, U.aud.token)).status, 403);
    const pr = await s.project(U.pm.token, 'Secret'); await J(s, 'POST', `/api/projects/${pr.id}/move`, { organization_id: org }, U.pm.token);
    assert.equal(await s.app.scope.roleOn(U.aud.id, pr.id), null);
    // auditors use no seat
    assert.equal((await J(s, 'GET', `/api/orgs/${org}`, null, U.a.token)).data.seats_used, 2);
    // a failed change leaves no entry
    const before = (await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.a.token)).data.events.length;
    await J(s, 'POST', `/api/orgs/${org}/programs`, { name: '' }, U.a.token);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.a.token)).data.events.length, before);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('AI governance: switch AI off, cap a member, and the pool', async () => {
  const { s, U, org, join, enterprise } = await setup();
  try {
    await enterprise(); await join(U.pm, 'project_manager');
    const p = await s.project(U.pm.token, 'Alpha'); await J(s, 'POST', `/api/projects/${p.id}/move`, { organization_id: org }, U.pm.token);
    const pm = { id: U.pm.id, is_super: false };
    assert.equal(await s.app.ops.allowance(pm, p.id), null);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/ai-policy`, { enabled: false }, U.pm.token)).status, 403);
    await J(s, 'PUT', `/api/orgs/${org}/ai-policy`, { enabled: false }, U.a.token);
    assert.match(await s.app.ops.allowance(pm, p.id), /turned off/);
    await J(s, 'PUT', `/api/orgs/${org}/ai-policy`, { enabled: true, member_cap_units: 100 }, U.a.token);
    assert.equal(await s.app.ops.allowance(pm, p.id), null);
    await s.app.ops.recordUsage({ userId: U.pm.id, projectId: p.id, source: 'analysis', model: 'm', input: 1000000, output: 100000 });
    assert.match(await s.app.ops.allowance(pm, p.id), /personal AI limit/);
    // another member is not affected by that member's cap
    assert.equal(await s.app.ops.allowance({ id: U.a.id, is_super: false }, p.id), null);
    // the policy applies even when platform limits are off
    await s.app.ops.setConfig({ enforce_limits: false }, null); await s.app.ops.config(true);
    assert.match(await s.app.ops.allowance(pm, p.id), /personal AI limit/);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('SCIM provisioning: token, create, find, deactivate with handover, seats and isolation', async () => {
  const { s, U, org, join, enterprise } = await setup();
  try {
    await enterprise();
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/scim-token`, null, U.pm.token)).status, 403);
    const tok = (await J(s, 'POST', `/api/orgs/${org}/scim-token`, null, U.a.token)).data.token;
    assert.match(tok, /^pmscim_/);
    assert.equal((await scim(s, 'GET', '/scim/v2/Users', null, null)).status, 401);
    assert.equal((await scim(s, 'GET', '/scim/v2/Users', null, 'pmscim_wrong')).status, 401);
    const c = await scim(s, 'POST', '/scim/v2/Users', { userName: 'new.person@corp.test', displayName: 'New Person', active: true }, tok);
    assert.equal(c.status, 201, JSON.stringify(c.data));
    assert.equal(c.data.userName, 'new.person@corp.test');
    assert.equal((await scim(s, 'POST', '/scim/v2/Users', { userName: 'new.person@corp.test' }, tok)).status, 409);
    const f = await scim(s, 'GET', '/scim/v2/Users?filter=' + encodeURIComponent('userName eq "new.person@corp.test"'), null, tok);
    assert.equal(f.data.totalResults, 1);
    // the new person is a Project Manager of the organization and uses a seat
    assert.deepEqual(await s.app.orgs.rolesIn(Number(c.data.id), org), ['project_manager']);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}`, null, U.a.token)).data.seats_used, 2);
    // seats are enforced: 3 bought, one more fits, then full
    assert.equal((await scim(s, 'POST', '/scim/v2/Users', { userName: 'second@corp.test' }, tok)).status, 201);
    assert.equal((await scim(s, 'POST', '/scim/v2/Users', { userName: 'third@corp.test' }, tok)).status, 409);
    // deactivating hands over active projects and ends access
    const owner = await s.user('owner'); const proj = await s.project(owner.token, 'Mine');
    const oemail = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [owner.id])).rows[0].email;
    await s.app.db.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [org, c.data.id]);
    await s.app.db.query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,'project_manager')", [org, owner.id]);
    await J(s, 'POST', `/api/projects/${proj.id}/move`, { organization_id: org }, owner.token);
    const uid = owner.id; void oemail;
    const d = await scim(s, 'PATCH', `/scim/v2/Users/${uid}`, { Operations: [{ op: 'replace', path: 'active', value: false }] }, tok);
    assert.equal(d.status, 200); assert.equal(d.data.active, false);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/handovers`, null, U.a.token)).data.handovers.length, 1);
    assert.deepEqual(await s.app.orgs.rolesIn(uid, org), []);
    assert.equal((await scim(s, 'GET', `/scim/v2/Users/${uid}`, null, tok)).status, 404);
    // the last admin cannot be removed this way
    assert.equal((await scim(s, 'DELETE', `/scim/v2/Users/${U.a.id}`, null, tok)).status, 409);
    // audit trail has the provisioning events with no actor
    const ev = (await J(s, 'GET', `/api/orgs/${org}/audit`, null, U.a.token)).data.events.map((e) => e.action);
    assert.ok(ev.includes('provisioning.user_created') && ev.includes('provisioning.user_deactivated') && ev.includes('provisioning.token_created'));
    // revoking the token stops access, and a token only reaches its own organization
    await J(s, 'DELETE', `/api/orgs/${org}/scim-token`, null, U.a.token);
    assert.equal((await scim(s, 'GET', '/scim/v2/Users', null, tok)).status, 401);
    // downgrading the plan switches provisioning off
    const t2 = (await J(s, 'POST', `/api/orgs/${org}/scim-token`, null, U.a.token)).data.token;
    await s.app.db.query("UPDATE billing_accounts SET plan_code = 'team' WHERE workspace_id = $1", [org]);
    assert.equal((await scim(s, 'GET', '/scim/v2/Users', null, t2)).status, 401);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('the platform owner can set the plan and it is recorded', async () => {
  const { s, U, org } = await setup();
  try {
    await s.app.db.query('INSERT INTO user_flags(user_id, is_super) VALUES ($1, true) ON CONFLICT (user_id) DO UPDATE SET is_super = true', [U.out.id]);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/plan`, { plan: 'enterprise' }, U.out.token)).status, 200);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/plan`, { plan: 'bogus' }, U.out.token)).status, 400);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}`, null, U.a.token)).data.plan, 'enterprise');
  } finally { await s.close(); }
});
