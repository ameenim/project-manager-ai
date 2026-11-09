/* Schedule board view (Jira style cards) and the task editor page. */
(function () {
  const { esc, t, icon, $, $$, toast, modal, initials } = window.PM;
  const S = window.PM.state;
  const U = window.GanttUtil;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const STATUSES = ['todo', 'prog', 'done'];
  const noMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const locale = () => (S.lang === 'ar' ? 'ar-AE' : 'en-US');
  const fmt = (s) => (s ? PM.dtf(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z')) : '');
  const longDate = (s) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  // status comes from progress, so there is one source of truth and no new field
  const stOf = (x) => ((x.progress || 0) >= 100 ? 'done' : (x.progress || 0) > 0 ? 'prog' : 'todo');
  const lateDays = (x, today) => (stOf(x) !== 'done' && x.finish && today && x.finish < today ? Math.max(1, U.diff(x.finish, today)) : 0);
  const depKey = (deps) => JSON.stringify((deps || []).map((d) => [d.id, d.type || 'FS', Number(d.lag) || 0]));

  // outline: ordered tasks with WBS numbers, depth and children
  function outline(tasks) {
    const ids = new Set(tasks.map((x) => x.id));
    const kids = new Map();
    for (const x of tasks) {
      const k = x.parent_id && ids.has(x.parent_id) ? x.parent_id : 0;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(x);
    }
    for (const a of kids.values()) a.sort((a, b) => a.position - b.position || a.id - b.id);
    const order = [], wbs = new Map(), depth = new Map();
    const walk = (pid, pre, d) => (kids.get(pid) || []).forEach((x, i) => {
      const w = pre ? `${pre}.${i + 1}` : `${i + 1}`;
      wbs.set(x.id, w); depth.set(x.id, d); order.push(x);
      walk(x.id, w, d + 1);
    });
    walk(0, '', 0);
    return { order, wbs, depth, kids };
  }

  /* ================= Board ================= */
  function Board(host, ctx) {
    const st = ctx.state;
    let drag = null, menu = null, menuFor = null, suppress = false, barSig = '', moving = false, qTimer = 0;

    host.classList.add('bd');
    host.innerHTML = `
      <div class="bd-bar">
        <label class="sf bd-search">${icon('search')}<input type="text" data-f="q" autocomplete="off" placeholder="${esc(t('b_search'))}" aria-label="${esc(t('b_search'))}"></label>
        <select data-f="owner" aria-label="${esc(t('g_owner'))}"></select>
        <select data-f="phase" aria-label="${esc(t('b_phase'))}"></select>
        <button class="btn sm" type="button" data-f="late" aria-pressed="false">${icon('alert')}${esc(t('b_late_only'))}</button>
        <button class="btn sm ghost" type="button" data-f="clear">${esc(t('b_clear'))}</button>
        <button class="btn sm" type="button" data-f="undo" data-tip="${esc(t('g_undo'))}">${icon('undo')}${esc(t('g_undo'))}</button>
        <span class="grow"></span><span class="small muted" data-count></span>
      </div>
      <div class="bd-hint">${esc(t('b_hint_drag'))}</div>
      <div class="bd-cols"></div>`;
    const colsEl = $('.bd-cols', host);

    const label = (s) => t('b_' + s);

    function model() {
      const tasks = ctx.tasks(), today = ctx.today();
      const ol = outline(tasks);
      const by = new Map(tasks.map((x) => [x.id, x]));
      const idx = new Map(ol.order.map((x, i) => [x.id, i]));
      const leaves = ol.order.filter((x) => !x.summary);
      const owners = [...new Set(leaves.map((x) => x.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const phases = ol.order.filter((x) => x.summary);
      let list = leaves;
      if (st.phase) {
        const keep = new Set();
        const walk = (id) => (ol.kids.get(id) || []).forEach((k) => { keep.add(k.id); walk(k.id); });
        walk(Number(st.phase));
        list = list.filter((x) => keep.has(x.id));
      }
      if (st.owner) list = list.filter((x) => (st.owner === '__none' ? !x.assignee : x.assignee === st.owner));
      if (st.late) list = list.filter((x) => lateDays(x, today) > 0);
      if (st.q) {
        const q = st.q.toLowerCase();
        list = list.filter((x) => x.name.toLowerCase().includes(q) || (ol.wbs.get(x.id) || '').startsWith(q) || (x.assignee || '').toLowerCase().includes(q));
      }
      const cols = { todo: [], prog: [], done: [] };
      for (const x of list) cols[stOf(x)].push(x);
      const byStart = (a, b) => (a.start || '').localeCompare(b.start || '') || idx.get(a.id) - idx.get(b.id);
      cols.todo.sort(byStart); cols.prog.sort(byStart);
      cols.done.sort((a, b) => (b.finish || '').localeCompare(a.finish || '') || idx.get(a.id) - idx.get(b.id));
      const path = (x) => {
        const anc = []; let p = by.get(x.parent_id), g = 0;
        while (p && g++ < 40) { anc.unshift(p.name); p = by.get(p.parent_id); }
        return { short: (anc.length > 2 ? '… › ' : '') + anc.slice(-2).join(' › '), full: anc.join(' › ') };
      };
      return { tasks, today, ol, by, cols, owners, phases, path, total: list.length, all: leaves.length };
    }

    function updateBar(m) {
      const sig = JSON.stringify([m.owners, m.phases.map((p) => p.id + p.name)]);
      const own = $('[data-f=owner]', host), ph = $('[data-f=phase]', host);
      if (sig !== barSig) {
        barSig = sig;
        own.innerHTML = `<option value="">${esc(t('b_all_owners'))}</option><option value="__none">${esc(t('b_unassigned'))}</option>` + m.owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
        ph.innerHTML = `<option value="">${esc(t('b_all_phases'))}</option>` + m.phases.map((p) => `<option value="${p.id}">${'  '.repeat(m.ol.depth.get(p.id) || 0)}${esc(m.ol.wbs.get(p.id) + ' ' + p.name)}</option>`).join('');
      }
      own.value = st.owner; ph.value = st.phase;
      const q = $('[data-f=q]', host); if (q.value !== st.q) q.value = st.q;
      const late = $('[data-f=late]', host); late.classList.toggle('on', !!st.late); late.setAttribute('aria-pressed', st.late ? 'true' : 'false');
      $('[data-count]', host).textContent = t('b_count', { n: m.total, of: m.all });
      $('[data-f=undo]', host).disabled = !(ctx.canUndo && ctx.canUndo());
    }

    function cardHtml(x, m) {
      const s = stOf(x), late = lateDays(x, m.today), ms = !!x.is_milestone, p = Math.round(x.progress || 0);
      const path = m.path(x), wbs = m.ol.wbs.get(x.id) || '';
      const dates = ms || !x.finish || x.start === x.finish ? fmt(x.start) : `${fmt(x.start)} – ${fmt(x.finish)}`;
      const chips = [];
      if (ms) chips.push(`<span class="chip violet">${icon('flag')}${esc(t('b_milestone'))}</span>`);
      if (late) chips.push(`<span class="chip red">${icon('alert')}${esc(t('b_late_days', { n: late }))}</span>`);
      if (x.critical && s !== 'done') chips.push(`<span class="chip amber">${esc(t('b_critical'))}</span>`);
      if (x.flag) chips.push(`<span class="chip blue">${icon('pin')}${esc(t('b_highlighted'))}</span>`);
      const deps = (x.deps || []).length;
      const owner = x.assignee
        ? `<span class="avatar" data-tip="${esc(x.assignee)}">${esc(initials(x.assignee))}</span>`
        : `<span class="avatar bd-none" data-tip="${esc(t('b_unassigned'))}">${icon('user')}</span>`;
      return `<article class="bd-card${late ? ' late' : ''}${ms ? ' ms' : ''}" data-id="${x.id}" tabindex="0" role="button" aria-label="${esc(`${wbs} ${x.name}. ${label(s)}${ms ? '' : ', ' + p + '%'}. ${t('b_move_kb')}`)}">
        ${path.full ? `<div class="bd-path" data-tip="${esc(path.full)}">${icon('folder')}<span>${esc(path.short)}</span></div>` : ''}
        <div class="bd-title">${esc(x.name)}</div>
        ${chips.length ? `<div class="bd-chips">${chips.join('')}</div>` : ''}
        ${ms ? '' : `<div class="bd-prog"><div class="progress ${s === 'done' ? 'green' : ''}"><i style="width:${p}%"></i></div><b>${p}%</b></div>`}
        <div class="bd-foot"><span class="bd-wbs">${esc(wbs)}</span><span class="grow">${esc(dates)}</span>${deps ? `<span class="bd-dep" data-tip="${esc(t('predecessors'))}">${icon('link')}${deps}</span>` : ''}${owner}</div>
        <button type="button" class="btn ghost icon bd-more" data-bm data-tip="${esc(t('b_card_menu'))}" aria-label="${esc(t('b_card_menu'))}">${icon('more')}</button>
      </article>`;
    }

    function colHtml(s, m) {
      const arr = m.cols[s], lim = st.limit[s] || 40;
      const shown = arr.slice(0, lim);
      return `<section class="bd-col ${s}" data-st="${s}" aria-label="${esc(label(s))}">
        <header><i class="bd-dot"></i><h4>${esc(label(s))}</h4><span class="chip">${arr.length}</span></header>
        <div class="bd-body">${shown.length ? shown.map((x) => cardHtml(x, m)).join('') : `<div class="bd-empty">${esc(t(m.all ? 'b_empty_' + s : 'b_board_empty'))}</div>`}
        ${arr.length > lim ? `<button type="button" class="btn sm" data-more="${s}">${esc(t('b_show_more', { n: Math.min(40, arr.length - lim) }))}</button>` : ''}</div>
      </section>`;
    }

    function rects() {
      const out = new Map();
      const cards = $$('.bd-card', host);
      if (cards.length > 600) return out;
      for (const el of cards) { const r = el.getBoundingClientRect(); out.set(el.dataset.id, { l: r.left, t: r.top }); }
      return out;
    }
    function flip(prev) {
      if (noMotion() || !prev.size) return;
      for (const el of $$('.bd-card', host)) {
        const o = prev.get(el.dataset.id); if (!o) continue;
        const r = el.getBoundingClientRect(), dx = o.l - r.left, dy = o.t - r.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
      }
    }

    function render() {
      if (!host.isConnected || host.hidden) return;
      const m = model();
      updateBar(m);
      const prev = rects();
      const scrolls = $$('.bd-body', host).map((b) => b.scrollTop), sx = colsEl.scrollLeft;
      colsEl.innerHTML = STATUSES.map((s) => colHtml(s, m)).join('');
      $$('.bd-body', host).forEach((b, i) => { b.scrollTop = scrolls[i] || 0; });
      colsEl.scrollLeft = sx;
      flip(prev);
      if (st.hl) {
        const el = $(`.bd-card[data-id="${st.hl}"]`, host);
        if (el) { el.classList.add('bd-hl'); setTimeout(() => el.classList.remove('bd-hl'), 1300); }
        st.hl = null;
      }
      if (st.focusId) {
        const el = $(`.bd-card[data-id="${st.focusId}"]`, host);
        if (el) el.focus({ preventScroll: true });
        st.focusId = null;
      }
    }

    const taskOf = (id) => ctx.tasks().find((x) => x.id === Number(id));

    /* ----- progress prompt when work starts ----- */
    function askProgress(task, from) {
      return new Promise((resolve) => {
        let answered = false;
        const cur = from === 'done' ? 90 : 10;
        const m = modal({
          title: t('b_progress_title'), noBackdropClose: true,
          onClose: () => { if (!answered) resolve(null); },
          body: `<p style="margin-top:0"><b>${esc(task.name)}</b></p>
            <p class="muted">${esc(t(from === 'done' ? 'b_progress_reopen' : 'b_progress_intro'))}</p>
            <div class="te-prog"><input type="range" id="bp_r" min="1" max="99" value="${cur}" aria-label="${esc(t('progress'))}"><label class="te-num"><input type="number" id="bp_n" min="1" max="99" value="${cur}" aria-label="${esc(t('progress'))}"><span>%</span></label></div>
            <div class="te-quick" style="margin-top:12px">${[10, 25, 50, 75].map((v) => `<button type="button" class="btn sm" data-v="${v}">${v}%</button>`).join('')}</div>
            <div class="te-err" id="bp_err" role="alert" hidden></div>`,
          footer: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="bpOk">${icon('check')}${esc(t('b_start_work'))}</button>`,
        });
        const r = m.$('#bp_r'), n = m.$('#bp_n');
        r.oninput = () => { n.value = r.value; m.$('#bp_err').hidden = true; };
        n.oninput = () => { const v = Number(n.value); if (v >= 1 && v <= 99) r.value = v; };
        m.$$('[data-v]').forEach((b) => (b.onclick = () => { r.value = b.dataset.v; n.value = b.dataset.v; }));
        const go = () => {
          const v = Math.round(Number(n.value));
          if (!(v >= 1 && v <= 99)) { const e = m.$('#bp_err'); e.textContent = t('b_progress_range'); e.hidden = false; n.focus(); return; }
          answered = true; resolve(v); m.close();
        };
        m.$('#bpOk').onclick = go;
        m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        setTimeout(() => { n.focus(); n.select(); }, 40);
      });
    }

    async function moveTask(task, to, byKeyboard) {
      if (moving) return;
      const from = stOf(task);
      if (to === from) return;
      if (task.is_milestone && to === 'prog') { toast(t('b_ms_rule')); return; }
      moving = true;
      try {
        let progress;
        if (to === 'todo') progress = 0;
        else if (to === 'done') progress = 100;
        else { progress = await askProgress(task, from); if (progress == null) return; }
        st.hl = task.id;
        if (byKeyboard) st.focusId = task.id;
        await ctx.commit({ [task.id]: { progress } }, { label: 'progress' });
        const now = taskOf(task.id);
        if (now && (now.progress || 0) === progress) toast(t('b_moved', { name: task.name, to: label(to) }), 'ok', { label: t('g_undo'), fn: () => ctx.undo() });
        else { st.hl = null; st.focusId = null; }
      } finally { moving = false; }
    }

    /* ----- card menu ----- */
    function closeMenu() {
      if (!menu) return;
      menu.remove(); menu = null; menuFor = null;
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onMenuKey, true);
    }
    function onDocDown(e) { if (menu && !menu.contains(e.target) && !e.target.closest('[data-bm]')) closeMenu(); }
    function onMenuKey(e) {
      if (!menu) return;
      if (e.key === 'Escape') { e.stopPropagation(); const id = menuFor; closeMenu(); const c = $(`.bd-card[data-id="${id}"]`, host); if (c) c.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const b = $$('button', menu), i = b.indexOf(document.activeElement);
        b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
      }
    }
    function openMenu(card, btn) {
      const id = Number(card.dataset.id);
      if (menu && menuFor === id) { closeMenu(); return; }
      closeMenu();
      const task = taskOf(id); if (!task) return;
      const cur = stOf(task);
      menu = document.createElement('div');
      menu.className = 'bd-menu'; menu.setAttribute('role', 'menu'); menuFor = id;
      menu.innerHTML = `<button type="button" role="menuitem" data-act="edit">${icon('edit')}${esc(t('g_edit'))}</button><div class="bd-menu-h">${esc(t('b_move_to'))}</div>`
        + STATUSES.filter((s) => s !== cur && !(task.is_milestone && s === 'prog')).map((s) => `<button type="button" role="menuitem" data-act="${s}"><i class="bd-dot ${s}"></i>${esc(label(s))}</button>`).join('');
      (document.fullscreenElement || document.body).appendChild(menu);
      const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
      const left = S.lang === 'ar' ? r.left : r.right - mw;
      menu.style.left = Math.max(8, Math.min(innerWidth - mw - 8, left)) + 'px';
      menu.style.top = (r.bottom + 4 + mh > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
      menu.onclick = (e) => {
        const b = e.target.closest('button[data-act]'); if (!b) return;
        const a = b.dataset.act; closeMenu();
        if (a === 'edit') ctx.edit(task); else moveTask(task, a, true);
      };
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onMenuKey, true);
      menu.querySelector('button').focus();
    }

    /* ----- drag and drop (pointer events, long press on touch) ----- */
    const colAt = (x, y) => $$('.bd-col', host).find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
    const stopTouch = (e) => { if (drag && drag.started) e.preventDefault(); };
    function place() { drag.ghost.style.transform = `translate(${drag.x - drag.dx}px,${drag.y - drag.dy}px) scale(1.02)`; }
    function updateOver() {
      const c = colAt(drag.x, drag.y);
      $$('.bd-col', host).forEach((el) => {
        const bad = el === c && drag.task.is_milestone && el.dataset.st === 'prog';
        el.classList.toggle('over', el === c && !bad && el.dataset.st !== stOf(drag.task));
        el.classList.toggle('no', bad);
      });
    }
    function loop() {
      if (!drag || !drag.started) return;
      const cr = colsEl.getBoundingClientRect();
      if (drag.x < cr.left + 48) colsEl.scrollLeft -= 16; else if (drag.x > cr.right - 48) colsEl.scrollLeft += 16;
      const c = colAt(drag.x, drag.y), b = c && $('.bd-body', c);
      if (b) { const br = b.getBoundingClientRect(); if (drag.y < br.top + 48) b.scrollTop -= 12; else if (drag.y > br.bottom - 48) b.scrollTop += 12; }
      updateOver();
      drag.raf = requestAnimationFrame(loop);
    }
    function begin() {
      const task = taskOf(drag.id);
      if (!task) { endDrag(); return; }
      drag.task = task; drag.started = true; closeMenu();
      const r = drag.card.getBoundingClientRect();
      drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      const g = drag.card.cloneNode(true);
      g.classList.add('bd-ghost'); g.removeAttribute('data-id'); g.removeAttribute('tabindex'); g.style.width = r.width + 'px';
      (document.fullscreenElement || document.body).appendChild(g);
      drag.ghost = g;
      drag.card.classList.add('bd-dragging'); host.classList.add('bd-drag-on');
      place(); loop();
      window.addEventListener('touchmove', stopTouch, { passive: false });
      window.addEventListener('keydown', onDragKey, true);
    }
    function onDragKey(e) { if (e.key === 'Escape' && drag) { e.stopPropagation(); endDrag(); } }
    function endDrag() {
      const d = drag; drag = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', stopTouch);
      window.removeEventListener('keydown', onDragKey, true);
      if (!d) return;
      clearTimeout(d.timer); cancelAnimationFrame(d.raf);
      if (d.ghost) d.ghost.remove();
      if (d.card) d.card.classList.remove('bd-dragging');
      host.classList.remove('bd-drag-on');
      $$('.bd-col', host).forEach((el) => el.classList.remove('over', 'no'));
    }
    function onMove(e) {
      if (!drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.started) {
        const dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
        if (drag.touch) { if (dist > 10) endDrag(); }
        else if (dist > 5) begin();
        return;
      }
      place();
    }
    function onUp() {
      const d = drag; if (!d) return;
      if (!d.started) { endDrag(); return; }
      const col = colAt(d.x, d.y), task = d.task;
      endDrag();
      suppress = true; setTimeout(() => { suppress = false; }, 80);
      if (col && col.dataset.st !== stOf(task)) moveTask(task, col.dataset.st, false);
    }
    function onCancel() { endDrag(); }

    host.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const card = e.target.closest('.bd-card');
      if (!card || e.target.closest('[data-bm]') || drag) return;
      drag = { id: Number(card.dataset.id), card, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, touch: e.pointerType === 'touch', timer: 0, raf: 0 };
      if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.started) begin(); }, 260);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });

    /* ----- clicks, filters, keyboard ----- */
    host.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (f && f.dataset.f === 'late') { st.late = !st.late; render(); return; }
      if (f && f.dataset.f === 'undo') { if (!f.disabled) ctx.undo(); return; }
      if (f && f.dataset.f === 'clear') { st.q = ''; st.owner = ''; st.phase = ''; st.late = false; render(); return; }
      const more = e.target.closest('[data-more]');
      if (more) { st.limit[more.dataset.more] = (st.limit[more.dataset.more] || 40) + 40; render(); return; }
      const bm = e.target.closest('[data-bm]');
      if (bm) { e.stopPropagation(); openMenu(bm.closest('.bd-card'), bm); return; }
      const card = e.target.closest('.bd-card');
      if (card && !suppress) { const task = taskOf(card.dataset.id); if (task) ctx.edit(task); }
    });
    host.addEventListener('input', (e) => {
      if (e.target.matches('[data-f=q]')) { st.q = e.target.value.trim(); clearTimeout(qTimer); qTimer = setTimeout(render, 140); }
    });
    host.addEventListener('change', (e) => {
      if (e.target.matches('[data-f=owner]')) { st.owner = e.target.value; render(); }
      if (e.target.matches('[data-f=phase]')) { st.phase = e.target.value; render(); }
    });
    host.addEventListener('keydown', (e) => {
      if (e.target.matches('[data-f=q]') && e.key === 'Escape' && st.q) { e.target.value = ''; st.q = ''; render(); return; }
      const card = e.target.classList && e.target.classList.contains('bd-card') ? e.target : null;
      if (!card) return;
      const task = taskOf(card.dataset.id); if (!task) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.edit(task); }
      else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const rtl = getComputedStyle(host).direction === 'rtl';
        const dir = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
        const next = STATUSES[STATUSES.indexOf(stOf(task)) + dir];
        if (next) moveTask(task, next, true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const sib = $$('.bd-card', card.closest('.bd-body')), i = sib.indexOf(card), n = sib[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) n.focus();
      }
    });

    return { render };
  }

  /* ================= Task editor ================= */
  function openEditor(tk, ctx) {
    if (!tk) return;
    // old toasts would sit on top of the Save button
    $$('#toasts .toast').forEach((x) => x.remove());
    const data = ctx.data(), tasks = ctx.tasks(), today = data.today;
    const ol = outline(tasks), by = new Map(tasks.map((x) => [x.id, x]));
    const summary = !!tk.summary;
    const anc = []; { let p = by.get(tk.parent_id), g = 0; while (p && g++ < 40) { anc.unshift(p); p = by.get(p.parent_id); } }
    const ancIds = new Set(anc.map((a) => a.id));
    const desc = new Set(); (function walk(id) { (ol.kids.get(id) || []).forEach((k) => { desc.add(k.id); walk(k.id); }); })(tk.id);
    const origMode = tk.mode === 'manual' ? 'manual' : 'auto';
    const w = { progress: Math.round(tk.progress || 0), ms: !!tk.is_milestone, mode: origMode, flag: !!tk.flag, deps: (tk.deps || []).map((d) => ({ id: d.id, type: d.type || 'FS', lag: Number(d.lag) || 0 })) };
    let candMap = new Map();
    const wbsOf = (id) => ol.wbs.get(id) || '?';

    const sec = (id, title, inner) => `<section class="te-sec" aria-labelledby="${id}"><h3 id="${id}">${esc(title)}</h3>${inner}</section>`;
    const statusSec = summary ? '' : sec('te_h_st', t('te_status'), `
      <div class="seg st" role="group" aria-label="${esc(t('te_status'))}">${STATUSES.map((s) => `<button type="button" data-st="${s}">${esc(t('b_' + s))}</button>`).join('')}</div>
      <div class="te-prog"><input type="range" id="et_range" min="0" max="100" step="1" aria-label="${esc(t('progress'))}"><label class="te-num"><input type="number" id="et_prog" min="0" max="100" aria-label="${esc(t('progress'))} %"><span>%</span></label></div>
      <div class="te-quick">${[0, 25, 50, 75, 100].map((v) => `<button type="button" class="btn sm" data-v="${v}">${v}%</button>`).join('')}</div>
      <span class="small faint">${esc(t('te_progress_hint'))}</span>`);
    const schedSec = summary ? '' : sec('te_h_sc', t('te_schedule'), `
      <div class="form-grid">
        <label class="f">${esc(t('start'))}<input type="date" id="et_start" value="${esc(tk.start || '')}"><span class="te-err" id="err_start" role="alert" hidden></span></label>
        <label class="f">${esc(t('duration_days'))}<input type="number" id="et_dur" min="0" value="${tk.duration}"></label>
        <div class="te-fld"><span>${esc(t('te_finish'))}</span><div class="te-ro" id="te_finish"></div></div>
        <div class="te-fld"><span>${esc(t('g_mode'))}</span><div class="seg" id="te_mode" role="group" aria-label="${esc(t('g_mode'))}"><button type="button" data-m="auto">${esc(t('g_mode_auto'))}</button><button type="button" data-m="manual">${esc(t('g_mode_manual'))}</button></div></div>
        <label class="check full"><input type="checkbox" id="et_ms"> ${esc(t('is_milestone'))}</label>
        <span class="small faint full">${esc(t('te_ms_hint'))} ${esc(t('g_mode_hint'))}</span>
      </div>`);
    const predSec = sec('te_h_pr', t('te_preds'), `
      <div id="te_deps" class="te-deps"></div>
      <label class="f">${esc(t('te_add_pred'))}<input type="text" id="te_add" list="te_cands" autocomplete="off" placeholder="${esc(t('te_add_pred_ph'))}"></label><datalist id="te_cands"></datalist>
      <div id="te_succ"></div>`);
    const notesSec = sec('te_h_nt', t('notes'), `<textarea id="et_notes" rows="4" aria-label="${esc(t('notes'))}">${esc(tk.notes || '')}</textarea>`);
    const detailSec = sec('te_h_dt', t('te_details'), `
      <label class="f">${esc(t('g_owner'))}<input type="text" id="et_owner" list="et_res" value="${esc(tk.assignee || '')}"><datalist id="et_res">${(data.resources || []).map((r) => `<option value="${esc(r)}">`).join('')}</datalist></label>
      <label class="f">${esc(t('linked_deliverable'))}<select id="et_deliv"><option value="">${esc(t('none'))}</option>${(data.deliverables || []).map((d) => `<option value="${d.id}" ${tk.deliverable_id === d.id ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="et_flag"> ${esc(t('te_highlight'))}</label>
      ${ctx.linkItems ? `<div class="f full"><button type="button" class="btn" id="etLinks">${icon('link')}${esc(t('g_link_items'))}${ctx.linkCount && ctx.linkCount(tk) ? ` (${ctx.linkCount(tk)})` : ''}</button><span class="small faint">${esc(t('g_link_items_tip'))}</span></div>` : ''}
      ${tk.critical ? `<div class="small" style="color:var(--warning)">${icon('zap')} ${esc(t('te_critical_note'))}</div>` : ''}
      ${tk.b_start ? `<div class="small muted">${esc(t('te_baseline'))}: ${esc(fmt(tk.b_start))} – ${esc(fmt(tk.b_end))}</div>` : ''}
      ${summary ? `<div class="small muted">${esc(fmt(tk.start))} – ${esc(fmt(tk.finish))} · ${Math.round(tk.progress || 0)}%</div>` : ''}`);

    const m = modal({
      title: t('edit_task'), size: 'xl', noBackdropClose: true,
      body: `<div class="te">
        <div class="te-head">
          <div class="te-path">${icon('folder')}<span>${esc(anc.length ? anc.map((a) => a.name).join(' › ') : t('te_top'))}</span><span class="chip">${esc(wbsOf(tk.id))}</span></div>
          <input type="text" id="et_name" class="te-name" value="${esc(tk.name)}" maxlength="200" aria-label="${esc(t('g_task'))}">
          <span class="te-err" id="err_name" role="alert" hidden></span>
          <div class="te-chips" id="te_chips"></div>
        </div>
        ${summary ? `<div class="banner">${icon('alert')}<div>${esc(t('te_summary_note'))}</div></div>` : ''}
        <div class="te-grid"><div class="te-main">${statusSec}${schedSec}${predSec}${notesSec}</div><aside class="te-side">${detailSec}</aside></div>
      </div>`,
      footer: `<button class="btn danger" id="etDel" style="margin-inline-end:auto">${icon('trash')}${esc(t('delete'))}</button><span class="small muted" id="te_dirty" role="status"></span><button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="etOk" data-tip="${esc(t('te_kbd'))}" disabled>${esc(t('save'))}</button>`,
    });
    const $m = (s) => m.$(s);
    if (w.flag) $m('#et_flag').checked = true;
    if (w.ms && !summary) $m('#et_ms').checked = true;

    function renderDeps() {
      $m('#te_deps').innerHTML = w.deps.length ? w.deps.map((d, i) => {
        const x = by.get(d.id);
        return `<div class="te-dep" data-i="${i}"><span class="chip">${esc(wbsOf(d.id))}</span><span class="te-dep-n" data-tip="${esc(x ? x.name : '')}">${esc(x ? x.name : '?')}</span>
          <select data-k="type" aria-label="${esc(t('link_type'))}">${['FS', 'SS', 'FF', 'SF'].map((k) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${k}: ${esc(t('link_' + k))}</option>`).join('')}</select>
          <input type="number" data-k="lag" min="-365" max="365" value="${d.lag}" aria-label="${esc(t('te_lag'))}" data-tip="${esc(t('te_lag'))}">
          <button type="button" class="btn ghost icon" data-rm="${i}" data-tip="${esc(t('te_remove_pred'))}" aria-label="${esc(t('te_remove_pred'))}">${icon('x')}</button></div>`;
      }).join('') : `<p class="small muted" style="margin:0">${esc(t('te_no_preds'))}</p>`;
      const linked = new Set(w.deps.map((d) => d.id));
      const cands = ol.order.filter((x) => x.id !== tk.id && !desc.has(x.id) && !ancIds.has(x.id) && !linked.has(x.id));
      candMap = new Map(cands.map((x) => [`${wbsOf(x.id)} ${x.name}`, x.id]));
      $m('#te_cands').innerHTML = cands.map((x) => `<option value="${esc(wbsOf(x.id) + ' ' + x.name)}"></option>`).join('');
      const succ = ol.order.filter((x) => (x.deps || []).some((d) => d.id === tk.id));
      $m('#te_succ').innerHTML = `<div class="te-fld"><span>${esc(t('te_succ'))}</span>${succ.length ? `<div class="te-chips">${succ.map((x) => `<span class="chip" data-tip="${esc(x.name)}">${esc(wbsOf(x.id))} ${esc(x.name.length > 28 ? x.name.slice(0, 27) + '…' : x.name)}</span>`).join('')}</div>` : `<span class="small faint">${esc(t('te_no_succ'))}</span>`}</div>`;
    }
    function addPred(val) {
      val = (val || '').trim(); if (!val) return;
      let id = candMap.get(val);
      if (!id) { const hit = [...candMap.entries()].find(([k]) => k.split(' ')[0] === val); if (hit) id = hit[1]; }
      if (!id) return;
      w.deps.push({ id, type: 'FS', lag: 0 });
      $m('#te_add').value = '';
      renderDeps(); sync();
    }

    function collect() {
      const ch = {}, err = {};
      const v = (id) => $m('#' + id).value;
      const nm = v('et_name').trim();
      if (!nm) err.name = t('te_name_req'); else if (nm !== tk.name) ch.name = nm;
      if (!summary) {
        const start = v('et_start');
        if (!start) err.start = t('te_start_req'); else if (start !== tk.start) ch.start = start;
        if (w.ms !== !!tk.is_milestone) { ch.is_milestone = w.ms; if (w.ms) ch.duration = 0; else ch.duration = Math.max(1, Number(v('et_dur')) || 1); }
        if (ch.duration === undefined) { const dur = Math.max(0, Math.round(Number(v('et_dur')) || 0)); if (dur !== tk.duration) ch.duration = dur; }
        if (w.progress !== Math.round(tk.progress || 0)) ch.progress = w.progress;
        if (w.mode !== origMode) ch.mode = w.mode;
      }
      if (v('et_owner') !== (tk.assignee || '')) ch.assignee = v('et_owner');
      if (v('et_notes') !== (tk.notes || '')) ch.notes = v('et_notes');
      const dl = v('et_deliv') ? Number(v('et_deliv')) : null;
      if (dl !== (tk.deliverable_id || null)) ch.deliverable_id = dl;
      if (w.flag !== !!tk.flag) ch.flag = w.flag ? 1 : 0;
      if (depKey(w.deps) !== depKey(tk.deps)) ch.deps = w.deps.map((d) => ({ id: d.id, type: d.type, lag: Number(d.lag) || 0 }));
      return { ch, err };
    }

    function sync(skip) {
      let fin = '', late = 0;
      if (!summary) {
        const s = stOf({ progress: w.progress });
        $$('.seg.st button', m.el).forEach((b) => { const on = b.dataset.st === s; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        if (skip !== 'range') $m('#et_range').value = w.progress;
        if (skip !== 'num') $m('#et_prog').value = w.progress;
        $m('#et_range').disabled = w.ms; $m('#et_prog').disabled = w.ms;
        const pb = m.$('.seg.st [data-st=prog]'); pb.disabled = w.ms; if (w.ms) pb.setAttribute('data-tip', t('b_ms_rule')); else pb.removeAttribute('data-tip');
        $$('.te-quick button', m.el).forEach((b) => { b.disabled = w.ms && !['0', '100'].includes(b.dataset.v); });
        $$('#te_mode button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.m === w.mode));
        const dur = $m('#et_dur'); dur.disabled = w.ms;
        const start = $m('#et_start').value, d = w.ms ? 0 : Math.max(0, Number(dur.value) || 0);
        fin = start ? ctx.finishOf(start, d, w.ms) : '';
        $m('#te_finish').textContent = fin ? longDate(fin) : t('none');
        if (fin && w.progress < 100 && fin < today) late = Math.max(1, U.diff(fin, today));
      }
      const chips = [];
      if (summary) chips.push(`<span class="chip blue">${Math.round(tk.progress || 0)}%</span>`);
      else { const s = stOf({ progress: w.progress }); chips.push(`<span class="chip ${s === 'done' ? 'green' : s === 'prog' ? 'blue' : ''}">${esc(t('b_' + s))}${w.ms ? '' : ' · ' + w.progress + '%'}</span>`); }
      if (late) chips.push(`<span class="chip red">${icon('alert')}${esc(t('te_late', { n: late }))}</span>`);
      if (w.ms) chips.push(`<span class="chip violet">${icon('flag')}${esc(t('b_milestone'))}</span>`);
      if (tk.critical) chips.push(`<span class="chip amber">${esc(t('b_critical'))}</span>`);
      $m('#te_chips').innerHTML = chips.join('');
      const dirty = Object.keys(collect().ch).length > 0;
      $m('#etOk').disabled = !dirty;
      const dl = $m('#te_dirty'); dl.textContent = dirty ? t('te_unsaved') : ''; dl.classList.toggle('te-dirty', dirty);
    }
    const setProgress = (v) => {
      v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
      if (w.ms) v = v >= 50 ? 100 : 0;
      w.progress = v; sync();
    };

    m.el.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'et_range') { w.progress = Number(e.target.value); sync('range'); return; }
      if (id === 'et_prog') { if (e.target.value !== '' && !Number.isNaN(Number(e.target.value))) w.progress = Math.max(0, Math.min(100, Math.round(Number(e.target.value)))); sync('num'); return; }
      if (id === 'et_name') $m('#err_name').hidden = true;
      if (id === 'et_start') $m('#err_start').hidden = true;
      const dep = e.target.closest('.te-dep');
      if (dep && e.target.dataset.k === 'lag') { w.deps[Number(dep.dataset.i)].lag = Number(e.target.value) || 0; }
      if (id === 'te_add') return;
      sync();
    });
    m.el.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'et_prog') { sync(); return; }
      if (id === 'te_add') { addPred(e.target.value); return; }
      const dep = e.target.closest('.te-dep');
      if (dep && e.target.dataset.k === 'type') { w.deps[Number(dep.dataset.i)].type = e.target.value; sync(); return; }
      if (id === 'et_ms') {
        w.ms = e.target.checked;
        const dur = $m('#et_dur');
        if (w.ms) { dur.value = 0; w.progress = w.progress >= 50 ? 100 : 0; } else if (!Number(dur.value)) dur.value = 1;
        sync(); return;
      }
      if (id === 'et_flag') { w.flag = e.target.checked; sync(); return; }
      sync();
    });
    m.el.addEventListener('click', (e) => {
      const stb = e.target.closest('.seg.st button[data-st]');
      if (stb && !stb.disabled) {
        const s = stb.dataset.st;
        if (s === 'todo') setProgress(0);
        else if (s === 'done') setProgress(100);
        else { if (w.progress < 1 || w.progress > 99) setProgress(w.progress >= 100 ? 90 : 10); $m('#et_prog').focus(); $m('#et_prog').select(); }
        return;
      }
      const q = e.target.closest('.te-quick button[data-v]'); if (q && !q.disabled) { setProgress(q.dataset.v); return; }
      const md = e.target.closest('#te_mode button[data-m]'); if (md) { w.mode = md.dataset.m; sync(); return; }
      const rm = e.target.closest('[data-rm]'); if (rm) { w.deps.splice(Number(rm.dataset.rm), 1); renderDeps(); sync(); }
    });
    m.el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); const b = $m('#etOk'); if (!b.disabled) b.click(); } });

    $m('#etDel').onclick = () => { m.close(); ctx.del(tk); };
    if ($m('#etLinks')) $m('#etLinks').onclick = () => { m.close(); ctx.linkItems(tk); };
    $m('#etOk').onclick = async () => {
      const r = collect();
      if (r.err.name || r.err.start) {
        if (r.err.name) { const e = $m('#err_name'); e.textContent = r.err.name; e.hidden = false; $m('#et_name').focus(); }
        else { const e = $m('#err_start'); e.textContent = r.err.start; e.hidden = false; $m('#et_start').focus(); }
        return;
      }
      m.close();
      if (Object.keys(r.ch).length) await ctx.commit({ [tk.id]: r.ch }, { label: 'edit' });
    };
    renderDeps(); sync();
    setTimeout(() => { const n = $m('#et_name'); n.focus(); n.select(); }, 40);
  }

  Object.assign(window.PM, { Board, openTaskEditor: openEditor, outline });
})();
