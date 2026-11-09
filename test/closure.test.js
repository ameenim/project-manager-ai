'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
let s; before(async () => { s = await start(); }); after(() => s.close());

async function setup(name = 'Closure') {
  const u = await s.user(); const p = await s.project(u.token, name);
  const add = async (kind, title, extra = {}) => (await s.call('POST', `/api/projects/${p.id}/items`, { kind, title, ...extra }, u.token)).data.item;
  const d1 = await add('deliverable', 'Design document', { data: { due_date: '2027-04-15' } });
  const d2 = await add('deliverable', 'Mobile app');
  const r1 = await add('requirement', 'Support Arabic', { description: 'Support Arabic', data: { priority: 'Must' } });
  const closure = async () => (await s.call('GET', `/api/projects/${p.id}/closure`, null, u.token)).data;
  const put = (id, body) => s.call('PUT', `/api/items/${id}`, body, u.token);
  const gen = (type) => s.call('POST', `/api/projects/${p.id}/generate`, { type, format: 'docx' }, u.token);
  return { u, p, d1, d2, r1, closure, put, gen };
}

test('a project is not ready while deliverables and requirements are open', async () => {
  const x = await setup();
  const c = await x.closure();
  assert.equal(c.ready, false);
  assert.equal(c.checks.find((k) => k.code === 'items_open').n, 3);
  const r = await s.call('POST', `/api/projects/${x.p.id}/close`, {}, x.u.token);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not ready to close/);
  assert.equal((await s.call('GET', `/api/projects/${x.p.id}`, null, x.u.token)).data.project.status, 'active');
});

test('not delivered needs a reason and a reopened item loses it', async () => {
  const x = await setup();
  const bad = await x.put(x.d2.id, { state: 'closed', data: { outcome: 'not_delivered' } });
  assert.equal(bad.status, 400);
  assert.equal((await x.closure()).scope.counts.open, 3, 'a refused change leaves the item as it was');
  const ok = await x.put(x.d2.id, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: '  Client cancelled the mobile scope  ' } });
  assert.equal(ok.status, 200);
  let row = (await x.closure()).scope.rows.find((r) => r.id === x.d2.id);
  assert.equal(row.outcome, 'not_delivered'); assert.equal(row.reason, 'Client cancelled the mobile scope');
  // closing it as delivered clears the flag
  await x.put(x.d2.id, { data: { outcome: 'delivered' } });
  row = (await x.closure()).scope.rows.find((r) => r.id === x.d2.id);
  assert.equal(row.outcome, 'delivered'); assert.equal(row.reason, '');
  // not delivered again, then reopened
  await x.put(x.d2.id, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: 'Out of budget' } });
  await x.put(x.d2.id, { state: 'open' });
  row = (await x.closure()).scope.rows.find((r) => r.id === x.d2.id);
  assert.equal(row.outcome, 'open'); assert.equal(row.reason, '');
  // a risk cannot be closed as not delivered
  const risk = (await s.call('POST', `/api/projects/${x.p.id}/items`, { kind: 'risk', title: 'A risk' }, x.u.token)).data.item;
  assert.equal((await x.put(risk.id, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: 'Because' } })).status, 400);
});

test('the closure documents wait for every item and list the reasons', async () => {
  const x = await setup();
  assert.equal((await x.gen('lessons_learned')).status, 400, 'open items block the report');
  await x.put(x.d1.id, { state: 'closed' });
  await x.put(x.r1.id, { state: 'closed' });
  await x.put(x.d2.id, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: 'Client cancelled the mobile scope' } });
  const ll = await x.gen('lessons_learned');
  assert.equal(ll.status, 200);
  assert.match(ll.data.generated.content, /Scope Not Delivered and Reasons/);
  assert.match(ll.data.generated.content, /Mobile app/);
  assert.match(ll.data.generated.content, /Client cancelled the mobile scope/);
  const cert = await x.gen('completion_certificate');
  assert.equal(cert.status, 200);
  assert.match(cert.data.generated.content, /completed with exceptions/);
  let c = await x.closure();
  assert.equal(c.documents.lessons_learned.current, true);
  assert.equal(c.ready, false, 'the acceptance details are still missing');
  assert.equal(c.checks.find((k) => k.code === 'acceptance').ok, false);
  // recording the acceptance makes the certificate out of date until it is written again
  const put = await s.call('PUT', `/api/projects/${x.p.id}/closure`, { accepted_by: 'Sam Client', accepted_on: '2027-10-01' }, x.u.token);
  assert.equal(put.status, 200);
  c = put.data;
  assert.equal(c.documents.completion_certificate.current, false);
  assert.equal(c.documents.lessons_learned.current, true);
  const cert2 = await x.gen('completion_certificate');
  assert.match(cert2.data.generated.content, /Sam Client/);
  assert.equal((await x.closure()).ready, true);
});

test('a change after the report was written makes it out of date', async () => {
  const x = await setup();
  for (const id of [x.d1.id, x.d2.id, x.r1.id]) await x.put(id, { state: 'closed' });
  await s.call('PUT', `/api/projects/${x.p.id}/closure`, { accepted_by: 'Sam', accepted_on: '2027-10-01' }, x.u.token);
  await x.gen('lessons_learned'); await x.gen('completion_certificate');
  assert.equal((await x.closure()).ready, true);
  await x.put(x.d2.id, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: 'Dropped late' } });
  const c = await x.closure();
  assert.equal(c.ready, false);
  assert.equal(c.documents.lessons_learned.current, false);
  assert.equal(c.documents.completion_certificate.current, false);
  assert.match((await s.call('POST', `/api/projects/${x.p.id}/close`, {}, x.u.token)).data.error, /lessons learned report is missing or out of date/);
});

test('items waiting for review block the closure', async () => {
  const x = await setup();
  const P = (await s.call('GET', `/api/projects/${x.p.id}/items`, null, x.u.token)).data.items;
  assert.equal(P.length, 3);
  // an extracted item that is not confirmed yet
  const ignore = await s.call('POST', `/api/items/${x.r1.id}/reopen`, null, x.u.token);
  assert.equal(ignore.status, 200);
  const c = await x.closure();
  assert.equal(c.checks.find((k) => k.code === 'items_review').n, 1);
  assert.equal(c.scope.counts.total, 2);
});

test('closing makes the project read only, leaves the dashboards and can be undone by reopening', async () => {
  const x = await setup('Closing');
  for (const id of [x.d1.id, x.d2.id, x.r1.id]) await x.put(id, { state: 'closed' });
  await s.call('PUT', `/api/projects/${x.p.id}/closure`, { accepted_by: 'Sam', accepted_on: '2027-10-01' }, x.u.token);
  await x.gen('lessons_learned'); await x.gen('completion_certificate');
  assert.equal((await s.call('GET', '/api/dashboard', null, x.u.token)).data.projects.length >= 1, true);
  const closed = await s.call('POST', `/api/projects/${x.p.id}/close`, {}, x.u.token);
  assert.equal(closed.status, 200);
  assert.equal(closed.data.project.status, 'closed');
  assert.ok(closed.data.project.closed_at);
  assert.equal(closed.data.closure.status, 'closed');
  // read only for changes
  assert.equal((await x.put(x.d1.id, { state: 'open' })).status, 409);
  assert.equal((await s.call('POST', `/api/projects/${x.p.id}/items`, { kind: 'risk', title: 'Late' }, x.u.token)).status, 409);
  assert.equal((await s.call('PUT', `/api/projects/${x.p.id}`, { name: 'Renamed' }, x.u.token)).status, 409);
  assert.equal((await s.call('PUT', `/api/projects/${x.p.id}`, { status: 'active' }, x.u.token)).status, 409, 'settings cannot reopen it');
  assert.equal((await s.call('GET', `/api/projects/${x.p.id}`, null, x.u.token)).status, 200);
  assert.equal((await s.call('POST', `/api/projects/${x.p.id}/close`, {}, x.u.token)).status, 409);
  // out of the portfolio views
  assert.equal((await s.call('GET', '/api/dashboard', null, x.u.token)).data.projects.some((c) => c.id === x.p.id), false);
  assert.equal((await s.call('GET', '/api/calendar', null, x.u.token)).data.projects.some((c) => c.id === x.p.id), false);
  // reopen needs a reason
  assert.equal((await s.call('POST', `/api/projects/${x.p.id}/reopen`, {}, x.u.token)).status, 400);
  const re = await s.call('POST', `/api/projects/${x.p.id}/reopen`, { reason: 'Client found a defect' }, x.u.token);
  assert.equal(re.status, 200);
  assert.equal(re.data.project.status, 'active');
  assert.equal(re.data.closure.history[0].action, 'reopened');
  assert.equal((await x.put(x.d1.id, { state: 'open' })).status, 200);
  assert.equal((await s.call('GET', '/api/dashboard', null, x.u.token)).data.projects.some((c) => c.id === x.p.id), true);
});

test('the settings cannot close a project around the checks', async () => {
  const x = await setup();
  assert.equal((await s.call('PUT', `/api/projects/${x.p.id}`, { status: 'closed' }, x.u.token)).status, 400);
  assert.equal((await s.call('GET', `/api/projects/${x.p.id}`, null, x.u.token)).data.project.status, 'active');
  assert.equal((await s.call('PUT', `/api/projects/${x.p.id}`, { status: 'archived' }, x.u.token)).status, 200);
  assert.equal((await s.call('POST', `/api/projects/${x.p.id}/close`, {}, x.u.token)).status, 409, 'an archived project cannot be closed');
});

test('only the project manager can change the closure', async () => {
  const x = await setup();
  const ed = await s.user(); const vw = await s.user();
  await s.call('POST', `/api/projects/${x.p.id}/members`, { email: ed.email, role: 'editor' }, x.u.token);
  await s.call('POST', `/api/projects/${x.p.id}/members`, { email: vw.email, role: 'viewer' }, x.u.token);
  assert.equal((await s.call('GET', `/api/projects/${x.p.id}/closure`, null, vw.token)).data.can_manage, false);
  for (const tok of [ed.token, vw.token]) {
    assert.equal((await s.call('PUT', `/api/projects/${x.p.id}/closure`, { accepted_by: 'X' }, tok)).status, 403);
    assert.equal((await s.call('POST', `/api/projects/${x.p.id}/close`, {}, tok)).status, 403);
    assert.equal((await s.call('POST', `/api/projects/${x.p.id}/reopen`, { reason: 'because' }, tok)).status, 403);
  }
});

test('a closed project survives a backup and import', async () => {
  const x = await setup('Backup');
  for (const id of [x.d1.id, x.d2.id, x.r1.id]) await x.put(id, { state: 'closed' });
  await x.put(x.d2.id, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: 'Cancelled by client' } });
  await s.call('PUT', `/api/projects/${x.p.id}/closure`, { accepted_by: 'Sam', accepted_on: '2027-10-01' }, x.u.token);
  await x.gen('lessons_learned'); await x.gen('completion_certificate');
  assert.equal((await s.call('POST', `/api/projects/${x.p.id}/close`, {}, x.u.token)).status, 200);
  const exp = await s.call('GET', `/api/projects/${x.p.id}/export`, null, x.u.token);
  assert.equal(exp.status, 200);
  const fd = new FormData(); fd.append('file', new Blob([exp.buf], { type: 'application/json' }), 'backup.json');
  const imp = await s.call('POST', '/api/projects/import', fd, x.u.token);
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  const id = imp.data.imported[0].id;
  const c = (await s.call('GET', `/api/projects/${id}/closure`, null, x.u.token)).data;
  assert.equal(c.status, 'closed');
  assert.equal(c.accepted_by, 'Sam');
  assert.equal(c.documents.lessons_learned.current, true);
  assert.equal(c.scope.rows.find((r) => r.outcome === 'not_delivered').reason, 'Cancelled by client');
});
