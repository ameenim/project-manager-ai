#!/usr/bin/env node
/* Looks for leaked secrets in the files Git tracks and, with --history, in every line ever added to any commit.
   Usage: node scripts/secret-scan.js [--history]
   Exit code 1 when something is found, so CI can stop the build. Found values are masked in the output.
   A line that holds a harmless fake value on purpose can end with: secret-scan:allow */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const history = process.argv.includes('--history');
// Patterns with a distinctive shape. A hit in any file, tests included, is a real problem.
const STRONG = {
  'Anthropic key': /sk-ant-[A-Za-z0-9_-]{20,}/,
  'Google API key': /AIza[0-9A-Za-z_-]{30,}/,
  'GitHub token': /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
  'AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
  'Slack token': /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  'Stripe live key': /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/,
  'OpenAI style key': /\bsk-[A-Za-z0-9]{32,}\b/,
  'Private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'Database URL with a password': /\bpostgres(?:ql)?:\/\/[^\s"'<>:@/]+:[^\s"'<>@]{3,}@(?!localhost|127\.0\.0\.1|helium)[^\s"'<>/]+/i,
  'Signed token (JWT)': /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
};
// A quoted value of 20 or more characters assigned to a name like secret or token. Tests are skipped because they hold fakes.
const LOOSE = { 'Hard coded secret': /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\w*\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{20,}['"]/i };
const SKIP_FILE = /(^|\/)(package-lock\.json|node_modules\/|public\/vendor\/|generated-artifacts\/|bench-results\/)|\.(png|jpe?g|webp|gif|woff2?|mp4|ico|zip|pdf)$/i;
const isTest = (f) => /(^|\/)(test|tests)\//.test(f);

const mask = (s) => s.slice(0, 6) + '*'.repeat(Math.min(10, Math.max(4, s.length - 6)));
const findings = [];
function scanLine(file, where, line) {
  if (line.includes('secret-scan:allow')) return;
  for (const [name, re] of Object.entries({ ...STRONG, ...(isTest(file) ? {} : LOOSE) })) {
    const m = line.match(re);
    if (!m) continue;
    // the name of an environment variable (ATLASSIAN_CLIENT_SECRET) or an obvious placeholder is not a secret
    const value = (m[0].match(/['"]([^'"]+)['"]\s*$/) || [])[1];
    if (name === 'Hard coded secret' && value && (/^[A-Z][A-Z0-9_]+$/.test(value) || /example|changeme|your[_-]|xxxx|placeholder/i.test(value))) continue;
    findings.push({ name, file, where, sample: mask(m[0]) });
  }
}
const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, ...opts });

for (const f of git(['ls-files']).split('\n').filter(Boolean)) {
  if (SKIP_FILE.test(f)) continue;
  let text; try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
  text.split('\n').forEach((line, i) => scanLine(f, `line ${i + 1}`, line));
}
if (history) {
  let commit = '', file = '';
  for (const line of git(['log', '--all', '-p', '--no-color', '--pretty=format:@@COMMIT %h']).split('\n')) {
    if (line.startsWith('@@COMMIT ')) { commit = line.slice(9); continue; }
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (line.startsWith('+') && !line.startsWith('+++') && file && !SKIP_FILE.test(file)) scanLine(file, `commit ${commit}`, line.slice(1));
  }
}
const seen = new Set(), unique = findings.filter((f) => { const k = `${f.name}|${f.file}|${f.sample}`; if (seen.has(k)) return false; seen.add(k); return true; });
if (unique.length) {
  console.error(`Secret scan found ${unique.length} possible secret${unique.length === 1 ? '' : 's'}:`);
  for (const f of unique) console.error(`  ${f.name} in ${f.file} (${f.where}): ${f.sample}`);
  console.error('Remove the value, then revoke and replace the key at its provider. Deleting it from the code does not remove it from Git history.');
  process.exit(1);
}
console.log(`Secret scan clean (${history ? 'files and full history' : 'files'}).`);
