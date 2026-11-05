/* Document export for Project Manager AI.
   A generated document is stored as Markdown plus a small JSON snapshot of chart data. This file turns that into
   a branded plan (cover, key figures, sections, visuals) and hands it to the Word, PowerPoint or Excel builder.
   The builders and their libraries are loaded only when a file is downloaded.
   Colors are the light theme tokens of styles.css, because a document is read on paper or in an office app. */
(function () {
  'use strict';
  const PM = window.PM;
  const VERSION = '3';

  // ---------- design tokens (light theme of styles.css, hex without the hash) ----------
  const T = {
    primary: '2457D6', primary600: '1C46B0', primarySoft: 'E8EEFC', onPrimary: 'FFFFFF',
    text: '1B2437', muted: '5B6680', faint: '626F8A', border: 'E2E7F0', borderStrong: 'CDD5E3', surface: 'FFFFFF', surface2: 'F8F9FD',
    success: '12784A', successSoft: 'E2F5EC', warning: '9A5700', warningSoft: 'FDF0D9', danger: 'B82F2F', dangerSoft: 'FBE6E6', violet: '6B4FD1', violetSoft: 'ECE8FB',
    c1: '2A78D6', c2: 'EB6834', c3: '1BAF7A', c4: 'EDA100', track: 'E6EAF3', gSum: '1F2F55', gToday: 'E0453A',
  };
  const TONE = { ok: T.success, warn: T.warning, bad: T.danger, info: T.primary, idle: T.faint };
  const SOFT = { ok: T.successSoft, warn: T.warningSoft, bad: T.dangerSoft, info: T.primarySoft, idle: T.surface2 };
  const FONT_NAME = 'IBM Plex Sans';
  const FONT = '"IBM Plex Sans","IBM Plex Sans Arabic",Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
  const hex = (h) => '#' + h;
  const tone = (k) => TONE[k] || TONE.idle;

  // A table cell that holds only one of these words is colored. The word stays, so color is never the only signal.
  const STATUS = { closed: 'ok', paid: 'ok', done: 'ok', mitigated: 'ok', low: 'ok', overdue: 'bad', late: 'bad', high: 'bad', medium: 'warn', invoiced: 'info', open: 'idle', pending: 'idle', tbc: 'idle' };
  const statusTone = (txt) => STATUS[String(txt || '').trim().toLowerCase()] || null;

  const FORMATS = {
    docx: { ext: 'docx', label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    xlsx: { ext: 'xlsx', label: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    pptx: { ext: 'pptx', label: 'PowerPoint', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  };

  // ---------- small helpers ----------
  const fmtDate = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso || '');
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  };
  const safeName = (s) => (String(s || 'document').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document');
  const money = (n, cur) => `${cur ? cur + ' ' : ''}${window.__Visuals ? window.__Visuals.compact(n) : n}`;
  const dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

  // ---------- Markdown to blocks ----------
  function inlineRuns(text) {
    const parts = String(text == null ? '' : text).split(/(\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|(?<!\w)_[^_]+_(?!\w))/g).filter((s) => s !== '');
    return parts.map((p) => {
      let m;
      if ((m = p.match(/^\*\*([^*]+)\*\*$/)) || (m = p.match(/^__([^_]+)__$/))) return { text: m[1], bold: true };
      if ((m = p.match(/^_([^_]+)_$/))) return { text: m[1], italic: true };
      return { text: p };
    });
  }
  const plain = (runs) => runs.map((r) => r.text).join('');
  const startsBlock = (l) => /^\s*(#{1,3}\s|\||[-*]\s+|\d+[.)]\s+)/.test(l);

  function parseMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { out.push({ t: 'h' + m[1].length, runs: inlineRuns(m[2].trim()) }); i++; continue; }
      if (/^\s*\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
        const isSep = (r) => r.length && r.every((c) => /^:?-{2,}:?$/.test(c));
        const body = rows.filter((r) => !isSep(r));
        if (body.length) out.push({ t: 'table', head: body[0].map(inlineRuns), rows: body.slice(1).map((r) => r.map(inlineRuns)) });
        continue;
      }
      if (/^\s*[-*]\s+/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(inlineRuns(lines[i].replace(/^\s*[-*]\s+/, ''))); i++; }
        out.push({ t: 'ul', items });
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(inlineRuns(lines[i].replace(/^\s*\d+[.)]\s+/, ''))); i++; }
        out.push({ t: 'ol', items });
        continue;
      }
      const buf = [l.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) { buf.push(lines[i].trim()); i++; }
      out.push({ t: 'p', runs: inlineRuns(buf.join(' ')) });
    }
    return out;
  }

  // ---------- visuals: what each section shows ----------
  // The first section whose heading matches the first matching pattern gets the visual, so a visual appears once.
  const RULES = [
    ['slip', [/variance/i]],
    ['gantt', [/planned next period/i, /timeline/i, /schedule management/i, /baselines?/i, /schedule/i]],
    ['deliverables', [/deliverables? status/i, /scope and deliverables/i, /deliverable/i]],
    ['payments', [/payment/i, /budget/i, /cost/i]],
    ['risks', [/risk exposure/i, /risk register/i, /key risks/i, /risks and issues/i, /risk/i]],
    ['flow', [/governance structure/i, /team and stakeholders/i, /stakeholders and team/i, /communication matrix/i, /governance/i]],
  ];
  const has = (id, V) => {
    if (id === 'flow') return true;
    if (!V) return false;
    if (id === 'phases') return V.phases && V.phases.length > 0;
    if (id === 'status') return V.status && V.status.length > 0;
    if (id === 'slip') return V.slip && V.slip.length > 0;
    if (id === 'gantt') return V.phases && V.phases.length > 0;
    if (id === 'deliverables') return V.deliverables && V.deliverables.length > 0;
    if (id === 'payments') return !!V.payments;
    if (id === 'risks') return !!V.risks;
    return false;
  };

  function specsFor(id, V, meta) {
    const m = meta || {};
    if (id === 'phases') {
      const ph = V.phases;
      const anyPlan = ph.some((x) => x.planned != null);
      const series = [{ name: 'Actual', tone: 'info', values: ph.map((x) => x.actual) }];
      if (anyPlan) series.push({ name: 'Planned', tone: 'idle', values: ph.map((x) => x.planned) });
      return [{ id, kind: 'hbar', title: 'Progress by phase', alt: `Bar chart of progress by phase. ${ph.map((x) => `${x.name} ${x.actual} percent${x.planned != null ? `, planned ${x.planned} percent` : ''}`).join('. ')}.`, labels: ph.map((x) => x.name), series, unit: '%', max: 100 }];
    }
    if (id === 'status') {
      const total = V.status.reduce((a, b) => a + b.n, 0);
      return [{ id, kind: 'donut', title: 'Tasks by status', alt: `Donut chart of ${total} tasks. ${V.status.map((x) => `${x.label} ${x.n}`).join(', ')}.`, parts: V.status, center: { value: String(total), label: 'tasks' } }];
    }
    if (id === 'slip') {
      return [{ id, kind: 'hbar', title: 'Largest slips against baseline', alt: `Bar chart of the largest slips in working days. ${V.slip.map((x) => `${x.name} ${x.days} days`).join('. ')}.`, labels: V.slip.map((x) => x.name), series: [{ name: 'Working days late', tone: 'bad', values: V.slip.map((x) => x.days) }], unit: ' days' }];
    }
    if (id === 'gantt') {
      return [{ id, kind: 'gantt', title: 'Timeline by phase', alt: `Timeline of ${V.phases.length} phases with today marked.${(V.marks || []).length ? ` ${(V.marks || []).length} payment dates are shown as diamonds.` : ''}`, rows: V.phases, marks: V.marks || [], today: V.today }];
    }
    if (id === 'deliverables') {
      const total = V.deliverables.reduce((a, b) => a + b.n, 0);
      return [{ id, kind: 'donut', title: 'Deliverables by status', alt: `Donut chart of ${total} deliverables. ${V.deliverables.map((x) => `${x.label} ${x.n}`).join(', ')}.`, parts: V.deliverables, center: { value: String(total), label: 'deliverables' } }];
    }
    if (id === 'payments') {
      const P = V.payments;
      return [
        { id: 'payments', kind: 'column', title: 'Payment milestones by amount', alt: `Column chart of payment milestones in ${P.currency || 'the contract currency'}. ${P.items.map((x) => `${x.name} ${money(x.amount, '')} ${x.state}`).join('. ')}.`, labels: P.items.map((x) => x.name), values: P.items.map((x) => x.amount), tones: P.items.map((x) => (x.state === 'Paid' ? 'ok' : x.state === 'Invoiced' ? 'info' : 'idle')), currency: P.currency },
        { id: 'payments', kind: 'stack', title: 'Payments by status', alt: `Stacked bar of payment value by status. ${P.byState.map((x) => `${x.label} ${money(x.n, P.currency)}`).join(', ')}.`, parts: P.byState, currency: P.currency },
      ];
    }
    if (id === 'risks') {
      const R = V.risks;
      return [
        { id: 'risks', kind: 'heat', title: 'Risk exposure by probability and impact', alt: `Risk heat map. ${R.open} open risks.`, matrix: R.matrix, rowLabels: ['High', 'Medium', 'Low'], colLabels: ['High', 'Medium', 'Low'] },
        { id: 'risks', kind: 'hbar', title: 'Open risks by level', alt: `Bar chart of open risks by level. ${R.byLevel.map((x) => `${x.label} ${x.n}`).join(', ')}.`, labels: R.byLevel.map((x) => x.label), series: [{ name: 'Open risks', tone: 'info', values: R.byLevel.map((x) => x.n) }], tones: R.byLevel.map((x) => x.tone), unit: '' },
      ];
    }
    if (id === 'flow') {
      return [{
        id, kind: 'flow', title: 'How decisions and reports move', alt: 'Flow from client sponsor to steering committee to project manager to delivery team.',
        steps: [{ title: `${m.client || 'Client'} sponsor`, sub: 'Direction and approvals' }, { title: 'Steering committee', sub: 'Decisions and escalations' }, { title: 'Project manager', sub: m.pm || 'Plans and reports' }, { title: 'Delivery team', sub: 'Builds and delivers' }],
      }];
    }
    return [];
  }

  // ---------- plan: cover facts and ordered sections ----------
  function splitSections(blocks, fallbackHeading) {
    const out = [];
    let cur = null;
    for (const b of blocks) {
      if (b.t === 'h1') { cur = { heading: plain(b.runs), blocks: [], ids: [] }; out.push(cur); continue; }
      if (!cur) { cur = { heading: fallbackHeading, blocks: [], ids: [] }; out.push(cur); }
      cur.blocks.push(b);
    }
    return out;
  }
  function plan(g) {
    const meta = g.meta || {};
    const V = g.visuals || null;
    const def = window.__Reports && window.__Reports.DEFAULTS[g.doc_type];
    const sections = splitSections(parseMarkdown(g.content), 'Overview');
    for (const [id, pats] of RULES) {
      if (!has(id, V)) continue;
      let hit = null;
      for (const re of pats) { hit = sections.find((s) => re.test(s.heading)); if (hit) break; }
      if (hit) hit.ids.push(id);
    }
    const glanceIds = ['phases', 'status'].filter((id) => has(id, V));
    const all = glanceIds.length ? [{ heading: 'Project at a glance', blocks: [], ids: glanceIds, glance: true }, ...sections] : sections;
    for (const s of all) s.specs = s.ids.flatMap((id) => specsFor(id, V, meta));
    return { title: g.title || (def && def.title) || 'Document', typeTitle: g.custom ? 'Custom document' : (def && def.title) || '', meta, date: fmtDate(meta.date), kpis: (V && V.kpis) || [], sections: all, onepager: def && def.oneSlide && !g.custom && V ? V.onepager || null : null, oneSlide: !!(def && def.oneSlide && !g.custom) };
  }

  // ---------- canvas chart rendering ----------
  function canvas(w, h) {
    const sc = 2;
    const c = document.createElement('canvas');
    c.width = w * sc; c.height = h * sc;
    const g = c.getContext('2d');
    g.scale(sc, sc);
    g.fillStyle = hex(T.surface); g.fillRect(0, 0, w, h);
    g.textBaseline = 'middle';
    return { c, g, w, h };
  }
  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function fit(g, text, maxW) {
    let s = String(text);
    if (g.measureText(s).width <= maxW) return s;
    while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }
  function wrap(g, text, maxW, maxLines) {
    const words = String(text).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = fit(g, lines.slice(maxLines - 1).join(' '), maxW); return keep; }
    return lines;
  }
  const font = (w, px) => `${w} ${px}px ${FONT}`;
  const W = 640;

  function drawHBar(s) {
    const many = s.series.length > 1;
    const rowH = many ? 46 : 32, top = many ? 30 : 6, labW = 176, valW = 56;
    const H = top + s.labels.length * rowH + 6;
    const cv = canvas(W, H), g = cv.g;
    if (many) {
      let x = 0;
      for (const se of s.series) {
        g.fillStyle = hex(tone(se.tone)); rrect(g, x, 8, 10, 10, 3); g.fill();
        g.fillStyle = hex(T.muted); g.font = font(400, 12); g.textAlign = 'left'; g.fillText(se.name, x + 16, 13);
        x += 16 + g.measureText(se.name).width + 22;
      }
    }
    const barX = labW, barW = W - labW - valW;
    const max = s.max || Math.max(1, ...s.series.flatMap((se) => se.values.map((v) => v || 0)));
    s.labels.forEach((lab, i) => {
      const y = top + i * rowH;
      g.fillStyle = hex(T.text); g.font = font(400, 12); g.textAlign = 'left'; g.fillText(fit(g, lab, labW - 14), 0, y + rowH / 2 - 2);
      const bh = many ? 11 : 14, gap = 4;
      let by = y + (rowH - (s.series.length * bh + (s.series.length - 1) * gap)) / 2 - 2;
      for (const se of s.series) {
        const v = se.values[i];
        g.fillStyle = hex(T.track); rrect(g, barX, by, barW, bh, 4); g.fill();
        if (v != null && v > 0) { g.fillStyle = hex(tone(s.tones ? s.tones[i] : se.tone)); rrect(g, barX, by, Math.max(8, barW * Math.min(v, max) / max), bh, 4); g.fill(); }
        g.fillStyle = hex(T.text); g.font = font(600, 11); g.textAlign = 'right'; g.fillText(v == null ? 'n/a' : `${v}${s.unit || ''}`, W, by + bh / 2);
        by += bh + gap;
      }
    });
    return cv;
  }

  function niceMax(m) {
    if (m <= 0) return 1;
    const pow = 10 ** Math.floor(Math.log10(m)); const n = m / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }
  function drawColumn(s) {
    const H = 280, padL = 58, padR = 8, padT = 36, padB = 60;
    const cv = canvas(W, H), g = cv.g;
    const max = niceMax(Math.max(...s.values));
    const plotH = H - padT - padB, plotW = W - padL - padR;
    const cmp = (v) => (window.__Visuals ? window.__Visuals.compact(v) : String(v));
    g.font = font(400, 11); g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const y = padT + plotH - (plotH * k) / 4;
      g.strokeStyle = hex(T.border); g.lineWidth = 1; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillStyle = hex(T.faint); g.fillText(cmp((max * k) / 4), padL - 8, y);
    }
    const slot = plotW / s.values.length, bw = Math.min(56, slot * 0.6);
    s.values.forEach((v, i) => {
      const x = padL + slot * i + (slot - bw) / 2, h = (plotH * v) / max, y = padT + plotH - h;
      g.fillStyle = hex(tone(s.tones[i])); rrect(g, x, y, bw, Math.max(h, 3), 4); g.fill();
      g.fillStyle = hex(T.text); g.font = font(600, 11); g.textAlign = 'center'; g.fillText(cmp(v), x + bw / 2, y - 9);
      g.fillStyle = hex(T.text); g.font = font(400, 11);
      wrap(g, s.labels[i], slot - 6, 2).forEach((ln, k) => g.fillText(ln, padL + slot * i + slot / 2, padT + plotH + 16 + k * 14));
    });
    const keys = [['ok', 'Paid'], ['info', 'Invoiced'], ['idle', 'Pending']].filter((k) => s.tones.includes(k[0]));
    let lx = padL;
    for (const k of keys) {
      g.fillStyle = hex(tone(k[0])); rrect(g, lx, 6, 10, 10, 3); g.fill();
      g.fillStyle = hex(T.muted); g.font = font(400, 12); g.textAlign = 'left'; g.fillText(k[1], lx + 16, 11);
      lx += 16 + g.measureText(k[1]).width + 22;
    }
    return cv;
  }

  function drawDonut(s) {
    const H = 230, cx = 130, cy = 115, R = 92, r = 62;
    const cv = canvas(W, H), g = cv.g;
    const total = s.parts.reduce((a, b) => a + b.n, 0) || 1;
    let a0 = -Math.PI / 2;
    const gap = s.parts.length > 1 ? 0.035 : 0;
    for (const p of s.parts) {
      const sweep = (p.n / total) * Math.PI * 2;
      g.beginPath(); g.arc(cx, cy, R, a0 + gap / 2, a0 + sweep - gap / 2); g.arc(cx, cy, r, a0 + sweep - gap / 2, a0 + gap / 2, true); g.closePath();
      g.fillStyle = hex(tone(p.tone)); g.fill();
      a0 += sweep;
    }
    g.textAlign = 'center'; g.fillStyle = hex(T.text); g.font = font(650, 28); g.fillText(s.center.value, cx, cy - 8);
    g.fillStyle = hex(T.muted); g.font = font(400, 12); g.fillText(s.center.label, cx, cy + 18);
    const rowH = 32, y0 = cy - (s.parts.length * rowH) / 2 + rowH / 2;
    s.parts.forEach((p, i) => {
      const y = y0 + i * rowH;
      g.fillStyle = hex(tone(p.tone)); rrect(g, 290, y - 6, 12, 12, 3); g.fill();
      g.fillStyle = hex(T.text); g.font = font(400, 14); g.textAlign = 'left'; g.fillText(p.label, 314, y);
      g.font = font(600, 14); g.textAlign = 'right'; g.fillText(String(p.n), 560, y);
      g.fillStyle = hex(T.muted); g.font = font(400, 12); g.fillText(`${Math.round((p.n / total) * 100)}%`, W - 4, y);
    });
    return cv;
  }

  function drawStack(s) {
    const H = 100, cv = canvas(W, H), g = cv.g;
    const total = s.parts.reduce((a, b) => a + b.n, 0) || 1;
    const gap = 2, usable = W - gap * (s.parts.length - 1);
    let x = 0;
    for (const p of s.parts) {
      const w = Math.max(6, (usable * p.n) / total);
      g.fillStyle = hex(tone(p.tone)); rrect(g, x, 14, w, 20, 6); g.fill();
      x += w + gap;
    }
    let lx = 0;
    for (const p of s.parts) {
      g.fillStyle = hex(tone(p.tone)); rrect(g, lx, 56, 12, 12, 3); g.fill();
      g.fillStyle = hex(T.text); g.font = font(600, 13); g.textAlign = 'left';
      const label = `${p.label} ${money(p.n, s.currency)}`;
      g.fillText(label, lx + 18, 62);
      g.fillStyle = hex(T.muted); g.font = font(400, 12); g.fillText(`${Math.round((p.n / total) * 100)}% of total`, lx + 18, 80);
      lx += Math.max(g.measureText(label).width, 96) + 40;
    }
    return cv;
  }

  function drawGantt(s) {
    const rows = s.rows.slice(0, 8);
    const labW = 176, axisH = 30, rowH = 30, H = axisH + rows.length * rowH + (s.marks.length ? rowH + 10 : 8) + 22;
    const cv = canvas(W, H), g = cv.g;
    const dates = rows.flatMap((r) => [r.start, r.finish]).concat(s.marks.map((m) => m.date)).concat(s.today ? [s.today] : []).filter(Boolean).map(dnum);
    let lo = Math.min(...dates), hi = Math.max(...dates);
    if (hi - lo < 14) hi = lo + 14;
    const barX = labW, barW = W - labW - 8, X = (d) => barX + ((dnum(d) - lo) / (hi - lo)) * barW;
    const months = Math.max(1, (hi - lo) / 30.4), step = months > 30 ? 6 : months > 14 ? 3 : 1;
    const d0 = new Date(lo * 86400000);
    let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1);
    g.font = font(400, 11); g.textAlign = 'left';
    let lastEnd = -1;
    for (let k = 0; k < 80; k++) {
      const d = new Date(cur); const day = cur / 86400000;
      if (day > hi) break;
      if (day >= lo - 1) {
        const x = barX + ((day - lo) / (hi - lo)) * barW;
        g.strokeStyle = hex(T.border); g.lineWidth = 1; g.beginPath(); g.moveTo(x, axisH - 4); g.lineTo(x, H - 22); g.stroke();
        const label = d.toLocaleDateString('en-US', { month: 'short', year: d.getUTCMonth() === 0 || lastEnd < 0 ? 'numeric' : undefined, timeZone: 'UTC' });
        const lw2 = g.measureText(label).width;
        if (x + 3 > lastEnd && x + 3 + lw2 < W) { g.fillStyle = hex(T.faint); g.fillText(label, x + 3, 12); lastEnd = x + 3 + lw2 + 6; }
      }
      cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1);
    }
    rows.forEach((r, i) => {
      const y = axisH + i * rowH;
      g.fillStyle = hex(T.text); g.font = font(400, 12); g.textAlign = 'left'; g.fillText(fit(g, r.name, labW - 14), 0, y + rowH / 2);
      const x1 = X(r.start), x2 = Math.max(X(r.finish), x1 + 6), late = s.today && r.finish < s.today && r.actual < 100;
      g.fillStyle = hex(T.primarySoft); rrect(g, x1, y + 8, x2 - x1, 14, 4); g.fill();
      g.strokeStyle = hex(late ? T.danger : T.c1); g.lineWidth = 1; rrect(g, x1 + 0.5, y + 8.5, x2 - x1 - 1, 13, 4); g.stroke();
      const pw = ((x2 - x1) * Math.min(r.actual, 100)) / 100;
      if (pw > 0) { g.fillStyle = hex(late ? T.danger : T.c1); rrect(g, x1, y + 8, Math.max(pw, 6), 14, 4); g.fill(); }
    });
    let yEnd = axisH + rows.length * rowH;
    if (s.marks.length) {
      g.fillStyle = hex(T.text); g.font = font(400, 12); g.textAlign = 'left'; g.fillText('Payment dates', 0, yEnd + rowH / 2);
      for (const m of s.marks) { const x = X(m.date), y = yEnd + rowH / 2; g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = hex(T.violet); rrect(g, -6, -6, 12, 12, 2); g.fill(); g.restore(); }
      yEnd += rowH + 4;
    }
    if (s.today && dnum(s.today) >= lo && dnum(s.today) <= hi) {
      const x = X(s.today);
      g.strokeStyle = hex(T.gToday); g.lineWidth = 2; g.beginPath(); g.moveTo(x, axisH - 2); g.lineTo(x, yEnd); g.stroke();
      g.fillStyle = hex(T.danger); g.font = font(600, 11); g.textAlign = 'center'; g.fillText('Today', x, yEnd + 12);
    }
    return cv;
  }

  function drawFlow(s) {
    const H = 120, n = s.steps.length, gap = 28, bw = (W - gap * (n - 1)) / n, by = 14, bh = 88;
    const cv = canvas(W, H), g = cv.g;
    s.steps.forEach((st, i) => {
      const x = i * (bw + gap), first = i === 0;
      g.fillStyle = hex(first ? T.primary : T.surface2); rrect(g, x, by, bw, bh, 10); g.fill();
      if (!first) { g.strokeStyle = hex(T.border); g.lineWidth = 1; rrect(g, x + 0.5, by + 0.5, bw - 1, bh - 1, 10); g.stroke(); }
      g.textAlign = 'center';
      g.fillStyle = hex(first ? T.onPrimary : T.text); g.font = font(600, 13);
      wrap(g, st.title, bw - 16, 2).forEach((ln, k, arr) => g.fillText(ln, x + bw / 2, by + (arr.length > 1 ? 24 : 32) + k * 16));
      g.fillStyle = hex(first ? T.onPrimary : T.muted); g.font = font(400, 11);
      wrap(g, st.sub, bw - 16, 2).forEach((ln, k) => g.fillText(ln, x + bw / 2, by + 60 + k * 14));
      if (i < n - 1) { const ax = x + bw + 6; g.strokeStyle = hex(T.faint); g.lineWidth = 2; g.beginPath(); g.moveTo(ax, by + bh / 2); g.lineTo(ax + gap - 14, by + bh / 2); g.stroke(); g.beginPath(); g.moveTo(ax + gap - 20, by + bh / 2 - 5); g.lineTo(ax + gap - 12, by + bh / 2); g.lineTo(ax + gap - 20, by + bh / 2 + 5); g.stroke(); }
    });
    return cv;
  }

  const DRAW = { hbar: drawHBar, column: drawColumn, donut: drawDonut, stack: drawStack, gantt: drawGantt, flow: drawFlow };
  async function renderSpec(s) {
    const fn = DRAW[s.kind];
    if (!fn) return null;
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* draw with the fallback font */ } }
    const cv = fn(s);
    const blob = await new Promise((ok) => cv.c.toBlob(ok, 'image/png'));
    return { data: new Uint8Array(await blob.arrayBuffer()), w: cv.w, h: cv.h };
  }

  // The numbers behind a visual, as rows. Used for the Excel sheets and as a text alternative.
  function specTable(s) {
    if (s.kind === 'hbar') return { head: ['Item', ...s.series.map((x) => x.name)], rows: s.labels.map((l, i) => [l, ...s.series.map((x) => (x.values[i] == null ? 'n/a' : x.values[i]))]) };
    if (s.kind === 'column') return { head: ['Milestone', `Amount${s.currency ? ' ' + s.currency : ''}`], rows: s.labels.map((l, i) => [l, s.values[i]]) };
    if (s.kind === 'donut' || s.kind === 'stack') return { head: ['Status', 'Count'], rows: s.parts.map((p) => [p.label, p.n]) };
    if (s.kind === 'gantt') return { head: ['Phase', 'Start', 'Finish', 'Actual %', 'Planned %'], rows: s.rows.map((r) => [r.name, r.start, r.finish, r.actual, r.planned == null ? 'n/a' : r.planned]) };
    if (s.kind === 'heat') return { head: ['Probability or impact', ...s.colLabels], rows: s.rowLabels.map((l, i) => [l, ...s.matrix[i]]) };
    if (s.kind === 'flow') return { head: ['Step', 'Role'], rows: s.steps.map((x) => [x.title, x.sub]) };
    return { head: [], rows: [] };
  }
  const heatTone = (ri, ci) => { const sc = (3 - ri) * (3 - ci); return sc >= 6 ? 'bad' : sc >= 3 ? 'warn' : 'ok'; };

  // ---------- images ----------
  async function bytesOf(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Could not load ' + url);
    return new Uint8Array(await r.arrayBuffer());
  }
  const pngSize = (b) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return { w: v.getUint32(16), h: v.getUint32(20) }; };
  async function asset(url) { const data = await bytesOf(url); const s = pngSize(data); return { data, w: s.w, h: s.h }; }
  async function clientLogo(meta) {
    const src = meta && meta.client_logo;
    if (!src || !/^data:image\//.test(src)) return null;
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const sc = Math.min(1, 600 / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = hex(T.surface); g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      return { data: new Uint8Array(await blob.arrayBuffer()), w, h };
    } catch (e) { return null; }
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

  // ---------- loading and saving ----------
  const loading = {};
  function loadScript(src) {
    if (!loading[src]) {
      loading[src] = new Promise((ok, no) => {
        const s = document.createElement('script');
        s.src = `${src}?v=${VERSION}`; s.onload = ok;
        s.onerror = () => { delete loading[src]; no(new Error(PM.t('err_download'))); };
        document.head.appendChild(s);
      });
    }
    return loading[src];
  }
  const LIBS = { docx: ['vendor/docx.min.js', 'export_docx.js'], pptx: ['vendor/pptxgen.bundle.js', 'export_pptx.js'], xlsx: ['vendor/exceljs.min.js', 'export_xlsx.js'] };
  const ex = { T, TONE, SOFT, FONT_NAME, FORMATS, STATUS, tone, statusTone, fmtDate, safeName, money, inlineRuns, plain, parseMarkdown, plan, specsFor, specTable, heatTone, renderSpec, asset, b64, builders: {} };

  async function build(g) {
    const fmt = FORMATS[g.format] ? g.format : 'docx';
    for (const src of LIBS[fmt]) await loadScript(src);
    const P = plan(g);
    const [logo, mark, client] = await Promise.all([asset('brand/full-light.png'), asset('brand/mark-512.png'), clientLogo(g.meta)]);
    const blob = await ex.builders[fmt]({ plan: P, logo, mark, client });
    return { blob, filename: `${safeName(g.title)}.${FORMATS[fmt].ext}`, format: fmt };
  }
  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  // g is a full generated document, as returned by GET /api/generated/:id
  async function download(g) {
    const r = await build(g);
    save(r.blob, r.filename);
    return r;
  }
  Object.assign(ex, { build, download, save });
  PM.exporter = ex;
  // Fetch the stored document and download it in the format it was created in.
  PM.downloadGenerated = async function (id) {
    const r = await PM.api('GET', `/api/generated/${id}`);
    return ex.download(r.generated);
  };
})();
