#!/usr/bin/env node
// Real browser check that moving a card on the schedule Board is instant, even when the server is slow or fails.
//   node scripts/board-move-check.js        env: DELAY=900 (ms of simulated server delay), PLAYWRIGHT_PATH, CHROME_PATH
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
const { start } = require('../test/helpers');
const { seed } = require('./perf-seed');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const DELAY = Number(process.env.DELAY || 900);
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  const u = await s.user('Board'); const sd = await seed(s, u.token, 200);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('pm_token', t); localStorage.setItem('pm_sched_view', 'board'); localStorage.setItem('pm_onboard', JSON.stringify({ done: true, tour: true, phone: '', hide: true })); } catch (e) { /* ignore */ } }, u.token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  let mode = 'slow', applied = [];
  await page.route('**/schedule/apply', async (route) => {
    applied.push(Date.now());
    await sleep(DELAY);
    if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated server failure' }) });
    return route.continue();
  });
  await page.goto(`${s.base}/app.html#/p/${sd.big}/schedule?view=board`, { waitUntil: 'load' });
  await page.waitForSelector('.bd-card', { timeout: 20000 });
  await sleep(600);

  const count = (col) => page.evaluate((c) => document.querySelector(`.bd-col.${c} header .chip`).textContent.trim(), col);
  const inCol = (id, col) => page.evaluate(([i, c]) => !!document.querySelector(`.bd-col.${c} .bd-card[data-id="${i}"]`), [id, col]);
  // time from mouse release until the card sits in the target column
  async function dragTo(id, col) {
    const card = page.locator(`.bd-col.todo .bd-card[data-id="${id}"]`);
    const cb = await card.boundingBox(), tb = await page.locator(`.bd-col.${col} .bd-body`).boundingBox();
    await page.mouse.move(cb.x + 40, cb.y + 30); await page.mouse.down();
    await page.mouse.move(cb.x + 80, cb.y + 40, { steps: 3 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 60, { steps: 8 });
    await page.evaluate(([i, c]) => { window.__t = null; const q = () => !!document.querySelector(`.bd-col.${c} .bd-card[data-id="${i}"]`); const tick = () => { if (window.__t !== null) return; if (q()) window.__t = performance.now() - window.__up; else requestAnimationFrame(tick); }; window.addEventListener('pointerup', () => { window.__up = performance.now(); requestAnimationFrame(tick); }, { once: true, capture: true }); }, [id, col]);
    await page.mouse.up();
    await page.waitForFunction(() => window.__t !== null, null, { timeout: 5000 });
    return page.evaluate(() => window.__t);
  }
  const firstTodo = await page.evaluate(() => [...document.querySelectorAll('.bd-col.todo .bd-card')].slice(0, 3).map((c) => c.dataset.id));
  const [a, b, c] = firstTodo;
  const todo0 = Number(await count('todo')), done0 = Number(await count('done'));

  // 1. move to Done with a slow server: instant on screen
  const t1 = await dragTo(a, 'done');
  check(`card reaches Done on screen in under 100 ms (server delay ${DELAY} ms)`, t1 < 100, `took ${t1.toFixed(0)} ms`);
  check('counts update at once', Number(await count('todo')) === todo0 - 1 && Number(await count('done')) === done0 + 1);
  check('undo toast shows at once', await page.locator('.toast, .toasts > *').filter({ hasText: /moved to/i }).count() > 0);
  // 2. a second move before the first reply arrives must not flick back
  const t2 = await dragTo(b, 'done');
  check('a second move while the first is still in flight is instant too', t2 < 100, `took ${t2.toFixed(0)} ms`);
  await sleep(DELAY * 2 + 600);
  check('both cards stay in Done after the server replies', (await inCol(a, 'done')) && (await inCol(b, 'done')));
  check('server received both changes', applied.length >= 2, `calls ${applied.length}`);
  const srv = await s.call('GET', `/api/projects/${sd.big}/schedule`, null, u.token);
  const prog = (id) => (srv.data.tasks.find((x) => x.id === Number(id)) || {}).progress;
  check('server state matches the board', prog(a) === 100 && prog(b) === 100, `a=${prog(a)} b=${prog(b)}`);

  // 3. Undo is instant as well
  const undoBtn = page.locator('[data-f=undo]');
  await undoBtn.click();
  await page.waitForFunction((i) => !!document.querySelector(`.bd-col.todo .bd-card[data-id="${i}"]`), b, { timeout: 150 }).then(() => check('undo returns the card at once', true), () => check('undo returns the card at once', false));
  await sleep(DELAY + 600);
  const srv2 = await s.call('GET', `/api/projects/${sd.big}/schedule`, null, u.token);
  check('undo reached the server', (srv2.data.tasks.find((x) => x.id === Number(b)) || {}).progress === 0);

  // 4. server failure rolls the card back with a message
  mode = 'fail';
  const t4 = await dragTo(c, 'done');
  check('failed move still shows instantly', t4 < 100, `took ${t4.toFixed(0)} ms`);
  await page.waitForFunction((i) => !!document.querySelector(`.bd-col.todo .bd-card[data-id="${i}"]`), c, { timeout: DELAY + 3000 }).then(() => check('failed move rolls back to To do', true), () => check('failed move rolls back to To do', false));
  check('an error message is shown', await page.locator('.toast, .toasts > *').filter({ hasText: /Simulated server failure/ }).count() > 0);
  check('no console errors', errors.length === 0, errors.join(' | '));

  await browser.close(); await s.close();
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `\n${bad} FAILED` : '\nall passed');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
