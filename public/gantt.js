/* Gantt chart component. Plain JavaScript, no dependencies.
   Drag bars to move, drag edges to resize, drag the triangle for progress,
   drag the round connector to another bar to create a dependency. */
(function () {
  const DAY = 864e5;
  const P = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const F = (d) => d.toISOString().slice(0, 10);
  const addD = (s, n) => F(new Date(P(s).getTime() + n * DAY));
  const diff = (a, b) => Math.round((P(b) - P(a)) / DAY);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ROW = 34, H1 = 26, H2 = 30, HEAD = H1 + H2;
  const ZOOM = { day: 30, week: 12, month: 4 };
  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>', flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>', trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>',
    indent: '<path d="M3 6h18M11 12h10M11 18h10M3 9l3 3-3 3"/>', outdent: '<path d="M3 6h18M11 12h10M11 18h10M6 9l-3 3 3 3"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    expand: '<path d="m7 8 5-5 5 5M7 16l5 5 5-5"/>', collapse: '<path d="m7 4 5 5 5-5M7 20l5-5 5 5"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    full: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>', exit: '<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>',
    today: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>', layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>', cols: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', pin: '<path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3Z"/>', auto: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  };
  Object.assign(ICON, {
    minus: '<path d="M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    save: '<path d="M5 3h11l4 4v14H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>', download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>', print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', diamond: '<path d="m12 3 8 9-8 9-8-9Z"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16m0 0v5m0-5h5M3 12A9 9 0 0 1 18.5 5.8L21 8m0 0V3m0 5h-5"/>', hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6m0-1V4a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.5L8 15"/>',
    chevup: '<path d="m6 15 6-6 6 6"/>', chevdown: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', csv: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5M8 13h8M8 17h8"/>',
  });
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24">${ICON[n] || ''}</svg>`;

  const FILTER_LIST = [['all', 'g_f_all'], ['open', 'g_f_open'], ['late', 'g_f_late'], ['critical', 'g_f_critical'], ['milestones', 'g_f_milestones'], ['flag', 'g_f_flag'], ['manual', 'g_f_manual'], ['unlinked', 'g_f_unlinked'], ['linked', 'g_f_linked'], ['done', 'g_f_done']];

  class Gantt {
    constructor(root, opts) {
      this.root = root;
      this.o = opts;
      this.t = opts.t || ((k) => k);
      this.tasks = [];
      this.cal = { days: new Set([1, 2, 3, 4, 5]), holidays: new Set() };
      this.today = F(new Date());
      this.ui = { zoom: 'week', critical: true, baseline: true, compact: false, z: 1, selected: null, multi: new Set(), anchor: null, collapsed: new Set(), legend: true, filter: 'all', q: '', tab: 'task', ribbon: true };
      try { this.ui.colW = JSON.parse(localStorage.getItem('pm_gt_cols') || '{}') || {}; } catch (e) { this.ui.colW = {}; }
      try { const sv = localStorage.getItem('pm_rb_tab'); if (sv) this.ui.tab = sv; if (localStorage.getItem('pm_rb_open') === '0') this.ui.ribbon = false; const lw = Number(localStorage.getItem('pm_gt_leftw')); if (lw >= 160) this.ui.leftW = lw; } catch (e) { /* storage blocked */ }
      this.items = [];
      this.impactOn = true;
      this.canUndo = false;
      this.hasBaseline = false;
      this.resources = [];
      this.firstRender = true;
      this.build();
    }

    // ---------- calendar ----------
    isWork(s) { return this.cal.days.has(P(s).getUTCDay()) && !this.cal.holidays.has(s); }
    nextWork(s) { let g = 0; while (!this.isWork(s) && g++ < 800) s = addD(s, 1); return s; }
    addWork(s, n) { s = this.nextWork(s); while (n > 0) { s = addD(s, 1); if (this.isWork(s)) n--; } return s; }
    countWork(a, b) { let n = 0; for (let d = a; d <= b; d = addD(d, 1)) if (this.isWork(d)) n++; return n; }
    finishOf(start, dur, ms) { const s = this.nextWork(start); return ms || dur <= 0 ? s : this.addWork(s, dur - 1); }

    setData(d) {
      this.tasks = d.tasks;
      this.cal = { days: new Set(d.calendar.work_days), holidays: new Set(d.calendar.holidays) };
      this.today = d.today;
      this.hasBaseline = d.has_baseline;
      this.resources = d.resources || [];
      this.deliverables = d.deliverables || [];
      this.items = d.items || [];
      this.itemMap = new Map(this.items.map((i) => [i.id, i]));
      if (d.impact_check !== undefined) this.impactOn = d.impact_check;
      { const have = new Set(this.tasks.map((x) => x.id)); for (const id of [...this.ui.multi]) if (!have.has(id)) this.ui.multi.delete(id); if (this.ui.selected != null && !have.has(this.ui.selected)) this.ui.selected = this.ui.multi.size ? [...this.ui.multi].pop() : null; if (this.ui.anchor != null && !have.has(this.ui.anchor)) this.ui.anchor = null; }
      // very large plans open collapsed to work package level, so the first view is fast and readable
      if (!this._auto && this.tasks.length > 400) {
        this._auto = true; this.ui.level = 3; this.ui.collapsed = new Set();
        for (const t of this.tasks) if (t.summary && this.depthOf(t) >= 3) this.ui.collapsed.add(t.id);
      }
      this.render();
    }

    // ---------- layout ----------
    baseCols() {
      const c = this.ui.compact;
      const b = c ? [['num', 'wbs', 58], ['md', 'mode', 34], ['nm', 'task', 250]] : [['num', 'wbs', 64], ['md', 'mode', 36], ['nm', 'task', 260], ['pd', 'pred', 112], ['dt', 'start', 106], ['du', 'dur', 56], ['dt', 'finish', 106], ['pc', 'pct', 62], ['ow', 'owner', 140]];
      const cw = this.ui.colW || {};
      for (const x of b) if (cw[x[1]]) x[2] = cw[x[1]];
      return b;
    }
    // The width of the table can be dragged. Extra width goes to the task column, and a narrower table clips the right hand columns.
    cols() {
      const base = this.baseCols().map((c) => c.slice());
      if (this.ui.leftW) {
        const nat = base.reduce((a, c) => a + c[2], 0), i = base.findIndex((c) => c[0] === 'nm');
        base[i][2] = Math.max(120, base[i][2] + this.leftTarget() - nat);
      }
      return base;
    }
    leftTarget() { return Math.max(160, Math.min(Number(this.ui.leftW) || 0, Math.max(240, (this.scroll ? this.scroll.clientWidth : 1200) - 160))); }
    leftW() { return this.ui.leftW ? this.leftTarget() : this.baseCols().reduce((s, c) => s + c[2], 0); }

    rows() {
      const ids = new Set(this.tasks.map((t) => t.id));
      const by = new Map();
      for (const t of this.tasks) {
        const k = t.parent_id && ids.has(t.parent_id) ? t.parent_id : 0;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(t);
      }
      for (const arr of by.values()) arr.sort((a, b) => a.position - b.position || a.id - b.id);
      const all = new Map();
      const wk = (pid, pre) => (by.get(pid) || []).forEach((x, i) => { const w = pre ? `${pre}.${i + 1}` : `${i + 1}`; all.set(x.id, w); wk(x.id, w); });
      wk(0, '');
      this._wbsAll = all;
      const keep = this.keepSet();
      const out = [];
      const walk = (pid, depth, wbs, trail) => {
        const arr = (by.get(pid) || []).filter((t) => !keep || keep.has(t.id));
        arr.forEach((t, i) => {
          t._depth = depth; t._wbs = all.get(t.id) || (wbs ? `${wbs}.${i + 1}` : `${i + 1}`);
          t._last = i === arr.length - 1; t._trail = trail;
          out.push(t);
          if (keep || !(t.summary && this.ui.collapsed.has(t.id))) walk(t.id, depth + 1, t._wbs, [...trail, t._last]);
        });
      };
      walk(0, 0, '', []);
      this._by = by;
      return out;
    }

    // select a task, opening the groups above it and scrolling it into view
    goTo(id) {
      const t = this.tasks.find((x) => x.id === id); if (!t) return;
      const by = new Map(this.tasks.map((x) => [x.id, x])); let p = t.parent_id ? by.get(t.parent_id) : null, n = 0, changed = false;
      while (p && n++ < 50) { if (this.ui.collapsed.delete(p.id)) changed = true; p = p.parent_id ? by.get(p.parent_id) : null; }
      if (this.filterOn() && !this.matches(t)) { this.ui.filter = 'all'; this.ui.q = ''; changed = true; }
      if (changed) this.render();
      this.select(id);
      this.inner.querySelector(`.gt-cells[data-row="${id}"]`)?.scrollIntoView({ block: 'center' });
      if (t.start) this.scrollToDate(t.start, true);
    }

    // ---------- links, filter and search ----------
    linkIds(t) { return [...new Set([...(t.deliverable_id ? [t.deliverable_id] : []), ...(t.links || [])])].filter((id) => !this.itemMap || this.itemMap.has(id)); }
    linkCount(t) { return this.linkIds(t).length; }
    linkTip(t) {
      const by = {}; for (const id of this.linkIds(t)) { const i = this.itemMap.get(id); if (i) (by[i.kind] = by[i.kind] || []).push(i.title); }
      return Object.entries(by).map(([k, v]) => `${this.t('kind_' + k)}: ${v.join(', ')}`).join('\n');
    }
    filterOn() { return this.ui.filter !== 'all' || !!(this.ui.q || '').trim(); }
    matches(t) {
      const q = (this.ui.q || '').trim().toLowerCase();
      if (q && !(String(t.name).toLowerCase().includes(q) || String(t.assignee || '').toLowerCase().includes(q) || (this._wbsAll.get(t.id) || '') === q)) return false;
      const leaf = !t.summary, pc = t.progress || 0;
      switch (this.ui.filter) {
        case 'open': return leaf && pc < 100;
        case 'done': return leaf && pc >= 100;
        case 'late': return leaf && t.finish && t.finish < this.today && pc < 100;
        case 'critical': return leaf && !!t.critical;
        case 'milestones': return !!t.is_milestone;
        case 'flag': return !!t.flag;
        case 'manual': return leaf && t.mode === 'manual';
        case 'unlinked': return leaf && !this.linkCount(t);
        case 'linked': return leaf && this.linkCount(t) > 0;
        default: return true;
      }
    }
    // ids to show while a filter or search is on: the matches and the summaries above them
    keepSet() {
      if (!this.filterOn()) return null;
      const by = new Map(this.tasks.map((x) => [x.id, x])), keep = new Set();
      for (const t of this.tasks) {
        if (!this.matches(t)) continue;
        let p = t, n = 0;
        while (p && !keep.has(p.id) && n++ < 50) { keep.add(p.id); p = p.parent_id ? by.get(p.parent_id) : null; }
      }
      this._matchN = this.tasks.filter((t) => this.matches(t)).length;
      return keep;
    }
    setFilter(f, q) {
      if (f !== undefined) this.ui.filter = f;
      if (q !== undefined) this.ui.q = q;
      this.render();
    }

    range() {
      let min = null, max = null;
      for (const t of this.tasks) {
        for (const d of [t.start, t.b_start]) if (d && (!min || d < min)) min = d;
        for (const d of [t.finish, t.b_end]) if (d && (!max || d > max)) max = d;
      }
      if (!min) { min = this.today; max = addD(this.today, 60); }
      if (this.today < min) min = this.today;
      min = addD(min, -10); max = addD(max, 45);
      if (this.ui.zoom !== 'day') { min = min.slice(0, 8) + '01'; }
      return { min, max, days: diff(min, max) + 1 };
    }

    // ---------- build static shell ----------
    build() {
      const t = this.t;
      this.root.classList.add('gt-wrap');
      this.root.setAttribute('dir', 'ltr');
      const btn = (kind) => (id, icon, label, tip = '', extra = '') => `<button type="button" class="rb ${kind} ${extra}" data-g="${id}" data-tip="${esc(tip || label)}" aria-label="${esc(tip || label)}">${ic(icon)}<span>${esc(label)}</span></button>`;
      const L = btn('lg'), Sm = btn('sm');
      const grp = (name, html) => `<div class="rb-grp"><div class="rb-body">${html}</div><div class="rb-name">${esc(name)}</div></div>`;
      const col = (html) => `<div class="rb-col">${html}</div>`;
      const tabs = [['task', 'g_tab_task'], ['view', 'g_tab_view'], ['project', 'g_tab_project'], ['links', 'g_tab_links'], ['exchange', 'g_tab_exchange']];
      const FILTERS = FILTER_LIST;
      this.root.innerHTML = `
        <div class="gt-toolbar gt-ribbon" role="region" aria-label="${esc(t('g_ribbon'))}">
          <div class="rb-tabs" role="tablist">
            ${tabs.map(([k, label]) => `<button type="button" role="tab" class="rb-tab" data-tab="${k}">${esc(t(label))}</button>`).join('')}
            <span class="grow"></span>
            <button type="button" class="rb sm quiet" data-g="full" data-tip="${esc(t('g_maximize'))}" aria-label="${esc(t('g_maximize'))}">${ic('full')}<span>${esc(t('g_maximize'))}</span></button>
            <button type="button" class="rb sm quiet icon" data-g="rbtoggle" data-tip="${esc(t('g_ribbon_collapse'))}" aria-label="${esc(t('g_ribbon_collapse'))}">${ic('chevup')}</button>
          </div>
          <div class="rb-body-wrap">
            <div class="rb-panel" data-panel="task">
              ${grp(t('g_grp_tasks'), L('add', 'plus', t('g_add_task'), '', 'primary') + L('addms', 'diamond', t('g_add_milestone')) + col(Sm('edit', 'edit', t('g_edit')) + Sm('del', 'trash', t('g_delete')) + '<span class="rb-selcount" data-selcount hidden></span>'))}
              ${grp(t('g_grp_outline'), col(Sm('indent', 'indent', t('g_indent_short'), t('g_indent')) + Sm('outdent', 'outdent', t('g_outdent_short'), t('g_outdent')) + Sm('expandall', 'expand', t('g_expand_all'))) + col(Sm('up', 'up', t('g_up_short'), t('g_move_up')) + Sm('down', 'down', t('g_down_short'), t('g_move_down')) + Sm('collapseall', 'collapse', t('g_collapse_all'))))}
              ${grp(t('g_grp_schedule'), `<div class="rb-stack"><div class="rb-seg" role="group" aria-label="${esc(t('progress'))}">${[0, 25, 50, 75, 100].map((n) => `<button type="button" class="rb chip" data-g="prog-${n}" data-tip="${esc(t('g_set_progress', { n }))}" aria-label="${esc(t('g_set_progress', { n }))}">${n}%</button>`).join('')}</div><div class="rb-row">${Sm('track', 'clock', t('g_on_track'), t('g_on_track_tip'))}${Sm('relink', 'refresh', t('g_respect_links'), t('g_respect_links_tip'))}</div></div>` + L('modemanual', 'pin', t('g_btn_manual'), t('g_mode_manual_tip')) + L('modeauto', 'auto', t('g_btn_auto'), t('g_mode_auto_tip')))}
              ${grp(t('g_grp_properties'), L('flag', 'star', t('g_hl_short'), t('g_highlight')) + L('link', 'link', t('g_link_items'), t('g_link_items_tip')))}
              ${grp(t('g_grp_editing'), L('undo', 'undo', t('g_undo')))}
            </div>
            <div class="rb-panel" data-panel="view" hidden>
              ${grp(t('g_grp_zoom'), `<div class="rb-stack"><div class="rb-seg"><button type="button" class="rb chip" data-g="zoom-day">${t('g_day')}</button><button type="button" class="rb chip" data-g="zoom-week">${t('g_week')}</button><button type="button" class="rb chip" data-g="zoom-month">${t('g_month')}</button></div><div class="rb-row"><button type="button" class="rb sm icon" data-g="zout" data-tip="${esc(t('g_zoom_out'))}" aria-label="${esc(t('g_zoom_out'))}">${ic('minus')}</button><span class="gt-zl" data-zl data-g="zreset" data-tip="${esc(t('g_zoom_reset'))}" role="button" tabindex="0">100%</span><button type="button" class="rb sm icon" data-g="zin" data-tip="${esc(t('g_zoom_in'))}" aria-label="${esc(t('g_zoom_in'))}">${ic('plus')}</button></div></div>` + L('today', 'today', t('g_today')) + L('goto', 'target', t('g_go_selected')) + L('fit', 'full', t('g_fit')))}
              ${grp(t('g_grp_show'), col(Sm('critical', 'zap', t('g_critical')) + Sm('baseline', 'layers', t('g_baseline_show')) + Sm('legend', 'flag', t('g_legend_short'), t('g_legend'))) + col(Sm('cols', 'cols', t('g_columns_short'), t('g_columns')) + `<select class="gt-level" data-g="level" title="${esc(t('g_show_level'))}" aria-label="${esc(t('g_show_level'))}"></select>`)) + col(Sm('fitcols', 'full', t('g_fit_cols'), t('g_fit_cols_tip')) + Sm('resetcols', 'undo', t('g_reset_cols'), t('g_reset_cols_tip')))}
              ${grp(t('g_grp_filter'), `<div class="rb-stack wide"><select class="rb-sel" data-g="filter" aria-label="${esc(t('g_filter'))}">${FILTERS.map(([k, label]) => `<option value="${k}">${esc(t(label))}</option>`).join('')}</select><label class="rb-search">${ic('search')}<input type="search" data-g="q" placeholder="${esc(t('g_find'))}" aria-label="${esc(t('g_find'))}"></label></div>`)}
            </div>
            <div class="rb-panel" data-panel="project" hidden>
              ${grp(t('g_grp_quality'), L('validate', 'check', t('g_check'), t('g_check_tip')) + L('impact', 'bell', t('g_impact')))}
              ${grp(t('g_grp_baseline'), L('setbaseline', 'pin', t('g_set_baseline')))}
              ${grp(t('g_grp_versions'), L('versions', 'history', t('g_versions'), t('g_versions_tip')) + L('saveversion', 'save', t('g_save_version'), t('g_save_version_tip')))}
            </div>
            <div class="rb-panel" data-panel="links" hidden>
              ${grp(t('g_grp_links'), L('link', 'link', t('g_link_items'), t('g_link_items_tip')) + L('links', 'layers', t('g_link_manager'), t('g_link_manager_tip')))}
              ${grp(t('g_grp_coverage'), '<div class="rb-cov" data-cov></div>')}
              ${grp(t('g_grp_find'), col(Sm('f-unlinked', 'search', t('g_f_unlinked'), t('g_f_unlinked_tip')) + Sm('f-linked', 'link', t('g_f_linked')) + Sm('f-all', 'x', t('g_f_all'))))}
            </div>
            <div class="rb-panel" data-panel="exchange" hidden>
              ${grp(t('g_grp_msp'), L('msp', 'swap', t('g_msp'), t('g_msp_tip')))}
              ${grp(t('g_grp_table'), L('csv', 'csv', t('g_csv'), t('g_csv_tip')) + L('print', 'print', t('g_print'), t('g_print_tip')))}
            </div>
          </div>
          <div class="gt-filterbar hidden" data-fbar><span class="grow" data-ftext></span><button type="button" class="btn sm" data-g="clearfilter">${ic('x')}${esc(t('g_clear_filter'))}</button></div>
        </div>
        <div class="gt-scroll" tabindex="0"><div class="gt-inner"></div></div>
        <div class="gt-legend"></div>`;
      this.scroll = this.root.querySelector('.gt-scroll');
      this.inner = this.root.querySelector('.gt-inner');
      this.legendEl = this.root.querySelector('.gt-legend');
      this.root.addEventListener('click', (e) => this.onToolbar(e));
      // Ctrl or Cmd with the mouse wheel zooms the timeline around the pointer
      this.root.querySelector('.gt-scroll').addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); this.setZoom(this.ui.z * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
      this.scroll.addEventListener('keydown', (e) => { if (this.onSplitKey(e)) return; this.onKey(e); });
      this.root.addEventListener('pointerdown', (e) => { if (!e.target.closest) return; if (e.target.closest('.gt-split')) this.onSplitDown(e); else if (e.target.closest('.hc-rs')) this.onColDown(e); });
      this.root.addEventListener('change', (e) => { const s = e.target.closest('select[data-g="level"]'); if (s) this.showLevel(Number(s.value)); const f = e.target.closest('select[data-g="filter"]'); if (f) this.setFilter(f.value); });
      this.root.addEventListener('input', (e) => { const q = e.target.closest('input[data-g="q"]'); if (q) { clearTimeout(this._qt); this._qt = setTimeout(() => this.setFilter(undefined, q.value), 180); } });
      this.root.addEventListener('dblclick', (e) => { const tb = e.target.closest('[data-tab]'); if (tb) { this.ui.ribbon = !this.ui.ribbon; try { localStorage.setItem('pm_rb_open', this.ui.ribbon ? '1' : '0'); } catch (er) { /* ignore */ } this.updateToolbar(); } });
      this._esc = (e) => { if (e.key === 'Escape' && this.root.classList.contains('gt-max') && !document.querySelector('.overlay')) this.setMax(false); };
      document.addEventListener('keydown', this._esc);
      this.tip = document.createElement('div');
      this.tip.className = 'gt-tip hidden';
      this.root.appendChild(this.tip); // inside the root so it also shows in full screen
    }

    // continuous zoom on top of the day, week or month scale (25% to 400%)
    setZoom(z, keep) {
      z = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));
      if (Math.abs(z - this.ui.z) < 0.001) return;
      keep = keep || this.centerDate();
      this.ui.z = z; this.render(); this.scrollToDate(keep, true);
    }

    updateToolbar() {
      const R = this.root, T = this.t;
      const $g = (id) => R.querySelector(`[data-g="${id}"]`);
      // tabs
      R.querySelectorAll('.rb-tab').forEach((el) => { const on = el.dataset.tab === this.ui.tab; el.classList.toggle('on', on && this.ui.ribbon); el.setAttribute('aria-selected', on ? 'true' : 'false'); });
      R.querySelectorAll('.rb-panel').forEach((el) => { el.hidden = el.dataset.panel !== this.ui.tab; });
      R.querySelector('.rb-body-wrap').hidden = !this.ui.ribbon;
      const tg = $g('rbtoggle'); if (tg) { tg.innerHTML = ic(this.ui.ribbon ? 'chevup' : 'chevdown'); const tip = T(this.ui.ribbon ? 'g_ribbon_collapse' : 'g_ribbon_expand'); tg.dataset.tip = tip; tg.setAttribute('aria-label', tip); }
      // zoom
      const zl = R.querySelector('[data-zl]'); if (zl) zl.textContent = `${Math.round(this.ui.z * 100)}%`;
      if ($g('zin')) $g('zin').disabled = this.ui.z >= 4; if ($g('zout')) $g('zout').disabled = this.ui.z <= 0.25;
      const set = (id, on) => $g(id)?.classList.toggle('on', !!on);
      set('zoom-day', this.ui.zoom === 'day'); set('zoom-week', this.ui.zoom === 'week'); set('zoom-month', this.ui.zoom === 'month');
      set('critical', this.ui.critical); set('baseline', this.ui.baseline); set('impact', this.impactOn); set('cols', !this.ui.compact); set('legend', this.ui.legend);
      const imp = $g('impact')?.querySelector('span'); if (imp) imp.textContent = `${T('g_impact')}: ${this.impactOn ? T('on') : T('off')}`;
      if ($g('undo')) $g('undo').disabled = !this.canUndo;
      const full = $g('full'), mx = this.root.classList.contains('gt-max');
      if (full) full.innerHTML = `${ic(mx ? 'exit' : 'full')}<span>${T(mx ? 'g_restore' : 'g_maximize')}</span>`;
      this.updateLevels();
      const sb = $g('setbaseline')?.querySelector('span'); if (sb) sb.textContent = this.hasBaseline ? T('g_update_baseline') : T('g_set_baseline');
      this.legendEl.classList.toggle('hidden', !this.ui.legend);
      // selection
      const sel = this.sel(), has = !!sel, many = this.selCount() > 1, picked = this.selTasks();
      const leafs = picked.filter((x) => !x.summary), leaf = leafs.length > 0;
      for (const id of ['outdent', 'indent', 'up', 'down', 'flag', 'del']) { const el = $g(id); if (el) el.disabled = !has; }
      for (const id of ['edit', 'link', 'goto']) { const el = $g(id); if (el) el.disabled = !has || many; }
      for (const id of ['prog-0', 'prog-25', 'prog-50', 'prog-75', 'prog-100', 'track', 'relink', 'modemanual', 'modeauto']) { const el = $g(id); if (el) el.disabled = !leaf; }
      const same = (f) => leaf && leafs.every((x) => f(x));
      R.querySelectorAll('[data-g^="prog-"]').forEach((el) => el.classList.toggle('on', same((x) => (x.progress || 0) === Number(el.dataset.g.slice(5)))));
      set('modemanual', same((x) => x.mode === 'manual')); set('modeauto', same((x) => x.mode !== 'manual')); set('flag', has && picked.length > 0 && picked.every((x) => x.flag));
      const fl = $g('flag')?.querySelector('span'); if (fl) fl.textContent = T(has && picked.length > 0 && picked.every((x) => x.flag) ? 'g_unhl_short' : 'g_hl_short');
      const lk = R.querySelectorAll('[data-g="link"] span'); lk.forEach((el) => { el.textContent = T('g_link_items') + (has && !many && this.linkCount(sel) ? ` (${this.linkCount(sel)})` : ''); });
      const sc = R.querySelector('[data-selcount]'); if (sc) { sc.hidden = !many; sc.textContent = many ? T('g_n_selected', { n: this.selCount() }) : ''; }
      // filter
      const fs = $g('filter'); if (fs && fs.value !== this.ui.filter) fs.value = this.ui.filter;
      const qi = $g('q'); if (qi && document.activeElement !== qi && qi.value !== (this.ui.q || '')) qi.value = this.ui.q || '';
      ['unlinked', 'linked'].forEach((k) => set('f-' + k, this.ui.filter === k)); set('f-all', false);
      const fb = R.querySelector('[data-fbar]'), on = this.filterOn();
      if (fb) { fb.classList.toggle('hidden', !on); if (on) fb.querySelector('[data-ftext]').textContent = T('g_filter_status', { n: this._matchN ?? this.vis.length, total: this.tasks.length }); }
      // coverage of deliverables, payments, requirements and risks
      const cov = R.querySelector('[data-cov]');
      if (cov) {
        const linked = new Set(); for (const t of this.tasks) for (const id of this.linkIds(t)) linked.add(id);
        for (const i of this.items) if (i.kind === 'milestone' && i.data && i.data.deliverable_id && linked.has(Number(i.data.deliverable_id))) linked.add(i.id);
        cov.innerHTML = [['deliverable', 'kind_deliverable'], ['milestone', 'kind_milestone'], ['requirement', 'kind_requirement'], ['risk', 'kind_risk']].map(([k, label]) => {
          const list = this.items.filter((i) => i.kind === k && (k !== 'risk' || (i.state !== 'closed' && i.state !== 'mitigated')));
          const n = list.filter((i) => linked.has(i.id)).length, tot = list.length, full = tot > 0 && n === tot;
          return `<button type="button" class="rb-covi ${tot && !full ? 'warn' : full ? 'ok' : ''}" data-g="links" data-tip="${esc(T('g_cov_tip', { n, total: tot, kind: T(label) }))}"><b>${n}/${tot}</b><span>${esc(T(label))}</span></button>`;
        }).join('');
      }
    }

    // Fill the browser window (not the whole screen). Esc or the button restores it.
    setMax(on) {
      this.root.classList.toggle('gt-max', on);
      document.documentElement.classList.toggle('gt-locked', on);
      this.updateToolbar();
      this.render();
    }

    // ---------- outline levels ----------
    maxDepth() { let m = 1; for (const t of this.tasks) if (t._depth != null) m = Math.max(m, t._depth + 1); return m; }
    depthOf(t) { let n = 1, p = t; const by = new Map(this.tasks.map((x) => [x.id, x])); let g = 0; while (p.parent_id && by.has(p.parent_id) && g++ < 50) { p = by.get(p.parent_id); n++; } return n; }
    updateLevels() {
      const sel = this.root.querySelector('select[data-g="level"]');
      if (!sel) return;
      let deepest = 1; for (const t of this.tasks) deepest = Math.max(deepest, this.depthOf(t));
      const opts = [['all', this.t('g_all_levels')]];
      for (let i = 1; i <= Math.max(deepest, 5); i++) opts.push([String(i), `${this.t('g_level')} ${i}`]);
      const html = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
      if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
      sel.value = this.ui.level ? String(this.ui.level) : 'all';
    }
    // show outline down to level n: summaries at level n are collapsed, shallower ones expanded
    showLevel(n) {
      this.ui.level = Number.isFinite(n) && n > 0 ? n : null;
      this.ui.collapsed = new Set();
      if (this.ui.level) for (const t of this.tasks) if (t.summary && this.depthOf(t) >= this.ui.level) this.ui.collapsed.add(t.id);
      this.render();
    }

    sel() { return this.tasks.find((t) => t.id === this.ui.selected) || null; }
    // ---------- selecting one or many tasks ----------
    isSel(id) { return this.ui.selected != null && (this.ui.selected === id || this.ui.multi.has(id)); }
    selTasks() { return (this.vis || this.tasks).filter((t) => this.isSel(t.id)); }
    selCount() { return this.ui.selected == null ? 0 : Math.max(1, this.selTasks().length); }
    paintSel() {
      this.inner.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
      for (const t of this.selTasks()) {
        this.inner.querySelector(`.gt-cells[data-row="${t.id}"]`)?.classList.add('sel');
        this.inner.querySelector(`.gt-bar[data-id="${t.id}"]`)?.classList.add('sel');
      }
    }

    // ---------- render ----------
    render() {
      const keepL = this.scroll.scrollLeft, keepT = this.scroll.scrollTop;
      const prevIdx = this.rowIndex, prevGeom = this._geom, prevSel = this._barFor;
      const rows = this.rows();
      this.vis = rows;
      this.rowIndex = new Map(rows.map((t, i) => [t.id, i]));
      const R = this.range();
      this.R = R;
      this.ppd = ZOOM[this.ui.zoom] * this.ui.z;
      const totalW = R.days * this.ppd;
      const LW = this.leftW();
      this.LW = LW;
      const bodyH = Math.max(rows.length * ROW, 120);
      const x = (s) => diff(R.min, s) * this.ppd;
      this.x = x;

      // header
      const { h1, h2 } = this.headers(R);
      const headLeft = this.cols().map((c) => `<div class="hc" style="width:${c[2]}px" data-tip="${esc(this.colTitle(c[1]))}">${esc(this.colTitle(c[1]))}<i class="hc-rs" data-col="${c[1]}" data-tip="${esc(this.t('g_col_drag'))}"></i></div>`).join('');
      // grid rows
      const dl = `<datalist id="gt-res">${this.resources.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>`;
      const cells = rows.map((t) => this.rowHtml(t)).join('');

      // timeline layer
      let layer = '';
      for (let i = 0; i < rows.length; i++) layer += `<div class="gt-stripe" style="top:${(i + 1) * ROW - 1}px;height:1px"></div>`;
      layer += this.nonWorkHtml(R, bodyH);
      layer += `<div class="gt-today" style="left:${x(this.today) + (this.ppd >= 10 ? this.ppd / 2 : 0)}px"></div>`;
      let bars = '';
      rows.forEach((t, i) => { bars += this.barHtml(t, i); });
      const lines = this.linesHtml(rows);

      this.inner.style.width = `${LW + totalW}px`;
      this.inner.style.height = `${HEAD + bodyH}px`;
      this.inner.innerHTML = `
        <div class="gt-head" style="height:${HEAD}px">
          <div class="gt-head-left" style="width:${LW}px;height:${HEAD}px">${headLeft}${this.splitHtml()}</div>
          <div class="gt-head-right" style="width:${totalW}px"><div class="gt-h1">${h1}</div><div class="gt-h2">${h2}</div></div>
        </div>
        <div class="gt-left" style="width:${LW}px;height:${bodyH}px">${dl}${cells}${this.splitHtml()}</div>
        <div class="gt-layer" style="left:${LW}px;top:${HEAD}px;width:${totalW}px;height:${bodyH}px">${layer}${lines}${bars}</div>`;
      this.layer = this.inner.querySelector('.gt-layer');
      this.svg = this.inner.querySelector('.gt-svg');
      this.legend();
      this.updateToolbar();
      if (this.firstRender) {
        this.firstRender = false;
        const st = this.tasks.map((x) => x.start).filter(Boolean).sort(), fn = this.tasks.map((x) => x.finish).filter(Boolean).sort();
        const inside = st.length && this.today >= st[0] && this.today <= fn[fn.length - 1];
        this.scrollToDate(st.length && !inside ? st[0] : this.today, !inside ? false : true);
      } else { this.scroll.scrollLeft = keepL; this.scroll.scrollTop = keepT; }
      this.bind();
      this._geom = new Map(rows.filter((t) => t.start && t.finish).map((t) => [t.id, this.barGeom(t).left]));
      this.placeBar(prevSel);
      this.animate(prevIdx, prevGeom);
    }

    colTitle(k) { return { wbs: '#', mode: '', pred: this.t('g_pred'), task: this.t('g_task'), start: this.t('g_start'), dur: this.t('g_dur'), finish: this.t('g_finish'), pct: '%', owner: this.t('g_owner') }[k]; }

    headers(R) {
      const ppd = this.ppd;
      const loc = this.o.lang === 'ar' ? 'ar' : 'en-US';
      const mname = (d, w) => new Intl.DateTimeFormat(loc, { month: w, timeZone: 'UTC' }).format(P(d));
      let h1 = '', h2 = '';
      if (this.ui.zoom === 'month') {
        let y = R.min.slice(0, 4);
        let start = R.min;
        for (let d = R.min; d <= R.max; d = addD(d, 1)) {
          const nextY = d.slice(0, 4);
          if (d === R.max || (nextY !== y && d.slice(5) === '01-01')) {
            const end = d === R.max ? d : addD(d, -1);
            h1 += `<div class="gt-hc" style="left:${diff(R.min, start) * ppd}px;width:${(diff(start, end) + 1) * ppd}px"><b>${y}</b></div>`;
            start = d; y = nextY;
          }
        }
        let cur = R.min;
        while (cur <= R.max) {
          const [yy, mm] = cur.split('-').map(Number);
          const nxt = F(new Date(Date.UTC(yy, mm, 1)));
          const end = addD(nxt, -1);
          h2 += `<div class="gt-hc" style="left:${diff(R.min, cur) * ppd}px;width:${(diff(cur, end) + 1) * ppd}px">${mname(cur, 'short')}</div>`;
          cur = nxt;
        }
      } else {
        let cur = R.min;
        while (cur <= R.max) {
          const [yy, mm] = cur.split('-').map(Number);
          const nxt = F(new Date(Date.UTC(yy, mm, 1)));
          const end = nxt > R.max ? R.max : addD(nxt, -1);
          h1 += `<div class="gt-hc" style="left:${diff(R.min, cur) * ppd}px;width:${(diff(cur, end) + 1) * ppd}px"><b>${mname(cur, 'long')} ${yy}</b></div>`;
          cur = nxt;
        }
        if (this.ui.zoom === 'day') {
          for (let d = R.min; d <= R.max; d = addD(d, 1)) {
            const dn = Number(d.slice(8));
            h2 += `<div class="gt-hc ${this.isWork(d) ? '' : 'nw'} ${d === this.today ? 'today' : ''}" style="left:${diff(R.min, d) * ppd}px;width:${ppd}px;text-align:center;padding:5px 0 0">${dn}</div>`;
          }
        } else {
          for (let d = R.min; d <= R.max; d = addD(d, 7)) {
            h2 += `<div class="gt-hc" style="left:${diff(R.min, d) * ppd}px;width:${7 * ppd}px">${Number(d.slice(8))} ${mname(d, 'short')}</div>`;
          }
        }
      }
      return { h1, h2 };
    }

    nonWorkHtml(R, h) {
      if (this.ppd < 10) return '';
      let out = '', runStart = null, hol = false;
      const flush = (end) => {
        if (runStart === null) return;
        out += `<div class="gt-nw ${hol ? 'gt-hol' : ''}" style="left:${diff(R.min, runStart) * this.ppd}px;width:${(diff(runStart, end) + 1) * this.ppd}px;height:${h}px"></div>`;
        runStart = null;
      };
      let prev = R.min;
      for (let d = R.min; d <= R.max; d = addD(d, 1)) {
        const nw = !this.isWork(d);
        const isHol = this.cal.holidays.has(d);
        if (nw) { if (runStart !== null && isHol !== hol) flush(prev); if (runStart === null) { runStart = d; hol = isHol; } } else flush(prev);
        prev = d;
      }
      flush(prev);
      return out;
    }

    status(t) {
      if (t.progress >= 100) return 'done';
      if (t.finish && t.finish < this.today) return 'late';
      if (t.progress > 0) return 'prog';
      return 'todo';
    }

    // tree view: guide lines for ancestors and an elbow for the row itself
    treeHtml(t) {
      let h = '';
      for (let k = 0; k < t._depth; k++) {
        if (k === t._depth - 1) h += `<span class="tr elb ${t._last ? 'end' : ''}"></span>`;
        else h += `<span class="tr ${t._trail[k + 1] ? '' : 'line'}"></span>`;
      }
      return h;
    }

    rowHtml(t) {
      const cols = this.cols();
      const sel = this.isSel(t.id) ? 'sel' : '';
      const caret = t.summary ? `<span class="gt-caret" data-caret="${t.id}">${ic(this.ui.collapsed.has(t.id) ? 'down' : 'up').replace('<svg', '<svg style="width:12px;height:12px;transform:rotate(' + (this.ui.collapsed.has(t.id) ? '-90' : '0') + 'deg)"')}</span>` : '<span class="gt-caret"></span>';
      const cell = (c) => {
        const w = `style="width:${c[2]}px"`;
        const leaf = !t.summary;
        switch (c[1]) {
          case 'wbs': return `<div class="c num" ${w} data-tip="${esc(this.t('g_drag_tip'))}">${t._wbs}</div>`;
          case 'mode': return `<div class="c md" ${w}>${t.summary ? '' : `<button type="button" class="gt-mode ${t.mode === 'manual' ? 'manual' : ''}" data-mode="${t.id}" aria-label="${esc(this.t(t.mode === 'manual' ? 'g_mode_manual_tip' : 'g_mode_auto_tip'))}" data-tip="${esc(this.t(t.mode === 'manual' ? 'g_mode_manual_tip' : 'g_mode_auto_tip'))}">${ic(t.mode === 'manual' ? 'pin' : 'auto')}</button>`}</div>`;
          case 'pred': { const txt = (t.deps || []).map((d) => `${this._wbsAll.get(d.id) || '?'}${d.type && d.type !== 'FS' ? d.type : ''}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag + 'd' : ''}`).join(', '); return `<div class="c pd ${t.conflict ? 'bad' : ''}" ${w} ${txt ? `data-tip="${esc(this.t('g_pred_tip'))}: ${esc(txt)}${t.conflict ? '\n' + esc(this.t('g_conflict_tip')) : ''}"` : ''}>${esc(txt)}</div>`; }
          case 'task': return `<div class="c nm ed" ${w} data-f="name" style="width:${c[2]}px;padding-inline-start:6px">${this.treeHtml(t)}${caret}${t.flag ? `<span class="gt-flagico">${ic('star')}</span>` : ''}${this.linkCount(t) ? `<span class="gt-lkico" data-tip="${esc(this.linkTip(t))}">${ic('link')}${this.linkCount(t)}</span>` : ''}<span class="txt" data-tip="${esc(t.name)}">${esc(t.name)}</span></div>`;
          case 'start': return `<div class="c dt ${leaf ? 'ed' : ''}" ${w} data-f="start">${t.start || ''}</div>`;
          case 'dur': return `<div class="c dt ${leaf ? 'ed' : ''}" ${w} data-f="duration">${t.is_milestone ? '0d' : t.duration + 'd'}</div>`;
          case 'finish': return `<div class="c dt" ${w}>${t.finish || ''}</div>`;
          case 'pct': return `<div class="c pc ${leaf ? 'ed' : ''}" ${w} data-f="progress" title="${t.progress || 0}%">${t.progress || 0}%</div>`;
          case 'owner': return `<div class="c dt ed" ${w} data-f="assignee" title="${esc(t.assignee || '')}">${esc(t.assignee || '')}</div>`;
        }
        return '';
      };
      return `<div class="gt-cells ${sel} ${t.summary ? 'sum' : ''} ${t.flag ? 'flag' : ''}" data-row="${t.id}" style="height:${ROW}px">${cols.map(cell).join('')}</div>`;
    }

    barGeom(t) {
      const x = this.x;
      const left = x(t.start);
      const ms = t.is_milestone || t.duration === 0;
      let width = (diff(t.start, t.finish) + 1) * this.ppd - 2;
      if (!ms) width = Math.max(width, 6);
      return { left, width, ms };
    }

    barHtml(t, i) {
      if (!t.start || !t.finish) return '';
      const g = this.barGeom(t);
      const st = this.status(t);
      const crit = this.ui.critical && t.critical && !t.summary ? 'crit' : '';
      const sel = (this.isSel(t.id) ? 'sel' : '') + (t.flag ? ' flagged' : '') + (t.mode === 'manual' && !t.summary ? ' manual' : '') + (t.conflict ? ' conflict' : '');
      let html = '';
      if (this.ui.baseline && t.b_start && t.b_end) {
        html += `<div class="gt-base" style="left:${this.x(t.b_start)}px;width:${(diff(t.b_start, t.b_end) + 1) * this.ppd - 2}px;top:${i * ROW + ROW - 8}px"></div>`;
      }
      if (g.ms) {
        const cx = g.left + this.ppd / 2;
        html += `<div class="gt-bar gt-ms ${st} ${sel}" data-id="${t.id}" style="left:${cx - 9}px;top:${i * ROW + 8}px;width:18px;height:18px"></div>`;
        html += `<div class="gt-ext" style="left:${cx + 16}px;top:${i * ROW + 8}px;line-height:18px">${esc(t.name)}</div>`;
        return html;
      }
      if (t.summary) {
        html += `<div class="gt-bar gt-sum ${sel}" data-id="${t.id}" style="left:${g.left}px;top:${i * ROW + 12}px;width:${g.width}px;height:10px"><div class="fill" style="width:${t.progress}%"></div></div>`;
        html += `<div class="gt-ext" style="left:${g.left + g.width + 8}px;top:${i * ROW + 8}px;line-height:18px;font-weight:600">${esc(t.name)}</div>`;
        return html;
      }
      const label = g.width > 70 ? esc(t.name) : '';
      html += `<div class="gt-bar ${st} ${crit} ${sel}" data-id="${t.id}" style="left:${g.left}px;top:${i * ROW + 7}px;width:${g.width}px;height:20px">
        <div class="fill" style="width:${t.progress}%"></div><div class="lbl">${label}</div>
        <div class="hdl l" data-m="left"></div><div class="hdl r" data-m="right"></div>
        <div class="pg" data-m="progress" style="left:${t.progress}%" data-tip="${this.t('g_progress_drag')}"></div>
        <div class="lk l" data-m="linkl"></div><div class="lk r" data-m="linkr"></div></div>`;
      if (!label) html += `<div class="gt-ext" style="left:${g.left + g.width + 8}px;top:${i * ROW + 8}px;line-height:18px">${esc(t.name)}</div>`;
      return html;
    }

    anchors(t) {
      const i = this.rowIndex.get(t.id);
      const g = this.barGeom(t);
      const y = i * ROW + ROW / 2;
      if (g.ms) return { l: g.left + this.ppd / 2 - 9, r: g.left + this.ppd / 2 + 9, y };
      return { l: g.left, r: g.left + g.width, y };
    }

    linesHtml(rows) {
      let paths = '';
      const byId = new Map(rows.map((t) => [t.id, t]));
      for (const t of rows) {
        for (const d of t.deps || []) {
          const p = byId.get(d.id);
          if (!p || !p.start || !t.start) continue;
          const a = this.anchors(p), b = this.anchors(t);
          const crit = this.ui.critical && p.critical && t.critical ? 'crit' : '';
          const type = d.type || 'FS';
          let path, tip;
          if (type === 'FS') {
            if (b.l >= a.r + 14) path = `M${a.r} ${a.y}H${a.r + 8}V${b.y}H${b.l - 1}`;
            else {
              const mid = a.y + (b.y >= a.y ? ROW / 2 : -ROW / 2) * (a.y === b.y ? 0 : 1);
              path = `M${a.r} ${a.y}H${a.r + 8}V${mid}H${b.l - 10}V${b.y}H${b.l - 1}`;
            }
            tip = `points="${b.l},${b.y} ${b.l - 7},${b.y - 4} ${b.l - 7},${b.y + 4}"`;
          } else if (type === 'SS') {
            const x1 = Math.min(a.l, b.l) - 12;
            path = `M${a.l} ${a.y}H${x1}V${b.y}H${b.l - 1}`;
            tip = `points="${b.l},${b.y} ${b.l - 7},${b.y - 4} ${b.l - 7},${b.y + 4}"`;
          } else if (type === 'FF') {
            const x1 = Math.max(a.r, b.r) + 12;
            path = `M${a.r} ${a.y}H${x1}V${b.y}H${b.r + 1}`;
            tip = `points="${b.r},${b.y} ${b.r + 7},${b.y - 4} ${b.r + 7},${b.y + 4}"`;
          } else {
            const x1 = Math.min(a.l - 12, b.r - 12);
            path = `M${a.l} ${a.y}H${x1}V${b.y}H${b.r + 1}`;
            tip = `points="${b.r},${b.y} ${b.r + 7},${b.y - 4} ${b.r + 7},${b.y + 4}"`;
          }
          const lag = d.lag ? (d.lag > 0 ? '+' : '') + d.lag + 'd' : '';
          paths += `<path class="${crit}" d="${path}"/><path class="hit" d="${path}" data-dep="${p.id}:${t.id}" style="stroke:transparent;stroke-width:10;pointer-events:stroke;cursor:pointer"></path>`;
          paths += `<polygon class="${crit}" ${tip}/>`;
        }
      }
      return `<svg class="gt-svg" width="100%" height="100%">${paths}</svg>`;
    }

    legend() {
      const L = (c, k) => `<span><i style="background:var(${c})"></i>${this.t(k)}</span>`;
      this.legendEl.innerHTML = `${L('--g-todo', 'g_l_todo')}${L('--g-prog', 'g_l_prog')}${L('--g-done', 'g_l_done')}${L('--g-late', 'g_l_late')}${L('--g-ms', 'g_l_ms')}${L('--g-sum', 'g_l_sum')}<span><i style="background:transparent;outline:2px solid var(--g-crit)"></i>${this.t('g_l_crit')}</span><span><i style="background:var(--faint);height:4px;vertical-align:2px"></i>${this.t('g_l_base')}</span><span><i class="gt-lg-manual"></i>${this.t('g_mode_manual')}</span><span><i style="background:var(--g-today);width:3px"></i>${this.t('g_today')}</span>`;
    }

    // ---------- column widths: drag the edge of a header, double click fits the text, buttons fit or reset all ----------
    saveCols() { try { if (Object.keys(this.ui.colW || {}).length) localStorage.setItem('pm_gt_cols', JSON.stringify(this.ui.colW)); else localStorage.removeItem('pm_gt_cols'); } catch (e) { /* storage blocked */ } }
    fitWidth(key) {
      const idx = this.cols().findIndex((c) => c[1] === key); if (idx < 0) return null;
      let mx = 0;
      const probe = (el) => { if (!el) return; const kids = [...el.children]; let w; if (kids.length) { w = 0; const cs = getComputedStyle(el); const gap = parseFloat(cs.columnGap) || 0; for (const k of kids) { w += k.getBoundingClientRect().width + gap; } w += parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); } else { w = el.scrollWidth; } mx = Math.max(mx, w); };
      this.inner.querySelectorAll('.gt-cells[data-row]').forEach((r) => { const c = r.children[idx]; if (c) { const clone = c.cloneNode(true); clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;overflow:visible;white-space:nowrap;flex:none'; r.appendChild(clone); mx = Math.max(mx, clone.getBoundingClientRect().width); clone.remove(); } });
      const hc = this.inner.querySelectorAll('.gt-head-left .hc')[idx]; if (hc) { const clone = hc.cloneNode(true); clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;overflow:visible'; hc.parentNode.appendChild(clone); mx = Math.max(mx, clone.getBoundingClientRect().width); clone.remove(); }
      return Math.max(36, Math.min(700, Math.ceil(mx) + 4));
    }
    setColW(key, w, save) {
      this.ui.colW = this.ui.colW || {};
      if (w == null) delete this.ui.colW[key]; else this.ui.colW[key] = Math.round(w);
      this.ui.leftW = null; try { localStorage.removeItem('pm_gt_leftw'); } catch (e) { /* ignore */ }
      if (save) this.saveCols();
      this.render();
    }
    fitAll() { const keys = this.cols().map((c) => c[1]).filter((k) => k !== 'mode'); const out = {}; for (const k of keys) { const w = this.fitWidth(k); if (w) out[k] = w; } this.ui.colW = { ...(this.ui.colW || {}), ...out }; this.ui.leftW = null; this.saveCols(); this.render(); }
    resetCols() { this.ui.colW = {}; this.ui.leftW = null; try { localStorage.removeItem('pm_gt_leftw'); } catch (e) { /* ignore */ } this.saveCols(); this.render(); }
    onColDown(e) {
      const h = e.target.closest('.hc-rs'); if (!h || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      const key = h.dataset.col; const now = Date.now();
      if (this._colAt && this._colKey === key && now - this._colAt < 400) { this._colAt = 0; const w = this.fitWidth(key); if (w) this.setColW(key, w, true); return; }
      this._colAt = now; this._colKey = key;
      const x0 = e.clientX; const w0 = this.cols().find((c) => c[1] === key)[2]; let raf = 0, next = w0, moved = false;
      const min = key === 'mode' ? 30 : 40;
      this.root.classList.add('gt-resizing'); document.body.style.cursor = 'col-resize';
      const move = (ev) => { moved = true; next = Math.max(min, Math.min(700, w0 + ev.clientX - x0)); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.ui.colW = this.ui.colW || {}; this.ui.colW[key] = next; this.ui.leftW = null; this.render(); }); };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        this.root.classList.remove('gt-resizing'); document.body.style.cursor = ''; if (raf) cancelAnimationFrame(raf);
        if (moved) this.setColW(key, next, true);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    }

    // ---------- draggable divider between the table and the timeline ----------
    splitHtml() { return `<div class="gt-split" role="separator" aria-orientation="vertical" tabindex="0" title="${esc(this.t('g_split'))}" aria-label="${esc(this.t('g_split'))}"></div>`; }
    setLeftW(w, save) {
      this.ui.leftW = w == null ? null : Math.round(w);
      if (save) { try { if (w == null) localStorage.removeItem('pm_gt_leftw'); else localStorage.setItem('pm_gt_leftw', String(this.ui.leftW)); } catch (e) { /* storage blocked */ } }
      this.render();
    }
    onSplitDown(e) {
      const h = e.target.closest('.gt-split'); if (!h || e.button > 0) return;
      e.preventDefault();
      const now = Date.now();
      if (this._splitAt && now - this._splitAt < 400) { this._splitAt = 0; this.setLeftW(null, true); return; } // double click or double tap resets
      this._splitAt = now;
      const rtl = getComputedStyle(this.root).direction === 'rtl';
      const x0 = e.clientX, w0 = this.LW; let raf = 0, next = w0;
      this.root.classList.add('gt-resizing'); document.body.style.cursor = 'col-resize';
      let moved = false;
      const move = (ev) => { moved = true; next = w0 + (rtl ? x0 - ev.clientX : ev.clientX - x0); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.ui.leftW = next; this.render(); }); };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        this.root.classList.remove('gt-resizing'); document.body.style.cursor = '';
        if (raf) cancelAnimationFrame(raf);
        if (!moved) return;
        this.setLeftW(Math.max(160, Math.min(next, Math.max(240, this.scroll.clientWidth - 160))), true);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    }
    onSplitKey(e) {
      if (!e.target.closest || !e.target.closest('.gt-split')) return false;
      const step = e.shiftKey ? 80 : 20, rtl = getComputedStyle(this.root).direction === 'rtl';
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const d = (e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1); this.setLeftW(Math.max(160, this.LW + d * step), true); const hh = this.root.querySelector('.gt-left .gt-split'); if (hh) hh.focus(); e.preventDefault(); return true; }
      if (e.key === 'Home' || e.key === 'Enter') { this.setLeftW(null, true); e.preventDefault(); return true; }
      return false;
    }

    scrollToDate(d, center) {
      if (!this.R) return;
      const x = diff(this.R.min, d) * this.ppd;
      const vw = this.scroll.clientWidth - this.LW;
      this.scroll.scrollLeft = Math.max(0, center ? x - vw / 3 : x);
    }

    // ---------- events ----------
    onToolbar(e) {
      const tb = e.target.closest('[data-tab]');
      if (tb) { this.ui.tab = tb.dataset.tab; if (!this.ui.ribbon) this.ui.ribbon = true; try { localStorage.setItem('pm_rb_tab', this.ui.tab); localStorage.setItem('pm_rb_open', '1'); } catch (er) { /* ignore */ } return this.updateToolbar(); }
      const b = e.target.closest('[data-g]');
      if (!b || b.disabled) return;
      const id = b.dataset.g;
      const t = this.sel();
      if (id.startsWith('zoom-')) { const keep = this.centerDate(); this.ui.zoom = id.slice(5); this.ui.z = 1; this.render(); this.scrollToDate(keep, true); return; }
      if (id === 'zreset') return this.setZoom(1);
      if (id === 'zin' || id === 'zout') return this.setZoom(this.ui.z * (id === 'zin' ? 1.25 : 0.8));
      if (id === 'today') return this.scrollToDate(this.today, true);
      if (id === 'critical') { this.ui.critical = !this.ui.critical; return this.render(); }
      if (id === 'baseline') { this.ui.baseline = !this.ui.baseline; return this.render(); }
      if (id === 'cols') { this.ui.compact = !this.ui.compact; return this.render(); }
      if (id === 'fitcols') return this.fitAll();
      if (id === 'resetcols') return this.resetCols();
      if (id === 'expandall') return this.showLevel(0);
      if (id === 'collapseall') return this.showLevel(1);
      if (id === 'level' || id === 'filter' || id === 'q') return;
      if (id === 'mode') return;
      if (id === 'rbtoggle') { this.ui.ribbon = !this.ui.ribbon; try { localStorage.setItem('pm_rb_open', this.ui.ribbon ? '1' : '0'); } catch (er) { /* ignore */ } return this.updateToolbar(); }
      if (id === 'goto') { if (t) this.goTo(t.id); return; }
      if (id === 'fit') { const r = this.range(); const vw = this.scroll.clientWidth - this.LW; const base = this.ui.zoom === 'day' ? 28 : this.ui.zoom === 'week' ? 8 : 2.6; this.setZoom(Math.min(4, Math.max(0.25, vw / ((r.days - 55) * base)))); this.scrollToDate(r.min && addD(r.min, 10), false); return; }
      if (id === 'clearfilter' || id === 'f-all') return this.setFilter('all', '');
      if (id === 'f-unlinked' || id === 'f-linked') return this.setFilter(id.slice(2));
      if (id.startsWith('prog-')) return this.o.onProgress && this.o.onProgress(Number(id.slice(5)), t);
      if (id === 'modemanual' || id === 'modeauto') return this.o.onMode && this.o.onMode(id === 'modemanual' ? 'manual' : 'auto', t);
      if (id === 'legend') { this.ui.legend = !this.ui.legend; return this.updateToolbar(); }
      if (id === 'full') {
        this.setMax(!this.root.classList.contains('gt-max'));
        return;
      }
      const map = { track: 'onMarkTrack', relink: 'onRelink', flag: 'onFlag', link: 'onLinkItems', links: 'onLinkManager', versions: 'onVersions', saveversion: 'onSaveVersion', csv: 'onCsv', print: 'onPrint', add: 'onAdd', addms: 'onAddMilestone', edit: 'onEdit', del: 'onDelete', outdent: 'onOutdent', indent: 'onIndent', up: 'onUp', down: 'onDown', undo: 'onUndo', impact: 'onToggleImpact', setbaseline: 'onSetBaseline', validate: 'onValidate', msp: 'onMsProject' };
      const fn = this.o[map[id]];
      if (fn) fn(t);
    }

    centerDate() {
      const x = this.scroll.scrollLeft + (this.scroll.clientWidth - this.LW) / 3;
      return addD(this.R.min, Math.max(0, Math.round(x / this.ppd)));
    }

    onKey(e) {
      if (e.target.matches('input,select,textarea')) return;
      const t = this.sel();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.o.onUndo && this.o.onUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); return; }
      if (!t) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.o.onDelete && this.o.onDelete(t); }
      else if (e.key === 'Enter') { e.preventDefault(); this.o.onEdit && this.o.onEdit(t); }
      else if (e.key === 'F2') { e.preventDefault(); this.startEdit(t.id, 'name'); }
      else if (e.key === 'Insert') { e.preventDefault(); const i = this.rowIndex.get(t.id); this.o.onInsert && this.o.onInsert(t, this.vis[i + 1] || null); }
      else if (e.key === 'Escape') { this.select(null); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = this.rowIndex.get(t.id) + (e.key === 'ArrowDown' ? 1 : -1);
        const n = this.vis[i];
        if (n) { if (e.shiftKey) { if (this.ui.anchor == null) this.ui.anchor = t.id; this.select(n.id, { shiftKey: true }); } else this.select(n.id); }
      }
    }

    // Plain click selects one task. Ctrl or Cmd click adds or removes one. Shift click selects the range from the last clicked task.
    select(id, ev) {
      const was = this.ui.selected, U = this.ui;
      const ctrl = ev && (ev.ctrlKey || ev.metaKey), shift = ev && ev.shiftKey;
      if (id == null) { U.selected = null; U.multi = new Set(); U.anchor = null; }
      else if (shift && U.anchor != null && this.rowIndex.has(U.anchor) && this.rowIndex.has(id)) {
        const a = this.rowIndex.get(U.anchor), b = this.rowIndex.get(id), lo = Math.min(a, b), hi = Math.max(a, b);
        const set = ctrl ? new Set(U.multi) : new Set();
        for (let i = lo; i <= hi; i++) set.add(this.vis[i].id);
        U.multi = set; U.selected = id;
      } else if (ctrl) {
        const set = new Set(U.multi); if (U.selected != null) set.add(U.selected);
        if (set.has(id) && set.size > 1) { set.delete(id); U.selected = [...set].pop(); } else set.add(id), U.selected = id;
        U.multi = set; U.anchor = id;
      } else if (U.multi.size > 1 && U.multi.has(id) && ev && ev.type === 'pointerdown') { U.selected = id; } // pressing a selected bar keeps the group
      else { U.selected = id; U.multi = new Set([id]); U.anchor = id; }
      this.paintSel();
      this.updateToolbar();
      this.placeBar(was === id && this.selCount() === 1 ? id : null);
    }
    selectAll() {
      const ids = (this.vis || []).map((t) => t.id); if (!ids.length) return;
      this.ui.multi = new Set(ids); this.ui.selected = ids[0]; this.ui.anchor = ids[0];
      this.paintSel(); this.updateToolbar(); this.placeBar(null);
    }

    bind() {
      const left = this.inner.querySelector('.gt-left');
      left.addEventListener('click', (e) => {
        const car = e.target.closest('[data-caret]');
        if (car) { const id = Number(car.dataset.caret); this.ui.collapsed.has(id) ? this.ui.collapsed.delete(id) : this.ui.collapsed.add(id); this.ui.level = null; this.render(); return; }
        const md = e.target.closest('[data-mode]');
        if (md) { const x = this.tasks.find((k) => k.id === Number(md.dataset.mode)); if (x) this.o.commit({ [x.id]: { mode: x.mode === 'manual' ? 'auto' : 'manual' } }, { label: 'mode' }); return; }
        const row = e.target.closest('[data-row]');
        if (row) this.select(Number(row.dataset.row), e);
      });
      this.bindInsert(left);
      this.bindRowDrag(left);
      left.addEventListener('dblclick', (e) => {
        if (e.target.closest('.gt-rowbar,.gt-ins,[data-mode],[data-caret]')) return;
        const cell = e.target.closest('.c.ed');
        const row = e.target.closest('[data-row]');
        if (!row) return;
        const t = this.tasks.find((x) => x.id === Number(row.dataset.row));
        if (!t) return;
        // double click on the task opens the edit page, double click on a date, days, percent or owner edits in the cell
        if (!cell || cell.dataset.f === 'name') { this.select(t.id); if (this.o.onEdit) this.o.onEdit(t); return; }
        this.editCell(cell, t, cell.dataset.f);
      });
      this.layer.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      this.layer.addEventListener('dblclick', (e) => {
        const bar = e.target.closest('.gt-bar');
        if (bar) { const t = this.tasks.find((x) => x.id === Number(bar.dataset.id)); if (t && this.o.onEdit) this.o.onEdit(t); }
      });
      this.layer.addEventListener('click', (e) => {
        const dep = e.target.closest('[data-dep]');
        if (dep) { const [a, b] = dep.dataset.dep.split(':').map(Number); if (this.o.onEditDep) this.o.onEditDep(a, b); else if (this.o.onRemoveDep) this.o.onRemoveDep(a, b); }
      });
      this.layer.addEventListener('pointermove', (e) => {
        if (this.drag) return;
        const dp = e.target.closest('[data-dep]');
        if (dp) { const [a, b2] = dp.dataset.dep.split(':').map(Number); const pa = this.tasks.find((x) => x.id === a), sb = this.tasks.find((x) => x.id === b2); const d = sb && sb.deps.find((k) => k.id === a); if (pa && sb && d) { this.showTip(e, `<b>${esc(pa.name)} \u2192 ${esc(sb.name)}</b><br>${d.type || 'FS'}${d.lag ? ` ${d.lag > 0 ? '+' : ''}${d.lag}d` : ''} \u00b7 ${this.t('g_link_tip')}`); return; } }
        const bar = e.target.closest('.gt-bar');
        if (!bar) { this.tip.classList.add('hidden'); return; }
        const t = this.tasks.find((x) => x.id === Number(bar.dataset.id));
        if (!t) return;
        this.showTip(e, `<b>${esc(t.name)}</b><br>${t.start} to ${t.finish}${t.is_milestone ? '' : ` (${t.duration} ${this.t('g_days')})`}<br>${t.progress || 0}% ${this.t('g_complete')}${t.assignee ? `<br>${esc(t.assignee)}` : ''}${t.critical && !t.summary ? `<br><span style="color:#f5a04a">${this.t('g_l_crit')}</span>` : ''}${t.summary ? `<br><i>${this.t('g_summary_note')}</i>` : ''}`);
      });
      this.layer.addEventListener('pointerleave', () => this.tip.classList.add('hidden'));
    }

    // ---------- motion ----------
    reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    animate(prevIdx, prevGeom) {
      if (this.reduced() || !prevIdx || this.vis.length > 600) return;
      const ease = 'cubic-bezier(.2,.7,.2,1)';
      const left = this.inner.querySelector('.gt-left');
      let n = 0;
      for (let i = 0; i < this.vis.length && n < 160; i++) {
        const id = this.vis[i].id, pi = prevIdx.get(id);
        const row = left.querySelector(`[data-row="${id}"]`), bar = this.layer.querySelector(`.gt-bar[data-id="${id}"]`);
        if (pi === undefined) {
          n++;
          row && row.animate([{ opacity: 0, transform: 'translateX(-10px)', background: 'var(--primary-soft)' }, { opacity: 1, transform: 'none', background: 'var(--primary-soft)' }, { background: 'var(--surface)' }], { duration: 520, easing: ease });
          bar && bar.animate([{ opacity: 0, transform: 'scaleX(.2)', transformOrigin: 'left center' }, { opacity: 1, transform: 'none', transformOrigin: 'left center' }], { duration: 420, easing: ease });
        } else {
          const dy = (pi - i) * ROW, dx = prevGeom && prevGeom.has(id) && this._geom.has(id) ? prevGeom.get(id) - this._geom.get(id) : 0;
          if (dy) { n++; row && row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: ease }); }
          if ((dy || dx) && bar) { n++; bar.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 300, easing: ease }); }
        }
      }
    }

    // ---------- row action bar (appears on the selected task) ----------
    placeBar(prevFor) {
      const old = this.inner.querySelector('.gt-rowbar'); if (old) old.remove();
      const t = this.sel(); this._barFor = t ? t.id : null;
      if (!t || !this.rowIndex.has(t.id)) return;
      const picked = this.selTasks(), many = picked.length > 1;
      const first = many ? Math.min(...picked.map((x) => this.rowIndex.get(x.id))) : this.rowIndex.get(t.id);
      const i = first, T = this.t;
      const A = (a, icn, tip, extra = '', dis = false) => `<button type="button" class="${extra}" data-a="${a}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" ${dis ? 'disabled' : ''}>${ic(icn)}</button>`;
      const leafs = picked.filter((x) => !x.summary);
      const done = leafs.length > 0 && leafs.every((x) => (x.progress || 0) >= 100), flagged = picked.every((x) => x.flag);
      const manual = leafs.length > 0 && leafs.every((x) => x.mode === 'manual');
      const el = document.createElement('div');
      el.className = 'gt-rowbar' + (i === 0 ? ' below' : '') + (prevFor === t.id ? ' still' : '');
      el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', T('g_row_actions'));
      el.style.top = (i === 0 ? (i + 1) * ROW + 4 : i * ROW - 42) + 'px';
      el.innerHTML = (many ? `<span class="rb-count">${esc(T('g_n_selected', { n: picked.length }))}</span>` : A('edit', 'edit', T('g_edit'))) + A('del', 'trash', T('g_delete'), 'danger') + '<i class="sp"></i>'
        + A('up', 'up', T('g_move_up')) + A('down', 'down', T('g_move_down')) + A('outdent', 'outdent', T('g_outdent')) + A('indent', 'indent', T('g_indent')) + '<i class="sp"></i>'
        + (many ? '' : A('links', 'link', T('g_link_items'), this.linkCount(t) ? 'on' : '')) + A('flag', 'star', T(flagged ? 'g_unhighlight' : 'g_highlight'), flagged ? 'on' : '') + A('done', 'check', T(done ? 'g_reopen' : 'g_mark_done'), done ? 'on' : '', !leafs.length)
        + A('mode', manual ? 'pin' : 'auto', T(manual ? 'g_mode_manual_tip' : 'g_mode_auto_tip'), manual ? 'on' : '', !leafs.length)
        + '<i class="sp"></i>' + A('close', 'x', T('close'));
      this.inner.querySelector('.gt-left').appendChild(el);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
        e.stopPropagation();
        const a = b.dataset.a, o = this.o, cur = this.sel(); if (!cur) return;
        const pk = this.selTasks(), lf = pk.filter((x) => !x.summary);
        if (a === 'close') { this.select(null); return; }
        if (a === 'edit') o.onEdit && o.onEdit(cur);
        else if (a === 'del') o.onDelete && o.onDelete(cur);
        else if (a === 'up') o.onUp && o.onUp(cur);
        else if (a === 'down') o.onDown && o.onDown(cur);
        else if (a === 'indent') o.onIndent && o.onIndent(cur);
        else if (a === 'outdent') o.onOutdent && o.onOutdent(cur);
        else if (a === 'links') o.onLinkItems && o.onLinkItems(cur);
        else if (a === 'flag') { const on = pk.every((x) => x.flag) ? 0 : 1; o.commit(Object.fromEntries(pk.map((x) => [x.id, { flag: on }])), { label: 'flag' }); }
        else if (a === 'done') { const open = lf.every((x) => (x.progress || 0) >= 100); o.commit(Object.fromEntries(lf.map((x) => [x.id, { progress: open ? 0 : 100 }])), { label: 'progress' }); }
        else if (a === 'mode') { const to = lf.every((x) => x.mode === 'manual') ? 'auto' : 'manual'; o.commit(Object.fromEntries(lf.map((x) => [x.id, { mode: to }])), { label: 'mode' }); }
      });
    }

    // ---------- insert between two rows ----------
    // Drag a task by its number cell and drop it above, below or inside another task.
    bindRowDrag(left) {
      left.addEventListener('pointerdown', (e) => {
        const num = e.target.closest('.c.num');
        if (!num || e.button || !this.o.onMoveTo) return;
        const srcRow = num.closest('[data-row]');
        const id = Number(srcRow.dataset.row);
        const x0 = e.clientX, y0 = e.clientY;
        let on = false, tgt = null, line = null;
        const isUnder = (cand) => { let c = this.tasks.find((k) => k.id === cand); while (c) { if (c.id === id) return true; c = this.tasks.find((k) => k.id === c.parent_id); } return false; };
        const clear = () => { left.querySelectorAll('.gt-drop-into,.gt-dragging').forEach((n) => n.classList.remove('gt-drop-into', 'gt-dragging')); if (line) line.hidden = true; };
        const move = (ev) => {
          if (!on) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; on = true; srcRow.classList.add('gt-dragging'); document.body.classList.add('gt-dnd'); line = document.createElement('div'); line.className = 'gt-dropline'; document.body.appendChild(line); }
          ev.preventDefault();
          const rows = [...left.querySelectorAll('.gt-cells[data-row]')];
          const r = rows.find((n) => { const b = n.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
          left.querySelectorAll('.gt-drop-into').forEach((n) => n.classList.remove('gt-drop-into'));
          tgt = null;
          if (!r) { line.hidden = true; return; }
          const tid = Number(r.dataset.row);
          if (isUnder(tid)) { line.hidden = true; return; }
          const b = r.getBoundingClientRect(), f = (ev.clientY - b.top) / b.height;
          const pos = f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'into';
          tgt = { id: tid, pos };
          if (pos === 'into') { r.classList.add('gt-drop-into'); line.hidden = true; }
          else { line.hidden = false; const lb = left.getBoundingClientRect(); line.style.top = (pos === 'before' ? b.top : b.bottom) - 1 + 'px'; line.style.left = lb.left + 'px'; line.style.width = lb.width + 'px'; }
          // scroll the page or the schedule while dragging near an edge
          const sc = left.closest('.gt-scroll') || this.root; const sb = sc.getBoundingClientRect();
          if (ev.clientY > sb.bottom - 30) sc.scrollTop += 12; else if (ev.clientY < sb.top + 60) sc.scrollTop -= 12;
        };
        const up = () => {
          document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
          document.body.classList.remove('gt-dnd');
          const t2 = tgt; clear(); if (line) line.remove();
          if (on && t2) this.o.onMoveTo(id, t2.id, t2.pos);
        };
        document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
      });
    }

    bindInsert(left) {
      const w = document.createElement('div'); w.className = 'gt-ins'; w.hidden = true;
      w.innerHTML = `<i></i><button type="button" data-tip="${esc(this.t('g_insert_here'))}" aria-label="${esc(this.t('g_insert_here'))}">${ic('plus')}</button>`;
      left.appendChild(w);
      let at = 0;
      left.addEventListener('pointermove', (e) => {
        if (this.drag || e.pointerType === 'touch' || e.target.closest('.gt-rowbar')) { if (e.target.closest('.gt-rowbar')) w.hidden = true; return; }
        const y = e.clientY - left.getBoundingClientRect().top, idx = Math.round(y / ROW);
        if (idx < 1 || idx > this.vis.length || Math.abs(y - idx * ROW) > 9) { if (!e.target.closest('.gt-ins button')) w.hidden = true; return; }
        at = idx; w.hidden = false; w.style.top = `${idx * ROW}px`;
      });
      left.addEventListener('pointerleave', () => { w.hidden = true; });
      w.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); w.hidden = true; this.o.onInsert && this.o.onInsert(this.vis[at - 1], this.vis[at] || null); });
    }

    startEdit(id, f = 'name') {
      const cell = this.inner.querySelector(`.gt-cells[data-row="${id}"] .c[data-f="${f}"]`), t = this.tasks.find((x) => x.id === id);
      if (cell && t) { cell.scrollIntoView({ block: 'nearest' }); this.editCell(cell, t, f); }
    }

    showTip(e, html) {
      this.tip.innerHTML = html;
      this.tip.classList.remove('hidden');
      const w = this.tip.offsetWidth;
      this.tip.style.left = `${Math.min(window.innerWidth - w - 10, e.clientX + 14)}px`;
      this.tip.style.top = `${e.clientY + 16}px`;
    }

    // ---------- inline cell editing ----------
    editCell(cell, t, f) {
      if (!f) return;
      if (t.summary && f !== 'name' && f !== 'assignee') return;
      const orig = f === 'duration' ? t.duration : f === 'progress' ? t.progress : (t[f] || '');
      const input = document.createElement(f === 'assignee' ? 'input' : 'input');
      input.type = f === 'start' ? 'date' : f === 'duration' || f === 'progress' ? 'number' : 'text';
      if (f === 'assignee') input.setAttribute('list', 'gt-res');
      if (f === 'progress') { input.min = 0; input.max = 100; }
      if (f === 'duration') input.min = 0;
      input.value = orig;
      cell.innerHTML = '';
      cell.appendChild(input);
      input.focus(); input.select();
      let done = false;
      const finish = (commit) => {
        if (done) return; done = true;
        const v = input.value;
        if (commit && String(v) !== String(orig) && !(v === '' && f !== 'assignee')) {
          let val = v;
          if (f === 'duration' || f === 'progress') val = Number(v);
          this.o.commit({ [t.id]: { [f]: val } }, { label: f });
        } else this.render();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); });
      input.addEventListener('blur', () => finish(true));
    }

    // ---------- pointer interactions ----------
    onPointerDown(e) {
      if (e.button !== 0) return;
      const bar = e.target.closest('.gt-bar');
      if (!bar) return;
      const id = Number(bar.dataset.id);
      const t = this.tasks.find((x) => x.id === id);
      if (!t) return;
      this.select(id, e);
      this.scroll.focus({ preventScroll: true });
      if (t.summary) return;
      const handle = e.target.closest('[data-m]');
      let mode = handle ? handle.dataset.m : 'move';
      if (bar.classList.contains('gt-ms')) mode = 'move';
      e.preventDefault();
      this.tip.classList.add('hidden');
      const rect = bar.getBoundingClientRect();
      const d = this.drag = {
        id, t, mode, bar, x0: e.clientX, y0: e.clientY, moved: false, rect, pointer: e.pointerId,
        start: t.start, dur: t.duration, finish: t.finish, progress: t.progress, ms: bar.classList.contains('gt-ms'),
        newStart: t.start, newDur: t.duration, newProgress: t.progress, link: null,
      };
      this.layer.setPointerCapture?.(e.pointerId);
      if (mode === 'linkl' || mode === 'linkr') this.beginLink(e, d);
      const move = (ev) => { d.last = ev; if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; this.onDragMove(d, d.last); }); };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
        document.removeEventListener('keydown', esc2);
        if (d.raf) cancelAnimationFrame(d.raf);
        this.onDragEnd(d, ev, false);
      };
      const cancel = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', esc2); this.onDragEnd(d, null, true); };
      const esc2 = (ev) => { if (ev.key === 'Escape') cancel(); };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
      document.addEventListener('keydown', esc2);
    }

    onDragMove(d, e) {
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      if (!d.moved) { d.moved = true; if (d.mode !== 'linkl' && d.mode !== 'linkr') d.bar.classList.add('dragging'); }
      const ppd = this.ppd;
      const days = Math.round(dx / ppd);
      const t = d.t;
      if (d.mode === 'move') {
        const ns = this.nextWork(addD(d.start, days));
        d.newStart = ns;
        const shift = diff(d.start, ns) * ppd;
        d.bar.style.transform = d.ms ? `translateX(${shift}px) rotate(45deg)` : `translateX(${shift}px)`;
        const nf = this.finishOf(ns, d.dur, t.is_milestone);
        this.showTip(e, `<b>${esc(t.name)}</b><br>${ns} to ${nf}`);
      } else if (d.mode === 'right') {
        const wantFinish = addD(d.finish, days);
        const nd = Math.max(1, this.countWork(d.start, wantFinish < d.start ? d.start : wantFinish));
        d.newDur = nd;
        const nf = this.finishOf(d.start, nd, false);
        d.bar.style.width = `${(diff(d.start, nf) + 1) * ppd - 2}px`;
        this.showTip(e, `<b>${esc(t.name)}</b><br>${d.start} to ${nf}<br>${nd} ${this.t('g_days')}`);
      } else if (d.mode === 'left') {
        let ns = this.nextWork(addD(d.start, days));
        if (ns > d.finish) ns = d.finish;
        const nd = Math.max(1, this.countWork(ns, d.finish));
        d.newStart = ns; d.newDur = nd;
        d.bar.style.left = `${this.x(ns)}px`;
        d.bar.style.width = `${(diff(ns, d.finish) + 1) * ppd - 2}px`;
        this.showTip(e, `<b>${esc(t.name)}</b><br>${ns} to ${d.finish}<br>${nd} ${this.t('g_days')}`);
      } else if (d.mode === 'progress') {
        const w = d.rect.width;
        const pct = Math.max(0, Math.min(100, Math.round(((e.clientX - d.rect.left) / w) * 20) * 5));
        d.newProgress = pct;
        d.bar.querySelector('.fill').style.width = `${pct}%`;
        d.bar.querySelector('.pg').style.left = `${pct}%`;
        this.showTip(e, `<b>${esc(t.name)}</b><br>${pct}% ${this.t('g_complete')}`);
      } else if (d.mode === 'linkl' || d.mode === 'linkr') {
        this.updateLink(d, e);
      }
    }

    beginLink(e, d) {
      const ns = 'http://www.w3.org/2000/svg';
      d.tmp = document.createElementNS(ns, 'path');
      d.tmp.setAttribute('class', 'tmp');
      this.svg.appendChild(d.tmp);
      const a = this.anchors(d.t);
      d.from = d.mode === 'linkr' ? { x: a.r, y: a.y } : { x: a.l, y: a.y };
    }

    updateLink(d, e) {
      const lr = this.layer.getBoundingClientRect();
      const x = e.clientX - lr.left, y = e.clientY - lr.top;
      d.tmp.setAttribute('d', `M${d.from.x} ${d.from.y}L${x} ${y}`);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el && el.closest('.gt-bar');
      this.layer.querySelectorAll('.linking-target').forEach((n) => n.classList.remove('linking-target'));
      d.link = null;
      d.side = 'start';
      if (target && Number(target.dataset.id) !== d.id) { target.classList.add('linking-target'); d.link = Number(target.dataset.id); const r = target.getBoundingClientRect(); d.side = e.clientX > r.left + r.width / 2 ? 'finish' : 'start'; target.dataset.side = d.side; }
    }

    onDragEnd(d, e, cancelled) {
      this.tip.classList.add('hidden');
      this.drag = null;
      d.bar.classList.remove('dragging');
      if (d.tmp) d.tmp.remove();
      this.layer.querySelectorAll('.linking-target').forEach((n) => n.classList.remove('linking-target'));
      if (cancelled || !d.moved) { if (d.moved) this.render(); return; }
      const t = d.t;
      if (d.mode === 'move' && d.newStart !== d.start) return this.o.commit({ [t.id]: { start: d.newStart } }, { label: 'move', direct: t.id });
      if (d.mode === 'right' && d.newDur !== d.dur) return this.o.commit({ [t.id]: { duration: d.newDur } }, { label: 'resize', direct: t.id });
      if (d.mode === 'left' && (d.newStart !== d.start || d.newDur !== d.dur)) return this.o.commit({ [t.id]: { start: d.newStart, duration: d.newDur } }, { label: 'resize', direct: t.id });
      if (d.mode === 'progress' && d.newProgress !== d.progress) return this.o.commit({ [t.id]: { progress: d.newProgress } }, { label: 'progress', direct: t.id });
      if ((d.mode === 'linkl' || d.mode === 'linkr') && d.link) {
        const pred = d.mode === 'linkr' ? d.id : d.link;
        const succ = d.mode === 'linkr' ? d.link : d.id;
        // dragging from the finish handle: drop on the start half = FS, drop on the finish half = FF
        // dragging from the start handle: drop on the finish half = FS (target finishes first), start half = SS
        const type = d.mode === 'linkr' ? (d.side === 'finish' ? 'FF' : 'FS') : (d.side === 'finish' ? 'FS' : 'SS');
        return this.o.onAddDep && this.o.onAddDep(pred, succ, type);
      }
      this.render();
    }
  }

  window.Gantt = Gantt;
  window.GanttUtil = { addD, diff, P, F };
})();
