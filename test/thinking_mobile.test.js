'use strict';
// Thinking Area on a phone: the voice input endpoint, the capability flag and the pieces the phone layout depends on.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./helpers');

let s; let u;
before(async () => { delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY; s = await start({}); u = await s.user('Speaker'); });
after(() => { delete process.env.GEMINI_API_KEY; return s.close(); });

const dictate = (body) => s.call('POST', '/api/chat/dictate', body, u.token);

test('the chat view says whether voice input can use the server', async () => {
  const r = await s.call('GET', '/api/chat', null, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.dictation, false);
  process.env.GEMINI_API_KEY = 'test-key';
  const on = await s.call('GET', '/api/chat', null, u.token);
  assert.equal(on.data.dictation, true);
  delete process.env.GEMINI_API_KEY;
});

test('voice input is refused with a clear message when the server has no speech service', async () => {
  const r = await dictate({ audio: Buffer.from('abc').toString('base64'), mime: 'audio/webm' });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /not set up/);
});

test('voice input checks the recording before it spends anything', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  assert.equal((await dictate({})).status, 400);
  assert.equal((await dictate({ audio: '', mime: 'audio/webm' })).status, 400);
  assert.equal((await dictate({ audio: Buffer.from('abc').toString('base64'), mime: 'text/plain' })).status, 400);
  const big = Buffer.alloc(3 * 1024 * 1024 + 10, 1).toString('base64');
  assert.equal((await dictate({ audio: big, mime: 'audio/webm' })).status, 413);
  const anon = await s.call('POST', '/api/chat/dictate', { audio: 'AAAA', mime: 'audio/webm' });
  assert.equal(anon.status, 401);
});

test('the phone composer pieces exist in the page code and the styles, in both languages', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/app_chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  for (const id of ['chtPlus', 'chtMic', 'chtSheet', 'chtCam', 'chtRec', 'chtBox', 'chtDeepPill']) assert.ok(js.includes(id), id);
  for (const cls of ['.cht-sheet-card', '.cht-box.rec', '.cht-wave', '.cht-sw']) assert.ok(css.includes(cls), cls);
  const keys = ['th_plus', 'th_cam', 'th_photos', 'th_files', 'th_files_h', 'th_deep_h', 'th_mic', 'th_mic_ok', 'th_mic_no', 'th_listening', 'th_transcribing', 'th_mic_blocked', 'th_mic_fail', 'th_mic_long', 'th_mic_none', 'th_deep_off', 'th_sheet_x'];
  const en = js.slice(js.indexOf('Object.assign(PM.I18N.en, {\n    th_plus'), js.indexOf('Object.assign(PM.I18N.ar, {\n    th_plus'));
  const ar = js.slice(js.indexOf('Object.assign(PM.I18N.ar, {\n    th_plus'), js.indexOf('const pref = '));
  for (const k of keys) { assert.ok(en.includes(k + ':'), 'en ' + k); assert.ok(ar.includes(k + ':'), 'ar ' + k); }
  // user facing text follows the house rule: no dashes and no semicolons
  for (const block of [en, ar]) for (const m of block.matchAll(/th_\w+: '([^']*)'/g)) assert.ok(!/[;–—]|\s-\s/.test(m[1]), m[1]);
});
