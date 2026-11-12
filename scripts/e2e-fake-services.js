'use strict';
// Starts fake Gemini (batch and live) and Anthropic servers, then the app on PORT, so browser tests can run the whole
// meeting cycle (record, live transcript, minutes) without real keys.  Usage: PORT=5055 node scripts/e2e-fake-services.js
const http = require('node:http');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 0 });
wss.on('connection', (ws) => {
  let chunks = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.setup) { ws.send(JSON.stringify({ setupComplete: {} })); return; }
    const ri = m.realtimeInput || {};
    if (ri.audio) {
      chunks++;
      if (chunks % 6 === 2) ws.send(JSON.stringify({ serverContent: { interimInputTranscription: { text: 'good morn' } } }));
      if (chunks % 6 === 3) ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Good morning everyone.' } } }));
    }
    if (ri.audioStreamEnd) ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'That is all.' } } }));
  });
});
const gem = http.createServer((req, res) => {
  req.on('data', () => {}); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ segments: [{ start: '00:02', speaker: 'Speaker 1', text: 'Good morning everyone.' }, { start: '00:09', speaker: 'Speaker 2', text: 'Hello.' }] }) }] }, finishReason: 'STOP' }], usageMetadata: {} }));
  });
});
const ant = http.createServer((req, res) => {
  req.on('data', () => {}); req.on('end', () => {
    const out = { title: 'Weekly status update', summary: 'A short meeting.', topics: [], decisions: [], actions: [], risks: [], updates: [], questions: [] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5 } } }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(out) } }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + '\n\n');
    res.end();
  });
});
wss.on('listening', () => gem.listen(0, () => ant.listen(0, () => {
  const env = { ...process.env, DEMO_ACCOUNT: '1', PORT: process.env.PORT || '5055', GEMINI_LIVE_URL: 'ws://localhost:' + wss.address().port, GEMINI_API_KEY: 'fake', GEMINI_BASE_URL: 'http://localhost:' + gem.address().port, ANTHROPIC_BASE_URL: 'http://localhost:' + ant.address().port, ANTHROPIC_API_KEY: 'fake' };
  const child = spawn(process.execPath, ['server.js'], { env, stdio: 'inherit' });
  const bye = () => { child.kill(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye); child.on('exit', () => process.exit(0));
})));
