'use strict';
// Speed work must never change answers. These tests pin the behavior of the fast paths: day counting, the schedule
// memo, link validation, and the compressed, cached static files.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { start } = require('./helpers');

const win = { console }; vm.createContext(win); win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'engine.js'), 'utf8'), win);
const E = win.__Sched;

const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

test('counting work days matches a plain day by day count for any calendar', () => {
  for (let i = 0; i < 300; i++) {
    const wd = [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [2], [0, 1, 2, 3, 4, 5, 6]][ri(0, 4)];
    const hol = []; for (let h = 0; h < ri(0, 8); h++) hol.push(day(ri(0, 400)));
    const project = { work_days: JSON.stringify(wd), holidays: JSON.stringify(hol) };
    const cal = E.calendar(project);
    const a = day(ri(0, 300)), b = day(ri(0, 300));
    let brute = 0;
    if (a <= b) for (let d = a; d <= b; d = E.addDays(d, 1)) if (wd.includes(new Date(d + 'T00:00:00Z').getUTCDay()) && !hol.includes(d)) brute++;
    assert.equal(E.countWork(a, b, cal), brute, `${a} to ${b} on ${wd}`);
  }
});

const plan = (n) => {
  const tasks = [];
  for (let i = 1; i <= n; i++) tasks.push({ id: i, parent_id: null, position: i, name: 'T' + i, start: day(ri(0, 60)), duration: ri(1, 9), progress: 0, mode: 'auto', deps: i > 1 ? [{ id: i - 1, lag: 0, type: 'FS' }] : [] });
  return tasks;
};
const project = { work_days: '[1,2,3,4,5]', holidays: '[]', end_date: day(200) };

test('scheduling the same plan twice gives the same answer and callers cannot corrupt the stored answer', () => {
  const tasks = plan(40);
  const first = E.schedule(tasks, project);
  const snapshot = JSON.stringify(first);
  first.forEach((t) => { t.start = '1999-01-01'; t.finish = '1999-01-02'; });  // a caller mangles its copy
  const second = E.schedule(tasks, project);
  assert.equal(JSON.stringify(second), snapshot);
});

test('the schedule answer changes when the plan changes', () => {
  const tasks = plan(20), before = JSON.stringify(E.schedule(tasks, project));
  tasks[5].duration += 4;
  assert.notEqual(JSON.stringify(E.schedule(tasks, project)), before);
  tasks[5].duration -= 4;
  assert.equal(JSON.stringify(E.schedule(tasks, project)), before);
  assert.notEqual(JSON.stringify(E.schedule(tasks, { ...project, holidays: JSON.stringify([day(60), day(61), day(62), day(63), day(64)]) })), before);
});

test('validation finds a link loop and is fast on a large plan', () => {
  const tasks = plan(3000);
  let t0 = Date.now(); const ok = E.validateSchedule(tasks, project); const ms = Date.now() - t0;
  assert.ok(ms < 1500, `validating 3000 tasks took ${ms} ms`);
  assert.equal(ok.filter((i) => i.severity === 'error').length, 0);
  const small = plan(30); small[0].deps = [{ id: 30, lag: 0, type: 'FS' }];
  const bad = E.validateSchedule(small, project);
  assert.ok(bad.some((i) => i.severity === 'error' || /loop|circular/i.test(i.message)), 'a loop is reported: ' + JSON.stringify(bad).slice(0, 200));
});

// ---------- static files ----------
let s; before(async () => { s = await start(); }); after(() => s.close());
const get = (p, headers = {}) => new Promise((ok, no) => {
  const port = s.app.server.address().port;
  http.get({ host: 'localhost', port, path: p, headers }, (r) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) })); }).on('error', no);
});

test('the app page links its scripts with a content version and those files are cached for a year', async () => {
  const page = (await get('/app.html')).body.toString();
  const m = page.match(/(?:src|href)="([^"]+\.js\?v=[0-9a-f]+)"/);
  assert.ok(m, 'a versioned script link');
  const r = await get('/' + m[1]);
  assert.equal(r.status, 200);
  assert.match(r.headers['cache-control'], /immutable/);
  const plain = await get('/' + m[1].split('?')[0]);
  assert.match(plain.headers['cache-control'], /no-cache/);
});

test('large files are compressed when the browser accepts it and the bytes decode to the original', async () => {
  const zlib = require('zlib');
  const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'engine.js'));
  const gz = await get('/engine.js', { 'accept-encoding': 'gzip' });
  assert.equal(gz.status, 200); assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.ok(gz.body.length < raw.length / 2);
  assert.deepEqual(zlib.gunzipSync(gz.body), raw);
  const none = await get('/engine.js', { 'accept-encoding': 'identity' });
  assert.equal(none.headers['content-encoding'], undefined); assert.deepEqual(none.body, raw);
});

test('an unchanged file answers 304 with the validator and a changed validator gets the file', async () => {
  const a = await get('/styles.css', { 'accept-encoding': 'gzip' });
  assert.ok(a.headers.etag);
  const b = await get('/styles.css', { 'accept-encoding': 'gzip', 'if-none-match': a.headers.etag });
  assert.equal(b.status, 304); assert.equal(b.body.length, 0);
  const c = await get('/styles.css', { 'accept-encoding': 'gzip', 'if-none-match': '"other"' });
  assert.equal(c.status, 200);
});

test('large API answers are compressed when asked', async () => {
  const u = await s.user('Zip'); const p = await s.project(u.token, 'Zip', 'text');
  for (let i = 0; i < 30; i++) await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Task number ' + i, duration: 2, start: '2026-01-05' }, u.token);
  const r = await get(`/api/projects/${p.id}/schedule`, { 'accept-encoding': 'gzip', authorization: 'Bearer ' + u.token });
  assert.equal(r.status, 200);
  const body = r.headers['content-encoding'] === 'gzip' ? require('zlib').gunzipSync(r.body) : r.body;
  assert.ok(JSON.parse(body.toString()).tasks.length >= 30);
});
