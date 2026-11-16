'use strict';
// Thinking Area: documents made in All projects. A document no longer needs a project first. It is created as a draft that stays
// on its card. A document about one project can then be saved to that project, and a portfolio document, which covers several
// projects, cannot. The model is scripted, so no test reaches the network.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

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

async function talk(tok, body) {
  const r = await fetch(s.base + '/api/chat/message', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === 'done');
  return { status: r.status, events, done, message: done && done.message };
}
const SECTIONS = [{ heading: 'Overview', guidance: 'Where the portfolio stands' }, { heading: 'Risks', guidance: 'The main risks' }, { heading: 'Next steps', guidance: 'Actions and owners' }];
async function setup() { const u = await s.user('Planner'); const a = await s.project(u.token, 'Alpha'); const b = await s.project(u.token, 'Beta'); return { u, a, b }; }
const call = (u, method, path, body) => s.call(method, path, body, u.token);
// the model prepares a document in All projects (no project in the chat) and the card is returned
async function prepare(u, input, words, tool = 'create_custom_document') {
  say(use(tool, input, 't_doc')); say(text('Prepared the document.'));
  const r = await talk(u.token, { text: words || 'Create a report for my projects' });
  sc.q.length = 0;
  return r;
}
const apply = (u, r) => call(u, 'POST', `/api/chat/messages/${r.message.id}/apply`, {});
const cardOf = async (u, r) => (await call(u, 'GET', '/api/chat')).data.messages.find((m) => m.id === r.message.id).card;
const generatedOf = async (u, p) => (await call(u, 'GET', `/api/projects/${p.id}/generated`)).data.generated;

test('a portfolio document needs no project, is created as a draft and cannot be saved to a project', async () => {
  const { u, a, b } = await setup();
  const r = await prepare(u, { name: 'Portfolio status report', audience: 'Executive team', description: 'Where all projects stand', sections: SECTIONS, format: 'docx' }, 'Create a portfolio report for all my projects');
  assert.ok(r.message.card, 'a card is prepared without a project');
  assert.equal(r.message.card.items[0].sum.op, 'generate');
  assert.deepEqual(r.message.card.projects, []);
  const ap = await apply(u, r);
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  // nothing was filed in any project
  assert.equal((await generatedOf(u, a)).length, 0); assert.equal((await generatedOf(u, b)).length, 0);
  const card = await cardOf(u, r);
  assert.equal(card.drafts.length, 1);
  assert.equal(card.drafts[0].related_project_id, null);
  assert.equal(card.drafts[0].saved, null);
  assert.ok(!JSON.stringify(card).includes('| Project | Client'), 'the card list never carries the document text');
  // the draft is read from the card and holds a real portfolio table of both projects
  const g = (await call(u, 'GET', `/api/chat/messages/${r.message.id}/drafts/0`)).data.generated;
  assert.equal(g.title, 'Portfolio status report');
  assert.match(g.content, /# Overview/); assert.match(g.content, /Alpha/); assert.match(g.content, /Beta/);
  assert.equal(g.meta.project, 'Portfolio'); assert.equal(g.format, 'docx');
  // a portfolio document has no related project, so saving is refused
  const save = await call(u, 'POST', `/api/chat/messages/${r.message.id}/drafts/0/save`, {});
  assert.equal(save.status, 409); assert.match(save.data.error, /more than one project/);
  assert.equal((await generatedOf(u, a)).length + (await generatedOf(u, b)).length, 0);
  // Undo discards the draft
  assert.equal((await call(u, 'POST', `/api/chat/messages/${r.message.id}/undo`, {})).status, 200);
  assert.equal((await call(u, 'GET', `/api/chat/messages/${r.message.id}/drafts/0`)).status, 404);
});

test('a document about one project is a draft with a related project, saves to it on request, and Undo takes it out again', async () => {
  const { u, a, b } = await setup();
  const r = await prepare(u, { project_id: a.id, name: 'Alpha steering brief', audience: 'Steering committee', description: 'Brief for the steering committee', sections: SECTIONS, format: 'pptx' }, 'Create a steering brief for my project Alpha');
  assert.deepEqual(r.message.card.projects.map((p) => p.id), [a.id]);
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await generatedOf(u, a)).length, 0, 'created first, not filed yet');
  let card = await cardOf(u, r);
  assert.equal(card.drafts[0].related_project_id, a.id); assert.equal(card.drafts[0].related_project, 'Alpha'); assert.equal(card.drafts[0].format, 'pptx');
  const save = await call(u, 'POST', `/api/chat/messages/${r.message.id}/drafts/0/save`, {});
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal(save.data.saved.project_id, a.id);
  const list = await generatedOf(u, a);
  assert.equal(list.length, 1); assert.equal(list[0].title, 'Alpha steering brief'); assert.equal(list[0].format, 'pptx');
  assert.equal((await generatedOf(u, b)).length, 0, 'the other project is untouched');
  assert.equal((await call(u, 'GET', `/api/generated/${list[0].id}`)).status, 200);
  const audit = (await call(u, 'GET', `/api/projects/${a.id}/audit`)).data;
  assert.match(JSON.stringify(audit), /Saved Alpha steering brief from the Thinking Area/);
  // saving twice files it once
  const again = await call(u, 'POST', `/api/chat/messages/${r.message.id}/drafts/0/save`, {});
  assert.equal(again.status, 200); assert.equal(again.data.already, true);
  assert.equal((await generatedOf(u, a)).length, 1);
  card = await cardOf(u, r);
  assert.equal(card.drafts[0].saved.project_id, a.id);
  // Undo removes the saved copy with the draft
  assert.equal((await call(u, 'POST', `/api/chat/messages/${r.message.id}/undo`, {})).status, 200);
  assert.equal((await generatedOf(u, a)).length, 0);
});

test('a standard report made in All projects is a draft for the named project', async () => {
  const { u, a } = await setup();
  const r = await prepare(u, { project_id: a.id, type: 'charter', format: 'docx' }, 'Generate the charter for my project Alpha', 'generate_report');
  assert.deepEqual(r.message.card.projects.map((p) => p.id), [a.id]);
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await generatedOf(u, a)).length, 0);
  const g = (await call(u, 'GET', `/api/chat/messages/${r.message.id}/drafts/0`)).data.generated;
  assert.equal(g.doc_type, 'charter'); assert.ok(g.content.length > 50);
  assert.equal((await call(u, 'POST', `/api/chat/messages/${r.message.id}/drafts/0/save`, {})).status, 200);
  const list = await generatedOf(u, a);
  assert.equal(list.length, 1); assert.equal(list[0].doc_type, 'charter');
});

test('inside a project the document is still filed in that project on Apply, as before', async () => {
  const { u, a } = await setup();
  say(use('create_custom_document', { name: 'Vendor brief', audience: 'Team', sections: SECTIONS }, 't1')); say(text('Prepared.'));
  const r = await talk(u.token, { project_id: a.id, text: 'Create a vendor brief for this project' });
  assert.equal((await apply(u, r)).status, 200);
  assert.equal((await generatedOf(u, a)).length, 1);
  const card = (await call(u, 'GET', `/api/chat?project_id=${a.id}`)).data.messages.find((m) => m.id === r.message.id).card;
  assert.equal(card.drafts.length, 0); assert.equal(card.docs.length, 1);
});

test('only the owner of the card can read or save a draft, and a person who lost edit rights cannot save it', async () => {
  const { u, a } = await setup();
  const ed = await s.user('Editor'); const other = await s.user('Stranger');
  await call(u, 'POST', `/api/projects/${a.id}/members`, { email: ed.email, role: 'editor' });
  const r = await prepare(ed, { project_id: a.id, name: 'Alpha note', audience: 'Team', sections: SECTIONS }, 'Create a note for my project Alpha');
  assert.equal((await apply(ed, r)).status, 200);
  // another person cannot reach the card
  assert.equal((await call(other, 'GET', `/api/chat/messages/${r.message.id}/drafts/0`)).status, 404);
  assert.equal((await call(other, 'POST', `/api/chat/messages/${r.message.id}/drafts/0/save`, {})).status, 404);
  // the editor becomes a viewer before saving, so the save is refused and nothing is filed
  const down = await call(u, 'PUT', `/api/projects/${a.id}/members/${ed.id}`, { role: 'viewer' });
  assert.equal(down.status, 200, JSON.stringify(down.data));
  const save = await call(ed, 'POST', `/api/chat/messages/${r.message.id}/drafts/0/save`, {});
  assert.equal(save.status, 403, JSON.stringify(save.data));
  assert.equal((await generatedOf(u, a)).length, 0);
  // a person who left the project can no longer read its draft either
  await call(u, 'DELETE', `/api/projects/${a.id}/members/${ed.id}`);
  assert.equal((await call(ed, 'GET', `/api/chat/messages/${r.message.id}/drafts/0`)).status, 404);
});

test('a person with no project cannot create a portfolio document, and an unknown project is not guessed', async () => {
  const lone = await s.user('Lonely');
  say(use('create_custom_document', { name: 'Empty', audience: 'Team', sections: SECTIONS }, 'n1')); say(text('You need a project first.'));
  const r = await talk(lone.token, { text: 'Create a portfolio report for my projects' });
  assert.equal(r.message.card, null);
  const { u } = await setup();
  say(use('create_custom_document', { project_id: 999999, name: 'Ghost', audience: 'Team', sections: SECTIONS }, 'n2')); say(text('Which project do you mean?'));
  const g = await talk(u.token, { text: 'Create a report for my projects' });
  assert.equal(g.message.card, null);
});

test('the catalog and the prompt tell the model how portfolio documents work', async () => {
  const tools = require('../server/chat/tools');
  const cat = tools.catalog(true);
  const custom = cat.find((x) => x.name === 'create_custom_document');
  assert.match(custom.description, /leave project_id out/i);
  assert.match(custom.description, /portfolio/i);
  const { u } = await setup();
  say(text('Ok.'));
  await talk(u.token, { text: 'Create a portfolio report document for all my projects' });
  const sys = sc.seen[0].system;
  assert.match(sys, /covers several or all projects needs no project/);
  assert.match(sys, /DOCUMENT PRACTICE/);
  assert.match(sys, /portfolio document cannot/);
});
