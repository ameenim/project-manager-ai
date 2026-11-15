#!/usr/bin/env node
// Real browser check of the widget builder: every chart type, rules, split, calc, light, dark, Arabic and phone.
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
const { start } = require('../test/helpers');
const { seed } = require('./perf-seed');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d ? '  ' + d : '')); };
(async () => {
  const s = await start({ snapshotJob: false, opsJobs: false, noScheduler: true });
  const u = await s.user('Builder'); await seed(s, u.token, 60);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('pm_token', t); localStorage.setItem('pm_onboard', JSON.stringify({ done: true, tour: true, phone: '', hide: true })); } catch (e) { /* ignore */ } }, u.token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(s.base + '/app.html#/widgets/new', { waitUntil: 'load' });
  await page.waitForSelector('.wb-vcard', { timeout: 20000 });
  await sleep(500);
  const vizList = await page.$$eval('[data-viz]', (els) => els.map((e) => e.dataset.viz));
  check('21 chart types in the picker', vizList.length === 21, String(vizList.length));
  await page.fill('#wbTitle', 'Check widget'); await sleep(300);
  const bad = [];
  for (const v of vizList) {
    await page.click(`[data-viz="${v}"]`); await sleep(350);
    const st = await page.evaluate(() => ({ msg: document.querySelector('#wbMsg') && !document.querySelector('#wbMsg').hidden ? document.querySelector('#wbMsg').textContent : '', body: document.querySelector('#wbPreview').innerText.length, raw: /\b(wb_|wk_)[a-z_0-9]+/.test(document.querySelector('.wb').innerText), over: document.documentElement.scrollWidth > innerWidth + 2 }));
    if (st.msg || st.raw || st.over || !st.body) bad.push(v + ':' + JSON.stringify(st));
  }
  check('every chart type previews with no error, raw key or overflow', !bad.length, bad.join(' | '));
  // rules
  await page.click('[data-viz="kpi"]'); await sleep(200);
  await page.click('#wbAddRule'); await page.fill('#wb_rules_0_value', '5'); await sleep(400);
  check('an alert rule can be added', await page.$$eval('.wb-rule', (e) => e.length) === 1);
  check('rule color shows in preview', await page.evaluate(() => /k-bad|tone|bad/.test(document.querySelector('#wbPreview').innerHTML)));
  // calc
  await page.selectOption('#wb_agg', 'calc'); await sleep(400);
  check('calculated field shows its editor', !!(await page.$('#wb_calc_op')));
  // filter in list
  await page.click('#wbAddFilter'); await sleep(200);
  check('filter row added', await page.$$eval('.wb-filter', (e) => e.length) === 1);
  // save draft
  await page.fill('.wb-filter input[data-fk="value"]', 'x').catch(() => {}); await sleep(300);
  check('save enabled with a valid spec', await page.$eval('#wbSave', (b) => !b.disabled), await page.$eval('#wbMsg', (e) => e.textContent));
  // themes, Arabic, phone
  for (const [name, fn] of [['dark', () => document.documentElement.setAttribute('data-theme', 'dark')], ['arabic', () => { document.documentElement.setAttribute('dir', 'rtl'); document.documentElement.setAttribute('lang', 'ar'); }]]) {
    await page.evaluate(fn); await sleep(200);
    check(name + ' has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  await page.setViewportSize({ width: 390, height: 800 }); await sleep(400);
  check('phone has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/builder-phone.png', fullPage: false });
  check('no console errors', !errors.length, errors.join(' | '));
  await browser.close(); await s.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
