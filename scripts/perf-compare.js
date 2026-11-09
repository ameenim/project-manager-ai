#!/usr/bin/env node
// Prints a pre versus post table from two result files.  node scripts/perf-compare.js server pre post
//                                                        node scripts/perf-compare.js browser pre-browser post-browser
'use strict';
const [kind, a, b] = process.argv.slice(2);
const A = require(`../bench-results/${a}.json`), B = require(`../bench-results/${b}.json`);
const row = (name, x, y, unit = 'ms') => `${name.padEnd(58)} ${String(x).padStart(8)} ${String(y).padStart(8)} ${(x && y !== undefined ? (x / Math.max(y, 0.1)).toFixed(1) + 'x' : '').padStart(8)}`;
if (kind === 'server') {
  const key = (r) => r.screen + "|" + r.action; const m = new Map(B.results.map((r) => [key(r), r]));
  for (const r of A.results) { const p = m.get(key(r)); if (p) console.log(row(`${r.screen} | ${r.action}`, r.median, p.median) + `  q ${r.queries}->${p.queries}  kb ${r.kb}->${p.kb}`); }
} else {
  const ms = new Map(B.screens.map((r) => [r.screen, r]));
  for (const r of A.screens) { const p = ms.get(r.screen); if (p) console.log(row('screen | ' + r.screen, r.readyMs, p.readyMs) + `  long ${r.longTaskMs}->${p.longTaskMs}  nodes ${r.domNodes}->${p.domNodes}`); }
  const ma = new Map(B.actions.map((r) => [r.action, r]));
  for (const r of A.actions) { const p = ma.get(r.action); if (p && r.readyMs !== undefined) console.log(row('action | ' + r.action, r.readyMs, p.readyMs) + `  long ${r.longTaskMs}->${p.longTaskMs}`); }
  for (const k of ['cold', 'repeat']) console.log(row('load ' + k + ' dashboard ready', A.load[k].dashboardReadyMs, B.load[k].dashboardReadyMs) + `  KB ${A.load[k].transferredKB}->${B.load[k].transferredKB}  requests ${A.load[k].requests}->${B.load[k].requests}`);
}
