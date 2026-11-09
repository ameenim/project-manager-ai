// Reads plain text out of uploaded files: PDF, Word, PowerPoint, Excel, pictures and text.
'use strict';
const { openSafeZip } = require('./safezip');
const { readSpreadsheet } = require('./xlsx_text');
const path = require('path');
const { callClaude } = require('./claude');

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
  const zip = await openSafeZip(buf);
  if (!zip) throw Object.assign(new Error('This PowerPoint file could not be opened. Save it again as .pptx and try again.'), { status: 422, expose: true });
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
    await openSafeZip(buf);
    const mammoth = require('mammoth');
    const r = await mammoth.convertToHtml({ buffer: buf });
    return { text: htmlToText(r.value || ''), kind: 'docx' };
  }
  if (ext === '.pptx') return extractPptx(buf);
  if (ext === '.xlsx' || ext === '.xls') {
    if (buf[0] === 0x50 && buf[1] === 0x4b) await openSafeZip(buf);
    const r = await readSpreadsheet(buf);
    return { text: r.text, sheets: r.sheets, kind: 'xlsx' };
  }
  if (ext === '.mpp') throw Object.assign(new Error('Microsoft Project .mpp files cannot be read directly. In Project choose File, Save As, then XML Format, and upload the .xml file.'), { status: 415 });
  if (ext === '.doc' || ext === '.ppt') throw Object.assign(new Error(`Old ${ext} files cannot be read. Save the file as ${ext}x and upload it again.`), { status: 415 });
  if (['.txt', '.md', '.csv', '.tsv', '.json', '.html', '.htm', '.eml', '.xml', ''].includes(ext)) return { text: buf.toString('utf8'), kind: 'text' };
  throw Object.assign(new Error(`The ${ext} format is not supported. Use PDF, Word, PowerPoint, Excel, pictures, Project XML or text files.`), { status: 415 });
}

module.exports = { extractText };
