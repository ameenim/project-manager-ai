'use strict';
// The meeting microphone setup: every text it shows exists in English and Arabic, and the old three way radio choice is gone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const load = () => { global.window = {}; global.PM = { I18N: { en: {}, ar: {} } }; window.PM = PM; delete require.cache[require.resolve('../public/i18n_lazy.js')]; require('../public/i18n_lazy.js'); return PM.I18N; };

test('every meeting key used by the recorder exists in English and Arabic', () => {
  const { en, ar } = load();
  const code = pub('app_meetings.js');
  const used = new Set([...code.matchAll(/\bt\('(mt_[a-z_0-9]+)'\s*[,)]/g)].map((m) => m[1]));
  for (const k of ['mt_mc_' + 'blocked', 'mt_mc_none', 'mt_mc_busy', 'mt_mc_unsupported', 'mt_mc_insecure']) { used.add(k); used.add(k + '_h'); }
  for (const k of used) { assert.ok(en[k], 'English text for ' + k); assert.ok(ar[k], 'Arabic text for ' + k); }
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith('mt_') && !(k in ar)), []);
  assert.deepEqual(Object.keys(ar).filter((k) => k.startsWith('mt_') && !(k in en)), []);
});

test('the new setup text follows the house rules (no dashes or semicolons)', () => {
  const { en, ar } = load();
  for (const k of Object.keys(en).filter((x) => /^mt_(src|mc|call|dock|mic)_/.test(x))) {
    for (const d of [en, ar]) assert.ok(!/[;–—]| - /.test(d[k]), k + ' has a dash or semicolon');
  }
});

test('the recorder offers two clear choices and a microphone check, not the old radio list', () => {
  const code = pub('app_meetings.js');
  assert.ok(!/name="mtSysM"|name=mtSysM/.test(code), 'old radio group removed');
  for (const id of ['mcSrc', 'mcMic', 'mcRetry', 'mcAllow']) assert.ok(code.includes(id), id + ' exists');
  assert.ok(/role="radiogroup"|role=\\"radiogroup\\"/.test(code), 'choices are an accessible radio group');
  assert.ok(/ended'/.test(code), 'a microphone that disconnects is handled');
});
