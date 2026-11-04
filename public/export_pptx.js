/* PowerPoint builder for generated documents. Needs vendor/pptxgen.bundle.js and export.js.
   Charts are native PowerPoint charts and the tiles, heat map, timeline and flow are native shapes, so everything can be edited.
   Slide size is 16:9 (13.33 by 7.5 inches). Every main heading starts on a new slide. */
(function () {
  'use strict';
  const X = window.PM.exporter, T = X.T;
  const SW = 13.333, SH = 7.5, MX = 0.55, CWI = SW - 2 * MX; // slide width and height, side margin, content width
  const TOP = 1.9, BOTTOM = 6.85;                            // content area
  const F = X.FONT_NAME;

  X.builders.pptx = async function ({ plan, logo, mark, client }) {
    const meta = plan.meta;
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Project Manager AI'; pptx.company = 'Project Manager AI'; pptx.title = plan.title; pptx.subject = `${plan.typeTitle} for ${meta.project || ''}`.trim();
    const png = (im) => 'image/png;base64,' + X.b64(im.data);
    const SH_ = pptx.ShapeType;
    const lh = (w, im) => (w * im.h) / im.w;

    // ----- masters -----
    pptx.defineSlideMaster({
      title: 'CONTENT', background: { color: T.surface },
      objects: [
        { image: { x: MX, y: 0.28, w: 1.8, h: lh(1.8, logo), data: png(logo) } },
        { text: { text: meta.project || '', options: { x: SW - MX - 6, y: 0.2, w: 6, h: 0.3, align: 'right', valign: 'middle', fontFace: F, fontSize: 11, bold: true, color: T.text, margin: 0 } } },
        { text: { text: meta.client || '', options: { x: SW - MX - 6, y: 0.48, w: 6, h: 0.28, align: 'right', valign: 'middle', fontFace: F, fontSize: 10, color: T.muted, margin: 0 } } },
        { rect: { x: MX, y: 0.82, w: CWI, h: 0.012, fill: { color: T.border } } },
        { rect: { x: MX, y: 7.0, w: CWI, h: 0.012, fill: { color: T.border } } },
        { text: { text: `${plan.title}  ·  ${plan.date}`, options: { x: MX, y: 7.05, w: 9, h: 0.3, fontSize: 9, color: T.muted, fontFace: F, margin: 0 } } },
      ],
      slideNumber: { x: SW - MX - 0.8, y: 7.05, w: 0.8, h: 0.3, fontFace: F, fontSize: 9, color: T.muted, align: 'right' },
    });
    pptx.defineSlideMaster({ title: 'COVER', background: { color: T.surface }, objects: [] });

    // ----- cover slide -----
    {
      const s = pptx.addSlide({ masterName: 'COVER' });
      const px = 8.5;
      s.addShape(SH_.rect, { x: px, y: 0, w: SW - px, h: SH, fill: { color: T.primary }, line: { color: T.primary, width: 0 } });
      s.addShape(SH_.ellipse, { x: px + 2.6, y: -1.2, w: 3.6, h: 3.6, fill: { color: T.primary600, transparency: 55 }, line: { color: T.primary600, width: 0, transparency: 100 } });
      s.addShape(SH_.ellipse, { x: px - 1.3, y: 5.2, w: 3.2, h: 3.2, fill: { color: T.primary600, transparency: 55 }, line: { color: T.primary600, width: 0, transparency: 100 } });
      s.addShape(SH_.roundRect, { x: px + 1.35, y: 1.65, w: 2.4, h: 2.4, fill: { color: T.surface }, line: { color: T.surface, width: 0 }, rectRadius: 0.35 });
      s.addImage({ data: png(mark), x: px + 1.55, y: 1.85, w: 2.0, h: 2.0, altText: 'Project Manager AI mark' });
      if (client) {
        const bw = 3.4, bh = 1.0, bx = px + (SW - px - bw) / 2, by = 5.35;
        s.addShape(SH_.roundRect, { x: bx, y: by, w: bw, h: bh, fill: { color: T.surface }, line: { color: T.surface, width: 0 }, rectRadius: 0.15 });
        const r = Math.min((bw - 0.4) / client.w, (bh - 0.3) / client.h);
        s.addImage({ data: png(client), x: bx + (bw - client.w * r) / 2, y: by + (bh - client.h * r) / 2, w: client.w * r, h: client.h * r, altText: `${meta.client || 'Client'} logo` });
      }
      s.addImage({ data: png(logo), x: 0.7, y: 0.65, w: 2.7, h: lh(2.7, logo), altText: 'Project Manager AI logo' });
      s.addText(plan.typeTitle, { x: 0.7, y: 2.1, w: 7.3, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: T.primary, margin: 0 });
      s.addText(plan.title, { x: 0.7, y: 2.55, w: 7.3, h: 1.7, fontFace: F, fontSize: 38, bold: true, color: T.text, valign: 'top', margin: 0, fit: 'shrink' });
      s.addShape(SH_.rect, { x: 0.7, y: 4.4, w: 1.2, h: 0.07, fill: { color: T.primary }, line: { color: T.primary, width: 0 } });
      const facts = [['Client', meta.client], ['Project', meta.project], ['Project code', meta.code], ['Document date', plan.date], ['Prepared by', meta.pm]].filter((r) => r[1]);
      facts.forEach(([k, v], i) => {
        const y = 4.75 + i * 0.44;
        s.addText(k, { x: 0.7, y, w: 1.8, h: 0.36, fontFace: F, fontSize: 12, color: T.muted, valign: 'middle', margin: 0 });
        s.addText(String(v), { x: 2.5, y, w: 5.6, h: 0.36, fontFace: F, fontSize: 15, bold: true, color: T.text, valign: 'middle', margin: 0, fit: 'shrink' });
      });
    }

    // ----- shared pieces -----
    const slideTitle = (s, text) => {
      s.addText(text, { x: MX, y: 0.98, w: CWI, h: 0.6, fontFace: F, fontSize: 26, bold: true, color: T.text, valign: 'middle', margin: 0, fit: 'shrink' });
      s.addShape(SH_.rect, { x: MX, y: 1.62, w: 0.9, h: 0.06, fill: { color: T.primary }, line: { color: T.primary, width: 0 } });
    };
    const card = (s, x, y, w, h) => s.addShape(SH_.roundRect, { x, y, w, h, fill: { color: T.surface }, line: { color: T.border, width: 1 }, rectRadius: 0.1 });
    const colors = (arr) => arr.map((k) => X.tone(k));

    function kpiTiles(s, kpis, y, h) {
      const gap = 0.2, w = (CWI - gap * (kpis.length - 1)) / kpis.length;
      kpis.forEach((k, i) => {
        const x = MX + i * (w + gap), c = X.tone(k.tone);
        s.addShape(SH_.roundRect, { x, y, w, h, fill: { color: T.surface2 }, line: { color: T.border, width: 1 }, rectRadius: 0.08 });
        s.addShape(SH_.rect, { x: x + 0.02, y, w: w - 0.04, h: 0.07, fill: { color: c }, line: { color: c, width: 0 } });
        s.addText(k.label, { x: x + 0.2, y: y + 0.18, w: w - 0.4, h: 0.3, fontFace: F, fontSize: 12, color: T.muted, margin: 0 });
        s.addText(k.value, { x: x + 0.2, y: y + 0.48, w: w - 0.4, h: 0.55, fontFace: F, fontSize: 28, bold: true, color: k.tone === 'info' || k.tone === 'idle' ? T.text : c, margin: 0, valign: 'middle', fit: 'shrink' });
        s.addText(k.hint || '', { x: x + 0.2, y: y + h - 0.4, w: w - 0.4, h: 0.28, fontFace: F, fontSize: 11, color: T.muted, margin: 0 });
      });
    }

    // Height each visual needs, in inches
    const visualH = (sp) => {
      if (sp.kind === 'hbar') return Math.min(4.6, 0.95 + sp.labels.length * (sp.series.length > 1 ? 0.55 : 0.42));
      if (sp.kind === 'column') return 3.5;
      if (sp.kind === 'donut') return 3.0;
      if (sp.kind === 'stack') return 1.9;
      if (sp.kind === 'gantt') return Math.min(4.7, 1.3 + (sp.rows.length + (sp.marks.length ? 1 : 0)) * 0.42);
      if (sp.kind === 'heat') return 3.0;
      if (sp.kind === 'flow') return 2.1;
      return 2;
    };

    // ----- visuals -----
    function drawVisual(s, sp, x, y, w, h, withTitle) {
      if (withTitle) card(s, x, y, w, h);
      if (withTitle) s.addText(sp.title, { x: x + 0.2, y: y + 0.1, w: w - 0.4, h: 0.36, fontFace: F, fontSize: 14, bold: true, color: T.text, margin: 0 });
      const cx = x + 0.15, cy = y + (withTitle ? 0.5 : 0), cw = w - 0.3, ch = h - (withTitle ? 0.6 : 0.1);
      const base = { x: cx, y: cy, w: cw, h: ch, altText: sp.alt, catAxisLabelFontFace: F, catAxisLabelFontSize: 11, catAxisLabelColor: T.text, valAxisLabelFontFace: F, valAxisLabelFontSize: 10, valAxisLabelColor: T.faint, dataLabelFontFace: F, dataLabelFontSize: 11, dataLabelColor: T.text, legendFontFace: F, legendFontSize: 11, legendColor: T.muted, valGridLine: { color: T.border, size: 0.75 }, catGridLine: { style: 'none' } };
      if (sp.kind === 'hbar') {
        const many = sp.series.length > 1;
        const data = sp.series.map((se) => ({ name: se.name, labels: sp.labels, values: se.values.map((v) => v || 0) }));
        const cols = sp.tones ? colors(sp.tones) : colors(sp.series.map((se) => se.tone));
        const fmt = sp.unit === '%' ? '0"%"' : sp.unit ? `0"${sp.unit}"` : '0';
        s.addChart(pptx.charts.BAR, data, { ...base, barDir: 'bar', barGapWidthPct: 60, chartColors: cols, showLegend: many, legendPos: 't', showValue: true, dataLabelFormatCode: fmt, dataLabelPosition: 'outEnd', catAxisOrientation: 'maxMin', valAxisMinVal: 0, valAxisMaxVal: sp.max || undefined, valAxisLabelFormatCode: fmt, valAxisHidden: true, valGridLine: { style: 'none' } });
      } else if (sp.kind === 'column') {
        s.addChart(pptx.charts.BAR, [{ name: 'Amount', labels: sp.labels, values: sp.values }], { ...base, barDir: 'col', barGapWidthPct: 60, chartColors: colors(sp.tones), showLegend: false, showValue: true, dataLabelFormatCode: '#,##0', valAxisLabelFormatCode: '#,##0', valAxisMinVal: 0 });
        // the bar colors carry the payment status, so show the key
        const keys = [['ok', 'Paid'], ['info', 'Invoiced'], ['idle', 'Pending']].filter((k) => sp.tones.includes(k[0]));
        keys.forEach((k, i) => {
          s.addShape(SH_.roundRect, { x: x + w - 0.2 - (keys.length - i) * 1.1, y: y + 0.2, w: 0.14, h: 0.14, fill: { color: X.tone(k[0]) }, line: { color: X.tone(k[0]), width: 0 }, rectRadius: 0.03 });
          s.addText(k[1], { x: x + w - 0.2 - (keys.length - i) * 1.1 + 0.2, y: y + 0.12, w: 0.85, h: 0.3, fontFace: F, fontSize: 11, color: T.muted, margin: 0 });
        });
      } else if (sp.kind === 'donut') {
        const data = [{ name: sp.title, labels: sp.parts.map((p) => p.label), values: sp.parts.map((p) => p.n) }];
        s.addChart(pptx.charts.DOUGHNUT, data, { ...base, holeSize: 62, chartColors: colors(sp.parts.map((p) => p.tone)), showLegend: true, legendPos: 'r', showPercent: false, showValue: true, dataLabelColor: T.onPrimary, dataLabelFontBold: true, dataBorder: { pt: 2, color: T.surface } });
        s.addText([{ text: sp.center.value, options: { fontSize: 28, bold: true, color: T.text, breakLine: true } }, { text: sp.center.label, options: { fontSize: 11, color: T.muted } }], { x: cx, y: cy, w: cw * 0.62, h: ch, align: 'center', valign: 'middle', fontFace: F, margin: 0 });
      } else if (sp.kind === 'stack') {
        const data = sp.parts.map((p) => ({ name: p.label, labels: ['Payments'], values: [p.n] }));
        s.addChart(pptx.charts.BAR, data, { ...base, barDir: 'bar', barGrouping: 'percentStacked', barGapWidthPct: 40, chartColors: colors(sp.parts.map((p) => p.tone)), showLegend: true, legendPos: 'b', showValue: true, dataLabelFormatCode: '#,##0', dataLabelColor: T.onPrimary, catAxisHidden: true, valAxisHidden: true, valGridLine: { style: 'none' } });
      } else if (sp.kind === 'heat') {
        const lw = 2.6, cwid = (cw - lw) / 3, rh = (ch - 0.5) / 3;
        ['Probability or impact', ...sp.colLabels].forEach((t, i) => {
          const hx = i ? cx + lw + (i - 1) * cwid : cx, hw = i ? cwid : lw;
          s.addShape(SH_.rect, { x: hx + 0.02, y: cy, w: hw - 0.04, h: 0.42, fill: { color: T.primary }, line: { color: T.primary, width: 0 } });
          s.addText(t, { x: hx + 0.02, y: cy, w: hw - 0.04, h: 0.42, fontFace: F, fontSize: 12, bold: true, color: T.onPrimary, align: i ? 'center' : 'left', valign: 'middle', margin: [0, 0.1, 0, 0.1] });
        });
        sp.rowLabels.forEach((lab, ri) => {
          const ry = cy + 0.5 + ri * rh;
          s.addShape(SH_.rect, { x: cx + 0.02, y: ry + 0.02, w: lw - 0.04, h: rh - 0.04, fill: { color: T.surface2 }, line: { color: T.surface2, width: 0 } });
          s.addText(`${lab} probability`, { x: cx + 0.02, y: ry, w: lw - 0.04, h: rh, fontFace: F, fontSize: 12, bold: true, color: T.text, valign: 'middle', margin: [0, 0.1, 0, 0.1] });
          sp.matrix[ri].forEach((n, ci) => {
            const tn = X.heatTone(ri, ci), hx = cx + lw + ci * cwid;
            s.addShape(SH_.rect, { x: hx + 0.02, y: ry + 0.02, w: cwid - 0.04, h: rh - 0.04, fill: { color: X.SOFT[tn] }, line: { color: X.SOFT[tn], width: 0 } });
            s.addText(String(n), { x: hx + 0.02, y: ry, w: cwid - 0.04, h: rh, fontFace: F, fontSize: 24, bold: true, color: n ? X.tone(tn) : T.faint, align: 'center', valign: 'middle', margin: 0 });
          });
        });
      } else if (sp.kind === 'gantt') {
        const rows = sp.rows.slice(0, 8), dn = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
        const dates = rows.flatMap((r) => [r.start, r.finish]).concat(sp.marks.map((m) => m.date)).concat(sp.today ? [sp.today] : []).filter(Boolean).map(dn);
        const lo = Math.min(...dates); let hi = Math.max(...dates); if (hi - lo < 14) hi = lo + 14;
        const lw = 2.6, bx = cx + lw, bw = cw - lw - 0.1, rh = 0.42, ay = cy + 0.1, X_ = (d) => bx + ((dn(d) - lo) / (hi - lo)) * bw;
        const months = Math.max(1, (hi - lo) / 30.4), step = months > 30 ? 6 : months > 14 ? 3 : 1;
        let cur = new Date(lo * 86400000); cur = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1);
        let lastEnd = -1;
        for (let k = 0; k < 80; k++) {
          const day = cur / 86400000; if (day > hi) break;
          if (day >= lo - 1) {
            const gx = bx + ((day - lo) / (hi - lo)) * bw, d = new Date(cur);
            s.addShape(SH_.line, { x: gx, y: ay + 0.3, w: 0, h: rows.length * rh + (sp.marks.length ? rh : 0) + 0.05, line: { color: T.border, width: 0.75 } });
            if (gx > lastEnd && gx + 0.75 < bx + bw + 0.2) { s.addText(d.toLocaleDateString('en-US', { month: 'short', year: d.getUTCMonth() === 0 || lastEnd < 0 ? 'numeric' : undefined, timeZone: 'UTC' }), { x: gx + 0.03, y: ay, w: 0.9, h: 0.25, fontFace: F, fontSize: 10, color: T.faint, margin: 0 }); lastEnd = gx + 0.75; }
          }
          const dd = new Date(cur); cur = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + step, 1);
        }
        rows.forEach((r, i) => {
          const ry = ay + 0.35 + i * rh, x1 = X_(r.start), x2 = Math.max(X_(r.finish), x1 + 0.1), late = sp.today && r.finish < sp.today && r.actual < 100, c = late ? T.danger : T.c1;
          s.addText(r.name, { x: cx, y: ry, w: lw - 0.1, h: rh, fontFace: F, fontSize: 11, color: T.text, valign: 'middle', margin: 0, fit: 'shrink' });
          s.addShape(SH_.roundRect, { x: x1, y: ry + 0.1, w: x2 - x1, h: 0.22, fill: { color: T.primarySoft }, line: { color: c, width: 0.75 }, rectRadius: 0.05 });
          const pw = Math.max(0.1, ((x2 - x1) * Math.min(r.actual, 100)) / 100);
          if (r.actual > 0) s.addShape(SH_.roundRect, { x: x1, y: ry + 0.1, w: pw, h: 0.22, fill: { color: c }, line: { color: c, width: 0 }, rectRadius: 0.05 });
        });
        let yEnd = ay + 0.35 + rows.length * rh;
        if (sp.marks.length) {
          s.addText('Payment dates', { x: cx, y: yEnd, w: lw - 0.1, h: rh, fontFace: F, fontSize: 11, color: T.text, valign: 'middle', margin: 0 });
          sp.marks.forEach((m) => s.addShape(SH_.diamond, { x: X_(m.date) - 0.09, y: yEnd + 0.12, w: 0.18, h: 0.18, fill: { color: T.violet }, line: { color: T.violet, width: 0 } }));
          yEnd += rh;
        }
        if (sp.today && dn(sp.today) >= lo && dn(sp.today) <= hi) {
          const tx = X_(sp.today);
          s.addShape(SH_.line, { x: tx, y: ay + 0.28, w: 0, h: yEnd - ay - 0.25, line: { color: T.gToday, width: 2 } });
          s.addText('Today', { x: tx - 0.4, y: yEnd + 0.03, w: 0.8, h: 0.25, fontFace: F, fontSize: 10, bold: true, color: T.danger, align: 'center', margin: 0 });
        }
      } else if (sp.kind === 'flow') {
        const n = sp.steps.length, gap = 0.45, bw = (cw - gap * (n - 1)) / n, bh = Math.min(1.4, ch - 0.1);
        sp.steps.forEach((st, i) => {
          const bx = cx + i * (bw + gap), first = i === 0;
          s.addShape(SH_.roundRect, { x: bx, y: cy + 0.05, w: bw, h: bh, fill: { color: first ? T.primary : T.surface2 }, line: { color: first ? T.primary : T.border, width: 1 }, rectRadius: 0.12 });
          s.addText([{ text: st.title, options: { fontSize: 14, bold: true, color: first ? T.onPrimary : T.text, breakLine: true } }, { text: st.sub, options: { fontSize: 11, color: first ? T.onPrimary : T.muted } }], { x: bx + 0.1, y: cy + 0.05, w: bw - 0.2, h: bh, align: 'center', valign: 'middle', fontFace: F, margin: 0, fit: 'shrink' });
          if (i < n - 1) s.addShape(SH_.rightArrow, { x: bx + bw + 0.08, y: cy + 0.05 + bh / 2 - 0.14, w: gap - 0.16, h: 0.28, fill: { color: T.faint }, line: { color: T.faint, width: 0 } });
        });
      }
    }

    // ----- text and tables, with estimated heights for page breaks -----
    const LINE = 0.27;
    const textH = (len, perLine) => Math.max(1, Math.ceil(len / perLine)) * LINE;
    function tableModel(b) {
      const wts = b.head.map((h, c) => Math.min(Math.max(X.plain(h).length, ...b.rows.map((r) => X.plain(r[c] || []).length), 8), 40));
      const tot = wts.reduce((a, v) => a + v, 0);
      const colW = wts.map((w) => Math.max(0.9, (CWI * w) / tot));
      colW[colW.indexOf(Math.max(...colW))] += CWI - colW.reduce((a, v) => a + v, 0);
      const rowH = (r) => Math.max(0.36, Math.max(...b.head.map((_, c) => Math.ceil(X.plain(r[c] || []).length / Math.max(6, colW[c] * 10.5)) * 0.2 + 0.2)));
      return { colW, rowH };
    }
    const cellOf = (rs, o) => {
      const st = o.header ? null : X.statusTone(X.plain(rs || []));
      const opt = { fontFace: F, fontSize: 11, color: o.header ? T.onPrimary : st ? X.tone(st) : T.text, bold: o.header || !!st, fill: { color: o.header ? T.primary : st ? X.SOFT[st] : o.zebra ? T.surface2 : T.surface }, valign: 'middle' };
      return { text: rs && rs.length ? rs.map((r) => ({ text: r.text, options: { bold: r.bold || opt.bold, italic: r.italic } })) : ' ', options: opt };
    };
    function addTable(s, b, rows, y, model, header) {
      const body = rows.map((r, i) => b.head.map((_, c) => cellOf(r[c], { zebra: i % 2 === 1 })));
      s.addTable([b.head.map((h, c) => cellOf(h, { header: true })), ...body], { x: MX, y, w: CWI, colW: model.colW, border: { type: 'solid', pt: 0.75, color: T.border }, margin: [0.04, 0.1, 0.04, 0.1], autoPage: false });
    }

    // ----- sections -----
    const sectionSlide = (title, cont) => { const s = pptx.addSlide({ masterName: 'CONTENT' }); slideTitle(s, cont ? `${title} (continued)` : title); return s; };

    for (const sec of plan.sections) {
      if (sec.glance) {
        const s = sectionSlide(sec.heading);
        if (plan.kpis.length) kpiTiles(s, plan.kpis, TOP, 1.35);
        const ph = sec.specs.find((x) => x.id === 'phases'), st = sec.specs.find((x) => x.id === 'status');
        const y = TOP + 1.35 + 0.25, h = BOTTOM - y;
        if (ph && st) { drawVisual(s, ph, MX, y, 7.0, h, true); drawVisual(s, st, MX + 7.2, y, CWI - 7.2, h, true); }
        else if (ph || st) drawVisual(s, ph || st, MX, y, CWI, h, true);
        continue;
      }
      let s = sectionSlide(sec.heading), y = TOP, first = true;
      const next = () => { s = sectionSlide(sec.heading, true); y = TOP; first = false; };
      const room = (h) => y + h <= BOTTOM + 0.001;
      for (const sp of sec.specs) {
        const h = Math.min(visualH(sp), BOTTOM - TOP);
        if (!room(h)) next();
        drawVisual(s, sp, MX, y, CWI, h, true);
        y += h + 0.2;
      }
      for (const b of sec.blocks) {
        if (b.t === 'h2' || b.t === 'h3') {
          if (!room(0.9)) next();
          s.addText(X.plain(b.runs), { x: MX, y, w: CWI, h: 0.4, fontFace: F, fontSize: b.t === 'h2' ? 18 : 15, bold: true, color: b.t === 'h2' ? T.text : T.muted, margin: 0 });
          y += 0.5;
        } else if (b.t === 'p') {
          const h = textH(X.plain(b.runs).length, 115) + 0.12;
          if (!room(h)) next();
          s.addText(b.runs.map((r) => ({ text: r.text, options: { bold: r.bold, italic: r.italic } })), { x: MX, y, w: CWI, h, fontFace: F, fontSize: 14, color: T.text, valign: 'top', margin: 0, fit: 'shrink' });
          y += h + 0.1;
        } else if (b.t === 'ul' || b.t === 'ol') {
          const ih = (k) => textH(X.plain(b.items[k]).length, 108) + 0.08;
          let i = 0;
          while (i < b.items.length) {
            if (!room(ih(i))) next();
            let h = 0, take = 0;
            while (i + take < b.items.length && (take === 0 || y + h + ih(i + take) <= BOTTOM)) { h += ih(i + take); take++; }
            const runs = [];
            b.items.slice(i, i + take).forEach((it, n) => it.forEach((r, k) => runs.push({ text: r.text, options: { bold: r.bold, italic: r.italic, bullet: b.t === 'ol' ? { type: 'number', numberStartAt: i + 1 } : { code: '25CF' }, breakLine: k === it.length - 1, paraSpaceAfter: 6 } })));
            s.addText(runs, { x: MX, y, w: CWI, h, fontFace: F, fontSize: 14, color: T.text, valign: 'top', margin: 0 });
            y += h + 0.1; i += take;
            if (i < b.items.length) next();
          }
        } else if (b.t === 'table') {
          const model = tableModel(b);
          let i = 0;
          if (!room(0.34 + model.rowH(b.rows[0] || []) * Math.min(2, b.rows.length || 1))) next();
          do {
            let h = 0.36, take = 0;
            while (i + take < b.rows.length) { const rh = model.rowH(b.rows[i + take]); if (take > 0 && y + h + rh > BOTTOM) break; h += rh; take++; }
            addTable(s, b, b.rows.slice(i, i + take), y, model);
            y += h + 0.2; i += take;
            if (i < b.rows.length) next();
          } while (i < b.rows.length);
        }
      }
    }
    return pptx.write({ outputType: 'blob' });
  };
})();
