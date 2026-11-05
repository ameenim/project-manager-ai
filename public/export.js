/* Document export for Project Manager AI.
   A generated document is stored as Markdown plus a small JSON snapshot of chart data. This file turns that into
   a branded plan (cover, key figures, sections, visuals) and hands it to the Word, PowerPoint or Excel builder.
   The builders and their libraries are loaded only when a file is downloaded.
   Colors are the light theme tokens of styles.css, because a document is read on paper or in an office app. */
(function () {
  'use strict';
  const PM = window.PM;
  const VERSION = '5';

  // ---------- design tokens (light theme of styles.css, hex without the hash) ----------
  const T = {
    primary: '2457D6', primary600: '1C46B0', primarySoft: 'E8EEFC', onPrimary: 'FFFFFF',
    text: '1B2437', muted: '5B6680', faint: '626F8A', border: 'E2E7F0', borderStrong: 'CDD5E3', surface: 'FFFFFF', surface2: 'F8F9FD',
    success: '12784A', successSoft: 'E2F5EC', warning: '9A5700', warningSoft: 'FDF0D9', danger: 'B82F2F', dangerSoft: 'FBE6E6', violet: '6B4FD1', violetSoft: 'ECE8FB',
    c1: '2A78D6', c2: 'EB6834', c3: '1BAF7A', c4: 'EDA100', track: 'E6EAF3', gSum: '1F2F55', gToday: 'E0453A',
  };
  const TONE = { ok: T.success, warn: T.warning, bad: T.danger, info: T.primary, idle: T.faint };
  const SOFT = { ok: T.successSoft, warn: T.warningSoft, bad: T.dangerSoft, info: T.primarySoft, idle: T.surface2 };
  let FONT_NAME = 'IBM Plex Sans';
  const BASE_FONT = '"IBM Plex Sans","IBM Plex Sans Arabic",Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
  let FONT = '"IBM Plex Sans","IBM Plex Sans Arabic",Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
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
  function plainRuns(text) {
    const parts = String(text == null ? '' : text).split(/(\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|(?<!\w)_[^_]+_(?!\w))/g).filter((s) => s !== '');
    return parts.map((p) => {
      let m;
      if ((m = p.match(/^\*\*([^*]+)\*\*$/)) || (m = p.match(/^__([^_]+)__$/))) return { text: m[1], bold: true };
      if ((m = p.match(/^_([^_]+)_$/))) return { text: m[1], italic: true };
      return { text: p };
    });
  }
  // {#RRGGBB:text} colors a piece of text. Bold and italic can sit inside it.
  function inlineRuns(text) {
    const out = [];
    String(text == null ? '' : text).split(/(\{#[0-9a-fA-F]{6}:[^{}]*\})/g).forEach((seg) => {
      if (seg === '') return;
      const m = seg.match(/^\{#([0-9a-fA-F]{6}):([^{}]*)\}$/);
      const runs = plainRuns(m ? m[2] : seg);
      if (m) runs.forEach((r) => { r.color = m[1].toUpperCase(); });
      out.push(...runs);
    });
    return out;
  }
  const plain = (runs) => runs.map((r) => r.text).join('');
  const startsBlock = (l) => /^\s*(#{1,3}\s|\||[-*]\s+|\d+[.)]\s+|:::chart\s)/.test(l);

  function parseMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { out.push({ t: 'h' + m[1].length, runs: inlineRuns(m[2].trim().replace(/\{#[0-9a-fA-F]{6}:([^{}]*)\}/g, '$1')) }); i++; continue; }
      if ((m = l.match(/^:::chart\s+(\{.*\})\s*$/))) {
        let spec = null; try { spec = chartSpec(JSON.parse(m[1])); } catch (e) { /* not a chart */ }
        i++; if (spec) out.push({ t: 'chart', spec }); continue;
      }
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


  // ---------- client brand: a template's colors, fonts and logo replace the platform design ----------
  // The brand is applied for the length of one build and then put back, so the next document starts clean.
  const lum = (h) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mixHex = (a, b, t) => [0, 2, 4].map((i) => { const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16); return Math.round(x + (y - x) * t).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  const farFrom = (c, others, d) => others.every((o) => { const x = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)), y = [0, 2, 4].map((i) => parseInt(o.slice(i, i + 2), 16)); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) > (d || 70); });
  const legible = (h, min) => { let c = String(h).toUpperCase(); for (let i = 0; i < 30 && contrast(c, 'FFFFFF') < min; i++) c = mixHex(c, '000000', 0.12); return c; };
  // The color tokens a document draws with, from a brand. Light brand colors are darkened until text and fills stay readable.
  function brandTokens(b) {
    const c = (b && b.colors) || {};
    const ok = (v, d) => (/^[0-9A-Fa-f]{6}$/.test(v || '') ? v.toUpperCase() : d);
    const primary = legible(ok(c.primary, T0.primary), 3);
    const secondary = ok(c.secondary, T0.gSum), accent = ok(c.accent, T0.c3);
    const text = legible(ok(c.text, T0.text), 7), muted = legible(ok(c.muted, T0.muted), 4.5);
    const onPrimary = contrast(primary, 'FFFFFF') >= contrast(primary, text) ? 'FFFFFF' : text;
    const c1 = primary, c2 = farFrom(secondary, [c1]) ? secondary : T0.c2, c3 = farFrom(accent, [c1, c2]) ? accent : T0.c3;
    return {
      primary, primary600: mixHex(primary, '000000', 0.2), primarySoft: mixHex(primary, 'FFFFFF', 0.9), onPrimary, text, muted, faint: muted,
      border: mixHex(text, 'FFFFFF', 0.88), borderStrong: mixHex(text, 'FFFFFF', 0.78), surface2: mixHex(primary, 'FFFFFF', 0.96), track: mixHex(text, 'FFFFFF', 0.9),
      gSum: legible(secondary, 4.5), c1, c2, c3,
    };
  }
  const T0 = { ...T };
  function applyBrand(brand) {
    const saved = { T: { ...T }, tone: { ...TONE }, soft: { ...SOFT }, name: FONT_NAME, head: ex.HEAD_FONT, font: FONT };
    const tk = brandTokens(brand);
    Object.assign(T, tk);
    TONE.info = T.primary; TONE.idle = T.faint; SOFT.info = T.primarySoft; SOFT.idle = T.surface2;
    const f = brand.fonts || {};
    FONT_NAME = f.body || FONT_NAME;
    ex.FONT_NAME = FONT_NAME; ex.HEAD_FONT = f.heading || FONT_NAME;
    FONT = `"${FONT_NAME}",${BASE_FONT}`;
    return () => { Object.assign(T, saved.T); Object.assign(TONE, saved.tone); Object.assign(SOFT, saved.soft); FONT_NAME = saved.name; ex.FONT_NAME = saved.name; ex.HEAD_FONT = saved.head; FONT = saved.font; };
  }
  // Any image the browser can draw becomes a PNG the Word, PowerPoint and Excel libraries accept.
  async function brandLogo(logo) {
    if (!logo || !logo.dataUrl) return null;
    const img = new Image();
    img.src = logo.dataUrl;
    try { await img.decode(); } catch (e) { return null; }
    const nw = img.naturalWidth || logo.w || 300, nh = img.naturalHeight || logo.h || 100;
    const k = Math.min(1, 900 / Math.max(nw, nh)), w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), w, h } : null;
  }

  // ---------- page layout: logo position, header and footer text ----------
  // A document with no saved layout looks as it always did. {{page}} and {{pages}} are filled by the file itself.
  const DEFAULT_LAYOUT = {
    v: 1, logo: { cover: 'left', header: 'left' },
    header: { left: '', center: '', right: '{{project}}\n{{client}}' },
    footer: { left: '{{title}}  \u00b7  {{date}}', center: '', right: 'Page {{page}} of {{pages}}' },
  };
  const LAYOUT_TOKENS = ['project', 'client', 'title', 'date', 'code', 'pm', 'page', 'pages'];
  function layoutOf(g) {
    const l = g && g.layout;
    if (!l || typeof l !== 'object') return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    const part = (o, d) => ({ left: o && typeof o.left === 'string' ? o.left : d.left, center: o && typeof o.center === 'string' ? o.center : d.center, right: o && typeof o.right === 'string' ? o.right : d.right });
    const pos = (v, d) => (['left', 'center', 'right', 'hidden'].includes(v) ? v : d);
    const li = l.logoImg && typeof l.logoImg.dataUrl === 'string' && /^data:image\/(png|jpeg|gif|svg\+xml);base64,/.test(l.logoImg.dataUrl) ? { logoImg: { dataUrl: l.logoImg.dataUrl, w: Number(l.logoImg.w) || 0, h: Number(l.logoImg.h) || 0 } } : {};
    return { v: 1, logo: { cover: pos(l.logo && l.logo.cover, 'left'), header: pos(l.logo && l.logo.header, 'left') }, header: part(l.header, DEFAULT_LAYOUT.header), footer: part(l.footer, DEFAULT_LAYOUT.footer), ...li };
  }
  // Fills every token except page and pages.
  function fillTokens(text, plan) {
    const m = plan.meta || {};
    const map = { project: m.project || '', client: m.client || '', title: plan.title || '', date: plan.date || '', code: m.code || '', pm: m.pm || '' };
    return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => (k in map ? map[k] : all));
  }
  // The same text with page numbers resolved, for formats with no page fields.
  const fillPlain = (text, plan, page, pages) => fillTokens(text, plan).replace(/\{\{\s*page\s*\}\}/g, page == null ? '' : String(page)).replace(/\{\{\s*pages\s*\}\}/g, pages == null ? '' : String(pages));

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
  function planLayout(g) {
    const l = layoutOf(g);
    if (g.brand && !g.brand.logo && !l.logoImg) { l.logo.cover = 'hidden'; l.logo.header = 'hidden'; }
    return l;
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
    return { brand: g.brand || null, brandName: g.brand ? (g.template || 'Client template') : 'Project Manager AI', layout: planLayout(g), title: g.title || (def && def.title) || 'Document', typeTitle: g.custom ? 'Custom document' : (def && def.title) || '', meta, date: fmtDate(meta.date), kpis: (V && V.kpis) || [], sections: all, onepager: def && def.oneSlide && !g.custom && V ? V.onepager || null : null, oneSlide: !!(def && def.oneSlide && !g.custom) };
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

  // ---------- charts the project manager builds from a table ----------
  const CHART_NAMES = { column: 'Column', bar: 'Bar', line: 'Line', pie: 'Pie' };
  const fmtN = (v) => { const a = Math.abs(v); if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`; if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}K`; return String(Math.round(v * 100) / 100); };
  function chartSpec(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.labels) || !Array.isArray(o.series)) return null;
    const ctype = CHART_NAMES[o.ctype] ? o.ctype : 'column';
    const labels = o.labels.slice(0, 24).map((x) => String(x == null ? '' : x).slice(0, 80));
    const series = o.series.slice(0, 6).map((se, i) => ({ name: String((se && se.name) || `Series ${i + 1}`).slice(0, 60), values: labels.map((_, k) => { const v = Number(se && se.values && se.values[k]); return Number.isFinite(v) ? v : 0; }) })).filter((se) => se.values.length);
    if (!labels.length || !series.length) return null;
    const title = String(o.title || '').slice(0, 120) || 'Chart';
    const alt = `${CHART_NAMES[ctype]} chart, ${title}. ${labels.map((l, k) => `${l}: ${series.map((se) => `${series.length > 1 ? se.name + ' ' : ''}${fmtN(se.values[k])}`).join(', ')}`).join('. ')}.`;
    return { id: 'uchart', kind: 'uchart', ctype, title, alt, labels, series };
  }
  const chartCols = () => [T.primary, T.c2, T.c3, T.c4, T.violet, T.faint];
  function legendRow(g, series, cols) {
    let x = 0;
    series.forEach((se, i) => {
      g.fillStyle = hex(cols[i % cols.length]); rrect(g, x, 8, 10, 10, 3); g.fill();
      g.fillStyle = hex(T.muted); g.font = font(400, 12); g.textAlign = 'left'; g.fillText(fit(g, se.name, 150), x + 16, 13);
      x += 16 + Math.min(150, g.measureText(se.name).width) + 22;
    });
  }
  function drawColLine(s, line) {
    const many = s.series.length > 1, H = 300, padL = 58, padR = 12, padT = many ? 40 : 20, padB = 64;
    const cv = canvas(W, H), g = cv.g;
    const all = s.series.flatMap((se) => se.values), mx = Math.max(0, ...all), mn = Math.min(0, ...all);
    const hi = mx > 0 ? niceMax(mx) : 0, lo = mn < 0 ? -niceMax(-mn) : 0, span = (hi - lo) || 1;
    const plotH = H - padT - padB, plotW = W - padL - padR, cols = chartCols();
    const yOf = (v) => padT + plotH * (1 - (v - lo) / span);
    g.font = font(400, 11); g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const v = lo + (span * k) / 4, y = yOf(v);
      g.strokeStyle = hex(T.border); g.lineWidth = 1; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillStyle = hex(T.faint); g.fillText(fmtN(v), padL - 8, y);
    }
    if (many) legendRow(g, s.series, cols);
    const n = s.labels.length, slot = plotW / n, showVal = n * s.series.length <= 14;
    if (!line) {
      const gw = Math.min(slot * 0.74, s.series.length * 46), bw = gw / s.series.length, zero = yOf(0);
      s.series.forEach((se, si) => se.values.forEach((v, i) => {
        const x = padL + slot * i + (slot - gw) / 2 + si * bw, y = yOf(v), top = Math.min(y, zero), h = Math.max(Math.abs(zero - y), 2);
        g.fillStyle = hex(cols[si % cols.length]); rrect(g, x + 1, top, Math.max(bw - 2, 3), h, 3); g.fill();
        if (showVal) { g.fillStyle = hex(T.text); g.font = font(600, 11); g.textAlign = 'center'; g.fillText(fmtN(v), x + bw / 2, v >= 0 ? top - 9 : top + h + 10); }
      }));
    } else {
      s.series.forEach((se, si) => {
        g.strokeStyle = hex(cols[si % cols.length]); g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
        se.values.forEach((v, i) => { const x = padL + slot * i + slot / 2, y = yOf(v); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
        se.values.forEach((v, i) => {
          const x = padL + slot * i + slot / 2, y = yOf(v);
          g.fillStyle = hex(T.surface); g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = hex(cols[si % cols.length]); g.lineWidth = 2.5; g.stroke();
          if (n <= 10 && !many) { g.fillStyle = hex(T.text); g.font = font(600, 11); g.textAlign = 'center'; g.fillText(fmtN(v), x, y - 14); }
        });
      });
    }
    g.fillStyle = hex(T.text); g.font = font(400, 11); g.textAlign = 'center';
    s.labels.forEach((lab, i) => wrap(g, lab, slot - 6, 2).forEach((ln, k) => g.fillText(ln, padL + slot * i + slot / 2, padT + plotH + 16 + k * 14)));
    return cv;
  }
  function drawBarsH(s) {
    const many = s.series.length > 1, cols = chartCols();
    const rowH = many ? s.series.length * 15 + 18 : 32, top = many ? 30 : 6, labW = 176, valW = 56;
    const H = top + s.labels.length * rowH + 6;
    const cv = canvas(W, H), g = cv.g;
    if (many) legendRow(g, s.series, cols);
    const barX = labW, barW = W - labW - valW;
    const max = niceMax(Math.max(1, ...s.series.flatMap((se) => se.values.map((v) => Math.max(v, 0)))));
    s.labels.forEach((lab, i) => {
      const y = top + i * rowH;
      g.fillStyle = hex(T.text); g.font = font(400, 12); g.textAlign = 'left'; g.fillText(fit(g, lab, labW - 14), 0, y + rowH / 2);
      const bh = many ? 11 : 14, gap = 4;
      let by = y + (rowH - (s.series.length * bh + (s.series.length - 1) * gap)) / 2;
      s.series.forEach((se, si) => {
        const v = se.values[i];
        g.fillStyle = hex(T.track); rrect(g, barX, by, barW, bh, 4); g.fill();
        if (v > 0) { g.fillStyle = hex(cols[si % cols.length]); rrect(g, barX, by, Math.max(8, (barW * Math.min(v, max)) / max), bh, 4); g.fill(); }
        g.fillStyle = hex(T.text); g.font = font(600, 11); g.textAlign = 'right'; g.fillText(fmtN(v), W - 4, by + bh / 2);
        by += bh + gap;
      });
    });
    return cv;
  }
  function drawPie(s) {
    const cols = chartCols(), vals = s.series[0].values.map((v) => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const n = s.labels.length, H = Math.max(230, 40 + n * 30), cx = 130, cy = H / 2, R = 92;
    const cv = canvas(W, H), g = cv.g;
    let a0 = -Math.PI / 2;
    const gap = vals.filter((v) => v > 0).length > 1 ? 0.035 : 0;
    vals.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2; if (!v) return;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0 + gap / 2, a0 + sweep - gap / 2); g.closePath();
      g.fillStyle = hex(cols[i % cols.length]); g.fill(); a0 += sweep;
    });
    const rowH = 28, y0 = cy - (n * rowH) / 2 + rowH / 2;
    s.labels.forEach((lab, i) => {
      const y = y0 + i * rowH;
      g.fillStyle = hex(cols[i % cols.length]); rrect(g, 270, y - 6, 12, 12, 3); g.fill();
      g.fillStyle = hex(T.text); g.font = font(400, 13); g.textAlign = 'left'; g.fillText(fit(g, lab, 230), 292, y);
      g.font = font(600, 13); g.textAlign = 'right'; g.fillText(fmtN(s.series[0].values[i]), 570, y);
      g.fillStyle = hex(T.muted); g.font = font(400, 12); g.fillText(`${Math.round((vals[i] / total) * 100)}%`, W - 4, y);
    });
    return cv;
  }
  const drawUChart = (s) => (s.ctype === 'pie' ? drawPie(s) : s.ctype === 'bar' ? drawBarsH(s) : drawColLine(s, s.ctype === 'line'));
  // A picture of a chart for the editor, drawn with the document's own colors
  function chartPreview(spec, brand) {
    const sp = chartSpec(spec); if (!sp) return '';
    const restore = brand ? applyBrand(brand) : null;
    try { return drawUChart(sp).c.toDataURL('image/png'); } finally { if (restore) restore(); }
  }

  const DRAW = { hbar: drawHBar, column: drawColumn, donut: drawDonut, stack: drawStack, gantt: drawGantt, flow: drawFlow, uchart: drawUChart };
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
    if (s.kind === 'uchart') return { head: ['Item', ...s.series.map((x) => x.name)], rows: s.labels.map((l, i) => [l, ...s.series.map((x) => x.values[i])]) };
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
  const ex = { HEAD_FONT: FONT_NAME, brandTokens, brandLogo, contrast, legible, applyBrand, DEFAULT_LAYOUT, LAYOUT_TOKENS, layoutOf, fillTokens, fillPlain, T, TONE, SOFT, FONT_NAME, FORMATS, STATUS, tone, statusTone, fmtDate, safeName, money, inlineRuns, plain, parseMarkdown, plan, specsFor, specTable, chartSpec, chartPreview, heatTone, renderSpec, asset, b64, builders: {} };

  async function build(g) {
    const fmt = FORMATS[g.format] ? g.format : 'docx';
    for (const src of LIBS[fmt]) await loadScript(src);
    const brand = g.brand || null;
    const restore = brand ? applyBrand(brand) : null;
    try {
      const P = plan(g);
      let logo, mark, client;
      if (brand) {
        const bl = await brandLogo(brand.logo);
        logo = bl; mark = bl; client = bl ? null : await clientLogo(g.meta);
      } else [logo, mark, client] = await Promise.all([asset('brand/full-light.png'), asset('brand/mark-512.png'), clientLogo(g.meta)]);
      const lg = P.layout && P.layout.logoImg ? await brandLogo(P.layout.logoImg) : null;
      if (lg) { logo = lg; mark = lg; client = null; }
      const blob = await ex.builders[fmt]({ plan: P, logo, mark, client });
      return { blob, filename: `${safeName(g.title)}.${FORMATS[fmt].ext}`, format: fmt };
    } finally { if (restore) restore(); }
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
