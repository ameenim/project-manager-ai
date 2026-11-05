'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

// A file saved from Microsoft Project with per day timephased detail on every assignment: far bigger than the
// 8 MB JSON limit, though the part the import reads is small.
function bigXml(tasks, bloatPerAssignment) {
  const phase = '<TimephasedData><Type>1</Type><UID>1</UID><Start>2026-01-01T08:00:00</Start><Finish>2026-01-01T17:00:00</Finish><Unit>2</Unit><Value>PT8H0M0S</Value></TimephasedData>\n\t\t\t';
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">\n\t<MinutesPerDay>480</MinutesPerDay>\n\t<Tasks>\n';
  for (let i = 1; i <= tasks; i++) x += `\t\t<Task>\n\t\t\t<UID>${i}</UID>\n\t\t\t<Name>Task ${i}</Name>\n\t\t\t<OutlineLevel>${i === 1 ? 1 : 2}</OutlineLevel>\n\t\t\t<Start>2026-01-04T08:00:00</Start>\n\t\t\t<Finish>2026-01-08T17:00:00</Finish>\n\t\t\t<Duration>PT40H0M0S</Duration>\n\t\t</Task>\n`;
  x += '\t</Tasks>\n\t<Resources><Resource><UID>1</UID><Name>Ana</Name></Resource></Resources>\n\t<Assignments>\n';
  for (let i = 2; i <= tasks; i++) x += `\t\t<Assignment>\n\t\t\t<UID>${i}</UID>\n\t\t\t<TaskUID>${i}</TaskUID>\n\t\t\t<ResourceUID>1</ResourceUID>\n\t\t\t${phase.repeat(bloatPerAssignment)}</Assignment>\n`;
  return x + '\t</Assignments>\n</Project>\n';
}

test('a large Microsoft Project file imports and an oversized one gets a clear message', async () => {
  const u = await s.user(); const p = await s.project(u.token, 'Big');
  const xml = bigXml(300, 300);
  assert.ok(xml.length > 12 * 1024 * 1024, 'fixture is larger than the normal JSON limit');
  const pv = await s.call('POST', `/api/projects/${p.id}/msproject/import`, { xml, mode: 'replace', preview: true }, u.token);
  assert.equal(pv.status, 200, JSON.stringify(pv.data).slice(0, 200));
  assert.equal(pv.data.summary.tasks, 300);
  const go = await s.call('POST', `/api/projects/${p.id}/msproject/import`, { xml, mode: 'replace' }, u.token);
  assert.equal(go.status, 200);
  assert.equal(go.data.tasks.length, 300);
  assert.ok(go.data.tasks.some((t) => t.assignee === 'Ana'));
  const huge = 'x'.repeat(70 * 1024 * 1024);
  const bad = await s.call('POST', `/api/projects/${p.id}/msproject/import`, { xml: huge, mode: 'replace' }, u.token);
  assert.equal(bad.status, 413);
});
