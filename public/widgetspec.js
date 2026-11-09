/* Widget specs. A custom widget is plain data, never code, so a widget published to every user can only ever read the
   viewer's own data through the fixed datasets below. This one file is used by the server (to validate a widget before it
   is saved or published) and by the browser (to compute what a widget shows), so both always agree.
   It has no access to the page or the network. */
(function () {
  'use strict';

  const GROUPS = ['overview', 'schedule', 'financials', 'risk', 'delivery', 'team', 'trends', 'other'];
  const SCOPES = ['portfolio', 'project'];
  const VIZ = ['kpi', 'bar', 'column', 'line', 'area', 'combo', 'donut', 'radar', 'funnel', 'table'];
  const GROUPED = ['bar', 'column', 'line', 'area', 'combo', 'donut', 'radar', 'funnel'];
  const LINE_MODES = ['cumulative', 'second'];
  // groups drawn by default and the most each display allows
  const DEFAULT_LIMIT = { donut: 4, radar: 6, funnel: 5, line: 12, area: 12, combo: 12 }, MAX_LIMIT = { donut: 4, radar: 8, funnel: 8 };
  const AGGS = ['count', 'sum', 'avg', 'min', 'max'];
  const SORTS = ['value_desc', 'value_asc', 'label'];
  const FORMATS = ['number', 'percent', 'money'];
  const MAX_FILTERS = 5, MAX_COLUMNS = 5;
  const LIMIT = { min: 3, max: 12 }, ROWS = { min: 3, max: 25 };
  const TITLE_MAX = 60, DESC_MAX = 200, VALUE_MAX = 80;
  const SPEC_BYTES = 6000;

  const T = { text: 'text', enum: 'enum', number: 'number', date: 'date' };
  const level = { High: 'bad', Medium: 'warn', Low: 'ok' };
  const f = (name, type, extra) => Object.assign({ name, type }, extra || {});

  // Fields and enum values are names. The screen translates them (labels are wf_<field>, enum values wv_<value>).
  const DATASETS = {
    projects: [
      f('name', T.text), f('client', T.text), f('health', T.enum, { values: { green: 'ok', amber: 'warn', red: 'bad' } }),
      f('status', T.text), f('progress', T.number, { unit: 'percent' }), f('planned', T.number, { unit: 'percent' }), f('spi', T.number),
      f('overdue', T.number), f('pending_review', T.number), f('value', T.number, { money: true }), f('currency', T.text),
      f('forecast_end', T.date), f('contract_end', T.date), f('slip_days', T.number),
    ],
    tasks: [
      f('project', T.text), f('name', T.text), f('owner', T.text), f('start', T.date), f('finish', T.date), f('duration', T.number),
      f('progress', T.number, { unit: 'percent' }),
      f('status', T.enum, { values: { done: 'ok', active: 'c1', todo: 'idle', late: 'bad' } }),
      f('critical', T.enum, { values: { yes: 'c1', no: null } }), f('milestone', T.enum, { values: { yes: 'c1', no: null } }),
    ],
    payments: [
      f('project', T.text), f('title', T.text), f('due', T.date), f('amount', T.number, { money: true }), f('currency', T.text),
      f('state', T.enum, { values: { paid: 'ok', invoiced: 'c1', pending: 'idle' } }), f('late', T.enum, { values: { yes: 'bad', no: 'ok' } }),
    ],
    risks: [
      f('project', T.text), f('title', T.text), f('probability', T.enum, { values: level }), f('impact', T.enum, { values: level }),
      f('state', T.enum, { values: { open: 'bad', mitigated: 'ok', transferred: 'idle', closed: 'ok' } }),
    ],
    deliverables: [
      f('project', T.text), f('title', T.text), f('due', T.date), f('state', T.enum, { values: { open: 'idle', closed: 'ok' } }),
      f('late', T.enum, { values: { yes: 'bad', no: 'ok' } }),
    ],
  };
  const fieldOf = (ds, name) => (DATASETS[ds] || []).find((x) => x.name === name) || null;
  const numericFields = (ds) => (DATASETS[ds] || []).filter((x) => x.type === T.number);

  // Which operators a field type offers.
  const OPS = {
    text: ['eq', 'ne', 'contains'],
    enum: ['eq', 'ne'],
    number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
    date: ['before_today', 'within_days', 'gt', 'lt'],
  };

  // The message is plain English for the server and logs. The code and vars let the screen show it in either language.
  class SpecError extends Error { constructor(message, code, vars) { super(message); this.code = code; this.vars = vars || {}; } }
  const bad = (m, code, vars) => { throw new SpecError(m, code, vars); };
  const isInt = (n) => Number.isInteger(n);
  const cleanText = (s, max, label, required, code) => {
    const v = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (required && !v) bad(label + ' is required', code + '_required');
    if (v.length > max) bad(label + ' is too long (at most ' + max + ' characters)', code + '_long', { max });
    return v;
  };

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
    for (const x of filters) {
      const fd = x && fieldOf(ds, x.field);
      if (!fd) bad('A filter uses a field that is not available', 'filter_field');
      if (!OPS[fd.type].includes(x.op)) bad('A filter uses a condition that does not fit its field', 'filter_op');
      let value = x.value;
      if (x.op === 'before_today') value = '';
      else if (x.op === 'within_days') { value = Number(value); if (!isInt(value) || value < 0 || value > 3650) bad('Days must be a whole number from 0 to 3650', 'days'); }
      else if (fd.type === T.number) { value = Number(value); if (!Number.isFinite(value)) bad('A number filter needs a number', 'filter_number'); }
      else if (fd.type === T.enum) { value = String(value); if (!Object.prototype.hasOwnProperty.call(fd.values, value)) bad('A filter uses a value that is not available', 'filter_value'); }
      else if (fd.type === T.date) { value = String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('A date filter needs a date', 'filter_date'); }
      else value = cleanText(value, VALUE_MAX, 'The filter text', true, 'filter_text');
      out.filters.push({ field: fd.name, op: x.op, value });
    }

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
      return out;
    }

    const agg = raw.agg == null ? 'count' : raw.agg;
    if (!AGGS.includes(agg)) bad('Choose how to calculate the value', 'agg');
    out.agg = agg;
    if (viz === 'donut' && agg !== 'count' && agg !== 'sum') bad('A donut shows shares of a whole, so use count or sum', 'donut_agg');
    if (viz === 'funnel' && agg !== 'count' && agg !== 'sum') bad('A funnel shows steps that narrow, so use count or sum', 'funnel_agg');
    if (agg !== 'count') {
      const fd = fieldOf(ds, raw.measure);
      if (!fd || fd.type !== T.number) bad('Choose a number field to calculate', 'measure');
      out.measure = fd.name;
    }
    if (viz === 'kpi') {
      out.format = FORMATS.includes(raw.format) ? raw.format : 'number';
      if (out.format === 'money') { const m = out.measure && fieldOf(ds, out.measure); if (!m || !m.money) bad('Money format needs an amount or value field', 'money_format'); }
      const tone = raw.tone;
      if (tone && typeof tone === 'object' && (tone.warn != null || tone.bad != null)) {
        const w = tone.warn == null || tone.warn === '' ? null : Number(tone.warn), b = tone.bad == null || tone.bad === '' ? null : Number(tone.bad);
        if ((w != null && !Number.isFinite(w)) || (b != null && !Number.isFinite(b))) bad('Alert levels must be numbers', 'tone_numbers');
        out.tone = { dir: tone.dir === 'below' ? 'below' : 'above', warn: w, bad: b };
      }
      return out;
    }
    const gb = fieldOf(ds, raw.groupBy);
    if (!gb) bad('Choose what to group by', 'group_by');
    out.groupBy = gb.name;
    out.sort = SORTS.includes(raw.sort) ? raw.sort : (gb.type === T.date || viz === 'line' || viz === 'area' || viz === 'combo' ? 'label' : 'value_desc');
    const limit = raw.limit == null || raw.limit === '' ? (DEFAULT_LIMIT[viz] || 8) : Number(raw.limit);
    const cap = MAX_LIMIT[viz] || LIMIT.max;
    if (!isInt(limit) || limit < LIMIT.min || limit > cap) bad('The number of groups must be from ' + LIMIT.min + ' to ' + cap, 'groups_range', { min: LIMIT.min, max: cap });
    out.limit = limit;
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
          if (!f2 || f2.type !== T.number) bad('Choose a number field for the line', 'measure2');
          out.measure2 = f2.name;
        }
      }
    }
    return out;
  }

  function meta(raw) {
    const m = raw || {};
    const group = GROUPS.includes(m.group) ? m.group : bad('Choose a group for the widget', 'group');
    return { title: cleanText(m.title, TITLE_MAX, 'The title', true, 'title'), description: cleanText(m.description, DESC_MAX, 'The description', false, 'desc'), group };
  }

  // ---------- computing ----------
  const DAY = 864e5;
  const dnum = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY : null);

  function matches(row, flt, fd, today) {
    const v = row[flt.field];
    switch (flt.op) {
      case 'eq': return fd.type === T.number ? Number(v) === flt.value : String(v == null ? '' : v) === String(flt.value);
      case 'ne': return fd.type === T.number ? Number(v) !== flt.value : String(v == null ? '' : v) !== String(flt.value);
      case 'contains': return String(v == null ? '' : v).toLowerCase().includes(String(flt.value).toLowerCase());
      case 'gt': return fd.type === T.date ? !!v && String(v) > flt.value : v != null && Number(v) > flt.value;
      case 'gte': return v != null && Number(v) >= flt.value;
      case 'lt': return fd.type === T.date ? !!v && String(v) < flt.value : v != null && Number(v) < flt.value;
      case 'lte': return v != null && Number(v) <= flt.value;
      case 'before_today': return !!v && String(v) < today;
      case 'within_days': { const d = dnum(v), t = dnum(today); return d != null && t != null && d >= t && d <= t + flt.value; }
      default: return false;
    }
  }
  const filtered = (spec, rows, today) => {
    const tests = spec.filters.map((x) => [x, fieldOf(spec.dataset, x.field)]);
    return rows.filter((r) => tests.every(([x, fd]) => matches(r, x, fd, today)));
  };

  // opts.convert(value, row) turns a money value into the display currency (the overview converts, a project keeps its own).
  function measureOf(spec, rows, opts) {
    if (spec.agg === 'count') return { value: rows.length, n: rows.length };
    const fd = fieldOf(spec.dataset, spec.measure);
    const conv = fd.money && opts && opts.convert ? opts.convert : (v) => v;
    const vals = [];
    for (const r of rows) { const v = r[spec.measure]; if (v != null && v !== '' && Number.isFinite(Number(v))) vals.push(conv(Number(v), r)); }
    if (!vals.length) return { value: null, n: rows.length };
    let value;
    if (spec.agg === 'sum') value = vals.reduce((a, b) => a + b, 0);
    else if (spec.agg === 'avg') value = vals.reduce((a, b) => a + b, 0) / vals.length;
    else if (spec.agg === 'min') value = Math.min(...vals);
    else value = Math.max(...vals);
    return { value: Math.round(value * 100) / 100, n: rows.length };
  }

  const keyOf = (fd, row) => {
    const v = row[fd.name];
    if (v == null || v === '') return '';
    return fd.type === T.date ? String(v).slice(0, 7) : String(v);
  };

  // Returns { kind: 'kpi' | 'groups' | 'table', ... }. Never throws on odd rows.
  function run(spec, rows, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const set = filtered(spec, Array.isArray(rows) ? rows : [], today);
    if (spec.viz === 'kpi') {
      const m = measureOf(spec, set, opts);
      let tone = '';
      if (spec.tone && m.value != null) {
        const above = spec.tone.dir === 'above', hit = (lim) => lim != null && (above ? m.value >= lim : m.value <= lim);
        tone = hit(spec.tone.bad) ? 'bad' : hit(spec.tone.warn) ? 'warn' : 'good';
      }
      return { kind: 'kpi', value: m.value, count: m.n, tone };
    }
    if (spec.viz === 'table') {
      const fd = fieldOf(spec.dataset, spec.sortBy), dir = spec.sortDir === 'desc' ? -1 : 1;
      const num = fd.type === T.number;
      const sorted = set.slice().sort((a, b) => {
        const x = a[spec.sortBy], y = b[spec.sortBy];
        if (x == null || x === '') return y == null || y === '' ? 0 : 1; // empty values always last
        if (y == null || y === '') return -1;
        return (num ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * dir;
      });
      return { kind: 'table', columns: spec.columns, total: set.length, rows: sorted.slice(0, spec.rows) };
    }
    const gb = fieldOf(spec.dataset, spec.groupBy), buckets = new Map();
    for (const r of set) { const k = keyOf(gb, r); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
    const second = spec.viz === 'combo' && spec.line === 'second' ? { ...spec, agg: spec.agg2, measure: spec.measure2 } : null;
    let groups = [...buckets].map(([key, list]) => { const m = measureOf(spec, list, opts); const g = { key, value: m.value == null ? 0 : m.value, count: m.n, tone: gb.type === T.enum ? gb.values[key] || null : null }; if (second) { const m2 = measureOf(second, list, opts); g.value2 = m2.value == null ? 0 : m2.value; } return g; });
    if (spec.sort === 'label' || gb.type === T.date) groups.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : String(a.key).localeCompare(String(b.key))));
    else groups.sort((a, b) => (spec.sort === 'value_asc' ? a.value - b.value : b.value - a.value));
    // A trend by month: rows with no date cannot sit on a time axis, so they are left out. The latest months that have rows are
    // kept first (the widget limit), then the empty months between them are added as zero so the axis is even, the quarters line
    // up and a running total carries over. A gap wider than two years is left as it is, so one far away date never pushes the
    // real months out of the chart. Averages and the like are not filled.
    const trend = gb.type === T.date && (spec.viz === 'line' || spec.viz === 'area' || spec.viz === 'combo');
    if (trend) {
      groups = groups.filter((g) => /^\d{4}-\d{2}$/.test(g.key));
      if (groups.length > spec.limit) groups = groups.slice(-spec.limit);
      if (groups.length > 1 && (spec.agg === 'count' || spec.agg === 'sum') && (!second || second.agg === 'count' || second.agg === 'sum')) {
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
    let other = null;
    if (!trend && groups.length > spec.limit) {
      const keep = spec.viz === 'donut' ? spec.limit - 1 : spec.limit;
      if (spec.viz === 'donut') {
        const rest = groups.slice(keep);
        groups = groups.slice(0, keep);
        const restRows = rest.reduce((a, g) => a + g.count, 0);
        other = { key: '__other', value: spec.agg === 'sum' || spec.agg === 'count' ? rest.reduce((a, g) => a + g.value, 0) : 0, count: restRows, tone: null };
        if (spec.agg === 'sum' || spec.agg === 'count') groups.push(other);
      } else if (gb.type === T.date && (spec.viz === 'line' || spec.viz === 'area' || spec.viz === 'combo')) groups = groups.slice(-keep); // a trend keeps the latest months
      else groups = groups.slice(0, keep);
    }
    if (spec.viz === 'combo' && spec.line === 'cumulative') { let run = 0; for (const g of groups) { run += g.value; g.value2 = Math.round(run * 100) / 100; } }
    return { kind: 'groups', groups, total: set.length, grouped: gb.name, dateBuckets: gb.type === T.date, line: spec.viz === 'combo' ? spec.line : null };
  }

  const api = { GROUPS, SCOPES, VIZ, GROUPED, LINE_MODES, DEFAULT_LIMIT, MAX_LIMIT, AGGS, SORTS, FORMATS, DATASETS, OPS, LIMIT, ROWS, MAX_FILTERS, MAX_COLUMNS, TITLE_MAX, DESC_MAX, SpecError, fieldOf, numericFields, normalize, meta, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.__WidgetSpec = api;
})();
