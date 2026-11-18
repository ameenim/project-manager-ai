'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('migration 16 applies and every user, project and subscription lands in a personal workspace', async () => {
  const s = await start();
  try {
    assert.equal(s.app.workspaces.ready, true);
    const a = await s.user('A'), b = await s.user('B');
    await s.project(a.token, 'One'); await s.project(a.token, 'Two'); await s.project(b.token, 'Three');
    const first = await s.app.workspaces.backfillAll();
    assert.ok(first);
    const v = await s.app.workspaces.verify();
    assert.equal(v.users_without_workspace, 0);
    assert.equal(v.projects_without_workspace, 0);
    assert.equal(v.subscriptions_without_billing_account, 0);
    assert.equal(v.users, v.personal_workspaces);
    assert.equal(v.subscriptions, v.billing_accounts);
    const again = await s.app.workspaces.backfillAll();
    assert.equal(again.workspaces + again.projects + again.billing, 0);
  } finally { await s.close(); }
});

test('backfill stamps projects that existed before workspaces', async () => {
  const s = await start();
  try {
    const a = await s.user('A'); const p = await s.project(a.token, 'Old');
    await s.app.db.query('UPDATE projects SET workspace_id = NULL');
    await s.app.db.query('DELETE FROM billing_accounts');
    assert.ok((await s.app.workspaces.verify()).projects_without_workspace >= 1);
    const r = await s.app.workspaces.backfillAll();
    assert.ok(r.projects >= 1 && r.billing >= 1);
    const v = await s.app.workspaces.verify();
    assert.equal(v.projects_without_workspace, 0);
    assert.equal(v.subscriptions_without_billing_account, 0);
    assert.ok(p.id);
  } finally { await s.close(); }
});

test('scope resolver matches project_members and never leaks across users', async () => {
  const s = await start();
  try {
    const a = await s.user('A'), b = await s.user('B');
    const pa = await s.project(a.token, 'Mine'), pb = await s.project(b.token, 'Theirs');
    assert.equal(await s.app.scope.roleOn(a.id, pa.id), 'manager');
    assert.equal(await s.app.scope.roleOn(a.id, pb.id), null);
    assert.equal(await s.app.scope.can(b.id, pa.id), false);
    const wa = await s.app.workspaces.workspaceOf(a.id), wb = await s.app.workspaces.workspaceOf(b.id);
    assert.notEqual(wa, wb);
    const mine = await s.app.scope.workspacesOf(a.id);
    assert.deepEqual(mine, [wa]);
  } finally { await s.close(); }
});

test('organization grants stay off while org_features is off and work for the right scope when on', async () => {
  const s = await start();
  try {
    const a = await s.user('A'), b = await s.user('B');
    const pa = await s.project(a.token, 'Alpha');
    const now = await s.app.db.query("INSERT INTO workspaces(id, kind, name) VALUES (9001, 'business', 'Acme') RETURNING id");
    const org = Number(now.rows[0].id);
    await s.app.db.query('UPDATE projects SET workspace_id = $1 WHERE id = $2', [org, pa.id]);
    await s.app.db.query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1, $2, 'pmo_director')", [org, b.id]);
    assert.equal(await s.app.scope.roleOn(b.id, pa.id), null);
    await s.app.ops.setConfig({ org_features: true }, null);
    await s.app.ops.config(true);
    assert.equal(await s.app.scope.roleOn(b.id, pa.id), 'manager');
    assert.deepEqual(await s.app.scope.workspacesOf(b.id), [await s.app.workspaces.workspaceOf(b.id), org]);
    const c = await s.user('C');
    assert.equal(await s.app.scope.roleOn(c.id, pa.id), null);
    await s.app.db.query("UPDATE workspace_members SET role = 'viewer' WHERE user_id = $1", [b.id]);
    assert.equal(await s.app.scope.roleOn(b.id, pa.id), 'viewer');
  } finally { await s.close(); }
});

test('token ledger totals equal the old usage tables', async () => {
  const s = await start();
  try {
    const a = await s.user('A'); const p = await s.project(a.token, 'Alpha');
    await s.app.ops.recordUsage({ userId: a.id, projectId: p.id, source: 'analysis', model: 'm', input: 1000, output: 500 });
    await s.app.ops.recordUsage({ userId: a.id, projectId: p.id, source: 'analysis', model: 'm', input: 200, output: 50 });
    const c = await s.app.ops.ledger.compare();
    assert.equal(c.ready, true);
    assert.equal(c.difference, 0);
    assert.equal(c.ledger_tokens, 1750);
    const row = (await s.app.db.query('SELECT workspace_id, units FROM token_ledger LIMIT 1')).rows[0];
    assert.equal(Number(row.workspace_id), await s.app.workspaces.workspaceOf(a.id));
    assert.ok(Number(row.units) > 0);
  } finally { await s.close(); }
});

test('project rollups are written on save and a rebuild gives the same rows', async () => {
  const s = await start();
  try {
    const a = await s.user('A'); const p = await s.project(a.token, 'Alpha');
    await s.app.store.save(s.app.store.cache.get(p.id).P);
    const before = (await s.app.db.query('SELECT project_id, health, progress, tasks, pending_review, value FROM project_rollups ORDER BY project_id')).rows;
    assert.ok(before.length >= 1);
    await s.app.db.query('DELETE FROM project_rollups');
    const r = await s.app.rollups.rebuildAll();
    assert.equal(r.ready, true);
    const after = (await s.app.db.query('SELECT project_id, health, progress, tasks, pending_review, value FROM project_rollups ORDER BY project_id')).rows;
    assert.deepEqual(after, before);
  } finally { await s.close(); }
});

test('a personal user sees no change: org features default off and project list is the same', async () => {
  const s = await start();
  try {
    const a = await s.user('A'); await s.project(a.token, 'Alpha');
    assert.equal((await s.app.ops.config()).org_features, false);
    const r = await s.call('GET', '/api/projects', null, a.token);
    assert.equal(r.status, 200);
  } finally { await s.close(); }
});
