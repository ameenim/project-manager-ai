/* Overview, Inbox, Documents, Reports and Settings tabs. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, modal, confirmDlg, busy, dropzone, state: S } = PM;
  const stale = (tk) => PM.stale(tk);
  const stateChip = (s) => `<span class="chip ${['closed', 'paid', 'mitigated'].includes(s) ? 'green' : ['invoiced'].includes(s) ? 'blue' : ''}">${t('state_' + s)}</span>`;
  const when = (ts) => esc(String(ts || '').replace('T', ' ').slice(0, 16));

  // ================= Overview =================
  PM.views.tab_overview = async function (root, p, q, token) {
    const [items, sched, audit] = await Promise.all([api('GET', `/api/projects/${p.id}/items`), api('GET', `/api/projects/${p.id}/schedule`), api('GET', `/api/projects/${p.id}/audit`)]);
    if (stale(token)) return;
    const live = items.items.filter((i) => i.status !== 'ignored');
    const del = live.filter((i) => i.kind === 'deliverable');
    const ms = live.filter((i) => i.kind === 'milestone');
    const risks = live.filter((i) => i.kind === 'risk' && i.state !== 'closed');
    const st = p.stats;
    const closed = del.filter((d) => d.state === 'closed').length;
    const phases = sched.tasks.filter((x) => !x.parent_id).slice(0, 10);
    const sev = (r) => ({ High: 3, Medium: 2, Low: 1 }[r.data.probability] || 2) * ({ High: 3, Medium: 2, Low: 1 }[r.data.impact] || 2);
    const topRisks = [...risks].sort((a, b) => sev(b) - sev(a)).slice(0, 5);
    const paid = ms.filter((m) => m.state === 'paid').length, inv = ms.filter((m) => m.state === 'invoiced').length;
    const amt = (m) => m.data.amount ?? (m.data.percent != null && p.value ? Math.round((p.value * m.data.percent) / 100) : 0);
    const paidSum = ms.filter((m) => m.state === 'paid').reduce((a, m) => a + amt(m), 0);
    const kpi = (v, l, sub = '') => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
    const late = st.forecast_end && p.end_date && st.forecast_end > p.end_date;
    root.innerHTML = `<div class="page">
      ${st.pendingItems ? `<div class="banner mb">${icon('spark')}<div class="grow"><b>${t('items_waiting', { n: st.pendingItems })}</b></div><a class="btn primary" href="#/p/${p.id}/review">${t('review_now')}</a></div>` : ''}
      ${st.pendingInbox ? `<div class="banner mb">${icon('inbox')}<div class="grow"><b>${t('updates_waiting', { n: st.pendingInbox })}</b></div><a class="btn primary" href="#/p/${p.id}/inbox">${t('review_now')}</a></div>` : ''}
      <div class="grid g4">${kpi(`${st.progress}%`, t('progress'), st.planned != null ? `${t('planned')} ${st.planned}%` : t('no_baseline'))}${kpi(st.spi != null ? st.spi.toFixed(2) : '-', t('spi'), st.spi == null ? t('set_baseline_hint') : st.spi >= 0.95 ? t('on_track') : t('behind_plan'))}
        ${kpi(`<span style="font-size:var(--fs-title)">${st.forecast_end || '-'}</span>`, t('forecast_end'), p.end_date ? `${t('contract_end')} ${p.end_date}${late ? ` · <span style="color:var(--danger)">${t('later_than_contract')}</span>` : ''}` : '')}${kpi(st.overdue, t('overdue'), `${st.tasks} ${t('tasks')}`)}</div>
      <div class="grid g-main mt"><div class="col gap-lg">
        <div class="card"><div class="card-head"><h3>${t('phases')}</h3><a class="small" href="#/p/${p.id}/schedule">${t('open_schedule')}</a></div>${phases.length ? phases.map((x) => `<div style="margin-bottom:12px"><div class="row small"><span class="grow" style="font-weight:600">${esc(x.name)}</span><span class="muted">${x.start} to ${x.finish}</span><span style="width:40px;text-align:end">${x.progress}%</span></div><div class="progress ${x.progress >= 100 ? 'green' : ''}"><i style="width:${x.progress}%"></i></div></div>`).join('') : `<div class="empty small">${t('no_tasks')}</div>`}</div>
        <div class="card"><div class="card-head"><h3>${t('deliverables')}</h3><span class="chip ${closed === del.length && del.length ? 'green' : ''}">${closed} / ${del.length}</span></div>${del.length ? `<div class="table-wrap"><table class="t"><tbody>${del.map((d) => `<tr><td><b>${esc(d.title)}</b>${d.evidence_name ? `<div class="small muted">${icon('file')} ${esc(d.evidence_name)}</div>` : ''}</td><td class="nowrap">${d.data.due_date || ''}</td><td>${stateChip(d.state)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty small">${t('nothing_here')}</div>`}</div>
        <div class="card"><div class="card-head"><h3>${t('payment_milestones')}</h3><span class="chip">${paid} ${t('state_paid')} · ${inv} ${t('state_invoiced')} · ${ms.length} ${t('total')}</span></div>${ms.length ? `<div class="table-wrap"><table class="t"><tbody>${ms.map((m) => `<tr><td><b>${esc(m.title)}</b></td><td>${m.data.percent != null ? m.data.percent + '%' : ''}</td><td class="nowrap">${amt(m) ? money(amt(m), p.currency) : ''}</td><td class="nowrap">${m.data.due_date || ''}</td><td>${stateChip(m.state)}</td></tr>`).join('')}</tbody></table></div><div class="small muted mt">${t('paid_so_far')}: <b>${money(paidSum, p.currency)}</b> ${p.value ? `${t('of')} ${money(p.value, p.currency)}` : ''}</div>` : `<div class="empty small">${t('nothing_here')}</div>`}</div></div>
      <div class="col gap-lg"><div class="card"><div class="card-head"><h3>${t('top_risks')}</h3><a class="small" href="#/p/${p.id}/review?kind=risk">${t('all')}</a></div>${topRisks.length ? topRisks.map((r) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(r.title)}</div>${r.data.mitigation ? `<div class="small muted">${esc(r.data.mitigation)}</div>` : ''}</div><span class="chip ${sev(r) >= 6 ? 'red' : 'amber'}">${t('lv_' + (r.data.probability || 'Medium'))}</span></div>`).join('') : `<div class="empty small">${t('nothing_here')}</div>`}</div>
        <div class="card"><div class="card-head"><h3>${t('recent_activity')}</h3></div>${audit.audit.slice(0, 10).map((a) => `<div class="list-item"><div class="grow"><div class="small">${esc(a.detail.summary || a.action)}</div><div class="small faint">${esc(a.actor)} · ${when(a.ts)}</div></div></div>`).join('') || `<div class="empty small">${t('nothing_here')}</div>`}</div></div></div></div>`;
  };

  // ================= Updates (inbox) =================
  // Messages and documents become suggested changes. The PM reviews each one and applies, edits or dismisses it.
  PM.views.tab_inbox = async function (root, p, q, token) {
    let rows = (await api('GET', `/api/projects/${p.id}/inbox`)).inbox;
    let filter = 'pending', src = 'all';
    const SRC = { teams: 'chat', email: 'mail', jira: 'jira', upload: 'file', manual: 'edit' };
    const FIL = { pending: ['pending'], applied: ['applied', 'auto_applied'], other: ['dismissed', 'undone', 'no_action'] };
    const ACT = { update_task: 'cal', close_deliverable: 'check', milestone_invoiced: 'coin', milestone_paid: 'coin', flag_issue: 'alert' };
    let guide = true; try { guide = localStorage.getItem('pm_upd_guide') !== 'off'; } catch (e) { /* storage blocked */ }
    const reload = async () => { rows = (await api('GET', `/api/projects/${p.id}/inbox`)).inbox; S.project = (await api('GET', `/api/projects/${p.id}`)).project; draw(); };
    const level = (c) => (c == null ? null : c >= 0.8 ? 'hi' : c >= 0.65 ? 'mid' : 'lo');
    const conf = (c) => (c == null ? '' : `<span class="conf ${level(c)}" data-tip="${esc(t('upd_conf_tip', { n: Math.round(c * 100) }))}">${t('upd_conf_' + level(c))} ${Math.round(c * 100)}%</span>`);
    const completes = (r) => !!(r.action && r.action.type === 'update_task' && r.action.progress >= 100);
    const safe = (r) => r.status === 'pending' && r.action && (r.confidence || 0) >= 0.8 && !completes(r) && r.action.type !== 'flag_issue';
    const srcLabel = (k) => t('src_' + k) === 'src_' + k ? k : t('src_' + k);

    function card(r) {
      const done = r.status === 'applied' || r.status === 'auto_applied', pend = r.status === 'pending', a = r.action || {};
      const text = (r.body || '').replace(/\s+/g, ' ').trim(), long = text.length > 220;
      const pm = /(\d+)% to (\d+)%/.exec((done ? a.summary : r.summary) || '');
      const bar = pm && a.type === 'update_task' ? `<div class="upd-bar"><span class="small muted">${pm[1]}%</span><div class="progress"><i style="width:${pm[2]}%"></i></div><b class="small">${pm[2]}%</b></div>` : '';
      const kind = a.type && t('upd_type_' + a.type) !== 'upd_type_' + a.type ? t('upd_type_' + a.type) : t('upd_type_note');
      const none = r.status === 'no_action' || r.status === 'unassigned' || !r.action;
      return `<article class="upd ${r.status}" data-id="${r.id}">
        <header class="upd-h"><span class="upd-src s-${esc(r.source)}">${icon(SRC[r.source] || 'mail')}</span><div class="grow"><b>${esc(srcLabel(r.source))}</b>${r.resource || r.sender ? ` <span class="muted">${t('upd_from')} ${esc(r.resource || r.sender)}</span>` : ''}${r.doc_name ? ` <span class="chip gray">${icon('file')}${esc(r.doc_name)}</span>` : ''}</div><span class="small muted nowrap">${when(r.created_at)}</span></header>
        <blockquote class="upd-msg ${long ? 'clamp' : ''}">${r.subject ? `<b>${esc(r.subject)}</b> ` : ''}${esc(text)}</blockquote>${long ? `<button type="button" class="upd-more" data-more="${r.id}">${t('upd_more')}</button>` : ''}
        <div class="upd-act ${none ? 'none' : done ? 'done' : ''}"><span class="upd-ic">${icon(none ? 'check' : ACT[a.type] || 'spark')}</span><div class="grow"><div class="small muted">${none ? t('upd_no_change') : done ? t('upd_applied_what') : t('upd_will')}</div><div><b>${esc(none ? r.summary || t('upd_nothing') : done ? a.summary || r.summary : r.summary || kind)}</b></div>${bar}</div>${pend ? conf(r.confidence) : `<span class="chip ${done ? 'green' : 'gray'}">${t('inb_' + r.status)}</span>`}</div>
        <footer class="upd-f">${pend && r.action ? `<button class="btn good" data-apply="${r.id}">${icon('check')}${t('upd_apply')}</button>${a.type === 'update_task' && a.progress != null ? `<button class="btn" data-edit="${r.id}">${icon('edit')}${t('edit')}</button>` : ''}` : ''}${pend ? `<button class="btn ghost" data-dismiss="${r.id}">${t('upd_dismiss')}</button>` : ''}${done ? `<button class="btn" data-undo="${r.id}">${icon('undo')}${t('undo')}</button>` : ''}${r.status === 'dismissed' || r.status === 'undone' ? `<button class="btn" data-restore="${r.id}">${t('upd_restore')}</button>` : ''}${a.task_id ? `<a class="upd-link" href="#/p/${p.id}/schedule">${t('upd_open_schedule')}</a>` : ''}${pend && completes(r) ? `<span class="small muted grow" style="text-align:end">${icon('alert')} ${t('upd_review_first')}</span>` : ''}</footer></article>`;
    }

    function draw() {
      if (stale(token)) return;
      const st = S.status || {};
      const inStatus = (k) => rows.filter((r) => FIL[k].includes(r.status));
      const bySrc = rows.filter((r) => !FIL[filter] || FIL[filter].includes(r.status));
      const list = bySrc.filter((r) => src === 'all' || r.source === src);
      const srcs = [...new Set(rows.map((r) => r.source))];
      const safeN = rows.filter(safe).length;
      const stat = (k, label, hint, ic2) => `<button type="button" class="upd-stat ${filter === k ? 'on' : ''} ${k}" data-f="${k}"><span class="upd-stat-ic">${icon(ic2)}</span><span class="grow"><b>${inStatus(k).length}</b><span>${t(label)}</span></span></button>`;
      const conn = (name, ic2, on, kind) => `<span class="upd-conn ${on ? 'on' : ''}">${icon(ic2)}<b>${name}</b>${on ? `<i>${t('connected')}</i>` : `<button type="button" class="btn sm" data-conn="${kind}">${t('upd_connect')}</button>`}</span>`;
      const empty = filter === 'pending' && !rows.length
        ? `<div class="upd-empty"><div class="upd-empty-ic">${icon('inbox')}</div><h3>${t('upd_empty_title')}</h3><p class="muted">${t('upd_empty_body')}</p><div class="row wrap" style="justify-content:center;gap:8px"><button class="btn primary" data-add>${icon('plus')}${t('upd_add')}</button><button class="btn" data-sync>${icon('refresh')}${t('sync_now')}</button></div></div>`
        : filter === 'pending' ? `<div class="upd-empty small"><div class="upd-empty-ic ok">${icon('check')}</div><h3>${t('upd_caught_up')}</h3><p class="muted">${t('upd_caught_body')}</p></div>` : `<div class="empty">${t('nothing_here')}</div>`;
      root.innerHTML = `<div class="page upd-page">
        <div class="upd-head"><div class="grow"><h2>${t('tab_inbox')}</h2><div class="muted">${t('upd_lead')}</div></div>
          <button class="btn" data-sync id="syncBtn">${icon('refresh')}${t('sync_now')}</button><button class="btn primary" data-add>${icon('plus')}${t('upd_add')}</button></div>
        ${guide ? `<div class="upd-guide" role="note"><ol><li><span>1</span><div><b>${t('upd_g1_t')}</b><div class="small muted">${t('upd_g1_b')}</div></div></li><li><span>2</span><div><b>${t('upd_g2_t')}</b><div class="small muted">${t('upd_g2_b')}</div></div></li><li><span>3</span><div><b>${t('upd_g3_t')}</b><div class="small muted">${t('upd_g3_b')}</div></div></li></ol><button type="button" class="btn ghost icon sm" data-hide-guide aria-label="${t('close')}" data-tip="${t('upd_hide_guide')}">${icon('x')}</button></div>` : ''}
        ${p.auto_apply ? `<div class="banner ok mb small">${icon('spark')}<div>${t('auto_on', { n: Math.round(p.auto_threshold * 100) })} <a href="#/p/${p.id}/settings">${t('change')}</a></div></div>` : ''}
        <div class="upd-stats">${stat('pending', 'upd_s_waiting', '', 'inbox')}${stat('applied', 'upd_s_applied', '', 'check')}${stat('other', 'upd_s_other', '', 'x')}<div class="upd-conns">${conn('Teams', 'chat', st.graph, 'outlook')}${conn('Outlook', 'mail', st.graph, 'outlook')}${conn('Jira', 'jira', st.jira, 'jira')}</div></div>
        <div class="upd-bar2"><div class="row wrap grow" style="gap:6px"><span class="small muted">${t('upd_source')}</span>${['all', ...srcs].map((k) => `<button type="button" class="filter-chip ${src === k ? 'on' : ''}" data-src="${k}">${k === 'all' ? t('all') : esc(srcLabel(k))}${k !== 'all' ? ` <b>${bySrc.filter((r) => r.source === k).length}</b>` : ''}</button>`).join('')}</div>
          ${filter === 'pending' && safeN ? `<button class="btn good" data-all>${icon('check')}${t('upd_apply_safe', { n: safeN })}</button>` : ''}</div>
        <div class="upd-list">${list.length ? list.map(card).join('') : empty}</div></div>`;

      $$('[data-f]', root).forEach((c) => (c.onclick = () => { filter = c.dataset.f; src = 'all'; draw(); }));
      $$('[data-src]', root).forEach((c) => (c.onclick = () => { src = c.dataset.src; draw(); }));
      $$('[data-hide-guide]', root).forEach((c) => (c.onclick = () => { guide = false; try { localStorage.setItem('pm_upd_guide', 'off'); } catch (e) { /* ignore */ } draw(); }));
      $$('[data-more]', root).forEach((c) => (c.onclick = () => { const bq = c.previousElementSibling; const open = bq.classList.toggle('clamp') === false; c.textContent = t(open ? 'upd_less' : 'upd_more'); }));
      $$('[data-conn]', root).forEach((c) => (c.onclick = () => PM.connect.wizard(c.dataset.conn, async () => { try { S.status = (await api('GET', '/api/me')).status; } catch (e) { /* ignore */ } draw(); })));
      $$('[data-add]', root).forEach((c) => (c.onclick = addDialog));
      $$('[data-sync]', root).forEach((c) => (c.onclick = () => sync(c)));
      $$('[data-apply]', root).forEach((b) => (b.onclick = async () => {
        const r = rows.find((x) => x.id === Number(b.dataset.apply));
        await applyRow(r, null, b);
      }));
      $$('[data-dismiss]', root).forEach((b) => (b.onclick = async () => { await busy(b, () => api('POST', `/api/inbox/${b.dataset.dismiss}/dismiss`)); toast(t('upd_dismissed'), '', { label: t('undo'), fn: async () => { await api('POST', `/api/inbox/${b.dataset.dismiss}/restore`).catch(() => {}); reload(); } }); reload(); }));
      $$('[data-undo]', root).forEach((b) => (b.onclick = async () => { await busy(b, () => api('POST', `/api/inbox/${b.dataset.undo}/undo`)); toast(t('undone'), 'ok'); reload(); }));
      $$('[data-restore]', root).forEach((b) => (b.onclick = async () => { await busy(b, () => api('POST', `/api/inbox/${b.dataset.restore}/restore`)); filter = 'pending'; reload(); }));
      $$('[data-edit]', root).forEach((b) => (b.onclick = () => {
        const r = rows.find((x) => x.id === Number(b.dataset.edit));
        const m = modal({ title: t('edit_suggestion'), body: `<p class="muted" style="margin-top:0">${esc(r.summary)}</p><label class="f">${t('progress')} %<input type="number" id="ovProg" min="0" max="100" value="${r.action.progress}"></label>`, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="ovOk">${t('upd_apply')}</button>` });
        m.$('#ovOk').onclick = async () => { const v = Number(m.$('#ovProg').value); m.close(); await applyRow(r, { progress: v }, null); };
      }));
      const all = $('[data-all]', root);
      if (all) all.onclick = async () => {
        const todo = rows.filter(safe);
        if (!(await PM.confirmDlg({ title: t('upd_apply_safe', { n: todo.length }), message: t('upd_apply_safe_q', { n: todo.length }), ok: t('upd_apply') }))) return;
        let n = 0; await busy(all, async () => { for (const r of todo) { try { await api('POST', `/api/inbox/${r.id}/apply`, {}); n++; } catch (e) { /* skip */ } } });
        toast(t('upd_applied_n', { n }), 'ok'); reload();
      };
    }

    // applying a suggestion that finishes a task offers to close the deliverable and invoice the payment, like the schedule does
    async function applyRow(r, override, btn) {
      const a = { ...(r.action || {}), ...(override || {}) };
      let ops = [];
      if (a.type === 'update_task' && a.progress >= 100 && a.task_id) {
        ops = await PM.completion.flow(p.id, { [a.task_id]: { progress: a.progress } }, null, p.currency);
        if (ops === null) return;
      }
      const res = await busy(btn, () => api('POST', `/api/inbox/${r.id}/apply`, override ? { override } : {}));
      if (!res) return;
      if (ops.length) await PM.completion.commit(ops);
      toast(res.summary + (ops.length ? ` ${t('upd_and_linked')}` : ''), 'ok', { label: t('undo'), fn: async () => { await api('POST', `/api/inbox/${r.id}/undo`); if (ops.length) await PM.completion.revert(ops); reload(); } });
      reload();
    }

    function addDialog() {
      const m = modal({ title: t('upd_add_title'), size: 'lg', body: `<p class="muted" style="margin-top:0">${t('upd_add_intro')}</p>
        <div class="form-grid"><label class="f">${t('source')}<select id="msgSrc"><option value="teams">Teams</option><option value="email">Email</option><option value="jira">Jira</option><option value="manual">${t('other')}</option></select></label><label class="f">${t('from')}<input type="text" id="msgFrom" placeholder="${t('from_ph')}"></label>
        <label class="f full">${t('message')}<textarea id="msgBody" rows="6" placeholder="${esc(t('upd_add_ph'))}"></textarea></label></div>`,
        footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="msgGo">${icon('spark')}${t('upd_analyze')}</button>` });
      setTimeout(() => m.$('#msgBody').focus(), 40);
      m.$('#msgGo').onclick = async () => {
        const body = m.$('#msgBody').value.trim();
        if (!body) { m.$('#msgBody').focus(); return; }
        const r = await busy(m.$('#msgGo'), () => api('POST', `/api/projects/${p.id}/messages`, { source: m.$('#msgSrc').value, sender: m.$('#msgFrom').value, body }));
        if (r) { m.close(); toast(t('msg_analyzed', { n: r.rows }), 'ok'); filter = 'pending'; src = 'all'; reload(); }
      };
    }

    async function sync(btn) {
      const r = await busy(btn, () => api('POST', `/api/projects/${p.id}/sync`, {}));
      if (!r) return;
      const done = Object.entries(r.report).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(', ');
      const errs = Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join('\n');
      toast(done ? t('sync_done', { d: done }) : t('sync_none'), done ? 'ok' : '');
      if (errs && !done) modal({ title: t('sync_now'), body: `<p>${t('sync_help')}</p><pre style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:8px">${esc(errs)}</pre><p class="small muted">${t('sync_webhook_hint')}</p>`, footer: `<button class="btn primary" data-close>${t('close')}</button>` });
      reload();
    }
    draw();
  };

  // ================= Documents =================
  PM.views.tab_documents = async function (root, p, q, token) {
    let files = [];
    let purpose = 'auto';
    let docs = (await api('GET', `/api/projects/${p.id}/documents`)).documents;
    const delivs = (await api('GET', `/api/projects/${p.id}/items?kind=deliverable`)).items.filter((i) => i.status !== 'ignored');
    const reload = async () => { docs = (await api('GET', `/api/projects/${p.id}/documents`)).documents; draw(); };
    function draw() {
      if (stale(token)) return;
      root.innerHTML = `<div class="page"><div class="grid g-main"><div class="card"><div class="card-head"><h3>${t('project_documents')}</h3><button class="btn sm" id="reAn">${icon('refresh')}${t('reanalyze')}</button></div>
        ${docs.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>${t('col_name')}</th><th>${t('type')}</th><th>${t('uploaded')}</th><th></th></tr></thead><tbody>${docs.map((d) => `<tr><td><b>${esc(d.filename)}</b>${d.summary && !/^Rule based/.test(d.summary) ? `<div class="small muted">${esc(d.summary)}</div>` : ''}</td><td><span class="chip blue">${t('dk_' + d.kind)}</span></td><td class="small muted nowrap">${when(d.created_at)}<br>${esc(d.uploaded_by || '')}</td>
          <td class="nowrap right"><button class="btn sm icon" data-dl="${d.id}" data-name="${esc(d.filename)}" title="${t('download')}">${icon('dl')}</button> <select data-link="${d.id}" style="width:150px;padding:4px 6px;display:inline-block" title="${t('link_evidence')}"><option value="">${t('link_evidence')}</option>${delivs.filter((x) => x.state !== 'closed').map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select> <button class="btn sm icon ghost" data-del="${d.id}" title="${t('delete')}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('no_docs')}</div>`}</div>
        <div class="card"><div class="card-head"><h3>${t('upload_docs')}</h3></div><label class="f" style="margin-bottom:12px">${t('upload_purpose')}<select id="purpose"><option value="auto">${t('purpose_auto')}</option><option value="source">${t('purpose_source')}</option><option value="progress">${t('purpose_progress')}</option></select></label><div id="dz"></div><div class="filelist" id="fl"></div>
        <button class="btn primary mt" id="upGo" style="width:100%;justify-content:center" ${files.length ? '' : 'disabled'}>${icon('upload')}${t('upload_analyze')}</button><div class="small muted mt">${t('upload_help')}</div></div></div></div>`;
      $('#purpose', root).value = purpose;
      $('#purpose', root).onchange = (e) => (purpose = e.target.value);
      dropzone($('#dz', root), { accept: '.pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.xml,.mpp', onFiles: (f) => { files = files.concat(f); list(); } });
      const list = () => { $('#fl', root).innerHTML = files.map((f, i) => `<div class="fi">${icon('file')}<span class="grow">${esc(f.name)}</span><button class="btn ghost icon sm" data-rm="${i}">${icon('x')}</button></div>`).join(''); $('#upGo', root).disabled = !files.length; $$('[data-rm]', root).forEach((b) => (b.onclick = () => { files.splice(Number(b.dataset.rm), 1); list(); })); };
      list();
      $('#upGo', root).onclick = async () => {
        const fd = new FormData(); fd.append('purpose', purpose); files.forEach((f) => fd.append('files', f));
        const r = await busy($('#upGo', root), () => api('POST', `/api/projects/${p.id}/documents`, fd));
        if (!r) return;
        files = [];
        const prog = r.results.filter((x) => x.handled === 'progress');
        const failed = r.results.filter((x) => x.handled === 'failed');
        if (failed.length) toast(failed.map((x) => `${x.filename}: ${x.error}`).join(' '), 'err');
        if (failed.length === r.results.length) { reload(); return; }
        if (!failed.length) toast(prog.length ? t('upload_done_progress', { n: prog.reduce((a, x) => a + x.suggestions, 0) }) : t('upload_done_source'), 'ok');
        if (prog.length) location.hash = `#/p/${p.id}/inbox`; else location.hash = `#/p/${p.id}/review`;
      };
      $('#reAn', root).onclick = async () => { const r = await busy($('#reAn', root), () => api('POST', `/api/projects/${p.id}/analyze`)); if (r) { toast(t('reanalyzed'), 'ok'); location.hash = `#/p/${p.id}/review`; } };
      $$('[data-dl]', root).forEach((b) => (b.onclick = () => PM.download(`/api/projects/${p.id}/documents/${b.dataset.dl}/file`, b.dataset.name)));
      $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_doc'), ok: t('delete'), danger: true })) { await busy(null, () => api('DELETE', `/api/projects/${p.id}/documents/${b.dataset.del}`)); reload(); } }));
      $$('[data-link]', root).forEach((s) => (s.onchange = async () => { if (!s.value) return; const r = await busy(null, () => api('POST', `/api/projects/${p.id}/documents/${s.dataset.link}/link`, { deliverable_id: Number(s.value) })); if (r) { toast(r.summary, 'ok'); reload(); } }));
    }
    draw();
  };

  // ================= Reports =================
  const FMT = [['docx', 'Word', 'out_word'], ['xlsx', 'Excel', 'out_excel'], ['pptx', 'PowerPoint', 'out_ppt']];
  PM.views.tab_reports = async function (root, p, q, token) {
    const types = (await api('GET', '/api/doc-types')).types;
    let templates = (await api('GET', '/api/templates')).templates;
    let gen = (await api('GET', `/api/projects/${p.id}/generated`)).generated;
    let type = sessionStorage.getItem('rp_type') || 'progress_weekly';
    let out = sessionStorage.getItem('rp_out') || 'docx';
    const reload = async () => { templates = (await api('GET', '/api/templates')).templates; gen = (await api('GET', `/api/projects/${p.id}/generated`)).generated; draw(); };
    function draw() {
      if (stale(token)) return;
      const isProg = type.startsWith('progress');
      const tpls = templates.filter((x) => x.doc_type === type);
      const opt = (ts) => ts.map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join('');
      const titleOf = (id) => (types.find((x) => x.id === id) || {}).title || id;
      root.innerHTML = `<div class="page"><div class="grid g-main"><div class="col gap-lg"><div class="card"><div class="card-head"><h3>${t('create_document')}</h3></div>
        <div class="form-grid"><label class="f full">${t('doc_type')}<select id="rpType"><optgroup label="${t('grp_progress')}">${opt(types.filter((x) => x.progress))}</optgroup><optgroup label="${t('grp_project')}">${opt(types.filter((x) => !x.progress))}</optgroup></select></label>
        <label class="f full">${t('template')}<select id="rpTpl"><option value="">${t('tpl_default')}</option>${tpls.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
        <label class="f full">${t('doc_output')}<select id="rpOut"><option value="docx">${t('out_word')}</option><option value="xlsx">${t('out_excel')}</option><option value="pptx">${t('out_ppt')}</option></select></label>
        ${isProg ? `<label class="f">${t('as_of')}<input type="date" id="rpAsOf" value="${PM.today()}"></label><label class="f">${t('period')}<select id="rpPeriod"><option value="7" ${type === 'progress_weekly' ? 'selected' : ''}>${t('days_n', { n: 7 })}</option><option value="14" ${type === 'progress_biweekly' ? 'selected' : ''}>${t('days_n', { n: 14 })}</option><option value="30">${t('days_n', { n: 30 })}</option></select></label>` : ''}
        <div class="full small muted">${isProg ? t('progress_report_hint') : t('project_doc_hint')}${S.status.claude ? '' : ` ${t('ai_rules_note')}`}</div></div>
        <div class="row mt"><button class="btn primary" id="rpGo">${icon('spark')}${t('generate')}</button></div></div>
        <div class="card"><div class="card-head"><h3>${t('generated_docs')}</h3></div>${gen.length ? gen.map((g) => `<div class="list-item"><div class="avatar" style="border-radius:8px">${icon('file')}</div><div class="grow"><div style="font-weight:600">${esc(g.title)}</div><div class="small muted">${esc(g.template)} · ${when(g.created_at)}</div></div><button class="btn sm" data-open="${g.id}">${icon('eye')}${t('open')}</button>${FMT.map((f) => `<button class="btn sm ${out === f[0] ? 'primary' : ''}" data-dl-fmt="${f[0]}" data-id="${g.id}" data-name="${esc(p.name + ' ' + g.title)}.${f[0]}" title="${t(f[2])}">${icon('dl')}${f[1]}</button>`).join('')}<button class="btn sm ghost icon" data-gdel="${g.id}">${icon('trash')}</button></div>`).join('') : `<div class="empty small">${t('no_generated')}</div>`}</div></div>
        <div class="card"><div class="card-head"><h3>${t('custom_templates')}</h3><button class="btn sm" id="tplNew">${icon('plus')}${t('new_template')}</button></div><div class="small muted mb">${t('template_help')}</div>${templates.length ? templates.map((x) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.name)}</div><div class="small muted">${esc(titleOf(x.doc_type))}</div></div><button class="btn sm ghost icon" data-tdel="${x.id}">${icon('trash')}</button></div>`).join('') : `<div class="empty small">${t('no_templates')}</div>`}</div></div>`;
      $('#rpType', root).value = type;
      $('#rpOut', root).value = out; $('#rpOut', root).onchange = (e) => { out = e.target.value; sessionStorage.setItem('rp_out', out); draw(); };
      $('#rpType', root).onchange = (e) => { type = e.target.value; sessionStorage.setItem('rp_type', type); draw(); };
      $('#rpGo', root).onclick = async () => {
        const body = { type, template_id: $('#rpTpl', root).value || null };
        if (type.startsWith('progress')) { body.as_of = $('#rpAsOf', root).value; body.period_days = Number($('#rpPeriod', root).value); }
        const r = await busy($('#rpGo', root), () => api('POST', `/api/projects/${p.id}/generate`, body));
        if (r) { if (r.unconfirmed) toast(t('unconfirmed_note', { n: r.unconfirmed })); await reload(); openDoc(r.generated.id); }
      };
      $$('[data-open]', root).forEach((b) => (b.onclick = () => openDoc(Number(b.dataset.open))));
      $$('[data-dl-fmt]', root).forEach((b) => (b.onclick = () => PM.download(`/api/generated/${b.dataset.id}/${b.dataset.dlFmt}`, b.dataset.name)));
      $$('[data-gdel]', root).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_doc'), ok: t('delete'), danger: true })) { await api('DELETE', `/api/generated/${b.dataset.gdel}`); reload(); } }));
      $$('[data-tdel]', root).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_tpl'), ok: t('delete'), danger: true })) { await api('DELETE', `/api/templates/${b.dataset.tdel}`); reload(); } }));
      $('#tplNew', root).onclick = () => templateDialog(types, type, reload);
    }

    async function openDoc(id) {
      const g = (await api('GET', `/api/generated/${id}`)).generated;
      let editing = false;
      const m = modal({ title: g.title, size: 'xl', body: '<div id="docBody"></div>', footer: '' });
      const show = () => {
        $('#docBody', m.el).innerHTML = editing ? `<textarea id="docMd" style="min-height:60vh;font-family:ui-monospace,monospace;font-size:var(--fs-body)">${esc(g.content)}</textarea>` : `<div class="md">${PM.mdToHtml(g.content)}</div>`;
        m.setFooter(`<span class="small muted grow">${t('doc_pages_note')}</span>${editing ? `<button class="btn" id="dEditCancel">${t('cancel')}</button><button class="btn primary" id="dSave">${t('save')}</button>` : `<button class="btn" id="dEdit">${icon('edit')}${t('edit')}</button>${FMT.map((f) => `<button class="btn ${out === f[0] ? 'primary' : ''}" id="dl_${f[0]}">${icon('dl')}${f[1]}</button>`).join('')}`}`);
        const on = (id, fn) => { const el = $('#' + id, m.el); if (el) el.onclick = fn; };
        on('dEdit', () => { editing = true; show(); });
        on('dEditCancel', () => { editing = false; show(); });
        on('dSave', async () => { const v = $('#docMd', m.el).value; const r = await busy($('#dSave', m.el), () => api('PUT', `/api/generated/${id}`, { content: v })); if (r) { g.content = v; editing = false; toast(t('saved'), 'ok'); show(); } });
        FMT.forEach((f) => on('dl_' + f[0], () => PM.download(`/api/generated/${id}/${f[0]}`, `${p.name} ${g.title}.${f[0]}`)));
      };
      show();
    }
    draw();
  };

  function templateDialog(types, curType, done) {
    const m = modal({ title: t('new_template'), size: 'lg', body: `<div class="form-grid"><label class="f">${t('template_name')}<input type="text" id="tn"></label><label class="f">${t('doc_type')}<select id="tt">${types.map((x) => `<option value="${x.id}" ${x.id === curType ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label class="f full">${t('upload_word_tpl')}<input type="file" id="tf" accept=".docx,.md,.txt"></label><div class="full small muted">${t('or_write')}</div>
      <label class="f full"><span class="row"><span class="grow">${t('template_body')}</span><button type="button" class="btn sm" id="tSkel">${t('start_from_default')}</button></span><textarea id="tb" style="min-height:220px;font-family:ui-monospace,monospace;font-size:var(--fs-body)" placeholder="# Executive Summary&#10;Guidance or fixed text for this section. Use {{project.name}}.&#10;&#10;# Progress"></textarea></label>
      <div class="full small muted">${t('template_vars')}: <code>{{project.name}} {{project.client}} {{project.value}} {{project.start_date}} {{project.end_date}} {{date}} {{period.start}} {{period.end}} {{pm.name}} {{progress.actual}} {{progress.planned}} {{progress.spi}}</code></div></div>`,
      footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="tOk">${t('save')}</button>` });
    m.$('#tSkel').onclick = async () => { const r = await busy(m.$('#tSkel'), () => api('GET', `/api/templates/skeleton/${m.$('#tt').value}`)); if (r) m.$('#tb').value = r.body; };
    m.$('#tOk').onclick = async () => {
      const name = m.$('#tn').value.trim();
      if (!name) { m.$('#tn').focus(); return; }
      const fd = new FormData();
      fd.append('name', name); fd.append('doc_type', m.$('#tt').value); fd.append('body', m.$('#tb').value);
      const f = m.$('#tf').files[0]; if (f) fd.append('file', f);
      const r = await busy(m.$('#tOk'), () => api('POST', '/api/templates', fd));
      if (r) { m.close(); toast(t('template_saved', { n: r.sections.length }), 'ok'); done(); }
    };
  }

  // ================= Settings =================
  PM.views.tab_settings = async function (root, p, q, token) {
    let proj = p;
    let team = (await api('GET', `/api/projects/${p.id}/resources`)).resources;
    const DAYS = [0, 1, 2, 3, 4, 5, 6];
    const dayName = (d) => new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar' : 'en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + d)));
    const hooks = `${location.origin}/api/ingest`;
    const key = S.user.ingest_key;
    const save = async (body, btn) => { const r = await busy(btn, () => api('PUT', `/api/projects/${p.id}`, body)); if (r) { proj = r.project; S.project = r.project; toast(t('saved'), 'ok'); } return r; };
    function draw() {
      if (stale(token)) return;
      root.innerHTML = `<div class="page" style="max-width:980px"><div class="col gap-lg">
        <div class="card"><div class="card-head"><h3>${t('general')}</h3></div><div class="row gap-lg wrap" style="align-items:flex-start"><div style="width:160px"><div class="small muted" style="margin-bottom:6px">${t('client_logo')}</div><div style="height:90px;border:1px solid var(--border);border-radius:10px;display:grid;place-items:center;background:var(--surface-2);overflow:hidden">${proj.client_logo ? `<img src="${esc(proj.client_logo)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">` : `<span class="faint small">${t('no_logo')}</span>`}</div><label class="btn sm mt" style="width:100%;justify-content:center"><input type="file" id="logoF" accept="image/*" class="hidden">${icon('upload')}${t('upload_logo')}</label></div>
          <div class="grow form-grid"><label class="f">${t('project_name')}<input type="text" id="s_name" value="${esc(proj.name)}"></label><label class="f">${t('project_code')}<input type="text" id="s_code" value="${esc(proj.code || '')}"></label><label class="f">${t('client')}<input type="text" id="s_client" value="${esc(proj.client || '')}"></label>
          <label class="f">${t('currency')}<input type="text" id="s_cur" value="${esc(proj.currency || '')}" maxlength="3" style="text-transform:uppercase"></label><label class="f">${t('project_value')}<input type="number" id="s_val" value="${proj.value ?? ''}"></label><label class="f">${t('status')}<select id="s_status"><option value="active" ${proj.status === 'active' ? 'selected' : ''}>${t('active')}</option><option value="archived" ${proj.status === 'archived' ? 'selected' : ''}>${t('archived')}</option></select></label>
          <label class="f">${t('start')}<input type="date" id="s_start" value="${proj.start_date || ''}"></label><label class="f">${t('finish')}<input type="date" id="s_end" value="${proj.end_date || ''}"></label></div></div><div class="row mt"><button class="btn primary" id="saveGen">${t('save')}</button></div></div>
        <div class="card"><div class="card-head"><h3>${t('working_time')}</h3></div><div class="row wrap" style="gap:14px">${DAYS.map((d) => `<label class="check"><input type="checkbox" data-day="${d}" ${proj.work_days.includes(d) ? 'checked' : ''}>${dayName(d)}</label>`).join('')}</div>
          <div class="form-grid mt" style="max-width:420px"><label class="f">${t('work_start')}<input type="time" id="s_ws" value="${proj.work_start || '08:00'}"></label><label class="f">${t('work_end')}<input type="time" id="s_we" value="${proj.work_end || '17:00'}"></label></div>
          <div class="mt"><div class="small muted" style="margin-bottom:6px">${t('holidays')}</div><div class="row wrap" id="hols">${proj.holidays.map((h) => `<span class="chip">${h} <a href="#" data-rmh="${h}">${icon('x')}</a></span>`).join('') || `<span class="small faint">${t('no_holidays')}</span>`}<input type="date" id="holNew" style="width:auto"><button class="btn sm" id="holAdd">${t('add')}</button></div></div>
          <div class="small muted mt">${t('calendar_note')}</div><div class="row mt"><button class="btn primary" id="saveCal">${t('save')}</button></div></div>
        <div class="card"><div class="card-head"><h3>${t('team')}</h3></div>${team.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>${t('name')}</th><th>${t('role')}</th><th>${t('email')}</th><th>Teams</th><th>Jira</th><th></th></tr></thead><tbody>${team.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.role || '')}</td><td>${esc(r.email || '')}</td><td>${esc(r.teams_name || '')}</td><td>${esc(r.jira_account || '')}</td><td class="right"><button class="btn sm ghost icon" data-rdel="${r.id}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty small">${t('no_team')}</div>`}
          <div class="form-grid mt" style="grid-template-columns:repeat(5,minmax(0,1fr)) auto;align-items:end"><label class="f">${t('name')}<input type="text" id="r_name"></label><label class="f">${t('role')}<input type="text" id="r_role"></label><label class="f">${t('email')}<input type="text" id="r_email"></label><label class="f">Teams<input type="text" id="r_teams"></label><label class="f">Jira<input type="text" id="r_jira"></label><button class="btn" id="r_add">${icon('plus')}${t('add')}</button></div><div class="small muted mt">${t('team_hint')}</div></div>
        <div class="card"><div class="card-head"><h3>${t('pl_title')}</h3></div><div class="small muted mb">${t('pl_hint')}</div><div class="form-grid"><label class="f">${t('pl_sp')}<input type="url" id="s_sp" value="${esc(proj.sharepoint_url || '')}" placeholder="https://company.sharepoint.com/sites/project"></label><label class="f">${t('pl_jira')}<input type="url" id="s_jiraurl" value="${esc(proj.jira_url || '')}" placeholder="https://company.atlassian.net/browse/PROJ"></label></div>
          <div class="row mt"><button class="btn primary" id="saveLinks">${t('save')}</button><span class="small muted">${t('pl_conn_note')} <a href="#/account">${t('pl_conn_go')}</a></span></div></div>
        <div class="card"><div class="card-head"><h3>${t('integrations')}</h3></div><div class="form-grid"><label class="f">${t('jira_key')}<input type="text" id="s_jira" value="${esc(proj.jira_key || '')}" placeholder="PROJ"></label><label class="f">${t('teams_channel')}<input type="text" id="s_teams" value="${esc(proj.teams_channel || '')}" placeholder="teamId/channelId"></label></div>
          <div class="row mt" style="gap:16px"><label class="switch"><input type="checkbox" id="s_auto" ${proj.auto_apply ? 'checked' : ''}><span></span></label><div class="grow"><b>${t('auto_apply')}</b><div class="small muted">${t('auto_apply_hint')}</div></div><label class="f" style="width:130px">${t('threshold')} %<input type="number" id="s_thr" min="50" max="100" value="${Math.round((proj.auto_threshold || 0.9) * 100)}"></label></div>
          <div class="mt"><div class="small muted" style="margin-bottom:6px">${t('webhooks')}</div>
          ${[['Teams, Outlook, Power Automate', `${hooks}/message?key=${key}`], ['Jira webhook', `${hooks}/jira?key=${key}`]].map(([l, u]) => `<div class="row" style="margin-bottom:6px"><span class="small muted" style="width:190px">${l}</span><input type="text" readonly value="${esc(u)}" style="font-family:ui-monospace,monospace;font-size:var(--fs-small)"><button class="btn sm" data-copy="${esc(u)}">${icon('copy')}</button></div>`).join('')}<div class="row"><button class="btn sm" id="newKey">${icon('refresh')}${t('regen_key')}</button><span class="small faint">${t('webhook_body_hint')}</span></div></div>
          <div class="row mt"><button class="btn primary" id="saveInt">${t('save')}</button></div></div>
        <div class="card"><div class="card-head"><h3 style="color:var(--danger)">${t('danger_zone')}</h3></div><div class="row"><div class="grow small muted">${t('delete_project_hint')}</div><button class="btn danger" id="delProj">${icon('trash')}${t('delete_project')}</button></div></div></div></div>`;
      bind();
    }
    function bind() {
      const v = (id) => $('#' + id, root).value;
      $('#saveGen', root).onclick = (e) => save({ name: v('s_name'), code: v('s_code'), client: v('s_client'), currency: v('s_cur').toUpperCase(), value: v('s_val'), status: v('s_status'), start_date: v('s_start'), end_date: v('s_end') }, e.currentTarget);
      $('#logoF', root).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const r = await busy(null, () => api('POST', `/api/projects/${p.id}/logo`, fd)); if (r) { proj = { ...proj, ...r.project }; S.project = proj; toast(t('saved'), 'ok'); PM.projectView(p.id, 'settings', new URLSearchParams()); } };
      $('#saveLinks', root).onclick = (e) => save({ sharepoint_url: v('s_sp'), jira_url: v('s_jiraurl') }, e.currentTarget);
      $('#saveCal', root).onclick = (e) => save({ work_days: $$('[data-day]:checked', root).map((c) => Number(c.dataset.day)), work_start: v('s_ws'), work_end: v('s_we'), holidays: proj.holidays }, e.currentTarget);
      $('#holAdd', root).onclick = async () => { const d = v('holNew'); if (!d) return; const r = await save({ holidays: [...proj.holidays, d] }); if (r) draw(); };
      $$('[data-rmh]', root).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); const r = await save({ holidays: proj.holidays.filter((h) => h !== a.dataset.rmh) }); if (r) draw(); }));
      $('#saveInt', root).onclick = (e) => save({ jira_key: v('s_jira'), teams_channel: v('s_teams'), auto_apply: $('#s_auto', root).checked, auto_threshold: Number(v('s_thr')) / 100 }, e.currentTarget);
      $$('[data-copy]', root).forEach((b) => (b.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy); toast(t('copied'), 'ok'); }));
      $('#newKey', root).onclick = async () => { if (!(await confirmDlg({ title: t('regen_key'), message: t('regen_key_q'), ok: t('regen_key') }))) return; const r = await busy(null, () => api('POST', '/api/me/ingest-key')); if (r) { S.user.ingest_key = r.ingest_key; PM.projectView(p.id, 'settings', new URLSearchParams()); } };
      $('#r_add', root).onclick = async () => { const name = v('r_name').trim(); if (!name) { $('#r_name', root).focus(); return; } const r = await busy($('#r_add', root), () => api('POST', `/api/projects/${p.id}/resources`, { name, role: v('r_role'), email: v('r_email'), teams_name: v('r_teams'), jira_account: v('r_jira') })); if (r) { team = (await api('GET', `/api/projects/${p.id}/resources`)).resources; draw(); } };
      $$('[data-rdel]', root).forEach((b) => (b.onclick = async () => { await busy(null, () => api('DELETE', `/api/projects/${p.id}/resources/${b.dataset.rdel}`)); team = (await api('GET', `/api/projects/${p.id}/resources`)).resources; draw(); }));
      $('#delProj', root).onclick = async () => { if (await confirmDlg({ title: t('delete_project'), message: t('confirm_delete_project', { name: esc(proj.name) }), ok: t('delete_project'), danger: true })) { await busy(null, () => api('DELETE', `/api/projects/${p.id}`)); location.hash = '#/projects'; } };
    }
    draw();
  };
})();
