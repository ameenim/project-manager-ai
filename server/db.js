// Database layer. Uses Postgres through DATABASE_URL (Replit Postgres in production).
// Without DATABASE_URL it uses an embedded Postgres (PGlite) stored in ./data/pglite so local work needs no setup.
// Tests pass { memory: true } for a throwaway embedded database.
'use strict';
const path = require('path');
const fs = require('fs');

const MIGRATIONS = [
  // 1: core tables
  `
  CREATE SEQUENCE IF NOT EXISTS id_blocks;
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pw_salt TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
    avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS projects (
    id BIGINT PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id),
    data JSONB NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('manager','editor','viewer')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS members_user_idx ON project_members(user_id);
  CREATE TABLE IF NOT EXISTS project_files (
    id BIGINT PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_id BIGINT,
    filename TEXT NOT NULL,
    mime TEXT,
    size INT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS files_project_idx ON project_files(project_id, doc_id);
  `,
];

async function openPg(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => Number(v)); // bigint ids fit safely in a JS number
  const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  pool.on('error', (e) => console.error('database pool error', e.message));
  return {
    kind: 'pg',
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const out = await fn({ query: (t, p) => c.query(t, p) }); await c.query('COMMIT'); return out; }
      catch (e) { try { await c.query('ROLLBACK'); } catch (x) { /* connection already gone */ } throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

async function openLite(opts) {
  const { PGlite } = require('@electric-sql/pglite');
  let dir;
  if (!opts.memory) { dir = opts.dir || path.join(__dirname, '..', 'data', 'pglite'); fs.mkdirSync(path.dirname(dir), { recursive: true }); }
  const lite = new PGlite(dir);
  await lite.waitReady;
  // PGlite returns bigint as BigInt for int8, so normalise rows to plain numbers
  const fix = (res) => ({ rows: res.rows.map((r) => { const o = {}; for (const k in r) o[k] = typeof r[k] === 'bigint' ? Number(r[k]) : r[k]; return o; }), rowCount: res.affectedRows != null ? res.affectedRows : res.rows.length });
  const q = (text, params) => lite.query(text, params).then(fix);
  return {
    kind: 'pglite',
    query: q,
    tx: (fn) => lite.transaction(async (t) => fn({ query: (text, params) => t.query(text, params).then(fix) })),
    exec: (sql) => lite.exec(sql),
    close: () => lite.close(),
  };
}

async function open(opts = {}) {
  const url = opts.url !== undefined ? opts.url : process.env.DATABASE_URL;
  const db = url ? await openPg(url) : await openLite(opts);
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT version FROM schema_migrations')).rows.map((r) => Number(r.version)));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const v = i + 1;
    if (done.has(v)) continue;
    await db.tx(async (t) => {
      for (const stmt of MIGRATIONS[i].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query('INSERT INTO schema_migrations(version) VALUES ($1)', [v]);
    });
  }
  return db;
}

module.exports = { open };
