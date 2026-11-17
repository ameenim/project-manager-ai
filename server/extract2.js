/* Role aware document extraction. Each document is first given a role (technical proposal, financial
   proposal, contract, award letter, purchase order, schedule file). The role decides which kinds of data
   that document is allowed to supply, and every data kind has its own definition so the AI knows what
   counts. Risks are analysed from the whole document set, not copied from a single page. */
window.__Pipe = (function () {
  const AI = window.__AI;
  const SECTIONS = ['info', 'deliverables', 'requirements', 'payments', 'schedule', 'risks'];
  // What each kind of document may supply.
  const SCOPE = {
    technical: ['info', 'deliverables', 'requirements', 'schedule', 'risks'],
    financial: ['info', 'deliverables', 'payments'],
    contract: ['info', 'deliverables', 'requirements', 'payments', 'schedule', 'risks'],
    award: ['info', 'payments'],
    po: ['info', 'payments'],
    schedule: ['schedule'],
    plan: ['info', 'schedule', 'risks'],
    other: ['info', 'deliverables', 'requirements', 'payments', 'schedule', 'risks'],
  };
  // When two documents disagree, the higher number wins for project info.
  const AUTHORITY = { award: 4, po: 4, contract: 4, financial: 3, technical: 2, schedule: 2, plan: 2, other: 1 };
  const ROLE_LABEL = { technical: 'Technical proposal', financial: 'Financial proposal', contract: 'Contract or statement of work', award: 'Award letter', po: 'Purchase order', schedule: 'Schedule file', plan: 'Project plan workbook', other: 'Other document' };

  function isMspXml(text) {
    return /<Project[\s>]/.test(String(text).slice(0, 4000)) && /schemas\.microsoft\.com\/project/i.test(String(text).slice(0, 4000));
  }

  // ---------- role detection ----------
  function detectRole(filename, text) {
    const f = String(filename || '').toLowerCase();
    if (/\.(xml|mpp)$/.test(f) && isMspXml(text)) return { role: 'schedule', confidence: 0.99 };
    // A workbook with a plan table (WBS, task, start, finish) is read row by row in code, not by the AI.
    if (/\.(xlsx|xls)$/.test(f) && planFromText(text).found) return { role: 'plan', confidence: 0.97 };
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
  const BASE = `You are a principal project manager with more than twenty years of delivery experience on government and enterprise technology programs. You hold PMP and PRINCE2 qualifications and you work to PMBOK and ISO 21502. A delivery team will plan, staff, invoice and govern the project from what you extract, so you read like the person who is accountable for the outcome: precise, skeptical and complete. You are reading one part of a project document.

How you read:
1. First decide what this part of the document is for: scope, deliverables register, price table, payment terms, work plan, risk register, assumptions or boilerplate. Extract from the sections written to list the thing, and ignore passing mentions in narrative.
2. Read tables cell by cell. One row is one record. Keep the columns of a row together. Totals, subtotals and taxes are never records.
3. Keep the document's own numbering and names, for example "3.1 Detailed project plan", so people can find the line again.
4. Capture the numbers that drive control: prices, percentages, durations, week numbers, dates, counts and service levels. Copy them exactly.
5. Note who has to act. The client approving, providing access, environments or data is as important as the vendor's own work.

Rules for every item:
1. Every item needs a quote copied exactly, word for word, from the text you were given, about 8 to 25 words. Never rewrite, translate or join quotes. Skip anything you cannot quote.
2. Never guess. A month or year without a day is not a date. If timing is relative such as Week 1 to Week 6, fill the week numbers and leave dates null.
3. confidence is 0 to 1. Use 0.9 or more only when the text states the fact plainly. Use below 0.7 when you had to interpret.
4. List each fact once. Do not repeat the same item from different places in the text. If this part has nothing relevant return empty lists.
5. Write descriptions as plain sentences without dashes or semicolons.`;
  const DEFS = {
    info: {
      schema: '"fields": [{"field":"client|value|currency|start_date|end_date|award_date","value":"","confidence":0.0,"quote":""}]',
      text: `PROJECT INFO. client is the customer organization that buys the work, never the vendor writing the proposal. value is the total contract or offer price as a plain number without currency symbols or thousands separators. If several totals appear choose the grand total excluding VAT unless the text says the contract value includes it, and say which in the quote. A figure that appears in an award letter, contract or purchase order outranks a proposal. currency is the ISO code. start_date and end_date are the project start and end written as exact dates. award_date is the date an award letter, contract or purchase order was issued. Only give a date if the day is stated.`,
    },
    deliverables: {
      schema: '"deliverables": [{"ref":"document numbering such as 3.1 or null","title":"","description":"what is handed over","category":"document|system|service|training|other","phase":"Phase 1|Phase 2|other label used by the document or null","due_date":"YYYY-MM-DD or null","week":number or null,"amount":number or null,"acceptance":"how the client accepts it, or null","confidence":0.0,"quote":""}]',
      text: `DELIVERABLES. A deliverable is a concrete output the vendor hands over and the client can accept, for example a project charter, detailed project plan, BOQ, design document, running system on staging, go live release, installation and deployment, training, user manual, UAT report, source code handover, and a maintenance or support service. It is not an activity, meeting, task, principle or feature. "Hold kickoff meeting" is a task. "Kickoff presentation and minutes" is a deliverable. Take deliverables from the section that lists what will be delivered, the deliverables register, the scope of supply, the price table or the contract schedule. In a price table every priced line is a contract deliverable, so fill amount with its price exactly. When the same deliverable appears in a technical table and a price table, report it once with both its due date and its price. Keep the document's reference number in ref. Use phase for the release the deliverable belongs to. Use acceptance for the stated acceptance event or criteria, for example UAT sign off or approval by the client PMO.`,
    },
    requirements: {
      schema: '"requirements": [{"ref":"section number or null","title":"","description":"","type":"functional|non functional|security|compliance|contractual","priority":"Must|Should|Could","verification":"how it will be tested or evidenced, or null","confidence":0.0,"quote":""}]',
      text: `REQUIREMENTS. A requirement is something the solution or the vendor must do or meet, written as a testable statement. Examples are data hosted inside the UAE, Arabic right to left support, uptime of 99.9 percent, page load within a stated time, penetration test before go live, source code owned by the client, handover documentation, accessibility standards, integration with the client identity service. Cover every type: functional, non functional (performance, availability, scalability), security, compliance and standards, and contractual (warranty, support, intellectual property, confidentiality, service levels). Group closely related statements into one requirement rather than one per sentence, but never merge different types. Marketing claims, descriptions of how the system works and project activities are not requirements. priority is Must for shall, must or mandatory, Should for should, and Could for may or optional. verification names the test or gate that proves it, such as UAT, VAPT, performance test, or acceptance review.`,
    },
    payments: {
      schema: '"milestones": [{"ref":"deliverable reference or null","title":"","deliverable":"the deliverable this payment is for, or null","percent":number or null,"amount":number or null,"due_date":"YYYY-MM-DD or null","terms_days":number or null,"trigger":"what must happen before payment","confidence":0.0,"quote":""}]',
      text: `PAYMENT MILESTONES. A payment milestone is one line of the payment schedule or price table: what is paid, the amount or percent, and the event that triggers the payment. Payment tables usually show each milestone with its amount, so copy amount exactly as a number. If a line is 100 percent of a priced item, percent is 100 and amount is that item's price. If the text gives percentages only, compute nothing and leave amount null. Fill deliverable with the deliverable that the payment is tied to, and ref with its reference number. trigger is the event, for example acceptance and delivery, UAT sign off or go live. terms_days is the number of days the client has to pay after receiving the invoice, from the payment terms. due_date is a planned invoice or delivery date only if the text states it. Do not include delivery tasks, taxes alone, retention notes or the grand total as a milestone. Check that your milestones add up to the contract value and mention it in the quote of the last milestone only if the text itself says so.`,
    },
    schedule: {
      schema: '"schedule": [{"level":"phase|task|milestone","type":"task|review|approval|milestone","name":"","phase":"parent phase name or null","start":"YYYY-MM-DD or null","end":"YYYY-MM-DD or null","start_week":number or null,"end_week":number or null,"duration_days":number or null,"owner":"role or party responsible, or null","depends_on":["predecessor name"],"confidence":0.0,"quote":""}]',
      text: `SCHEDULE. Build the work breakdown that the technical plan describes, as a project manager would enter it in MS Project. A phase is a named stage that groups work (a summary task). A task is work inside a phase. List the activities named in a phase's activity column as separate tasks under that phase. A milestone is a gate or event such as kick off, UAT sign off, go live or handover with no duration. Treat every stated gate or exit criterion as a milestone, and mark approvals by the client with type approval and client reviews with type review. Put the parent phase name in phase for every task and milestone. Use exact dates when the text gives them, otherwise week numbers counted from project start. Capture every duration the text gives in duration_days, converting weeks to working days at five days per week and months at twenty two days. Name the owner when the plan says who does the work or approves it. Fill depends_on only when the order is stated or obvious from the plan, for example UAT follows build. Use the project plan, phase table, timeline or Gantt description, not the general discussion. Extract only what the document states here. Expected review and approval steps that the document does not mention are added later in the schedule synthesis.`,
    },
    risks: {
      schema: '"risks": [{"title":"","description":"","probability":"Low|Medium|High","impact":"Low|Medium|High","mitigation":"","owner":"role or null","confidence":0.0,"quote":""}]',
      text: `RISKS STATED IN THE DOCUMENT. Extract only the risks that the document itself lists, in a risk register, risk table or risk section. Keep the document's own rating for probability and impact, its mitigation and its owner. Do not invent risks here and do not turn assumptions or dependencies into risks. A separate step analyzes the whole document set for additional project risks.`,
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

  const CONTEXT_SYSTEM = `You are a principal project manager screening a new project document before it is analyzed. You receive the start of the document and the list of its headings. Decide what kind of document it is and summarize it for the delivery team.
Return JSON: {"role":"technical|financial|contract|award|po|schedule|other","summary":"three sentences: what this document is and who it is for, what it commits the vendor or the client to, and the key figures or dates it states","project_name":"","confidence":0.0}
technical is a technical proposal or solution description with approach, plan, deliverables and resources. financial is a price offer or commercial proposal with prices and payment terms. contract covers agreements and statements of work. award is an award or acceptance letter. po is a purchase order. Write plain sentences without dashes or semicolons.`;

  const RISK_SYSTEM = `You are a principal project manager with more than twenty years of delivery experience on government and enterprise technology programs. You hold PMP and PRINCE2 qualifications and you work to PMBOK and ISO 31000. You are preparing the risk register for THIS project from its documents, the way a PMO director would review it before approving the plan.

You receive the project facts, what each document is, the deliverables with prices and dates, the schedule, the payment milestones and terms, the risks the documents already list, and passages about assumptions, dependencies and client responsibilities.

Think in this order:
1. Where does the plan depend on the client? Approval turnaround for each deliverable and acceptance gate, naming of approvers, access to environments, tenants, test users and data, availability of stakeholders, security and architecture review slots, UAT calendar, rights cleared content.
2. Where do the documents disagree or leave gaps? Dates before the award, go live before staging, a week plan shorter than the dated windows, a deliverable labeled for the wrong phase, values in words versus numbers, scope stated in one document and missing in another.
3. Where can money slip? Payment only on acceptance, a payment that carries a large share of the value, no advance payment, payment terms in days, maintenance billing not defined, VAT treatment, performance bond or guarantee timing.
4. Where can delivery slip? Hard to staff skills, integration with client identity and API services, security testing and remediation time, performance targets, hosting inside the country, language quality, data readiness, third party dependencies, holidays and Ramadan.
5. Where does scope move? Optional modules, phase boundaries, change control, requirements still to be confirmed, handover and training expectations.

Identify 12 to 20 risks to delivering THIS project. Do not repeat a risk the documents already list, build on them instead. Do not list generic risks that could apply to any project. Each risk must name the specific deliverable, phase, date, party or number it relates to.
Return JSON: {"risks":[{"title":"short, specific","description":"cause, event and effect in two or three sentences, naming the deliverable, date or party","early_warning":"the sign that shows the risk is happening","category":"client dependency|schedule|commercial|scope|technical|resource|security|compliance","probability":"Low|Medium|High","impact":"Low|Medium|High","response":"avoid|mitigate|transfer|accept","mitigation":"one concrete action with a time or owner","contingency":"what to do if it happens","owner":"role","evidence":"short text copied exactly from the passages or documents that supports it, or null","confidence":0.0}]}
Rate probability and impact honestly. A payment worth a third of the contract held up by one client approval is High impact. Use confidence 0.8 or more only when a passage states the risk or dependency directly. Use 0.5 to 0.75 when you inferred it from the facts. Write plain sentences without dashes or semicolons.`;

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
    // A spreadsheet sheet is one block of table rows, so each row is its own passage. Rows that carry dates are
    // schedule lines and are already in the schedule digest.
    const units = [];
    for (const para of String(text).split(/\n{2,}|\n(?=\d+(?:\.\d+)*\.?\s)/)) {
      if (/^\|/m.test(para)) { for (const row of para.split('\n')) if (!/\d{4}-\d{2}-\d{2}[^]*\d{4}-\d{2}-\d{2}/.test(row)) units.push(row.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' | ')); }
      else units.push(para);
    }
    for (const para of units) {
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
      // The schedule role belongs to Microsoft Project XML only. A plan workbook or a proposal with a work plan keeps its own role.
      const keepRole = role === 'plan' || (j.role === 'schedule' && !isMspXml(text));
      return { role: SCOPE[j.role] && !keepRole ? j.role : role, summary: String(j.summary || ''), project_name: j.project_name || null, confidence: clamp(Number(j.confidence)) };
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
    const parts = AI.splitParts(text, 22000);
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
    await Promise.all(Array.from({ length: Math.min(6, parts.length) }, worker));
    const out = { fields: [], deliverables: [], requirements: [], milestones: [], schedule: [], risks: [] };
    let ok = 0, failed = 0, dropped = 0, charsSent = 0;
    const seen = new Set();
    const take = (j, partText) => {
      if (!j) return;
      const hay = AI.normQuote(partText);
      const keyMap = { fields: 'info', deliverables: 'deliverables', requirements: 'requirements', milestones: 'payments', schedule: 'schedule', risks: 'risks' };
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

  async function analyzeRisks({ project, docs, items, text, checks }) {
    const live = (k) => items.filter((i) => i.kind === k && i.status !== 'ignored');
    const digest = {
      project,
      documents: docs.map((d) => ({ file: d.filename, role: ROLE_LABEL[d.role] || d.role, summary: d.summary })),
      deliverables: live('deliverable').slice(0, 40).map((i) => ({ ref: i.data.ref || null, title: i.title, phase: i.data.phase || null, due: i.data.due_date || null, price: i.data.amount || null, acceptance: i.data.acceptance || null })),
      // Phases and milestones first, then tasks, so a long plan still shows its whole shape.
      schedule: [...live('schedule').filter((i) => i.data.level !== 'task'), ...live('schedule').filter((i) => i.data.level === 'task')].slice(0, 250).map((i) => ({ name: i.title, level: i.data.level, phase: i.data.phase || null, owner: i.data.owner || null, start: i.data.start, end: i.data.end, weeks: i.data.start_week != null ? `${i.data.start_week} to ${i.data.end_week}` : null, days: i.data.duration_days || null })),
      payments: live('milestone').slice(0, 30).map((i) => ({ title: i.title, percent: i.data.percent, amount: i.data.amount, trigger: i.data.trigger || null, terms_days: i.data.terms_days || null, planned_date: i.data.due_date || null })),
      requirements: live('requirement').slice(0, 40).map((i) => ({ type: i.data.type || null, priority: i.data.priority || null, text: (i.title || i.description || '').slice(0, 140) })),
      risks_already_listed: live('risk').slice(0, 40).map((i) => i.title),
      consistency_findings: (checks || []).filter((c) => c.status !== 'Pass').slice(0, 12).map((c) => `${c.status}: ${c.title}. ${c.detail}`),
    };
    const ps = [];
    for (const d of docs) for (const t of passages(text[d.id] || '', 7000)) ps.push(`[${d.filename}] ${t}`);
    const hay = AI.normQuote(Object.values(text).join(' '));
    try {
      const j = await AI.claudeJSON(RISK_SYSTEM, `Project facts and documents:\n${JSON.stringify(digest)}\n\nPassages about assumptions, dependencies and client responsibilities:\n${ps.slice(0, 80).join('\n')}`, 14000);
      const risks = [];
      for (const r of Array.isArray(j.risks) ? j.risks : []) {
        if (!r || !String(r.title || '').trim()) continue;
        const grounded = r.evidence && AI.quoteFound(String(r.evidence).replace(/^\[[^\]]+\]\s*/, ''), hay);
        const lvl = (x) => (['Low', 'Medium', 'High'].includes(x) ? x : 'Medium');
        const warn = r.early_warning ? ` Early warning: ${String(r.early_warning).trim()}` : '';
        const cont = r.contingency ? ` Contingency: ${String(r.contingency).trim()}` : '';
        risks.push({ title: String(r.title).slice(0, 140), description: (String(r.description || '').trim() + warn).trim(), probability: lvl(r.probability), impact: lvl(r.impact), mitigation: (String(r.mitigation || '').trim() + cont).trim(), response: ['avoid', 'mitigate', 'transfer', 'accept'].includes(r.response) ? r.response : null, category: r.category || null, owner: r.owner || null, quote: grounded ? String(r.evidence).replace(/^\[[^\]]+\]\s*/, '') : '', inferred: !grounded, confidence: clamp(Number(r.confidence), 0.3, grounded ? 0.95 : 0.75) });
      }
      return risks.slice(0, 22);
    } catch (e) {
      if (['bad_key', 'budget', 'rate', 'network'].includes(e.code)) throw e;
      console.error('Risk analysis failed:', e.message);
      return [];
    }
  }

  // ---------- plan workbooks, read in code ----------
  // The spreadsheet reader writes every sheet as "Sheet: name" followed by one line per row, cells joined by " | ".
  // A plan table and a risk table are read straight from those lines, so every row is kept exactly as written.
  function sheetBlocks(text) {
    const blocks = [];
    let cur = null;
    for (const line of String(text || '').split('\n')) {
      const m = /^Sheet: (.*)$/.exec(line);
      if (m) { cur = { sheet: m[1].trim(), lines: [], chars: line.length + 1 }; blocks.push(cur); continue; }
      if (!cur) continue;
      cur.chars += line.length + 1;
      if (line.startsWith('|')) cur.lines.push({ line, cells: line.replace(/^\|\s?/, '').replace(/\s?\|$/, '').split(' | ').map((c) => c.trim()) });
    }
    return blocks;
  }
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const colOf = (head, re) => head.findIndex((h) => re.test(h));
  function planColumns(head) {
    const h = head.map((c) => String(c || '').toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim());
    const name = colOf(h, /^(task|activity|task name|activity name|name|work package)$/);
    const start = colOf(h, /^(start|start date|planned start|baseline start)$/);
    const end = colOf(h, /^(finish|end|end date|finish date|planned end|planned finish|finish basline|finish baseline|baseline finish|baseline end)$/);
    if (name < 0 || start < 0 || end < 0) return null;
    return { name, start, end, wbs: colOf(h, /^(wbs|id|no|ref|#)$/), type: colOf(h, /^(type|level|task type)$/), owner: colOf(h, /^(owner|resource|resources|responsible|assigned to|assignee)$/), status: colOf(h, /^status$/), pct: colOf(h, /^(% complete|complete|progress)$/), notes: colOf(h, /(notes|dependenc|predecessor|comments)/) };
  }
  function riskColumns(head) {
    const h = head.map((c) => String(c || '').toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim());
    const title = colOf(h, /(risk|dependency|issue|assumption)/);
    const impact = colOf(h, /^impact|severity/);
    const prob = colOf(h, /^(probability|likelihood)/);
    if (title < 0 || impact < 0 || prob < 0) return null;
    return { title, impact, prob, id: colOf(h, /^(id|ref|no|#)$/), owner: colOf(h, /^(owner|responsible)/), status: colOf(h, /^status/), mitigation: colOf(h, /(mitigation|action|response)/) };
  }
  const level3 = (v) => { const x = String(v || '').toLowerCase(); return /high|critical|severe/.test(x) ? 'High' : /low|minor/.test(x) ? 'Low' : 'Medium'; };
  function planFromText(text) {
    const res = { found: false, schedule: [], risks: [], fields: [], sheets_read: [], sheets_skipped: [], chars_read: 0, chars_total: String(text || '').length, project: null };
    const blocks = sheetBlocks(text);
    for (const b of blocks) {
      let used = false;
      for (let i = 0; i < b.lines.length && !used; i++) {
        const head = b.lines[i].cells;
        const pc = planColumns(head);
        const rc = pc ? null : riskColumns(head);
        if (!pc && !rc) continue;
        const rows = b.lines.slice(i + 1);
        if (pc) {
          const names = new Map();
          const cell = (r, k) => (k >= 0 ? r.cells[k] || '' : '');
          const parsed = rows.map((r) => ({ r, wbs: cell(r, pc.wbs), name: cell(r, pc.name).replace(/\s+/g, ' ').trim(), start: cell(r, pc.start), end: cell(r, pc.end), type: cell(r, pc.type).toLowerCase() })).filter((x) => x.name && (ISO_DATE.test(x.start) || ISO_DATE.test(x.end)));
          if (parsed.length < 2) continue;
          for (const x of parsed) if (x.wbs) names.set(x.wbs, x.name);
          for (const x of parsed) {
            const start = ISO_DATE.test(x.start) ? x.start : x.end, end = ISO_DATE.test(x.end) ? x.end : x.start;
            if (/^project$/.test(x.type)) { res.project = { name: x.name, start, end, quote: x.r.line.slice(0, 300) }; continue; }
            const hasKids = x.wbs && parsed.some((y) => y !== x && y.wbs.startsWith(x.wbs + '.'));
            const level = /phase|summary|stage/.test(x.type) ? 'phase' : /milestone/.test(x.type) ? 'milestone' : x.type ? 'task' : hasKids ? 'phase' : 'task';
            const parentWbs = x.wbs.includes('.') ? x.wbs.slice(0, x.wbs.lastIndexOf('.')) : '';
            res.schedule.push({ level, type: level === 'milestone' ? 'milestone' : 'task', name: x.name, phase: parentWbs && names.get(parentWbs) ? names.get(parentWbs) : null, start, end, start_week: null, end_week: null, duration_days: null, owner: cell(x.r, pc.owner) || null, depends_on: [], wbs: x.wbs || null, confidence: 0.95, quote: x.r.line.slice(0, 300) });
          }
          if (res.schedule.length) { used = true; res.found = true; }
        } else if (rc) {
          const cell = (r, k) => (k >= 0 ? r.cells[k] || '' : '');
          for (const r of rows) {
            const full = cell(r, rc.title).replace(/\s+/g, ' ').trim();
            if (full.length < 8) continue;
            const id = cell(r, rc.id), status = cell(r, rc.status);
            const body = full.replace(/^(risk|dependency|assumption|issue)\s*:\s*/i, '');
            const colon = body.indexOf(':');
            const title = (colon >= 12 && colon <= 90 ? body.slice(0, colon) : body.split(/(?<=[.!?])\s/)[0].slice(0, 100)).replace(/[.\s]+$/, '').trim();
            const closed = /closed|resolved|retired|done/i.test(status);
            res.risks.push({ title, description: `${id ? id + '. ' : ''}${full}${status ? ` Status in the plan: ${status}.` : ''}`, probability: level3(cell(r, rc.prob)), impact: level3(cell(r, rc.impact)), mitigation: cell(r, rc.mitigation), owner: cell(r, rc.owner) || null, confidence: closed ? 0.6 : 0.9, quote: r.line.slice(0, 300) });
          }
          if (res.risks.length) { used = true; res.found = true; }
        }
      }
      (used ? res.sheets_read : res.sheets_skipped).push(b.sheet);
      if (used) res.chars_read += b.chars;
    }
    const dates = res.schedule.flatMap((t) => [t.start, t.end]).filter(Boolean).sort();
    const pj = res.project;
    if (res.schedule.length && (pj || dates.length)) {
      const quote = pj ? pj.quote : res.schedule[0].quote;
      res.fields.push({ field: 'start_date', value: pj ? pj.start : dates[0], confidence: 0.85, quote });
      res.fields.push({ field: 'end_date', value: pj ? pj.end : dates[dates.length - 1], confidence: 0.8, quote });
    }
    return res;
  }
  // Same result shape as extractDoc, with no AI call: every row of the plan and risk tables is kept as written.
  function extractPlan({ text }) {
    const p = planFromText(text);
    if (!p.found) throw Object.assign(new Error('No plan table was found in this workbook'), { code: 'badjson' });
    return { engine: 'plan', fields: p.fields, deliverables: [], requirements: [], milestones: [], schedule: p.schedule, risks: p.risks, sheets_read: p.sheets_read, sheets_skipped: p.sheets_skipped, project_name: p.project ? p.project.name : null, coverage: { chars_total: p.chars_total, chars_sent: Math.min(p.chars_total, p.chars_read), parts: p.sheets_read.length + p.sheets_skipped.length, parts_read: p.sheets_read.length, parts_failed: 0, dropped_no_quote: 0 } };
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

  // ---------- schedule builder ----------
  // The plan is built in two steps. First an outline of phases and the delivery approach, then every phase is expanded
  // into detailed tasks at the same time. Code then places the tasks on working days, so dates and links stay consistent.
  const PLAN_HEAD = /project management|methodolog|delivery (approach|model|plan)|implementation (approach|plan)|approach|governance|work ?plan|project plan|timeline|schedule|phase|sprint|agile|waterfall|scope of (work|services)|deliverable|testing|uat|acceptance|training|deployment|go.?live|handover|hand over|hypercare|support|maintenance|raci|roles and responsibilities|communication|quality|change (control|management)|reporting|resources|team structure|milestone|cutover|migration|onboarding|kick.?off|transition/i;
  const PLAN_TOP = /project management|methodolog|delivery (approach|model|plan)|implementation (approach|plan)|governance|work ?plan|project plan|timeline|phase|sprint/i;
  // Pulls the sections of a document that describe how the work is delivered.
  function planSections(text, limit) {
    const lines = String(text).split('\n');
    const heads = [];
    let pos = 0;
    lines.forEach((l, i) => {
      const t = l.trim();
      if (t.length >= 4 && t.length <= 100 && /^(#{1,3}\s|\d+(\.\d+){0,3}\.?\s+[A-Z])/.test(t) && !/\.{4,}/.test(t) && !/\|/.test(t)) heads.push({ i, pos, t });
      pos += l.length + 1;
    });
    const secs = [];
    heads.forEach((h, k) => {
      const end = k + 1 < heads.length ? heads[k + 1].pos : String(text).length;
      const body = String(text).slice(h.pos, end).trim();
      if (body.length < 120 || (body.match(/\.{4,}/g) || []).length > 3) return;
      if (!PLAN_HEAD.test(h.t)) return;
      secs.push({ head: h.t, body: body.slice(0, 4200), top: PLAN_TOP.test(h.t) ? 1 : 0 });
    });
    secs.sort((a, b) => b.top - a.top);
    const out = []; let size = 0;
    for (const x of secs) { if (size + x.body.length > limit) continue; out.push(x); size += x.body.length; }
    return out;
  }

  const OUTLINE_SYSTEM = `You are a principal project manager with more than twenty years of delivery experience on government and enterprise technology programs. You hold PMP and PRINCE2 qualifications and work to PMBOK and ISO 21502. You are planning the delivery of a project from its proposal, award and price documents before the kick off.

You receive numbered items already extracted from the documents (phases, tasks, deliverables with prices, payment milestones) and the sections of the documents that describe scope, methodology, project management and governance. Produce the OUTLINE of the delivery plan only. Another step will expand every phase into tasks.

Decide the delivery methodology from the documents: agile, waterfall, hybrid or unknown. Say what in the text shows it, such as sprints, iterations, stage gates or a work breakdown. If the text gives a sprint length, environments, ceremonies, governance bodies or reporting rhythm, record them.

Return JSON: {"summary":"3 to 5 sentences: what is delivered, for whom, the contract value, the duration and the main risk to the dates","methodology":{"approach":"agile|waterfall|hybrid|unknown","basis":"stated|implied","evidence":"one sentence","cadence":"for example two week sprints or null","environments":["development","staging","production"],"governance":["weekly status meeting","monthly steering committee"]},"phases":[{"name":"","objective":"one sentence","start_week":number or null,"end_week":number or null,"duration_days":number,"basis":"stated|implied","refs":[item numbers],"deliverables":["deliverable names from the items that finish in this phase"],"activities":["key activities the documents state for this phase"],"gates":["client approvals and acceptance gates in this phase"],"recurring":false}],"notes":["one line per conflict, gap or assumption the project manager must resolve"]}

Rules. Use 4 to 9 phases in delivery order. Keep every stated phase and its weeks. Add the phases a real project needs that the documents leave out, such as mobilization and contract setup, requirements and design, testing and acceptance, go live and hypercare, training and handover, closure. Give the last phase the name Project governance and reporting with recurring true. It holds the weekly and monthly meetings and the reports. Every phase cites at least one item in refs, so cite the deliverable or task it supports. A phase with week numbers keeps them, week 1 starts on the anchor date. Never invent calendar dates. Estimate duration_days as working days. Documents rank: award letter, then financial offer, then technical proposal. Where documents disagree schedule the higher ranked one and note it. Write plain sentences without dashes or semicolons.`;

  const PHASE_SYSTEM = `You are a principal project manager with more than twenty years of delivery experience on government and enterprise technology programs. You are expanding ONE phase of a delivery plan into the detailed task list you would enter in MS Project.

You receive the methodology, the outline of this phase, the other phases for context, the extracted items and the sections of the documents that describe scope and project management. Work to the delivery methodology. For agile work include backlog refinement, sprint planning, each sprint build, sprint demo and review, retrospectives, a release plan and release reviews. For waterfall work include requirements, design, build, integration, test and acceptance. Always add the steps a real project needs even when the documents do not list them: draft and prepare each deliverable, internal quality review, client review, client approval or sign off as its own line, the invoice trigger when a payment depends on an approval, environment setup, security and architecture reviews, system and integration testing, performance and security testing, UAT planning, UAT cycles, defect fixing, CAB or change approval, cutover plan, deployment rehearsal, deployment, go live verification, hypercare, training, handover, lessons learned and final acceptance. Use only the ones that belong in this phase.

Return JSON: {"rows":[{"name":"","type":"task|review|approval|milestone|meeting","duration_days":number,"depends_on":["names of earlier rows in this phase"],"owner":"role or party","basis":"stated|implied","assumption":"for implied rows one short sentence on why it is needed and where the duration comes from","refs":[item numbers],"span":false}]}

Rules. Give 12 to 28 rows, or 6 to 12 rows for a recurring governance phase. List rows so that a predecessor always appears before its successors. The first row has an empty depends_on. Every other row names at least one earlier row in depends_on. Rows that can run in parallel name the same predecessor. Each row name is unique, under 60 characters and starts with a verb or a clear noun. Give a realistic duration in working days. Use typical durations unless the documents state one: client review of plans and governance 3 days, requirements workshop 5 days, design 3 days, security architecture review 4 days, sprint 10 days, sprint demo and review 2 days, UAT cycle 5 to 8 days, CAB review 2 days, approval 1 day after each review. Reviews and approvals are separate rows owned by the client. A milestone has duration_days 0. In a recurring governance phase use meeting rows with span true, which means they run across the whole project, and ordinary rows for reports. Stated rows come from the documents and cite their items in refs. Implied rows cite the item of the deliverable or phase they support. Write plain sentences without dashes or semicolons.`;

  async function buildSchedule({ docs, items, anchor, project, texts, onProgress }) {
    await AI.ready();
    if (!AI.hasKey()) return null;
    const rows = items.filter((i) => i.status !== 'ignored' && ['schedule', 'deliverable', 'milestone'].includes(i.kind));
    if (!rows.length) return null;
    const list = rows.slice(0, 220).map((i, n) => ({ n: n + 1, kind: i.kind, doc: i.doc_name || '', ref: i.data.ref || null, name: i.title, level: i.data.level || null, type: i.data.type || null, phase: i.data.phase || null, owner: i.data.owner || null, start: i.data.start || i.data.due_date || null, end: i.data.end || null, start_week: i.data.start_week ?? null, end_week: i.data.end_week ?? null, days: i.data.duration_days ?? null, amount: i.data.amount ?? null, percent: i.data.percent ?? null, trigger: i.data.trigger || null, acceptance: i.data.acceptance || null, depends_on: i.data.depends_on || null }));
    // The sections that describe how the work is delivered. The technical proposal and contract come first.
    const order = { technical: 0, contract: 1, other: 2, award: 3, financial: 4 };
    const secs = [];
    for (const d of [...docs].sort((a, b) => (order[a.role] ?? 5) - (order[b.role] ?? 5))) for (const x of planSections((texts || {})[d.id] || '', 16000)) secs.push(`[${d.filename}] ${x.head}\n${x.body}`);
    let excerpt = ''; for (const x of secs) { if (excerpt.length + x.length > 34000) break; excerpt += x + '\n\n'; }
    const head = `Anchor date for Week 1: ${anchor || 'unknown'}\nProject: ${JSON.stringify({ value: project.value, currency: project.currency, award_date: project.award_date || null, start_date: project.start_date || null, end_date: project.end_date || null })}\nDocuments: ${JSON.stringify(docs.map((d) => ({ file: d.filename, kind: d.kind, summary: d.summary })))}\nItems: ${JSON.stringify(list)}`;
    const tail = `\n\nSections of the documents about scope, methodology and project management:\n${excerpt || '(none found)'}`;
    const step = (label, frac) => { if (onProgress) onProgress(label, frac); };
    let outline;
    try {
      step('Planning the phases and the delivery approach', 0.05);
      outline = await AI.claudeJSON(OUTLINE_SYSTEM, head + tail, 9000);
    } catch (e) {
      console.error('Outline failed:', e.message);
      return { failed: true, reason: e.message, code: e.code || null, plan: [], notes: [], summary: '' };
    }
    const phases = (outline && Array.isArray(outline.phases) ? outline.phases : []).filter((p) => p && String(p.name || '').trim()).slice(0, 10);
    if (!phases.length) return { failed: true, reason: 'The AI did not return any phases', code: 'badjson', plan: [], notes: [], summary: '' };
    const meth = outline.methodology || {};
    const methText = JSON.stringify({ approach: meth.approach || 'unknown', evidence: meth.evidence || null, cadence: meth.cadence || null, environments: meth.environments || [], governance: meth.governance || [] });
    const phaseList = phases.map((p) => ({ name: p.name, objective: p.objective, start_week: p.start_week ?? null, end_week: p.end_week ?? null, duration_days: p.duration_days ?? null, recurring: !!p.recurring }));
    let doneN = 0;
    const expand = async (p, k) => {
      const mine = { ...p };
      const user = `Methodology: ${methText}\nThis phase: ${JSON.stringify(mine)}\nAll phases in order: ${JSON.stringify(phaseList)}\n${head}${tail}`;
      let j = null; let err = null;
      for (let a = 0; a < 2 && !j; a++) {
        try { j = await AI.claudeJSON(PHASE_SYSTEM, user, 14000); } catch (e) { err = e; if (e.code === 'cutoff' && e.text) { const arr = salvageRows(e.text); if (arr) j = { rows: arr }; } if (['bad_key', 'budget'].includes(e.code)) throw e; }
      }
      doneN++; step(`Detailing the phases, ${doneN} of ${phases.length} done`, 0.3 + 0.65 * (doneN / phases.length));
      return { j, err };
    };
    step(`Detailing the phases, 0 of ${phases.length} done`, 0.3);
    const expanded = await Promise.all(phases.map(expand));

    // ----- place the tasks on working days -----
    const plan = []; const notes = Array.isArray(outline.notes) ? outline.notes.map(String).filter(Boolean) : [];
    const refsOf = (arr, fallback) => { const r = (Array.isArray(arr) ? arr : []).map((n) => rows[Number(n) - 1]).filter(Boolean); return r.length ? r : fallback; };
    const globalRefs = [rows.find((r) => r.kind === 'deliverable') || rows[0]];
    const used = new Set();
    const uniq = (n) => { let x = String(n).trim().slice(0, 140) || 'Task'; let k = 2; const base = x; while (used.has(x.toLowerCase())) x = `${base} (${k++})`; used.add(x.toLowerCase()); return x; };
    let cursor = 1; let lastName = null; let projectEnd = 1;
    const recurring = [];
    phases.forEach((p, k) => {
      const ex = expanded[k];
      const prefs = refsOf(p.refs, globalRefs);
      const phaseName = uniq(p.name);
      if (p.recurring) { recurring.push({ p, ex, prefs, phaseName }); return; }
      if (!ex.j || !Array.isArray(ex.j.rows) || !ex.j.rows.length) { notes.push(`The tasks of the phase ${p.name} could not be generated (${(ex.err && ex.err.message) || 'no reply'}). Use Analyze again.`); }
      let pStart = p.start_week > 0 ? (Math.round(p.start_week) - 1) * 5 + 1 : cursor;
      if (!(p.start_week > 0)) pStart = cursor;
      const slot = new Map(); const out = []; let pEnd = pStart;
      const rws = ex.j && Array.isArray(ex.j.rows) ? ex.j.rows.filter((r) => r && String(r.name || '').trim()).slice(0, 40) : [];
      const nameKey = (n) => String(n || '').trim().toLowerCase();
      const local = new Map();
      rws.forEach((r, i) => {
        const name = uniq(r.name);
        local.set(nameKey(r.name), name);
        const type = ['task', 'review', 'approval', 'milestone', 'meeting'].includes(r.type) ? r.type : 'task';
        let deps = (Array.isArray(r.depends_on) ? r.depends_on : []).map((d) => local.get(nameKey(d))).filter(Boolean);
        if (!deps.length && i > 0) deps = [out[i - 1].name];
        const ends = deps.map((d) => slot.get(d)).filter((x) => x != null);
        const isMs = type === 'milestone';
        const dur = isMs ? 0 : Math.max(1, Math.round(Number(r.duration_days) || 1));
        const start = ends.length ? (isMs ? Math.max(...ends) : Math.max(...ends) + 1) : pStart;
        const end = isMs ? start : start + dur - 1;
        slot.set(name, end);
        if (end > pEnd) pEnd = end;
        const implied = r.basis !== 'stated';
        out.push({ level: isMs ? 'milestone' : 'task', type: type === 'meeting' ? 'task' : type, name, phase: phaseName, start: null, end: null, start_week: null, end_week: null, start_day: start, duration_days: isMs ? null : dur, owner: r.owner ? String(r.owner).slice(0, 80) : null, implied, assumption: implied && r.assumption ? String(r.assumption).slice(0, 240) : null, depends_on: deps, refs: refsOf(r.refs, prefs) });
      });
      if (out.length && lastName && !out[0].depends_on.length) out[0].depends_on = [lastName];
      const sd = pStart; const dd = Math.max(1, pEnd - pStart + 1);
      plan.push({ level: 'phase', type: 'task', name: phaseName, phase: null, start: null, end: null, start_week: p.start_week ?? null, end_week: p.end_week ?? null, start_day: sd, duration_days: dd, owner: null, implied: p.basis !== 'stated', assumption: p.basis !== 'stated' ? (p.objective || null) : null, depends_on: [], refs: prefs });
      plan.push(...out);
      if (out.length) lastName = out[out.length - 1].name;
      cursor = Math.max(cursor, pEnd + 1);
      if (pEnd > projectEnd) projectEnd = pEnd;
    });
    // Recurring governance runs across the whole project
    for (const { p, ex, prefs, phaseName } of recurring) {
      const rws = ex.j && Array.isArray(ex.j.rows) ? ex.j.rows.filter((r) => r && String(r.name || '').trim()).slice(0, 20) : [];
      if (!rws.length) { notes.push(`The governance tasks could not be generated (${(ex.err && ex.err.message) || 'no reply'}). Use Analyze again.`); }
      plan.push({ level: 'phase', type: 'task', name: phaseName, phase: null, start: null, end: null, start_week: null, end_week: null, start_day: 1, duration_days: projectEnd, owner: null, implied: p.basis !== 'stated', assumption: p.basis !== 'stated' ? (p.objective || null) : null, depends_on: [], refs: prefs });
      let pos = 1;
      for (const r of rws) {
        const name = uniq(r.name);
        const span = !!r.span || r.type === 'meeting';
        const dur = span ? projectEnd : Math.max(1, Math.round(Number(r.duration_days) || 1));
        const isMs = r.type === 'milestone';
        const implied = r.basis !== 'stated';
        plan.push({ level: isMs ? 'milestone' : 'task', type: ['review', 'approval', 'milestone'].includes(r.type) ? r.type : 'task', name, phase: phaseName, start: null, end: null, start_week: null, end_week: null, start_day: span ? 1 : Math.min(pos, projectEnd), duration_days: isMs ? null : dur, owner: r.owner ? String(r.owner).slice(0, 80) : null, implied, assumption: implied && r.assumption ? String(r.assumption).slice(0, 240) : null, depends_on: [], refs: refsOf(r.refs, prefs) });
        if (!span) pos += dur;
      }
    }
    const methLine = meth.approach && meth.approach !== 'unknown' ? `Delivery approach: ${meth.approach}${meth.cadence ? `, ${meth.cadence}` : ''}${meth.basis === 'stated' ? ', as stated in the documents' : ', assumed because the documents do not state it'}.` : '';
    if (methLine) notes.unshift(methLine);
    const result = plan.filter((r) => r.refs && r.refs.length).map((r) => ({ ...r, quote: ((r.refs[0] && r.refs[0].quote) || '').slice(0, 300), source_docs: [...new Set(r.refs.map((x) => x.doc_name).filter(Boolean))], refs: r.refs.map((x) => x.id) }));
    return { summary: String(outline.summary || ''), plan: result, notes: notes.slice(0, 18), methodology: meth };
  }
  // A cut off reply still holds the rows that were complete. Keep them.
  function salvageRows(txt) {
    const a = txt.indexOf('"rows"'); if (a < 0) return null;
    const open = txt.indexOf('[', a); if (open < 0) return null;
    for (let i = txt.length; i > open; i--) { if (txt[i - 1] !== '}') continue; try { const arr = JSON.parse(txt.slice(open, i) + ']'); if (Array.isArray(arr) && arr.length >= 3) return arr; } catch (e) { /* keep scanning back */ } }
    return null;
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

  return { SCOPE, AUTHORITY, ROLE_LABEL, detectRole, isMspXml, planFromText, extractPlan, context, extractDoc, analyzeRisks, buildSchedule, planSections, scheduleFromMsp, confidence, passages };
})();
