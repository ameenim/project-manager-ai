// The fix job. It runs inside GitHub Actions (see .github/workflows/ticket-fix.yml), never inside the app.
// Steps: tell the app it started, fetch the signed ticket package, let Claude Code change the code on a branch,
// run the tests ourselves, apply the policy, open a pull request, merge it into the target branch only when it is
// safe, and report the result back to the app with a signed request.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const fx = require('../../server/ticketfix');

const E = process.env;
const need = ['APP_URL', 'TICKET_ID', 'ATTEMPT', 'TICKET_WEBHOOK_SECRET'];
const TARGET = E.TARGET_BRANCH || 'dev';
const ATTEMPT = Number(E.ATTEMPT || 1);

async function call(method, route, body) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(Date.now());
  const url = new URL(route, E.APP_URL);
  const res = await fetch(url, { method, body: raw || undefined, headers: { 'x-ticket-timestamp': ts, 'x-ticket-signature': fx.sign(E.TICKET_WEBHOOK_SECRET, ts, `${method} ${url.pathname}\n${raw}`), ...(raw ? { 'content-type': 'application/json' } : {}) } });
  if (!res.ok) throw new Error(`${method} ${url.pathname} answered ${res.status}`);
  return res.json();
}
const report = (obj) => call('POST', `/api/hooks/tickets/${E.TICKET_ID}/report`, { attempt: ATTEMPT, run_url: E.RUN_URL, ...obj });

function sh(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const git = (...a) => sh('git', a);
// The environment Claude and the tests get has no secrets in it.
function cleanEnv(extra) {
  const env = { ...E, ...extra };
  for (const k of ['TICKET_WEBHOOK_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN', 'DATABASE_URL', 'REPLIT_DEPLOYMENT']) delete env[k];
  return env;
}

function runClaude(prompt) {
  const args = ['--bare', '-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(fx.REPORT_SCHEMA), '--append-system-prompt', fx.SYSTEM,
    '--permission-mode', 'acceptEdits', '--max-turns', '40', '--max-budget-usd', '5',
    '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash(npm test:*),Bash(node --test:*),Bash(git diff:*),Bash(git status:*),Bash(ls:*)',
    '--disallowedTools', 'Bash(curl:*),Bash(wget:*),Bash(git push:*),Bash(git commit:*),Bash(git checkout:*),Bash(env:*),Bash(printenv:*),WebFetch,WebSearch'];
  const r = sh('claude', args, { env: cleanEnv({ ANTHROPIC_API_KEY: E.ANTHROPIC_API_KEY }), timeout: 20 * 60e3 });
  let obj = null; try { obj = JSON.parse(r.stdout); } catch (e) { /* handled below */ }
  if (!obj) throw new Error('Claude Code did not return a readable result. ' + r.out.slice(-400));
  let rep = obj.structured_output || null;
  if (!rep && typeof obj.result === 'string') { try { rep = JSON.parse(obj.result); } catch (e) { /* no report */ } }
  if (!rep) throw new Error('Claude Code finished without the structured report.');
  return rep;
}

function changes() {
  git('add', '-A');
  const names = git('diff', '--cached', '--name-only').stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  let lines = 0;
  for (const l of git('diff', '--cached', '--numstat').stdout.split('\n')) { const p = l.split('\t'); if (p.length >= 3) lines += (Number(p[0]) || 0) + (Number(p[1]) || 0); }
  return { names, lines };
}
const runTests = () => { const r = sh('npm', ['test'], { env: cleanEnv(), timeout: 15 * 60e3 }); return { ok: r.code === 0, tail: r.out.slice(-3000) }; };

async function main() {
  for (const k of need) if (!E[k]) throw new Error(`${k} is missing`);
  await report({ phase: 'running' });
  const pkg = await call('GET', `/api/hooks/tickets/${E.TICKET_ID}/package`);

  // The target branch (dev by default) is created from main the first time.
  git('config', 'user.name', 'Claude ticket fixer'); git('config', 'user.email', 'noreply@anthropic.com');
  if (git('ls-remote', '--exit-code', '--heads', 'origin', TARGET).code !== 0) { git('push', 'origin', `origin/main:refs/heads/${TARGET}`); git('fetch', 'origin', TARGET); }
  const branch = `ticket/${String(pkg.ref || E.TICKET_REF || E.TICKET_ID).toLowerCase()}-${ATTEMPT}`;
  git('checkout', '-B', branch, `origin/${TARGET}`);

  let rep = runClaude(fx.buildPrompt(pkg, { previous_failure: pkg.previous_failure }));
  let ch = changes(); let tests = ch.names.length ? runTests() : { ok: false, tail: '' };
  if (ch.names.length && !tests.ok && !rep.needs_human_reason) {
    rep = runClaude(fx.buildPrompt(pkg, { previous_failure: 'npm test failed after your change:\n' + tests.tail }));
    ch = changes(); tests = ch.names.length ? runTests() : { ok: false, tail: '' };
  }
  const base = { root_cause: rep.root_cause, summary: rep.summary, reporter_message: rep.reporter_message, tests_added: rep.tests_added || [], confidence: rep.confidence };
  if (rep.needs_human_reason || !ch.names.length) return report({ phase: 'needs_review', reason: rep.needs_human_reason || 'Claude made no change.', ...base });

  const pol = fx.evaluatePolicy({ files: ch.names, lines: ch.lines });
  git('commit', '-m', `Fix ${pkg.ref}: ${String(pkg.title || '').slice(0, 70)}\n\n${rep.summary || ''}`);
  git('fetch', 'origin', TARGET);
  const rb = git('rebase', `origin/${TARGET}`);
  if (rb.code !== 0) { git('rebase', '--abort'); return report({ phase: 'needs_review', reason: `The fix could not be rebased on ${TARGET}. A person needs to resolve the conflict.`, ...base }); }
  if (git('push', '--force-with-lease', 'origin', branch).code !== 0) throw new Error('Could not push the fix branch.');
  const body = `Ticket ${pkg.ref} (attempt ${ATTEMPT})\n\n${rep.root_cause || ''}\n\n${rep.summary || ''}\n\nTests: ${tests.ok ? 'passed' : 'failed'}. Policy: ${pol.ok ? 'may merge by itself' : pol.reasons.join(' ')}\nRun: ${E.RUN_URL}`;
  const pr = sh('gh', ['pr', 'create', '--base', TARGET, '--head', branch, '--title', `Fix ${pkg.ref}: ${String(pkg.title || '').slice(0, 70)}`, '--body', body]);
  const pr_url = (pr.stdout.match(/https:\/\/github\.com\/\S+\/pull\/\d+/) || [''])[0];
  let merged = false;
  if (pr_url && tests.ok && pol.ok) merged = sh('gh', ['pr', 'merge', pr_url, '--squash', '--delete-branch']).code === 0;
  return report({ phase: 'fixed', ci: tests.ok ? 'passed' : 'failed', merged, branch, pr_url, files_changed: ch.names, lines_changed: ch.lines, ...base });
}

main().catch(async (e) => {
  console.error(e.message);
  try { await report({ phase: 'failed', error: String(e.message).slice(0, 900) }); } catch (x) { console.error('Could not report the failure:', x.message); }
  process.exit(0);
});
