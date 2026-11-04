'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const seen = [];
let sites = [{ id: 'c1', name: 'Acme', url: 'https://acme.atlassian.net' }];
let expiresIn = 3600, basicStatus = 200;
const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
async function fakeFetch(url, init = {}) {
  url = String(url); seen.push({ url, init });
  if (url === 'https://auth.atlassian.com/oauth/token') {
    const b = JSON.parse(init.body);
    return reply(200, { access_token: b.grant_type === 'refresh_token' ? 'JIRA_ACCESS_2' : 'JIRA_ACCESS_1', refresh_token: 'JIRA_REFRESH_SECRET', expires_in: expiresIn });
  }
  if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') return reply(200, sites);
  if (/^https:\/\/api\.atlassian\.com\/ex\/jira\/(\w+)\/rest\/api\/3\/myself$/.test(url)) return reply(200, { displayName: 'Ann Jira' });
  if (url.startsWith('https://login.microsoftonline.com/')) return reply(200, { access_token: 'MS_ACCESS_SECRET', refresh_token: 'MS_REFRESH_SECRET', expires_in: 3600 });
  if (url.startsWith('https://graph.microsoft.com/v1.0/me') && !url.includes('/mailFolders/')) return reply(200, { displayName: 'Ann Mail', mail: 'ann@corp.com' });
  if (url === 'https://acme.atlassian.net/rest/api/3/myself') return basicStatus === 200 ? reply(200, { displayName: 'Token Ann' }) : reply(basicStatus, {});
  if (url.startsWith('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages')) return reply(200, { value: [
    { id: 'm1', subject: 'Re: Acme Portal delivery', from: { emailAddress: { name: 'Sam Lee', address: 'sam@x.com' } }, receivedDateTime: '2026-11-01T10:00:00Z', body: { content: 'Hi, the Acme Portal design sign off is done.' } },
    { id: 'm2', subject: 'Lunch on Friday', from: { emailAddress: { name: 'Bob', address: 'b@x.com' } }, receivedDateTime: '2026-11-01T11:00:00Z', body: { content: 'Pizza?' } }] });
  if (url.startsWith('https://api.atlassian.com/ex/jira/c1/rest/api/3/search/jql')) return reply(200, { issues: [{ key: 'ACME-7', fields: { summary: 'Design sign off', status: { name: 'Done' }, updated: '2026-11-02T09:00:00Z', comment: { comments: [{ author: { displayName: 'Ann Jira' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished and signed.' }] }] } }] } } }] });
  throw new Error('unexpected call ' + url);
}
let s;
const ENV = { ATLASSIAN_CLIENT_ID: 'aid', ATLASSIAN_CLIENT_SECRET: 'asecret', MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' };
before(async () => { s = await start({ connectorOptions: { fetch: fakeFetch } }); });
after(() => { for (const k of Object.keys(ENV)) delete process.env[k]; return s.close(); });
const setEnv = () => Object.assign(process.env, ENV);
const clearEnv = () => { for (const k of Object.keys(ENV)) delete process.env[k]; };
const callback = (kind, q) => fetch(`${s.base}/oauth/callback/${kind}?${new URLSearchParams(q)}`, { redirect: 'manual' }).then((r) => ({ status: r.status, loc: r.headers.get('location') || '' }));
async function connect(u, kind) {
  const st = await s.call('POST', `/api/connections/${kind}/start`, {}, u.token);
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const url = new URL(st.data.url);
  return { url, state: url.searchParams.get('state') };
}

test('without the owner setup the screen explains what is missing and cannot start', async () => {
  clearEnv(); const u = await s.user();
  const r = await s.call('GET', '/api/connections', null, u.token);
  assert.equal(r.data.connections.jira.configured, false);
  assert.match(r.data.connections.jira.setup.redirect_uri, /\/oauth\/callback\/jira$/);
  assert.equal(r.data.connections.jira.setup.id_env, 'ATLASSIAN_CLIENT_ID');
  assert.equal((await s.call('POST', '/api/connections/jira/start', {}, u.token)).status, 409);
});
test('Jira: start, approve, connected, and the tokens never reach the browser', async () => {
  setEnv(); const u = await s.user();
  const { url, state } = await connect(u, 'jira');
  assert.equal(url.origin + url.pathname, 'https://auth.atlassian.com/authorize');
  assert.equal(url.searchParams.get('client_id'), 'aid'); assert.match(url.searchParams.get('redirect_uri'), /\/oauth\/callback\/jira$/);
  assert.ok(url.searchParams.get('scope').includes('offline_access'));
  const cb = await callback('jira', { code: 'CODE1', state });
  assert.equal(cb.status, 302); assert.match(cb.loc, /oauth-done\.html\?kind=jira&ok=1/);
  const c = (await s.call('GET', '/api/connections', null, u.token)).data.connections.jira;
  assert.equal(c.connected, true); assert.equal(c.label, 'Ann Jira at acme.atlassian.net');
  assert.equal((await s.call('GET', '/api/me', null, u.token)).data.status.jira, true);
  for (const path of ['/api/me', '/api/connections']) assert.ok(!/JIRA_ACCESS|JIRA_REFRESH|conn_secrets/.test((await s.call('GET', path, null, u.token)).buf.toString()), path);
  const row = await s.app.db.query('SELECT prefs FROM users WHERE id = $1', [u.id]);
  const raw = JSON.stringify(row.rows[0].prefs);
  assert.ok(!raw.includes('JIRA_ACCESS') && !raw.includes('JIRA_REFRESH'), 'tokens are encrypted at rest');
  assert.ok(row.rows[0].prefs.conn_secrets.jira.split('.').length === 3);
  // a normal settings save keeps the connection
  await s.call('PUT', '/api/me', { name: 'Renamed' }, u.token);
  assert.equal((await s.call('GET', '/api/connections', null, u.token)).data.connections.jira.connected, true);
});
test('the sign in link works once, for the right service, and only when allowed', async () => {
  setEnv(); const u = await s.user();
  const { state } = await connect(u, 'jira');
  assert.match((await callback('outlook', { code: 'C', state })).loc, /ok=0/, 'a Jira link cannot finish Outlook');
  assert.match((await callback('jira', { code: 'C', state })).loc, /ok=0/, 'and a mixed up link is burned');
  const fresh = await connect(u, 'jira');
  assert.match((await callback('jira', { code: 'C', state: fresh.state })).loc, /ok=1/);
  const again = fresh.state;
  assert.match((await callback('jira', { code: 'C', state: again })).loc, /ok=0/, 'second use is refused');
  assert.match((await callback('jira', { code: 'C', state: 'made-up' })).loc, /ok=0/);
  assert.match((await callback('jira', {})).loc, /ok=0/);
  const denied = await callback('jira', { error: 'access_denied' });
  assert.match(denied.loc, /ok=0/); assert.match(decodeURIComponent(denied.loc), /Access was not allowed/);
});
test('one person cannot finish another person link into their own account', async () => {
  setEnv(); const a = await s.user(), b = await s.user();
  const { state } = await connect(a, 'jira');
  await callback('jira', { code: 'C', state });
  assert.equal((await s.call('GET', '/api/connections', null, a.token)).data.connections.jira.connected, true);
  assert.equal((await s.call('GET', '/api/connections', null, b.token)).data.connections.jira.connected, false);
});
test('Outlook connects the same way', async () => {
  setEnv(); const u = await s.user();
  const { url, state } = await connect(u, 'outlook');
  assert.match(url.href, /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/); assert.ok(url.searchParams.get('scope').includes('Mail.Read'));
  assert.match((await callback('outlook', { code: 'C', state })).loc, /ok=1/);
  const c = (await s.call('GET', '/api/connections', null, u.token)).data.connections.outlook;
  assert.equal(c.connected, true); assert.equal(c.label, 'Ann Mail (ann@corp.com)');
  assert.equal((await s.call('GET', '/api/me', null, u.token)).data.status.graph, true);
});
test('test connection renews an expired token and reports who is connected', async () => {
  setEnv(); const u = await s.user(); expiresIn = 1;
  const { state } = await connect(u, 'jira'); await callback('jira', { code: 'C', state }); expiresIn = 3600;
  seen.length = 0;
  const t = await s.call('POST', '/api/connections/jira/test', {}, u.token);
  assert.equal(t.status, 200); assert.equal(t.data.ok, true); assert.match(t.data.label, /Ann Jira/);
  assert.ok(seen.some((x) => x.url === 'https://auth.atlassian.com/oauth/token' && JSON.parse(x.init.body).grant_type === 'refresh_token'), 'the refresh token was used');
  assert.equal((await s.call('POST', '/api/connections/outlook/test', {}, u.token)).status, 404, 'not connected');
});
test('several Jira sites can be chosen from', async () => {
  setEnv(); const u = await s.user();
  sites = [{ id: 'c1', name: 'Acme', url: 'https://acme.atlassian.net' }, { id: 'c2', name: 'Beta', url: 'https://beta.atlassian.net' }];
  const { state } = await connect(u, 'jira'); await callback('jira', { code: 'C', state });
  let c = (await s.call('GET', '/api/connections', null, u.token)).data.connections.jira;
  assert.equal(c.sites.length, 2); assert.equal(c.site_id, 'c1');
  const r = await s.call('POST', '/api/connections/jira/site', { site_id: 'c2' }, u.token);
  assert.equal(r.status, 200); assert.match(r.data.connections.jira.label, /beta\.atlassian\.net/); assert.equal(r.data.connections.jira.site_id, 'c2');
  sites = [{ id: 'c1', name: 'Acme', url: 'https://acme.atlassian.net' }];
});
test('Jira with an API token is checked live', async () => {
  const u = await s.user();
  assert.equal((await s.call('POST', '/api/connections/jira/token', { base_url: 'https://evil.example.com', email: 'a@b.co', token: 'x' }, u.token)).status, 400);
  assert.equal((await s.call('POST', '/api/connections/jira/token', { base_url: 'http://acme.atlassian.net', email: 'a@b.co', token: 'x' }, u.token)).status, 400);
  assert.equal((await s.call('POST', '/api/connections/jira/token', { base_url: 'https://acme.atlassian.net' }, u.token)).status, 400);
  basicStatus = 401;
  assert.equal((await s.call('POST', '/api/connections/jira/token', { base_url: 'https://acme.atlassian.net', email: 'a@b.co', token: 'bad' }, u.token)).status, 400);
  assert.equal((await s.call('GET', '/api/connections', null, u.token)).data.connections.jira.connected, false, 'a failed check connects nothing');
  basicStatus = 200;
  const ok = await s.call('POST', '/api/connections/jira/token', { base_url: 'https://acme.atlassian.net', email: 'a@b.co', token: 'good' }, u.token);
  assert.equal(ok.status, 200); assert.equal(ok.data.connections.jira.label, 'Token Ann at acme.atlassian.net');
  assert.equal((await s.call('POST', '/api/connections/jira/test', {}, u.token)).data.ok, true);
});
test('disconnect removes the connection and its saved tokens', async () => {
  setEnv(); const u = await s.user();
  const { state } = await connect(u, 'jira'); await callback('jira', { code: 'C', state });
  const d = await s.call('DELETE', '/api/connections/jira', null, u.token);
  assert.equal(d.status, 200); assert.equal(d.data.connections.jira.connected, false);
  const prefs = (await s.app.db.query('SELECT prefs FROM users WHERE id = $1', [u.id])).rows[0].prefs;
  assert.ok(!prefs.conn_secrets || !prefs.conn_secrets.jira);
  assert.equal((await s.call('POST', '/api/connections/jira/test', {}, u.token)).status, 404);
  assert.equal((await s.call('GET', '/api/me', null, u.token)).data.status.jira, false);
});
test('connections need a signed in user', async () => {
  assert.equal((await s.call('POST', '/api/connections/jira/start', {})).status, 401);
  assert.equal((await s.call('GET', '/api/connections')).status, 401);
});

test('the owner can paste the app id and secret in the app, no restart and no environment secrets', async () => {
  clearEnv(); const u = await s.user();
  assert.equal((await s.call('POST', '/api/connections/outlook/setup', { client_id: '', client_secret: '' }, u.token)).status, 400);
  const r = await s.call('POST', '/api/connections/outlook/setup', { client_id: 'pasted-id', client_secret: 'pasted-secret-value' }, u.token);
  assert.equal(r.status, 200); assert.equal(r.data.connections.outlook.configured, true);
  assert.ok(!r.buf.toString().includes('pasted-secret-value'), 'the secret is never sent back');
  const { url } = await connect(u, 'outlook');
  assert.equal(url.searchParams.get('client_id'), 'pasted-id');
  const row = await s.app.db.query("SELECT value FROM app_secrets WHERE key = 'oauth_outlook'");
  assert.ok(!row.rows[0].value.includes('pasted-secret-value'), 'stored encrypted');
  await s.app.db.query("DELETE FROM app_secrets WHERE key = 'oauth_outlook'");
});

test('Sync now reads new mail and Jira work for the project and never repeats a message', async () => {
  setEnv(); const u = await s.user();
  const p = await s.project(u.token, 'Acme Portal');
  const empty = await s.call('POST', `/api/projects/${p.id}/sync`, {}, u.token);
  assert.equal(empty.data.needs_connection, true, 'nothing connected yet gives a friendly next step');
  for (const kind of ['outlook', 'jira']) { const { state } = await connect(u, kind); assert.equal((await callback(kind, { code: 'C' + kind, state })).status, 302); }
  await s.call('PUT', `/api/projects/${p.id}`, { jira_url: 'https://acme.atlassian.net/browse/ACME' }, u.token);
  const r1 = await s.call('POST', `/api/projects/${p.id}/sync`, {}, u.token);
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.deepEqual(r1.data.errors, {});
  assert.ok(r1.data.report.outlook >= 1, 'only the mail that mentions the project is read');
  assert.ok(r1.data.report.jira >= 1);
  const rows = (await s.call('GET', `/api/projects/${p.id}/inbox`, null, u.token)).data.inbox;
  assert.ok(rows.some((x) => x.source === 'outlook' && /Acme Portal/.test(x.subject)));
  assert.ok(!rows.some((x) => /Lunch/.test(x.subject || '')), 'unrelated mail is ignored');
  assert.ok(rows.some((x) => x.source === 'jira' && /ACME-7/.test(x.subject)));
  const r2 = await s.call('POST', `/api/projects/${p.id}/sync`, {}, u.token);
  assert.equal(r2.data.report.outlook, 0); assert.equal(r2.data.report.jira, 0);
});
