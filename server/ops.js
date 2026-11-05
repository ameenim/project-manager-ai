// Operations layer. Runtime configuration, subscriptions, AI usage metering, the error log and health beats.
// The app uses it to record what happens. The super admin area (admin.js) reads and manages it.
'use strict';
const os = require('os');

const err = (status, message) => Object.assign(new Error(message), { status });
const DAY = 86400e3;

// Each setting has a default, a type and limits. Anything else is rejected so the config cannot be filled with junk.
const CONFIG = {
  trial_days: { def: 15, type: 'int', min: 0, max: 365, label: 'Free trial length in days' },
  plan_name: { def: 'Monthly', type: 'text', max: 60, label: 'Plan name' },
  price_cents: { def: 2500, type: 'int', min: 0, max: 100000000, label: 'Plan price in cents' },
  currency: { def: 'USD', type: 'text', max: 3, label: 'Currency code' },
  period_days: { def: 30, type: 'int', min: 1, max: 366, label: 'Billing period in days' },
  token_limit: { def: 10000000, type: 'int', min: 0, max: 1e12, label: 'Tokens per period for new subscriptions' },
  ai_price_input_per_m: { def: 3, type: 'num', min: 0, max: 100000, label: 'AI cost per million input tokens (USD)' },
  ai_price_output_per_m: { def: 15, type: 'num', min: 0, max: 100000, label: 'AI cost per million output tokens (USD)' },
  signup_enabled: { def: true, type: 'bool', label: 'Allow new sign ups' },
  self_serve_subscribe: { def: true, type: 'bool', label: 'Allow people to subscribe themselves in the app' },
  enforce_limits: { def: false, type: 'bool', label: 'Block AI use when a plan has ended or tokens are used up' },
  maintenance_mode: { def: false, type: 'bool', label: 'Maintenance mode (only super admins can use the app)' },
  maintenance_message: { def: 'The service is being updated. Please try again in a few minutes.', type: 'text', max: 300, label: 'Maintenance message' },
  ticket_ai_triage: { def: true, type: 'bool', label: 'Let AI triage new support tickets' },
  auto_error_tickets: { def: true, type: 'bool', label: 'Open a ticket automatically when the same server error repeats' },
  fix_max_attempts: { def: 3, type: 'int', min: 1, max: 10, label: 'AI fix attempts allowed per ticket' },
  fix_daily_cap: { def: 10, type: 'int', min: 0, max: 200, label: 'AI fixes allowed per day (0 turns Fix it off)' },
};

function cleanValue(key, v) {
  const d = CONFIG[key];
  if (!d) throw err(400, `Unknown setting: ${key}`);
  if (d.type === 'bool') { if (typeof v !== 'boolean') throw err(400, `${d.label} must be on or off`); return v; }
  if (d.type === 'text') { const s = String(v == null ? '' : v).trim(); if (s.length > d.max) throw err(400, `${d.label} is too long`); if (key === 'currency' && !/^[A-Za-z]{3}$/.test(s)) throw err(400, 'Use a three letter currency code'); return key === 'currency' ? s.toUpperCase() : s; }
  const n = Number(v);
  if (!Number.isFinite(n) || (d.type === 'int' && !Number.isInteger(n))) throw err(400, `${d.label} must be a ${d.type === 'int' ? 'whole ' : ''}number`);
  if (n < d.min || n > d.max) throw err(400, `${d.label} must be between ${d.min} and ${d.max}`);
  return n;
}

class Ops {
  constructor(db, store) {
    this.db = db; this.store = store;
    this.cfg = null; this.cfgAt = 0;
    this.startedAt = Date.now();
    this.counters = { requests: 0, errors: 0 };
    this.seen = new Map();
    this.timers = [];
  }
  q(text, params) { return this.db.query(text, params); }

  // ---------- configuration ----------
  async config(fresh) {
    if (!fresh && this.cfg && Date.now() - this.cfgAt < 15000) return this.cfg;
    const out = {};
    for (const k of Object.keys(CONFIG)) out[k] = CONFIG[k].def;
    try { for (const r of (await this.q('SELECT key, value FROM app_config')).rows) if (CONFIG[r.key]) out[r.key] = r.value; } catch (e) { console.error('config read', e.message); }
    this.cfg = out; this.cfgAt = Date.now();
    return out;
  }
  async configRows() {
    const cur = await this.config(true);
    const meta = (await this.q('SELECT key, updated_at, updated_by FROM app_config')).rows;
    return Object.keys(CONFIG).map((k) => ({ key: k, value: cur[k], default: CONFIG[k].def, type: CONFIG[k].type, label: CONFIG[k].label, min: CONFIG[k].min, max: CONFIG[k].max, updated_at: (meta.find((m) => m.key === k) || {}).updated_at || null }));
  }
  async setConfig(patch, adminId) {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) clean[k] = cleanValue(k, v);
    for (const [k, v] of Object.entries(clean)) await this.q('INSERT INTO app_config(key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()', [k, JSON.stringify(v), adminId || null]);
    this.cfg = null;
    return clean;
  }

  // ---------- super admins ----------
  adminEmails() { return String(process.env.SUPER_ADMIN_EMAILS || 'ameenim@gmail.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); }
  isReservedEmail(email) { return this.adminEmails().includes(String(email || '').trim().toLowerCase()); }
  // Only an account that already exists is promoted. A reserved address cannot be registered by the public (see app.js),
  // so nobody can claim the super admin account by signing up first.
  async bootstrapSuperAdmins() {
    const r = await this.q('INSERT INTO user_flags(user_id, is_super) SELECT id, true FROM users WHERE email = ANY($1::text[]) ON CONFLICT (user_id) DO UPDATE SET is_super = true RETURNING user_id', [this.adminEmails()]);
    return r.rows.length;
  }
  touchSeen(userId) {
    const now = Date.now();
    if (now - (this.seen.get(userId) || 0) < 5 * 60e3) return;
    this.seen.set(userId, now);
    this.q('INSERT INTO user_flags(user_id, last_seen_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()', [userId]).catch(() => {});
  }

  // ---------- subscriptions ----------
  async ensureSubscription(userId) {
    const c = await this.config();
    await this.q('INSERT INTO subscriptions(user_id, plan, trial_start, trial_end, price_cents, token_limit) VALUES ($1, $2, now(), now() + ($3 || \' days\')::interval, $4, $5) ON CONFLICT (user_id) DO NOTHING', [userId, c.plan_name, String(c.trial_days), c.price_cents, c.token_limit]);
  }
  async backfillSubscriptions() {
    const c = await this.config();
    await this.q('INSERT INTO subscriptions(user_id, plan, trial_start, trial_end, price_cents, token_limit) SELECT u.id, $1, now(), now() + ($2 || \' days\')::interval, $3, $4 FROM users u WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)', [c.plan_name, String(c.trial_days), c.price_cents, c.token_limit]);
  }
  // The state a person is in right now. "expired" means the trial or paid period ran out.
  static state(s, now = Date.now()) {
    if (!s) return 'trial';
    const t = (v) => (v ? new Date(v).getTime() : 0);
    if (s.status === 'cancelled') return t(s.period_end) > now ? 'cancelled' : 'ended';
    if (s.status === 'active') return t(s.period_end) > now ? 'active' : 'expired';
    return t(s.trial_end) > now ? 'trial' : 'expired';
  }
  periodStart(s) { return s.status === 'active' || (s.status === 'cancelled' && s.period_start) ? s.period_start : s.trial_start; }
  async tokensUsedSince(userId, since) {
    const a = (await this.q('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM ai_usage WHERE user_id = $1 AND created_at >= $2', [userId, since])).rows[0].n;
    const b = (await this.q('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM chat_log WHERE user_id = $1 AND billable AND created_at >= $2', [userId, since])).rows[0].n;
    return Number(a) + Number(b);
  }
  // Used before an AI call when "enforce_limits" is on. Super admins are never blocked.
  async allowance(user) {
    const c = await this.config();
    if (!c.enforce_limits || user.is_super) return null;
    await this.ensureSubscription(user.id);
    const s = (await this.q('SELECT * FROM subscriptions WHERE user_id = $1', [user.id])).rows[0];
    const st = Ops.state(s);
    if (st === 'expired' || st === 'ended') return 'Your plan has ended. Subscribe to continue.';
    if (Number(s.token_limit) > 0 && (await this.tokensUsedSince(user.id, this.periodStart(s))) >= Number(s.token_limit)) return 'You have used all of your tokens for this period.';
    return null;
  }

  // ---------- AI usage ----------
  async recordUsage({ userId, projectId, source, model, input, output }) {
    if (!input && !output) return;
    try { await this.q('INSERT INTO ai_usage(id, user_id, project_id, source, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7)', [this.store.nid(), userId || null, projectId || null, source || 'ai', model || '', Math.round(input || 0), Math.round(output || 0)]); }
    catch (e) { console.error('usage log', e.message); }
  }
  async cost(inTok, outTok) {
    const c = await this.config();
    return (Number(inTok) / 1e6) * c.ai_price_input_per_m + (Number(outTok) / 1e6) * c.ai_price_output_per_m;
  }

  // ---------- errors ----------
  async logError(e) {
    this.counters.errors++;
    try {
      await this.q('INSERT INTO error_log(id, user_id, kind, status, method, path, message, stack, ref, agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [this.store.nid(), e.userId || null, e.kind, e.status || null, String(e.method || '').slice(0, 10), String(e.path || '').slice(0, 300), String(e.message || '').slice(0, 1000), String(e.stack || '').slice(0, 4000), String(e.ref || '').slice(0, 40), String(e.agent || '').slice(0, 300)]);
    } catch (x) { console.error('error log', x.message); }
  }

  // ---------- health ----------
  async beat() {
    const t0 = Date.now();
    await this.q('SELECT 1');
    const ms = Date.now() - t0;
    await this.q("INSERT INTO health_beats(beat, db_ms, mem_mb) VALUES (date_trunc('minute', now()), $1, $2) ON CONFLICT (beat) DO NOTHING", [ms, Math.round(process.memoryUsage().rss / 1048576)]);
  }
  start() {
    const run = () => this.beat().catch((e) => console.error('health beat', e.message));
    const prune = () => Promise.all([
      this.q("DELETE FROM health_beats WHERE beat < now() - interval '35 days'"),
      this.q("DELETE FROM error_log WHERE created_at < now() - interval '90 days'"),
      this.q("DELETE FROM ai_usage WHERE created_at < now() - interval '400 days'"),
    ]).catch(() => {});
    run(); prune();
    this.timers.push(setInterval(run, 60e3), setInterval(prune, 6 * 3600e3));
    this.timers.forEach((t) => t.unref());
  }
  stop() { this.timers.forEach((t) => clearInterval(t)); this.timers = []; }
  // Uptime is the share of expected minutes that have a beat, counted from the first beat inside the window.
  // A minute without a beat means the server was not running, so a restart or an outage shows as lost uptime.
  async uptime(days) {
    const r = (await this.q('SELECT count(*) AS n, min(beat) AS first FROM health_beats WHERE beat >= now() - ($1 || \' days\')::interval', [String(days)])).rows[0];
    if (!Number(r.n)) return { pct: null, beats: 0, expected: 0 };
    const expected = Math.max(1, Math.floor((Date.now() - new Date(r.first).getTime()) / 60e3) + 1);
    return { pct: Math.min(100, Math.round((Number(r.n) / expected) * 10000) / 100), beats: Number(r.n), expected };
  }
  system() {
    const m = process.memoryUsage();
    return { started_at: new Date(this.startedAt).toISOString(), uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000), node: process.version, platform: `${os.platform()} ${os.arch()}`, rss_mb: Math.round(m.rss / 1048576), heap_mb: Math.round(m.heapUsed / 1048576), load: os.loadavg().map((x) => Math.round(x * 100) / 100), cpus: os.cpus().length, requests_since_start: this.counters.requests, errors_since_start: this.counters.errors };
  }
}

module.exports = { Ops, CONFIG, DAY };
