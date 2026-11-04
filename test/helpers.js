'use strict';
const { createApp } = require('../server/app');

async function start(opts = {}) {
  const app = await createApp({ dbOptions: { memory: true }, ...opts });
  await new Promise((ok) => app.server.listen(0, ok));
  const base = 'http://localhost:' + app.server.address().port;
  async function call(method, path, body, tok, extra = {}) {
    const isForm = body instanceof FormData;
    const headers = { ...(body && !isForm && typeof body === 'object' ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...extra };
    const r = await fetch(base + path, { method, headers, body: isForm ? body : typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await r.arrayBuffer());
    let data = null; try { data = JSON.parse(buf.toString()); } catch { /* not json */ }
    return { status: r.status, data, buf, headers: r.headers };
  }
  let n = 0;
  async function user(name = 'User') {
    n++;
    const email = `u${n}_${Date.now()}@test.co`;
    const r = await call('POST', '/api/auth/register', { name: `${name} ${n}`, email, password: 'password1' });
    if (r.status !== 200) throw new Error('register failed ' + r.status + ' ' + JSON.stringify(r.data));
    return { email, token: r.data.token, id: r.data.user.id };
  }
  async function project(tok, name = 'Alpha', text) {
    const fd = new FormData(); fd.append('name', name);
    if (text) fd.append('files', new Blob([text], { type: 'text/plain' }), 'contract.txt');
    const r = await call('POST', '/api/projects', fd, tok);
    if (r.status !== 200) throw new Error('create project failed ' + r.status + ' ' + JSON.stringify(r.data));
    return r.data.project;
  }
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function until(fn, ms = 15000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out'); await sleep(150); } }
  return { app, base, call, user, project, sleep, until, close: () => app.close() };
}
module.exports = { start };
