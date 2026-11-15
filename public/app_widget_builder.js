/* Widget builder: a form that produces a declarative widget spec (data, never code) with a live preview on the
   person's own projects. Specs are validated by the same widgetspec.js the server uses.
   The form works like a chart builder: choose the data and filters, choose the chart, then the values (calculation, show
   values as, grouping, series), the display options and the alert colors. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, state: S } = PM;
  const WS = window.__WidgetSpec;
  const W = () => PM.widgets;

  const VIZ_ICON = { kpi: 'spark', gauge: 'spark', bar: 'list', column: 'cols', cluster: 'cols', stacked: 'cols', stackedbar: 'list', pct: 'cols', waterfall: 'cols', line: 'vline', lines: 'vline', area: 'varea', combo: 'vcombo', donut: 'grid', pie: 'grid', funnel: 'vfunnel', radar: 'vradar', scatter: 'spark', heatmap: 'grid', table: 'list', pivot: 'list' };
  const CATS = [['number', ['kpi', 'gauge']], ['compare', ['bar', 'column', 'cluster', 'stacked', 'stackedbar', 'pct', 'waterfall']], ['trend', ['line', 'lines', 'area', 'combo']], ['share', ['donut', 'pie', 'funnel', 'radar', 'scatter', 'heatmap']], ['lists', ['table', 'pivot']]];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fields = (ds) => WS.DATASETS[ds] || [];
  const fld = (ds, n) => WS.fieldOf(ds, n);
  const nums = (ds) => WS.numericFields(ds);
  const defaultGroupBy = (ds) => { const fs = fields(ds); return (fs.find((x) => x.type === 'enum') || fs.find((x) => x.type === 'text') || fs[0]).name; };
  const defaultSplit = (ds, not) => { const fs = fields(ds).filter((x) => x.name !== not); return (fs.find((x) => x.type === 'enum') || fs.find((x) => x.type === 'text') || fs[0]).name; };
  const defaultColumns = (ds) => fields(ds).slice(0, 4).map((x) => x.name);
  const firstNum = (ds) => (nums(ds)[0] ? nums(ds)[0].name : '');
  const emptyState = () => ({
    id: null, title: '', description: '', group: 'overview', size: '', dataset: 'tasks', match: 'all', filters: [],
    viz: 'kpi', agg: 'count', measure: '', calc: { op: 'ratio', a: { agg: 'sum', measure: '' }, b: { agg: 'count', measure: '' } },
    line: 'cumulative', agg2: 'count', measure2: '', seriesMode: 'measures', series: [{ agg: 'count', measure: '' }, { agg: 'sum', measure: '' }],
    format: 'number', decimals: '', unit: '', target: '', max: '', rules: [], ruleField: '', legend: true,
    groupBy: '', dateBy: 'month', bin: '', sort: 'value_desc', limit: '', showAs: 'value', splitBy: '', splitLimit: '', splitDateBy: 'month',
    x: '', y: '', colorBy: '', trend: false, columns: [], sortBy: '', sortDir: 'asc', rows: '10', totals: false,
  });
  const str = (v) => (v == null ? '' : String(v));

  // An older number widget kept its alert levels as two thresholds. They become the same rules a person would write now.
  function toneToRules(tone) {
    const out = [], have = [tone.warn, tone.bad].filter((x) => x != null);
    if (!have.length) return out;
    if (tone.dir === 'below') { if (tone.bad != null) out.push({ op: 'lte', value: str(tone.bad), value2: '', tone: 'bad' }); if (tone.warn != null) out.push({ op: 'lte', value: str(tone.warn), value2: '', tone: 'warn' }); out.push({ op: 'gt', value: str(Math.max(...have)), value2: '', tone: 'good' }); } else { if (tone.bad != null) out.push({ op: 'gte', value: str(tone.bad), value2: '', tone: 'bad' }); if (tone.warn != null) out.push({ op: 'gte', value: str(tone.warn), value2: '', tone: 'warn' }); out.push({ op: 'lt', value: str(Math.min(...have)), value2: '', tone: 'good' }); }
    return out;
  }

  function fromSpec(w) {
    const s = w.spec, st = emptyState();
    Object.assign(st, { id: w.id, title: w.title, description: w.description || '', group: w.group, dataset: s.dataset, viz: s.viz, size: s.size || '', match: s.match || 'all' });
    st.filters = (s.filters || []).map((x) => ({ field: x.field, op: x.op, value: Array.isArray(x.value) ? x.value.slice() : str(x.value), value2: str(x.value2) }));
    st.legend = s.legend !== false; st.decimals = str(s.decimals); st.unit = s.unit || ''; st.target = str(s.target);
    st.rules = (s.rules || []).map((r) => ({ op: r.op, value: str(r.value), value2: str(r.value2), tone: r.tone }));
    if (s.viz === 'table') { st.columns = s.columns.slice(); st.sortBy = s.sortBy; st.sortDir = s.sortDir; st.rows = String(s.rows); st.totals = !!s.totals; st.ruleField = s.ruleField || ''; return st; }
    if (s.viz === 'scatter') { st.x = s.x; st.y = s.y; st.colorBy = s.colorBy || ''; st.trend = !!s.trend; return st; }
    st.agg = s.agg; st.measure = s.measure || '';
    if (s.agg === 'calc') st.calc = { op: s.calc.op, a: { agg: s.calc.a.agg, measure: s.calc.a.measure || '' }, b: { agg: s.calc.b.agg, measure: s.calc.b.measure || '' } };
    if (s.series) { st.seriesMode = 'measures'; st.series = s.series.map((x) => ({ agg: x.agg, measure: x.measure || '' })); }
    if (s.viz === 'kpi') { st.format = s.format || 'number'; if (!st.rules.length && s.tone) st.rules = toneToRules(s.tone); return st; }
    if (s.viz === 'gauge') { st.max = str(s.max); return st; }
    st.groupBy = s.groupBy; st.dateBy = s.dateBy || 'month'; st.bin = str(s.bin); st.sort = s.sort; st.limit = String(s.limit); st.showAs = s.showAs || 'value';
    if (s.splitBy) { st.splitBy = s.splitBy; st.seriesMode = 'split'; st.splitLimit = String(s.splitLimit || ''); st.splitDateBy = s.splitDateBy || 'month'; }
    if (s.viz === 'combo') { st.line = s.line; st.agg2 = s.agg2 || 'count'; st.measure2 = s.measure2 || ''; }
    return st;
  }

  const partRaw = (p) => (p.agg === 'count' ? { agg: 'count' } : { agg: p.agg, measure: p.measure });
  function filterRaw(ds, x) {
    if (!fld(ds, x.field)) return x;
    if (WS.NO_VALUE.includes(x.op)) return { field: x.field, op: x.op };
    if (x.op === 'in' || x.op === 'not_in') return { field: x.field, op: x.op, value: x.value };
    if (x.op === 'between') return { field: x.field, op: x.op, value: x.value, value2: x.value2 };
    return { field: x.field, op: x.op, value: x.value === '' ? undefined : x.value };
  }
  function toSpec(st) {
    const ds = st.dataset, v = st.viz;
    const raw = { dataset: ds, viz: v, filters: st.filters.map((x) => filterRaw(ds, x)), match: st.match, size: st.size || undefined };
    const rules = () => (st.rules.length ? st.rules.map((r) => ({ op: r.op, value: r.value, value2: r.value2, tone: r.tone })) : undefined);
    if (v === 'table') {
      Object.assign(raw, { columns: st.columns, sortBy: st.sortBy || st.columns[0], sortDir: st.sortDir, rows: st.rows === '' ? NaN : Number(st.rows), totals: st.totals || undefined, ruleField: st.ruleField || undefined });
      if (st.ruleField) raw.rules = rules();
      return raw;
    }
    if (v === 'scatter') { Object.assign(raw, { x: st.x, y: st.y, colorBy: st.colorBy || undefined, trend: st.trend || undefined, legend: st.legend ? undefined : false }); return raw; }
    const split = WS.SPLIT_REQUIRED.includes(v) || (WS.MULTI.includes(v) && st.seriesMode === 'split');
    if (WS.MULTI.includes(v) && !split) raw.series = st.series.map(partRaw);
    else { raw.agg = st.agg; if (st.agg === 'calc') raw.calc = { op: st.calc.op, a: partRaw(st.calc.a), b: partRaw(st.calc.b) }; else if (st.agg !== 'count') raw.measure = st.measure; }
    if (WS.RULE_VIZ.includes(v)) raw.rules = rules();
    if (WS.TARGET_VIZ.includes(v)) raw.target = st.target;
    if (v === 'kpi') { Object.assign(raw, { format: st.format, decimals: st.decimals, unit: st.unit }); return raw; }
    if (v === 'gauge') { Object.assign(raw, { max: st.max, decimals: st.decimals, unit: st.unit }); return raw; }
    const gb = fld(ds, st.groupBy);
    raw.groupBy = st.groupBy;
    if (gb && gb.type === 'date') raw.dateBy = st.dateBy; else if (gb && gb.type === 'number' && st.bin !== '') raw.bin = st.bin;
    raw.sort = st.sort; raw.limit = st.limit === '' ? undefined : Number(st.limit);
    if (WS.SHOW_VIZ.includes(v)) raw.showAs = st.showAs;
    if (WS.MATRIX.includes(v)) {
      if (split) { raw.splitBy = st.splitBy; raw.splitLimit = st.splitLimit === '' ? undefined : Number(st.splitLimit); const sf = fld(ds, st.splitBy); if (sf && sf.type === 'date') raw.splitDateBy = st.splitDateBy; }
      if (!st.legend) raw.legend = false;
    }
    if (v === 'combo') { raw.line = st.line; if (!st.legend) raw.legend = false; if (st.line === 'second') { raw.agg2 = st.agg2; if (st.agg2 !== 'count') raw.measure2 = st.measure2; } }
    return raw;
  }

  // Which section an error belongs to, so the message shows where the person is working
  const errSection = (code) => (/^(title|desc|group)/.test(code || '') ? 'about' : /^(dataset|filter|days)/.test(code || '') ? 'data' : /^(rule|rules)/.test(code || '') ? 'alerts' : /^(target|decimals|unit)/.test(code || '') ? 'display' : 'show');

  PM.views.widgetBuilder = async function (id) {
    const token = S.nav;
    PM.shell('widgets', `${PM.skeleton.page()}`);
    let st = emptyState(), saved = null;
    try {
      if (id) { const w = (await api('GET', `/api/widgets/${id}`)).widget; if (!w.mine) throw new Error(t('wb_not_yours')); st = fromSpec(w); saved = w; }
    } catch (e) { if (PM.stale(token)) return; $('#content').innerHTML = '<div class="page wb"></div>'; $('#content .page').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn" href="#/widgets?tab=mine">${esc(t('wb_back'))}</a></div>`; return; }
    let data = null;
    try { await PM.loadProjects(); const r = await api('GET', '/api/widgets/datasets'); data = { datasets: r.datasets, today: r.today, truncated: r.truncated || {} }; } catch (e) { /* the preview shows a note */ }
    if (PM.stale(token)) return;
    $('#content').innerHTML = '<div class="page wb"></div>';
    const dirty = { v: false };
    const label = W().labels;

    // ---------- small form pieces ----------
    const idOf = (path) => 'wb_' + path.replace(/[^a-z0-9]/gi, '_');
    const sel = (path, cur, opts, extra) => `<select id="${idOf(path)}" data-s="${path}" ${extra || ''}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const inp = (path, val, attrs) => `<input id="${idOf(path)}" data-s="${path}" value="${esc(val)}" ${attrs || ''}>`;
    const row = (label2, inner, hint, idFor) => `<div class="wb-field"><label${idFor ? ` for="${idFor}"` : ''}>${esc(label2)}</label>${inner}${hint ? `<div class="small muted">${esc(hint)}</div>` : ''}</div>`;
    const fieldOpts = (ds, pred) => fields(ds).filter(pred || (() => true)).map((x) => [x.name, label.field(x.name)]);
    const opLabel = (op, type) => (type === 'date' && (op === 'gt' || op === 'lt') ? t('wb_dop_' + op) : t('wb_op_' + op));
    const errBox = (sec) => `<div class="wb-err" id="wbErr_${sec}" role="alert" hidden></div>`;
    const dateField = (fd) => fd && fd.type === 'date';

    // ---------- filters ----------
    function filterRow(f, i) {
      const fd = fld(st.dataset, f.field) || fields(st.dataset)[0];
      const ops = WS.OPS[fd.type], a = `data-fi="${i}"`;
      let val = '';
      const one = (k, v, ph) => (fd.type === 'date' ? `<input type="date" ${a} data-fk="${k}" value="${esc(v)}" aria-label="${esc(ph)}">` : `<input type="number" step="any" ${a} data-fk="${k}" value="${esc(v)}" aria-label="${esc(ph)}" placeholder="${esc(ph)}">`);
      if (WS.NO_VALUE.includes(f.op)) val = '';
      else if (f.op === 'within_days' || f.op === 'last_days') val = `<input type="number" min="0" max="3650" ${a} data-fk="value" value="${esc(f.value)}" aria-label="${esc(t('wb_days'))}" placeholder="${esc(t('wb_days'))}">`;
      else if (f.op === 'between') val = one('value', f.value, t('wb_from')) + one('value2', f.value2, t('wb_value2'));
      else if (f.op === 'in' || f.op === 'not_in') val = `<div class="wb-multi" role="group" aria-label="${esc(t('wb_value'))}">${Object.keys(fd.values).map((v) => `<label class="wb-check"><input type="checkbox" ${a} data-fin="${v}" ${Array.isArray(f.value) && f.value.includes(v) ? 'checked' : ''}>${esc(label.value(v))}</label>`).join('')}</div>`;
      else if (fd.type === 'enum') val = `<select ${a} data-fk="value" aria-label="${esc(t('wb_value'))}">${Object.keys(fd.values).map((v) => `<option value="${v}" ${f.value === v ? 'selected' : ''}>${esc(label.value(v))}</option>`).join('')}</select>`;
      else if (fd.type === 'number') val = one('value', f.value, t('wb_value'));
      else if (fd.type === 'date') val = one('value', f.value, t('wb_value'));
      else val = `<input type="text" maxlength="80" ${a} data-fk="value" value="${esc(f.value)}" aria-label="${esc(t('wb_value'))}" placeholder="${esc(t('wb_value'))}">`;
      return `<div class="wb-filter row" data-i="${i}"><select ${a} data-fk="field" aria-label="${esc(t('wb_field'))}">${fieldOpts(st.dataset).map(([v, l]) => `<option value="${v}" ${f.field === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><select ${a} data-fk="op" aria-label="${esc(t('wb_condition'))}">${ops.map((o) => `<option value="${o}" ${f.op === o ? 'selected' : ''}>${esc(opLabel(o, fd.type))}</option>`).join('')}</select>${val}<button class="btn sm ghost icon" type="button" data-fdel="${i}" aria-label="${esc(t('wb_remove_filter'))}" data-tip="${esc(t('wb_remove_filter'))}">${icon('trash')}</button></div>`;
    }

    // ---------- values ----------
    const aggsFor = () => (WS.SHARE.includes(st.viz) || WS.PARTS.includes(st.viz) || (st.viz === 'combo' && st.line === 'cumulative') ? ['count', 'sum'] : WS.AGGS.concat(['calc']));
    const measureOpts = (ds, agg) => (agg === 'distinct' ? fieldOpts(ds) : nums(ds).map((x) => [x.name, label.field(x.name)]));
    // one calculation: how to combine rows, and of which field
    function metric(path, m, aggs, nameLabel) {
      const needM = m.agg !== 'count' && m.agg !== 'calc';
      return `<div class="wb-row"><div class="wb-field"><label for="${idOf(path + '.agg')}">${esc(nameLabel)}</label>${sel(path + '.agg', m.agg, aggs.map((a) => [a, t('wb_agg_' + a)]), 'data-redraw')}</div>${needM ? `<div class="wb-field"><label for="${idOf(path + '.measure')}">${esc(t('wb_measure'))}</label>${sel(path + '.measure', m.measure, measureOpts(st.dataset, m.agg))}</div>` : ''}</div>`;
    }
    function calcBlock() {
      const parts = (p, k) => metric('calc.' + p, st.calc[p], WS.AGGS, t('wb_calc_' + k));
      return `<div class="wb-field"><div class="wb-row"><div class="wb-field"><label for="${idOf('calc.op')}">${esc(t('wb_calc_op'))}</label>${sel('calc.op', st.calc.op, WS.CALC_OPS.map((o) => [o, t('wb_calc_' + o)]))}</div></div>${parts('a', 'a')}${parts('b', 'b')}<div class="small muted">${esc(t('wb_calc_hint'))}</div></div>`;
    }

    function rulesBlock(sec) {
      const ops = WS.RULE_OPS.map((o) => [o, t('wb_rop_' + o)]);
      const rows = st.rules.map((r, i) => `<div class="wb-rule" data-ri="${i}"><div class="wb-field"><label for="${idOf('rules.' + i + '.op')}">${esc(t('wb_rule_when'))}</label>${sel('rules.' + i + '.op', r.op, ops, 'data-redraw')}</div><div class="wb-field"><label for="${idOf('rules.' + i + '.value')}">${esc(r.op === 'between' ? t('wb_from') : t('wb_value'))}</label>${inp('rules.' + i + '.value', r.value, 'type="number" step="any"')}</div>${r.op === 'between' ? `<div class="wb-field"><label for="${idOf('rules.' + i + '.value2')}">${esc(t('wb_value2'))}</label>${inp('rules.' + i + '.value2', r.value2, 'type="number" step="any"')}</div>` : ''}<div class="wb-field"><span class="wb-lab">${esc(t('wb_rule_color'))}</span><div class="wb-tones" role="radiogroup" aria-label="${esc(t('wb_rule_color'))}">${WS.TONES.map((tn) => `<button type="button" role="radio" aria-checked="${r.tone === tn}" class="wb-tone k-${tn} ${r.tone === tn ? 'on' : ''}" data-rt="${i}" data-tone="${tn}"><i></i>${esc(t('wb_tone_' + tn))}</button>`).join('')}</div></div><div><button class="btn sm ghost icon" type="button" data-rdel="${i}" aria-label="${esc(t('wb_remove_rule'))}" data-tip="${esc(t('wb_remove_rule'))}">${icon('trash')}</button></div></div>`).join('');
      return `<div class="wb-field"><span class="wb-lab">${esc(t('wb_rules'))}</span>${rows || `<div class="small muted">${esc(t('wb_no_rules'))}</div>`}${st.rules.length < WS.MAX_RULES ? `<div><button class="btn sm" type="button" id="wbAddRule">${icon('plus')}${esc(t('wb_add_rule'))}</button></div>` : ''}<div class="small muted">${esc(t('wb_rules_hint', { n: WS.MAX_RULES }))}</div>${errBox(sec)}</div>`;
    }

    function formHtml() {
      const ds = st.dataset, v = st.viz, isTable = v === 'table', isScatter = v === 'scatter', isKpi = v === 'kpi', isGauge = v === 'gauge';
      const grouped = WS.GROUPED.includes(v), matrix = WS.MATRIX.includes(v), multi = WS.MULTI.includes(v);
      const split = WS.SPLIT_REQUIRED.includes(v) || (multi && st.seriesMode === 'split');
      const gb = fld(ds, st.groupBy), sf = fld(ds, st.splitBy);
      const aggs = aggsFor();

      // 1. about
      const about = `<section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_about'))}</h2>
        <div class="wb-field"><label for="wbTitle">${esc(t('wb_title'))}</label><input id="wbTitle" data-s="title" maxlength="${WS.TITLE_MAX}" value="${esc(st.title)}" placeholder="${esc(t('wb_title_ph'))}"></div>
        <div class="wb-field"><label for="wbDesc">${esc(t('wb_desc'))}</label><textarea id="wbDesc" data-s="description" rows="2" maxlength="${WS.DESC_MAX}" placeholder="${esc(t('wb_desc_ph'))}">${esc(st.description)}</textarea><div class="small muted">${esc(t('wb_desc_hint'))}</div></div>
        <div class="wb-row">${row(t('wb_group'), sel('group', st.group, WS.GROUPS.map((g) => [g, label.group(g)])), '', idOf('group'))}${row(t('wb_size'), sel('size', st.size, [['', t('wb_size_auto')]].concat(WS.SIZES.map((x) => [x, t('dash_size_' + x)]))), t('wb_size_hint'), idOf('size'))}</div>${errBox('about')}</section>`;

      // 2. data and filters
      const data2 = `<section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_data'))}</h2>
        <div class="wb-field"><label for="${idOf('dataset')}">${esc(t('wb_dataset'))}</label>${sel('dataset', ds, Object.keys(WS.DATASETS).map((d) => [d, label.ds(d)]), 'data-redraw')}<div class="small muted">${esc(t('wb_dataset_hint'))}</div></div>
        <div class="wb-field"><span class="wb-lab">${esc(t('wb_filters'))}</span>${st.filters.length > 1 ? `<div class="wb-row">${row(t('wb_match'), sel('match', st.match, [['all', t('wb_match_all')], ['any', t('wb_match_any')]]), '', idOf('match'))}</div>` : ''}${st.filters.map(filterRow).join('') || `<div class="small muted">${esc(t('wb_no_filters'))}</div>`}${st.filters.length < WS.MAX_FILTERS ? `<div><button class="btn sm" type="button" id="wbAddFilter">${icon('plus')}${esc(t('wb_add_filter'))}</button></div>` : ''}${errBox('data')}</div></section>`;

      // 3. chart type
      const picker = CATS.map(([c, list]) => `<div class="wb-cat"><h3 class="wb-cat-h">${esc(t('wb_vc_' + c))}</h3><div class="wb-viz" role="radiogroup" aria-label="${esc(t('wb_vc_' + c))}">${list.map((x) => `<button type="button" role="radio" aria-checked="${v === x}" class="wb-vcard ${v === x ? 'on' : ''}" data-viz="${x}">${icon(VIZ_ICON[x])}<b>${esc(t('wb_viz_' + x))}</b><span class="small muted">${esc(t('wb_viz_hint_' + x))}</span></button>`).join('')}</div></div>`).join('');

      // 4. values
      let vals = '';
      if (isTable) {
        vals = `<div class="wb-field"><span class="wb-lab">${esc(t('wb_columns', { n: WS.MAX_COLUMNS }))}</span><div class="wb-cols">${fields(ds).map((x) => { const on = st.columns.includes(x.name); return `<label class="wb-check"><input type="checkbox" data-col="${x.name}" ${on ? 'checked' : ''} ${!on && st.columns.length >= WS.MAX_COLUMNS ? 'disabled' : ''}>${esc(label.field(x.name))}</label>`; }).join('')}</div></div>
          <div class="wb-row">${row(t('wb_sort_by'), sel('sortBy', st.sortBy || st.columns[0] || '', fieldOpts(ds)), '', idOf('sortBy'))}${row(t('wb_sort_dir'), sel('sortDir', st.sortDir, [['asc', t('wb_asc')], ['desc', t('wb_descending')]]), '', idOf('sortDir'))}${row(t('wb_rows'), inp('rows', st.rows, `type="number" min="${WS.ROWS.min}" max="${WS.ROWS.max}"`), '', idOf('rows'))}</div>`;
      } else if (isScatter) {
        const n = nums(ds).map((x) => [x.name, label.field(x.name)]);
        vals = `<div class="wb-row">${row(t('wb_x'), sel('x', st.x, n), '', idOf('x'))}${row(t('wb_y'), sel('y', st.y, n), '', idOf('y'))}${row(t('wb_color_by'), sel('colorBy', st.colorBy, [['', t('wb_split_none')]].concat(fieldOpts(ds, (x) => x.type === 'enum' || x.type === 'text'))), '', idOf('colorBy'))}</div>`;
      } else {
        // the calculation
        if (multi && !split) {
          vals += `<div class="wb-field"><span class="wb-lab">${esc(t('wb_series_mode'))}</span>${sel('seriesMode', st.seriesMode, [['measures', t('wb_sm_measures')], ['split', t('wb_sm_split')]], 'data-redraw')}</div>`;
          vals += st.series.map((s, i) => `<div class="wb-field wb-serie">${metric('series.' + i, s, WS.AGGS, t('wb_series_n', { n: i + 1 }))}${st.series.length > 2 ? `<div><button class="btn sm ghost" type="button" data-sdel="${i}">${icon('trash')}${esc(t('wb_remove_series'))}</button></div>` : ''}</div>`).join('');
          vals += st.series.length < WS.MAX_SERIES ? `<div><button class="btn sm" type="button" id="wbAddSeries">${icon('plus')}${esc(t('wb_add_series'))}</button></div>` : '';
        } else {
          if (multi) vals += `<div class="wb-field"><span class="wb-lab">${esc(t('wb_series_mode'))}</span>${sel('seriesMode', st.seriesMode, [['measures', t('wb_sm_measures')], ['split', t('wb_sm_split')]], 'data-redraw')}</div>`;
          vals += `<div class="wb-row"><div class="wb-field"><label for="${idOf('agg')}">${esc(t('wb_agg'))}</label>${sel('agg', st.agg, aggs.map((a) => [a, t('wb_agg_' + a)]), 'data-redraw')}</div>${st.agg === 'count' || st.agg === 'calc' ? '' : `<div class="wb-field"><label for="${idOf('measure')}">${esc(t('wb_measure'))}</label>${sel('measure', st.measure, measureOpts(ds, st.agg))}</div>`}</div>`;
          if (st.agg === 'calc') vals += calcBlock();
        }
        if (isGauge) vals += `<div class="wb-row">${row(t('wb_max'), inp('max', st.max, 'type="number" step="any" min="0"'), '', idOf('max'))}</div>`;
        if (grouped) {
          const dateOpt = dateField(gb) ? row(t('wb_date_by'), sel('dateBy', st.dateBy, WS.DATE_BY.map((d) => [d, t('wb_db_' + d)])), '', idOf('dateBy')) : '';
          const binOpt = gb && gb.type === 'number' ? row(t('wb_bin'), inp('bin', st.bin, 'type="number" step="any" min="0"'), t('wb_bin_hint'), idOf('bin')) : '';
          const cap = WS.MAX_LIMIT[v] || WS.LIMIT.max;
          vals += `<div class="wb-row">${row(t('wb_group_by'), sel('groupBy', st.groupBy, fieldOpts(ds), 'data-redraw'), '', idOf('groupBy'))}${dateOpt}${binOpt}</div>
            <div class="wb-row">${row(t('wb_sort'), sel('sort', st.sort, WS.SORTS.map((s) => [s, t('wb_sort_' + s)])), '', idOf('sort'))}${row(t('wb_limit'), inp('limit', st.limit, `type="number" min="${WS.LIMIT.min}" max="${cap}" placeholder="${WS.DEFAULT_LIMIT[v] || 8}"`), '', idOf('limit'))}</div>`;
        }
        if (matrix && split) {
          const wide = v === 'heatmap' || v === 'pivot', cap2 = wide ? WS.SPLIT_LIMIT.wide : WS.SPLIT_LIMIT.max;
          vals += `<div class="wb-row">${row(t('wb_split_by'), sel('splitBy', st.splitBy, fieldOpts(ds, (x) => x.name !== st.groupBy), 'data-redraw'), '', idOf('splitBy'))}${dateField(sf) ? row(t('wb_date_by'), sel('splitDateBy', st.splitDateBy, WS.DATE_BY.map((d) => [d, t('wb_db_' + d)])), '', idOf('splitDateBy')) : ''}${row(t('wb_split_limit'), inp('splitLimit', st.splitLimit, `type="number" min="${WS.SPLIT_LIMIT.min}" max="${cap2}" placeholder="${wide ? WS.SPLIT_LIMIT.defWide : WS.SPLIT_LIMIT.def}"`), '', idOf('splitLimit'))}</div>`;
        }
        if (WS.SHOW_VIZ.includes(v)) {
          const modes = v === 'pct' ? ['pct_cat'] : WS.SHOW.filter((m) => matrix || !['pct_cat', 'pct_series'].includes(m));
          vals += `<div class="wb-row">${row(t('wb_showas'), sel('showAs', v === 'pct' ? 'pct_cat' : st.showAs, modes.map((m) => [m, t('wb_sa_' + m)]), v === 'pct' ? 'disabled' : ''), '', idOf('showAs'))}</div>`;
        }
        if (v === 'combo') {
          const n = nums(ds).map((x) => [x.name, label.field(x.name)]);
          vals += `<div class="wb-row"><div class="wb-field"><label for="${idOf('line')}">${esc(t('wb_line_shows'))}</label>${sel('line', st.line, [['cumulative', t('wb_line_cumulative')], ['second', t('wb_line_second')]], 'data-redraw')}</div>${st.line === 'second' ? `<div class="wb-field"><label for="${idOf('agg2')}">${esc(t('wb_agg2'))}</label>${sel('agg2', st.agg2, WS.AGGS.map((a) => [a, t('wb_agg_' + a)]), 'data-redraw')}</div>${st.agg2 === 'count' ? '' : `<div class="wb-field"><label for="${idOf('measure2')}">${esc(t('wb_measure2'))}</label>${sel('measure2', st.measure2, st.agg2 === 'distinct' ? fieldOpts(ds) : n)}</div>`}` : ''}</div><div class="small muted">${esc(t('wb_combo_hint'))}</div>`;
        }
      }
      const show = `<section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_show'))}</h2>${picker}${vals}${errBox('show')}</section>`;

      // 5. display options
      let disp = '';
      if (isKpi) disp += `<div class="wb-row">${row(t('wb_format'), sel('format', st.format, WS.FORMATS.map((f2) => [f2, t('wb_fmt_' + f2)])), '', idOf('format'))}${row(t('wb_decimals'), inp('decimals', st.decimals, 'type="number" min="0" max="3" placeholder="auto"'), '', idOf('decimals'))}${row(t('wb_unit'), inp('unit', st.unit, `maxlength="${WS.UNIT_MAX}" placeholder="${esc(t('wb_unit_ph'))}"`), '', idOf('unit'))}</div>`;
      if (isGauge) disp += `<div class="wb-row">${row(t('wb_decimals'), inp('decimals', st.decimals, 'type="number" min="0" max="3" placeholder="auto"'), '', idOf('decimals'))}${row(t('wb_unit'), inp('unit', st.unit, `maxlength="${WS.UNIT_MAX}" placeholder="${esc(t('wb_unit_ph'))}"`), '', idOf('unit'))}</div>`;
      if (WS.TARGET_VIZ.includes(v)) disp += `<div class="wb-row">${row(t('wb_target'), inp('target', st.target, 'type="number" step="any"'), t('wb_target_hint'), idOf('target'))}</div>`;
      if (isTable) disp += `<label class="wb-check"><input type="checkbox" data-s="totals" ${st.totals ? 'checked' : ''}>${esc(t('wb_totals'))}</label>`;
      if (matrix || v === 'combo' || isScatter) disp += `<label class="wb-check"><input type="checkbox" data-s="legend" ${st.legend ? 'checked' : ''}>${esc(t('wb_legend'))}</label>`;
      if (isScatter) disp += `<label class="wb-check"><input type="checkbox" data-s="trend" ${st.trend ? 'checked' : ''}>${esc(t('wb_trend'))}</label>`;
      const display = disp ? `<section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_display'))}</h2>${disp}${errBox('display')}</section>` : '';

      // 6. alert colors
      let alerts = '';
      if (WS.RULE_VIZ.includes(v)) {
        const pick = isTable ? `<div class="wb-row">${row(t('wb_rule_field'), sel('ruleField', st.ruleField, [['', t('wb_rule_field_none')]].concat(st.columns.filter((c) => (fld(ds, c) || {}).type === 'number').map((c) => [c, label.field(c)]))), '', idOf('ruleField'))}</div>` : '';
        alerts = `<section class="card wb-card"><h2 class="wb-h">${esc(t('wb_rules'))}</h2>${pick}${!isTable || st.ruleField ? rulesBlock('alerts') : ''}</section>`;
      }
      return about + data2 + show + display + alerts;
    }

    // ---------- keeping the state consistent ----------
    function fixPart(p, allowAll) {
      const ds = st.dataset;
      if (p.agg === 'count') return;
      if (p.agg === 'distinct') { if (!fld(ds, p.measure)) p.measure = fields(ds)[0].name; return; }
      if (!nums(ds).some((x) => x.name === p.measure)) p.measure = firstNum(ds);
      void allowAll;
    }
    function fix() {
      const ds = st.dataset, v = st.viz, aggs = aggsFor();
      if (!aggs.includes(st.agg)) st.agg = 'count';
      if (st.agg !== 'count' && st.agg !== 'calc') fixPart(st);
      for (const p of [st.calc.a, st.calc.b]) fixPart(p);
      st.series.forEach((s) => fixPart(s));
      if (st.agg2 !== 'count') fixPart({ get agg() { return st.agg2; }, get measure() { return st.measure2; }, set measure(m) { st.measure2 = m; } });
      if (!fld(ds, st.groupBy)) st.groupBy = defaultGroupBy(ds);
      const needSplit = WS.SPLIT_REQUIRED.includes(v) || (WS.MULTI.includes(v) && st.seriesMode === 'split');
      if (needSplit && (!fld(ds, st.splitBy) || st.splitBy === st.groupBy)) st.splitBy = defaultSplit(ds, st.groupBy);
      const cap = WS.MAX_LIMIT[v] || WS.LIMIT.max; if (st.limit !== '' && Number(st.limit) > cap) st.limit = String(cap);
      const scap = v === 'heatmap' || v === 'pivot' ? WS.SPLIT_LIMIT.wide : WS.SPLIT_LIMIT.max; if (st.splitLimit !== '' && Number(st.splitLimit) > scap) st.splitLimit = String(scap);
      const gb = fld(ds, st.groupBy), byLabel = (gb && gb.type === 'date') || WS.TREND_VIZ.includes(v) || v === 'waterfall' || (gb && gb.type === 'number' && st.bin !== '');
      if (byLabel && !['label', 'label_desc'].includes(st.sort)) st.sort = 'label'; else if (!byLabel && st.sort === 'label' && gb && gb.type !== 'date') st.sort = 'value_desc';
      if (!WS.SHOW_VIZ.includes(v)) st.showAs = 'value';
      if (!(WS.MATRIX.includes(v)) && ['pct_cat', 'pct_series'].includes(st.showAs)) st.showAs = 'pct_total';
      if (!st.columns.length) { st.columns = defaultColumns(ds); }
      if (!st.columns.includes(st.sortBy)) st.sortBy = st.columns[0];
      if (st.ruleField && !(st.columns.includes(st.ruleField) && (fld(ds, st.ruleField) || {}).type === 'number')) st.ruleField = '';
      const n = nums(ds); if (!n.some((x) => x.name === st.x)) st.x = n[0] ? n[0].name : ''; if (!n.some((x) => x.name === st.y) || st.y === st.x) st.y = (n.find((x) => x.name !== st.x) || n[0] || {}).name || '';
      if (st.colorBy && !fld(ds, st.colorBy)) st.colorBy = '';
      if (st.format === 'money') { const ok = st.agg === 'calc' ? ['sum', 'diff'].includes(st.calc.op) && [st.calc.a, st.calc.b].every((p) => (fld(ds, p.measure) || {}).money) : (fld(ds, st.measure) || {}).money; if (!ok) st.format = 'number'; }
      for (const r of st.rules) if (r.op !== 'between') r.value2 = '';
    }

    function onDataset(ds) {
      st.dataset = ds; st.filters = []; st.measure = ''; st.measure2 = ''; st.groupBy = defaultGroupBy(ds); st.columns = defaultColumns(ds); st.sortBy = st.columns[0]; st.splitBy = ''; st.ruleField = ''; st.colorBy = ''; st.x = ''; st.y = '';
      for (const p of [st.calc.a, st.calc.b].concat(st.series)) p.measure = '';
      if (st.agg !== 'count' && st.agg !== 'calc') st.measure = firstNum(ds);
      fix();
    }
    function onViz(v) {
      st.viz = v;
      if (v === 'gauge' && st.max === '') st.max = '100';
      if (WS.MULTI.includes(v) && !st.splitBy) st.seriesMode = 'measures';
      if (WS.SPLIT_REQUIRED.includes(v) && !st.splitBy) st.splitBy = defaultSplit(st.dataset, st.groupBy);
      fix();
    }
    const newFilter = () => { const fd = fields(st.dataset)[0]; return { field: fd.name, op: WS.OPS[fd.type][0], value: fd.type === 'enum' ? Object.keys(fd.values)[0] : '', value2: '' }; };

    // ---------- validation and live preview ----------
    function check() {
      try { const meta = WS.meta({ title: st.title, description: st.description, group: st.group }); const spec = WS.normalize(toSpec(st)); return { ok: true, meta, spec }; } catch (e) { return { ok: false, msg: W().specMsg(e), code: e.code || '' }; }
    }
    let lastOk = null;
    function paintPreview() {
      const res = check(), box = $('#wbPreview'), msg = $('#wbMsg'), sv = $('#wbSave'), pb = $('#wbPublish'), hints = $('#wbHints');
      lastOk = res.ok ? res : null;
      msg.textContent = res.ok ? '' : res.msg; msg.hidden = res.ok;
      $$('.wb-err').forEach((el) => { el.hidden = true; el.textContent = ''; });
      $$('.wb-field.has-err').forEach((el) => el.classList.remove('has-err'));
      if (!res.ok) { const el = $('#wbErr_' + errSection(res.code)); if (el) { el.textContent = res.msg; el.hidden = false; } }
      sv.disabled = !res.ok; pb.disabled = !res.ok;
      $('#wbDirty').hidden = !dirty.v;
      if (!res.ok) { box.innerHTML = `<div class="empty small">${esc(t('wb_fix_to_preview'))}</div>`; hints.innerHTML = ''; return; }
      if (!data) { box.innerHTML = `<div class="empty small">${esc(t('wb_no_data'))}</div>`; return; }
      box.innerHTML = '';
      const frame = $('#wbFrame'); frame.className = `dw wb-frame sz-${W().sizeOf(res.spec)}`;
      $('#wbPrevTitle').textContent = res.meta.title;
      PM.dash.h.setWidth(Math.max(240, Math.round(frame.clientWidth || 360) - 38));
      PM.fx.mode = 'USD';
      try { W().renderSpec(box, { title: res.meta.title, spec: res.spec }, data, {}, { limit: true }); } catch (e) { box.innerHTML = `<div class="empty small">${esc(t('wk_broken'))}</div>`; }
      PM.dash.h.bindTips(box); PM.dash.h.countUp(box);
      try {
        const run = WS.run(res.spec, data.datasets[res.spec.dataset] || [], { today: data.today });
        const list = WS.hints(res.spec, run);
        hints.innerHTML = list.length ? `<h3 class="wb-cat-h">${esc(t('wb_notes'))}</h3>${list.map((h) => `<div class="wb-hint">${icon('info')}<span>${esc(t('wk_h_' + h.code, h.vars))}</span></div>`).join('')}` : '';
      } catch (e) { hints.innerHTML = ''; }
    }
    let pt = null;
    const later = () => { dirty.v = true; clearTimeout(pt); pt = setTimeout(paintPreview, 160); };

    const root = $('#content .page');
    root.innerHTML = `<div class="page-head"><div><a class="small wb-back" href="#/widgets?tab=mine">${icon('chev_l', 'flip')}${esc(t('wb_back'))}</a><h1>${esc(t(id ? 'wb_edit' : 'wb_new'))}</h1><p class="muted wm-sub">${esc(t('wb_sub'))}</p></div></div>
      <div class="wb-grid"><div class="wb-form" id="wbForm"></div>
      <aside class="wb-side"><div class="card wb-card wb-sticky"><h2 class="wb-h">${esc(t('wb_preview'))}</h2><p class="small muted">${esc(t('wb_preview_note'))}</p>
        <div class="wb-stage"><section class="dw wb-frame sz-m" id="wbFrame"><header class="dw-h"><h3 id="wbPrevTitle"></h3></header><div class="dw-body" id="wbPreview"></div></section></div>
        <div id="wbMsg" class="wb-msg" role="alert" hidden></div><div id="wbHints" class="wb-hints" aria-live="polite"></div>
        <div class="row wb-actions"><button class="btn" id="wbSave" type="button">${esc(t('wb_save_draft'))}</button><button class="btn primary" id="wbPublish" type="button">${esc(t('wm_publish'))}</button><a class="btn ghost" href="#/widgets?tab=mine">${esc(t('cancel'))}</a></div>
        <div class="small muted" id="wbDirty" hidden>${esc(t('wb_unsaved'))}</div></div></aside></div>`;

    function drawForm() { $('#wbForm').innerHTML = formHtml(); paintPreview(); }
    const form = $('#wbForm');
    // a path like calc.a.agg or rules.1.value reaches into the state
    const setPath = (path, value) => { const parts = path.split('.'); let o = st; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = value; };

    // text boxes update the state in place so typing never loses focus
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.fi !== undefined && el.dataset.fk && el.tagName === 'INPUT' && el.type !== 'checkbox') { st.filters[Number(el.dataset.fi)][el.dataset.fk] = el.value; return later(); }
      if (!el.dataset.s || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') || el.type === 'checkbox') return;
      setPath(el.dataset.s, el.value); later();
    });
    form.addEventListener('change', (e) => {
      const el = e.target, redraw = () => { dirty.v = true; fix(); drawForm(); };
      // filters
      if (el.dataset.fi !== undefined) {
        const f = st.filters[Number(el.dataset.fi)];
        if (el.dataset.fin !== undefined) { const set = new Set(Array.isArray(f.value) ? f.value : []); if (el.checked) set.add(el.dataset.fin); else set.delete(el.dataset.fin); f.value = [...set]; return later(); }
        const k = el.dataset.fk;
        if (k === 'field') { f.field = el.value; const fd = fld(st.dataset, f.field); f.op = WS.OPS[fd.type][0]; f.value = fd.type === 'enum' ? Object.keys(fd.values)[0] : ''; f.value2 = ''; return redraw(); }
        if (k === 'op') { const fd = fld(st.dataset, f.field), multi2 = el.value === 'in' || el.value === 'not_in'; f.op = el.value; f.value = multi2 ? (Array.isArray(f.value) ? f.value : []) : Array.isArray(f.value) ? (fd.type === 'enum' ? Object.keys(fd.values)[0] : '') : (WS.NO_VALUE.includes(f.op) ? '' : f.value); if (f.op !== 'between') f.value2 = ''; return redraw(); }
        f[k] = el.value; return later();
      }
      if (el.dataset.col) { const n = el.dataset.col; st.columns = el.checked ? st.columns.concat(n) : st.columns.filter((x) => x !== n); return redraw(); }
      const p = el.dataset.s; if (!p) return;
      setPath(p, el.type === 'checkbox' ? el.checked : el.value);
      if (p === 'dataset') { onDataset(el.value); return redraw(); }
      if (p === 'agg' && st.agg !== 'count' && st.agg !== 'calc') fixPart(st);
      if (p === 'bin' || p === 'groupBy' || p === 'dateBy') { const gb = fld(st.dataset, st.groupBy); if (p === 'groupBy') st.sort = (gb && gb.type === 'date') || WS.TREND_VIZ.includes(st.viz) ? 'label' : 'value_desc'; }
      if (el.dataset.redraw !== undefined) return redraw();
      fix(); later();
    });
    form.addEventListener('click', (e) => {
      const v = e.target.closest('[data-viz]'); if (v) { onViz(v.dataset.viz); dirty.v = true; return drawForm(); }
      if (e.target.closest('#wbAddFilter')) { st.filters.push(newFilter()); dirty.v = true; return drawForm(); }
      const d = e.target.closest('[data-fdel]'); if (d) { st.filters.splice(Number(d.dataset.fdel), 1); dirty.v = true; return drawForm(); }
      if (e.target.closest('#wbAddRule')) { st.rules.push({ op: 'gte', value: '', value2: '', tone: st.rules.length ? 'warn' : 'bad' }); dirty.v = true; return drawForm(); }
      const rd = e.target.closest('[data-rdel]'); if (rd) { st.rules.splice(Number(rd.dataset.rdel), 1); dirty.v = true; return drawForm(); }
      const rt = e.target.closest('[data-rt]'); if (rt) { st.rules[Number(rt.dataset.rt)].tone = rt.dataset.tone; dirty.v = true; return drawForm(); }
      if (e.target.closest('#wbAddSeries')) { st.series.push({ agg: 'sum', measure: firstNum(st.dataset) }); dirty.v = true; fix(); return drawForm(); }
      const sd = e.target.closest('[data-sdel]'); if (sd) { st.series.splice(Number(sd.dataset.sdel), 1); dirty.v = true; return drawForm(); }
    });

    async function save() {
      const res = check(); if (!res.ok) { toast(res.msg, 'err'); return null; }
      const body = { title: res.meta.title, description: res.meta.description, group: res.meta.group, spec: res.spec };
      const r = st.id ? await api('PUT', `/api/widgets/${st.id}`, body) : await api('POST', '/api/widgets', body);
      st.id = r.widget.id; saved = r.widget; dirty.v = false;
      if (!id || String(id) !== String(st.id)) history.replaceState(null, '', `#/widgets/${st.id}/edit`);
      $('#wbDirty').hidden = true;
      return r.widget;
    }
    $('#wbSave').onclick = (ev) => PM.busy(ev.currentTarget, async () => { if (await save()) toast(t('wb_saved'), 'ok'); });
    $('#wbPublish').onclick = (ev) => PM.busy(ev.currentTarget, async () => {
      const res = check(); if (!res.ok) { toast(res.msg, 'err'); return; }
      const update = saved && saved.status === 'published';
      const ok = await PM.confirmDlg({ title: t(update ? 'wm_publish_update' : 'wm_publish'), message: esc(t('wm_publish_msg', { title: res.meta.title })), ok: t(update ? 'wm_publish_update' : 'wm_publish') });
      if (!ok) return;
      const w = await save(); if (!w) return;
      await api('POST', `/api/widgets/${w.id}/publish`);
      toast(t('wm_published', { title: w.title }), 'ok');
      location.hash = '#/widgets?tab=mine';
    });

    if (!id) onDataset(st.dataset); else fix();
    drawForm();
    void lastOk; void clone;
    let rt = null;
    window.addEventListener('resize', function onR() { if (!$('#wbFrame')) return window.removeEventListener('resize', onR); clearTimeout(rt); rt = setTimeout(paintPreview, 200); });
  };
})();
