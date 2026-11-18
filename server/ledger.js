// Token ledger: one row per AI call, owned by a workspace and tied to the project it was spent on. In Phase 0 it is written
// next to the existing ai_usage and chat_log tables (dual write) and never read by the product, so the old numbers stay the
// source of truth until the totals have matched for a full period. One AI unit is USD 0.001 of provider cost.
'use strict';

class Ledger {
  constructor(db, store, workspaces, ops) { this.db = db; this.store = store; this.workspaces = workspaces; this.ops = ops; this.ready = null; }

  async check() {
    if (this.ready !== null) return this.ready;
    try { this.ready = !!(await this.db.query("SELECT to_regclass('public.token_ledger') AS t")).rows[0].t; } catch (e) { this.ready = false; }
    return this.ready;
  }

  // Never throws and never blocks the AI call it describes.
  async record({ userId, projectId, feature, model, input, output, billable }) {
    try {
      if (!this.workspaces.ready || !(await this.check())) return;
      if (!input && !output) return;
      let wid = null;
      if (projectId) { const r = (await this.db.query("SELECT p.workspace_id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = $1 AND w.kind = 'business'", [Number(projectId)])).rows[0]; if (r) wid = Number(r.workspace_id); }
      if (!wid) wid = await this.workspaces.workspaceOf(userId);
      if (!wid) return;
      const usd = await this.ops.cost(input || 0, output || 0);
      const micros = Math.round(usd * 1e6);
      await this.db.query(
        'INSERT INTO token_ledger(id, workspace_id, user_id, project_id, feature, model, input_tokens, output_tokens, units, cost_micros, billable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [this.store.nid(), wid, userId || null, projectId || null, feature || 'ai', model || '', Math.round(input || 0), Math.round(output || 0), micros / 1000, micros, billable !== false]);
    } catch (e) { console.error('ledger', e.message); }
  }

  // Ledger totals against the two old tables. Every difference is zero while the dual write is healthy.
  async compare() {
    if (!(await this.check())) return { ready: false };
    const n = async (sql) => Number((await this.db.query(sql)).rows[0].n);
    const oldTokens = (await n('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM ai_usage')) + (await n('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM chat_log WHERE billable'));
    const ledgerTokens = await n('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM token_ledger WHERE billable');
    return { ready: true, old_tokens: oldTokens, ledger_tokens: ledgerTokens, difference: oldTokens - ledgerTokens };
  }
}

module.exports = { Ledger };
