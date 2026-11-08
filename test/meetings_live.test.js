'use strict';
// Live transcription against a fake Gemini Live server (WebSocket) plus the fake batch and Anthropic servers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');

let s, wss, gem, ant, u, other, p;
const conns = [];
let batchFail = true;
const pcm = (n = 3200) => Buffer.alloc(n, 1).toString('base64');

before(async () => {
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws, req) => {
    const c = { ws, key: new URL(req.url, 'http://x').searchParams.get('key'), setup: null, chunks: 0, ended: false };
    conns.push(c);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.setup) { c.setup = m.setup; ws.send(JSON.stringify({ setupComplete: {} })); return; }
      const ri = m.realtimeInput || {};
      if (ri.audio) {
        c.chunks++;
        assert.equal(ri.audio.mimeType, 'audio/pcm;rate=16000');
        if (c.chunks === 2) ws.send(JSON.stringify({ serverContent: { interimInputTranscription: { text: 'good morn' } } }));
        if (c.chunks === 3) ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Good morning everyone.' } } }));
        if (c.chunks === 5) ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'مرحبا بالجميع' } } }));
      }
      if (ri.audioStreamEnd) { c.ended = true; ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'That is all.' } } })); }
    });
  });
  await new Promise((ok) => wss.on('listening', ok));
  gem = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      if (batchFail) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'boom' } })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ segments: [{ start: '00:02', speaker: 'Speaker 1', text: 'Good morning everyone.' }, { start: '00:09', speaker: 'Speaker 2', text: 'Hello.' }] }) }] }, finishReason: 'STOP' }], usageMetadata: {} }));
    });
  });
  ant = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const out = { title: 'Live meeting', summary: 'A short meeting.', topics: [], decisions: [], actions: [], risks: [], updates: [], questions: [] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5 } } }) + '\n\n');
      res.write('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(out) } }) + '\n\n');
      res.write('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + '\n\n');
      res.end();
    });
  });
  await new Promise((ok) => gem.listen(0, ok)); await new Promise((ok) => ant.listen(0, ok));
  Object.assign(process.env, {
    GEMINI_LIVE_URL: 'ws://localhost:' + wss.address().port, GEMINI_API_KEY: 'live-key', GEMINI_BASE_URL: 'http://localhost:' + gem.address().port,
    ANTHROPIC_BASE_URL: 'http://localhost:' + ant.address().port, ANTHROPIC_API_KEY: 'k', LIVE_ROTATE_MS: '600',
  });
  s = await require('./helpers').start();
  u = await s.user('Maya'); other = await s.user('Other');
  p = await s.project(u.token, 'Live project');
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
});
after(async () => { await s.close(); wss.close(); gem.close(); ant.close(); });

const mk = async (title, language = 'auto') => (await s.call('POST', `/api/projects/${p.id}/meetings`, { title, source: 'recording', language, attendees: ['Sara'] }, u.token)).data.meeting.id;
const send = (id, n = 1, tok = u.token) => s.call('POST', `/api/meetings/${id}/live/audio`, { pcm: pcm() }, tok);
const poll = (id, after = 0) => s.call('GET', `/api/meetings/${id}/live?after=${after}`, null, u.token);

test('audio goes to Gemini Live, interim and final text come back, and the transcript is saved', async () => {
  const id = await mk('Live sync', 'ar');
  const st = await s.call('POST', `/api/meetings/${id}/live`, null, u.token);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const c = await s.until(() => conns[conns.length - 1]);
  await s.until(() => c.setup);
  assert.equal(c.key, 'live-key', 'the key stays on the server side connection');
  assert.equal(c.setup.model, 'models/gemini-3.5-transcribe-live');
  assert.deepEqual(c.setup.inputAudioTranscription.languageCodes, ['ar-EG']);
  assert.ok(c.setup.inputAudioTranscription.customVocabulary.includes('Sara'));
  await s.until(async () => (await poll(id)).data.live.state === 'live');
  for (let i = 0; i < 3; i++) assert.equal((await send(id)).status, 200);
  const r = await s.until(async () => { const x = (await poll(id)).data.live; return x.count >= 1 ? x : null; });
  assert.equal(r.lines[0].text, 'Good morning everyone.');
  assert.equal((await send(id)).status, 200); assert.equal((await send(id)).status, 200);
  const r2 = await s.until(async () => { const x = (await poll(id, 1)).data.live; return x.lines.length ? x : null; });
  assert.equal(r2.lines[0].text, 'مرحبا بالجميع', 'polling after a line returns only newer lines');
  const stop = await s.call('POST', `/api/meetings/${id}/live/stop`, null, u.token);
  assert.equal(stop.data.live.lines, 3, 'the last words that arrive after the stream ends are kept');
  assert.ok(c.ended);
  const m = (await s.call('GET', `/api/meetings/${id}`, null, u.token)).data.meeting;
  assert.equal(m.transcript.length, 3);
  assert.equal(m.speakers.S1.live, true);
  assert.equal((await send(id)).status, 409, 'audio after stop is refused');
});

test('only project members can use a live session', async () => {
  const id = await mk('Private live');
  assert.equal((await s.call('POST', `/api/meetings/${id}/live`, null, other.token)).status, 404);
  assert.equal((await send(id, 1, other.token)).status, 404);
  assert.equal((await s.call('GET', `/api/meetings/${id}/live`, null, other.token)).status, 404);
  assert.equal((await s.call('POST', `/api/meetings/${id}/live/audio`, { pcm: '' }, u.token)).status, 400);
});

test('a session is rotated before the ten minute limit and lost connections are restored', async () => {
  const id = await mk('Long live');
  const before = conns.length;
  await s.call('POST', `/api/meetings/${id}/live`, null, u.token);
  await s.until(async () => (await poll(id)).data.live.state === 'live');
  await s.until(() => conns.length >= before + 2, 5000);
  const first = conns[before];
  await s.until(() => first.ended, 4000);
  assert.equal((await poll(id)).data.live.state, 'live', 'audio keeps flowing on the new session');
  const cur = conns[conns.length - 1]; const n = cur.chunks;
  await send(id); await s.until(() => cur.chunks > n);
  cur.ws.terminate();
  await s.until(async () => ['reconnecting', 'live'].includes((await poll(id)).data.live.state));
  await s.until(async () => { await send(id); return (await poll(id)).data.live.state === 'live' && conns[conns.length - 1] !== cur; }, 8000);
  await s.call('POST', `/api/meetings/${id}/live/stop`, null, u.token);
});

test('when the full transcription fails the live transcript is used and the minutes are still written', async () => {
  const id = await mk('Fallback live');
  await s.call('POST', `/api/meetings/${id}/live`, null, u.token);
  await s.until(async () => (await poll(id)).data.live.state === 'live');
  for (let i = 0; i < 3; i++) await send(id);
  await s.until(async () => (await poll(id)).data.live.count >= 1);
  await s.call('POST', `/api/meetings/${id}/live/stop`, null, u.token);
  const wav = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'binary'), Buffer.alloc(32)]);
  const fd = new FormData(); fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'a.wav'); fd.append('duration_sec', '30');
  assert.equal((await s.call('POST', `/api/meetings/${id}/audio`, fd, u.token)).status, 200);
  const d = await s.until(async () => { const x = (await s.call('GET', `/api/meetings/${id}`, null, u.token)).data; return x.meeting.status === 'ready' ? x : null; });
  assert.ok(d.meeting.minutes && d.meeting.transcript.length >= 1);
  assert.equal(d.has_audio, true, 'the recording is kept so Retry can transcribe it again');
  batchFail = false;
  assert.equal((await s.call('POST', `/api/meetings/${id}/retry`, null, u.token)).status, 200);
  const d2 = await s.until(async () => { const x = (await s.call('GET', `/api/meetings/${id}`, null, u.token)).data; return x.meeting.status === 'ready' && x.meeting.speakers.S2 ? x : null; });
  assert.equal(d2.meeting.speakers.S1.live, undefined, 'the full pass replaces the live lines with labeled speakers');
  assert.equal(d2.has_audio, false);
});

test('live transcription reports whether it is available', async () => {
  const r = await s.call('GET', `/api/projects/${p.id}/meetings`, null, u.token);
  assert.equal(r.data.stt.live, true);
});
