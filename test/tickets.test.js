'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const fx = require('../server/ticketfix');
const T = require('../server/tickets');

process.env.SUPER_ADMIN_EMAILS = 'boss@test.co';
process.env.TICKET_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.SITE_URL = 'https://pm.example.com';
delete process.env.ANTHROPIC_API_KEY;
const SECRET = process.env.TICKET_WEBHOOK_SECRET;

let s, boss, alice, bob, carol;
const dispatched = [];
let dispatchError = null, configured = true;
const dispatcher = { configured: () => configured, describe: () => ({ repo: 'owner/repo', branch: 'dev' }), dispatch: async (p) => { if (dispatchError) throw dispatchError; dispatched.push(p); } };
const A = (m, p, b, t) => s.call(m, p, m === 'GET' ? undefined : b, t || boss.token);
const settle = () => s.app.tickets.idle();
const letters = () => Array.from({ length: 8 }, () => 'abcdefghij'[Math.floor(Math.random() * 10)]).join('');
const plainCtx = () => ({ route: `#/area${letters()}`, lang: 'en', technical: true, breadcrumbs: [{ at: '2026-11-05T10:00:00Z', a: 'click', l: 'Export', r: '#/x' }] });
const ctx = (over) => ({ route: '#/p/123/schedule', lang: 'en', technical: true, breadcrumbs: [{ at: '2026-11-05T10:00:00Z', a: 'click', l: 'Export', r: '#/p/123/schedule' }], failed_request: { method: 'GET', path: '/api/projects/123/export', status: 500, ref: 'abc12345', message: 'Something went wrong on the server (reference abc12345). Try again.' }, ...over });
async function report(user, body) { if (!body || !body.keepRate) s.app.tickets.rate.clear(); const r = await s.call('POST', '/api/tickets', { kind: 'bug', title: 'Export fails', description: 'It crashes when I export.', context: plainCtx(), ...body }, user.token); assert.equal(r.status, 200, JSON.stringify(r.data)); await settle(); return r.data.ticket; }
const mine = async (user, id) => (await s.call('GET', `/api/tickets/${id}`, null, user.token)).data;
const hook = (method, path, obj, o = {}) => {
  const raw = obj === undefined ? '' : JSON.stringify(obj); const ts = String(o.ts || Date.now());
  const sig = o.sig || fx.sign(SECRET, ts, `${method} ${path}\n${raw}`);
  return s.call(method, path, raw || undefined, null, { 'x-ticket-timestamp': ts, 'x-ticket-signature': sig, ...(raw ? { 'content-type': 'application/json' } : {}) });
};
// puts a ticket into the state "being fixed" by calling the real admin endpoint
async function fixing(ticket, notes) { const r = await A('POST', `/api/admin/tickets/${ticket.id}/fix`, { notes }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; }
const result = (t, over) => ({ attempt: 1, phase: 'fixed', ci: 'passed', merged: true, branch: 'ticket/T-1-1', pr_url: 'https://github.com/owner/repo/pull/9', run_url: 'https://github.com/owner/repo/actions/runs/1', files_changed: ['public/app_schedule.js', 'test/schedule.test.js'], lines_changed: 30, root_cause: 'A date was parsed twice.', summary: 'Parsed once.', reporter_message: 'The export problem is fixed and is being checked.', tests_added: ['test/schedule.test.js'], confidence: 0.9, ...over });

before(async () => {
  s = await start({ opsJobs: false, ticketDispatcher: dispatcher });
  process.env.SUPER_ADMIN_ALLOW_REGISTER = '1';
  const r = await s.call('POST', '/api/auth/register', { name: 'Boss', email: 'boss@test.co', password: 'Pm-Test-4821' });
  delete process.env.SUPER_ADMIN_ALLOW_REGISTER;
  boss = { token: r.data.token, id: r.data.user.id, email: 'boss@test.co' };
  alice = await s.user('Alice'); bob = await s.user('Bob'); carol = await s.user('Carol');
});
after(() => s.close());

// ---------- reporting ----------
test('a signed in person reports a problem, AI triage runs, and they see it move to triaged', async () => {
  const t = await report(alice, {});
  assert.equal(t.ref.startsWith('T-'), true);
  const d = await mine(alice, t.id);
  assert.equal(d.ticket.status, 'triaged');
  assert.deepEqual(d.timeline.map((e) => e.type), ['reported', 'triaged']);
  assert.ok(d.timeline.every((e) => e.by === 'team' || e.by === 'you'));
});
test('anonymous callers are refused and one person cannot see another person\'s ticket', async () => {
  const t = await report(alice, { title: 'Private thing about payroll', description: 'secret details' });
  assert.equal((await s.call('GET', '/api/tickets')).status, 401);
  assert.equal((await s.call('POST', '/api/tickets', { title: 'x' })).status, 401);
  for (const [m, p, b] of [['GET', `/api/tickets/${t.id}`], ['POST', `/api/tickets/${t.id}/reply`, { message: 'hi' }], ['POST', `/api/tickets/${t.id}/confirm`, {}], ['POST', `/api/tickets/${t.id}/reopen`, {}]]) assert.equal((await s.call(m, p, b, bob.token)).status, 404, p);
  const list = (await s.call('GET', '/api/tickets', null, bob.token)).data.tickets;
  assert.ok(!JSON.stringify(list).includes('payroll'));
});
test('the reporter view never carries triage, the debugging package, or the reporter email', async () => {
  const t = await report(alice, { title: 'Chart colors look wrong' });
  const raw = JSON.stringify(await mine(alice, t.id));
  for (const k of ['"triage"', '"context"', '"suspected_files"', 'confidence', 'fix_state', 'breadcrumbs', alice.email]) assert.ok(!raw.includes(k), k);
});
test('input is validated and secrets are removed before anything is stored', async () => {
  assert.equal((await s.call('POST', '/api/tickets', { title: '   ' }, alice.token)).status, 400);
  assert.equal((await s.call('POST', '/api/tickets', { kind: 'rant', title: 'x' }, alice.token)).status, 400);
  const tok = 'a'.repeat(64);
  const t = await report(alice, { title: 'Sign in loop', description: `It said Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 and password=hunter2hunter2 and token ${tok} and key sk-ant-api03-abcdefghijk`, context: ctx({ failed_request: { method: 'POST', path: '/api/x?token=SECRETVALUE&a=1', status: 500, message: 'password: "hunter2"' } }) });
  const row = (await s.app.db.query('SELECT description, context FROM tickets WHERE id = $1', [t.id])).rows[0];
  const all = JSON.stringify(row);
  for (const bad of ['hunter2', 'abcdefghijklmnopqrstuvwxyz123456', tok, 'sk-ant-api03', 'SECRETVALUE']) assert.ok(!all.includes(bad), bad);
  assert.match(row.description, /\[redacted\]|\[token\]|\[key\]/);
});
test('a reporter who turns off technical details sends only the page', async () => {
  const t = await report(alice, { title: 'Odd layout', context: ctx({ technical: false, error: { message: 'boom', stack: 'at x (a.js:1:1)' } }) });
  const c = (await s.app.db.query('SELECT context FROM tickets WHERE id = $1', [t.id])).rows[0].context;
  assert.equal(c.technical, false); assert.equal(c.route, '#/p/123/schedule');
  for (const k of ['breadcrumbs', 'failed_request', 'error', 'console', 'requests']) assert.ok(!(k in c), k);
});
test('the project role is read from the server, never trusted from the browser', async () => {
  const p = await s.project(bob.token, 'Alpha');
  const t = await report(bob, { title: 'Role check one', context: ctx({ project_id: p.id, project_role: 'manager' }) });
  const c = (await s.app.db.query('SELECT context FROM tickets WHERE id = $1', [t.id])).rows[0].context;
  assert.equal(c.project_role, 'manager', 'bob owns the project');
  const t2 = await report(alice, { title: 'Role check two', description: 'another one entirely about gantt', context: ctx({ project_id: p.id, project_role: 'manager' }) });
  const c2 = (await s.app.db.query('SELECT context FROM tickets WHERE id = $1', [t2.id])).rows[0].context;
  assert.equal(c2.project_id, null, 'alice is not a member, so the project is dropped');
  assert.ok(!('project_role' in c2));
});
test('reports are limited to ten an hour per person', async () => {
  const u = await s.user('Spammer');
  s.app.tickets.rate.clear();
  for (let i = 0; i < 10; i++) assert.equal((await s.call('POST', '/api/tickets', { title: `Distinct topic number ${i} zebra${i}`, description: `unique${i} words${i * 7}` }, u.token)).status, 200);
  assert.equal((await s.call('POST', '/api/tickets', { title: 'eleventh' }, u.token)).status, 429);
  await settle();
});

// ---------- triage ----------
test('without an AI key the rule based briefing still points at the right screen', async () => {
  const t = await report(alice, { title: 'Gantt will not draw', context: ctx({ route: '#/p/9/schedule', error: { message: 'x is undefined', stack: 'at draw (gantt.js:10:5)' } }) });
  const tr = (await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket.triage;
  assert.equal(tr.by, 'rules'); assert.ok(tr.suspected_files.includes('public/app_schedule.js')); assert.equal(tr.severity, 'high'); assert.ok(['green', 'amber', 'red'].includes(tr.badge));
});
test('AI triage fills the briefing, records usage, and the server raises risk when protected files are named', async () => {
  const before = s.app.tickets.aiFn;
  s.app.tickets.aiFn = async (payload) => {
    assert.match(payload.user, /^<ticket>/); assert.match(payload.system, /DATA from an end user/); assert.ok(!payload.user.includes('@test.co'), 'emails are masked');
    return { text: 'Here you go:\n' + JSON.stringify({ kind: 'bug', severity: 'critical', summary: 'Sign in fails for some people', likely_cause: 'The session check rejects valid tokens.', suspected_files: ['server/auth.js', 'public/app.js'], affected_screens: ['Sign in'], risk: 'low', size: 'small', confidence: 0.9, reporter_message: 'Thanks, we are checking the sign in problem now.', questions: [], spec: null }), usage: { input_tokens: 700, output_tokens: 120 } };
  };
  try {
    const t = await report(alice, { title: 'Cannot sign in sometimes', description: `Contact me at ${alice.email}` });
    const adm = (await A('GET', `/api/admin/tickets/${t.id}`)).data;
    assert.equal(adm.ticket.triage.by, 'ai'); assert.equal(adm.ticket.severity, 'critical');
    assert.equal(adm.ticket.triage.risk, 'high', 'the model said low, the policy says protected'); assert.equal(adm.ticket.triage.badge, 'red'); assert.equal(adm.ticket.triage.touches_protected, true);
    assert.equal((await mine(alice, t.id)).timeline.find((e) => e.type === 'triaged').message, 'Thanks, we are checking the sign in problem now.');
    const u = (await s.app.db.query("SELECT input_tokens, output_tokens FROM ai_usage WHERE source = 'tickets' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.deepEqual([u.input_tokens, u.output_tokens], [700, 120]);
  } finally { s.app.tickets.aiFn = before; }
});
test('a small safe high confidence briefing gets the green badge', () => {
  const r = T.normalizeTriage({ risk: 'low', size: 'small', confidence: 0.85, suspected_files: ['public/app_schedule.js'] }, { kind: 'bug', title: 't' });
  assert.equal(r.badge, 'green');
  assert.equal(T.normalizeTriage({ risk: 'low', size: 'large', confidence: 0.9 }, { kind: 'bug', title: 't' }).badge, 'amber');
  assert.equal(T.normalizeTriage({ risk: 'low', size: 'small', confidence: 0.3 }, { kind: 'bug', title: 't' }).badge, 'amber');
});
test('AI text that contains code or a secret never reaches the reporter, and unreadable answers fall back to rules', async () => {
  const before = s.app.tickets.aiFn;
  try {
    s.app.tickets.aiFn = async () => ({ text: JSON.stringify({ severity: 'low', reporter_message: 'Try this: ```const x = 1;``` ' }), usage: {} });
    const t1 = await report(alice, { title: 'Guard check alpha beta', description: 'zeta eta theta iota' });
    const m1 = (await mine(alice, t1.id)).timeline.find((e) => e.type === 'triaged');
    assert.equal(m1.canned, true); assert.ok(!m1.message.includes('```'));
    s.app.tickets.aiFn = async () => ({ text: 'I cannot help with that', usage: {} });
    const t2 = await report(alice, { title: 'Fallback check kappa lambda', description: 'mu nu xi omicron' });
    assert.equal((await A('GET', `/api/admin/tickets/${t2.id}`)).data.ticket.triage.by, 'rules');
    s.app.tickets.aiFn = async () => { throw new Error('API down'); };
    const t3 = await report(alice, { title: 'Outage check pi rho sigma', description: 'tau upsilon phi chi' });
    assert.equal((await mine(alice, t3.id)).ticket.status, 'triaged', 'a failing AI never blocks a ticket');
  } finally { s.app.tickets.aiFn = before; }
});
test('an enhancement gets a draft spec for the super admin to approve', async () => {
  const t = await report(alice, { kind: 'enhancement', title: 'Add dark mode to the Gantt chart', description: 'Please', context: ctx({ failed_request: null }) });
  const adm = (await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket;
  assert.equal(adm.severity, 'low'); assert.equal(adm.triage.spec.goal, 'Add dark mode to the Gantt chart'); assert.ok(Array.isArray(adm.triage.spec.acceptance_criteria));
});

// ---------- duplicates ----------
test('the same failure from two people becomes one main ticket, and each person keeps their own words', async () => {
  const c1 = ctx({ route: '#/p/501/reports', failed_request: { method: 'POST', path: '/api/projects/501/report', status: 500, ref: 'aaaa1111', message: 'Something went wrong on the server (reference aaaa1111). Try again.' } });
  const c2 = ctx({ route: '#/p/777/reports', failed_request: { method: 'POST', path: '/api/projects/777/report', status: 500, ref: 'bbbb2222', message: 'Something went wrong on the server (reference bbbb2222). Try again.' } });
  const a = await report(alice, { title: 'Report generation breaks', description: 'Word export blank', context: c1 });
  const b = await report(bob, { title: 'Cannot create the weekly report', description: 'Spinner forever', context: c2 });
  assert.equal(a.shared, false); assert.equal(b.shared, true);
  assert.equal(b.title, 'Cannot create the weekly report', 'bob sees his own title');
  const list = (await A('GET', '/api/admin/tickets?q=Report generation')).data.tickets;
  const main = list.find((x) => x.id === a.id);
  assert.equal(main.occurrences, 2); assert.equal(main.duplicates, 1);
  assert.ok(!(await A('GET', '/api/admin/tickets?q=weekly report')).data.tickets.some((x) => x.id === b.id), 'the linked report is not listed on its own');
  const det = (await A('GET', `/api/admin/tickets/${a.id}`)).data;
  assert.equal(det.reports.length, 1); assert.equal(det.reports[0].description, 'Spinner forever');
});
test('a linked report follows the status of the main ticket and receives its updates', async () => {
  const c = ctx({ route: '#/p/42/inbox', failed_request: { method: 'GET', path: '/api/inbox', status: 500, ref: 'cccc3333', message: 'Inbox failed (reference cccc3333)' } });
  const a = await report(alice, { title: 'Inbox will not load', description: 'blank page', context: c });
  const b = await report(bob, { title: 'Inbox empty and error', description: 'toast error', context: { ...c, failed_request: { ...c.failed_request, ref: 'dddd4444', message: 'Inbox failed (reference dddd4444)' } } });
  assert.equal(b.status, 'triaged', 'main is triaged, so the linked report shows that');
  assert.equal((await A('POST', `/api/admin/tickets/${a.id}/status`, { status: 'needs_info', message: 'Which browser are you on?' })).status, 200);
  const bd = await mine(bob, b.id);
  assert.equal(bd.ticket.status, 'needs_info'); assert.equal(bd.ticket.unread, false);
  assert.ok(bd.timeline.some((e) => e.message === 'Which browser are you on?'), 'the question reaches the linked reporter too');
});
test('the pre submit check says a problem is known without naming anyone else\'s ticket', async () => {
  const c = ctx({ route: '#/p/42/inbox', failed_request: { method: 'GET', path: '/api/inbox', status: 500, ref: 'eeee5555', message: 'Inbox failed (reference eeee5555)' } });
  const r = await s.call('POST', '/api/tickets/check', { kind: 'bug', title: 'Inbox broken', description: '', context: c }, carol.token);
  assert.equal(r.status, 200); assert.equal(r.data.known, true); assert.deepEqual(Object.keys(r.data).sort(), ['known', 'status']);
  const none = await s.call('POST', '/api/tickets/check', { kind: 'bug', title: 'Completely unrelated quokka request', description: 'wombat platypus', context: { route: '#/zzz' } }, carol.token);
  assert.deepEqual(none.data, { known: false });
});
test('text similarity links reports without an error, and unrelated reports stay apart', async () => {
  const a = await report(alice, { title: 'Gantt bars overlap when zooming timeline', description: 'gantt bars overlap when zooming timeline', context: { route: '#/p/5/schedule' } });
  const b = await report(bob, { title: 'Gantt bars overlap when zooming timeline', description: 'gantt bars overlap when zooming timeline', context: { route: '#/p/6/schedule' } });
  const c = await report(carol, { title: 'Invoice total shows wrong currency', description: 'currency symbol is dollars instead of dirhams', context: { route: '#/billing' } });
  assert.equal(a.shared, false); assert.equal(b.shared, true); assert.equal(c.shared, false);
  assert.ok(T.similarity('a b c', 'x y z').score === 0);
});
test('a wrong match can be unlinked and then stands on its own', async () => {
  const a = await report(alice, { title: 'Calendar export button misaligned on phones', description: 'the calendar export button sits off screen on small phones', context: { route: '#/calendar' } });
  const b = await report(bob, { title: 'Calendar export button misaligned', description: 'export button on calendar is off screen on phones', context: { route: '#/calendar' } });
  assert.equal(b.shared, true);
  assert.equal((await A('POST', `/api/admin/tickets/${b.id}/unlink`)).status, 200);
  assert.equal((await mine(bob, b.id)).ticket.shared, false);
  assert.equal((await A('GET', '/api/admin/tickets?q=Calendar export')).data.tickets.find((x) => x.id === a.id).occurrences, 1);
  await settle();
  assert.equal((await A('POST', `/api/admin/tickets/${a.id}/unlink`)).status, 400, 'a main ticket cannot be unlinked');
});

// ---------- the super admin ----------
test('ticket screens are for super admins only', async () => {
  for (const [m, p] of [['GET', '/api/admin/tickets'], ['GET', '/api/admin/tickets/stats'], ['GET', '/api/admin/tickets/1'], ['POST', '/api/admin/tickets/1/fix'], ['POST', '/api/admin/tickets/1/status'], ['POST', '/api/admin/tickets/publish-ready'], ['PUT', '/api/admin/tickets/1']]) {
    const body = m === 'GET' ? undefined : {};
    assert.equal((await s.call(m, p, body, alice.token)).status, 403, p);
    assert.equal((await s.call(m, p, body)).status, 401, p);
  }
});
test('the list filters, searches, and reports counts per status', async () => {
  const r = await A('GET', '/api/admin/tickets?status=open&kind=bug');
  assert.equal(r.status, 200); assert.ok(r.data.tickets.length > 3); assert.ok(r.data.counts.triaged > 0); assert.equal(r.data.pipeline.configured, true);
  assert.ok(r.data.tickets.every((t) => t.kind === 'bug'));
  assert.equal((await A('GET', `/api/admin/tickets?q=${encodeURIComponent('T-1')}`)).status, 200);
  const st = (await A('GET', '/api/admin/tickets/stats')).data; assert.ok(st.open > 0); assert.ok(st.needs_action > 0);
  assert.equal((await A('GET', '/api/admin/overview')).data.tickets.open, st.open);
});
test('the super admin can change severity and type, and bad values are refused', async () => {
  const t = await report(alice, { title: 'Severity edit one', description: 'unique alpha1' });
  assert.equal((await A('PUT', `/api/admin/tickets/${t.id}`, { severity: 'low' })).status, 200);
  assert.equal((await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket.severity, 'low');
  assert.equal((await A('PUT', `/api/admin/tickets/${t.id}`, { severity: 'apocalyptic' })).status, 400);
  assert.equal((await A('PUT', `/api/admin/tickets/${t.id}`, { kind: 'nope' })).status, 400);
});
test('opening a ticket clears its unread flag and a reporter reply raises it again', async () => {
  const t = await report(alice, { title: 'Unread flag check', description: 'unique beta2' });
  assert.equal((await A('GET', '/api/admin/tickets')).data.tickets.find((x) => x.id === t.id).unread, true);
  await A('GET', `/api/admin/tickets/${t.id}`);
  assert.equal((await A('GET', '/api/admin/tickets')).data.tickets.find((x) => x.id === t.id).unread, false);
  await s.call('POST', `/api/tickets/${t.id}/reply`, { message: 'One more detail' }, alice.token);
  assert.equal((await A('GET', '/api/admin/tickets')).data.tickets.find((x) => x.id === t.id).unread, true);
});
test('status changes follow the allowed paths, and the super admin can write to the reporter', async () => {
  const t = await report(alice, { title: 'Status path check', description: 'unique gamma3' });
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/status`, { status: 'published' })).status, 409, 'a triaged ticket cannot jump to published');
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/status`, { status: 'fixing' })).status, 400, 'fixing is only reachable through Fix it');
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/status`, { status: 'needs_info' })).status, 400, 'a question needs text');
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/status`, { status: 'wont_fix', message: 'This is how it is meant to work.' })).status, 200);
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/reply`, { message: 'Thanks for flagging.' })).status, 200);
  const d = await mine(alice, t.id);
  assert.equal(d.ticket.status, 'wont_fix'); assert.deepEqual(d.timeline.slice(-2).map((e) => e.message), ['This is how it is meant to work.', 'Thanks for flagging.']);
  assert.equal((await s.call('POST', `/api/tickets/${t.id}/reply`, { message: 'hello?' }, alice.token)).status, 409, 'a closed ticket takes no replies');
});
test('a reporter answering a question moves the ticket back to the super admin', async () => {
  const t = await report(alice, { title: 'Needs info path', description: 'unique delta4' });
  await A('POST', `/api/admin/tickets/${t.id}/status`, { status: 'needs_info', message: 'Which project?' });
  assert.equal((await mine(alice, t.id)).ticket.status, 'needs_info');
  assert.equal((await s.call('POST', `/api/tickets/${t.id}/reply`, { message: '' }, alice.token)).status, 400);
  const r = await s.call('POST', `/api/tickets/${t.id}/reply`, { message: 'The Alpha project' }, alice.token);
  assert.equal(r.data.ticket.status, 'triaged'); assert.equal(r.data.timeline.at(-1).by, 'you');
});

// ---------- Fix it ----------
test('Fix it marks the ticket as being fixed, tells the reporter, and dispatches the job once', async () => {
  const t = await report(alice, { title: 'Fix it happy path', description: 'unique epsilon5' });
  dispatched.length = 0;
  const r = await A('POST', `/api/admin/tickets/${t.id}/fix`, { notes: 'Start in the export code.' });
  assert.equal(r.status, 200); assert.equal(r.data.attempt, 1); assert.equal(r.data.ticket.status, 'fixing');
  assert.equal(dispatched.length, 1); assert.equal(dispatched[0].ticket_id, t.id); assert.equal(dispatched[0].attempt, 1); assert.equal(dispatched[0].app_url, 'https://pm.example.com');
  assert.equal((await mine(alice, t.id)).ticket.status, 'fixing');
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/fix`, {})).status, 409, 'a second click does not start a second job');
  assert.equal(dispatched.length, 1);
  const audit = (await A('GET', '/api/admin/audit')).data;
  assert.ok(JSON.stringify(audit).includes('ticket.fix'));
});
test('Fix it is refused when it is not connected, and a failed dispatch puts the ticket back', async () => {
  const t = await report(alice, { title: 'Fix it refusals', description: 'unique zeta6' });
  configured = false;
  const off = await A('POST', `/api/admin/tickets/${t.id}/fix`, {}); configured = true;
  assert.equal(off.status, 503); assert.match(off.data.error, /GITHUB_DISPATCH_TOKEN/);
  dispatchError = Object.assign(new Error('GitHub refused the request.'), { status: 502, expose: true });
  const bad = await A('POST', `/api/admin/tickets/${t.id}/fix`, {}); dispatchError = null;
  assert.equal(bad.status, 502);
  const adm = (await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket;
  assert.equal(adm.status, 'triaged', 'back to where it was'); assert.equal(adm.fix.attempts, 0, 'the failed start did not use an attempt');
  assert.ok((await mine(alice, t.id)).timeline.some((e) => e.type === 'fix_cancelled'));
});
test('questions, linked reports and unknown tickets cannot be sent to Claude', async () => {
  const q = await report(alice, { kind: 'question', title: 'How do I rename a project', description: 'unique eta7' });
  assert.equal((await A('POST', `/api/admin/tickets/${q.id}/fix`, {})).status, 400);
  const c = ctx({ route: '#/p/42/inbox', failed_request: { method: 'GET', path: '/api/inbox', status: 500, ref: 'ffff6666', message: 'Inbox failed (reference ffff6666)' } });
  const linked = await report(carol, { title: 'Inbox again', description: 'x', context: c });
  assert.equal(linked.shared, true);
  assert.equal((await A('POST', `/api/admin/tickets/${linked.id}/fix`, {})).status, 400);
  assert.equal((await A('POST', '/api/admin/tickets/999999999/fix', {})).status, 404);
});
test('an enhancement needs an approved spec before Claude is asked to build it', async () => {
  const t = await report(alice, { kind: 'enhancement', title: 'Add CSV export to the risk radar', description: 'please', context: { route: '#/p/1/overview' } });
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/fix`, {})).status, 400);
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/fix`, { spec: { goal: 'Add CSV export', acceptance_criteria: [] } })).status, 400);
  const ok = await A('POST', `/api/admin/tickets/${t.id}/fix`, { spec: { goal: 'Add CSV export to the risk radar', acceptance_criteria: ['A button downloads a CSV', 'Arabic text is kept'] } });
  assert.equal(ok.status, 200);
  const pkg = (await hook('GET', `/api/hooks/tickets/${t.id}/package`)).data;
  assert.equal(pkg.kind, 'enhancement'); assert.equal(pkg.spec.acceptance_criteria.length, 2);
});
test('the attempt limit and the daily limit stop runaway fixes', async () => {
  const t = await report(alice, { title: 'Attempt limit check', description: 'unique theta8' });
  await A('PUT', '/api/admin/config', { settings: { fix_max_attempts: 1 } });
  await fixing(t);
  await hook('POST', `/api/hooks/tickets/${t.id}/report`, { attempt: 1, phase: 'failed', error: 'Tests kept failing.' });
  const again = await A('POST', `/api/admin/tickets/${t.id}/fix`, {});
  assert.equal(again.status, 409); assert.match(again.data.error, /already tried 1 times/);
  await A('PUT', '/api/admin/config', { settings: { fix_max_attempts: 3, fix_daily_cap: 0 } });
  const t2 = await report(alice, { title: 'Daily cap check', description: 'unique iota9' });
  assert.equal((await A('POST', `/api/admin/tickets/${t2.id}/fix`, {})).status, 403);
  await A('PUT', '/api/admin/config', { settings: { fix_daily_cap: 1 } });
  assert.equal((await A('POST', `/api/admin/tickets/${t2.id}/fix`, {})).status, 429, 'one fix was already started within 24 hours');
  await A('PUT', '/api/admin/config', { settings: { fix_daily_cap: 100 } });
});

// ---------- the fix job calls back ----------
test('the job webhook rejects missing, wrong, tampered and expired signatures', async () => {
  const t = await report(alice, { title: 'Webhook signature check', description: 'unique kappa10' });
  const p = `/api/hooks/tickets/${t.id}/package`;
  assert.equal((await s.call('GET', p)).status, 401);
  assert.equal((await hook('GET', p, undefined, { sig: 'f'.repeat(64) })).status, 401);
  assert.equal((await hook('GET', p, undefined, { ts: Date.now() - 10 * 60e3 })).status, 401);
  assert.equal((await s.call('GET', p, null, alice.token)).status, 401, 'a user session is not a job signature');
  const body = { attempt: 1, phase: 'running' }; const ts = String(Date.now());
  const sig = fx.sign(SECRET, ts, `POST /api/hooks/tickets/${t.id}/report\n${JSON.stringify(body)}`);
  assert.equal((await hook('POST', `/api/hooks/tickets/${t.id}/report`, { ...body, phase: 'fixed' }, { ts, sig })).status, 401, 'the body was changed after signing');
  assert.equal((await hook('GET', p)).status, 200);
  assert.equal((await hook('POST', p, {})).status, 405);
  const saved = process.env.TICKET_WEBHOOK_SECRET; delete process.env.TICKET_WEBHOOK_SECRET;
  assert.equal((await hook('GET', p)).status, 503, 'with no secret set nothing is accepted'); process.env.TICKET_WEBHOOK_SECRET = saved;
});
test('the package for the job has no reporter identity, masks emails, and joins the server log by reference', async () => {
  await s.app.ops.logError({ kind: 'server', status: 500, method: 'GET', path: '/api/projects/123/export', message: 'Cannot read properties of undefined (reading "end")', stack: 'TypeError at exportDoc (server/exporter.js:10:5)', ref: 'abc12345' });
  const t = await report(alice, { title: 'Package contents check', description: `Please email ${alice.email} when fixed. Bearer abcdefghijklmnopqrstuvwxyz123456`, context: ctx({ route: '#/p/123/export' }) });
  await fixing(t, 'Check the export code first.');
  const pkg = (await hook('GET', `/api/hooks/tickets/${t.id}/package`)).data;
  const raw = JSON.stringify(pkg);
  assert.ok(!raw.includes(alice.email) && !raw.includes('abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(!raw.includes('reporter'));
  assert.equal(pkg.server_error.message, 'Cannot read properties of undefined (reading "end")');
  assert.equal(pkg.admin_notes, 'Check the export code first.'); assert.equal(pkg.attempt, 1); assert.equal(pkg.target_branch, 'dev'); assert.equal(pkg.ref, 'T-' + (await s.app.db.query('SELECT number FROM tickets WHERE id = $1', [t.id])).rows[0].number);
});
test('a good fix that merged and passed moves to fixed on dev and the reporter is told in plain words', async () => {
  const t = await report(alice, { title: 'Job result happy path', description: 'unique lambda11' });
  await fixing(t);
  assert.equal((await hook('POST', `/api/hooks/tickets/${t.id}/report`, { attempt: 1, phase: 'running', run_url: 'https://github.com/owner/repo/actions/runs/1' })).status, 200);
  assert.equal((await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket.fix_state.phase, 'running');
  const r = await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t));
  assert.equal(r.status, 200); assert.equal(r.data.status, 'fixed_dev');
  const d = await mine(alice, t.id);
  assert.equal(d.ticket.status, 'fixed_dev'); assert.equal(d.ticket.can_confirm, true);
  assert.equal(d.timeline.at(-1).message, 'The export problem is fixed and is being checked.');
  assert.ok(!JSON.stringify(d).includes('github.com'), 'no links or code reach the reporter');
  const adm = (await A('GET', `/api/admin/tickets/${t.id}`)).data;
  assert.equal(adm.ticket.fix_state.pr_url, 'https://github.com/owner/repo/pull/9'); assert.ok(adm.timeline.some((e) => e.type === 'fix_result' && e.visible === false));
});
test('a fix that touches a protected file is held for review even when the checks passed and the job merged', async () => {
  const t = await report(alice, { title: 'Protected path check', description: 'unique mu12' });
  await fixing(t);
  const r = await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t, { files_changed: ['server/auth.js', 'test/auth.test.js'] }));
  assert.equal(r.data.status, 'needs_attention');
  const adm = (await A('GET', `/api/admin/tickets/${t.id}`)).data;
  assert.equal(adm.ticket.status, 'needs_attention'); assert.match(adm.timeline.find((e) => e.type === 'needs_attention').message, /protected files: server\/auth\.js/);
  const rep = await mine(alice, t.id);
  assert.equal(rep.ticket.status, 'in_review', 'the reporter sees that a person is reviewing it, not the internal state');
  assert.ok(!JSON.stringify(rep).includes('auth.js'));
});
test('failed checks, an unmerged fix, a job failure and a request for a person all end in needs attention', async () => {
  for (const [over, re] of [[{ ci: 'failed' }, /checks did not pass/], [{ merged: false }, /not merged/], [{ phase: 'failed', error: 'Out of budget.' }, /Out of budget/], [{ phase: 'needs_review', reason: 'The fix needs a database change.' }, /database change/], [{ files_changed: Array.from({ length: 20 }, (_, i) => `public/f${i}.js`) }, /more than the limit/]]) {
    const t = await report(alice, { title: `Needs attention ${letters()} ${letters()}`, description: `${letters()} ${letters()} ${letters()}` });
    await fixing(t);
    const r = await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t, over));
    assert.equal(r.data.status, 'needs_attention', JSON.stringify(over));
    assert.match((await A('GET', `/api/admin/tickets/${t.id}`)).data.timeline.find((e) => e.type === 'needs_attention').message, re);
  }
});
test('late, repeated and unknown reports from the job change nothing', async () => {
  const t = await report(alice, { title: 'Stale report check', description: 'unique xi14' });
  assert.equal((await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t))).data.ignored, true, 'not being fixed yet');
  await fixing(t);
  assert.equal((await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t, { attempt: 7 }))).data.ignored, true, 'a different attempt');
  assert.equal((await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket.status, 'fixing');
  assert.equal((await hook('POST', `/api/hooks/tickets/${t.id}/report`, { attempt: 1, phase: 'dance' })).status, 400);
  await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t));
  assert.equal((await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t))).data.ignored, true, 'a repeat after the first result');
  assert.equal((await hook('POST', '/api/hooks/tickets/999999999/report', result(t))).status, 404);
});
test('a human can retry after a failure, and the next job gets the earlier failure', async () => {
  const t = await report(alice, { title: 'Retry flow check', description: 'unique omicron15' });
  await fixing(t);
  await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t, { ci: 'failed', summary: '', error: '2 tests failed in export.test.js' }));
  assert.equal((await A('GET', `/api/admin/tickets/${t.id}`)).data.ticket.status, 'needs_attention');
  const r = await A('POST', `/api/admin/tickets/${t.id}/fix`, { notes: 'Try a smaller change.' });
  assert.equal(r.data.attempt, 2);
  const pkg = (await hook('GET', `/api/hooks/tickets/${t.id}/package`)).data;
  assert.equal(pkg.attempt, 2); assert.equal(pkg.admin_notes, 'Try a smaller change.');
  assert.match(pkg.previous_failure, /2 tests failed/);
});

// ---------- after the fix ----------
test('reporter confirms, super admin readies and publishes in one click, and the reporter sees each step', async () => {
  const t = await report(alice, { title: 'Release flow check', description: 'unique pi16' });
  await fixing(t); await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t));
  const c = await s.call('POST', `/api/tickets/${t.id}/confirm`, {}, alice.token);
  assert.equal(c.data.ticket.confirmed, true); assert.equal(c.data.ticket.can_confirm, false);
  assert.equal((await s.call('POST', `/api/tickets/${t.id}/confirm`, {}, alice.token)).status, 200, 'confirming twice is harmless');
  assert.equal((await A('POST', `/api/admin/tickets/${t.id}/status`, { status: 'ready_publish' })).status, 200);
  assert.equal((await mine(alice, t.id)).ticket.status, 'ready_publish');
  const pub = await A('POST', '/api/admin/tickets/publish-ready', {});
  assert.ok(pub.data.count >= 1);
  const d = await mine(alice, t.id);
  assert.equal(d.ticket.status, 'published');
  assert.deepEqual(d.timeline.map((e) => e.type).filter((x) => ['reported', 'triaged', 'fix_started', 'fixed_dev', 'reporter_confirmed', 'ready_publish', 'published'].includes(x)), ['reported', 'triaged', 'fix_started', 'fixed_dev', 'reporter_confirmed', 'ready_publish', 'published']);
  assert.equal((await A('POST', '/api/admin/tickets/publish-ready', {})).data.count, 0, 'nothing is published twice');
});
test('there is nothing to confirm before a fix exists, and the unread badge follows updates', async () => {
  const u = await s.user('Badge');
  const t = await report(u, { title: 'Badge flow check', description: 'unique rho17' });
  assert.equal((await s.call('POST', `/api/tickets/${t.id}/confirm`, {}, u.token)).status, 409);
  let sum = (await s.call('GET', '/api/tickets/summary', null, u.token)).data;
  assert.equal(sum.unread, 1, 'the triage update is unread'); assert.equal(sum.open, 1);
  await mine(u, t.id);
  sum = (await s.call('GET', '/api/tickets/summary', null, u.token)).data;
  assert.equal(sum.unread, 0);
  await A('POST', `/api/admin/tickets/${t.id}/reply`, { message: 'We are on it.' });
  assert.equal((await s.call('GET', '/api/tickets/summary', null, u.token)).data.unread, 1);
});
test('a reporter who says it is still broken reopens the main ticket for the super admin', async () => {
  const t = await report(alice, { title: 'Reopen flow check', description: 'unique sigma18' });
  assert.equal((await s.call('POST', `/api/tickets/${t.id}/reopen`, {}, alice.token)).status, 409, 'it is not fixed yet');
  await fixing(t); await hook('POST', `/api/hooks/tickets/${t.id}/report`, result(t));
  const r = await s.call('POST', `/api/tickets/${t.id}/reopen`, { message: 'It still crashes on Safari.' }, alice.token);
  assert.equal(r.status, 200); assert.equal(r.data.ticket.status, 'triaged');
  const adm = (await A('GET', `/api/admin/tickets/${t.id}`)).data;
  assert.equal(adm.ticket.reopened, 1); assert.ok(adm.timeline.some((e) => e.type === 'reopened' && e.message === 'It still crashes on Safari.'));
});
test('a ticket moves only along the allowed paths', () => {
  assert.equal(T.canMove('triaged', 'fixing'), true); assert.equal(T.canMove('fixing', 'fixed_dev'), true); assert.equal(T.canMove('fixed_dev', 'ready_publish'), true);
  assert.equal(T.canMove('triaged', 'published'), false); assert.equal(T.canMove('published', 'fixing'), false); assert.equal(T.canMove('wont_fix', 'fixing'), false);
  assert.equal(T.publicStatus('needs_attention'), 'in_review'); assert.equal(T.publicStatus('fixing'), 'fixing');
});

// ---------- automatic tickets from repeated server errors ----------
test('the same server error repeating opens one ticket by itself, and a single error does not', async () => {
  const e = (ref) => ({ kind: 'server', status: 500, method: 'GET', path: '/api/projects/88/forecast', message: 'Cannot read properties of null (reading "x")', stack: 'TypeError at forecast (server/api.js:99:3)', ref });
  await s.app.tickets.noteServerError(e('r1')); await s.app.tickets.noteServerError(e('r2'));
  assert.equal((await A('GET', '/api/admin/tickets?source=auto_error')).data.tickets.length, 0, 'two errors are not a pattern');
  await s.app.tickets.noteServerError(e('r3')); await settle();
  let auto = (await A('GET', '/api/admin/tickets?source=auto_error')).data.tickets;
  assert.equal(auto.length, 1); assert.equal(auto[0].reporter, null); assert.equal(auto[0].severity, 'high'); assert.equal(auto[0].occurrences, 3); assert.match(auto[0].title, /Server error on GET api\/projects\/:id/);
  for (const r of ['r4', 'r5', 'r6']) await s.app.tickets.noteServerError(e(r));
  auto = (await A('GET', '/api/admin/tickets?source=auto_error')).data.tickets;
  assert.equal(auto.length, 1, 'later bursts add to the same ticket'); assert.equal(auto[0].occurrences, 6);
});
test('automatic tickets can be turned off in Configuration', async () => {
  await A('PUT', '/api/admin/config', { settings: { auto_error_tickets: false } });
  const e = (ref) => ({ kind: 'server', status: 500, method: 'POST', path: '/api/other/thing', message: 'A different failure entirely', stack: '', ref });
  for (const r of ['q1', 'q2', 'q3', 'q4']) await s.app.tickets.noteServerError(e(r));
  assert.equal((await A('GET', '/api/admin/tickets?q=different failure')).data.tickets.length, 0);
  await A('PUT', '/api/admin/config', { settings: { auto_error_tickets: true } });
});
test('a real server error returns its reference so the report can be matched to the server log', async () => {
  const bad = await s.call('GET', '/api/projects/not-a-number/anything', null, alice.token);
  if (bad.status >= 500) assert.match(bad.data.ref, /^[0-9a-f]{8}$/);
  else assert.ok(bad.status >= 400);
});
