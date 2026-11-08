// Minutes as a Word file or Markdown. Each main heading starts a new page, as in the other generated documents.
'use strict';
const { mmss } = require('./meetings');

const AR = /[؀-ۿ]/;
const when = (iso) => { try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.APP_TZ || 'Asia/Dubai' }); } catch (e) { return ''; } };
const spName = (m, id) => ((m.speakers || {})[id] || {}).name || id;

function sections(m, projectName) {
  const mi = m.minutes || {};
  const s = [];
  s.push({ h: 'Summary', meta: [['Project', projectName], ['Meeting', m.title], ['Date and time', when(m.meeting_at)], ['Attendees', (m.attendees || []).map((a) => a.name).join(', ') || 'Not listed']], paras: [mi.summary || ''] });
  if ((mi.topics || []).length) s.push({ h: 'Discussion', topics: mi.topics });
  if ((mi.decisions || []).length) s.push({ h: 'Decisions', bullets: mi.decisions.map((d) => d.text + (d.owner ? ` (${d.owner})` : '')) });
  if ((mi.actions || []).length) s.push({ h: 'Actions', table: { head: ['Action', 'Owner', 'Due date'], rows: mi.actions.map((a) => [a.title, a.owner || '', a.due_date || '']) } });
  if ((mi.risks || []).length) s.push({ h: 'Risks and issues', table: { head: ['Risk', 'Probability', 'Impact', 'Mitigation'], rows: mi.risks.map((r) => [r.title, r.probability, r.impact, r.mitigation || '']) } });
  if ((mi.updates || []).length) s.push({ h: 'Progress updates', table: { head: ['Task', 'Progress', 'Delay (days)', 'Note'], rows: mi.updates.map((u) => [u.task, u.progress == null ? '' : u.progress + '%', u.delay_days == null ? '' : String(u.delay_days), u.note || '']) } });
  if ((mi.questions || []).length) s.push({ h: 'Open questions', bullets: mi.questions.map((q) => q.text + (q.owner ? ` (${q.owner})` : '')) });
  return s;
}

function markdown(m, projectName, withTranscript) {
  const out = [`# ${(m.minutes && m.minutes.title) || m.title}`, ''];
  for (const s of sections(m, projectName)) {
    if (s.h !== 'Summary') out.push(`## ${s.h}`, '');
    if (s.meta) { for (const [k, v] of s.meta) out.push(`**${k}:** ${v}`); out.push(''); }
    for (const p of s.paras || []) if (p) out.push(p, '');
    for (const t of s.topics || []) { out.push(`### ${t.heading}`); for (const p of t.points) out.push(`* ${p}`); out.push(''); }
    for (const b of s.bullets || []) out.push(`* ${b}`);
    if (s.bullets) out.push('');
    if (s.table) { out.push(`| ${s.table.head.join(' | ')} |`, `| ${s.table.head.map(() => '---').join(' | ')} |`); for (const r of s.table.rows) out.push(`| ${r.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`); out.push(''); }
  }
  if (withTranscript) { out.push('## Transcript', ''); for (const t of m.transcript || []) out.push(`**[${mmss(t.start)}] ${spName(m, t.speaker)}:** ${t.text}`, ''); }
  return Buffer.from(out.join('\n'), 'utf8');
}

async function docx(m, projectName, withTranscript) {
  const D = require('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = D;
  const p = (text, o = {}) => new Paragraph({ bidirectional: AR.test(text), spacing: { after: 120 }, ...o, children: [new TextRun({ text: String(text), rightToLeft: AR.test(text), bold: !!o.bold, size: o.size || 22 })] });
  const cell = (text, head) => new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, shading: head ? { fill: 'EEF2FA' } : undefined, children: [p(text, { bold: head, size: 20 })] });
  const table = (head, rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) }), ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))] });
  const kids = [];
  let first = true;
  const heading = (text) => { kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: !first, children: [new TextRun({ text, bold: true })] })); first = false; };
  kids.push(new Paragraph({ heading: HeadingLevel.TITLE, bidirectional: AR.test((m.minutes && m.minutes.title) || m.title), children: [new TextRun({ text: (m.minutes && m.minutes.title) || m.title, bold: true })] }));
  for (const s of sections(m, projectName)) {
    heading(s.h);
    if (s.meta) kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: s.meta.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v, false)] })) }), p(''));
    for (const t of s.paras || []) if (t) kids.push(p(t));
    for (const t of s.topics || []) { kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, bidirectional: AR.test(t.heading), children: [new TextRun({ text: t.heading, bold: true })] })); for (const x of t.points) kids.push(new Paragraph({ bullet: { level: 0 }, bidirectional: AR.test(x), children: [new TextRun({ text: x, rightToLeft: AR.test(x), size: 22 })] })); }
    for (const b of s.bullets || []) kids.push(new Paragraph({ bullet: { level: 0 }, bidirectional: AR.test(b), children: [new TextRun({ text: b, rightToLeft: AR.test(b), size: 22 })] }));
    if (s.table) kids.push(table(s.table.head, s.table.rows));
  }
  if (withTranscript) { heading('Transcript'); for (const t of m.transcript || []) kids.push(p(`[${mmss(t.start)}] ${spName(m, t.speaker)}: ${t.text}`, { size: 20 })); }
  const doc = new Document({ sections: [{ children: kids }] });
  return Packer.toBuffer(doc);
}

module.exports = { markdown, docx };
