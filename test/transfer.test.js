'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

const CONTRACT = 'Client: Ministry of Test\nContract value: AED 1,000,000\nStart date: 2027-03-01\nEnd date: 2027-09-30\nDeliverable 1: Design document due 2027-04-15\nPayment 1: 30% on signing';
async function ready(u, name = 'Source') {
  const p = await s.project(u.token, name, CONTRACT);
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Task one', duration: 3, start: '2027-03-01' }, u.token);
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Task two', duration: 2 }, u.token);
  return p;
}
const allIds = (o, out = []) => { if (Array.isArray(o)) o.forEach((x) => allIds(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'id' && typeof v === 'number') out.push(v); else allIds(v, out); } return out; };

test('project export then import makes an independent copy', async () => {
  const u = await s.user(); const p = await ready(u);
  const ex = await s.call('GET', `/api/projects/${p.id}/export?files=1`, null, u.token);
  assert.equal(ex.status, 200);
  const backup = JSON.parse(ex.buf.toString());
  assert.equal(backup.format, 'pmai-project'); assert.equal(backup.version, 1);
  assert.equal(backup.files.length, 1);
  const im = await s.call('POST', '/api/projects/import', backup, u.token);
  assert.equal(im.status, 200, JSON.stringify(im.data));
  const copy = im.data.imported[0];
  assert.equal(copy.name, 'Source (imported)'); assert.ok(copy.id !== p.id);
  const a = (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data.tasks;
  const b = (await s.call('GET', `/api/projects/${copy.id}/schedule`, null, u.token)).data.tasks;
  assert.deepEqual(b.map((t) => [t.name, t.start, t.duration]), a.map((t) => [t.name, t.start, t.duration]));
  const idsA = new Set(allIds(JSON.parse((await s.call('GET', `/api/projects/${p.id}/export`, null, u.token)).buf.toString()).project));
  const idsB = allIds(JSON.parse((await s.call('GET', `/api/projects/${copy.id}/export`, null, u.token)).buf.toString()).project);
  assert.ok(idsB.every((i) => !idsA.has(i) || i === undefined), 'no id is shared with the original');
  const docs = (await s.call('GET', `/api/projects/${copy.id}/documents`, null, u.token)).data.documents;
  const f = await s.call('GET', `/api/projects/${copy.id}/documents/${docs[0].id}/file`, null, u.token);
  assert.equal(f.buf.toString(), CONTRACT, 'original document came with the backup');
  await s.call('POST', `/api/projects/${copy.id}/tasks`, { name: 'Only in copy' }, u.token);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data.tasks.length, a.length, 'the original is untouched');
});
test('a backup can be imported by another account', async () => {
  const a = await s.user(), b = await s.user(); const p = await ready(a, 'Shared copy');
  const backup = JSON.parse((await s.call('GET', `/api/projects/${p.id}/export`, null, a.token)).buf.toString());
  const im = await s.call('POST', '/api/projects/import', backup, b.token);
  assert.equal(im.status, 200); assert.equal(im.data.imported[0].name, 'Shared copy');
  const mine = (await s.call('GET', `/api/projects/${im.data.imported[0].id}`, null, b.token)).data.project;
  assert.equal(mine.role, 'manager');
  assert.equal((await s.call('GET', `/api/projects/${im.data.imported[0].id}`, null, a.token)).status, 404);
});
test('importing a file upload works', async () => {
  const u = await s.user(); const p = await ready(u, 'Upload me');
  const buf = (await s.call('GET', `/api/projects/${p.id}/export`, null, u.token)).buf;
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'application/json' }), 'x.pmai.json');
  const r = await s.call('POST', '/api/projects/import', fd, u.token);
  assert.equal(r.status, 200); assert.equal(r.data.imported.length, 1);
});
test('workspace export and import', async () => {
  const a = await s.user(), b = await s.user();
  await ready(a, 'W1'); await ready(a, 'W2');
  const ex = await s.call('GET', '/api/workspace/export', null, a.token);
  const ws = JSON.parse(ex.buf.toString()); assert.equal(ws.format, 'pmai-workspace'); assert.equal(ws.projects.length, 2);
  const r = await s.call('POST', '/api/projects/import', ws, b.token);
  assert.equal(r.status, 200); assert.equal(r.data.imported.length, 2);
  assert.deepEqual((await s.call('GET', '/api/projects', null, b.token)).data.projects.map((x) => x.name).sort(), ['W1', 'W2']);
});
test('bad or hostile backups are refused and change nothing', async () => {
  const u = await s.user(); const p = await ready(u, 'Base');
  const good = JSON.parse((await s.call('GET', `/api/projects/${p.id}/export`, null, u.token)).buf.toString());
  const cases = {
    'not an object': 'nope', 'array': [], 'wrong format': { format: 'other', version: 1 }, 'future version': { ...good, version: 99 },
    'no project': { format: 'pmai-project', version: 1 }, 'no name': { ...good, project: { ...good.project, p: { ...good.project.p, name: '  ' } } },
    'tasks not objects': { ...good, project: { ...good.project, tasks: [1, 2] } },
    'too many tasks': { ...good, project: { ...good.project, tasks: Array.from({ length: 20001 }, (_, i) => ({ id: i + 1, name: 'x' })) } },
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = await s.call('POST', '/api/projects/import', typeof body === 'string' ? JSON.stringify(body) : body, u.token, typeof body === 'string' ? { 'content-type': 'application/json' } : {});
    assert.equal(r.status, 400, name + ' -> ' + r.status);
  }
  const junk = new FormData(); junk.append('file', new Blob(['{not json'], { type: 'application/json' }), 'a.json');
  assert.equal((await s.call('POST', '/api/projects/import', junk, u.token)).status, 400);
  assert.equal((await s.call('GET', '/api/projects', null, u.token)).data.projects.length, 1);
});
test('import cleans broken links, bad dates and prototype keys', async () => {
  const u = await s.user(); const p = await ready(u, 'Clean');
  const good = JSON.parse((await s.call('GET', `/api/projects/${p.id}/export`, null, u.token)).buf.toString());
  const bad = JSON.parse(JSON.stringify(good));
  bad.project.tasks[0].deps = [{ id: 999999, type: 'FS', lag: 0 }];
  bad.project.tasks[0].parent_id = 424242;
  bad.project.p.start_date = 'yesterday-ish'; bad.project.p.work_days = [9, 'x'];
  bad.project.p.name = 'Hostile';
  bad.project.p.__proto__ = { polluted: 1 };
  bad.project.tasks[1].constructor = { prototype: { polluted: 1 } };
  const r = await s.call('POST', '/api/projects/import', JSON.stringify(bad).replace('"p":{', '"p":{"__proto__":{"polluted":1},'), u.token, { 'content-type': 'application/json' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.imported[0].warnings.length >= 2);
  assert.equal({}.polluted, undefined);
  const out = (await s.call('GET', `/api/projects/${r.data.imported[0].id}`, null, u.token)).data.project;
  assert.equal(out.start_date, null); assert.deepEqual(out.work_days, [1, 2, 3, 4, 5]);
  const tasks = (await s.call('GET', `/api/projects/${r.data.imported[0].id}/schedule`, null, u.token)).data.tasks;
  assert.ok(tasks.every((t) => t.parent_id == null || tasks.some((x) => x.id === t.parent_id)));
});
test('schedule exports open as real spreadsheets', async () => {
  const u = await s.user(); const p = await ready(u, 'Sheets');
  const csv = await s.call('GET', `/api/projects/${p.id}/schedule/export?format=csv`, null, u.token);
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /csv/);
  const text = csv.buf.toString('utf8').replace(/^﻿/, '');
  assert.match(text, /Task one/); assert.match(text, /Task two/);
  const x = await s.call('GET', `/api/projects/${p.id}/schedule/export?format=xlsx`, null, u.token);
  const wb = XLSX.read(x.buf);
  assert.ok(wb.SheetNames.includes('Schedule'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Schedule, { header: 1 });
  assert.ok(rows.some((r) => r.includes('Task one')));
});
test('csv export does not let cells run as formulas', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Formula');
  await s.call('POST', `/api/projects/${p.id}/tasks`, { name: '=HYPERLINK("http://evil","x")', duration: 1 }, u.token);
  const csv = (await s.call('GET', `/api/projects/${p.id}/schedule/export?format=csv`, null, u.token)).buf.toString();
  assert.ok(!/(^|,|")=HYPERLINK/.test(csv.split('\n').slice(1).join('\n')), 'leading = is neutralized');
});
test('generated reports download as Word, Excel, PowerPoint and Markdown', async () => {
  const u = await s.user(); const p = await ready(u, 'Reports');
  const g = await s.call('POST', `/api/projects/${p.id}/generate`, { type: 'progress_weekly' }, u.token);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const id = g.data.generated.id;
  for (const [fmt, entry] of [['docx', 'word/document.xml'], ['pptx', 'ppt/presentation.xml'], ['xlsx', 'xl/workbook.xml']]) {
    const r = await s.call('GET', `/api/generated/${id}/${fmt}`, null, u.token);
    assert.equal(r.status, 200, fmt); assert.match(r.headers.get('content-disposition') || '', /attachment/);
    const zip = await JSZip.loadAsync(r.buf); assert.ok(zip.file(entry), fmt + ' has ' + entry);
  }
  const md = await s.call('GET', `/api/generated/${id}/md`, null, u.token);
  assert.equal(md.status, 200); assert.ok(md.buf.length > 50);
  const other = await s.user();
  assert.equal((await s.call('GET', `/api/generated/${id}/docx`, null, other.token)).status, 404);
});
