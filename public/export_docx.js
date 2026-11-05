/* Word builder for generated documents. Needs vendor/docx.min.js and export.js.
   Page: A4, 0.8 inch side margins. Every main heading starts on a new page. */
(function () {
  'use strict';
  const X = window.PM.exporter, T = X.T;
  const CW = 9602; // content width in twips

  X.builders.docx = async function ({ plan, logo, client }) {
    const D = window.docx;
    const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, HeadingLevel, Header, Footer, PageNumber, TabStopType, VerticalAlign, LevelFormat, TableLayoutType, LineRuleType } = D;
    const FONT = X.FONT_NAME, HEAD = X.HEAD_FONT || X.FONT_NAME;
    const ALT = plan.brandName || 'Project Manager AI';
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const line = (c, sz) => ({ style: BorderStyle.SINGLE, size: sz || 4, color: c });
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    const meta = plan.meta;
    const numConfigs = [];

    const tr = (text, o) => new TextRun({ text, font: FONT, ...o });
    const runs = (rs, o) => rs.map((r) => tr(r.text, { bold: r.bold || (o && o.bold), italics: r.italic, size: o && o.size, color: (o && o.color) || r.color }));
    const img = (im, width, alt, maxH) => new ImageRun({ type: 'png', data: im.data, transformation: (() => { const w = maxH ? Math.min(width, Math.round((maxH * im.w) / im.h)) : width; return { width: w, height: Math.round((w * im.h) / im.w) }; })(), altText: { title: alt, description: alt, name: alt.slice(0, 40) } });
    const spacer = (after) => new Paragraph({ spacing: { after: after == null ? 120 : after }, children: [] });
    const caption = (text) => new Paragraph({ keepNext: true, spacing: { before: 200, after: 80 }, children: [tr(text, { bold: true, size: 21, color: T.text })] });

    // ----- key figure tiles (a colored top edge carries the status, the text carries the meaning) -----
    function kpiTable(kpis) {
      const w = Math.floor(CW / kpis.length);
      return new Table({
        width: { size: CW, type: WidthType.DXA }, columnWidths: kpis.map(() => w), layout: TableLayoutType.FIXED, borders: noBorders,
        rows: [new TableRow({
          cantSplit: true,
          children: kpis.map((k) => new TableCell({
            width: { size: w, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: T.surface2, color: 'auto' }, margins: { top: 140, bottom: 140, left: 160, right: 120 },
            borders: { top: line(X.tone(k.tone), 24), left: line('FFFFFF', 48), right: line('FFFFFF', 48), bottom: none },
            children: [
              new Paragraph({ spacing: { after: 40 }, children: [tr(k.label, { size: 18, color: T.muted })] }),
              new Paragraph({ spacing: { after: 40 }, children: [tr(k.value, { size: 40, bold: true, color: k.tone === 'info' || k.tone === 'idle' ? T.text : X.tone(k.tone) })] }),
              new Paragraph({ children: [tr(k.hint || '', { size: 17, color: T.muted })] }),
            ],
          })),
        })],
      });
    }

    // ----- tables from Markdown -----
    function table(b) {
      const cols = b.head.length;
      const wts = b.head.map((h, c) => Math.min(Math.max(X.plain(h).length, ...b.rows.map((r) => X.plain(r[c] || []).length), 7), 42));
      const tot = wts.reduce((a, v) => a + v, 0);
      const widths = wts.map((w) => Math.max(1300, Math.round((CW * w) / tot)));
      widths[widths.indexOf(Math.max(...widths))] += CW - widths.reduce((a, v) => a + v, 0);
      const cell = (rs, c, o) => {
        const st = o.header ? null : X.statusTone(X.plain(rs || []));
        return new TableCell({
          width: { size: widths[c], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 70, bottom: 70, left: 100, right: 100 },
          shading: o.header ? { type: ShadingType.CLEAR, fill: T.primary, color: 'auto' } : st ? { type: ShadingType.CLEAR, fill: X.SOFT[st], color: 'auto' } : o.zebra ? { type: ShadingType.CLEAR, fill: T.surface2, color: 'auto' } : undefined,
          children: [new Paragraph({ spacing: { after: 0 }, children: rs && rs.length ? runs(rs, { size: 18, bold: o.header || !!st, color: o.header ? T.onPrimary : st ? X.tone(st) : T.text }) : [] })],
        });
      };
      return new Table({
        width: { size: CW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
        borders: { top: line(T.border), bottom: line(T.border), left: none, right: none, insideHorizontal: line(T.border), insideVertical: none },
        rows: [
          new TableRow({ tableHeader: true, cantSplit: true, children: b.head.map((h, c) => cell(h, c, { header: true })) }),
          ...b.rows.map((r, ri) => new TableRow({ cantSplit: true, children: Array.from({ length: cols }, (_, c) => cell(r[c], c, { zebra: ri % 2 === 1 })) })),
        ],
      });
    }

    // ----- risk heat map as a shaded table -----
    function heat(s) {
      const first = 2400, w = Math.floor((CW - first) / 3);
      const head = ['Probability or impact', ...s.colLabels];
      const hc = (txt, i) => new TableCell({ width: { size: i ? w : first, type: WidthType.DXA }, margins: { top: 90, bottom: 90, left: 100, right: 100 }, shading: { type: ShadingType.CLEAR, fill: T.primary, color: 'auto' }, children: [new Paragraph({ alignment: i ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 0 }, children: [tr(txt, { size: 18, bold: true, color: T.onPrimary })] })] });
      return new Table({
        width: { size: CW, type: WidthType.DXA }, columnWidths: [first, w, w, w], layout: TableLayoutType.FIXED,
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: line('FFFFFF', 24), insideVertical: line('FFFFFF', 24) },
        rows: [
          new TableRow({ children: head.map(hc) }),
          ...s.rowLabels.map((lab, ri) => new TableRow({
            cantSplit: true,
            children: [
              new TableCell({ width: { size: first, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 110, bottom: 110, left: 100, right: 100 }, shading: { type: ShadingType.CLEAR, fill: T.surface2, color: 'auto' }, children: [new Paragraph({ spacing: { after: 0 }, children: [tr(`${lab} probability`, { size: 18, bold: true, color: T.text })] })] }),
              ...s.matrix[ri].map((n, ci) => {
                const tn = X.heatTone(ri, ci);
                return new TableCell({ width: { size: w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 110, bottom: 110, left: 100, right: 100 }, shading: { type: ShadingType.CLEAR, fill: X.SOFT[tn], color: 'auto' }, children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [tr(String(n), { size: 28, bold: true, color: n ? X.tone(tn) : T.faint })] })] });
              }),
            ],
          })),
        ],
      });
    }

    async function visual(s) {
      const out = [caption(s.title)];
      if (s.kind === 'heat') { out.push(heat(s), spacer(160)); return out; }
      const im = await X.renderSpec(s);
      if (im) out.push(new Paragraph({ spacing: { after: 160, line: 240, lineRule: LineRuleType.AUTO }, keepLines: true, children: [img(im, 620, s.alt)] }));
      return out;
    }

    function block(b) {
      if (b.t === 'h2') return [new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [tr(X.plain(b.runs), { font: HEAD })] })];
      if (b.t === 'h3') return [new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [tr(X.plain(b.runs), { font: HEAD })] })];
      if (b.t === 'p') return [new Paragraph({ spacing: { after: 140 }, children: runs(b.runs) })];
      if (b.t === 'ul') return [...b.items.map((it) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 70 }, children: runs(it) })), spacer(80)];
      if (b.t === 'ol') {
        const ref = `num${numConfigs.length}`;
        numConfigs.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 320 } } } }] });
        return [...b.items.map((it) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 70 }, children: runs(it) })), spacer(80)];
      }
      if (b.t === 'table') return [table(b), spacer(200)];
      return [];
    }

    // ----- cover page -----
    const lay = plan.layout || X.DEFAULT_LAYOUT;
    const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
    const cover = [
      new Paragraph({ alignment: ALIGN[lay.logo.cover] || AlignmentType.LEFT, spacing: { after: 1700, line: 240, lineRule: LineRuleType.AUTO }, children: lay.logo.cover === 'hidden' ? [] : [img(logo, 240, ALT + ' logo', 90)] }),
      new Paragraph({ spacing: { after: 120 }, children: [tr(plan.typeTitle, { size: 24, bold: true, color: T.primary })] }),
      new Paragraph({ spacing: { after: 240, line: 240, lineRule: LineRuleType.AUTO }, children: [tr(plan.title, { size: 60, bold: true, color: T.text, font: HEAD })] }),
      new Paragraph({ spacing: { after: 560 }, indent: { right: 6800 }, border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: T.primary, space: 1 } }, children: [] }),
    ];
    if (client) cover.push(new Paragraph({ spacing: { after: 200, line: 240, lineRule: LineRuleType.AUTO }, children: [img(client, Math.min(180, Math.round((client.w / client.h) * 56)), `${meta.client || 'Client'} logo`)] }));
    const facts = [['Client', meta.client], ['Project', meta.project], ['Project code', meta.code], ['Document date', plan.date], ['Prepared for', meta.audience], ['Prepared by', meta.pm]].filter((r) => r[1]);
    cover.push(new Table({
      width: { size: CW, type: WidthType.DXA }, columnWidths: [2300, CW - 2300], layout: TableLayoutType.FIXED, borders: noBorders,
      rows: facts.map(([k, v]) => new TableRow({
        cantSplit: true,
        children: [
          new TableCell({ width: { size: 2300, type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 0, right: 100 }, children: [new Paragraph({ spacing: { after: 0 }, children: [tr(k, { size: 20, color: T.muted })] })] }),
          new TableCell({ width: { size: CW - 2300, type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 0, right: 0 }, children: [new Paragraph({ spacing: { after: 0 }, children: [tr(String(v), { size: 24, bold: true, color: T.text })] })] }),
        ],
      })),
    }));
    if (plan.kpis.length) cover.push(new Paragraph({ spacing: { before: 520, after: 100 }, children: [tr('Key figures', { size: 21, bold: true, color: T.text })] }), kpiTable(plan.kpis));

    // ----- sections, each on a new page -----
    const body = [];
    for (const s of plan.sections) {
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [tr(s.heading, { font: HEAD })] }));
      if (s.glance) body.push(new Paragraph({ spacing: { after: 120 }, children: [tr(`Key figures and charts as of ${plan.date}.`, { color: T.muted })] }));
      for (const sp of s.specs) body.push(...(await visual(sp)));
      for (const b of s.blocks) { if (b.t === 'chart') body.push(...(await visual(b.spec))); else body.push(...block(b)); }
    }

    // ----- header and footer, from the page layout -----
    // Text keeps its line breaks. {{page}} and {{pages}} become live page fields.
    const fieldRuns = (text, o) => {
      const out = [];
      String(text || '').split(/(\{\{\s*pages?\s*\}\})/).forEach((part) => {
        if (/^\{\{\s*page\s*\}\}$/.test(part)) out.push(new TextRun({ font: FONT, ...o, children: [PageNumber.CURRENT] }));
        else if (/^\{\{\s*pages\s*\}\}$/.test(part)) out.push(new TextRun({ font: FONT, ...o, children: [PageNumber.TOTAL_PAGES] }));
        else if (part) out.push(tr(part, o));
      });
      return out;
    };
    const lines = (text, al, o) => X.fillTokens(text, plan).split('\n').filter((x, i, a) => x.trim() || a.length === 1).map((ln) => new Paragraph({ alignment: al, spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: fieldRuns(ln, o) }));
    const hasHeader = lay.logo.header !== 'hidden' || ['left', 'center', 'right'].some((k) => lay.header[k].trim());
    // The middle column is narrow when it holds nothing, so left and right text get more room.
    const wide = (grp) => (lay[grp].center.trim() || (grp === 'header' && lay.logo.header === 'center') ? Math.floor(CW / 3) : Math.floor(CW * 0.45));
    const colW = (grp) => { const l = wide(grp); const r = l; return [l, CW - l - r, r]; };
    const headCell = (k, w) => {
      const kids = [];
      if (lay.logo.header === k) kids.push(new Paragraph({ alignment: ALIGN[k], spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [img(logo, 120, ALT + ' logo', 38)] }));
      kids.push(...lines(lay.header[k], ALIGN[k], { size: 18, color: T.text }));
      return new TableCell({ width: { size: w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { bottom: 100 }, children: kids.length ? kids : [new Paragraph({ children: [] })] });
    };
    const header = new Header({
      children: hasHeader ? [new Table({
        width: { size: CW, type: WidthType.DXA }, columnWidths: colW('header'), layout: TableLayoutType.FIXED,
        borders: { top: none, left: none, right: none, insideVertical: none, insideHorizontal: none, bottom: line(T.border, 6) },
        rows: [new TableRow({ children: [headCell('left', colW('header')[0]), headCell('center', colW('header')[1]), headCell('right', colW('header')[2])] })],
      })] : [new Paragraph({ children: [] })],
    });
    const hasFooter = ['left', 'center', 'right'].some((k) => lay.footer[k].trim());
    const footCell = (k, w) => new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 80 }, children: (() => { const l = lines(lay.footer[k], ALIGN[k], { size: 16, color: T.muted }); return l.length ? l : [new Paragraph({ children: [] })]; })() });
    const footer = new Footer({
      children: hasFooter ? [new Table({
        width: { size: CW, type: WidthType.DXA }, columnWidths: colW('footer'), layout: TableLayoutType.FIXED,
        borders: { top: line(T.border, 4), left: none, right: none, bottom: none, insideVertical: none, insideHorizontal: none },
        rows: [new TableRow({ children: [footCell('left', colW('footer')[0]), footCell('center', colW('footer')[1]), footCell('right', colW('footer')[2])] })],
      })] : [new Paragraph({ children: [] })],
    });
    const blank = () => new Paragraph({ children: [] });

    const doc = new Document({
      creator: 'Project Manager AI', title: plan.title, subject: `${plan.typeTitle} for ${meta.project || ''}`.trim(), description: `Prepared for ${meta.client || 'the client'} on ${plan.date}`,
      styles: {
        default: { document: { run: { font: FONT, size: 21, color: T.text }, paragraph: { spacing: { line: 288, lineRule: LineRuleType.AUTO } } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: HEAD, size: 40, bold: true, color: T.text }, paragraph: { spacing: { before: 0, after: 260 }, outlineLevel: 0, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: T.primary, space: 8 } } } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: HEAD, size: 28, bold: true, color: T.text }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: HEAD, size: 24, bold: true, color: T.muted }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
        ],
      },
      numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } }, run: { color: T.primary } } }] }, ...numConfigs] },
      sections: [{
        properties: { titlePage: true, page: { size: { width: 11906, height: 16838 }, margin: { top: 1500, bottom: 1250, left: 1152, right: 1152, header: 560, footer: 520 } } },
        headers: { default: header, first: new Header({ children: [blank()] }) },
        footers: { default: footer, first: new Footer({ children: [blank()] }) },
        children: [...cover, ...body],
      }],
    });
    return Packer.toBlob(doc);
  };
})();
