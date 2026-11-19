// Portfolios group programs, and the organization view sits above all of them. Both are built from project_rollups only.
// Who sees numbers: PMO Director (organization wide), a Viewer (organization wide or scoped to one portfolio). The Admin
// manages the structure and sees counts, never project numbers, unless the Admin also holds one of those roles.
'use strict';
const { Programs } = require('./programs');

const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
const COLS = 'r.project_id, r.parent_id, r.status, r.health, r.progress, r.planned, r.spi, r.overdue, r.tasks, r.pending_review, r.value, r.currency, r.forecast_end, r.contract_end, pr.data->\'p\'->>\'name\' AS name';

class Portfolios {
  constructor({ db, store, orgs, programs }) { this.db = db; this.store = store; this.orgs = orgs; this.programs = programs; }
  q(t, p) { return this.db.query(t, p); }

  async portfolio(wid, id) {
    const p = (await this.q("SELECT id, name, status FROM structure_nodes WHERE id = $1 AND workspace_id = $2 AND kind = 'portfolio'", [Number(id) || 0, Number(wid)])).rows[0];
    if (!p) throw err(404, 'Portfolio not found');
    return p;
  }
  async canView(userId, wid, portfolioId) {
    const g = await this.programs.grants(userId, wid);
    return g.some((x) => ['pmo_director', 'viewer'].includes(x.role) && (x.scope_type === 'organization' || (portfolioId != null && x.scope_type === 'portfolio' && x.scope_id === Number(portfolioId))));
  }
  async canViewOrg(userId, wid) { const g = await this.programs.grants(userId, wid); return g.some((x) => ['pmo_director', 'viewer'].includes(x.role) && x.scope_type === 'organization'); }
  async manage(userId, wid) { await this.orgs.need(); if (!(await this.programs.canManageStructure(userId, wid))) throw err(403, 'Only an Admin or PMO Director can change the structure'); }

  async list(userId, wid) {
    await this.orgs.need();
    const g = await this.programs.grants(userId, wid);
    if (!g.length) throw err(403, 'You do not have permission to do this in this organization');
    const all = g.some((x) => ['admin', 'pmo_director', 'viewer'].includes(x.role) && x.scope_type === 'organization');
    const mine = new Set(g.filter((x) => x.scope_type === 'portfolio').map((x) => x.scope_id));
    const rows = (await this.q("SELECT n.id, n.name, n.status, (SELECT count(*) FROM structure_nodes c WHERE c.parent_id = n.id AND c.status = 'active') AS programs FROM structure_nodes n WHERE n.workspace_id = $1 AND n.kind = 'portfolio' ORDER BY n.status, n.name", [wid])).rows;
    return rows.filter((r) => all || mine.has(Number(r.id))).map((r) => ({ id: Number(r.id), name: r.name, status: r.status, programs: Number(r.programs) }));
  }
  async create(userId, wid, name) {
    await this.manage(userId, wid);
    const nm = String(name || '').trim().slice(0, 80); if (!nm) throw err(400, 'Give the portfolio a name');
    if ((await this.q("SELECT 1 FROM structure_nodes WHERE workspace_id = $1 AND kind = 'portfolio' AND status = 'active' AND lower(name) = lower($2)", [wid, nm])).rows.length) throw err(409, 'A portfolio with this name already exists');
    const id = this.store.nid();
    await this.q("INSERT INTO structure_nodes(id, workspace_id, kind, name) VALUES ($1,$2,'portfolio',$3)", [id, wid, nm]);
    return { id };
  }
  async rename(userId, wid, id, name) {
    await this.manage(userId, wid); await this.portfolio(wid, id);
    const nm = String(name || '').trim().slice(0, 80); if (!nm) throw err(400, 'Give the portfolio a name');
    await this.q('UPDATE structure_nodes SET name = $3 WHERE id = $1 AND workspace_id = $2', [id, wid, nm]);
  }
  // Closing a portfolio keeps its programs and projects: they return to the organization level.
  async archive(userId, wid, id) {
    await this.manage(userId, wid); await this.portfolio(wid, id);
    await this.q('UPDATE structure_nodes SET parent_id = NULL WHERE parent_id = $1 AND workspace_id = $2', [id, wid]);
    await this.q("UPDATE structure_nodes SET status = 'archived' WHERE id = $1 AND workspace_id = $2", [id, wid]);
    await this.q("DELETE FROM workspace_members WHERE workspace_id = $1 AND scope_type = 'portfolio' AND scope_id = $2", [wid, id]);
  }
  async placeProgram(userId, wid, programId, portfolioId) {
    await this.manage(userId, wid);
    await this.programs.program(wid, programId);
    if (portfolioId != null) { const f = await this.portfolio(wid, portfolioId); if (f.status !== 'active') throw err(409, 'This portfolio is closed'); }
    await this.q("UPDATE structure_nodes SET parent_id = $3 WHERE id = $1 AND workspace_id = $2 AND kind = 'program'", [programId, wid, portfolioId == null ? null : Number(portfolioId)]);
    return { program_id: Number(programId), portfolio_id: portfolioId == null ? null : Number(portfolioId) };
  }

  async rows(wid, where, params) {
    return (await this.q(`SELECT ${COLS} FROM project_rollups r JOIN projects pr ON pr.id = r.project_id WHERE r.workspace_id = $1 ${where} ORDER BY r.project_id`, [wid, ...params])).rows;
  }
  async dashboard(userId, wid, id) {
    await this.orgs.need();
    const f = await this.portfolio(wid, id);
    if (!(await this.canView(userId, wid, id))) {
      if (!(await this.programs.canManageStructure(userId, wid))) throw err(403, 'You do not have permission to see this portfolio');
      const n = Number((await this.q('SELECT count(*) AS n FROM projects p WHERE p.workspace_id = $1 AND p.parent_id IN (SELECT id FROM structure_nodes WHERE parent_id = $2)', [wid, id])).rows[0].n);
      return { id: Number(f.id), name: f.name, status: f.status, restricted: true, project_count: n };
    }
    const progs = (await this.q("SELECT id, name FROM structure_nodes WHERE parent_id = $1 AND workspace_id = $2 AND status = 'active' ORDER BY name", [id, wid])).rows;
    const rows = await this.rows(wid, 'AND r.parent_id IN (SELECT id FROM structure_nodes WHERE parent_id = $2)', [id]);
    return {
      id: Number(f.id), name: f.name, status: f.status, restricted: false, totals: Programs.agg(rows),
      programs: progs.map((p) => ({ id: Number(p.id), name: p.name, totals: Programs.agg(rows.filter((r) => Number(r.parent_id) === Number(p.id))) })),
      projects: Programs.list(rows),
    };
  }
  // The whole organization: every portfolio, every program outside a portfolio, and projects that sit in neither.
  async overview(userId, wid) {
    await this.orgs.need();
    if (!(await this.canViewOrg(userId, wid))) {
      if (!(await this.programs.canManageStructure(userId, wid))) throw err(403, 'You do not have permission to see the organization overview');
      const n = Number((await this.q('SELECT count(*) AS n FROM projects WHERE workspace_id = $1', [wid])).rows[0].n);
      return { restricted: true, project_count: n };
    }
    const nodes = (await this.q("SELECT id, kind, name, parent_id FROM structure_nodes WHERE workspace_id = $1 AND status = 'active' ORDER BY name", [wid])).rows;
    const rows = await this.rows(wid, '', []);
    const progOf = new Map(nodes.filter((n) => n.kind === 'program').map((n) => [Number(n.id), n.parent_id == null ? null : Number(n.parent_id)]));
    const inPortfolio = (r, f) => { const par = r.parent_id == null ? null : Number(r.parent_id); return par != null && progOf.has(par) && progOf.get(par) === Number(f); };
    const portfolios = nodes.filter((n) => n.kind === 'portfolio').map((f) => ({ id: Number(f.id), name: f.name, totals: Programs.agg(rows.filter((r) => inPortfolio(r, f.id))) }));
    const programs = nodes.filter((n) => n.kind === 'program' && n.parent_id == null).map((p) => ({ id: Number(p.id), name: p.name, totals: Programs.agg(rows.filter((r) => Number(r.parent_id) === Number(p.id))) }));
    const placed = new Set(nodes.filter((n) => n.kind === 'program').map((n) => Number(n.id)));
    const loose = rows.filter((r) => r.parent_id == null || !placed.has(Number(r.parent_id)));
    return { restricted: false, totals: Programs.agg(rows), portfolios, programs, unplaced: { totals: Programs.agg(loose), projects: Programs.list(loose) } };
  }
}

module.exports = { Portfolios };
