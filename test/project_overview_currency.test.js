'use strict';
// The project overview has the same currency toggle as the main overview. Money widgets convert from the project's own currency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function load() {
  const noop = () => '';
  const PM = {
    esc: (x) => String(x), t: (k) => k, icon: noop, $: noop, $$: () => [], api: noop, toast: noop, modal: noop, busy: noop, state: {},
    money: (n, c) => `${c} ${n}`, views: {}, dash: { h: { kpiList: () => [], empty: () => '', legend: (rows) => rows.map((r) => r.join(':')).join('|'), tipAttr: () => '' } },
  };
  const win = { PM, innerWidth: 1200 };
  const ctx = vm.createContext({ window: win, PMCL: new Proxy({}, { get: () => () => ({ on: false }) }), document: {}, console, Math, Object, Number, String, Array, Set, JSON });
  vm.runInContext(src('fx.js'), ctx);
  vm.runInContext(src('app_pdash.js'), ctx);
  return PM;
}

const data = (cur) => ({
  project: { currency: cur, value: 1000 },
  paymentSums: { paid: 367.25, invoiced: 0, pending: 0, late: 0, total: 367.25 },
  payments: [{ id: 1, title: 'M1', amount: 367.25, state: 'paid' }],
  cash: { thisMonth: '2026-11', months: [{ m: '2026-11', paid: 367.25, invoiced: 0, pending: 0, late: 0, cumPlanned: 3672.5, cumReceived: 367.25 }] },
  analytics: { projects: [{ progress: 10, planned: 10, spi: 1 }] },
  radar: { counts: { high: 0 }, items: [] }, status: { late: 0 }, criticalOpen: 0, criticalTotal: 0, taskCount: 0,
});

test('project payment and cash widgets show the project currency in native mode', () => {
  const PM = load();
  PM.fx.mode = 'native';
  const body = { innerHTML: '' };
  const info = PM.pdash.widgets.pkpi.render(body, data('AED'));
  assert.match(body.innerHTML, /AED 367\.25/);
  assert.ok(info.csv);
});

test('project KPI converts to the chosen display currency with the same rates as the main overview', () => {
  const PM = load();
  PM.fx.mode = 'USD';
  const body = { innerHTML: '' };
  PM.pdash.widgets.pkpi.render(body, data('AED'));
  assert.match(body.innerHTML, /USD 100\b/, '367.25 AED is 100 USD at 3.6725');
  assert.ok(!/AED/.test(body.innerHTML), 'no leftover native currency');
});

test('project csv exports carry the display currency', () => {
  const PM = load();
  PM.fx.mode = 'USD';
  const body = { innerHTML: '' };
  const info = PM.pdash.widgets.ppay.render(body, data('AED'), { reload() {} });
  const rows = info.csv();
  assert.equal(rows[1][2], 100);
  assert.equal(rows[1][3], 'USD');
});

test('the project overview mounts with the currency toggle on', () => {
  assert.match(src('app_pdash.js'), /key: 'proj', always: true, currencyToggle: true/);
});
