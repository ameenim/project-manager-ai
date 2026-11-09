// Reads a spreadsheet into text inside a worker thread.
// The spreadsheet library has known flaws on crafted files (prototype pollution and slow pattern matching) and no fixed
// release on npm. In a worker, a polluted object or a runaway match stays in that thread's own memory and the thread is
// stopped after a time limit, so the server itself is never affected.
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

function toText(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const parts = [];
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
    parts.push(`Sheet: ${sheet}`);
    for (const r of rows) if (r.some((c) => String(c).trim() !== '')) parts.push('| ' + r.map((c) => String(c).trim()).join(' | ') + ' |');
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
