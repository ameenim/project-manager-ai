'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

test('register validates input', async () => {
  for (const b of [{}, { name: 'A', email: 'bad', password: 'password1' }, { name: 'A', email: 'a@b.co', password: 'short' }, { name: '', email: 'a@b.co', password: 'password1' }]) {
    const r = await s.call('POST', '/api/auth/register', b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.ok(r.data.error);
  }
});
test('register, duplicate email, login, me, logout', async () => {
  const r = await s.call('POST', '/api/auth/register', { name: 'Ann', email: 'Ann@Test.co', password: 'password1' });
  assert.equal(r.status, 200); assert.ok(r.data.token); assert.equal(r.data.user.email, 'ann@test.co');
  assert.equal(r.data.user.password_hash, undefined);
  assert.equal((await s.call('POST', '/api/auth/register', { name: 'Ann', email: 'ann@test.co', password: 'password1' })).status, 409);
  const l = await s.call('POST', '/api/auth/login', { email: 'ANN@test.co', password: 'password1' });
  assert.equal(l.status, 200);
  assert.equal((await s.call('GET', '/api/me', null, l.data.token)).status, 200);
  await s.call('POST', '/api/auth/logout', {}, l.data.token);
  assert.equal((await s.call('GET', '/api/me', null, l.data.token)).status, 401);
  assert.equal((await s.call('GET', '/api/me', null, r.data.token)).status, 200, 'other sessions stay valid');
});
test('wrong password and unknown email give the same answer', async () => {
  const a = await s.call('POST', '/api/auth/login', { email: 'ann@test.co', password: 'nope-nope' });
  const b = await s.call('POST', '/api/auth/login', { email: 'ghost@test.co', password: 'nope-nope' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.data.error, b.data.error);
});
test('login locks after repeated failures', async () => {
  await s.call('POST', '/api/auth/register', { name: 'Lock', email: 'lock@test.co', password: 'password1' });
  let last;
  for (let i = 0; i < 10; i++) last = await s.call('POST', '/api/auth/login', { email: 'lock@test.co', password: 'wrong-wrong' });
  assert.equal(last.status, 429);
});
test('api needs a valid token', async () => {
  assert.equal((await s.call('GET', '/api/projects')).status, 401);
  assert.equal((await s.call('GET', '/api/projects', null, 'not-a-token')).status, 401);
});
test('change password keeps this session and rejects the old password', async () => {
  const u = await s.user();
  const bad = await s.call('POST', '/api/me/password', { current: 'wrong-pass', next: 'newpassword1' }, u.token);
  assert.equal(bad.status, 400);
  const ok = await s.call('POST', '/api/me/password', { current: 'password1', next: 'newpassword1' }, u.token);
  assert.equal(ok.status, 200); assert.ok(ok.data.token);
  assert.equal((await s.call('GET', '/api/me', null, ok.data.token)).status, 200);
  assert.equal((await s.call('GET', '/api/me', null, u.token)).status, 401, 'old sessions end');
  assert.equal((await s.call('POST', '/api/auth/login', { email: u.email, password: 'password1' })).status, 401);
  assert.equal((await s.call('POST', '/api/auth/login', { email: u.email, password: 'newpassword1' })).status, 200);
});
test('profile update validates', async () => {
  const u = await s.user();
  assert.equal((await s.call('PUT', '/api/me', { language: 'xx' }, u.token)).status, 400);
  const r = await s.call('PUT', '/api/me', { name: 'New Name', language: 'ar', theme: 'dark' }, u.token);
  assert.equal(r.status, 200); assert.equal(r.data.user.name, 'New Name'); assert.equal(r.data.user.language, 'ar');
});
