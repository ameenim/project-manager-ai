'use strict';
// Thinking Area dashboard skill: the dashboard guidance loads on the right words, preview_widget checks a spec against the
// person's data, and one card can hold a whole dashboard that Apply creates and Undo removes together.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const skill = require('../server/chat/skill');
const WS = require('../public/widgetspec.js');

const sc = { q: [], seen: [] };
async function* model(args) {
  sc.seen.push(args);
  const next = sc.q.shift();
  if (!next) throw new Error('the model was called when it should not have been');
  for (const e of next) yield e;
  yield { type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}
const say = (...events) => sc.q.push(events);
const text = (t) => ({ type: 'text', text: t });
const use = (name, input, id) => ({ type: 'tool_use', id: id || 'tu_' + Math.random().toString(36).slice(2), name, input });
let s, u, p;
before(async () => { delete process.env.ANTHROPIC_API_KEY; s = await start({ chatModel: model }); u = await s.user('Dash'); p = await s.project(u.token, 'Dashboard project'); });
after(() => s.close());
beforeEach(() => { sc.q.length = 0; sc.seen.length = 0; });
async function talk(body) {
  const r = await fetch(s.base + '/api/chat/message', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + u.token }, body: JSON.stringify(body) });
  const events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === 'done');
  return { status: r.status, events, done, message: done && done.message };
}

test('the dashboard guidance loads for dashboard words and on the widgets screen, and lists only real fields', () => {
  for (const w of ['build me a dashboard', 'add a heat map of risks', 'a KPI for late tasks', 'show a gauge', 'visualize payments']) assert.ok(skill.partsFor(w, 'overview').includes('widgets'), w);
  assert.ok(skill.partsFor('anything', 'widgets').includes('widgets'));
  assert.ok(!skill.partsFor('which tasks are late', 'overview').includes('widgets'));
  const t = skill.skillText('create a dashboard', 'overview');
  assert.match(t, /DASHBOARD AND WIDGET PRACTICE/);
  assert.match(t, /preview_widget/);
  for (const [ds, fields] of Object.entries(WS.DATASETS)) { assert.ok(t.includes('  ' + ds + ': '), ds); for (const f of fields) assert.ok(t.includes(f.name), f.name); }
  for (const v of WS.VIZ) assert.ok(new RegExp('\\b' + v + '\\b').test(t), 'chart ' + v);
  assert.ok(!skill.skillText('hello', 'overview').includes('DASHBOARD AND WIDGET PRACTICE'), 'not loaded for other questions');
  assert.match(skill.SKILL_VERSION, /^1\.12/);
});

test('every example spec in the skill is valid', () => {
  const t = skill.skillText('dashboard', '');
  const specs = [...t.matchAll(/(\{"dataset".*\})(?:'|$)/gm)].map((m) => JSON.parse(m[1]));
  assert.ok(specs.length >= 5, 'found ' + specs.length);
  for (const sp of specs) assert.doesNotThrow(() => WS.normalize(sp), JSON.stringify(sp));
});

test('preview_widget reports real values, notes and errors, and changes nothing', async () => {
  const tk = (n, status) => s.call('POST', `/api/projects/${p.id}/tasks`, { name: n, start: '2027-01-11', duration: 2, status }, u.token);
  await tk('One'); await tk('Two');
  say(use('preview_widget', { spec: { dataset: 'tasks', viz: 'kpi', agg: 'count' } }, 'a'),
    use('preview_widget', { spec: { dataset: 'tasks', viz: 'kpi', agg: 'count', filters: [{ field: 'name', op: 'contains', value: 'zzzz' }] } }, 'b'),
    use('preview_widget', { spec: { dataset: 'tasks', viz: 'donut', groupBy: 'nope', agg: 'count' } }, 'c'));
  say(text('Checked.'));
  const before = (await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets.length;
  const r = await talk({ project_id: p.id, text: 'Check these widgets for a dashboard' });
  assert.equal(r.status, 200); assert.equal(r.message.card, null, 'a check never prepares a card');
  const results = sc.seen[1].messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'tool_result').map((c) => String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)));
  assert.equal(results.length, 3);
  assert.match(results[0], /"kind":"kpi"/); assert.match(results[0], /"value":[2-9]/);
  assert.match(results[1], /no_rows|"value":0/);
  assert.match(results[2], /not|field|group/i, 'a bad field is explained');
  assert.equal((await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets.length, before);
});

test('one card holds a dashboard: Apply creates every widget as a draft on the overview and Undo removes them all', async () => {
  const specs = [
    ['Late tasks', { dataset: 'tasks', viz: 'kpi', agg: 'count', filters: [{ field: 'status', op: 'eq', value: 'late' }], rules: [{ op: 'gt', value: 0, tone: 'bad' }, { op: 'lte', value: 0, tone: 'good' }] }],
    ['Status by owner', { dataset: 'tasks', viz: 'stackedbar', agg: 'count', groupBy: 'owner', splitBy: 'status' }],
    ['Task status share', { dataset: 'tasks', viz: 'donut', agg: 'count', groupBy: 'status' }],
    ['Progress', { dataset: 'tasks', viz: 'gauge', agg: 'avg', measure: 'progress', max: 100 }],
    ['Late list', { dataset: 'tasks', viz: 'table', columns: ['name', 'owner', 'finish', 'days_late'], sortBy: 'days_late', sortDir: 'desc', rows: 10 }],
    ['Risk map', { dataset: 'risks', viz: 'heatmap', agg: 'count', groupBy: 'probability', splitBy: 'impact' }],
    ['Payments by month', { dataset: 'payments', viz: 'column', agg: 'sum', measure: 'amount', groupBy: 'due', dateBy: 'month' }],
  ];
  say(...specs.map(([title, spec], i) => use('create_widget', { title, group: 'delivery', add_to: 'project', spec }, 'd' + i)));
  say(text('Prepared the delivery dashboard.'));
  const r = await talk({ project_id: p.id, text: 'Build me a delivery dashboard' });
  const card = r.message.card;
  assert.equal(card.items.length, 7);
  assert.equal(card.strong, false, 'seven widgets are not a destructive change, so no second confirmation');
  assert.ok(card.items.every((it) => it.widget && it.widget.spec));
  assert.equal((await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets.length, 0, 'nothing before Apply');
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, {}, u.token)).status, 200);
  const mine = (await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets;
  assert.equal(mine.length, 7); assert.ok(mine.every((w) => w.status === 'draft' && w.added.project));
  const wc = (await s.call('GET', `/api/chat?project_id=${p.id}`, null, u.token)).data.messages.find((m) => m.id === r.message.id).card;
  assert.equal(wc.widgets.length, 7);
  assert.deepEqual(wc.widgets.map((w) => w.ix), [0, 1, 2, 3, 4, 5, 6], 'each widget is tied to its own card item');
  assert.equal(new Set(wc.widgets.map((w) => w.id)).size, 7);
  await s.call('POST', `/api/chat/messages/${r.message.id}/undo`, {}, u.token);
  assert.equal((await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets.length, 0);
});

test('a dashboard card is limited to 12 widgets', async () => {
  const spec = { dataset: 'tasks', viz: 'kpi', agg: 'count' };
  say(...Array.from({ length: 13 }, (_, i) => use('create_widget', { title: 'W' + i, group: 'delivery', spec }, 'x' + i)));
  say(text('Prepared.'));
  const r = await talk({ project_id: p.id, text: 'Make thirteen widgets' });
  assert.equal(r.message.card.items.length, 12);
});

test('in All projects a dashboard needs no project to be named and goes to the portfolio overview', async () => {
  say(use('create_widget', { title: 'Portfolio late tasks', group: 'delivery', add_to: 'portfolio', spec: { dataset: 'tasks', viz: 'bar', agg: 'count', groupBy: 'project', filters: [{ field: 'status', op: 'eq', value: 'late' }] } }, 'p1'));
  say(text('Prepared.'));
  const r = await talk({ text: 'Build me a dashboard of late tasks across all my projects' });
  assert.ok(r.message.card, 'a card is prepared without naming a project');
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, {}, u.token)).status, 200);
  const w = (await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets.find((x) => x.title === 'Portfolio late tasks');
  assert.ok(w && w.added.portfolio && !w.added.project);
});
