'use strict';
// The widget filter reads the full payment and overdue lists, so a year far from today still has rows to filter.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start({ snapshotJob: false }); }); after(() => s.close());

test('the dashboard carries every payment, not only the next few', async () => {
  const u = (await s.call('POST', '/api/auth/register', { name: 'Filter User', email: 'wf@test.co', password: 'password1' })).data;
  const fd = new FormData(); fd.append('name', 'Filter project');
  const p = (await s.call('POST', '/api/projects', fd, u.token)).data.project;
  for (const due of ['2027-01-10', '2027-03-10', '2027-06-10', '2027-09-10', '2027-12-10', '2028-02-10']) {
    await s.call('POST', `/api/projects/${p.id}/items`, { kind: 'milestone', title: 'Pay ' + due, data: { due_date: due, amount: 100 } }, u.token);
  }
  const d = (await s.call('GET', '/api/dashboard', null, u.token)).data;
  assert.ok(d.payments.length <= 10, 'the default list stays short');
  assert.equal(d.payments_all.length, 6, 'the filter sees all six');
  assert.deepEqual(d.payments_all.map((x) => x.due.slice(0, 4)).filter((y) => y === '2027').length, 5);
  assert.ok(Array.isArray(d.overdue_all));
});
