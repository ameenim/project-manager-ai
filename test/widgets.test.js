'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const W = require('../public/widgetspec.js');
let s; before(async () => { s = await start(); }); after(() => s.close());

const SPEC = { dataset: 'projects', viz: 'bar', agg: 'avg', measure: 'progress', groupBy: 'health' };
const make = (tok, over = {}) => s.call('POST', '/api/widgets', { title: 'Progress by health', description: 'Average progress per health band', group: 'overview', spec: SPEC, ...over }, tok);
const publish = async (tok, over) => { const r = await make(tok, over); assert.equal(r.status, 200, JSON.stringify(r.data)); const p = await s.call('POST', `/api/widgets/${r.data.widget.id}/publish`, null, tok); assert.equal(p.status, 200); return p.data.widget; };

// ---------- the pure spec rules (shared by the server and the browser) ----------
test('a spec is checked against a fixed whitelist and bad input is refused with a plain sentence', () => {
  assert.throws(() => W.normalize({ dataset: 'nope', viz: 'kpi' }), /Choose the data/);
  assert.throws(() => W.normalize({ dataset: 'payments', viz: 'kpi', agg: 'sum', measure: 'title' }), /number field/);
  assert.throws(() => W.normalize({ dataset: 'payments', viz: 'table', columns: [] }), /at least one column/);
  assert.throws(() => W.normalize({ dataset: 'payments', viz: 'kpi', filters: [{ field: 'state', op: 'eq', value: 'weird' }] }), /not available/);
  assert.throws(() => W.normalize({ dataset: 'tasks', viz: 'kpi', filters: Array(6).fill({ field: 'status', op: 'eq', value: 'done' }) }), /at most 5 filters/);
  assert.throws(() => W.normalize({ dataset: 'payments', viz: 'kpi', format: 'money' }), /Money format/);
  assert.throws(() => W.normalize({ dataset: 'payments', viz: 'donut', agg: 'avg', measure: 'amount', groupBy: 'state' }), /shares of a whole/);
  assert.throws(() => W.meta({ title: '', group: 'overview' }), /title is required/);
  assert.throws(() => W.meta({ title: 'x'.repeat(61), group: 'overview' }), /too long/);
  assert.throws(() => W.meta({ title: 'ok', group: 'hacking' }), /Choose a group/);
  // unknown keys never survive, so nothing but the whitelisted shape can be stored or run
  const clean = W.normalize({ dataset: 'projects', viz: 'kpi', agg: 'count', script: 'alert(1)', html: '<img onerror=x>' });
  assert.deepEqual(Object.keys(clean).sort(), ['agg', 'dataset', 'filters', 'format', 'v', 'viz']);
});

test('a spec computes the right numbers: filters, grouping, money conversion, tones and the other slice', () => {
  const rows = [
    { project: 'A', title: 'p1', due: '2026-11-10', amount: 100, currency: 'AED', state: 'pending', late: 'no' },
    { project: 'A', title: 'p2', due: '2026-10-01', amount: 50, currency: 'AED', state: 'pending', late: 'yes' },
    { project: 'B', title: 'p3', due: '2026-11-20', amount: 200, currency: 'USD', state: 'paid', late: 'no' },
    { project: 'B', title: 'p4', due: '2026-12-01', amount: 25, currency: 'USD', state: 'invoiced', late: 'no' },
  ];
  const today = '2026-11-05';
  const bar = W.run(W.normalize({ dataset: 'payments', viz: 'bar', agg: 'sum', measure: 'amount', groupBy: 'project', filters: [{ field: 'state', op: 'ne', value: 'paid' }] }), rows, { today });
  assert.deepEqual(bar.groups.map((g) => [g.key, g.value]), [['A', 150], ['B', 25]]);
  const kpi = W.run(W.normalize({ dataset: 'payments', viz: 'kpi', agg: 'count', filters: [{ field: 'due', op: 'within_days', value: 30 }], tone: { dir: 'above', warn: 1, bad: 3 } }), rows, { today });
  assert.equal(kpi.value, 3); assert.equal(kpi.tone, 'bad');
  const late = W.run(W.normalize({ dataset: 'payments', viz: 'kpi', agg: 'count', filters: [{ field: 'due', op: 'before_today' }, { field: 'state', op: 'eq', value: 'pending' }] }), rows, { today });
  assert.equal(late.value, 1);
  const conv = W.run(W.normalize({ dataset: 'payments', viz: 'kpi', agg: 'sum', measure: 'amount', format: 'money' }), rows, { today, convert: (v, r) => (r.currency === 'AED' ? v / 3.6725 : v) });
  assert.equal(conv.value, Math.round(((150 / 3.6725) + 225) * 100) / 100);
  const donut = W.run(W.normalize({ dataset: 'payments', viz: 'donut', agg: 'count', groupBy: 'title', limit: 3 }), rows, { today });
  assert.equal(donut.groups.length, 3); assert.equal(donut.groups[2].key, '__other'); assert.equal(donut.groups[2].value, 2);
  const months = W.run(W.normalize({ dataset: 'payments', viz: 'column', agg: 'sum', measure: 'amount', groupBy: 'due' }), rows, { today });
  assert.deepEqual(months.groups.map((g) => [g.key, g.value]), [['2026-10', 50], ['2026-11', 300], ['2026-12', 25]]);
  const table = W.run(W.normalize({ dataset: 'payments', viz: 'table', columns: ['title', 'amount'], sortBy: 'amount', sortDir: 'desc', rows: 3 }), rows, { today });
  assert.deepEqual(table.rows.map((r) => r.title), ['p3', 'p1', 'p2']); assert.equal(table.total, 4);
  assert.equal(W.run(W.normalize({ dataset: 'payments', viz: 'kpi', agg: 'avg', measure: 'amount' }), [], { today }).value, null, 'no rows gives no value, not zero');
});

// ---------- building and publishing ----------
test('a draft is private, a published widget is visible to everyone, and bad definitions are refused', async () => {
  const a = await s.user('Author'), b = await s.user('Other');
  assert.equal((await make(a.token, { title: '' })).status, 400);
  assert.equal((await make(a.token, { spec: { dataset: 'projects', viz: 'kpi', agg: 'sum', measure: 'name' } })).status, 400);
  assert.equal((await make(a.token, { group: 'nonsense' })).status, 400);
  const d = await make(a.token, { title: 'Secret draft' });
  assert.equal(d.status, 200); assert.equal(d.data.widget.status, 'draft');
  assert.equal((await s.call('GET', `/api/widgets/${d.data.widget.id}`, null, b.token)).status, 404, 'a draft is private');
  assert.equal((await s.call('POST', `/api/widgets/${d.data.widget.id}/install`, { scope: 'portfolio' }, b.token)).status, 404);
  assert.equal((await s.call('GET', '/api/widgets', null, b.token)).data.widgets.some((w) => w.title === 'Secret draft'), false);
  const pub = await s.call('POST', `/api/widgets/${d.data.widget.id}/publish`, null, a.token);
  assert.equal(pub.data.widget.status, 'published'); assert.equal(pub.data.widget.version, 1);
  const seen = await s.call('GET', `/api/widgets/${d.data.widget.id}`, null, b.token);
  assert.equal(seen.status, 200); assert.equal(seen.data.widget.mine, false); assert.equal(seen.data.widget.author.startsWith('Author'), true);
  assert.equal(JSON.stringify(seen.data).includes('@test.co'), false, 'the author email is never exposed');
  assert.equal((await s.call('PUT', `/api/widgets/${d.data.widget.id}`, { title: 'Hijack' }, b.token)).status, 404, 'only the author edits');
  assert.equal((await s.call('POST', `/api/widgets/${d.data.widget.id}/publish`, null, b.token)).status, 404);
  assert.equal((await s.call('DELETE', `/api/widgets/${d.data.widget.id}`, null, b.token)).status, 404);
});

test('editing a published widget changes the author copy at once and everyone else only after publishing again', async () => {
  const a = await s.user('Author'), b = await s.user('User');
  const w = await publish(a.token, { title: 'Versioned' });
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, b.token);
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, a.token);
  const edit = await s.call('PUT', `/api/widgets/${w.id}`, { spec: { ...SPEC, viz: 'donut', agg: 'count', limit: 4 } }, a.token);
  assert.equal(edit.data.widget.dirty, true);
  assert.equal(edit.data.widget.spec.viz, 'donut', 'the author sees the draft');
  const theirs = (await s.call('GET', '/api/widgets/installed?scope=portfolio', null, b.token)).data.widgets[0];
  assert.equal(theirs.spec.viz, 'bar', 'other people keep the published version');
  const mine = (await s.call('GET', '/api/widgets/installed?scope=portfolio', null, a.token)).data.widgets[0];
  assert.equal(mine.spec.viz, 'donut');
  const again = await s.call('POST', `/api/widgets/${w.id}/publish`, null, a.token);
  assert.equal(again.data.widget.version, 2);
  assert.equal((await s.call('GET', '/api/widgets/installed?scope=portfolio', null, b.token)).data.widgets[0].spec.viz, 'donut');
});

test('the marketplace searches, groups, filters by rating and sorts', async () => {
  const a = await s.user('Maker'), r1 = await s.user('R1'), r2 = await s.user('R2');
  const tag = 'zq' + Date.now();
  const cash = await publish(a.token, { title: `${tag} cash view`, description: 'Money by project', group: 'financials' });
  const risk = await publish(a.token, { title: `${tag} risk view`, description: 'Open risks', group: 'risk', spec: { dataset: 'risks', viz: 'donut', agg: 'count', groupBy: 'probability' } });
  const find = async (qs, tok = r1.token) => (await s.call('GET', '/api/widgets?' + qs, null, tok)).data.widgets.map((w) => w.title);
  assert.deepEqual((await find(`q=${tag}&sort=name`)).sort(), [`${tag} cash view`, `${tag} risk view`]);
  assert.deepEqual(await find(`q=${tag}&group=risk`), [`${tag} risk view`]);
  assert.deepEqual(await find(`q=${encodeURIComponent('Open risks')}`), [`${tag} risk view`], 'searches the description');
  assert.deepEqual(await find(`q=${encodeURIComponent('Maker')}&group=financials`).then((x) => x.filter((t) => t.startsWith(tag))), [`${tag} cash view`], 'searches the author name');
  assert.deepEqual(await find('q=%25'), [], 'a percent sign is searched as text, not as a wildcard');
  for (const [tok, w, stars] of [[r1.token, cash, 5], [r2.token, cash, 4], [r1.token, risk, 2]]) {
    await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, tok);
    assert.equal((await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars }, tok)).status, 200);
  }
  assert.deepEqual((await find(`q=${tag}&sort=rated`)), [`${tag} cash view`, `${tag} risk view`]);
  assert.deepEqual((await find(`q=${tag}&min_rating=4`)), [`${tag} cash view`]);
  assert.deepEqual((await find(`q=${tag}&source=added`, r2.token)), [`${tag} cash view`]);
  assert.deepEqual((await find(`q=${tag}&source=mine`, a.token)).sort(), [`${tag} cash view`, `${tag} risk view`]);
  assert.equal((await find(`q=${tag}&sort=installs`))[0], `${tag} cash view`);
  const top = (await s.call('GET', `/api/widgets?q=${tag}&sort=rated`, null, r1.token)).data.widgets[0];
  assert.deepEqual(top.rating, { avg: 4.5, count: 2 }); assert.equal(top.installs, 2);
  assert.deepEqual(top.added, { portfolio: true, project: false }); assert.equal(top.my_rating.stars, 5);
});

test('a few early five star votes do not outrank a widget many people rate well', async () => {
  const a = await s.user('Maker'), voters = [];
  for (let i = 0; i < 5; i++) voters.push(await s.user('V'));
  const tag = 'bay' + Date.now();
  const lone = await publish(a.token, { title: `${tag} lone` }), many = await publish(a.token, { title: `${tag} many` });
  const vote = async (w, who, stars) => { await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, who.token); await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars }, who.token); };
  await vote(lone, voters[0], 5);
  for (const v of voters) await vote(many, v, 5);
  const order = (await s.call('GET', `/api/widgets?q=${tag}&sort=rated`, null, voters[0].token)).data.widgets.map((w) => w.title);
  assert.deepEqual(order, [`${tag} many`, `${tag} lone`]);
});

// ---------- adding, removing, retiring ----------
test('adding is per overview, listed for that overview, and removing keeps the widget for everyone else', async () => {
  const a = await s.user('Maker'), b = await s.user('User');
  const w = await publish(a.token, { title: 'Addable' });
  assert.equal((await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'galaxy' }, b.token)).status, 400);
  const add = await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'project' }, b.token);
  assert.deepEqual(add.data.widget.added, { portfolio: false, project: true });
  assert.equal((await s.call('GET', '/api/widgets/installed?scope=portfolio', null, b.token)).data.widgets.length, 0);
  const inst = (await s.call('GET', '/api/widgets/installed?scope=project', null, b.token)).data.widgets;
  assert.equal(inst.length, 1); assert.equal(inst[0].title, 'Addable'); assert.equal(inst[0].spec.dataset, 'projects');
  assert.equal((await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'project' }, b.token)).status, 200, 'adding twice is harmless');
  assert.equal((await s.call('GET', '/api/widgets/installed?scope=project', null, b.token)).data.widgets.length, 1);
  await s.call('DELETE', `/api/widgets/${w.id}/install?scope=project`, null, b.token);
  assert.equal((await s.call('GET', '/api/widgets/installed?scope=project', null, b.token)).data.widgets.length, 0);
  assert.equal((await s.call('GET', `/api/widgets/${w.id}`, null, a.token)).status, 200);
});

test('unpublishing hides a widget from the marketplace but it keeps working where it was added, and delete is blocked while others use it', async () => {
  const a = await s.user('Maker'), b = await s.user('User'), c = await s.user('Late');
  const w = await publish(a.token, { title: 'Retiring' });
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, b.token);
  const del = await s.call('DELETE', `/api/widgets/${w.id}`, null, a.token);
  assert.equal(del.status, 409); assert.match(del.data.error, /Unpublish it instead/);
  assert.equal((await s.call('POST', `/api/widgets/${w.id}/unpublish`, null, a.token)).data.widget.status, 'unpublished');
  assert.equal((await s.call('GET', '/api/widgets?q=Retiring', null, c.token)).data.widgets.length, 0);
  assert.equal((await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, c.token)).status, 404, 'nobody new can add it');
  assert.equal((await s.call('GET', '/api/widgets/installed?scope=portfolio', null, b.token)).data.widgets[0].title, 'Retiring', 'it keeps working for the people who added it');
  await s.call('DELETE', `/api/widgets/${w.id}/install`, null, b.token);
  assert.equal((await s.call('DELETE', `/api/widgets/${w.id}`, null, a.token)).status, 200);
  assert.equal((await s.call('GET', `/api/widgets/${w.id}`, null, a.token)).status, 404);
});

// ---------- ratings ----------
test('rating rules: not your own, only after adding, whole stars 1 to 5, one vote per person that can be changed or withdrawn', async () => {
  const a = await s.user('Maker'), b = await s.user('Rater');
  const w = await publish(a.token, { title: 'Rate me' });
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, a.token);
  assert.equal((await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars: 5 }, a.token)).status, 403, 'not your own');
  assert.equal((await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars: 5 }, b.token)).status, 403, 'add it first');
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, b.token);
  for (const stars of [0, 6, 2.5, 'x', null]) assert.equal((await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars }, b.token)).status, 400, String(stars));
  assert.equal((await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars: 4, comment: 'x'.repeat(281) }, b.token)).status, 400);
  await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars: 3, comment: '  Useful   for weekly reviews ' }, b.token);
  const changed = await s.call('PUT', `/api/widgets/${w.id}/rating`, { stars: 5 }, b.token);
  assert.deepEqual(changed.data.widget.rating, { avg: 5, count: 1 }, 'one vote per person, the new one replaces the old');
  const detail = await s.call('GET', `/api/widgets/${w.id}`, null, a.token);
  assert.equal(detail.data.reviews.length, 1); assert.equal(detail.data.reviews[0].stars, 5);
  const gone = await s.call('DELETE', `/api/widgets/${w.id}/rating`, null, b.token);
  assert.deepEqual(gone.data.widget.rating, { avg: 0, count: 0 });
});

// ---------- the data a widget reads ----------
test('datasets come only from the person own projects, and the overviews carry widgets and data only when one was added', async () => {
  const a = await s.user('Owner'), b = await s.user('Stranger');
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, a.token)).status, 200);
  const dash = await s.call('GET', '/api/dashboard', null, a.token);
  assert.equal(dash.data.widgets, undefined, 'no custom widget added, so nothing extra is sent');
  assert.equal(dash.data.datasets, undefined);
  const ds = await s.call('GET', '/api/widgets/datasets', null, a.token);
  assert.equal(ds.status, 200);
  assert.ok(ds.data.datasets.projects.length >= 1);
  assert.ok(ds.data.datasets.tasks.length > 0);
  const row = ds.data.datasets.projects[0];
  for (const f of W.DATASETS.projects) assert.ok(f.name in row, 'projects row has ' + f.name);
  for (const name of Object.keys(W.DATASETS)) for (const r of ds.data.datasets[name].slice(0, 20)) for (const f of W.DATASETS[name]) assert.ok(f.name in r, `${name} row has ${f.name}`);
  assert.deepEqual((await s.call('GET', '/api/widgets/datasets', null, b.token)).data.datasets.projects, [], 'a stranger sees no rows');
  const pid = row.project_id;
  assert.equal((await s.call('GET', `/api/widgets/datasets?project_id=${pid}`, null, b.token)).status, 404, 'a project you are not on does not exist for you');
  const one = await s.call('GET', `/api/widgets/datasets?project_id=${pid}`, null, a.token);
  assert.equal(one.data.scope, 'project'); assert.deepEqual([...new Set(one.data.datasets.tasks.map((t) => t.project_id))], [pid]);
  const w = await publish(a.token, { title: 'On my overview' });
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'portfolio' }, a.token);
  await s.call('POST', `/api/widgets/${w.id}/install`, { scope: 'project' }, a.token);
  const dash2 = await s.call('GET', '/api/dashboard', null, a.token);
  assert.equal(dash2.data.widgets.length, 1); assert.ok(dash2.data.datasets.projects.length >= 1);
  const pd = await s.call('GET', `/api/projects/${pid}/dashboard`, null, a.token);
  assert.equal(pd.data.widgets.length, 1); assert.deepEqual(pd.data.datasets.projects.map((p) => p.project_id), [pid]);
  const stranger = await s.call('GET', '/api/dashboard', null, b.token);
  assert.equal(stranger.data.widgets, undefined, 'adding a widget never changes anyone else overview');
});

// ---------- saved layouts ----------
test('saved layouts: create, list per overview, update, rename, delete, with validation and private to the person', async () => {
  const a = await s.user('Layouts'), b = await s.user('Other');
  const layout = { order: ['kpi', 'radar', 'cw_123'], hidden: ['radar'], size: { kpi: 'l', radar: 'm', bogus: 'x' } };
  assert.equal((await s.call('POST', '/api/layouts', { scope: 'portfolio', name: '', layout }, a.token)).status, 400);
  assert.equal((await s.call('POST', '/api/layouts', { scope: 'nowhere', name: 'x', layout }, a.token)).status, 400);
  assert.equal((await s.call('POST', '/api/layouts', { scope: 'portfolio', name: 'x', layout: { order: ['<script>'], hidden: [] } }, a.token)).status, 400);
  assert.equal((await s.call('POST', '/api/layouts', { scope: 'portfolio', name: 'x'.repeat(41), layout }, a.token)).status, 400);
  const made = await s.call('POST', '/api/layouts', { scope: 'portfolio', name: 'Weekly review', layout }, a.token);
  assert.equal(made.status, 200);
  assert.deepEqual(made.data.layout.layout.size, { kpi: 'l', radar: 'm' }, 'unknown sizes are dropped');
  assert.equal((await s.call('POST', '/api/layouts', { scope: 'portfolio', name: 'WEEKLY review', layout }, a.token)).status, 409, 'names are unique ignoring case');
  assert.equal((await s.call('POST', '/api/layouts', { scope: 'project', name: 'Weekly review', layout }, a.token)).status, 200, 'the same name is fine on the other overview');
  assert.equal((await s.call('GET', '/api/layouts?scope=portfolio', null, a.token)).data.layouts.length, 1);
  assert.equal((await s.call('GET', '/api/layouts?scope=portfolio', null, b.token)).data.layouts.length, 0, 'private');
  assert.equal((await s.call('PUT', `/api/layouts/${made.data.layout.id}`, { name: 'x' }, b.token)).status, 404);
  assert.equal((await s.call('DELETE', `/api/layouts/${made.data.layout.id}`, null, b.token)).status, 404);
  const upd = await s.call('PUT', `/api/layouts/${made.data.layout.id}`, { name: 'Steering', layout: { order: ['kpi'], hidden: [], size: {} } }, a.token);
  assert.equal(upd.data.layout.name, 'Steering'); assert.deepEqual(upd.data.layout.layout.order, ['kpi']);
  assert.equal((await s.call('DELETE', `/api/layouts/${made.data.layout.id}`, null, a.token)).status, 200);
  assert.equal((await s.call('GET', '/api/layouts?scope=portfolio', null, a.token)).data.layouts.length, 0);
});

test('applying a layout adds the custom widgets it names and reports the ones that are gone', async () => {
  const a = await s.user('Maker'), b = await s.user('User');
  const w = await publish(a.token, { title: 'In a layout' });
  const draft = (await make(a.token, { title: 'Never published' })).data.widget;
  const r = await s.call('POST', '/api/widgets/install-many', { scope: 'portfolio', ids: [w.id, draft.id, 999999999, 'x'] }, b.token);
  assert.deepEqual(r.data.installed, [w.id]); assert.deepEqual(r.data.missing.sort((x, y) => x - y), [draft.id, 999999999].sort((x, y) => x - y));
  assert.equal((await s.call('GET', '/api/widgets/installed?scope=portfolio', null, b.token)).data.widgets.length, 1);
});

test('every widget route needs a signed in person', async () => {
  for (const [m, p] of [['GET', '/api/widgets'], ['GET', '/api/widgets/mine'], ['POST', '/api/widgets'], ['GET', '/api/widgets/datasets'], ['GET', '/api/layouts?scope=portfolio'], ['POST', '/api/widgets/1/install']]) {
    assert.equal((await s.call(m, p, m === 'POST' ? {} : null)).status, 401, m + ' ' + p);
  }
});
