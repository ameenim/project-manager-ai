// A test organization for the platform owner. It gives one account (config testbed_email) every organization role at once,
// one separate test account for each role, and a "View as role" switch that signs the owner in as one of those accounts and back.
// The seed is idempotent and runs on every start, so it reaches production on Publish. Switching is limited to the owner.
'use strict';
const crypto = require('crypto');
const sec = require('./security');

const TB = 'pm_tb';
const ROLES = [
  { key: 'admin', type: 'admin', label: 'Organization Admin', slug: 'admin' },
  { key: 'pmo_director', type: 'pmo_director', label: 'PMO Director', slug: 'pmo' },
  { key: 'program_manager', type: 'program_manager', label: 'Program Manager', slug: 'program-manager' },
  { key: 'project_manager', type: 'project_manager', label: 'Project Manager', slug: 'project-manager' },
  { key: 'viewer', type: 'viewer', label: 'Viewer', slug: 'viewer' },
  { key: 'auditor', type: 'auditor', label: 'Auditor', slug: 'auditor' },
];
const ORG_NAME = 'Test Organization';

class Testbed {
  constructor({ db, store, auth, ops, orgs, workspaces, api }) { Object.assign(this, { db, store, auth, ops, orgs, workspaces, api }); }
  q(t, p) { return this.db.query(t, p); }
  async email() { try { return String((await this.ops.config()).testbed_email || '').trim().toLowerCase(); } catch (e) { return ''; } }
  static address(owner, slug) { const [l, d] = owner.split('@'); return `${l.split('+')[0]}+${slug}@${d}`; }
  async org(ownerId) {
    return (await this.q("SELECT id, settings FROM workspaces WHERE kind = 'business' AND owner_id = $1 AND settings ? 'testbed' ORDER BY id LIMIT 1", [ownerId])).rows[0] || null;
  }

  async seed() {
    const email = await this.email(); if (!email || !this.workspaces.ready) return null;
    const owner = (await this.q('SELECT id, name FROM users WHERE email = $1', [email])).rows[0]; if (!owner) return null;
    const oid = Number(owner.id), orgs = this.orgs;
    orgs.force = true;
    try {
      let row = await this.org(oid), fresh = false;
      if (!row) {
        const made = await orgs.create(oid, ORG_NAME); const wid0 = Number(made.id);
        await orgs.setSeats(oid, wid0, 15);
        await orgs.setPlan({ is_super: true, id: oid }, wid0, 'enterprise');
        // a test organization is free, it must not count in income
        await this.q('UPDATE billing_accounts SET price_cents = 0 WHERE workspace_id = $1', [wid0]);
        await this.q("UPDATE workspaces SET settings = settings || '{\"testbed\":{}}'::jsonb WHERE id = $1", [wid0]);
        row = await this.org(oid); fresh = true;
      }
      const wid = Number(row.id); const tb = ((typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings) || {}).testbed || {};
      const node = async (kind, name, parent) => {
        const f = (await this.q('SELECT id FROM structure_nodes WHERE workspace_id = $1 AND kind = $2 AND name = $3', [wid, kind, name])).rows[0];
        if (f) return Number(f.id);
        const id = this.store.nid(); await this.q('INSERT INTO structure_nodes(id, workspace_id, kind, parent_id, name) VALUES ($1,$2,$3,$4,$5)', [id, wid, kind, parent || null, name]); return id;
      };
      const portfolio = await node('portfolio', 'Test Portfolio', null);
      const program = await node('program', 'Test Program', portfolio);
      // the owner holds every role at once
      for (const [role, st, sid] of [['admin', 'organization', 0], ['project_manager', 'organization', 0], ['pmo_director', 'organization', 0], ['program_manager', 'program', program], ['viewer', 'organization', 0], ['auditor', 'organization', 0]]) {
        await this.q('INSERT INTO workspace_members(workspace_id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1,$2,$3,$4,$5,$2) ON CONFLICT DO NOTHING', [wid, oid, role, st, sid]);
      }
      // one account per role
      const users = { ...(tb.users || {}) };
      for (const r of ROLES) {
        const em = Testbed.address(email, r.slug);
        let u = (await this.q('SELECT id FROM users WHERE email = $1', [em])).rows[0];
        if (!u) { const made = await this.auth.register({ name: 'Test ' + r.label, email: em, password: crypto.randomBytes(24).toString('hex') }, { skipPolicy: true }); await this.auth.logout(made.token).catch(() => {}); u = { id: made.user.id }; await this.ops.ensureSubscription(u.id); }
        const uid = Number(u.id); users[r.key] = uid;
        if (!(await orgs.rolesIn(uid, wid)).length) await orgs.setMemberRole(oid, wid, uid, r.type, program);
      }
      // sample projects, owned by the test Project Manager. The first three sit in the test program.
      let samples = !!tb.samples;
      if (!samples && this.api && this.api.createSamples) {
        const ids = await this.api.createSamples(users.project_manager);
        for (let i = 0; i < ids.length; i++) {
          const par = i < 3 ? program : null;
          await this.q('UPDATE projects SET workspace_id = $2, parent_id = $3 WHERE id = $1', [ids[i], wid, par]);
          await this.q('UPDATE project_rollups SET workspace_id = $2, parent_id = $3 WHERE project_id = $1', [ids[i], wid, par]).catch(() => {});
          this.store.cache.delete(Number(ids[i]));
        }
        samples = true;
      }
      await this.q('UPDATE workspaces SET settings = settings || $2::jsonb WHERE id = $1', [wid, JSON.stringify({ testbed: { users, samples, program_id: program, portfolio_id: portfolio } })]);
      return { organization_id: wid, created: fresh };
    } finally { orgs.force = false; }
  }

  // Who may switch: the owner, or the owner's own session kept in a cookie while signed in as a test account.
  async actor(req, user, cred) {
    const email = await this.email(); if (!email) return null;
    if (user.email.toLowerCase() === email) return { ownerId: user.id, ownerToken: cred.token, as: null };
    const t = sec.parseCookies(req.headers.cookie)[TB]; if (!t) return null;
    const o = await this.auth.userForToken(t).catch(() => null);
    if (!o || o.email.toLowerCase() !== email) return null;
    const row = await this.org(o.id); const users = row ? (((typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings).testbed || {}).users || {}) : {};
    const as = Object.keys(users).find((k) => Number(users[k]) === Number(user.id));
    return as ? { ownerId: o.id, ownerToken: t, as } : null;
  }
  async state(req, user, cred) {
    const a = await this.actor(req, user, cred); if (!a) return { available: false };
    const row = await this.org(a.ownerId);
    return { available: !!row, active: a.as || 'owner', organization_id: row ? Number(row.id) : null, roles: ROLES.map((r) => ({ role: r.key, label: r.label })) };
  }

  async route(req, res, url, user, cred, c) {
    if (url.pathname === '/api/testbed' && req.method === 'GET') { c.json(res, 200, await this.state(req, user, cred)); return true; }
    if (url.pathname !== '/api/testbed/switch' || req.method !== 'POST') return false;
    const a = await this.actor(req, user, cred); if (!a) { c.json(res, 403, { error: 'The role switcher is not available for this account' }); return true; }
    let body = {}; try { body = JSON.parse((await c.readBody(req, 4096)).toString('utf8') || '{}'); } catch (e) { c.json(res, 400, { error: 'Invalid request' }); return true; }
    const want = String(body.role || ''); const row = await this.org(a.ownerId);
    const secs = await c.sessionSeconds(); let token;
    if (want === 'owner') {
      token = a.ownerToken;
    } else {
      const r = ROLES.find((x) => x.key === want); const users = row ? (((typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings).testbed || {}).users || {}) : {};
      if (!r || !users[r.key]) { c.json(res, 400, { error: 'Choose one of the listed roles' }); return true; }
      token = await this.auth.startSession(Number(users[r.key]));
    }
    // a test session is not kept once it is left behind, the owner session stays so the owner can return
    if (a.as) await this.auth.logout(cred.token).catch(() => {});
    const secure = sec.isSecure(req) || sec.isProduction();
    const tbCookie = want === 'owner' ? `${TB}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}` : `${TB}=${a.ownerToken}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(secs)}${secure ? '; Secure' : ''}`;
    const who = await this.auth.userForToken(token);
    c.json(res, 200, { ok: true, active: want, user: c.userView(who) }, { 'Set-Cookie': [...sec.sessionCookies(req, token, secs), tbCookie] });
    return true;
  }
}

module.exports = { Testbed, ROLES };
