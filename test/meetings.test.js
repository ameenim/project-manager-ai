'use strict';
// Meeting capture end to end against fake Gemini and fake Anthropic servers. The env is set before the app loads.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let s, gem, ant, u, other, p;
const gemCalls = [], antCalls = [];
let gemMode = 'ok';
const SEGS = [
  { start: '00:03', speaker: 'Speaker 1', text: 'Good morning everyone, let us start with the integration status.' },
  { start: '00:20', speaker: 'Speaker 2', text: 'The Build API task is about sixty percent done and we expect two days of delay.' },
  { start: '01:05', speaker: 'Speaker 1', text: 'Agreed, we will go with the phased rollout. Sara please send the revised plan by Friday.' },
  { start: '01:40', speaker: 'Speaker 3', text: 'مرحبا، سأرسل الخطة المعدلة يوم الجمعة' },
];
let taskId = null;

function minutesFor(user) {
  const m = /^(\d+) \| Build API/m.exec(user);
  const tid = m ? Number(m[1]) : null;
  return {
    title: 'Integration status',
    summary: 'The team reviewed the integration. Build API is late. The phased rollout was agreed.',
    topics: [{ heading: 'Integration', points: ['Build API is at sixty percent.'] }],
    decisions: [{ text: 'Go with the phased rollout.', owner: null, time: '1:05' }],
    actions: [
      { title: 'Send the revised plan', owner: 'Sara', due_date: '2027-03-12', time: '1:05', quote: 'send the revised plan by Friday', task_id: null },
      { title: 'Ghost task link', owner: null, due_date: 'not a date', time: '1:10', quote: '', task_id: 999999 },
    ],
    risks: [{ title: 'Integration may slip', probability: 'High', impact: 'Medium', mitigation: 'Add a second developer', time: '0:20' }],
    updates: [{ task_id: tid, progress: 60, delay_days: 2, note: 'About sixty percent with two days of delay', time: '0:20' }, { task_id: 424242, progress: 10, note: 'unknown task', time: '0:30' }],
    questions: [{ text: 'Who signs off the rollout?', owner: null }],
  };
}

before(async () => {
  gem = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (!/generateContent/.test(req.url)) { res.writeHead(404); return res.end('{}'); }
      const j = JSON.parse(b); gemCalls.push({ url: req.url, key: req.headers['x-goog-api-key'], body: j });
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (gemMode === 'forbidden') return send(403, { error: { message: 'API key not allowed' } });
      const parts = j.contents[0].parts;
      const at = /ended at (\d+):(\d+)/.exec(parts[parts.length - 1].text);
      const resumed = !!at;
      const sec = (x) => Number(x.start.split(':')[0]) * 60 + Number(x.start.split(':')[1]);
      // the fake repeats the last turn it was told about, as a model sometimes does
      const use = gemMode === 'truncate' ? (resumed ? SEGS.filter((x) => sec(x) >= Number(at[1]) * 60 + Number(at[2])) : SEGS.slice(0, 2)) : SEGS;
      const finish = gemMode === 'truncate' && !resumed ? 'MAX_TOKENS' : 'STOP';
      const text = JSON.stringify({ segments: use });
      send(200, { candidates: [{ content: { parts: [{ text: finish === 'MAX_TOKENS' ? text.slice(0, text.length - 30) : text }] }, finishReason: finish }], usageMetadata: { promptTokenCount: 1920, candidatesTokenCount: 300 } });
    });
  });
  ant = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const j = JSON.parse(b); antCalls.push(j);
      const user = typeof j.messages[0].content === 'string' ? j.messages[0].content : '';
      const section = /Rewrite only the "(\w+)" section/.exec(user);
      let out = minutesFor(user);
      if (section) out = { [section[1]]: section[1] === 'summary' ? 'A rewritten summary.' : out[section[1]] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 500 } } }) + '\n\n');
      res.write('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '```json\n' + JSON.stringify(out) + '\n```' } }) + '\n\n');
      res.write('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 200 } }) + '\n\n');
      res.end();
    });
  });
  await new Promise((ok) => gem.listen(0, ok)); await new Promise((ok) => ant.listen(0, ok));
  process.env.GEMINI_BASE_URL = 'http://localhost:' + gem.address().port;
  process.env.GEMINI_API_KEY = 'gem-test-key';
  process.env.ANTHROPIC_BASE_URL = 'http://localhost:' + ant.address().port;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  s = await require('./helpers').start();
  u = await s.user('Maya'); other = await s.user('Other');
  p = await s.project(u.token, 'Meeting project');
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
  const t = await s.call('POST', `/api/projects/${p.id}/tasks`, { name: 'Build API', duration: 5, assignee: 'Sara' }, u.token);
  taskId = t.data.created;
});
after(async () => { await s.close(); gem.close(); ant.close(); });

const wav = () => Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'binary'), Buffer.alloc(32)]);
async function upload(id, type = 'audio/wav', name = 'meeting.wav', dur = '125') {
  const fd = new FormData(); fd.append('file', new Blob([wav()], { type }), name); fd.append('duration_sec', dur);
  return s.call('POST', `/api/meetings/${id}/audio`, fd, u.token);
}
const ready = (id, want = 'ready') => s.until(async () => { const r = await s.call('GET', `/api/meetings/${id}`, null, u.token); return r.data.meeting.status === want ? r.data : (r.data.meeting.status === 'failed' && want !== 'failed' ? (() => { throw new Error('failed: ' + r.data.meeting.error); })() : null); }, 20000);

test('a recording becomes a speaker labelled transcript and minutes, and the audio is deleted', async () => {
  const c = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Weekly sync', source: 'recording', language: 'auto', attendees: ['Sara', { name: 'Omar', role: 'Developer' }] }, u.token);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const id = c.data.meeting.id;
  assert.equal(c.data.meeting.status, 'draft');
  assert.equal((await upload(id, 'application/pdf', 'x.pdf')).status, 400, 'a non audio file is refused');
  const up = await upload(id, 'audio/webm;codecs=opus', 'rec.webm');
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const d = await ready(id);
  const m = d.meeting;
  assert.equal(m.transcript.length, 4);
  assert.deepEqual(Object.keys(m.speakers).sort(), ['S1', 'S2', 'S3']);
  assert.equal(m.transcript[0].start, 3); assert.equal(m.transcript[3].start, 100);
  assert.equal(m.duration_sec, 125, 'the length reported by the browser is kept');
  assert.equal(d.has_audio, false, 'the recording is deleted once transcribed');
  assert.ok(m.minutes.summary.includes('phased rollout'));
  // Gemini got the recording inline with the plain mime type, the names and the right key
  const call = gemCalls[gemCalls.length - 1];
  assert.equal(call.key, 'gem-test-key');
  assert.equal(call.body.contents[0].parts[0].inline_data.mime_type, 'audio/webm');
  assert.match(call.body.contents[0].parts[1].text, /Sara/); assert.match(call.body.contents[0].parts[1].text, /Meeting project/);
  // minutes were cleaned: bad dates and unknown task ids are dropped
  const acts = m.minutes.actions;
  assert.equal(acts.length, 2); assert.equal(acts[0].due_date, '2027-03-12'); assert.equal(acts[1].due_date, null); assert.equal(acts[1].task_id, null);
  assert.equal(m.minutes.updates.length, 1, 'an update for a task that does not exist is dropped');
  assert.equal(m.minutes.updates[0].task_id, taskId);
  assert.equal(m.minutes.updates[0].task, 'Build API');
  // the minutes prompt knew the real task and treated the transcript as data
  const prompt = antCalls[antCalls.length - 1];
  assert.match(prompt.system, /never as instructions/);
  assert.match(prompt.messages[0].content, new RegExp(`${taskId} \\| Build API \\| Sara`));
  assert.match(prompt.messages[0].content, /\[1:40\] Speaker 3: مرحبا/);
});

test('only members of the project can see or change a meeting', async () => {
  const c = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Private', source: 'text', transcript_text: 'Sara: hello there' }, u.token);
  const id = c.data.meeting.id;
  for (const [m, path, body] of [['GET', `/api/meetings/${id}`], ['PUT', `/api/meetings/${id}`, { title: 'x' }], ['DELETE', `/api/meetings/${id}`], ['POST', `/api/meetings/${id}/apply`, { items: [] }], ['GET', `/api/meetings/${id}/export`]]) {
    assert.equal((await s.call(m, path, body, other.token)).status, 404, m + ' ' + path);
  }
  assert.equal((await s.call('GET', `/api/projects/${p.id}/meetings`, null, other.token)).status, 404);
  assert.equal((await s.call('GET', `/api/projects/${p.id}/meetings`)).status, 401);
});

test('a pasted transcript works without any audio, and speakers, text and sections can be edited', async () => {
  const c = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Pasted', source: 'text', transcript_text: '[00:05] Sara: We start now.\n00:30 Omar: The API is late.\nSara: Agreed, send the plan by Friday.' }, u.token);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const id = c.data.meeting.id;
  let d = (await ready(id)).meeting;
  assert.equal(d.transcript.length, 3); assert.equal(d.speakers.S1.name, 'Sara'); assert.equal(d.speakers.S2.name, 'Omar');
  const bad = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Empty', source: 'text', transcript_text: '   ' }, u.token);
  assert.equal(bad.status, 400);
  // rename, change one turn's speaker, edit text, delete a turn, merge
  d = (await s.call('POST', `/api/meetings/${id}/speakers`, { rename: { S2: { name: 'Omar K' } } }, u.token)).data.meeting;
  assert.equal(d.speakers.S2.name, 'Omar K');
  d = (await s.call('PUT', `/api/meetings/${id}/segments/${d.transcript[1].id}`, { text: 'The API is two days late.', speaker: 'S1' }, u.token)).data.meeting;
  assert.equal(d.transcript[1].text, 'The API is two days late.'); assert.equal(d.transcript[1].speaker, 'S1');
  assert.equal((await s.call('PUT', `/api/meetings/${id}/segments/${d.transcript[1].id}`, { speaker: 'S9' }, u.token)).status, 400);
  assert.equal((await s.call('PUT', `/api/meetings/${id}/segments/${d.transcript[1].id}`, { text: '  ' }, u.token)).status, 400);
  d = (await s.call('DELETE', `/api/meetings/${id}/segments/${d.transcript[2].id}`, null, u.token)).data.meeting;
  assert.equal(d.transcript.length, 2);
  d = (await s.call('POST', `/api/meetings/${id}/speakers`, { merge: { from: 'S2', into: 'S1' } }, u.token)).data.meeting;
  assert.deepEqual(Object.keys(d.speakers), ['S1']);
  assert.equal((await s.call('POST', `/api/meetings/${id}/speakers`, { merge: { from: 'S1', into: 'S1' } }, u.token)).status, 400);
  // section regeneration changes only that section and sends the guidance along
  const before = d.minutes.decisions;
  const r = await s.call('POST', `/api/meetings/${id}/regenerate`, { section: 'summary', instructions: 'Keep it to one line' }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.meeting.minutes.summary, 'A rewritten summary.');
  assert.deepEqual(r.data.meeting.minutes.decisions, before);
  assert.match(antCalls[antCalls.length - 1].messages[0].content, /Keep it to one line/);
  assert.equal((await s.call('POST', `/api/meetings/${id}/regenerate`, { section: 'summary' }, other.token)).status, 404);
  // the whole minutes can be edited by hand, and a new item never takes the id of another
  const edited = JSON.parse(JSON.stringify(r.data.meeting.minutes));
  edited.summary = 'Edited by hand.'; edited.actions.push({ title: 'Added by hand', owner: 'Omar', due_date: '2027-04-01' });
  const put = await s.call('PUT', `/api/meetings/${id}/minutes`, { minutes: edited }, u.token);
  assert.equal(put.status, 200);
  const ids = put.data.meeting.minutes.actions.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length); assert.equal(put.data.meeting.minutes.summary, 'Edited by hand.');
});

test('actions, decisions, risks and updates are sent to the project, linked, undoable and shown as a meeting source', async () => {
  const c = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'To apply', source: 'text', transcript_text: 'Sara: The Build API is sixty percent done.\nOmar: I will send the plan by Friday.' }, u.token);
  const id = c.data.meeting.id;
  let mt = (await ready(id)).meeting;
  const act = mt.minutes.actions[0], dec = mt.minutes.decisions[0], risk = mt.minutes.risks[0], upd = mt.minutes.updates[0];
  const res = await s.call('POST', `/api/meetings/${id}/apply`, { items: [{ id: act.id, to: ['log', 'task'], owner: 'Sara', title: 'Send the revised plan to the client' }, { id: dec.id }, { id: risk.id }, { id: upd.id }, { id: 'zz9' }] }, u.token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(res.data.results.some((x) => x.id === 'zz9' && x.error), 'an unknown item is reported, not fatal');
  mt = res.data.meeting;
  // log items carry the meeting
  const items = (await s.call('GET', `/api/projects/${p.id}/items`, null, u.token)).data.items;
  const a = items.find((i) => i.kind === 'action'), d = items.find((i) => i.kind === 'decision'), r = items.find((i) => i.kind === 'risk' && i.meeting_id === id);
  assert.ok(a && d && r);
  assert.equal(a.meeting_id, id); assert.equal(a.title, 'Send the revised plan to the client'); assert.equal(a.data.owner, 'Sara'); assert.equal(a.data.due_date, '2027-03-12'); assert.equal(a.state, 'open');
  assert.equal(d.state, 'active'); assert.equal(r.data.probability, 'High');
  // the task sits under a Meeting actions group, is flagged as from a meeting, and is linked to the log entry
  const sched = (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data;
  const task = sched.tasks.find((t) => t.meeting_id === id);
  assert.ok(task, 'task created'); assert.equal(task.source, 'meeting'); assert.equal(task.assignee, 'Sara');
  const group = sched.tasks.find((t) => t.name === 'Meeting actions');
  assert.equal(task.parent_id, group.id);
  assert.ok(task.links.includes(a.id), 'the task is linked to the log entry');
  assert.equal(a.data.task_id, task.id);
  // the update moved the existing task
  const build = sched.tasks.find((t) => t.id === taskId);
  assert.equal(build.progress, 60);
  // the Updates inbox shows meeting rows, applied, with the project facts as the summary
  const inbox = (await s.call('GET', `/api/projects/${p.id}/inbox`, null, u.token)).data.inbox.filter((x) => x.source === 'meeting' && x.subject === 'To apply');
  assert.equal(inbox.length, 5); assert.ok(inbox.every((x) => x.status === 'applied'));
  assert.ok(mt.applied[act.id].log && mt.applied[act.id].task && mt.applied[upd.id].update);
  // sending the same action again does nothing
  const again = await s.call('POST', `/api/meetings/${id}/apply`, { items: [{ id: act.id }] }, u.token);
  assert.ok(again.data.results.every((x) => x.skipped));
  assert.equal((await s.call('GET', `/api/projects/${p.id}/items`, null, u.token)).data.items.filter((i) => i.kind === 'action').length, 1);
  // undo in the inbox removes the task and clears the mark on the meeting
  const taskRow = inbox.find((x) => x.action && x.action.type === 'create_task');
  assert.equal((await s.call('POST', `/api/inbox/${taskRow.id}/undo`, {}, u.token)).status, 200);
  const sched2 = (await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data;
  assert.ok(!sched2.tasks.some((t) => t.meeting_id === id), 'task removed');
  assert.ok(!sched2.tasks.some((t) => t.name === 'Meeting actions'), 'the empty group is removed too');
  const after = (await s.call('GET', `/api/meetings/${id}`, null, u.token)).data.meeting;
  assert.ok(after.applied[act.id].log && !after.applied[act.id].task);
  // send for review instead: the row waits in the inbox and nothing changes in the project
  const q = await s.call('POST', `/api/meetings/${id}/apply`, { items: [{ id: act.id, to: ['task'], mode: 'inbox' }] }, u.token);
  assert.equal(q.status, 200);
  const pend = (await s.call('GET', `/api/projects/${p.id}/inbox`, null, u.token)).data.inbox.find((x) => x.status === 'pending' && x.source === 'meeting');
  assert.ok(pend); assert.ok(!(await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data.tasks.some((t) => t.meeting_id === id));
  assert.equal((await s.call('POST', `/api/inbox/${pend.id}/apply`, {}, u.token)).status, 200);
  assert.ok((await s.call('GET', `/api/projects/${p.id}/schedule`, null, u.token)).data.tasks.some((t) => t.meeting_id === id), 'applying from the inbox creates the task');
  const m2 = (await s.call('GET', `/api/meetings/${id}`, null, u.token)).data.meeting;
  assert.equal(m2.applied[act.id].task.pending, false, 'the meeting learns the row was applied');
  // the log API accepts the new types
  assert.equal((await s.call('POST', `/api/projects/${p.id}/items`, { kind: 'decision', title: 'Manual decision' }, u.token)).data.item.state, 'active');
  assert.equal((await s.call('POST', `/api/projects/${p.id}/items`, { kind: 'bogus', title: 'x' }, u.token)).status, 400);
});

test('a long recording that is cut off is continued, and bad keys give a plain message with a working retry', async () => {
  gemMode = 'truncate';
  const c = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Long one', source: 'recording' }, u.token);
  const id = c.data.meeting.id;
  await upload(id);
  let d = (await ready(id)).meeting;
  assert.equal(d.transcript.length, 4, 'the turns after the cut were fetched with a second request');
  assert.deepEqual(d.transcript.map((t) => t.start), [3, 20, 65, 100]);
  gemMode = 'forbidden';
  const c2 = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Bad key', source: 'recording' }, u.token);
  await upload(c2.data.meeting.id);
  const f = (await ready(c2.data.meeting.id, 'failed')).meeting;
  assert.match(f.error, /Gemini API key is not allowed/);
  assert.equal((await s.call('POST', `/api/meetings/${c2.data.meeting.id}/regenerate`, {}, u.token)).status, 400, 'no transcript yet');
  gemMode = 'ok';
  assert.equal((await s.call('POST', `/api/meetings/${c2.data.meeting.id}/retry`, {}, u.token)).status, 200);
  d = (await ready(c2.data.meeting.id)).meeting;
  assert.equal(d.transcript.length, 4);
});

test('exports, deletion and the list view', async () => {
  const list = (await s.call('GET', `/api/projects/${p.id}/meetings`, null, u.token)).data;
  assert.ok(list.meetings.length >= 5); assert.equal(list.stt.configured, true);
  const ready1 = list.meetings.find((x) => x.title === 'Weekly sync');
  assert.equal(ready1.status, 'ready'); assert.equal(ready1.segments, 4); assert.ok(ready1.actions >= 1); assert.ok(ready1.summary.length > 10);
  assert.ok(!('transcript' in ready1), 'the list does not carry transcripts');
  const docx = await s.call('GET', `/api/meetings/${ready1.id}/export?format=docx&transcript=1`, null, u.token);
  assert.equal(docx.status, 200); assert.equal(docx.buf.subarray(0, 2).toString(), 'PK');
  const md = await s.call('GET', `/api/meetings/${ready1.id}/export?format=md`, null, u.token);
  assert.match(md.buf.toString('utf8'), /^# Integration status/); assert.match(md.buf.toString('utf8'), /## Actions/);
  const rep = await s.call('GET', `/api/meetings/${ready1.id}/report?transcript=1`, null, u.token);
  assert.equal(rep.status, 200); const doc = rep.data.document;
  assert.equal(doc.type_title, 'Minutes of meeting'); assert.equal(doc.format, 'docx'); assert.equal(doc.meta.project, p.name);
  assert.match(doc.content, /^# Summary/m); assert.match(doc.content, /^# Actions/m); assert.match(doc.content, /^# Transcript/m);
  assert.ok(!/^## Summary/m.test(doc.content), 'main headings are single # so each starts a new page');
  const draft = (await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Draft only' }, u.token)).data.meeting;
  assert.equal((await s.call('GET', `/api/meetings/${draft.id}/report`, null, u.token)).status, 400, 'nothing to export yet');
  assert.equal((await s.call('GET', `/api/meetings/${draft.id}/export`, null, u.token)).status, 400, 'nothing to export yet');
  assert.equal((await s.call('DELETE', `/api/meetings/${draft.id}`, null, u.token)).status, 200);
  assert.equal((await s.call('GET', `/api/meetings/${draft.id}`, null, u.token)).status, 404);
});

test('a pasted Outlook style attendee list becomes separate attendees with emails', async () => {
  const { parseAttendees } = require('../server/meetings');
  const list = 'Zaid AlRadaideh <zaid.alradaideh@tarjama.com>; Bids <bids@tarjama.com>; Amin Shafaqouj <amin.shafaqouj@tarjama.com>; Iyad Ahmad <iyad.ahmad@tarjama.com>; Legal Team <Legal.team@tarjama.com>; Abdulrahman Al-Osaili <abdulrahman.alosaili@tarjama.com>';
  const parsed = parseAttendees(list);
  assert.equal(parsed.length, 6);
  assert.deepEqual(parsed[4], { name: 'Legal Team', email: 'legal.team@tarjama.com' });
  const c = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Pasted list', source: 'recording', attendees: [list] }, u.token);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.meeting.attendees.length, 6);
  assert.equal(c.data.meeting.attendees[0].email, 'zaid.alradaideh@tarjama.com');
  assert.equal(c.data.meeting.attendees[5].name, 'Abdulrahman Al-Osaili');
  assert.deepEqual(parseAttendees('Doe, John <j@x.com>; sara@x.com; Omar').map((a) => a.name), ['Doe, John', 'Sara', 'Omar'], 'a comma inside a name is kept when semicolons separate people');
  assert.equal(parseAttendees('Sara, Omar, Lina').length, 3, 'commas separate plain names');
  const dup = await s.call('POST', `/api/projects/${p.id}/meetings`, { title: 'Dups', source: 'recording', attendees: ['A <a@x.com>; B <b@x.com>; Another <a@x.com>'] }, u.token);
  assert.equal(dup.data.meeting.attendees.length, 2, 'the same email is added once');
});

test('a transcript or minutes document becomes a meeting with minutes', async () => {
  const up = (name, text, extra = {}, tok = u.token, type = 'text/plain') => {
    const fd = new FormData(); fd.append('file', new Blob([text], { type }), name);
    for (const [k, v] of Object.entries({ attendees: JSON.stringify(['Sara']), ...extra })) fd.append(k, v);
    return s.call('POST', `/api/projects/${p.id}/meetings/document`, fd, tok);
  };
  const vtt = 'WEBVTT\n\n00:00:03.000 --> 00:00:07.000\n<v Sara>Good morning everyone.</v>\n\n00:00:08.000 --> 00:00:12.000\n<v Omar>Build API is sixty percent done.</v>\n\n00:00:14.000 --> 00:00:18.000\n<v Omar>We expect two days of delay.</v>\n\n00:01:30.000 --> 00:01:34.000\n<v Sara>Please send the plan by Friday.</v>\n';
  const a = await up('weekly.vtt', vtt, { title: 'From captions' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const d = await ready(a.data.meeting.id);
  assert.equal(d.meeting.source, 'document');
  assert.deepEqual(Object.values(d.meeting.speakers).map((x) => x.name), ['Sara', 'Omar']);
  assert.equal(d.meeting.transcript.length, 3, 'a speaker who keeps talking is merged into one line');
  assert.equal(d.meeting.transcript[1].start, 8);
  assert.ok(d.meeting.minutes && d.meeting.minutes.actions.length >= 1);

  const teams = 'Sara   0:03\nGood morning everyone.\n\nOmar   0:20\nBuild API is sixty percent done.\n\nSara   1:05\nSend the plan by Friday.\n';
  const b = await up('teams.txt', teams);
  const db = await ready(b.data.meeting.id);
  assert.equal(db.meeting.title, 'teams', 'the file name becomes the title when none is given');
  assert.deepEqual(Object.values(db.meeting.speakers).map((x) => x.name), ['Sara', 'Omar']);

  const mom = 'Minutes of the weekly meeting\n\nAttendees: Sara, Omar\n\nThe team agreed to use the phased rollout.\n\nAction: Sara to send the revised plan by Friday.\n';
  const antBefore = antCalls.length;
  const c = await up('minutes.txt', mom, { kind: 'minutes' });
  const dc = await ready(c.data.meeting.id);
  assert.equal(Object.values(dc.meeting.speakers)[0].document, true);
  assert.match(String(antCalls[antCalls.length - 1].system || JSON.stringify(antCalls[antCalls.length - 1])), /written meeting document/);
  assert.ok(antCalls.length > antBefore);

  assert.equal((await up('minutes.txt', mom, { kind: 'transcript' })).status, 400, 'no speaker lines means it is not a transcript');
  assert.equal((await up('empty.txt', '   ')).status, 400);
  assert.equal((await up('x.xyz', 'hello')).status, 415, 'unsupported formats are refused');
  assert.equal((await up('weekly.vtt', vtt, {}, other.token)).status, 404, 'only project members can add a meeting');
});
