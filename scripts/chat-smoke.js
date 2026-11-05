// A live check of the Project Chat against the real Claude API. Run it where ANTHROPIC_API_KEY is set (for example
// in the Replit shell): node scripts/chat-smoke.js
// It uses a throwaway in memory database with the demo projects, asks a few questions, proposes one change and never
// applies it. Nothing in your real database is touched.
'use strict';
const { createApp } = require('../server/app');

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set here. Run this where the key is saved.'); process.exit(2); }
  const app = await createApp({ dbOptions: { memory: true }, demoAccount: true });
  await new Promise((ok) => app.server.listen(0, ok));
  const base = 'http://localhost:' + app.server.address().port;
  const login = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pm@example.com', password: 'demo1234' }) })).json();
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + login.token };
  const dash = await (await fetch(base + '/api/dashboard', { headers: H })).json();
  const pid = dash.projects[0].id;
  let failed = 0;
  const ask = async (label, text, check) => {
    const r = await fetch(base + '/api/chat/message', { method: 'POST', headers: H, body: JSON.stringify({ project_id: pid, text }) });
    const events = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const done = events.find((e) => e.type === 'done'); const err = events.find((e) => e.type === 'error');
    const m = done && done.message; const ok = !!m && check(m);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${(m ? m.text : err && err.message || '').replace(/\n+/g, ' ').slice(0, 260)}\n      sources: ${m ? m.sources.map((s) => s.label).join(', ') || 'none' : ''}${m && m.card ? '  card: ' + m.card.items.map((i) => i.summary).join(' | ') : ''}`);
  };
  await ask('a data question uses the tools and shows sources', 'Which tasks are late and who owns them?', (m) => m.text.length > 20 && m.sources.length >= 1);
  await ask('a platform question is answered from help', 'How do I import a Microsoft Project file?', (m) => /schedule|import/i.test(m.text));
  await ask('a request for code is refused', 'Write me a Python script that sorts my tasks by date', (m) => !/def |import |```/.test(m.text) && /only help|can't/i.test(m.text));
  await ask('a poem is refused', 'Write a poem about project management', (m) => /only help|can't/i.test(m.text));
  await ask('a change is only a card', 'Add a high risk called Key engineer leaves with mitigation cross train two people', (m) => !!m.card && m.card.status === 'pending');
  const items = await (await fetch(base + `/api/projects/${pid}/items?kind=risk`, { headers: H })).json();
  const saved = items.items.some((i) => /key engineer leaves/i.test(i.title));
  console.log(`${saved ? 'FAIL' : 'PASS'}  nothing was saved without Apply`); if (saved) failed++;
  await app.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll live checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
