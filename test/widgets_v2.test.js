'use strict';
// The widget builder upgrade: more chart types, calculations, show as, alert colors, filters and validation.
// These are pure spec tests, they need no server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/widgetspec.js');

const rows = [
  { project: 'A', title: 'p1', due: '2026-01-05', amount: 100, currency: 'AED', state: 'paid', late: 'no' },
  { project: 'A', title: 'p2', due: '2026-02-10', amount: 50, currency: 'AED', state: 'pending', late: 'yes' },
  { project: 'B', title: 'p3', due: '2026-02-20', amount: 200, currency: 'AED', state: 'paid', late: 'no' },
  { project: 'B', title: 'p4', due: '2026-05-01', amount: 25, currency: 'AED', state: 'invoiced', late: 'no' },
  { project: 'C', title: 'p5', due: '', amount: 75, currency: 'AED', state: 'pending', late: 'no' },
];
const today = '2026-03-01';
const run = (raw, r) => W.run(W.normalize(raw), r || rows, { today });
const code = (raw) => { try { W.normalize(raw); return null; } catch (e) { return e.code; } };

test('old specs stay valid and store no new keys', () => {
  assert.deepEqual(Object.keys(W.normalize({ dataset: 'payments', viz: 'bar', agg: 'sum', measure: 'amount', groupBy: 'state' })).sort(), ['agg', 'dataset', 'filters', 'groupBy', 'limit', 'measure', 'sort', 'v', 'viz']);
});

test('more calculations: median, distinct count, standard deviation and calculated fields', () => {
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'median', measure: 'amount' }).value, 75);
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'distinct', measure: 'project' }).value, 3);
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'stdev', measure: 'amount' }).value, 67.55);
  const share = run({ dataset: 'payments', viz: 'kpi', agg: 'calc', calc: { op: 'pct', a: { agg: 'sum', measure: 'amount' }, b: { agg: 'count' } } });
  assert.equal(share.value, 9000, 'total divided by the number of rows, as a percent');
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'calc', calc: { op: 'diff', a: { agg: 'max', measure: 'amount' }, b: { agg: 'min', measure: 'amount' } } }).value, 175);
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'calc', calc: { op: 'ratio', a: { agg: 'sum', measure: 'amount' }, b: { agg: 'count' } }, filters: [{ field: 'state', op: 'eq', value: 'paid' }] }).value, 150);
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'calc', calc: { op: 'ratio', a: { agg: 'count' }, b: { agg: 'sum', measure: 'amount' } } }, []).value, null, 'dividing by nothing gives no value, not infinity');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', agg: 'calc', calc: { op: 'nope' } }), 'calc_op');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', agg: 'calc', calc: { op: 'sum', a: { agg: 'sum', measure: 'title' }, b: { agg: 'count' } } }), 'calc_a');
});

test('filters: any or all, ranges, lists, text and date shortcuts', () => {
  const n = (filters, match) => run({ dataset: 'payments', viz: 'kpi', agg: 'count', filters, match }).value;
  assert.equal(n([{ field: 'state', op: 'eq', value: 'paid' }, { field: 'late', op: 'eq', value: 'yes' }], 'any'), 3);
  assert.equal(n([{ field: 'state', op: 'eq', value: 'paid' }, { field: 'late', op: 'eq', value: 'yes' }]), 0);
  assert.equal(n([{ field: 'amount', op: 'between', value: 50, value2: 100 }]), 3);
  assert.equal(n([{ field: 'state', op: 'in', value: ['paid', 'invoiced'] }]), 3);
  assert.equal(n([{ field: 'state', op: 'not_in', value: ['paid', 'invoiced'] }]), 2);
  assert.equal(n([{ field: 'title', op: 'starts_with', value: 'P1' }]), 1);
  assert.equal(n([{ field: 'title', op: 'not_contains', value: 'p' }]), 0);
  assert.equal(n([{ field: 'due', op: 'empty' }]), 1);
  assert.equal(n([{ field: 'due', op: 'not_empty' }]), 4);
  assert.equal(n([{ field: 'due', op: 'this_month' }]), 0);
  assert.equal(n([{ field: 'due', op: 'this_year' }]), 4);
  assert.equal(n([{ field: 'due', op: 'last_days', value: 30 }]), 2);
  assert.equal(n([{ field: 'due', op: 'between', value: '2026-02-01', value2: '2026-02-28' }]), 2);
  assert.equal(code({ dataset: 'payments', viz: 'kpi', filters: [{ field: 'amount', op: 'between', value: 9, value2: 1 }] }), 'filter_range_order');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', filters: [{ field: 'state', op: 'in', value: [] }] }), 'filter_in_none');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', filters: [{ field: 'due', op: 'between', value: '2026-01-01', value2: 'x' }] }), 'filter_range_dates');
});

test('alert colors: rules pick the first match and apply to numbers, bars and gauges', () => {
  const rules = [{ op: 'gte', value: 300, tone: 'bad' }, { op: 'between', value: 100, value2: 299, tone: 'warn' }, { op: 'lt', value: 100, tone: 'info' }];
  assert.equal(W.toneOf(rules, 350), 'bad'); assert.equal(W.toneOf(rules, 150), 'warn'); assert.equal(W.toneOf(rules, 5), 'info'); assert.equal(W.toneOf(null, 5), '');
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'sum', measure: 'amount', rules }).tone, 'bad');
  const bar = run({ dataset: 'payments', viz: 'bar', agg: 'sum', measure: 'amount', groupBy: 'project', rules });
  assert.deepEqual(bar.groups.map((g) => [g.key, g.rule]), [['B', 'warn'], ['A', 'warn'], ['C', 'info']]);
  const g = run({ dataset: 'payments', viz: 'gauge', agg: 'sum', measure: 'amount', max: 1000, rules });
  assert.equal(g.kind, 'gauge'); assert.equal(g.value, 450); assert.equal(g.tone, 'bad');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', rules: [{ op: 'gt', value: 1, tone: 'purple' }] }), 'rule_tone');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', rules: [{ op: 'between', value: 5, value2: 1, tone: 'bad' }] }), 'rule_range');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', rules: [{ op: 'gt', value: '', tone: 'bad' }] }), 'rule_number');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', rules: Array(7).fill({ op: 'gt', value: 1, tone: 'bad' }) }), 'rules_max');
  assert.equal(code({ dataset: 'payments', viz: 'gauge', agg: 'sum', measure: 'amount' }), 'gauge_max', 'a gauge needs an end');
  assert.equal(W.normalize({ dataset: 'projects', viz: 'gauge', agg: 'avg', measure: 'progress' }).max, 100, 'a percent field ends at 100');
  const t = run({ dataset: 'payments', viz: 'table', columns: ['title', 'amount'], ruleField: 'amount', totals: true, rows: 3, rules });
  assert.equal(t.totals.amount, 450);
  assert.equal(code({ dataset: 'payments', viz: 'table', columns: ['title'], ruleField: 'amount' }), 'rule_field');
});

test('a kpi can show progress toward a target and the old alert levels still work', () => {
  const k = run({ dataset: 'payments', viz: 'kpi', agg: 'sum', measure: 'amount', target: 900 });
  assert.equal(k.progress, 50); assert.equal(k.target, 900);
  assert.equal(run({ dataset: 'payments', viz: 'kpi', agg: 'count', tone: { dir: 'above', warn: 2, bad: 9 } }).tone, 'warn');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', target: 'abc' }), 'target');
  assert.equal(code({ dataset: 'payments', viz: 'kpi', decimals: 5 }), 'decimals');
  assert.equal(W.normalize({ dataset: 'payments', viz: 'kpi', unit: '  days  ' }).unit, 'days');
});

test('show values as: share, change and rank', () => {
  const base = { dataset: 'payments', viz: 'column', agg: 'sum', measure: 'amount', groupBy: 'project', sort: 'label' };
  assert.deepEqual(run({ ...base, showAs: 'pct_total' }).groups.map((g) => g.value), [33.33, 50, 16.67]);
  assert.deepEqual(run({ ...base, showAs: 'running' }).groups.map((g) => g.value), [150, 375, 450]);
  assert.deepEqual(run({ ...base, showAs: 'diff_prev' }).groups.map((g) => g.value), [0, 75, -150]);
  assert.deepEqual(run({ ...base, showAs: 'rank' }).groups.map((g) => g.value), [2, 1, 3]);
  assert.equal(run({ ...base, showAs: 'rank' }).showAs, 'rank');
  assert.equal(code({ ...base, showAs: 'weird' }), 'show_as');
  assert.equal(W.normalize({ ...base, viz: 'donut', agg: 'sum', groupBy: 'state', showAs: 'rank' }).showAs, undefined, 'a donut already shows shares');
});

test('group dates by day, month, quarter or year, and numbers into ranges', () => {
  const by = (dateBy) => run({ dataset: 'payments', viz: 'column', agg: 'count', groupBy: 'due', dateBy, limit: 12 }).groups.map((g) => g.key);
  assert.deepEqual(by('year'), ['2026', '']); assert.deepEqual(by('quarter'), ['2026-Q1', '2026-Q2', '']);
  assert.deepEqual(by('day').slice(0, 2), ['2026-01-05', '2026-02-10']);
  const hist = run({ dataset: 'payments', viz: 'column', agg: 'count', groupBy: 'amount', bin: 100 });
  assert.deepEqual(hist.groups.map((g) => [g.key, g.value]), [['0', 3], ['100', 1], ['200', 1]]);
  assert.equal(code({ dataset: 'payments', viz: 'column', agg: 'count', groupBy: 'amount', bin: 0 }), 'bin');
  const desc = run({ dataset: 'payments', viz: 'column', agg: 'count', groupBy: 'due', dateBy: 'quarter', sort: 'label_desc' }).groups.map((g) => g.key);
  assert.deepEqual(desc, ['2026-Q2', '2026-Q1', '']);
});

test('stacked, 100 percent, clustered and multi line charts build a table of categories by series', () => {
  const st = run({ dataset: 'payments', viz: 'stacked', agg: 'sum', measure: 'amount', groupBy: 'project', splitBy: 'state', sort: 'label' });
  assert.equal(st.kind, 'matrix'); assert.deepEqual(st.cats.map((c) => c.key), ['A', 'B', 'C']);
  const by = Object.fromEntries(st.series.map((s) => [s.key, s.values]));
  assert.deepEqual(by.paid, [100, 200, 0]); assert.deepEqual(by.pending, [50, 0, 75]); assert.deepEqual(by.invoiced, [0, 25, 0]);
  assert.deepEqual(st.rowTotals, [150, 225, 75]); assert.equal(st.grand, 450);
  const pct = run({ dataset: 'payments', viz: 'pct', agg: 'sum', measure: 'amount', groupBy: 'project', splitBy: 'state', sort: 'label' });
  assert.equal(pct.showAs, 'pct_cat'); assert.deepEqual(pct.series.find((s) => s.key === 'paid').values, [66.67, 88.89, 0]);
  const few = run({ dataset: 'payments', viz: 'stacked', agg: 'count', groupBy: 'project', splitBy: 'title', splitLimit: 2, sort: 'label' });
  assert.equal(few.series.length, 3); assert.equal(few.series[2].key, '__other', 'the smaller series are joined');
  const cl = run({ dataset: 'payments', viz: 'cluster', series: [{ agg: 'sum', measure: 'amount' }, { agg: 'count' }], groupBy: 'project', sort: 'label' });
  assert.deepEqual(cl.series.map((s) => s.values), [[150, 225, 75], [2, 2, 1]]);
  const ln = run({ dataset: 'payments', viz: 'lines', agg: 'sum', measure: 'amount', groupBy: 'due', splitBy: 'state' });
  assert.equal(ln.kind, 'matrix');
  assert.equal(code({ dataset: 'payments', viz: 'stacked', agg: 'sum', measure: 'amount', groupBy: 'project' }), 'split_required');
  assert.equal(code({ dataset: 'payments', viz: 'stacked', agg: 'sum', measure: 'amount', groupBy: 'project', splitBy: 'project' }), 'split_same');
  assert.equal(code({ dataset: 'payments', viz: 'stacked', agg: 'avg', measure: 'amount', groupBy: 'project', splitBy: 'state' }), 'stack_agg');
  assert.equal(code({ dataset: 'payments', viz: 'cluster', groupBy: 'project', series: [{ agg: 'count' }] }), 'series_min');
  assert.equal(code({ dataset: 'payments', viz: 'cluster', groupBy: 'project', series: Array(5).fill({ agg: 'count' }) }), 'series_max');
  assert.equal(code({ dataset: 'payments', viz: 'heatmap', agg: 'count', groupBy: 'project', splitBy: 'state', splitLimit: 9 }), 'split_range');
});

test('pivot and heat map totals use the real calculation, not a sum of averages', () => {
  const pv = run({ dataset: 'payments', viz: 'pivot', agg: 'avg', measure: 'amount', groupBy: 'project', splitBy: 'state', sort: 'label' });
  assert.deepEqual(pv.rowTotals, [75, 112.5, 75]); assert.equal(pv.grand, 90);
});

test('waterfall adds steps in order and a scatter keeps the points that have both numbers', () => {
  const wf = run({ dataset: 'payments', viz: 'waterfall', agg: 'sum', measure: 'amount', groupBy: 'project' });
  assert.deepEqual(wf.steps.map((s) => [s.key, s.start, s.end]), [['A', 0, 150], ['B', 150, 375], ['C', 375, 450]]);
  assert.equal(wf.sum, 450);
  assert.equal(code({ dataset: 'payments', viz: 'waterfall', agg: 'avg', measure: 'amount', groupBy: 'project' }), 'waterfall_agg');
  const pr = [{ name: 'a', progress: 10, planned: 20, health: 'green' }, { name: 'b', progress: 40, planned: 50, health: 'red' }, { name: 'c', progress: 70, planned: 80, health: 'red' }, { name: 'd', progress: null, planned: 5, health: 'red' }];
  const sc = W.run(W.normalize({ dataset: 'projects', viz: 'scatter', x: 'planned', y: 'progress', colorBy: 'health', trend: true }), pr, { today });
  assert.equal(sc.points.length, 3); assert.deepEqual(sc.colors, ['red', 'green']); assert.ok(Math.abs(sc.trend.slope - 1) < 1e-9);
  assert.equal(code({ dataset: 'projects', viz: 'scatter', x: 'name', y: 'progress' }), 'scatter_x');
  assert.equal(code({ dataset: 'projects', viz: 'scatter', x: 'progress', y: 'progress' }), 'scatter_same');
  const pie = run({ dataset: 'payments', viz: 'pie', agg: 'count', groupBy: 'title', limit: 3 });
  assert.equal(pie.groups.length, 3); assert.equal(pie.groups[2].key, '__other');
});

test('hints explain what a widget will show with the data it has, and never block saving', () => {
  const s = W.normalize({ dataset: 'payments', viz: 'kpi', agg: 'sum', measure: 'amount', rules: [{ op: 'gt', value: 99999, tone: 'bad' }] });
  assert.deepEqual(W.hints(s, W.run(s, rows, { today })).map((h) => h.code), ['rules_never']);
  const e = W.normalize({ dataset: 'payments', viz: 'column', agg: 'count', groupBy: 'state' });
  assert.deepEqual(W.hints(e, W.run(e, [], { today })).map((h) => h.code), ['no_rows']);
  const b = W.normalize({ dataset: 'payments', viz: 'column', agg: 'count', groupBy: 'due', dateBy: 'quarter' });
  assert.ok(W.hints(b, W.run(b, rows, { today })).some((h) => h.code === 'blank_group'));
});

test('size and legend are stored only when chosen, and nothing else survives', () => {
  const s = W.normalize({ dataset: 'payments', viz: 'stacked', agg: 'count', groupBy: 'project', splitBy: 'state', size: 'l', legend: false, script: 'x' });
  assert.equal(s.size, 'l'); assert.equal(s.legend, false); assert.equal(s.script, undefined);
  assert.equal(W.normalize({ dataset: 'payments', viz: 'kpi', size: 'xl' }).size, undefined);
  assert.equal(code({ dataset: 'payments', viz: 'table', columns: Array(9).fill('title') }), 'columns_max');
});
