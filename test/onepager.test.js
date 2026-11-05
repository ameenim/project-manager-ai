'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('jszip');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

const PUB = path.join(__dirname, '..', 'public');
const CONTRACT = 'Client: Ministry of Test\nContract value: AED 1,000,000\nStart date: 2027-03-01\nEnd date: 2027-09-30\nDeliverable 1: Design document due 2027-04-15\nPayment 1: 30% on signing';
async function ready(u, name) {
  const p = await s.project(u.token, name, CONTRACT);
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
  // the contract details are proposals until confirmed, so set the project facts directly
  await s.call('PUT', `/api/projects/${p.id}`, { client: 'Ministry of Test', currency: 'AED', value: 1000000, start_date: '2027-03-01', end_date: '2027-09-30' }, u.token);
  return p;
}

// Builds the file the same way the browser does, with the browser code loaded into this process.
async function buildSlide(g) {
  const win = {}; vm.createContext(win); win.window = win;
  vm.runInContext(fs.readFileSync(path.join(PUB, 'engine.js'), 'utf8'), win, { filename: 'engine.js' });
  win.PM = {};
  global.window = win;
  for (const f of ['export.js', 'export_pptx.js']) vm.runInThisContext(fs.readFileSync(path.join(PUB, f), 'utf8'), { filename: f });
  win.PptxGenJS = require('pptxgenjs');
  const ex = win.PM.exporter;
  const png = (f) => { const data = new Uint8Array(fs.readFileSync(path.join(PUB, 'brand', f))); const v = new DataView(data.buffer, data.byteOffset); return { data, w: v.getUint32(16), h: v.getUint32(20) }; };
  const blob = await ex.builders.pptx({ plan: ex.plan(g), logo: png('full-light.png'), mark: png('mark-512.png'), client: null });
  return Buffer.from(await blob.arrayBuffer());
}

test('the one slide status report is listed as a progress report that is only one slide', async () => {
  const u = await s.user();
  const r = await s.call('GET', '/api/doc-types', null, u.token);
  const t = r.data.types.find((x) => x.id === 'progress_onepager');
  assert.ok(t, 'type exists');
  assert.equal(t.title, 'One Slide Status Report');
  assert.equal(t.progress, true);
  assert.equal(t.oneSlide, true);
  assert.equal(r.data.types.find((x) => x.id === 'progress_weekly').oneSlide, false);
});

test('it is always made as PowerPoint and carries the slide data', async () => {
  const u = await s.user(); const p = await ready(u, 'One Slide');
  const r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_onepager', format: 'docx' }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = (await s.call('GET', `/api/generated/${r.data.generated.id}`, null, u.token)).data.generated;
  assert.equal(g.format, 'pptx', 'the format is forced to PowerPoint');
  const o = g.visuals.onepager;
  assert.ok(o, 'slide data exists');
  assert.equal(o.info.client, 'Ministry of Test');
  assert.equal(o.info.currency, 'AED');
  assert.equal(o.info.value, 1000000);
  assert.equal(o.pct.last, null, 'no snapshot a week ago means no figure, never an estimate');
  assert.ok(['done', 'ok', 'warn', 'bad', 'idle'].includes(o.health));
  for (const k of ['stages', 'rows', 'risks', 'delays', 'done', 'next', 'ask']) assert.ok(Array.isArray(o[k]), k + ' is a list');
  assert.ok(o.brief.length > 0);
  // the other progress reports keep their own formats
  const w = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx' }, u.token);
  assert.equal(w.data.generated.format, 'docx');
});

test('last week comes from the snapshot recorded 7 to 14 days before the report date', async () => {
  const u = await s.user(); const p = await ready(u, 'Last week');
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const asOf = day(0);
  // no history yet
  let r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_onepager', as_of: asOf }, u.token);
  let g = (await s.call('GET', `/api/generated/${r.data.generated.id}`, null, u.token)).data.generated;
  assert.equal(g.visuals.onepager.pct.last, null);
  // a recorded day 8 days ago is found
  await s.app.api.snapshots.save(p.id, day(-8), { v: 1, progress: 37 });
  r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_onepager', as_of: asOf }, u.token);
  g = (await s.call('GET', `/api/generated/${r.data.generated.id}`, null, u.token)).data.generated;
  assert.equal(g.visuals.onepager.pct.last, 37);
});

test('the file is one slide in the platform colors with the platform logo and a note for the presenter', async () => {
  const u = await s.user(); const p = await ready(u, 'Slide Build');
  const r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_onepager' }, u.token);
  const g = (await s.call('GET', `/api/generated/${r.data.generated.id}`, null, u.token)).data.generated;
  const buf = await buildSlide(g);
  if (process.env.ONEPAGER_OUT) fs.writeFileSync(process.env.ONEPAGER_OUT, buf);
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, 1, 'exactly one slide');
  const xml = await zip.file(slides[0]).async('string');
  for (const text of ['Slide Build', 'Weekly project status', 'Project brief', 'Completion', 'Top risks and issues', 'Reasons for delay', 'Next steps', 'Decisions and support required']) assert.ok(xml.includes(text), 'slide shows ' + text);
  // the template colors (orange, purple, red) are not used. Platform blues are.
  for (const c of ['FF8A65', 'FF7F5C', '4B3DB5', 'D62F3A']) assert.ok(!xml.includes(c), 'no template color ' + c);
  assert.ok(xml.includes('2457D6') && xml.includes('1C46B0'), 'platform primary colors are used');
  assert.ok(Object.keys(zip.files).some((n) => /^ppt\/media\/.+\.png$/.test(n)), 'the platform logo is embedded');
  assert.ok(Object.keys(zip.files).some((n) => /notesSlide1\.xml$/.test(n)), 'speaker notes exist');
});

// ---------- the slide data, built straight from a report context ----------
function slideData(ctx) {
  const win = {}; vm.createContext(win); win.window = win;
  for (const f of ['engine.js', 'visuals.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), win, { filename: f });
  return win.__Visuals.fromContext(ctx, true).onepager;
}
const T = (id, parent, name, extra) => ({ id, parent_id: parent, name, summary: false, start: '2027-01-04', finish: '2027-02-26', duration: 20, progress: 0, ...extra });
function ctxOf(tasks, extra) {
  const rows = tasks.filter((t) => !t.summary).map((t) => ({ ...t, plannedPct: 50, slipDays: 0, overdue: false }));
  return {
    project: { name: 'Phase Test', client: 'Client Co', currency: 'USD', value: 500000, start_date: '2027-01-04', end_date: '2027-06-30' }, user: { name: 'Pat PM' }, today: '2027-02-10',
    period: { start: '2027-02-04', end: '2027-02-10', next: '2027-02-17', days: 7 }, tasks, metrics: { actualPct: 40, plannedPct: 50, spi: 0.8, overdue: 0, taskCount: rows.length, rows },
    milestones: [], risks: [], deliverables: [], resources: [], docs: [], audit: [], inbox: [], unconfirmed: 0, lastWeek: null, ...extra,
  };
}

test('stages and rows come from the phases below a single project root task', () => {
  const tasks = [
    T(1, null, 'Whole Project', { summary: true }),
    T(2, 1, 'Design', { summary: true }), T(3, 2, 'Draft', { progress: 100 }), T(4, 2, 'Review', { progress: 100 }),
    T(5, 1, 'Build', { summary: true }), T(6, 5, 'Code', { progress: 20 }),
  ];
  const o = slideData(ctxOf(tasks));
  assert.deepEqual(o.stages.map((x) => [x.name, x.state]), [['Design', 'done'], ['Build', 'active']]);
  assert.deepEqual(o.rows.map((x) => [x.name, x.pct]), [['Design', 100], ['Build', 20]]);
  assert.equal(o.rows[0].label, 'Completed');
  assert.equal(o.health, 'warn', 'a schedule index of 0.8 is a timeline at risk');
});

test('a schedule with several top level phases keeps them as they are', () => {
  const tasks = [T(1, null, 'Plan', { summary: true }), T(2, 1, 'Scope', { progress: 50 }), T(3, null, 'Deliver', { summary: true }), T(4, 3, 'Ship', { progress: 0 })];
  const o = slideData(ctxOf(tasks));
  assert.deepEqual(o.stages.map((x) => x.name), ['Plan', 'Deliver']);
});

test('lists are plain short text, with friendly dates and no template wording', () => {
  const tasks = [T(1, null, 'Whole Project', { summary: true }), T(2, 1, 'Late phase', { summary: true }), T(3, 2, 'Late task', { finish: '2027-02-01', start: '2027-01-04' })];
  const ctx = ctxOf(tasks);
  ctx.metrics.rows[0].overdue = true; ctx.metrics.rows[0].slipDays = 5;
  ctx.risks = [{ title: 'Low one', state: 'open', d: { probability: 'Low', impact: 'Low' } }, { title: 'High one', state: 'open', d: { probability: 'High', impact: 'High', mitigation: 'Add a second vendor' } }];
  const o = slideData(ctx);
  assert.equal(o.risks[0].title, 'High one', 'the highest rated risk comes first');
  assert.equal(o.risks[0].mitigation, 'Add a second vendor');
  assert.ok(o.delays[0].includes('5 working days behind baseline'));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(o.next.concat(o.delays).join(' ')), 'dates are written out, not ISO');
  assert.ok([...o.done, ...o.next, ...o.ask, ...o.delays].every((x) => x.length <= 130), 'each line is short');
  assert.ok(![...o.done, ...o.next, ...o.ask, ...o.delays, o.brief].join(' ').includes(';'), 'no semicolons');
});

test('a custom document is not forced into the one slide format', async () => {
  const u = await s.user(); const p = await ready(u, 'Custom Base');
  const r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_onepager', format: 'docx', custom: { name: 'Board note', audience: 'Board', description: 'A short note for the board.', sections: [{ heading: 'Summary', key: 'p_summary' }] } }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.generated.format, 'docx');
});
