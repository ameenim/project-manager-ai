// Accounts and sessions. Passwords are hashed with scrypt and a per user salt. A session token is random,
// only its SHA-256 hash is stored, and it expires after 30 days at most. The super admin also sets how many minutes a person can stay signed in (default 60),
// counted from sign in. That limit is checked on every request, so changing it applies to people already signed in.
'use strict';
const crypto = require('crypto');
const mailer = require('./mailer');

const SESSION_DAYS = 30;
const MAX_SESSIONS = 20;
const DEFAULT_MINUTES = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const err = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k.toString('hex')))));

// Failed sign in attempts are counted three ways. Per address and email stops a simple guess loop. Per address stops one
// machine trying many emails. Per email stops a spread out attack on one account from many addresses. The email limit is
// higher than the others so a stranger cannot lock a real person out with a handful of wrong guesses.
const fails = new Map();
const WINDOW = 10 * 60e3;
const LIMITS = [['pair', 8], ['ip', 40], ['email', 30]];
const keysFor = (ip, email) => [`pair|${ip || ''}|${email}`, `ip|${ip || ''}`, `email|${email}`];
function tooMany(keys, limits = LIMITS.map((l) => l[1])) {
  const now = Date.now();
  return keys.some((key, i) => {
    const list = (fails.get(key) || []).filter((t) => now - t < WINDOW);
    fails.set(key, list);
    return list.length >= limits[i];
  });
}
const noteFail = (keys) => { for (const key of keys) { const l = fails.get(key) || []; l.push(Date.now()); fails.set(key, l); } };
setInterval(() => { const now = Date.now(); for (const [k, l] of fails) { const keep = l.filter((t) => now - t < WINDOW); if (keep.length) fails.set(k, keep); else fails.delete(k); } }, 60e3).unref();

// Passwords everyone tries first. A new password is refused when it is one of these, repeats one character, or is
// the person's own email. Length is checked as well.
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword', '12345678', '123456789', '1234567890', '11111111', '00000000', 'qwertyui', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1qaz2wsx', 'abc12345', 'abcd1234', 'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'administrator', 'changeme', 'changeme1', 'monkey123', 'dragon123', 'football1', 'baseball1', 'sunshine1', 'princess1', 'trustno1', 'master123', 'login123', 'demo1234', 'test1234', 'user1234', 'zaq12wsx']);
function checkPassword(password, email) {
  if (password.length < 8) return 'Use at least 8 characters for the password';
  if (password.length > 200) return 'The password is too long';
  const low = password.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(password) || (email && (low === email || low === String(email).split('@')[0].toLowerCase()))) return 'That password is too easy to guess. Choose a less common one.';
  return null;
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

function make(db, getSessionMinutes, hooks = {}) {
  const emit = (type, o) => { try { const r = hooks.event && hooks.event(type, o); if (r && r.catch) r.catch(() => {}); } catch (e) { /* logging never blocks a sign in */ } };
  const emailForLog = (e) => (EMAIL_RE.test(e) && e.length <= 200 ? e : '[not an email]');
  const minutesNow = async () => { try { const m = Number(await getSessionMinutes()); return Number.isFinite(m) && m >= 1 ? m : DEFAULT_MINUTES; } catch (e) { return DEFAULT_MINUTES; } };
  async function newSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || \' days\')::interval)', [sha(token), userId, String(SESSION_DAYS)]);
    // a person keeps at most MAX_SESSIONS signed in devices, the oldest are signed out first
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT $2)', [userId, MAX_SESSIONS]);
    return token;
  }

  async function register({ name, email, password }, opts = {}) {
    name = String(name || '').trim(); email = String(email || '').trim().toLowerCase(); password = String(password || '');
    if (!name) throw err(400, 'Enter your name');
    if (name.length > 120) throw err(400, 'The name is too long');
    if (!EMAIL_RE.test(email) || email.length > 200) throw err(400, 'Enter a valid email address');
    if (!opts.skipPolicy) { const bad = checkPassword(password, email); if (bad) throw err(400, bad); }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt);
    let row;
    try {
      row = (await db.query('INSERT INTO users(email, name, pw_salt, pw_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email', [email, name, salt, hash])).rows[0];
    } catch (e) {
      if (/unique|duplicate/i.test(e.message)) throw err(409, 'An account with this email already exists. Sign in instead.');
      throw e;
    }
    return { user: publicUser(row), token: await newSession(row.id), created: true };
  }

  async function login({ email, password }, ip) {
    email = String(email || '').trim().toLowerCase(); password = String(password || '');
    const keys = keysFor(ip, email);
    if (tooMany(keys)) { emit('login_locked', { ip, email: emailForLog(email), path: '/api/auth/login', throttleMs: 60e3, key: email }); throw err(429, 'Too many attempts. Wait a few minutes and try again.'); }
    const row = (await db.query("SELECT u.id, u.name, u.email, u.pw_salt, u.pw_hash, COALESCE(f.status, 'active') AS status FROM users u LEFT JOIN user_flags f ON f.user_id = u.id WHERE u.email = $1", [email])).rows[0];
    // The hash is computed even for an unknown email so response time does not reveal which emails exist.
    const hash = await scrypt(password, row ? row.pw_salt : 'x'.repeat(32));
    const ok = row && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.pw_hash, 'hex'));
    if (!ok) { noteFail(keys); emit('login_failed', { ip, email: emailForLog(email), path: '/api/auth/login', detail: { reason: row ? 'wrong_password' : 'unknown_email' } }); throw err(401, 'Email or password is not correct'); }
    fails.delete(keys[0]);
    if (row.status === 'suspended') { emit('login_failed', { ip, userId: row.id, email: emailForLog(email), path: '/api/auth/login', detail: { reason: 'suspended' } }); throw err(403, 'This account is suspended. Contact support.'); }
    emit('login_success', { ip, userId: row.id, path: '/api/auth/login' });
    return { user: publicUser(row), token: await newSession(row.id) };
  }

  async function userForToken(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const minutes = await minutesNow();
    // the session ends at the sooner of its stored 30 day expiry and sign in time plus the configured minutes
    const row = (await db.query("SELECT u.id, u.name, u.email, u.prefs, u.avatar, COALESCE(f.is_super, false) AS is_super, COALESCE(f.status, 'active') AS status, LEAST(s.expires_at, s.created_at + ($2 || ' minutes')::interval) AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN user_flags f ON f.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > now() AND s.created_at + ($2 || ' minutes')::interval > now()", [sha(token), String(minutes)])).rows[0];
    if (row && row.session_expires_at) row.session_expires_at = new Date(row.session_expires_at).toISOString();
    return row || null;
  }

  const logout = (token) => (token ? db.query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]) : null);
  const logoutEverywhere = (userId) => db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);

  async function changePassword(userId, current, next) {
    next = String(next || '');
    const row = (await db.query('SELECT email, pw_salt, pw_hash FROM users WHERE id = $1', [userId])).rows[0];
    if (!row) throw err(404, 'Account not found');
    { const bad = checkPassword(next, row.email); if (bad) throw err(400, bad.startsWith('Use at least') ? 'New password must be at least 8 characters' : bad); }
    // guessing the current password through a stolen session is slowed the same way as guessing at the sign in
    const pwKeys = [`pwchange|${userId}`];
    if (tooMany(pwKeys, [6])) throw err(429, 'Too many attempts. Wait a few minutes and try again.');
    const hash = await scrypt(String(current || ''), row.pw_salt);
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.pw_hash, 'hex'))) { noteFail(pwKeys); emit('login_failed', { userId, path: '/api/me/password', detail: { reason: 'wrong_current_password' } }); throw err(400, 'The current password is not correct'); }
    const salt = crypto.randomBytes(16).toString('hex');
    await db.query('UPDATE users SET pw_salt = $1, pw_hash = $2 WHERE id = $3', [salt, await scrypt(next, salt), userId]);
    await logoutEverywhere(userId); // every other device is signed out, this one gets a fresh session
    emit('password_changed', { userId, path: '/api/me/password' });
    return newSession(userId);
  }

  // ---------- one time reset links ----------
  // There is no email service, so a super admin makes a link and gives it to the person. Only the hash of the link is kept.
  // It works once and stops working after 30 minutes. A new link for the same person replaces the older ones.
  const RESET_MINUTES = 30;
  async function createResetLink(userId, createdBy) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await db.query("INSERT INTO password_resets(token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)", [sha(token), userId, createdBy || null, String(RESET_MINUTES)]);
    return { token, minutes: RESET_MINUTES, expires_at: new Date(Date.now() + RESET_MINUTES * 60e3).toISOString() };
  }
  // "Forgot password" from the sign in page. The answer is the same for every address, so it never says who has an account.
  // Without a mail service it says so, and the page falls back to asking support.
  async function requestReset(email, ip) {
    email = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw err(400, 'Enter a valid email address, for example name@company.com.');
    const rk = [`forgot|${ip || ''}`, `forgotmail|${email}`];
    if (tooMany(rk, [8, 3])) throw err(429, 'Too many requests. Wait a few minutes and try again.');
    noteFail(rk);
    const m = mailer.status();
    if (!m.configured) return { ok: true, mail: false };
    const row = (await db.query('SELECT u.id, u.name, COALESCE(f.status, \'active\') AS status FROM users u LEFT JOIN user_flags f ON f.user_id = u.id WHERE u.email = $1', [email])).rows[0];
    if (row && row.status !== 'suspended') {
      const r = await createResetLink(row.id, null);
      const link = `${m.siteUrl}/login.html#reset=${r.token}`;
      try {
        await mailer.send({ to: email, subject: 'Reset your Project Manager AI password', text: `Hi ${String(row.name || '').split(' ')[0] || 'there'},\n\nUse this link to choose a new password. It works once and stops working after ${r.minutes} minutes:\n\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.\n\nProject Manager AI` });
        emit('password_reset_emailed', { ip, userId: row.id, path: '/api/auth/forgot' });
      } catch (e) { emit('password_reset_mail_failed', { ip, userId: row.id, path: '/api/auth/forgot', detail: { error: String(e.message).slice(0, 120) } }); }
    }
    return { ok: true, mail: true };
  }
  async function resetPassword(token, password, ip) {
    token = String(token || ''); password = String(password || '');
    const bad = () => { emit('password_reset_failed', { ip, path: '/api/auth/reset', throttleMs: 30e3, key: 'bad' }); return err(400, 'This reset link is not valid or has expired. Ask your administrator for a new one.'); };
    const rk = [`reset|${ip || ''}`];
    if (tooMany(rk, [10])) throw err(429, 'Too many attempts. Wait a few minutes and try again.');
    if (!/^[0-9a-f]{64}$/.test(token)) { noteFail(rk); throw bad(); }
    const row = (await db.query('SELECT r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()', [sha(token)])).rows[0];
    if (!row) { noteFail(rk); throw bad(); }
    const policy = checkPassword(password, row.email);
    if (policy) throw err(400, policy);
    // the link is spent first and in one statement, so two requests with the same link cannot both win
    const used = await db.query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id', [sha(token)]);
    if (!used.rows.length) { noteFail(rk); throw bad(); }
    const salt = crypto.randomBytes(16).toString('hex');
    await db.query('UPDATE users SET pw_salt = $1, pw_hash = $2 WHERE id = $3', [salt, await scrypt(password, salt), row.user_id]);
    await logoutEverywhere(row.user_id);
    for (const k of [`email|${row.email}`, ...keysFor(ip, row.email)]) fails.delete(k);
    emit('password_reset_used', { ip, userId: row.user_id, path: '/api/auth/reset' });
    return { ok: true };
  }

  const purgeExpired = async () => { const m = await minutesNow(); await db.query("DELETE FROM sessions WHERE expires_at < now() OR created_at + ($1 || ' minutes')::interval < now()", [String(m)]); };
  const purgeResets = () => db.query("DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'").catch(() => {});
  return { register, login, userForToken, logout, logoutEverywhere, changePassword, purgeExpired, createResetLink, resetPassword, requestReset, purgeResets, EMAIL_RE, RESET_MINUTES };
}

module.exports = { make, err, checkPassword };
