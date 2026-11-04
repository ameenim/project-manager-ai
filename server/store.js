// Project storage on top of the database. Each project is one JSON document (version counted) with a member list that
// decides who may see and change it. Projects are cached in memory and a version check on every request reloads
// a project that another server instance has changed.
'use strict';

const BLOCK = 10_000_000;
const err = (status, message) => Object.assign(new Error(message), { status });
const ROLES = ['manager', 'editor', 'viewer'];
const RANK = { viewer: 1, editor: 2, manager: 3 };
const replacer = (k, v) => (k.startsWith('_') ? undefined : v);

class Store {
  constructor(db) {
    this.db = db;
    this.cache = new Map();      // project id to { P, version }
    this.timers = new Map();     // project id to a pending save timer
    this.chain = new Map();      // project id to the last save promise, so saves never overtake each other
    this.events = [];            // recent analysis events, newest last
    this.evSeq = 0;
    this.next = 0; this.limit = 0; this.spare = null; this.reserving = false;
  }

  // ---------- ids ----------
  // Every process takes a block of ten million ids from a database sequence, so ids never repeat across projects,
  // users or server instances, and creating an id never waits for the database.
  async init() { await this.reserve(true); }
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
      const res = await this.db.query('SELECT id, data, version FROM projects WHERE id = ANY($1::bigint[])', [need]);
      for (const row of res.rows) {
        const old = this.cache.get(row.id);
        // the project object is replaced in place so a running analysis keeps writing to the object everyone reads
        if (old && old.P) { for (const k of Object.keys(old.P)) if (!k.startsWith('_')) delete old.P[k]; Object.assign(old.P, row.data); old.version = row.version; }
        else this.cache.set(row.id, { P: row.data, version: row.version });
      }
    }
    const projects = {}, roles = {}, order = [];
    for (const r of rows) { const c = this.cache.get(r.id); if (!c) continue; projects[r.id] = c.P; roles[r.id] = r.role; order.push(r.id); }
    return { projects, roles, order };
  }

  roleOf(projectId, userId) {
    return this.db.query('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]).then((r) => (r.rows[0] ? r.rows[0].role : null));
  }

  // ---------- writing ----------
  async create(P, ownerId) {
    const data = JSON.stringify(P, replacer);
    await this.db.tx(async (t) => {
      await t.query('INSERT INTO projects(id, owner_id, data) VALUES ($1, $2, $3::jsonb)', [P.id, ownerId, data]);
      await t.query("INSERT INTO project_members(project_id, user_id, role) VALUES ($1, $2, 'manager')", [P.id, ownerId]);
    });
    this.cache.set(P.id, { P, version: 1 });
  }

  save(P) {
    const id = P.id;
    const prev = this.chain.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      if (!this.cache.has(id)) return false;
      const data = JSON.stringify(P, replacer);
      const r = await this.db.query('UPDATE projects SET data = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version', [id, data]);
      if (!r.rows[0]) { this.cache.delete(id); return false; } // deleted meanwhile
      const c = this.cache.get(id); if (c) { c.P = P; c.version = r.rows[0].version; }
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
