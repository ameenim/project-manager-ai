// Workspaces: the owner of projects, billing and AI use. Every person gets a hidden personal workspace of one, so the
// product has one code path for a single project manager and for an organization. This file creates personal workspaces,
// stamps projects with their workspace, copies each subscription into a billing account and checks that nothing was missed.
// Nothing here changes what a user sees. If the new tables are not in the database yet (a published app gets them when
// Publish applies the schema), ready stays false and every method does nothing.
'use strict';

// The same plan code is built in SQL for the bulk copy, so both paths always agree.
const CODE_SQL = "trim(both '_' from lower(regexp_replace(s.plan, '[^a-zA-Z0-9]+', '_', 'g')))";

class Workspaces {
  constructor(db, store) {
    this.db = db; this.store = store;
    this.ready = false;
    this.byUser = new Map();   // user id to personal workspace id
    this.currency = null;      // optional async function returning the billing currency
  }
  q(text, params) { return this.db.query(text, params); }

  async init() {
    try {
      const r = (await this.q("SELECT to_regclass('public.workspaces') AS w, to_regclass('public.workspace_members') AS m, to_regclass('public.billing_accounts') AS b")).rows[0];
      let ok = !!(r.w && r.m && r.b);
      if (ok) ok = (await this.q("SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'workspace_id'")).rows.length > 0;
      this.ready = ok;
    } catch (e) { this.ready = false; }
    if (!this.ready) console.error('workspace tables not found, organization features stay off until the database schema is updated');
    return this.ready;
  }

  async cur() { try { return this.currency ? await this.currency() : 'USD'; } catch (e) { return 'USD'; } }

  // The personal workspace of one person. Created on first use, so it never needs a bulk migration to be correct.
  async ensurePersonal(userId) {
    if (!this.ready) return null;
    const hit = this.byUser.get(userId);
    if (hit) return hit;
    try {
      let row = (await this.q("SELECT id FROM workspaces WHERE kind = 'personal' AND owner_id = $1", [userId])).rows[0];
      if (!row) {
        const u = (await this.q('SELECT name FROM users WHERE id = $1', [userId])).rows[0];
        if (!u) return null;
        await this.q("INSERT INTO workspaces(id, kind, name, owner_id) VALUES ($1, 'personal', $2, $3) ON CONFLICT DO NOTHING", [this.store.nid(), u.name, userId]);
        row = (await this.q("SELECT id FROM workspaces WHERE kind = 'personal' AND owner_id = $1", [userId])).rows[0];
      }
      const wid = row.id;
      await this.q("INSERT INTO workspace_members(workspace_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, 'project_manager', 'organization', 0) ON CONFLICT DO NOTHING", [wid, userId]);
      await this.copyBilling(wid, userId);
      this.byUser.set(userId, wid);
      return wid;
    } catch (e) { console.error('workspace', e.message); return null; }
  }

  // One billing account per workspace, copied from the subscription. The subscription stays the source of truth in Phase 0.
  async copyBilling(wid, userId) {
    const cur = await this.cur();
    await this.q(`INSERT INTO billing_accounts(id, workspace_id, plan_code, status, currency, price_cents, trial_end, period_start, period_end)
      SELECT $1, $2, ${CODE_SQL}, s.status, $3, s.price_cents, s.trial_end, s.period_start, s.period_end FROM subscriptions s WHERE s.user_id = $4
      ON CONFLICT (workspace_id) DO NOTHING`, [this.store.nid(), wid, cur, userId]);
  }

  // The workspace a project is stamped with when it is created.
  async stampProject(projectId, userId) {
    if (!this.ready) return;
    try {
      const wid = await this.ensurePersonal(userId);
      if (wid) await this.q('UPDATE projects SET workspace_id = $2 WHERE id = $1 AND workspace_id IS NULL', [projectId, wid]);
    } catch (e) { console.error('stamp project', e.message); }
  }

  async workspaceOf(userId) { return this.ensurePersonal(userId); }

  // Bring every user, project and subscription that existed before workspaces into line. Safe to run again at any time.
  async backfill(limit = 500) {
    if (!this.ready) return null;
    const out = { workspaces: 0, projects: 0, billing: 0, refreshed: 0 };
    const users = (await this.q("SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.kind = 'personal' AND w.owner_id = u.id) ORDER BY u.id LIMIT $1", [limit])).rows;
    for (const u of users) if (await this.ensurePersonal(u.id)) out.workspaces++;
    out.projects = (await this.q("UPDATE projects p SET workspace_id = w.id FROM workspaces w WHERE p.workspace_id IS NULL AND w.kind = 'personal' AND w.owner_id = p.owner_id")).rowCount;
    const missing = (await this.q("SELECT w.id, w.owner_id FROM workspaces w WHERE w.kind = 'personal' AND NOT EXISTS (SELECT 1 FROM billing_accounts b WHERE b.workspace_id = w.id) AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = w.owner_id) ORDER BY w.id LIMIT $1", [limit])).rows;
    for (const m of missing) { await this.copyBilling(m.id, m.owner_id); out.billing++; }
    out.refreshed = (await this.q(`UPDATE billing_accounts b SET status = s.status, plan_code = ${CODE_SQL}, price_cents = s.price_cents, trial_end = s.trial_end, period_start = s.period_start, period_end = s.period_end
      FROM workspaces w JOIN subscriptions s ON s.user_id = w.owner_id WHERE b.workspace_id = w.id AND w.kind = 'personal'
      AND (b.status, b.plan_code, b.price_cents, b.trial_end, b.period_start, b.period_end) IS DISTINCT FROM (s.status, ${CODE_SQL}, s.price_cents, s.trial_end, s.period_start, s.period_end)`)).rowCount;
    out.more = users.length === limit || missing.length === limit;
    return out;
  }
  async backfillAll() {
    if (!this.ready) return null;
    const total = { workspaces: 0, projects: 0, billing: 0, refreshed: 0 };
    for (let i = 0; i < 1000; i++) {
      const r = await this.backfill();
      for (const k of Object.keys(total)) total[k] += r[k] || 0;
      if (!r.more) break;
    }
    return total;
  }

  // Counts that must match after a backfill. Every difference is zero when the migration is complete.
  async verify() {
    if (!this.ready) return { ready: false };
    const n = async (sql) => Number((await this.q(sql)).rows[0].n);
    return {
      ready: true,
      users_without_workspace: await n("SELECT count(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.kind = 'personal' AND w.owner_id = u.id)"),
      projects_without_workspace: await n('SELECT count(*) AS n FROM projects WHERE workspace_id IS NULL'),
      subscriptions_without_billing_account: await n("SELECT count(*) AS n FROM subscriptions s WHERE NOT EXISTS (SELECT 1 FROM workspaces w JOIN billing_accounts b ON b.workspace_id = w.id WHERE w.kind = 'personal' AND w.owner_id = s.user_id)"),
      users: await n('SELECT count(*) AS n FROM users'),
      personal_workspaces: await n("SELECT count(*) AS n FROM workspaces WHERE kind = 'personal'"),
      projects: await n('SELECT count(*) AS n FROM projects'),
      subscriptions: await n('SELECT count(*) AS n FROM subscriptions'),
      billing_accounts: await n('SELECT count(*) AS n FROM billing_accounts'),
    };
  }
}

module.exports = { Workspaces };
