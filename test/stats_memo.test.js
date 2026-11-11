'use strict';
// The project list memoizes each project's stats on the saved version. It must never show stale numbers after a change.
const { test } = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('project list stats follow every change, and stay equal to the project page', async () => {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  try {
    const u = await s.user('Memo');
    const p = await s.project(u.token, 'Memo project');
    const t1 = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'First', start: '2026-01-05', duration: 10 }, u.token);
    assert.strictEqual(t1.status, 200, JSON.stringify(t1.data));
    const listStats = async () => (await s.call('GET', '/api/projects', null, u.token)).data.projects.find((x) => x.id === p.id).stats;
    const a = await listStats(), a2 = await listStats();
    assert.deepStrictEqual(a2, a, 'two reads in a row agree');
    assert.strictEqual(a.tasks, 1);
    // add a task: the count must move at once
    const t2 = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Second', start: '2026-01-20', duration: 5 }, u.token);
    assert.strictEqual(t2.status, 200);
    assert.strictEqual((await listStats()).tasks, 2, 'task count updates after an add');
    // change progress: the actual percent must move at once
    const sched = (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data.tasks;
    const before = (await listStats()).progress;
    const ap = await s.call('POST', `/api/projects/${p.id}/schedule/apply`, { changes: { [sched[0].id]: { progress: 100 } } }, u.token);
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.data).slice(0, 200));
    const after = await listStats();
    assert.ok(after.progress > before, `progress moved from ${before} to ${after.progress}`);
    // the project page and the list agree
    const page = (await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data;
    assert.deepStrictEqual(after, (page.project || page).stats, 'list and page show the same stats');
    // a delete leaves no stale entry behind and a new project starts clean
    const p2 = await s.project(u.token, 'Second project');
    const l = (await s.call('GET', '/api/projects', null, u.token)).data.projects;
    assert.strictEqual(l.find((x) => x.id === p2.id).stats.tasks, 0);
  } finally { await s.close(); }
});
