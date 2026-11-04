'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { start } = require('./helpers');
const { createApp } = require('../server/app');
let s; before(async () => { s = await start(); }); after(() => s.close());

const CONTRACT = 'Client: Ministry of Test\nContract value: AED 1,000,000\nStart date: 2027-03-01\nEnd date: 2027-09-30\nDeliverable 1: Design document due 2027-04-15\nPayment 1: 30% on signing';

test('a created project is saved and listed', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Alpha');
  assert.equal(p.role, 'manager'); assert.equal(p.can_delete, true);
  const list = await s.call('GET', '/api/projects', null, u.token);
  assert.deepEqual(list.data.projects.map((x) => x.name), ['Alpha']);
});
test('projects are private to their members', async () => {
  const a = await s.user(), b = await s.user();
  const p = await s.project(a.token, 'Secret');
  assert.equal((await s.call('GET', '/api/projects', null, b.token)).data.projects.length, 0);
  for (const [m, path] of [['GET', ''], ['GET', '/tasks'], ['GET', '/export'], ['DELETE', '']]) assert.equal((await s.call(m, `/api/projects/${p.id}${path}`, null, b.token)).status, 404, m + path);
});
test('only the manager can delete and a delete is permanent', async () => {
  const mgr = await s.user(), ed = await s.user(), vw = await s.user();
  const p = await s.project(mgr.token, 'Roles');
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: ed.email, role: 'editor' }, mgr.token)).status, 200);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token)).status, 200);
  assert.equal((await s.call('DELETE', `/api/projects/${p.id}`, null, ed.token)).status, 403);
  assert.equal((await s.call('DELETE', `/api/projects/${p.id}`, null, vw.token)).status, 403);
  assert.equal((await s.call('GET', '/api/projects', null, mgr.token)).data.projects.length, 1);
  assert.equal((await s.call('DELETE', `/api/projects/${p.id}`, null, mgr.token)).status, 200);
  assert.equal((await s.call('GET', '/api/projects', null, mgr.token)).data.projects.length, 0);
  assert.equal((await s.call('GET', '/api/projects', null, ed.token)).data.projects.length, 0);
});
test('editors edit, viewers only read', async () => {
  const mgr = await s.user(), ed = await s.user(), vw = await s.user();
  const p = await s.project(mgr.token, 'Edit rights');
  await s.call('POST', `/api/projects/${p.id}/members`, { email: ed.email, role: 'editor' }, mgr.token);
  await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token);
  const task = { name: 'Write plan', duration: 3 };
  assert.equal((await s.call('POST', `/api/projects/${p.id}/tasks`, task, vw.token)).status, 403);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/tasks`, task, ed.token)).status, 200);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/schedule`, null, vw.token)).data.tasks.length, 1);
  assert.equal((await s.call('PUT', `/api/projects/${p.id}`, { name: 'X' }, vw.token)).status, 403);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'editor' }, ed.token)).status, 403, 'editors cannot manage access');
  const view = await s.call('GET', `/api/projects/${p.id}`, null, vw.token);
  assert.equal(view.data.project.role, 'viewer'); assert.equal(view.data.project.can_edit, false);
});
test('member management guards', async () => {
  const mgr = await s.user(), other = await s.user();
  const p = await s.project(mgr.token, 'Members');
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: 'ghost@nowhere.co', role: 'editor' }, mgr.token)).status, 404);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: mgr.email, role: 'editor' }, mgr.token)).status, 409);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: other.email, role: 'superuser' }, mgr.token)).status >= 400, true);
  const last = await s.call('DELETE', `/api/projects/${p.id}/members/${mgr.id}`, null, mgr.token);
  assert.equal(last.status >= 400, true, 'the last manager cannot leave');
  assert.equal((await s.call('GET', `/api/projects/${p.id}`, null, mgr.token)).status, 200);
});
test('a document upload is analyzed in the background and ends in a finished state', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Analyze', CONTRACT);
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
  const docs = (await s.call('GET', `/api/projects/${p.id}/documents`, null, u.token)).data.documents;
  assert.equal(docs.length, 1);
  const file = await s.call('GET', `/api/projects/${p.id}/documents/${docs[0].id}/file`, null, u.token);
  assert.equal(file.status, 200); assert.equal(file.buf.toString(), CONTRACT, 'original file is kept');
  const ev = await s.call('GET', '/api/analysis/events?since=0', null, u.token);
  assert.ok(ev.data.events.some((e) => e.type === 'done'));
});
test('tasks keep dependencies and loops are refused', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Sched');
  const a = (await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'A', duration: 2, start: '2027-03-01' }, u.token)).data.created;
  const r = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'B', duration: 2, deps: [{ id: a, type: 'FS', lag: 0 }] }, u.token);
  const A = r.data.tasks.find((t) => t.name === 'A'), B = r.data.tasks.find((t) => t.name === 'B');
  assert.ok(B.start > A.start, 'B starts after A');
  const loop = await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [A.id]: { deps: [{ id: B.id, type: 'FS', lag: 0 }] } } }, u.token);
  assert.equal(loop.status >= 400, true, 'a dependency loop is refused');
  const move = await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [A.id]: { duration: 5 } } }, u.token);
  assert.equal(move.status, 200);
  const again = (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data.tasks;
  assert.ok(again.find((t) => t.name === 'B').start > B.start, 'B moved with A');
});
test('data survives a server restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmai-'));
  const run = async (fn) => { const app = await createApp({ dbOptions: { dir: path.join(dir, 'db') } }); await new Promise((ok) => app.server.listen(0, ok)); const base = 'http://localhost:' + app.server.address().port; try { return await fn(base); } finally { await app.close(); } };
  const j = async (base, m, p, body, tok) => { const r = await fetch(base + p, { method: m, headers: { ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); return r.json(); };
  const { token, ids } = await run(async (base) => {
    const reg = await j(base, 'POST', '/api/auth/register', { name: 'Persist', email: 'p@test.co', password: 'password1' });
    const ids = [];
    for (const n of ['One', 'Two']) { const fd = new FormData(); fd.append('name', n); ids.push((await j(base, 'POST', '/api/projects', fd, reg.token)).project.id); }
    await j(base, 'POST', `/api/projects/${ids[0]}/tasks`, { name: 'Kept task', duration: 2 }, reg.token);
    return { token: reg.token, ids };
  });
  await run(async (base) => {
    const me = await j(base, 'GET', '/api/me', null, token); assert.equal(me.user.email, 'p@test.co', 'session survives');
    const list = await j(base, 'GET', '/api/projects', null, token);
    assert.deepEqual(list.projects.map((p) => p.name).sort(), ['One', 'Two']);
    assert.equal((await j(base, 'GET', `/api/projects/${ids[0]}/schedule`, null, token)).tasks[0].name, 'Kept task');
    const fd = new FormData(); fd.append('name', 'Three');
    const p3 = (await j(base, 'POST', '/api/projects', fd, token)).project;
    assert.ok(!ids.includes(p3.id), 'new ids never reuse old ones');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
test('concurrent creates all land with unique ids', async () => {
  const u = await s.user();
  const made = await Promise.all(Array.from({ length: 12 }, (_, i) => s.project(u.token, 'P' + i)));
  assert.equal(new Set(made.map((p) => p.id)).size, 12);
  assert.equal((await s.call('GET', '/api/projects', null, u.token)).data.projects.length, 12);
});
test('sample projects load once', async () => {
  const u = await s.user();
  const r = await s.call('POST', '/api/workspace/sample', {}, u.token);
  assert.equal(r.status, 200); assert.ok(r.data.projects >= 10);
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, u.token)).status, 409);
  assert.equal((await s.call('GET', '/api/projects', null, u.token)).data.projects.length, r.data.projects);
});
