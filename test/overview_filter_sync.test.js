'use strict';
// The overview filters rule the page: a changed top filter rewrites any widget filter that disagrees with it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public');
const win = { PM: { esc: String, t: (k) => k, icon: () => '', $: () => null, $$: () => [], state: { lang: 'en' } }, localStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(fs.readFileSync(path.join(PUB, 'app_dash_filters.js'), 'utf8'), { window: win, localStorage: win.localStorage, document: { addEventListener() {} }, URLSearchParams, Date });
const rawAlign = win.PM.dashFilters.align;
const align = (...a) => { const r = rawAlign(...a); return r === null ? null : JSON.parse(JSON.stringify(r)); };
const blank = { y: '', q: '', m: '', s: '', h: '', cur: '', c: '', p: [] };
const names = { 7: 'Alpha', 9: 'Beta' };

test('a new top year replaces a different widget year and clears its quarter and month', () => {
  const next = align({ y: '2026', q: '2', m: '5' }, { ...blank, y: '2025' }, blank, null, names);
  assert.deepEqual(next, { y: '2025' });
});

test('clearing the top year clears the widget period', () => {
  const next = align({ y: '2026', s: 'late' }, blank, { ...blank, y: '2025' }, ['late'], names);
  assert.deepEqual(next, { s: 'late' });
});

test('a top quarter or month moves the whole widget period with it', () => {
  assert.deepEqual(align({ y: '2026' }, { ...blank, y: '2025', q: '3' }, { ...blank, y: '2025' }, null, names), { y: '2025', q: '3' });
  assert.deepEqual(align({ y: '2025', q: '3' }, { ...blank, y: '2025', m: '8' }, { ...blank, y: '2025', q: '3' }, null, names), { y: '2025', m: '8' });
});

test('a widget that already matches is left alone and no warning is needed', () => {
  assert.equal(align({ y: '2025' }, { ...blank, y: '2025' }, blank, null, names), null);
});

test('an untouched top field never rewrites that widget field', () => {
  const next = align({ y: '2026', s: 'red', p: 'Alpha' }, { ...blank, y: '2026', cur: 'USD' }, { ...blank, y: '2026' }, ['red'], names);
  assert.equal(next, null);
});

test('status follows only when the widget offers that status, else it is cleared', () => {
  assert.deepEqual(align({ s: 'pending' }, { ...blank, s: 'late' }, blank, ['pending', 'late'], names), { s: 'late' });
  assert.deepEqual(align({ s: 'red' }, { ...blank, s: 'late' }, blank, ['green', 'amber', 'red'], names), {});
});

test('project follows the single picked project and is cleared for none or several', () => {
  assert.deepEqual(align({ p: 'Beta' }, { ...blank, p: [7] }, blank, null, names), { p: 'Alpha' });
  assert.deepEqual(align({ p: 'Beta' }, { ...blank, p: [7, 9] }, blank, null, names), {});
  assert.deepEqual(align({ p: 'Beta' }, blank, { ...blank, p: [9] }, null, names), {});
});

test('the dashboard wires the sync into the top filter and shows a dismissible warning', () => {
  const dash = fs.readFileSync(path.join(PUB, 'app_dash.js'), 'utf8');
  assert.match(dash, /syncWidgetFilters\(f, prev\)/);
  assert.match(dash, /flt\.warn\(/);
  const i18n = fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8');
  assert.equal((i18n.match(/gf_sync_warn:/g) || []).length, 2, 'English and Arabic');
});

test('the export dialog opens the same filters, edits apply to the overview and the export waits for them', () => {
  const rep = fs.readFileSync(path.join(PUB, 'app_dash_report.js'), 'utf8');
  assert.match(rep, /mountBar\(box, \{ key: o\.fkey/);
  assert.match(rep, /o\.apply\(nf, prev\)/);
  assert.match(rep, /await pending;/);
  const dash = fs.readFileSync(path.join(PUB, 'app_dash.js'), 'utf8');
  assert.match(dash, /apply: \(f, prev\) => \(applyFilters/);
  assert.match(dash, /applyFilters = \(f, prev\) => \{\s*syncWidgetFilters\(f, prev\)/);
  assert.equal((fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8').match(/ex_filters_edit:/g) || []).length, 2);
});
