// Everything that leaves the system as a file: project backups, schedule exports and generated reports
// in Word, Excel, PowerPoint and Markdown.
'use strict';

const VERSION = 1;
const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown; charset=utf-8',
};

// The line under the title. A custom document also says who it was prepared for.
const byline = (g, P) => `${P.p.name}${P.p.client ? ' for ' + P.p.client : ''}${g.custom && g.custom.audience ? `. Prepared for ${g.custom.audience}` : ''}`;

// ---------- backup ----------
function projectBackup(P, { files = [], by, snapshots = [] } = {}) {
  const data = JSON.parse(JSON.stringify(P, (k, v) => (k.startsWith('_') ? undefined : v)));
  return {
    format: 'pmai-project', version: VERSION, app: 'Project Manager AI', exported_at: new Date().toISOString(), exported_by: by || null,
    project: data,
    snapshots, // the daily key figures behind the trends dashboards, oldest first
    files: files.map((f) => ({ doc_id: f.doc_id, filename: f.filename, mime: f.mime || null, size: f.size, data_base64: f.buffer.toString('base64') })),
  };
}

// ---------- schedule ----------
// Rows in outline order with an outline number such as 2.1.3, the way the schedule screen shows them.
function outline(computed) {
  const byParent = new Map();
  for (const t of computed) { const k = t.parent_id == null ? 0 : t.parent_id; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(t); }
  for (const l of byParent.values()) l.sort((a, b) => (a.position || 0) - (b.position || 0));
  const rows = [];
  const walk = (pid, prefix, depth) => (byParent.get(pid) || []).forEach((t, i) => { const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1); rows.push({ t, wbs, depth }); walk(t.id, wbs, depth + 1); });
  walk(0, '', 0);
  const rowNo = new Map(rows.map((r, i) => [r.t.id, i + 1]));
  return { rows, rowNo };
}
const predText = (t, rowNo) => (t.deps || []).map((d) => `${rowNo.get(d.id) || '?'}${d.type && d.type !== 'FS' ? d.type : ''}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ');
const SCHED_HEAD = ['Row', 'Outline', 'Task', 'Start', 'Finish', 'Duration (days)', '% complete', 'Predecessors', 'Assignee', 'Milestone', 'Summary', 'Notes'];
function scheduleRows(computed) {
  const { rows, rowNo } = outline(computed);
  return rows.map(({ t, wbs, depth }) => [rowNo.get(t.id), wbs, `${'  '.repeat(depth)}${t.name}`, t.start || '', t.finish || '', t.duration ?? '', t.progress || 0, predText(t, rowNo), t.assignee || '', t.is_milestone ? 'Yes' : '', t.summary ? 'Yes' : '', t.notes || '']);
}
// A text cell that starts with = + - or @ would run as a formula when the file is opened in Excel, so it gets a leading quote.
const safeText = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^[-+]?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v);
const csvCell = (v) => { const s = String(safeText(v) ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function scheduleCsv(P, computed) {
  const lines = [SCHED_HEAD, ...scheduleRows(computed)].map((r) => r.map(csvCell).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8'); // the byte order mark lets Excel read Arabic correctly
}
function sheet(XLSX, aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}
function scheduleXlsx(P, computed) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [SCHED_HEAD, ...scheduleRows(computed)], [6, 9, 46, 12, 12, 10, 10, 16, 18, 10, 9, 40]), 'Schedule');
  const live = (k) => (P.items || []).filter((i) => i.kind === k && i.status !== 'ignored');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [['Deliverable', 'Due', 'State'], ...live('deliverable').map((i) => [i.title, (i.data || {}).due_date || '', i.state || ''])], [46, 12, 14]), 'Deliverables');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [['Payment', 'Percent', 'Amount', 'Due', 'State'], ...live('milestone').map((i) => { const d = i.data || {}; return [i.title, d.percent ?? '', d.amount ?? '', d.due_date || '', i.state || '']; })], [46, 9, 14, 12, 14]), 'Payments');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [['Risk', 'Probability', 'Impact', 'Mitigation'], ...live('risk').map((i) => { const d = i.data || {}; return [i.title, d.probability || '', d.impact || '', d.mitigation || '']; })], [46, 12, 12, 50]), 'Risks');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, [['Name', 'Role', 'Email'], ...(P.resources || []).map((r) => [r.name, r.role || '', r.email || ''])], [26, 24, 30]), 'Team');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------- reports (markdown in, file out) ----------
// Reads the markdown the report writer produces into blocks.
function parseMarkdown(md) {
  const blocks = [];
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim() }); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) blocks.push({ type: 'table', rows });
      continue;
    }
    if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      const items = [];
      while (i < lines.length && (m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) { items.push({ level: Math.min(2, Math.floor(m[1].length / 2)), text: m[3].trim(), ordered: /\d/.test(m[2]) }); i++; }
      blocks.push({ type: 'list', items });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*\||\s*([-*+]|\d+[.)])\s)/.test(lines[i])) { para.push(lines[i].replace(/^>\s?/, '').trim()); i++; }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}
// Inline markdown to plain runs: **bold**, *italic*, `code`.
function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0, m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) out.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith('`')) out.push({ text: t.slice(1, -1), code: true });
    else out.push({ text: t.slice(1, -1), italics: true });
    last = m.index + t.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length ? out : [{ text: '' }];
}
const plain = (text) => inline(text).map((r) => r.text).join('');

async function toDocx(g, P) {
  const D = require('docx');
  const heads = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  const runs = (text, base = {}) => inline(text).map((r) => new D.TextRun({ text: r.text, bold: r.bold || base.bold, italics: r.italics, font: r.code ? 'Consolas' : undefined, rightToLeft: hasArabic(r.text), size: base.size }));
  const children = [];
  children.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: g.title || 'Report', rightToLeft: hasArabic(g.title) })], bidirectional: hasArabic(g.title) }));
  children.push(new D.Paragraph({ children: [new D.TextRun({ text: byline(g, P), color: '666666' })] }));
  for (const b of parseMarkdown(g.content)) {
    if (b.type === 'heading') children.push(new D.Paragraph({ heading: heads[b.level], children: runs(b.text), bidirectional: hasArabic(b.text), spacing: { before: 240, after: 120 } }));
    else if (b.type === 'paragraph') children.push(new D.Paragraph({ children: runs(b.text), bidirectional: hasArabic(b.text), spacing: { after: 120 } }));
    else if (b.type === 'list') b.items.forEach((it) => children.push(new D.Paragraph({ children: runs(it.text), bullet: it.ordered ? undefined : { level: it.level }, numbering: it.ordered ? { reference: 'num', level: it.level } : undefined, bidirectional: hasArabic(it.text) })));
    else if (b.type === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length));
      children.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        rows: b.rows.map((r, ri) => new D.TableRow({ tableHeader: ri === 0, children: Array.from({ length: cols }, (_, ci) => new D.TableCell({ shading: ri === 0 ? { type: D.ShadingType.CLEAR, fill: 'E8EEF9', color: 'auto' } : undefined, children: [new D.Paragraph({ children: runs(r[ci] || '', { bold: ri === 0 }), bidirectional: hasArabic(r[ci]) })] })) })),
      }));
      children.push(new D.Paragraph({ children: [] }));
    }
  }
  const doc = new D.Document({
    creator: 'Project Manager AI', title: g.title || 'Report',
    numbering: { config: [{ reference: 'num', levels: [0, 1, 2].map((level) => ({ level, format: D.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: D.AlignmentType.START })) }] },
    sections: [{ children }],
  });
  return D.Packer.toBuffer(doc);
}

async function toPptx(g, P) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = g.title || 'Report';
  const font = 'Calibri', blue = '1F4FD8', ink = '1B2437';
  const title = pptx.addSlide();
  title.background = { color: 'F4F7FD' };
  title.addText(g.title || 'Report', { x: 0.7, y: 2.3, w: 11.9, h: 1.2, fontFace: font, fontSize: 36, bold: true, color: ink, rtlMode: hasArabic(g.title) });
  title.addText(byline(g, P), { x: 0.7, y: 3.6, w: 11.9, h: 0.6, fontFace: font, fontSize: 18, color: '5B6477', rtlMode: hasArabic(P.p.name) });
  const sections = [];
  for (const b of parseMarkdown(g.content)) {
    if (b.type === 'heading' && b.level <= 2) sections.push({ title: plain(b.text), body: [] });
    else { if (!sections.length) sections.push({ title: g.title || 'Summary', body: [] }); sections[sections.length - 1].body.push(b); }
  }
  for (const sec of sections) {
    const bullets = [], tables = [];
    for (const b of sec.body) {
      if (b.type === 'table') tables.push(b.rows);
      else if (b.type === 'list') b.items.forEach((it) => bullets.push({ text: plain(it.text), level: it.level }));
      else if (b.type === 'heading') bullets.push({ text: plain(b.text), level: 0, bold: true });
      else if (b.type === 'paragraph') bullets.push({ text: plain(b.text), level: 0, plain: true });
    }
    const PER = 7;
    const pages = Math.max(1, Math.ceil(bullets.length / PER));
    for (let pg = 0; pg < pages && (bullets.length || !tables.length); pg++) {
      const s = pptx.addSlide();
      s.addText(pages > 1 ? `${sec.title} (${pg + 1} of ${pages})` : sec.title, { x: 0.6, y: 0.35, w: 12.1, h: 0.8, fontFace: font, fontSize: 28, bold: true, color: blue, rtlMode: hasArabic(sec.title) });
      const slice = bullets.slice(pg * PER, pg * PER + PER);
      if (slice.length) s.addText(slice.map((b) => ({ text: b.text, options: { bullet: b.plain ? false : { indent: 18 }, indentLevel: b.level, bold: !!b.bold, breakLine: true } })), { x: 0.7, y: 1.35, w: 11.9, h: 5.4, fontFace: font, fontSize: 18, color: ink, valign: 'top', paraSpaceAfter: 8, rtlMode: hasArabic(slice[0].text) });
    }
    for (const rows of tables) {
      const cols = Math.max(...rows.map((r) => r.length));
      for (let at = 0; at < rows.length; at += 12) {
        const chunk = at === 0 ? rows.slice(0, 12) : [rows[0], ...rows.slice(at, at + 11)];
        const s = pptx.addSlide();
        s.addText(sec.title, { x: 0.6, y: 0.35, w: 12.1, h: 0.8, fontFace: font, fontSize: 26, bold: true, color: blue, rtlMode: hasArabic(sec.title) });
        s.addTable(chunk.map((r, ri) => Array.from({ length: cols }, (_, ci) => ({ text: plain(r[ci] || ''), options: { bold: ri === 0, fill: { color: ri === 0 ? 'E8EEF9' : 'FFFFFF' }, color: ink, fontFace: font, fontSize: 12 } }))), { x: 0.6, y: 1.4, w: 12.1, border: { type: 'solid', color: 'D0D7E5', pt: 0.5 }, autoPage: false });
        if (at + 11 >= rows.length) break;
      }
    }
  }
  return pptx.write({ outputType: 'nodebuffer' });
}

function toXlsx(g, P) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const blocks = parseMarkdown(g.content);
  const text = [[g.title || 'Report'], [byline(g, P)], []];
  const tables = [];
  let current = g.title || 'Report';
  for (const b of blocks) {
    if (b.type === 'heading') { text.push([plain(b.text)]); current = plain(b.text); }
    else if (b.type === 'paragraph') text.push([plain(b.text)]);
    else if (b.type === 'list') b.items.forEach((it) => text.push([`${'    '.repeat(it.level)}• ${plain(it.text)}`]));
    else if (b.type === 'table') { tables.push({ name: current, rows: b.rows.map((r) => r.map(plain)) }); text.push([`See the table "${current}"`]); }
  }
  const first = XLSX.utils.aoa_to_sheet(text); first['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, first, 'Report');
  const used = new Set(['Report']);
  tables.forEach((t, i) => {
    let name = (t.name || `Table ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || `Table ${i + 1}`;
    let n = 2; const base = name; while (used.has(name)) name = `${base.slice(0, 25)} ${n++}`;
    used.add(name);
    const ws = XLSX.utils.aoa_to_sheet(t.rows);
    ws['!cols'] = t.rows[0].map((_, ci) => ({ wch: Math.min(60, Math.max(10, ...t.rows.map((r) => String(r[ci] || '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function report(g, P, fmt) {
  if (fmt === 'md') return { buffer: Buffer.from(`# ${g.title || 'Report'}\n\n${g.content || ''}\n`, 'utf8'), type: MIME.md };
  if (fmt === 'docx') return { buffer: await toDocx(g, P), type: MIME.docx };
  if (fmt === 'pptx') return { buffer: Buffer.from(await toPptx(g, P)), type: MIME.pptx };
  if (fmt === 'xlsx') return { buffer: toXlsx(g, P), type: MIME.xlsx };
  throw Object.assign(new Error('Unknown format'), { status: 400 });
}

module.exports = { VERSION, projectBackup, scheduleCsv, scheduleXlsx, report, parseMarkdown, MIME };
