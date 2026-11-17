'use strict';
// A project plan workbook (WBS table plus a risk sheet plus a colored month grid) must be read row by row in code.
// Before this fix the AI labeled such a file as a Microsoft Project schedule, the XML parser threw, and 0 items were found.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const XLSX = require('xlsx');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

const { workbook } = require('./_plan_fixture');

function pipe(aiReply) {
  const win = { __AI: { claudeJSON: async () => aiReply } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/extract2.js'), 'utf8'), { window: win, console });
  return win.__Pipe;
}

test('the spreadsheet reader writes ISO dates and one line per row', async () => {
  const { readSpreadsheet } = require('../server/xlsx_text');
  const r = await readSpreadsheet(workbook());
  assert.match(r.text, /\| 1\.1 \| +Contract award received \| Milestone \| Both \| 2026-04-26 \| 2026-04-26 \|/);
  assert.match(r.text, /Line one line two/, 'a cell with a line break stays on one line');
  assert.doesNotMatch(r.text, /\d\d-[A-Z][a-z]{2}-\d\d/, 'no formatted dates are left');
});

test('a plan workbook is read in code: every row, hierarchy, dates, risks', async () => {
  const { readSpreadsheet } = require('../server/xlsx_text');
  const text = (await readSpreadsheet(workbook())).text;
  const P = pipe({});
  assert.equal(P.detectRole('ACME_Plan.xlsx', text).role, 'plan');
  const a = P.extractPlan({ text });
  assert.equal(a.engine, 'plan');
  assert.equal(a.schedule.length, 12, 'all rows except the project row');
  const by = (n) => a.schedule.find((x) => x.name === n);
  assert.equal(by('Initiation').level, 'phase');
  assert.equal(by('Contract award received').level, 'milestone');
  assert.equal(by('Contract award received').phase, 'Initiation');
  assert.equal(by('Collect business documents').start, '2026-04-26');
  assert.equal(by('Collect business documents').end, '2026-04-28');
  assert.equal(JSON.stringify(a.fields.map((f) => [f.field, f.value])), JSON.stringify([['start_date', '2026-04-26'], ['end_date', '2027-12-23']]));
  assert.equal(a.risks.length, 3);
  assert.equal(a.risks[0].impact, 'High'); assert.equal(a.risks[0].probability, 'Medium');
  assert.ok(a.risks[0].confidence < 0.8, 'a closed risk goes to review, not auto fill');
  assert.equal(a.risks[2].title, 'client cybersecurity clearance is required again before production go-live', 'a Dependency: prefix is not the title');
  assert.equal(JSON.stringify(a.sheets_skipped), JSON.stringify(['Roadmap']));
  for (const x of [...a.schedule, ...a.risks]) assert.ok(text.includes(x.quote), 'every quote is a real line of the file');
});

test('the AI cannot relabel a plan workbook or a work plan as a Microsoft Project schedule', async () => {
  const P = pipe({ role: 'schedule', summary: 'A schedule.', confidence: 0.9 });
  assert.equal((await P.context({ filename: 'plan.xlsx' }, 'text', 'plan')).role, 'plan');
  assert.equal((await P.context({ filename: 'tech.docx' }, 'plain text, not xml', 'technical')).role, 'technical');
  const xml = '<Project xmlns="http://schemas.microsoft.com/project"><Tasks/></Project>';
  assert.equal((await P.context({ filename: 'p.xml' }, xml, 'other')).role, 'schedule');
});

test('passages reads spreadsheet rows one by one and leaves out dated schedule rows', async () => {
  const { readSpreadsheet } = require('../server/xlsx_text');
  const text = (await readSpreadsheet(workbook())).text;
  const ps = pipe({}).passages(text);
  assert.ok(ps.some((p) => /cybersecurity clearance/.test(p)), 'risk rows are passages');
  assert.ok(!ps.some((p) => /Weekly status meeting/.test(p)), 'schedule rows are not');
});

test('uploading a plan workbook fills the project with its schedule and risks, with no AI key', async () => {
  const u = await s.user();
  const fd = new FormData(); fd.append('name', 'ACME plan');
  fd.append('files', new Blob([workbook()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'ACME_Project_Plan.xlsx');
  const r = await s.call('POST', '/api/projects', fd, u.token);
  assert.equal(r.status, 200);
  const id = r.data.project.id;
  await s.until(async () => !(await s.call('GET', `/api/projects/${id}`, null, u.token)).data.project.analyzing);
  const items = (await s.call('GET', `/api/projects/${id}/items?limit=500`, null, u.token)).data.items;
  const sched = items.filter((i) => i.kind === 'schedule');
  assert.equal(sched.length, 12, 'near identical names and repeated meetings are all kept');
  assert.equal(sched.filter((i) => i.title === 'Weekly status meeting').length, 2);
  assert.ok(sched.some((i) => i.title === 'ICN Requirements Analysis Sign-Off') && sched.some((i) => i.title === 'Tawasol Requirements Analysis Sign-Off'));
  assert.equal(items.filter((i) => i.kind === 'risk').length, 3);
  const docs = (await s.call('GET', `/api/projects/${id}/documents`, null, u.token)).data.documents;
  assert.equal(docs.length, 1);
  const proj = (await s.call('GET', `/api/projects/${id}`, null, u.token)).data.project;
  assert.equal(proj.start_date, '2026-04-26');
  assert.equal(proj.end_date, '2027-12-23');
  assert.equal(JSON.stringify(proj.work_days), '[0,1,2,3,4]', 'dates only on Sunday to Thursday set a Sunday to Thursday week');
  const tasks = (await s.call('GET', `/api/projects/${id}/schedule`, null, u.token)).data.tasks;
  assert.equal(tasks.length, 12);
  assert.equal(tasks.find((x) => x.name === 'Initiation').start, '2026-04-26', 'a Sunday start stays on Sunday');
  const phase = tasks.find((x) => x.name === 'Analysis Sign-Off' && !x.is_milestone), ms = tasks.find((x) => x.name === 'Analysis Sign-Off' && x.is_milestone);
  assert.equal(ms.parent_id, phase.id, 'a milestone named like its phase sits inside it');
  assert.equal(tasks.find((x) => x.name === 'Close analysis').parent_id, phase.id, 'later siblings stay in the phase, not under the milestone');
  // Analyzing the same file again adds nothing.
  await s.call('POST', `/api/projects/${id}/analyze`, {}, u.token);
  await s.sleep(300);
  await s.until(async () => !(await s.call('GET', `/api/projects/${id}`, null, u.token)).data.project.analyzing);
  const again = (await s.call('GET', `/api/projects/${id}/items?limit=500`, null, u.token)).data.items;
  assert.equal(again.filter((i) => i.kind === 'schedule').length, 12);
  assert.equal(again.filter((i) => i.kind === 'risk').length, 3);
});

test('the risk analysis is given the whole plan shape and the risks the workbook lists', async () => {
  const { readSpreadsheet } = require('../server/xlsx_text');
  const text = (await readSpreadsheet(workbook())).text;
  let prompt = '';
  const win = { __AI: { claudeJSON: async (sys, user) => { prompt = user; return { risks: [] }; }, normQuote: (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''), quoteFound: () => true } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/extract2.js'), 'utf8'), { window: win, console });
  const P = win.__Pipe;
  const a = P.extractPlan({ text });
  const items = [
    ...a.schedule.map((r) => ({ kind: 'schedule', status: 'confirmed', title: r.name, data: r })),
    ...a.risks.map((r) => ({ kind: 'risk', status: 'confirmed', title: r.title, data: r })),
  ];
  await P.analyzeRisks({ project: { value: null }, docs: [{ id: 1, filename: 'plan.xlsx', role: 'plan', summary: 'A plan.' }], items, text: { 1: text }, checks: [] });
  const digest = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.indexOf('\n\nPassages')));
  assert.equal(digest.schedule.length, 12, 'every plan row reaches the risk step');
  assert.equal(digest.schedule[0].level === 'task', false, 'phases and milestones come first');
  assert.equal(digest.risks_already_listed.length, 3);
  assert.match(prompt, /cybersecurity clearance is required again/, 'the risk rows are passages');
  assert.doesNotMatch(prompt.slice(prompt.indexOf('Passages')), /Weekly status meeting/, 'dated schedule rows are not passages');
});
