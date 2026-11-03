// Small server with no framework. Serves ./public on PORT (default 5000) and exposes two
// private helper routes used by the browser app:
//   POST /srv/extract?name=file.pdf   raw file bytes in, plain text out (PDF, Word, Excel, text)
//   POST /srv/ai                      JSON in, Claude reply out. The API key never leaves the server.
//   GET  /srv/ai/status               tells the browser whether the key is configured
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');
const PORT = process.env.PORT || 5000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
const MAX_UPLOAD = 40 * 1024 * 1024;
const MAX_AI_BODY = 600 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('File is too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Only the app itself may call the helper routes, and each visitor gets a small hourly allowance.
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
const hits = new Map();
function limited(req, max) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

// ---------- text extraction ----------
async function extractText(buf, name) {
  const ext = path.extname(name || '').toLowerCase();
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const r = await parser.getText();
      const pages = r.total || (r.pages ? r.pages.length : 0) || 0;
      const text = (r.text || '').replace(/^\s*-- \d+ of \d+ --\s*$/gm, '');
      return { text, pages, kind: 'pdf' };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value || '', kind: 'docx' };
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const parts = [];
    for (const sheet of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
      parts.push(`Sheet: ${sheet}`);
      for (const r of rows) if (r.some((c) => String(c).trim() !== '')) parts.push('| ' + r.map((c) => String(c).trim()).join(' | ') + ' |');
      parts.push('');
    }
    return { text: parts.join('\n'), sheets: wb.SheetNames.length, kind: 'xlsx' };
  }
  if (['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.eml', ''].includes(ext)) return { text: buf.toString('utf8'), kind: 'text' };
  throw Object.assign(new Error(`The ${ext} format is not supported. Use PDF, Word, Excel or text files.`), { status: 415 });
}

async function handleExtract(req, res, url) {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Not allowed' });
  if (limited(req, 300)) return send(res, 429, { error: 'Too many uploads, try again later' });
  const name = url.searchParams.get('name') || '';
  let buf;
  try { buf = await readBody(req, MAX_UPLOAD); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  if (!buf.length) return send(res, 400, { error: 'The file is empty' });
  try {
    const out = await extractText(buf, name);
    const text = (out.text || '').replace(/\u0000/g, '').trim();
    if (!text) {
      const why = out.kind === 'pdf'
        ? 'No text found. This PDF looks like a scan or image, so it cannot be read. Upload a text based PDF or a Word file.'
        : 'No text found in this file.';
      return send(res, 422, { error: why });
    }
    // A PDF with very little text per page is almost certainly a scan with a few stray characters.
    if (out.kind === 'pdf' && out.pages && text.length / out.pages < 40) {
      return send(res, 422, { error: `Only ${text.length} characters found across ${out.pages} pages. This PDF looks like a scan, so it cannot be read.` });
    }
    return send(res, 200, { text, chars: text.length, pages: out.pages || null, kind: out.kind });
  } catch (e) {
    const missing = e && e.code === 'MODULE_NOT_FOUND';
    console.error('extract failed:', name, e.message);
    return send(res, missing ? 500 : e.status || 422, { error: missing ? 'File reading is not installed on the server. Run npm install.' : `Could not read ${name || 'the file'}: ${e.message}` });
  }
}

// ---------- Claude proxy ----------
async function callClaude(payload) {
  const key = process.env.ANTHROPIC_API_KEY;
  const body = JSON.stringify({ model: MODEL, max_tokens: payload.max_tokens, system: payload.system, messages: [{ role: 'user', content: payload.user }] });
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body,
    });
    if (r.ok) {
      const j = await r.json();
      const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { text, stop_reason: j.stop_reason || null, usage: j.usage || null };
    }
    const t = await r.text();
    last = { status: r.status, message: t.slice(0, 300) };
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw Object.assign(new Error(`Claude API ${last.status}: ${last.message}`), { status: last.status });
}

async function handleAi(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: 'ANTHROPIC_API_KEY is not set on the server', code: 'no_key' });
  if (limited(req, 400)) return send(res, 429, { error: 'Request limit reached, try again later', code: 'rate' });
  let payload;
  try { payload = JSON.parse((await readBody(req, MAX_AI_BODY)).toString('utf8')); } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? 'Request is too large' : 'Invalid request' }); }
  if (typeof payload.system !== 'string' || typeof payload.user !== 'string') return send(res, 400, { error: 'Invalid request' });
  payload.max_tokens = Math.min(Math.max(parseInt(payload.max_tokens, 10) || 4000, 200), 16000);
  try {
    return send(res, 200, await callClaude(payload));
  } catch (e) {
    console.error('claude failed:', e.message);
    const code = e.status === 401 ? 'bad_key' : e.status === 429 ? 'rate' : e.status === 400 && /credit|billing|balance/i.test(e.message) ? 'budget' : 'upstream';
    return send(res, 502, { error: code === 'bad_key' ? 'The Anthropic API key was rejected' : code === 'budget' ? 'The Anthropic account has no credit left' : 'Claude could not be reached', code, status: e.status || null });
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/srv/extract') return handleExtract(req, res, url);
  if (req.method === 'POST' && url.pathname === '/srv/ai') return handleAi(req, res);
  if (req.method === 'GET' && url.pathname === '/srv/ai/status') return send(res, 200, { configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
  if (url.pathname.startsWith('/srv/')) return send(res, 404, { error: 'Not found' });

  const urlPath = decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log('Project Manager AI running on port ' + PORT));

module.exports = { extractText };
