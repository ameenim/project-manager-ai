/* Portfolio pages: Projects (cards or grid, with filters) and the Calendar across all projects. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api } = PM;
  const S = PM.state;
  const loc = () => (S.lang === 'ar' ? 'ar-AE' : 'en-US');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ======================= Projects =======================
  const Q = { q: '', health: 'all', cur: 'all', sort: 'name', dir: 1 };
  const HEALTH = { green: 0, amber: 1, red: 2 };

  PM.views.projects = async function () {
    S.project = null;
    PM.shell('projects', `<div class="page"><div class="empty"><span class="spinner"></span></div></div>`);
    await PM.loadProjects();
    PM.shell('projects', '');
    let mode = store.get('pm_proj_view', 'cards');
    const all = S.projects;
    const currencies = [...new Set(all.map((p) => p.currency).filter(Boolean))].sort();

    const view = () => {
      const q = Q.q.trim().toLowerCase();
      let list = all.filter((p) => (Q.health === 'all' || p.stats.health === Q.health) && (Q.cur === 'all' || p.currency === Q.cur) && (!q || [p.name, p.client, p.code].some((x) => (x || '').toLowerCase().includes(q))));
      const key = { name: (p) => p.name.toLowerCase(), progress: (p) => p.stats.progress, status: (p) => HEALTH[p.stats.health] ?? 0, value: (p) => p.value || 0, start: (p) => p.start_date || '9999', end: (p) => p.end_date || '9999' }[Q.sort];
      list = [...list].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * Q.dir);
      return list;
    };

    const card = (p) => `<a class="card pj-card" href="#/p/${p.id}/overview"><div class="row">${p.client_logo ? `<img src="${esc(p.client_logo)}" alt="" style="height:30px;max-width:90px;object-fit:contain">` : ''}<div class="grow" style="min-width:0"><h3>${esc(p.name)}</h3><div class="small muted">${esc(p.client || '')}</div></div>${PM.healthChip(p.stats.health)}</div>
      <div class="mt"><div class="row small"><span class="grow">${t('progress')} ${p.stats.progress}%</span><span class="muted">${p.value ? money(p.value, p.currency) : ''}</span></div><div class="progress" style="margin-top:6px"><i style="width:${p.stats.progress}%"></i></div></div>
      <div class="row small muted mt wrap"><span>${p.start_date || '?'} ${t('to')} ${p.end_date || '?'}</span>${p.stats.pendingItems + p.stats.pendingInbox ? `<span class="chip blue">${p.stats.pendingItems + p.stats.pendingInbox} ${t('to_review')}</span>` : ''}</div></a>`;

    const th = (k, label) => `<th class="sortable ${Q.sort === k ? 'on' : ''}" data-sort="${k}" tabindex="0" role="columnheader" aria-sort="${Q.sort === k ? (Q.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-ar">${Q.sort === k ? (Q.dir > 0 ? '▲' : '▼') : ''}</span></th>`;
    const grid = (list) => `<div class="card flush"><div class="table-wrap"><table class="t pj-grid"><thead><tr>${th('name', t('pf_project'))}${th('progress', t('pf_progress'))}${th('status', t('pf_status'))}${th('value', t('pf_value'))}${th('start', t('pf_start'))}${th('end', t('pf_end'))}</tr></thead><tbody>${list.map((p) => `<tr data-go="#/p/${p.id}/overview"><td><div style="font-weight:600">${esc(p.name)}</div><div class="small muted">${esc(p.client || '')}</div></td>
      <td style="min-width:150px"><div class="row" style="gap:8px"><div class="progress grow"><i style="width:${p.stats.progress}%"></i></div><span class="small" style="width:36px;text-align:end">${p.stats.progress}%</span></div></td>
      <td>${PM.healthChip(p.stats.health)}</td><td class="nowrap">${p.value ? money(p.value, p.currency) : '<span class="muted">-</span>'}</td><td class="nowrap">${p.start_date || '<span class="muted">-</span>'}</td><td class="nowrap">${p.end_date || '<span class="muted">-</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;

    function draw(keepFocus) {
      const list = view();
      $('#pjBody').innerHTML = !all.length ? `<div class="card empty"><div class="big">📁</div><p>${t('empty_projects')}</p></div>` : !list.length ? `<div class="card empty"><p>${t('pf_none_match')}</p><button class="btn" id="pjClear">${t('pf_clear')}</button></div>` : mode === 'grid' ? grid(list) : `<div class="grid g3 pj-cards">${list.map(card).join('')}</div>`;
      $('#pjCount').textContent = t('pf_shown', { a: list.length, b: all.length });
      $$('#pjBody [data-go]').forEach((r) => (r.onclick = () => (location.hash = r.dataset.go)));
      $$('#pjBody [data-sort]').forEach((h) => { const go = () => { if (Q.sort === h.dataset.sort) Q.dir *= -1; else { Q.sort = h.dataset.sort; Q.dir = 1; } draw(); }; h.onclick = go; h.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
      const c = $('#pjClear'); if (c) c.onclick = () => { Object.assign(Q, { q: '', health: 'all', cur: 'all' }); $('#pjQ').value = ''; $('#pjHealth').value = 'all'; $('#pjCur').value = 'all'; draw(); };
      $$('#pjMode button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode); });
    }

    $('#content').innerHTML = `<div class="page"><div class="page-head"><h1>${t('nav_projects')}</h1><button class="btn primary" id="newProj">${icon('plus')}${t('new_project')}</button></div>
      <div class="pj-bar"><input type="search" id="pjQ" placeholder="${t('pf_search')}" value="${esc(Q.q)}" aria-label="${t('pf_search')}">
        <select id="pjHealth" aria-label="${t('pf_status')}"><option value="all">${t('pf_all_status')}</option><option value="green">${t('health_green')}</option><option value="amber">${t('health_amber')}</option><option value="red">${t('health_red')}</option></select>
        <select id="pjCur" aria-label="${t('currency')}"><option value="all">${t('pf_all_cur')}</option>${currencies.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <span class="small muted grow" id="pjCount"></span>
        <div class="seg" id="pjMode" role="group"><button data-mode="cards" aria-label="${t('pf_cards')}" title="${t('pf_cards')}">${icon('grid')}${t('pf_cards')}</button><button data-mode="grid" aria-label="${t('pf_grid')}" title="${t('pf_grid')}">${icon('list')}${t('pf_grid')}</button></div></div>
      <div id="pjBody"></div></div>`;
    $('#pjHealth').value = Q.health; $('#pjCur').value = Q.cur;
    $('#newProj').onclick = PM.newProjectDialog;
    $('#pjQ').oninput = (e) => { Q.q = e.target.value; draw(); };
    $('#pjHealth').onchange = (e) => { Q.health = e.target.value; draw(); };
    $('#pjCur').onchange = (e) => { Q.cur = e.target.value; draw(); };
    $$('#pjMode button').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; store.set('pm_proj_view', mode); draw(); }));
    draw();
  };

  // ======================= Calendar =======================
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#9a4fd1', '#d4a017', '#d6336c', '#0c8ea8', '#6c757d'];
  const DAY = 86400000;
  const U = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
  const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);

  PM.views.calendar = async function () {
    const token = S.nav;
    PM.shell('calendar', `<div class="page"><div class="empty"><span class="spinner"></span></div></div>`);
    let data;
    const load = async () => { data = await api('GET', '/api/calendar'); };
    await Promise.all([load(), PM.loadProjects()]);
    if (PM.stale(token)) return;
    PM.shell('calendar', '');
    const projects = data.projects;
    const color = {}; projects.forEach((p, i) => (color[p.id] = COLORS[i % COLORS.length]));
    const pname = Object.fromEntries(projects.map((p) => [p.id, p]));
    const TYPES = ['milestone', 'task', 'summary', 'payment'];
    const TORDER = Object.fromEntries(TYPES.map((k, i) => [k, i]));
    const sel = new Set(store.get('pm_cal_sel', null) || projects.map((p) => p.id));
    for (const id of [...sel]) if (!pname[id]) sel.delete(id);
    const types = new Set((store.get('pm_cal_types', null) || TYPES).filter((k) => TYPES.includes(k)));
    let overOnly = store.get('pm_cal_over', false);
    let focus = null; // { day } or { key, fromDay }
    const todayN = U(data.today);
    const first = new Date(data.today.slice(0, 7) + '-01T00:00:00Z');
    let year = first.getUTCFullYear(), month = first.getUTCMonth(), dir = 0;
    const MAXM = 3;

    const monthLabel = () => new Date(Date.UTC(year, month, 1)).toLocaleDateString(loc(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const dayLabel = (n, long) => new Date(n * DAY).toLocaleDateString(loc(), long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const wk = (i) => new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString(loc(), { weekday: 'short', timeZone: 'UTC' }); // Sunday first

    // every task and payment becomes one marker on its due date
    function build() {
      const out = [];
      for (const x of data.tasks) {
        const type = x.summary ? 'summary' : x.milestone ? 'milestone' : 'task';
        out.push({ key: 't' + x.id, k: 't', type, id: x.id, pid: x.project_id, name: x.name, due: x.finish, n: U(x.finish), start: x.start, progress: x.progress || 0, who: x.assignee, late: !!x.late, done: (x.progress || 0) >= 100 });
      }
      for (const x of data.payments) {
        out.push({ key: 'p' + x.id, k: 'p', type: 'payment', id: x.id, pid: x.project_id, name: x.title, due: x.due, n: U(x.due), state: x.state, amount: x.amount, late: x.state !== 'paid' && x.due < data.today, done: x.state === 'paid' });
      }
      return out;
    }
    let all = build();
    const byKey = () => Object.fromEntries(all.map((e) => [e.key, e]));
    const visible = () => all.filter((e) => sel.has(e.pid) && types.has(e.type) && (!overOnly || (e.late && !e.done)));
    function byDay(list) {
      const m = new Map();
      for (const e of list) { if (!m.has(e.n)) m.set(e.n, []); m.get(e.n).push(e); }
      for (const a of m.values()) a.sort((x, y) => TORDER[x.type] - TORDER[y.type] || x.pid - y.pid || x.name.localeCompare(y.name));
      return m;
    }
    const typeName = (k) => t('cal_ty_' + k);
    const shape = (e) => e.type === 'payment' ? `<span class="mk-s pay">${icon('coin')}</span>` : `<i class="mk-s ${e.type}"></i>`;
    function status(e) {
      if (e.done) return { cls: 'green', text: e.type === 'payment' ? t('state_paid') : t('cal_done') };
      const d = e.n - todayN;
      if (e.late) return { cls: 'red', text: t('cal_overdue_days', { n: -d }) };
      if (d === 0) return { cls: 'amber', text: t('cal_due_today') };
      return { cls: 'blue', text: t('cal_due_in', { n: d }) };
    }
    const tip = (e) => `${e.name}\n${pname[e.pid].name}\n${typeName(e.type)} · ${dayLabel(e.n)}`;

    function weeks() {
      const start = Date.UTC(year, month, 1) / DAY;
      const lead = new Date(start * DAY).getUTCDay();
      const gridStart = start - lead;
      const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const n = Math.ceil((lead + days) / 7);
      return Array.from({ length: n }, (_, i) => gridStart + i * 7);
    }

    function marker(e) {
      const on = focus && focus.key === e.key;
      return `<button type="button" class="mk ${e.type} ${e.late && !e.done ? 'late' : ''} ${e.done ? 'done' : ''} ${on ? 'sel' : ''}" style="--pc:${color[e.pid]}" data-key="${e.key}" title="${esc(tip(e))}" aria-label="${esc(e.name + ', ' + typeName(e.type) + ', ' + pname[e.pid].name)}">${shape(e)}<span class="mk-t">${esc(e.name)}</span></button>`;
    }

    function render() {
      const list = visible(), m = byDay(list);
      const g = $('#calGrid');
      g.innerHTML = weeks().map((w0) => `<div class="cal-w">${Array.from({ length: 7 }, (_, c) => {
        const dn = w0 + c, d = new Date(dn * DAY), other = d.getUTCMonth() !== month, wkend = [5, 6].includes(d.getUTCDay());
        const items = m.get(dn) || [];
        const shown = items.length > MAXM ? items.slice(0, MAXM - 1) : items;
        const more = items.length - shown.length;
        const on = focus && focus.day === iso(dn);
        return `<div class="cal-d ${other ? 'other' : ''} ${wkend ? 'wkend' : ''} ${dn === todayN ? 'today' : ''} ${on ? 'sel' : ''}" data-day="${iso(dn)}"><button type="button" class="cal-n" data-day="${iso(dn)}" aria-label="${esc(dayLabel(dn, true) + ', ' + t('cal_day_items', { n: items.length }))}">${d.getUTCDate()}</button>${shown.map(marker).join('')}${more ? `<button type="button" class="cal-more" data-day="${iso(dn)}">${t('cal_more', { n: more })}</button>` : ''}</div>`;
      }).join('')}</div>`).join('');
      g.classList.remove('slide-l', 'slide-r'); void g.offsetWidth;
      if (dir) g.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
      dir = 0;
      $('#calMonth').textContent = monthLabel();
      $('#calMonthPick').value = `${year}-${String(month + 1).padStart(2, '0')}`;
      const a = Date.UTC(year, month, 1) / DAY, b = Date.UTC(year, month + 1, 0) / DAY;
      $('#calCount').textContent = t('cal_count', { n: list.filter((e) => e.n >= a && e.n <= b).length });
      $('#calOver').classList.toggle('on', overOnly); $('#calOver').setAttribute('aria-pressed', overOnly);
      renderBtns();
      side();
    }

    // ----- details panel (same screen) -----
    function side() {
      const el = $('#calSide');
      const map = byKey();
      if (focus && focus.key && !map[focus.key]) focus = null;
      if (!focus) {
        el.innerHTML = `<div class="cal-empty"><div class="big">${icon('cal')}</div><b>${t('cal_pick_hint')}</b><div class="small muted">${t('cal_pick_sub')}</div></div>`;
        return;
      }
      if (focus.day) {
        const n = U(focus.day), list = (byDay(visible()).get(n) || []);
        el.innerHTML = `<div class="cal-det"><div class="cal-det-h"><div class="grow"><div class="cal-det-t">${esc(dayLabel(n, true))}</div><div class="small muted">${t('cal_day_items', { n: list.length })}</div></div><button class="btn ghost icon" id="calClose" aria-label="${esc(t('close'))}">${icon('x')}</button></div>
          ${list.length ? `<div class="cal-agenda">${list.map((e) => `<button type="button" class="cal-ag ${e.done ? 'done' : ''}" data-key="${e.key}" style="--pc:${color[e.pid]}">${shape(e)}<span class="grow"><span class="cal-ag-t">${esc(e.name)}</span><span class="small muted">${esc(pname[e.pid].name)} · ${typeName(e.type)}</span></span><span class="chip ${status(e).cls}">${esc(status(e).text)}</span></button>`).join('')}</div>` : `<div class="empty small">${t('cal_no_events')}</div>`}</div>`;
        $('#calClose').onclick = () => { focus = null; render(); };
        return;
      }
      const e = map[focus.key], st = status(e), cur = pname[e.pid].currency;
      const rows = [[t('cal_due'), dayLabel(e.n)]];
      if (e.k === 't') {
        if (e.type !== 'milestone') rows.push([t('cal_start'), dayLabel(U(e.start))]);
        if (e.who) rows.push([t('cal_assignee'), esc(e.who)]);
      } else {
        rows.push([t('cal_amount'), e.amount != null ? money(e.amount, cur) : '-']);
        rows.push([t('cal_state'), t('state_' + e.state)]);
      }
      const canProg = e.k === 't' && e.type !== 'summary' && !e.done;
      el.innerHTML = `<div class="cal-det" style="--pc:${color[e.pid]}">
        <div class="cal-det-h">${focus.fromDay ? `<button class="btn ghost icon" id="calBack" aria-label="${esc(t('cal_back'))}">${icon(S.lang === 'ar' ? 'chev_r' : 'chev_l')}</button>` : ''}<div class="grow"><div class="cal-det-t">${esc(e.name)}</div><div class="small muted"><span class="cal-sw dot"></span>${esc(pname[e.pid].name)}</div></div><button class="btn ghost icon" id="calClose" aria-label="${esc(t('close'))}">${icon('x')}</button></div>
        <div class="row wrap" style="gap:6px;margin:10px 0">${`<span class="chip">${shape(e)}${typeName(e.type)}</span>`}<span class="chip ${st.cls}">${esc(st.text)}</span></div>
        <dl class="cal-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${e.k === 't' ? `<div class="cal-prog-row"><div class="small muted">${t('cal_progress')}</div><div class="row" style="gap:10px"><div class="progress ${e.progress >= 100 ? 'green' : ''} grow"><i style="width:${e.progress}%"></i></div><b>${e.progress}%</b></div></div>` : ''}
        <div class="cal-acts">
          ${canProg ? `<button class="btn primary sm" id="calProg">${icon('check')}${t('ra_update')}</button>` : ''}
          ${e.k === 'p' && e.state === 'pending' ? `<button class="btn sm" id="calInv">${t('ra_invoiced')}</button>` : ''}
          ${e.k === 'p' && e.state !== 'paid' ? `<button class="btn good sm" id="calPaid">${icon('check')}${t('ra_paid')}</button>` : ''}
          <button class="btn sm" id="calPeek">${t(e.k === 'p' ? 'tab_review' : 'tab_schedule')}</button>
          <a class="btn sm ghost" href="#/p/${e.pid}/${e.k === 'p' ? 'review' : 'schedule'}">${t('open_full_page')}</a>
        </div></div>`;
      $('#calClose').onclick = () => { focus = null; render(); };
      if (focus.fromDay) $('#calBack').onclick = () => { focus = { day: focus.fromDay }; render(); };
      const done = async () => { await load(); all = build(); render(); };
      if (canProg) $('#calProg').onclick = () => PM.act.progress({ title: e.name, project: pname[e.pid].name, project_id: e.pid, task_id: e.id, progress: e.progress }, done);
      if ($('#calInv')) $('#calInv').onclick = () => PM.act.setState(e.id, 'invoiced', e.state, done);
      if ($('#calPaid')) $('#calPaid').onclick = () => PM.act.setState(e.id, 'paid', e.state, done);
      $('#calPeek').onclick = () => PM.act.peek(e.pid, e.k === 'p' ? 'review' : 'schedule');
    }

    // ----- dropdown filters -----
    let openDd = null;
    function ddHtml(id, label, body) {
      return `<div class="dd" id="${id}"><button type="button" class="dd-btn" aria-haspopup="true" aria-expanded="false">${label}${icon('chev_d')}</button><div class="dd-pop" hidden>${body}</div></div>`;
    }
    function projLabel() {
      const n = sel.size;
      const dots = [...sel].slice(0, 4).map((id) => `<i class="dd-dot" style="background:${color[id]}"></i>`).join('');
      const txt = n === projects.length ? t('cal_all_projects') : n === 0 ? t('cal_no_projects') : n === 1 ? esc(pname[[...sel][0]].name) : t('cal_n_projects', { n });
      return `<span class="dd-dots">${dots}</span><span class="dd-txt">${txt}</span>`;
    }
    function typeLabel() {
      const n = types.size;
      return `<span class="dd-txt">${n === TYPES.length ? t('cal_all_types') : n === 0 ? t('cal_no_types') : n === 1 ? typeName([...types][0]) : t('cal_n_types', { n })}</span>`;
    }
    function projBody(q) {
      const list = projects.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
      return list.map((p) => `<label class="dd-opt"><input type="checkbox" data-p="${p.id}" ${sel.has(p.id) ? 'checked' : ''}><i class="dd-dot" style="background:${color[p.id]}"></i><span class="grow">${esc(p.name)}</span><button type="button" class="dd-only" data-only-p="${p.id}">${t('cal_only')}</button></label>`).join('') || `<div class="small muted" style="padding:8px 10px">${t('cal_no_match')}</div>`;
    }
    const typeBody = () => TYPES.map((k) => `<label class="dd-opt"><input type="checkbox" data-t="${k}" ${types.has(k) ? 'checked' : ''}><span class="mk-s-wrap">${k === 'payment' ? `<span class="mk-s pay">${icon('coin')}</span>` : `<i class="mk-s ${k}"></i>`}</span><span class="grow">${typeName(k)}</span><button type="button" class="dd-only" data-only-t="${k}">${t('cal_only')}</button></label>`).join('');

    function closeDd() { if (!openDd) return; const p = $('.dd-pop', openDd), b = $('.dd-btn', openDd); p.hidden = true; b.setAttribute('aria-expanded', 'false'); openDd = null; }
    function toggleDd(box) { if (openDd === box) return closeDd(); closeDd(); openDd = box; $('.dd-pop', box).hidden = false; $('.dd-btn', box).setAttribute('aria-expanded', 'true'); const s = $('.dd-search', box); if (s) s.focus(); }
    function renderBtns() { const a = $('#ddProj .dd-btn'), b = $('#ddType .dd-btn'); a.innerHTML = projLabel() + icon('chev_d'); b.innerHTML = typeLabel() + icon('chev_d'); }
    function persist() { store.set('pm_cal_sel', [...sel]); store.set('pm_cal_types', [...types]); store.set('pm_cal_over', overOnly); }
    function refreshProjList() { $('#ddProjList').innerHTML = projBody($('#ddProj .dd-search').value); }
    function refreshTypeList() { $('#ddTypeList').innerHTML = typeBody(); }

    $('#content').innerHTML = `<div class="page"><div class="page-head"><h1>${t('nav_calendar')}</h1><div class="row" style="gap:8px">
        <button class="btn icon" id="calPrev" aria-label="${t('cal_prev')}">${icon(S.lang === 'ar' ? 'chev_r' : 'chev_l')}</button><button class="btn" id="calToday">${t('cal_today')}</button><button class="btn icon" id="calNext" aria-label="${t('cal_next')}">${icon(S.lang === 'ar' ? 'chev_l' : 'chev_r')}</button>
        <label class="cal-pick"><span class="cal-month" id="calMonth"></span><input type="month" id="calMonthPick" aria-label="${t('cal_pick')}"></label></div></div>
      <div class="card cal-filters"><div class="row wrap" style="gap:10px">
        <div class="cal-f"><span class="small muted">${t('cal_projects')}</span>${ddHtml('ddProj', '', `<div class="dd-tools"><input type="search" class="dd-search" placeholder="${esc(t('cal_search'))}" aria-label="${esc(t('cal_search'))}"><button type="button" class="btn sm ghost" id="calAll">${t('cal_all')}</button><button type="button" class="btn sm ghost" id="calNone">${t('cal_none')}</button></div><div class="dd-list" id="ddProjList"></div>`)}</div>
        <div class="cal-f"><span class="small muted">${t('cal_types')}</span>${ddHtml('ddType', '', `<div class="dd-tools"><button type="button" class="btn sm ghost" id="calAllT">${t('cal_all')}</button><button type="button" class="btn sm ghost" id="calNoneT">${t('cal_none')}</button></div><div class="dd-list" id="ddTypeList"></div>`)}</div>
        <button type="button" class="cal-tog" id="calOver" aria-pressed="false">${icon('alert')}${t('cal_overdue')}</button>
        <span class="grow"></span><span class="small muted" id="calCount"></span></div></div>
      <div class="cal-layout"><div class="card cal"><div class="cal-head">${Array.from({ length: 7 }, (_, i) => `<div>${wk(i)}</div>`).join('')}</div><div id="calGrid" class="cal-grid"></div>
        <div class="cal-legend small muted">${TYPES.map((k) => `<span class="cal-lg">${k === 'payment' ? `<span class="mk-s pay">${icon('coin')}</span>` : `<i class="mk-s ${k}"></i>`}${typeName(k)}</span>`).join('')}<span class="cal-lg"><i class="mk-s task late"></i>${t('cal_overdue')}</span></div></div>
        <aside class="card cal-side" id="calSide" aria-live="polite"></aside></div></div>`;

    refreshProjList(); refreshTypeList();
    const go = (dm) => { month += dm; while (month < 0) { month += 12; year--; } while (month > 11) { month -= 12; year++; } dir = dm; render(); };
    $('#calPrev').onclick = () => go(-1); $('#calNext').onclick = () => go(1);
    $('#calToday').onclick = () => { const f = new Date(data.today.slice(0, 7) + '-01T00:00:00Z'); dir = (f.getUTCFullYear() * 12 + f.getUTCMonth()) - (year * 12 + month); year = f.getUTCFullYear(); month = f.getUTCMonth(); render(); };
    $('#calMonthPick').onchange = (e) => { const v = e.target.value; if (!/^\d{4}-\d{2}$/.test(v)) return; const ny = +v.slice(0, 4), nm = +v.slice(5) - 1; dir = (ny * 12 + nm) - (year * 12 + month); year = ny; month = nm; render(); };
    $$('.dd-btn').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleDd(b.parentElement); }));
    $$('.dd-pop').forEach((p) => p.addEventListener('click', (e) => e.stopPropagation()));
    $('#ddProj .dd-search').oninput = refreshProjList;
    $('#ddProjList').onchange = (e) => { const id = Number(e.target.dataset.p); if (!id) return; e.target.checked ? sel.add(id) : sel.delete(id); persist(); render(); };
    $('#ddProjList').onclick = (e) => { const b = e.target.closest('[data-only-p]'); if (!b) return; e.preventDefault(); sel.clear(); sel.add(Number(b.dataset.onlyP)); persist(); refreshProjList(); render(); };
    $('#ddTypeList').onchange = (e) => { const k = e.target.dataset.t; if (!k) return; e.target.checked ? types.add(k) : types.delete(k); persist(); render(); };
    $('#ddTypeList').onclick = (e) => { const b = e.target.closest('[data-only-t]'); if (!b) return; e.preventDefault(); types.clear(); types.add(b.dataset.onlyT); persist(); refreshTypeList(); render(); };
    $('#calAll').onclick = () => { projects.forEach((p) => sel.add(p.id)); persist(); refreshProjList(); render(); };
    $('#calNone').onclick = () => { sel.clear(); persist(); refreshProjList(); render(); };
    $('#calAllT').onclick = () => { TYPES.forEach((k) => types.add(k)); persist(); refreshTypeList(); render(); };
    $('#calNoneT').onclick = () => { types.clear(); persist(); refreshTypeList(); render(); };
    $('#calOver').onclick = () => { overOnly = !overOnly; persist(); render(); };
    $('#calGrid').addEventListener('click', (e) => {
      const mk = e.target.closest('[data-key]');
      if (mk) { focus = { key: mk.dataset.key }; render(); revealSide(); return; }
      const d = e.target.closest('[data-day]');
      if (d) { focus = { day: d.dataset.day }; render(); revealSide(); }
    });
    $('#calSide').addEventListener('click', (e) => {
      const ag = e.target.closest('.cal-ag');
      if (ag) { focus = { key: ag.dataset.key, fromDay: focus && focus.day }; render(); }
    });
    const revealSide = () => { if (matchMedia('(max-width: 1100px)').matches) $('#calSide').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    const onDoc = (e) => { if (!document.body.contains($('#calGrid'))) { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); document.removeEventListener('pm-peek-close', onPeek); return; } if (openDd && !openDd.contains(e.target)) closeDd(); };
    const onKey = (e) => { if (e.key === 'Escape' && openDd) { const b = $('.dd-btn', openDd); closeDd(); b.focus(); } };
    const onPeek = async () => { if (!document.body.contains($('#calGrid'))) return; await load(); all = build(); render(); };
    document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); document.addEventListener('pm-peek-close', onPeek);
    document.onkeydown = null;
    render();
  };

  // keep the calendar route and nav in sync with the router
  const prevRoute = PM.routeExtras || {};
  PM.routeExtras = Object.assign(prevRoute, { calendar: () => PM.views.calendar() });
})();
