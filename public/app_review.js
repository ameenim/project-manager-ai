/* Review tab and the confirm or ignore wizard. */
(function () {
  const { esc, t, icon, money, $, $$, api, toast, modal, confirmDlg, busy, state: S } = window.PM;
  const KINDS = ['field', 'deliverable', 'requirement', 'milestone', 'risk', 'schedule'];
  const STATES = { deliverable: ['open', 'closed'], milestone: ['pending', 'invoiced', 'paid'], risk: ['open', 'mitigated', 'closed'] };
  const FIELD_INPUT = { start_date: 'date', end_date: 'date', value: 'number', currency: 'text', client: 'text' };

  const conf = (c) => (c == null ? '' : `<span class="conf ${c >= 0.8 ? 'hi' : c >= 0.65 ? 'mid' : 'lo'}" title="${t('confidence')}">${Math.round(c * 100)}%</span>`);
  const statusChip = (s) => `<span class="chip ${s === 'confirmed' ? 'green' : s === 'ignored' ? '' : 'blue'}">${t('st_' + s)}</span>`;
  const sel = (id, opts, cur, tr) => `<select id="${id}">${opts.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${tr ? t(tr + o) : o}</option>`).join('')}</select>`;

  // ---------- shared form for edit modal and wizard ----------
  function formFields(kind, it) {
    const d = it.data || {};
    const f = (id, label, val, type = 'text', extra = '') => `<label class="f ${extra}">${label}<input type="${type}" id="${id}" value="${esc(val ?? '')}"></label>`;
    const ta = (id, label, val, extra = 'full') => `<label class="f ${extra}">${label}<textarea id="${id}">${esc(val ?? '')}</textarea></label>`;
    if (kind === 'field') return `<div class="form-grid">${f('f_value', t('fld_' + d.field), d.value, FIELD_INPUT[d.field] || 'text', 'full')}</div>`;
    if (kind === 'deliverable') return `<div class="form-grid">${f('f_title', t('title'), it.title, 'text', 'full')}${ta('f_desc', t('description'), it.description)}${f('f_due', t('due_date'), d.due_date, 'date')}</div>`;
    if (kind === 'requirement') return `<div class="form-grid">${ta('f_desc', t('requirement'), it.description || it.title)}<label class="f">${t('priority')}${sel('f_prio', ['Must', 'Should', 'Could'], d.priority || 'Should')}</label></div>`;
    if (kind === 'risk') return `<div class="form-grid">${f('f_title', t('risk'), it.title, 'text', 'full')}<label class="f">${t('probability')}${sel('f_prob', ['Low', 'Medium', 'High'], d.probability || 'Medium', 'lv_')}</label><label class="f">${t('impact')}${sel('f_imp', ['Low', 'Medium', 'High'], d.impact || 'Medium', 'lv_')}</label>${ta('f_mit', t('mitigation'), d.mitigation)}</div>`;
    if (kind === 'milestone') return `<div class="form-grid">${f('f_title', t('milestone'), it.title, 'text', 'full')}${f('f_pct', t('share_pct'), d.percent, 'number')}${f('f_amt', t('amount'), d.amount, 'number')}${f('f_due', t('due_date'), d.due_date, 'date')}</div>`;
    if (kind === 'schedule') return `<div class="form-grid">${f('f_title', t('task'), it.title, 'text', 'full')}${f('f_start', t('start'), d.start, 'date')}${f('f_end', t('finish'), d.end, 'date')}${f('f_days', t('duration_days'), d.duration_days, 'number')}</div>`;
    return '';
  }
  function readForm(root, kind, it) {
    const v = (id) => { const el = $('#' + id, root); return el ? el.value : undefined; };
    const num = (x) => (x === '' || x == null ? null : Number(x));
    const d = {};
    let title, description;
    if (kind === 'field') { d.value = it.data.field === 'value' ? num(v('f_value')) : v('f_value'); title = it.title; }
    if (kind === 'deliverable') { title = v('f_title'); description = v('f_desc'); d.due_date = v('f_due') || null; }
    if (kind === 'requirement') { description = v('f_desc'); title = (description || '').slice(0, 120); d.priority = v('f_prio'); }
    if (kind === 'risk') { title = v('f_title'); d.probability = v('f_prob'); d.impact = v('f_imp'); d.mitigation = v('f_mit'); }
    if (kind === 'milestone') { title = v('f_title'); d.percent = num(v('f_pct')); d.amount = num(v('f_amt')); d.due_date = v('f_due') || null; }
    if (kind === 'schedule') { title = v('f_title'); d.start = v('f_start') || null; d.end = v('f_end') || null; d.duration_days = num(v('f_days')); }
    return { title, description, data: d };
  }

  function summaryCells(kind, it, p) {
    const d = it.data;
    const src = `<div class="small muted">${esc(it.doc_name || t('manual'))}${d.also_in && d.also_in.length ? ` +${d.also_in.length}` : ''}</div>`;
    if (kind === 'field') {
      const v = d.field === 'value' ? money(d.value, p.currency) : esc(d.value);
      return [`<b>${t('fld_' + d.field)}</b>`, `${v}${d.conflict ? ` <span class="chip amber">${t('conflict')}</span>` : ''}`, src];
    }
    if (kind === 'deliverable') return [`<b>${esc(it.title)}</b><div class="small muted">${esc((it.description || '').slice(0, 120))}</div>`, d.due_date || '', src];
    if (kind === 'requirement') return [`${esc(it.description || it.title)}`, `<span class="chip ${d.priority === 'Must' ? 'red' : d.priority === 'Could' ? '' : 'blue'}">${esc(d.priority || '')}</span>`, src];
    if (kind === 'milestone') return [`<b>${esc(it.title)}</b>`, `${d.percent != null ? d.percent + '%' : ''}`, d.amount != null ? money(d.amount, p.currency) : d.percent != null && p.value ? `<span class="muted">${money(Math.round((p.value * d.percent) / 100), p.currency)}</span>` : '', d.due_date || '', src];
    if (kind === 'risk') return [`<b>${esc(it.title)}</b>`, `<span class="chip ${d.probability === 'High' ? 'red' : d.probability === 'Low' ? 'green' : 'amber'}">${t('lv_' + (d.probability || 'Medium'))}</span>`, `<span class="chip ${d.impact === 'High' ? 'red' : d.impact === 'Low' ? 'green' : 'amber'}">${t('lv_' + (d.impact || 'Medium'))}</span>`, esc(d.mitigation || ''), src];
    if (kind === 'schedule') return [`<b>${esc(it.title)}</b>`, d.start || '', d.end || (d.duration_days ? `${d.duration_days} ${t('days')}` : ''), src];
    return [];
  }
  const HEADS = {
    field: ['fld', 'value', 'source'], deliverable: ['deliverable', 'due_date', 'source'], requirement: ['requirement', 'priority', 'source'],
    milestone: ['milestone', 'share_pct', 'amount', 'due_date', 'source'], risk: ['risk', 'probability', 'impact', 'mitigation', 'source'], schedule: ['task', 'start', 'finish', 'source'],
  };

  // ---------- tab ----------
  window.PM.views.tab_review = async function (root, p, q, token) {
    let items = (await api('GET', `/api/projects/${p.id}/items`)).items;
    let kind = q.get('kind') || sessionStorage.getItem('rv_kind') || null;
    let status = sessionStorage.getItem('rv_status') || 'all';
    let search = '';
    let stateF = '';
    const proposedBy = () => KINDS.reduce((o, k) => ((o[k] = items.filter((i) => i.kind === k && i.status === 'proposed').length), o), {});
    if (!kind || !KINDS.includes(kind)) { const pb = proposedBy(); kind = KINDS.find((k) => pb[k]) || 'deliverable'; }
    const reload = async () => { items = (await api('GET', `/api/projects/${p.id}/items`)).items; S.project = (await api('GET', `/api/projects/${p.id}`)).project; draw(); };

    function draw() {
      if (window.PM.stale(token)) return;
      const pb = proposedBy();
      const total = Object.values(pb).reduce((a, b) => a + b, 0);
      let list = items.filter((i) => i.kind === kind);
      if (status !== 'all') list = list.filter((i) => i.status === status);
      if (stateF) list = list.filter((i) => i.state === stateF);
      if (search) list = list.filter((i) => `${i.title} ${i.description}`.toLowerCase().includes(search.toLowerCase()));
      const toConfirm = list.filter((i) => i.status === 'proposed');
      const heads = HEADS[kind].map((h) => `<th>${t('col_' + h)}</th>`).join('');
      const rows = list.map((i) => {
        const cells = summaryCells(kind, i, p);
        const stSel = STATES[kind] ? `<select data-state="${i.id}" style="width:auto;padding:3px 6px">${STATES[kind].map((s) => `<option value="${s}" ${i.state === s ? 'selected' : ''}>${t('state_' + s)}</option>`).join('')}</select>` : '';
        const ev = i.evidence_name ? `<div class="small"><a href="#" data-dl="${i.evidence_doc_id}" data-name="${esc(i.evidence_name)}">${icon('file')} ${esc(i.evidence_name)}</a></div>` : '';
        return `<tr><td style="width:30px">${i.status === 'proposed' ? `<input type="checkbox" data-pick="${i.id}">` : ''}</td>${cells.map((c) => `<td>${c}</td>`).join('')}<td>${stSel}${ev}</td><td>${i.status === 'proposed' ? conf(i.confidence) + ' ' : ''}${statusChip(i.status)}</td>
          <td class="nowrap right">${i.status === 'proposed' ? `<button class="btn sm good icon" data-confirm="${i.id}" title="${t('confirm')}">${icon('check')}</button> ` : ''}${i.status !== 'ignored' ? `<button class="btn sm icon" data-ignore="${i.id}" title="${t('ignore')}">${icon('x')}</button> ` : `<button class="btn sm" data-reopen="${i.id}">${t('reopen')}</button> `}<button class="btn sm icon ghost" data-edit="${i.id}" title="${t('edit')}">${icon('edit')}</button><button class="btn sm icon ghost" data-del="${i.id}" title="${t('delete')}">${icon('trash')}</button></td></tr>`;
      }).join('');
      const stateCol = STATES[kind] ? `<th>${t('col_state')}</th>` : '<th></th>';
      root.innerHTML = `<div class="page">
        ${p.analyzing ? `<div class="banner mb"><span class="spinner"></span><div class="grow"><b>${t('ai_reading')}</b><div class="small muted">${t('ai_reading_hint')}</div></div></div>` : ''}
        ${!p.analyzing && total ? `<div class="banner mb">${icon('spark')}<div class="grow"><b>${t('items_waiting', { n: total })}</b><div class="small muted">${t('wizard_intro')}</div></div><button class="btn primary" id="wizBtn">${icon('play')}${t('start_wizard')}</button></div>` : ''}
        ${!p.analyzing && !total && items.length ? `<div class="banner ok mb">${icon('check')}<div class="grow"><b>${t('all_reviewed')}</b></div></div>` : ''}
        ${!p.analyzing && !items.length ? `<div class="card empty mb"><div class="big">📄</div><p>${t('no_items_yet')}</p><a class="btn primary" href="#/p/${p.id}/documents">${icon('upload')}${t('upload_docs')}</a></div>` : ''}
        <div class="card"><div class="row wrap" style="margin-bottom:12px">${KINDS.map((k) => `<button class="tab ${k === kind ? 'active' : ''}" data-kind="${k}" style="border-radius:8px 8px 0 0">${t('kind_' + k)} <span class="badge-count ${pb[k] ? '' : 'soft'}">${pb[k] || items.filter((i) => i.kind === k && i.status !== 'ignored').length}</span></button>`).join('')}</div>
        <div class="row wrap" style="margin-bottom:12px">${['all', 'proposed', 'confirmed', 'ignored'].map((s) => `<span class="chip filter-chip ${status === s ? 'on' : ''}" data-status="${s}">${s === 'all' ? t('all') : t('st_' + s)}</span>`).join('')}
          ${STATES[kind] ? `<select id="stateF" style="width:auto"><option value="">${t('any_state')}</option>${STATES[kind].map((s) => `<option value="${s}" ${stateF === s ? 'selected' : ''}>${t('state_' + s)}</option>`).join('')}</select>` : ''}
          <span class="grow"></span><div style="position:relative;width:220px"><input type="text" id="rvSearch" placeholder="${t('search')}" value="${esc(search)}"></div>
          ${toConfirm.length ? `<button class="btn" id="bulkOk">${icon('check')}${t('confirm_all', { n: toConfirm.length })}</button>` : ''}
          ${['deliverable', 'requirement', 'risk', 'milestone'].includes(kind) ? `<button class="btn" id="addItem">${icon('plus')}${t('add')}</button>` : ''}</div>
        ${kind === 'schedule' ? `<div class="small muted mb">${t('schedule_note')} <a href="#/p/${p.id}/schedule">${t('open_schedule')}</a></div>` : ''}
        ${list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th></th>${heads}${stateCol}<th>${t('col_status')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('nothing_here')}</div>`}</div></div>`;
      bind();
    }

    function bind() {
      $$('[data-kind]', root).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; stateF = ''; sessionStorage.setItem('rv_kind', kind); draw(); }));
      $$('[data-status]', root).forEach((b) => (b.onclick = () => { status = b.dataset.status; sessionStorage.setItem('rv_status', status); draw(); }));
      const ss = $('#stateF', root); if (ss) ss.onchange = () => { stateF = ss.value; draw(); };
      const si = $('#rvSearch', root); if (si) si.oninput = () => { search = si.value; const pos = si.selectionStart; draw(); const n = $('#rvSearch', root); n.focus(); n.setSelectionRange(pos, pos); };
      const act = async (e, fn) => { const b = e.currentTarget; await busy(b, fn); await reload(); };
      $$('[data-confirm]', root).forEach((b) => (b.onclick = (e) => act(e, () => api('POST', `/api/items/${b.dataset.confirm}/confirm`))));
      $$('[data-ignore]', root).forEach((b) => (b.onclick = (e) => act(e, () => api('POST', `/api/items/${b.dataset.ignore}/ignore`))));
      $$('[data-reopen]', root).forEach((b) => (b.onclick = (e) => act(e, () => api('POST', `/api/items/${b.dataset.reopen}/reopen`))));
      $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_item'), ok: t('delete'), danger: true })) { await busy(null, () => api('DELETE', `/api/items/${b.dataset.del}`)); reload(); } }));
      $$('[data-edit]', root).forEach((b) => (b.onclick = () => editItem(items.find((i) => i.id === Number(b.dataset.edit)))));
      $$('[data-state]', root).forEach((s) => (s.onchange = async () => { await busy(null, () => api('PUT', `/api/items/${s.dataset.state}`, { state: s.value })); reload(); }));
      $$('[data-dl]', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.PM.download(`/api/projects/${p.id}/documents/${a.dataset.dl}/file`, a.dataset.name); }));
      const bulk = $('#bulkOk', root);
      if (bulk) bulk.onclick = async () => {
        const picked = $$('[data-pick]:checked', root).map((c) => Number(c.dataset.pick));
        const ids = picked.length ? picked : items.filter((i) => i.kind === kind && i.status === 'proposed' && (status === 'all' || status === 'proposed') && (!search || `${i.title} ${i.description}`.toLowerCase().includes(search.toLowerCase()))).map((i) => i.id);
        if (!(await confirmDlg({ title: t('confirm'), message: t('confirm_bulk', { n: ids.length }), ok: t('confirm') }))) return;
        await busy(bulk, () => api('POST', `/api/projects/${p.id}/items/bulk`, { ids, action: 'confirm' }));
        reload();
      };
      const add = $('#addItem', root); if (add) add.onclick = () => editItem({ kind, title: '', description: '', data: {}, isNew: true });
      const wb = $('#wizBtn', root); if (wb) wb.onclick = () => startWizard(p, reload);
    }

    function editItem(it) {
      const m = modal({ title: it.isNew ? t('add_item') : t('edit_item'), size: 'lg', body: formFields(it.kind, it), footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="saveItem">${t('save')}</button>` });
      m.$('#saveItem').onclick = async () => {
        const v = readForm(m.el, it.kind, it);
        if (it.kind !== 'field' && !String(v.title || v.description || '').trim()) { toast(t('title_required'), 'err'); return; }
        const r = await busy(m.$('#saveItem'), () => (it.isNew ? api('POST', `/api/projects/${p.id}/items`, { kind: it.kind, ...v }) : api('PUT', `/api/items/${it.id}`, v)));
        if (r) { m.close(); toast(t('saved'), 'ok'); reload(); }
      };
    }

    draw();
    if (p.analyzing) {
      const poll = async () => {
        if (window.PM.stale(token)) return;
        const np = (await api('GET', `/api/projects/${p.id}`)).project;
        if (np.analyzing) setTimeout(poll, 1500);
        else { window.PM.projectView(p.id, 'review', new URLSearchParams()); }
      };
      setTimeout(poll, 1500);
    } else if (new URLSearchParams(location.hash.split('?')[1] || '').get('wizard') === '1' && Object.values(proposedBy()).some(Boolean)) startWizard(p, reload);
  };

  // ---------- wizard ----------
  async function startWizard(p, onDone) {
    const w = await api('GET', `/api/projects/${p.id}/wizard`);
    const Q = w.items;
    if (!Q.length) { toast(t('all_reviewed'), 'ok'); return; }
    const done = new Set();
    const tally = { confirmed: 0, ignored: 0, skipped: 0 };
    let idx = 0;
    const history = [];
    const m = modal({ title: t('wizard_title'), size: 'lg', noBackdropClose: true, body: '<div class="wiz" id="wz"></div>', footer: '' });
    const order = KINDS.filter((k) => Q.some((i) => i.kind === k));

    const next = () => { let n = idx; do { n++; } while (n < Q.length && done.has(Q[n].id)); idx = n; };
    const show = () => {
      while (idx < Q.length && done.has(Q[idx].id)) idx++;
      if (idx >= Q.length) return finish();
      const it = Q[idx];
      const group = it.kind === 'field' && it.data.conflict ? Q.filter((x) => x.kind === 'field' && x.data.field === it.data.field && !done.has(x.id)) : null;
      const remaining = Q.filter((x) => !done.has(x.id)).length;
      const pct = Math.round(((Q.length - remaining) / Q.length) * 100);
      const steps = order.map((k) => { const left = Q.filter((x) => x.kind === k && !done.has(x.id)).length; return `<span class="wiz-step ${k === it.kind ? 'cur' : left === 0 ? 'done' : ''}">${t('kind_' + k)}${left ? ` · ${left}` : ' ✓'}</span>`; }).join('');
      let body;
      if (group && group.length > 1) {
        body = `<div class="small muted" style="margin-bottom:6px">${t('conflict_help')}</div><h3 style="margin-bottom:12px">${t('fld_' + it.data.field)}</h3><div class="col" id="opts">${group.map((g, i) => `<label class="option ${i === 0 ? 'sel' : ''}" data-opt="${g.id}"><input type="radio" name="opt" ${i === 0 ? 'checked' : ''} style="margin-top:3px"><div class="grow"><div style="font-weight:600;font-size:var(--fs-heading)">${g.data.field === 'value' ? money(g.data.value, p.currency) : esc(g.data.value)}</div><div class="small muted">${esc(g.doc_name || '')} ${conf(g.confidence)}</div>${g.quote ? `<div class="quote">${esc(g.quote)}</div>` : ''}</div></label>`).join('')}</div>`;
      } else {
        body = `<div class="wiz-card"><div class="row" style="margin-bottom:12px"><span class="chip blue">${t('kind_' + it.kind)}</span>${conf(it.confidence)}<span class="grow"></span><span class="small muted">${icon('file')} ${esc(it.doc_name || '')}${it.data.also_in && it.data.also_in.length ? ` +${esc(it.data.also_in.join(', '))}` : ''}</span></div>${formFields(it.kind, it)}${it.quote ? `<div class="quote">${esc(it.quote)}</div>` : ''}</div>`;
      }
      $('#wz', m.el).innerHTML = `<div class="progress" style="margin-bottom:12px"><i style="width:${pct}%"></i></div><div class="wiz-steps">${steps}</div>${body}`;
      m.setFooter(`<button class="btn" id="wzLater">${t('finish_later')}</button><span class="grow"></span><button class="btn" id="wzBack" ${history.length ? '' : 'disabled'}>${icon('back', 'flip')}${t('back')}</button><button class="btn" id="wzSkip">${icon('skip', 'flip')}${t('skip')}</button><button class="btn" id="wzIgnore">${icon('x')}${t('ignore')}</button><button class="btn good" id="wzOk">${icon('check')}${t('confirm')}</button>`);
      const isGroup = group && group.length > 1;
      if (isGroup) $$('[data-opt]', m.el).forEach((o) => (o.onclick = () => { $$('[data-opt]', m.el).forEach((x) => x.classList.remove('sel')); o.classList.add('sel'); $('input', o).checked = true; }));
      $('#wzLater', m.el).onclick = () => { m.close(); onDone && onDone(); };
      $('#wzBack', m.el).onclick = () => { const h = history.pop(); if (h) { h.ids.forEach((id) => done.delete(id)); tally[h.kind] = Math.max(0, tally[h.kind] - 1); idx = Q.findIndex((x) => x.id === h.ids[0]); show(); } };
      $('#wzSkip', m.el).onclick = () => { tally.skipped++; if (isGroup) group.forEach((g) => done.add(g.id)); else done.add(it.id); history.push({ ids: isGroup ? group.map((g) => g.id) : [it.id], kind: 'skipped' }); show(); };
      $('#wzIgnore', m.el).onclick = async () => {
        const ids = isGroup ? [($('[data-opt].sel', m.el) || {}).dataset.opt].map(Number) : [it.id];
        await busy($('#wzIgnore', m.el), async () => { for (const id of ids) await api('POST', `/api/items/${id}/ignore`); });
        ids.forEach((id) => done.add(id)); tally.ignored++; history.push({ ids, kind: 'ignored' });
        show();
      };
      $('#wzOk', m.el).onclick = async () => {
        let chosen = it;
        if (isGroup) chosen = Q.find((x) => x.id === Number(($('[data-opt].sel', m.el) || {}).dataset.opt));
        const ok = await busy($('#wzOk', m.el), async () => {
          if (!isGroup) { const v = readForm(m.el, it.kind, it); await api('PUT', `/api/items/${it.id}`, v); }
          await api('POST', `/api/items/${chosen.id}/confirm`);
          return true;
        });
        if (!ok) return;
        const ids = isGroup ? group.map((g) => g.id) : [it.id];
        ids.forEach((id) => done.add(id)); tally.confirmed++; history.push({ ids, kind: 'confirmed' });
        show();
      };
    };
    async function finish() {
      await api('POST', `/api/projects/${p.id}/wizard/finish`).catch(() => {});
      const sched = Q.some((x) => x.kind === 'schedule');
      $('#wz', m.el).innerHTML = `<div class="empty"><div class="big">🎉</div><h2>${t('review_complete')}</h2><p class="muted">${t('wizard_summary', { c: tally.confirmed, i: tally.ignored, s: tally.skipped })}</p></div>`;
      m.setFooter(`<button class="btn" id="wzClose">${t('close')}</button>${sched ? `<a class="btn primary" href="#/p/${p.id}/schedule" id="wzSched">${icon('cal')}${t('open_schedule')}</a>` : ''}`);
      $('#wzClose', m.el).onclick = () => { m.close(); onDone && onDone(); };
      const a = $('#wzSched', m.el); if (a) a.onclick = () => m.close();
    }
    show();
  }
  window.PM.startWizard = startWizard;
})();
