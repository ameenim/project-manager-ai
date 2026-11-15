'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { start } = require('./helpers');
const { openSafeZip } = require('../server/safezip');
const { readSpreadsheet } = require('../server/xlsx_text');
const { extractText } = require('../server/extract');
const { Connectors } = require('../server/connectors');
const { clientIp } = require('../server/net');
const { checkPassword } = require('../server/auth');

let s; before(async () => { s = await start(); }); after(() => s.close());
const PW = 'Pm-Test-4821';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('every response carries the browser security headers', async () => {
  for (const p of ['/login.html', '/app.html', '/', '/healthz']) {
    const r = await s.call('GET', p);
    const csp = r.headers.get('content-security-policy') || '';
    assert.ok(/default-src 'self'/.test(csp), p + ' has a content security policy');
    assert.ok(/script-src 'self'(?!.*unsafe)/.test(csp.split(';').find((x) => /script-src/.test(x)) || ''), p + ' allows no inline script');
    assert.ok(/object-src 'none'/.test(csp) && /frame-ancestors 'self'/.test(csp) && /base-uri 'self'/.test(csp));
    assert.ok(/max-age=\d{7,}/.test(r.headers.get('strict-transport-security') || ''), p + ' sends HSTS');
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  }
  const api = await s.call('GET', '/api/projects');
  assert.ok(api.headers.get('content-security-policy'));
});

test('no page carries an inline script or an inline event handler', async () => {
  for (const p of ['/', '/login.html', '/app.html', '/admin', '/oauth-done.html']) {
    const html = (await s.call('GET', p)).buf.toString();
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/gi)].filter((m) => !/type="application\/(ld\+)?json"/i.test(m[1]));
    assert.equal(inline.length, 0, p + ' has an inline script');
    assert.ok(!/\son(click|load|error|submit|change|input)\s*=/i.test(html), p + ' has an inline handler');
    assert.ok(!/href="javascript:/i.test(html), p);
  }
});

test('a made up X-Forwarded-For entry does not give a new rate limit allowance', async () => {
  await s.call('POST', '/api/auth/register', { name: 'Spoof', email: 'spoof@test.co', password: PW });
  let last;
  for (let i = 0; i < 10; i++) last = await s.call('POST', '/api/auth/login', { email: 'spoof@test.co', password: 'wrong-wrong' }, null, { 'x-forwarded-for': `10.9.${i}.1, 203.0.113.50` });
  assert.equal(last.status, 429, 'rotating the left hand entry must not reset the count');
});

test('client address is taken from the trusted end of the header', () => {
  const at = (xff, peer = '10.0.0.5') => clientIp({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: peer } });
  assert.equal(at('6.6.6.6, 7.7.7.7'), '7.7.7.7');
  assert.equal(at('7.7.7.7'), '7.7.7.7');
  assert.equal(at(''), '10.0.0.5');
  assert.equal(at('6.6.6.6, 7.7.7.7, 10.1.1.1'), '7.7.7.7', 'our own network entries count as hops');
  process.env.TRUST_PROXY_HOPS = '0';
  try { assert.equal(at('6.6.6.6, 7.7.7.7', '4.4.4.4'), '4.4.4.4'); } finally { delete process.env.TRUST_PROXY_HOPS; }
});

test('one account cannot be guessed at from many addresses', async () => {
  await s.call('POST', '/api/auth/register', { name: 'Spread', email: 'spread@test.co', password: PW });
  let last;
  for (let i = 0; i < 31; i++) last = await s.call('POST', '/api/auth/login', { email: 'spread@test.co', password: 'wrong-wrong' }, null, { 'x-forwarded-for': `198.51.${i}.${i + 1}` });
  assert.equal(last.status, 429);
  const good = await s.call('POST', '/api/auth/login', { email: 'spread@test.co', password: PW }, null, { 'x-forwarded-for': '198.51.100.200' });
  assert.equal(good.status, 429, 'the account is paused for a few minutes whatever the address');
});

test('weak passwords are refused when choosing one', async () => {
  for (const password of ['password1', 'aaaaaaaa', 'demo1234', 'short']) {
    const r = await s.call('POST', '/api/auth/register', { name: 'Weak', email: `weak${password}@test.co`, password });
    assert.equal(r.status, 400, password);
  }
  const own = await s.call('POST', '/api/auth/register', { name: 'Own', email: 'bob12345@test.co', password: 'bob12345' });
  assert.equal(own.status, 400, 'the email name is not allowed as the password');
  const u = await s.user();
  assert.equal((await s.call('POST', '/api/me/password', { current: PW, next: 'qwerty123' }, u.token)).status, 400);
  assert.equal(checkPassword('Tr1cky-horse-9', 'a@b.co'), null);
});

test('guessing the current password through a session is slowed down', async () => {
  const u = await s.user();
  let last;
  for (let i = 0; i < 8; i++) last = await s.call('POST', '/api/me/password', { current: 'not-it-at-all', next: 'Another-Pass-77' }, u.token);
  assert.equal(last.status, 429);
});

test('a person keeps at most twenty signed in devices', async () => {
  const email = 'devices@test.co';
  const first = (await s.call('POST', '/api/auth/register', { name: 'Dev', email, password: PW })).data.token;
  let latest;
  for (let i = 0; i < 21; i++) latest = (await s.call('POST', '/api/auth/login', { email, password: PW }, null, { 'x-forwarded-for': `203.0.113.${i + 1}` })).data.token;
  assert.equal((await s.call('GET', '/api/me', null, first)).status, 401, 'the oldest session is signed out');
  assert.equal((await s.call('GET', '/api/me', null, latest)).status, 200);
});

test('a picture must really be the kind of picture it says it is', async () => {
  const u = await s.user();
  const send = (bytes, type) => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), 'a.png'); return s.call('POST', '/api/me/avatar', fd, u.token); };
  assert.equal((await send(Buffer.from('this is not an image at all'), 'image/png')).status, 400);
  assert.equal((await send(Buffer.from('icns\0\0\0\0\0\0\0\0\0\0\0\0'), 'image/png')).status, 400);
  assert.equal((await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml')).status, 400);
  assert.equal((await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'), 'image/svg+xml')).status, 200);
  assert.equal((await send(png, 'image/png')).status, 200);
});

test('an archive that claims to unpack to too much is refused before it is read', async () => {
  const z = new JSZip(); z.file('word/document.xml', Buffer.alloc(4 * 1024 * 1024, 65));
  const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.ok(buf.length < 100 * 1024, 'it is small on disk');
  await assert.rejects(() => openSafeZip(buf, { maxTotal: 1024 * 1024 }), (e) => e.status === 422);
  await assert.rejects(() => openSafeZip(buf, { maxEntry: 1024 * 1024 }), (e) => e.status === 422);
  assert.ok(await openSafeZip(buf));
  assert.equal(await openSafeZip(Buffer.from('not a zip')), null);
});

test('SheetJS stays outside both vulnerable version ranges', () => {
  const version = require('xlsx').version;
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major > 0 || (major === 0 && (minor > 20 || (minor === 20 && patch >= 2))),
    `SheetJS ${version} must include the prototype pollution and ReDoS fixes`);
  const lock = require('../package-lock.json');
  const entries = Object.entries(lock.packages).filter(([name]) => /(^|\/)node_modules\/xlsx$/.test(name));
  assert.ok(entries.length > 0);
  for (const [name, entry] of entries) assert.equal(entry.version, version, `${name} must use the patched version`);
});

test('spreadsheets are read in a separate thread and time out', async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Task', 'Owner'], ['Design', 'Ann']]), 'Plan');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const r = await extractText(buf, 'plan.xlsx');
  assert.match(r.text, /Design \| Ann/); assert.equal(r.kind, 'xlsx');
  await assert.rejects(() => readSpreadsheet(buf, { timeoutMs: 1 }), (e) => e.status === 422);
  await assert.rejects(() => readSpreadsheet(Buffer.alloc(26 * 1024 * 1024)), (e) => e.status === 413, 'an oversized workbook is refused');
});

test('patched SheetJS preserves legacy and modern spreadsheet imports', async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Task', 'Budget'], ['تصميم', 123.5]]), 'Plan');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Owner'], ['Ann']]), 'Team');
  for (const [bookType, ext] of [['biff8', 'xls'], ['xlsx', 'xlsx']]) {
    const buf = XLSX.write(wb, { type: 'buffer', bookType });
    const r = await extractText(buf, `plan.${ext}`);
    assert.equal(r.sheets, 2);
    assert.match(r.text, /تصميم \| 123\.5/);
    assert.match(r.text, /Sheet: Team\n\| Owner \|\n\| Ann \|/);
  }
});

test('saved connection tokens survive moving from the database key to APP_SECRET', async () => {
  const db = s.app.db;
  const before = process.env.APP_SECRET; delete process.env.APP_SECRET;
  try {
    const a = new Connectors(db);
    const sealed = await a.seal({ access: 'tok-1' });
    process.env.APP_SECRET = 'a-long-random-secret-for-this-test-0123456789';
    const b = new Connectors(db);
    assert.deepEqual(await b.open(sealed), { access: 'tok-1' }, 'old tokens still open');
    const again = await b.seal({ access: 'tok-2' });
    assert.deepEqual(await new Connectors(db).open(again), { access: 'tok-2' });
    delete process.env.APP_SECRET;
    await assert.rejects(() => new Connectors(db).open(again), (e) => e.status === 409, 'a token sealed with APP_SECRET is not readable without it');
  } finally { if (before === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = before; }
});
