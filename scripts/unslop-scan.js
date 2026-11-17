#!/usr/bin/env node
/* Scans public/ for visual habits that read as AI generated.
   Usage: node scripts/unslop-scan.js [dir] [--json] [--severity high]
   Exit code is the number of HIGH findings, so CI can gate on it. */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const json = args.includes('--json');
const sevIdx = args.indexOf('--severity');
const onlyHigh = sevIdx >= 0 && /^high$/i.test(args[sevIdx + 1] || '');
const dirArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--severity');
const root = path.resolve(dirArg || path.join(__dirname, '..', 'public'));

const SKIP_DIRS = new Set(['vendor', 'brand', 'node_modules']);
const EXT = new Set(['.css', '.html', '.js']);
const SKIP_FILES = new Set(['i18n.js']);

const RULES = [
  { id: 'purple-blue-gradient', sev: 'high', ext: ['.css', '.html', '.js'],
    re: /linear-gradient\((?:[^()]|\([^()]*\))*(#8b5cf6|#6b4fd1|#7c3aed|#a855f7|var\(--violet\))/i,
    fix: 'Use one solid token such as var(--primary).' },
  { id: 'gradient-text', sev: 'high', ext: ['.css', '.html'],
    re: /background-clip:\s*text/i, fix: 'Use a solid text color from the tokens.' },
  { id: 'emoji-icon', sev: 'high', ext: ['.html', '.js'],
    re: /[\p{Extended_Pictographic}]/u, fix: 'Use the SVG icon() set so size and color follow the theme.' },
  { id: 'inter-first-font', sev: 'high', ext: ['.css'],
    re: /font(-family)?:[^;{}]*(?:^|[\s:])(Inter|Geist)\b/i, fix: 'Use Tajawal, the product font.' },
  { id: 'neon-glow', sev: 'high', ext: ['.css'],
    re: /box-shadow:\s*0\s+0\s+(1[2-9]|[2-9]\d)px/i, fix: 'Use var(--shadow) or the 2px focus ring.' },
  { id: 'big-hover-lift', sev: 'medium', ext: ['.css'],
    re: /:hover[^{]*\{[^}]*translateY\(-([3-9]|\d{2,})px\)/i, fix: 'Lift 1px at most.' },
  { id: 'icon-spin-on-hover', sev: 'medium', ext: ['.css'],
    re: /:hover[^{]*\{[^}]*rotate\(/i, fix: 'Remove the rotation. No bouncing or spinning.' },
  { id: 'shimmer-sweep', sev: 'medium', ext: ['.css'],
    re: /translate:\s*-120%/i, fix: 'Remove the shimmer sweep.' },
  { id: 'cursor-spotlight', sev: 'medium', ext: ['.css', '.js'],
    re: /--mx\b/, fix: 'Remove the cursor following glow.' },
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (EXT.has(path.extname(e.name)) && !SKIP_FILES.has(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

const findings = [];
for (const file of walk(root, [])) {
  const ext = path.extname(file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const r of RULES) {
      if (!r.ext.includes(ext)) continue;
      if (onlyHigh && r.sev !== 'high') continue;
      if (r.re.test(line)) findings.push({ file: path.relative(process.cwd(), file), line: i + 1, rule: r.id, severity: r.sev, fix: r.fix });
    }
  });
}

const high = findings.filter(f => f.severity === 'high').length;
const med = findings.length - high;
if (json) console.log(JSON.stringify({ high, medium: med, findings }, null, 2));
else {
  findings.forEach(f => console.log(`${f.severity.toUpperCase().padEnd(6)} ${f.file}:${f.line}  ${f.rule}  ${f.fix}`));
  console.log(`\nunslop scan: ${high} high, ${med} medium`);
}
process.exit(Math.min(high, 255));
