// The one place that decides which workspaces and projects a person can reach. Phase 0 keeps the answer identical to the old
// project_members check for every existing user. Organization grants (workspace_members above project level) are added only
// when org_features is on, so no current user can gain or lose access from this file.
'use strict';

const RANK = { viewer: 1, editor: 2, manager: 3 };
// Admin and Project Manager reach projects only through direct project membership. The Admin role manages the organization,
// it does not open project data. PMO Director and Program Manager reach projects by scope, Viewer reads by scope.
const ROLE_ACCESS = { pmo_director: 'manager', program_manager: 'manager', viewer: 'viewer' };

class Scope {
  constructor(db, workspaces, ops) { this.db = db; this.workspaces = workspaces; this.ops = ops; }
  async orgOn() { try { return !!(await this.ops.config()).org_features; } catch (e) { return false; } }

  // Workspaces this person belongs to, personal first.
  async workspacesOf(userId) {
    if (!this.workspaces.ready) return [];
    const mine = await this.workspaces.workspaceOf(userId);
    const out = mine ? [mine] : [];
    if (await this.orgOn()) {
      const r = await this.db.query("SELECT DISTINCT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND w.kind = 'business'", [userId]);
      for (const x of r.rows) out.push(Number(x.workspace_id));
    }
    return out;
  }

  // Project id to role for one person. Direct membership always applies, organization grants only with the switch on.
  async projectRoles(userId) {
    const map = new Map();
    for (const r of (await this.db.query('SELECT project_id, role FROM project_members WHERE user_id = $1', [userId])).rows) map.set(Number(r.project_id), r.role);
    if (this.workspaces.ready && await this.orgOn()) {
      const grants = (await this.db.query("SELECT m.role, m.scope_type, m.scope_id, m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND w.kind = 'business'", [userId])).rows;
      for (const g of grants) {
        const role = ROLE_ACCESS[g.role]; if (!role) continue;
        let sql = 'SELECT id FROM projects WHERE workspace_id = $1', p = [g.workspace_id];
        if (g.scope_type === 'project') { sql += ' AND id = $2'; p.push(g.scope_id); }
        else if (g.scope_type === 'program') { sql += ' AND parent_id = $2'; p.push(g.scope_id); }
        else if (g.scope_type === 'portfolio') { sql += ' AND parent_id IN (SELECT id FROM structure_nodes WHERE parent_id = $2 UNION SELECT $2)'; p.push(g.scope_id); }
        for (const x of (await this.db.query(sql, p)).rows) {
          const id = Number(x.id), cur = map.get(id);
          if (!cur || RANK[role] > RANK[cur]) map.set(id, role);
        }
      }
    }
    return map;
  }
  async roleOn(userId, projectId) { return (await this.projectRoles(userId)).get(Number(projectId)) || null; }
  async can(userId, projectId, need = 'viewer') { const r = await this.roleOn(userId, projectId); return !!r && RANK[r] >= RANK[need]; }
}

module.exports = { Scope, RANK, ROLE_ACCESS };
