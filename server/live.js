'use strict';
// Live transcription while a meeting is being recorded. The browser sends 16 kHz mono PCM to this server and the server
// relays it to the Gemini Live API, so the API key never reaches the browser. The browser polls for new lines.
// The Live API has no speaker labels and each session lasts about ten minutes, so sessions are rotated before the limit
// and the recording is transcribed again after the meeting for correct speakers.
const stt = require('./stt');

const URL_BASE = () => process.env.GEMINI_LIVE_URL || 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = () => process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-transcribe-live';
const ROTATE_MS = () => Number(process.env.LIVE_ROTATE_MS) || 8.5 * 60 * 1000;
const IDLE_MS = () => Number(process.env.LIVE_IDLE_MS) || 90 * 1000;
const MAX_QUEUE = 16000 * 2 * 20; // twenty seconds of audio waiting for a connection
const BCP = { en: ['en-US'], ar: ['ar-EG'] };

function socketClass() {
  if (typeof WebSocket !== 'undefined') return WebSocket;
  try { return require('ws'); } catch { return null; }
}
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
async function textOf(d) {
  if (typeof d === 'string') return d;
  if (d && typeof d.arrayBuffer === 'function') return Buffer.from(await d.arrayBuffer()).toString('utf8');
  if (Array.isArray(d)) return Buffer.concat(d).toString('utf8');
  return Buffer.from(d || []).toString('utf8');
}

class LiveHub {
  constructor(meetings, ops) { this.meetings = meetings; this.ops = ops; this.sessions = new Map(); }
  available() { return stt.configured() && !!socketClass(); }
  has(id) { return this.sessions.has(Number(id)); }

  start(id, { userId, projectId, language, vocabulary }) {
    id = Number(id);
    if (!this.available()) { const e = new Error('Live transcription is not available on this server.'); e.status = 503; e.expose = true; throw e; }
    this.stopNow(id);
    const s = {
      id, userId, projectId, language: language === 'en' || language === 'ar' ? language : 'auto', vocabulary: (vocabulary || []).map((x) => clip(x, 60)).filter(Boolean).slice(0, 80),
      startedAt: Date.now(), lastPush: Date.now(), lines: [], interim: '', state: 'connecting', error: null, queue: [], queued: 0, audioBytes: 0,
      cur: null, next: null, retries: 0, closed: false, persistTimer: null, rotateTimer: null, idleTimer: null, words: 0, model: MODEL(),
    };
    this.sessions.set(id, s);
    this.connect(s, false);
    s.idleTimer = setInterval(() => { if (Date.now() - s.lastPush > IDLE_MS()) this.stop(id).catch(() => {}); }, 15000);
    s.idleTimer.unref && s.idleTimer.unref();
    return this.view(s, 0);
  }

  connect(s, isNext) {
    const WS = socketClass();
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    let ws;
    try { ws = new WS(`${URL_BASE()}?key=${encodeURIComponent(key)}`); } catch (e) { return this.lost(s, null, e.message); }
    const link = { ws, ready: false, dead: false };
    if (isNext) s.next = link; else s.cur = link;
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch { /* closed */ } };
    link.send = send;
    ws.addEventListener('open', () => {
      send({ setup: { model: `models/${s.model}`, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { languageCodes: BCP[s.language] || [], ...(s.vocabulary.length ? { customVocabulary: s.vocabulary } : {}) } } });
    });
    ws.addEventListener('message', async (ev) => {
      let m; try { m = JSON.parse(await textOf(ev.data)); } catch { return; }
      if (m.setupComplete !== undefined) {
        link.ready = true;
        if (isNext) { const old = s.cur; s.cur = link; s.next = null; this.closeLink(old, true); this.armRotate(s); }
        else { s.state = 'live'; s.retries = 0; s.error = null; this.armRotate(s); this.flush(s); }
        return;
      }
      if (link !== s.cur) return;
      const sc = m.serverContent; if (!sc) return;
      if (sc.interimInputTranscription && sc.interimInputTranscription.text != null) s.interim = String(sc.interimInputTranscription.text);
      if (sc.inputTranscription && sc.inputTranscription.text != null) this.final(s, String(sc.inputTranscription.text));
    });
    ws.addEventListener('error', () => { /* the close event follows */ });
    ws.addEventListener('close', (ev) => { link.dead = true; if (s.closed) return; if (isNext) { s.next = null; return; } if (link === s.cur) this.lost(s, ev); });
  }
  closeLink(link, quiet) { if (!link) return; link.dead = true; try { link.send({ realtimeInput: { audioStreamEnd: true } }); } catch { /* closed */ } setTimeout(() => { try { link.ws.close(); } catch { /* closed */ } }, quiet ? 1500 : 0); }
  armRotate(s) { clearTimeout(s.rotateTimer); s.rotateTimer = setTimeout(() => { if (!s.closed && !s.next) this.connect(s, true); }, ROTATE_MS()); }
  lost(s, ev, why) {
    if (s.closed) return;
    s.cur = null; s.interim = '';
    if (s.retries >= 6) { s.state = 'failed'; s.error = (ev && ev.reason) || why || 'The live connection was lost. The recording continues and the transcript is written after the meeting.'; return; }
    s.state = 'reconnecting'; s.retries++;
    setTimeout(() => { if (!s.closed && !s.cur) this.connect(s, false); }, Math.min(8000, 700 * s.retries));
  }
  final(s, text) {
    const x = clip(text, 4000); s.interim = '';
    if (!x) return;
    const last = s.lines[s.lines.length - 1];
    if (last && last.text === x) return;
    s.lines.push({ n: s.lines.length + 1, start: Math.max(0, Math.round((Date.now() - s.startedAt) / 1000) - 1), text: x });
    s.words += x.split(' ').length;
    this.schedulePersist(s);
  }
  schedulePersist(s) { if (s.persistTimer) return; s.persistTimer = setTimeout(() => { s.persistTimer = null; this.persist(s).catch(() => {}); }, 6000); }
  async persist(s) {
    if (!s.lines.length) return;
    // a finished transcript from the recording is never replaced by live lines
    const r = await this.meetings.row(s.id); if (!r || (r.transcript || []).length && !(r.speakers && r.speakers.S1 && r.speakers.S1.live)) return;
    await this.meetings.setLive(s.id, s.lines);
  }

  push(id, pcm) {
    const s = this.sessions.get(Number(id)); if (!s || s.closed) return null;
    s.lastPush = Date.now(); s.audioBytes += pcm.length;
    const ok = s.cur && s.cur.ready;
    if (ok) this.sendAudio(s.cur, pcm);
    else { s.queue.push(pcm); s.queued += pcm.length; while (s.queued > MAX_QUEUE && s.queue.length) s.queued -= s.queue.shift().length; }
    return this.view(s, null);
  }
  sendAudio(link, pcm) { link.send({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }); }
  flush(s) { const q = s.queue; s.queue = []; s.queued = 0; for (const b of q) if (s.cur && s.cur.ready) this.sendAudio(s.cur, b); }

  view(s, after) {
    const o = { state: s.state, error: s.error, interim: s.interim, count: s.lines.length, seconds: Math.round((Date.now() - s.startedAt) / 1000) };
    if (after != null) o.lines = s.lines.filter((l) => l.n > after);
    return o;
  }
  poll(id, after) { const s = this.sessions.get(Number(id)); return s ? this.view(s, Number(after) || 0) : { state: 'idle', lines: [], count: 0, interim: '' }; }

  stopNow(id) { const s = this.sessions.get(Number(id)); if (!s) return; this.teardown(s); }
  teardown(s) {
    s.closed = true; clearTimeout(s.rotateTimer); clearInterval(s.idleTimer); clearTimeout(s.persistTimer);
    this.closeLink(s.cur); this.closeLink(s.next); this.sessions.delete(s.id);
  }
  async stop(id) {
    const s = this.sessions.get(Number(id));
    if (!s) return { lines: 0 };
    try { s.cur && s.cur.send({ realtimeInput: { audioStreamEnd: true } }); } catch { /* closed */ }
    // the last words arrive a moment after the stream ends
    const until = Date.now() + 2500, was = s.lines.length;
    while (Date.now() < until && s.cur && !s.cur.dead) { await new Promise((r) => setTimeout(r, 150)); if (s.lines.length > was && !s.interim) break; }
    await this.persist(s).catch(() => {});
    const out = { lines: s.lines.length };
    this.teardown(s);
    if (this.ops && s.audioBytes) {
      try { await this.ops.recordUsage({ userId: s.userId, projectId: s.projectId, source: 'meeting live transcription', model: s.model, input: Math.round((s.audioBytes / 32000) * 32), output: Math.round(s.words * 1.5) }); } catch { /* usage is best effort */ }
    }
    return out;
  }
  closeAll() { for (const s of [...this.sessions.values()]) this.teardown(s); }
}

module.exports = { LiveHub, BCP };
