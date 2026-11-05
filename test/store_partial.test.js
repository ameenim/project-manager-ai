'use strict';
// Saving a project writes only the parts that changed. The stored copy must always equal the copy in memory, and a
// small edit on a project with a large history must not send the large parts again.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let s, u, p;
before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  s = await start(); u = await s.user('Partial');
  p = await s.project(u.token, 'Partial save', 'Contract clause about payment. '.repeat(5000));
});
after(() => s.close());

const stored = async () => (await s.app.store.db.query('SELECT data, version FROM projects WHERE id = $1', [p.id])).rows[0];
const memory = async () => JSON.parse(JSON.stringify((await s.app.store.forUser(u.id)).projects[p.id], (k, v) => (k.startsWith('_') ? undefined : v)));

test('the stored project equals the project in memory after several edits', async () => {
  for (let i = 0; i < 4; i++) await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Task ' + i, duration: 2, start: '2026-01-05' }, u.token);
  await s.call('POST', `/api/projects/${p.id}/items`, { kind: 'risk', title: 'Vendor delay', data: { probability: 'High', impact: 'High' } }, u.token);
  const row = await stored();
  assert.deepEqual(row.data, await memory());
});

test('a small edit sends only the parts that changed', async () => {
  const db = s.app.store.db; const real = db.query.bind(db); const seen = [];
  db.query = (text, params) => { if (/UPDATE projects SET data/.test(text)) seen.push({ text, size: String(params[1]).length }); return real(text, params); };
  try {
    const risk = (await s.call('GET', `/api/projects/${p.id}/items`, null, u.token)).data.items[0];
    await s.call('PUT', `/api/items/${risk.id}`, { state: 'closed' }, u.token);
  } finally { db.query = real; }
  assert.equal(seen.length, 1);
  const whole = JSON.stringify((await memory())).length;
  assert.ok(seen[0].size < whole / 5, `the write was ${seen[0].size} bytes of a ${whole} byte project`);
  assert.deepEqual((await stored()).data, await memory());
});

test('a part removed from the project is removed from the stored copy', async () => {
  const P = (await s.app.store.forUser(u.id)).projects[p.id];
  P.scratch = { note: 'temporary' };
  await s.app.store.save(P);
  assert.deepEqual((await stored()).data.scratch, { note: 'temporary' });
  delete P.scratch;
  await s.app.store.save(P);
  assert.equal('scratch' in (await stored()).data, false);
  assert.deepEqual((await stored()).data, await memory());
});

test('after another server changed the project the next save writes everything again', async () => {
  const store = s.app.store; const P = (await store.forUser(u.id)).projects[p.id];
  // another instance writes a new version with a different note
  const row = await stored(); const other = { ...row.data, note_from_other: 'x' };
  await store.db.query('UPDATE projects SET data = $2::jsonb, version = version + 1 WHERE id = $1', [p.id, JSON.stringify(other)]);
  const fresh = (await store.forUser(u.id)).projects[p.id];
  assert.equal(fresh, P, 'the project object is replaced in place');
  assert.equal(fresh.note_from_other, 'x');
  fresh.p.name = 'Renamed here';
  await store.save(fresh);
  const after = await stored();
  assert.equal(after.data.p.name, 'Renamed here');
  assert.equal(after.data.note_from_other, 'x');
  assert.deepEqual(after.data, await memory());
});
