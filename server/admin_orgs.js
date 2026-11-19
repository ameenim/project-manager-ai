// Super admin management of organizations: list, detail, members, billing, AI pool, projects, reports.
// The platform owner acts across every organization, so these routes never depend on an organization role. Every change is
// written to admin_audit (by the caller) and to the organization audit trail with via "platform owner".
'use strict';
const err = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v || 0);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };

module.exports = function adminOrgs({ db, store, ops, userRow }) {
  const q = (t, p) => db.query(t, p);
  const orgs = () => { if (!ops.orgs) throw err(503, 'Organizations are not available'); return ops.orgs; };
  const ready = () => !!(ops.orgs && ops.orgs.workspaces.ready);
  const idOf = (s) => { const n = Number(s); if (!Number.isSafeInteger(n) || n <= 0) throw err(400, 'Invalid id'); return n; };
  // The Orgs class checks the caller's organization role. For platform changes it acts as one of that organization's Admins,
  // the real actor is recorded in the audit trails.
  async function needOn() { if (!(await orgs().enabled())) throw err(400, 'Organizations are turned off for customers. Turn them on in Configuration first.'); }
  async function actorFor(wid) {
    const r = (await q("SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'admin' ORDER BY user_id LIMIT 1", [wid])).rows[0];
    if (!r) throw err(409, 'This organization has no Admin. Add one first.');
    return Number(r.user_id);
  }
  async function exists(wid) { await orgs().business(wid); }
  const trail = (wid, admin, action, meta) => orgs().audit(wid, admin.id, 'platform.' + action, { ...(meta || {}), via: 'platform owner' });

  async function row(w) {
    const id = Number(w.id);
    const one = async (sql) => num((await q(sql, [id])).rows[0].n);
    const b = (await q('SELECT plan_code, status, price_cents, currency, trial_end, period_end FROM billing_accounts WHERE workspace_id = $1', [id])).rows[0] || {};
    const pool = await orgs().pool(id);
    return {
      id, name: w.name, owner_id: w.owner_id, owner: w.owner_name || '', owner_email: w.owner_email || '', created_at: iso(w.created_at),
      plan: b.plan_code || 'team', billing_status: b.status || 'trial', price_cents: num(b.price_cents), currency: b.currency || 'USD', period_end: iso(b.period_end), trial_end: iso(b.trial_end),
      seats: await orgs().seatsBought(id), seats_used: await orgs().seatsUsed(id),
      members: await one('SELECT count(DISTINCT user_id) AS n FROM workspace_members WHERE workspace_id = $1'),
      programs: await one("SELECT count(*) AS n FROM structure_nodes WHERE workspace_id = $1 AND kind = 'program' AND status = 'active'"),
      portfolios: await one("SELECT count(*) AS n FROM structure_nodes WHERE workspace_id = $1 AND kind = 'portfolio' AND status = 'active'"),
      projects: await one('SELECT count(*) AS n FROM projects WHERE workspace_id = $1'),
      handovers: await one("SELECT count(*) AS n FROM project_handovers WHERE workspace_id = $1 AND status = 'open'"),
      units_used: pool ? pool.used : 0, units_total: pool ? pool.total : 0, blocked: pool ? pool.blocked : false,
    };
  }
  async function list(query, page, like) {
    if (!ready()) return { enabled: false, total: 0, page: 1, size: page.size, organizations: [], totals: {} };
    const params = []; const w = ["w.kind = 'business'"];
    if (query.q) { params.push(like(query.q)); w.push(`(w.name ILIKE $${params.length} OR o.email ILIKE $${params.length})`); }
    if (['team', 'business', 'enterprise'].includes(query.plan)) { params.push(query.plan); w.push(`COALESCE(b.plan_code, 'team') = $${params.length}`); }
    const base = `FROM workspaces w LEFT JOIN users o ON o.id = w.owner_id LEFT JOIN billing_accounts b ON b.workspace_id = w.id WHERE ${w.join(' AND ')}`;
    const total = num((await q(`SELECT count(*) AS n ${base}`, params)).rows[0].n);
    const rows = (await q(`SELECT w.id, w.name, w.owner_id, w.created_at, o.name AS owner_name, o.email AS owner_email ${base} ORDER BY w.id DESC LIMIT ${page.size} OFFSET ${page.offset}`, params)).rows;
    const out = []; for (const r of rows) out.push(await row(r));
    return { enabled: await orgs().enabled(), total, page: page.page, size: page.size, organizations: out, totals: await totals() };
  }
  async function totals() {
    const o = (await q("SELECT count(*) AS n FROM workspaces WHERE kind = 'business'")).rows[0];
    const m = (await q("SELECT count(DISTINCT m.user_id) AS n FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE w.kind = 'business'")).rows[0];
    const p = (await q("SELECT count(*) AS n FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.kind = 'business'")).rows[0];
    const bill = (await q("SELECT COALESCE(SUM(b.price_cents) FILTER (WHERE b.status = 'active'), 0) AS mrr, count(*) FILTER (WHERE b.status = 'active') AS paying, count(*) FILTER (WHERE b.status = 'trial') AS trial FROM billing_accounts b JOIN workspaces w ON w.id = b.workspace_id WHERE w.kind = 'business'")).rows[0];
    const seats = (await q("SELECT w.id FROM workspaces w WHERE w.kind = 'business'")).rows; let bought = 0, used = 0;
    for (const s of seats) { bought += await orgs().seatsBought(s.id); used += await orgs().seatsUsed(s.id); }
    const u = (await q("SELECT COALESCE(SUM(units), 0) AS n FROM token_ledger l JOIN workspaces w ON w.id = l.workspace_id WHERE w.kind = 'business' AND l.billable AND l.created_at >= now() - interval '30 days'")).rows[0];
    return { organizations: num(o.n), members: num(m.n), projects: num(p.n), mrr_cents: num(bill.mrr), paying: num(bill.paying), trial: num(bill.trial), seats_bought: bought, seats_used: used, units_30d: num(u.n) };
  }
  async function detail(wid) {
    await exists(wid);
    const w = (await q('SELECT w.id, w.name, w.owner_id, w.created_at, o.name AS owner_name, o.email AS owner_email FROM workspaces w LEFT JOIN users o ON o.id = w.owner_id WHERE w.id = $1', [wid])).rows[0];
    const org = await row(w);
    const members = (await q(`SELECT m.user_id, u.name, u.email, COALESCE(f.status, 'active') AS status, array_agg(DISTINCT m.role) AS roles, (SELECT n.name FROM workspace_members m2 JOIN structure_nodes n ON n.id = m2.scope_id WHERE m2.workspace_id = m.workspace_id AND m2.user_id = m.user_id AND m2.scope_type = 'program' LIMIT 1) AS program FROM workspace_members m JOIN users u ON u.id = m.user_id LEFT JOIN user_flags f ON f.user_id = u.id WHERE m.workspace_id = $1 GROUP BY m.workspace_id, m.user_id, u.name, u.email, f.status ORDER BY u.name`, [wid])).rows
      .map((r) => ({ user_id: Number(r.user_id), name: r.name, email: r.email, status: r.status, roles: r.roles, program: r.program || null, type: orgs().constructor.typeOf(false, [{ roles: r.roles.map((x) => ({ role: x })) }]) }));
    const invites = (await q("SELECT id, email, role, created_at FROM workspace_invites WHERE workspace_id = $1 AND status = 'pending' ORDER BY id", [wid])).rows.map((i) => ({ id: String(i.id), email: i.email, role: i.role, created_at: iso(i.created_at) }));
    const structure = (await q("SELECT id, kind, name, parent_id FROM structure_nodes WHERE workspace_id = $1 AND status = 'active' ORDER BY kind, name", [wid])).rows.map((r) => ({ id: Number(r.id), kind: r.kind, name: r.name, parent_id: r.parent_id ? Number(r.parent_id) : null }));
    const projects = (await q("SELECT p.id, p.data->'p'->>'name' AS name, p.owner_id, o.email AS owner_email, p.parent_id, (SELECT name FROM structure_nodes n WHERE n.id = p.parent_id) AS program, p.updated_at FROM projects p LEFT JOIN users o ON o.id = p.owner_id WHERE p.workspace_id = $1 ORDER BY p.id DESC LIMIT 200", [wid])).rows
      .map((r) => ({ id: Number(r.id), name: r.name || 'Untitled', owner_email: r.owner_email, program: r.program || null, updated_at: iso(r.updated_at) }));
    const handovers = (await q("SELECT h.id, h.project_id, f.name AS from_name, h.created_at, p.data->'p'->>'name' AS project_name FROM project_handovers h JOIN projects p ON p.id = h.project_id LEFT JOIN users f ON f.id = h.from_user_id WHERE h.workspace_id = $1 AND h.status = 'open' ORDER BY h.id", [wid])).rows
      .map((r) => ({ id: String(r.id), project_id: Number(r.project_id), project_name: r.project_name || 'Untitled', from_name: r.from_name || '', created_at: iso(r.created_at) }));
    const events = (await q('SELECT e.kind, e.amount_cents, e.currency, e.effective_at, e.meta FROM subscription_events e JOIN billing_accounts b ON b.id = e.billing_account_id WHERE b.workspace_id = $1 ORDER BY e.effective_at DESC LIMIT 20', [wid])).rows
      .map((e) => ({ kind: e.kind, amount_cents: num(e.amount_cents), currency: e.currency, at: iso(e.effective_at), meta: e.meta }));
    const audit = await auditRows({ wid, size: 30, offset: 0 });
    const scim = num((await q("SELECT count(*) AS n FROM scim_tokens WHERE workspace_id = $1 AND NOT revoked", [wid]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
    return { organization: org, pool: await orgs().pool(wid), by_member: await orgs().byMember(wid), ai_policy: await orgs().aiPolicy(wid), members, invites, structure, projects, handovers, events, audit: audit.entries, scim_tokens: scim };
  }
  async function auditRows({ wid, qtext, size, offset }, like) {
    const params = []; const w = [];
    if (wid) { params.push(wid); w.push(`a.workspace_id = $${params.length}`); }
    if (qtext) { params.push('%' + String(qtext).replace(/[%_\\]/g, (c) => '\\' + c) + '%'); w.push(`(a.action ILIKE $${params.length} OR wk.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const from = `FROM org_audit a LEFT JOIN workspaces wk ON wk.id = a.workspace_id LEFT JOIN users u ON u.id = a.actor_id ${where}`;
    const total = num((await q(`SELECT count(*) AS n ${from}`, params)).rows[0].n);
    const rows = (await q(`SELECT a.id, a.workspace_id, wk.name AS organization, a.actor_id, u.email AS actor, a.action, a.meta, a.ip, a.created_at ${from} ORDER BY a.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
    return { total, entries: rows.map((r) => ({ id: String(r.id), organization_id: Number(r.workspace_id), organization: r.organization || '', actor: r.actor || (r.meta && r.meta.via) || '', action: r.action, meta: r.meta, ip: r.ip, at: iso(r.created_at) })) };
  }
  async function usage(days) {
    const rows = (await q(`SELECT w.id, w.name, COALESCE(SUM(l.units) FILTER (WHERE l.billable), 0) AS units, COALESCE(SUM(l.input_tokens), 0) AS i, COALESCE(SUM(l.output_tokens), 0) AS o, COALESCE(SUM(l.cost_micros), 0) AS cost, count(l.id) AS calls FROM workspaces w LEFT JOIN token_ledger l ON l.workspace_id = w.id AND l.created_at >= now() - ($1 || ' days')::interval WHERE w.kind = 'business' GROUP BY w.id, w.name ORDER BY units DESC`, [String(days)])).rows;
    return rows.map((r) => ({ id: Number(r.id), name: r.name, units: num(r.units), input: num(r.i), output: num(r.o), cost_usd: num(r.cost) / 1e6, calls: num(r.calls) }));
  }
  async function financeBlock(from, to) {
    if (!ready()) return { mrr_cents: 0, events_cents: 0, active: 0, by_org: [] };
    const mrr = (await q("SELECT COALESCE(SUM(b.price_cents), 0) AS n, count(*) AS c FROM billing_accounts b JOIN workspaces w ON w.id = b.workspace_id WHERE w.kind = 'business' AND b.status = 'active'")).rows[0];
    const ev = (await q('SELECT w.id, w.name, COALESCE(SUM(e.amount_cents), 0) AS n FROM subscription_events e JOIN billing_accounts b ON b.id = e.billing_account_id JOIN workspaces w ON w.id = b.workspace_id WHERE e.effective_at >= $1 AND e.effective_at <= $2 GROUP BY w.id, w.name ORDER BY n DESC LIMIT 10', [from, to])).rows;
    return { mrr_cents: num(mrr.n), active: num(mrr.c), events_cents: ev.reduce((a, r) => a + num(r.n), 0), by_org: ev.map((r) => ({ id: Number(r.id), name: r.name, cents: num(r.n) })) };
  }

  function register({ on, audit, page, like }) {
    on('GET', '/orgs', async ({ query }) => list(query, page(query), like));
    on('GET', '/orgs/(\\d+)', async ({ m }) => detail(idOf(m[1])));
    on('POST', '/orgs', async ({ admin, body }) => {
      await needOn();
      const owner = await userRow(idOf(body.owner_id)); const name = String(body.name || '').trim();
      if (!name) throw err(400, 'Give the organization a name');
      const o = await orgs().create(owner.id, name);
      const wid = Number(o.id || o.workspace_id);
      if (body.seats) await orgs().setSeats(owner.id, wid, body.seats);
      await trail(wid, admin, 'create', { owner_id: owner.id });
      await audit(admin, 'org.create', `org:${wid}`, { name, owner_id: owner.id });
      return { id: wid };
    });
    on('PUT', '/orgs/(\\d+)', async ({ m, admin, body }) => {
      const wid = idOf(m[1]); await exists(wid); await needOn(); const actor = await actorFor(wid); const ch = {};
      if ('plan' in body) { await orgs().setPlan({ is_super: true, id: admin.id }, wid, body.plan); ch.plan = body.plan; }
      if ('name' in body) { await orgs().rename(actor, wid, body.name); ch.name = String(body.name).trim().slice(0, 80); }
      if ('seats' in body) { const r = await orgs().setSeats(actor, wid, body.seats); ch.seats = r.seats; }
      if ('overage_policy' in body) { await orgs().setOverage(actor, wid, body.overage_policy, body.overage_cap); ch.overage = body.overage_policy; }
      if ('ai_policy' in body) { await orgs().setAiPolicy(actor, wid, body.ai_policy); ch.ai_policy = body.ai_policy; }
      if ('units_purchased' in body) {
        const n = Math.max(0, Math.round(num(body.units_purchased)));
        await q('UPDATE token_wallets SET units_purchased = $2, updated_at = now() WHERE workspace_id = $1', [wid, n]); ch.units_purchased = n;
      }
      await trail(wid, admin, 'update', ch); await audit(admin, 'org.update', `org:${wid}`, ch);
      return detail(wid);
    });
    on('POST', '/orgs/(\\d+)/members', async ({ m, admin, body }) => {
      const wid = idOf(m[1]); await exists(wid); await needOn();
      const type = String(body.type || '');
      if (['individual', 'super_admin'].includes(type) || !orgs().constructor.TYPES.includes(type)) throw err(400, 'Choose an organization role');
      const u = body.user_id ? await userRow(idOf(body.user_id)) : (await q('SELECT id FROM users WHERE email = $1', [String(body.email || '').trim().toLowerCase()])).rows[0];
      if (!u) throw err(404, 'No account has this email. Create the user first in Users.');
      await orgs().setMemberRole(admin.id, wid, Number(u.id), type, body.program_id);
      await trail(wid, admin, 'member.add', { user_id: Number(u.id), type }); await audit(admin, 'org.member.add', `org:${wid}`, { user_id: Number(u.id), type });
      return detail(wid);
    });
    on('PUT', '/orgs/(\\d+)/members/(\\d+)', async ({ m, admin, body }) => {
      const wid = idOf(m[1]), uid = idOf(m[2]); await exists(wid); await needOn();
      if (!(await orgs().rolesIn(uid, wid)).length) throw err(404, 'That person is not in this organization');
      await orgs().setMemberRole(admin.id, wid, uid, String(body.type || ''), body.program_id);
      await trail(wid, admin, 'member.role', { user_id: uid, type: body.type }); await audit(admin, 'org.member.role', `org:${wid}`, { user_id: uid, type: body.type });
      return detail(wid);
    });
    on('DELETE', '/orgs/(\\d+)/members/(\\d+)', async ({ m, admin }) => {
      const wid = idOf(m[1]), uid = idOf(m[2]); await exists(wid); await needOn();
      const r = await orgs().remove(admin.id, wid, uid, { system: true });
      await trail(wid, admin, 'member.remove', { user_id: uid, ...r }); await audit(admin, 'org.member.remove', `org:${wid}`, { user_id: uid, ...r });
      return { ...(await detail(wid)), result: r };
    });
    on('DELETE', '/orgs/(\\d+)/invites/(\\d+)', async ({ m, admin }) => {
      const wid = idOf(m[1]); await exists(wid);
      await q("UPDATE workspace_invites SET status = 'revoked', decided_at = now() WHERE id = $1 AND workspace_id = $2 AND status = 'pending'", [idOf(m[2]), wid]);
      await trail(wid, admin, 'invite.revoke', { invite_id: m[2] }); await audit(admin, 'org.invite.revoke', `org:${wid}`, { invite_id: m[2] });
      return detail(wid);
    });
    on('POST', '/orgs/(\\d+)/handovers/(\\d+)/transfer', async ({ m, admin, body }) => {
      const wid = idOf(m[1]); await exists(wid); await needOn();
      const r = await orgs().transfer(await actorFor(wid), wid, m[2], idOf(body.to_user_id));
      await trail(wid, admin, 'handover.transfer', { project_id: r.project_id, to: Number(body.to_user_id) }); await audit(admin, 'org.handover', `org:${wid}`, { project_id: r.project_id, to: Number(body.to_user_id) });
      return detail(wid);
    });
    // Move a project into an organization, or out of it into its owner's personal workspace (organization_id 0).
    on('POST', '/projects/(\\d+)/organization', async ({ m, admin, body }) => {
      const pid = idOf(m[1]); const p = (await q('SELECT id, owner_id, workspace_id FROM projects WHERE id = $1', [pid])).rows[0]; if (!p) throw err(404, 'Project not found');
      let wid = num(body.organization_id);
      if (wid) { await exists(wid); await needOn(); }
      else { const pw = (await q("SELECT id FROM workspaces WHERE kind = 'personal' AND owner_id = $1", [p.owner_id])).rows[0]; wid = pw ? Number(pw.id) : null; }
      await q('UPDATE projects SET workspace_id = $2, parent_id = NULL WHERE id = $1', [pid, wid]);
      await q('UPDATE project_rollups SET workspace_id = $2, parent_id = NULL WHERE project_id = $1', [pid, wid]).catch(() => {});
      store.cache.delete(pid);
      if (num(body.organization_id)) await trail(wid, admin, 'project.move_in', { project_id: pid });
      if (p.workspace_id) await orgs().audit(p.workspace_id, admin.id, 'platform.project.move_out', { project_id: pid, via: 'platform owner' });
      await audit(admin, 'project.move', `project:${pid}`, { from: p.workspace_id ? Number(p.workspace_id) : null, to: wid });
      return { ok: true, organization_id: num(body.organization_id) };
    });
    // Delete an organization. Projects go back to their owners' personal workspaces, memberships and billing records are removed.
    on('DELETE', '/orgs/(\\d+)', async ({ m, admin, query }) => {
      const wid = idOf(m[1]); const w = await orgs().business(wid);
      if (String(query.confirm || '').trim().toLowerCase() !== String(w.name).trim().toLowerCase()) throw err(400, 'Type the organization name to confirm');
      const ps = (await q('SELECT id, owner_id FROM projects WHERE workspace_id = $1', [wid])).rows;
      await q('DELETE FROM project_handovers WHERE workspace_id = $1', [wid]);
      await q('UPDATE projects SET workspace_id = NULL, parent_id = NULL WHERE workspace_id = $1', [wid]);
      await q('UPDATE project_rollups SET workspace_id = NULL, parent_id = NULL WHERE workspace_id = $1', [wid]).catch(() => {});
      await q('DELETE FROM workspaces WHERE id = $1', [wid]);
      const W = orgs().workspaces;
      for (const owner of [...new Set(ps.map((p) => String(p.owner_id)))]) {
        W.byUser && W.byUser.delete(Number(owner));
        const pw = await W.ensurePersonal(Number(owner));
        const pid = pw && (pw.id || pw);
        if (pid) await q('UPDATE projects SET workspace_id = $2 WHERE owner_id = $1 AND workspace_id IS NULL', [Number(owner), Number(pid)]);
      }
      for (const p of ps) store.cache.delete(Number(p.id));
      await q('UPDATE token_ledger SET workspace_id = NULL WHERE workspace_id = $1', [wid]);
      await orgs().audit(wid, admin.id, 'platform.delete', { name: w.name, projects_returned: ps.length, via: 'platform owner' });
      await audit(admin, 'org.delete', `org:${wid}`, { name: w.name, projects_returned: ps.length });
      return { ok: true, projects_returned: ps.length };
    });
    on('GET', '/org-audit', async ({ query }) => { const p = page(query, 50); const r = await auditRows({ wid: query.organization_id ? idOf(query.organization_id) : 0, qtext: query.q, size: p.size, offset: p.offset }); return { total: r.total, page: p.page, size: p.size, entries: r.entries }; });
    on('GET', '/org-usage', async ({ query }) => ({ days: Math.min(365, Math.max(1, parseInt(query.days, 10) || 30)), organizations: await usage(Math.min(365, Math.max(1, parseInt(query.days, 10) || 30))) }));
  }

  // CSV reports. Returns { name, body } or null.
  async function csv(path) {
    let m;
    if (path === '/api/admin/orgs/export.csv') {
      const r = await list({}, { size: 10000, offset: 0, page: 1 }, (s) => s);
      const head = ['id', 'name', 'owner', 'owner_email', 'plan', 'billing_status', 'seats', 'seats_used', 'members', 'programs', 'portfolios', 'projects', 'units_used', 'units_total', 'price', 'created'];
      return { name: 'organizations.csv', rows: r.organizations.length, body: [head.join(',')].concat(r.organizations.map((o) => [o.id, o.name, o.owner, o.owner_email, o.plan, o.billing_status, o.seats, o.seats_used, o.members, o.programs, o.portfolios, o.projects, o.units_used, o.units_total, (o.price_cents / 100).toFixed(2), o.created_at].map(cell).join(','))).join('\n') };
    }
    if ((m = path.match(/^\/api\/admin\/orgs\/(\d+)\/members\.csv$/))) {
      const d = await detail(Number(m[1]));
      return { name: 'organization-members.csv', rows: d.members.length, body: ['name,email,type,program,status'].concat(d.members.map((x) => [x.name, x.email, x.type, x.program || '', x.status].map(cell).join(','))).join('\n') };
    }
    if (path === '/api/admin/org-usage/export.csv') {
      const rows = await usage(30);
      return { name: 'organization-ai-usage-30-days.csv', rows: rows.length, body: ['organization,ai_units,input_tokens,output_tokens,cost_usd,calls'].concat(rows.map((x) => [x.name, x.units, x.input, x.output, x.cost_usd.toFixed(4), x.calls].map(cell).join(','))).join('\n') };
    }
    return null;
  }
  return { register, csv, totals: async () => (ready() ? totals() : null), financeBlock, usage, ready };
};
