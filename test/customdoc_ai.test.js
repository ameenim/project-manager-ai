'use strict';
// The Claude path of custom documents, against a fake Anthropic endpoint. The env is set before the app loads.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let s, fake, mode = 'good';
const PLAN = { base_type: 'governance', summary: 'A steering update needs status, risks and decisions.', sections: [
  { heading: 'Where we stand', key: 'p_summary', guidance: 'Status in a few lines.' },
  { heading: 'Risks to watch', key: 'p_risks', guidance: 'Open risks.' },
  { heading: 'Stakeholder sentiment', key: null, guidance: 'How the sponsors feel.' },
  { heading: 'Asks of the committee', key: 'p_actions', guidance: 'Decisions needed.' },
  { heading: 'Made up key', key: 'zzz', guidance: 'Falls back to the brief.' },
] };
before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const j = JSON.parse(b);
      const isPlan = /plan professional/.test(j.system || '');
      const text = isPlan ? (mode === 'bad' ? 'I cannot do that.' : mode === 'short' ? JSON.stringify({ sections: [{ heading: 'One', key: null }] }) : '```json\n' + JSON.stringify(PLAN) + '\n```') : 'Drafted from the brief.';
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

const brief = { name: 'Steering committee update', audience: 'Executive sponsor', description: 'A short status update with risks and the decisions we need from the committee.' };
const CONTRACT = 'Client: Ministry of Test\nContract value: AED 1,000,000\nStart date: 2027-03-01\nEnd date: 2027-09-30';

test('Claude picks the sections, and bad answers fall back to the rule based suggestion', async () => {
  const u = await s.user();
  const p = await s.project(u.token, 'AI plan', CONTRACT);
  await s.until(async () => !(await s.call('GET', `/api/projects/${p.id}`, null, u.token)).data.project.analyzing);
  mode = 'good';
  const r = await s.call('POST', `/api/projects/${p.id}/doc-plan`, brief, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const pl = r.data.plan;
  assert.equal(pl.engine, 'claude'); assert.equal(pl.base_type, 'governance'); assert.equal(pl.summary, PLAN.summary);
  assert.deepEqual(pl.sections.map((x) => x.heading), PLAN.sections.map((x) => x.heading));
  assert.deepEqual(pl.sections.map((x) => x.key), ['p_summary', 'p_risks', null, 'p_actions', null], 'an unknown key becomes a section written from the brief');
  for (const bad of ['bad', 'short']) {
    mode = bad;
    const f = await s.call('POST', `/api/projects/${p.id}/doc-plan`, brief, u.token);
    assert.equal(f.status, 200); assert.equal(f.data.plan.engine, 'rules', bad); assert.ok(f.data.plan.sections.length >= 3);
  }
  mode = 'good';
  // generation drafts the narrative with Claude and keeps the chosen order
  const g = await s.call('POST', `/api/projects/${p.id}/generate`, { type: pl.base_type, custom: { ...brief, sections: pl.sections } }, u.token);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.engine, 'claude');
  const heads = g.data.generated.content.split('\n').filter((l) => /^# /.test(l)).map((l) => l.slice(2));
  assert.deepEqual(heads, PLAN.sections.map((x) => x.heading));
  assert.match(g.data.generated.content, /Drafted from the brief\./);
  assert.doesNotMatch(g.data.generated.content, /To be completed by the project manager/);
});
