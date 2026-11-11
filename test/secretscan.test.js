'use strict';
// The secret scanner finds real looking keys, ignores harmless names, and the repository itself is clean.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCAN = path.join(__dirname, '..', 'scripts', 'secret-scan.js');
// the script scans the repository it sits in, so a scratch repository gets its own copy
const run = (cwd, args = []) => spawnSync(process.execPath, [path.join(cwd, 'scripts', 'secret-scan.js'), ...args], { cwd, encoding: 'utf8' });

test('the repository has no secrets in its files or history', () => {
  const r = run(path.join(__dirname, '..'), ['--history']);
  assert.equal(r.status, 0, r.stderr);
});

test('the scanner finds keys, masks them, and ignores names and marked fakes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const sh = (c) => spawnSync('sh', ['-c', c], { cwd: dir, encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(SCAN, path.join(dir, 'scripts', 'secret-scan.js'));
  const fake = 'sk-ant-' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
  fs.writeFileSync(path.join(dir, 'ok.js'), "const x = { secretEnv: 'ATLASSIAN_CLIENT_SECRET' };\nconst y = 'sk-ant-" + 'q'.repeat(24) + "'; // secret-scan:allow\n");
  sh('git init -q && git add -A && git -c user.email=a@b -c user.name=t commit -qm init');
  assert.equal(run(dir).status, 0);
  fs.writeFileSync(path.join(dir, 'leak.js'), `const key = '${fake}';\n`);
  sh('git add -A && git -c user.email=a@b -c user.name=t commit -qm leak');
  const r = run(dir);
  assert.equal(r.status, 1); assert.match(r.stderr, /Anthropic key in leak\.js/); assert.ok(!r.stderr.includes(fake), 'the value is masked');
  // a key that was committed and then deleted is still found in the history
  fs.unlinkSync(path.join(dir, 'leak.js')); sh('git add -A && git -c user.email=a@b -c user.name=t commit -qm remove');
  assert.equal(run(dir).status, 0); assert.equal(run(dir, ['--history']).status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
