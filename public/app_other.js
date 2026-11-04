/* Overview, Inbox, Documents, Reports and Settings tabs. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, modal, confirmDlg, busy, dropzone, state: S } = PM;
  const stale = (tk) => PM.stale(tk);
  const stateChip = (s) => `<span class="chip ${['closed', 'paid', 'mitigated', 'transferred'].includes(s) ? 'green' : ['invoiced'].includes(s) ? 'blue' : ''}">${t('state_' + s)}</span>`;
  const when = (ts) => esc(String(ts || '').replace('T', ' ').slice(0, 16));

  // ================= Overview =================
  PM.views.tab_overview = async function (root, p, q, token) {
    const [items, sched, audit] = await Promise.all([api('GET', `/api/projects/${p.id}/items`), api('GET', `/api/projects/${p.id}/schedule`), api('GET', `/api/projects/${p.id}/audit`)]);
    if (stale(token)) return;
    const live = items.items.filter((i) => i.status !== 'ignored');
    const del = live.filter((i) => i.kind === 'deliverable');
    const ms = live.filter((i) => i.kind === 'milestone');
    const risks = live.filter((i) => i.kind === 'risk' && i.state !== 'closed' && i.state !== 'transferred');
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
  // Each document is made in one output format and downloads only in that format.
  const FMT = {
    docx: { label: 'Word', icon: 'file', name: 'out_word', hint: 'out_hint_docx' },
    xlsx: { label: 'Excel', icon: 'grid', name: 'out_excel', hint: 'out_hint_xlsx' },
    pptx: { label: 'PowerPoint', icon: 'chart', name: 'out_ppt', hint: 'out_hint_pptx' },
  };
  const fmtOf = (k) => FMT[k] || FMT.docx;
  PM.views.tab_reports = async function (root, p, q, token) {
    const types = (await api('GET', '/api/doc-types')).types;
    let templates = (await api('GET', '/api/templates')).templates;
    let gen = (await api('GET', `/api/projects/${p.id}/generated`)).generated;
    let folders = (await api('GET', `/api/projects/${p.id}/folders`)).folders;
    let type = sessionStorage.getItem('rp_type') || 'progress_weekly';
    let out = sessionStorage.getItem('rp_out'); if (!FMT[out]) out = 'docx';
    const selKey = `rp_sel_${p.id}`;
    let sel = sessionStorage.getItem(selKey) || 'all';
    if (!['all', 'none'].includes(sel) && !folders.some((f) => String(f.id) === sel)) sel = 'all';
    const setSel = (v) => { sel = String(v); try { sessionStorage.setItem(selKey, sel); } catch (e) { /* storage blocked */ } };
    const titleOf = (id) => (types.find((x) => x.id === id) || {}).title || id;
    const form = { name: '', touched: false, tpl: '', folder: null, asOf: PM.today(), period: null };
    const defName = () => `${titleOf(type)} ${p.name}`;
    const ui = { creating: false, folderErr: '', renamingFolder: false, renamingDoc: null, dragging: null };
    const folderName = (id) => (id == null ? t('unfiled') : (folders.find((f) => f.id === id) || {}).name || t('unfiled'));

    root.innerHTML = `<div class="page"><div class="page-head"><h1>${t('tab_reports')}</h1><button class="btn primary" id="rpCreate">${icon('plus')}${t('create_document')}</button></div><div class="grid g-main"><div class="col gap-lg"><div class="card" id="rpDocs"></div></div><div class="card" id="rpTpls"></div></div></div>`;
    $('#rpCreate', root).onclick = () => createDialog();
    const reloadAll = async () => {
      [templates, gen, folders] = await Promise.all([api('GET', '/api/templates').then((r) => r.templates), api('GET', `/api/projects/${p.id}/generated`).then((r) => r.generated), api('GET', `/api/projects/${p.id}/folders`).then((r) => r.folders)]);
      if (!['all', 'none'].includes(sel) && !folders.some((f) => String(f.id) === sel)) setSel('all');
      drawDocs(); drawTpls();
    };

    // ---------- create a document (pop up, then a progress screen) ----------
    function createDialog() {
      const body = () => {
        const isProg = type.startsWith('progress');
        const tpls = templates.filter((x) => x.doc_type === type);
        const opt = (ts) => ts.map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join('');
        return `<div class="form-grid">
          <div class="fmt-pick full"><span class="lbl" id="rpOutL">${t('doc_output')}</span>
            <div class="seg" role="radiogroup" aria-labelledby="rpOutL">${Object.keys(FMT).map((k) => `<button type="button" role="radio" aria-checked="${out === k}" class="${out === k ? 'on' : ''}" data-fmt="${k}" data-tip="${esc(t(FMT[k].name))}">${icon(FMT[k].icon)}${FMT[k].label}</button>`).join('')}</div>
            <div class="small muted">${t(FMT[out].hint)}</div></div>
          <label class="f full">${t('doc_type')}<select id="rpType"><optgroup label="${t('grp_progress')}">${opt(types.filter((x) => x.progress))}</optgroup><optgroup label="${t('grp_project')}">${opt(types.filter((x) => !x.progress))}</optgroup></select></label>
          <label class="f full">${t('template')}<select id="rpTpl"><option value="">${t('tpl_default')}</option>${tpls.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
          <label class="f">${t('doc_name')}<input type="text" id="rpName" maxlength="120" value="${esc(form.touched ? form.name : defName())}"><span class="small muted">${t('doc_name_hint')}</span></label>
          <label class="f">${t('save_in_folder')}<select id="rpFolder"><option value="">${t('unfiled')}</option>${folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
          ${isProg ? `<label class="f">${t('as_of')}<input type="date" id="rpAsOf" value="${esc(form.asOf)}"></label><label class="f">${t('period')}<select id="rpPeriod"><option value="7">${t('days_n', { n: 7 })}</option><option value="14">${t('days_n', { n: 14 })}</option><option value="30">${t('days_n', { n: 30 })}</option></select></label>` : ''}
          <div class="full small muted">${isProg ? t('progress_report_hint') : t('project_doc_hint')}${S.status.claude ? '' : ` ${t('ai_rules_note')}`}</div></div>`;
      };
      const m = modal({ title: t('create_document'), size: 'md', body: '<div id="rpBody"></div>', footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="rpGo">${icon('spark')}${t('generate')}</button>` });
      const draw = () => {
        const el = $('#rpBody', m.el);
        const isProg = type.startsWith('progress');
        el.innerHTML = body();
        $('#rpType', el).value = type; $('#rpTpl', el).value = form.tpl;
        $('#rpFolder', el).value = form.folder != null ? form.folder : (/^\d+$/.test(sel) ? sel : '');
        if (isProg) $('#rpPeriod', el).value = String(form.period || (type === 'progress_biweekly' ? 14 : 7));
        $$('[data-fmt]', el).forEach((b) => (b.onclick = () => { out = b.dataset.fmt; sessionStorage.setItem('rp_out', out); draw(); }));
        $('#rpType', el).onchange = (e) => { type = e.target.value; sessionStorage.setItem('rp_type', type); form.tpl = ''; form.period = null; draw(); };
        $('#rpTpl', el).onchange = (e) => { form.tpl = e.target.value; };
        $('#rpName', el).oninput = (e) => { form.name = e.target.value; form.touched = true; };
        $('#rpFolder', el).onchange = (e) => { form.folder = e.target.value; };
        if (isProg) { $('#rpAsOf', el).onchange = (e) => { form.asOf = e.target.value; }; $('#rpPeriod', el).onchange = (e) => { form.period = Number(e.target.value); }; }
      };
      draw();
      $('#rpGo', m.el).onclick = () => {
        const el = $('#rpBody', m.el), isProg = type.startsWith('progress');
        const body = { type, format: out, template_id: form.tpl || null, title: $('#rpName', el).value.trim() || defName(), folder_id: $('#rpFolder', el).value ? Number($('#rpFolder', el).value) : null };
        if (isProg) { body.as_of = $('#rpAsOf', el).value; body.period_days = Number($('#rpPeriod', el).value); }
        m.close();
        runCreate(body);
      };
    }

    // The progress screen. Each status is a real stage of the work, shown for at least a moment so it can be read.
    function runCreate(body) {
      const steps = ['gen_s_read', 'gen_s_text', 'gen_s_format', 'gen_s_visuals', 'gen_s_design', 'gen_s_save'];
      const m = modal({ title: t('gen_title'), size: 'sm gen', noBackdropClose: true, body: `<div class="gen-run" role="status" aria-live="polite"><div class="progress"><i id="gnBar" style="width:4%"></i></div><ul class="gen-steps">${steps.map((k, i) => `<li data-i="${i}"><span class="dot"></span><span>${t(k)}</span></li>`).join('')}</ul><div class="small muted" id="gnNote">${t('gen_wait')}</div></div>`, footer: '' });
      const lis = $$('.gen-steps li', m.el), bar = $('#gnBar', m.el);
      const show = (i) => { lis.forEach((li, n) => { li.className = n < i ? 'done' : n === i ? 'on' : ''; }); bar.style.width = `${Math.round(((i + 0.5) / steps.length) * 100)}%`; };
      const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const step = async (i, fn) => { show(i); const t0 = Date.now(); const r = fn ? await fn() : undefined; const left = 550 - (Date.now() - t0); if (left > 0) await pause(left); return r; };
      (async () => {
        try {
          await step(0);
          const r = await step(1, () => api('POST', `/api/projects/${p.id}/generate`, body));
          const g = (await api('GET', `/api/generated/${r.generated.id}`)).generated;
          await step(2); await step(3);
          const built = await step(4, () => PM.exporter.build(g));
          await step(5, async () => { form.touched = false; form.folder = null; setSel(g.folder_id != null ? g.folder_id : 'all'); await reloadAll(); });
          lis.forEach((li) => (li.className = 'done')); bar.style.width = '100%';
          await pause(350);
          m.close();
          if (r.unconfirmed) toast(t('unconfirmed_note', { n: r.unconfirmed }));
          ready(g, built);
        } catch (e) { m.close(); toast(e.message || t('err_download'), 'err'); }
      })();
    }

    // done screen: the document is ready in the chosen format
    function ready(g, built) {
      const f = fmtOf(g.format);
      const m = modal({ title: t('gen_ready'), size: 'sm', body: `<div class="gen-done"><span class="ico">${icon(f.icon)}</span><div><div style="font-weight:600">${esc(g.title)}</div><div class="small muted">${f.label} · ${esc(folderName(g.folder_id))}</div></div></div>`, footer: `<button class="btn" id="rdOpen">${icon('eye')}${t('open')}</button><button class="btn primary" id="rdDl">${icon('dl')}${t('download_fmt', { f: f.label })}</button>` });
      $('#rdOpen', m.el).onclick = () => { m.close(); openDoc(g.id); };
      $('#rdDl', m.el).onclick = () => { PM.exporter.save(built.blob, built.filename); toast(t('download_ready'), 'ok'); m.close(); };
    }

    // ---------- the folder view ----------
    const inSel = (g) => sel === 'all' || (sel === 'none' ? g.folder_id == null : String(g.folder_id) === sel);
    const count = (f) => gen.filter((g) => g.folder_id === f).length;

    async function downloadDoc(id, btn) {
      const ok = await busy(btn, async () => { await PM.downloadGenerated(id); return true; });
      if (ok) toast(t('download_ready'), 'ok');
    }
    async function moveDoc(id, to) {
      const g = gen.find((x) => x.id === id);
      if (!g) return;
      const prev = g.folder_id == null ? null : g.folder_id;
      if (prev === to) return;
      const r = await busy(null, () => api('PUT', `/api/generated/${id}`, { folder_id: to }));
      if (!r) return;
      g.folder_id = to; drawDocs();
      toast(t('doc_moved', { f: folderName(to) }), 'ok', { label: t('g_undo'), fn: async () => { try { await api('PUT', `/api/generated/${id}`, { folder_id: prev }); g.folder_id = prev; drawDocs(); } catch (e) { toast(e.message, 'err'); } } });
    }
    function moveDialog(g) {
      const targets = [[null, t('unfiled')], ...folders.map((f) => [f.id, f.name])];
      const m = modal({ title: t('move_to_folder'), body: `<div class="mv-list">${targets.map(([id, nm]) => `<button class="fv-folder ${(g.folder_id == null ? null : g.folder_id) === id ? 'on' : ''}" data-to="${id == null ? '' : id}">${icon('folder')}<span class="nm">${esc(nm)}</span></button>`).join('')}</div>`, footer: `<button class="btn" data-close>${t('cancel')}</button>` });
      $$('[data-to]', m.el).forEach((b) => (b.onclick = () => { m.close(); moveDoc(g.id, b.dataset.to === '' ? null : Number(b.dataset.to)); }));
    }

    function docRow(g) {
      const f = fmtOf(g.format), renaming = ui.renamingDoc === g.id;
      return `<div class="fv-doc" draggable="${renaming ? 'false' : 'true'}" data-doc="${g.id}">
        <span class="grip" aria-hidden="true">${icon('grip')}</span><span class="ico">${icon(f.icon)}</span>
        <div class="body">${renaming ? `<div class="rn"><input type="text" id="rnDoc" maxlength="120" value="${esc(g.title)}" aria-label="${esc(t('rename_doc'))}"><button class="btn sm primary" data-rn-ok>${t('save')}</button><button class="btn sm" data-rn-no>${t('cancel')}</button></div>` : `<div class="ttl">${esc(g.title)}</div>`}
          <div class="meta"><span class="chip" data-tip="${esc(t(f.name))}">${(g.format || 'docx').toUpperCase()}</span><span>${esc(g.template)}</span><span>${when(g.created_at)}</span>${sel === 'all' ? `<span>${icon('folder')} ${esc(folderName(g.folder_id))}</span>` : ''}</div>
          <div class="acts"><button class="btn sm" data-open="${g.id}">${icon('eye')}${t('open')}</button><button class="btn sm primary" data-dl="${g.id}">${icon('dl')}${t('download_fmt', { f: f.label })}</button><button class="btn sm" data-rn="${g.id}">${icon('edit')}${t('rename')}</button><button class="btn sm" data-mv="${g.id}">${icon('folder')}${t('move_to_folder')}</button><button class="btn sm ghost icon" data-gdel="${g.id}" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('trash')}</button></div></div></div>`;
    }

    function drawDocs() {
      if (stale(token)) return;
      const el = $('#rpDocs', root);
      const list = gen.filter(inSel);
      const cur = folders.find((f) => String(f.id) === sel);
      const heading = sel === 'all' ? t('all_docs') : sel === 'none' ? t('unfiled') : cur.name;
      const rail = (key, label, n, drop) => `<button class="fv-folder ${sel === key ? 'on' : ''}" data-sel="${key}" ${drop !== undefined ? `data-drop="${drop}"` : ''} ${sel === key ? 'aria-current="true"' : ''}>${icon('folder')}<span class="nm">${esc(label)}</span><span class="ct">${n}</span></button>`;
      el.innerHTML = `<div class="card-head"><h3>${t('generated_docs')}</h3></div><div class="fv">
        <nav class="fv-rail" aria-label="${esc(t('folders'))}"><div class="sub">${t('folders')}</div>
          ${rail('all', t('all_docs'), gen.length)}${rail('none', t('unfiled'), count(null), '')}${folders.map((f) => rail(String(f.id), f.name, count(f.id), f.id)).join('')}
          ${ui.creating ? `<div class="fv-newf"><input type="text" id="fvNew" maxlength="60" placeholder="${esc(t('folder_name'))}" aria-label="${esc(t('folder_name'))}"><button class="btn sm primary icon" data-new-ok aria-label="${esc(t('save'))}" data-tip="${esc(t('save'))}">${icon('check')}</button><button class="btn sm ghost icon" data-new-no aria-label="${esc(t('cancel'))}" data-tip="${esc(t('cancel'))}">${icon('x')}</button></div>${ui.folderErr ? `<div class="fv-err" role="alert">${esc(ui.folderErr)}</div>` : ''}` : `<button class="btn sm" data-new>${icon('plus')}${t('new_folder')}</button>`}</nav>
        <div class="fv-main"><div class="fv-head">${ui.renamingFolder && cur ? `<div class="rn grow" style="display:flex;gap:6px"><input type="text" id="rnFolder" maxlength="60" value="${esc(cur.name)}" aria-label="${esc(t('folder_name'))}" style="flex:1;min-width:0"><button class="btn sm primary" data-rf-ok>${t('save')}</button><button class="btn sm" data-rf-no>${t('cancel')}</button></div>${ui.folderErr ? `<div class="fv-err" role="alert">${esc(ui.folderErr)}</div>` : ''}` : `<h4>${esc(heading)} <span class="muted">(${list.length})</span></h4>${cur ? `<button class="btn sm" data-rf>${icon('edit')}${t('rename')}</button><button class="btn sm danger" data-df>${icon('trash')}${t('delete_folder')}</button>` : ''}`}</div>
          ${folders.length && gen.length ? `<div class="fv-hint">${t('drag_hint')}</div>` : ''}
          ${list.length ? list.map(docRow).join('') : `<div class="fv-empty">${gen.length ? t('folder_empty') : t('no_generated')}</div>`}</div></div>`;

      // folders
      $$('[data-sel]', el).forEach((b) => (b.onclick = () => { setSel(b.dataset.sel); ui.renamingFolder = false; ui.folderErr = ''; drawDocs(); }));
      const nb = $('[data-new]', el); if (nb) nb.onclick = () => { ui.creating = true; ui.folderErr = ''; drawDocs(); $('#fvNew', root).focus(); };
      const submitNew = async () => {
        try { const r = await api('POST', `/api/projects/${p.id}/folders`, { name: $('#fvNew', root).value }); folders.push(r.folder); ui.creating = false; ui.folderErr = ''; setSel(r.folder.id); drawDocs(); toast(t('folder_created'), 'ok'); }
        catch (e) { ui.folderErr = e.message; drawDocs(); $('#fvNew', root).focus(); }
      };
      const ni = $('#fvNew', el);
      if (ni) { ni.onkeydown = (e) => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') { ui.creating = false; ui.folderErr = ''; drawDocs(); } }; $('[data-new-ok]', el).onclick = submitNew; $('[data-new-no]', el).onclick = () => { ui.creating = false; ui.folderErr = ''; drawDocs(); }; }
      const rf = $('[data-rf]', el); if (rf) rf.onclick = () => { ui.renamingFolder = true; ui.folderErr = ''; drawDocs(); const i = $('#rnFolder', root); i.focus(); i.select(); };
      const rfi = $('#rnFolder', el);
      if (rfi) {
        const ok = async () => { try { const r = await api('PUT', `/api/folders/${cur.id}`, { name: rfi.value }); cur.name = r.folder.name; ui.renamingFolder = false; ui.folderErr = ''; drawDocs(); toast(t('saved'), 'ok'); } catch (e) { ui.folderErr = e.message; drawDocs(); const i = $('#rnFolder', root); if (i) i.focus(); } };
        rfi.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { ui.renamingFolder = false; ui.folderErr = ''; drawDocs(); } };
        $('[data-rf-ok]', el).onclick = ok; $('[data-rf-no]', el).onclick = () => { ui.renamingFolder = false; ui.folderErr = ''; drawDocs(); };
      }
      const df = $('[data-df]', el);
      if (df) df.onclick = async () => {
        const saved = { id: cur.id, name: cur.name };
        const r = await busy(null, () => api('DELETE', `/api/folders/${cur.id}`));
        if (!r) return;
        setSel('all'); await reloadAll();
        toast(t('folder_deleted'), 'ok', { label: t('g_undo'), fn: async () => { try { await api('POST', `/api/projects/${p.id}/folders`, { id: saved.id, name: saved.name }); for (const gid of r.moved) await api('PUT', `/api/generated/${gid}`, { folder_id: saved.id }); setSel(saved.id); await reloadAll(); } catch (e) { toast(e.message, 'err'); } } });
      };

      // documents
      $$('[data-open]', el).forEach((b) => (b.onclick = () => openDoc(Number(b.dataset.open))));
      $$('[data-dl]', el).forEach((b) => (b.onclick = () => downloadDoc(Number(b.dataset.dl), b)));
      $$('[data-mv]', el).forEach((b) => (b.onclick = () => moveDialog(gen.find((x) => x.id === Number(b.dataset.mv)))));
      $$('[data-rn]', el).forEach((b) => (b.onclick = () => { ui.renamingDoc = Number(b.dataset.rn); drawDocs(); const i = $('#rnDoc', root); i.focus(); i.select(); }));
      const rn = $('#rnDoc', el);
      if (rn) {
        const g = gen.find((x) => x.id === ui.renamingDoc);
        const ok = async () => { const r = await busy(null, () => api('PUT', `/api/generated/${g.id}`, { title: rn.value })); if (r) { g.title = r.generated.title; ui.renamingDoc = null; drawDocs(); toast(t('doc_renamed'), 'ok'); } };
        rn.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { ui.renamingDoc = null; drawDocs(); } };
        $('[data-rn-ok]', el).onclick = ok; $('[data-rn-no]', el).onclick = () => { ui.renamingDoc = null; drawDocs(); };
      }
      $$('[data-gdel]', el).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_doc'), ok: t('delete'), danger: true })) { await api('DELETE', `/api/generated/${b.dataset.gdel}`); reloadAll(); } }));

      // drag a document onto a folder
      $$('.fv-doc[draggable="true"]', el).forEach((d) => {
        d.ondragstart = (e) => { ui.dragging = Number(d.dataset.doc); d.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(ui.dragging)); } catch (x) { /* some browsers block data */ } };
        d.ondragend = () => { d.classList.remove('dragging'); ui.dragging = null; $$('.fv-folder.over', el).forEach((x) => x.classList.remove('over')); };
      });
      $$('[data-drop]', el).forEach((z) => {
        const to = z.dataset.drop === '' ? null : Number(z.dataset.drop);
        z.ondragenter = (e) => { if (ui.dragging != null) { e.preventDefault(); z.classList.add('over'); } };
        z.ondragover = (e) => { if (ui.dragging != null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; z.classList.add('over'); } };
        z.ondragleave = (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('over'); };
        z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); const id = ui.dragging != null ? ui.dragging : Number(e.dataTransfer.getData('text/plain')); ui.dragging = null; if (id) moveDoc(id, to); };
      });
    }

    // ---------- templates ----------
    function drawTpls() {
      if (stale(token)) return;
      const el = $('#rpTpls', root);
      el.innerHTML = `<div class="card-head"><h3>${t('custom_templates')}</h3><button class="btn sm" id="tplNew">${icon('plus')}${t('new_template')}</button></div><div class="small muted mb">${t('template_help')}</div>${templates.length ? templates.map((x) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.name)}</div><div class="small muted">${esc(titleOf(x.doc_type))}</div></div><button class="btn sm ghost icon" data-tdel="${x.id}" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('trash')}</button></div>`).join('') : `<div class="empty small">${t('no_templates')}</div>`}`;
      $$('[data-tdel]', el).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_tpl'), ok: t('delete'), danger: true })) { await api('DELETE', `/api/templates/${b.dataset.tdel}`); reloadAll(); } }));
      $('#tplNew', el).onclick = () => templateDialog(types, type, reloadAll);
    }

    // ---------- preview, rename and download ----------
    async function openDoc(id) {
      const g = (await api('GET', `/api/generated/${id}`)).generated;
      const f = fmtOf(g.format);
      let editing = false;
      const m = modal({ title: g.title, size: 'xl', body: '<div id="docBody"></div>', footer: '' });
      const show = () => {
        $('#docBody', m.el).innerHTML = editing ? `<label class="f" style="margin-bottom:12px">${t('doc_name')}<input type="text" id="docName" maxlength="120" value="${esc(g.title)}"></label><textarea id="docMd" style="min-height:56vh;font-family:ui-monospace,monospace;font-size:var(--fs-body)">${esc(g.content)}</textarea>` : `<div class="md">${PM.mdToHtml(g.content)}</div>`;
        m.setFooter(`<span class="small muted grow">${t('doc_pages_note')}</span>${editing ? `<button class="btn" id="dEditCancel">${t('cancel')}</button><button class="btn primary" id="dSave">${t('save')}</button>` : `<button class="btn" id="dEdit">${icon('edit')}${t('edit')}</button><button class="btn primary" id="dDl">${icon('dl')}${t('download_fmt', { f: f.label })}</button>`}`);
        const on = (k, fn) => { const e = $('#' + k, m.el); if (e) e.onclick = fn; };
        on('dEdit', () => { editing = true; show(); });
        on('dEditCancel', () => { editing = false; show(); });
        on('dSave', async () => {
          const body = { content: $('#docMd', m.el).value, title: $('#docName', m.el).value };
          const r = await busy($('#dSave', m.el), () => api('PUT', `/api/generated/${id}`, body));
          if (r) { g.content = body.content; g.title = r.generated.title; $('.modal-head h2', m.el).textContent = g.title; editing = false; toast(t('saved'), 'ok'); show(); reloadAll(); }
        });
        on('dDl', async () => { const ok = await busy($('#dDl', m.el), async () => { await PM.exporter.download(g); return true; }); if (ok) toast(t('download_ready'), 'ok'); });
      };
      show();
    }
    drawDocs(); drawTpls();
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
          <div class="row mt"><button class="btn primary" id="saveInt">${t('save')}</button></div></div>
        ${PM.data.projectCards(proj)}
        <div class="card"><div class="card-head"><h3 style="color:var(--danger)">${t('danger_zone')}</h3></div><div class="row"><div class="grow small muted">${proj.can_delete === false ? t('delete_project_pm_only') : t('delete_project_hint')}</div>${proj.can_delete === false ? '' : `<button class="btn danger" id="delProj">${icon('trash')}${t('delete_project')}</button>`}</div></div></div></div>`;
      bind();
      PM.data.bindProject(root, proj);
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
      $('#r_add', root).onclick = async () => { const name = v('r_name').trim(); if (!name) { $('#r_name', root).focus(); return; } const r = await busy($('#r_add', root), () => api('POST', `/api/projects/${p.id}/resources`, { name, role: v('r_role'), email: v('r_email'), teams_name: v('r_teams'), jira_account: v('r_jira') })); if (r) { team = (await api('GET', `/api/projects/${p.id}/resources`)).resources; draw(); } };
      $$('[data-rdel]', root).forEach((b) => (b.onclick = async () => { await busy(null, () => api('DELETE', `/api/projects/${p.id}/resources/${b.dataset.rdel}`)); team = (await api('GET', `/api/projects/${p.id}/resources`)).resources; draw(); }));
      const delBtn = $('#delProj', root);
      if (delBtn) delBtn.onclick = async () => { if (await confirmDlg({ title: t('delete_project'), message: t('confirm_delete_project', { name: esc(proj.name) }), ok: t('delete_project'), danger: true })) { const r = await busy(null, () => api('DELETE', `/api/projects/${p.id}`)); if (r) location.hash = '#/projects'; } };
    }
    draw();
  };
})();
