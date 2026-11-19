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
  const a = await s.user('Admin'), pmo = await s.user('Pmo'), prog = await s.user('Prog'), pm = await s.user('Pm'), view = await s.user('View'), out = await s.user('Out');
  const org = (await J(s, 'POST', '/api/orgs', { name: 'Acme' }, a.token)).data.id;
  await J(s, 'PUT', `/api/orgs/${org}/seats`, { seats: 10 }, a.token);
  const join = async (u, role, program_id) => {
    const em = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [u.id])).rows[0].email;
    const r = await J(s, 'POST', `/api/orgs/${org}/invites`, { email: em, role, program_id }, a.token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const iv = (await J(s, 'GET', '/api/orgs', null, u.token)).data.invites[0];
    assert.equal((await J(s, 'POST', `/api/orgs/invites/${iv.id}/accept`, {}, u.token)).status, 200);
  };
  return { s, a, pmo, prog, pm, view, out, org, join };
}

test('structure: only Admin or PMO Director change it, Program Manager invites need a real program', async () => {
  const { s, a, pmo, prog, pm, org, join } = await setup();
  try {
    await join(pmo, 'pmo_director'); await join(pm, 'project_manager');
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Digital' }, pm.token)).status, 403);
    const p1 = (await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Digital' }, a.token)).data.id;
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'digital' }, pmo.token)).status, 409);
    const em = (await s.app.db.query('SELECT email FROM users WHERE id = $1', [prog.id])).rows[0].email;
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: em, role: 'program_manager' }, a.token)).status, 400);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/invites`, { email: em, role: 'program_manager', program_id: 999 }, a.token)).status, 400);
    await join(prog, 'program_manager', p1);
    const seen = (await J(s, 'GET', `/api/orgs/${org}/programs`, null, prog.token)).data.programs;
    assert.deepEqual(seen.map((x) => x.id), [p1]);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/programs/${p1}`, { name: 'Digital 2' }, prog.token)).status, 403);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/programs/${p1}`, { name: 'Digital 2' }, pmo.token)).status, 200);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('program dashboard rolls up its projects and respects scope', async () => {
  const { s, a, pmo, prog, pm, view, out, org, join } = await setup();
  try {
    await join(pmo, 'pmo_director'); await join(pm, 'project_manager'); await join(view, 'viewer'); 
    const p1 = (await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Digital' }, a.token)).data.id;
    const p2 = (await J(s, 'POST', `/api/orgs/${org}/programs`, { name: 'Field' }, a.token)).data.id;
    await join(prog, 'program_manager', p1);
    const x = await s.project(pm.token, 'Alpha'), y = await s.project(pm.token, 'Beta'), z = await s.project(pm.token, 'Gamma');
    for (const p of [x, y, z]) assert.equal((await J(s, 'POST', `/api/projects/${p.id}/move`, { organization_id: org }, pm.token)).status, 200);
    // a Project Manager cannot place projects in programs, the PMO Director can
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/projects/${x.id}/program`, { program_id: p1 }, pm.token)).status, 403);
    for (const p of [x, y]) assert.equal((await J(s, 'PUT', `/api/orgs/${org}/projects/${p.id}/program`, { program_id: p1 }, pmo.token)).status, 200);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/projects/${z.id}/program`, { program_id: p2 }, pmo.token)).status, 200);
    // a Program Manager can only act in their own program
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/projects/${y.id}/program`, { program_id: p2 }, prog.token)).status, 403);
    assert.equal((await J(s, 'PUT', `/api/orgs/${org}/projects/${z.id}/program`, { program_id: p1 }, prog.token)).status, 403);
    await J(s, 'PUT', `/api/orgs/${org}/projects/${y.id}/program`, { program_id: p1 }, pmo.token);
    for (const p of [x, y, z]) await s.app.store.save(s.app.store.cache.get(p.id) ? s.app.store.cache.get(p.id).P : (await s.app.store.forUser(pm.id)).find((q) => q.p.id === p.id));
    const d = (await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, prog.token)).data;
    assert.equal(d.restricted, false); assert.equal(d.totals.projects, 2);
    assert.deepEqual(d.projects.map((q) => q.name).sort(), ['Alpha', 'Beta']);
    const rows = (await s.app.db.query('SELECT count(*) AS n FROM project_rollups WHERE parent_id = $1', [p1])).rows[0];
    assert.equal(Number(rows.n), 2);
    // PMO Director sees the same numbers, the other program shows only Gamma
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, pmo.token)).data.totals.projects, 2);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p2}/dashboard`, null, pmo.token)).data.projects[0].name, 'Gamma');
    // isolation: a Program Manager of one program, a project manager, an outsider and a different org
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p2}/dashboard`, null, prog.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, pm.token)).status, 403);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, out.token)).status, 403);
    // org wide Viewer sees it, the Admin sees only that the projects exist
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, view.token)).data.totals.projects, 2);
    const adm = (await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, a.token)).data;
    assert.equal(adm.restricted, true); assert.equal(adm.project_count, 2); assert.equal(adm.totals, undefined);
    // the Program Manager reaches the program's projects through scope, and not the other program's
    assert.equal(await s.app.scope.roleOn(prog.id, x.id), 'manager');
    assert.equal(await s.app.scope.roleOn(prog.id, z.id), null);
    // grants: Admin gives themselves PMO Director and then sees numbers
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/members/${a.id}/grants`, { role: 'pmo_director' }, a.token)).status, 200);
    assert.equal((await J(s, 'GET', `/api/orgs/${org}/programs/${p1}/dashboard`, null, a.token)).data.restricted, false);
    assert.equal((await J(s, 'POST', `/api/orgs/${org}/members/${a.id}/grants`, { role: 'pmo_director' }, pm.token)).status, 403);
    // closing a program returns its projects to the organization level
    assert.equal((await J(s, 'DELETE', `/api/orgs/${org}/programs/${p1}`, null, pmo.token)).status, 200);
    assert.equal((await s.app.db.query('SELECT count(*) AS n FROM projects WHERE parent_id = $1', [p1])).rows[0].n, '0');
    assert.equal(await s.app.scope.roleOn(prog.id, x.id), null);
  } finally { mailer.api.transport = null; await s.close(); }
});

test('programs stay hidden while org_features is off', async () => {
  const s = await start();
  try {
    const a = await s.user('A');
    assert.equal((await J(s, 'GET', '/api/orgs/1/programs', null, a.token)).status, 404);
  } finally { await s.close(); }
});
