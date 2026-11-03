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
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const TRANSCRIBE_SYSTEM = 'You transcribe project documents. Write all text you can see in reading order, exactly as written, without commentary. Keep tables as one line per row with cells separated by " | ". Keep headings on their own line. For a Gantt chart or timeline picture, list every task label and every date you can actually read. If bars have no readable dates write "[chart bars have no readable dates]". Never guess or add dates. Write [illegible] for text you cannot read.';

const xmlText = (x) => String(x || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Reads text out of a scan or picture with Claude vision. Needs the API key.
async function transcribe(blocks) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('Reading pictures and scanned files needs the Anthropic API key, which is not set on the server.'), { status: 503 });
  const r = await callClaude({ system: TRANSCRIBE_SYSTEM, content: [...blocks, { type: 'text', text: 'Transcribe this.' }], max_tokens: 16000 });
  return r.text.trim();
}

// Scanned PDFs are split into small page groups so each reply stays complete.
async function ocrPdf(buf) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = src.getPageCount();
  const CHUNK = 5, MAX_CHUNKS = 14;
  const ranges = [];
  for (let i = 0; i < total && ranges.length < MAX_CHUNKS; i += CHUNK) ranges.push([i, Math.min(i + CHUNK, total)]);
  const out = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const idx = next++;
      const [a, z] = ranges[idx];
      const part = await PDFDocument.create();
      (await part.copyPages(src, Array.from({ length: z - a }, (_, k) => a + k))).forEach((pg) => part.addPage(pg));
      const data = Buffer.from(await part.save()).toString('base64');
      out[idx] = await transcribe([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, ranges.length) }, worker));
  const read = Math.min(total, ranges.length * CHUNK);
  return { text: out.map((t, i) => `[Pages ${ranges[i][0] + 1} to ${ranges[i][1]}]\n${t}`).join('\n\n'), pages: total, pages_read: read };
}

function htmlToText(html) {
  return xmlText(String(html)
    .replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, (m, inner) => inner.replace(/<\/p>\s*<p[^>]*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim() + ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, '\n# ')
    .replace(/<\/(p|h[1-6]|li|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\|[ \t]*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n'));
}

async function extractPptx(buf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const num = (n) => Number((n.match(/(\d+)\.xml$/) || [])[1] || 0);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const parts = [];
  for (const n of slides) {
    const xml = await zip.file(n).async('string');
    const rows = [...xml.matchAll(/<a:tr[ >][\s\S]*?<\/a:tr>/g)].map((m) => m[0]);
    const tableText = rows.map((r) => [...r.matchAll(/<a:tc[ >][\s\S]*?<\/a:tc>/g)].map((c) => [...c[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(' ').trim()).join(' | '));
    const body = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, '');
    const paras = [...body.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)].map((p) => [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('')).map((t) => xmlText(t).trim()).filter(Boolean);
    const notesName = n.replace('slides/slide', 'notesSlides/notesSlide');
    let notes = '';
    if (zip.file(notesName)) notes = [...(await zip.file(notesName).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => xmlText(t[1])).join(' ').trim();
    parts.push(`Slide ${num(n)}\n${paras.join('\n')}${tableText.length ? '\n' + tableText.map(xmlText).join('\n') : ''}${notes ? '\nNotes: ' + notes : ''}`);
  }
  return { text: parts.join('\n\n'), slides: slides.length, kind: 'pptx' };
}

async function extractText(buf, name) {
  const ext = path.extname(name || '').toLowerCase();
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    let pages = 0, text = '';
    try {
      const r = await parser.getText();
      pages = r.total || (r.pages ? r.pages.length : 0) || 0;
      text = (r.text || '').replace(/^\s*-- \d+ of \d+ --\s*$/gm, '');
    } finally {
      await parser.destroy().catch(() => {});
    }
    // A PDF with almost no text per page is a scan. It is read with vision instead of being rejected.
    if (text.trim().length / Math.max(pages, 1) < 40) {
      const o = await ocrPdf(buf);
      return { text: o.text, pages: o.pages, pages_read: o.pages_read, kind: 'pdf', ocr: true };
    }
    return { text, pages, kind: 'pdf' };
  }
  if (IMAGE_TYPES[ext]) {
    const t = await transcribe([{ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: buf.toString('base64') } }]);
    return { text: t, kind: 'image', ocr: true };
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.convertToHtml({ buffer: buf });
    return { text: htmlToText(r.value || ''), kind: 'docx' };
  }
  if (ext === '.pptx') return extractPptx(buf);
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
  if (ext === '.mpp') throw Object.assign(new Error('Microsoft Project .mpp files cannot be read directly. In Project choose File, Save As, then XML Format, and upload the .xml file.'), { status: 415 });
  if (ext === '.doc' || ext === '.ppt') throw Object.assign(new Error(`Old ${ext} files cannot be read. Save the file as ${ext}x and upload it again.`), { status: 415 });
  if (['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.eml', '.xml', ''].includes(ext)) return { text: buf.toString('utf8'), kind: 'text' };
  throw Object.assign(new Error(`The ${ext} format is not supported. Use PDF, Word, PowerPoint, Excel, pictures, Project XML or text files.`), { status: 415 });
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
    if (!text) return send(res, 422, { error: out.ocr ? 'The AI could not find any readable text in this file.' : 'No text found in this file.' });
    return send(res, 200, { text, chars: text.length, pages: out.pages || out.slides || null, pages_read: out.pages_read || null, kind: out.kind, ocr: !!out.ocr });
  } catch (e) {
    const missing = e && e.code === 'MODULE_NOT_FOUND';
    console.error('extract failed:', name, e.message);
    return send(res, missing ? 500 : e.status || 422, { error: missing ? 'File reading is not installed on the server. Run npm install.' : `Could not read ${name || 'the file'}: ${e.message}` });
  }
}

// ---------- Claude proxy ----------
async function callClaude(payload) {
  const key = process.env.ANTHROPIC_API_KEY;
  const body = JSON.stringify({ model: MODEL, max_tokens: payload.max_tokens, system: payload.system, messages: [{ role: 'user', content: payload.content || payload.user }] });
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
