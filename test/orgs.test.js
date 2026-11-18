'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const mailer = require('../server/mailer');

async function on(s) { await s.app.ops.setConfig({ org_features: true }, null); await s.app.ops.config(true); }
const J = (s, m, p, b, t) => s.call(m, p, b, t);

test('organization routes are hidden while org_features is off', async () => {
  const s = await start();
  try {
    const a = await s.user('A');
    assert.equal((await J(s, 'GET', '/api/orgs', null, a.token)).status, 404);
    assert.equal((await J(s, 'POST', '/api/orgs/convert', { name: 'X' }, a.token)).status, 404);
  } finally { await s.close(); }
});

test('convert my workspace keeps every project and makes the person Admin and Project Manager', async () => {
  const s = await start(); await on(s);
  try {
    const a = await s.user('A');
    const p1 = await s.project(a.token, 'One'), p2 = await s.project(a.token, 'Two');
    const before = (await J(s, 'GET', '/api/projects', null, a.token)).data;
    const r = await J(s, 'POST', '/api/orgs/convert', { name: 'Acme' }, a.token);
    assert.equal(r.status, 200);
    const wid = r.data.id;
    const rows = (await s.app.db.query('SELECT workspace_id FROM projects WHERE id = ANY($1::bigint[])', [[p1.id, p2.id]])).rows;
    assert.ok(rows.every((x) => Number(x.workspace_id) === Number(wid)));
    const o = (await J(s, 'GET', '/api/orgs/' + wid, null, a.token)).data;
    assert.ok(o.roles.includes('admin') && o.roles.includes('project_manager'));
    assert.equal(o.seats, 5); assert.equal(o.seats_used, 1);
    assert.ok(o.pool.total > 0);
    const after = (await J(s, 'GET', '/api/projects', null, a.token)).data;
    assert.equal(JSON.stringify(after).length > 10, true);
    assert.equal((before.projects || before).length, (after.projects || after).length);
    // a new empty personal workspace exists beside the organization
    const list = (await J(s, 'GET', '/api/orgs', null, a.token)).data.organizations;
    assert.equal(list.filter((x) => x.personal).length, 1);
    assert.equal(list.filter((x) => !x.personal).length, 1);
    const ev = o.events.map((e) => e.kind); assert.ok(ev.includes('converted'));
    // converting again has no personal workspace with a plan to convert but still works on the fresh one
  } finally { await s.close(); }
});

test('invite, accept, seats and roles with isolation between organizations', async () => {
  const s = await start(); await on(s);
  const sent = []; mailer.api.transport = async (m) => { sent.push(m); return { sent: true }; };
  try {
    const a = await s.user('A'), b = await s.user('B'), c = await s.user('C'), d = await s.user('D');
    const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, a.token)).data.id;
    const other = (await J(s, 'POST', '/api/orgs', { name: 'Other' }, d.token)).data.id;
    // a non member cannot read or change
    assert.equal((await J(s, 'GET', '/api/orgs/' + org, null, d.token)).status, 403);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: 'x@y.co', role: 'viewer' }, d.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/members`, null, d.token)).status, 403);
    // invite B as Project Manager
    const bemail = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [b.id])).rows[0].email;
    const inv = await J(s, 'POST', `/api/orgs/${org}/invites`, { email: bemail, role: 'project_manager' }, a.token);
    assert.equal(inv.status, 200); assert.equal(sent.length, 1);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: bemail, role: 'project_manager' }, a.token)).status, 409);
    const mine = (await J(s, 'GET', '/api/orgs', null, b.token)).data.invites;
    assert.equal(mine.length, 1);
    // someone else cannot accept it
    assert.equal((await J(s, 'POST', `/api/orgs/invites/${mine[0].id}/accept`, {}, c.token)).status, 404);
    assert.equal((await J(s, 'POST', `/api/orgs/invites/${mine[0].id}/accept`, {}, b.token)).status, 200);
    // B is not an Admin
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: 'z@y.co', role: 'viewer' }, b.token)).status, 403);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 9 }, b.token)).status, 403);
    // seats: 5 bought, 2 used
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 1 }, a.token)).status, 409);
    await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 2 }, a.token);
    const cemail = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [c.id])).rows[0].email;
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: cemail, role: 'project_manager' }, a.token)).status, 409);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: cemail, role: 'viewer' }, a.token)).status, 200); // viewers use no seat
    // cannot demote the last admin
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/members/${a.id}`, { role: 'viewer' }, a.token)).status, 409);
    assert.equal((await J(s, 'DELETE', `/api/orgs/${org}/members/${a.id}`, null, a.token)).status, 409);
    // the other organization is untouched
    assert.equal((await J(s, 'GET', '/api/orgs/' + other, null, d.token)).status, 200);
    assert.equal((await J(s, 'GET', `/api/orgs/${other}/members`, null, a.token)).status, 403);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('a manager who leaves: active projects go to the handover queue, closed ones are archived', async () => {
  const s = await start(); await on(s);
  mailer.api.transport = async () => ({ sent: true });
  try {
    const a = await s.user('A'), b = await s.user('B'), c = await s.user('C');
    const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, a.token)).data.id;
    for (const u of [b, c]) {
      const em = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [u.id])).rows[0].email;
      await J(s, 'POST', `/api/orgs/${org}/invites`, { email: em, role: 'project_manager' }, a.token);
      const iv = (await J(s, 'GET', '/api/orgs', null, u.token)).data.invites[0];
      await J(s, 'POST', `/api/orgs/invites/${iv.id}/accept`, {}, u.token);
    }
    const live = await s.project(b.token, 'Live'), done = await s.project(b.token, 'Done');
    assert.equal((await J(s, 'POST', `/api/projects/${live.id}/move`, { organization_id: org }, b.token)).status, 200);
    assert.equal((await J(s, 'POST', `/api/projects/${done.id}/move`, { organization_id: org }, b.token)).status, 200);
    await s.app.db.query("UPDATE projects SET data = jsonb_set(data, '{p,status}', '\"closed\"') WHERE id = $1", [done.id]);
    s.app.store.cache.delete(Number(done.id));
    const out = (await J(s, 'DELETE', `/api/orgs/${org}/members/${b.id}`, null, a.token)).data;
    assert.deepEqual(out, { handover: 1, archived: 1 });
    // B lost access
    assert.equal((await J(s, 'GET', `/api/projects/${live.id}`, null, b.token)).status === 200, false);
    const q = (await J(s, 'GET', `/api/orgs/${org}/handovers`, null, a.token)).data.handovers;
    assert.equal(q.length, 1);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/handovers`, null, c.token)).status, 403);
    // only an active Project Manager of the organization can receive it
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/handovers/${q[0].id}/transfer`, { user_id: b.id }, a.token)).status, 400);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/handovers/${q[0].id}/transfer`, { user_id: c.id }, a.token)).status, 200);
    assert.equal((await s.app.scope.roleOn(c.id, live.id)), 'manager');
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/handovers`, null, a.token)).data.handovers.length, 0);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('pooled tokens: org projects draw on the pool and stop at the limit', async () => {
  const s = await start(); await on(s);
  try {
    await s.app.ops.setConfig({ enforce_limits: true }, null); await s.app.ops.config(true);
    const a = await s.user('A');
    const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, a.token)).data.id;
    const p = await s.project(a.token, 'Alpha');
    await J(s, 'POST', `/api/projects/${p.id}/move`, { organization_id: org }, a.token);
    const user = { id: a.id, is_super: false };
    assert.equal(await s.app.ops.allowance(user, p.id), null);
    await s.app.ops.recordUsage({ userId: a.id, projectId: p.id, source: 'analysis', model: 'm', input: 1000000, output: 100000 });
    const o = (await J(s, 'GET', '/api/orgs/' + org, null, a.token)).data;
    assert.ok(o.pool.used > 0);
    assert.equal(o.by_member.length, 1);
    // shrink the pool below what is used, the project is blocked and a personal call is not
    await s.app.db.query('UPDATE token_wallets SET units_included = 1 WHERE workspace_id = $1', [org]);
    assert.match(await s.app.ops.allowance(user, p.id), /organization has used all/);
    // capped overage keeps it open up to the cap
    await J(s, 'PUT', `/api/orgs/${org}/overage`, { policy: 'capped', cap_units: 1000000 }, a.token);
    assert.equal(await s.app.ops.allowance(user, p.id), null);
    await J(s, 'PUT', `/api/orgs/${org}/overage`, { policy: 'stop' }, a.token);
    assert.ok(await s.app.ops.allowance(user, p.id));
  } finally { await s.close(); }
});

test('proration and seat accounting', async () => {
  const { Orgs } = require('../server/orgs');
  assert.equal(Orgs.credit(3000, new Date(Date.now() + 15 * 86400000).toISOString()), 1500);
  assert.equal(Orgs.credit(3000, new Date(Date.now() - 86400000).toISOString()), 0);
  assert.equal(Orgs.credit(3000, null), 0);
  const s = await start(); await on(s);
  try {
    const a = await s.user('A');
    const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, a.token)).data.id;
    const r = (await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 6 }, a.token)).data;
    assert.ok(r.prorated_cents > 0 && r.prorated_cents <= 4900);
    const down = (await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 5 }, a.token)).data;
    assert.ok(down.prorated_cents < 0);
  } finally { await s.close(); }
});
