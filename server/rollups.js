// One summary row per project, refreshed whenever the project is saved. Higher level dashboards (program, portfolio,
// organization) will read these rows and never load project documents. rebuildAll recreates every row from the documents, so
// the table can always be thrown away and rebuilt.
'use strict';

class Rollups {
  constructor(db, store, workspaces) { this.db = db; this.store = store; this.workspaces = workspaces; this.statsFn = null; this.ready = null; }
  async check() {
    if (this.ready !== null) return this.ready;
    try { this.ready = !!(await this.db.query("SELECT to_regclass('public.project_rollups') AS t")).rows[0].t; } catch (e) { this.ready = false; }
    return this.ready;
  }
  rowOf(P) {
    const s = this.statsFn(P), p = P.p || {};
    return { status: p.status || 'active', health: s.health, progress: s.progress, planned: s.planned, spi: s.spi == null ? null : s.spi, overdue: s.overdue, tasks: s.tasks,
      pending_review: (s.pendingItems || 0) + (s.pendingInbox || 0), value: Number(p.value) || 0, currency: p.currency || 'USD', forecast_end: s.forecast_end || null, contract_end: p.end_date || null };
  }
  // Best effort. A failure here must never fail a project save.
  async write(P, version) {
    try {
      if (!this.statsFn || !this.workspaces.ready || !(await this.check())) return;
      const r = this.rowOf(P);
      const w = (await this.db.query('SELECT workspace_id, parent_id FROM projects WHERE id = $1', [P.id])).rows[0];
      if (!w) return;
      await this.db.query(`INSERT INTO project_rollups(project_id, workspace_id, parent_id, status, health, progress, planned, spi, overdue, tasks, pending_review, value, currency, forecast_end, contract_end, project_version, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
        ON CONFLICT (project_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, parent_id = EXCLUDED.parent_id, status = EXCLUDED.status, health = EXCLUDED.health, progress = EXCLUDED.progress,
          planned = EXCLUDED.planned, spi = EXCLUDED.spi, overdue = EXCLUDED.overdue, tasks = EXCLUDED.tasks, pending_review = EXCLUDED.pending_review, value = EXCLUDED.value,
          currency = EXCLUDED.currency, forecast_end = EXCLUDED.forecast_end, contract_end = EXCLUDED.contract_end, project_version = EXCLUDED.project_version, updated_at = now()`,
        [P.id, w.workspace_id, w.parent_id, r.status, r.health, r.progress, r.planned, r.spi, r.overdue, r.tasks, r.pending_review, r.value, r.currency, r.forecast_end, r.contract_end, version || null]);
    } catch (e) { console.error('rollup', e.message); }
  }
  async rebuildAll() {
    if (!(await this.check())) return { ready: false };
    const ids = (await this.db.query('SELECT id FROM projects ORDER BY id')).rows.map((r) => Number(r.id));
    let n = 0;
    for (let i = 0; i < ids.length; i += 20) {
      for (const row of await this.store.readRows(ids.slice(i, i + 20))) {
        if (row.data) { await this.write(row.data, row.version); n++; }
      }
    }
    return { ready: true, rebuilt: n };
  }
}

module.exports = { Rollups };
