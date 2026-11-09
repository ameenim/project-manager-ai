'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const X = require('../server/team_extract');
let s; before(async () => { s = await start(); }); after(() => s.close());

test('owner cells are split into people and organizations', () => {
  assert.deepEqual(X.splitOwners('Amin Shafaqouj (Tarjama), Saeed Alrashdi (DGE); Dr. Kamal (A, B) / Nour'), ['Amin Shafaqouj (Tarjama)', 'Saeed Alrashdi (DGE)', 'Dr. Kamal (A, B)', 'Nour']);
  assert.deepEqual(X.splitOwners('أمين، سعيد'), ['أمين', 'سعيد']);
  assert.deepEqual(X.splitOwners('  '), []);
  assert.deepEqual(X.parsePerson('Amin Shafaqouj (Tarjama)'), { name: 'Amin Shafaqouj', organization: 'Tarjama' });
  assert.deepEqual(X.parsePerson('Mona Younes'), { name: 'Mona Younes', organization: '' });
});

test('the same person written two ways is one row, and people already in the team are marked', () => {
  const tasks = [
    { assignee: 'Amin Shafaqouj (Tarjama), Ashraf Rady (Tarjama)' },
    { assignee: 'amin shafaqouj, ADGEs, Dr. Kamal Mohamed (DGE)' },
    { assignee: 'Amin Shafaqouj (Tarjama), Amin Shafaqouj' },
    { assignee: null }, { assignee: '' },
  ];
  const rows = X.fromSchedule(tasks, [{ name: 'Kamal Mohamed' }]);
  const by = (n) => rows.find((r) => r.name.toLowerCase().includes(n));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].name.toLowerCase(), 'amin shafaqouj'); assert.equal(rows[0].organization, 'Tarjama'); assert.equal(rows[0].tasks, 3, 'a person is counted once per task');
  assert.equal(by('kamal').in_team, true, 'a leading title does not make a different person');
  assert.equal(by('adges').group, true, 'a single word with no organization looks like a group');
  assert.equal(by('ashraf').group, false);
});

test('the endpoints list the people, add the chosen ones once and keep the organization', async () => {
  const u = await s.user(), p = await s.project(u.token, 'Team');
  const mk = (assignee, name) => s.call('POST', `/api/projects/${p.id}/tasks`, { name, start: '2027-01-11', duration: 2, assignee }, u.token);
  assert.equal((await mk('Amin Shafaqouj (Tarjama), Saeed Alrashdi (DGE)', 'One')).status, 200);
  assert.equal((await mk('Saeed Alrashdi (DGE)', 'Two')).status, 200);
  const list = await s.call('GET', `/api/projects/${p.id}/team/from-schedule`, null, u.token);
  assert.equal(list.status, 200); assert.equal(list.data.people.length, 2); assert.equal(list.data.people[0].name, 'Saeed Alrashdi'); assert.equal(list.data.people[0].tasks, 2);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/team/from-schedule`, { people: [] }, u.token)).status, 400);
  const add = await s.call('POST', `/api/projects/${p.id}/team/from-schedule`, { people: list.data.people.map((x) => ({ name: x.name, organization: x.organization })) }, u.token);
  assert.equal(add.status, 200); assert.equal(add.data.added.length, 2);
  const again = await s.call('POST', `/api/projects/${p.id}/team/from-schedule`, { people: [{ name: 'saeed alrashdi' }] }, u.token);
  assert.equal(again.data.added.length, 0); assert.equal(again.data.skipped, 1);
  const team = (await s.call('GET', `/api/projects/${p.id}/resources`, null, u.token)).data.resources;
  assert.deepEqual(team.map((r) => [r.name, r.organization]).sort(), [['Amin Shafaqouj', 'Tarjama'], ['Saeed Alrashdi', 'DGE']]);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/team/from-schedule`, null, u.token)).data.people.every((x) => x.in_team), true);
  for (const r of add.data.added) assert.equal((await s.call('DELETE', `/api/projects/${p.id}/resources/${r.id}`, null, u.token)).status, 200);
});

test('a viewer can read the suggestions but cannot add people, and strangers get nothing', async () => {
  const mgr = await s.user(), vw = await s.user(), other = await s.user();
  const p = await s.project(mgr.token, 'Roles');
  assert.equal((await s.call('POST', `/api/projects/${p.id}/members`, { email: vw.email, role: 'viewer' }, mgr.token)).status, 200);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/team/from-schedule`, null, vw.token)).status, 200);
  assert.equal((await s.call('POST', `/api/projects/${p.id}/team/from-schedule`, { people: [{ name: 'X Y' }] }, vw.token)).status, 403);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/team/from-schedule`, null, other.token)).status, 404);
});

test('a team member can be edited, and bad input is refused', async () => {
  const u = await s.user(), p = await s.project(u.token, 'Edit team');
  const add = await s.call('POST', `/api/projects/${p.id}/resources`, { name: 'Mona Younes', organization: 'Tarjama' }, u.token);
  assert.equal(add.status, 200);
  const id = add.data.resource.id;
  const put = await s.call('PUT', `/api/projects/${p.id}/resources/${id}`, { role: 'Project manager', email: 'mona@example.com', organization: 'DGE' }, u.token);
  assert.equal(put.status, 200); assert.equal(put.data.resource.role, 'Project manager'); assert.equal(put.data.resource.organization, 'DGE'); assert.equal(put.data.resource.name, 'Mona Younes', 'fields not sent are kept');
  const clear = await s.call('PUT', `/api/projects/${p.id}/resources/${id}`, { email: '' }, u.token);
  assert.equal(clear.data.resource.email, null);
  assert.equal((await s.call('PUT', `/api/projects/${p.id}/resources/${id}`, { name: '  ' }, u.token)).status, 400);
  assert.equal((await s.call('PUT', `/api/projects/${p.id}/resources/999999`, { role: 'x' }, u.token)).status, 404);
  const list = await s.call('GET', `/api/projects/${p.id}/resources`, null, u.token);
  assert.equal(list.data.resources.length, 1);
});
