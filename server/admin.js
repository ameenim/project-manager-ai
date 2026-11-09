// The super admin API, everything under /api/admin. Every request is checked against the database, so a person who
// loses the super admin switch or is suspended is locked out at once. Every change is written to admin_audit.
'use strict';
const crypto = require('crypto');
const { Ops, DAY } = require('./ops');

const err = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v || 0);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const intOf = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k.toString('hex')))));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };

module.exports = function createAdmin({ db, store, auth, ops, usage, tickets }) {
  const q = (t, p) => db.query(t, p);
  const routes = [];
  const on = (method, re, fn) => routes.push([method, new RegExp('^/api/admin' + re + '$'), fn]);

  async function audit(admin, action, target, detail) {
    try { await q('INSERT INTO admin_audit(id, admin_id, admin_email, action, target, detail) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [store.nid(), admin.id, admin.email, action, String(target || ''), JSON.stringify(detail || {})]); }
    catch (e) { console.error('audit', e.message); }
  }
  const page = (query, def = 25) => { const size = Math.min(100, Math.max(1, intOf(query.size, def))); const p = Math.max(1, intOf(query.page, 1)); return { size, offset: (p - 1) * size, page: p }; };
  const like = (s) => '%' + String(s || '').replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  const idOf = (s) => { const n = Number(s); if (!Number.isSafeInteger(n) || n <= 0) throw err(400, 'Invalid id'); return n; };
  const dateParam = (s, d) => { if (!s) return d; const t = Date.parse(s); if (Number.isNaN(t)) throw err(400, 'Invalid date'); return new Date(t); };

  async function userRow(id) {
    const r = (await q("SELECT u.id, u.name, u.email, u.created_at, COALESCE(f.is_super, false) AS is_super, COALESCE(f.status, 'active') AS status, f.last_seen_at FROM users u LEFT JOIN user_flags f ON f.user_id = u.id WHERE u.id = $1", [id])).rows[0];
    if (!r) throw err(404, 'User not found');
    return r;
  }
  const userOut = (r) => ({ id: r.id, name: r.name, email: r.email, is_super: !!r.is_super, status: r.status, created_at: iso(r.created_at), last_seen_at: iso(r.last_seen_at) });
  const supersLeft = async (exceptId) => num((await q("SELECT count(*) AS c FROM user_flags f JOIN users u ON u.id = f.user_id WHERE f.is_super AND f.status = 'active' AND f.user_id <> $1", [exceptId])).rows[0].c);

  // ---------- who am I ----------
  on('GET', '/me', async ({ admin }) => ({ user: { id: admin.id, name: admin.name, email: admin.email, is_super: true } }));

  // ---------- overview ----------
  async function series(table, valueSql, days, where) {
    const rows = (await q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, ${valueSql} AS v FROM ${table} WHERE created_at >= now() - ($1 || ' days')::interval ${where || ''} GROUP BY 1 ORDER BY 1`, [String(days)])).rows;
    const m = new Map(rows.map((r) => [r.d, num(r.v)]));
    const out = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); out.push({ d, v: m.get(d) || 0 }); }
    return out;
  }
  async function aiTotals(days) {
    const a = (await q("SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, count(*) AS calls FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval", [String(days)])).rows[0];
    const b = (await q("SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, count(*) AS calls FROM chat_log WHERE billable AND (input_tokens > 0 OR output_tokens > 0) AND created_at >= now() - ($1 || ' days')::interval", [String(days)])).rows[0];
    const input = num(a.i) + num(b.i), output = num(a.o) + num(b.o);
    return { input, output, total: input + output, calls: num(a.calls) + num(b.calls), cost: await ops.cost(input, output) };
  }
  on('GET', '/overview', async () => {
    await ops.backfillSubscriptions();
    const cfg = await ops.config();
    const users = (await q("SELECT count(*) AS total, count(*) FILTER (WHERE u.created_at >= now() - interval '7 days') AS new7, count(*) FILTER (WHERE f.status = 'suspended') AS suspended, count(*) FILTER (WHERE f.last_seen_at >= now() - interval '30 days') AS active30 FROM users u LEFT JOIN user_flags f ON f.user_id = u.id")).rows[0];
    const subs = (await q('SELECT * FROM subscriptions')).rows;
    const by = { trial: 0, active: 0, expired: 0, cancelled: 0, ended: 0 };
    let mrr = 0;
    for (const s of subs) { const st = Ops.state(s); by[st]++; if (st === 'active') mrr += num(s.price_cents); }
    const inc = (await q("SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END) FILTER (WHERE paid_at >= date_trunc('month', now())), 0) AS month, COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END), 0) AS total FROM payments WHERE status = 'paid'")).rows[0];
    const projects = num((await q('SELECT count(*) AS c FROM projects')).rows[0].c);
    const errs = (await q("SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS d1, count(*) FILTER (WHERE created_at >= now() - interval '24 hours' AND NOT resolved) AS open1 FROM error_log")).rows[0];
    return {
      currency: cfg.currency,
      users: { total: num(users.total), new7: num(users.new7), suspended: num(users.suspended), active30: num(users.active30) },
      subscriptions: by, mrr_cents: mrr, income: { month_cents: num(inc.month), total_cents: num(inc.total) }, projects,
      ai30: await aiTotals(30), errors24: { total: num(errs.d1), open: num(errs.open1) }, tickets: tickets ? await tickets.stats() : { open: 0, needs_action: 0, counts: {}, ai_fix: { tried: 0, succeeded: 0 } },
      uptime: { d1: await ops.uptime(1), d7: await ops.uptime(7), d30: await ops.uptime(30) },
      series: {
        signups: await series('users', 'count(*)', 30),
        tokens: await (async () => { const a = await series('ai_usage', 'SUM(input_tokens + output_tokens)', 30); const b = await series('chat_log', 'SUM(input_tokens + output_tokens)', 30, 'AND billable'); return a.map((x, i) => ({ d: x.d, v: x.v + b[i].v })); })(),
        income: await (async () => { const rows = (await q("SELECT to_char(date_trunc('day', paid_at), 'YYYY-MM-DD') AS d, SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END) AS v FROM payments WHERE status = 'paid' AND paid_at >= now() - interval '30 days' GROUP BY 1")).rows; const m = new Map(rows.map((r) => [r.d, num(r.v)])); const out = []; for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); out.push({ d, v: m.get(d) || 0 }); } return out; })(),
      },
    };
  });

  // ---------- users ----------
  on('GET', '/users', async ({ query }) => {
    const { size, offset, page: p } = page(query);
    const w = []; const params = [];
    if (query.q) { params.push(like(query.q)); w.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`); }
    if (query.status === 'suspended' || query.status === 'active') { params.push(query.status); w.push(`COALESCE(f.status, 'active') = $${params.length}`); }
    if (query.role === 'super') w.push('COALESCE(f.is_super, false)');
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = num((await q(`SELECT count(*) AS c FROM users u LEFT JOIN user_flags f ON f.user_id = u.id ${where}`, params)).rows[0].c);
    const rows = (await q(`SELECT u.id, u.name, u.email, u.created_at, COALESCE(f.is_super, false) AS is_super, COALESCE(f.status, 'active') AS status, f.last_seen_at, s.status AS sub_status, s.trial_end, s.period_end, s.token_limit, (SELECT count(*) FROM projects pr WHERE pr.owner_id = u.id) AS projects FROM users u LEFT JOIN user_flags f ON f.user_id = u.id LEFT JOIN subscriptions s ON s.user_id = u.id ${where} ORDER BY u.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
    return { total, page: p, size, users: rows.map((r) => ({ ...userOut(r), projects: num(r.projects), subscription: r.sub_status ? Ops.state({ status: r.sub_status, trial_end: r.trial_end, period_end: r.period_end }) : 'none' })) };
  });
  on('GET', '/users/(\\d+)', async ({ m }) => {
    const id = idOf(m[1]); const u = await userRow(id);
    await ops.ensureSubscription(id);
    const sub = (await q('SELECT * FROM subscriptions WHERE user_id = $1', [id])).rows[0];
    const start = ops.periodStart(sub);
    const projects = (await q("SELECT p.id, p.data->'p'->>'name' AS name, p.updated_at, (SELECT role FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1) AS role FROM projects p WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = $1) ORDER BY p.id DESC", [id])).rows;
    const payments = (await q('SELECT id, amount_cents, currency, kind, status, method, reference, note, paid_at FROM payments WHERE user_id = $1 ORDER BY paid_at DESC LIMIT 50', [id])).rows;
    const errors = (await q('SELECT id, kind, status, path, message, created_at FROM error_log WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [id])).rows;
    const used = await ops.tokensUsedSince(id, start);
    return { user: userOut(u), subscription: subView(sub), tokens_used: used, projects: projects.map((p) => ({ id: p.id, name: p.name || 'Untitled', role: p.role, updated_at: iso(p.updated_at) })), payments: payments.map(payView), errors: errors.map((e) => ({ ...e, created_at: iso(e.created_at) })) };
  });
  on('POST', '/users', async ({ admin, body }) => {
    const name = String(body.name || '').trim(), email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
    if (!name || name.length > 120) throw err(400, 'Enter a name up to 120 characters');
    if (!EMAIL_RE.test(email) || email.length > 200) throw err(400, 'Enter a valid email address');
    if (password.length < 8 || password.length > 200) throw err(400, 'Use 8 to 200 characters for the password');
    const salt = crypto.randomBytes(16).toString('hex');
    let row;
    try { row = (await q('INSERT INTO users(email, name, pw_salt, pw_hash) VALUES ($1,$2,$3,$4) RETURNING id', [email, name, salt, await scrypt(password, salt)])).rows[0]; }
    catch (e) { if (/unique|duplicate/i.test(e.message)) throw err(409, 'An account with this email already exists'); throw e; }
    await ops.ensureSubscription(row.id);
    if (body.is_super) await q('INSERT INTO user_flags(user_id, is_super) VALUES ($1, true) ON CONFLICT (user_id) DO UPDATE SET is_super = true', [row.id]);
    await audit(admin, 'user.create', `user:${row.id}`, { email, is_super: !!body.is_super });
    return { user: userOut(await userRow(row.id)) };
  });
  on('PUT', '/users/(\\d+)', async ({ m, admin, body }) => {
    const id = idOf(m[1]); const cur = await userRow(id); const changes = {};
    if ('name' in body) { const n = String(body.name || '').trim(); if (!n || n.length > 120) throw err(400, 'Enter a name up to 120 characters'); await q('UPDATE users SET name = $2 WHERE id = $1', [id, n]); changes.name = n; }
    if ('email' in body) {
      const e = String(body.email || '').trim().toLowerCase(); if (!EMAIL_RE.test(e) || e.length > 200) throw err(400, 'Enter a valid email address');
      try { await q('UPDATE users SET email = $2 WHERE id = $1', [id, e]); } catch (x) { if (/unique|duplicate/i.test(x.message)) throw err(409, 'Another account already uses this email'); throw x; }
      changes.email = e;
    }
    if ('status' in body) {
      if (!['active', 'suspended'].includes(body.status)) throw err(400, 'Choose active or suspended');
      if (body.status === 'suspended' && id === admin.id) throw err(400, 'You cannot suspend your own account');
      if (body.status === 'suspended' && cur.is_super && (await supersLeft(id)) === 0) throw err(400, 'This is the last active super admin');
      await q('INSERT INTO user_flags(user_id, status) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status', [id, body.status]);
      if (body.status === 'suspended') await auth.logoutEverywhere(id);
      changes.status = body.status;
    }
    if ('is_super' in body) {
      const v = !!body.is_super;
      if (!v && cur.is_super && (id === admin.id || (await supersLeft(id)) === 0)) throw err(400, id === admin.id ? 'You cannot remove your own super admin access' : 'This is the last active super admin');
      await q('INSERT INTO user_flags(user_id, is_super) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET is_super = EXCLUDED.is_super', [id, v]);
      changes.is_super = v;
    }
    await audit(admin, 'user.update', `user:${id}`, changes);
    return { user: userOut(await userRow(id)) };
  });
  on('POST', '/users/(\\d+)/password', async ({ m, admin, body }) => {
    const id = idOf(m[1]); await userRow(id);
    const pw = String(body.password || '');
    if (pw.length < 8 || pw.length > 200) throw err(400, 'Use 8 to 200 characters for the password');
    const salt = crypto.randomBytes(16).toString('hex');
    await q('UPDATE users SET pw_salt = $2, pw_hash = $3 WHERE id = $1', [id, salt, await scrypt(pw, salt)]);
    await auth.logoutEverywhere(id);
    await audit(admin, 'user.password_reset', `user:${id}`, {});
    return { ok: true };
  });
  on('POST', '/users/(\\d+)/sign-out', async ({ m, admin }) => { const id = idOf(m[1]); await userRow(id); await auth.logoutEverywhere(id); await audit(admin, 'user.sign_out', `user:${id}`, {}); return { ok: true }; });
  on('DELETE', '/users/(\\d+)', async ({ m, admin, query }) => {
    const id = idOf(m[1]); const u = await userRow(id);
    if (id === admin.id) throw err(400, 'You cannot delete your own account');
    if (u.is_super && (await supersLeft(id)) === 0) throw err(400, 'This is the last active super admin');
    const owned = (await q('SELECT id FROM projects WHERE owner_id = $1', [id])).rows.map((r) => r.id);
    if (owned.length && query.delete_projects !== '1') throw err(409, `This person owns ${owned.length} project${owned.length === 1 ? '' : 's'}. Delete them too, or transfer them first.`);
    for (const pid of owned) await store.remove(pid);
    await q('DELETE FROM users WHERE id = $1', [id]);
    await audit(admin, 'user.delete', `user:${id}`, { email: u.email, projects_deleted: owned.length });
    return { ok: true, projects_deleted: owned.length };
  });

  // ---------- subscriptions ----------
  const subView = (s) => (s ? { user_id: s.user_id, state: Ops.state(s), status: s.status, plan: s.plan, trial_start: iso(s.trial_start), trial_end: iso(s.trial_end), period_start: iso(s.period_start), period_end: iso(s.period_end), price_cents: num(s.price_cents), token_limit: num(s.token_limit), auto_renew: !!s.auto_renew, notes: s.notes || '' } : null);
  on('GET', '/subscriptions', async ({ query }) => {
    await ops.backfillSubscriptions();
    const { size, offset, page: p } = page(query, 25);
    const rows = (await q('SELECT s.*, u.name, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY u.id DESC')).rows;
    const want = query.state;
    const list = [];
    for (const r of rows) { const st = Ops.state(r); if (want && want !== st) continue; if (query.q && !(`${r.name} ${r.email}`.toLowerCase().includes(String(query.q).toLowerCase()))) continue; list.push({ r, st }); }
    const slice = list.slice(offset, offset + size);
    const out = [];
    for (const { r } of slice) out.push({ ...subView(r), name: r.name, email: r.email, tokens_used: await ops.tokensUsedSince(r.user_id, ops.periodStart(r)) });
    return { total: list.length, page: p, size, subscriptions: out };
  });
  on('PUT', '/subscriptions/(\\d+)', async ({ m, admin, body }) => {
    const id = idOf(m[1]); await userRow(id); await ops.ensureSubscription(id);
    const sets = []; const params = [id]; const changes = {};
    const add = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); changes[col] = v; };
    if ('status' in body) { if (!['trial', 'active', 'cancelled'].includes(body.status)) throw err(400, 'Choose trial, active or cancelled'); add('status', body.status); }
    if ('plan' in body) { const v = String(body.plan || '').trim(); if (!v || v.length > 60) throw err(400, 'Enter a plan name up to 60 characters'); add('plan', v); }
    for (const col of ['trial_end', 'period_start', 'period_end']) if (col in body) { if (body[col] === null || body[col] === '') { if (col === 'trial_end') throw err(400, 'The trial end date is required'); add(col, null); } else add(col, dateParam(body[col])); }
    if ('price_cents' in body) { const v = intOf(body.price_cents, NaN); if (!(v >= 0 && v <= 1e8)) throw err(400, 'Enter a price of zero or more'); add('price_cents', v); }
    if ('token_limit' in body) { const v = Number(body.token_limit); if (!Number.isFinite(v) || v < 0 || v > 1e12) throw err(400, 'Enter a token limit of zero or more (zero means no limit)'); add('token_limit', Math.round(v)); }
    if ('auto_renew' in body) add('auto_renew', !!body.auto_renew);
    if ('notes' in body) add('notes', String(body.notes || '').slice(0, 1000));
    if (!sets.length) throw err(400, 'Nothing to change');
    await q(`UPDATE subscriptions SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1`, params);
    await audit(admin, 'subscription.update', `user:${id}`, changes);
    return { subscription: subView((await q('SELECT * FROM subscriptions WHERE user_id = $1', [id])).rows[0]) };
  });
  // Starts or renews a paid period. Optionally records the payment in the same step.
  on('POST', '/subscriptions/(\\d+)/activate', async ({ m, admin, body }) => {
    const id = idOf(m[1]); const u = await userRow(id); await ops.ensureSubscription(id);
    const cfg = await ops.config();
    const days = Math.min(3660, Math.max(1, intOf(body.days, cfg.period_days)));
    const cur = (await q('SELECT * FROM subscriptions WHERE user_id = $1', [id])).rows[0];
    const from = cur.status === 'active' && cur.period_end && new Date(cur.period_end) > new Date() ? new Date(cur.period_end) : new Date();
    const end = new Date(from.getTime() + days * DAY);
    await q("UPDATE subscriptions SET status = 'active', period_start = $2, period_end = $3, updated_at = now() WHERE user_id = $1", [id, from, end]);
    let payment = null;
    if (body.record_payment) {
      const cents = intOf(body.amount_cents, cur.price_cents);
      if (!(cents > 0)) throw err(400, 'Enter an amount above zero to record a payment');
      payment = await addPayment(admin, { user_id: id, email: u.email, amount_cents: cents, currency: cfg.currency, kind: 'payment', method: String(body.method || 'manual'), reference: String(body.reference || ''), note: 'Subscription period' });
    }
    await audit(admin, 'subscription.activate', `user:${id}`, { days, payment: payment && payment.id });
    return { subscription: subView((await q('SELECT * FROM subscriptions WHERE user_id = $1', [id])).rows[0]), payment };
  });

  // ---------- finance ----------
  const payView = (p) => ({ id: p.id, user_id: p.user_id, email: p.email, name: p.name || null, amount_cents: num(p.amount_cents), currency: p.currency, kind: p.kind, status: p.status, method: p.method, reference: p.reference, note: p.note, paid_at: iso(p.paid_at) });
  async function addPayment(admin, b) {
    const cents = Math.round(Number(b.amount_cents));
    if (!Number.isFinite(cents) || cents <= 0 || cents > 1e11) throw err(400, 'Enter an amount above zero');
    const kind = b.kind === 'refund' ? 'refund' : 'payment';
    const cur = String(b.currency || 'USD').toUpperCase(); if (!/^[A-Z]{3}$/.test(cur)) throw err(400, 'Use a three letter currency code');
    let email = String(b.email || '').trim().toLowerCase(), uid = b.user_id ? idOf(b.user_id) : null;
    if (uid) email = (await userRow(uid)).email;
    const id = store.nid();
    await q('INSERT INTO payments(id, user_id, email, amount_cents, currency, kind, status, method, reference, note, paid_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, uid, email, cents, cur, kind, b.status === 'demo' ? 'demo' : 'paid', String(b.method || '').slice(0, 60), String(b.reference || '').slice(0, 120), String(b.note || '').slice(0, 500), dateParam(b.paid_at, new Date()), admin ? admin.id : null]);
    return payView((await q('SELECT * FROM payments WHERE id = $1', [id])).rows[0]);
  }
  on('GET', '/finance', async ({ query }) => {
    const to = dateParam(query.to, new Date()); const from = dateParam(query.from, new Date(to.getTime() - 365 * DAY));
    const base = "WHERE paid_at >= $1 AND paid_at <= $2";
    const sum = (await q(`SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_cents ELSE 0 END) FILTER (WHERE status = 'paid'), 0) AS gross, COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_cents ELSE 0 END) FILTER (WHERE status = 'paid'), 0) AS refunds, count(*) FILTER (WHERE status = 'paid' AND kind = 'payment') AS payments, COALESCE(SUM(amount_cents) FILTER (WHERE status = 'demo'), 0) AS demo FROM payments ${base}`, [from, to])).rows[0];
    const months = (await q(`SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS m, SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END) AS v FROM payments ${base} AND status = 'paid' GROUP BY 1 ORDER BY 1`, [from, to])).rows;
    const byMethod = (await q(`SELECT COALESCE(NULLIF(method, ''), 'other') AS method, SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END) AS v FROM payments ${base} AND status = 'paid' GROUP BY 1 ORDER BY 2 DESC`, [from, to])).rows;
    const top = (await q(`SELECT email, SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END) AS v FROM payments ${base} AND status = 'paid' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [from, to])).rows;
    const subs = (await q('SELECT * FROM subscriptions')).rows;
    const activeSubs = subs.filter((s) => Ops.state(s) === 'active');
    const mrr = activeSubs.reduce((a, s) => a + num(s.price_cents), 0);
    const aiCost = await ops.cost(...(await (async () => { const t = await aiTotals(Math.max(1, Math.ceil((to - from) / DAY))); return [t.input, t.output]; })()));
    const net = num(sum.gross) - num(sum.refunds);
    const cfg = await ops.config();
    const { size, offset, page: p } = page(query, 25);
    const total = num((await q(`SELECT count(*) AS c FROM payments ${base}`, [from, to])).rows[0].c);
    const rows = (await q(`SELECT p.*, u.name FROM payments p LEFT JOIN users u ON u.id = p.user_id ${base.replace(/paid_at/g, 'p.paid_at')} ORDER BY p.paid_at DESC, p.id DESC LIMIT ${size} OFFSET ${offset}`, [from, to])).rows;
    return {
      currency: cfg.currency, from: iso(from), to: iso(to),
      note: 'There is no payment processor connected. Income is what is recorded in the ledger. Payments marked demo come from the in app demo subscribe step and are not counted as income.',
      totals: { gross_cents: num(sum.gross), refunds_cents: num(sum.refunds), net_cents: net, payments: num(sum.payments), demo_cents: num(sum.demo), mrr_cents: mrr, arr_cents: mrr * 12, active_subscribers: activeSubs.length, ai_cost_usd: aiCost, margin_usd: net / 100 - aiCost },
      by_month: months.map((r) => ({ month: r.m, cents: num(r.v) })), by_method: byMethod.map((r) => ({ method: r.method, cents: num(r.v) })), top_customers: top.map((r) => ({ email: r.email || 'Unknown', cents: num(r.v) })),
      payments: { total, page: p, size, rows: rows.map(payView) },
    };
  });
  on('POST', '/payments', async ({ admin, body }) => { const p = await addPayment(admin, body); await audit(admin, 'payment.create', `payment:${p.id}`, { amount_cents: p.amount_cents, kind: p.kind, email: p.email }); return { payment: p }; });
  on('PUT', '/payments/(\\d+)', async ({ m, admin, body }) => {
    const id = idOf(m[1]); const cur = (await q('SELECT * FROM payments WHERE id = $1', [id])).rows[0]; if (!cur) throw err(404, 'Payment not found');
    const merged = { amount_cents: 'amount_cents' in body ? body.amount_cents : cur.amount_cents, currency: body.currency || cur.currency, kind: body.kind || cur.kind, method: 'method' in body ? body.method : cur.method, reference: 'reference' in body ? body.reference : cur.reference, note: 'note' in body ? body.note : cur.note, paid_at: body.paid_at || cur.paid_at, status: body.status || cur.status };
    const cents = Math.round(Number(merged.amount_cents)); if (!Number.isFinite(cents) || cents <= 0) throw err(400, 'Enter an amount above zero');
    if (!/^[A-Z]{3}$/i.test(merged.currency)) throw err(400, 'Use a three letter currency code');
    await q('UPDATE payments SET amount_cents = $2, currency = $3, kind = $4, method = $5, reference = $6, note = $7, paid_at = $8, status = $9 WHERE id = $1', [id, cents, String(merged.currency).toUpperCase(), merged.kind === 'refund' ? 'refund' : 'payment', String(merged.method || '').slice(0, 60), String(merged.reference || '').slice(0, 120), String(merged.note || '').slice(0, 500), dateParam(merged.paid_at, new Date()), merged.status === 'demo' ? 'demo' : 'paid']);
    await audit(admin, 'payment.update', `payment:${id}`, body);
    return { payment: payView((await q('SELECT * FROM payments WHERE id = $1', [id])).rows[0]) };
  });
  on('DELETE', '/payments/(\\d+)', async ({ m, admin }) => { const id = idOf(m[1]); const r = await q('DELETE FROM payments WHERE id = $1 RETURNING email, amount_cents', [id]); if (!r.rows.length) throw err(404, 'Payment not found'); await audit(admin, 'payment.delete', `payment:${id}`, r.rows[0]); return { ok: true }; });

  // ---------- AI consumption ----------
  on('GET', '/ai', async ({ query }) => {
    const days = Math.min(365, Math.max(1, intOf(query.days, 30)));
    const cfg = await ops.config();
    const totals = await aiTotals(days);
    const bySource = [];
    const a = (await q("SELECT source, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, count(*) AS calls FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval GROUP BY 1", [String(days)])).rows;
    for (const r of a) bySource.push({ source: r.source, input: num(r.i), output: num(r.o), calls: num(r.calls) });
    const c = (await q("SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, count(*) AS calls FROM chat_log WHERE billable AND (input_tokens > 0 OR output_tokens > 0) AND created_at >= now() - ($1 || ' days')::interval", [String(days)])).rows[0];
    if (num(c.calls)) bySource.push({ source: 'thinking area', input: num(c.i), output: num(c.o), calls: num(c.calls) });
    for (const s of bySource) s.cost = await ops.cost(s.input, s.output);
    const perUser = (await q(`SELECT u.id, u.email, u.name, SUM(t.i) AS i, SUM(t.o) AS o, SUM(t.calls) AS calls FROM (
      SELECT user_id, input_tokens AS i, output_tokens AS o, 1 AS calls FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval
      UNION ALL SELECT user_id, input_tokens, output_tokens, 1 FROM chat_log WHERE billable AND (input_tokens > 0 OR output_tokens > 0) AND created_at >= now() - ($1 || ' days')::interval) t
      JOIN users u ON u.id = t.user_id GROUP BY u.id, u.email, u.name ORDER BY SUM(t.i + t.o) DESC LIMIT 25`, [String(days)])).rows;
    const dayRows = (await q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, SUM(i) AS i, SUM(o) AS o FROM (
      SELECT created_at, input_tokens AS i, output_tokens AS o FROM ai_usage UNION ALL SELECT created_at, input_tokens, output_tokens FROM chat_log WHERE billable) t
      WHERE created_at >= now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 1`, [String(days)])).rows;
    const dm = new Map(dayRows.map((r) => [r.d, r])); const daily = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); const r = dm.get(d); const inp = r ? num(r.i) : 0, out = r ? num(r.o) : 0; daily.push({ d, input: inp, output: out, cost: (inp / 1e6) * cfg.ai_price_input_per_m + (out / 1e6) * cfg.ai_price_output_per_m }); }
    const models = (await q("SELECT model, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, count(*) AS calls FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC", [String(days)])).rows;
    return {
      days, totals, rates: { input_per_m: cfg.ai_price_input_per_m, output_per_m: cfg.ai_price_output_per_m },
      note: 'Cost is an estimate: tokens multiplied by the rates in Configuration. Set the rates of your model there. Usage before this feature existed is not recorded, and the project chat tokens come from the chat log, which keeps 90 days.',
      configured: !!process.env.ANTHROPIC_API_KEY, by_source: bySource, by_model: models.map((r) => ({ model: r.model || 'unknown', input: num(r.i), output: num(r.o), calls: num(r.calls) })),
      top_users: await Promise.all(perUser.map(async (r) => ({ id: r.id, email: r.email, name: r.name, input: num(r.i), output: num(r.o), calls: num(r.calls), cost: await ops.cost(num(r.i), num(r.o)) }))), daily,
    };
  });

  // ---------- projects ----------
  on('GET', '/projects', async ({ query }) => {
    const { size, offset, page: p } = page(query);
    const params = []; let where = '';
    if (query.q) { params.push(like(query.q)); where = `WHERE (p.data->'p'->>'name' ILIKE $1 OR o.email ILIKE $1)`; }
    const total = num((await q(`SELECT count(*) AS c FROM projects p JOIN users o ON o.id = p.owner_id ${where}`, params)).rows[0].c);
    const rows = (await q(`SELECT p.id, p.data->'p'->>'name' AS name, p.owner_id, o.email AS owner_email, o.name AS owner_name, p.created_at, p.updated_at, (SELECT count(*) FROM project_members m WHERE m.project_id = p.id) AS members, jsonb_array_length(COALESCE(p.data->'tasks', '[]'::jsonb)) AS tasks FROM projects p JOIN users o ON o.id = p.owner_id ${where} ORDER BY p.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
    return { total, page: p, size, projects: rows.map((r) => ({ id: r.id, name: r.name || 'Untitled', owner_id: r.owner_id, owner_email: r.owner_email, owner_name: r.owner_name, members: num(r.members), tasks: num(r.tasks), created_at: iso(r.created_at), updated_at: iso(r.updated_at) })) };
  });
  on('GET', '/projects/(\\d+)', async ({ m }) => {
    const id = idOf(m[1]); const r = (await q("SELECT p.id, p.data->'p'->>'name' AS name, p.owner_id, p.created_at, p.updated_at, pg_column_size(p.data) AS bytes FROM projects p WHERE p.id = $1", [id])).rows[0];
    if (!r) throw err(404, 'Project not found');
    return { project: { id: r.id, name: r.name || 'Untitled', owner_id: r.owner_id, created_at: iso(r.created_at), updated_at: iso(r.updated_at), bytes: num(r.bytes) }, members: (await store.members(id)).map((x) => ({ user_id: x.user_id, name: x.name, email: x.email, role: x.role })) };
  });
  on('PUT', '/projects/(\\d+)', async ({ m, admin, body }) => {
    const id = idOf(m[1]); const r = (await q('SELECT id, owner_id FROM projects WHERE id = $1', [id])).rows[0]; if (!r) throw err(404, 'Project not found');
    if (body.owner_id) {
      const nu = await userRow(idOf(body.owner_id));
      await db.tx(async (t) => {
        await t.query('UPDATE projects SET owner_id = $2 WHERE id = $1', [id, nu.id]);
        await t.query("INSERT INTO project_members(project_id, user_id, role) VALUES ($1,$2,'manager') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'manager'", [id, nu.id]);
      });
      store.cache.delete(id);
      await audit(admin, 'project.transfer', `project:${id}`, { from: r.owner_id, to: nu.id });
    }
    return { ok: true };
  });
  on('DELETE', '/projects/(\\d+)', async ({ m, admin }) => { const id = idOf(m[1]); const r = (await q("SELECT data->'p'->>'name' AS name FROM projects WHERE id = $1", [id])).rows[0]; if (!r) throw err(404, 'Project not found'); await store.remove(id); await audit(admin, 'project.delete', `project:${id}`, { name: r.name }); return { ok: true }; });

  // ---------- widgets ----------
  on('GET', '/widgets', async ({ query }) => {
    const { size, offset, page: p } = page(query);
    const total = num((await q('SELECT count(*) AS c FROM widgets')).rows[0].c);
    const rows = (await q('SELECT w.id, w.title, w.grp, w.status, w.version, w.updated_at, u.email AS owner, (SELECT count(*) FROM widget_installs i WHERE i.widget_id = w.id) AS installs, (SELECT ROUND(AVG(stars), 1) FROM widget_ratings r WHERE r.widget_id = w.id) AS rating FROM widgets w JOIN users u ON u.id = w.owner_id ORDER BY w.id DESC LIMIT ' + size + ' OFFSET ' + offset)).rows;
    return { total, page: p, size, widgets: rows.map((r) => ({ id: r.id, title: r.title, group: r.grp, status: r.status, version: r.version, owner: r.owner, installs: num(r.installs), rating: r.rating == null ? null : Number(r.rating), updated_at: iso(r.updated_at) })) };
  });
  on('POST', '/widgets/(\\d+)/status', async ({ m, admin, body }) => {
    const id = idOf(m[1]); if (!['published', 'unpublished'].includes(body.status)) throw err(400, 'Choose published or unpublished');
    const w = (await q('SELECT status, published_spec FROM widgets WHERE id = $1', [id])).rows[0]; if (!w) throw err(404, 'Widget not found');
    if (body.status === 'published' && !w.published_spec) throw err(400, 'This widget was never published by its author, so there is nothing to republish');
    await q('UPDATE widgets SET status = $2, updated_at = now() WHERE id = $1', [id, body.status]);
    await audit(admin, 'widget.status', `widget:${id}`, { status: body.status });
    return { ok: true };
  });
  on('DELETE', '/widgets/(\\d+)', async ({ m, admin }) => { const id = idOf(m[1]); const r = await q('DELETE FROM widgets WHERE id = $1 RETURNING title', [id]); if (!r.rows.length) throw err(404, 'Widget not found'); await audit(admin, 'widget.delete', `widget:${id}`, r.rows[0]); return { ok: true }; });

  // ---------- configuration ----------
  on('GET', '/config', async () => ({ settings: await ops.configRows(), environment: { anthropic_key: !!process.env.ANTHROPIC_API_KEY, database: db.kind, replit_deployment: process.env.REPLIT_DEPLOYMENT === '1', site_url: process.env.SITE_URL || null, app_tz: process.env.APP_TZ || 'Asia/Dubai', jira_oauth: !!process.env.ATLASSIAN_CLIENT_ID, outlook_oauth: !!process.env.MICROSOFT_CLIENT_ID, demo_account: process.env.DEMO_ACCOUNT === '1', super_admin_emails: ops.adminEmails(), note: 'Secrets and connection strings are managed in Replit Secrets. They are never shown here.' } }));
  on('PUT', '/config', async ({ admin, body }) => { const done = await ops.setConfig(body.settings || body, admin.id); await audit(admin, 'config.update', 'config', done); return { settings: await ops.configRows() }; });

  // ---------- health ----------
  on('GET', '/health', async () => {
    const t0 = Date.now(); let dbOk = true, dbMs = 0;
    try { await q('SELECT 1'); dbMs = Date.now() - t0; } catch (e) { dbOk = false; }
    const beats = (await q("SELECT beat, db_ms, mem_mb FROM health_beats WHERE beat >= now() - interval '3 hours' ORDER BY beat")).rows;
    const err1 = (await q("SELECT count(*) FILTER (WHERE created_at >= now() - interval '1 hour') AS h1, count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS h24 FROM error_log WHERE kind = 'server'")).rows[0];
    const sizes = (await q("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM projects) AS projects, (SELECT count(*) FROM sessions WHERE expires_at > now()) AS sessions")).rows[0];
    const sys = ops.system();
    const issues = [];
    if (!dbOk) issues.push('The database did not answer.');
    if (dbMs > 500) issues.push('The database is slow (over 500 ms).');
    if (!process.env.ANTHROPIC_API_KEY) issues.push('No Anthropic API key is set, so AI features use the basic rule based reading.');
    if (num(err1.h1) >= 10) issues.push('Ten or more server errors in the last hour.');
    if (sys.rss_mb > 1500) issues.push('Memory use is high.');
    return { status: !dbOk ? 'down' : issues.some((x) => !/Anthropic/.test(x)) ? 'degraded' : 'healthy', issues, database: { ok: dbOk, kind: db.kind, latency_ms: dbMs }, system: sys, uptime: { d1: await ops.uptime(1), d7: await ops.uptime(7), d30: await ops.uptime(30) }, server_errors: { last_hour: num(err1.h1), last_24h: num(err1.h24) }, counts: { users: num(sizes.users), projects: num(sizes.projects), sessions: num(sizes.sessions) }, beats: beats.map((b) => ({ at: iso(b.beat), db_ms: b.db_ms, mem_mb: b.mem_mb })) };
  });

  // ---------- project manager usability ----------
  on('GET', '/usability', async ({ query }) => usage.report(query.days));

  // ---------- error log ----------
  on('GET', '/errors', async ({ query }) => {
    const { size, offset, page: p } = page(query);
    const w = []; const params = [];
    if (query.kind === 'server' || query.kind === 'browser') { params.push(query.kind); w.push(`e.kind = $${params.length}`); }
    if (query.resolved === '0') w.push('NOT e.resolved'); else if (query.resolved === '1') w.push('e.resolved');
    if (query.q) { params.push(like(query.q)); w.push(`(e.message ILIKE $${params.length} OR e.path ILIKE $${params.length} OR e.ref ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = num((await q(`SELECT count(*) AS c FROM error_log e LEFT JOIN users u ON u.id = e.user_id ${where}`, params)).rows[0].c);
    const rows = (await q(`SELECT e.*, u.email FROM error_log e LEFT JOIN users u ON u.id = e.user_id ${where} ORDER BY e.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
    const groups = (await q("SELECT message, kind, count(*) AS n, max(created_at) AS last FROM error_log WHERE created_at >= now() - interval '24 hours' AND NOT resolved GROUP BY message, kind ORDER BY n DESC LIMIT 8")).rows;
    return { total, page: p, size, groups: groups.map((g) => ({ message: g.message, kind: g.kind, count: num(g.n), last: iso(g.last) })), errors: rows.map((e) => ({ id: e.id, kind: e.kind, status: e.status, method: e.method, path: e.path, message: e.message, stack: e.stack, ref: e.ref, agent: e.agent, resolved: e.resolved, email: e.email || null, created_at: iso(e.created_at) })) };
  });
  on('POST', '/errors/(\\d+)/resolve', async ({ m, admin, body }) => { const id = idOf(m[1]); const r = await q('UPDATE error_log SET resolved = $2 WHERE id = $1 RETURNING id', [id, body.resolved !== false]); if (!r.rows.length) throw err(404, 'Error not found'); await audit(admin, 'error.resolve', `error:${id}`, { resolved: body.resolved !== false }); return { ok: true }; });
  on('POST', '/errors/resolve-all', async ({ admin }) => { const r = await q('UPDATE error_log SET resolved = true WHERE NOT resolved RETURNING id'); await audit(admin, 'error.resolve_all', 'errors', { count: r.rows.length }); return { ok: true, count: r.rows.length }; });
  on('DELETE', '/errors/(\\d+)', async ({ m, admin }) => { const id = idOf(m[1]); await q('DELETE FROM error_log WHERE id = $1', [id]); await audit(admin, 'error.delete', `error:${id}`, {}); return { ok: true }; });
  on('DELETE', '/errors', async ({ admin, query }) => { if (query.resolved !== '1') throw err(400, 'Only resolved errors can be cleared in bulk'); const r = await q('DELETE FROM error_log WHERE resolved RETURNING id'); await audit(admin, 'error.clear_resolved', 'errors', { count: r.rows.length }); return { ok: true, count: r.rows.length }; });

  // ---------- audit ----------
  on('GET', '/audit', async ({ query }) => {
    const { size, offset, page: p } = page(query, 50);
    const params = []; let where = '';
    if (query.q) { params.push(like(query.q)); where = 'WHERE action ILIKE $1 OR target ILIKE $1 OR admin_email ILIKE $1'; }
    const total = num((await q(`SELECT count(*) AS c FROM admin_audit ${where}`, params)).rows[0].c);
    const rows = (await q(`SELECT * FROM admin_audit ${where} ORDER BY id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
    return { total, page: p, size, entries: rows.map((r) => ({ id: r.id, admin: r.admin_email, action: r.action, target: r.target, detail: r.detail, at: iso(r.created_at) })) };
  });

  // ---------- support tickets (see tickets.js) ----------
  if (tickets) tickets.registerAdmin({ on, audit, idOf, page, like });

  // ---------- routing ----------
  // Returns true when it handled the request. "ctx" brings the JSON helpers from app.js.
  async function route(req, res, url, user, c) {
    if (!url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin') return false;
    // the super admin switch is read from the database on every request, never from a cache
    const fresh = (await q("SELECT u.id, u.name, u.email, COALESCE(f.is_super, false) AS is_super, COALESCE(f.status, 'active') AS status FROM users u LEFT JOIN user_flags f ON f.user_id = u.id WHERE u.id = $1", [user.id])).rows[0];
    if (!fresh || !fresh.is_super || fresh.status !== 'active') { c.json(res, 403, { error: 'This area is for super admins only.' }); return true; }
    if (url.pathname === '/api/admin/finance/export.csv' && req.method === 'GET') {
      const rows = (await q('SELECT p.*, u.name FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.paid_at DESC, p.id DESC')).rows;
      const head = ['id', 'date', 'name', 'email', 'kind', 'status', 'amount', 'currency', 'method', 'reference', 'note'];
      const body = [head.join(',')].concat(rows.map((r) => [r.id, iso(r.paid_at), r.name || '', r.email, r.kind, r.status, (num(r.amount_cents) / 100).toFixed(2), r.currency, r.method, r.reference, r.note].map(csvCell).join(','))).join('\n');
      await audit(fresh, 'finance.export', 'payments', { rows: rows.length });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payments.csv"', 'Cache-Control': 'no-store', ...c.SECURITY });
      res.end(body);
      return true;
    }
    for (const [method, re, fn] of routes) {
      if (method !== req.method) continue;
      const m = url.pathname.match(re); if (!m) continue;
      let body = {};
      if (method !== 'GET') { const raw = await c.readBody(req, 256 * 1024); if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch (e) { throw err(400, 'The request body is not valid JSON'); } } }
      c.json(res, 200, await fn({ m, admin: fresh, body, query: Object.fromEntries(url.searchParams), origin: c.origin ? c.origin(req) : '' }));
      return true;
    }
    throw err(404, 'Not found');
  }
  return { route, addPayment, audit };
};
