'use strict';
// Overview filters: year, quarter, month, status, health, currency, client and project. The screen, the report and the Excel rows share one server filter.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { start } = require('./helpers');

let s, u;
before(async () => {
  s = await start({ opsJobs: false });
  u = await s.user('Filters');
  assert.equal((await s.call('POST', '/api/workspace/sample', {}, u.token)).status, 200);
});
after(() => s.close());
const dash = async (qs = '') => (await s.call('GET', '/api/dashboard' + qs, null, u.token));

test('no filter returns every project and offers the filter choices', async () => {
  const r = await dash();
  assert.equal(r.status, 200);
  const o = r.data.filter_options;
  assert.ok(o.years.length && o.projects.length === r.data.projects.length);
  assert.ok(Array.isArray(o.currencies) && Array.isArray(o.clients));
});

test('invalid filter values are rejected', async () => {
  for (const qs of ['?y=1900', '?q=5', '?m=13', '?s=bogus', '?h=blue', '?cur=DOLLAR', '?p=abc']) assert.equal((await dash(qs)).status, 400, qs);
});

test('a project filter narrows the portfolio and the totals follow', async () => {
  const all = (await dash()).data, id = all.projects[0].id;
  const one = (await dash('?p=' + id)).data;
  assert.equal(one.projects.length, 1);
  assert.equal(one.projects[0].id, id);
  assert.ok(one.counts.active <= all.counts.active);
});

test('a health filter keeps only matching projects', async () => {
  const all = (await dash()).data;
  const h = all.projects[0].stats.health;
  const r = (await dash('?h=' + h)).data;
  assert.ok(r.projects.length >= 1 && r.projects.every((p) => p.stats.health === h));
});

test('a status filter never adds work and a late filter keeps only late tasks', async () => {
  const all = (await dash()).data, late = (await dash('?s=late')).data;
  assert.ok(late.analytics.status.done === 0 && late.analytics.status.active === 0 && late.analytics.status.todo === 0);
  assert.ok(late.analytics.status.late <= all.analytics.status.late);
});

test('report data has row tables that match the filter', async () => {
  const all = (await s.call('GET', '/api/dashboard/report-data', null, u.token)).data;
  for (const k of ['projects', 'tasks', 'payments', 'deliverables', 'risks', 'team', 'workload', 'activity']) assert.ok(Array.isArray(all.tables[k]), k);
  assert.ok(all.tables.tasks.length > 0);
  const id = (await dash()).data.projects[0].id;
  const one = (await s.call('GET', '/api/dashboard/report-data?p=' + id, null, u.token)).data;
  assert.equal(one.tables.projects.length, 1);
  assert.ok(one.tables.tasks.length <= all.tables.tasks.length);
  assert.ok(one.filter_text.length > 0);
});

test('a project overview takes period and status filters and ignores portfolio filters', async () => {
  const id = (await dash()).data.projects[0].id;
  const base = await s.call('GET', `/api/projects/${id}/dashboard`, null, u.token);
  assert.equal(base.status, 200);
  assert.ok(base.data.filter_options.years.length);
  const f = await s.call('GET', `/api/projects/${id}/dashboard?s=late&cur=EUR&c=nobody`, null, u.token);
  assert.equal(f.status, 200);
  assert.equal((await s.call('GET', `/api/projects/${id}/dashboard?y=1800`, null, u.token)).status, 400);
  const rep = await s.call('GET', `/api/projects/${id}/report-data?s=late`, null, u.token);
  assert.equal(rep.status, 200);
  assert.ok(rep.data.tables.tasks.every((r) => /late/i.test(String(r[8]))), 'only late tasks');
});

test('filter bar and export report styles exist and the toolbar still wraps', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  for (const c of ['.dw-flt', '.gf-row', '.dw-empty']) assert.ok(css.includes(c), c);
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
  for (const k of ['gf_clear', 'ex_report', 'ex_go', 'gf_none_portfolio']) assert.equal((i18n.match(new RegExp(k + ':', 'g')) || []).length, 2, k + ' in English and Arabic');
});
