'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

const raw = (port, text) => new Promise((ok) => { const c = net.connect(port, 'localhost', () => c.write(text)); let d = ''; c.on('data', (x) => (d += x)); c.on('end', () => ok(d)); c.on('error', () => ok(d)); setTimeout(() => { c.destroy(); ok(d); }, 1500); });

test('health and static pages', async () => {
  assert.equal((await s.call('GET', '/healthz')).status, 200);
  for (const p of ['/', '/login.html', '/app.html']) assert.equal((await s.call('GET', p)).status, 200, p);
  assert.equal((await s.call('GET', '/mock.js')).status, 404, 'the in browser mock is gone');
});
test('security headers are set', async () => {
  const r = await s.call('GET', '/login.html');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('x-frame-options') || /frame-ancestors/.test(r.headers.get('content-security-policy') || ''));
});
test('path traversal never leaves the public folder', async () => {
  const port = s.app.server.address().port;
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/server.js', '/public/../server.js', '/..\\package.json']) {
    const out = await raw(port, `GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.ok(!/"name": "project-manager-ai"|createApp/.test(out), p);
  }
  assert.equal((await s.call('GET', '/server/app.js')).status, 404);
  assert.equal((await s.call('GET', '/data/pglite')).status, 404);
});
test('bad json and wrong methods give clean errors', async () => {
  const u = await s.user();
  const bad = await s.call('POST', '/api/auth/login', '{oops', null, { 'content-type': 'application/json' });
  assert.equal(bad.status, 400);
  assert.equal((await s.call('POST', '/api/projects/abc/tasks', {}, u.token)).status, 404);
  assert.equal((await s.call('GET', '/api/does-not-exist', null, u.token)).status, 404);
  assert.equal((await s.call('PATCH', '/api/me', {}, u.token)).status >= 400, true);
});
test('oversized json is refused', async () => {
  const u = await s.user();
  const r = await s.call('POST', '/api/projects/import', JSON.stringify({ format: 'pmai-project', pad: 'x'.repeat(60 * 1024 * 1024) }), u.token, { 'content-type': 'application/json' });
  assert.ok([400, 413].includes(r.status), String(r.status));
});
test('uploads are checked', async () => {
  const u = await s.user();
  const fd = new FormData(); fd.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'a.html');
  assert.equal((await s.call('POST', '/api/me/avatar', fd, u.token)).status, 400, 'only real image types for avatars');
  const p = await s.project(u.token, 'Up');
  const empty = new FormData(); empty.append('name', 'x');
  assert.equal((await s.call('POST', `/api/projects/${p.id}/documents`, empty, u.token)).status >= 400, true);
});
test('names with markup are stored as text and returned unchanged', async () => {
  const u = await s.user();
  const p = await s.project(u.token, '<img src=x onerror=alert(1)>');
  assert.equal((await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.name, '<img src=x onerror=alert(1)>');
});
test('sql style input is harmless', async () => {
  const u = await s.user();
  const p = await s.project(u.token, `x'); DROP TABLE projects;--`);
  assert.equal((await s.call('GET', '/api/projects', null, u.token)).data.projects.length, 1);
  assert.equal((await s.call('POST', '/api/auth/login', { email: `' OR '1'='1`, password: 'password1' })).status, 401);
  assert.ok(p.id);
});
test('downloads cannot be used with another account token', async () => {
  const a = await s.user(), b = await s.user(); const p = await s.project(a.token, 'Mine');
  assert.equal((await s.call('GET', `/api/projects/${p.id}/schedule/export?format=csv`, null, b.token)).status, 404);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/schedule/export?format=csv`)).status, 401);
});
