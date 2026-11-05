/* In place actions (PM.act) and the project overview dashboards. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, busy, state: S } = PM;
  const H = () => PM.dash.h;
  const money = (n, c) => PM.money(n, c);

  // ================= in place actions =================
  async function undoable(msg, doFn, undoFn, done) {
    try { await doFn(); } catch (e) { toast(e.message, 'err'); return; }
    toast(msg, 'ok', { label: t('g_undo'), fn: async () => { try { await undoFn(); } catch (e) { toast(e.message, 'err'); } done && done(); } });
    done && done();
  }
  const setState = (itemId, state, prev, done) => undoable(t('radar_updated'), () => api('PUT', `/api/items/${itemId}`, { state }), () => api('PUT', `/api/items/${itemId}`, { state: prev }), done);

  function progress(x, done) {
    const m = modal({
      title: t('ra_update'),
      body: `<p class="muted" style="margin-top:0"><b>${esc(x.title)}</b><br>${esc(x.project || '')}</p><div class="row" style="gap:12px"><input type="range" id="paRange" min="0" max="100" step="5" value="${x.progress || 0}" style="flex:1"><b id="paVal" style="min-width:44px;text-align:end">${x.progress || 0}%</b></div>`,
      footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn" id="paDone">${t('ra_done100')}</button><button class="btn primary" id="paSave">${t('save')}</button>`,
    });
    const r = m.$('#paRange');
    r.oninput = () => (m.$('#paVal').textContent = r.value + '%');
    const apply = async (val) => {
      m.close();
      const chg = { [x.task_id]: { progress: val } };
      let ops = [];
      if (val >= 100 && (x.progress || 0) < 100) { ops = await completion.flow(x.project_id, chg, null, x.currency); if (ops === null) return; }
      undoable(t('radar_updated'),
        async () => { await api('POST', `/api/projects/${x.project_id}/schedule/apply`, { changes: chg }); await completion.commit(ops); },
        async () => { await api('POST', `/api/projects/${x.project_id}/schedule/apply`, { changes: { [x.task_id]: { progress: x.progress || 0 } } }); await completion.revert(ops); }, done);
    };
    m.$('#paSave').onclick = () => apply(Number(r.value));
    m.$('#paDone').onclick = () => apply(100);
  }

  // report: pick the output format first, then the type, create it, download it in that same format
  async function report(pid) {
    const types = (await api('GET', '/api/doc-types')).types.filter((x) => x.progress);
    const F = { docx: ['Word', 'file', 'out_word', 'out_hint_docx'], xlsx: ['Excel', 'grid', 'out_excel', 'out_hint_xlsx'], pptx: ['PowerPoint', 'chart', 'out_ppt', 'out_hint_pptx'] };
    let out = sessionStorage.getItem('rp_out'); if (!F[out]) out = 'docx';
    const m = modal({
      title: t('ra_report'),
      body: `<div class="form-grid"><div class="fmt-pick full"><span class="lbl" id="prOutL">${t('doc_output')}</span><div class="seg" id="prSeg" role="radiogroup" aria-labelledby="prOutL"></div><div class="small muted" id="prHint"></div></div>
        <label class="f full">${t('doc_type')}<select id="prType">${types.map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select></label></div>`,
      footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="prGo">${icon('spark')}${t('generate')}</button>`,
    });
    const drawSeg = () => {
      m.$('#prSeg').innerHTML = Object.keys(F).map((k) => `<button type="button" role="radio" aria-checked="${out === k}" class="${out === k ? 'on' : ''}" data-fmt="${k}" data-tip="${esc(t(F[k][2]))}">${icon(F[k][1])}${F[k][0]}</button>`).join('');
      m.$('#prHint').textContent = t(F[out][3]);
      m.$('#prGo').lastChild.textContent = t('generate');
      m.el.querySelectorAll('[data-fmt]').forEach((b) => (b.onclick = () => { out = b.dataset.fmt; sessionStorage.setItem('rp_out', out); drawSeg(); }));
    };
    drawSeg();
    m.$('#prGo').onclick = async () => {
      const ty = m.$('#prType').value;
      const ok = await busy(m.$('#prGo'), async () => {
        const r = await api('POST', `/api/projects/${pid}/generate`, { type: ty, format: out, as_of: PM.today(), period_days: ty === 'progress_biweekly' ? 14 : 7 });
        await PM.downloadGenerated(r.generated.id);
        return true;
      });
      if (!ok) return;
      m.close();
      toast(t('report_ready'), 'ok');
    };
  }

  // side panel: look at or work on any project without leaving the page
  const PEEK_TABS = [['overview', 'chart'], ['schedule', 'cal'], ['review', 'check'], ['inbox', 'inbox'], ['reports', 'spark']];
  let drawer = null;
  async function peek(pid, tab) {
    if (tab === 'attention') tab = 'review';
    if (!PEEK_TABS.some((x) => x[0] === tab)) tab = 'overview';
    if (drawer) drawer.close(true);
    const keep = S.project;
    let p;
    try { p = (await api('GET', `/api/projects/${pid}`)).project; } catch (e) { return toast(e.message, 'err'); }
    const el = document.createElement('div');
    el.className = 'drawer-ov';
    el.innerHTML = `<aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.name)}"><header class="drawer-h"><div class="grow"><div class="drawer-t">${esc(p.name)} ${PM.healthChip(p.stats.health)}</div><div class="small muted">${esc(p.client || '')}</div></div>
      <a class="btn sm ghost" id="dwFull" href="#/p/${pid}/${tab}">${t('open_full_page')}</a><button class="btn ghost icon" data-x aria-label="${esc(t('close'))}">${icon('x')}</button></header>
      <nav class="tabs drawer-tabs">${PEEK_TABS.map(([k, ic]) => `<a class="tab" data-tab="${k}" href="#">${icon(ic)}${t('tab_' + k)}</a>`).join('')}</nav><div class="drawer-b" id="drawerBody"></div></aside>`;
    (document.fullscreenElement || document.body).appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    S.project = p;
    let token = ++S.nav;
    const api2 = {
      close(silent) {
        if (!el.isConnected) return;
        S.nav++; // stop anything still loading into the panel
        S.project = keep; el.remove(); document.removeEventListener('keydown', onKey); drawer = null;
        if (!silent) document.dispatchEvent(new CustomEvent('pm-peek-close'));
      },
    };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.overlay')) api2.close(); };
    document.addEventListener('keydown', onKey);
    el.addEventListener('mousedown', (e) => { if (e.target === el) api2.close(); });
    $('[data-x]', el).onclick = () => api2.close();
    $('#dwFull', el).onclick = () => { api2.close(true); };
    drawer = api2;
    async function show(k) {
      tab = k; token = ++S.nav;
      $$('.drawer-tabs .tab', el).forEach((a) => a.classList.toggle('active', a.dataset.tab === k));
      $('#dwFull', el).setAttribute('href', `#/p/${pid}/${k}`);
      const body = $('#drawerBody', el);
      body.innerHTML = `<div class="empty">${PM.loader.html({ size: 'md' })}</div>`;
      try { p = (await api('GET', `/api/projects/${pid}`)).project; S.project = p; } catch { /* keep the last copy */ }
      const view = PM.views['tab_' + k];
      try { await view(body, p, new URLSearchParams(), token, { nav: show, embedded: true }); } catch (e) { console.error(e); body.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
    }
    $$('.drawer-tabs .tab', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); show(a.dataset.tab); }));
    show(tab);
  }

  // ================= completion links =================
  // Finishing a task can finish what it delivers: close a deliverable, invoice a payment, mitigate a risk.
  const completion = {
    impact(data, changes) {
      const tasks = new Map(data.tasks.map((x) => [x.id, x]));
      const items = new Map((data.items || []).map((i) => [i.id, i]));
      const done = (id) => { const c = changes[id], tk = tasks.get(id); return c && 'progress' in c ? c.progress >= 100 : !!(tk && (tk.progress || 0) >= 100); };
      const finishing = Object.keys(changes).map(Number).filter((id) => { const tk = tasks.get(id); return tk && !tk.summary && changes[id].progress >= 100 && (tk.progress || 0) < 100; });
      if (!finishing.length) return [];
      const linkIds = (tk) => new Set([...(tk.deliverable_id ? [tk.deliverable_id] : []), ...(tk.links || [])]);
      const byItem = new Map();
      for (const tk of data.tasks) if (!tk.summary) for (const id of linkIds(tk)) { if (!byItem.has(id)) byItem.set(id, []); byItem.get(id).push(tk); }
      const allDone = (id) => (byItem.get(id) || []).every((tk) => done(tk.id));
      const touched = new Set(); for (const id of finishing) for (const l of linkIds(tasks.get(id))) touched.add(l);
      const ops = new Map();
      for (const id of touched) {
        const it = items.get(id); if (!it) continue;
        if (it.kind === 'deliverable' && it.state === 'open') ops.set(id, allDone(id) ? { item: it, action: 'close', to: 'closed' } : { item: it, action: 'partial', left: (byItem.get(id) || []).filter((tk) => !done(tk.id)).length });
        else if (it.kind === 'milestone' && it.state === 'pending' && allDone(id)) ops.set(id, { item: it, action: 'invoice', to: 'invoiced' });
        else if (it.kind === 'risk' && it.state === 'open' && allDone(id)) ops.set(id, { item: it, action: 'mitigate', to: 'mitigated', optional: true });
      }
      for (const it of data.items || []) {
        if (it.kind !== 'milestone' || it.state !== 'pending' || ops.has(it.id)) continue;
        const o = it.data && it.data.deliverable_id && ops.get(Number(it.data.deliverable_id));
        if (o && o.action === 'close') ops.set(it.id, { item: it, action: 'invoice', to: 'invoiced', via: o.item.title });
      }
      const rank = { close: 0, invoice: 1, mitigate: 2, partial: 3 };
      return [...ops.values()].sort((a, b) => rank[a.action] - rank[b.action]);
    },
    text(ops, cur) {
      const q = (s) => `&ldquo;${esc(s)}&rdquo;`;
      const part = (o) => t('cm_' + o.action, { title: q(o.item.title) });
      const list = ops.filter((o) => o.action !== 'partial').map(part);
      return list.length > 1 ? `${list.slice(0, -1).join(', ')} ${t('cm_and')} ${list[list.length - 1]}` : list[0] || '';
    },
    // Ask the PM. Resolves to the operations to apply, [] to complete only, or null to cancel.
    ask(ops, names, cur) {
      const act = ops.filter((o) => o.action !== 'partial'), info = ops.filter((o) => o.action === 'partial');
      if (!act.length && !info.length) return Promise.resolve([]);
      return new Promise((resolve) => {
        let answered = false;
        const row = (o, i) => `<label class="cm-row"><input type="checkbox" data-op="${i}" ${o.optional ? '' : 'checked'}><span class="cm-ic">${icon(o.action === 'close' ? 'check' : o.action === 'invoice' ? 'coin' : 'target')}</span><span class="grow"><b>${esc(o.item.title)}</b><span class="small muted"> ${t('cm_' + o.action + '_short')}${o.via ? ` &middot; ${t('cm_via', { title: esc(o.via) })}` : ''}</span></span>${o.item.kind === 'milestone' && o.item.data && o.item.data.amount != null ? `<span class="small">${esc(PM.money(o.item.data.amount, cur))}</span>` : ''}</label>`;
        const m = modal({
          title: t('cm_title'), noBackdropClose: true,
          onClose: () => { if (!answered) resolve(null); },
          body: `<p style="margin-top:0">${act.length ? t(names.length > 1 ? 'cm_lead_many' : 'cm_lead_one', { what: completion.text(ops, cur) }) : t('cm_lead_info')}</p>
            <div class="small muted" style="margin-bottom:8px">${names.slice(0, 3).map(esc).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}</div>
            ${act.map(row).join('')}
            ${info.map((o) => `<div class="cm-info small muted">${icon('alert')} ${t('cm_partial', { title: esc(o.item.title), n: o.left })}</div>`).join('')}`,
          footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn" id="cmOnly">${t('cm_only')}</button>${act.length ? `<button class="btn primary" id="cmGo">${icon('check')}${t('cm_update')}</button>` : ''}`,
        });
        m.$('#cmOnly').onclick = () => { answered = true; resolve([]); m.close(); };
        const go = m.$('#cmGo');
        if (go) { go.onclick = () => { answered = true; resolve(act.filter((o, i) => m.$(`[data-op="${i}"]`).checked)); m.close(); }; go.focus(); } else m.$('#cmOnly').focus();
      });
    },
    // Work out the effect and ask. changes: {taskId: {progress: 100}}
    async flow(pid, changes, data, cur) {
      if (!Object.values(changes).some((c) => c.progress >= 100)) return [];
      data = data || (await api('GET', `/api/projects/${pid}/schedule`));
      const ops = completion.impact(data, changes);
      if (!ops.length) return [];
      const names = Object.keys(changes).filter((id) => changes[id].progress >= 100).map((id) => (data.tasks.find((x) => x.id === Number(id)) || {}).name).filter(Boolean);
      return completion.ask(ops, names, cur);
    },
    commit: (ops) => Promise.all(ops.map((o) => api('PUT', `/api/items/${o.item.id}`, { state: o.to }))),
    revert: (ops) => Promise.all(ops.map((o) => api('PUT', `/api/items/${o.item.id}`, { state: o.item.state }))),
    summary: (ops) => completion.text(ops),
  };
  PM.completion = completion;
  PM.act = { undoable, setState, progress, report, peek };

  // ================= project dashboard widgets =================
  const SRC = { teams: 'chat', email: 'mail', jira: 'jira', upload: 'file', manual: 'edit' };
  const stateTone = (s) => (s === 'paid' || s === 'closed' ? 'green' : s === 'invoiced' ? 'blue' : '');
  const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString(S.lang === 'ar' ? 'ar-AE' : 'en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const short = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)));
  const W = () => Math.max(300, Math.min(1600, Math.round(H().width())));
  const nice = (max) => { const p = Math.pow(10, Math.floor(Math.log10(max || 1))); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  const PW = {
    pkpi: {
      size: 'l', title: 'pw_kpi',
      render(body, d) {
        const a = d.analytics.projects[0] || {}, S0 = d.paymentSums, cur = d.project.currency;
        const high = d.radar.counts.high;
        const tiles = [
          { k: 'progress', v: a.progress != null ? a.progress + '%' : '-', n: a.progress, suffix: '%', sub: a.planned != null ? t('planned') + ' ' + a.planned + '%' : t('no_baseline'), tone: a.progress != null && a.planned != null ? (a.progress >= a.planned - 2 ? 'good' : a.progress >= a.planned - 10 ? 'warn' : 'bad') : '' },
          { k: 'spi', v: a.spi != null ? a.spi.toFixed(2) : '-', sub: t('kpi_spi_hint'), tone: a.spi == null ? '' : a.spi >= 0.95 ? 'good' : a.spi >= 0.8 ? 'warn' : 'bad' },
          { k: 'pk_critical', v: d.criticalOpen, n: d.criticalOpen, sub: t('pk_of_n', { n: d.criticalTotal }), tone: '' },
          { k: 'pk_late', v: d.status.late, n: d.status.late, sub: t('tasks_n', { n: d.taskCount }), tone: d.status.late ? 'bad' : 'good' },
          { k: 'kpi_high_risks', v: high, n: high, sub: t('kpi_of_signals', { n: d.radar.items.length }), tone: high ? 'bad' : 'good' },
          { k: 'pk_collected', v: d.project.value ? Math.round((S0.paid / (S0.total || 1)) * 100) + '%' : '-', n: d.project.value ? Math.round((S0.paid / (S0.total || 1)) * 100) : null, suffix: '%', sub: money(S0.paid, cur), tone: '' },
        ];
        body.innerHTML = `<div class="kpis">${tiles.map((x, i) => `<div class="kpi-t ${x.tone}" style="--i:${i}"><div class="kv" ${x.n != null ? `data-count="${x.n}" data-suffix="${x.suffix || ''}"` : ''}>${x.v}</div><div class="kl">${esc(t(x.k))}</div><div class="ks small muted">${esc(x.sub)}</div></div>`).join('')}</div>`;
        return { csv: () => [[t('metric'), t('value')], ...tiles.map((x) => [t(x.k), x.v])] };
      },
    },

    pradar: {
      size: 'l', title: 'radar_title',
      render(body, d, ctx) {
        PM.radar.mount(body, d.radar, { single: true, fetch: async () => (await ctx.reloadExcept('pradar')).radar });
        return { csv: () => [[t('severity'), t('type'), t('dimension'), t('item'), t('detail'), t('score')], ...d.radar.items.map((x) => [x.sev, x.type, x.dim, x.title, PM.radar.describe(x), x.score])] };
      },
    },

    pstatus: {
      size: 's', title: 'pw_status',
      render(body, d) {
        const s = d.status, h = H();
        if (!d.taskCount) { body.innerHTML = h.empty(t('no_tasks_hint')); return { csv: () => [] }; }
        const parts = [{ v: s.done, cls: 'ok', label: t('g_l_done') }, { v: s.active, cls: 'c1', label: t('pw_active') }, { v: s.todo, cls: 'idle', label: t('pw_todo') }, { v: s.late, cls: 'bad', label: t('late') }];
        body.innerHTML = `<div class="donut-wrap">${h.donut(parts, h.num(d.taskCount), t('tasks'))}${h.legend(parts.map((p) => [p.cls, p.label, p.v]))}</div>`;
        return { csv: () => [[t('status'), t('count')], ...parts.map((p) => [p.label, p.v])] };
      },
    },

    pphases: {
      size: 'm', title: 'phases',
      render(body, d) {
        const h = H();
        if (!d.phases.length) { body.innerHTML = h.empty(t('no_tasks_hint')); return { csv: () => [] }; }
        const rows = d.phases.slice(0, 14).map((x) => ({ label: x.name, sub: `${x.start} ${t('to')} ${x.finish}`, segs: [{ v: x.progress, cls: x.progress >= 100 ? 'ok' : 'c1' }], max: 100, valueLabel: x.progress + '%', tipHtml: `<b>${esc(x.name)}</b><br>${x.start} ${t('to')} ${x.finish}<br>${x.progress}%` }));
        body.innerHTML = h.hbars(rows, { max: 100, rowH: 38, labelW: 190, aria: t('phases') });
        return { csv: () => [[t('phase'), t('start'), t('finish'), t('progress')], ...d.phases.map((x) => [x.name, x.start, x.finish, x.progress])] };
      },
    },

    pscurve: {
      size: 'l', title: 'pw_scurve',
      render(body, d) {
        const c = d.curve, h = H();
        if (!c) { body.innerHTML = h.empty(t('no_tasks_hint')); return { csv: () => [] }; }
        const Wd = W(), Ht = 230, L = 38, R = 16, T = 14, B = 28, pw = Wd - L - R, ph = Ht - T - B;
        const lo = h.dnum(c.min), hi = h.dnum(c.max), x = (s) => L + ((h.dnum(s) - lo) / Math.max(hi - lo, 1)) * pw, y = (v) => T + ph - (v / 100) * ph;
        const line = c.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.planned).toFixed(1)}`).join(' ');
        const area = `${line} L${x(c.points[c.points.length - 1].d)} ${y(0)} L${x(c.points[0].d)} ${y(0)} Z`;
        const tx = Math.min(Math.max(x(c.today), L), L + pw), gap = Math.round((c.actual - c.plannedToday) * 10) / 10;
        let g = [0, 25, 50, 75, 100].map((v) => `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('');
        const steps = 5;
        for (let i = 0; i <= steps; i++) { const dn = lo + ((hi - lo) * i) / steps, s = h.ymd(Math.round(dn)); g += `<text x="${L + (pw * i) / steps}" y="${Ht - 8}" text-anchor="${i === 0 ? 'start' : i === steps ? 'end' : 'middle'}">${new Date(s + 'T00:00:00Z').toLocaleDateString(S.lang === 'ar' ? 'ar-AE' : 'en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>`; }
        g += `<path class="sc-area" d="${area}"/><path class="sc-line" d="${line}"/>`;
        // actual progress so far: a rising line from the start to today
        g += `<path class="sc-act" d="M${x(c.min)} ${y(0)} L${tx} ${y(c.actual)}"/>`;
        g += `<line class="tl-today" x1="${tx}" x2="${tx}" y1="${T}" y2="${T + ph}"/>`;
        g += `<circle class="sc-dot plan" cx="${tx}" cy="${y(c.plannedToday)}" r="5"/><circle class="sc-dot act" cx="${tx}" cy="${y(c.actual)}" r="6"/>`;
        g += c.points.map((p) => `<circle class="hit-dot" cx="${x(p.d)}" cy="${y(p.planned)}" r="9" ${PM.dash.h.tipAttr(`<b>${p.d}</b><br>${t('planned')} ${p.planned}%`)}/>`).join('');
        body.innerHTML = `<svg class="viz scurve" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(t('pw_scurve'))}">${g}</svg>${h.legend([['c1 line', t('planned')], ['ok', t('progress') + ' ' + c.actual + '%'], ['mark', t('g_today')]])}<div class="small muted mt">${gap >= 0 ? t('pw_ahead', { n: gap }) : t('pw_behind', { n: -gap })}</div>`;
        return { csv: () => [[t('date'), t('planned')], ...c.points.map((p) => [p.d, p.planned])] };
      },
    },

    pcritical: {
      size: 'm', title: 'pw_critical',
      render(body, d, ctx) {
        const h = H();
        if (!d.critical.length) { body.innerHTML = h.empty(t('pw_no_critical')); return { csv: () => [] }; }
        body.innerHTML = `<div class="small muted" style="margin-bottom:6px">${t('pk_of_n', { n: d.criticalTotal })} · ${t('pw_open_n', { n: d.criticalOpen })}</div>` + d.critical.map((x, i) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.name)}${x.milestone ? ' ◆' : ''}</div><div class="small muted">${x.start} ${t('to')} ${x.finish}${x.assignee ? ` · ${esc(x.assignee)}` : ''}</div>${x.progress < 100 ? `<div class="row qa"><button class="btn sm ${x.late ? 'good' : ''}" data-cp="${i}">${t('ra_update')}</button></div>` : ''}</div><div class="right"><div class="${x.late ? 'bad-txt' : ''}">${x.progress}%</div>${x.late ? `<div class="small bad-txt">${t('late')}</div>` : ''}</div></div>`).join('');
        $$('[data-cp]', body).forEach((b) => (b.onclick = () => { const x = d.critical[Number(b.dataset.cp)]; progress({ project_id: d.project.id, task_id: x.id, title: x.name, project: d.project.name, progress: x.progress }, () => ctx.reload()); }));
        return { csv: () => [[t('g_task'), t('start'), t('finish'), t('progress'), t('g_owner')], ...d.critical.map((x) => [x.name, x.start, x.finish, x.progress, x.assignee || ''])] };
      },
    },

    pdeliv: {
      size: 'm', title: 'deliverables',
      render(body, d, ctx) {
        const h = H(), D = d.deliverables, closed = D.filter((x) => x.state === 'closed').length;
        if (!D.length) { body.innerHTML = h.empty(); return { csv: () => [] }; }
        const parts = [{ v: closed, cls: 'ok', label: t('state_closed') }, { v: D.filter((x) => x.state !== 'closed' && !x.late).length, cls: 'idle', label: t('state_open') }, { v: D.filter((x) => x.late).length, cls: 'bad', label: t('late') }];
        body.innerHTML = `<div class="donut-row">${h.donut(parts, `${closed}/${D.length}`, t('deliverables'))}${h.legend(parts.map((p) => [p.cls, p.label, p.v]))}</div>${D.map((x) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.title)}</div><div class="small muted">${x.due || ''}${x.late ? ` <span class="bad-txt">(${t('late')})</span>` : ''}</div></div><button class="btn sm ${x.state === 'closed' ? 'ghost' : 'good'}" data-dl="${x.id}" data-to="${x.state === 'closed' ? 'open' : 'closed'}" data-from="${x.state}">${x.state === 'closed' ? t('reopen') : t('ra_close')}</button></div>`).join('')}`;
        $$('[data-dl]', body).forEach((b) => (b.onclick = () => setState(Number(b.dataset.dl), b.dataset.to, b.dataset.from, () => ctx.reload())));
        return { csv: () => [[t('deliverables'), t('due_date'), t('col_state')], ...D.map((x) => [x.title, x.due || '', x.state])] };
      },
    },

    ppay: {
      size: 'm', title: 'payment_milestones',
      render(body, d, ctx) {
        const h = H(), P = d.payments, cur = d.project.currency, s = d.paymentSums;
        if (!P.length) { body.innerHTML = h.empty(); return { csv: () => [] }; }
        const bar = [['ok', 'paid', t('state_paid')], ['c1', 'invoiced', t('state_invoiced')], ['idle', 'pending', t('state_pending')], ['bad', 'late', t('late')]];
        body.innerHTML = `<div class="stackbar" role="img" aria-label="${esc(t('payment_milestones'))}">${bar.map(([c, k]) => (s[k] ? `<i class="${c}" style="flex:${s[k]}" ${h.tipAttr(`${t(k === 'late' ? 'late' : 'state_' + k)}: ${money(s[k], cur)}`)}></i>` : '')).join('')}</div>${h.legend(bar.map(([c, k, l]) => [c, l, money(s[k], cur)]))}` + P.map((x) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.title)}</div><div class="small muted">${x.due || ''}${x.percent != null ? ` · ${x.percent}%` : ''}${x.late ? ` <span class="bad-txt">(${t('late')})</span>` : ''}</div>${x.state !== 'paid' ? `<div class="row qa">${x.state === 'pending' ? `<button class="btn sm" data-py="invoiced" data-i="${x.id}" data-prev="${x.state}">${t('state_invoiced')}</button>` : ''}<button class="btn sm good" data-py="paid" data-i="${x.id}" data-prev="${x.state}">${t('ra_paid')}</button></div>` : ''}</div><div class="right"><div>${x.amount ? money(x.amount, cur) : ''}</div><span class="chip ${stateTone(x.state)}">${t('state_' + x.state)}</span></div></div>`).join('');
        $$('[data-py]', body).forEach((b) => (b.onclick = () => setState(Number(b.dataset.i), b.dataset.py, b.dataset.prev, () => ctx.reload())));
        return { csv: () => [[t('milestone'), t('due_date'), t('amount'), t('col_state')], ...P.map((x) => [x.title, x.due || '', x.amount, x.state])] };
      },
    },

    pcash: {
      size: 'l', title: 'pw_cash',
      render(body, d) {
        const h = H(), C = d.cash, cur = d.project.currency;
        if (!C) { body.innerHTML = h.empty(); return { csv: () => [] }; }
        const Wd = W(), Ht = 220, L = 46, R = 12, T = 12, B = 28, pw = Wd - L - R, ph = Ht - T - B;
        const tot = (r) => r.paid + r.invoiced + r.pending + r.late;
        const top = nice(Math.max(1, ...C.months.map(tot))), y = (v) => T + ph - (v / top) * ph;
        const slot = pw / C.months.length, bw = Math.min(46, slot * 0.62);
        let g = [0, 0.5, 1].map((f) => `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${y(top * f)}" y2="${y(top * f)}"/><text x="${L - 6}" y="${y(top * f) + 4}" text-anchor="end">${short(top * f)}</text>`).join('');
        const every = Math.ceil(C.months.length / Math.max(2, Math.floor(pw / 56)));
        C.months.forEach((r, i) => {
          const cx = L + slot * i + slot / 2;
          let acc = 0;
          const segs = [['ok', r.paid], ['c1', r.invoiced], ['idle', r.pending], ['bad', r.late]].filter((s) => s[1] > 0);
          const tipTxt = `<b>${monthLabel(r.m)}</b><br>${t('state_paid')}: ${money(r.paid, cur)}<br>${t('state_invoiced')}: ${money(r.invoiced, cur)}<br>${t('state_pending')}: ${money(r.pending, cur)}<br>${t('late')}: ${money(r.late, cur)}`;
          g += `<g class="cb" ${h.tipAttr(tipTxt)}><rect class="hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ph}"/>`;
          segs.forEach(([c, v], k) => { const y1 = y(acc + v), y0 = y(acc); acc += v; g += `<rect class="hb-seg ${c}" x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(y0 - y1 - (k < segs.length - 1 ? 2 : 0), 1)}" rx="${k === segs.length - 1 ? 4 : 1}"/>`; });
          g += `</g>`;
          if (i % every === 0) g += `<text x="${cx}" y="${Ht - 8}" text-anchor="middle" ${r.m === C.thisMonth ? 'class="cur-m"' : ''}>${monthLabel(r.m)}</text>`;
        });
        const ti = C.months.findIndex((r) => r.m === C.thisMonth);
        if (ti >= 0) g += `<line class="tl-today" x1="${L + slot * ti + slot / 2}" x2="${L + slot * ti + slot / 2}" y1="${T}" y2="${T + ph}"/>`;
        body.innerHTML = `<svg class="viz cashcols" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(t('pw_cash'))}">${g}</svg>${h.legend([['ok', t('state_paid')], ['c1', t('state_invoiced')], ['idle', t('state_pending')], ['bad', t('late')]])}`;
        return { csv: () => [[t('month'), t('state_paid'), t('state_invoiced'), t('state_pending'), t('late')], ...C.months.map((r) => [r.m, r.paid, r.invoiced, r.pending, r.late])] };
      },
    },

    pcum: {
      size: 'm', title: 'pw_cumulative',
      render(body, d) {
        const h = H(), C = d.cash, cur = d.project.currency;
        if (!C) { body.innerHTML = h.empty(); return { csv: () => [] }; }
        const Wd = W(), Ht = 220, L = 46, R = 14, T = 12, B = 28, pw = Wd - L - R, ph = Ht - T - B, n = C.months.length;
        const top = nice(Math.max(1, ...C.months.map((r) => r.cumPlanned))), y = (v) => T + ph - (v / top) * ph, x = (i) => (n === 1 ? L + pw / 2 : L + (pw * i) / (n - 1));
        const path = (k) => C.months.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r[k]).toFixed(1)}`).join(' ');
        let g = [0, 0.5, 1].map((f) => `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${y(top * f)}" y2="${y(top * f)}"/><text x="${L - 6}" y="${y(top * f) + 4}" text-anchor="end">${short(top * f)}</text>`).join('');
        const every = Math.ceil(n / Math.max(2, Math.floor(pw / 56)));
        C.months.forEach((r, i) => { if (i % every === 0) g += `<text x="${x(i)}" y="${Ht - 8}" text-anchor="middle">${monthLabel(r.m)}</text>`; });
        g += `<path class="sc-area" d="${path('cumPlanned')} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z"/><path class="sc-line" d="${path('cumPlanned')}"/><path class="sc-act ok" d="${path('cumReceived')}"/>`;
        g += C.months.map((r, i) => `<circle class="hit-dot" cx="${x(i)}" cy="${y(r.cumPlanned)}" r="9" ${h.tipAttr(`<b>${monthLabel(r.m)}</b><br>${t('planned')}: ${money(r.cumPlanned, cur)}<br>${t('state_paid')}: ${money(r.cumReceived, cur)}`)}/>`).join('');
        const last = C.months[n - 1];
        body.innerHTML = `<svg class="viz scurve" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(t('pw_cumulative'))}">${g}</svg>${h.legend([['c1', t('planned'), money(last.cumPlanned, cur)], ['ok', t('state_paid'), money(last.cumReceived, cur)]])}`;
        return { csv: () => [[t('month'), t('planned'), t('state_paid')], ...C.months.map((r) => [r.m, r.cumPlanned, r.cumReceived])] };
      },
    },

    powners: {
      size: 'm', title: 'w_workload',
      render(body, d) {
        const h = H();
        if (!d.owners.length) { body.innerHTML = h.empty(); return { csv: () => [] }; }
        const rows = d.owners.map((o) => ({ label: o.name || t('unassigned'), sub: t('tasks_n', { n: o.total }), segs: [{ v: o.done, cls: 'ok' }, { v: o.active, cls: 'c1' }, { v: o.todo, cls: 'idle' }, { v: o.late, cls: 'bad' }], tipHtml: `<b>${esc(o.name || t('unassigned'))}</b><br>${t('g_l_done')} ${o.done} · ${t('pw_active')} ${o.active}<br>${t('pw_todo')} ${o.todo} · ${t('late')} ${o.late}` }));
        body.innerHTML = h.hbars(rows, { rowH: 36, aria: t('w_workload') }) + h.legend([['ok', t('g_l_done')], ['c1', t('pw_active')], ['idle', t('pw_todo')], ['bad', t('late')]]);
        return { csv: () => [[t('g_owner'), t('g_l_done'), t('pw_active'), t('pw_todo'), t('late')], ...d.owners.map((o) => [o.name || '', o.done, o.active, o.todo, o.late])] };
      },
    },

    pdecide: {
      size: 's', title: 'pw_decide',
      render(body, d, ctx) {
        const nav = ctx.nav;
        const items = [...d.review.map((x) => ({ ic: 'check', title: x.title, sub: t('kind_' + x.kind) || x.kind, tab: 'review' })), ...d.updates.map((x) => ({ ic: SRC[x.source] || 'mail', title: x.summary, sub: x.sender, tab: 'inbox' }))];
        body.innerHTML = (items.length ? items.map((x, i) => `<div class="list-item"><div class="avatar" style="width:30px;height:30px">${icon(x.ic)}</div><div class="grow"><div style="font-weight:600">${esc(PM.dash.h.trunc(x.title || '', 70))}</div><div class="small muted">${esc(x.sub || '')}</div></div><button class="btn sm good" data-dn="${x.tab}">${t('review_now')}</button></div>`).join('') : PM.dash.h.empty(t('pw_all_clear')));
        $$('[data-dn]', body).forEach((b) => (b.onclick = () => nav(b.dataset.dn)));
        return { csv: () => [[t('item'), t('detail')], ...items.map((x) => [x.title, x.sub])] };
      },
    },

    pactivity: {
      size: 's', title: 'recent_activity',
      render(body, d) {
        const H = PM.dash.h;
        body.innerHTML = d.activity.map((a) => { const [day, hm] = H.stamp(a.ts); return H.listRow({ title: a.summary, meta: esc(a.actor || ''), val: day, sub: hm }); }).join('') || PM.dash.h.empty();
        return { csv: () => [[t('date'), t('user'), t('action')], ...d.activity.map((a) => [a.ts, a.actor, a.summary])] };
      },
    },
  };
  const PORDER = ['pkpi', 'pradar', 'pstatus', 'pdecide', 'pactivity', 'pscurve', 'pcritical', 'pphases', 'pcash', 'ppay', 'pcum', 'pdeliv', 'powners'];

  // ================= the project overview tab =================
  PM.pdash = { widgets: PW, order: PORDER };
  PM.views.tab_overview = async function (root, p, q, token, opts) {
    opts = opts || {};
    const nav = opts.nav || ((tab) => { location.hash = `#/p/${p.id}/${tab}`; });
    const fetchD = () => api('GET', `/api/projects/${p.id}/dashboard`);
    const d = await fetchD();
    if (PM.stale(token)) return;
    const st = d.project.stats || p.stats || {};
    root.innerHTML = `<div class="page"><div class="qa-bar" role="toolbar" aria-label="${esc(t('pw_quick'))}"><span class="qa-lab">${icon('spark')}${t('pw_quick')}</span>
      <button class="btn sm" data-q="schedule">${icon('cal')}${t('ra_schedule')}</button><button class="btn sm" data-q="review">${icon('check')}${t('ra_review')}${st.pendingItems ? `<span class="badge-count">${st.pendingItems}</span>` : ''}</button><button class="btn sm" data-q="inbox">${icon('inbox')}${t('tab_inbox')}${st.pendingInbox ? `<span class="badge-count">${st.pendingInbox}</span>` : ''}</button><button class="btn sm primary" data-q="report">${icon('file')}${t('ra_report')}</button></div><div id="pdHost"></div></div>`;
    $$('[data-q]', root).forEach((b) => (b.onclick = () => (b.dataset.q === 'report' ? report(p.id) : nav(b.dataset.q))));
    const widgets = {};
    const order = PORDER.concat(PM.trends ? PM.trends.ids('project') : []);
    if (PM.trends) Object.assign(PW, PM.trends.wrapped('project'));
    for (const id of order) widgets[id] = { ...PW[id], render: (body, dd, ctx) => PW[id].render(body, dd, Object.assign(Object.create(ctx), { nav })) };
    PM.dash.mount($('#pdHost', root), d, { widgets, order, key: 'proj', always: true, currencyToggle: false, fetch: fetchD });
  };
})();
