'use strict';
// Thinking Area, the second set of tools: review, closure, the team list, report folders, templates, meetings, sync,
// saved views, widgets, notifications, support and new projects. The model is scripted, so no test reaches the network.
// Every write tool prepares a card, saves nothing before Apply, and Undo puts the earlier state back.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
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

let s;
before(async () => { delete process.env.ANTHROPIC_API_KEY; s = await start({ chatModel: model }); });
after(() => s.close());
beforeEach(() => { sc.q.length = 0; sc.seen.length = 0; });

// a message must read as project work, or the scope check asks the model first and the script is used up
const projectish = (t) => (/project/i.test(t) ? t : t + ' in my project');
async function talk(tok, body0) {
  const body = { ...body0, text: projectish(body0.text) };
  const r = await fetch(s.base + '/api/chat/message', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === 'done');
  return { status: r.status, events, done, message: done && done.message };
}
async function setup(name = 'More tools') { const u = await s.user('Planner'); const p = await s.project(u.token, name); return { u, p }; }
const api = (u, method, path, body) => s.call(method, path, body, u.token);
// one request: the model calls a tool, then answers. Returns the card message.
async function ask(u, p, name, input, words) {
  say(use(name, input, 't_' + name)); say(text('Prepared.'));
  const r = await talk(u.token, { project_id: p ? p.id : undefined, text: words || 'Please prepare this for my project' });
  sc.q.length = 0; // a refused card ends the turn early and leaves its closing line unused
  return r;
}
const apply = (u, r, body) => s.call('POST', `/api/chat/messages/${r.message.id}/apply`, body || {}, u.token);
const undo = (u, r) => s.call('POST', `/api/chat/messages/${r.message.id}/undo`, {}, u.token);
const op = (r) => r.message.card.items[0].sum.op;
// what the model saw in its last call, which carries the tool results of the turn
const toolResult = () => JSON.stringify(sc.seen[sc.seen.length - 1].messages).replace(/\\+"/g, '"');

test('every new tool has a schema, a handler and a place in the catalog', () => {
  const read = tools.catalog(false).map((t) => t.name), all = tools.catalog(true).map((t) => t.name);
  for (const n of ['get_closure_status', 'list_review_items', 'list_resources', 'list_members', 'list_reports', 'validate_schedule', 'get_trends', 'get_calendar', 'get_sync_status', 'test_connection', 'list_notifications', 'list_log_views', 'search_widgets', 'list_tickets']) {
    assert.ok(read.includes(n), n + ' is a read tool'); assert.equal(typeof tools.READ[n], 'function', n);
  }
  for (const n of ['review_item', 'update_closure', 'close_project', 'reopen_project', 'create_resource', 'update_resource', 'delete_resource', 'add_team_from_schedule', 'update_report', 'delete_report', 'create_folder', 'rename_folder', 'delete_folder', 'update_template', 'delete_template', 'update_meeting', 'rename_speakers', 'regenerate_minutes', 'restore_update', 'run_sync', 'set_sync_schedule', 'choose_jira_site', 'reorder_task', 'save_log_view', 'delete_log_view', 'mark_notifications', 'install_widget', 'uninstall_widget', 'delete_widget', 'delete_layout', 'create_project', 'create_support_ticket']) {
    assert.ok(all.includes(n), n + ' is a write tool'); assert.ok(tools.WRITE_NAMES.has(n), n); assert.equal(typeof tools.WRITE[n], 'function', n);
    assert.ok(!read.includes(n) || tools.USER_LEVEL.has(n), n + ' is hidden from a person who can only read');
  }
  // the old tools are still there
  for (const n of ['create_item', 'set_baseline', 'create_widget', 'navigate']) assert.ok(all.includes(n), n);
});

test('actions and decisions can be logged from the chat and the tool names every screen', async () => {
  const { u, p } = await setup();
  let r = await ask(u, p, 'create_item', { kind: 'action', title: 'Send the kickoff notes', owner: 'Sara', due_date: '2027-02-01' }, 'Log an action to send the kickoff notes');
  assert.equal(op(r), 'create_item'); assert.equal((await apply(u, r)).status, 200);
  const items = (await api(u, 'GET', `/api/projects/${p.id}/items`)).data.items;
  assert.ok(items.some((i) => i.kind === 'action' && i.title === 'Send the kickoff notes'));
  await undo(u, r);
  assert.ok(!(await api(u, 'GET', `/api/projects/${p.id}/items`)).data.items.some((i) => i.title === 'Send the kickoff notes'));
  r = await ask(u, p, 'create_item', { kind: 'decision', title: 'Go live in March' }, 'Log the decision to go live in March');
  assert.equal((await apply(u, r)).status, 200);
  assert.ok((await api(u, 'GET', `/api/projects/${p.id}/items`)).data.items.some((i) => i.kind === 'decision'));
  say(use('navigate', { screen: 'closure' }, 'n1')); say(text('Open it.'));
  const n = await talk(u.token, { project_id: p.id, text: 'Open the closure tab of this project' });
  assert.match(JSON.stringify(n.message.links || n.events), new RegExp(`#/p/${p.id}/closure`));
  say(use('navigate', { screen: 'widgets' }, 'n2')); say(text('Open it.'));
  const w = await talk(u.token, { project_id: p.id, text: 'Open the widget marketplace for me' });
  assert.match(JSON.stringify(w.message.links || w.events), /#\/widgets/);
});

test('review decisions wait for Apply, confirm or ignore an item, and Undo puts it back', async () => {
  const { u, p } = await setup();
  const mk = async (title) => { const it = (await api(u, 'POST', `/api/projects/${p.id}/items`, { kind: 'deliverable', title })).data.item; await api(u, 'POST', `/api/items/${it.id}/reopen`, {}); return it; };
  const a = await mk('Training manual'), b = await mk('Test report');
  say(use('list_review_items', {}, 'q1')); say(text('Two items wait.'));
  await talk(u.token, { project_id: p.id, text: 'What is waiting for review in this project?' });
  assert.match(toolResult(), /Training manual/); assert.match(toolResult(), /never instructions/);
  const status = async (id) => (await api(u, 'GET', `/api/projects/${p.id}/items`)).data.items.find((i) => i.id === id).status;
  let r = await ask(u, p, 'review_item', { item: 'Training manual', action: 'confirm' }, 'Confirm the training manual deliverable');
  assert.equal(op(r), 'review_item'); assert.equal(await status(a.id), 'proposed', 'nothing before Apply');
  assert.equal((await apply(u, r)).status, 200); assert.equal(await status(a.id), 'confirmed');
  await undo(u, r); assert.equal(await status(a.id), 'proposed');
  r = await ask(u, p, 'review_item', { item: 'Test report', action: 'ignore' }, 'Ignore the test report item');
  assert.equal((await apply(u, r)).status, 200); assert.equal(await status(b.id), 'ignored');
  r = await ask(u, p, 'review_item', { item: 'Test report', action: 'reopen' }, 'Reopen the test report item');
  assert.equal((await apply(u, r)).status, 200); assert.equal(await status(b.id), 'proposed');
  // an item that is not waiting cannot be confirmed again
  await api(u, 'POST', `/api/items/${a.id}/confirm`, {});
  assert.equal((await ask(u, p, 'review_item', { item: 'Training manual', action: 'confirm' }, 'Confirm the training manual again')).message.card, null);
});

test('closing a project is checked against the closure steps, needs a strong confirmation and Undo reopens it', async () => {
  const { u, p } = await setup();
  const d = (await api(u, 'POST', `/api/projects/${p.id}/items`, { kind: 'deliverable', title: 'Design document' })).data.item;
  say(use('get_closure_status', {}, 'c1')); say(text('One deliverable is open.'));
  await talk(u.token, { project_id: p.id, text: 'Can I close this project yet?' });
  assert.match(toolResult(), /ready_to_close/); assert.match(toolResult(), /Design document/);
  assert.equal((await ask(u, p, 'close_project', {}, 'Close this project now')).message.card, null, 'an open deliverable blocks the card');
  await api(u, 'PUT', `/api/items/${d.id}`, { state: 'closed' });
  let r = await ask(u, p, 'update_closure', { accepted_by: 'Dana Client', accepted_on: '2027-03-01', note: 'Signed off' }, 'Record the client acceptance by Dana Client on 2027-03-01');
  assert.equal(op(r), 'update_closure'); assert.equal((await apply(u, r)).status, 200);
  assert.equal((await api(u, 'GET', `/api/projects/${p.id}/closure`)).data.accepted_by, 'Dana Client');
  await undo(u, r); assert.equal((await api(u, 'GET', `/api/projects/${p.id}/closure`)).data.accepted_by, '');
  r = await ask(u, p, 'close_project', {}, 'Close this project now');
  assert.equal(op(r), 'close_project'); assert.equal(r.message.card.strong, true);
  assert.equal((await apply(u, r)).status, 400, 'a destructive card needs the second confirmation');
  assert.equal((await apply(u, r, { confirmed: true })).status, 200);
  assert.equal((await api(u, 'GET', `/api/projects/${p.id}`)).data.project.status, 'closed');
  r = await ask(u, p, 'reopen_project', { reason: 'The client asked for more' }, 'Reopen this project because the client asked for more');
  assert.equal((await apply(u, r)).status, 200); assert.equal((await api(u, 'GET', `/api/projects/${p.id}`)).data.project.status, 'active');
  await undo(u, r); assert.equal((await api(u, 'GET', `/api/projects/${p.id}`)).data.project.status, 'closed');
  assert.equal((await ask(u, p, 'reopen_project', { reason: 'x' }, 'Reopen this project please')).message.card, null, 'a short reason is turned back');
});

test('the team list is read, changed after Apply, refuses duplicates, and fills from the schedule owners', async () => {
  const { u, p } = await setup();
  let r = await ask(u, p, 'create_resource', { name: 'Sara Khan', role: 'Tester', organization: 'Acme' }, 'Add Sara Khan to the team list as a tester');
  assert.equal((await api(u, 'GET', `/api/projects/${p.id}/resources`)).data.resources.length, 0);
  assert.equal((await apply(u, r)).status, 200);
  const list = async () => (await api(u, 'GET', `/api/projects/${p.id}/resources`)).data.resources;
  assert.equal((await list())[0].role, 'Tester');
  assert.equal((await ask(u, p, 'create_resource', { name: 'sara khan' }, 'Add sara khan to the team list')).message.card, null, 'a duplicate is turned back');
  say(use('list_resources', {}, 'l1')); say(text('One person.')); await talk(u.token, { project_id: p.id, text: 'Show the team list of this project' });
  assert.match(toolResult(), /Sara Khan/); assert.doesNotMatch(toolResult(), /@/, 'no email address is returned');
  const u2 = await ask(u, p, 'update_resource', { resource: 'Sara Khan', role: 'Lead tester' }, 'Update Sara Khan on the team list to lead tester');
  assert.equal((await apply(u, u2)).status, 200); assert.equal((await list())[0].role, 'Lead tester');
  await undo(u, u2); assert.equal((await list())[0].role, 'Tester');
  const del = await ask(u, p, 'delete_resource', { resource: 'Sara Khan' }, 'Remove Sara Khan from the team list');
  assert.equal(del.message.card.strong, true); assert.equal((await apply(u, del, { confirmed: true })).status, 200); assert.equal((await list()).length, 0);
  await undo(u, del); assert.equal((await list()).length, 1);
  await api(u, 'POST', `/api/projects/${p.id}/tasks`, { name: 'Build the module', assignee: 'Omar Ali' });
  const f = await ask(u, p, 'add_team_from_schedule', {}, 'Add the owners found in the schedule to the team list');
  assert.equal(op(f), 'add_team'); assert.equal((await apply(u, f)).status, 200);
  assert.ok((await list()).some((x) => x.name === 'Omar Ali'));
  await undo(u, f); assert.ok(!(await list()).some((x) => x.name === 'Omar Ali'));
});

test('generated documents are renamed, filed in folders and deleted only after Apply, and Undo brings each back', async () => {
  const { u, p } = await setup();
  const g = (await api(u, 'POST', `/api/projects/${p.id}/generate`, { type: 'charter', format: 'docx' })).data.generated;
  assert.ok(g && g.id);
  let r = await ask(u, p, 'create_folder', { name: 'Client pack' }, 'Create a folder called Client pack for the reports');
  assert.equal((await apply(u, r)).status, 200);
  const folders = async () => (await api(u, 'GET', `/api/projects/${p.id}/folders`)).data.folders;
  const gen = async () => (await api(u, 'GET', `/api/projects/${p.id}/generated`)).data.generated.find((x) => x.id === g.id);
  assert.equal((await folders()).length, 1);
  const fid = (await folders())[0].id;
  r = await ask(u, p, 'update_report', { report: g.title, title: 'Charter v2', folder: 'Client pack' }, 'Rename the charter to Charter v2 and file it in Client pack');
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await gen()).title, 'Charter v2'); assert.equal((await gen()).folder_id, fid);
  await undo(u, r); assert.equal((await gen()).title, g.title); assert.ok((await gen()).folder_id == null);
  await apply(u, await ask(u, p, 'update_report', { report: g.title, folder: 'Client pack' }, 'File the charter in Client pack'));
  r = await ask(u, p, 'rename_folder', { folder: 'Client pack', name: 'Client pack 2027' }, 'Rename the Client pack folder to Client pack 2027');
  assert.equal((await apply(u, r)).status, 200); assert.equal((await folders())[0].name, 'Client pack 2027');
  await undo(u, r); assert.equal((await folders())[0].name, 'Client pack');
  r = await ask(u, p, 'delete_folder', { folder: 'Client pack' }, 'Delete the Client pack folder');
  assert.equal((await apply(u, r, { confirmed: true })).status, 200);
  assert.equal((await folders()).length, 0); assert.ok((await gen()).folder_id == null, 'the document moved to Unfiled');
  await undo(u, r); assert.equal((await folders()).length, 1); assert.equal((await gen()).folder_id, (await folders())[0].id, 'the document went back into the folder');
  say(use('list_reports', {}, 'lr')); say(text('One document.')); await talk(u.token, { project_id: p.id, text: 'Which reports have been generated for this project?' });
  assert.match(toolResult(), /Client pack/); assert.match(toolResult(), /standard_types/);
  r = await ask(u, p, 'delete_report', { report: g.title }, 'Delete the charter document');
  assert.equal(r.message.card.strong, true); assert.equal((await apply(u, r, { confirmed: true })).status, 200); assert.equal(await gen(), undefined);
  await undo(u, r); assert.ok(await gen(), 'the document is back');
});

test('a template is renamed, its sections changed, and deleted only after Apply, with Undo for each', async () => {
  const { u } = await setup();
  const fd = new FormData(); fd.append('name', 'Weekly pack'); fd.append('doc_type', 'progress_weekly'); fd.append('body', '# Summary\n\n# Risks\n\n# Next steps\n');
  const t = (await api(u, 'POST', '/api/templates', fd)).data.template; assert.ok(t.id);
  const get = async () => (await api(u, 'GET', `/api/templates/${t.id}`)).data.template;
  let r = await ask(u, null, 'update_template', { template: 'Weekly pack', name: 'Weekly pack v2', sections: ['Summary', 'Risks', 'Decisions'] }, 'Rename the weekly pack template and change its sections');
  assert.equal(op(r), 'update_template'); assert.equal((await get()).name, 'Weekly pack');
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await get()).name, 'Weekly pack v2'); assert.deepEqual((await get()).sections, ['Summary', 'Risks', 'Decisions']);
  await undo(u, r); assert.equal((await get()).name, 'Weekly pack'); assert.deepEqual((await get()).sections, ['Summary', 'Risks', 'Next steps']);
  r = await ask(u, null, 'delete_template', { template: 'Weekly pack' }, 'Delete the weekly pack template');
  assert.equal((await apply(u, r, { confirmed: true })).status, 200);
  const list = async () => (await api(u, 'GET', '/api/templates')).data.templates;
  assert.equal((await list()).length, 0);
  await undo(u, r); const back = await list(); assert.equal(back.length, 1); assert.equal(back[0].name, 'Weekly pack'); assert.equal(back[0].doc_type, 'progress_weekly');
});

const MINUTES = { summary: 'We agreed the rollout.', actions: [{ id: 'a1', title: 'Share the plan', owner: 'Ali' }], decisions: [], risks: [], updates: [] };
test('a meeting is edited after Apply, and a section of its minutes cannot be rewritten before the minutes exist', async () => {
  const { u, p } = await setup();
  const m = (await api(u, 'POST', `/api/projects/${p.id}/meetings`, { title: 'Weekly sync', source: 'notes' })).data.meeting;
  await api(u, 'PUT', `/api/meetings/${m.id}/minutes`, { minutes: MINUTES });
  const get = async () => (await api(u, 'GET', `/api/meetings/${m.id}`)).data.meeting;
  let r = await ask(u, p, 'update_meeting', { meeting: m.id, title: 'Weekly rollout sync', notes: 'Bring the plan' }, 'Rename the weekly sync meeting to Weekly rollout sync');
  assert.equal(op(r), 'update_meeting'); assert.equal((await get()).title, 'Weekly sync');
  assert.equal((await apply(u, r)).status, 200); assert.equal((await get()).title, 'Weekly rollout sync'); assert.equal((await get()).notes, 'Bring the plan');
  await undo(u, r); assert.equal((await get()).title, 'Weekly sync'); assert.equal((await get()).notes || '', '');
  say(use('rename_speakers', { meeting: m.id, renames: [{ speaker: 'S9', name: 'Ali' }] }, 'sp')); say(text('That speaker is not in the meeting.'));
  assert.equal((await talk(u.token, { project_id: p.id, text: 'Rename speaker S9 in the weekly sync meeting to Ali' })).message.card, null);
  const empty = (await api(u, 'POST', `/api/projects/${p.id}/meetings`, { title: 'Empty meeting', source: 'notes' })).data.meeting;
  say(use('regenerate_minutes', { meeting: empty.id, section: 'actions' }, 'rg')); say(text('There is nothing to write from.'));
  assert.equal((await talk(u.token, { project_id: p.id, text: 'Write the actions of the empty meeting minutes again' })).message.card, null);
});

test('a dismissed update comes back after Apply, and Undo dismisses it again', async () => {
  const { u, p } = await setup();
  await api(u, 'POST', `/api/projects/${p.id}/messages`, { body: 'The vendor will be late with the hardware by two weeks.', sender: 'Vendor', subject: 'Hardware delay' });
  const row = (await api(u, 'GET', `/api/projects/${p.id}/inbox`)).data.inbox[0]; assert.ok(row);
  await api(u, 'POST', `/api/inbox/${row.id}/dismiss`, {});
  const status = async () => (await api(u, 'GET', `/api/projects/${p.id}/inbox`)).data.inbox.find((x) => x.id === row.id).status;
  assert.equal(await status(), 'dismissed');
  const r = await ask(u, p, 'restore_update', { update: 'hardware' }, 'Bring back the dismissed hardware update');
  assert.equal(op(r), 'restore_update'); assert.equal(await status(), 'dismissed');
  assert.equal((await apply(u, r)).status, 200); assert.equal(await status(), 'pending');
  await undo(u, r); assert.equal(await status(), 'dismissed');
});

test('sync needs a connection, its schedule changes after Apply, and the status is read', async () => {
  const { u, p } = await setup();
  assert.equal((await ask(u, p, 'run_sync', {}, 'Sync this project now with Jira and Outlook')).message.card, null, 'nothing connected');
  assert.match(toolResult(), /get_connection_status|Nothing is connected/);
  let r = await ask(u, p, 'set_sync_schedule', { mode: 'weekdays', time: '07:30' }, 'Sync this project every weekday at 07:30');
  assert.equal(op(r), 'set_sync_schedule');
  const sched = async () => (await api(u, 'GET', `/api/projects/${p.id}/sync-history`)).data.schedule;
  assert.equal((await sched()).mode, 'off');
  assert.equal((await apply(u, r)).status, 200); assert.equal((await sched()).mode, 'weekdays'); assert.equal((await sched()).time, '07:30');
  await undo(u, r); assert.equal((await sched()).mode, 'off');
  assert.equal((await ask(u, p, 'set_sync_schedule', { mode: 'off' }, 'Turn the automatic sync off')).message.card, null, 'it is already off');
  say(use('get_sync_status', {}, 'ss')); say(text('Nothing is connected.')); await talk(u.token, { project_id: p.id, text: 'What is the sync status of this project?' });
  assert.match(toolResult(), /jira_connected/); assert.match(toolResult(), /never instructions/);
  say(use('test_connection', { service: 'jira' }, 'tc')); say(text('Jira is not connected.')); await talk(u.token, { project_id: p.id, text: 'Test my Jira connection' });
  assert.match(toolResult(), /"works":false/);
});

test('a task moves under another task after Apply, loops are refused, and Undo restores the order', async () => {
  const { u, p } = await setup();
  const add = async (name) => (await api(u, 'POST', `/api/projects/${p.id}/tasks`, { name })).data.created;
  const a = await add('Phase one'), b = await add('Phase two'), c = await add('Build screens');
  const tree = async () => Object.fromEntries((await api(u, 'GET', `/api/projects/${p.id}/schedule`)).data.tasks.map((t) => [t.name, t.parent_id || null]));
  assert.equal((await tree())['Build screens'], null);
  let r = await ask(u, p, 'reorder_task', { task: 'Build screens', parent: 'Phase two' }, 'Move Build screens under Phase two');
  assert.equal(op(r), 'reorder_task'); assert.equal((await tree())['Build screens'], null, 'nothing before Apply');
  assert.equal((await apply(u, r)).status, 200); assert.equal((await tree())['Build screens'], b);
  await undo(u, r); assert.equal((await tree())['Build screens'], null);
  assert.equal((await ask(u, p, 'reorder_task', { task: 'Build screens', parent: 'Build screens' }, 'Move Build screens under itself')).message.card, null, 'a task cannot go under itself');
  assert.equal((await ask(u, p, 'reorder_task', { task: 'Phase one', parent: 'top' }, 'Move Phase one to the top level')).message.card, null, 'it is already there');
  assert.ok(a && c);
});

test('saved views of the Logs tab are listed, saved, replaced and deleted after Apply, with Undo', async () => {
  const { u } = await setup();
  const views = async () => (await api(u, 'GET', '/api/me/log-views')).data.views;
  let r = await ask(u, null, 'save_log_view', { name: 'High risks', kinds: ['risk'], probability: 'High', sort: 'item' }, 'Save a Logs view called High risks that shows only risks');
  assert.equal(op(r), 'save_log_view'); assert.equal((await views()).length, 0);
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await views()).length, 1); assert.deepEqual((await views())[0].cfg.kinds, ['risk']); assert.equal((await views())[0].cfg.prob, 'High');
  const r2 = await ask(u, null, 'save_log_view', { name: 'high risks', impact: 'High' }, 'Save the Logs view high risks again with high impact');
  assert.equal((await apply(u, r2)).status, 200); assert.equal((await views()).length, 1, 'the same name replaces'); assert.equal((await views())[0].cfg.imp, 'High');
  await undo(u, r2); assert.equal((await views())[0].cfg.imp, '');
  say(use('list_log_views', {}, 'lv')); say(text('One view.')); await talk(u.token, { text: 'Which Logs views have I saved?' });
  assert.match(toolResult(), /High risks/);
  const d = await ask(u, null, 'delete_log_view', { view: 'High risks' }, 'Delete the Logs view High risks');
  assert.equal((await apply(u, d)).status, 200); assert.equal((await views()).length, 0);
  await undo(u, d); assert.equal((await views()).length, 1);
});

test('widgets are searched, added to an overview, removed and deleted only after Apply, with Undo', async () => {
  const { u } = await setup();
  const spec = { dataset: 'tasks', viz: 'kpi', agg: 'count' };
  const w = (await api(u, 'POST', '/api/widgets', { title: 'Task counter', description: 'Counts tasks', group: 'delivery', spec })).data.widget; assert.ok(w && w.id);
  say(use('search_widgets', { source: 'mine' }, 'sw')); say(text('Nothing published.')); await talk(u.token, { text: 'Search the widgets I built' });
  assert.match(toolResult(), /widgets/);
  const added = async (scope) => ((await api(u, 'GET', `/api/widgets/installed?scope=${scope}`)).data.widgets || []).some((x) => x.id === w.id);
  let r = await ask(u, null, 'install_widget', { widget: 'Task counter', scope: 'portfolio' }, 'Add the Task counter widget to the portfolio overview');
  assert.equal(await added('portfolio'), false); assert.equal((await apply(u, r)).status, 200); assert.equal(await added('portfolio'), true);
  await undo(u, r); assert.equal(await added('portfolio'), false);
  await apply(u, await ask(u, null, 'install_widget', { widget: 'Task counter', scope: 'portfolio' }, 'Add the Task counter widget to the portfolio overview'));
  r = await ask(u, null, 'uninstall_widget', { widget: 'Task counter', scope: 'portfolio' }, 'Remove the Task counter widget from the portfolio overview');
  assert.equal((await apply(u, r)).status, 200); assert.equal(await added('portfolio'), false);
  await undo(u, r); assert.equal(await added('portfolio'), true);
  r = await ask(u, null, 'delete_widget', { widget: 'Task counter' }, 'Delete the Task counter widget I built');
  assert.equal(r.message.card.strong, true); assert.equal((await apply(u, r, { confirmed: true })).status, 200);
  assert.equal(((await api(u, 'GET', '/api/widgets/mine')).data.widgets || []).length, 0);
  await undo(u, r); const back = (await api(u, 'GET', '/api/widgets/mine')).data.widgets; assert.equal(back.length, 1); assert.equal(back[0].title, 'Task counter');
});

test('a saved layout is deleted after Apply and Undo saves it again', async () => {
  const { u } = await setup();
  await api(u, 'POST', '/api/layouts', { scope: 'portfolio', name: 'Monday view', layout: { order: ['kpi', 'radar'], hidden: [], size: {} } });
  const layouts = async () => (await api(u, 'GET', '/api/layouts?scope=portfolio')).data.layouts;
  assert.equal((await layouts()).length, 1);
  const r = await ask(u, null, 'delete_layout', { scope: 'portfolio', layout: 'Monday view' }, 'Delete my Monday view layout');
  assert.equal((await apply(u, r)).status, 200); assert.equal((await layouts()).length, 0);
  await undo(u, r); assert.equal((await layouts()).length, 1); assert.equal((await layouts())[0].name, 'Monday view');
});

test('a project is created from the chat, even by a person with no project yet, and Undo removes it only while it is empty', async () => {
  const u = await s.user('Fresh');
  const r = await ask(u, null, 'create_project', { name: 'Harbor upgrade', client: 'Port Authority', currency: 'usd', value: 250000, start_date: '2027-01-10', end_date: '2027-09-30' }, 'Create a new project called Harbor upgrade for Port Authority');
  assert.equal(op(r), 'create_project'); assert.equal((await api(u, 'GET', '/api/projects')).data.projects.length, 0, 'nothing before Apply');
  assert.equal((await apply(u, r)).status, 200);
  const list = (await api(u, 'GET', '/api/projects')).data.projects; assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Harbor upgrade'); assert.equal(list[0].client, 'Port Authority'); assert.equal(list[0].currency, 'USD'); assert.equal(list[0].value, 250000); assert.equal(list[0].end_date, '2027-09-30');
  await undo(u, r); assert.equal((await api(u, 'GET', '/api/projects')).data.projects.length, 0, 'an empty project is removed');
  const r2 = await ask(u, null, 'create_project', { name: 'Second project' }, 'Create a new project called Second project');
  await apply(u, r2);
  const id = (await api(u, 'GET', '/api/projects')).data.projects[0].id;
  await api(u, 'POST', `/api/projects/${id}/tasks`, { name: 'First task' });
  await undo(u, r2); assert.equal((await api(u, 'GET', '/api/projects')).data.projects.length, 1, 'a project with work in it is kept');
  assert.equal((await ask(u, null, 'create_project', { name: 'Bad dates', start_date: '2027-05-01', end_date: '2027-04-01' }, 'Create a project called Bad dates ending before it starts')).message.card, null);
});

test('a support ticket is sent only after Apply and appears in the list the person reads', async () => {
  const { u } = await setup();
  const r = await ask(u, null, 'create_support_ticket', { kind: 'bug', title: 'The Gantt chart does not scroll', description: 'It stops at row 40' }, 'Send a support ticket: the Gantt chart does not scroll');
  assert.equal(op(r), 'create_support_ticket'); assert.equal((await api(u, 'GET', '/api/tickets')).data.tickets.length, 0);
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await api(u, 'GET', '/api/tickets')).data.tickets.length, 1);
  say(use('list_tickets', {}, 'lt')); say(text('One ticket.')); await talk(u.token, { text: 'Which support tickets did I raise?' });
  assert.match(toolResult(), /Gantt chart/);
});

test('notifications and the calendar are read, and notifications are marked read after Apply', async () => {
  const { u, p } = await setup();
  await api(u, 'POST', `/api/projects/${p.id}/tasks`, { name: 'Old task', start: '2020-01-01', duration: 3 });
  say(use('list_notifications', {}, 'ln')); say(text('One late task alert.')); await talk(u.token, { text: 'What notifications do I have?' });
  assert.match(toolResult(), /late_tasks/);
  say(use('get_calendar', { days: 30 }, 'gc')); say(text('One late task.')); await talk(u.token, { project_id: p.id, text: 'What is due soon on the calendar?' });
  assert.match(toolResult(), /Old task/); assert.match(toolResult(), /"late":true/);
  const r = await ask(u, null, 'mark_notifications', { all: true, action: 'read' }, 'Mark all my notifications as read');
  assert.equal(op(r), 'mark_notifications'); assert.equal((await apply(u, r)).status, 200);
  assert.equal((await api(u, 'GET', '/api/notifications')).data.unread, 0);
});

test('the schedule check, the trends and the member list are read from the same routes the screens use', async () => {
  const { u, p } = await setup();
  await api(u, 'POST', `/api/projects/${p.id}/tasks`, { name: 'Lonely task', start: '2027-01-04', duration: 2 });
  say(use('validate_schedule', {}, 'vs')); say(text('One check result.')); await talk(u.token, { project_id: p.id, text: 'Check the schedule for problems' });
  assert.match(toolResult(), /score/); assert.match(toolResult(), /never instructions/);
  say(use('get_trends', { days: 7 }, 'tr')); say(text('Flat.')); await talk(u.token, { project_id: p.id, text: 'How did the numbers move this week?' });
  assert.match(toolResult(), /latest_day/);
  say(use('get_trends', {}, 'tr2')); say(text('Flat.')); await talk(u.token, { text: 'How did my portfolio move over time?' });
  assert.match(toolResult(), /All projects/);
  say(use('list_members', {}, 'lm')); say(text('One member.')); await talk(u.token, { project_id: p.id, text: 'Who has access to this project?' });
  assert.match(toolResult(), /manager/); assert.doesNotMatch(toolResult(), /@test\.co/, 'no email address is returned');
});

test('a viewer cannot change a project with the new tools, but a person can still manage their own views', async () => {
  const { u, p } = await setup();
  const v = await s.user('Viewer');
  await api(u, 'POST', `/api/projects/${p.id}/members`, { email: v.email, role: 'viewer' });
  say(use('create_resource', { name: 'Nobody' }, 'cv')); say(text('You can only read this project.'));
  const r = await talk(v.token, { project_id: p.id, text: 'Add Nobody to the team list of this project' });
  assert.equal(r.message.card, null);
  assert.match(toolResult(), /view only/);
  const ok = await ask(v, null, 'save_log_view', { name: 'My view', kinds: ['risk'] }, 'Save a Logs view called My view that shows only risks');
  assert.equal(op(ok), 'save_log_view'); assert.equal((await apply(v, ok)).status, 200);
});

test('the scope check lets a team list role pass but still sends access changes to Settings', () => {
  const gate = require('../server/chat/gate');
  assert.equal(gate.decide('Change the role of Sara Khan to lead tester on the team list').decision, 'pass');
  assert.equal(gate.decide('Remove Sara from the team list').decision, 'pass');
  assert.equal(gate.decide('Change the role of Sara to editor').reason, 'administration');
  assert.equal(gate.decide('Add a member to this project').reason, 'administration');
  assert.equal(gate.decide('Close the project').decision, 'pass');
});

test('the help topic and the skill name the new areas, and the closure part loads on the Settings screen', () => {
  const help = require('../server/chat/help'), skill = require('../server/chat/skill');
  assert.ok(help.lookup('which actions can the thinking area do on every screen').some((x) => x.id === 'chat_actions'));
  assert.ok(skill.partsFor('hello', 'settings').includes('closure'));
  assert.ok(skill.partsFor('add Sara to the team list', 'overview').includes('team'));
  assert.ok(skill.skillText('sync now', 'overview').includes('set_sync_schedule'));
});
