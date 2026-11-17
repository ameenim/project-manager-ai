'use strict';
// Full upload with the AI switched on. The stub answers like the real model did in production: it calls the workbook a
// Microsoft Project schedule file. The plan must still be read in code and the project filled.
process.env.ANTHROPIC_API_KEY = 'sk-ant-stub';
const claude = require('../server/claude');
const calls = [];
claude.callClaude = async (p) => {
  const sys = String(p.system || ''), usr = String(p.user || p.content || '');
  let out;
  if (/screening a new project document/.test(sys)) out = { role: 'schedule', summary: 'A project plan for the Tawasol and ICN implementation.', project_name: 'Tawasol DMS', confidence: 0.9 };
  else if (/risk register for THIS project/.test(sys)) {
    const d = JSON.parse(usr.slice(usr.indexOf('{'), usr.indexOf('\n\nPassages')));
    calls.push({ sched: d.schedule.length, listed: d.risks_already_listed.length, passages: (usr.split('Passages about assumptions')[1] || '').split('\n').length });
    out = { risks: [{ title: 'Go-live overlaps Qatar National Day', description: 'Both go-lives sit in December.', probability: 'Medium', impact: 'High', mitigation: 'Confirm cover in November.', owner: 'PM', evidence: null, confidence: 0.6 }] };
  } else { calls.push({ unexpected: sys.slice(0, 80) }); out = {}; }
  return { text: JSON.stringify(out), stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } };
};
const { test, before, after } = require('node:test');
const fs = require('fs');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());
const { workbook } = require('./_plan_fixture');
const assert = require('node:assert/strict');
test('with the AI on, a plan workbook the AI calls a schedule file is still read and filled in', async () => {
  const u = await s.user();
  const fd = new FormData(); fd.append('name', 'ACME plan');
  fd.append('files', new Blob([workbook()]), 'ACME Project Plan.xlsx');
  const r = await s.call('POST', '/api/projects', fd, u.token); const id = r.data.project.id;
  await s.until(async () => !(await s.call('GET', `/api/projects/${id}`, null, u.token)).data.project.analyzing, 60000);
  const items = (await s.call('GET', `/api/projects/${id}/items?limit=500`, null, u.token)).data.items;
  assert.equal(items.filter((i) => i.kind === 'schedule' && i.status === 'confirmed').length, 12);
  assert.equal(items.filter((i) => i.kind === 'risk').length >= 3, true);
  const an = (await s.call('GET', `/api/projects/${id}`, null, u.token)).data.project.analysis || {};
  const docs = an.docs || [];
  assert.equal(docs[0].role_label, 'Project plan workbook');
  assert.equal(docs[0].status, 'done');
  assert.ok(an.filled.confirmed >= 12, 'items are filled in, not all left for review');
  assert.ok(calls.length === 1 && calls[0].sched === 12 && calls[0].listed === 3 && !calls[0].unexpected, 'the risk step is given the plan and the listed risks');
});
