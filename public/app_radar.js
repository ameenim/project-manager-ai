/* Risk radar for the overview dashboard: clickable heat map, ranked list, one click actions. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, modal } = PM;
  const LV = ['Low', 'Medium', 'High'];
  const TYPES = ['risk', 'overdue', 'payment', 'behind', 'forecast', 'review', 'updates'];
  const SEVS = ['high', 'med', 'low'];

  // where an item sits on the heat map: risks use their own rating, live problems are "already happening"
  const cellOf = (x) => (x.type === 'risk' ? [x.probability, x.impact] : ['High', x.score >= 9 ? 'High' : x.score >= 6 ? 'Medium' : 'Low']);
  const go = (h) => { location.hash = h; };

  function describe(x) {
    const bits = [];
    if (x.type === 'risk') {
      bits.push(`${t('probability')} ${t('lv_' + x.probability)}`, `${t('impact')} ${t('lv_' + x.impact)}`);
      if (x.unconfirmed) bits.push(t('rd_unconfirmed'));
    } else if (x.type === 'overdue') {
      bits.push(t('rd_days_late', { n: x.late_days }), `${x.progress}%`);
      if (x.assignee) bits.push(x.assignee);
    } else if (x.type === 'payment') {
      if (x.amount != null) bits.push(PM.fmt(x.amount, x.currency));
      bits.push(x.late_days > 0 ? t('rd_days_late', { n: x.late_days }) : t('rd_due_in', { n: -x.late_days }));
      bits.push(t('state_' + x.state));
    } else if (x.type === 'behind') {
      bits.push(t('rd_spi', { v: x.spi }), `${x.progress}% / ${x.planned}%`);
    } else if (x.type === 'forecast') {
      bits.push(t('rd_forecast', { a: x.forecast_end, b: x.contract_end }), t('rd_days_late', { n: x.late_days }));
    } else bits.push(t('rd_items', { n: x.count }));
    return bits.map(esc).join(' · ');
  }

  function actionsFor(x) {
    const b = (act, label, cls = '') => `<button class="btn sm ${cls}" data-act="${act}" data-key="${esc(x.key)}">${esc(label)}</button>`;
    switch (x.type) {
      case 'risk': return (x.unconfirmed ? b('confirm', t('ra_confirm'), 'good') : '') + b('mitigated', t('ra_mitigated'), x.unconfirmed ? '' : 'good') + b('closeRisk', t('ra_close')) + b('openReview', t('ra_open'), 'ghost');
      case 'overdue': return b('progress', t('ra_update'), 'good') + b('schedule', t('ra_schedule'), 'ghost');
      case 'payment': return (x.state === 'pending' ? b('invoiced', t('ra_invoiced'), 'good') : '') + b('paid', t('ra_paid'), x.state === 'pending' ? '' : 'good') + b('overview', t('ra_open'), 'ghost');
      case 'behind': case 'forecast': return b('schedule', t('ra_schedule'), 'good') + b('report', t('ra_report'));
      case 'review': return b('openReview', t('ra_review'), 'good');
      default: return b('inbox', t('ra_inbox'), 'good');
    }
  }

  // Exposure by dimension: each axis is the sum of signal scores that belong to it
  function spider(items, active) {
    const DIMS = ['schedule', 'financial', 'scope', 'resources', 'technical', 'governance'];
    const val = Object.fromEntries(DIMS.map((d) => [d, 0]));
    const cnt = Object.fromEntries(DIMS.map((d) => [d, 0]));
    for (const x of items) { val[x.dim] += x.score; cnt[x.dim]++; }
    const top = Math.max(...Object.values(val));
    const max = Math.max(9, Math.ceil(top / 3) * 3);
    const CX = 150, CY = 120, R = 80;
    const pt = (k, f) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / DIMS.length; return [CX + Math.cos(a) * R * f, CY + Math.sin(a) * R * f]; };
    const ring = (f) => DIMS.map((_, k) => pt(k, f).join(',')).join(' ');
    let g = [0.25, 0.5, 0.75, 1].map((f) => `<polygon class="sp-ring" points="${ring(f)}"/>`).join('');
    g += DIMS.map((_, k) => { const [x, y] = pt(k, 1); return `<line class="sp-axis" x1="${CX}" y1="${CY}" x2="${x}" y2="${y}"/>`; }).join('');
    g += `<polygon class="sp-area" points="${DIMS.map((d, k) => pt(k, val[d] / max).join(',')).join(' ')}"/>`;
    g += DIMS.map((d, k) => { const [x, y] = pt(k, val[d] / max); return `<circle class="sp-dot ${val[d] ? '' : 'zero'}" cx="${x}" cy="${y}" r="4.5"/>`; }).join('');
    g += DIMS.map((d, k) => {
      const [x, y] = pt(k, 1.2);
      const anchor = Math.abs(x - CX) < 6 ? 'middle' : x < CX ? 'end' : 'start';
      const on = active === d;
      return `<g class="sp-lab ${on ? 'on' : ''}" data-dim="${d}" role="button" tabindex="0" aria-pressed="${on}" title="${esc(t('dim_' + d))}: ${val[d]}"><rect class="hit" x="${anchor === 'end' ? x - 70 : anchor === 'start' ? x - 4 : x - 38}" y="${y - 14}" width="74" height="30"/><text x="${x}" y="${y - 1}" text-anchor="${anchor}">${esc(t('dim_' + d))}</text><text class="n" x="${x}" y="${y + 12}" text-anchor="${anchor}">${cnt[d] ? `${cnt[d]} · ${val[d]}` : '0'}</text></g>`;
    }).join('');
    return `<svg class="viz spider" viewBox="0 0 300 240" role="img" aria-label="${esc(t('radar_dims'))}">${g}</svg>`;
  }

  function mount(host, initial, opts) {
    opts = opts || {};
    let data = initial;
    const F = { cell: null, type: 'all', sev: 'all', project: 'all', dim: 'all' };

    async function refresh() {
      try { data = opts.fetch ? await opts.fetch() : (await api('GET', '/api/dashboard')).radar; } catch (e) { toast(e.message, 'err'); }
      draw();
    }
    async function undoable(msg, doFn, undoFn) {
      try { await doFn(); } catch (e) { return toast(e.message, 'err'); }
      toast(msg, 'ok', { label: t('g_undo'), fn: async () => { try { await undoFn(); } catch (e) { toast(e.message, 'err'); } refresh(); } });
      refresh();
    }
    const setState = (x, state, prev) => undoable(t('radar_updated'), () => api('PUT', `/api/items/${x.item_id}`, { state }), () => api('PUT', `/api/items/${x.item_id}`, { state: prev }));

    function progressDialog(x) {
      const m = modal({
        title: t('ra_update'),
        body: `<p class="muted" style="margin-top:0"><b>${esc(x.title)}</b><br>${esc(x.project)}</p><div class="row" style="gap:12px"><input type="range" id="rpRange" min="0" max="100" step="5" value="${x.progress}" style="flex:1"><b id="rpVal" style="min-width:44px;text-align:end">${x.progress}%</b></div>`,
        footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn" id="rpDone">${t('ra_done100')}</button><button class="btn primary" id="rpSave">${t('save')}</button>`,
      });
      const r = m.$('#rpRange');
      r.oninput = () => (m.$('#rpVal').textContent = r.value + '%');
      const apply = (val) => {
        m.close();
        undoable(t('radar_updated'),
          () => api('POST', `/api/projects/${x.project_id}/schedule/apply`, { changes: { [x.task_id]: { progress: val } } }),
          () => api('POST', `/api/projects/${x.project_id}/schedule/apply`, { changes: { [x.task_id]: { progress: x.progress } } }));
      };
      m.$('#rpSave').onclick = () => apply(Number(r.value));
      m.$('#rpDone').onclick = () => apply(100);
    }

    function run(act, x) {
      const pid = x.project_id;
      switch (act) {
        case 'mitigated': return setState(x, 'mitigated', x.state || 'open');
        case 'closeRisk': return setState(x, 'closed', x.state || 'open');
        case 'invoiced': return setState(x, 'invoiced', x.state);
        case 'paid': return setState(x, 'paid', x.state);
        case 'confirm': return undoable(t('radar_updated'), () => api('POST', `/api/items/${x.item_id}/confirm`), () => api('POST', `/api/items/${x.item_id}/reopen`));
        case 'progress': return progressDialog(x);
        case 'schedule': return PM.act.peek(pid, 'schedule');
        case 'report': return PM.act.report(pid);
        case 'openReview': return x.item_id && PM.openItem ? PM.openItem(x.item_id, pid, refresh) : PM.act.peek(pid, 'attention');
        case 'inbox': return PM.act.peek(pid, 'attention');
        case 'overview': return x.item_id && PM.openItem ? PM.openItem(x.item_id, pid, refresh) : PM.act.peek(pid);
      }
    }

    function draw() {
      const all = data.items;
      const projects = [...new Map(all.map((x) => [x.project_id, x.project])).entries()];
      if (F.project !== 'all' && !projects.some(([id]) => String(id) === F.project)) F.project = 'all';
      const list = all.filter((x) => {
        if (F.sev !== 'all' && x.sev !== F.sev) return false;
        if (F.type !== 'all' && x.type !== F.type) return false;
        if (F.project !== 'all' && String(x.project_id) !== F.project) return false;
        if (F.dim !== 'all' && x.dim !== F.dim) return false;
        if (F.cell) { const c = cellOf(x); if (c[0] !== F.cell[0] || c[1] !== F.cell[1]) return false; }
        return true;
      });
      // heat map counts follow every filter except the cell itself
      const base = all.filter((x) => (F.sev === 'all' || x.sev === F.sev) && (F.type === 'all' || x.type === F.type) && (F.project === 'all' || String(x.project_id) === F.project) && (F.dim === 'all' || x.dim === F.dim));
      const grid = {};
      for (const x of base) { const c = cellOf(x).join('|'); grid[c] = (grid[c] || 0) + 1; }
      const heat = (p, i) => {
        const score = (LV.indexOf(p) + 1) * (LV.indexOf(i) + 1);
        const sev = score >= 6 ? 'high' : score >= 3 ? 'med' : 'low';
        const n = grid[p + '|' + i] || 0;
        const sel = F.cell && F.cell[0] === p && F.cell[1] === i;
        const names = base.filter((x) => cellOf(x)[0] === p && cellOf(x)[1] === i).slice(0, 6).map((x) => x.title).join('\n');
        return `<button title="${esc(names)}" class="rd-cell ${sev} ${n ? 'has' : ''} ${sel ? 'sel' : ''}" data-cell="${p}|${i}" aria-pressed="${!!sel}" aria-label="${t('probability')} ${t('lv_' + p)}, ${t('impact')} ${t('lv_' + i)}: ${n}">${n || ''}</button>`;
      };
      const spiderBase = all.filter((x) => (F.sev === 'all' || x.sev === F.sev) && (F.type === 'all' || x.type === F.type) && (F.project === 'all' || String(x.project_id) === F.project));
      const typeCount = (ty) => all.filter((x) => x.type === ty).length;
      const filtered = F.cell || F.type !== 'all' || F.sev !== 'all' || F.project !== 'all' || F.dim !== 'all';
      const rows = list.map((x) => `<div class="rd-item ${x.sev}">
          <div class="rd-main"><div class="rd-top"><span class="rd-type">${t('rt_' + x.type)}</span><span class="rd-title">${esc(x.title)}</span></div>
            <div class="rd-meta">${opts.single ? esc(x.project) : `<a href="#/p/${x.project_id}/overview" data-peek="${x.project_id}">${esc(x.project)}</a>`} · ${describe(x)}</div>${x.type === 'risk' && x.mitigation ? `<div class="rd-mit small muted">${esc(x.mitigation)}</div>` : ''}</div>
          <div class="rd-acts">${actionsFor(x)}</div></div>`).join('');
      host.innerHTML = `<div class="rd" id="radarCard">
        <div class="rd-head"><div class="small muted">${all.length ? t('radar_sub', { n: all.length }) : ''}</div>
          <div class="rd-sev">${SEVS.map((s) => `<button class="rd-pill ${s} ${F.sev === s ? 'on' : ''}" data-sev="${s}" aria-pressed="${F.sev === s}"><b>${data.counts[s]}</b> ${t('radar_sev_' + s)}</button>`).join('')}</div></div>
        ${all.length ? `<div class="rd-body">
          <div class="rd-map"><div class="rd-cap">${t('radar_matrix')}</div><div class="rd-ylabel">${t('impact')}</div><div class="rd-grid">${['High', 'Medium', 'Low'].map((i) => `<div class="rd-rowlab">${t('lv_' + i)}</div>${LV.map((p) => heat(p, i)).join('')}`).join('')}<div></div>${LV.map((p) => `<div class="rd-collab">${t('lv_' + p)}</div>`).join('')}</div><div class="rd-xlabel">${t('probability')}</div></div>
          <div class="rd-spider"><div class="rd-cap">${t('radar_dims')}</div>${spider(spiderBase, F.dim)}</div>
          <div class="rd-side">
            <div class="rd-filters"><button class="rd-chip ${F.type === 'all' ? 'on' : ''}" data-type="all">${t('radar_all')} ${all.length}</button>${TYPES.filter(typeCount).map((ty) => `<button class="rd-chip ${F.type === ty ? 'on' : ''}" data-type="${ty}">${t('rt_' + ty)} ${typeCount(ty)}</button>`).join('')}
              ${projects.length > 1 ? `<select id="rdProj" aria-label="${t('project')}"><option value="all">${t('radar_all_projects')}</option>${projects.map(([id, n]) => `<option value="${id}" ${String(id) === F.project ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
              ${F.dim !== 'all' ? `<span class="rd-chip on" data-dim="all">${t('dim_' + F.dim)} ×</span>` : ''}
              ${filtered ? `<button class="btn sm ghost" id="rdClear">${t('radar_clear')}</button>` : ''}</div>
            <div class="rd-list">${rows || `<div class="empty small">${t('radar_none_match')}</div>`}</div></div></div>`
        : `<div class="empty"><div class="big">✅</div><p>${t('radar_empty')}</p></div>`}</div>`;
      $$('[data-cell]', host).forEach((b) => (b.onclick = () => { const [p, i] = b.dataset.cell.split('|'); F.cell = F.cell && F.cell[0] === p && F.cell[1] === i ? null : [p, i]; draw(); }));
      $$('[data-sev]', host).forEach((b) => (b.onclick = () => { F.sev = F.sev === b.dataset.sev ? 'all' : b.dataset.sev; draw(); }));
      $$('[data-type]', host).forEach((b) => (b.onclick = () => { F.type = b.dataset.type; draw(); }));
      const sel = $('#rdProj', host); if (sel) sel.onchange = () => { F.project = sel.value; draw(); };
      const clr = $('#rdClear', host); if (clr) clr.onclick = () => { F.cell = null; F.type = 'all'; F.sev = 'all'; F.project = 'all'; F.dim = 'all'; draw(); };
      $$('[data-dim]', host).forEach((b) => { b.onclick = () => { F.dim = F.dim === b.dataset.dim ? 'all' : b.dataset.dim; draw(); }; b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.onclick(); } }; });
      $$('[data-peek]', host).forEach((a) => (a.onclick = (e) => { e.preventDefault(); PM.act.peek(Number(a.dataset.peek)); }));
      $$('[data-act]', host).forEach((b) => (b.onclick = () => { const x = data.items.find((i) => i.key === b.dataset.key); if (x) run(b.dataset.act, x); }));
    }
    draw();
  }

  PM.radar = { mount, describe };
})();
