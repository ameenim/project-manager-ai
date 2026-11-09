// Guards for Office files, which are zip archives. A tiny upload can expand to many gigabytes when it is read (a zip bomb),
// so the sizes the archive claims are checked before anything is unpacked.
'use strict';
const JSZip = require('jszip');

const MAX_ENTRIES = 5000;
const MAX_ENTRY = 120 * 1024 * 1024;
const MAX_TOTAL = 300 * 1024 * 1024;
const refuse = (msg) => Object.assign(new Error(msg), { status: 422, expose: true });

// Opens the archive and refuses it when it claims too much. Returns the opened archive, or null when the bytes are not a
// zip at all so the caller can give its own message.
async function openSafeZip(buf, limits = {}) {
  const maxEntries = limits.maxEntries || MAX_ENTRIES, maxEntry = limits.maxEntry || MAX_ENTRY, maxTotal = limits.maxTotal || MAX_TOTAL;
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { return null; }
  const names = Object.keys(zip.files);
  if (names.length > maxEntries) throw refuse('This file has too many parts to read safely.');
  let total = 0;
  for (const n of names) {
    const size = Number(zip.files[n] && zip.files[n]._data && zip.files[n]._data.uncompressedSize) || 0;
    if (size > maxEntry) throw refuse('This file contains a part that is too large to read safely.');
    total += size;
    if (total > maxTotal) throw refuse('This file expands to more than it is safe to read.');
  }
  return zip;
}

module.exports = { openSafeZip, MAX_ENTRIES, MAX_ENTRY, MAX_TOTAL };
