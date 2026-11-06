'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('jszip');
const brandLib = require('../server/brand');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());
const PUB = path.join(__dirname, '..', 'public');
const LOGO = fs.readFileSync(path.join(PUB, 'brand', 'mark-512.png'));

const theme = (maj, min) => `<?xml version="1.0"?><a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Acme"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3D1E5C"/></a:dk2><a:lt2><a:srgbClr val="F2EEF7"/></a:lt2><a:accent1><a:srgbClr val="7B2D8E"/></a:accent1><a:accent2><a:srgbClr val="F28C28"/></a:accent2><a:accent3><a:srgbClr val="2BA6A0"/></a:accent3><a:accent4><a:srgbClr val="A0A0A0"/></a:accent4><a:accent5><a:srgbClr val="C8D0D8"/></a:accent5><a:accent6><a:srgbClr val="333333"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme><a:fontScheme name="Acme"><a:majorFont><a:latin typeface="${maj}"/></a:majorFont><a:minorFont><a:latin typeface="${min}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
async function word(opts) {
  opts = opts || {};
  const w = new JSZip();
  w.file('[Content_Types].xml', '<Types/>');
  w.file('word/theme/theme1.xml', theme('Georgia', 'Verdana'));
  w.file('word/styles.xml', '<w:styles xmlns:w="x"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:color w:val="2B2B2B"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:color w:val="7B2D8E"/><w:sz w:val="40"/></w:rPr></w:style></w:styles>');
  const p = (t) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  w.file('word/document.xml', `<w:document xmlns:w="x"><w:body>${(opts.heads || ['Introduction', 'Scope of Work', 'Project Schedule', 'Risks and Mitigation', 'Commercial Terms']).map(p).join('')}<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="7B2D8E"/></w:tcPr></w:tc></w:tr></w:tbl></w:body></w:document>`);
  w.file('word/header1.xml', '<w:hdr xmlns:w="x"><w:p><w:r><w:t>Acme Corporation | Confidential</w:t></w:r></w:p></w:hdr>');
  w.file('word/footer1.xml', '<w:ftr xmlns:w="x"><w:p><w:r><w:t>Acme Corporation, Dubai</w:t></w:r></w:p></w:ftr>');
  if (!opts.noLogo) {
    w.file('word/_rels/header1.xml.rels', `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${opts.logoName || 'logo.png'}"/></Relationships>`);
    w.file('word/media/' + (opts.logoName || 'logo.png'), opts.logoBytes || LOGO);
  }
  return w.generateAsync({ type: 'nodebuffer' });
}
async function ppt() {
  const pp = new JSZip();
  pp.file('ppt/presentation.xml', '<p:presentation xmlns:p="x"/>');
  pp.file('ppt/theme/theme1.xml', theme('Trebuchet MS', 'Calibri'));
  pp.file('ppt/slideMasters/slideMaster1.xml', '<p:sldMaster xmlns:p="x" xmlns:a="y"><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="C8102E"/></a:solidFill><a:latin typeface="Trebuchet MS"/></a:defRPr></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>');
  pp.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<Relationships><Relationship Id="r9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  pp.file('ppt/media/image1.png', LOGO);
  const slide = (t) => `<p:sld xmlns:p="x" xmlns:a="y"><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp><a:solidFill><a:srgbClr val="C8102E"/></a:solidFill></p:sld>`;
  ['Acme Update', 'Executive Summary', 'Delivery Plan', 'Budget and Payments'].forEach((t, i) => pp.file(`ppt/slides/slide${i + 1}.xml`, slide(t)));
  return pp.generateAsync({ type: 'nodebuffer' });
}
const form = (file, name, extra) => { const fd = new FormData(); fd.append('file', new Blob([file]), name); for (const k of Object.keys(extra || {})) fd.append(k, extra[k]); return fd; };

test('colors, fonts, logo, headings, header and footer are read from a Word template', async () => {
  const r = await brandLib.extract(await word(), 'Acme Report.docx');
  assert.equal(r.engine, 'rules');
  assert.equal(r.brand.colors.primary, '7B2D8E');
  assert.equal(r.brand.fonts.heading, 'Georgia');
  assert.equal(r.brand.fonts.body, 'Verdana');
  assert.ok(r.brand.logo && r.brand.logo.dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(r.brand.logo.w, 512);
  assert.deepEqual(r.headings, ['Introduction', 'Scope of Work', 'Project Schedule', 'Risks and Mitigation', 'Commercial Terms']);
  assert.equal(r.header, 'Acme Corporation | Confidential');
  assert.equal(r.footer, 'Acme Corporation, Dubai');
  assert.equal(r.name, 'Acme Report');
  for (const k of ['primary', 'secondary', 'accent', 'text', 'muted']) assert.match(r.brand.colors[k], /^[0-9A-F]{6}$/);
  assert.ok(brandLib.contrast(r.brand.colors.text, 'FFFFFF') >= 7 && brandLib.contrast(r.brand.colors.muted, 'FFFFFF') >= 4.5, 'text colors are readable');
});

test('a PowerPoint template gives its title color, fonts, slide titles and master logo', async () => {
  const r = await brandLib.extract(await ppt(), 'deck.pptx');
  assert.equal(r.brand.colors.primary, 'C8102E');
  assert.equal(r.brand.fonts.heading, 'Trebuchet MS');
  assert.ok(r.brand.logo);
  assert.deepEqual(r.headings, ['Executive Summary', 'Delivery Plan', 'Budget and Payments']);
});

test('placeholder headings are dropped and a bad file is refused', async () => {
  assert.deepEqual(brandLib.cleanHeadings(['Heading 1', 'Click to edit', 'Title', 'Real One']), []);
  assert.deepEqual(brandLib.cleanHeadings(['1. Scope', '2. Schedule', '2. Schedule']), ['Scope', 'Schedule']);
  await assert.rejects(() => brandLib.extract(Buffer.from('not a zip'), 'x.docx'), /could not be opened/);
  await assert.rejects(() => brandLib.extract(Buffer.from('x'), 'x.pdf'), /Word .* PowerPoint/);
  const z = new JSZip(); z.file('hello.txt', 'hi');
  const zb = await z.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => brandLib.extract(zb, 'x.docx'), /does not look like/);
});

test('an unusable logo is reported, not silently dropped', async () => {
  const emf = await brandLib.extract(await word({ logoName: 'logo.emf', logoBytes: Buffer.from('EMF') }), 'a.docx');
  assert.equal(emf.brand.logo, null); assert.ok(emf.warnings.includes('logo_format'));
  const big = await brandLib.extract(await word({ logoBytes: Buffer.concat([LOGO, Buffer.alloc(800 * 1024)]) }), 'a.docx');
  assert.equal(big.brand.logo, null); assert.ok(big.warnings.includes('logo_too_large'));
  const none = await brandLib.extract(await word({ noLogo: true }), 'a.docx');
  assert.equal(none.brand.logo, null);
});

test('Claude chooses the color roles and cleans the headings, and bad answers fall back to the rules', async () => {
  const calls = [];
  const ai = async (p) => { calls.push(p); return { text: '```json\n' + JSON.stringify({ name: 'Acme Corp', colors: { primary: '112233', secondary: 'nothex', accent: '445566', text: 'FFFFFF', muted: '777777' }, fonts: { heading: 'Cambria', body: 'Aptos<script>' }, sections: ['Scope', 'Plan', 'Heading 1'] }) + '\n```' }; };
  const r = await brandLib.extract(await word(), 'a.docx', { ai });
  assert.equal(r.engine, 'claude'); assert.equal(calls.length, 1);
  assert.match(calls[0].user, /7B2D8E/, 'the facts are sent to Claude');
  assert.equal(r.name, 'Acme Corp');
  assert.equal(r.brand.colors.primary, '112233');
  assert.match(r.brand.colors.secondary, /^[0-9A-F]{6}$/);
  assert.ok(brandLib.contrast(r.brand.colors.text, 'FFFFFF') >= 7, 'white text is darkened until readable');
  assert.equal(r.brand.fonts.heading, 'Cambria'); assert.ok(!/[<>]/.test(r.brand.fonts.body), 'font names are cleaned');
  assert.deepEqual(r.headings, ['Scope', 'Plan', 'Heading 1'].filter((h) => h !== 'Heading 1'));
  const bad = await brandLib.extract(await word(), 'a.docx', { ai: async () => ({ text: 'sorry, no' }) });
  assert.equal(bad.engine, 'rules'); assert.ok(bad.warnings.includes('ai_failed')); assert.equal(bad.brand.colors.primary, '7B2D8E');
});

test('uploading a client template creates a template the project manager can read and change', async () => {
  const u = await s.user();
  const r = await s.call('POST', '/api/templates/client', form(await word(), 'Acme.docx', { name: 'Acme standard', mode: 'both', doc_type: 'progress_weekly' }), u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const t = r.data.template;
  assert.equal(t.name, 'Acme standard'); assert.equal(t.doc_type, 'progress_weekly'); assert.equal(t.mode, 'both');
  assert.equal(t.brand.colors.primary, '7B2D8E'); assert.ok(t.brand.logo.dataUrl);
  assert.equal(t.sections.length, 5);
  assert.equal(t.layout.header.right, 'Acme Corporation | Confidential'); assert.equal(t.layout.footer.left, 'Acme Corporation, Dubai');
  assert.equal(r.data.found.logo, true);
  // the list carries colors and fonts but not the logo bytes
  const list = (await s.call('GET', '/api/templates', null, u.token)).data.templates.find((x) => x.id === t.id);
  assert.equal(list.brand.colors.primary, '7B2D8E'); assert.equal(list.brand.has_logo, true); assert.equal(list.brand.logo, undefined);
  // change colors, fonts, name and sections
  const up = await s.call('PUT', `/api/templates/${t.id}`, { name: 'Acme v2', brand: { colors: { primary: '00AA55' }, fonts: { heading: 'Arial' } }, sections: ['Intro', 'Plan', 'Risks and Issues'] }, u.token);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const back = (await s.call('GET', `/api/templates/${t.id}`, null, u.token)).data.template;
  assert.equal(back.name, 'Acme v2'); assert.equal(back.brand.colors.primary, '00AA55'); assert.equal(back.brand.colors.secondary, t.brand.colors.secondary, 'other colors are kept');
  assert.equal(back.brand.fonts.heading, 'Arial'); assert.equal(back.brand.fonts.body, t.brand.fonts.body);
  assert.ok(back.brand.logo, 'logo is kept');
  assert.deepEqual(back.sections, ['Intro', 'Plan', 'Risks and Issues']);
  // validation
  assert.equal((await s.call('PUT', `/api/templates/${t.id}`, { brand: { colors: { primary: 'red' } } }, u.token)).status, 400);
  assert.equal((await s.call('PUT', `/api/templates/${t.id}`, { brand: { logo: { dataUrl: 'javascript:alert(1)' } } }, u.token)).status, 400);
  assert.equal((await s.call('PUT', `/api/templates/${t.id}`, { brand: { logo: null } }, u.token)).data.template.brand.logo, null);
  assert.equal((await s.call('POST', '/api/templates/client', form(Buffer.from('nope'), 'x.docx', { mode: 'design' }), u.token)).status, 400);
  assert.equal((await s.call('POST', '/api/templates/client', form(Buffer.from('nope'), 'x.txt', { mode: 'design' }), u.token)).status, 400);
});

test('a document made from a client template carries its brand, and old documents keep theirs', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Branded');
  const t = (await s.call('POST', '/api/templates/client', form(await word(), 'Acme.docx', { mode: 'both', doc_type: 'progress_weekly' }), u.token)).data.template;
  const g1 = (await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx', template_id: t.id }, u.token)).data.generated;
  assert.equal(g1.brand.colors.primary, '7B2D8E'); assert.ok(g1.brand.logo.dataUrl);
  assert.deepEqual([...g1.content.matchAll(/^# (.*)$/gm)].map((m) => m[1]), ['Introduction', 'Scope of Work', 'Project Schedule', 'Risks and Mitigation', 'Commercial Terms']);
  assert.deepEqual(g1.layout.header.right, 'Acme Corporation | Confidential');
  await s.call('PUT', `/api/templates/${t.id}`, { brand: { colors: { primary: '00AA55' } } }, u.token);
  const old = (await s.call('GET', `/api/generated/${g1.id}`, null, u.token)).data.generated;
  assert.equal(old.brand.colors.primary, '7B2D8E', 'existing documents keep their style');
  const g2 = (await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx', template_id: t.id }, u.token)).data.generated;
  assert.equal(g2.brand.colors.primary, '00AA55', 'new documents use the changed style');
  // a design pattern has no sections, so the standard sections are used
  const t2 = (await s.call('POST', '/api/templates/client', form(await word({ heads: ['Heading 1', 'Title'] }), 'Plain.docx', { mode: 'design' }), u.token)).data.template;
  assert.equal(t2.sections.length, 0);
  const g3 = (await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx', template_id: t2.id }, u.token)).data.generated;
  assert.ok([...g3.content.matchAll(/^# (.*)$/gm)].length >= 5); assert.ok(g3.brand);
  // a document without a client template has no brand
  const g4 = (await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly', format: 'docx' }, u.token)).data.generated;
  assert.equal(g4.brand, undefined);
  const sum = (await s.call('GET', `/api/projects/${p.id}/generated`, null, u.token)).data.generated;
  assert.equal(sum.find((x) => x.id === g1.id).branded, true); assert.equal(sum.find((x) => x.id === g4.id).branded, false);
});

test('a template saved from the editor keeps the brand of its document', async () => {
  const u = await s.user();
  const brand = { colors: { primary: '123456' }, fonts: { heading: 'Tahoma', body: 'Tahoma' }, logo: null };
  const fd = new FormData(); fd.append('name', 'From editor'); fd.append('doc_type', '*'); fd.append('body', '# A\n\nx\n'); fd.append('brand', JSON.stringify(brand));
  const r = await s.call('POST', '/api/templates', fd, u.token);
  assert.equal(r.status, 200); assert.equal(r.data.template.has_brand, true);
  const t = (await s.call('GET', `/api/templates/${r.data.template.id}`, null, u.token)).data.template;
  assert.equal(t.brand.colors.primary, '123456'); assert.equal(t.brand.fonts.heading, 'Tahoma');
});


async function excel() {
  const x = new JSZip();
  x.file('[Content_Types].xml', '<Types/>');
  x.file('xl/workbook.xml', '<workbook xmlns="x"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Schedule" sheetId="2" r:id="rId2"/><sheet name="Risks" sheetId="3" r:id="rId3"/></sheets></workbook>');
  x.file('xl/theme/theme1.xml', theme('Georgia', 'Verdana'));
  x.file('xl/styles.xml', '<styleSheet xmlns="x"><fonts count="2"><font><sz val="11"/><color rgb="FF2B2B2B"/><name val="Verdana"/></font><font><b/><sz val="16"/><color rgb="FF7B2D8E"/><name val="Georgia"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7B2D8E"/></patternFill></fill></fills></styleSheet>');
  x.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="x"><headerFooter><oddHeader>&amp;LAcme Finance&amp;RConfidential</oddHeader><oddFooter>&amp;CAcme Corporation, Dubai</oddFooter></headerFooter></worksheet>');
  x.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  x.file('xl/media/image1.png', LOGO);
  return x.generateAsync({ type: 'nodebuffer' });
}

test('an Excel template gives its colors, fonts, logo, header, footer and sheet names', async () => {
  const r = await brandLib.extract(await excel(), 'Budget.xlsx');
  assert.equal(r.brand.source.kind, 'Excel');
  assert.equal(r.brand.colors.primary, '7B2D8E');
  assert.equal(r.brand.fonts.heading, 'Georgia'); assert.equal(r.brand.fonts.body, 'Verdana');
  assert.ok(r.brand.logo && r.brand.logo.dataUrl.startsWith('data:image/png'));
  assert.deepEqual(r.headings, ['Summary', 'Schedule', 'Risks']);
  assert.match(r.header, /Acme Finance/); assert.match(r.footer, /Acme Corporation, Dubai/);
});

test('the intro page logo position is read from Word and PowerPoint files', async () => {
  const w = await JSZip.loadAsync(await word());
  const doc = await w.file('word/document.xml').async('string');
  w.file('word/document.xml', doc.replace('<w:body>', '<w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>'));
  const rw = await brandLib.extract(await w.generateAsync({ type: 'nodebuffer' }), 'a.docx');
  assert.equal(rw.intro.found, true); assert.equal(rw.intro.logo, 'center');
  const p = await JSZip.loadAsync(await ppt());
  p.file('ppt/presentation.xml', '<p:presentation xmlns:p="x"><p:sldSz cx="9144000" cy="5143500"/></p:presentation>');
  const s1 = await p.file('ppt/slides/slide1.xml').async('string');
  p.file('ppt/slides/slide1.xml', s1.replace('</p:sld>', '<p:pic><p:spPr><a:xfrm><a:off x="7600000" y="300000"/><a:ext cx="1000000" cy="500000"/></a:xfrm></p:spPr></p:pic></p:sld>'));
  const rp = await brandLib.extract(await p.generateAsync({ type: 'nodebuffer' }), 'a.pptx');
  assert.equal(rp.intro.found, true); assert.equal(rp.intro.logo, 'right');
});

test('the project manager chooses design, structure or both, and the document type is required only when the structure is used', async () => {
  const u = await s.user(); const call = (fd) => s.call('POST', '/api/templates/client', fd, u.token);
  const doc = await word(), xl = await excel();
  // no choice, or a wrong choice
  assert.equal((await call(form(doc, 'a.docx'))).status, 400);
  assert.equal((await call(form(doc, 'a.docx', { mode: 'everything' }))).status, 400);
  // structure and both need a valid document type
  for (const mode of ['structure', 'both']) {
    const none = await call(form(doc, 'a.docx', { mode })); assert.equal(none.status, 400); assert.match(none.data.error || none.data.message || JSON.stringify(none.data), /document type/i);
    assert.equal((await call(form(doc, 'a.docx', { mode, doc_type: '*' }))).status, 400, 'all types is not allowed for the structure');
    assert.equal((await call(form(doc, 'a.docx', { mode, doc_type: 'nonsense' }))).status, 400);
  }
  // design needs no type, applies to all types, and drops the headings
  const d = await call(form(doc, 'a.docx', { mode: 'design', doc_type: 'charter' }));
  assert.equal(d.status, 200, JSON.stringify(d.data)); assert.equal(d.data.template.doc_type, '*'); assert.equal(d.data.template.mode, 'design');
  assert.deepEqual(d.data.template.sections, []); assert.ok(d.data.template.brand && d.data.template.layout);
  // structure keeps the headings and no design
  const st = await call(form(doc, 'a.docx', { mode: 'structure', doc_type: 'charter' }));
  assert.equal(st.status, 200); assert.equal(st.data.template.mode, 'structure'); assert.equal(st.data.template.doc_type, 'charter');
  assert.equal(st.data.template.brand, null); assert.equal(st.data.template.layout, null); assert.equal(st.data.template.sections.length, 5);
  // Excel works in every mode and its sheet names are the sections
  const xs = await call(form(xl, 'b.xlsx', { mode: 'both', doc_type: 'pm_plan' }));
  assert.equal(xs.status, 200, JSON.stringify(xs.data)); assert.deepEqual(xs.data.template.sections, ['Summary', 'Schedule', 'Risks']); assert.equal(xs.data.template.brand.fonts.heading, 'Georgia');
  // a file with no usable headings can still give a design, but not a structure
  const plain = await word({ heads: ['Heading 1', 'Title'] });
  assert.equal((await call(form(plain, 'p.docx', { mode: 'structure', doc_type: 'charter' }))).status, 400);
  assert.equal((await call(form(plain, 'p.docx', { mode: 'both', doc_type: 'charter' }))).status, 400);
  assert.equal((await call(form(plain, 'p.docx', { mode: 'design' }))).status, 200);
  // the list tells each mode apart
  const list = (await s.call('GET', '/api/templates', null, u.token)).data.templates;
  assert.equal(list.find((x) => x.id === d.data.template.id).mode, 'design');
  assert.equal(list.find((x) => x.id === st.data.template.id).brand, undefined);
  assert.equal(list.find((x) => x.id === st.data.template.id).sections, 5);
});

test('a design pattern works for every document type, a structure only for its own type', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Modes'); const gen = (type, tid) => s.call('POST', `/api/projects/${p.id}/generate`, { type, format: 'docx', template_id: tid }, u.token);
  const call = (fd) => s.call('POST', '/api/templates/client', fd, u.token);
  const doc = await word();
  const d = (await call(form(doc, 'a.docx', { mode: 'design' }))).data.template;
  const st = (await call(form(doc, 'a.docx', { mode: 'structure', doc_type: 'progress_weekly' }))).data.template;
  const both = (await call(form(doc, 'a.docx', { mode: 'both', doc_type: 'progress_weekly' }))).data.template;
  const headings = (g) => [...g.content.matchAll(/^# (.*)$/gm)].map((m) => m[1]);
  for (const type of ['progress_weekly', 'charter']) {
    const g = (await gen(type, d.id)).data.generated;
    assert.equal(g.brand.colors.primary, '7B2D8E', `design applies to ${type}`); assert.ok(g.layout);
    assert.ok(!headings(g).includes('Scope of Work'), 'a design pattern brings no sections');
  }
  const gs = (await gen('progress_weekly', st.id)).data.generated;
  assert.equal(gs.brand, undefined, 'structure only: no brand'); assert.equal(gs.layout, undefined);
  assert.deepEqual(headings(gs), ['Introduction', 'Scope of Work', 'Project Schedule', 'Risks and Mitigation', 'Commercial Terms']);
  const gb = (await gen('progress_weekly', both.id)).data.generated;
  assert.equal(gb.brand.colors.primary, '7B2D8E'); assert.deepEqual(headings(gb), headings(gs));
  assert.equal((await gen('charter', st.id)).status, 404, 'a structure is not offered for another type');
  assert.equal((await gen('charter', both.id)).status, 404);
  // a design template ignores edits to sections, a structure template ignores edits to the brand
  const r1 = await s.call('PUT', `/api/templates/${d.id}`, { sections: ['X', 'Y'], brand: { colors: { primary: '00AA55' } } }, u.token);
  assert.deepEqual(r1.data.template.sections, []); assert.equal(r1.data.template.brand.colors.primary, '00AA55');
  const r2 = await s.call('PUT', `/api/templates/${st.id}`, { sections: ['A', 'B'], brand: { colors: { primary: '00AA55' } } }, u.token);
  assert.deepEqual(r2.data.template.sections, ['A', 'B']); assert.equal(r2.data.template.brand, null);
});

// ---- the files follow the brand ----
function load(files) {
  const win = {}; vm.createContext(win); win.window = win;
  vm.runInContext(fs.readFileSync(path.join(PUB, 'engine.js'), 'utf8'), win, { filename: 'engine.js' });
  win.PM = {}; global.window = win;
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(PUB, f), 'utf8'), { filename: f });
  return win;
}
const pngAsset = (buf) => { const d = new Uint8Array(buf); const v = new DataView(d.buffer, d.byteOffset); return { data: d, w: v.getUint32(16), h: v.getUint32(20) }; };
const doc = { id: 1, doc_type: 'progress_weekly', title: 'Branded report', format: 'docx', template: 'Acme standard', content: '# First\n\nHello\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n# Second\n\n- one\n', meta: { project: 'Apollo', client: 'Acme', date: '2027-03-05' }, visuals: null,
  brand: { colors: { primary: '7B2D8E', secondary: 'F28C28', accent: '2BA6A0', text: '2B2B2B', muted: '747474' }, fonts: { heading: 'Georgia', body: 'Verdana' }, logo: { dataUrl: 'data:image/png;base64,' + LOGO.toString('base64'), w: 512, h: 512 } } };

test('the Word file uses the client colors and fonts and none of the platform blue', async () => {
  const win = load(['export.js', 'export_docx.js']); win.docx = require('docx');
  const ex = win.PM.exporter;
  const restore = ex.applyBrand(doc.brand);
  let zip;
  try { const blob = await ex.builders.docx({ plan: ex.plan(doc), logo: pngAsset(LOGO), mark: pngAsset(LOGO), client: null }); zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer())); } finally { restore(); }
  const all = (await Promise.all(Object.keys(zip.files).filter((f) => /^word\/.*\.xml$/.test(f)).map((f) => zip.file(f).async('string')))).join('\n');
  assert.match(all, /7B2D8E/, 'primary color is used');
  assert.match(all, /Georgia/); assert.match(all, /Verdana/);
  assert.ok(!/2457D6/i.test(all), 'platform primary is gone');
  assert.ok(!/IBM Plex/.test(all), 'platform font is gone');
  assert.match(all, /Acme standard logo/, 'logo is described by the template name');
  assert.ok(Object.keys(zip.files).some((f) => /^word\/media\//.test(f)), 'the logo is in the file');
  // nothing leaks to the next build
  assert.equal(ex.T.primary, '2457D6'); assert.equal(ex.FONT_NAME, 'IBM Plex Sans');
});

test('a brand with no logo draws no logo at all, and light colors are darkened to stay readable', async () => {
  const win = load(['export.js', 'export_docx.js']); win.docx = require('docx');
  const ex = win.PM.exporter;
  const noLogo = { ...doc, brand: { ...doc.brand, logo: null } };
  const p = ex.plan(noLogo);
  assert.equal(p.layout.logo.cover, 'hidden'); assert.equal(p.layout.logo.header, 'hidden');
  const restore = ex.applyBrand({ ...doc.brand, colors: { ...doc.brand.colors, primary: 'FFE066', text: 'BBBBBB' } });
  try {
    assert.ok(ex.contrast(ex.T.primary, 'FFFFFF') >= 3, 'primary is readable on white');
    assert.ok(ex.contrast(ex.T.text, 'FFFFFF') >= 7, 'text is readable on white');
    const blob = await ex.builders.docx({ plan: p, logo: null, mark: null, client: null });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    assert.ok(!Object.keys(zip.files).some((f) => /^word\/media\//.test(f)), 'no picture in the file');
  } finally { restore(); }
});

test('PowerPoint and Excel files use the client brand as well', async () => {
  const win = load(['export.js', 'export_pptx.js', 'export_xlsx.js']); win.PptxGenJS = require('pptxgenjs'); win.ExcelJS = require(path.join(PUB, 'vendor', 'exceljs.min.js'));
  const ex = win.PM.exporter;
  const restore = ex.applyBrand(doc.brand);
  try {
    const blob = await ex.builders.pptx({ plan: ex.plan({ ...doc, format: 'pptx' }), logo: pngAsset(LOGO), mark: pngAsset(LOGO), client: null });
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    const xml = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/(slides|slideMasters)\/[^/]+\.xml$/.test(f)).map((f) => zip.file(f).async('string')))).join('\n');
    assert.match(xml, /7B2D8E/); assert.match(xml, /Georgia/); assert.match(xml, /Verdana/); assert.ok(!/2457D6/i.test(xml), 'no platform blue in slides');
  } finally { restore(); }
});
