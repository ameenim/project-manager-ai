// Reads a spreadsheet into text inside a worker thread.
// Keep worker isolation, memory limits and a timeout as defense in depth when
// parsing untrusted files, even with the patched SheetJS release.
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// A date shown as text, such as 26-Apr-26 or 26 Apr 2026, becomes 2026-04-26. Anything else is left as it is.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function displayDate(s) {
  const m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{2}|\d{4})$/.exec(String(s).trim());
  if (!m || !MONTHS[m[2].toLowerCase()] || +m[1] < 1 || +m[1] > 31) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${p2(MONTHS[m[2].toLowerCase()])}-${p2(+m[1])}`;
}

// Date cells are written as ISO dates (2026-04-26) so the text never depends on the cell format (26-Apr-26),
// and every cell stays on one line so a row is always one line of text.
function toText(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellNF: true });
  const parts = [];
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const c = ws[addr];
      if (!c || c.t !== 'n' || typeof c.v !== 'number' || !c.z || !XLSX.SSF || !XLSX.SSF.is_date || !XLSX.SSF.parse_date_code || !XLSX.SSF.is_date(c.z)) continue;
      const d = XLSX.SSF.parse_date_code(c.v);
      if (!d || !d.y) continue;
      const p2 = (n) => String(n).padStart(2, '0');
      c.w = `${d.y}-${p2(d.m)}-${p2(d.d)}`;
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    parts.push(`Sheet: ${sheet}`);
    const one = (c) => displayDate(c) || String(c).replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s*\|\s*/g, ' / ').trim();
    for (const r of rows) if (r.some((c) => String(c).trim() !== '')) parts.push('| ' + r.map(one).join(' | ') + ' |');
    parts.push('');
  }
  return { text: parts.join('\n'), sheets: wb.SheetNames.length };
}

if (!isMainThread && workerData && workerData.__xlsxText) {
  try { parentPort.postMessage({ ok: true, value: toText(Buffer.from(workerData.buf)) }); }
  catch (e) { parentPort.postMessage({ ok: false, message: String(e && e.message || e).slice(0, 200) }); }
}

const MAX_BYTES = 25 * 1024 * 1024;
function readSpreadsheet(buf, { timeoutMs = 20000 } = {}) {
  if (buf.length > MAX_BYTES) return Promise.reject(Object.assign(new Error('This spreadsheet is larger than 25 MB. Save a smaller copy and try again.'), { status: 413, expose: true }));
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { __xlsxText: true, buf }, resourceLimits: { maxOldGenerationSizeMb: 768 } });
    let done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(t); w.terminate().catch(() => {}); fn(v); };
    const t = setTimeout(() => end(reject, Object.assign(new Error('This spreadsheet took too long to read. Save a simpler copy and try again.'), { status: 422, expose: true })), timeoutMs);
    w.once('message', (m) => (m.ok ? end(resolve, m.value) : end(reject, Object.assign(new Error('This spreadsheet could not be read. Save it again as .xlsx and try again.'), { status: 422, expose: true }))));
    w.once('error', () => end(reject, Object.assign(new Error('This spreadsheet could not be read. Save it again as .xlsx and try again.'), { status: 422, expose: true })));
    w.once('exit', () => end(reject, Object.assign(new Error('This spreadsheet could not be read.'), { status: 422, expose: true })));
  });
}

module.exports = { readSpreadsheet };
