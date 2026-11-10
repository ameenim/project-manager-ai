const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const win = {}; vm.createContext(win); win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'engine.js'), 'utf8'), win, { filename: 'engine.js' });
const AI = win.__AI;

const tasks = [{ id: 1, name: 'Test Strategy | Review Test Strategy with DCT', progress: 0 }, { id: 2, name: 'Test Plan | Approval Test Plan by DCT', progress: 0 }, { id: 3, name: 'Issue the plan', progress: 50 }];
const msg = (status, extra = '') => `DCTPA-7 Test Strategy Document\nStatus: ${status}${extra}`;
const up = (o) => ({ updates: [o], resource: null });

test('a Jira issue in approval suggests 90 percent, not 100', () => {
  const r = AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 100, confidence: 0.5, note: 'x' }), msg('Approval'), tasks);
  assert.equal(r.updates.length, 1);
  assert.equal(r.updates[0].progress, 90);
  assert.match(r.updates[0].note, /Jira status is Approval/);
});

test('a low guess in approval is raised to 90 percent', () => {
  const r = AI.applyJiraStatus(up({ type: 'update_task', task_id: 2, progress: 10, confidence: 0.55 }), msg('Approval'), tasks);
  assert.equal(r.updates[0].progress, 90);
});

test('a done status keeps 100 percent and closes deliverables', () => {
  for (const s of ['Completed', 'Done', 'Closed']) {
    const r = AI.applyJiraStatus({ updates: [{ type: 'update_task', task_id: 1, progress: 100 }, { type: 'close_deliverable', deliverable_id: 9 }] }, msg(s), tasks);
    assert.equal(r.updates.length, 2); assert.equal(r.updates[0].progress, 100);
  }
  const cat = AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 100 }), msg('Shipped', ' (category: Done)'), tasks);
  assert.equal(cat.updates[0].progress, 100);
});

test('an unfinished status never closes a deliverable', () => {
  const r = AI.applyJiraStatus({ updates: [{ type: 'close_deliverable', deliverable_id: 9 }] }, msg('In Review'), tasks);
  assert.equal(r.updates.length, 0);
});

test('active and waiting statuses are capped or give no progress', () => {
  assert.equal(AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 100 }), msg('In Progress', ' (category: In Progress)'), tasks).updates[0].progress, 90);
  assert.equal(AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 60 }), msg('In Progress'), tasks).updates[0].progress, 60);
  assert.equal(AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 100 }), msg('To Do'), tasks).updates.length, 0);
});

test('nothing changes when the task is already at or above 90 percent, but delays are kept', () => {
  const t2 = [{ id: 1, name: 'x', progress: 95 }];
  assert.equal(AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 100 }), msg('Approval'), t2).updates.length, 0);
  const r = AI.applyJiraStatus(up({ type: 'update_task', task_id: 1, progress: 100, delay_days: 3 }), msg('Approval'), t2);
  assert.equal(r.updates[0].progress, null); assert.equal(r.updates[0].delay_days, 3);
});

test('messages without a Jira status are untouched', () => {
  const o = { updates: [{ type: 'update_task', task_id: 3, progress: 100 }] };
  assert.deepEqual(AI.applyJiraStatus(o, 'Team: finished the plan', tasks), o);
  assert.equal(AI.jiraStage('Status: unknown'), null);
});

test('the rule based reader respects the Jira status end to end', async () => {
  const r = await AI.interpretMessage({ text: 'DCTPA-8 Test Plan | Approval Test Plan by DCT\nStatus: Approval', sender: 'Nouran', tasks, resources: [], deliverables: [] });
  for (const u of r.updates) assert.ok(u.progress == null || u.progress <= 90);
});
