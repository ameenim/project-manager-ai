// Reads a project backup (made by the export) and turns it into a project that is safe to store:
// the file is validated, only known fields are kept, every id is replaced with a new one so the copy never
// clashes with an existing project, and references between tasks, items and documents are checked.
'use strict';
const { VERSION } = require('./exporter');

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const SKIP = new Set(['__proto__', 'constructor', 'prototype']);
const LIMITS = { tasks: 20000, items: 50000, resources: 2000, inbox: 20000, documents: 500, folders: 500, generated: 2000, audit: 20000, versions: 200 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Fields that hold the id of another record. owner_id is a person, not a record, so it is left alone.
const isRefKey = (k) => k !== 'owner_id' && (k === 'id' || k.endsWith('_id') || k.endsWith('_ids'));

function prepare(backup, nid, opts = {}) {
  if (!isObj(backup)) throw bad('This file is not a Project Manager AI backup.');
  if (backup.format !== 'pmai-project') throw bad(backup.format === 'pmai-workspace' ? 'This is a workspace backup. Import it from the workspace import.' : 'This file is not a Project Manager AI project backup.');
  const version = Number(backup.version);
  if (!Number.isInteger(version) || version < 1) throw bad('The backup has no valid version.');
  if (version > VERSION) throw bad('This backup was made by a newer version of the app. Update the app and try again.');
  const src = backup.project;
  if (!isObj(src) || !isObj(src.p)) throw bad('The backup has no project data.');

  const warnings = [];
  const P = {
    id: 0,
    p: JSON.parse(JSON.stringify(src.p)),
    items: arr(src.items), tasks: arr(src.tasks), resources: arr(src.resources), inbox: arr(src.inbox),
    documents: arr(src.documents), folders: arr(src.folders), texts: isObj(src.texts) ? src.texts : {}, generated: arr(src.generated), audit: arr(src.audit),
    versions: arr(src.versions), analysis: isObj(src.analysis) ? src.analysis : null,
  };
  for (const [k, max] of Object.entries(LIMITS)) if (P[k].length > max) throw bad(`The backup has too many ${k} (more than ${max}).`);
  for (const k of ['items', 'tasks', 'resources', 'inbox', 'documents', 'folders', 'generated', 'audit', 'versions']) if (!P[k].every(isObj)) throw bad(`The ${k} in this backup are damaged.`);

  // project details
  const p = P.p;
  if (typeof p.name !== 'string' || !p.name.trim()) throw bad('The project in this backup has no name.');
  p.name = p.name.trim().slice(0, 200);
  if (!Array.isArray(p.work_days) || !p.work_days.length || !p.work_days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) { p.work_days = [1, 2, 3, 4, 5]; warnings.push('Working days were reset to Monday to Friday.'); }
  p.holidays = arr(p.holidays).filter((h) => typeof h === 'string' && DATE.test(h));
  for (const k of ['start_date', 'end_date']) if (p[k] != null && !DATE.test(String(p[k]))) { p[k] = null; warnings.push(`The ${k.replace('_', ' ')} was not a valid date and was cleared.`); }
  if (p.value != null && !Number.isFinite(Number(p.value))) p.value = null;
  if (p.client_logo != null && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(String(p.client_logo))) p.client_logo = null;
  for (const k of ['sharepoint_url', 'jira_url']) if (p[k] && !/^https?:\/\/\S+$/i.test(String(p[k]))) p[k] = null;

  // new ids everywhere
  const map = new Map();
  const take = (o) => { if (o && typeof o.id === 'number' && !map.has(o.id)) map.set(o.id, nid()); };
  for (const k of ['items', 'tasks', 'resources', 'inbox', 'documents', 'folders', 'generated', 'audit']) P[k].forEach(take);
  P.versions.forEach((v) => { take(v); arr(v.snapshot).forEach(take); });
  if (isObj(P.analysis)) arr(P.analysis.docs).forEach(take);
  const newId = nid();
  const swap = (v) => (typeof v === 'number' && map.has(v) ? map.get(v) : v);
  const walk = (o, key) => {
    if (Array.isArray(o)) {
      if (key === 'links' || (key && key.endsWith('_ids'))) return o.map((x) => swap(x));
      return o.map((x) => walk(x, null));
    }
    if (isObj(o)) {
      const out = {};
      for (const k of Object.keys(o)) {
        if (SKIP.has(k)) continue;
        const v = o[k];
        out[k] = isRefKey(k) && typeof v === 'number' ? swap(v) : walk(v, k);
      }
      return out;
    }
    return o;
  };
  const rebuilt = {};
  for (const k of ['items', 'tasks', 'resources', 'inbox', 'documents', 'folders', 'generated', 'audit', 'versions']) rebuilt[k] = walk(P[k], null);
  rebuilt.p = walk(P.p, null); rebuilt.analysis = P.analysis ? walk(P.analysis, null) : null;
  rebuilt.texts = {};
  for (const k of Object.keys(P.texts)) { const nk = map.get(Number(k)); if (nk != null && typeof P.texts[k] === 'string') rebuilt.texts[nk] = P.texts[k]; }
  const out = { id: newId, ...rebuilt };
  out.p.id = newId;
  for (const k of ['items', 'resources', 'inbox', 'audit', 'documents', 'generated']) for (const r of out[k]) if (r.project_id !== undefined) r.project_id = newId;

  // references must point at something
  const folderIds = new Set(out.folders.map((f) => f.id));
  for (const g of out.generated) if (g.folder_id != null && !folderIds.has(g.folder_id)) g.folder_id = null;
  const ids = (list) => new Set(list.map((x) => x.id));
  const taskIds = ids(out.tasks), itemIds = ids(out.items), docIds = ids(out.documents);
  let dropped = 0;
  for (const t of out.tasks) {
    if (t.parent_id != null && !taskIds.has(t.parent_id)) { t.parent_id = null; dropped++; }
    t.deps = arr(t.deps).filter((d) => isObj(d) && taskIds.has(d.id) && d.id !== t.id);
    if (t.deliverable_id != null && !itemIds.has(t.deliverable_id)) { t.deliverable_id = null; dropped++; }
    if (t.links != null) t.links = arr(t.links).filter((x) => itemIds.has(x));
  }
  for (const it of out.items) {
    if (it.doc_id != null && !docIds.has(it.doc_id)) { it.doc_id = null; dropped++; }
    if (it.evidence_doc_id != null && !docIds.has(it.evidence_doc_id)) { it.evidence_doc_id = null; dropped++; }
    if (isObj(it.data)) { if (it.data.deliverable_id != null && !itemIds.has(it.data.deliverable_id)) { delete it.data.deliverable_id; dropped++; } if (it.data.task_id != null && !taskIds.has(it.data.task_id)) { delete it.data.task_id; dropped++; } }
  }
  if (dropped) warnings.push(`${dropped} broken link${dropped === 1 ? '' : 's'} between records ${dropped === 1 ? 'was' : 'were'} removed.`);
  // a task chain that points back at itself would break the schedule
  if (opts.S) {
    try {
      const raw = { ...out.p, work_days: JSON.stringify(out.p.work_days), holidays: JSON.stringify(out.p.holidays) };
      const issues = opts.S.validateSchedule(out.tasks, raw).filter((i) => i.severity === 'error');
      if (issues.length) warnings.push(`The schedule has ${issues.length} problem${issues.length === 1 ? '' : 's'} to fix after import.`);
    } catch (e) { warnings.push('The schedule could not be checked.'); }
  }
  // a project that was being analyzed when it was exported is not running any more
  out.p.analyzing = 0;
  if (out.analysis && !out.analysis.finished) out.analysis = null;
  for (const d of out.documents) d.unread = false;

  // original files that came with the backup
  const files = [];
  for (const f of arr(backup.files)) {
    if (!isObj(f) || typeof f.data_base64 !== 'string' || typeof f.filename !== 'string') continue;
    const docId = map.get(f.doc_id);
    if (docId == null) continue;
    const buffer = Buffer.from(f.data_base64, 'base64');
    if (buffer.length > 40 * 1024 * 1024) { warnings.push(`${f.filename} is too large to import and was skipped.`); continue; }
    files.push({ doc_id: docId, filename: f.filename.slice(0, 250), mime: typeof f.mime === 'string' ? f.mime.slice(0, 120) : null, buffer });
  }
  return { P: out, files, warnings, exported_at: backup.exported_at || null };
}

module.exports = { prepare };
