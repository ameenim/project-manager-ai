// Finds the people named in the schedule's Owner column so they can be added to the project team.
// An owner cell can hold several people, for example "Amin Shafaqouj (Tarjama), Saeed Alrashdi (DGE)".
// The text in brackets after a name is the organization.
'use strict';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Splits on commas, Arabic commas, semicolons, slashes, ampersands and new lines, but never inside brackets.
function splitOwners(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(text || '')) {
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (depth === 0 && /[,،;\/&\n]/.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(clean).filter(Boolean);
}

// "Amin Shafaqouj (Tarjama)" becomes { name: "Amin Shafaqouj", organization: "Tarjama" }.
function parsePerson(part) {
  const m = clean(part).match(/^(.*?)\s*[(\[]([^()\[\]]*)[)\]]\s*$/);
  const name = clean(m ? m[1] : part).replace(/[.:\-–]+$/, '').trim();
  const organization = clean(m ? m[2] : '');
  return { name, organization };
}

// The key used to decide that two spellings are the same person. A leading title and punctuation do not count.
const keyOf = (name) => clean(name).toLowerCase().replace(/^(dr|eng|mr|mrs|ms|prof)\.?\s+/, '').replace(/[.,]/g, '').trim();

// A single word, or a word written in capitals, is more likely a team or a body than a person.
const looksLikeGroup = (name, organization) => !organization && (!/\s/.test(name) || (name === name.toUpperCase() && /[A-Z]/.test(name)));

// tasks: the schedule. resources: the current team. Returns one row per distinct person, most tasks first.
function fromSchedule(tasks, resources) {
  const have = new Set((resources || []).map((r) => keyOf(r.name)));
  const byKey = new Map();
  for (const t of tasks || []) {
    const seen = new Set();
    for (const part of splitOwners(t.assignee)) {
      const { name, organization } = parsePerson(part);
      if (!name || name.length > 120) continue;
      const k = keyOf(name);
      if (!k) continue;
      let row = byKey.get(k);
      if (!row) { row = { key: k, name, organization: '', tasks: 0 }; byKey.set(k, row); }
      if (!row.organization && organization) row.organization = organization;
      if (name.length > row.name.length && keyOf(name) === k) row.name = name;
      if (!seen.has(k)) { row.tasks++; seen.add(k); }
    }
  }
  return [...byKey.values()]
    .map((r) => ({ name: r.name, organization: r.organization, tasks: r.tasks, in_team: have.has(r.key), group: looksLikeGroup(r.name, r.organization) }))
    .sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name));
}

module.exports = { splitOwners, parsePerson, keyOf, fromSchedule };
