/* Widget builder: a form that produces a declarative widget spec (data, never code) with a live preview on the
   person's own projects. Specs are validated by the same widgetspec.js the server uses. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, state: S } = PM;
  const WS = window.__WidgetSpec;
  const W = () => PM.widgets;

  const VIZ_ICON = { kpi: 'spark', bar: 'list', column: 'cols', donut: 'grid', table: 'list' };
  const emptyState = () => ({ id: null, title: '', description: '', group: 'overview', dataset: 'tasks', filters: [], viz: 'kpi', agg: 'count', measure: '', format: 'number', dir: 'above', warn: '', bad: '', groupBy: '', sort: 'value_desc', limit: '', columns: [], sortBy: '', sortDir: 'asc', rows: '10' });
  const fields = (ds) => WS.DATASETS[ds] || [];
  const fld = (ds, n) => WS.fieldOf(ds, n);
  const defaultGroupBy = (ds) => { const fs = fields(ds); return (fs.find((x) => x.type === 'enum') || fs.find((x) => x.type === 'text') || fs[0]).name; };
  const defaultColumns = (ds) => fields(ds).slice(0, 4).map((x) => x.name);

  function fromSpec(w) {
    const s = w.spec, st = emptyState();
    Object.assign(st, { id: w.id, title: w.title, description: w.description || '', group: w.group, dataset: s.dataset, viz: s.viz });
    st.filters = (s.filters || []).map((x) => ({ field: x.field, op: x.op, value: x.value == null ? '' : String(x.value) }));
    if (s.viz === 'table') { st.columns = s.columns.slice(); st.sortBy = s.sortBy; st.sortDir = s.sortDir; st.rows = String(s.rows); } else {
      st.agg = s.agg; st.measure = s.measure || '';
      if (s.viz === 'kpi') { st.format = s.format || 'number'; if (s.tone) { st.dir = s.tone.dir; st.warn = s.tone.warn == null ? '' : String(s.tone.warn); st.bad = s.tone.bad == null ? '' : String(s.tone.bad); } } else { st.groupBy = s.groupBy; st.sort = s.sort; st.limit = String(s.limit); }
    }
    return st;
  }
  function toSpec(st) {
    const raw = { dataset: st.dataset, viz: st.viz, filters: st.filters.map((x) => ({ field: x.field, op: x.op, value: x.value === '' ? undefined : x.value })) };
    if (st.viz === 'table') { raw.columns = st.columns; raw.sortBy = st.sortBy || st.columns[0]; raw.sortDir = st.sortDir; raw.rows = st.rows === '' ? NaN : Number(st.rows); return raw; }
    raw.agg = st.agg; if (st.agg !== 'count') raw.measure = st.measure;
    if (st.viz === 'kpi') { raw.format = st.format; if (st.warn !== '' || st.bad !== '') raw.tone = { dir: st.dir, warn: st.warn, bad: st.bad }; return raw; }
    raw.groupBy = st.groupBy; raw.sort = st.sort; raw.limit = st.limit === '' ? undefined : Number(st.limit);
    return raw;
  }

  PM.views.widgetBuilder = async function (id) {
    const token = S.nav;
    PM.shell('widgets', `${PM.loader.html({ size: 'page' })}`);
    let st = emptyState(), saved = null;
    try {
      if (id) { const w = (await api('GET', `/api/widgets/${id}`)).widget; if (!w.mine) throw new Error(t('wb_not_yours')); st = fromSpec(w); saved = w; }
    } catch (e) { if (PM.stale(token)) return; $('#content .page').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn" href="#/widgets?tab=mine">${esc(t('wb_back'))}</a></div>`; return; }
    let data = null;
    try { await PM.loadProjects(); const r = await api('GET', '/api/widgets/datasets'); data = { datasets: r.datasets, today: r.today, truncated: r.truncated || {} }; } catch (e) { /* the preview shows a note */ }
    if (PM.stale(token)) return;
    const dirty = { v: false };
    const label = W().labels;

    const sel = (idn, cur, opts) => `<select id="${idn}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const fieldOpts = (ds, pred) => fields(ds).filter(pred || (() => true)).map((x) => [x.name, label.field(x.name)]);
    const opLabel = (op, type) => (type === 'date' && (op === 'gt' || op === 'lt') ? t('wb_dop_' + op) : t('wb_op_' + op));

    function filterRow(f, i) {
      const fd = fld(st.dataset, f.field) || fields(st.dataset)[0];
      const ops = WS.OPS[fd.type];
      let val = '';
      if (f.op === 'before_today') val = '';
      else if (f.op === 'within_days') val = `<input type="number" min="0" max="3650" data-fv="${i}" value="${esc(f.value)}" aria-label="${esc(t('wb_days'))}" placeholder="${esc(t('wb_days'))}">`;
      else if (fd.type === 'enum') val = `<select data-fv="${i}" aria-label="${esc(t('wb_value'))}">${Object.keys(fd.values).map((v) => `<option value="${v}" ${f.value === v ? 'selected' : ''}>${esc(label.value(v))}</option>`).join('')}</select>`;
      else if (fd.type === 'number') val = `<input type="number" step="any" data-fv="${i}" value="${esc(f.value)}" aria-label="${esc(t('wb_value'))}" placeholder="${esc(t('wb_value'))}">`;
      else if (fd.type === 'date') val = `<input type="date" data-fv="${i}" value="${esc(f.value)}" aria-label="${esc(t('wb_value'))}">`;
      else val = `<input type="text" maxlength="80" data-fv="${i}" value="${esc(f.value)}" aria-label="${esc(t('wb_value'))}" placeholder="${esc(t('wb_value'))}">`;
      return `<div class="wb-filter row" data-i="${i}"><select data-ff="${i}" aria-label="${esc(t('wb_field'))}">${fieldOpts(st.dataset).map(([v, l]) => `<option value="${v}" ${f.field === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><select data-fo="${i}" aria-label="${esc(t('wb_condition'))}">${ops.map((o) => `<option value="${o}" ${f.op === o ? 'selected' : ''}>${esc(opLabel(o, fd.type))}</option>`).join('')}</select>${val}<button class="btn sm ghost icon" type="button" data-fdel="${i}" aria-label="${esc(t('wb_remove_filter'))}" data-tip="${esc(t('wb_remove_filter'))}">${icon('trash')}</button></div>`;
    }

    function formHtml() {
      const ds = st.dataset, nums = WS.numericFields(ds);
      const aggs = st.viz === 'donut' ? ['count', 'sum'] : WS.AGGS;
      const measureSel = st.agg === 'count' ? '' : `<div class="wb-field"><label for="wbMeasure">${esc(t('wb_measure'))}</label>${sel('wbMeasure', st.measure, nums.map((x) => [x.name, label.field(x.name)]))}</div>`;
      let shape = '';
      if (st.viz === 'table') {
        shape = `<div class="wb-field"><span class="wb-lab">${esc(t('wb_columns', { n: WS.MAX_COLUMNS }))}</span><div class="wb-cols">${fields(ds).map((x) => { const on = st.columns.includes(x.name); return `<label class="wb-check"><input type="checkbox" data-col="${x.name}" ${on ? 'checked' : ''} ${!on && st.columns.length >= WS.MAX_COLUMNS ? 'disabled' : ''}>${esc(label.field(x.name))}</label>`; }).join('')}</div></div>
          <div class="wb-row"><div class="wb-field"><label for="wbSortBy">${esc(t('wb_sort_by'))}</label>${sel('wbSortBy', st.sortBy || st.columns[0] || '', fieldOpts(ds))}</div><div class="wb-field"><label for="wbSortDir">${esc(t('wb_sort_dir'))}</label>${sel('wbSortDir', st.sortDir, [['asc', t('wb_asc')], ['desc', t('wb_descending')]])}</div><div class="wb-field"><label for="wbRows">${esc(t('wb_rows'))}</label><input id="wbRows" type="number" min="${WS.ROWS.min}" max="${WS.ROWS.max}" value="${esc(st.rows)}"></div></div>`;
      } else {
        shape = `<div class="wb-row"><div class="wb-field"><label for="wbAgg">${esc(t('wb_agg'))}</label>${sel('wbAgg', st.agg, aggs.map((a) => [a, t('wb_agg_' + a)]))}</div>${measureSel}</div>`;
        if (st.viz === 'kpi') {
          shape += `<div class="wb-row"><div class="wb-field"><label for="wbFormat">${esc(t('wb_format'))}</label>${sel('wbFormat', st.format, WS.FORMATS.map((f) => [f, t('wb_fmt_' + f)]))}</div></div>
            <div class="wb-field"><span class="wb-lab">${esc(t('wb_alerts'))}</span><div class="wb-row"><div class="wb-field"><label for="wbDir">${esc(t('wb_alert_when'))}</label>${sel('wbDir', st.dir, [['above', t('wb_above')], ['below', t('wb_below')]])}</div><div class="wb-field"><label for="wbWarn">${esc(t('wb_warn'))}</label><input id="wbWarn" type="number" step="any" value="${esc(st.warn)}"></div><div class="wb-field"><label for="wbBad">${esc(t('wb_bad'))}</label><input id="wbBad" type="number" step="any" value="${esc(st.bad)}"></div></div><div class="small muted">${esc(t('wb_alerts_hint'))}</div></div>`;
        } else {
          shape += `<div class="wb-row"><div class="wb-field"><label for="wbGroup">${esc(t('wb_group_by'))}</label>${sel('wbGroup', st.groupBy, fieldOpts(ds))}</div><div class="wb-field"><label for="wbSort">${esc(t('wb_sort'))}</label>${sel('wbSort', st.sort, WS.SORTS.map((s) => [s, t('wb_sort_' + s)]))}</div><div class="wb-field"><label for="wbLimit">${esc(t('wb_limit'))}</label><input id="wbLimit" type="number" min="${WS.LIMIT.min}" max="${st.viz === 'donut' ? 4 : WS.LIMIT.max}" value="${esc(st.limit)}" placeholder="${st.viz === 'donut' ? 4 : 8}"></div></div>`;
        }
      }
      return `<section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_about'))}</h2>
          <div class="wb-field"><label for="wbTitle">${esc(t('wb_title'))}</label><input id="wbTitle" maxlength="${WS.TITLE_MAX}" value="${esc(st.title)}" placeholder="${esc(t('wb_title_ph'))}"></div>
          <div class="wb-field"><label for="wbDesc">${esc(t('wb_desc'))}</label><textarea id="wbDesc" rows="2" maxlength="${WS.DESC_MAX}" placeholder="${esc(t('wb_desc_ph'))}">${esc(st.description)}</textarea><div class="small muted">${esc(t('wb_desc_hint'))}</div></div>
          <div class="wb-field"><label for="wbGroupSel">${esc(t('wb_group'))}</label>${sel('wbGroupSel', st.group, WS.GROUPS.map((g) => [g, label.group(g)]))}</div></section>
        <section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_data'))}</h2>
          <div class="wb-field"><label for="wbDataset">${esc(t('wb_dataset'))}</label>${sel('wbDataset', ds, Object.keys(WS.DATASETS).map((d) => [d, label.ds(d)]))}<div class="small muted">${esc(t('wb_dataset_hint'))}</div></div>
          <div class="wb-field"><span class="wb-lab">${esc(t('wb_filters'))}</span>${st.filters.map(filterRow).join('') || `<div class="small muted">${esc(t('wb_no_filters'))}</div>`}${st.filters.length < WS.MAX_FILTERS ? `<div><button class="btn sm" type="button" id="wbAddFilter">${icon('plus')}${esc(t('wb_add_filter'))}</button></div>` : ''}</div></section>
        <section class="card wb-card"><h2 class="wb-h">${esc(t('wb_s_show'))}</h2>
          <div class="wb-viz" role="radiogroup" aria-label="${esc(t('wb_viz'))}">${WS.VIZ.map((v) => `<button type="button" role="radio" aria-checked="${st.viz === v}" class="wb-vcard ${st.viz === v ? 'on' : ''}" data-viz="${v}">${icon(VIZ_ICON[v])}<b>${esc(t('wb_viz_' + v))}</b><span class="small muted">${esc(t('wb_viz_hint_' + v))}</span></button>`).join('')}</div>
          ${shape}</section>`;
    }

    // ---------- validation and live preview ----------
    function check() {
      try { const meta = WS.meta({ title: st.title, description: st.description, group: st.group }); const spec = WS.normalize(toSpec(st)); return { ok: true, meta, spec }; } catch (e) { return { ok: false, msg: W().specMsg(e) }; }
    }
    let lastOk = null;
    function paintPreview() {
      const res = check(), box = $('#wbPreview'), msg = $('#wbMsg'), sv = $('#wbSave'), pb = $('#wbPublish');
      lastOk = res.ok ? res : null;
      msg.textContent = res.ok ? '' : res.msg; msg.hidden = res.ok;
      sv.disabled = !res.ok; pb.disabled = !res.ok;
      $('#wbDirty').hidden = !dirty.v;
      if (!res.ok) { box.innerHTML = `<div class="empty small">${esc(t('wb_fix_to_preview'))}</div>`; return; }
      if (!data) { box.innerHTML = `<div class="empty small">${esc(t('wb_no_data'))}</div>`; return; }
      box.innerHTML = '';
      const frame = $('#wbFrame'); frame.className = `dw wb-frame sz-${W().SIZE_OF[res.spec.viz] || 'm'}`;
      $('#wbPrevTitle').textContent = res.meta.title;
      PM.dash.h.setWidth(Math.max(240, Math.round(frame.clientWidth || 360) - 38));
      PM.fx.mode = 'USD';
      try { W().renderSpec(box, { title: res.meta.title, spec: res.spec }, data, {}, { limit: true }); } catch (e) { box.innerHTML = `<div class="empty small">${esc(t('wk_broken'))}</div>`; }
      PM.dash.h.bindTips(box); PM.dash.h.countUp(box);
    }
    let pt = null;
    const later = () => { dirty.v = true; clearTimeout(pt); pt = setTimeout(paintPreview, 160); };

    function onDataset(ds) {
      st.dataset = ds; st.filters = []; st.measure = ''; st.groupBy = defaultGroupBy(ds); st.columns = defaultColumns(ds); st.sortBy = st.columns[0];
      const nums = WS.numericFields(ds); if (st.agg !== 'count') st.measure = nums[0] ? nums[0].name : '';
    }
    function onViz(v) {
      st.viz = v;
      if (v === 'donut' && !['count', 'sum'].includes(st.agg)) st.agg = 'count';
      if (st.agg !== 'count' && !st.measure) { const n = WS.numericFields(st.dataset)[0]; st.measure = n ? n.name : ''; }
      if (!st.groupBy) st.groupBy = defaultGroupBy(st.dataset);
      if (!st.columns.length) { st.columns = defaultColumns(st.dataset); st.sortBy = st.columns[0]; }
      if (v === 'donut' && Number(st.limit) > 4) st.limit = '4';
    }

    const root = $('#content .page');
    root.innerHTML = `<div class="page-head"><div><a class="small wb-back" href="#/widgets?tab=mine">${icon('chev_l', 'flip')}${esc(t('wb_back'))}</a><h1>${esc(t(id ? 'wb_edit' : 'wb_new'))}</h1><p class="muted wm-sub">${esc(t('wb_sub'))}</p></div></div>
      <div class="wb-grid"><div class="wb-form" id="wbForm"></div>
      <aside class="wb-side"><div class="card wb-card wb-sticky"><h2 class="wb-h">${esc(t('wb_preview'))}</h2><p class="small muted">${esc(t('wb_preview_note'))}</p>
        <div class="wb-stage"><section class="dw wb-frame sz-m" id="wbFrame"><header class="dw-h"><h3 id="wbPrevTitle"></h3></header><div class="dw-body" id="wbPreview"></div></section></div>
        <div id="wbMsg" class="wb-msg" role="alert" hidden></div>
        <div class="row wb-actions"><button class="btn" id="wbSave" type="button">${esc(t('wb_save_draft'))}</button><button class="btn primary" id="wbPublish" type="button">${esc(t('wm_publish'))}</button><a class="btn ghost" href="#/widgets?tab=mine">${esc(t('cancel'))}</a></div>
        <div class="small muted" id="wbDirty" hidden>${esc(t('wb_unsaved'))}</div></div></aside></div>`;

    function drawForm() { $('#wbForm').innerHTML = formHtml(); paintPreview(); }
    const form = $('#wbForm');
    // text boxes update the state in place so typing never loses focus
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.id === 'wbTitle') st.title = el.value; else if (el.id === 'wbDesc') st.description = el.value; else if (el.id === 'wbRows') st.rows = el.value;
      else if (el.id === 'wbWarn') st.warn = el.value; else if (el.id === 'wbBad') st.bad = el.value; else if (el.id === 'wbLimit') st.limit = el.value;
      else if (el.dataset.fv !== undefined && el.tagName === 'INPUT') st.filters[Number(el.dataset.fv)].value = el.value; else return;
      later();
    });
    form.addEventListener('change', (e) => {
      const el = e.target, redraw = () => { dirty.v = true; drawForm(); };
      if (el.id === 'wbGroupSel') { st.group = el.value; return later(); }
      if (el.id === 'wbDataset') { onDataset(el.value); return redraw(); }
      if (el.id === 'wbAgg') { st.agg = el.value; if (st.agg !== 'count' && !st.measure) { const n = WS.numericFields(st.dataset)[0]; st.measure = n ? n.name : ''; } return redraw(); }
      if (el.id === 'wbMeasure') { st.measure = el.value; if (st.format === 'money' && !(fld(st.dataset, st.measure) || {}).money) st.format = 'number'; return later(); }
      if (el.id === 'wbFormat') { st.format = el.value; return later(); }
      if (el.id === 'wbDir') { st.dir = el.value; return later(); }
      if (el.id === 'wbGroup') { st.groupBy = el.value; const gb = fld(st.dataset, st.groupBy); st.sort = gb && gb.type === 'date' ? 'label' : 'value_desc'; return redraw(); }
      if (el.id === 'wbSort') { st.sort = el.value; return later(); }
      if (el.id === 'wbSortBy') { st.sortBy = el.value; return later(); }
      if (el.id === 'wbSortDir') { st.sortDir = el.value; return later(); }
      if (el.dataset.col) { const n = el.dataset.col; st.columns = el.checked ? st.columns.concat(n) : st.columns.filter((x) => x !== n); if (!st.columns.includes(st.sortBy)) st.sortBy = st.columns[0] || ''; return redraw(); }
      if (el.dataset.ff !== undefined) { const f = st.filters[Number(el.dataset.ff)]; f.field = el.value; const fd = fld(st.dataset, f.field); f.op = WS.OPS[fd.type][0]; f.value = fd.type === 'enum' ? Object.keys(fd.values)[0] : ''; return redraw(); }
      if (el.dataset.fo !== undefined) { const f = st.filters[Number(el.dataset.fo)]; f.op = el.value; if (f.op === 'before_today') f.value = ''; return redraw(); }
      if (el.dataset.fv !== undefined) { st.filters[Number(el.dataset.fv)].value = el.value; return later(); }
    });
    form.addEventListener('click', (e) => {
      const v = e.target.closest('[data-viz]'); if (v) { onViz(v.dataset.viz); dirty.v = true; return drawForm(); }
      if (e.target.closest('#wbAddFilter')) { const fd = fields(st.dataset)[0]; st.filters.push({ field: fd.name, op: WS.OPS[fd.type][0], value: fd.type === 'enum' ? Object.keys(fd.values)[0] : '' }); dirty.v = true; return drawForm(); }
      const d = e.target.closest('[data-fdel]'); if (d) { st.filters.splice(Number(d.dataset.fdel), 1); dirty.v = true; drawForm(); }
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

    if (!id) onDataset(st.dataset);
    drawForm();
    if (!id) { st.title = ''; }
    let rt = null;
    window.addEventListener('resize', function onR() { if (!$('#wbFrame')) return window.removeEventListener('resize', onR); clearTimeout(rt); rt = setTimeout(paintPreview, 200); });
  };
})();
