/* Closure tab: resolve every deliverable and requirement (delivered, or not delivered with a reason), write the lessons learned
   report and the certificate of completion, record the client acceptance, then close the project. A closed project is read
   only until the project manager reopens it with a reason. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, confirmDlg, busy } = PM;


  // One dialog for closing a deliverable or requirement as not delivered. The Logs tab uses it too.
  PM.askNotDelivered = function (r, done) {
    const m = modal({ title: t('cl_nd_title'), size: 'md', body: `<div class="form-grid"><div class="full" style="font-weight:var(--fw);unicode-bidi:plaintext">${esc(r.title)}</div>
      <label class="f full">${t('cl_nd_reason')}<textarea id="clWhy" rows="4" maxlength="600" placeholder="${esc(t('cl_nd_ph'))}">${esc(r.reason || '')}</textarea><span class="small muted">${t('cl_nd_help')}</span><span class="small" id="clWhyErr" role="alert" style="color:var(--danger)"></span></label></div>`,
    footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="clWhySave">${t('save')}</button>` });
    const box = m.$('#clWhy'); box.focus();
    m.$('#clWhySave').onclick = async () => {
      const why = box.value.trim();
      if (why.length < 3) { m.$('#clWhyErr').textContent = t('cl_nd_need'); box.focus(); return; }
      const ok = await busy(m.$('#clWhySave'), async () => { await api('PUT', `/api/items/${r.id}`, { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: why } }); return true; });
      if (!ok) return;
      m.close(); if (done) await done(why);
    };
  };

  const SHOW = 5;
  const chipOf = (o) => (o === 'delivered' ? 'green' : o === 'not_delivered' ? 'amber' : '');
  const dayOf = (ts) => String(ts || '').slice(0, 10);

  PM.views.tab_closure = async function (root, p, q, token) {
    let c = await api('GET', `/api/projects/${p.id}/closure`);
    const allKey = `pm_closure_all_${p.id}`;
    const ui = { all: sessionStorage.getItem(allKey) === '1' };
    const closed = () => c.status === 'closed';
    const manage = () => c.can_manage && !closed();
    const refreshHead = async () => { if (PM.refresh) await PM.refresh(); };
    const reload = async () => { c = await api('GET', `/api/projects/${p.id}/closure`); draw(); };

    // ---------- steps ----------
    const steps = () => {
      const byCode = Object.fromEntries(c.checks.map((k) => [k.code, k]));
      const sc = c.scope;
      const docState = (k, doc) => (!doc ? 'missing' : doc.current ? 'current' : 'stale');
      const ll = c.documents.lessons_learned, ce = c.documents.completion_certificate;
      const itemsMeta = sc.counts.total === 0 ? t('cl_c_items_none') : byCode.items_open.ok ? t('cl_c_items_ok', { n: sc.counts.total }) : t('cl_c_items_todo', { n: sc.counts.open });
      return [
        { req: true, ok: byCode.items_open.ok && byCode.reasons.ok, title: t('cl_c_items'), meta: itemsMeta + (byCode.reasons.ok ? '' : `. ${t('cl_c_reasons', { n: byCode.reasons.n })}`), go: 'clItems' },
        { ok: byCode.items_review.ok, title: t('cl_c_review'), meta: byCode.items_review.ok ? t('cl_c_review_ok') : t('cl_c_review_todo', { n: byCode.items_review.n }), go: 'clItems' },
        { ok: byCode.ll.ok, title: t('cl_c_ll'), meta: t('cl_c_' + docState('ll', ll)), go: 'clLL' },
        { ok: byCode.acceptance.ok, title: t('cl_c_accept'), meta: byCode.acceptance.ok ? `${esc(c.accepted_by)}, ${esc(c.accepted_on)}` : t('cl_c_accept_todo'), go: 'clCert' },
        { ok: byCode.cert.ok, title: t('cl_c_cert'), meta: t('cl_c_' + docState('cert', ce)), go: 'clCert' },
      ];
    };

    // ---------- rendering ----------
    function checklist() {
      const all = steps(), list = all.filter((s) => s.req), opt = all.filter((s) => !s.req), done = list.filter((s) => s.ok).length;
      const docsTodo = !closed() && c.can_manage && c.scope.counts.open === 0 && ['lessons_learned', 'completion_certificate'].some((k) => !c.documents[k] || !c.documents[k].current);
      const li = (s) => `<li class="cl-check ${s.ok ? 'ok' : 'todo'}"><span class="cl-ico" aria-hidden="true">${icon(s.ok ? 'check' : 'clock')}</span><div class="grow" style="min-width:0"><div class="cl-t">${s.title}</div><div class="small muted">${s.meta}</div></div></li>`;
      const heads = [[c.heads_up.unpaid, 'cl_h_unpaid'], [c.heads_up.open_risks, 'cl_h_risks'], [c.heads_up.open_tasks, 'cl_h_tasks']].filter(([n]) => n > 0);
      const btn = closed() ? '' : c.can_manage
        ? `<button class="btn primary" id="clClose" ${c.ready ? '' : 'disabled'} ${c.ready ? '' : `data-tip="${esc(t('cl_close_tip'))}"`}>${icon('check')}${t('cl_close')}</button>`
        : `<span class="small muted">${t('cl_manager_only')}</span>`;
      return `<div class="card" id="clCheck"><div class="card-head"><h3>${t('cl_checklist')}</h3>${btn}</div>
        <div class="row small" style="margin-bottom:8px"><span class="grow">${c.ready || closed() ? t('cl_ready') : t('cl_progress', { a: done, b: list.length })}</span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${done}"><i style="width:${Math.round((done / list.length) * 100)}%"></i></div>
        <ul class="cl-checks">${list.map(li).join('')}</ul>
        <div class="row cl-opt-head"><h4 class="sub grow" style="margin:0">${t('cl_opt_h')}</h4>${docsTodo ? `<button class="btn sm" id="clBoth">${icon('spark')}${t('cl_write_both')}</button>` : ''}</div>
        <p class="small muted" style="margin:4px 0 0">${t('cl_opt_p')}</p>
        <ul class="cl-checks">${opt.map(li).join('')}</ul>
        ${heads.length && !closed() ? `<div class="cl-heads"><span class="small muted">${t('cl_heads')}</span><div class="row wrap" style="gap:6px;margin-top:6px">${heads.map(([n, k]) => `<span class="chip amber">${t(k, { n })}</span>`).join('')}</div></div>` : ''}</div>`;
    }

    function itemRow(r) {
      const can = !closed();
      const tip = (k) => `data-tip="${esc(t(k))}"`;
      const acts = !can ? '' : r.outcome === 'open'
        ? `<button class="btn sm good" data-deliver="${r.id}" ${tip('cl_tip_deliver')}>${icon('check')}${t('cl_a_deliver')}</button><button class="btn sm ghost" data-not="${r.id}" ${tip('cl_tip_not')}>${icon('x')}${t('cl_a_not')}</button>`
        : r.outcome === 'delivered'
          ? `<button class="btn sm ghost" data-not="${r.id}" ${tip('cl_tip_not')}>${icon('x')}${t('cl_a_not')}</button><button class="btn sm ghost" data-reopen="${r.id}" ${tip('cl_tip_reopen')}>${icon('undo')}${t('cl_a_reopen')}</button>`
          : `<button class="btn sm ghost" data-not="${r.id}" ${tip('cl_tip_edit')}>${icon('edit')}${t('cl_a_edit')}</button><button class="btn sm ghost" data-deliver="${r.id}" ${tip('cl_tip_deliver')}>${icon('check')}${t('cl_a_deliver')}</button><button class="btn sm ghost" data-reopen="${r.id}" ${tip('cl_tip_reopen')}>${icon('undo')}${t('cl_a_reopen')}</button>`;
      return `<tr><td class="nowrap"><span class="chip">${t('cl_kind_' + r.kind)}</span></td>
        <td style="min-width:200px"><div style="font-weight:var(--fw);unicode-bidi:plaintext">${esc(r.title)}</div>${r.outcome === 'not_delivered' ? `<div class="cl-reason">${esc(r.reason)}</div>` : ''}</td>
        <td class="nowrap small">${esc(r.due || '')}</td><td class="nowrap"><span class="chip ${chipOf(r.outcome)}">${t(r.outcome === 'open' ? 'cl_open' : r.outcome === 'delivered' ? 'cl_delivered' : 'cl_not_delivered')}</span></td>
        <td><div class="cl-actions">${acts}</div></td></tr>`;
    }

    function items() {
      const sc = c.scope, order = { open: 0, not_delivered: 1, delivered: 2 };
      const rows = [...sc.rows].sort((a, b) => order[a.outcome] - order[b.outcome] || a.id - b.id);
      const shown = ui.all ? rows : rows.slice(0, SHOW);
      const review = sc.pending ? `<div class="banner warn cl-note" role="status"><span class="grow">${t('cl_review_warn')} (${sc.pending})</span><a class="btn sm" href="#/p/${p.id}/review">${t('cl_review_go')}</a></div>` : '';
      const counts = `<div class="row wrap" style="gap:6px"><span class="chip green">${t('cl_delivered')}: ${sc.counts.delivered}</span><span class="chip amber">${t('cl_not_delivered')}: ${sc.counts.not_delivered}</span><span class="chip">${t('cl_open')}: ${sc.counts.open}</span></div>`;
      const bulk = !closed() && sc.counts.open > 1 ? `<button class="btn sm" id="clAll">${icon('check')}${t('cl_a_all')}</button>` : '';
      return `<div class="card" id="clItems"><div class="card-head"><h3>${t('cl_s1_h')}</h3>${bulk}</div><p class="small muted" style="margin:0 0 10px">${t('cl_s1_p')}</p>${counts}${review}
        ${!rows.length ? `<div class="empty small" style="padding:16px 0">${t('cl_none')}</div>` : `<div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th>${t('cl_col_type')}</th><th>${t('cl_col_item')}</th><th>${t('cl_col_due')}</th><th>${t('cl_col_outcome')}</th><th></th></tr></thead><tbody>${shown.map(itemRow).join('')}</tbody></table></div>
        ${rows.length > SHOW ? `<div class="row" style="justify-content:center;margin-top:8px"><button class="btn sm ghost" id="clMore">${ui.all ? t('cl_show_less') : t('cl_show_all', { n: rows.length })}</button></div>` : ''}`}</div>`;
    }

    function docCard(type, id, titleKey, textKey, writeKey) {
      const d = c.documents[type];
      const blocked = c.scope.counts.open > 0;
      const state = !d ? 'none' : d.current ? 'ok' : 'stale';
      const chip = `<span class="chip ${state === 'ok' ? 'green' : state === 'stale' ? 'amber' : ''}">${t('cl_doc_' + state)}</span>`;
      const can = !closed();
      const write = can ? `<button class="btn ${state === 'ok' ? '' : 'primary'}" data-write="${type}" ${blocked ? `disabled data-tip="${esc(t('cl_doc_blocked'))}"` : ''}>${icon(state === 'none' ? 'plus' : 'refresh')}${t(state === 'none' ? writeKey : 'cl_doc_again')}</button>` : '';
      const open = d ? `<button class="btn ghost" data-open="${d.id}">${icon('edit')}${t('cl_doc_open')}</button><button class="btn ghost" data-dl="${d.id}">${icon('dl')}${t('cl_doc_dl')}</button>` : '';
      return `<div class="card" id="${id}"><div class="card-head"><h3>${t(titleKey)}</h3>${chip}</div><p class="small muted" style="margin:0 0 10px">${t(textKey)}</p>
        ${d ? `<div class="small muted" style="margin-bottom:8px">${esc(d.title)}. ${t('cl_doc_written', { d: dayOf(d.created_at) })}</div>` : ''}
        ${state === 'stale' ? `<div class="banner warn cl-note" role="status"><span class="grow">${t('cl_doc_stale_p')}</span></div>` : ''}
        ${type === 'completion_certificate' ? accept() : ''}
        <div class="row wrap" style="gap:8px;margin-top:12px">${write}${open}</div></div>`;
    }

    function accept() {
      const ro = !manage();
      return `<div class="cl-acc-wrap"><h4 class="sub" style="margin:0 0 8px">${t('cl_acc_h')}</h4>
        <div class="cl-acc"><label class="f">${t('cl_acc_by')}<input type="text" id="clBy" maxlength="120" value="${esc(c.accepted_by)}" placeholder="${esc(t('cl_acc_by_ph'))}" ${ro ? 'disabled' : ''}></label>
        <label class="f">${t('cl_acc_on')}<input type="date" id="clOn" value="${esc(c.accepted_on)}" ${ro ? 'disabled' : ''}></label>
        ${ro ? '' : `<button class="btn" id="clAccSave" disabled>${t('cl_acc_save')}</button>`}</div>
        <div class="small muted" style="margin-top:6px">${t('cl_acc_help')}</div></div>`;
    }

    function history() {
      if (!c.history.length) return '';
      return `<div class="card"><div class="card-head"><h3>${t('cl_hist_h')}</h3></div><ul class="cl-hist">${c.history.map((h) => `<li><span class="small muted nowrap">${esc(dayOf(h.at))}</span><span>${h.action === 'closed' ? t('cl_hist_closed', { u: esc(h.by), a: h.delivered, b: h.not_delivered }) + ((h.skipped || []).length ? t('cl_hist_skipped', { s: h.skipped.map((k) => t('cl_n_' + (k === 'items_review' ? 'review' : k === 'll' ? 'll' : k))).join(', ') }) : '') : t('cl_hist_reopened', { u: esc(h.by), r: esc(h.reason) })}</span></li>`).join('')}</ul></div>`;
    }

    function draw() {
      const sc = c.scope;
      const banner = closed() ? `<div class="banner ok cl-pop" role="status"><span class="grow">${t('cl_banner_closed', { d: esc(dayOf(c.closed_at)), u: esc(c.closed_by || ''), a: sc.counts.delivered, b: sc.counts.not_delivered })}</span>${c.can_manage ? `<button class="btn" id="clReopen">${icon('undo')}${t('cl_reopen')}</button>` : `<span class="small muted">${t('cl_manager_only')}</span>`}</div>` : '';
      root.innerHTML = `<div class="page"><div class="page-head"><div><h1>${t('cl_title')}</h1><p class="muted small" style="margin:4px 0 0;max-width:80ch">${t('cl_lead')}</p></div></div>
        <div class="col gap-lg">${banner}${checklist()}${items()}${docCard('lessons_learned', 'clLL', 'cl_ll_h', 'cl_ll_p', 'cl_doc_write_ll')}${docCard('completion_certificate', 'clCert', 'cl_cert_h', 'cl_cert_p', 'cl_doc_write_cert')}${history()}</div></div>`;
      bind();
    }

    // ---------- actions ----------
    const put = (id, body) => api('PUT', `/api/items/${id}`, body);
    const rowOf = (id) => c.scope.rows.find((r) => r.id === Number(id));
    // what to send to put an item back exactly as it was
    const restoreBody = (r) => (r.outcome === 'not_delivered' ? { state: 'closed', data: { outcome: 'not_delivered', not_delivered_reason: r.reason } } : r.outcome === 'delivered' ? { state: 'closed', data: { outcome: 'delivered' } } : { state: r.state });
    const undoFor = (prev) => ({ label: t('cl_undo'), fn: async () => { try { for (const r of prev) await put(r.id, restoreBody(r)); await reload(); } catch (e) { toast(e.message, 'err'); } } });

    function notDeliveredDialog(r) {
      const prev = { ...r };
      PM.askNotDelivered(r, async () => { await reload(); toast(t('cl_updated'), 'ok', undoFor([prev])); });
    }

    async function setOutcome(id, kind) {
      const r = rowOf(id); if (!r) return;
      const prev = { ...r };
      try {
        await put(r.id, kind === 'deliver' ? { state: 'closed', data: { outcome: 'delivered' } } : { state: 'open' });
        await reload(); toast(t('cl_updated'), 'ok', undoFor([prev]));
      } catch (e) { toast(e.message, 'err'); }
    }

    async function writeDoc(btn, type) {
      const ok = await busy(btn, async () => {
        const r = await api('POST', `/api/projects/${p.id}/generate`, { type, format: 'docx' });
        const g = (await api('GET', `/api/generated/${r.generated.id}`)).generated;
        await reload();
        toast(t('cl_doc_done'), 'ok');
        return g;
      });
      // the lessons learned report has sections only the project manager can write, so it opens for editing
      if (ok && type === 'lessons_learned' && PM.docEditor) PM.docEditor.open(ok, { onSaved: () => reload(), onTemplate: () => reload() });
    }

    function bind() {
      $$('[data-deliver]', root).forEach((b) => (b.onclick = () => setOutcome(b.dataset.deliver, 'deliver')));
      $$('[data-reopen]', root).forEach((b) => (b.onclick = () => setOutcome(b.dataset.reopen, 'reopen')));
      $$('[data-not]', root).forEach((b) => (b.onclick = () => notDeliveredDialog(rowOf(b.dataset.not))));
      const more = $('#clMore', root); if (more) more.onclick = () => { ui.all = !ui.all; try { sessionStorage.setItem(allKey, ui.all ? '1' : '0'); } catch (e) { /* optional */ } draw(); };
      const all = $('#clAll', root);
      if (all) all.onclick = async () => {
        const open = c.scope.rows.filter((r) => r.outcome === 'open');
        if (!await confirmDlg({ title: t('cl_all_q'), message: t('cl_all_msg'), ok: t('cl_all_ok') })) return;
        const prev = open.map((r) => ({ ...r }));
        try { for (const r of open) await put(r.id, { state: 'closed', data: { outcome: 'delivered' } }); await reload(); toast(t('cl_updated'), 'ok', undoFor(prev)); } catch (e) { toast(e.message, 'err'); await reload(); }
      };
      $$('[data-write]', root).forEach((b) => (b.onclick = () => writeDoc(b, b.dataset.write)));
      $$('[data-open]', root).forEach((b) => (b.onclick = async () => { const g = (await api('GET', `/api/generated/${b.dataset.open}`)).generated; PM.docEditor.open(g, { onSaved: () => reload(), onTemplate: () => reload() }); }));
      $$('[data-dl]', root).forEach((b) => (b.onclick = async () => { await busy(b, async () => { await PM.downloadGenerated(b.dataset.dl); toast(t('download_ready'), 'ok'); }); }));
      const by = $('#clBy', root), on = $('#clOn', root), sv = $('#clAccSave', root);
      if (sv) {
        const dirty = () => { sv.disabled = (by.value.trim() === c.accepted_by) && (on.value === c.accepted_on); };
        by.oninput = dirty; on.onchange = dirty; on.oninput = dirty;
        sv.onclick = async () => {
          const ok = await busy(sv, async () => { c = await api('PUT', `/api/projects/${p.id}/closure`, { accepted_by: by.value, accepted_on: on.value }); return true; });
          if (ok) { draw(); toast(t('cl_acc_saved'), 'ok'); }
        };
      }
      const both = $('#clBoth', root);
      if (both) both.onclick = async () => {
        const ok = await busy(both, async () => { for (const type of ['lessons_learned', 'completion_certificate']) { const d = c.documents[type]; if (!d || !d.current) await api('POST', `/api/projects/${p.id}/generate`, { type, format: 'docx' }); } return true; });
        if (ok) { await reload(); toast(t('cl_both_done'), 'ok'); }
      };
      const close = $('#clClose', root);
      if (close) close.onclick = async () => {
        const skip = (c.skipped || []).map((k) => t('cl_n_' + (k === 'items_review' ? 'review' : k))).join(', ');
        if (!await confirmDlg({ title: t('cl_close_q'), message: t('cl_close_msg', { d: c.scope.counts.delivered, n: c.scope.counts.not_delivered }) + (skip ? ' ' + t('cl_skip_msg', { list: skip }) : ''), ok: t('cl_close') })) return;
        const ok = await busy(close, async () => { await api('POST', `/api/projects/${p.id}/close`); return true; });
        if (!ok) { await reload(); return; }
        await refreshHead();
        toast(t('cl_closed_toast'), 'ok', { label: t('cl_undo'), fn: async () => { try { await api('POST', `/api/projects/${p.id}/reopen`, { reason: t('cl_undo_reason') }); await refreshHead(); } catch (e) { toast(e.message, 'err'); } } });
      };
      const re = $('#clReopen', root);
      if (re) re.onclick = () => {
        const m = modal({ title: t('cl_reopen_title'), size: 'md', body: `<p class="small muted" style="margin:0 0 10px">${t('cl_reopen_hint')}</p><label class="f">${t('cl_reopen_reason')}<textarea id="clRe" rows="3" maxlength="400"></textarea><span class="small" id="clReErr" role="alert" style="color:var(--danger)"></span></label>`,
          footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="clReGo">${t('cl_reopen')}</button>` });
        m.$('#clRe').focus();
        m.$('#clReGo').onclick = async () => {
          const reason = m.$('#clRe').value.trim();
          if (reason.length < 3) { m.$('#clReErr').textContent = t('cl_reopen_need'); return; }
          const ok = await busy(m.$('#clReGo'), async () => { await api('POST', `/api/projects/${p.id}/reopen`, { reason }); return true; });
          if (!ok) return;
          m.close(); await refreshHead(); toast(t('cl_reopened'), 'ok');
        };
      };
    }
    if (PM.stale(token)) return;
    draw();
  };
})();
