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
  // 2: connections to other services (Jira, Outlook)
  `
  CREATE TABLE IF NOT EXISTS app_secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  `,
  // 3: the Project Chat. A thread belongs to one person and one context (a project or the whole portfolio) and is
  // deleted with its project. The log keeps counts and outcomes, never secrets, and is purged after 90 days.
  `
  CREATE TABLE IF NOT EXISTS chat_threads (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_active_idx ON chat_threads(user_id, COALESCE(project_id, 0)) WHERE archived = false;
  CREATE INDEX IF NOT EXISTS chat_threads_project_idx ON chat_threads(project_id);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT PRIMARY KEY,
    thread_id BIGINT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
    text TEXT NOT NULL DEFAULT '',
    tool_calls JSONB,
    card JSONB,
    feedback SMALLINT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(thread_id, id);
  CREATE TABLE IF NOT EXISTS chat_log (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    project_id BIGINT,
    kind TEXT NOT NULL,
    category TEXT,
    tool TEXT,
    outcome TEXT,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    billable BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS chat_log_user_idx ON chat_log(user_id, created_at);
  CREATE INDEX IF NOT EXISTS chat_log_kind_idx ON chat_log(kind, created_at);
  `,
  // 4: daily snapshots of each project's key figures, the history behind the trends dashboards
  `
  CREATE TABLE IF NOT EXISTS project_snapshots (
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snap_date DATE NOT NULL,
    figures JSONB NOT NULL,
    taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, snap_date)
  );
  CREATE INDEX IF NOT EXISTS snapshots_date_idx ON project_snapshots(snap_date);
  `,
  // 5: the widget marketplace. A widget is plain data (a spec), never code. published_spec is what other people run, so
  // editing a draft never changes a widget someone already added. Ratings are one per person. Installs record which
  // overview (portfolio or project) a widget was added to. Saved layouts are named snapshots of an overview.
  `
  CREATE TABLE IF NOT EXISTS widgets (
    id BIGINT PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    grp TEXT NOT NULL,
    spec JSONB NOT NULL,
    published_spec JSONB,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unpublished')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS widgets_status_idx ON widgets(status, published_at);
  CREATE INDEX IF NOT EXISTS widgets_owner_idx ON widgets(owner_id);
  CREATE TABLE IF NOT EXISTS widget_ratings (
    widget_id BIGINT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (widget_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS widget_installs (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    widget_id BIGINT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('portfolio','project')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, widget_id, scope)
  );
  CREATE INDEX IF NOT EXISTS widget_installs_widget_idx ON widget_installs(widget_id);
  CREATE TABLE IF NOT EXISTS dash_layouts (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('portfolio','project')),
    name TEXT NOT NULL,
    layout JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS dash_layouts_name_idx ON dash_layouts(user_id, scope, lower(name));
  `,
  // 6: the super admin area. user_flags holds the super admin switch, the suspended state and last seen (a separate table
  // so the users table is never altered). app_config is the runtime configuration. subscriptions is one row per person.
  // payments is the income ledger. ai_usage records every metered AI call. error_log holds server and browser errors.
  // health_beats is one row per minute while the server runs, the base for uptime. admin_audit records every admin change.
  `
  CREATE TABLE IF NOT EXISTS user_flags (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_super BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    last_seen_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','cancelled')),
    plan TEXT NOT NULL DEFAULT 'Monthly',
    trial_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    trial_end TIMESTAMPTZ NOT NULL,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    price_cents INT NOT NULL DEFAULT 2500,
    token_limit BIGINT NOT NULL DEFAULT 10000000,
    auto_renew BOOLEAN NOT NULL DEFAULT true,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS payments (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL DEFAULT '',
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
    status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','demo')),
    method TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments(paid_at);
  CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id);
  CREATE TABLE IF NOT EXISTS ai_usage (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    project_id BIGINT,
    source TEXT NOT NULL DEFAULT 'ai',
    model TEXT NOT NULL DEFAULT '',
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ai_usage_time_idx ON ai_usage(created_at);
  CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage(user_id, created_at);
  CREATE TABLE IF NOT EXISTS error_log (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('server','browser')),
    status INT,
    method TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    stack TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL DEFAULT '',
    resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS error_log_time_idx ON error_log(created_at);
  CREATE TABLE IF NOT EXISTS health_beats (
    beat TIMESTAMPTZ PRIMARY KEY,
    db_ms INT NOT NULL DEFAULT 0,
    mem_mb INT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS admin_audit (
    id BIGINT PRIMARY KEY,
    admin_id BIGINT,
    admin_email TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS admin_audit_time_idx ON admin_audit(created_at);
  `,
  // 7: how project managers use the product. One row per observed step (a screen opened, an action used, a repeated
  // click, a slow or failed call). It holds screen and action names only, never project content, and is purged after 90 days.
  `
  CREATE TABLE IF NOT EXISTS usage_events (
    id BIGINT PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    sid TEXT NOT NULL,
    kind TEXT NOT NULL,
    screen TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '',
    ms INT NOT NULL DEFAULT 0,
    device TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS usage_events_time_idx ON usage_events(created_at);
  CREATE INDEX IF NOT EXISTS usage_events_user_idx ON usage_events(user_id, created_at);
  `,
  // 8: support tickets. A ticket is a problem report or an idea from a signed in person (or an automatic draft from a
  // repeated server error). context is the sanitized debugging package, triage is the AI briefing for the super admin,
  // fix is the state of the AI fix job. A report that matches an open ticket becomes a child of it (duplicate_of), so each
  // person keeps their own words and sees the status of the main ticket. ticket_events is the timeline. visible says
  // whether the reporter sees the entry.
  `
  CREATE SEQUENCE IF NOT EXISTS ticket_numbers;
  CREATE TABLE IF NOT EXISTS tickets (
    id BIGINT PRIMARY KEY,
    number BIGINT NOT NULL UNIQUE DEFAULT nextval('ticket_numbers'),
    reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bug','enhancement','question')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_error')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','triaged','needs_info','fixing','needs_attention','fixed_dev','ready_publish','published','wont_fix','duplicate')),
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    fingerprint TEXT NOT NULL DEFAULT '',
    duplicate_of BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    occurrences INT NOT NULL DEFAULT 1,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    triage JSONB NOT NULL DEFAULT '{}'::jsonb,
    fix JSONB NOT NULL DEFAULT '{}'::jsonb,
    fix_attempts INT NOT NULL DEFAULT 0,
    reopened INT NOT NULL DEFAULT 0,
    reporter_unread BOOLEAN NOT NULL DEFAULT false,
    admin_unread BOOLEAN NOT NULL DEFAULT true,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS tickets_reporter_idx ON tickets(reporter_id, updated_at);
  CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status, updated_at);
  CREATE INDEX IF NOT EXISTS tickets_fp_idx ON tickets(fingerprint);
  CREATE INDEX IF NOT EXISTS tickets_dup_idx ON tickets(duplicate_of);
  CREATE TABLE IF NOT EXISTS ticket_events (
    id BIGINT PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('reporter','admin','ai','system')),
    actor_id BIGINT,
    type TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    visible BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events(ticket_id, id);
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

async function prepareSchema(db, { managedProduction = false } = {}) {
  if (managedProduction) {
    // Replit Publish owns production DDL. Its schema copy need not include the
    // development migration-history rows, so do not replay migrations here.
    const required = ['users', 'sessions', 'projects', 'project_members', 'project_files', 'app_secrets', 'oauth_states', 'chat_threads', 'chat_messages', 'chat_log', 'project_snapshots', 'widgets', 'widget_ratings', 'widget_installs', 'dash_layouts', 'user_flags', 'app_config', 'subscriptions', 'payments', 'ai_usage', 'error_log', 'health_beats', 'admin_audit', 'tickets', 'ticket_events', 'schema_migrations', 'id_blocks'];
    const result = await db.query(
      "SELECT name FROM unnest($1::text[]) AS required(name) WHERE to_regclass('public.' || name) IS NULL",
      [required],
    );
    if (result.rows.length) {
      throw new Error('Production database schema is missing: ' + result.rows.map((r) => r.name).join(', ') + '. Replit Publish must apply the development schema before this version starts.');
    }
    return;
  }
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
}

async function open(opts = {}) {
  const url = opts.url !== undefined ? opts.url : process.env.DATABASE_URL;
  const managedProduction = process.env.REPLIT_DEPLOYMENT === '1' && !opts.memory;
  if (managedProduction && !url) {
    throw new Error('DATABASE_URL is required in a published app. Replit must provision the production database; embedded storage is not a production fallback.');
  }
  const db = url ? await openPg(url) : await openLite(opts);
  try {
    await prepareSchema(db, { managedProduction });
  } catch (error) {
    await db.close().catch(() => {});
    throw error;
  }
  return db;
}

module.exports = { open, prepareSchema };
