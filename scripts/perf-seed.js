// Shared seed for the performance scripts: a realistic, fairly heavy workspace for one person.
'use strict';
function bigXml(tasks) {
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">\n<MinutesPerDay>480</MinutesPerDay>\n<Tasks>\n';
  for (let i = 1; i <= tasks; i++) {
    const lvl = i === 1 ? 1 : (i % 25 === 2 ? 2 : 3);
    const pu = i % 25 === 3 ? i - 2 : i - 1; const pred = i > 3 && i % 25 !== 2 ? `<PredecessorLink><PredecessorUID>${pu}</PredecessorUID><Type>1</Type></PredecessorLink>` : '';
    x += `<Task><UID>${i}</UID><Name>Task ${i} deliver component</Name><OutlineLevel>${lvl}</OutlineLevel><Start>2026-0${1 + (i % 8)}-04T08:00:00</Start><Finish>2026-0${1 + (i % 8)}-14T17:00:00</Finish><Duration>PT${40 + (i % 5) * 8}H0M0S</Duration>${pred}</Task>\n`;
  }
  x += '</Tasks>\n<Resources>' + ['Ana', 'Omar', 'Lina', 'Sami', 'Noor'].map((n, i) => `<Resource><UID>${i + 1}</UID><Name>${n}</Name></Resource>`).join('') + '</Resources>\n<Assignments>\n';
  for (let i = 2; i <= tasks; i++) x += `<Assignment><UID>${i}</UID><TaskUID>${i}</TaskUID><ResourceUID>${1 + (i % 5)}</ResourceUID></Assignment>\n`;
  return x + '</Assignments>\n</Project>\n';
}


// s is the test helper (start()), tok the person's token. Returns the ids the scripts need.
async function seed(s, tok, BIG) {
  const call = async (m, p, b) => { const r = await s.call(m, p, b, tok); if (r.status >= 400) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`); return r; };
  const t0 = Date.now();
  await call('POST', '/api/workspace/sample');
  const list = (await call('GET', '/api/projects')).data.projects;
  const main = await s.project(tok, 'Bench Large Project');
  await call('POST', `/api/projects/${main.id}/msproject/import`, { xml: bigXml(BIG), mode: 'replace' });
  const kinds = ['risk', 'requirement', 'deliverable', 'milestone', 'action', 'decision'];
  for (let i = 0; i < 120; i++) await call('POST', `/api/projects/${main.id}/items`, { kind: kinds[i % kinds.length], title: `${kinds[i % kinds.length]} item ${i} about integration and delivery`, description: 'Detail text '.repeat(20), data: kinds[i % 6] === 'risk' ? { probability: 1 + (i % 5), impact: 1 + (i % 5), owner: 'Ana' } : {} });
  const longText = ('The supplier shall deliver the platform in phases with acceptance testing after each phase. ').repeat(4000);
  for (let d = 0; d < 4; d++) {
    const fd = new FormData(); fd.append('purpose', 'reference');
    fd.append('files', new Blob([longText], { type: 'text/plain' }), `spec${d}.txt`);
    await call('POST', `/api/projects/${main.id}/documents`, fd);
  }
  for (let v = 0; v < Number(process.env.BENCH_VERSIONS || 60); v++) await call('POST', `/api/projects/${main.id}/schedule/versions`, { label: 'Version ' + v });
  const extra = [];
  for (let i = 0; i < 6; i++) { const p = await s.project(tok, 'Bench Extra ' + i); await call('POST', `/api/projects/${p.id}/msproject/import`, { xml: bigXml(120), mode: 'replace' }); extra.push(p.id); }
  await s.app.store.flush();
  return { ms: Date.now() - t0, first: list[0].id, big: main.id, extra, projects: list.length + 1 + extra.length };
}
module.exports = { seed, bigXml };
