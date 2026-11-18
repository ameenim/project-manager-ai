// Project storage on top of the database. Each project is one JSON document (version counted) with a member list that
// decides who may see and change it. Projects are cached in memory and a version check on every request reloads
// a project that another server instance has changed.
'use strict';

const crypto = require('crypto');
const BLOCK = 10_000_000;
const err = (status, message) => Object.assign(new Error(message), { status });
const ROLES = ['manager', 'editor', 'viewer'];
const RANK = { viewer: 1, editor: 2, manager: 3 };
const replacer = (k, v) => (k.startsWith('_') ? undefined : v);
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const vkey = (id) => 'v:' + id;
// What each schedule version entry was last fingerprinted as, so an old entry that nobody touches is never stringified again.
// The value 'stored' means the entry came from the database and has not been looked at since.
const vmemo = new WeakMap();

class Store {
  constructor(db) {
    this.db = db;
    this.cache = new Map();      // project id to { P, version }
    this.timers = new Map();     // project id to a pending save timer
    this.chain = new Map();      // project id to the last save promise, so saves never overtake each other
    this.events = [];            // recent analysis events, newest last
    this.evSeq = 0;
    this.next = 0; this.limit = 0; this.spare = null; this.reserving = false;
    this.sharded = true;         // false when the project_parts table is missing: everything then stays in the project row
  }

  // ---------- ids ----------
  // Every process takes a block of ten million ids from a database sequence, so ids never repeat across projects,
  // users or server instances, and creating an id never waits for the database.
  async init() {
    await this.reserve(true);
    // A database that has not got the project_parts table yet (a published app whose schema was not updated) must still
    // work, so the app keeps the older layout, where everything is in the project row, until the table exists.
    try { this.sharded = !!(await this.db.query("SELECT to_regclass('public.project_parts') AS t")).rows[0].t; } catch (e) { this.sharded = false; }
    if (!this.sharded) console.error('project_parts table not found, projects stay in one row until the database schema is updated');
  }
  async reserve(first) {
    const n = (await this.db.query("SELECT nextval('id_blocks') AS n")).rows[0].n;
    const start = Number(n) * BLOCK;
    if (first) { this.next = start; this.limit = start + BLOCK - 1; } else this.spare = start;
    this.reserving = false;
  }
  nid() {
    if (this.next >= this.limit) {
      if (this.spare == null) throw new Error('Out of ids, restart the server');
      this.next = this.spare; this.limit = this.spare + BLOCK - 1; this.spare = null;
    }
    if (this.limit - this.next < BLOCK / 10 && this.spare == null && !this.reserving) { this.reserving = true; this.reserve(false).catch(() => { this.reserving = false; }); }
    return ++this.next;
  }

  // ---------- reading ----------
  async forUser(userId) {
    const rows = (await this.db.query('SELECT p.id, p.version, m.role FROM project_members m JOIN projects p ON p.id = m.project_id WHERE m.user_id = $1 ORDER BY p.id', [userId])).rows;
    const need = rows.filter((r) => { const c = this.cache.get(r.id); return !c || c.version !== r.version; }).map((r) => r.id);
    if (need.length) {
      for (const row of await this.readRows(need)) {
        const old = this.cache.get(row.id);
        // the project object is replaced in place so a running analysis keeps writing to the object everyone reads
        if (old && old.P) { for (const k of Object.keys(old.P)) if (!k.startsWith('_')) delete old.P[k]; Object.assign(old.P, row.data); old.version = row.version; old.sums = null; old.psums = row.psums; }
        else this.cache.set(row.id, { P: row.data, version: row.version, sums: null, psums: row.psums });
      }
    }
    const projects = {}, roles = {}, order = [];
    for (const r of rows) { const c = this.cache.get(r.id); if (!c) continue; projects[r.id] = c.P; roles[r.id] = r.role; order.push(r.id); }
    return { projects, roles, order };
  }

  // The heavy, rarely changing parts of a project (extracted document text and the schedule version history) live in
  // their own rows, one row per version entry. The project row keeps the order of the versions. Rows written before this
  // layout still hold everything inline and are moved on their first save.
  async readRows(ids) {
    const rows = (await this.db.query('SELECT id, data, version FROM projects WHERE id = ANY($1::bigint[])', [ids])).rows;
    if (!rows.length) return [];
    const pr = this.sharded ? (await this.db.query('SELECT project_id, k, data FROM project_parts WHERE project_id = ANY($1::bigint[])', [rows.map((r) => r.id)])).rows : [];
    const by = new Map();
    for (const r of pr) { if (!by.has(r.project_id)) by.set(r.project_id, {}); by.get(r.project_id)[r.k] = r.data; }
    return rows.map((row) => {
      const parts = by.get(row.id) || null, d = row.data;
      let psums = null;
      if (parts) {
        psums = {};
        for (const k of Object.keys(parts)) psums[k] = 'stored';
        if (Array.isArray(d.vorder)) { d.versions = d.vorder.map((id) => parts[vkey(id)]).filter((v) => v !== undefined); delete d.vorder; for (const v of d.versions) vmemo.set(v, 'stored'); }
        if ('texts' in parts) { d.texts = parts.texts; psums.textsRef = { ...parts.texts }; }
      }
      return { id: row.id, version: row.version, data: d, psums };
    });
  }

  roleOf(projectId, userId) {
    return this.db.query('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]).then((r) => (r.rows[0] ? r.rows[0].role : null));
  }

  // ---------- writing ----------
  async create(P, ownerId) {
    await this.db.tx(async (t) => {
      await t.query("INSERT INTO projects(id, owner_id, data) VALUES ($1, $2, '{}'::jsonb)", [P.id, ownerId]);
      await t.query("INSERT INTO project_members(project_id, user_id, role) VALUES ($1, $2, 'manager')", [P.id, ownerId]);
    });
    this.cache.set(P.id, { P, version: 1, sums: null, psums: null });
    if (this.onCreate) await this.onCreate(P, ownerId);
    await this.save(P);
  }

  // A project is one JSON document, but most of its weight (extracted document text, schedule version history) almost
  // never changes. Every top level part is fingerprinted when it is saved, and the next save sends only the parts whose
  // fingerprint changed. A small edit on a project with megabytes of history is then a small write, not a full rewrite.
  save(P) {
    const id = P.id;
    const prev = this.chain.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const c0 = this.cache.get(id);
      if (!c0) return false;
      const heavy = new Set(this.sharded ? ['versions', 'texts'] : []);
      const keys = Object.keys(P).filter((k) => !k.startsWith('_') && P[k] !== undefined && !heavy.has(k));
      const parts = {}, sums = {};
      for (const k of keys) { const s = JSON.stringify(P[k]); if (s === undefined) continue; parts[k] = s; sums[k] = md5(s); }

      // heavy parts: one row per schedule version and one for the document texts
      const pknown = c0.psums, psums = {}, pwrite = {};
      const vers = this.sharded && Array.isArray(P.versions) ? P.versions : null;
      if (vers && vers.every((v) => v && typeof v === 'object' && Number.isFinite(v.id))) {
        const recent = new Set(vers.slice(-2));
        for (const v of vers) {
          const k = vkey(v.id); let m = vmemo.get(v);
          let json = null;
          if (m === undefined || recent.has(v)) { json = JSON.stringify(v); m = md5(json); vmemo.set(v, m); }
          psums[k] = m;
          if (!pknown || pknown[k] !== m) pwrite[k] = json;      // null means stringify when it is written
        }
        const order = JSON.stringify(vers.map((v) => v.id)); parts.vorder = order; sums.vorder = md5(order);
      } else if (vers) { const s = JSON.stringify(vers); parts.versions = s; sums.versions = md5(s); }
      const tx = this.sharded ? P.texts : undefined;
      if (tx && typeof tx === 'object') {
        const ref = pknown && pknown.textsRef, ks = Object.keys(tx);
        const same = ref && ks.length === Object.keys(ref).length && ks.every((k) => ref[k] === tx[k]);
        psums.textsRef = same ? ref : { ...tx };
        psums.texts = 'x';
        if (!same || !pknown || pknown.texts === undefined) pwrite.texts = JSON.stringify(tx);
      } else if (tx !== undefined) { const s = JSON.stringify(tx); parts.texts = s; sums.texts = md5(s); }
      const stale = !this.sharded ? [] : pknown ? Object.keys(pknown).filter((k) => k !== 'textsRef' && !(k in psums)) : null;

      const known = c0.sums;
      let ver = null;
      const writeMain = async (q) => {
        if (!known) {
          const data = '{' + Object.keys(parts).map((k) => JSON.stringify(k) + ':' + parts[k]).join(',') + '}';
          return q('UPDATE projects SET data = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version', [id, data]);
        }
        const changed = Object.keys(parts).filter((k) => known[k] !== sums[k]);
        const gone = Object.keys(known).filter((k) => !(k in parts));
        const patch = '{' + changed.map((k) => JSON.stringify(k) + ':' + parts[k]).join(',') + '}';
        return q('UPDATE projects SET data = (data - $3::text[]) || $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version', [id, patch, gone]);
      };
      const writeParts = async (q) => {
        for (const k of Object.keys(pwrite)) {
          let json = pwrite[k];
          if (json === null) json = JSON.stringify(vers.find((v) => vkey(v.id) === k));
          await q('INSERT INTO project_parts(project_id, k, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (project_id, k) DO UPDATE SET data = EXCLUDED.data', [id, k, json]);
        }
        if (stale === null) await q('DELETE FROM project_parts WHERE project_id = $1 AND k <> ALL($2::text[])', [id, Object.keys(psums).filter((k) => k !== 'textsRef' && k !== 'texts').concat(psums.texts ? ['texts'] : [])]);
        else if (stale.length) await q('DELETE FROM project_parts WHERE project_id = $1 AND k = ANY($2::text[])', [id, stale]);
      };
      const needParts = Object.keys(pwrite).length > 0 || stale === null || stale.length > 0;
      if (needParts) {
        await this.db.tx(async (t) => {
          const r = await writeMain((text, p) => t.query(text, p));
          if (!r.rows[0]) return;
          ver = r.rows[0].version;
          await writeParts((text, p) => t.query(text, p));
        });
      } else {
        const r = await writeMain((text, p) => this.db.query(text, p));
        if (r.rows[0]) ver = r.rows[0].version;
      }
      if (ver === null) { this.cache.delete(id); return false; } // deleted meanwhile
      const c = this.cache.get(id); if (c) { c.P = P; c.version = ver; c.sums = sums; c.psums = psums; }
      if (this.afterSave) await this.afterSave(P, ver);
      return true;
    });
    this.chain.set(id, run);
    run.finally(() => { if (this.chain.get(id) === run) this.chain.delete(id); }).catch(() => {});
    return run;
  }

  saveSoon(P, ms = 400) {
    if (this.timers.has(P.id)) return;
    const t = setTimeout(() => { this.timers.delete(P.id); this.save(P).catch((e) => console.error('save failed for project', P.id, e.message)); }, ms);
    t.unref && t.unref();
    this.timers.set(P.id, { t, P });
    this.timers.get(P.id).t = t;
  }

  async flush() {
    const pending = [...this.timers.values()];
    for (const x of pending) clearTimeout(x.t);
    this.timers.clear();
    await Promise.all(pending.map((x) => this.save(x.P).catch((e) => console.error('flush failed', x.P.id, e.message))));
    await Promise.all([...this.chain.values()].map((p) => p.catch(() => {})));
  }

  async remove(id) {
    const x = this.timers.get(id); if (x) { clearTimeout(x.t); this.timers.delete(id); }
    await (this.chain.get(id) || Promise.resolve()).catch(() => {});
    await this.db.query('DELETE FROM projects WHERE id = $1', [id]);
    this.cache.delete(id);
  }

  // ---------- members ----------
  async members(projectId) {
    return (await this.db.query('SELECT u.id AS user_id, u.name, u.email, m.role, m.added_at FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY (m.role = \'manager\') DESC, m.added_at, u.id', [projectId])).rows;
  }
  async userByEmail(email) {
    return (await this.db.query('SELECT id, name, email FROM users WHERE email = $1', [String(email || '').trim().toLowerCase()])).rows[0] || null;
  }
  async setMember(projectId, userId, role) {
    if (!ROLES.includes(role)) throw err(400, 'Choose a role: project manager, editor or viewer');
    const cur = await this.roleOf(projectId, userId);
    if (cur === 'manager' && role !== 'manager') await this.assertAnotherManager(projectId, userId);
    await this.db.query('INSERT INTO project_members(project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role', [projectId, userId, role]);
  }
  async removeMember(projectId, userId) {
    const cur = await this.roleOf(projectId, userId);
    if (!cur) throw err(404, 'That person is not on this project');
    if (cur === 'manager') await this.assertAnotherManager(projectId, userId);
    await this.db.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  }
  async assertAnotherManager(projectId, userId) {
    const n = (await this.db.query("SELECT count(*) AS c FROM project_members WHERE project_id = $1 AND role = 'manager' AND user_id <> $2", [projectId, userId])).rows[0].c;
    if (!Number(n)) throw err(400, 'A project needs at least one project manager');
  }

  // ---------- original files ----------
  async putFile(projectId, docId, f) {
    const id = this.nid();
    await this.db.query('INSERT INTO project_files(id, project_id, doc_id, filename, mime, size, data) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, projectId, docId, f.name, f.type || null, f.buffer.length, f.buffer]);
    return id;
  }
  async getFile(projectId, docId) {
    const r = (await this.db.query('SELECT filename, mime, size, data FROM project_files WHERE project_id = $1 AND doc_id = $2 ORDER BY id DESC LIMIT 1', [projectId, docId])).rows[0];
    return r ? { filename: r.filename, mime: r.mime, size: r.size, buffer: Buffer.from(r.data) } : null;
  }
  deleteFiles(projectId, docId) { return this.db.query('DELETE FROM project_files WHERE project_id = $1 AND doc_id = $2', [projectId, docId]); }
  async filesOf(projectId) {
    return (await this.db.query('SELECT doc_id, filename, mime, size, data FROM project_files WHERE project_id = $1 ORDER BY id', [projectId])).rows.map((r) => ({ doc_id: r.doc_id, filename: r.filename, mime: r.mime, size: r.size, buffer: Buffer.from(r.data) }));
  }

  // ---------- analysis events (polled by the browser) ----------
  pushEvent(userIdsOrNull, projectId, detail) {
    this.events.push({ seq: ++this.evSeq, at: Date.now(), project_id: projectId, detail });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }
  eventsFor(projectIds, since) {
    const ok = new Set(projectIds.map(Number));
    return this.events.filter((e) => e.seq > since && ok.has(Number(e.project_id)));
  }
}

module.exports = { Store, ROLES, RANK, err };
