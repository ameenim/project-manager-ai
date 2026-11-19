// Organizations (Team plan). An organization is a business workspace. This file converts a personal workspace, invites and
// manages members, keeps the pooled AI allowance, moves projects in, and handles a manager who leaves. Every method needs
// org_features on, and nothing here touches a personal workspace that stays personal.
'use strict';
const mailer = require('./mailer');

const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
const ROLES = ['admin', 'pmo_director', 'program_manager', 'project_manager', 'viewer', 'auditor'];
const FREE_ROLES = ['viewer', 'auditor']; // read only roles that use no seat
const PHASE1_ROLES = ['admin', 'project_manager', 'viewer'];
const INVITE_ROLES = ['admin', 'pmo_director', 'program_manager', 'project_manager', 'viewer', 'auditor'];
const DAY = 86400000;

class Orgs {
  constructor({ db, store, workspaces, scope, ops }) { this.db = db; this.store = store; this.workspaces = workspaces; this.scope = scope; this.ops = ops; }
  q(t, p) { return this.db.query(t, p); }
  async enabled() { return this.workspaces.ready && (await this.scope.orgOn()); }
  async need() { if (this.force) return; if (!(await this.enabled())) throw err(404, 'Not found'); }

  async rolesIn(userId, wid) { return (await this.q('SELECT DISTINCT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wid, userId])).rows.map((r) => r.role); }
  async requireRole(userId, wid, ...roles) {
    const have = await this.rolesIn(userId, wid);
    if (!have.some((r) => roles.includes(r))) throw err(403, 'You do not have permission to do this in this organization');
    return have;
  }
  async business(wid) {
    const w = (await this.q("SELECT id, name, owner_id, settings FROM workspaces WHERE id = $1 AND kind = 'business'", [Number(wid)])).rows[0];
    if (!w) throw err(404, 'Organization not found');
    return w;
  }

  // ---------- plan and pool ----------
  async plan() {
    const c = await this.ops.config();
    return { code: 'team', price_cents: Number(c.team_seat_price_cents), units_per_seat: Number(c.team_units_per_seat), period_days: 30 };
  }
  async seatsUsed(wid) { return Number((await this.q("SELECT count(DISTINCT user_id) AS n FROM workspace_members WHERE workspace_id = $1 AND role NOT IN ('viewer','auditor')", [wid])).rows[0].n); }
  async seatsBought(wid) { const w = await this.business(wid); return Number((w.settings || {}).seats) || 5; }
  async event(wid, kind, o = {}) {
    const b = (await this.q('SELECT id, currency FROM billing_accounts WHERE workspace_id = $1', [wid])).rows[0];
    if (!b) return;
    await this.q('INSERT INTO subscription_events(id, billing_account_id, kind, from_plan, to_plan, amount_cents, currency, effective_at, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)', [this.store.nid(), b.id, kind, o.from || '', o.to || '', Math.round(o.amount || 0), b.currency, JSON.stringify(o.meta || {})]);
  }
  // Unused part of a paid period, as a credit. Prorated by whole days, never negative.
  static credit(priceCents, periodEnd, now = Date.now(), periodDays = 30) {
    if (!periodEnd) return 0;
    const left = Math.max(0, Math.min(periodDays, Math.ceil((new Date(periodEnd).getTime() - now) / DAY)));
    return Math.round((Number(priceCents) * left) / periodDays);
  }
  async setWallet(wid) {
    const p = await this.plan(), seats = await this.seatsBought(wid);
    const start = new Date(), end = new Date(Date.now() + p.period_days * DAY);
    await this.q(`INSERT INTO token_wallets(workspace_id, period_start, period_end, units_included) VALUES ($1,$2,$3,$4)
      ON CONFLICT (workspace_id) DO UPDATE SET units_included = EXCLUDED.units_included, updated_at = now()`, [wid, start, end, seats * p.units_per_seat]);
    await this.q('UPDATE token_wallets SET period_start = COALESCE(period_start, $2), period_end = COALESCE(period_end, $3) WHERE workspace_id = $1', [wid, start, end]);
  }
  async pool(wid) {
    const w = (await this.q('SELECT * FROM token_wallets WHERE workspace_id = $1', [wid])).rows[0];
    if (!w) return null;
    const used = Number((await this.q('SELECT COALESCE(SUM(units), 0) AS n FROM token_ledger WHERE workspace_id = $1 AND billable AND created_at >= $2', [wid, w.period_start])).rows[0].n);
    const total = Number(w.units_included) + Number(w.units_purchased);
    const cap = w.overage_policy === 'capped' ? Number(w.overage_cap_units || 0) : 0;
    return { included: Number(w.units_included), purchased: Number(w.units_purchased), total, used, remaining: Math.max(0, total - used), policy: w.overage_policy, overage_cap: cap, blocked: used >= total + cap, period_start: w.period_start, period_end: w.period_end };
  }
  async byMember(wid) {
    const w = (await this.q('SELECT period_start FROM token_wallets WHERE workspace_id = $1', [wid])).rows[0];
    if (!w) return [];
    return (await this.q('SELECT l.user_id, u.name, COALESCE(SUM(l.units), 0) AS units FROM token_ledger l LEFT JOIN users u ON u.id = l.user_id WHERE l.workspace_id = $1 AND l.billable AND l.created_at >= $2 GROUP BY l.user_id, u.name ORDER BY units DESC', [wid, w.period_start])).rows
      .map((r) => ({ user_id: r.user_id, name: r.name, units: Number(r.units) }));
  }
  // The message that stops an AI call, or null. Used by ops.allowance for projects that belong to an organization.
  async poolBlock(wid, userId, enforce = true) {
    const ai = await this.aiPolicy(wid);
    if (!ai.enabled) return 'AI features are turned off for your organization.';
    if (userId && ai.member_cap_units > 0) {
      const w = (await this.q('SELECT period_start FROM token_wallets WHERE workspace_id = $1', [wid])).rows[0];
      if (w) {
        const used = Number((await this.q('SELECT COALESCE(SUM(units), 0) AS n FROM token_ledger WHERE workspace_id = $1 AND user_id = $2 AND billable AND created_at >= $3', [wid, userId, w.period_start])).rows[0].n);
        if (used >= ai.member_cap_units) return 'You have reached your personal AI limit for this period. Ask an organization admin to raise it.';
      }
    }
    if (!enforce) return null;
    const p = await this.pool(wid);
    return p && p.blocked ? 'Your organization has used all of its AI units for this period. Ask an organization admin to add units or wait for the next period.' : null;
  }
  async workspaceOfProject(projectId) {
    if (!projectId || !this.workspaces.ready) return null;
    const r = (await this.q("SELECT p.workspace_id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = $1 AND w.kind = 'business'", [Number(projectId)])).rows[0];
    return r ? Number(r.workspace_id) : null;
  }

  // ---------- plan, governance and audit (Enterprise) ----------
  async planCode(wid) { const r = (await this.q('SELECT plan_code FROM billing_accounts WHERE workspace_id = $1', [wid])).rows[0]; return r ? r.plan_code : 'team'; }
  async needEnterprise(wid) { if ((await this.planCode(wid)) !== 'enterprise') throw err(403, 'This control is part of the Enterprise plan'); }
  // Only the platform owner sets the plan until payments are connected.
  async setPlan(user, wid, plan) {
    await this.need();
    if (!user.is_super) throw err(403, 'Only the platform owner can change the plan');
    if (!['team', 'business', 'enterprise'].includes(plan)) throw err(400, 'Choose team, business or enterprise');
    await this.business(wid);
    const from = await this.planCode(wid);
    await this.q('UPDATE billing_accounts SET plan_code = $2 WHERE workspace_id = $1', [wid, plan]);
    await this.event(wid, 'plan_changed', { from, to: plan, meta: { by: user.id } });
    return { plan };
  }
  async aiPolicy(wid) {
    const w = await this.business(wid); const a = (w.settings || {}).ai || {};
    return { enabled: a.enabled !== false, member_cap_units: Number(a.member_cap_units) || 0 };
  }
  async setAiPolicy(userId, wid, body) {
    await this.need(); await this.requireRole(userId, wid, 'admin'); await this.needEnterprise(wid);
    const cap = Math.max(0, Math.round(Number(body && body.member_cap_units) || 0));
    const ai = { enabled: !(body && body.enabled === false), member_cap_units: cap };
    await this.q("UPDATE workspaces SET settings = settings || $2::jsonb WHERE id = $1", [wid, JSON.stringify({ ai })]);
    return ai;
  }
  static auditAction(method, path) {
    const t = [
      ['POST', /^\/api\/orgs$/, 'organization.created'], ['POST', /^\/api\/orgs\/convert$/, 'organization.converted'], ['POST', /^\/api\/orgs\/invites\/\d+\/accept$/, 'invitation.accepted'],
      ['PUT', /^\/api\/orgs\/\d+$/, 'organization.renamed'], ['PUT', /\/seats$/, 'seats.changed'], ['PUT', /\/overage$/, 'overage.changed'], ['PUT', /\/ai-policy$/, 'ai_policy.changed'], ['PUT', /\/plan$/, 'plan.changed'],
      ['POST', /\/invites$/, 'member.invited'], ['DELETE', /\/invites\/\d+$/, 'invitation.cancelled'], ['PUT', /\/members\/\d+$/, 'member.role_changed'], ['DELETE', /\/members\/\d+$/, 'member.removed'],
      ['POST', /\/members\/\d+\/grants$/, 'role.granted'], ['DELETE', /\/members\/\d+\/grants$/, 'role.revoked'],
      ['POST', /\/handovers\/\d+\/transfer$/, 'project.handed_over'], ['POST', /^\/api\/projects\/\d+\/move$/, 'project.moved_in'], ['PUT', /\/projects\/\d+\/program$/, 'project.placed'],
      ['POST', /\/programs$/, 'program.created'], ['PUT', /\/programs\/\d+$/, 'program.renamed'], ['DELETE', /\/programs\/\d+$/, 'program.closed'], ['PUT', /\/programs\/\d+\/portfolio$/, 'program.placed'],
      ['POST', /\/portfolios$/, 'portfolio.created'], ['PUT', /\/portfolios\/\d+$/, 'portfolio.renamed'], ['DELETE', /\/portfolios\/\d+$/, 'portfolio.closed'],
      ['POST', /\/scim-token$/, 'provisioning.token_created'], ['DELETE', /\/scim-token$/, 'provisioning.token_revoked'],
    ];
    const hit = t.find(([m, re]) => m === method && re.test(path));
    return hit ? hit[2] : null;
  }
  // Called by the API after any successful change under /api/orgs, so no change can be left out of the trail.
  async auditRoute(c, method, path, body, out) {
    const action = Orgs.auditAction(method, path); if (!action) return;
    const m = /^\/api\/orgs\/(\d+)/.exec(path);
    const wid = m ? Number(m[1]) : (out && (out.organization_id || out.id)) || (body && body.organization_id);
    if (!wid) return;
    const meta = {}; const b = body || {};
    for (const k of ['email', 'role', 'name', 'seats', 'policy', 'cap_units', 'program_id', 'portfolio_id', 'user_id', 'organization_id', 'enabled', 'member_cap_units', 'plan']) if (b[k] !== undefined) meta[k] = b[k];
    const ids = path.match(/\/(\d+)/g) || []; if (ids.length > 1) meta.target = Number(ids[ids.length - 1].slice(1));
    if (out && out.handover != null) { meta.handover = out.handover; meta.archived = out.archived; }
    await this.audit(wid, c.user && c.user.id, action, meta, c.ip);
  }
  async audit(wid, actorId, action, meta, ip) {
    try { await this.q('INSERT INTO org_audit(id, workspace_id, actor_id, action, meta, ip) VALUES ($1,$2,$3,$4,$5,$6)', [this.store.nid(), Number(wid), actorId || null, action, JSON.stringify(meta || {}), ip || '']); }
    catch (e) { console.error('audit', e.message); }
  }
  async auditList(userId, wid, { before, limit, action } = {}) {
    await this.need(); await this.requireRole(userId, wid, 'admin', 'auditor'); await this.needEnterprise(wid);
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = (await this.q(`SELECT a.id, a.actor_id, u.name AS actor, a.action, a.meta, a.ip, a.created_at FROM org_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.workspace_id = $1 AND ($2::bigint IS NULL OR a.id < $2) AND ($3::text IS NULL OR a.action = $3) ORDER BY a.id DESC LIMIT ${lim}`, [wid, before ? Number(before) : null, action || null])).rows;
    return rows.map((r) => ({ id: String(r.id), actor_id: r.actor_id, actor: r.actor || (r.meta && r.meta.via) || '', action: r.action, meta: r.meta, ip: r.ip, created_at: r.created_at }));
  }
  async auditCsv(userId, wid) {
    const rows = await this.auditList(userId, wid, { limit: 500 });
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    return ['time,actor,action,details,ip'].concat(rows.map((r) => [new Date(r.created_at).toISOString(), r.actor, r.action, JSON.stringify(r.meta || {}), r.ip].map(cell).join(','))).join('\n');
  }

  // ---------- platform owner: user types ----------
  static get TYPES() { return ['individual', 'super_admin', 'admin', 'pmo_director', 'program_manager', 'project_manager', 'viewer', 'auditor']; }
  async lookup() {
    if (!(await this.enabled())) return { enabled: false, organizations: [] };
    const rows = (await this.q("SELECT id, name FROM workspaces WHERE kind = 'business' ORDER BY name")).rows;
    const out = [];
    for (const w of rows) {
      const progs = (await this.q("SELECT id, name FROM structure_nodes WHERE workspace_id = $1 AND kind = 'program' AND status = 'active' ORDER BY name", [w.id])).rows;
      out.push({ id: Number(w.id), name: w.name, plan: await this.planCode(w.id), seats: await this.seatsBought(w.id), seats_used: await this.seatsUsed(w.id), programs: progs.map((p) => ({ id: Number(p.id), name: p.name })) });
    }
    return { enabled: true, organizations: out };
  }
  // Roles a person holds in every organization, for the platform console.
  async membershipsOf(userId) {
    if (!this.workspaces.ready) return [];
    try {
      const rows = (await this.q("SELECT w.id, w.name, m.role, m.scope_type, m.scope_id, (SELECT name FROM structure_nodes n WHERE n.id = m.scope_id AND m.scope_type = 'program') AS program FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND w.kind = 'business' ORDER BY w.name, m.role", [userId])).rows;
      const by = new Map();
      for (const r of rows) { const e = by.get(String(r.id)) || { organization_id: Number(r.id), name: r.name, roles: [] }; e.roles.push({ role: r.role, scope_type: r.scope_type, program: r.program || null }); by.set(String(r.id), e); }
      return [...by.values()];
    } catch (e) { return []; }
  }
  static typeOf(isSuper, memberships) {
    if (isSuper) return 'super_admin';
    const order = ['admin', 'pmo_director', 'program_manager', 'project_manager', 'auditor', 'viewer'];
    const have = memberships.flatMap((m) => m.roles.map((r) => r.role));
    return order.find((r) => have.includes(r)) || 'individual';
  }
  // Check that a person of this type can be placed in the organization, before anything is created or changed.
  async assertPlaceable(userId, type, wid, programId) {
    await this.need();
    if (!wid) throw err(400, 'Choose an organization');
    const w = await this.business(wid);
    if (type === 'program_manager') {
      const p = (await this.q("SELECT id FROM structure_nodes WHERE id = $1 AND workspace_id = $2 AND kind = 'program' AND status = 'active'", [Number(programId) || 0, wid])).rows[0];
      if (!p) throw err(400, 'Choose a program of this organization');
    }
    if (type === 'auditor') await this.needEnterprise(wid);
    const have = userId ? await this.rolesIn(userId, wid) : [];
    if (!FREE_ROLES.includes(type) && have.every((r) => FREE_ROLES.includes(r)) && (await this.seatsUsed(wid)) >= (await this.seatsBought(wid))) throw err(409, `All seats of ${w.name} are in use. Raise the seats in the organization first.`);
    if (have.includes('admin') && type !== 'admin' && (await this.admins(wid)) <= 1) throw err(409, `${w.name} needs at least one Admin`);
  }
  async setMemberRole(actorId, wid, userId, type, programId) {
    await this.assertPlaceable(userId, type, wid, programId);
    await this.q('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wid, userId]);
    const rows = type === 'admin' ? [['admin', 'organization', 0], ['project_manager', 'organization', 0]] : [[type, type === 'program_manager' ? 'program' : 'organization', type === 'program_manager' ? Number(programId) : 0]];
    for (const [role, st, sid] of rows) await this.q('INSERT INTO workspace_members(workspace_id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1,$2,$3,$4,$5,$6)', [wid, userId, role, st, sid, actorId]);
    await this.audit(wid, actorId, 'member.type_set', { user_id: userId, type, via: 'platform owner' });
  }
  // Take a person out of every organization. Active projects they managed go to each handover queue.
  async leaveAll(actorId, userId) {
    if (!this.workspaces.ready) return { handover: 0, archived: 0, organizations: 0 };
    const orgs = (await this.q("SELECT DISTINCT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND w.kind = 'business'", [userId])).rows;
    const out = { handover: 0, archived: 0, organizations: 0 };
    for (const o of orgs) {
      if ((await this.rolesIn(userId, o.workspace_id)).includes('admin') && (await this.admins(o.workspace_id)) <= 1) { const w = await this.business(o.workspace_id); throw err(409, `${w.name} needs at least one Admin. Make someone else Admin first.`); }
    }
    for (const o of orgs) { const r = await this.remove(actorId, o.workspace_id, userId, { system: true }); out.handover += r.handover; out.archived += r.archived; out.organizations++; await this.audit(o.workspace_id, actorId, 'member.removed', { user_id: userId, via: 'platform owner' }); }
    return out;
  }
  // Organization projects owned by a person who is being deleted pass to the organization owner or another Admin.
  async reassignOwned(userId) {
    if (!this.workspaces.ready) return;
    const rows = (await this.q("SELECT p.id, p.workspace_id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.owner_id = $1 AND w.kind = 'business'", [userId])).rows;
    for (const r of rows) {
      const to = (await this.q("SELECT COALESCE((SELECT owner_id FROM workspaces WHERE id = $1 AND owner_id <> $2), (SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'admin' AND user_id <> $2 LIMIT 1)) AS u", [r.workspace_id, userId])).rows[0];
      if (!to || !to.u) throw err(409, 'An organization project is owned by this person and the organization has nobody else to own it');
      await this.q('UPDATE projects SET owner_id = $2 WHERE id = $1', [r.id, to.u]); this.store.cache.delete(Number(r.id));
    }
  }

  // ---------- organizations ----------
  async list(userId) {
    await this.need();
    const rows = (await this.q(`SELECT w.id, w.kind, w.name, w.owner_id, array_agg(DISTINCT m.role) AS roles FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 GROUP BY w.id ORDER BY (w.kind = 'personal') DESC, w.id`, [userId])).rows;
    return rows.map((r) => ({ id: Number(r.id), kind: r.kind, name: r.name, roles: r.roles, personal: r.kind === 'personal' }));
  }
  async create(userId, name) {
    await this.need();
    const nm = String(name || '').trim().slice(0, 80); if (!nm) throw err(400, 'Give the organization a name');
    const id = this.store.nid();
    await this.q("INSERT INTO workspaces(id, kind, name, owner_id, settings) VALUES ($1, 'business', $2, $3, $4)", [id, nm, userId, JSON.stringify({ seats: 5, allow_personal: true })]);
    await this.q("INSERT INTO workspace_members(workspace_id, user_id, role, granted_by) VALUES ($1, $2, 'admin', $2), ($1, $2, 'project_manager', $2)", [id, userId]);
    const p = await this.plan(), c = (await this.ops.config()).currency || 'USD';
    await this.q("INSERT INTO billing_accounts(id, workspace_id, plan_code, status, currency, price_cents, period_start, period_end) VALUES ($1,$2,'team','active',$3,$4, now(), now() + interval '30 days')", [this.store.nid(), id, c, p.price_cents * 5]);
    await this.event(id, 'created', { to: 'team', amount: p.price_cents * 5 });
    await this.setWallet(id);
    return { id };
  }
  // Convert my workspace: the personal workspace becomes the organization, nothing moves, the person becomes Admin and Project Manager.
  async convert(userId, name) {
    await this.need();
    const wid = await this.workspaces.workspaceOf(userId);
    const w = (await this.q("SELECT id, name FROM workspaces WHERE id = $1 AND kind = 'personal' AND owner_id = $2", [wid, userId])).rows[0];
    if (!w) throw err(409, 'There is no personal workspace to convert');
    const nm = String(name || w.name || '').trim().slice(0, 80) || w.name;
    const b = (await this.q('SELECT price_cents, plan_code, period_end FROM billing_accounts WHERE workspace_id = $1', [wid])).rows[0];
    const credit = b ? Orgs.credit(b.price_cents, b.period_end) : 0;
    const p = await this.plan(), c = (await this.ops.config()).currency || 'USD';
    await this.db.tx(async (t) => {
      await t.query("UPDATE workspaces SET kind = 'business', name = $2, settings = $3 WHERE id = $1", [wid, nm, JSON.stringify({ seats: 5, allow_personal: true, converted_from: 'personal' })]);
      await t.query("INSERT INTO workspace_members(workspace_id, user_id, role, granted_by) VALUES ($1, $2, 'admin', $2) ON CONFLICT DO NOTHING", [wid, userId]);
      if (b) await t.query("UPDATE billing_accounts SET plan_code = 'team', currency = $2, price_cents = $3, period_start = now(), period_end = now() + interval '30 days', status = 'active' WHERE workspace_id = $1", [wid, c, p.price_cents * 5]);
    });
    this.workspaces.byUser.delete(userId);
    await this.event(wid, 'converted', { from: b && b.plan_code, to: 'team', amount: -credit, meta: { credit_cents: credit, note: 'Unused days of the personal plan, applied to the first Team invoice' } });
    await this.setWallet(wid);
    await this.workspaces.ensurePersonalBare(userId); // a new, empty personal workspace for the person
    return { id: Number(wid), credit_cents: credit };
  }
  async rename(userId, wid, name) {
    await this.need(); await this.requireRole(userId, wid, 'admin');
    const nm = String(name || '').trim().slice(0, 80); if (!nm) throw err(400, 'Give the organization a name');
    await this.q('UPDATE workspaces SET name = $2 WHERE id = $1', [wid, nm]);
  }
  async setSeats(userId, wid, seats) {
    await this.need(); await this.requireRole(userId, wid, 'admin');
    const n = Math.round(Number(seats)); if (!(n >= 1 && n <= 10000)) throw err(400, 'Choose a number of seats between 1 and 10000');
    const used = await this.seatsUsed(wid); if (n < used) throw err(409, `${used} seats are in use. Remove members first or choose at least ${used}.`);
    const w = await this.business(wid), before = Number((w.settings || {}).seats) || 5;
    await this.q("UPDATE workspaces SET settings = settings || $2::jsonb WHERE id = $1", [wid, JSON.stringify({ seats: n })]);
    const b = (await this.q('SELECT period_end FROM billing_accounts WHERE workspace_id = $1', [wid])).rows[0];
    const p = await this.plan();
    const amount = Orgs.credit(p.price_cents * (n - before), b && b.period_end); // prorated charge (positive) or credit (negative) for the days left
    await this.event(wid, 'seats_changed', { from: 'team', to: 'team', amount, meta: { from_seats: before, to_seats: n } });
    await this.q('UPDATE billing_accounts SET price_cents = $2 WHERE workspace_id = $1', [wid, p.price_cents * n]);
    await this.setWallet(wid);
    return { seats: n, prorated_cents: amount };
  }
  async overview(userId, wid) {
    await this.need(); await this.requireRole(userId, wid, 'admin', 'project_manager', 'viewer', 'pmo_director', 'program_manager', 'auditor');
    const w = await this.business(wid), roles = await this.rolesIn(userId, wid);
    const out = { id: Number(w.id), name: w.name, plan: await this.planCode(wid), roles, seats: await this.seatsBought(wid), seats_used: await this.seatsUsed(wid), pool: await this.pool(wid) };
    if (roles.includes('admin')) { out.by_member = await this.byMember(wid); out.events = (await this.q('SELECT e.kind, e.amount_cents, e.currency, e.effective_at, e.meta FROM subscription_events e JOIN billing_accounts b ON b.id = e.billing_account_id WHERE b.workspace_id = $1 ORDER BY e.effective_at DESC, e.id DESC LIMIT 50', [wid])).rows; }
    return out;
  }
  async setOverage(userId, wid, policy, cap) {
    await this.need(); await this.requireRole(userId, wid, 'admin');
    if (!['stop', 'capped'].includes(policy)) throw err(400, 'Choose stop or capped');
    await this.q('UPDATE token_wallets SET overage_policy = $2, overage_cap_units = $3, updated_at = now() WHERE workspace_id = $1', [wid, policy, policy === 'capped' ? Math.max(0, Math.round(Number(cap) || 0)) : 0]);
    return this.pool(wid);
  }

  // ---------- members and invitations ----------
  async members(userId, wid) {
    await this.need(); await this.requireRole(userId, wid, ...ROLES);
    const rows = (await this.q('SELECT m.user_id, u.name, u.email, array_agg(DISTINCT m.role) AS roles FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 GROUP BY m.user_id, u.name, u.email ORDER BY u.name', [wid])).rows;
    const invites = (await this.rolesIn(userId, wid)).includes('admin') ? (await this.q("SELECT id, email, role, created_at FROM workspace_invites WHERE workspace_id = $1 AND status = 'pending' ORDER BY id", [wid])).rows : [];
    return { members: rows.map((r) => ({ user_id: Number(r.user_id), name: r.name, email: r.email, roles: r.roles })), invites: invites.map((i) => ({ id: String(i.id), email: i.email, role: i.role, created_at: i.created_at })) };
  }
  async invite(userId, wid, email, role, programId, portfolioId) {
    await this.need(); await this.requireRole(userId, wid, 'admin');
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw err(400, 'Enter a valid email address');
    if (!INVITE_ROLES.includes(role)) throw err(400, 'Choose a role');
    let scopeType = 'organization', scopeId = 0;
    if (role === 'viewer' && portfolioId) {
      const f = (await this.q("SELECT id FROM structure_nodes WHERE id = $1 AND workspace_id = $2 AND kind = 'portfolio' AND status = 'active'", [Number(portfolioId) || 0, wid])).rows[0];
      if (!f) throw err(400, 'Choose a portfolio of this organization');
      scopeType = 'portfolio'; scopeId = Number(f.id);
    } else if (role === 'program_manager' || (role === 'viewer' && programId)) {
      const pr = (await this.q("SELECT id FROM structure_nodes WHERE id = $1 AND workspace_id = $2 AND kind = 'program' AND status = 'active'", [Number(programId) || 0, wid])).rows[0];
      if (!pr) throw err(400, 'Choose a program of this organization');
      scopeType = 'program'; scopeId = Number(pr.id);
    }
    const exists = (await this.q('SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = $2 LIMIT 1', [wid, e])).rows.length;
    if (exists) throw err(409, 'That person is already in this organization');
    if ((await this.q("SELECT 1 FROM workspace_invites WHERE workspace_id = $1 AND email = $2 AND status = 'pending'", [wid, e])).rows.length) throw err(409, 'That person already has an open invitation');
    if (role === 'auditor') await this.needEnterprise(wid);
    if (!FREE_ROLES.includes(role)) {
      const pending = Number((await this.q("SELECT count(*) AS n FROM workspace_invites WHERE workspace_id = $1 AND status = 'pending' AND role NOT IN ('viewer','auditor')", [wid])).rows[0].n);
      if ((await this.seatsUsed(wid)) + pending >= (await this.seatsBought(wid))) throw err(409, 'All seats are in use. Add seats before inviting another member.');
    }
    const id = this.store.nid();
    await this.q('INSERT INTO workspace_invites(id, workspace_id, email, role, invited_by, scope_type, scope_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, wid, e, role, userId, scopeType, scopeId]);
    const w = await this.business(wid);
    try { await mailer.send({ to: e, subject: `You are invited to ${w.name} on Project Manager AI`, text: `You have been invited to join ${w.name} as ${role.replace('_', ' ')}. Sign in with this email address and accept the invitation from the organization switcher.` }); } catch (x) { /* the invitation stays valid when the mail cannot be sent */ }
    return { id: String(id) };
  }
  async myInvites(userId) {
    await this.need();
    const u = (await this.q('SELECT email FROM users WHERE id = $1', [userId])).rows[0]; if (!u) return [];
    return (await this.q("SELECT i.id, i.role, w.name AS organization FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.email = $1 AND i.status = 'pending' ORDER BY i.id", [u.email.toLowerCase()])).rows.map((r) => ({ id: String(r.id), role: r.role, organization: r.organization }));
  }
  async accept(userId, inviteId) {
    await this.need();
    const u = (await this.q('SELECT email FROM users WHERE id = $1', [userId])).rows[0];
    const i = (await this.q("SELECT * FROM workspace_invites WHERE id = $1 AND status = 'pending'", [inviteId])).rows[0];
    if (!i || !u || i.email !== u.email.toLowerCase()) throw err(404, 'Invitation not found');
    await this.q('INSERT INTO workspace_members(workspace_id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [i.workspace_id, userId, i.role, i.scope_type, i.scope_id, i.invited_by]);
    if (i.role === 'admin') await this.q("INSERT INTO workspace_members(workspace_id, user_id, role, granted_by) VALUES ($1,$2,'project_manager',$3) ON CONFLICT DO NOTHING", [i.workspace_id, userId, i.invited_by]);
    await this.q("UPDATE workspace_invites SET status = 'accepted', decided_at = now() WHERE id = $1", [inviteId]);
    await this.workspaces.ensurePersonal(userId);
    return { organization_id: Number(i.workspace_id) };
  }
  async revoke(userId, wid, inviteId) {
    await this.need(); await this.requireRole(userId, wid, 'admin');
    await this.q("UPDATE workspace_invites SET status = 'revoked', decided_at = now() WHERE id = $1 AND workspace_id = $2 AND status = 'pending'", [inviteId, wid]);
  }
  async admins(wid) { return Number((await this.q("SELECT count(DISTINCT user_id) AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'admin'", [wid])).rows[0].n); }
  async changeRole(userId, wid, target, role) {
    await this.need(); await this.requireRole(userId, wid, 'admin');
    if (!PHASE1_ROLES.includes(role)) throw err(400, 'Choose Admin, Project Manager or Viewer');
    const have = await this.rolesIn(target, wid); if (!have.length) throw err(404, 'That person is not in this organization');
    if (have.includes('admin') && role !== 'admin' && (await this.admins(wid)) <= 1) throw err(409, 'An organization needs at least one Admin');
    const seatChange = !FREE_ROLES.includes(role) && !have.some((r) => !FREE_ROLES.includes(r));
    if (seatChange && (await this.seatsUsed(wid)) >= (await this.seatsBought(wid))) throw err(409, 'All seats are in use. Add seats first.');
    await this.q("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role IN ('admin','project_manager','viewer')", [wid, target]);
    const rows = role === 'admin' ? ['admin', 'project_manager'] : [role];
    for (const r of rows) await this.q('INSERT INTO workspace_members(workspace_id, user_id, role, granted_by) VALUES ($1,$2,$3,$4)', [wid, target, r, userId]);
  }
  // Remove a member, or let a member leave. Their access ends. Active projects they managed go to the handover queue,
  // every other project they managed is archived and stays reachable through the organization roles.
  async remove(actorId, wid, target, opts = {}) {
    await this.need();
    if (opts.system) { /* provisioning from the identity provider */ } else if (actorId !== target) await this.requireRole(actorId, wid, 'admin'); else await this.requireRole(actorId, wid, ...ROLES);
    const have = await this.rolesIn(target, wid); if (!have.length) throw err(404, 'That person is not in this organization');
    if (have.includes('admin') && (await this.admins(wid)) <= 1) throw err(409, 'An organization needs at least one Admin');
    const owned = (await this.q("SELECT p.id, p.data->'p'->>'status' AS status FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 AND m.role = 'manager' WHERE p.workspace_id = $1", [wid, target])).rows;
    const out = { handover: 0, archived: 0 };
    for (const p of owned) {
      const alone = Number((await this.q("SELECT count(*) AS n FROM project_members WHERE project_id = $1 AND role = 'manager' AND user_id <> $2", [p.id, target])).rows[0].n) === 0;
      if (!alone) continue; // another manager remains, nothing to hand over
      if (p.status === 'active' || p.status == null) {
        await this.q('INSERT INTO project_handovers(id, workspace_id, project_id, from_user_id) VALUES ($1,$2,$3,$4)', [this.store.nid(), wid, p.id, target]); out.handover++;
      } else {
        await this.q("UPDATE projects SET data = jsonb_set(data, '{p,archived}', 'true'::jsonb), version = version + 1 WHERE id = $1", [p.id]); this.store.cache.delete(Number(p.id)); out.archived++;
      }
    }
    await this.q('DELETE FROM project_members WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE workspace_id = $1)', [wid, target]);
    await this.q('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wid, target]);
    return out;
  }

  // ---------- handover queue ----------
  async queue(userId, wid) {
    await this.need(); await this.requireRole(userId, wid, 'admin', 'pmo_director', 'program_manager');
    return (await this.q(`SELECT h.id, h.project_id, h.from_user_id, f.name AS from_name, h.created_at, p.data->'p'->>'name' AS project_name FROM project_handovers h JOIN projects p ON p.id = h.project_id LEFT JOIN users f ON f.id = h.from_user_id WHERE h.workspace_id = $1 AND h.status = 'open' ORDER BY h.id`, [wid])).rows
      .map((r) => ({ id: String(r.id), project_id: Number(r.project_id), project_name: r.project_name, from_user_id: r.from_user_id, from_name: r.from_name, created_at: r.created_at }));
  }
  async transfer(userId, wid, handoverId, toUser) {
    await this.need(); await this.requireRole(userId, wid, 'admin', 'pmo_director', 'program_manager');
    const h = (await this.q("SELECT * FROM project_handovers WHERE id = $1 AND workspace_id = $2 AND status = 'open'", [handoverId, wid])).rows[0];
    if (!h) throw err(404, 'Handover not found');
    const ok = (await this.q("SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'project_manager'", [wid, Number(toUser)])).rows.length;
    if (!ok) throw err(400, 'Choose an active Project Manager of this organization');
    await this.q("INSERT INTO project_members(project_id, user_id, role) VALUES ($1,$2,'manager') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'manager'", [h.project_id, Number(toUser)]);
    await this.q("UPDATE project_handovers SET status = 'done', to_user_id = $2, done_at = now(), done_by = $3 WHERE id = $1", [handoverId, Number(toUser), userId]);
    const to = (await this.q('SELECT name, email FROM users WHERE id = $1', [Number(toUser)])).rows[0];
    try { if (to) await mailer.send({ to: to.email, subject: 'A project was handed over to you', text: 'A project in your organization was handed over to you. It keeps its full history, risks, payments and meetings.' }); } catch (x) { /* best effort */ }
    return { project_id: Number(h.project_id) };
  }

  // ---------- projects ----------
  // Move a project into an organization. The person must manage the project and be an Admin or Project Manager there.
  async moveProject(userId, projectId, wid) {
    await this.need(); await this.requireRole(userId, wid, 'admin', 'project_manager');
    const role = await this.store.roleOf(Number(projectId), userId);
    if (role !== 'manager') throw err(403, 'Only a project manager of this project can move it');
    await this.q('UPDATE projects SET workspace_id = $2, parent_id = NULL WHERE id = $1', [Number(projectId), wid]);
    await this.q('UPDATE project_rollups SET workspace_id = $2, parent_id = NULL WHERE project_id = $1', [Number(projectId), wid]).catch(() => {});
    return { project_id: Number(projectId), organization_id: Number(wid) };
  }
}

module.exports = { Orgs, FREE_ROLES, ROLES, PHASE1_ROLES, INVITE_ROLES };
