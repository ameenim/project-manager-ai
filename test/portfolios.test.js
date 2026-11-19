'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const mailer = require('../server/mailer');
const J = (s, m, p, b, t) => s.call(m, p, b, t);

async function setup() {
  const s = await start();
  await s.app.ops.setConfig({ org_features: true }, null); await s.app.ops.config(true);
  mailer.api.transport = async () => ({ sent: true });
  const U = {}; for (const n of ['a', 'pmo', 'prog', 'pm', 'vOrg', 'vPort', 'out']) U[n] = await s.user(n);
  const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, U.a.token)).data.id;
  await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 20 }, U.a.token);
  const join = async (u, body) => {
    const em = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [u.id])).rows[0].email;
    const r = await J(s, 'POST', `/api/orgs/${org}/invites`, { email: em, ...body }, U.a.token); assert.equal(r.status, 200, JSON.stringify(r.data));
    const iv = (await J(s, 'GET', '/api/orgs', null, u.token)).data.invites[0];
    assert.equal((await J(s, 'POST', `/api/orgs/invites/${iv.id}/accept`, {}, u.token)).status, 200);
  };
  return { s, U, org, join };
}

test('portfolio and organization dashboards roll up programs and respect scope', async () => {
  const { s, U, org, join } = await setup();
  try {
    await join(U.pmo, { role: 'pmo_director' }); await join(U.pm, { role: 'project_manager' }); await join(U.vOrg, { role: 'viewer' });
    const f1 = (await J(s, 'POST', `/api/orgs/${org}/portfolios`, { name: 'Government' }, U.a.token)).data.id;
    const f2 = (await J(s, 'POST', `/api/orgs/${org}/portfolios`, { name: 'Private' }, U.pmo.token)).data.id;
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/portfolios`, { name: 'x' }, U.pm.token)).status, 403);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/portfolios`, { name: 'government' }, U.a.token)).status, 409);
    const g1 = (await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Digital' }, U.a.token)).data.id;
    const g2 = (await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Field' }, U.a.token)).data.id;
    const g3 = (await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Loose' }, U.a.token)).data.id;
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/programs/${g1}/portfolio`, { portfolio_id: f1 }, U.pm.token)).status, 403);
    await J(s, 'PUT', `/api/orgs/${org}/programs/${g1}/portfolio`, { portfolio_id: f1 }, U.pmo.token);
    await J(s, 'PUT', `/api/orgs/${org}/programs/${g2}/portfolio`, { portfolio_id: f2 }, U.pmo.token);
    // a Viewer scoped to the first portfolio only
    await join(U.vPort, { role: 'viewer', portfolio_id: f1 });
    const mk = async (name, prog) => { const p = await s.project(U.pm.token, name); await J(s, 'POST', `/api/projects/${p.id}/move`, { organization_id: org }, U.pm.token); if (prog) await J(s, 'PUT', `/api/orgs/${org}/projects/${p.id}/program`, { program_id: prog }, U.pmo.token); return p; };
    const a1 = await mk('A1', g1), a2 = await mk('A2', g1), b1 = await mk('B1', g2), c1 = await mk('C1', g3), d1 = await mk('D1', null);
    for (const p of [a1, a2, b1, c1, d1]) await s.app.store.save(s.app.store.cache.get(p.id).P);
    const d = (await J(s, 'GET', `/api/orgs/${org}/portfolios/${f1}/dashboard`, null, U.pmo.token)).data;
    assert.equal(d.totals.projects, 2); assert.equal(d.programs.length, 1); assert.equal(d.programs[0].totals.projects, 2);
    assert.deepEqual(d.projects.map((p) => p.name).sort(), ['A1', 'A2']);
    const o = (await J(s, 'GET', `/api/orgs/${org}/overview`, null, U.pmo.token)).data;
    assert.equal(o.totals.projects, 5);
    assert.equal(o.portfolios.find((p) => p.id === f1).totals.projects, 2);
    assert.equal(o.portfolios.find((p) => p.id === f2).totals.projects, 1);
    assert.equal(o.programs.length, 1); assert.equal(o.programs[0].totals.projects, 1);
    assert.equal(o.unplaced.totals.projects, 1); assert.equal(o.unplaced.projects[0].name, 'D1');
    // scope
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/overview`, null, U.vOrg.token)).data.totals.projects, 5);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/overview`, null, U.vPort.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/portfolios/${f1}/dashboard`, null, U.vPort.token)).data.totals.projects, 2);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/portfolios/${f2}/dashboard`, null, U.vPort.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${g1}/dashboard`, null, U.vPort.token)).data.totals.projects, 2);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${g2}/dashboard`, null, U.vPort.token)).status, 403);
    assert.deepEqual((await J(s, 'GET', `/api/orgs/${org}/portfolios`, null, U.vPort.token)).data.portfolios.map((p) => p.id), [f1]);
    assert.equal(await s.app.scope.roleOn(U.vPort.id, a1.id), 'viewer');
    assert.equal(await s.app.scope.roleOn(U.vPort.id, b1.id), null);
    for (const u of [U.pm, U.out]) { assert.equal((await J(s, 'GET', `/api/orgs/${org}/overview`, null, u.token)).status, 403); assert.equal((await J(s, 'GET', `/api/orgs/${org}/portfolios/${f1}/dashboard`, null, u.token)).status, 403); }
    // the Admin sees counts only
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/overview`, null, U.a.token)).data.restricted, true);
    const adm = (await J(s, 'GET', `/api/orgs/${org}/portfolios/${f1}/dashboard`, null, U.a.token)).data;
    assert.equal(adm.restricted, true); assert.equal(adm.project_count, 2);
    // closing a portfolio keeps programs and projects, and drops the scoped Viewer
    assert.equal((await J(s, 'DELETE', `/api/orgs/${org}/portfolios/${f1}`, null, U.pmo.token)).status, 200);
    const left = (await J(s, 'GET', `/api/orgs/${org}/overview`, null, U.pmo.token)).data;
    assert.equal(left.totals.projects, 5); assert.equal(left.programs.length, 2);
    assert.equal(await s.app.scope.roleOn(U.vPort.id, a1.id), null);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('portfolio routes are hidden while org_features is off', async () => {
  const s = await start();
  try { const a = await s.user('A'); assert.equal((await J(s, 'GET', '/api/orgs/1/overview', null, a.token)).status, 404); } finally { await s.close(); }
});
