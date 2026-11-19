// Provisioning from an identity provider (SCIM 2.0, users only). An Admin creates a token for the organization, the
// provider calls /scim/v2/Users with it. Creating a user adds them as a Project Manager, deactivating or deleting a user
// removes them the same way an Admin would: access ends, active projects go to the handover queue.
'use strict';
const crypto = require('crypto');
const { FREE_ROLES } = require('./orgs');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const ERR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

class Scim {
  constructor({ db, store, orgs, auth }) { this.db = db; this.store = store; this.orgs = orgs; this.auth = auth; }
  q(t, p) { return this.db.query(t, p); }

  async tokenInfo(userId, wid) {
    await this.orgs.need(); await this.orgs.requireRole(userId, wid, 'admin'); await this.orgs.needEnterprise(wid);
    const r = (await this.q('SELECT created_at, last_used FROM scim_tokens WHERE workspace_id = $1 AND NOT revoked ORDER BY id DESC LIMIT 1', [wid])).rows[0];
    return { active: !!r, created_at: r ? r.created_at : null, last_used: r ? r.last_used : null };
  }
  // The token is shown once and stored only as a hash. A new token replaces the old one.
  async createToken(userId, wid) {
    await this.orgs.need(); await this.orgs.requireRole(userId, wid, 'admin'); await this.orgs.needEnterprise(wid);
    const token = 'pmscim_' + crypto.randomBytes(24).toString('hex');
    await this.q('UPDATE scim_tokens SET revoked = true WHERE workspace_id = $1', [wid]);
    await this.q('INSERT INTO scim_tokens(id, workspace_id, token_hash, created_by) VALUES ($1,$2,$3,$4)', [this.store.nid(), wid, sha(token), userId]);
    return { token };
  }
  async revokeToken(userId, wid) {
    await this.orgs.need(); await this.orgs.requireRole(userId, wid, 'admin');
    await this.q('UPDATE scim_tokens SET revoked = true WHERE workspace_id = $1', [wid]);
  }
  async workspaceForToken(header) {
    const m = /^Bearer\s+(\S+)$/.exec(String(header || '')); if (!m) return null;
    const r = (await this.q('SELECT id, workspace_id FROM scim_tokens WHERE token_hash = $1 AND NOT revoked', [sha(m[1])])).rows[0];
    if (!r) return null;
    if (!(await this.orgs.enabled()) || (await this.orgs.planCode(r.workspace_id)) !== 'enterprise') return null;
    this.q('UPDATE scim_tokens SET last_used = now() WHERE id = $1', [r.id]).catch(() => {});
    return Number(r.workspace_id);
  }

  resource(u, active = true) {
    return { schemas: [SCHEMA], id: String(u.id), userName: u.email, name: { formatted: u.name }, displayName: u.name, emails: [{ value: u.email, primary: true }], active, meta: { resourceType: 'User' } };
  }
  async member(wid, id) {
    return (await this.q('SELECT u.id, u.name, u.email FROM users u JOIN workspace_members m ON m.user_id = u.id WHERE m.workspace_id = $1 AND u.id = $2 LIMIT 1', [wid, Number(id) || 0])).rows[0] || null;
  }
  async add(wid, u) {
    if ((await this.orgs.rolesIn(u.id, wid)).length) return;
    if ((await this.orgs.seatsUsed(wid)) >= (await this.orgs.seatsBought(wid))) { const e = new Error('All seats are in use'); e.status = 409; e.scim = 'tooMany'; throw e; }
    await this.q("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,'project_manager') ON CONFLICT DO NOTHING", [wid, u.id]);
  }

  // Returns true when the request was a SCIM request and has been answered.
  async handle(req, res, url, deps) {
    const { json, readBody } = deps;
    const p = url.pathname;
    if (!p.startsWith('/scim/v2/')) return false;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/scim+json; charset=utf-8', 'Cache-Control': 'no-store', ...deps.SECURITY }); res.end(JSON.stringify(body)); };
    const fail = (status, detail, scimType) => send(status, { schemas: [ERR], status: String(status), detail, ...(scimType ? { scimType } : {}) });
    try {
      const wid = await this.workspaceForToken(req.headers.authorization);
      if (!wid) { fail(401, 'The provisioning token is not valid'); return true; }
      const rest = p.slice('/scim/v2'.length);
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') { try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch (e) { fail(400, 'Invalid request', 'invalidSyntax'); return true; } }
      if (rest === '/ServiceProviderConfig') { send(200, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'Organization provisioning token' }] }); return true; }
      if (rest === '/Users' && req.method === 'GET') {
        const f = /userName\s+eq\s+"([^"]+)"/i.exec(url.searchParams.get('filter') || '');
        const start = Math.max(1, Number(url.searchParams.get('startIndex')) || 1), count = Math.min(200, Math.max(0, Number(url.searchParams.get('count')) || 100));
        const rows = (await this.q('SELECT DISTINCT u.id, u.name, u.email FROM users u JOIN workspace_members m ON m.user_id = u.id WHERE m.workspace_id = $1 AND ($2::text IS NULL OR lower(u.email) = lower($2)) ORDER BY u.id', [wid, f ? f[1] : null])).rows;
        send(200, { schemas: [LIST], totalResults: rows.length, startIndex: start, itemsPerPage: Math.min(count, Math.max(0, rows.length - start + 1)), Resources: rows.slice(start - 1, start - 1 + count).map((u) => this.resource(u)) }); return true;
      }
      if (rest === '/Users' && req.method === 'POST') {
        const email = String(body.userName || (body.emails && body.emails[0] && body.emails[0].value) || '').trim().toLowerCase();
        if (!this.auth.EMAIL_RE.test(email)) { fail(400, 'userName must be an email address', 'invalidValue'); return true; }
        const name = String(body.displayName || (body.name && (body.name.formatted || [body.name.givenName, body.name.familyName].filter(Boolean).join(' '))) || email.split('@')[0]).trim().slice(0, 120);
        let u = (await this.q('SELECT id, name, email FROM users WHERE email = $1', [email])).rows[0], created = false;
        if (u && (await this.orgs.rolesIn(u.id, wid)).length) { fail(409, 'This user already exists', 'uniqueness'); return true; }
        if (!u) {
          if ((await this.orgs.seatsUsed(wid)) >= (await this.orgs.seatsBought(wid))) { fail(409, 'All seats are in use', 'tooMany'); return true; }
 const r = await this.auth.register({ name, email, password: crypto.randomBytes(24).toString('hex') }, { skipPolicy: true }); await this.auth.logout(r.token).catch(() => {}); u = { id: r.user.id, name: r.user.name, email: r.user.email }; created = true; }
        await this.add(wid, u);
        await this.orgs.audit(wid, null, 'provisioning.user_created', { email, via: 'scim', new_account: created });
        send(201, this.resource(u)); return true;
      }
      const one = /^\/Users\/(\d+)$/.exec(rest);
      if (one) {
        const u = await this.member(wid, one[1]);
        if (!u) { fail(404, 'User not found'); return true; }
        if (req.method === 'GET') { send(200, this.resource(u)); return true; }
        let active = null;
        if (req.method === 'DELETE') active = false;
        else if (req.method === 'PUT') active = body.active !== false;
        else if (req.method === 'PATCH') {
          for (const op of body.Operations || []) {
            const path = String(op.path || '').toLowerCase();
            if (path === 'active') active = op.value === true || String(op.value).toLowerCase() === 'true';
            else if (!path && op.value && typeof op.value === 'object' && 'active' in op.value) active = op.value.active === true || String(op.value.active).toLowerCase() === 'true';
          }
        }
        if (active === false) {
          const out = await this.orgs.remove(null, wid, Number(u.id), { system: true });
          await this.orgs.audit(wid, null, 'provisioning.user_deactivated', { user_id: Number(u.id), email: u.email, via: 'scim', ...out });
        }
        if (req.method === 'DELETE') { res.writeHead(204, { 'Cache-Control': 'no-store', ...deps.SECURITY }); res.end(); return true; }
        send(200, this.resource(u, active !== false)); return true;
      }
      fail(404, 'Not found'); return true;
    } catch (e) {
      if (e.scim) { fail(e.status || 409, e.message, e.scim); return true; }
      fail(e.status || 500, e.status ? e.message : 'Provisioning failed'); return true;
    }
  }
}

module.exports = { Scim };
