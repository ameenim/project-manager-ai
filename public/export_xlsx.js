/* Excel builder for generated documents. Needs vendor/exceljs.min.js and export.js.
   One Summary sheet (cover facts, key figures, charts) and one sheet for every main heading.
   Charts are pictures in the platform colors. The numbers behind each chart are written into cells beside it. */
(function () {
  'use strict';
  const X = window.PM.exporter, T = X.T;
  const COLS = 12, CWID = 14; // twelve equal columns make a 1236 pixel wide page

  X.builders.xlsx = async function ({ plan, logo, client }) {
    const E = window.ExcelJS;
    const wb = new E.Workbook();
    const meta = plan.meta;
    wb.creator = 'Project Manager AI'; wb.title = plan.title; wb.subject = `${plan.typeTitle} for ${meta.project || ''}`.trim(); wb.created = new Date();
    const A = (h) => 'FF' + h;
    const FONT = X.FONT_NAME;
    const used = new Set();

    const sheetName = (raw) => {
      let n = String(raw).replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
      let k = 2, base = n;
      while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`;
      used.add(n.toLowerCase());
      return n;
    };
    const newSheet = (name) => {
      const ws = wb.addWorksheet(sheetName(name), {
        properties: { tabColor: { argb: A(T.primary) }, defaultRowHeight: 15 }, views: [{ showGridLines: false }],
        pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 } },
        headerFooter: { oddFooter: `&L&"${FONT},Regular"&8${meta.project || ''}  ·  ${plan.date}&R&8Page &P of &N` },
      });
      ws.columns = Array.from({ length: COLS }, () => ({ width: CWID }));
      return ws;
    };

    // write a value into columns c1 to c2 of a row, merged, with one style
    function put(ws, r, c1, c2, value, st) {
      st = st || {};
      const cell = ws.getCell(r, c1);
      cell.value = value;
      if (c2 > c1) ws.mergeCells(r, c1, r, c2);
      for (let c = c1; c <= c2; c++) {
        const x = ws.getCell(r, c);
        x.font = { name: FONT, size: st.size || 11, bold: !!st.bold, italic: !!st.italic, color: { argb: A(st.color || T.text) } };
        x.alignment = { vertical: st.v || 'middle', horizontal: st.align || 'left', wrapText: st.wrap !== false, indent: st.indent || 0 };
        if (st.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A(st.fill) } };
        if (st.border) x.border = st.border(c, c1, c2);
      }
    }
    const thin = (c) => ({ style: 'thin', color: { argb: A(c || T.border) } });
    const addPic = (ws, im, col, row, w, h, alt) => {
      const id = wb.addImage({ base64: X.b64(im.data), extension: 'png' });
      ws.addImage(id, { tl: { col, row }, ext: { width: w, height: h }, editAs: 'oneCell' });
    };
    const rowsFor = (h) => Math.ceil(h / 20) + 1;

    // header band with the platform logo, project and client
    function band(ws) {
      ws.getRow(1).height = 36; ws.getRow(2).height = 18; ws.getRow(3).height = 6;
      addPic(ws, logo, 0, 0, 170, Math.round((170 * logo.h) / logo.w), 'Project Manager AI logo');
      put(ws, 1, 7, 12, meta.project || '', { bold: true, align: 'right' });
      put(ws, 2, 7, 12, meta.client || '', { size: 10, color: T.muted, align: 'right' });
      for (let c = 1; c <= COLS; c++) ws.getCell(3, c).border = { bottom: thin(T.border) };
    }
    const heading = (ws, r, text) => {
      ws.getRow(r).height = 30;
      put(ws, r, 1, COLS, text, { size: 18, bold: true, border: () => ({ bottom: { style: 'thick', color: { argb: A(T.primary) } } }) });
    };

    // tables use the twelve columns: each table column gets a span in proportion to its text length
    function spansFor(head, rows) {
      const w = head.map((h, c) => Math.min(Math.max(String(h).length, ...rows.map((r) => String(r[c] == null ? '' : r[c]).length), 6), 40));
      const tot = w.reduce((a, b) => a + b, 0);
      const sp = w.map((x) => Math.max(1, Math.round((COLS * x) / tot)));
      let diff = COLS - sp.reduce((a, b) => a + b, 0), guard = 0;
      while (diff !== 0 && guard++ < 50) { const i = sp.indexOf(diff > 0 ? Math.min(...sp) : Math.max(...sp)); sp[i] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1; }
      return sp;
    }
    function table(ws, r, head, rows, opt) {
      opt = opt || {};
      const sp = spansFor(head, rows);
      const place = (vals, rr, st) => { let c = 1; vals.forEach((v, i) => { const s = typeof st === 'function' ? st(v, i) : st; put(ws, rr, c, c + sp[i] - 1, v == null ? '' : v, s); c += sp[i]; }); };
      const lines = (vals) => Math.max(1, ...vals.map((v, i) => Math.ceil(String(v == null ? '' : v).length / Math.max(4, sp[i] * CWID * 0.95))));
      ws.getRow(r).height = Math.max(22, lines(head) * 15 + 6);
      place(head, r, { bold: true, size: 10, color: opt.soft ? T.primary : T.onPrimary, fill: opt.soft ? T.primarySoft : T.primary, border: () => ({ top: thin(opt.soft ? T.primarySoft : T.primary), bottom: thin(opt.soft ? T.primarySoft : T.primary) }) });
      rows.forEach((row, ri) => {
        const rr = r + 1 + ri;
        ws.getRow(rr).height = Math.max(20, lines(row) * 15 + 5);
        place(row, rr, (v, i) => {
          const st = X.statusTone(v);
          return { size: 10, bold: !!st, color: st ? X.tone(st) : T.text, fill: st ? X.SOFT[st] : ri % 2 ? T.surface2 : undefined, border: () => ({ bottom: thin(T.border) }), align: typeof v === 'number' ? 'right' : 'left' };
        });
      });
      return r + rows.length + 2;
    }

    // ----- visuals -----
    async function visual(ws, r, sp) {
      put(ws, r, 1, COLS, sp.title, { bold: true, size: 12 });
      ws.getRow(r).height = 22; r += 1;
      if (sp.kind === 'heat') {
        const head = ['Probability or impact', ...sp.colLabels];
        const sps = [4, 3, 3, 2]; // 12 columns
        let c = 1; ws.getRow(r).height = 22;
        head.forEach((h, i) => { put(ws, r, c, c + sps[i] - 1, h, { bold: true, size: 10, color: T.onPrimary, fill: T.primary, align: i ? 'center' : 'left' }); c += sps[i]; });
        sp.rowLabels.forEach((lab, ri) => {
          const rr = r + 1 + ri; ws.getRow(rr).height = 34; c = 1;
          put(ws, rr, 1, sps[0], `${lab} probability`, { bold: true, size: 10, fill: T.surface2 }); c = 1 + sps[0];
          sp.matrix[ri].forEach((n, ci) => { const tn = X.heatTone(ri, ci); put(ws, rr, c, c + sps[ci + 1] - 1, n, { size: 16, bold: true, color: n ? X.tone(tn) : T.faint, fill: X.SOFT[tn], align: 'center', border: () => ({ top: thin('FFFFFF'), left: thin('FFFFFF'), bottom: thin('FFFFFF'), right: thin('FFFFFF') }) }); c += sps[ci + 1]; });
        });
        return r + 5;
      }
      const im = await X.renderSpec(sp);
      if (im) {
        addPic(ws, im, 0, r - 1, im.w, im.h, sp.alt);
        r += rowsFor(im.h);
      }
      const tb = X.specTable(sp);
      if (tb.head.length && sp.kind !== 'flow') { put(ws, r, 1, COLS, 'Chart data', { size: 10, italic: true, color: T.muted }); r = table(ws, r + 1, tb.head, tb.rows, { soft: true }); }
      return r + 1;
    }

    // ----- Summary sheet -----
    {
      const ws = newSheet('Summary');
      band(ws);
      put(ws, 5, 1, COLS, plan.typeTitle, { size: 12, bold: true, color: T.primary });
      ws.getRow(6).height = 36;
      put(ws, 6, 1, COLS, plan.title, { size: 24, bold: true });
      const facts = [['Client', meta.client], ['Project', meta.project], ['Project code', meta.code], ['Document date', plan.date], ['Prepared for', meta.audience], ['Prepared by', meta.pm]].filter((f) => f[1]);
      let r = 8;
      facts.forEach(([k, v]) => { ws.getRow(r).height = 22; put(ws, r, 1, 2, k, { color: T.muted }); put(ws, r, 3, 8, String(v), { bold: true, size: 12 }); r++; });
      if (client) { const h = Math.min(90, Math.round((client.h / client.w) * 220)), w = Math.round((client.w / client.h) * h); addPic(ws, client, 9, 7, Math.min(w, 220), h, `${meta.client || 'Client'} logo`); }
      r += 1;
      if (plan.kpis.length) {
        put(ws, r, 1, COLS, 'Key figures', { bold: true, size: 12 }); ws.getRow(r).height = 22; r++;
        const span = COLS / plan.kpis.length;
        ws.getRow(r).height = 22; ws.getRow(r + 1).height = 38; ws.getRow(r + 2).height = 22;
        plan.kpis.forEach((k, i) => {
          const c1 = 1 + i * span, c2 = c1 + span - 1, edge = () => ({ left: thin('FFFFFF'), right: thin('FFFFFF') });
          put(ws, r, c1, c2, k.label, { size: 10, color: T.muted, fill: T.surface2, indent: 1, border: (c) => ({ top: { style: 'thick', color: { argb: A(X.tone(k.tone)) } }, left: thin('FFFFFF'), right: thin('FFFFFF') }) });
          put(ws, r + 1, c1, c2, k.value, { size: 22, bold: true, color: k.tone === 'info' || k.tone === 'idle' ? T.text : X.tone(k.tone), fill: T.surface2, indent: 1, border: edge });
          put(ws, r + 2, c1, c2, k.hint || '', { size: 9, color: T.muted, fill: T.surface2, indent: 1, border: edge });
        });
        r += 4;
      }
      const glance = plan.sections.find((s) => s.glance);
      if (glance) {
        put(ws, r, 1, COLS, glance.heading, { size: 16, bold: true, border: () => ({ bottom: { style: 'thick', color: { argb: A(T.primary) } } }) }); ws.getRow(r).height = 28; r += 2;
        for (const sp of glance.specs) r = await visual(ws, r, sp);
      }
    }

    // ----- one sheet per heading -----
    for (const sec of plan.sections) {
      if (sec.glance) continue;
      const ws = newSheet(sec.heading);
      band(ws);
      heading(ws, 5, sec.heading);
      let r = 7;
      for (const sp of sec.specs) r = await visual(ws, r, sp);
      for (const b of sec.blocks) {
        if (b.t === 'h2' || b.t === 'h3') { ws.getRow(r).height = 24; put(ws, r, 1, COLS, X.plain(b.runs), { bold: true, size: b.t === 'h2' ? 14 : 12, color: b.t === 'h2' ? T.text : T.muted }); r += 2; }
        else if (b.t === 'p') { const txt = X.plain(b.runs); ws.getRow(r).height = Math.max(20, Math.ceil(txt.length / 150) * 16 + 6); put(ws, r, 1, COLS, txt, { v: 'top' }); r += 2; }
        else if (b.t === 'ul' || b.t === 'ol') {
          b.items.forEach((it, i) => { const txt = `${b.t === 'ol' ? `${i + 1}.` : '•'}  ${X.plain(it)}`; ws.getRow(r).height = Math.max(20, Math.ceil(txt.length / 145) * 16 + 4); put(ws, r, 1, COLS, txt, { v: 'top', indent: 1 }); r++; });
          r += 1;
        } else if (b.t === 'table') r = table(ws, r, b.head.map(X.plain), b.rows.map((row) => b.head.map((_, c) => X.plain(row[c] || []))));
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: X.FORMATS.xlsx.mime });
  };
})();
