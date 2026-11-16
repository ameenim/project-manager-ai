'use strict';
// The overview filters can be hidden, and the project tab strip scrolls with arrows instead of a native scrollbar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const store = {};
const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const tr = (k, o) => (o ? k + JSON.stringify(o) : k);
const win = { PM: { esc: String, t: tr, icon: () => '', $: () => null, $$: () => [], state: { lang: 'en' } }, localStorage: ls };
vm.runInNewContext(read('app_dash_filters.js'), { window: win, localStorage: ls, document: { addEventListener() {} }, URLSearchParams, Date });
const F = win.PM.dashFilters;
const j = (x) => JSON.parse(JSON.stringify(x));

test('count and summary name every filter that is on', () => {
  F.put('main', { y: '2026', q: '2', s: 'late', p: [3, 4] });
  assert.equal(F.count(F.get('main')), 4);
  const s = j(F.summary('main', { filter_options: { projects: [{ id: 3, name: 'A' }, { id: 4, name: 'B' }] } }));
  assert.deepEqual(s.map((x) => x.k), ['y', 'q', 's', 'p']);
  assert.equal(s[1].label, 'Q2');
});

test('a single picked project is named, several are counted', () => {
  F.put('main', { p: [3] });
  assert.equal(F.summary('main', { filter_options: { projects: [{ id: 3, name: 'Alpha' }] } })[0].label, 'Alpha');
});

test('the open state is saved per overview and defaults to open', () => {
  assert.equal(F.isOpen('main'), true);
  F.setOpen('main', false);
  assert.equal(F.isOpen('main'), false);
  assert.equal(F.isOpen('proj:7'), true);
  F.setOpen('proj:7', false); F.setOpen('main', true);
  assert.equal(F.isOpen('main'), true); assert.equal(F.isOpen('proj:7'), false);
});

test('the overview has a Filters toggle, a collapsing wrapper and a chip row', () => {
  const js = read('app_dash.js'), css = read('styles.css');
  assert.match(js, /id="dwFltTog"[^>]*aria-controls="dwFltWrap"/);
  assert.match(js, /id="dwFltWrap"/); assert.match(js, /id="dwFltSum"/);
  assert.match(js, /fwrap\.inert = !open/, 'hidden controls are not reachable by keyboard');
  assert.match(css, /\.dw-fwrap \{[^}]*grid-template-rows: 0fr/);
  assert.match(css, /\.dw-fwrap\.open \{[^}]*grid-template-rows: 1fr/);
});

test('the project tab strip has arrows, edge fades and no native scrollbar', () => {
  const app = read('app.js'), css = read('styles.css'), ui = read('ui.js');
  assert.match(app, /class="tabs-wrap"/); assert.match(app, /tabs-nav nl/); assert.match(app, /tabs-nav nr/);
  assert.match(css, /\.tabs-wrap \.tabs \{[^}]*scrollbar-width: none/);
  assert.match(css, /\.tabs-wrap\.can-l \.tabs-nav\.nl/);
  assert.match(ui, /function tabsState/); assert.match(ui, /addEventListener\('wheel'/);
  assert.match(read('styles.css'), /\.tabs-wrap:not|:not\(\.tabs-wrap\)/, 'chat page keeps the tab strip');
});

test('both languages carry the new strings', () => {
  const i = read('i18n.js');
  for (const k of ['gf_filters', 'gf_hide', 'gf_show', 'gf_showing_by', 'gf_remove', 'tabs_prev', 'tabs_next']) assert.equal(i.split(k + ':').length - 1, 2, k);
});
