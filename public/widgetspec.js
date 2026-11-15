/* Widget specs. A custom widget is plain data, never code, so a widget published to every user can only ever read the
   viewer's own data through the fixed datasets below. This one file is used by the server (to validate a widget before it
   is saved or published) and by the browser (to compute what a widget shows), so both always agree.
   It has no access to the page or the network.
   Version 1 specs stay valid. Every option added later is optional and is stored only when it is set. */
(function () {
  'use strict';

  const GROUPS = ['overview', 'schedule', 'financials', 'risk', 'delivery', 'team', 'trends', 'other'];
  const SCOPES = ['portfolio', 'project'];
  // Chart families: single number, comparison, trend, share, relationship and lists
  const VIZ = ['kpi', 'gauge', 'bar', 'column', 'cluster', 'stacked', 'stackedbar', 'pct', 'waterfall', 'line', 'lines', 'area', 'combo', 'donut', 'pie', 'funnel', 'radar', 'scatter', 'heatmap', 'table', 'pivot'];
  const MATRIX = ['stacked', 'stackedbar', 'pct', 'cluster', 'lines', 'heatmap', 'pivot']; // a group by a second field or by several measures
  const MULTI = ['cluster', 'lines']; // may use several measures instead of a second field
  const SPLIT_REQUIRED = ['stacked', 'stackedbar', 'pct', 'heatmap', 'pivot'];
  const PARTS = ['stacked', 'stackedbar', 'pct']; // parts that add up, so only count or total make sense
  const SHARE = ['donut', 'pie', 'funnel', 'waterfall']; // count or total only
  const TREND_VIZ = ['line', 'area', 'combo', 'lines'];
  const GROUPED = ['bar', 'column', 'line', 'area', 'combo', 'donut', 'pie', 'radar', 'funnel', 'waterfall'].concat(MATRIX);
  const SHOW_VIZ = ['bar', 'column', 'line', 'area', 'radar', 'cluster', 'stacked', 'stackedbar', 'pct', 'lines', 'heatmap', 'pivot']; // charts that can show values as a share, a change or a rank
  const RULE_VIZ = ['kpi', 'gauge', 'bar', 'column', 'table'];
  const TARGET_VIZ = ['kpi', 'column', 'line', 'area', 'combo', 'cluster', 'lines'];
  const LINE_MODES = ['cumulative', 'second'];
  // groups drawn by default and the most each display allows
  const DEFAULT_LIMIT = { donut: 4, pie: 4, radar: 6, funnel: 5, line: 12, area: 12, combo: 12, lines: 12, waterfall: 8, heatmap: 10, pivot: 10 };
  const MAX_LIMIT = { donut: 4, pie: 6, radar: 8, funnel: 8, heatmap: 15, pivot: 15 };
  const SPLIT_LIMIT = { min: 2, max: 4, wide: 8, def: 4, defWide: 6 }; // heat maps and pivots may show more columns than a chart
  const AGGS = ['count', 'sum', 'avg', 'min', 'max', 'median', 'distinct', 'stdev'];
  const CALC_OPS = ['ratio', 'pct', 'diff', 'sum', 'product'];
  const SORTS = ['value_desc', 'value_asc', 'label', 'label_desc'];
  const FORMATS = ['number', 'percent', 'money', 'compact'];
  const SHOW = ['value', 'pct_total', 'pct_cat', 'pct_series', 'running', 'diff_prev', 'pct_diff_prev', 'rank'];
  const DATE_BY = ['day', 'month', 'quarter', 'year'];
  const SIZES = ['s', 'm', 'l'];
  const TONES = ['good', 'warn', 'bad', 'info', 'violet', 'neutral']; // alert colors
  const RULE_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between'];
  const MAX_FILTERS = 8, MAX_COLUMNS = 8, MAX_RULES = 6, MAX_SERIES = 4, MAX_POINTS = 400;
  const LIMIT = { min: 3, max: 12 }, ROWS = { min: 3, max: 50 };
  const TITLE_MAX = 60, DESC_MAX = 200, VALUE_MAX = 80, UNIT_MAX = 12;
  const SPEC_BYTES = 12000;

  const T = { text: 'text', enum: 'enum', number: 'number', date: 'date' };
  const level = { High: 'bad', Medium: 'warn', Low: 'ok' };
  const f = (name, type, extra) => Object.assign({ name, type }, extra || {});

  // Fields and enum values are names. The screen translates them (labels are wf_<field>, enum values wv_<value>).
  const DATASETS = {
    projects: [
      f('name', T.text), f('client', T.text), f('health', T.enum, { values: { green: 'ok', amber: 'warn', red: 'bad' } }),
      f('status', T.text), f('progress', T.number, { unit: 'percent' }), f('planned', T.number, { unit: 'percent' }), f('spi', T.number),
      f('overdue', T.number), f('pending_review', T.number), f('value', T.number, { money: true }), f('currency', T.text),
      f('forecast_end', T.date), f('contract_end', T.date), f('slip_days', T.number), f('days_left', T.number),
    ],
    tasks: [
      f('project', T.text), f('name', T.text), f('owner', T.text), f('start', T.date), f('finish', T.date), f('duration', T.number),
      f('progress', T.number, { unit: 'percent' }),
      f('status', T.enum, { values: { done: 'ok', active: 'c1', todo: 'idle', late: 'bad' } }),
      f('critical', T.enum, { values: { yes: 'c1', no: null } }), f('milestone', T.enum, { values: { yes: 'c1', no: null } }), f('days_late', T.number),
    ],
    payments: [
      f('project', T.text), f('title', T.text), f('due', T.date), f('amount', T.number, { money: true }), f('currency', T.text),
      f('state', T.enum, { values: { paid: 'ok', invoiced: 'c1', pending: 'idle' } }), f('late', T.enum, { values: { yes: 'bad', no: 'ok' } }), f('days_late', T.number),
    ],
    risks: [
      f('project', T.text), f('title', T.text), f('probability', T.enum, { values: level }), f('impact', T.enum, { values: level }),
      f('state', T.enum, { values: { open: 'bad', mitigated: 'ok', transferred: 'idle', closed: 'ok' } }), f('score', T.number),
    ],
    deliverables: [
      f('project', T.text), f('title', T.text), f('due', T.date), f('state', T.enum, { values: { open: 'idle', closed: 'ok' } }),
      f('late', T.enum, { values: { yes: 'bad', no: 'ok' } }), f('days_late', T.number),
    ],
  };
  const fieldOf = (ds, name) => (DATASETS[ds] || []).find((x) => x.name === name) || null;
  const numericFields = (ds) => (DATASETS[ds] || []).filter((x) => x.type === T.number);

  // Which operators a field type offers.
  const OPS = {
    text: ['eq', 'ne', 'contains', 'not_contains', 'starts_with', 'empty', 'not_empty'],
    enum: ['eq', 'ne', 'in', 'not_in'],
    number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
    date: ['before_today', 'within_days', 'last_days', 'this_month', 'this_quarter', 'this_year', 'gt', 'lt', 'between', 'empty', 'not_empty'],
  };
  const NO_VALUE = ['before_today', 'this_month', 'this_quarter', 'this_year', 'empty', 'not_empty'];

  // The message is plain English for the server and logs. The code and vars let the screen show it in either language.
  class SpecError extends Error { constructor(message, code, vars) { super(message); this.code = code; this.vars = vars || {}; } }
  const bad = (m, code, vars) => { throw new SpecError(m, code, vars); };
  const isInt = (n) => Number.isInteger(n);
  const isNum = (v) => v !== '' && v != null && Number.isFinite(Number(v));
  const cleanText = (s, max, label, required, code) => {
    const v = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (required && !v) bad(label + ' is required', code + '_required');
    if (v.length > max) bad(label + ' is too long (at most ' + max + ' characters)', code + '_long', { max });
    return v;
  };
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

  // ---------- reading a spec ----------
  function filterOf(ds, x) {
    const fd = x && fieldOf(ds, x.field);
    if (!fd) bad('A filter uses a field that is not available', 'filter_field');
    if (!OPS[fd.type].includes(x.op)) bad('A filter uses a condition that does not fit its field', 'filter_op');
    const out = { field: fd.name, op: x.op, value: x.value };
    if (NO_VALUE.includes(x.op)) out.value = '';
    else if (x.op === 'within_days' || x.op === 'last_days') { const n = Number(x.value); if (!isNum(x.value) || !isInt(n) || n < 0 || n > 3650) bad('Days must be a whole number from 0 to 3650', 'days'); out.value = n; }
    else if (x.op === 'between') {
      if (fd.type === T.date) {
        if (!isDate(x.value) || !isDate(x.value2)) bad('A date range needs two dates', 'filter_range_dates');
        if (String(x.value2) < String(x.value)) bad('The range must start before it ends', 'filter_range_order');
        out.value = String(x.value); out.value2 = String(x.value2);
      } else {
        if (!isNum(x.value) || !isNum(x.value2)) bad('A range needs two numbers', 'filter_range_numbers');
        if (Number(x.value2) < Number(x.value)) bad('The range must start low and end high', 'filter_range_order');
        out.value = Number(x.value); out.value2 = Number(x.value2);
      }
    } else if (x.op === 'in' || x.op === 'not_in') {
      const list = (Array.isArray(x.value) ? x.value : String(x.value == null ? '' : x.value).split(',')).map(String).filter(Boolean);
      const uniq = [...new Set(list)];
      if (!uniq.length) bad('Choose at least one value', 'filter_in_none');
      if (uniq.some((v) => !Object.prototype.hasOwnProperty.call(fd.values, v))) bad('A filter uses a value that is not available', 'filter_value');
      out.value = uniq;
    } else if (fd.type === T.number) { const n = Number(x.value); if (!isNum(x.value)) bad('A number filter needs a number', 'filter_number'); out.value = n; }
    else if (fd.type === T.enum) { const v = String(x.value); if (!Object.prototype.hasOwnProperty.call(fd.values, v)) bad('A filter uses a value that is not available', 'filter_value'); out.value = v; }
    else if (fd.type === T.date) { if (!isDate(x.value)) bad('A date filter needs a date', 'filter_date'); out.value = String(x.value); }
    else out.value = cleanText(x.value, VALUE_MAX, 'The filter text', true, 'filter_text');
    return out;
  }

  // One calculation: how to combine the rows of a group into a number. A calculated field combines two of them.
  function metricOf(ds, src, viz, codes) {
    const agg = src.agg == null || src.agg === '' ? 'count' : src.agg;
    if (agg === 'calc') {
      const c = src.calc;
      if (!c || typeof c !== 'object' || !CALC_OPS.includes(c.op)) bad('Choose how to combine the two numbers', 'calc_op');
      const part = (p, code) => {
        if (!p || typeof p !== 'object') bad('A calculated field needs two numbers', code);
        const a = p.agg == null || p.agg === '' ? 'count' : p.agg;
        if (!AGGS.includes(a)) bad('Choose how to calculate each part', code);
        const o = { agg: a };
        if (a !== 'count') { const fd = fieldOf(ds, p.measure); if (!fd || (a !== 'distinct' && fd.type !== T.number)) bad('Choose a number field for each part', code); o.measure = fd.name; }
        return o;
      };
      return { agg: 'calc', calc: { op: c.op, a: part(c.a, 'calc_a'), b: part(c.b, 'calc_b') } };
    }
    if (!AGGS.includes(agg)) bad('Choose how to calculate the value', codes[0]);
    const out = { agg };
    if (agg !== 'count') {
      const fd = fieldOf(ds, src.measure);
      if (!fd || (agg !== 'distinct' && fd.type !== T.number)) bad(agg === 'distinct' ? 'Choose a field to count' : 'Choose a number field to calculate', codes[1]);
      out.measure = fd.name;
    }
    return out;
  }
  const additive = (m) => m.agg === 'count' || m.agg === 'sum';

  function rulesOf(raw) {
    if (raw == null || (Array.isArray(raw) && !raw.length)) return null;
    if (!Array.isArray(raw)) bad('The alert rules are not valid', 'rules_bad');
    if (raw.length > MAX_RULES) bad('Use at most ' + MAX_RULES + ' alert rules', 'rules_max', { n: MAX_RULES });
    return raw.map((r) => {
      if (!r || !RULE_OPS.includes(r.op)) bad('An alert rule needs a condition', 'rule_op');
      if (!TONES.includes(r.tone)) bad('An alert rule needs a color', 'rule_tone');
      if (!isNum(r.value)) bad('An alert rule needs a number', 'rule_number');
      const o = { op: r.op, value: Number(r.value), tone: r.tone };
      if (r.op === 'between') {
        if (!isNum(r.value2)) bad('A range rule needs two numbers', 'rule_number');
        if (Number(r.value2) < o.value) bad('The range must start low and end high', 'rule_range');
        o.value2 = Number(r.value2);
      }
      return o;
    });
  }

  // Returns a clean copy of the spec or throws SpecError with a plain sentence. Nothing outside the whitelist survives.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('The widget definition is missing', 'spec_missing');
    if (JSON.stringify(raw).length > SPEC_BYTES) bad('The widget definition is too large', 'spec_large');
    const ds = raw.dataset;
    if (!DATASETS[ds]) bad('Choose the data the widget reads', 'dataset');
    const viz = raw.viz;
    if (!VIZ.includes(viz)) bad('Choose how the widget is shown', 'viz');
    const out = { v: 1, dataset: ds, viz, filters: [] };

    const filters = Array.isArray(raw.filters) ? raw.filters : [];
    if (filters.length > MAX_FILTERS) bad('Use at most ' + MAX_FILTERS + ' filters', 'filters_max', { n: MAX_FILTERS });
    for (const x of filters) out.filters.push(filterOf(ds, x));
    if (raw.match === 'any' && out.filters.length > 1) out.match = 'any';
    if (SIZES.includes(raw.size)) out.size = raw.size;

    // options shared by several displays, added just before a spec is returned
    const finish = () => {
      if (RULE_VIZ.includes(viz)) { const r = rulesOf(raw.rules); if (r) out.rules = r; }
      if (TARGET_VIZ.includes(viz) && raw.target != null && raw.target !== '') { if (!isNum(raw.target)) bad('The target must be a number', 'target'); out.target = Number(raw.target); }
      if ((viz === 'kpi' || viz === 'gauge') && raw.decimals != null && raw.decimals !== '') { const d = Number(raw.decimals); if (!isInt(d) || d < 0 || d > 3) bad('Decimals must be a whole number from 0 to 3', 'decimals'); out.decimals = d; }
      if (viz === 'kpi' || viz === 'gauge') { const u = cleanText(raw.unit, UNIT_MAX, 'The unit', false, 'unit'); if (u) out.unit = u; }
      if ((MATRIX.includes(viz) || viz === 'combo' || viz === 'scatter') && raw.legend === false) out.legend = false;
      return out;
    };

    if (viz === 'table') {
      const cols = Array.isArray(raw.columns) ? raw.columns : [];
      if (!cols.length) bad('Choose at least one column', 'columns_none');
      if (cols.length > MAX_COLUMNS) bad('Use at most ' + MAX_COLUMNS + ' columns', 'columns_max', { n: MAX_COLUMNS });
      const seen = new Set();
      out.columns = cols.map((c) => { const fd = fieldOf(ds, c); if (!fd) bad('A column is not available', 'column_bad'); if (seen.has(fd.name)) bad('A column is chosen twice', 'column_dup'); seen.add(fd.name); return fd.name; });
      const sb = raw.sortBy == null || raw.sortBy === '' ? out.columns[0] : raw.sortBy;
      if (!fieldOf(ds, sb)) bad('Sort by a field that is available', 'sort_bad');
      out.sortBy = sb;
      out.sortDir = raw.sortDir === 'desc' ? 'desc' : 'asc';
      const rows = raw.rows == null ? 10 : Number(raw.rows);
      if (!isInt(rows) || rows < ROWS.min || rows > ROWS.max) bad('Rows must be from ' + ROWS.min + ' to ' + ROWS.max, 'rows_range', { min: ROWS.min, max: ROWS.max });
      out.rows = rows;
      if (raw.totals === true) out.totals = true;
      if (raw.ruleField != null && raw.ruleField !== '') {
        const rf = fieldOf(ds, raw.ruleField);
        if (!rf || rf.type !== T.number || !out.columns.includes(rf.name)) bad('Color the cells of a number column that is shown', 'rule_field');
        out.ruleField = rf.name;
      }
      return finish();
    }

    if (viz === 'scatter') {
      const fx = fieldOf(ds, raw.x), fy = fieldOf(ds, raw.y);
      if (!fx || fx.type !== T.number) bad('Choose a number field for the horizontal axis', 'scatter_x');
      if (!fy || fy.type !== T.number) bad('Choose a number field for the vertical axis', 'scatter_y');
      if (fx.name === fy.name) bad('Choose two different number fields', 'scatter_same');
      out.x = fx.name; out.y = fy.name;
      if (raw.colorBy != null && raw.colorBy !== '') {
        const cb = fieldOf(ds, raw.colorBy);
        if (!cb || (cb.type !== T.enum && cb.type !== T.text)) bad('Color the points by a text or status field', 'scatter_color');
        out.colorBy = cb.name;
      }
      if (raw.trend === true) out.trend = true;
      return finish();
    }

    // the value: a calculation, or for some charts a list of calculations
    let main;
    if (MULTI.includes(viz) && !(raw.splitBy != null && raw.splitBy !== '')) {
      const list = Array.isArray(raw.series) ? raw.series : [];
      if (list.length < 2) bad('Add at least two measures, or split by a field', 'series_min');
      if (list.length > MAX_SERIES) bad('Use at most ' + MAX_SERIES + ' measures', 'series_max', { n: MAX_SERIES });
      out.series = list.map((s) => metricOf(ds, s || {}, viz, ['agg', 'measure']));
      main = out.series[0];
    } else main = metricOf(ds, raw, viz, ['agg', 'measure']);
    Object.assign(out, main);
    const agg = out.agg;
    if (viz === 'donut' && !additive(out)) bad('A donut shows shares of a whole, so use count or sum', 'donut_agg');
    if (viz === 'pie' && !additive(out)) bad('A pie shows shares of a whole, so use count or sum', 'pie_agg');
    if (viz === 'funnel' && !additive(out)) bad('A funnel shows steps that narrow, so use count or sum', 'funnel_agg');
    if (viz === 'waterfall' && !additive(out)) bad('A waterfall adds steps together, so use count or sum', 'waterfall_agg');
    if (PARTS.includes(viz) && !additive(out)) bad('Stacked charts add parts together, so use count or sum', 'stack_agg');

    if (viz === 'kpi') {
      out.format = FORMATS.includes(raw.format) ? raw.format : 'number';
      if (out.format === 'money') {
        let ok;
        if (agg === 'calc') { const c = out.calc, m = (p) => p.measure && fieldOf(ds, p.measure) && fieldOf(ds, p.measure).money; ok = (c.op === 'sum' || c.op === 'diff') && m(c.a) && m(c.b); } else { const m = out.measure && fieldOf(ds, out.measure); ok = m && m.money; }
        if (!ok) bad('Money format needs an amount or value field', 'money_format');
      }
      const tone = raw.tone;
      if (tone && typeof tone === 'object' && (tone.warn != null || tone.bad != null)) {
        const w = tone.warn == null || tone.warn === '' ? null : Number(tone.warn), b = tone.bad == null || tone.bad === '' ? null : Number(tone.bad);
        if ((w != null && !Number.isFinite(w)) || (b != null && !Number.isFinite(b))) bad('Alert levels must be numbers', 'tone_numbers');
        out.tone = { dir: tone.dir === 'below' ? 'below' : 'above', warn: w, bad: b };
      }
      return finish();
    }
    if (viz === 'gauge') {
      let max = raw.max;
      if (max == null || max === '') { const m = out.measure && fieldOf(ds, out.measure); if (m && m.unit === 'percent' && agg !== 'calc') max = 100; else bad('Enter the value the gauge ends at', 'gauge_max'); }
      if (!isNum(max) || Number(max) <= 0) bad('The gauge end must be a number above zero', 'gauge_max');
      out.max = Number(max);
      return finish();
    }

    const gb = fieldOf(ds, raw.groupBy);
    if (!gb) bad('Choose what to group by', 'group_by');
    out.groupBy = gb.name;
    if (gb.type === T.date && raw.dateBy != null && raw.dateBy !== '') {
      if (!DATE_BY.includes(raw.dateBy)) bad('Choose how to group the dates', 'date_by');
      if (raw.dateBy !== 'month') out.dateBy = raw.dateBy;
    } else if (gb.type === T.number && raw.bin != null && raw.bin !== '') {
      if (!isNum(raw.bin) || Number(raw.bin) <= 0) bad('The range size must be a number above zero', 'bin');
      out.bin = Number(raw.bin);
    }
    const labelOrder = gb.type === T.date || !!out.bin || TREND_VIZ.includes(viz) || viz === 'waterfall';
    out.sort = SORTS.includes(raw.sort) ? raw.sort : (labelOrder ? 'label' : 'value_desc');
    const limit = raw.limit == null || raw.limit === '' ? (DEFAULT_LIMIT[viz] || 8) : Number(raw.limit);
    const cap = MAX_LIMIT[viz] || LIMIT.max;
    if (!isInt(limit) || limit < LIMIT.min || limit > cap) bad('The number of groups must be from ' + LIMIT.min + ' to ' + cap, 'groups_range', { min: LIMIT.min, max: cap });
    out.limit = limit;

    if (SHOW_VIZ.includes(viz) && raw.showAs != null && raw.showAs !== '' && raw.showAs !== 'value') {
      if (!SHOW.includes(raw.showAs)) bad('Choose how to show the values', 'show_as');
      out.showAs = raw.showAs;
    }
    if (viz === 'pct') out.showAs = 'pct_cat';

    if (MATRIX.includes(viz)) {
      if (raw.splitBy != null && raw.splitBy !== '') {
        const sf = fieldOf(ds, raw.splitBy);
        if (!sf) bad('Choose a field to split the series', 'split_by');
        if (sf.name === gb.name) bad('Split by a different field than the one you group by', 'split_same');
        out.splitBy = sf.name;
        if (sf.type === T.date && raw.splitDateBy && raw.splitDateBy !== 'month') { if (!DATE_BY.includes(raw.splitDateBy)) bad('Choose how to group the dates', 'date_by'); out.splitDateBy = raw.splitDateBy; }
        const wide = viz === 'heatmap' || viz === 'pivot', max = wide ? SPLIT_LIMIT.wide : SPLIT_LIMIT.max;
        const sl = raw.splitLimit == null || raw.splitLimit === '' ? (wide ? SPLIT_LIMIT.defWide : SPLIT_LIMIT.def) : Number(raw.splitLimit);
        if (!isInt(sl) || sl < SPLIT_LIMIT.min || sl > max) bad('The number of series must be from ' + SPLIT_LIMIT.min + ' to ' + max, 'split_range', { min: SPLIT_LIMIT.min, max });
        out.splitLimit = sl;
        delete out.series;
      } else if (SPLIT_REQUIRED.includes(viz)) bad('Choose what to split the series by', 'split_required');
    }

    if (viz === 'combo') {
      out.line = raw.line === 'second' ? 'second' : 'cumulative';
      if (out.line === 'cumulative') {
        if (agg !== 'count' && agg !== 'sum') bad('A running total needs count or sum', 'combo_cumulative');
      } else {
        const a2 = raw.agg2 == null || raw.agg2 === '' ? 'count' : raw.agg2;
        if (!AGGS.includes(a2)) bad('Choose how to calculate the line', 'agg2');
        out.agg2 = a2;
        if (a2 !== 'count') {
          const f2 = fieldOf(ds, raw.measure2);
          if (!f2 || (a2 !== 'distinct' && f2.type !== T.number)) bad('Choose a number field for the line', 'measure2');
          out.measure2 = f2.name;
        }
      }
    }
    return finish();
  }

  function meta(raw) {
    const m = raw || {};
    const group = GROUPS.includes(m.group) ? m.group : bad('Choose a group for the widget', 'group');
    return { title: cleanText(m.title, TITLE_MAX, 'The title', true, 'title'), description: cleanText(m.description, DESC_MAX, 'The description', false, 'desc'), group };
  }

  // ---------- computing ----------
  const DAY = 864e5;
  const dnum = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY : null);
  const blank = (v) => v == null || v === '';

  function matches(row, flt, fd, today) {
    const v = row[flt.field];
    switch (flt.op) {
      case 'eq': return fd.type === T.number ? Number(v) === flt.value : String(v == null ? '' : v) === String(flt.value);
      case 'ne': return fd.type === T.number ? Number(v) !== flt.value : String(v == null ? '' : v) !== String(flt.value);
      case 'in': return flt.value.includes(String(v == null ? '' : v));
      case 'not_in': return !flt.value.includes(String(v == null ? '' : v));
      case 'contains': return String(v == null ? '' : v).toLowerCase().includes(String(flt.value).toLowerCase());
      case 'not_contains': return !String(v == null ? '' : v).toLowerCase().includes(String(flt.value).toLowerCase());
      case 'starts_with': return String(v == null ? '' : v).toLowerCase().startsWith(String(flt.value).toLowerCase());
      case 'empty': return blank(v);
      case 'not_empty': return !blank(v);
      case 'gt': return fd.type === T.date ? !!v && String(v) > flt.value : v != null && Number(v) > flt.value;
      case 'gte': return v != null && Number(v) >= flt.value;
      case 'lt': return fd.type === T.date ? !!v && String(v) < flt.value : v != null && Number(v) < flt.value;
      case 'lte': return v != null && Number(v) <= flt.value;
      case 'between': return fd.type === T.date ? !!v && String(v).slice(0, 10) >= flt.value && String(v).slice(0, 10) <= flt.value2 : !blank(v) && Number(v) >= flt.value && Number(v) <= flt.value2;
      case 'before_today': return !!v && String(v) < today;
      case 'within_days': { const d = dnum(v), t = dnum(today); return d != null && t != null && d >= t && d <= t + flt.value; }
      case 'last_days': { const d = dnum(v), t = dnum(today); return d != null && t != null && d <= t && d >= t - flt.value; }
      case 'this_month': return !!v && String(v).slice(0, 7) === today.slice(0, 7);
      case 'this_year': return !!v && String(v).slice(0, 4) === today.slice(0, 4);
      case 'this_quarter': return !!v && String(v).slice(0, 4) === today.slice(0, 4) && Math.floor((+String(v).slice(5, 7) - 1) / 3) === Math.floor((+today.slice(5, 7) - 1) / 3);
      default: return false;
    }
  }
  const filtered = (spec, rows, today) => {
    const tests = (spec.filters || []).map((x) => [x, fieldOf(spec.dataset, x.field)]);
    if (!tests.length) return rows;
    return rows.filter((r) => (spec.match === 'any' ? tests.some(([x, fd]) => matches(r, x, fd, today)) : tests.every(([x, fd]) => matches(r, x, fd, today))));
  };

  // The number a calculation gives for a list of rows. opts.convert(value, row) turns a money value into the display currency
  // (the overview converts, a project keeps its own).
  function one(ds, def, rows, opts) {
    if (def.agg === 'count') return rows.length;
    if (def.agg === 'distinct') { const s = new Set(); for (const r of rows) { const v = r[def.measure]; if (!blank(v)) s.add(String(v)); } return s.size; }
    const fd = fieldOf(ds, def.measure);
    const conv = fd && fd.money && opts && opts.convert ? opts.convert : (v) => v;
    const vals = [];
    for (const r of rows) { const v = r[def.measure]; if (!blank(v) && Number.isFinite(Number(v))) vals.push(conv(Number(v), r)); }
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    switch (def.agg) {
      case 'sum': return sum;
      case 'avg': return sum / vals.length;
      case 'min': return Math.min(...vals);
      case 'max': return Math.max(...vals);
      case 'median': { const s = vals.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
      case 'stdev': { if (vals.length < 2) return 0; const mean = sum / vals.length; return Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (vals.length - 1)); }
      default: return null;
    }
  }
  const combine = (op, a, b) => {
    if (op === 'sum') return a == null && b == null ? null : (a || 0) + (b || 0);
    if (a == null || b == null) return null;
    if (op === 'diff') return a - b;
    if (op === 'product') return a * b;
    if (b === 0) return null;
    return op === 'pct' ? (a / b) * 100 : a / b;
  };
  const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  function measureOf(spec, rows, opts) {
    const v = spec.agg === 'calc' ? combine(spec.calc.op, one(spec.dataset, spec.calc.a, rows, opts), one(spec.dataset, spec.calc.b, rows, opts)) : one(spec.dataset, spec, rows, opts);
    return { value: spec.agg === 'count' || spec.agg === 'distinct' ? v : round2(v), n: rows.length };
  }

  // The alert color a value gets. The first rule that fits wins. A spec without rules gets nothing.
  function toneOf(rules, v) {
    if (!rules || v == null || !Number.isFinite(Number(v))) return '';
    const n = Number(v);
    for (const r of rules) {
      const hit = r.op === 'gt' ? n > r.value : r.op === 'gte' ? n >= r.value : r.op === 'lt' ? n < r.value : r.op === 'lte' ? n <= r.value : r.op === 'eq' ? n === r.value : n >= r.value && n <= r.value2;
      if (hit) return r.tone;
    }
    return '';
  }

  const QKEY = (s) => s.slice(0, 4) + '-Q' + (Math.floor((+s.slice(5, 7) - 1) / 3) + 1);
  const keyOf = (fd, row, by, bin) => {
    const v = row[fd.name];
    if (blank(v)) return '';
    if (fd.type === T.date) { const s = String(v); return by === 'day' ? s.slice(0, 10) : by === 'year' ? s.slice(0, 4) : by === 'quarter' ? QKEY(s) : s.slice(0, 7); }
    if (fd.type === T.number && bin) { const n = Number(v); return Number.isFinite(n) ? String(+(Math.floor(n / bin) * bin).toFixed(6)) : ''; }
    return String(v);
  };
  const KEY_OK = { month: /^\d{4}-\d{2}$/, day: /^\d{4}-\d{2}-\d{2}$/, quarter: /^\d{4}-Q\d$/, year: /^\d{4}$/ };
  const cmpKey = (a, b) => (a === '' ? 1 : b === '' ? -1 : String(a).localeCompare(String(b), undefined, { numeric: true }));

  // Changes plain values into a share, a change or a rank. list is an array of arrays (categories by series), so a share of a
  // column or of a row can be told apart from a share of the whole.
  function showAs(mode, grid) {
    const rows = grid.length, cols = rows ? grid[0].length : 0;
    const tot = grid.flat().reduce((a, b) => a + b, 0);
    const colTot = (c) => grid.reduce((a, r) => a + r[c], 0), rowTot = (r) => grid[r].reduce((a, b) => a + b, 0);
    const out = grid.map((r) => r.slice());
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (mode === 'pct_total') out[r][c] = tot ? (v / tot) * 100 : 0;
        else if (mode === 'pct_cat') out[r][c] = colTot(c) ? (v / colTot(c)) * 100 : 0; // c is the category, r is the series
        else if (mode === 'pct_series') out[r][c] = rowTot(r) ? (v / rowTot(r)) * 100 : 0;
        else if (mode === 'running') out[r][c] = (c ? out[r][c - 1] : 0) + v;
        else if (mode === 'diff_prev') out[r][c] = c ? v - grid[r][c - 1] : 0;
        else if (mode === 'pct_diff_prev') out[r][c] = c && grid[r][c - 1] ? ((v - grid[r][c - 1]) / Math.abs(grid[r][c - 1])) * 100 : 0;
        else if (mode === 'rank') out[r][c] = 1 + grid.filter((x) => x[c] > v).length;
        else if (mode === 'rank_row') out[r][c] = 1 + grid[r].filter((x) => x > v).length; // one series, ranked across its categories
        out[r][c] = Math.round(out[r][c] * 100) / 100;
      }
    }
    return out;
  }

  // Returns { kind: 'kpi' | 'gauge' | 'groups' | 'matrix' | 'waterfall' | 'points' | 'table', ... }. Never throws on odd rows.
  function run(spec, rows, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const set = filtered(spec, Array.isArray(rows) ? rows : [], today);
    if (spec.viz === 'kpi' || spec.viz === 'gauge') {
      const m = measureOf(spec, set, opts);
      let tone = '';
      if (spec.rules) tone = toneOf(spec.rules, m.value);
      else if (spec.tone && m.value != null) {
        const above = spec.tone.dir === 'above', hit = (lim) => lim != null && (above ? m.value >= lim : m.value <= lim);
        tone = hit(spec.tone.bad) ? 'bad' : hit(spec.tone.warn) ? 'warn' : 'good';
      }
      if (spec.viz === 'gauge') return { kind: 'gauge', value: m.value, max: spec.max, count: m.n, tone };
      const progress = spec.target > 0 && m.value != null ? Math.round((m.value / spec.target) * 1000) / 10 : null;
      return { kind: 'kpi', value: m.value, count: m.n, tone, target: spec.target == null ? null : spec.target, progress };
    }
    if (spec.viz === 'table') {
      const fd = fieldOf(spec.dataset, spec.sortBy), dir = spec.sortDir === 'desc' ? -1 : 1;
      const num = fd.type === T.number;
      const sorted = set.slice().sort((a, b) => {
        const x = a[spec.sortBy], y = b[spec.sortBy];
        if (blank(x)) return blank(y) ? 0 : 1; // empty values always last
        if (blank(y)) return -1;
        return (num ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * dir;
      });
      const out = { kind: 'table', columns: spec.columns, total: set.length, rows: sorted.slice(0, spec.rows) };
      if (spec.totals) {
        out.totals = {};
        for (const c of spec.columns) { const cf = fieldOf(spec.dataset, c); if (cf.type === T.number) { const conv = cf.money && opts.convert ? opts.convert : (v) => v; out.totals[c] = round2(set.reduce((a, r) => (blank(r[c]) || !Number.isFinite(Number(r[c])) ? a : a + conv(Number(r[c]), r)), 0)); } }
      }
      return out;
    }
    if (spec.viz === 'scatter') {
      const cb = spec.colorBy ? fieldOf(spec.dataset, spec.colorBy) : null;
      const all = [];
      for (const r of set) {
        if (blank(r[spec.x]) || blank(r[spec.y]) || !Number.isFinite(Number(r[spec.x])) || !Number.isFinite(Number(r[spec.y]))) continue;
        all.push({ x: Number(r[spec.x]), y: Number(r[spec.y]), c: cb ? String(r[spec.colorBy] == null ? '' : r[spec.colorBy]) : '', name: r.name || r.title || r.project || '', id: r.project_id });
      }
      const points = all.slice(0, MAX_POINTS);
      let colors = [];
      if (cb) { const n = new Map(); for (const p of points) n.set(p.c, (n.get(p.c) || 0) + 1); colors = [...n].sort((a, b) => b[1] - a[1]).map((e) => e[0]); }
      let trend = null;
      if (spec.trend && points.length > 2) {
        const n = points.length, sx = points.reduce((a, p) => a + p.x, 0), sy = points.reduce((a, p) => a + p.y, 0), sxy = points.reduce((a, p) => a + p.x * p.y, 0), sxx = points.reduce((a, p) => a + p.x * p.x, 0);
        const den = n * sxx - sx * sx;
        if (den) { const slope = (n * sxy - sx * sy) / den; trend = { slope, intercept: (sy - slope * sx) / n }; }
      }
      return { kind: 'points', points, colors, trend, total: set.length, cut: all.length > MAX_POINTS };
    }

    const gb = fieldOf(spec.dataset, spec.groupBy), by = spec.dateBy || 'month', buckets = new Map();
    for (const r of set) { const k = keyOf(gb, r, by, spec.bin); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
    const second = spec.viz === 'combo' && spec.line === 'second' ? { ...spec, agg: spec.agg2, measure: spec.measure2, calc: undefined } : null;
    const members = new Map(); // the rows of each group, used by the charts that split a group again
    let groups = [...buckets].map(([key, list]) => {
      const m = measureOf(spec, list, opts); members.set(key, list);
      const g = { key, value: m.value == null ? 0 : m.value, count: m.n, tone: gb.type === T.enum ? gb.values[key] || null : null };
      if (spec.rules) g.rule = toneOf(spec.rules, g.value);
      if (second) { const m2 = measureOf(second, list, opts); g.value2 = m2.value == null ? 0 : m2.value; }
      return g;
    });
    const byLabel = spec.sort === 'label' || spec.sort === 'label_desc' || gb.type === T.date || !!spec.bin;
    if (byLabel) {
      groups.sort((a, b) => cmpKey(a.key, b.key));
      if (spec.sort === 'label_desc' && !TREND_VIZ.includes(spec.viz)) { const blanks = groups.filter((g) => g.key === ''); groups = groups.filter((g) => g.key !== '').reverse().concat(blanks); }
    } else groups.sort((a, b) => (spec.sort === 'value_asc' ? a.value - b.value : b.value - a.value));
    // A trend by month: rows with no date cannot sit on a time axis, so they are left out. The latest months that have rows are
    // kept first (the widget limit), then the empty months between them are added as zero so the axis is even, the quarters line
    // up and a running total carries over. A gap wider than two years is left as it is, so one far away date never pushes the
    // real months out of the chart. Averages and the like are not filled.
    const trend = gb.type === T.date && TREND_VIZ.includes(spec.viz);
    if (trend) {
      groups = groups.filter((g) => KEY_OK[by].test(g.key));
      if (groups.length > spec.limit) groups = groups.slice(-spec.limit);
      if (by === 'month' && groups.length > 1 && (spec.agg === 'count' || spec.agg === 'sum') && (!second || second.agg === 'count' || second.agg === 'sum')) {
        const have = new Map(groups.map((g) => [g.key, g])), first = groups[0].key, last = groups[groups.length - 1].key;
        const months = (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
        if (months <= 24) {
          const filled = []; let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
          for (let i = 0; i < months; i++) {
            const k = y + '-' + String(m).padStart(2, '0');
            filled.push(have.get(k) || (second ? { key: k, value: 0, count: 0, tone: null, value2: 0 } : { key: k, value: 0, count: 0, tone: null }));
            if (++m > 12) { m = 1; y++; }
          }
          groups = filled;
        }
      }
    }
    if (!trend && groups.length > spec.limit) {
      const share = spec.viz === 'donut' || spec.viz === 'pie';
      const keep = share ? spec.limit - 1 : spec.limit;
      if (share) {
        const rest = groups.slice(keep);
        groups = groups.slice(0, keep);
        const restRows = rest.reduce((a, g) => a + g.count, 0);
        const other = { key: '__other', value: spec.agg === 'sum' || spec.agg === 'count' ? rest.reduce((a, g) => a + g.value, 0) : 0, count: restRows, tone: null };
        if (spec.agg === 'sum' || spec.agg === 'count') groups.push(other);
      } else groups = groups.slice(0, keep);
    }
    if (spec.viz === 'combo' && spec.line === 'cumulative') { let run = 0; for (const g of groups) { run += g.value; g.value2 = Math.round(run * 100) / 100; } }
    const info = { total: set.length, grouped: gb.name, dateBuckets: gb.type === T.date, by: gb.type === T.date ? by : null, bin: spec.bin || null, line: spec.viz === 'combo' ? spec.line : null, showAs: null };

    if (spec.viz === 'waterfall') {
      let run = 0; const steps = groups.map((g) => { const start = run; run = Math.round((run + g.value) * 100) / 100; return { key: g.key, value: g.value, count: g.count, start, end: run }; });
      return { kind: 'waterfall', steps, sum: run, ...info };
    }

    if (MATRIX.includes(spec.viz)) {
      const cats = groups.map((g) => ({ key: g.key, count: g.count })), catRows = groups.map((g) => members.get(g.key) || []);
      let defs; // one entry per series: its label key, a way to pick the rows and the calculation
      if (spec.splitBy) {
        const sf = fieldOf(spec.dataset, spec.splitBy), sby = spec.splitDateBy || 'month';
        const skey = (r) => keyOf(sf, r, sby);
        const by2 = new Map();
        for (const r of set) { const k = skey(r); if (!by2.has(k)) by2.set(k, []); by2.get(k).push(r); }
        let order = [...by2].map(([k, list]) => ({ k, v: measureOf(spec, list, opts).value })).sort((a, b) => (b.v == null ? -Infinity : b.v) - (a.v == null ? -Infinity : a.v) || cmpKey(a.k, b.k));
        if (sf.type === T.date) order = order.filter((o) => KEY_OK[sby].test(o.k)).concat(order.filter((o) => !KEY_OK[sby].test(o.k)));
        const keep = order.slice(0, spec.splitLimit).map((o) => o.k), restKeys = new Set(order.slice(spec.splitLimit).map((o) => o.k));
        if (sf.type === T.date) keep.sort(cmpKey);
        defs = keep.map((k) => ({ key: k, pick: (r) => skey(r) === k, spec }));
        if (restKeys.size) defs.push({ key: '__other', pick: (r) => restKeys.has(skey(r)), spec });
      } else defs = spec.series.map((s, i) => ({ key: 's' + i, pick: () => true, spec: { dataset: spec.dataset, ...s } }));
      const series = defs.map((d) => {
        const vals = [], counts = [];
        catRows.forEach((list) => { const sub = spec.splitBy ? list.filter(d.pick) : list; const m = measureOf(d.spec, sub, opts); vals.push(m.value == null ? 0 : m.value); counts.push(m.n); });
        return { key: d.key, values: vals, counts, raw: vals.slice() };
      });
      const totalsOf = (list) => measureOf(spec, list, opts).value;
      const rowTotals = catRows.map((list) => (spec.splitBy ? totalsOf(list) : null));
      const colTotals = spec.splitBy ? defs.map((d) => totalsOf(set.filter(d.pick))) : null;
      const grand = spec.splitBy ? totalsOf(set) : null;
      const mode = spec.showAs || 'value';
      if (mode !== 'value' && series.length && cats.length) {
        const grid = showAs(mode, series.map((s) => s.values)); // series by category
        series.forEach((s, i) => { s.values = grid[i]; });
        info.showAs = mode;
      }
      return { kind: 'matrix', cats, series, split: spec.splitBy || null, rowTotals, colTotals, grand, ...info };
    }

    if (SHOW_VIZ.includes(spec.viz) && spec.showAs && spec.showAs !== 'value' && groups.length) {
      const one1 = spec.showAs === 'pct_cat' || spec.showAs === 'pct_series' ? 'pct_total' : spec.showAs === 'rank' ? 'rank_row' : spec.showAs; // a single series has no columns or rows to compare
      const grid = showAs(one1, [groups.map((g) => g.value)]);
      groups = groups.map((g, i) => ({ ...g, raw: g.value, value: grid[0][i] }));
      info.showAs = spec.showAs;
    }
    return { kind: 'groups', groups, ...info };
  }

  // Plain hints about what a widget will show with the data it has now. They never block saving.
  function hints(spec, res) {
    const out = [];
    if (!res) return out;
    if (res.kind === 'kpi' || res.kind === 'gauge') {
      if (res.value == null) out.push({ code: 'no_value' });
      if (spec.rules && res.value != null && !res.tone) out.push({ code: 'rules_never' });
    } else if (res.kind === 'table') { if (!res.total) out.push({ code: 'no_rows' }); }
    else if (res.kind === 'points') { if (!res.points.length) out.push({ code: 'no_rows' }); if (res.cut) out.push({ code: 'points_cut', vars: { n: MAX_POINTS } }); }
    else {
      const list = res.kind === 'waterfall' ? res.steps : res.kind === 'matrix' ? res.cats : res.groups;
      if (!res.total) out.push({ code: 'no_rows' });
      else {
        if (list.some((g) => g.key === '')) out.push({ code: 'blank_group' });
        if (TREND_VIZ.includes(spec.viz) && list.length < 2) out.push({ code: 'few_points' });
        if (spec.rules && res.kind === 'groups' && !res.groups.some((g) => g.rule)) out.push({ code: 'rules_never' });
      }
    }
    return out;
  }

  const api = {
    GROUPS, SCOPES, VIZ, GROUPED, MATRIX, MULTI, SPLIT_REQUIRED, PARTS, SHARE, TREND_VIZ, SHOW_VIZ, RULE_VIZ, TARGET_VIZ, LINE_MODES, DEFAULT_LIMIT, MAX_LIMIT, SPLIT_LIMIT,
    AGGS, CALC_OPS, SORTS, FORMATS, SHOW, DATE_BY, SIZES, TONES, RULE_OPS, DATASETS, OPS, NO_VALUE, LIMIT, ROWS, MAX_FILTERS, MAX_COLUMNS, MAX_RULES, MAX_SERIES, MAX_POINTS,
    TITLE_MAX, DESC_MAX, UNIT_MAX, SpecError, fieldOf, numericFields, normalize, meta, run, toneOf, hints,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.__WidgetSpec = api;
})();
