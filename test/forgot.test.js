'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const mailer = require('../server/mailer');
let s; before(async () => { s = await start(); }); after(() => { mailer.api.transport = null; s.close(); });
const KEYS = ['RESEND_API_KEY', 'MAIL_FROM', 'SITE_URL'];
const clear = () => KEYS.forEach((k) => delete process.env[k]);
const setup = () => { process.env.RESEND_API_KEY = 'test-key'; process.env.MAIL_FROM = 'PM <no-reply@example.com>'; process.env.SITE_URL = 'https://pm.example.com/'; };

test('forgot without a mail service says so and sends nothing', async () => {
  clear(); const sent = []; mailer.api.transport = async (m) => sent.push(m);
  await s.call('POST', '/api/auth/register', { name: 'Fay', email: 'fay@test.co', password: 'Pm-Test-4821' });
  const r = await s.call('POST', '/api/auth/forgot', { email: 'fay@test.co' });
  assert.equal(r.status, 200); assert.equal(r.data.mail, false); assert.equal(sent.length, 0);
});
test('forgot rejects a malformed address', async () => {
  const r = await s.call('POST', '/api/auth/forgot', { email: 'nope' });
  assert.equal(r.status, 400);
});
test('forgot emails a working link built from SITE_URL, and the answer does not reveal accounts', async () => {
  setup(); const sent = []; mailer.api.transport = async (m) => { sent.push(m); return { sent: true }; };
  await s.call('POST', '/api/auth/register', { name: 'Gus', email: 'gus@test.co', password: 'Pm-Test-4821' });
  const known = await s.call('POST', '/api/auth/forgot', { email: 'gus@test.co' });
  const ghost = await s.call('POST', '/api/auth/forgot', { email: 'ghost@test.co' });
  assert.deepEqual(known.data, ghost.data); assert.equal(known.data.mail, true);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'gus@test.co');
  const m = /https:\/\/pm\.example\.com\/login\.html#reset=([0-9a-f]{64})/.exec(sent[0].text);
  assert.ok(m, 'link uses SITE_URL');
  const ok = await s.call('POST', '/api/auth/reset', { token: m[1], password: 'New-Pass-7392x' });
  assert.equal(ok.status, 200);
  assert.equal((await s.call('POST', '/api/auth/login', { email: 'gus@test.co', password: 'New-Pass-7392x' })).status, 200);
  assert.equal((await s.call('POST', '/api/auth/reset', { token: m[1], password: 'Other-Pass-5521y' })).status, 400, 'link works once');
  clear();
});
test('forgot is throttled per address', async () => {
  setup(); mailer.api.transport = async () => ({ sent: true });
  let last;
  for (let i = 0; i < 6; i++) last = await s.call('POST', '/api/auth/forgot', { email: 'gus@test.co' });
  assert.equal(last.status, 429); clear();
});
