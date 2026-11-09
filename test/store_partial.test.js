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

const stored = async () => { const r = (await s.app.store.readRows([p.id]))[0]; return { data: r.data, version: r.version }; };
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

// ---------- heavy parts in their own rows ----------
const partRows = async (id) => (await s.app.store.db.query('SELECT k, length(data::text) AS n FROM project_parts WHERE project_id = $1 ORDER BY k', [id])).rows;
const spy = (fn) => {
  const db = s.app.store.db; const real = db.query.bind(db), realTx = db.tx.bind(db); const seen = [];
  db.query = (t, a) => { seen.push({ t, a }); return real(t, a); };
  db.tx = (f) => realTx((t) => f({ query: (x, a) => { seen.push({ t: x, a }); return t.query(x, a); } }));
  return fn().finally(() => { db.query = real; db.tx = realTx; }).then(() => seen);
};

test('schedule versions and document texts are stored in their own rows and read back identically', async () => {
  const q = await s.project(u.token, 'Sharded', 'Some document text. '.repeat(200));
  for (let i = 0; i < 3; i++) { await s.call('POST', `/api/projects/${q.id}/tasks`, { name: 'T' + i, duration: 2, start: '2026-01-05' }, u.token); await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'V' + i }, u.token); }
  await s.app.store.flush();
  const rows = await partRows(q.id);
  assert.ok(rows.some((r) => r.k === 'texts'));
  assert.ok(rows.filter((r) => r.k.startsWith('v:')).length >= 3);
  const main = (await s.app.store.db.query('SELECT data FROM projects WHERE id = $1', [q.id])).rows[0].data;
  assert.equal('versions' in main, false); assert.equal('texts' in main, false); assert.ok(Array.isArray(main.vorder));
  const mem = JSON.parse(JSON.stringify((await s.app.store.forUser(u.id)).projects[q.id], (k, v) => (k.startsWith('_') ? undefined : v)));
  const back = (await s.app.store.readRows([q.id]))[0].data;
  assert.deepEqual(back, mem);
});

test('saving a new version writes only the newest entries, never the old ones', async () => {
  const q = await s.project(u.token, 'Old versions stay', 'text');
  for (let i = 0; i < 5; i++) { await s.call('POST', `/api/projects/${q.id}/tasks`, { name: 'T' + i, duration: 2, start: '2026-01-05' }, u.token); await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'V' + i }, u.token); }
  await s.app.store.flush();
  const seen = await spy(async () => { await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'Next' }, u.token); await s.app.store.flush(); });
  const writes = seen.filter((x) => /INSERT INTO project_parts/.test(x.t)).map((x) => x.a[1]);
  assert.ok(writes.length >= 1 && writes.length <= 2, 'wrote ' + writes.join(','));
  const none = await spy(async () => { const it = (await s.call('POST', `/api/projects/${q.id}/items`, { kind: 'risk', title: 'R', data: { probability: 'High', impact: 'High' } }, u.token)).data; await s.call('PUT', `/api/items/${it.id || it.item.id}`, { title: 'R2' }, u.token); await s.app.store.flush(); });
  assert.equal(none.filter((x) => /project_parts/.test(x.t)).length, 0, 'an edit outside the schedule must not touch the version rows');
});

test('a project stored the old way is moved on its first save and loses nothing', async () => {
  const q = await s.project(u.token, 'Legacy layout', 'legacy text');
  await s.call('POST', `/api/projects/${q.id}/tasks`, { name: 'L', duration: 2, start: '2026-01-05' }, u.token);
  await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'Legacy' }, u.token);
  await s.app.store.flush();
  const whole = (await s.app.store.readRows([q.id]))[0].data;
  await s.app.store.db.query('DELETE FROM project_parts WHERE project_id = $1', [q.id]);
  await s.app.store.db.query('UPDATE projects SET data = $2::jsonb, version = version + 1 WHERE id = $1', [q.id, JSON.stringify(whole)]);
  const loaded = (await s.app.store.forUser(u.id)).projects[q.id];
  assert.equal(loaded.versions.length, whole.versions.length);
  loaded.p.name = 'Legacy moved';
  await s.app.store.save(loaded);
  assert.ok((await partRows(q.id)).length >= 2);
  const back = (await s.app.store.readRows([q.id]))[0].data;
  assert.equal(back.p.name, 'Legacy moved');
  assert.deepEqual(back.versions, whole.versions); assert.deepEqual(back.texts, whole.texts);
});

test('the oldest version dropped from the history is removed from its row too', async () => {
  const q = await s.project(u.token, 'Version limit', 'x');
  await s.call('POST', `/api/projects/${q.id}/tasks`, { name: 'T', duration: 2, start: '2026-01-05' }, u.token);
  const P = (await s.app.store.forUser(u.id)).projects[q.id];
  await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'A' }, u.token);
  await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'B' }, u.token);
  await s.app.store.flush();
  const before = (await partRows(q.id)).filter((r) => r.k.startsWith('v:')).length;
  const dropped = P.versions[1].id; P.versions.splice(1, 1);
  await s.app.store.save(P);
  const keys = (await partRows(q.id)).map((r) => r.k);
  assert.equal(keys.filter((k) => k.startsWith('v:')).length, before - 1);
  assert.equal(keys.includes('v:' + dropped), false);
  assert.deepEqual((await s.app.store.readRows([q.id]))[0].data.versions.map((v) => v.id), P.versions.map((v) => v.id));
});

test('another server adding a version is picked up and saved over without losing it', async () => {
  const q = await s.project(u.token, 'Two servers', 'x');
  await s.call('POST', `/api/projects/${q.id}/tasks`, { name: 'T', duration: 2, start: '2026-01-05' }, u.token);
  await s.call('POST', `/api/projects/${q.id}/schedule/versions`, { label: 'Mine' }, u.token);
  await s.app.store.flush();
  const db = s.app.store.db;
  const row = (await s.app.store.readRows([q.id]))[0].data; const extra = { ...row.versions[row.versions.length - 1], id: 999001, label: 'From other' };
  await db.query("INSERT INTO project_parts(project_id, k, data) VALUES ($1, 'v:999001', $2::jsonb)", [q.id, JSON.stringify(extra)]);
  await db.query("UPDATE projects SET data = jsonb_set(data, '{vorder}', (data->'vorder') || '999001'::jsonb), version = version + 1 WHERE id = $1", [q.id]);
  const P = (await s.app.store.forUser(u.id)).projects[q.id];
  assert.equal(P.versions[P.versions.length - 1].label, 'From other');
  P.p.name = 'Edited after reload'; await s.app.store.save(P);
  const back = (await s.app.store.readRows([q.id]))[0].data;
  assert.equal(back.versions[back.versions.length - 1].label, 'From other'); assert.equal(back.p.name, 'Edited after reload');
});
