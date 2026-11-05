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
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(PUB, 'brand', 'mark-512.png')).toString('base64');

function load(files) {
  const win = {}; vm.createContext(win); win.window = win;
  vm.runInContext(fs.readFileSync(path.join(PUB, 'engine.js'), 'utf8'), win, { filename: 'engine.js' });
  win.PM = {}; global.window = win;
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(PUB, f), 'utf8'), { filename: f });
  return win;
}
async function gen(u, p) {
  const r = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx' }, u.token);
  assert.equal(r.status, 200); return r.data.generated;
}

test('colored text is read from Markdown with bold and italic inside it', () => {
  const X = load(['export.js']).PM.exporter;
  const r = X.inlineRuns('Plain {#B82F2F:red **bold red**} and {#2457d6:_blue_} end');
  assert.deepEqual(r.map((x) => [x.text, x.color || null, !!x.bold, !!x.italic]), [
    ['Plain ', null, false, false], ['red ', 'B82F2F', false, false], ['bold red', 'B82F2F', true, false], [' and ', null, false, false], ['blue', '2457D6', false, true], [' end', null, false, false]]);
  assert.equal(X.plain(r), 'Plain red bold red and blue end');
  const md = X.parseMarkdown('# {#B82F2F:Heading}\n\n{#12784A:Good news}');
  assert.equal(X.plain(md[0].runs), 'Heading'); assert.equal(md[0].runs[0].color, undefined, 'headings keep the document style');
  assert.equal(md[1].runs[0].color, '12784A');
});

test('a chart line becomes a chart block and bad chart data is refused', () => {
  const X = load(['export.js']).PM.exporter;
  const line = ':::chart ' + JSON.stringify({ ctype: 'bar', title: 'Effort', labels: ['A', 'B'], series: [{ name: 'Days', values: [3, '5'] }] });
  const md = X.parseMarkdown(`# S\n\nIntro\n\n${line}\n\nAfter`);
  assert.deepEqual(md.map((b) => b.t), ['h1', 'p', 'chart', 'p']);
  const sp = md[2].spec;
  assert.equal(sp.kind, 'uchart'); assert.equal(sp.ctype, 'bar'); assert.deepEqual(sp.series[0].values, [3, 5]);
  assert.match(sp.alt, /Bar chart, Effort\. A: 3\. B: 5\./);
  assert.deepEqual(X.specTable(sp), { head: ['Item', 'Days'], rows: [['A', 3], ['B', 5]] });
  assert.equal(X.chartSpec({ labels: [], series: [] }), null);
  assert.equal(X.chartSpec({ labels: ['A'], series: 'x' }), null);
  assert.equal(X.chartSpec({ ctype: 'spider', labels: ['A'], series: [{ name: 'n', values: ['x'] }] }).ctype, 'column', 'unknown type falls back');
  assert.equal(X.chartSpec({ labels: ['A'], series: [{ name: 'n', values: ['x'] }] }).series[0].values[0], 0, 'not a number counts as zero');
  const big = X.chartSpec({ labels: Array.from({ length: 40 }, (_, i) => 'L' + i), series: Array.from({ length: 9 }, (_, i) => ({ name: 's' + i, values: [1] })) });
  assert.equal(big.labels.length, 24); assert.equal(big.series.length, 6);
  const broken = X.parseMarkdown(':::chart {not json}\n\ntext');
  assert.ok(!broken.some((b) => b.t === 'chart'), 'a broken chart line does not become a chart');
});

test('the Word file carries the text color', async () => {
  const win = load(['export.js', 'export_docx.js']); win.docx = require('docx');
  const ex = win.PM.exporter;
  const g = { id: 1, doc_type: 'progress_weekly', title: 'Colors', format: 'docx', content: '# One\n\nHello {#B82F2F:careful} world\n', meta: { project: 'P', client: 'C', date: '2027-03-05' }, visuals: null };
  const png = fs.readFileSync(path.join(PUB, 'brand', 'mark-512.png')); const a = { data: new Uint8Array(png), w: 512, h: 512 };
  const blob = await ex.builders.docx({ plan: ex.plan(g), logo: a, mark: a, client: null });
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:color w:val="B82F2F"\/><\/w:rPr><w:t[^>]*>careful<\/w:t>/);
});

test('a replaced logo is kept in the layout, checked, and used by the export plan', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Logo swap'); const g = await gen(u, p);
  const lay = { logo: { cover: 'center', header: 'right' }, header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' }, logoImg: { dataUrl: LOGO, w: 512, h: 512 } };
  const r = await s.call('PUT', `/api/generated/${g.id}`, { layout: lay }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = (await s.call('GET', `/api/generated/${g.id}`, null, u.token)).data.generated;
  assert.equal(back.layout.logoImg.dataUrl, LOGO); assert.equal(back.layout.logoImg.w, 512);
  const X = load(['export.js']).PM.exporter;
  assert.equal(X.layoutOf(back).logoImg.dataUrl, LOGO);
  // a client brand without a logo normally hides it, but a logo the PM adds is shown
  const plan = X.plan({ ...back, brand: { colors: {}, fonts: { heading: 'Arial', body: 'Arial' }, logo: null } });
  assert.equal(plan.layout.logo.cover, 'center'); assert.equal(plan.layout.logo.header, 'right');
  const hidden = X.plan({ ...back, layout: { ...back.layout, logoImg: undefined }, brand: { colors: {}, fonts: { heading: 'Arial', body: 'Arial' }, logo: null } });
  assert.equal(hidden.layout.logo.cover, 'hidden');
  // bad logos are refused
  for (const bad of [{ dataUrl: 'javascript:alert(1)' }, { dataUrl: 'data:text/html;base64,PGI+' }, { dataUrl: 'data:image/png;base64,' + 'A'.repeat(1100000) }, { w: 5 }]) {
    const x = await s.call('PUT', `/api/generated/${g.id}`, { layout: { ...lay, logoImg: bad } }, u.token);
    assert.ok(x.status === 400 || x.status === 413, 'refused: ' + JSON.stringify(bad).slice(0, 40) + ' got ' + x.status);
  }
  // clearing keeps no logo
  await s.call('PUT', `/api/generated/${g.id}`, { layout: { ...lay, logoImg: null } }, u.token);
  assert.equal((await s.call('GET', `/api/generated/${g.id}`, null, u.token)).data.generated.layout.logoImg, undefined);
});

test('colors and charts survive saving and a template saved from the document', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Keep'); const g = await gen(u, p);
  const chart = ':::chart ' + JSON.stringify({ ctype: 'pie', title: 'Split', labels: ['A', 'B'], series: [{ name: 'Share', values: [60, 40] }] });
  const content = `# Overview\n\n{#B82F2F:Watch this}\n\n${chart}\n`;
  assert.equal((await s.call('PUT', `/api/generated/${g.id}`, { content }, u.token)).status, 200);
  assert.equal((await s.call('GET', `/api/generated/${g.id}`, null, u.token)).data.generated.content, content);
  const fd = new FormData(); fd.append('name', 'With chart'); fd.append('doc_type', '*'); fd.append('body', `# Overview\n\n<!-- fixed -->\n{#B82F2F:Watch this}\n\n${chart}\n`);
  const t = await s.call('POST', '/api/templates', fd, u.token);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const g2 = (await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx', template_id: t.data.template.id }, u.token)).data.generated;
  assert.match(g2.content, /\{#B82F2F:Watch this\}/); assert.match(g2.content, /:::chart \{.*"ctype":"pie"/);
});
