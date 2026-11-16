#!/usr/bin/env node
// Real browser check: in All projects a document is created as a draft. A portfolio document cannot be saved to a project,
// a document about one project can, and the card says so in plain words.
'use strict';
delete process.env.DATABASE_URL; delete process.env.REPLIT_DEPLOYMENT; delete process.env.ANTHROPIC_API_KEY;
const { start } = require('../test/helpers');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d ? '  ' + d : '')); };
const sections = [{ heading: 'Overview', guidance: 'Where we stand' }, { heading: 'Risks', guidance: 'Main risks' }, { heading: 'Next steps', guidance: 'Actions' }];
const script = [];
async function* model() {
  const next = script.shift() || [{ type: 'text', text: 'Done.' }];
  for (const e of next) yield e;
  yield { type: 'done', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}
const doc = (input) => { script.push([{ type: 'tool_use', id: 'd' + Math.random(), name: 'create_custom_document', input }]); script.push([{ type: 'text', text: 'Prepared the document. Nothing is saved until you press Apply.' }]); };
(async () => {
  const s = await start({ chatModel: model, snapshotJob: false, opsJobs: false, noScheduler: true });
  const u = await s.user('Docs'); const a = await s.project(u.token, 'Alpha'); await s.project(u.token, 'Beta');
  const mobile = process.env.MOBILE === '1';
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 800 } : { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript((t) => { localStorage.setItem('pm_token', t); localStorage.setItem('pm_onboard', JSON.stringify({ done: true, tour: true, phone: '', hide: true })); }, u.token);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(s.base + '/app.html#/thinking', { waitUntil: 'load' });
  await page.waitForSelector('#chtIn', { timeout: 20000 }); await sleep(600);

  // 1. a portfolio document
  doc({ name: 'Portfolio status report', audience: 'Executive team', description: 'Where all projects stand', sections });
  await page.fill('#chtIn', 'Create a portfolio report for all my projects'); await page.press('#chtIn', 'Enter');
  await page.waitForSelector('.cht-card [data-act="apply"]', { timeout: 20000 });
  const head = await page.$eval('.cht-card .cht-card-h', (e) => e.innerText);
  check('the card names All projects, not a missing project', /All projects/i.test(head), head);
  check('the card lists Related project as none', /Related project/i.test(await page.$eval('.cht-card', (e) => e.innerText)));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + `/portfolio-pending${mobile ? '-m' : ''}.png` });
  await page.click('.cht-card [data-act="apply"]'); await page.waitForSelector('.cht-card [data-act="dropen"]', { timeout: 20000 }); await sleep(500);
  const dis = await page.$('.cht-card button[aria-disabled="true"]');
  check('Save to project is shown but disabled', !!dis && /Save to project/.test(await dis.innerText()));
  check('the card explains why it cannot be saved', /cannot be saved to a single project/i.test(await page.$eval('.cht-card', (e) => e.innerText)));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + `/portfolio-applied${mobile ? '-m' : ''}.png` });
  await page.click('.cht-card [data-act="dropen"]'); await page.waitForSelector('.overlay .md', { timeout: 10000 });
  check('Open shows the document text', /Overview/.test(await page.$eval('.overlay .md', (e) => e.innerText)));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + `/portfolio-open${mobile ? '-m' : ''}.png` });
  await page.keyboard.press('Escape'); await sleep(400);
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('.cht-card [data-act="drdl"]');
  const file = await dl.catch(() => null);
  check('Download gives a Word file', !!file && /\.docx$/.test(file.suggestedFilename()), file && file.suggestedFilename());
  check('nothing was saved to any project', (await s.call('GET', `/api/projects/${a.id}/generated`, null, u.token)).data.generated.length === 0);

  // 2. a document about one project
  doc({ project_id: a.id, name: 'Alpha steering brief', audience: 'Steering committee', description: 'Brief', sections, format: 'docx' });
  await page.fill('#chtIn', 'Create a steering brief for my project Alpha'); await page.press('#chtIn', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.cht-card [data-act="apply"]').length > 0, null, { timeout: 20000 });
  await page.click('.cht-card [data-act="apply"]');
  await page.waitForSelector('.cht-card [data-act="drsave"]', { timeout: 20000 });
  const sv = await page.$('.cht-card [data-act="drsave"]');
  check('Save to the related project is on and names it', /Save to Alpha/.test(await sv.innerText()));
  await sv.click(); await page.waitForSelector('.cht-card a[href$="/reports"]', { timeout: 20000 }); await sleep(400);
  check('after saving the card links to Reports and says Saved to Alpha', /Saved to Alpha/.test(await page.$$eval('.cht-draft-note', (e) => e.map((x) => x.innerText).join(' '))));
  const list = (await s.call('GET', `/api/projects/${a.id}/generated`, null, u.token)).data.generated;
  check('the document is now in the project Reports', list.length === 1 && list[0].title === 'Alpha steering brief');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + `/saved${mobile ? '-m' : ''}.png` });
  check('no console errors', !errors.length, errors.join(' | '));
  await b.close(); await s.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
