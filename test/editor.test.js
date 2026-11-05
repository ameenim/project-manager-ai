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

async function gen(u, p, extra) {
  const r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx', ...(extra || {}) }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.generated;
}
const tplForm = (o) => { const fd = new FormData(); for (const k of Object.keys(o)) fd.append(k, o[k]); return fd; };

test('a generated document keeps a page layout the project manager sets', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Layout');
  const g = await gen(u, p);
  assert.equal(g.layout, undefined, 'no layout until it is set');
  const lay = { logo: { cover: 'right', header: 'center' }, header: { left: 'Confidential', center: '', right: '{{project}}' }, footer: { left: '', center: 'Prepared by {{pm}}', right: 'Page {{page}} of {{pages}}' } };
  const r = await s.call('PUT', `/api/generated/${g.id}`, { content: '# One\n\nText\n\n# Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', layout: lay }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = (await s.call('GET', `/api/generated/${g.id}`, null, u.token)).data.generated;
  assert.deepEqual(back.layout, { v: 1, ...lay });
  assert.match(back.content, /# Two/);
  // clearing the layout goes back to the default look
  await s.call('PUT', `/api/generated/${g.id}`, { layout: null }, u.token);
  assert.equal((await s.call('GET', `/api/generated/${g.id}`, null, u.token)).data.generated.layout, undefined);
});

test('the page layout is cleaned and bad input is refused', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Layout clean');
  const g = await gen(u, p);
  const r = await s.call('PUT', `/api/generated/${g.id}`, { layout: { logo: { cover: 'diagonal', header: 'hidden' }, header: { left: 'x'.repeat(500) + '\u0007' }, footer: { right: 'a\nb\nc\nd\ne' } } }, u.token);
  assert.equal(r.status, 200);
  const l = (await s.call('GET', `/api/generated/${g.id}`, null, u.token)).data.generated.layout;
  assert.equal(l.logo.cover, 'left', 'unknown position falls back');
  assert.equal(l.logo.header, 'hidden');
  assert.ok(l.header.left.length <= 160 && !l.header.left.includes('\u0007'));
  assert.equal(l.footer.right.split('\n').length, 3);
  const bad = await s.call('PUT', `/api/generated/${g.id}`, { layout: 'nope' }, u.token);
  assert.equal(bad.status, 400);
});

test('a template can hold the layout, fixed sections and apply to every document type', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Template layout');
  const body = '# Risks and Issues\n\n\n# Our Notes\n\n<!-- fixed -->\nWritten once for {{project.name}}.\n\n# Executive Summary\n\n';
  const lay = { logo: { cover: 'center', header: 'right' }, header: { left: 'Header {{client}}', center: '', right: '' }, footer: { left: '', center: '', right: 'Page {{page}}' } };
  const made = await s.call('POST', '/api/templates', tplForm({ name: 'Mine', doc_type: '*', body, layout: JSON.stringify(lay) }), u.token);
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(made.data.template.has_layout, true);
  assert.deepEqual(made.data.sections, ['Risks and Issues', 'Our Notes', 'Executive Summary']);
  const list = (await s.call('GET', '/api/templates', null, u.token)).data.templates;
  assert.ok(list.find((x) => x.name === 'Mine' && x.doc_type === '*'));
  // it works for any document type
  for (const type of ['progress_weekly', 'charter']) {
    const g = await gen(u, p, { type, template_id: made.data.template.id });
    const order = [...g.content.matchAll(/^# (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(order, ['Risks and Issues', 'Our Notes', 'Executive Summary'], type);
    assert.match(g.content, /Written once for Template layout\./, 'fixed text kept with variables filled');
    assert.deepEqual(g.layout, { v: 1, ...lay });
  }
});

test('a fixed section is not overwritten by project data, a refresh section is', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Fixed vs refresh');
  const body = '# Risks and Issues\n\n<!-- fixed -->\nOur own risk wording.\n\n# Executive Summary\n\nignored guidance\n';
  const made = await s.call('POST', '/api/templates', tplForm({ name: 'Fixed', doc_type: 'progress_weekly', body }), u.token);
  const g = await gen(u, p, { template_id: made.data.template.id });
  assert.match(g.content, /# Risks and Issues\n\nOur own risk wording\./);
  assert.doesNotMatch(g.content, /ignored guidance/, 'matched section is rebuilt from project data');
});

test('a template for one type is refused for another and a bad layout is rejected', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Scope');
  const made = await s.call('POST', '/api/templates', tplForm({ name: 'Only weekly', doc_type: 'progress_weekly', body: '# A\n\nx\n' }), u.token);
  assert.equal(made.status, 200);
  const r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_biweekly', format: 'docx', template_id: made.data.template.id }, u.token);
  assert.equal(r.status, 404);
  const bad = await s.call('POST', '/api/templates', tplForm({ name: 'Bad', doc_type: '*', body: '# A\n\nx\n', layout: '{oops' }), u.token);
  assert.equal(bad.status, 400);
  const star = await s.call('POST', '/api/templates', tplForm({ name: 'Bad type', doc_type: 'nothing', body: '# A\n\nx\n' }), u.token);
  assert.equal(star.status, 400);
});

// ---- the Word file follows the layout ----
async function buildDocx(g) {
  const win = {}; vm.createContext(win); win.window = win;
  vm.runInContext(fs.readFileSync(path.join(PUB, 'engine.js'), 'utf8'), win, { filename: 'engine.js' });
  win.PM = {};
  global.window = win;
  for (const f of ['export.js', 'export_docx.js']) vm.runInThisContext(fs.readFileSync(path.join(PUB, f), 'utf8'), { filename: f });
  win.docx = require('docx');
  const ex = win.PM.exporter;
  const png = (f) => { const data = new Uint8Array(fs.readFileSync(path.join(PUB, 'brand', f))); const v = new DataView(data.buffer, data.byteOffset); return { data, w: v.getUint32(16), h: v.getUint32(20) }; };
  const blob = await ex.builders.docx({ plan: ex.plan(g), logo: png('full-light.png'), mark: png('mark-512.png'), client: null });
  return { zip: await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer())), ex };
}
const base = { id: 1, doc_type: 'progress_weekly', title: 'My report', format: 'docx', content: '# First\n\nHello\n\n# Second\n\n- a\n- b\n', meta: { project: 'Apollo', client: 'Acme', pm: 'Sam', date: '2027-03-05', code: 'AP-1' }, visuals: null };

test('the Word file uses the header, footer and logo position from the layout', async () => {
  const g = { ...base, layout: { logo: { cover: 'hidden', header: 'right' }, header: { left: 'For {{client}}', center: '', right: '' }, footer: { left: '', center: 'By {{pm}}', right: 'Page {{page}} of {{pages}}' } } };
  const { zip } = await buildDocx(g);
  const files = Object.keys(zip.files);
  const hdr = await zip.file(files.find((f) => /word\/header\d+\.xml/.test(f) && true)).async('string');
  const all = (await Promise.all(files.filter((f) => /word\/(header|footer)\d+\.xml$/.test(f)).map((f) => zip.file(f).async('string')))).join('\n');
  assert.match(all, /For Acme/);
  assert.match(all, /By Sam/);
  assert.match(all, /PAGE/); assert.match(all, /NUMPAGES/);
  assert.ok(!/\{\{/.test(all), 'every token is filled in');
  assert.ok(hdr.length > 0);
  const doc = await zip.file('word/document.xml').async('string');
  assert.match(doc, /First/); assert.match(doc, /Second/);
});

test('with no saved layout the Word file keeps its original header and footer', async () => {
  const { zip, ex } = await buildDocx(base);
  const all = (await Promise.all(Object.keys(zip.files).filter((f) => /word\/(header|footer)\d+\.xml$/.test(f)).map((f) => zip.file(f).async('string')))).join('\n');
  assert.match(all, /Apollo/); assert.match(all, /Acme/); assert.match(all, /My report/); assert.match(all, /NUMPAGES/);
  assert.deepEqual(ex.layoutOf(base), ex.DEFAULT_LAYOUT);
});

test('sections follow the order of the headings so moving a heading moves its section', async () => {
  const win = {}; vm.createContext(win); win.window = win;
  vm.runInContext(fs.readFileSync(path.join(PUB, 'engine.js'), 'utf8'), win, { filename: 'engine.js' });
  win.PM = {}; global.window = win;
  vm.runInThisContext(fs.readFileSync(path.join(PUB, 'export.js'), 'utf8'), { filename: 'export.js' });
  const plan = win.PM.exporter.plan({ ...base, content: '# Second\n\n- a\n\n# First\n\nHello\n' });
  assert.deepEqual(plan.sections.map((x) => x.heading), ['Second', 'First']);
});
