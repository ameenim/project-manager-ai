'use strict';
// Suggested schedule from the Thinking Area: "create a schedule for this project" reads the scope, deliverables,
// requirements and payment milestones, builds phases of tasks, checks them with the real schedule engine, and prepares one
// card. The model is scripted, so these tests never reach the network and show what the server does with what a model says.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const gate = require('../server/chat/gate');
const skill = require('../server/chat/skill');
const prompt = require('../server/chat/prompt');
const help = require('../server/chat/help');
const tools = require('../server/chat/tools');

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

let s; const people = []; let turn = 0;
const person = async (name) => { if (people.length < 4) { people.push(await s.user(name)); return people[people.length - 1]; } return people[turn++ % people.length]; };
before(async () => { delete process.env.ANTHROPIC_API_KEY; s = await start({ chatModel: model }); });
after(() => s.close());
beforeEach(() => { sc.q.length = 0; sc.seen.length = 0; });

async function talk(tok, body) {
  const r = await fetch(s.base + '/api/chat/message', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === 'done');
  return { status: r.status, events, done, message: done && done.message };
}
// what the model was shown by its tools, parsed, in order
const shown = (call) => sc.seen[call].messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result').map((b) => { try { return JSON.parse(typeof b.content === 'string' ? b.content : b.content.map((c) => c.text).join('')); } catch (e) { return {}; } });
const lastShown = () => { const r = shown(sc.seen.length - 1); return r[r.length - 1] || {}; };
const sched = async (u, p) => (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data;
const addItem = async (u, p, kind, title, data) => (await s.call('POST', `/api/projects/${p.id}/items`, { kind, title, data: data || {} }, u.token)).data.item;

// A project that starts in the future, with a contract end, two deliverables, a requirement, a payment and a risk.
async function setup(over) {
  const u = await person('Planner'); const p = await s.project(u.token, 'Gen project ' + Math.random().toString(36).slice(2, 7));
  const put = await s.call('PUT', `/api/projects/${p.id}`, { start_date: '2027-03-01', end_date: over && over.end || '2027-06-30' }, u.token);
  assert.equal(put.status, 200);
  const d1 = await addItem(u, p, 'deliverable', 'Design pack', { due_date: over && over.d1 || '2027-03-31' });
  const d2 = await addItem(u, p, 'deliverable', 'Customer portal', { due_date: '2027-05-14' });
  const rq = await addItem(u, p, 'requirement', 'Arabic interface');
  const pay = await addItem(u, p, 'milestone', 'Final payment', { due_date: '2027-06-15', amount: 9000, deliverable_id: d2.id });
  const rk = await addItem(u, p, 'risk', 'Vendor delay', { probability: 'High', impact: 'High' });
  return { u, p, d1, d2, rq, pay, rk };
}
const plan = (x, over) => ({
  title: 'Delivery schedule', reason: 'Three phases from the deliverables. Durations are estimates.',
  phases: [
    { name: 'Initiation', tasks: [{ name: 'Kickoff', milestone: true }, { name: 'Gather requirements', duration: 5, owner: 'Sam', after: [{ task: 'Kickoff' }] }] },
    { name: 'Design and build', tasks: [
      { name: 'Design the interface', duration: over && over.design || 10, deliverable: String(x.d1.id), covers: [String(x.rq.id)], after: [{ task: 'Gather requirements' }] },
      { name: 'Build the portal', duration: over && over.build || 20, deliverable: 'Customer portal', covers: ['Vendor delay'], after: [{ task: 'Design the interface', lag: 2 }] },
    ] },
    { name: 'Handover', tasks: [{ name: 'User acceptance', duration: 5, after: [{ task: 'Build the portal' }] }, { name: 'Go live', milestone: true, covers: [String(x.pay.id)], after: [{ task: 'User acceptance' }] }] },
  ],
});
const propose = async (x, p, body, label) => {
  say(use('propose_new_schedule', body, 'p' + (label || 1))); say(text('Prepared.'));
  return talk(x.u.token, { project_id: x.p.id, text: 'Create a schedule for this project ' + (label || ''), screen: 'schedule' });
};

test('the request, the starter and the skill are all in place', () => {
  assert.equal(gate.decide('create a schedule for this project').decision, 'pass');
  assert.equal(gate.decide('Create a schedule based on the scope, deliverables and milestones').decision, 'pass');
  assert.ok(skill.partsFor('create a schedule for this project', 'overview').includes('schedule'));
  const t = skill.skillText('create a schedule for this project', 'overview');
  assert.match(t, /get_schedule_basis/); assert.match(t, /check_new_schedule/); assert.match(t, /propose_new_schedule/);
  assert.match(t, /Never write a date from your own calculation/);
  assert.ok(prompt.startersFor('en').some((x) => x.id === 'newschedule' && /schedule/i.test(x.q)));
  assert.ok(prompt.startersFor('ar').some((x) => x.id === 'newschedule'));
  assert.ok(prompt.SUGGESTIONS.schedule.en.includes('Create a schedule for this project') && prompt.SUGGESTIONS.schedule.ar.length === prompt.SUGGESTIONS.schedule.en.length);
  assert.ok(help.lookup('how do I create a schedule').some((x) => x.id === 'suggest_schedule'));
  assert.ok(tools.catalog(true).some((x) => x.name === 'propose_new_schedule') && !tools.catalog(false).some((x) => x.name === 'propose_new_schedule'), 'view only people cannot prepare it');
});

test('a new schedule is read, checked with the engine, shown as one card, applied once and undone completely', async () => {
  const x = await setup(); const { u, p } = x;
  const body = plan(x);
  say(use('get_schedule_basis', {}, 'g1')); say(use('check_new_schedule', body, 'c1')); say(use('propose_new_schedule', body, 'p1')); say(text('Here is the schedule.'));
  const r = await talk(u.token, { project_id: p.id, text: 'Create a schedule for this project', screen: 'schedule' });
  assert.ok(r.done, 'the turn finished');
  // the model saw the basis and the checked dates
  const basis = JSON.stringify(shown(1)[0]);
  for (const w of ['Design pack', 'Customer portal', 'Arabic interface', 'Final payment', 'Vendor delay', '2027-03-31']) assert.ok(basis.includes(w), 'the basis names ' + w);
  const checked = shown(2)[1];
  assert.equal(checked.valid, true); assert.ok(checked.plan_end && checked.plan_start === '2027-03-01'); assert.equal(checked.days_over_contract, 0);
  assert.deepEqual(checked.not_covered, { deliverables: [], payments: [], requirements: [] }, 'every deliverable, payment and requirement has a task');
  // nothing exists before Apply
  assert.equal((await sched(u, p)).tasks.length, 0);
  const card = r.message.card; assert.ok(card, 'one card');
  assert.equal(card.items.length, 1);
  const it = card.items[0];
  assert.equal(it.sum.op, 'new_schedule');
  assert.equal(it.plan.counts.phases, 3); assert.equal(it.plan.counts.tasks, 4); assert.equal(it.plan.counts.milestones, 2);
  assert.equal(it.plan.phases[0].name, 'Initiation'); assert.equal(it.plan.phases[1].tasks.length, 2);
  assert.equal(it.plan.start, '2027-03-01');
  assert.ok(it.plan.end && it.plan.end <= '2027-06-30', 'fits the contract end');
  assert.equal(it.plan.over_days, 0);
  const dd = it.plan.dates.find((d) => d.title === 'Design pack'); assert.ok(dd && dd.due === '2027-03-31' && dd.finish && dd.late_days === 0);
  assert.ok(it.plan.dates.some((d) => d.kind === 'payment' && d.title === 'Final payment'), 'the payment is checked through its deliverable and the go live task');
  assert.ok(card.strong, 'a large schedule needs the second confirmation');
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, {}, u.token)).status, 400, 'Apply needs the confirmation');
  assert.equal((await sched(u, p)).tasks.length, 0);

  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, { confirmed: true }, u.token)).status, 200);
  const after = await sched(u, p);
  const by = (n) => after.tasks.find((t) => t.name === n);
  assert.equal(after.tasks.length, 3 + 6, 'three phases and six tasks');
  // the structure
  const ph = by('Design and build'); assert.ok(ph.summary, 'a phase is a summary task');
  assert.equal(by('Design the interface').parent_id, ph.id); assert.equal(by('Kickoff').parent_id, by('Initiation').id);
  // the links, the deliverables and the covered items
  assert.deepEqual(by('Build the portal').deps.map((d) => [d.id, d.type, d.lag]), [[by('Design the interface').id, 'FS', 2]]);
  assert.equal(by('Design the interface').deliverable_id, x.d1.id); assert.equal(by('Build the portal').deliverable_id, x.d2.id);
  assert.deepEqual(by('Design the interface').links, [x.rq.id]); assert.deepEqual(by('Build the portal').links, [x.rk.id]); assert.deepEqual(by('Go live').links, [x.pay.id]);
  assert.equal(by('Gather requirements').assignee, 'Sam'); assert.equal(by('Kickoff').is_milestone, 1); assert.equal(by('Kickoff').duration, 0);
  // the dates on the card are the dates the Schedule screen shows
  for (const phase of it.plan.phases) for (const t of phase.tasks) { const k = by(t.name); assert.equal(k.start, t.start, t.name + ' start'); assert.equal(k.finish, t.finish, t.name + ' finish'); }
  assert.equal(by('Kickoff').start, '2027-03-01');
  assert.ok(by('Build the portal').start > by('Design the interface').finish, 'the link and its lag moved the task');
  // the schedule passes the platform's own check
  const v = (await s.call('GET', `/api/projects/${p.id}/schedule/validate`, null, u.token)).data;
  assert.equal(v.errors, 0, JSON.stringify(v.issues && v.issues.filter((i) => i.severity === 'error')));
  assert.equal(v.stats.coverage.deliverable.linked, 2);

  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/undo`, {}, u.token)).status, 200);
  assert.equal((await sched(u, p)).tasks.length, 0, 'undo removes every task the card created');
});

test('a plan that overruns the contract or finishes a deliverable late is still shown, with the facts', async () => {
  const x = await setup({ end: '2027-04-30', d1: '2027-03-10' }); const { u, p } = x;
  const r = await propose(x, p, plan(x, { design: 15, build: 30 }));
  const it = r.message.card.items[0];
  assert.ok(it.plan.over_days > 0, 'the end is after the contract end'); assert.equal(it.plan.contract_end, '2027-04-30');
  const d = it.plan.dates.find((q) => q.title === 'Design pack'); assert.ok(d.late_days > 0, 'Design pack lands after its due date');
  assert.ok(it.changes.some((c) => c.field === 'contract_end'));
  // the model is told, so it can say it
  const told = shown(1)[0];
  assert.ok(told.warnings.some((w) => /days after the contract end/.test(w)), 'the model is told the end is late');
  assert.ok(told.warnings.some((w) => /Design pack/.test(w)), 'the model is told which deliverable is late');
});

test('a plan with a mistake never makes a card, and the model is told what to fix', async () => {
  const x = await setup(); const { u, p } = x;
  const t = (name, extra) => ({ name, duration: 3, ...(extra || {}) });
  const cases = [
    ['no phases', { phases: [] }, /at least one phase/],
    ['a phase with no tasks', { phases: [{ name: 'Empty', tasks: [] }] }, /has no tasks/],
    ['a task twice', { phases: [{ name: 'A', tasks: [t('Same'), t('same')] }] }, /used twice/],
    ['a phase named like a task', { phases: [{ name: 'A', tasks: [t('Same')] }, { name: 'Same', tasks: [t('Other')] }] }, /used twice/],
    ['no duration', { phases: [{ name: 'A', tasks: [{ name: 'Work' }] }] }, /whole number of working days/],
    ['a predecessor that does not exist', { phases: [{ name: 'A', tasks: [t('Work', { after: [{ task: 'Ghost' }] })] }] }, /no task named "Ghost"/],
    ['a loop', { phases: [{ name: 'A', tasks: [t('One', { after: [{ task: 'Two' }] }), t('Two', { after: [{ task: 'One' }] })] }] }, /circular|loop/i],
    ['a link to itself', { phases: [{ name: 'A', tasks: [t('One', { after: [{ task: 'One' }] }), t('Two')] }] }, /itself/i],
    ['a bad link type', { phases: [{ name: 'A', tasks: [t('One'), t('Two', { after: [{ task: 'One', type: 'XX' }] })] }] }, /FS, SS, FF or SF/],
    ['an unknown deliverable', { phases: [{ name: 'A', tasks: [t('One', { deliverable: 'Nothing like it' })] }] }, /Nothing matches/],
    ['a bad start date', { start_date: 'soon', phases: [{ name: 'A', tasks: [t('One')] }] }, /date like/],
  ];
  for (const [name, body, why] of cases) {
    say(use('propose_new_schedule', body, 'x')); say(text('That plan is not valid.'));
    const r = await talk(u.token, { project_id: p.id, text: 'Create a schedule for this project, case ' + name });
    assert.equal(r.message.card, null, name + ' makes no card');
    assert.match(String(lastShown().error), why, name);
  }
  // more tasks than a schedule holds
  const many = { phases: [{ name: 'Big', tasks: Array.from({ length: 61 }, (_, i) => t('Task ' + i)) }] };
  say(use('propose_new_schedule', many, 'm')); say(text('Too many.'));
  assert.equal((await talk(u.token, { project_id: p.id, text: 'Create a schedule for this project, too many' })).message.card, null);
  assert.equal((await sched(u, p)).tasks.length, 0, 'nothing was created');
});

test('tasks that already exist stay as they are, are linked by exact name, and a name that is taken is refused', async () => {
  const x = await setup(); const { u, p } = x;
  const first = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Contract signed', duration: 1, start: '2027-03-01' }, u.token);
  const before = (await sched(u, p)).tasks.map((k) => [k.id, k.start, k.finish, k.duration, k.progress]);
  // a partial name does not link to the wrong task
  let r = await propose(x, p, { phases: [{ name: 'Start', tasks: [{ name: 'Mobilize', duration: 3, after: [{ task: 'Contract' }] }] }] }, 'partial');
  assert.equal(r.message.card, null);
  assert.match(String(lastShown().error), /no task named "Contract"/);
  // a name already used in the project
  r = await propose(x, p, { phases: [{ name: 'Start', tasks: [{ name: 'Contract signed', duration: 3 }] }] }, 'taken');
  assert.equal(r.message.card, null);
  assert.match(String(lastShown().error), /already exists/);
  // an exact name and an id both link
  r = await propose(x, p, { phases: [{ name: 'Start', tasks: [{ name: 'Mobilize', duration: 3, after: [{ task: 'contract signed' }] }, { name: 'Plan the work', duration: 2, after: [{ task: String(first.data.created) }] }] }] }, 'exact');
  assert.ok(r.message.card, 'links to existing tasks work');
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, { confirmed: true }, u.token)).status, 200);
  const after = await sched(u, p);
  assert.deepEqual(after.tasks.filter((k) => before.some((b) => b[0] === k.id)).map((k) => [k.id, k.start, k.finish, k.duration, k.progress]), before, 'the existing task did not change');
  const mob = after.tasks.find((k) => k.name === 'Mobilize'); assert.equal(mob.deps[0].id, first.data.created);
  assert.ok(mob.start > after.tasks.find((k) => k.id === first.data.created).finish);
});

test('a task with the same name added after the card was made blocks Apply, and nothing is created', async () => {
  const x = await setup(); const { u, p } = x;
  const r = await propose(x, p, plan(x), 'stale');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Kickoff', duration: 1, start: '2027-03-01' }, u.token);
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, { confirmed: true }, u.token)).status, 409);
  assert.equal((await sched(u, p)).tasks.length, 1, 'only the task added by hand');
});

test('Undo keeps recorded progress, and a deleted deliverable blocks Apply', async () => {
  const x = await setup(); const { u, p } = x;
  let r = await propose(x, p, plan(x), 'undo');
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, { confirmed: true }, u.token)).status, 200);
  const k = (await sched(u, p)).tasks.find((t) => t.name === 'Gather requirements');
  await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [k.id]: { progress: 50 } } }, u.token);
  await s.call('POST', `/api/chat/messages/${r.message.id}/undo`, {}, u.token);
  assert.equal((await sched(u, p)).tasks.length, 9, 'work already started is not deleted by Undo');
  // a second project: the deliverable is removed before Apply
  const y = await setup(); r = await propose(y, y.p, plan(y), 'gone');
  assert.equal((await s.call('DELETE', `/api/items/${y.d1.id}`, null, y.u.token)).status, 200);
  assert.equal((await s.call('POST', `/api/chat/messages/${r.message.id}/apply`, { confirmed: true }, y.u.token)).status, 409);
  assert.equal((await sched(y.u, y.p)).tasks.length, 0);
});

test('the basis stays inside what the model can read, even for a large project', async () => {
  const u = await person('Big'); const p = await s.project(u.token, 'Big basis');
  await s.call('PUT', `/api/projects/${p.id}`, { start_date: '2027-03-01', end_date: '2027-12-31' }, u.token);
  for (let i = 0; i < 30; i++) await addItem(u, p, 'deliverable', `Deliverable number ${i} with a fairly long descriptive title for the client`, { due_date: '2027-06-01' });
  for (let i = 0; i < 30; i++) await addItem(u, p, 'requirement', `Requirement ${i} the platform shall support a long list of capabilities in the first release`);
  for (let i = 0; i < 20; i++) await addItem(u, p, 'milestone', `Payment ${i} after acceptance of the work`, { due_date: '2027-07-01', percent: 5 });
  say(use('get_schedule_basis', {}, 'g')); say(text('Read.'));
  await talk(u.token, { project_id: p.id, text: 'Create a schedule for this project' });
  const toolResult = sc.seen[1].messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result');
  const raw = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
  assert.ok(raw.length < 14000, 'inside the limit the model is shown, ' + raw.length);
  const o = JSON.parse(typeof toolResult.content === 'string' ? toolResult.content : toolResult.content.map((c) => c.text).join(''));
  assert.ok(o.shown.deliverables !== undefined && o.deliverables.length > 0, 'the lists are cut and say how much is shown');
});
