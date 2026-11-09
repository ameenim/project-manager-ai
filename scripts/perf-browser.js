#!/usr/bin/env node
// Browser benchmark. Starts the real app on a throwaway database with the shared seed, opens it in headless Chrome and
// times what a person feels: a cold page load, a repeat page load, opening every screen, and common actions.
//   node scripts/perf-browser.js <label>        env: BENCH_CPU (CPU slowdown, default 1), BENCH_LATENCY_MS (network, default 30)
// Needs Playwright and Chrome (PLAYWRIGHT_PATH, CHROME_PATH override the defaults). Writes bench-results/<label>-browser.json.
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
const fs = require('fs');
const path = require('path');
const { start } = require('../test/helpers');
const { seed } = require('./perf-seed');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');

const LABEL = process.argv[2] || 'run';
const CPU = Number(process.env.BENCH_CPU || 1);
const LAT = Number(process.env.BENCH_LATENCY_MS || 30);
const RUNS = Number(process.env.BENCH_BROWSER_RUNS || 3);
const BIG = Number(process.env.BENCH_TASKS || 600);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Runs inside the page: remembers the last moment anything fetched or changed (ignoring the loading screen and toasts)
const INIT = () => {
  const st = (window.__pm = { inflight: 0, last: performance.now(), long: [], fetches: 0, loaderOn: 0, loaderMs: 0 });
  const of = window.fetch;
  window.fetch = function () { st.inflight++; st.fetches++; return of.apply(this, arguments).finally(() => { st.inflight--; st.last = performance.now(); }); };
  // the loading screen, toasts and the number count up are decoration, not work
  const skip = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest && e.closest('.pmld-screen, #toasts, .toast, [data-count]')); };
  new MutationObserver((ms) => { for (const m of ms) if (!skip(m.target)) { st.last = performance.now(); return; } }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) st.long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* not supported */ }
};

async function main() {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  const u = await s.user('Bench'); const tok = u.token;
  const sd = await seed(s, tok, BIG);
  const base = s.base;
  const out = { label: LABEL, cpu: CPU, latencyMs: LAT, when: new Date().toISOString(), seedMs: sd.ms, screens: [], actions: [], load: {} };

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript((t) => { try { localStorage.setItem('pm_token', t); localStorage.setItem('pm_onboard', JSON.stringify({ done: true, tour: true, phone: '', hide: true })); } catch (e) { /* ignore */ } }, tok);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (LAT) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LAT, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8 });
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));

  // wait until nothing has fetched or changed for `quiet` ms and the loading screen is gone. Returns ms from t0 to the last activity.
  async function settle(t0, quiet = 350, cap = 40000) {
    const r = await page.evaluate(({ t0, quiet, cap }) => new Promise((ok) => {
      const st = window.__pm; const began = performance.now();
      const tick = () => {
        const now = performance.now();
        const idle = st.inflight === 0 && now - st.last > quiet && (st.last > t0 || now - began > 1500);
        if ((idle && !document.querySelector('.pmld-screen')) || now - began > cap) {
          const longs = st.long.filter((x) => x[0] >= t0);
          ok({ ms: st.last - t0, longMs: longs.reduce((a, x) => a + x[1], 0), longMax: longs.reduce((a, x) => Math.max(a, x[1]), 0), fetches: st.fetches, nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0, capped: now - began > cap });
        } else setTimeout(tick, 40);
      };
      tick();
    }), { t0, quiet, cap });
    return r;
  }
  const now = () => page.evaluate(() => { window.__pm.fetches = 0; window.__pm.long = []; return performance.now(); });

  // ---------- page loads ----------
  async function load(label, clearCache) {
    if (clearCache) await cdp.send('Network.clearBrowserCache');
    let bytes = 0, reqs = 0; const onResp = (r) => { reqs++; const l = Number(r.headers()['content-length'] || 0); bytes += l; };
    page.on('response', onResp);
    out._enc = 0;
    const onFin = (e) => { out._enc += e.encodedDataLength; };
    cdp.on('Network.loadingFinished', onFin);
    await page.goto('about:blank');
    const t = Date.now();
    await page.goto(base + '/app.html#/', { waitUntil: 'load' });
    const loadMs = Date.now() - t;
    const dcl = await page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd);
    const sres = await page.evaluate(() => new Promise((ok) => { const st = window.__pm; const tick = () => { if (st.inflight === 0 && performance.now() - st.last > 400 && document.querySelector('#dashHost, .page.dash, .page')) ok({ ms: st.last, nodes: document.getElementsByTagName('*').length }); else setTimeout(tick, 40); }; tick(); }));
    page.off('response', onResp); cdp.off('Network.loadingFinished', onFin);
    out.load[label] = { loadEventMs: loadMs, domContentLoadedMs: Math.round(dcl), dashboardReadyMs: Math.round(sres.ms), requests: reqs, transferredKB: Math.round(out._enc / 1024) };
  }
  await load('cold', true);
  await load('repeat', false);
  await load('repeat2', false);

  // ---------- screens ----------
  const big = sd.big, first = sd.first;
  const screens = [
    ['Portfolio dashboard', '#/'], ['Projects list', '#/projects'], ['Calendar', '#/calendar'], ['Widgets marketplace', '#/widgets'], ['Account', '#/account'], ['Billing', '#/billing'],
    ['Overview (large)', `#/p/${big}/overview`], ['Overview (small)', `#/p/${first}/overview`], ['Review', `#/p/${big}/review`], ['Schedule (large)', `#/p/${big}/schedule`], ['Logs and risks', `#/p/${big}/logs`],
    ['Meetings', `#/p/${big}/meetings`], ['Inbox', `#/p/${big}/inbox`], ['Documents', `#/p/${big}/documents`], ['Reports', `#/p/${big}/reports`], ['Project settings', `#/p/${big}/settings`],
  ];
  for (const [name, hash] of screens) {
    const ms = [], longs = [], longMax = [], nodes = [], fetches = [];
    for (let i = 0; i < RUNS; i++) {
      await page.evaluate((h) => { location.hash = h === '#/calendar' ? '#/projects' : '#/calendar'; }, hash); await settle(await now());
      const t0 = await now();
      await page.evaluate((h) => { location.hash = h; }, hash);
      const r = await settle(t0);
      ms.push(r.ms); longs.push(r.longMs); longMax.push(r.longMax); nodes.push(r.nodes); fetches.push(r.fetches);
    }
    out.screens.push({ screen: name, hash, readyMs: Math.round(median(ms)), maxMs: Math.round(Math.max(...ms)), longTaskMs: Math.round(median(longs)), longestTaskMs: Math.round(median(longMax)), requests: median(fetches), domNodes: median(nodes) });
    console.log(name.padEnd(24), String(Math.round(median(ms))).padStart(6), 'ms   long tasks', Math.round(median(longs)), 'ms   nodes', median(nodes), '  requests', median(fetches));
  }

  // ---------- actions ----------
  // each action: how to get to the screen, what to do, and how long until the screen has caught up
  async function action(name, screenHash, doIt, opt = {}) {
    const ms = [], longs = [], fetches = [];
    for (let i = 0; i < RUNS; i++) {
      await page.evaluate((h) => { location.hash = h; }, screenHash); await settle(await now());
      if (opt.prep) await opt.prep(i);
      const t0 = await now();
      try { await doIt(i); } catch (e) { out.actions.push({ action: name, error: String(e.message).slice(0, 120) }); console.log(name, 'ERROR', String(e.message).slice(0, 100)); return; }
      const r = await settle(t0);
      ms.push(r.ms); longs.push(r.longMs); fetches.push(r.fetches);
      if (opt.after) await opt.after(i);
    }
    out.actions.push({ action: name, readyMs: Math.round(median(ms)), maxMs: Math.round(Math.max(...ms)), longTaskMs: Math.round(median(longs)), requests: median(fetches) });
    console.log(name.padEnd(40), String(Math.round(median(ms))).padStart(6), 'ms   long tasks', Math.round(median(longs)), 'ms   requests', median(fetches));
  }
  const hasSel = (sel) => page.locator(sel).first().count().then((n) => n > 0);

  // screen switches that are common actions
  await action('Switch project tab: overview to schedule', `#/p/${big}/overview`, async () => { await page.click(`a.tab[href="#/p/${big}/schedule"]`); });
  await action('Switch project tab: schedule to logs', `#/p/${big}/schedule`, async () => { await page.click(`a.tab[href="#/p/${big}/logs"]`); });
  await action('Switch project tab: logs to documents', `#/p/${big}/logs`, async () => { await page.click(`a.tab[href="#/p/${big}/documents"]`); });
  await action('Toggle dark mode', `#/p/${big}/overview`, async () => { await page.click('#themeBtn'); }, { after: async () => { await page.click('#themeBtn'); await settle(await now()); } });
  await action('Switch language to Arabic and back', `#/p/${big}/overview`, async () => { await page.click('#langBtn'); }, { after: async () => { await page.click('#langBtn'); await settle(await now()); } });
  await action('Open Projects flyout and pick a project', '#/', async () => { await page.hover('#navFly'); await page.click(`.fly a[href="#/p/${first}/overview"]`); });

  // real edits in the schedule of the large project
  const cell = (f, n) => page.locator(`.gt-cells .c.ed[data-f="${f}"]`).nth(n);
  const curVal = async (f, n) => Number(((await cell(f, n).innerText()) || '0').replace(/[^0-9.]/g, '')) || 0;
  const edit = async (f, n, v) => { if (f === 'duration') { const cur = await curVal(f, n); if (cur === Number(v)) v = cur + 1; } await cell(f, n).dblclick(); const inp = page.locator('.gt-cells input').first(); await inp.fill(String(v)); await inp.press('Enter'); };
  await action('Schedule: edit progress inline', `#/p/${big}/schedule`, async (i) => { await edit('progress', 8, 40 + i); }, { prep: async () => { await page.waitForSelector('.gt-cells'); } });
  await action('Schedule: edit duration, impact dialog opens', `#/p/${big}/schedule`, async (i) => { await edit('duration', 8, 6 + i); await page.locator('.modal').first().waitFor(); }, { prep: async () => { await page.waitForSelector('.gt-cells'); }, after: async () => { await page.locator('.modal [data-close]').first().click().catch(() => {}); await settle(await now()); } });
  let applyRound = 0;
  await action('Schedule: confirm the impact dialog (apply)', `#/p/${big}/schedule`, async () => { await page.click('#impOk'); }, { prep: async () => { await page.waitForSelector('.gt-cells'); for (let tries = 0; tries < 4; tries++) { await edit('duration', 8, 4 + ((applyRound++) % 7)); if (await page.locator('#impOk').waitFor({ timeout: 5000 }).then(() => true, () => false)) break; await page.evaluate((h) => { location.hash = h; }, `#/p/${big}/schedule`); await page.waitForSelector('.gt-cells'); } await page.locator('#impOk').waitFor(); } });
  await action('Schedule: scroll and select a row', `#/p/${big}/schedule`, async (i) => { await page.locator('.gt-cells .c.nm').nth(30 + i).click(); }, { prep: async () => { await page.waitForSelector('.gt-cells'); } });
  await action('Logs: open a risk editor', `#/p/${big}/logs`, async () => { await page.locator('table tbody tr').first().click(); }, { after: async () => { await page.keyboard.press('Escape'); await settle(await now()); } });

  out.errors = errors;
  fs.mkdirSync(path.join(__dirname, '..', 'bench-results'), { recursive: true });
  delete out._enc;
  fs.writeFileSync(path.join(__dirname, '..', 'bench-results', `${LABEL}-browser.json`), JSON.stringify(out, null, 2));
  console.log('\nload', JSON.stringify(out.load), '\npage errors', errors.length, errors.slice(0, 3));
  await browser.close();
  await s.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
