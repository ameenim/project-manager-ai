'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

const CONTRACT = 'Client: Ministry of Test\nContract value: AED 1,000,000\nStart date: 2027-03-01\nEnd date: 2027-09-30\nDeliverable 1: Design document due 2027-04-15\nPayment 1: 30% on signing';
async function ready(u, name = 'Custom') {
  const p = await s.project(u.token, name, CONTRACT);
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
  return p;
}
const brief = { name: 'Steering committee update', audience: 'Executive sponsor and steering committee', description: 'A short status update with risks and the decisions we need from the committee.' };

test('the analysis suggests a template and sections from the name, audience and description', async () => {
  const u = await s.user(); const p = await ready(u, 'Plan');
  const r = await s.call('POST', `/api/projects/${p.id}/doc-plan`, brief, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const pl = r.data.plan;
  assert.equal(pl.base_type, 'progress_weekly');
  assert.ok(pl.base_title && pl.sections.length >= 3 && pl.sections.length <= 20);
  assert.equal(pl.sections[0].key, 'p_summary', 'a senior audience starts with an executive summary');
  assert.ok(pl.sections.every((x) => x.heading && 'key' in x && 'guidance' in x));
  assert.equal(new Set(pl.sections.map((x) => x.heading.toLowerCase())).size, pl.sections.length, 'no repeated headings');
  // a different need gives a different template
  const risk = await s.call('POST', `/api/projects/${p.id}/doc-plan`, { name: 'Risk approach', audience: 'Delivery team', description: 'How we find, rate and respond to risk on this project.' }, u.token);
  assert.equal(risk.data.plan.base_type, 'risk_plan');
  assert.ok(risk.data.plan.sections.some((x) => x.key === 'requirements' || x.key === 'timeline'), 'a technical audience gets requirements or timeline');
});

test('the analysis checks its input and respects roles', async () => {
  const mgr = await s.user(), vw = await s.user(); const p = await ready(mgr, 'Roles');
  await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token);
  const call = (b, tok) => s.call('POST', `/api/projects/${p.id}/doc-plan`, b, tok);
  assert.equal((await call({ ...brief, name: '  ' }, mgr.token)).status, 400);
  assert.equal((await call({ ...brief, audience: '' }, mgr.token)).status, 400);
  assert.equal((await call({ ...brief, description: 'short' }, mgr.token)).status, 400);
  assert.equal((await call(brief, vw.token)).status, 403);
  assert.equal((await call(brief, (await s.user()).token)).status, 404);
});

test('a custom document is generated from the chosen sections in the chosen order', async () => {
  const u = await s.user(); const p = await ready(u, 'Generate');
  const plan = (await s.call('POST', `/api/projects/${p.id}/doc-plan`, brief, u.token)).data.plan;
  const sections = [
    { heading: 'Where we are', key: 'p_summary', guidance: 'Status' },
    { heading: 'What we need from you', key: 'p_actions', guidance: '' },
    { heading: 'Lessons so far', key: null, guidance: 'What the team learned.' },
    { heading: 'where we are', key: 'p_summary', guidance: '' }, // repeated heading is dropped
    { heading: 'Bad key', key: 'not_a_real_key', guidance: '' },
  ];
  const f = await s.call('POST', `/api/projects/${p.id}/folders`, { name: 'Custom' }, u.token);
  const g = await s.call('POST', `/api/projects/${p.id}/generate`, { type: plan.base_type, format: 'docx', folder_id: f.data.folder.id, custom: { ...brief, sections } }, u.token);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const d = g.data.generated;
  assert.equal(d.title, brief.name); assert.equal(d.template, 'Custom document'); assert.deepEqual(d.custom, { audience: brief.audience, description: brief.description });
  assert.equal(d.meta.audience, brief.audience); assert.equal(d.folder_id, f.data.folder.id);
  const heads = d.content.split('\n').filter((l) => /^# /.test(l)).map((l) => l.slice(2));
  assert.deepEqual(heads, ['Where we are', 'What we need from you', 'Lessons so far', 'Bad key']);
  assert.match(d.content, /To be completed by the project manager/, 'a section with no data and no AI is left for the manager');
  assert.match(d.content, /What the team learned\./);
  // it shows in the list and downloads like any other document, with the audience on the cover
  const list = (await s.call('GET', `/api/projects/${p.id}/generated`, null, u.token)).data.generated;
  assert.equal(list.find((x) => x.id === d.id).custom, true);
  for (const [fmt, entry] of [['docx', 'word/document.xml'], ['pptx', 'ppt/presentation.xml'], ['xlsx', 'xl/workbook.xml']]) {
    const r = await s.call('GET', `/api/generated/${d.id}/${fmt}`, null, u.token);
    assert.equal(r.status, 200, fmt); assert.ok((await JSZip.loadAsync(r.buf)).file(entry), fmt);
  }
  const docx = await JSZip.loadAsync((await s.call('GET', `/api/generated/${d.id}/docx`, null, u.token)).buf);
  const xml = await docx.file('word/document.xml').async('string');
  assert.match(xml, /Prepared for/); assert.match(xml, /Executive sponsor and steering committee/);
});

test('custom generation validates and respects roles', async () => {
  const mgr = await s.user(), vw = await s.user(); const p = await ready(mgr, 'Checks');
  await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token);
  const one = [{ heading: 'Only section', key: 'purpose', guidance: '' }];
  const gen = (b, tok) => s.call('POST', `/api/projects/${p.id}/generate`, b, tok);
  assert.equal((await gen({ type: 'charter', custom: { ...brief, sections: [] } }, mgr.token)).status, 400, 'needs a section');
  assert.equal((await gen({ type: 'charter', custom: { ...brief, name: '', sections: one } }, mgr.token)).status, 400, 'needs a name');
  assert.equal((await gen({ type: 'nope', custom: { ...brief, sections: one } }, mgr.token)).status, 400, 'needs a known base type');
  assert.equal((await gen({ type: 'charter', custom: { ...brief, sections: one } }, vw.token)).status, 403);
  const many = Array.from({ length: 30 }, (_, i) => ({ heading: `Section ${i}`, key: null, guidance: '' }));
  const g = await gen({ type: 'charter', custom: { ...brief, sections: many } }, mgr.token);
  assert.equal(g.status, 200); assert.equal(g.data.generated.content.split('\n').filter((l) => /^# /.test(l)).length, 20, 'capped at 20 sections');
  // standard documents are unchanged
  const std = await gen({ type: 'charter' }, mgr.token);
  assert.equal(std.status, 200); assert.equal(std.data.generated.custom, undefined); assert.equal(std.data.generated.template, 'System default');
});
