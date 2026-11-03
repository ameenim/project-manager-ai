/* Role aware document extraction. Each document is first given a role (technical proposal, financial
   proposal, contract, award letter, purchase order, schedule file). The role decides which kinds of data
   that document is allowed to supply, and every data kind has its own definition so the AI knows what
   counts. Risks are analysed from the whole document set, not copied from a single page. */
window.__Pipe = (function () {
  const AI = window.__AI;
  const SECTIONS = ['info', 'deliverables', 'requirements', 'payments', 'schedule'];
  // What each kind of document may supply.
  const SCOPE = {
    technical: ['info', 'deliverables', 'requirements', 'schedule'],
    financial: ['info', 'payments'],
    contract: ['info', 'deliverables', 'requirements', 'payments', 'schedule'],
    award: ['info', 'payments'],
    po: ['info', 'payments'],
    schedule: ['schedule'],
    other: ['info', 'deliverables', 'requirements', 'payments', 'schedule'],
  };
  // When two documents disagree, the higher number wins for project info.
  const AUTHORITY = { award: 4, po: 4, contract: 4, financial: 3, technical: 2, schedule: 2, other: 1 };
  const ROLE_LABEL = { technical: 'Technical proposal', financial: 'Financial proposal', contract: 'Contract or statement of work', award: 'Award letter', po: 'Purchase order', schedule: 'Schedule file', other: 'Other document' };

  function isMspXml(text) {
    return /<Project[\s>]/.test(String(text).slice(0, 4000)) && /schemas\.microsoft\.com\/project/i.test(String(text).slice(0, 4000));
  }

  // ---------- role detection ----------
  function detectRole(filename, text) {
    const f = String(filename || '').toLowerCase();
    if (/\.(xml|mpp)$/.test(f) && isMspXml(text)) return { role: 'schedule', confidence: 0.99 };
    const head = String(text || '').slice(0, 8000).toLowerCase();
    const score = { technical: 0, financial: 0, contract: 0, award: 0, po: 0 };
    const rules = {
      technical: [[/technical/, 3], [/solution|methodology|architecture|approach/, 0.6], [/work\s*plan|project\s*plan|phase\s*activity|implementation plan/, 0.8]],
      financial: [[/financial|commercial|pricing|price[\s_-]*(offer|schedule|proposal)|boq|bill[\s_-]*of[\s_-]*quant|quotation/, 3], [/price\s*\(|total\s*price|unit\s*price|excluding\s*vat|payment\s*terms/, 0.8]],
      contract: [[/contract|agreement|statement[\s_-]*of[\s_-]*work|(^|[^a-z])sow([^a-z]|$)/, 3], [/hereinafter|the parties|governing law|termination|indemnif/, 0.8]],
      award: [[/award|(^|[^a-z])loa([^a-z]|$)|letter[\s_-]*of[\s_-]*(award|acceptance|intent)/, 3], [/we are pleased to (inform|award)|hereby award|award letter/, 1.5]],
      po: [[/purchase[\s_-]*order|(^|[^a-z])po[\s_-]*\d|p\.o\./, 3], [/purchase order|po number|ship to|bill to/, 1]],
    };
    for (const [role, list] of Object.entries(rules)) for (const [re, w] of list) { if (re.test(f)) score[role] += w; else if (re.test(head)) score[role] += w / 2; }
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    if (ranked[0][1] < 1) return { role: 'other', confidence: 0.4 };
    const gap = ranked[0][1] - ranked[1][1];
    return { role: ranked[0][0], confidence: Math.max(0.5, Math.min(0.95, 0.55 + gap / 6)) };
  }

  // ---------- prompts ----------
  const BASE = `You are a senior project manager reading one part of a project document. You extract only the kinds of data listed below, and only what the text supports.
Rules for every item:
1. Every item needs a quote copied exactly, word for word, from the text you were given, about 8 to 25 words. Never rewrite, translate or join quotes. Skip anything you cannot quote.
2. Never guess. A month or year without a day is not a date. If timing is relative such as Week 1 to Week 6, fill the week numbers and leave dates null.
3. confidence is 0 to 1. Use 0.9 or more only when the text states the fact plainly. Use below 0.7 when you had to interpret.
4. List each fact once. Do not repeat the same item from different places in the text. If this part has nothing relevant return empty lists.`;
  const DEFS = {
    info: {
      schema: '"fields": [{"field":"client|value|currency|start_date|end_date|award_date","value":"","confidence":0.0,"quote":""}]',
      text: `PROJECT INFO. client is the customer organization that buys the work (never the vendor writing the proposal). value is the total contract or offer price as a plain number without currency symbols or thousands separators. If several totals appear choose the grand total and say so in the quote. currency is the ISO code. start_date and end_date are the project start and end written as exact dates. award_date is the date an award letter, contract or purchase order was issued. Only give a date if the day is stated.`,
    },
    deliverables: {
      schema: '"deliverables": [{"title":"","description":"","category":"document|system|service|training|other","due_date":"YYYY-MM-DD or null","week":number or null,"confidence":0.0,"quote":""}]',
      text: `DELIVERABLES. A deliverable is a concrete output the vendor hands over and the client can accept, for example a project charter, detailed project plan, BOQ, design document, running system on staging, go live release, installation and deployment, training, user manual, UAT report, source code handover, maintenance and support service. It is not an activity, meeting, task, principle or feature. "Hold kickoff meeting" is a task. "Kickoff presentation and minutes" is a deliverable. Take deliverables from the section that lists what will be delivered, the deliverables register, the scope of supply or the contract schedule. Keep titles short and do not list the same deliverable twice under different wording.`,
    },
    requirements: {
      schema: '"requirements": [{"title":"","description":"","type":"functional|non functional|security|compliance|contractual","priority":"Must|Should|Could","confidence":0.0,"quote":""}]',
      text: `REQUIREMENTS. A requirement is something the solution or the vendor must do or meet, written as a testable statement, for example data must be hosted inside the UAE, the platform must support Arabic right to left, uptime of 99.5 percent, penetration test before go live. Group closely related statements into one requirement rather than one per sentence. Marketing claims, descriptions of how the system works and project activities are not requirements. priority is Must for shall or must, Should for should, Could for may.`,
    },
    payments: {
      schema: '"milestones": [{"title":"","percent":number or null,"amount":number or null,"due_date":"YYYY-MM-DD or null","trigger":"what must happen before payment","confidence":0.0,"quote":""}]',
      text: `PAYMENT MILESTONES. A payment milestone is one line of the payment schedule or price table: what is paid, the amount or percent, and the event that triggers the payment. Payment tables usually show each milestone with its amount, so copy amount exactly as a number. If a line is 100 percent of a priced item, percent is 100 and amount is that item's price. Do not include delivery tasks, taxes alone or the grand total as a milestone.`,
    },
    schedule: {
      schema: '"schedule": [{"name":"","level":"phase|task|milestone","phase":"parent phase name or null","start":"YYYY-MM-DD or null","end":"YYYY-MM-DD or null","start_week":number or null,"end_week":number or null,"duration_days":number or null,"depends_on":["predecessor name"],"confidence":0.0,"quote":""}]',
      text: `SCHEDULE. Build the work breakdown the technical plan describes. A phase is a named stage that groups work (summary task). A task is work inside a phase. A milestone is a gate such as UAT sign off, go live or handover with no duration. Put the parent phase name in phase for every task and milestone. Use exact dates when the text gives them, otherwise week numbers counted from project start. Fill depends_on only when the order is stated or obvious from the plan, for example UAT follows build. Use the project plan, phase table or Gantt description, not the general discussion.`,
    },
  };
  function buildPrompt(role) {
    const allowed = SCOPE[role] || SCOPE.other;
    const secs = SECTIONS.filter((s) => allowed.includes(s));
    return `${BASE}

This document is a ${ROLE_LABEL[role] || ROLE_LABEL.other}. Extract these kinds of data and nothing else.

${secs.map((s) => DEFS[s].text).join('\n\n')}

Return JSON only, with exactly this shape:
{
 ${secs.map((s) => DEFS[s].schema).join(',\n ')}
}`;
  }

  const CONTEXT_SYSTEM = `You are a senior project manager. You receive the start of a project document and the list of its headings. Decide what kind of document it is and summarize it.
Return JSON: {"role":"technical|financial|contract|award|po|schedule|other","summary":"two sentences: what this document is, who it is for and what it commits to","project_name":"","confidence":0.0}
technical is a technical proposal or solution description with approach and plan. financial is a price offer or commercial proposal. contract covers agreements and statements of work. award is an award or acceptance letter. po is a purchase order.`;

  const RISK_SYSTEM = `You are a senior project manager preparing the risk register for a project from its documents. You get the project facts, what each document is, the deliverables, the schedule, the payment terms and passages about assumptions, dependencies and client responsibilities.
Identify 8 to 14 risks to delivering THIS project. Focus on the project itself: client approval turnaround for deliverables and acceptance, client access to environments, data and stakeholders, dependencies on the client or third parties, schedule pressure and conflicting dates, payment only upon acceptance, scope ambiguity, resource and skills, integration and security approvals, performance and go live readiness. Do not list generic risks that could apply to any project.
Return JSON: {"risks":[{"title":"short","description":"cause, event and effect in two sentences","category":"client dependency|schedule|commercial|scope|technical|resource|security|compliance","probability":"Low|Medium|High","impact":"Low|Medium|High","mitigation":"one concrete action","owner":"role","evidence":"short text copied exactly from the passages or documents that supports it, or null","confidence":0.0}]}
Use confidence 0.8 or more only when a passage states the risk or dependency directly. Use 0.5 to 0.75 when you inferred it from the facts. Write plain sentences without dashes or semicolons.`;

  // ---------- helpers ----------
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0.6));
  function headings(text) {
    const out = [];
    for (const l of String(text).split('\n')) {
      const t = l.trim();
      if (t.length < 4 || t.length > 90) continue;
      if (/^(#{1,3}\s|\d+(\.\d+){0,3}\.?\s+[A-Z])/.test(t) && !/\.{4,}/.test(t) && !/\|/.test(t)) out.push(t);
      if (out.length >= 70) break;
    }
    return out;
  }
  // Pieces of text that talk about assumptions, dependencies and client duties. Used by the risk analysis.
  function passages(text, limit = 9000) {
    const re = /assum|depend|client (shall|will|must|is responsible)|responsib|approval|acceptance|constraint|prerequisite|penalt|liquidated|delay|access to|availability of|subject to|out of scope|exclu/i;
    const out = [];
    let size = 0;
    for (const para of String(text).split(/\n{2,}|\n(?=\d+(?:\.\d+)*\.?\s)/)) {
      const t = para.replace(/\s+/g, ' ').trim();
      if (t.length < 40 || t.length > 700 || !re.test(t)) continue;
      out.push(t);
      size += t.length;
      if (size > limit) break;
    }
    return out;
  }

  async function context(doc, text, role) {
    try {
      const j = await AI.claudeJSON(CONTEXT_SYSTEM, `Filename: ${doc.filename}\nHeadings:\n${headings(text).join('\n')}\n\nStart of document:\n${String(text).slice(0, 9000)}`, 1200);
      return { role: SCOPE[j.role] ? j.role : role, summary: String(j.summary || ''), project_name: j.project_name || null, confidence: clamp(Number(j.confidence)) };
    } catch (e) {
      if (['bad_key', 'budget', 'rate', 'network'].includes(e.code)) throw e;
      return { role, summary: '', project_name: null, confidence: 0.5 };
    }
  }

  async function extractPart(system, part, label, depth = 0, retry = false) {
    try {
      const j = await AI.claudeJSON(system, `${label}\n\nDocument text:\n${part}`, 12000);
      return { j, failed: 0 };
    } catch (e) {
      if (['bad_key', 'budget', 'rate', 'network'].includes(e.code)) throw e;
      if (e.code === 'cutoff' && depth < 2 && part.length > 16000) {
        const mid = part.lastIndexOf('\n', Math.floor(part.length / 2));
        const cut = mid > 8000 ? mid : Math.floor(part.length / 2);
        const a = await extractPart(system, part.slice(0, cut), label + ' (first half)', depth + 1);
        const b = await extractPart(system, part.slice(cut), label + ' (second half)', depth + 1);
        const halves = [a.j, b.j].filter(Boolean);
        return { j: halves.length ? { _halves: halves } : null, failed: a.failed + b.failed, error: a.error || b.error };
      }
      if (e.code === 'badjson' && !retry) return extractPart(system, part, label, depth, true);
      return { j: null, failed: 1, error: e.message, code: e.code };
    }
  }

  // Reads every part of one document with the prompt that fits its role. Returns verified items only.
  async function extractDoc({ text, filename, role, onProgress }) {
    const allowed = SCOPE[role] || SCOPE.other;
    const system = buildPrompt(role);
    const parts = AI.splitParts(text);
    const results = new Array(parts.length);
    let next = 0, done = 0, lastError = null, lastCode = null;
    const worker = async () => {
      while (next < parts.length) {
        const idx = next++;
        const r = await extractPart(system, parts[idx], `Filename: ${filename}. Part ${idx + 1} of ${parts.length}.`);
        results[idx] = r;
        if (r.error) { lastError = r.error; lastCode = r.code || lastCode; }
        done++;
        if (onProgress) onProgress({ done, total: parts.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, parts.length) }, worker));
    const out = { fields: [], deliverables: [], requirements: [], milestones: [], schedule: [] };
    let ok = 0, failed = 0, dropped = 0, charsSent = 0;
    const seen = new Set();
    const take = (j, partText) => {
      if (!j) return;
      const hay = AI.normQuote(partText);
      const keyMap = { fields: 'info', deliverables: 'deliverables', requirements: 'requirements', milestones: 'payments', schedule: 'schedule' };
      for (const k of Object.keys(out)) {
        if (!allowed.includes(keyMap[k])) continue;
        for (const it of Array.isArray(j[k]) ? j[k] : []) {
          if (!it || typeof it !== 'object') continue;
          if (!AI.quoteFound(it.quote, hay)) { dropped++; continue; }
          const sig = k + '|' + AI.normQuote(it.title || it.name || it.field) + '|' + AI.normQuote(it.value || it.due_date || it.start || it.start_week || it.amount || it.percent);
          if (seen.has(sig)) continue;
          seen.add(sig);
          it.confidence = clamp(Number(it.confidence), 0.2, 0.98);
          out[k].push(it);
        }
      }
    };
    results.forEach((r, i) => {
      if (r.failed) failed++;
      if (r.j) { ok++; charsSent += parts[i].length; if (r.j._halves) r.j._halves.forEach((h) => take(h, parts[i])); else take(r.j, parts[i]); }
    });
    if (!ok) throw Object.assign(new Error(lastError || 'Claude returned nothing usable'), { code: lastCode || 'badjson' });
    out.coverage = { chars_total: text.length, chars_sent: charsSent, parts: parts.length, parts_read: ok, parts_failed: failed, dropped_no_quote: dropped };
    out.engine = 'claude';
    return out;
  }

  async function analyzeRisks({ project, docs, items, text }) {
    const pick = (k) => items.filter((i) => i.kind === k && i.status !== 'ignored');
    const digest = {
      project,
      documents: docs.map((d) => ({ file: d.filename, role: ROLE_LABEL[d.role] || d.role, summary: d.summary })),
      deliverables: pick('deliverable').slice(0, 40).map((i) => ({ title: i.title, due: i.data.due_date || null })),
      schedule: pick('schedule').slice(0, 60).map((i) => ({ name: i.title, level: i.data.level, start: i.data.start, end: i.data.end, weeks: i.data.start_week != null ? `${i.data.start_week}-${i.data.end_week}` : null })),
      payments: pick('milestone').slice(0, 30).map((i) => ({ title: i.title, percent: i.data.percent, amount: i.data.amount, trigger: i.data.trigger || null })),
    };
    const ps = [];
    for (const d of docs) for (const t of passages(text[d.id] || '', 6000)) ps.push(`[${d.filename}] ${t}`);
    const hay = AI.normQuote(Object.values(text).join(' '));
    try {
      const j = await AI.claudeJSON(RISK_SYSTEM, `Project facts and documents:\n${JSON.stringify(digest)}\n\nPassages about assumptions, dependencies and client responsibilities:\n${ps.slice(0, 60).join('\n')}`, 8000);
      const risks = [];
      for (const r of Array.isArray(j.risks) ? j.risks : []) {
        if (!r || !String(r.title || '').trim()) continue;
        const grounded = r.evidence && AI.quoteFound(String(r.evidence).replace(/^\[[^\]]+\]\s*/, ''), hay);
        const lvl = (x) => (['Low', 'Medium', 'High'].includes(x) ? x : 'Medium');
        risks.push({ title: String(r.title).slice(0, 140), description: String(r.description || ''), probability: lvl(r.probability), impact: lvl(r.impact), mitigation: String(r.mitigation || ''), category: r.category || null, owner: r.owner || null, quote: grounded ? String(r.evidence).replace(/^\[[^\]]+\]\s*/, '') : '', inferred: !grounded, confidence: clamp(Number(r.confidence), 0.3, grounded ? 0.95 : 0.75) });
      }
      return risks.slice(0, 16);
    } catch (e) {
      if (['bad_key', 'budget', 'rate', 'network'].includes(e.code)) throw e;
      console.error('Risk analysis failed:', e.message);
      return [];
    }
  }

  // ---------- Microsoft Project XML, read without AI ----------
  function scheduleFromMsp(xml) {
    const parsed = window.__MSP.parse(xml);
    const byUid = new Map(parsed.tasks.map((t) => [t.uid, t]));
    const items = parsed.tasks.map((t) => {
      const parent = t.parent_uid ? byUid.get(t.parent_uid) : null;
      return {
        name: t.name, level: t.summary ? 'phase' : t.milestone ? 'milestone' : 'task', phase: parent ? parent.name : null,
        start: t.start, end: t.finish, duration_days: t.duration, start_week: null, end_week: null,
        depends_on: t.preds.map((p) => (byUid.get(p.uid) || {}).name).filter(Boolean), confidence: 0.98,
        quote: `${t.name} ${t.start || ''} ${t.finish || ''}`.trim(),
      };
    });
    const dates = parsed.tasks.flatMap((t) => [t.start, t.finish]).filter(Boolean).sort();
    return { items, name: parsed.name, start: dates[0] || null, end: dates[dates.length - 1] || null, warnings: parsed.warnings };
  }

  // ---------- confidence ----------
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  function confidence(items, docs) {
    const live = items.filter((i) => i.status !== 'ignored' && i.confidence != null);
    const kinds = { info: 'field', deliverable: 'deliverable', requirement: 'requirement', payment: 'milestone', schedule: 'schedule', risk: 'risk' };
    const by = {};
    for (const [k, kind] of Object.entries(kinds)) by[k] = mean(live.filter((i) => i.kind === kind).map((i) => Number(i.confidence)));
    const weights = { info: 1, deliverable: 1, requirement: 0.5, payment: 1, schedule: 1, risk: 0.5 };
    let num = 0, den = 0;
    for (const k of Object.keys(by)) if (by[k] != null) { num += by[k] * weights[k]; den += weights[k]; }
    const cov = mean((docs || []).filter((d) => d.coverage && d.coverage.chars_total).map((d) => d.coverage.chars_sent / d.coverage.chars_total));
    const overall = den ? (num / den) * (cov == null ? 1 : Math.max(0.5, cov)) : null;
    return { overall, by, coverage: cov };
  }

  return { SCOPE, AUTHORITY, ROLE_LABEL, detectRole, isMspXml, context, extractDoc, analyzeRisks, scheduleFromMsp, confidence, passages };
})();
