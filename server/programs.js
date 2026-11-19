// Programs: a group of projects inside an organization, run by a Program Manager. A program page is built only from the
// project_rollups rows, so it never loads a project document, and it shows only the projects the person is allowed to reach.
// The Admin role manages the structure and sees that projects exist, but not their numbers.
'use strict';

const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
const DATA_ROLES = ['pmo_director', 'program_manager', 'viewer'];

class Programs {
  constructor({ db, store, orgs }) { this.db = db; this.store = store; this.orgs = orgs; }
  q(t, p) { return this.db.query(t, p); }

  async grants(userId, wid) { return (await this.q('SELECT role, scope_type, scope_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wid, userId])).rows.map((r) => ({ role: r.role, scope_type: r.scope_type, scope_id: Number(r.scope_id) })); }
  isOrgWide(g) { return g.scope_type === 'organization'; }
  // Can this person see the numbers of this program
  async canView(userId, wid, programId) {
    const g = await this.grants(userId, wid);
    return g.some((x) => DATA_ROLES.includes(x.role) && (this.isOrgWide(x) || (x.scope_type === 'program' && x.scope_id === Number(programId))));
  }
  async canManageStructure(userId, wid) { const g = await this.grants(userId, wid); return g.some((x) => ['admin', 'pmo_director'].includes(x.role)); }
  async program(wid, pid) {
    const p = (await this.q("SELECT id, name, status FROM structure_nodes WHERE id = $1 AND workspace_id = $2 AND kind = 'program'", [Number(pid) || 0, Number(wid)])).rows[0];
    if (!p) throw err(404, 'Program not found');
    return p;
  }

  async list(userId, wid) {
    await this.orgs.need();
    const g = await this.grants(userId, wid);
    if (!g.length) throw err(403, 'You do not have permission to do this in this organization');
    const all = g.some((x) => ['admin', 'pmo_director'].includes(x.role) && this.isOrgWide(x)) || g.some((x) => x.role === 'viewer' && this.isOrgWide(x));
    const mine = new Set(g.filter((x) => x.scope_type === 'program').map((x) => x.scope_id));
    const rows = (await this.q("SELECT n.id, n.name, n.status, (SELECT count(*) FROM projects p WHERE p.parent_id = n.id) AS projects FROM structure_nodes n WHERE n.workspace_id = $1 AND n.kind = 'program' ORDER BY n.status, n.name", [wid])).rows;
    return rows.filter((r) => all || mine.has(Number(r.id))).map((r) => ({ id: Number(r.id), name: r.name, status: r.status, projects: Number(r.projects) }));
  }
  async create(userId, wid, name) {
    await this.orgs.need();
    if (!(await this.canManageStructure(userId, wid))) throw err(403, 'Only an Admin or PMO Director can change the structure');
    const nm = String(name || '').trim().slice(0, 80); if (!nm) throw err(400, 'Give the program a name');
    if ((await this.q("SELECT 1 FROM structure_nodes WHERE workspace_id = $1 AND kind = 'program' AND status = 'active' AND lower(name) = lower($2)", [wid, nm])).rows.length) throw err(409, 'A program with this name already exists');
    const id = this.store.nid();
    await this.q("INSERT INTO structure_nodes(id, workspace_id, kind, name) VALUES ($1,$2,'program',$3)", [id, wid, nm]);
    return { id };
  }
  async rename(userId, wid, pid, name) {
    await this.orgs.need();
    if (!(await this.canManageStructure(userId, wid))) throw err(403, 'Only an Admin or PMO Director can change the structure');
    await this.program(wid, pid);
    const nm = String(name || '').trim().slice(0, 80); if (!nm) throw err(400, 'Give the program a name');
    await this.q('UPDATE structure_nodes SET name = $3 WHERE id = $1 AND workspace_id = $2', [pid, wid, nm]);
  }
  // Closing a program keeps its projects: they return to the organization level.
  async archive(userId, wid, pid) {
    await this.orgs.need();
    if (!(await this.canManageStructure(userId, wid))) throw err(403, 'Only an Admin or PMO Director can change the structure');
    await this.program(wid, pid);
    await this.q('UPDATE projects SET parent_id = NULL WHERE parent_id = $1 AND workspace_id = $2', [pid, wid]);
    await this.q('UPDATE project_rollups SET parent_id = NULL WHERE parent_id = $1 AND workspace_id = $2', [pid, wid]);
    await this.q("UPDATE structure_nodes SET status = 'archived' WHERE id = $1 AND workspace_id = $2", [pid, wid]);
    await this.q("DELETE FROM workspace_members WHERE workspace_id = $1 AND scope_type = 'program' AND scope_id = $2", [wid, pid]);
  }
  // Put a project in a program, or take it out with a null program. Admin and PMO Director can do any, a Program Manager only for their program.
  async assign(userId, wid, projectId, pid) {
    await this.orgs.need();
    const proj = (await this.q('SELECT id, parent_id FROM projects WHERE id = $1 AND workspace_id = $2', [Number(projectId), wid])).rows[0];
    if (!proj) throw err(404, 'Project not found in this organization');
    const g = await this.grants(userId, wid);
    const wide = g.some((x) => ['admin', 'pmo_director'].includes(x.role));
    const pm = (target) => g.some((x) => x.role === 'program_manager' && x.scope_type === 'program' && x.scope_id === Number(target));
    if (pid != null) {
      const p = await this.program(wid, pid);
      if (p.status !== 'active') throw err(409, 'This program is closed');
      if (!wide && !pm(pid)) throw err(403, 'You do not have permission to change this program');
    } else if (!wide && !(proj.parent_id && pm(proj.parent_id))) throw err(403, 'You do not have permission to change this program');
    if (proj.parent_id && !wide && !pm(proj.parent_id)) throw err(403, 'The project belongs to another program');
    await this.q('UPDATE projects SET parent_id = $2 WHERE id = $1', [proj.id, pid == null ? null : Number(pid)]);
    await this.q('UPDATE project_rollups SET parent_id = $2 WHERE project_id = $1', [proj.id, pid == null ? null : Number(pid)]).catch(() => {});
    return { project_id: Number(proj.id), program_id: pid == null ? null : Number(pid) };
  }
  // Give or take away an extra organization role: PMO Director, or Program Manager for one program.
  async grant(adminId, wid, target, role, pid) {
    await this.orgs.need(); await this.orgs.requireRole(adminId, wid, 'admin');
    if (!['pmo_director', 'program_manager', 'viewer'].includes(role)) throw err(400, 'Choose PMO Director, Program Manager or Viewer');
    const have = await this.orgs.rolesIn(target, wid); if (!have.length) throw err(404, 'That person is not in this organization');
    let st = 'organization', sid = 0;
    if (role === 'program_manager' || (role === 'viewer' && pid)) { const p = await this.program(wid, pid); if (p.status !== 'active') throw err(409, 'This program is closed'); st = 'program'; sid = Number(p.id); }
    if (role !== 'viewer' && !have.some((r) => r !== 'viewer') && (await this.orgs.seatsUsed(wid)) >= (await this.orgs.seatsBought(wid))) throw err(409, 'All seats are in use. Add seats first.');
    await this.q('INSERT INTO workspace_members(workspace_id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [wid, target, role, st, sid, adminId]);
  }
  async revoke(adminId, wid, target, role, pid) {
    await this.orgs.need(); await this.orgs.requireRole(adminId, wid, 'admin');
    if (!['pmo_director', 'program_manager', 'viewer'].includes(role)) throw err(400, 'Choose PMO Director, Program Manager or Viewer');
    const st = role === 'program_manager' || (role === 'viewer' && pid) ? 'program' : 'organization', sid = st === 'program' ? Number(pid) || 0 : 0;
    await this.q('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = $3 AND scope_type = $4 AND scope_id = $5', [wid, target, role, st, sid]);
  }

  // Names and program of every project in the organization, for placing projects. No numbers.
  async projects(userId, wid) {
    await this.orgs.need();
    const g = await this.grants(userId, wid);
    if (!g.some((x) => ['admin', 'pmo_director', 'program_manager'].includes(x.role))) throw err(403, 'You do not have permission to do this in this organization');
    const rows = (await this.q("SELECT id, parent_id, data->'p'->>'name' AS name FROM projects WHERE workspace_id = $1 ORDER BY id", [wid])).rows;
    return rows.map((r) => ({ id: Number(r.id), name: r.name, program_id: r.parent_id == null ? null : Number(r.parent_id) }));
  }
  async dashboard(userId, wid, pid) {
    await this.orgs.need();
    const p = await this.program(wid, pid);
    const structure = await this.canManageStructure(userId, wid);
    if (!(await this.canView(userId, wid, pid))) {
      if (!structure) throw err(403, 'You do not have permission to see this program');
      // the Admin sees that the projects exist, not their numbers
      const n = Number((await this.q('SELECT count(*) AS n FROM projects WHERE parent_id = $1 AND workspace_id = $2', [pid, wid])).rows[0].n);
      return { id: Number(p.id), name: p.name, status: p.status, restricted: true, project_count: n };
    }
    const rows = (await this.q(`SELECT r.project_id, r.status, r.health, r.progress, r.planned, r.spi, r.overdue, r.tasks, r.pending_review, r.value, r.currency, r.forecast_end, r.contract_end, r.updated_at, pr.data->'p'->>'name' AS name
      FROM project_rollups r JOIN projects pr ON pr.id = r.project_id WHERE r.parent_id = $1 AND r.workspace_id = $2 ORDER BY r.project_id`, [pid, wid])).rows;
    const num = (v) => (v == null ? null : Number(v));
    const live = rows.filter((r) => r.status === 'active');
    const spis = live.map((r) => num(r.spi)).filter((v) => v != null);
    const health = { green: 0, amber: 0, red: 0 };
    for (const r of live) if (health[r.health] != null) health[r.health]++;
    const values = {};
    for (const r of rows) values[r.currency] = (values[r.currency] || 0) + (Number(r.value) || 0);
    const ends = rows.map((r) => r.forecast_end).filter(Boolean).sort();
    const rank = { red: 0, amber: 1, green: 2 };
    return {
      id: Number(p.id), name: p.name, status: p.status, restricted: false,
      totals: {
        projects: rows.length, active: live.length, health,
        progress: live.length ? Math.round(live.reduce((a, r) => a + (num(r.progress) || 0), 0) / live.length) : 0,
        planned: live.length ? Math.round(live.reduce((a, r) => a + (num(r.planned) || 0), 0) / live.length) : 0,
        spi: spis.length ? Math.round((spis.reduce((a, b) => a + b, 0) / spis.length) * 100) / 100 : null,
        overdue: live.reduce((a, r) => a + (Number(r.overdue) || 0), 0), pending_review: live.reduce((a, r) => a + (Number(r.pending_review) || 0), 0),
        value_by_currency: values, latest_forecast_end: ends.length ? ends[ends.length - 1] : null,
      },
      projects: rows.map((r) => ({ id: Number(r.project_id), name: r.name, status: r.status, health: r.health, progress: num(r.progress), planned: num(r.planned), spi: num(r.spi), overdue: Number(r.overdue), pending_review: Number(r.pending_review), forecast_end: r.forecast_end, contract_end: r.contract_end }))
        .sort((a, b) => (rank[a.health] ?? 3) - (rank[b.health] ?? 3) || a.name.localeCompare(b.name)),
    };
  }
}

module.exports = { Programs };
