'use strict';
// The Claude path of a portfolio document, against a fake Anthropic endpoint. The env is set before the app loads.
// The sections are written from the portfolio facts only, and a failed answer falls back to the facts table.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let s, fake, mode = 'good';
const prompts = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const j = JSON.parse(b);
      prompts.push(j);
      if (mode === 'fail') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'down' } })); return; }
      const text = 'Written by the model for this section.';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + '\n\n');
      res.write('data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + '\n\n');
      res.end();
    });
  });
  await new Promise((ok) => fake.listen(0, ok));
  process.env.ANTHROPIC_BASE_URL = 'http://localhost:' + fake.address().port;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  s = await require('./helpers').start();
});
after(async () => { await s.close(); fake.close(); });

const custom = { name: 'Portfolio review', audience: 'Executive team', description: 'Where every project stands and what needs a decision', sections: [{ heading: 'Overview', guidance: 'Where the portfolio stands' }, { heading: 'Decisions', guidance: 'What the executives must decide' }, { heading: 'Risks', guidance: 'Main risks' }] };

test('each section is written by Claude from the portfolio facts, and the document belongs to no project', async () => {
  const u = await s.user('Exec'); await s.project(u.token, 'Alpha'); await s.project(u.token, 'Beta');
  mode = 'good'; prompts.length = 0;
  const r = await s.call('POST', '/api/portfolio/generate', { custom, format: 'pptx' }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = r.data.generated;
  assert.equal(r.data.engine, 'claude'); assert.equal(r.data.draft, true);
  assert.equal(g.project_id, null); assert.equal(g.portfolio, true); assert.equal(g.format, 'pptx'); assert.equal(g.meta.project, 'Portfolio');
  const heads = g.content.split('\n').filter((l) => /^# /.test(l)).map((l) => l.slice(2));
  assert.deepEqual(heads, ['Overview', 'Decisions', 'Risks']);
  assert.equal((g.content.match(/Written by the model for this section\./g) || []).length, 3);
  assert.equal(prompts.length, 3, 'one call per section');
  const user = JSON.stringify(prompts.map((p) => p.messages));
  assert.match(user, /Alpha/); assert.match(user, /Beta/); assert.match(user, /Projects in the portfolio: 2/); assert.match(user, /What the executives must decide/);
  assert.match(prompts[0].system, /Use only the supplied facts/);
  // nothing was filed in either project
  const list = (await s.call('GET', '/api/projects', null, u.token)).data.projects;
  for (const p of list) assert.equal((await s.call('GET', `/api/projects/${p.id}/generated`, null, u.token)).data.generated.length, 0);
});

test('when the model fails, the sections fall back to the facts table and the guidance, and nothing is invented', async () => {
  const u = await s.user('Exec'); await s.project(u.token, 'Gamma');
  mode = 'fail';
  const r = await s.call('POST', '/api/portfolio/generate', { custom }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = r.data.generated.content;
  assert.match(c, /\| Gamma \|/, 'the first section carries the facts table');
  assert.match(c, /_What the executives must decide_/); assert.match(c, /To be completed by the project manager/);
  assert.doesNotMatch(c, /Written by the model/);
});

test('a portfolio document needs a name, a section and at least one project', async () => {
  const none = await s.user('Nobody');
  assert.equal((await s.call('POST', '/api/portfolio/generate', { custom }, none.token)).status, 400);
  const u = await s.user('Exec'); await s.project(u.token, 'Delta');
  assert.equal((await s.call('POST', '/api/portfolio/generate', { custom: { ...custom, name: '' } }, u.token)).status, 400);
  assert.equal((await s.call('POST', '/api/portfolio/generate', { custom: { ...custom, sections: [] } }, u.token)).status, 400);
  assert.equal((await s.call('POST', '/api/portfolio/generate', {}, u.token)).status, 400);
});
