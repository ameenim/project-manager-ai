/* Export an overview dashboard as a report in Word, PowerPoint or Excel.
   Each chosen widget becomes one section with a chart and its table. Excel also gets sheets of rows. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast } = PM;
  const DOC_ROWS = 12; // longest table inside a Word page or a slide, Excel has every row

  // column definitions for the Excel row sheets, in the same order the server writes them
  const COL = (h, kind, w) => ({ h, kind: kind || 'text', w: w || 16 });
  const SHEETS = [
    ['projects', 'Projects', [COL('Project', 'text', 30), COL('Client', 'text', 22), COL('Code', 'text', 12), COL('Status', 'text', 12), COL('Health', 'text', 16), COL('Progress', 'pct', 11), COL('Planned', 'pct', 11), COL('SPI', 'dec', 9), COL('Tasks', 'int', 9), COL('Overdue', 'int', 10), COL('Open risks', 'int', 11), COL('Currency', 'text', 10), COL('Value', 'money', 15), COL('Start', 'date', 13), COL('End', 'date', 13), COL('Forecast end', 'date', 14), COL('Slip days', 'int', 10), COL('Pending review', 'int', 14)]],
    ['tasks', 'Tasks', [COL('Project', 'text', 26), COL('WBS', 'text', 9), COL('Phase', 'text', 22), COL('Task', 'text', 40), COL('Start', 'date', 13), COL('Finish', 'date', 13), COL('Days', 'int', 8), COL('Progress', 'pct', 11), COL('Status', 'text', 14), COL('Owner', 'text', 18), COL('Critical', 'text', 10), COL('Milestone', 'text', 11), COL('Predecessors', 'text', 16), COL('Notes', 'text', 36)]],
    ['payments', 'Payments', [COL('Project', 'text', 26), COL('Payment', 'text', 34), COL('Due', 'date', 13), COL('Amount', 'money', 15), COL('Currency', 'text', 10), COL('Percent', 'dec', 10), COL('State', 'text', 12), COL('Status', 'text', 14), COL('Late', 'text', 8)]],
    ['deliverables', 'Deliverables', [COL('Project', 'text', 26), COL('Deliverable', 'text', 38), COL('Due', 'date', 13), COL('State', 'text', 12), COL('Status', 'text', 14), COL('Late', 'text', 8), COL('Outcome', 'text', 36)]],
    ['requirements', 'Requirements', [COL('Project', 'text', 26), COL('Requirement', 'text', 46), COL('Category', 'text', 18), COL('Priority', 'text', 12), COL('State', 'text', 12)]],
    ['risks', 'Risks', [COL('Project', 'text', 26), COL('Risk', 'text', 38), COL('Category', 'text', 16), COL('Probability', 'text', 13), COL('Impact', 'text', 11), COL('Level', 'text', 11), COL('State', 'text', 12), COL('Owner', 'text', 18), COL('Response', 'text', 18), COL('Mitigation', 'text', 40)]],
    ['team', 'Team', [COL('Project', 'text', 26), COL('Name', 'text', 24), COL('Role', 'text', 22), COL('Email', 'text', 30), COL('Open tasks', 'int', 12), COL('Late tasks', 'int', 12)]],
    ['workload', 'Workload', [COL('Project', 'text', 26), COL('Owner', 'text', 24), COL('Done', 'int', 10), COL('In progress', 'int', 12), COL('Not started', 'int', 12), COL('Late', 'int', 10), COL('Total', 'int', 10)]],
    ['activity', 'Activity', [COL('Time', 'text', 18), COL('Project', 'text', 26), COL('Actor', 'text', 20), COL('Action', 'text', 20), COL('Summary', 'text', 60)]],
  ];

  const num = (v) => { if (v === '' || v == null || typeof v === 'boolean') return false; const n = Number(String(v).replace(/[,%]/g, '')); return Number.isFinite(n); };
  const cell = (v) => ({ text: v == null ? '' : String(v) });

  // a widget table (header row plus rows) becomes a chart when it has numbers worth drawing
  function chartOf(title, csv) {
    const head = csv[0] || [], rows = csv.slice(1);
    if (rows.length < 2 || head.length < 2) return null;
    const cols = [];
    for (let c = 1; c < head.length; c++) if (rows.every((r) => num(r[c]))) cols.push(c);
    if (!cols.length) return null;
    const ctype = cols.length === 1 && rows.length <= 4 ? 'pie' : rows.length > 8 ? 'bar' : 'column';
    return { ctype, title, labels: rows.map((r) => r[0]), series: cols.slice(0, 6).map((c) => ({ name: String(head[c]), values: rows.map((r) => Number(String(r[c]).replace(/[,%]/g, ''))) })) };
  }
  // a page holds about eight columns. A table with many columns and few rows is turned on its side, otherwise the first columns stay.
  const MAXC = 8;
  function tableOf(csv) {
    if (!csv || csv.length < 2) return null;
    let head = csv[0].map(String), all = csv.slice(1), cut = 0;
    if (head.length > MAXC && all.length <= MAXC) {
      const rows0 = all;
      all = head.slice(1).map((h, c) => [h, ...rows0.map((r) => r[c + 1])]);
      head = [head[0], ...rows0.map((r) => String(r[0]))];
    }
    if (head.length > MAXC) { cut = head.length - MAXC; head = head.slice(0, MAXC); all = all.map((r) => r.slice(0, MAXC)); }
    const rows = all.slice(0, DOC_ROWS);
    return { t: 'table', head: head.map((h) => [cell(h)]), rows: rows.map((r) => head.map((_, c) => [cell(r[c])])), more: all.length - rows.length, cut };
  }

  function filterText(f) {
    const L = [];
    if (f.y) L.push(`${t('wfl_year')} ${f.y}`);
    if (f.m) L.push(`${t('wfl_month')} ${f.m}`); else if (f.q) L.push(`Q${f.q}`);
    if (f.s) L.push(t('gf_s_' + f.s));
    if (f.h) L.push(t('health_' + f.h));
    if (f.cur) L.push(f.cur);
    if (f.c) L.push(f.c);
    if (f.p && f.p.length) L.push(t('gf_n_projects', { n: f.p.length }));
    return L.join(', ');
  }

  // render each widget off screen, only to read the table it would export
  function sections(items, d, ctx, mode) {
    const out = []; let kpis = [];
    PM.fx.mode = mode;
    for (const it of items) {
      const host = document.createElement('div');
      let r = null;
      try { r = it.w.render(host, d, ctx); } catch (e) { r = null; }
      if (r && r.kpis) { kpis = r.kpis.slice(0, 6); continue; }
      const csv = r && typeof r.csv === 'function' ? r.csv() : null;
      if (!csv || csv.length < 3) continue; // a single row is not a report page
      const table = tableOf(csv);
      out.push({ heading: it.label, chart: chartOf(it.label, csv), table, csv });
    }
    return { sections: out, kpis };
  }

  function open(o) {
    const portfolio = o.scope === 'portfolio', f = PM.dashFilters.get(o.fkey), on = PM.dashFilters.isOn(f);
    const items = o.items;
    const m = PM.modal({ title: t('ex_title'), size: '', body: `<div class="col gap-lg">
      <div><div class="small muted" style="margin-bottom:6px">${esc(t('ex_format'))}</div><div class="seg" id="exFmt" role="group" aria-label="${esc(t('ex_format'))}">${[['docx', 'Word'], ['pptx', 'PowerPoint'], ['xlsx', 'Excel']].map(([k, l], i) => `<button type="button" data-f="${k}" aria-pressed="${i === 0}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}</div><div class="small muted" id="exHint" style="margin-top:6px"></div></div>
      <div><div class="row" style="gap:8px"><span class="small muted grow">${esc(t('ex_include'))}</span><button type="button" class="btn sm ghost" id="exAll">${esc(t('ex_all'))}</button><button type="button" class="btn sm ghost" id="exNone">${esc(t('ex_none'))}</button></div>
        <div class="ex-list" id="exList">${items.map((x) => `<label class="dd-opt"><input type="checkbox" data-id="${esc(x.id)}" checked><span class="grow">${esc(x.label)}</span></label>`).join('')}</div></div>
      <div class="small muted" id="exNote">${esc(on ? t('ex_filters_on', { f: filterText(f) }) : t('ex_filters_off'))}</div>
      <div class="small" id="exErr" role="alert" style="color:var(--danger)" hidden></div></div>`,
      footer: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="exGo">${icon('file')}${esc(t('ex_go'))}</button>` });
    let fmt = 'docx';
    const hint = () => { $('#exHint', m.el).textContent = t('ex_hint_' + fmt); };
    hint();
    $('#exFmt', m.el).onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; fmt = b.dataset.f; $$('#exFmt button', m.el).forEach((x) => { const on2 = x === b; x.classList.toggle('on', on2); x.setAttribute('aria-pressed', String(on2)); }); hint(); };
    const setAll = (v) => $$('#exList input', m.el).forEach((i) => (i.checked = v));
    $('#exAll', m.el).onclick = () => setAll(true); $('#exNone', m.el).onclick = () => setAll(false);
    $('#exGo', m.el).onclick = async () => {
      const ids = new Set($$('#exList input:checked', m.el).map((i) => i.dataset.id)), err = $('#exErr', m.el), go = $('#exGo', m.el);
      if (!ids.size) { err.textContent = t('ex_need_one'); err.hidden = false; return; }
      err.hidden = true; go.disabled = true; go.setAttribute('aria-busy', 'true');
      try {
        const qs = PM.dashFilters.query(o.fkey);
        const rd = await api('GET', o.reportUrl + qs);
        const d = o.ctx.data, S = sections(items.filter((x) => ids.has(x.id)), d, o.ctx, o.mode());
        const today = new Date().toISOString().slice(0, 10);
        const proj = portfolio ? t('ex_scope_portfolio') : (d.project && d.project.name) || '';
        const title = portfolio ? t('ex_t_portfolio') : `${t('ex_t_project')} ${proj}`.trim();
        const meta = { project: proj, client: portfolio ? '' : (d.project && d.project.client) || '', code: portfolio ? '' : (d.project && d.project.code) || '', date: today, pm: PM.state.user && PM.state.user.name || '', filters: rd.filter_text || (on ? filterText(f) : '') };
        const g = { format: fmt, title, type_title: portfolio ? t('ex_t_portfolio') : t('ex_t_project'), meta, doc_type: 'dashboard', content: '', dashboard: { kpis: S.kpis, sections: S.sections, data: fmt === 'xlsx' ? dataOf(rd, o.mode()) : null } };
        const r = await PM.exporter.download(g);
        m.close(); toast(t('ex_ready') + ': ' + r.filename, 'ok');
      } catch (e) { console.error('Report export failed', e); err.textContent = t('ex_failed'); err.hidden = false; go.disabled = false; go.removeAttribute('aria-busy'); }
    };
  }

  // row tables for Excel. Money columns also get an amount converted to the display currency.
  function dataOf(rd, mode) {
    const tables = [];
    for (const [key, name, cols] of SHEETS) {
      const rows = rd.tables && rd.tables[key];
      if (!rows || !rows.length) continue;
      tables.push({ name, cols, rows, conv: mode && mode !== 'native' ? mode : null, key });
    }
    return { tables, truncated: !!rd.truncated, cap: rd.cap, filters: rd.filter_text || '' };
  }

  PM.dashReport = { open, chartOf, tableOf, filterText, SHEETS, DOC_ROWS };
})();
