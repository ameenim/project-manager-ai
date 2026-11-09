// Connections to other services. A person clicks Connect, signs in at the service, allows access, and comes back connected.
// The app owner registers the app once with each service and sets the client id and secret. People never handle tokens.
// Tokens are encrypted before they are stored. They are never sent to the browser.
'use strict';
const crypto = require('crypto');

const err = (status, message) => Object.assign(new Error(message), { status, expose: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tenant = () => process.env.MICROSOFT_TENANT || 'common';

function providers() {
  return {
    jira: {
      name: 'Jira', idEnv: 'ATLASSIAN_CLIENT_ID', secretEnv: 'ATLASSIAN_CLIENT_SECRET',
      authorize: 'https://auth.atlassian.com/authorize', token: 'https://auth.atlassian.com/oauth/token', json: true,
      scope: 'read:me read:jira-work read:jira-user offline_access', extra: { audience: 'api.atlassian.com', prompt: 'consent' },
      resources: 'https://api.atlassian.com/oauth/token/accessible-resources', me: 'https://api.atlassian.com/me',
      site: (id) => `https://api.atlassian.com/ex/jira/${id}/rest/api/3/myself`,
      setupUrl: 'https://developer.atlassian.com/console/myapps/',
    },
    outlook: {
      name: 'Outlook', idEnv: 'MICROSOFT_CLIENT_ID', secretEnv: 'MICROSOFT_CLIENT_SECRET',
      authorize: `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, json: false,
      scope: 'offline_access User.Read Mail.Read', extra: { prompt: 'select_account' },
      me: 'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName',
      setupUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/isMSAApp~/false',
    },
  };
}

class Connectors {
  constructor(db, opts = {}) { this.db = db; this.fetch = opts.fetch || ((...a) => fetch(...a)); this.P = opts.providers || providers(); this._key = null; }

  // ----- encryption -----
  // The key comes from the APP_SECRET setting. Without it a key is made and kept in the database, which works but puts the
  // key beside the data it protects, so anyone who copies the database can read every saved token. Production should
  // set APP_SECRET. When it is set later, tokens saved under the database key are still read, then saved again under the
  // new key the next time they are written.
  async key() {
    if (this._key) return this._key;
    if (process.env.APP_SECRET) { this._key = crypto.createHash('sha256').update(process.env.APP_SECRET).digest(); return this._key; }
    if (process.env.REPLIT_DEPLOYMENT && !this._warned) { this._warned = true; console.warn('SECURITY: APP_SECRET is not set, so connection tokens are encrypted with a key stored in the same database. Set APP_SECRET to a long random value.'); }
    return this.dbKey(true);
  }
  async dbKey(create) {
    if (this._dbKey) return this._dbKey;
    if (create) await this.db.query('INSERT INTO app_secrets(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', ['conn_key', crypto.randomBytes(32).toString('hex')]);
    const r = await this.db.query('SELECT value FROM app_secrets WHERE key = $1', ['conn_key']);
    if (!r.rows[0]) return null;
    this._dbKey = Buffer.from(r.rows[0].value, 'hex');
    if (!process.env.APP_SECRET) this._key = this._dbKey;
    return this._dbKey;
  }
  async seal(obj) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', await this.key(), iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }
  async open(text) {
    const [iv, tag, enc] = String(text).split('.').map((s) => Buffer.from(s, 'base64'));
    const tryKey = (key) => {
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
    };
    try { return tryKey(await this.key()); } catch (e) { /* maybe saved under the older database key */ }
    try {
      const old = process.env.APP_SECRET ? await this.dbKey(false) : null;
      if (old) return tryKey(old);
    } catch (e) { /* falls through to the message below */ }
    throw err(409, 'The saved connection can no longer be read. Disconnect it and connect again.');
  }

  // ----- what the screen needs -----
  // the owner can paste the app id and secret into the app, or set them as environment secrets
  creds(kind) {
    const p = this.P[kind]; if (!p) return null;
    const c = this._cfg && this._cfg[kind];
    if (c && c.id && c.secret) return c;
    return process.env[p.idEnv] && process.env[p.secretEnv] ? { id: process.env[p.idEnv], secret: process.env[p.secretEnv] } : null;
  }
  async loadConfig() {
    try {
      const r = await this.db.query("SELECT key, value FROM app_secrets WHERE key LIKE 'oauth_%'");
      const cfg = {};
      for (const row of r.rows) { try { cfg[row.key.slice(6)] = await this.open(row.value); } catch { /* unreadable entry is ignored */ } }
      this._cfg = cfg;
    } catch { this._cfg = this._cfg || {}; }
  }
  async saveConfig(kind, id, secret) {
    if (!this.P[kind]) throw err(404, 'Unknown service');
    id = String(id || '').trim(); secret = String(secret || '').trim();
    if (!id || !secret) throw err(400, 'Enter both the client ID and the client secret.');
    await this.db.query('INSERT INTO app_secrets(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['oauth_' + kind, await this.seal({ id, secret })]);
    this._cfg = { ...(this._cfg || {}), [kind]: { id, secret } };
  }
  configured(kind) { return !!this.creds(kind); }
  redirectUri(origin, kind) { return `${origin}/oauth/callback/${kind}`; }
  setupInfo(kind, origin) {
    const p = this.P[kind];
    return { redirect_uri: this.redirectUri(origin, kind), id_env: p.idEnv, secret_env: p.secretEnv, url: p.setupUrl, scope: p.scope };
  }

  // ----- sign in at the service -----
  async begin(userId, kind, origin) {
    const p = this.P[kind]; if (!p) throw err(404, 'Unknown service');
    await this.loadConfig();
    if (!this.configured(kind)) throw err(409, `${p.name} is not set up for this app yet. The app owner needs to finish the one time setup.`);
    const state = crypto.randomBytes(24).toString('hex'), redirect = this.redirectUri(origin, kind);
    await this.db.query('DELETE FROM oauth_states WHERE expires_at < now()');
    await this.db.query("INSERT INTO oauth_states(state_hash, user_id, kind, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, now() + interval '10 minutes')", [sha(state), userId, kind, redirect]);
    const q = new URLSearchParams({ client_id: this.creds(kind).id, redirect_uri: redirect, response_type: 'code', scope: p.scope, state, ...p.extra });
    return `${p.authorize}?${q}`;
  }

  // called when the service sends the person back with a code
  async finish(kind, code, state) {
    const p = this.P[kind]; if (!p) throw err(404, 'Unknown service');
    await this.loadConfig();
    if (!code || !state) throw err(400, 'The sign in was not completed.');
    const r = await this.db.query('DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, kind, redirect_uri', [sha(String(state))]);
    const row = r.rows[0];
    if (!row || row.kind !== kind) throw err(400, 'This sign in link has expired or was already used. Start the connection again.');
    const tok = await this.tokenRequest(p, { grant_type: 'authorization_code', code, redirect_uri: row.redirect_uri });
    const secret = this.fromToken(tok);
    const who = await this.identify(kind, secret);
    return { userId: Number(row.user_id), secret: who.secret, label: who.label, meta: who.meta };
  }

  async tokenRequest(p, params) {
    const kind = Object.keys(this.P).find((k) => this.P[k] === p), c = this.creds(kind) || {};
    const body = { client_id: c.id, client_secret: c.secret, ...params };
    const res = await this.fetch(p.token, { method: 'POST', headers: p.json ? { 'content-type': 'application/json' } : { 'content-type': 'application/x-www-form-urlencoded' }, body: p.json ? JSON.stringify(body) : new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw err(502, `${p.name} did not accept the sign in${data.error_description ? ': ' + data.error_description : ''}. Try again.`);
    return data;
  }
  fromToken(t, old = {}) { return { ...old, access: t.access_token, refresh: t.refresh_token || old.refresh || null, expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000 }; }

  async call(url, secret, init = {}) {
    const headers = { accept: 'application/json', ...(secret.basic ? { authorization: `Basic ${secret.basic}` } : { authorization: `Bearer ${secret.access}` }), ...(init.headers || {}) };
    try { return await this.fetch(url, { ...init, headers, signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw err(502, 'Could not reach the service. Check the connection and try again.'); }
  }

  // asks the service who this is. A good answer proves the connection works.
  async identify(kind, secret, chosenSite) {
    const p = this.P[kind];
    if (kind === 'outlook') {
      const r = await this.call(p.me, secret);
      if (!r.ok) throw err(502, 'Outlook did not accept the connection. Try again.');
      const me = await r.json();
      return { secret, label: `${me.displayName || ''} (${me.mail || me.userPrincipalName || ''})`.trim(), meta: {} };
    }
    const rr = await this.call(p.resources, secret);
    if (!rr.ok) throw err(502, 'Jira did not accept the connection. Try again.');
    const sites = (await rr.json()).map((s) => ({ id: s.id, name: s.name, url: s.url }));
    if (!sites.length) throw err(409, 'This Atlassian account has no Jira site. Sign in with the account that uses your Jira.');
    const site = sites.find((s) => s.id === chosenSite) || sites.find((s) => s.id === secret.cloud_id) || sites[0];
    const next = { ...secret, cloud_id: site.id };
    const t = await this.call(p.site(site.id), next);
    if (!t.ok) throw err(502, `Jira signed you in but ${site.name} did not answer. Check that you have access to it.`);
    const me = await t.json().catch(() => ({}));
    return { secret: next, label: `${me.displayName || me.emailAddress || 'Jira'} at ${String(site.url).replace(/^https:\/\//, '')}`, meta: { sites, site_id: site.id } };
  }

  // the simpler fallback for Jira Cloud: the person's own API token
  async identifyToken(base, email, token) {
    const m = /^https:\/\/([a-z0-9-]+)\.atlassian\.net\/?$/i.exec(String(base || '').trim());
    if (!m) throw err(400, 'Enter your Jira address, for example https://yourcompany.atlassian.net');
    if (!email || !token) throw err(400, 'Enter the account email and the API token');
    const secret = { basic: Buffer.from(`${String(email).trim()}:${String(token).trim()}`).toString('base64'), base_url: `https://${m[1]}.atlassian.net` };
    const r = await this.call(`${secret.base_url}/rest/api/3/myself`, secret);
    if (r.status === 401 || r.status === 403) throw err(400, 'Jira did not accept this email and token. Check both and try again.');
    if (!r.ok) throw err(502, 'Jira did not answer. Check the address and try again.');
    const me = await r.json().catch(() => ({}));
    return { secret, label: `${me.displayName || email} at ${m[1]}.atlassian.net`, meta: { site_id: null } };
  }

  // a saved connection is checked again, and its token renewed when it is about to expire
  async retest(sealed, kind) {
    await this.loadConfig();
    const p = this.P[kind]; let secret = await this.open(sealed);
    if (secret.access && secret.expires_at && secret.expires_at - 60e3 < Date.now()) {
      if (!secret.refresh) throw err(409, `${p.name} needs you to sign in again. Disconnect and connect again.`);
      secret = this.fromToken(await this.tokenRequest(p, { grant_type: 'refresh_token', refresh_token: secret.refresh }), secret);
    }
    if (secret.basic) {
      const r = await this.call(`${secret.base_url}/rest/api/3/myself`, secret);
      if (!r.ok) throw err(409, 'Jira no longer accepts the saved token. Disconnect and connect again.');
      const me = await r.json().catch(() => ({}));
      return { secret, label: `${me.displayName || 'Jira'} at ${secret.base_url.replace(/^https:\/\//, '')}`, meta: {} };
    }
    return this.identify(kind, secret);
  }


  // ----- reading mail and Jira work for the sync button -----
  async fresh(prefs, kind) {
    await this.loadConfig();
    const sealed = prefs && prefs.conn_secrets && prefs.conn_secrets[kind];
    if (!sealed) return null;
    const p = this.P[kind]; let secret = await this.open(sealed), changed = false;
    if (secret.access && secret.expires_at && secret.expires_at - 60e3 < Date.now()) {
      if (!secret.refresh) throw err(409, `${p.name} needs you to sign in again. Disconnect and connect again.`);
      secret = this.fromToken(await this.tokenRequest(p, { grant_type: 'refresh_token', refresh_token: secret.refresh }), secret); changed = true;
    }
    return { secret, changed };
  }
  async outlookMail(secret, sinceIso, limit = 50) {
    const q = new URLSearchParams({ $top: String(limit), $orderby: 'receivedDateTime desc', $select: 'id,subject,from,receivedDateTime,bodyPreview,body', $filter: `receivedDateTime ge ${sinceIso}` });
    const r = await this.call(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${q}`, secret, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    if (r.status === 401 || r.status === 403) throw err(409, 'Outlook did not allow reading mail. Disconnect and connect again, and allow mail access.');
    if (!r.ok) throw err(502, 'Outlook did not answer. Try again in a moment.');
    const data = await r.json().catch(() => ({}));
    return (data.value || []).map((m) => ({ ext_id: m.id, subject: m.subject || '', sender: (m.from && m.from.emailAddress && (m.from.emailAddress.name || m.from.emailAddress.address)) || null, body: String((m.body && m.body.content) || m.bodyPreview || '').replace(/\r/g, '').trim(), at: m.receivedDateTime }));
  }
  async jiraIssues(secret, key, days = 14, limit = 25) {
    const base = secret.basic ? secret.base_url : `https://api.atlassian.com/ex/jira/${secret.cloud_id}`;
    const q = new URLSearchParams({ jql: `project = "${String(key).replace(/[^A-Za-z0-9_]/g, '')}" AND updated >= -${days}d ORDER BY updated DESC`, fields: 'summary,status,comment,updated,assignee,reporter', maxResults: String(limit) });
    const r = await this.call(`${base}/rest/api/3/search/jql?${q}`, secret);
    if (r.status === 401 || r.status === 403) throw err(409, 'Jira did not allow reading issues. Disconnect and connect again.');
    if (r.status === 400 || r.status === 404) throw err(404, `Jira could not find the project ${key}. Check the Jira link in the project settings.`);
    if (!r.ok) throw err(502, 'Jira did not answer. Try again in a moment.');
    const data = await r.json().catch(() => ({}));
    const adf = (n) => (!n ? '' : typeof n === 'string' ? n : n.text || (n.content || []).map(adf).join(n.type === 'paragraph' ? '\n' : ''));
    return (data.issues || []).map((i) => {
      const f = i.fields || {}, cs = (f.comment && f.comment.comments) || [], last = cs[cs.length - 1];
      return { ext_id: `${i.key}:${f.updated}`, subject: `${i.key} ${f.summary || ''}`.trim(), sender: (last && last.author && last.author.displayName) || (f.assignee && f.assignee.displayName) || (f.reporter && f.reporter.displayName) || null,
        body: `Status: ${(f.status && f.status.name) || 'unknown'}${last ? `\nLatest comment: ${adf(last.body).trim()}` : ''}`, at: f.updated };
    });
  }

  // ----- what is kept in the person's settings -----
  async apply(prefs, kind, result) {
    const out = { ...(prefs || {}) };
    out.connections = { ...(out.connections || {}), [kind]: result.label };
    out.conn_secrets = { ...(out.conn_secrets || {}), [kind]: await this.seal(result.secret) };
    out.conn_meta = { ...(out.conn_meta || {}), [kind]: result.meta || {} };
    return out;
  }
  remove(prefs, kind) {
    const out = { ...(prefs || {}) };
    for (const k of ['connections', 'conn_secrets', 'conn_meta']) { out[k] = { ...(out[k] || {}) }; delete out[k][kind]; }
    return out;
  }
  async saveFor(userId, kind, result) {
    await this.key(); // load the key before the transaction so it never waits on its own connection
    return this.db.tx(async (t) => {
      const r = await t.query('SELECT prefs FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!r.rows[0]) throw err(404, 'Account not found');
      const prefs = await this.apply(r.rows[0].prefs, kind, result);
      await t.query('UPDATE users SET prefs = $2::jsonb WHERE id = $1', [userId, JSON.stringify(prefs)]);
    });
  }
}

module.exports = { Connectors, providers };
