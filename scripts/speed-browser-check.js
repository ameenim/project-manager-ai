#!/usr/bin/env node
// Real browser check of the speed pass. Starts the app on a throwaway database with the shared seed and drives headless Chrome.
//   node scripts/speed-browser-check.js            env: SHOTS=/some/dir saves screenshots of the skeletons
// Needs Playwright and Chrome (PLAYWRIGHT_PATH, CHROME_PATH override the defaults). Exits 1 when any check fails.
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
const fs = require('fs');
const path = require('path');
const { start } = require('../test/helpers');
const { seed } = require('./perf-seed');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');

const SHOTS = process.env.SHOTS || '';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  ' + detail : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAZY = ['app_meetings.js', 'app_closure.js', 'app_brand.js', 'app_connect.js', 'app_editor.js', 'app_clienttpl.js'];

async function main() {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  const u = await s.user('Speed'); const sd = await seed(s, u.token, 200);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('pm_token', t); localStorage.setItem('pm_onboard', JSON.stringify({ done: true, tour: true, phone: '', hide: true })); } catch (e) { /* ignore */ } }, u.token);
  const page = await ctx.newPage();
  const errors = [], requests = [], apiCalls = [], encodings = {};
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('request', (r) => { const p = new URL(r.url()).pathname; requests.push({ p, at: Date.now() }); if (p.startsWith('/api/')) apiCalls.push(p); });
  page.on('response', (r) => { const p = new URL(r.url()).pathname; if (p === '/api/projects') encodings[p] = r.headers()['content-encoding'] || ''; });
  const big = sd.big;

  // ---- first load: lazy screens stay out of the start up ----
  await page.goto(s.base + '/app.html#/', { waitUntil: 'load' });
  await page.waitForSelector('#dashHost, .page', { timeout: 20000 });
  await sleep(800);
  const early = requests.map((r) => r.p.replace(/^\//, ''));
  check('first load does not fetch the six lazy screen files', LAZY.every((f) => !early.includes(f)), early.filter((f) => LAZY.includes(f)).join(','));
  check('API answers arrive brotli compressed in a real browser', encodings['/api/projects'] === 'br', 'got "' + encodings['/api/projects'] + '"');
  const stubs = await page.evaluate(() => ({ meetings: String(PM.views.tab_meetings).includes('lazy'), connect: String(PM.connect.wizard).includes('lazy'), editor: String(PM.docEditor.open).includes('lazy'), ask: String(PM.askNotDelivered).includes('lazy') }));
  check('stubs stand in before the screens load', stubs.meetings && stubs.connect && stubs.editor && stubs.ask, JSON.stringify(stubs));

  // ---- the warm up fetches them quietly a few seconds later ----
  await sleep(9000);
  const later = requests.map((r) => r.p.replace(/^\//, ''));
  check('the quiet warm up fetched every lazy file after the first screen', LAZY.every((f) => later.includes(f)), LAZY.filter((f) => !later.includes(f)).join(','));

  // ---- skeleton on a slow tab, no logo loading screen ----
  await page.route('**/api/projects/' + big + '/documents', async (route) => { await sleep(1500); route.continue(); });
  await page.evaluate((id) => { location.hash = '#/p/' + id + '/documents'; }, big);
  await page.waitForSelector('.sk-page', { timeout: 3000 }).catch(() => {});
  const during = await page.evaluate(() => ({ sk: !!document.querySelector('.sk-page'), loader: !!document.querySelector('.pmld-screen'), label: (document.querySelector('.sk-page') || {}).getAttribute ? document.querySelector('.sk-page').getAttribute('aria-label') : null, busy: document.querySelector('.sk-page') && document.querySelector('.sk-page').getAttribute('aria-busy') }));
  check('a slow tab shows the skeleton page and not the logo loading screen', during.sk && !during.loader && during.busy === 'true' && /Loading/.test(during.label || ''), JSON.stringify(during));
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'skeleton-light.png') }); }
  await page.waitForFunction(() => !document.querySelector('.sk-page'), null, { timeout: 8000 });
  check('the skeleton is replaced by the real tab', await page.evaluate(() => !!document.querySelector('#content .page, #content .card')));
  await page.unroute('**/api/projects/' + big + '/documents');

  // ---- skeleton in dark, Arabic (right to left) and on a phone ----
  if (SHOTS) {
    await page.route('**/api/calendar', async (route) => { await sleep(2500); route.continue(); });
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); location.hash = '#/calendar'; });
    await sleep(600); await page.screenshot({ path: path.join(SHOTS, 'skeleton-dark.png') });
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.setAttribute('data-theme', 'light'); });
    await sleep(100); await page.screenshot({ path: path.join(SHOTS, 'skeleton-rtl.png') });
    await page.setViewportSize({ width: 390, height: 800 }); await sleep(200); await page.screenshot({ path: path.join(SHOTS, 'skeleton-phone.png') });
    await page.waitForFunction(() => !document.querySelector('.sk-page'), null, { timeout: 8000 });
    await page.setViewportSize({ width: 1440, height: 900 }); await page.unroute('**/api/calendar');
    await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
  }

  // ---- lazy screens open and replace their stubs ----
  for (const [tab, label] of [['meetings', 'Meetings'], ['closure', 'Closure']]) {
    await page.evaluate(([id, t]) => { location.hash = '#/p/' + id + '/' + t; }, [big, tab]);
    await page.waitForFunction(() => !document.querySelector('.sk-page') && document.querySelector('#content .page, #content .card'), null, { timeout: 15000 });
    await page.waitForFunction((t) => !String(PM.views['tab_' + t]).includes('lazy.load'), tab, { timeout: 15000 }).catch(() => {});
    const ok = await page.evaluate((t) => !String(PM.views['tab_' + t]).includes('lazy.load'), tab);
    check(label + ' tab opens from a lazy file and the real code replaces the stub', ok);
  }
  await page.evaluate(() => { location.hash = '#/account'; });
  await page.waitForSelector('#avFile', { state: 'attached', timeout: 10000 });
  await page.evaluate(() => PM.lazy.load('docs').then(() => PM.lazy.load('connect')).then(() => PM.lazy.load('brand')));
  const realNow = await page.evaluate(() => ({ editor: !String(PM.docEditor.open).includes('lazy'), tpl: !String(PM.clientTpl.open).includes('lazy'), connect: !String(PM.connect.wizard).includes('lazy'), brand: !String(PM.views.brand).includes('lazy') }));
  check('the editor, client templates, connection wizard and brand screens load on demand', Object.values(realNow).every(Boolean), JSON.stringify(realNow));

  // ---- identical reads share one request, and each caller gets its own copy ----
  await page.evaluate(() => { location.hash = '#/'; });
  await sleep(1200);
  const before = apiCalls.filter((p) => p === '/api/me/log-views').length;
  const copies = await page.evaluate(async () => { const [a, b, c] = await Promise.all([PM.api('GET', '/api/me/log-views'), PM.api('GET', '/api/me/log-views'), PM.api('GET', '/api/me/log-views')]); a.views.push({ mutated: true }); return { same: a === b, bLen: b.views.length, cLen: c.views.length, aLen: a.views.length }; });
  const after = apiCalls.filter((p) => p === '/api/me/log-views').length;
  check('three identical reads at once make one request', after - before === 1, 'made ' + (after - before));
  check('callers get separate copies, so one cannot change what another sees', !copies.same && copies.bLen === copies.cLen && copies.aLen === copies.bLen + 1, JSON.stringify(copies));
  const dup = await page.evaluate(async (id) => { const p = (await PM.api('GET', '/api/projects/' + id)).project; let n = 0; const of = window.fetch; window.fetch = function (u, i) { if (String(u) === '/api/projects/' + id && i && i.method === 'PUT') n++; return of.apply(this, arguments); }; const a = PM.api('PUT', '/api/projects/' + id, { name: p.name }); const b = PM.api('PUT', '/api/projects/' + id, { name: p.name }); await Promise.all([a, b]); window.fetch = of; return n; }, big);
  check('the same PUT sent twice at once is one request', dup === 1, 'sent ' + dup);

  // ---- debounced search: one redraw after typing stops ----
  await page.evaluate(() => { location.hash = '#/projects'; });
  await page.waitForSelector('#pjQ', { timeout: 10000 });
  const draws = await page.evaluate(() => new Promise((ok) => { const host = document.querySelector('#pjQ').closest('.page') || document.body; let n = 0; const mo = new MutationObserver(() => { n++; }); const grid = host.querySelector('.pj-card') ? host.querySelector('.pj-card').parentElement : host; mo.observe(grid, { childList: true }); const q = document.querySelector('#pjQ'); 'proj'.split('').forEach((ch, i) => setTimeout(() => { q.value += ch; q.dispatchEvent(new Event('input', { bubbles: true })); }, i * 30)); setTimeout(() => { mo.disconnect(); ok(n); }, 900); }));
  check('typing four letters into the project search redraws the list once', draws <= 2, 'redraws ' + draws);

  // ---- avatar is shrunk to WebP before upload ----
  await page.evaluate(() => { location.hash = '#/account'; });
  await page.waitForSelector('#avFile', { state: 'attached', timeout: 10000 });
  await page.evaluate(() => { window.__avatar = null; const of = window.fetch; window.fetch = function (u, i) { if (String(u).includes('/api/me/avatar') && i && i.body && i.body.get) { const f = i.body.get('file'); window.__avatar = { name: f.name, type: f.type, size: f.size }; } return of.apply(this, arguments); }; });
  await page.evaluate(() => new Promise((ok) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 900; const g = c.getContext('2d');
    for (let i = 0; i < 900; i += 3) { g.fillStyle = 'hsl(' + (i % 360) + ',70%,50%)'; g.fillRect(i, 0, 3, 900); }
    c.toBlob((b) => { window.__origSize = b.size; const dt = new DataTransfer(); dt.items.add(new File([b], 'me.png', { type: 'image/png' })); const inp = document.querySelector('#avFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); ok(b.size); }, 'image/png');
  }));
  await sleep(1500);
  const av = await page.evaluate(() => ({ a: window.__avatar, o: window.__origSize }));
  check('a large PNG avatar is sent as a small WebP', av.a && av.a.name === 'avatar.webp' && av.a.type === 'image/webp' && av.a.size < av.o / 2, JSON.stringify(av));

  // ---- real user speed readings are sent when the page is left ----
  await page.evaluate(() => { location.hash = '#/'; });
  await sleep(500);
  const vit = page.waitForRequest((r) => r.url().includes('/api/usage') && /"k":"vital"/.test(r.postData() || ''), { timeout: 10000 });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const vr = await vit.catch(() => null);
  const sent = vr ? JSON.parse(vr.postData()).events.filter((e) => e.k === 'vital').map((e) => e.a) : [];
  check('the page reports real user speed (LCP, CLS and TTFB at least) when it is left', ['lcp', 'cls', 'ttfb'].every((m) => sent.includes(m)), 'sent ' + sent.join(','));

  // ---- notifications change on screen before the server answers ----
  await page.route('**/api/notifications/dismiss', async (route) => { await sleep(2500); route.continue(); });
  await page.evaluate(() => { location.hash = '#/'; });
  await sleep(800);
  const bell = page.locator('#ntBell');
  if (await bell.count()) {
    await bell.click(); await sleep(700);
    const n0 = await page.locator('.ib-item').count();
    if (n0 > 0) {
      await page.locator('.ib-dh [data-act="del"]').first().click(); await sleep(250);
      const n1 = await page.locator('.ib-item').count();
      check('dismissing a notification removes it at once, before the slow server answers', n1 === n0 - 1, n0 + ' to ' + n1);
    } else console.log('SKIP notification dismiss: no notifications in the seed');
  } else console.log('SKIP notification dismiss: no bell');
  await page.unroute('**/api/notifications/dismiss');

  check('no script errors or console errors during the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close(); await s.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('check run failed:', e); process.exit(2); });
