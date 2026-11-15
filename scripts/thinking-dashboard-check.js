#!/usr/bin/env node
// Real browser check: a dashboard request in the Thinking Area shows one card with a live preview per widget.
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY;
const { start } = require('../test/helpers');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d ? '  ' + d : '')); };
const specs = [
  ['Late tasks', { dataset: 'tasks', viz: 'kpi', agg: 'count', filters: [{ field: 'status', op: 'eq', value: 'late' }], rules: [{ op: 'gt', value: 0, tone: 'bad' }, { op: 'lte', value: 0, tone: 'good' }] }],
  ['Task status share', { dataset: 'tasks', viz: 'donut', agg: 'count', groupBy: 'status' }],
  ['Risk map', { dataset: 'risks', viz: 'heatmap', agg: 'count', groupBy: 'probability', splitBy: 'impact' }],
];
let calls = 0;
async function* model() {
  calls++;
  if (calls === 1) for (const [i, [title, spec]] of specs.entries()) yield { type: 'tool_use', id: 'w' + i, name: 'create_widget', input: { title, group: 'delivery', add_to: 'project', spec } };
  else yield { type: 'text', text: 'Prepared the dashboard.' };
  yield { type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}
(async () => {
  const s = await start({ chatModel: model, snapshotJob: false, opsJobs: false, noScheduler: true });
  const u = await s.user('Dash'); const p = await s.project(u.token, 'Dash project');
  for (const n of ['A', 'B', 'C']) await s.call('POST', `/api/projects/${p.id}/tasks`, { name: n, start: '2027-01-11', duration: 2 }, u.token);
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { localStorage.setItem('pm_token', t); localStorage.setItem('pm_onboard', JSON.stringify({ done: true, tour: true, phone: '', hide: true })); }, u.token);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(s.base + `/app.html#/thinking`, { waitUntil: 'load' });
  await page.waitForSelector('#chtIn', { timeout: 20000 }); await sleep(600);
  await page.fill('#chtIn', 'Build me a delivery dashboard'); await page.press('#chtIn', 'Enter');
  await page.waitForSelector('.cht-card .cht-wprev', { timeout: 20000 }); await sleep(1500);
  check('one card with three widget previews', (await page.$$('.cht-card .cht-wprev')).length === 3);
  check('every preview is drawn, none left loading', await page.$$eval('.cht-wprev .cht-wp-b', (e) => e.every((x) => x.innerHTML.length > 40 && !/loading/i.test(x.innerText))));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/dash-card.png' });
  await page.click('[data-act="apply"]'); await sleep(2500);
  check('after Apply the card links to all widgets', !!(await page.$('.cht-card-foot a[href="#/widgets?tab=mine"]')), await page.$eval('.cht-card', (e) => e.innerText.slice(-200)));
  check('three drafts exist', (await s.call('GET', '/api/widgets/mine', null, u.token)).data.widgets.length === 3);
  check('previews survive Apply', (await page.$$('.cht-card .cht-wprev')).length === 3);
  check('no console errors', !errors.length, errors.join(' | '));
  await b.close(); await s.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
