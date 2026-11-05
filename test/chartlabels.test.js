// Data labels on charts: the shared module and a guard that every chart renderer uses it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(stored) {
  const store = stored ? { pm_chart_labels: JSON.stringify(stored) } : {};
  const sandbox = {
    window: {}, document: { addEventListener() {}, documentElement: { lang: 'en' }, createElement() { return {}; } },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, innerWidth: 1200, innerHeight: 800,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'chartlabels.js'), 'utf8'), sandbox);
  return { CL: sandbox.PMCL, store };
}

test('every chart kind has the Microsoft style positions and a sensible default', () => {
  const { CL } = load();
  assert.deepEqual([...CL.KINDS.hbar].sort(), ['above', 'below', 'center', 'left', 'right']);
  assert.deepEqual([...CL.KINDS.line].sort(), ['above', 'below', 'center', 'left', 'right']);
  assert.ok(CL.KINDS.donut.includes('center') && CL.KINDS.donut.includes('outside'));
  CL.scope('t');
  assert.equal(CL.get('hbar').pos, 'right');
  assert.equal(CL.get('column').pos, 'above');
  assert.equal(CL.get('donut').show, 'percent');
  assert.ok(CL.get('hbar').on, 'labels are on until the person turns them off');
});

test('the radar starts without value labels because its axis names carry the numbers', () => {
  const { CL } = load();
  CL.scope('radar');
  assert.equal(CL.get('radar').on, false);
});

test('a saved choice per chart, the use for all charts choice, and invalid positions', () => {
  let { CL } = load({ all: null, k: { a: { pos: 'below', show: 'both' }, b: { pos: 'off' }, c: { pos: 'outside' } } });
  CL.scope('a'); assert.deepEqual([CL.get('hbar').pos, CL.get('hbar').show], ['below', 'both']);
  CL.scope('b'); assert.equal(CL.get('hbar').on, false);
  CL.scope('c'); assert.equal(CL.get('hbar').pos, 'right', 'a position the chart cannot use falls back to its default');
  ({ CL } = load({ all: { pos: 'center', show: 'value' }, k: { a: { pos: 'below' } } }));
  CL.scope('a'); assert.equal(CL.get('hbar').pos, 'center', 'use for all charts wins over one chart');
  CL.scope('z'); assert.equal(CL.get('donut').pos, 'center');
});

test('a chart that has no percentage never shows one', () => {
  const { CL } = load({ all: null, k: { a: { pos: 'above', show: 'percent' } } });
  CL.scope('a');
  assert.equal(CL.get('line', { percent: false }).show, 'value');
});

test('label words follow the show choice', () => {
  const { CL } = load();
  assert.equal(CL.str({ show: 'value' }, { text: '12', pct: '40%' }), '12');
  assert.equal(CL.str({ show: 'percent' }, { text: '12', pct: '40%' }), '40%');
  assert.equal(CL.str({ show: 'both' }, { text: '12', pct: '40%' }), '12 (40%)');
  assert.equal(CL.str({ show: 'percent' }, { text: '12' }), '12');
  assert.equal(CL.pctOf(1, 3), '33%');
  assert.equal(CL.pctOf(1, 40), '2.5%');
  assert.equal(CL.pctOf(1, 0), '');
});

test('SVG labels sit on the side the position names', () => {
  const { CL } = load();
  const at = (pos) => CL.text(100, 50, '7', pos);
  assert.match(at('above'), /y="44\.0"[^>]*text-anchor="middle"/);
  assert.match(at('below'), /y="65\.0"[^>]*text-anchor="middle"/);
  assert.match(at('left'), /x="94\.0"[^>]*y="54\.0"[^>]*text-anchor="end"/);
  assert.match(at('right'), /x="106\.0"[^>]*y="54\.0"[^>]*text-anchor="start"/);
  assert.match(at('center'), /x="100\.0"[^>]*y="54\.0"[^>]*text-anchor="middle"/);
  assert.match(CL.text(1, 1, '<b>', 'center'), /&lt;b&gt;/, 'label text is escaped');
});

test('every chart renderer uses the shared labels', () => {
  const dir = path.join(__dirname, '..', 'public');
  const need = { 'app_dash.js': ["PMCL.get('donut')", "PMCL.get('hbar')"], 'app_pdash.js': ["PMCL.get('stackcol')", "PMCL.get('line'", "PMCL.get('stackbar')"], 'app_trends.js': ["PMCL.get('line'", "PMCL.get('stackcol')"], 'app_radar.js': ["PMCL.get('radar')"], 'app_widgets.js': ["PMCL.get('htmlcol')"], 'admin.js': ["PMCL.get('htmlcol'"] };
  for (const [file, marks] of Object.entries(need)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of marks) assert.ok(src.includes(m), `${file} must use ${m}`);
  }
  for (const page of ['app.html', 'admin.html']) assert.ok(fs.readFileSync(path.join(dir, page), 'utf8').includes('chartlabels.js'), `${page} loads the module`);
  const frame = fs.readFileSync(path.join(dir, 'app_dash.js'), 'utf8');
  assert.ok(frame.includes('PMCL.button(') && frame.includes('PMCL.scope(id)'), 'the widget frame offers the labels button');
});
