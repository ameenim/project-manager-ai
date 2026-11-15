/* Overview filters: year, quarter, month, status, health, currency, client and projects.
   One filter state per overview is saved in localStorage and sent to the server as a query. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$ } = PM;
  const K = 'pm_gf';
  const read = () => { try { return JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch { return {}; } };
  const get = (key) => { const f = read()[key] || {}; return { y: f.y || '', q: f.q || '', m: f.m || '', s: f.s || '', h: f.h || '', cur: f.cur || '', c: f.c || '', p: Array.isArray(f.p) ? f.p.map(Number) : [] }; };
  const put = (key, f) => { try { const a = read(); a[key] = f; localStorage.setItem(K, JSON.stringify(a)); } catch { /* private mode */ } };
  const isOn = (f) => !!(f.y || f.q || f.m || f.s || f.h || f.cur || f.c || (f.p && f.p.length));
  function query(key) {
    const f = get(key), p = new URLSearchParams();
    for (const k of ['y', 'q', 'm', 's', 'h', 'cur', 'c']) if (f[k]) p.set(k, f[k]);
    if (f.p.length) p.set('p', f.p.join(','));
    const s = p.toString();
    return s ? '?' + s : '';
  }
  // The top filters rule the page. When one changes, a widget filter that disagrees is rewritten to match it.
  // cur is the widget filter, f the new top filter, prev the top filter before the change. Period fields move together,
  // status only when the widget offers that status, project only when exactly one project is picked.
  // statuses is the list of status values the widget offers (or null), names maps a project id to its name.
  function align(cur, f, prev, statuses, names) {
    const next = { ...cur };
    if (f.y !== prev.y || f.q !== prev.q || f.m !== prev.m) { next.y = f.y || ''; next.q = f.q || ''; next.m = f.m || ''; }
    if (f.s !== prev.s) next.s = f.s && statuses && statuses.includes(f.s) ? f.s : '';
    if (String(f.p) !== String(prev.p)) next.p = f.p.length === 1 && names && names[f.p[0]] ? names[f.p[0]] : '';
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    const same = ['y', 'q', 'm', 's', 'p'].every((k) => String(cur[k] || '') === String(next[k] || ''));
    return same ? null : next;
  }
  const monthName = (m) => new Date(2024, m - 1, 1).toLocaleDateString(PM.state.lang === 'ar' ? 'ar-AE' : 'en-US', { month: 'long' });

  function sel(id, label, all, opts, val) {
    return `<label class="gf-f"><span class="small muted">${esc(label)}</span><select id="${id}" aria-label="${esc(label)}"><option value="">${esc(all)}</option>${opts.map(([v, l]) => `<option value="${esc(String(v))}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }

  // scope is 'portfolio' or 'project'. Returns an object with update(d) to refresh options and counts.
  function mountBar(el, o) {
    const key = o.key, portfolio = o.scope === 'portfolio';
    let d = o.d, open = false, warn = '';
    const draw = () => {
      const f = get(key), op = (d && d.filter_options) || { years: [], clients: [], currencies: [], projects: [] };
      const picked = new Set(f.p);
      const pl = picked.size ? t('gf_n_projects', { n: picked.size }) : t('wfl_all_projects');
      el.innerHTML = `<div class="gf-row">
        ${sel('gfY', t('wfl_year'), t('wfl_all_years'), op.years.map((y) => [y, y]), f.y)}
        ${sel('gfQ', t('wfl_quarter'), t('wfl_all_quarters'), [1, 2, 3, 4].map((q) => [q, 'Q' + q]), f.q)}
        ${sel('gfM', t('wfl_month'), t('wfl_all_months'), Array.from({ length: 12 }, (_, i) => [i + 1, monthName(i + 1)]), f.m)}
        ${sel('gfS', t('wfl_status'), t('wfl_all_status'), ['done', 'active', 'todo', 'late'].map((s) => [s, t('gf_s_' + s)]), f.s)}
        ${portfolio ? sel('gfH', t('gf_health'), t('gf_all_health'), [['green', t('health_green')], ['amber', t('health_amber')], ['red', t('health_red')]], f.h) : ''}
        ${portfolio ? sel('gfCur', t('gf_currency'), t('gf_all_currency'), op.currencies.map((c) => [c, c]), f.cur) : ''}
        ${portfolio ? sel('gfC', t('gf_client'), t('gf_all_clients'), op.clients.map((c) => [c, c]), f.c) : ''}
        ${portfolio ? `<div class="gf-f"><span class="small muted">${esc(t('gf_projects'))}</span><div class="dd" id="gfP"><button type="button" class="dd-btn" aria-haspopup="true" aria-expanded="${open}">${esc(pl)}${icon('chev_d')}</button><div class="dd-pop" ${open ? '' : 'hidden'}>${op.projects.map((p) => `<label class="dd-opt"><input type="checkbox" data-p="${p.id}" ${picked.has(p.id) ? 'checked' : ''}><span class="grow">${esc(p.name)}</span></label>`).join('')}</div></div></div>` : ''}
        <button type="button" class="btn sm ghost" id="gfClear" ${isOn(f) ? '' : 'hidden'}>${icon('x')}${esc(t('gf_clear'))}</button>
      </div>
      <div class="gf-note small muted" id="gfNote" aria-live="polite" title="${esc(t('gf_status_tip'))}"></div>
      <div class="gf-warn small" id="gfWarn" role="status" aria-live="polite" ${warn ? '' : 'hidden'}>${warn ? `<span>${icon('alert')}${esc(warn)}</span><button type="button" class="btn sm ghost icon" id="gfWarnX" aria-label="${esc(t('gf_sync_dismiss'))}">${icon('x')}</button>` : ''}</div>`;
      note();
    };
    const note = () => {
      const n = $('#gfNote', el); if (!n) return;
      const f = get(key), kept = d && d.projects ? d.projects.length : null, total = d && d.filter_options ? d.filter_options.projects.length : null;
      n.textContent = isOn(f) && portfolio && kept != null ? t('gf_showing', { n: kept, total: Math.max(total, kept) }) : '';
    };
    const set = (patch) => { const prev = get(key), f = { ...prev, ...patch }; if (f.m) f.q = ''; put(key, f); o.onChange(f, prev); draw(); };
    el.addEventListener('change', (e) => {
      const x = e.target;
      const map = { gfY: 'y', gfQ: 'q', gfM: 'm', gfS: 's', gfH: 'h', gfCur: 'cur', gfC: 'c' };
      if (map[x.id]) set({ [map[x.id]]: x.value });
      else if (x.dataset && x.dataset.p) set({ p: $$('#gfP input:checked', el).map((i) => Number(i.dataset.p)) });
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('#gfWarnX')) { warn = ''; draw(); return; }
      if (e.target.closest('#gfClear')) { set({ y: '', q: '', m: '', s: '', h: '', cur: '', c: '', p: [] }); return; }
      const b = e.target.closest('#gfP .dd-btn');
      if (b) { open = !open; $('#gfP .dd-pop', el).hidden = !open; b.setAttribute('aria-expanded', String(open)); }
    });
    document.addEventListener('click', (e) => { if (!el.isConnected) return; if (open && !e.target.closest('#gfP')) { open = false; const p = $('#gfP .dd-pop', el); if (p) p.hidden = true; const b = $('#gfP .dd-btn', el); if (b) b.setAttribute('aria-expanded', 'false'); } });
    draw();
    return { warn(msg) { warn = msg || ''; draw(); }, update(nd) { d = nd; note(); const c = $('#gfClear', el); if (c) c.hidden = !isOn(get(key)); } };
  }

  PM.dashFilters = { get, put, query, isOn, mountBar, align, K };
})();
