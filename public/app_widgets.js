/* Widget marketplace: add or remove widgets on the two overview pages, preview them with the person's own project data,
   rate and search community widgets, and save overview layouts. The widget builder lives in app_widget_builder.js. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, state: S } = PM;
  const WS = window.__WidgetSpec;
  const H = () => PM.dash.h;
  const tx = (key, vars, fallback) => { const v = t(key, vars); return v === key && fallback != null ? fallback : v; };

  // ---------------- labels ----------------
  const groupLabel = (g) => tx('wg_' + g, null, g);
  const dsLabel = (d) => tx('wds_' + d, null, d);
  const fieldLabel = (f) => tx('wf_' + f, null, f);
  const valueLabel = (v) => (['High', 'Medium', 'Low'].includes(v) ? t('lv_' + v) : tx('wv_' + v, null, v));
  const scopeLabel = (s) => t(s === 'project' ? 'wm_scope_project' : 'wm_scope_portfolio');
  const keyOf = (scope) => (scope === 'project' ? 'proj' : null);
  const lang = () => (S.lang === 'ar' ? 'ar-AE' : 'en-US');
  const fmtNum = (n) => Number(n).toLocaleString(lang(), { maximumFractionDigits: 1 });
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang(), { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
  const specMsg = (e) => (e && e.code ? tx('wk_e_' + e.code, e.vars, e.message) : (e && e.message) || '');
  const TONE_CHIP = { ok: 'green', warn: 'amber', bad: 'red', c1: 'blue', idle: '' };
  const PALETTE = ['c1', 'c2', 'c3', 'c4'];
  const SIZE_OF = { kpi: 's', donut: 's', bar: 'm', column: 'm', table: 'm' };
  const blank = () => {};

  // ---------------- drawing a custom widget ----------------
  const curOf = (spec, pack) => {
    if (PM.fx.mode !== 'native') return PM.fx.mode;
    const set = new Set((pack.datasets[spec.dataset] || []).map((r) => r.currency).filter(Boolean));
    return set.size === 1 ? [...set][0] : '';
  };
  function fmtValue(v, fd, cur, format) {
    if (v == null) return t('wk_none');
    const unit = format || (fd && fd.unit === 'percent' ? 'percent' : fd && fd.money ? 'money' : 'number');
    if (unit === 'percent') return fmtNum(v) + '%';
    if (unit === 'money') return fmtNum(v) + (cur ? ' ' + cur : '');
    return fmtNum(v);
  }
  function aggLabel(spec) {
    if (spec.agg === 'count' || !spec.agg) return t('wk_agg_count', { ds: dsLabel(spec.dataset).toLowerCase() });
    return t('wk_agg_' + spec.agg, { field: fieldLabel(spec.measure).toLowerCase() });
  }
  const groupName = (g, res) => (g.key === '__other' ? t('wk_other') : g.key === '' ? t('wk_blank') : res.dateBuckets ? monthLabel(g.key) : valueLabel(g.key));

  // own.limit: the preview and the builder show five rows themselves. On an overview the grid applies the same five row rule.
  function renderSpec(body, w, pack, ctx, own) {
    const spec = w.spec, h = H(), rows = pack.datasets[spec.dataset] || [];
    const mode = PM.fx.mode;
    const conv = (v, r) => (mode !== 'native' && r && PM.fx.known(r.currency) ? PM.fx.convert(v, r.currency, mode) : v);
    let res;
    try { res = WS.run(spec, rows, { today: pack.today, convert: conv }); } catch (e) { body.innerHTML = h.empty(t('wk_broken')); return { csv: () => [] }; }
    const cur = curOf(spec, pack), note = pack.truncated && pack.truncated[spec.dataset] ? `<div class="small muted wk-note">${esc(t('wk_truncated'))}</div>` : '';
    const mfd = spec.measure ? WS.fieldOf(spec.dataset, spec.measure) : null;
    const title = w.title;

    if (res.kind === 'kpi') {
      const text = fmtValue(res.value, mfd, cur, spec.format);
      const intCount = res.value != null && Number.isInteger(res.value) && (spec.format || 'number') === 'number';
      body.innerHTML = `<div class="wk-kpi ${res.tone || ''}"><b class="wk-v" ${intCount ? `data-count="${res.value}"` : ''}>${esc(text)}</b><span class="small muted">${esc(aggLabel(spec))}</span><span class="small muted">${esc(t('wk_rows_n', { n: fmtNum(res.count) }))}</span></div>${note}`;
      return { csv: () => [[title, aggLabel(spec)], [text, '']] };
    }

    if (res.kind === 'table') {
      const cols = res.columns.map((c) => WS.fieldOf(spec.dataset, c));
      const cell = (fd, r) => {
        const v = r[fd.name];
        if (v == null || v === '') return '';
        if (fd.type === 'enum') { const c = TONE_CHIP[fd.values[v]]; return `<span class="chip ${c || ''}">${esc(valueLabel(v))}</span>`; }
        if (fd.type === 'number') return esc(fd.unit === 'percent' ? fmtNum(v) + '%' : fd.money ? fmtNum(conv(v, r)) + (mode !== 'native' ? ' ' + mode : r.currency ? ' ' + r.currency : '') : fmtNum(v));
        if ((fd.name === 'project' || (spec.dataset === 'projects' && fd.name === 'name')) && r.project_id) return `<span class="li-link" data-go="#/p/${r.project_id}/overview">${esc(v)}</span>`;
        return esc(v);
      };
      if (!res.rows.length) { body.innerHTML = h.empty(t('wk_empty')) + note; return { csv: () => [] }; }
      const lim = !!(own && own.limit);
      const trs = res.rows.map((r, i) => `<tr class="${lim && i >= 5 ? 'wk-extra' : ''}" ${lim && i >= 5 ? 'hidden' : ''}>${cols.map((fd) => `<td class="${fd.type === 'number' ? 'num' : ''}">${cell(fd, r)}</td>`).join('')}</tr>`).join('');
      body.innerHTML = `<div class="table-wrap"><table class="wk-table"><thead><tr>${cols.map((fd) => `<th class="${fd.type === 'number' ? 'num' : ''}">${esc(fieldLabel(fd.name))}</th>`).join('')}</tr></thead><tbody>${trs}</tbody></table></div>${lim && res.rows.length > 5 ? `<button class="btn sm ghost wk-more" type="button" data-wk-more>${esc(t('wk_more'))}</button>` : ''}<div class="small muted wk-note">${esc(t('wk_showing', { n: res.rows.length, total: res.total }))}</div>${note}`;
      const more = $('[data-wk-more]', body);
      if (more) more.onclick = () => { const open = more.dataset.open !== '1'; more.dataset.open = open ? '1' : ''; $$('.wk-extra', body).forEach((r) => (r.hidden = !open)); more.textContent = t(open ? 'wk_less' : 'wk_more'); };
      return { csv: () => [cols.map((fd) => fieldLabel(fd.name)), ...res.rows.map((r) => cols.map((fd) => (r[fd.name] == null ? '' : r[fd.name])))] };
    }

    // groups: bar, column or donut
    const groups = res.groups.filter((g) => g.value > 0 || spec.viz !== 'donut');
    if (!groups.length || (spec.viz === 'donut' && !groups.some((g) => g.value > 0))) { body.innerHTML = h.empty(t('wk_empty')) + note; return { csv: () => [] }; }
    const val = (g) => fmtValue(g.value, mfd, cur);
    const csv = () => [[fieldLabel(res.grouped), aggLabel(spec)], ...groups.map((g) => [groupName(g, res), g.value])];
    const aria = `${title}: ${groups.map((g) => `${groupName(g, res)} ${val(g)}`).join(', ')}`;
    if (spec.viz === 'bar') {
      const svg = h.hbars(groups.map((g) => ({ label: groupName(g, res), segs: [{ v: Math.max(g.value, 0), cls: g.tone || 'c1', label: '' }], valueLabel: val(g), tipHtml: `${groupName(g, res)}: ${val(g)} (${t('wk_rows_n', { n: fmtNum(g.count) })})` })), { aria, labelW: 120, max: Math.max(1, ...groups.map((g) => g.value)) });
      body.innerHTML = svg + note;
      return { csv, chart: true };
    }
    if (spec.viz === 'column') {
      const max = Math.max(1, ...groups.map((g) => g.value));
      const cl = PMCL.get('htmlcol'), tot = groups.reduce((a, g) => a + Math.max(g.value, 0), 0);
      const lab = (g) => esc(PMCL.str(cl, { text: val(g), pct: PMCL.pctOf(g.value, tot) }));
      body.innerHTML = `<div class="wk-cols" role="img" aria-label="${esc(aria)}">${groups.map((g) => `<div class="wk-col" data-tip="${esc(`${groupName(g, res)}: ${val(g)} (${t('wk_rows_n', { n: fmtNum(g.count) })})`)}"><span class="wk-cv cl-t">${cl.on && cl.pos === 'above' ? lab(g) : ''}</span><span class="wk-bar-wrap"><i class="wk-bar ${g.tone || 'c1'}" style="height:${Math.max(0, (g.value / max) * 100).toFixed(1)}%">${cl.on && cl.pos === 'center' ? `<span class="cl-t cl-mid">${lab(g)}</span>` : ''}</i></span><span class="wk-cl">${cl.on && cl.pos === 'below' ? `<b class="cl-t">${lab(g)}</b><br>` : ''}${esc(groupName(g, res))}</span></div>`).join('')}</div>${note}`;
      return { csv };
    }
    // donut
    const parts = groups.filter((g) => g.value > 0).map((g, i) => ({ v: g.value, cls: g.tone || PALETTE[i % PALETTE.length], label: groupName(g, res), lab: val(g), raw: g }));
    const total = parts.reduce((s, p) => s + p.v, 0);
    body.innerHTML = `<div class="donut-wrap">${h.donut(parts, esc(fmtValue(total, mfd, cur)), aggLabel(spec))}${h.legend(parts.map((p) => [p.cls, p.label, esc(val(p.raw))]))}</div>${note}`;
    return { csv, chart: true };
  }

  // The overview pages call this once per mount with the data they loaded. It appends the widgets the person added.
  function extend(cfg, d, scope) {
    if (!d || !Array.isArray(d.widgets) || !d.widgets.length) return cfg;
    const pack = { datasets: d.datasets || {}, today: d.datasets_today || new Date().toISOString().slice(0, 10), truncated: d.datasets_truncated || {} };
    const widgets = { ...cfg.widgets }, order = cfg.order.slice();
    for (const w of d.widgets) {
      const id = 'cw_' + w.id;
      widgets[id] = { size: SIZE_OF[w.spec.viz] || 'm', title: '', label: w.title, community: { id: w.id, author: w.author, version: w.version, title: w.title, mine: w.mine }, render: (body, dd, ctx) => renderSpec(body, w, pack, ctx) };
      order.push(id);
    }
    return { ...cfg, widgets, order };
  }

  // ---------------- built in widgets ----------------
  const BUILTIN_GROUP = {
    kpi: 'overview', health: 'overview', portfolio: 'overview', activity: 'overview', pkpi: 'overview', pdecide: 'overview', pactivity: 'overview', pstatus: 'overview',
    radar: 'risk', pradar: 'risk',
    schedule: 'schedule', progress: 'schedule', overdue: 'schedule', pphases: 'schedule', pscurve: 'schedule', pcritical: 'schedule',
    deliverables: 'delivery', pdeliv: 'delivery',
    payments: 'financials', payments_list: 'financials', ppay: 'financials', pcash: 'financials', pcum: 'financials',
    workload: 'team', powners: 'team',
  };
  function builtins(scope) {
    const defs = scope === 'project' ? { ...(PM.pdash ? PM.pdash.widgets : {}), ...(PM.trends ? PM.trends.wrapped('project') : {}) } : PM.dash.h.WIDGETS;
    const order = scope === 'project' ? (PM.pdash ? PM.pdash.order : []).concat(PM.trends ? PM.trends.ids('project') : []) : PM.dash.main.order;
    return order.filter((id) => defs[id]).map((id) => {
      const dk = 'wd_' + id, desc = t(dk);
      return { kind: 'builtin', id, scope, def: defs[id], group: id.startsWith('tr_') ? 'trends' : BUILTIN_GROUP[id] || 'other', title: t(defs[id].title), desc: desc === dk ? tx('wd_trends', null, '') : desc };
    });
  }

  // ---------------- layout helpers ----------------
  const L = () => PM.dash.layout;
  const builtinOn = (scope, id) => !L().read(keyOf(scope)).hidden.includes(id);
  async function setBuiltin(scope, id, on) {
    const k = keyOf(scope), cur = L().read(k);
    const hidden = on ? cur.hidden.filter((x) => x !== id) : cur.hidden.includes(id) ? cur.hidden : cur.hidden.concat(id);
    await L().write(k, { order: cur.order, hidden, size: cur.size });
  }
  async function showCommunity(scope, wid) {
    const k = keyOf(scope), cur = L().read(k), id = 'cw_' + wid;
    if (cur.hidden.includes(id)) await L().write(k, { order: cur.order, hidden: cur.hidden.filter((x) => x !== id), size: cur.size });
  }
  async function dropCommunity(scope, wid) {
    const k = keyOf(scope), cur = L().read(k), id = 'cw_' + wid, size = { ...cur.size }; delete size[id];
    await L().write(k, { order: cur.order.filter((x) => x !== id), hidden: cur.hidden.filter((x) => x !== id), size });
  }
  async function installCommunity(scope, wid) {
    const r = await api('POST', `/api/widgets/${wid}/install`, { scope });
    await showCommunity(scope, wid);
    return r.widget;
  }
  async function uninstallCommunity(scope, wid) {
    const r = await api('DELETE', `/api/widgets/${wid}/install?scope=${scope}`);
    await dropCommunity(scope, wid);
    return r.widget;
  }

  // Remove from the overview menu (called by the grid). Resolves true once removed, with an Undo toast.
  async function removeFromOverview({ scope, key, id, cw, L: lay, undo }) {
    const size = lay && lay.size ? lay.size[id] : null;
    try { await api('DELETE', `/api/widgets/${cw.id}/install?scope=${scope}`); } catch (e) { toast(e.message, 'err'); return false; }
    toast(t('wm_removed', { title: cw.title }), '', {
      label: t('undo'), fn: async () => {
        try {
          await api('POST', `/api/widgets/${cw.id}/install`, { scope });
          if (size) { const cur = L().read(key); await L().write(key, { order: cur.order, hidden: cur.hidden, size: { ...cur.size, [id]: size } }); }
          undo && undo();
        } catch (e) { toast(e.message, 'err'); }
      },
    });
    return true;
  }

  // ---------------- saved layouts ----------------
  async function layoutsDialog({ scope, key, current }) {
    const m = PM.modal({ title: t('wl_title'), size: '', body: `<div class="wl"><div class="field"><label for="wlName">${esc(t('wl_save_as'))}</label><div class="row" style="gap:8px"><input id="wlName" maxlength="40" placeholder="${esc(t('wl_name_ph'))}" class="grow"><button class="btn primary" id="wlSave" type="button">${esc(t('save'))}</button></div><div class="small muted">${esc(t('wl_hint'))}</div></div><div id="wlList" class="wl-list"><div class="empty small">${PM.loader.html({ size: 'md' })}</div></div></div>` });
    let layouts = [];
    const cwIds = (lay) => lay.order.filter((x) => /^cw_\d+$/.test(x)).map((x) => Number(x.slice(3)));
    const draw = () => {
      $('#wlList', m.el).innerHTML = layouts.length ? layouts.map((l) => `<div class="wl-item list-item" data-id="${l.id}"><div class="grow"><div class="li-title">${esc(l.name)}</div><div class="small muted">${esc(t('wl_meta', { n: l.layout.order.length - l.layout.hidden.length, c: cwIds(l.layout).length }))}</div></div><div class="row qa"><button class="btn sm primary" data-act="apply" type="button">${esc(t('wl_apply'))}</button><button class="btn sm" data-act="update" type="button" data-tip="${esc(t('wl_update_tip'))}">${esc(t('wl_update'))}</button><button class="btn sm ghost icon" data-act="rename" type="button" aria-label="${esc(t('wl_rename'))}" data-tip="${esc(t('wl_rename'))}">${icon('edit')}</button><button class="btn sm ghost icon" data-act="delete" type="button" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('trash')}</button></div></div>`).join('') : `<div class="empty small">${esc(t('wl_none'))}</div>`;
    };
    const load = async () => { layouts = (await api('GET', `/api/layouts?scope=${scope}`)).layouts; draw(); };
    try { await load(); } catch (e) { $('#wlList', m.el).innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
    $('#wlSave', m.el).onclick = (ev) => PM.busy(ev.currentTarget, async () => {
      const name = $('#wlName', m.el).value.trim();
      if (!name) { toast(t('wl_name_needed'), 'err'); return; }
      await api('POST', '/api/layouts', { scope, name, layout: current() });
      $('#wlName', m.el).value = ''; await load(); toast(t('wl_saved', { name }), 'ok');
    });
    async function apply(l) {
      const before = current(), had = await api('GET', `/api/widgets/installed?scope=${scope}`);
      const haveIds = had.widgets.map((w) => w.id), want = cwIds(l.layout);
      const res = want.length ? await api('POST', '/api/widgets/install-many', { scope, ids: want }) : { installed: [], missing: [] };
      for (const wid of haveIds) if (!res.installed.includes(wid)) await api('DELETE', `/api/widgets/${wid}/install?scope=${scope}`);
      const gone = new Set(res.missing.map((x) => 'cw_' + x)), ok = (x) => !gone.has(x);
      await L().write(key, { order: l.layout.order.filter(ok), hidden: l.layout.hidden.filter(ok), size: Object.fromEntries(Object.entries(l.layout.size).filter(([k]) => ok(k))) });
      m.close();
      toast(res.missing.length ? t('wl_applied_missing', { name: l.name, n: res.missing.length }) : t('wl_applied', { name: l.name }), '', {
        label: t('undo'), fn: async () => {
          try {
            const back = cwIds(before);
            if (back.length) await api('POST', '/api/widgets/install-many', { scope, ids: back });
            const now = await api('GET', `/api/widgets/installed?scope=${scope}`);
            for (const w of now.widgets) if (!back.includes(w.id)) await api('DELETE', `/api/widgets/${w.id}/install?scope=${scope}`);
            await L().write(key, before); PM.vt(PM.route);
          } catch (e) { toast(e.message, 'err'); }
        },
      });
      PM.vt(PM.route);
    }
    m.el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      const l = layouts.find((x) => String(x.id) === b.closest('[data-id]').dataset.id); if (!l) return;
      if (b.dataset.act === 'apply') await PM.busy(b, () => apply(l));
      else if (b.dataset.act === 'update') await PM.busy(b, async () => { await api('PUT', `/api/layouts/${l.id}`, { layout: current() }); await load(); toast(t('wl_updated', { name: l.name }), 'ok'); });
      else if (b.dataset.act === 'delete') {
        await PM.busy(b, async () => {
          await api('DELETE', `/api/layouts/${l.id}`); await load();
          toast(t('wl_deleted', { name: l.name }), '', { label: t('undo'), fn: async () => { try { await api('POST', '/api/layouts', { scope, name: l.name, layout: l.layout }); toast(t('wl_restored'), 'ok'); } catch (e) { toast(e.message, 'err'); } } });
        });
      } else if (b.dataset.act === 'rename') {
        const row = b.closest('.wl-item'), cell = $('.grow', row);
        cell.innerHTML = `<input class="wl-rename" maxlength="40" value="${esc(l.name)}" aria-label="${esc(t('wl_rename'))}">`;
        const inp = $('input', cell); inp.focus(); inp.select();
        const done = async (save) => {
          const name = inp.value.trim();
          if (!save || !name || name === l.name) return draw();
          try { await api('PUT', `/api/layouts/${l.id}`, { name }); await load(); } catch (e) { toast(e.message, 'err'); draw(); }
        };
        inp.onkeydown = (e2) => { if (e2.key === 'Enter') done(true); else if (e2.key === 'Escape') { e2.stopPropagation(); done(false); } };
        inp.onblur = () => done(true);
      }
    });
  }

  // ---------------- stars ----------------
  const stars = (avg, n) => `<span class="wr-stars" role="img" aria-label="${esc(n ? t('wr_avg', { avg: fmtNum(avg), n }) : t('wr_none'))}">${[1, 2, 3, 4, 5].map((i) => icon('star', i <= Math.round(avg) && n ? 'fill' : '')).join('')}</span><span class="small muted">${n ? `${fmtNum(avg)} (${n})` : esc(t('wr_none'))}</span>`;

  // ---------------- preview with the person's own data ----------------
  async function openPreview(item, scope, onChange) {
    await PM.loadProjects();
    const projects = S.projects || [];
    const isBuilt = item.kind === 'builtin';
    let w = item.w;
    if (!isBuilt && !w.spec) { try { w = (await api('GET', `/api/widgets/${w.id}`)).widget; } catch (e) { toast(e.message, 'err'); return; } }
    const title = isBuilt ? item.title : w.title;
    const needProject = scope === 'project';
    const st = { pid: needProject ? (projects[0] ? projects[0].id : '') : '', size: isBuilt ? (item.def.size || 'm') : SIZE_OF[w.spec.viz] || 'm', seq: 0 };
    const prevMode = PM.fx.mode;
    const canPick = !isBuilt || needProject;
    const opts = (needProject ? '' : `<option value="">${esc(t('wp_all'))}</option>`) + projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const m = PM.modal({
      title: t('wp_title', { title }), size: 'lg',
      onClose: () => { PM.fx.mode = prevMode; },
      body: `<div class="wp"><div class="wp-bar row">${canPick ? `<label class="wp-pick" for="wpData">${esc(t('wp_data'))}</label><select id="wpData" ${projects.length ? '' : 'disabled'}>${opts}</select>` : `<span class="small muted">${esc(t('wp_data_all'))}</span>`}<span class="grow"></span><div class="seg" id="wpSize" role="group" aria-label="${esc(t('dash_size'))}">${['s', 'm', 'l'].map((s) => `<button type="button" data-s="${s}" class="${st.size === s ? 'on' : ''}" aria-pressed="${st.size === s}">${t('dash_size_' + s)}</button>`).join('')}</div></div>
        ${needProject && !projects.length ? `<div class="empty small">${esc(t('wp_need_project'))}</div>` : `<div class="wp-stage"><section class="dw wp-frame sz-${st.size}" id="wpFrame"><header class="dw-h"><h3>${esc(title)}</h3></header><div class="dw-body wp-inert" id="wpBody"><div class="empty">${PM.loader.html({ size: 'md' })}</div></div></section></div><p class="small muted wp-note">${esc(t('wp_note'))}</p>`}</div>`,
      footer: `<button class="btn" data-close type="button">${esc(t('close'))}</button><span class="grow"></span><button class="btn primary" id="wpAdd" type="button"></button>`,
    });
    const body = $('#wpBody', m.el), frame = $('#wpFrame', m.el);
    // Nothing inside a preview acts: links and buttons are blocked so a preview can never change real data.
    if (body) body.addEventListener('click', (e) => { if (e.target.closest('a,button,[data-go],[data-act],select,input') && !e.target.closest('[data-wk-more]')) { e.preventDefault(); e.stopPropagation(); } }, true);
    const isAdded = () => (isBuilt ? builtinOn(scope, item.id) : !!(w.added && w.added[scope]));
    const paintAdd = () => { const b = $('#wpAdd', m.el); b.className = 'btn ' + (isAdded() ? '' : 'primary'); b.innerHTML = isAdded() ? `${icon('trash')}${esc(t('wm_remove'))}` : `${icon('plus')}${esc(t('wm_add_to', { scope: scopeLabel(scope).toLowerCase() }))}`; };
    paintAdd();
    $('#wpAdd', m.el).onclick = (ev) => PM.busy(ev.currentTarget, async () => {
      const was = isAdded();
      if (isBuilt) await setBuiltin(scope, item.id, !was); else { const nw = was ? await uninstallCommunity(scope, w.id) : await installCommunity(scope, w.id); if (nw) w = { ...w, ...nw, spec: w.spec }; }
      paintAdd(); onChange && onChange(isBuilt ? null : w); toast(t(was ? 'wm_removed' : 'wm_added', { title }), 'ok');
    });
    if (!body) return;
    const paint = (data) => {
      const my = ++st.seq; void my;
      PM.fx.mode = needProject || !projects.length ? 'native' : 'USD';
      frame.className = `dw wp-frame sz-${st.size}`;
      const span = { l: 12, m: 6, s: 4 }[st.size];
      body.innerHTML = '';
      H().setWidth(Math.max(240, Math.round(frame.clientWidth || body.clientWidth || 360) - 38));
      let info;
      try {
        const ctx = { get data() { return data.d; }, async reload() { return data.d; }, nav: blank };
        info = isBuilt ? item.def.render(body, data.d, ctx) : renderSpec(body, w, data.pack, ctx, { limit: true });
      } catch (e) { body.innerHTML = `<div class="empty small">${esc(t('wk_broken'))}</div>`; }
      void span; void info;
      H().bindTips(body); H().countUp(body);
    };
    let cache = null;
    const load = async () => {
      body.innerHTML = PM.loader.html({ size: 'md' });
      try {
        if (isBuilt) cache = { d: await api('GET', needProject ? `/api/projects/${st.pid}/dashboard` : '/api/dashboard') };
        else { const r = await api('GET', `/api/widgets/datasets${needProject && st.pid ? `?project_id=${st.pid}` : st.pid ? `?project_id=${st.pid}` : ''}`); cache = { pack: { datasets: r.datasets, today: r.today, truncated: r.truncated || {} } }; }
        paint(cache);
      } catch (e) { body.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
    };
    const pick = $('#wpData', m.el);
    if (pick) { pick.value = String(st.pid); pick.onchange = () => { st.pid = pick.value; load(); }; }
    $('#wpSize', m.el).onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st.size = b.dataset.s; $$('#wpSize button', m.el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); if (cache) paint(cache); };
    if (needProject && !st.pid) return;
    load();
  }

  // ---------------- details and ratings ----------------
  async function openDetails(w0, scope, onChange) {
    let data;
    try { data = await api('GET', `/api/widgets/${w0.id}`); } catch (e) { toast(e.message, 'err'); return; }
    let w = data.widget, reviews = data.reviews, pick = 0;
    const m = PM.modal({ title: w.title, size: 'lg', body: '<div id="wdBody"></div>', footer: `<button class="btn" data-close type="button">${esc(t('close'))}</button>` });
    const fresh = async () => { data = await api('GET', `/api/widgets/${w.id}`); w = data.widget; reviews = data.reviews; draw(); onChange && onChange(); };
    function draw() {
      const mine = reviews.find((r) => r.mine), canRate = !w.mine && (w.added.portfolio || w.added.project);
      const cur = pick || (w.my_rating ? w.my_rating.stars : 0);
      const addBtn = (sc) => `<button class="btn sm ${w.added[sc] ? '' : 'primary'}" data-add="${sc}" type="button">${w.added[sc] ? icon('trash') + esc(t('wm_remove_from', { scope: scopeLabel(sc).toLowerCase() })) : icon('plus') + esc(t('wm_add_to', { scope: scopeLabel(sc).toLowerCase() }))}</button>`;
      $('#wdBody', m.el).innerHTML = `<div class="wd">
        <div class="row wd-meta"><span class="chip">${esc(groupLabel(w.group))}</span><span class="small muted">${esc(t('wm_by', { name: w.author }))}</span><span class="small muted">${esc(t('wm_version', { n: w.version }))}</span><span class="small muted">${esc(t('wm_uses', { n: w.installs }))}</span></div>
        <p class="wd-desc">${esc(w.description || t('wm_no_desc'))}</p>
        <div class="small muted">${esc(t('wd_reads', { ds: dsLabel(w.dataset).toLowerCase(), viz: t('wb_viz_' + w.viz).toLowerCase() }))}</div>
        <div class="row wd-rate">${stars(w.rating.avg, w.rating.count)}</div>
        <div class="row wd-actions"><button class="btn sm" data-prev type="button">${icon('eye')}${esc(t('wm_preview'))}</button>${addBtn('portfolio')}${addBtn('project')}</div>
        <h4>${esc(t('wr_your'))}</h4>
        ${w.mine ? `<div class="small muted">${esc(t('wr_own'))}</div>` : !canRate ? `<div class="small muted">${esc(t('wr_need_add'))}</div>` : `<div class="wr-input"><div class="wr-pick" role="radiogroup" aria-label="${esc(t('wr_your'))}">${[1, 2, 3, 4, 5].map((i) => `<button type="button" role="radio" aria-checked="${i === cur}" class="wr-star ${i <= cur ? 'on' : ''}" data-star="${i}" aria-label="${esc(t('wr_n_stars', { n: i }))}" data-tip="${esc(t('wr_n_stars', { n: i }))}">${icon('star', i <= cur ? 'fill' : '')}</button>`).join('')}</div>
          <textarea id="wrComment" maxlength="280" rows="2" placeholder="${esc(t('wr_comment_ph'))}">${esc(mine ? mine.comment : w.my_rating ? w.my_rating.comment : '')}</textarea>
          <div class="row"><button class="btn sm primary" data-rate type="button" ${cur ? '' : 'disabled'}>${esc(t('wr_save'))}</button>${w.my_rating ? `<button class="btn sm ghost" data-unrate type="button">${esc(t('wr_remove'))}</button>` : ''}</div></div>`}
        <h4>${esc(t('wr_reviews'))}</h4>
        ${reviews.length ? reviews.slice(0, 5).map((r) => `<div class="wr-review"><div class="row"><b>${esc(r.name)}${r.mine ? ` (${esc(t('wr_you'))})` : ''}</b><span class="wr-stars">${[1, 2, 3, 4, 5].map((i) => icon('star', i <= r.stars ? 'fill' : '')).join('')}</span></div>${r.comment ? `<div class="small">${esc(r.comment)}</div>` : ''}</div>`).join('') : `<div class="small muted">${esc(t('wr_no_reviews'))}</div>`}</div>`;
    }
    draw();
    m.el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.prev !== undefined) { openPreview({ kind: 'community', w }, scope, fresh); return; }
      if (b.dataset.add) { await PM.busy(b, async () => { const sc = b.dataset.add; if (w.added[sc]) await uninstallCommunity(sc, w.id); else await installCommunity(sc, w.id); await fresh(); }); return; }
      if (b.dataset.star) { pick = Number(b.dataset.star); const c = $('#wrComment', m.el).value; draw(); $('#wrComment', m.el).value = c; return; }
      if (b.dataset.rate !== undefined) { await PM.busy(b, async () => { await api('PUT', `/api/widgets/${w.id}/rating`, { stars: pick || (w.my_rating && w.my_rating.stars), comment: $('#wrComment', m.el).value }); pick = 0; await fresh(); toast(t('wr_thanks'), 'ok'); }); return; }
      if (b.dataset.unrate !== undefined) await PM.busy(b, async () => { await api('DELETE', `/api/widgets/${w.id}/rating`); pick = 0; await fresh(); });
    });
  }

  // ---------------- the marketplace page ----------------
  PM.views.widgets = async function (params) {
    params = params || new URLSearchParams('');
    const token = S.nav;
    const st = {
      scope: params.get('scope') === 'project' ? 'project' : 'portfolio', tab: params.get('tab') === 'mine' ? 'mine' : 'market',
      q: '', group: '', source: 'all', sort: 'rating', min: 0, items: [], mine: [], loading: true, truncated: false,
    };
    PM.shell('widgets', `${PM.loader.html({ size: 'page' })}`);
    await PM.loadProjects();
    if (PM.stale(token)) return;
    const SOURCES = ['all', 'builtin', 'community', 'added', 'mine'], SORTS = ['rating', 'installs', 'newest', 'name'];
    const page = () => $('#content .page');

    page().innerHTML = `
      <div class="page-head"><div><h1>${esc(t('wm_title'))}</h1><p class="muted wm-sub">${esc(t('wm_sub'))}</p></div><a class="btn primary" href="#/widgets/new">${icon('plus')}${esc(t('wb_build'))}</a></div>
      <div class="wm-top row">
        <div class="seg" id="wmTab" role="tablist" aria-label="${esc(t('wm_title'))}"><button type="button" role="tab" data-tab="market">${esc(t('wm_tab_market'))}</button><button type="button" role="tab" data-tab="mine">${esc(t('wm_tab_mine'))}</button></div>
        <span class="grow"></span>
        <label class="small muted" for="wmScopeSeg">${esc(t('wm_add_to_label'))}</label>
        <div class="seg" id="wmScope" role="group" aria-label="${esc(t('wm_add_to_label'))}"><button type="button" data-scope="portfolio">${esc(t('wm_scope_portfolio'))}</button><button type="button" data-scope="project">${esc(t('wm_scope_project'))}</button></div>
      </div>
      <div id="wmFilters" class="wm-filters card"></div>
      <div id="wmBody"></div>`;

    const filtersHtml = () => `<div class="wm-search"><span class="wm-search-i">${icon('search')}</span><input id="wmQ" type="search" value="${esc(st.q)}" placeholder="${esc(t('wm_search_ph'))}" aria-label="${esc(t('wm_search_ph'))}"></div>
      <div class="wm-selects row"><label>${esc(t('wm_source'))}<select id="wmSource">${SOURCES.map((s) => `<option value="${s}" ${st.source === s ? 'selected' : ''}>${esc(t('wm_src_' + s))}</option>`).join('')}</select></label>
      <label>${esc(t('wm_sort'))}<select id="wmSort">${SORTS.map((s) => `<option value="${s}" ${st.sort === s ? 'selected' : ''}>${esc(t('wm_sort_' + s))}</option>`).join('')}</select></label>
      <label>${esc(t('wm_min'))}<select id="wmMin">${[0, 3, 4, 5].map((n) => `<option value="${n}" ${st.min === n ? 'selected' : ''}>${esc(n ? t('wm_min_n', { n }) : t('wm_min_any'))}</option>`).join('')}</select></label></div>
      <div class="wm-groups" role="group" aria-label="${esc(t('wm_group'))}"><button type="button" class="wm-gchip ${st.group ? '' : 'on'}" data-g="" aria-pressed="${!st.group}">${esc(t('wm_all_groups'))}</button>${WS.GROUPS.map((g) => `<button type="button" class="wm-gchip ${st.group === g ? 'on' : ''}" data-g="${g}" aria-pressed="${st.group === g}">${esc(groupLabel(g))}</button>`).join('')}</div>`;

    // community widgets come from the server (search, group, sort and rating filters run there)
    let reqSeq = 0;
    const loadMarket = async () => {
      const my = ++reqSeq; st.loading = true; drawBody();
      const qs = new URLSearchParams();
      if (st.q.trim()) qs.set('q', st.q.trim());
      if (st.group) qs.set('group', st.group);
      if (st.min) qs.set('min_rating', String(st.min));
      qs.set('sort', st.sort === 'rating' ? 'rating' : st.sort);
      if (st.source === 'added' || st.source === 'mine') qs.set('source', st.source);
      try {
        const skip = st.source === 'builtin';
        const r = skip ? { widgets: [], truncated: false } : await api('GET', '/api/widgets?' + qs);
        if (my !== reqSeq || PM.stale(token)) return;
        st.items = r.widgets; st.truncated = r.truncated;
      } catch (e) { if (my !== reqSeq) return; st.items = []; toast(e.message, 'err'); }
      st.loading = false; drawBody();
    };
    const loadMine = async () => {
      st.loading = true; drawBody();
      try { st.mine = (await api('GET', '/api/widgets/mine')).widgets; } catch (e) { st.mine = []; toast(e.message, 'err'); }
      if (PM.stale(token)) return;
      st.loading = false; drawBody();
    };

    const matchesBuiltin = (b) => {
      if (st.group && b.group !== st.group) return false;
      if (st.min) return false; // built in widgets have no rating
      if (st.source !== 'all' && st.source !== 'builtin' && !(st.source === 'added' && builtinOn(st.scope, b.id))) return false;
      const q = st.q.trim().toLowerCase();
      return !q || b.title.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q) || groupLabel(b.group).toLowerCase().includes(q);
    };
    const visibleItems = () => {
      const built = st.source === 'community' || st.source === 'mine' ? [] : builtins(st.scope).filter(matchesBuiltin);
      let comm = st.items.map((w) => ({ kind: 'community', w, group: w.group }));
      if (st.source === 'community') comm = comm.filter((x) => !x.w.mine);
      if (st.source === 'builtin') comm = [];
      return { built, comm };
    };

    function cardHtml(it) {
      const sc = st.scope;
      if (it.kind === 'builtin') {
        const on = builtinOn(sc, it.id);
        return `<article class="wm-card ${on ? 'is-added' : ''}" data-k="b:${it.id}"><header><h3>${esc(it.title)}</h3><span class="chip">${esc(t('wm_builtin'))}</span></header><p class="wm-desc">${esc(it.desc)}</p><div class="wm-meta small muted">${on ? `<span class="chip green">${icon('check')}${esc(t('wm_on_overview'))}</span>` : ''}</div><footer class="row"><button class="btn sm" data-act="preview" type="button">${icon('eye')}${esc(t('wm_preview'))}</button><span class="grow"></span><button class="btn sm ${on ? '' : 'primary'}" data-act="toggle" type="button">${on ? icon('trash') + esc(t('wm_remove')) : icon('plus') + esc(t('wm_add'))}</button></footer></article>`;
      }
      const w = it.w, on = w.added[sc];
      return `<article class="wm-card ${on ? 'is-added' : ''}" data-k="c:${w.id}"><header><h3><button class="wm-title" data-act="details" type="button">${esc(w.title)}</button></h3>${w.mine ? `<span class="chip blue">${esc(t('wm_yours'))}</span>` : ''}</header><div class="small muted wm-author">${esc(t('wm_by', { name: w.author }))}${w.version > 1 ? ` · ${esc(t('wm_version', { n: w.version }))}` : ''}</div><p class="wm-desc">${esc(w.description || t('wm_no_desc'))}</p><div class="wm-meta row small">${stars(w.rating.avg, w.rating.count)}<span class="muted">· ${esc(t('wm_uses', { n: w.installs }))}</span>${on ? `<span class="chip green">${icon('check')}${esc(t('wm_on_overview'))}</span>` : ''}</div><footer class="row"><button class="btn sm" data-act="preview" type="button">${icon('eye')}${esc(t('wm_preview'))}</button><button class="btn sm ghost" data-act="details" type="button">${esc(t('wm_details'))}</button><span class="grow"></span><button class="btn sm ${on ? '' : 'primary'}" data-act="toggle" type="button">${on ? icon('trash') + esc(t('wm_remove')) : icon('plus') + esc(t('wm_add'))}</button></footer></article>`;
    }

    function drawMarket() {
      const { built, comm } = visibleItems();
      const all = built.concat(comm);
      if (st.loading && !all.length) return `<div class="empty">${PM.loader.html({ size: 'md' })}</div>`;
      if (!all.length) return `<div class="empty">${esc(t('wm_none'))}</div>`;
      const sections = WS.GROUPS.map((g) => ({ g, list: all.filter((x) => x.group === g) })).filter((s) => s.list.length);
      return sections.map((s) => `<section class="wm-section"><h2 class="wm-h">${esc(groupLabel(s.g))} <span class="small muted">${s.list.length}</span></h2><div class="wm-grid">${s.list.map(cardHtml).join('')}</div></section>`).join('') + (st.truncated ? `<p class="small muted">${esc(t('wm_truncated'))}</p>` : '');
    }

    function drawMine() {
      if (st.loading && !st.mine.length) return `<div class="empty">${PM.loader.html({ size: 'md' })}</div>`;
      if (!st.mine.length) return `<div class="empty"><p>${esc(t('wm_mine_none'))}</p><a class="btn primary" href="#/widgets/new">${icon('plus')}${esc(t('wb_build'))}</a></div>`;
      return `<div class="card wm-mine">${st.mine.map((w) => {
        const on = w.added[st.scope], pub = w.status === 'published';
        return `<div class="list-item wm-mine-row" data-k="c:${w.id}"><div class="grow"><div class="li-title">${esc(w.title)}</div><div class="small muted">${esc(groupLabel(w.group))} · ${esc(dsLabel(w.dataset))} · ${esc(t('wb_viz_' + w.viz))}</div><div class="row small wm-meta"><span class="chip ${pub ? 'green' : w.status === 'draft' ? '' : 'amber'}">${esc(t('wm_status_' + w.status))}</span>${pub ? `<span class="muted">${esc(t('wm_version', { n: w.version }))}</span>${stars(w.rating.avg, w.rating.count)}<span class="muted">· ${esc(t('wm_uses', { n: w.installs }))}</span>` : ''}${w.dirty ? `<span class="chip amber">${esc(t('wm_unpublished_changes'))}</span>` : ''}</div>
          <div class="row qa"><a class="btn sm" href="#/widgets/${w.id}/edit">${icon('edit')}${esc(t('edit'))}</a><button class="btn sm" data-act="preview" type="button">${icon('eye')}${esc(t('wm_preview'))}</button><button class="btn sm ${on ? '' : ''}" data-act="toggle" type="button">${on ? icon('trash') + esc(t('wm_remove')) : icon('plus') + esc(t('wm_add'))}</button>${pub ? '' : `<button class="btn sm primary" data-act="publish" type="button">${esc(t('wm_publish'))}</button>`}${pub && w.dirty ? `<button class="btn sm primary" data-act="publish" type="button">${esc(t('wm_publish_update'))}</button>` : ''}${pub ? `<button class="btn sm" data-act="unpublish" type="button">${esc(t('wm_unpublish'))}</button>` : ''}<button class="btn sm ghost danger-text" data-act="delete" type="button">${icon('trash')}${esc(t('delete'))}</button></div></div></div>`;
      }).join('')}</div>`;
    }

    function drawBody() {
      $$('#wmTab button').forEach((b) => { const on = b.dataset.tab === st.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      $$('#wmScope button').forEach((b) => { const on = b.dataset.scope === st.scope; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      $('#wmFilters').hidden = st.tab !== 'market';
      $('#wmBody').innerHTML = st.tab === 'market' ? drawMarket() : drawMine();
    }
    const paintFilters = () => { const f = $('#wmFilters'); const had = document.activeElement && document.activeElement.id === 'wmQ'; f.innerHTML = filtersHtml(); if (had) { const q = $('#wmQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } };

    // refresh one card after its state changed, without redrawing the page
    const itemByKey = (k) => (k.startsWith('b:') ? builtins(st.scope).find((b) => b.id === k.slice(2)) : { kind: 'community', w: [...st.items, ...st.mine].find((w) => 'c:' + w.id === k) });
    const replaceWidget = (nw) => {
      if (!nw) return;
      st.items = st.items.map((x) => (x.id === nw.id ? { ...x, ...nw } : x));
      st.mine = st.mine.map((x) => (x.id === nw.id ? { ...x, ...nw } : x));
    };

    const toggle = async (it) => {
      const sc = st.scope, was = it.kind === 'builtin' ? builtinOn(sc, it.id) : it.w.added[sc], title = it.kind === 'builtin' ? it.title : it.w.title;
      const apply = async (on) => {
        if (it.kind === 'builtin') await setBuiltin(sc, it.id, on);
        else replaceWidget(on ? await installCommunity(sc, it.w.id) : await uninstallCommunity(sc, it.w.id));
      };
      await apply(!was);
      drawBody();
      toast(t(was ? 'wm_removed' : 'wm_added', { title }), '', { label: t('undo'), fn: async () => { try { await apply(was); drawBody(); } catch (e) { toast(e.message, 'err'); } } });
    };

    page().addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-act]'); if (!b) return;
      const row = b.closest('[data-k]'); if (!row) return;
      const it = itemByKey(row.dataset.k); if (!it || (it.kind === 'community' && !it.w)) return;
      const act = b.dataset.act;
      if (act === 'preview') return openPreview(it, st.scope, (nw) => { if (nw) replaceWidget(nw); drawBody(); });
      if (act === 'details') return openDetails(it.w, st.scope, () => { api('GET', `/api/widgets/${it.w.id}`).then((r) => { replaceWidget(r.widget); drawBody(); }).catch(blank); });
      if (act === 'toggle') return PM.busy(b, () => toggle(it));
      const w = it.w;
      if (act === 'publish') {
        const ok = await PM.confirmDlg({ title: t(w.status === 'published' ? 'wm_publish_update' : 'wm_publish'), message: esc(t('wm_publish_msg', { title: w.title })), ok: t(w.status === 'published' ? 'wm_publish_update' : 'wm_publish') });
        if (!ok) return;
        return PM.busy(b, async () => { replaceWidget((await api('POST', `/api/widgets/${w.id}/publish`)).widget); drawBody(); toast(t('wm_published', { title: w.title }), 'ok'); });
      }
      if (act === 'unpublish') return PM.busy(b, async () => { replaceWidget((await api('POST', `/api/widgets/${w.id}/unpublish`)).widget); drawBody(); toast(t('wm_unpublished', { title: w.title }), 'ok'); });
      if (act === 'delete') {
        const ok = await PM.confirmDlg({ title: t('wm_delete_title'), message: esc(t('wm_delete_msg', { title: w.title })), ok: t('delete'), danger: true });
        if (!ok) return;
        return PM.busy(b, async () => { await api('DELETE', `/api/widgets/${w.id}`); st.mine = st.mine.filter((x) => x.id !== w.id); st.items = st.items.filter((x) => x.id !== w.id); drawBody(); toast(t('wm_deleted', { title: w.title }), 'ok'); });
      }
    });

    $('#wmTab').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === st.tab) return; st.tab = b.dataset.tab; history.replaceState(null, '', `#/widgets?scope=${st.scope}${st.tab === 'mine' ? '&tab=mine' : ''}`); if (st.tab === 'mine') loadMine(); else drawBody(); };
    $('#wmScope').onclick = (e) => { const b = e.target.closest('[data-scope]'); if (!b || b.dataset.scope === st.scope) return; st.scope = b.dataset.scope; history.replaceState(null, '', `#/widgets?scope=${st.scope}${st.tab === 'mine' ? '&tab=mine' : ''}`); if (st.tab === 'market') { loadMarket(); } else drawBody(); };

    const filters = $('#wmFilters');
    let qTimer = null;
    filters.addEventListener('input', (e) => { if (e.target.id !== 'wmQ') return; st.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(loadMarket, 250); });
    filters.addEventListener('change', (e) => {
      if (e.target.id === 'wmSource') st.source = e.target.value; else if (e.target.id === 'wmSort') st.sort = e.target.value; else if (e.target.id === 'wmMin') st.min = Number(e.target.value); else return;
      loadMarket();
    });
    filters.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; st.group = b.dataset.g; paintFilters(); loadMarket(); });

    paintFilters();
    if (st.tab === 'mine') { await loadMine(); } else await loadMarket();
    drawBody();
  };

  PM.widgets = { extend, layoutsDialog, removeFromOverview, renderSpec, stars, labels: { group: groupLabel, ds: dsLabel, field: fieldLabel, value: valueLabel, scope: scopeLabel }, specMsg, fmtNum, openPreview, SIZE_OF };
})();
