// Accounts and sessions. Passwords are hashed with scrypt and a per user salt. A session token is random,
// only its SHA-256 hash is stored, and it expires after 30 days.
'use strict';
const crypto = require('crypto');

const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const err = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k.toString('hex')))));

// Failed sign in attempts are counted per address and email so a password cannot be guessed by trying many times.
const fails = new Map();
const WINDOW = 10 * 60e3, MAX_FAILS = 8;
function tooMany(key) {
  const now = Date.now();
  const list = (fails.get(key) || []).filter((t) => now - t < WINDOW);
  fails.set(key, list);
  return list.length >= MAX_FAILS;
}
const noteFail = (key) => { const l = fails.get(key) || []; l.push(Date.now()); fails.set(key, l); };
setInterval(() => { const now = Date.now(); for (const [k, l] of fails) { const keep = l.filter((t) => now - t < WINDOW); if (keep.length) fails.set(k, keep); else fails.delete(k); } }, 60e3).unref();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

function make(db) {
  async function newSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || \' days\')::interval)', [sha(token), userId, String(SESSION_DAYS)]);
    return token;
  }

  async function register({ name, email, password }) {
    name = String(name || '').trim(); email = String(email || '').trim().toLowerCase(); password = String(password || '');
    if (!name) throw err(400, 'Enter your name');
    if (name.length > 120) throw err(400, 'The name is too long');
    if (!EMAIL_RE.test(email) || email.length > 200) throw err(400, 'Enter a valid email address');
    if (password.length < 8) throw err(400, 'Use at least 8 characters for the password');
    if (password.length > 200) throw err(400, 'The password is too long');
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
    const key = `${ip || ''}|${email}`;
    if (tooMany(key)) throw err(429, 'Too many attempts. Wait a few minutes and try again.');
    const row = (await db.query("SELECT u.id, u.name, u.email, u.pw_salt, u.pw_hash, COALESCE(f.status, 'active') AS status FROM users u LEFT JOIN user_flags f ON f.user_id = u.id WHERE u.email = $1", [email])).rows[0];
    // The hash is computed even for an unknown email so response time does not reveal which emails exist.
    const hash = await scrypt(password, row ? row.pw_salt : 'x'.repeat(32));
    const ok = row && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.pw_hash, 'hex'));
    if (!ok) { noteFail(key); throw err(401, 'Email or password is not correct'); }
    fails.delete(key);
    if (row.status === 'suspended') throw err(403, 'This account is suspended. Contact support.');
    return { user: publicUser(row), token: await newSession(row.id) };
  }

  async function userForToken(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const row = (await db.query("SELECT u.id, u.name, u.email, u.prefs, u.avatar, COALESCE(f.is_super, false) AS is_super, COALESCE(f.status, 'active') AS status FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN user_flags f ON f.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > now()", [sha(token)])).rows[0];
    return row || null;
  }

  const logout = (token) => (token ? db.query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]) : null);
  const logoutEverywhere = (userId) => db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);

  async function changePassword(userId, current, next) {
    next = String(next || '');
    if (next.length < 8) throw err(400, 'New password must be at least 8 characters');
    if (next.length > 200) throw err(400, 'The password is too long');
    const row = (await db.query('SELECT pw_salt, pw_hash FROM users WHERE id = $1', [userId])).rows[0];
    if (!row) throw err(404, 'Account not found');
    const hash = await scrypt(String(current || ''), row.pw_salt);
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.pw_hash, 'hex'))) throw err(400, 'The current password is not correct');
    const salt = crypto.randomBytes(16).toString('hex');
    await db.query('UPDATE users SET pw_salt = $1, pw_hash = $2 WHERE id = $3', [salt, await scrypt(next, salt), userId]);
    await logoutEverywhere(userId); // every other device is signed out, this one gets a fresh session
    return newSession(userId);
  }

  const purgeExpired = () => db.query('DELETE FROM sessions WHERE expires_at < now()');
  return { register, login, userForToken, logout, logoutEverywhere, changePassword, purgeExpired, EMAIL_RE };
}

module.exports = { make, err };
