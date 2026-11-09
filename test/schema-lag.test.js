'use strict';
// Production gets new columns and tables only when Replit Publish runs. Until then the thread list and the suggestions
// must keep working, only without rename, pin, dismiss and snooze.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let s;
before(async () => { delete process.env.ANTHROPIC_API_KEY; s = await start(); });
after(() => s.close());

test('the thread list and suggestions work before the new columns and table exist', async () => {
  const u = await s.user('Lag'); const p = await s.project(u.token, 'Lag project');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', duration: 2, start: '2020-01-06' }, u.token);
  const db = s.app.db;
  assert.ok(db, 'the app exposes its database for tests');
  await db.query('ALTER TABLE chat_threads DROP COLUMN title');
  await db.query('ALTER TABLE chat_threads DROP COLUMN pinned');
  await db.query('DROP TABLE chat_suggest_state');
  const h = await s.call('GET', `/api/chat/history?project_id=${p.id}`, null, u.token);
  assert.equal(h.status, 200); assert.ok(Array.isArray(h.data.items));
  const hs = await s.call('GET', `/api/chat/history?project_id=${p.id}&q=zzz`, null, u.token);
  assert.equal(hs.status, 200);
  const g = await s.call('GET', `/api/chat/suggestions?project_id=${p.id}`, null, u.token);
  assert.equal(g.status, 200); assert.ok(g.data.items.some((x) => x.rule === 'late_tasks'));
  const d = await s.call('POST', '/api/chat/suggestions/dismiss', { project_id: p.id, rule: 'late_tasks' }, u.token);
  assert.equal(d.status, 503); assert.match(d.data.error, /Publish/);
});
