// What an uploaded document is allowed to be. A file is accepted only when its extension is on the list and its first
// bytes match that extension, so a program renamed to .pdf is refused. Text files must be text.
'use strict';
const path = require('path');

const ZIP = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
const OLE = (b) => b.length > 7 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const TEXT = (b) => {
  const head = b.subarray(0, 8192);
  if (head.length > 1 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) return true; // UTF-16 with a byte order mark
  return !head.includes(0);
};
const RULES = {
  '.pdf': { type: 'application/pdf', ok: (b) => b.subarray(0, 1024).toString('latin1').includes('%PDF-'), label: 'a PDF' },
  '.docx': { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ok: ZIP, label: 'a Word (.docx) file' },
  '.pptx': { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ok: ZIP, label: 'a PowerPoint (.pptx) file' },
  '.xlsx': { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ok: ZIP, label: 'an Excel (.xlsx) file' },
  '.xls': { type: 'application/vnd.ms-excel', ok: (b) => OLE(b) || ZIP(b), label: 'an Excel file' },
  '.doc': { type: 'application/msword', ok: OLE, label: 'a Word file' },
  '.ppt': { type: 'application/vnd.ms-powerpoint', ok: OLE, label: 'a PowerPoint file' },
  '.mpp': { type: 'application/vnd.ms-project', ok: OLE, label: 'a Microsoft Project file' },
  '.png': { type: 'image/png', ok: (b) => b.length > 7 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), label: 'a PNG picture' },
  '.jpg': { type: 'image/jpeg', ok: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, label: 'a JPEG picture' },
  '.jpeg': { type: 'image/jpeg', ok: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, label: 'a JPEG picture' },
  '.gif': { type: 'image/gif', ok: (b) => /^GIF8[79]a/.test(b.toString('latin1', 0, 6)), label: 'a GIF picture' },
  '.webp': { type: 'image/webp', ok: (b) => b.length > 11 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP', label: 'a WebP picture' },
};
for (const e of ['.txt', '.md', '.csv', '.tsv', '.json', '.eml', '.html', '.htm', '.xml']) RULES[e] = { type: 'text/plain; charset=utf-8', ok: TEXT, label: 'a text file' };

const extOf = (name) => path.extname(String(name || '')).toLowerCase();
const ALLOWED = Object.keys(RULES);
const LIST = 'PDF, Word, PowerPoint, Excel, pictures, Project XML or text files';

// Returns null when the file is fine, or a sentence that says why it is refused.
function check(name, buf) {
  const ext = extOf(name);
  const rule = RULES[ext];
  if (!rule) return `${String(name || 'This file').slice(0, 80)} is not an allowed file type. Use ${LIST}.`;
  if (!buf || !buf.length) return `${String(name).slice(0, 80)} is empty.`;
  if (!rule.ok(buf)) return `${String(name).slice(0, 80)} is not really ${rule.label}. Check the file and try again.`;
  return null;
}
// The type used when a stored file is sent back. It comes from the extension, never from what the sender claimed.
const safeType = (name) => (RULES[extOf(name)] ? RULES[extOf(name)].type : 'application/octet-stream');

module.exports = { check, safeType, ALLOWED, extOf };
