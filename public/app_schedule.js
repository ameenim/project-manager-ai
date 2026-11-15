/* Schedule tab: connects the Gantt to the API, the impact pop-up, undo and reordering. */
(function () {
  const { esc, t, icon, $, $$, api, toast, modal, confirmDlg, busy, state: S } = window.PM;
  const U = window.GanttUtil;

  window.PM.views.tab_schedule = async function (root, p, q, token) {
    root.innerHTML = `<div class="page wide" style="padding-top:16px"><div class="sv-bar"><div class="seg" id="svSeg" role="group" aria-label="${esc(t('b_view_label'))}"><button type="button" data-v="gantt">${icon('list')}${esc(t('b_view_gantt'))}</button><button type="button" data-v="board">${icon('grid')}${esc(t('b_view_board'))}</button></div></div><div id="schedBanner"></div><div id="gt"></div><div id="bd" hidden></div></div>`;
    let data = await api('GET', `/api/projects/${p.id}/schedule`);
    const undoStack = [];
    const base = `/api/projects/${p.id}`;
    let g;

    const wbsMap = () => {
      const ids = new Set(g.tasks.map((x) => x.id));
      const by = byParent();
      const map = new Map(), rev = new Map();
      const walk = (pid, pre) => (by.get(pid) || []).forEach((x, i) => { const w = pre ? `${pre}.${i + 1}` : `${i + 1}`; map.set(x.id, w); rev.set(w, x.id); walk(x.id, w); });
      walk(0, '');
      return { map, rev };
    };
    const key = (x, ids) => (x.parent_id && ids.has(x.parent_id) ? x.parent_id : 0);
    function byParent() {
      const ids = new Set(g.tasks.map((x) => x.id));
      const by = new Map();
      for (const x of g.tasks) { const k = key(x, ids); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
      for (const arr of by.values()) arr.sort((a, b) => a.position - b.position || a.id - b.id);
      return by;
    }
    const flatten = (by) => { const out = []; const walk = (pid) => (by.get(pid) || []).forEach((x) => { out.push({ id: x.id, parent_id: pid || null }); walk(x.id); }); walk(0); return out; };

    const banner = () => {
      const el = $('#schedBanner', root);
      if (!g.tasks.length) el.innerHTML = `<div class="banner mb">${icon('cal')}<div class="grow"><b>${t('no_tasks')}</b><div class="small muted">${t('no_tasks_hint')}</div></div><a class="btn" href="#/p/${p.id}/review?kind=schedule">${t('review_schedule_lines')}</a></div>`;
      else el.innerHTML = '';
    };

    const pickFields = (x) => ({ start: x.start, duration: x.duration, progress: x.progress, deps: x.deps, name: x.name, assignee: x.assignee || '', mode: x.mode || 'auto', flag: x.flag ? 1 : 0, links: x.links || [], deliverable_id: x.deliverable_id || null });

    // Board moves are optimistic: the local task changes in the same frame and the request follows in order.
    // Responses only reconcile when no other optimistic request is still on its way, so a slow reply never flicks a card back.
    let chain = Promise.resolve(), pending = 0;
    const queued = (fn) => { const r = chain.then(fn); chain = r.then(() => {}, () => {}); return r; };
    // true when progress is the only thing that really differs from the task now (an undo snapshot carries every field)
    const norm = (v) => (!v || (Array.isArray(v) && !v.length) ? '' : JSON.stringify(v));
    const progressOnly = (changes) => Object.entries(changes).every(([id, c]) => {
      const x = g.tasks.find((k) => k.id === Number(id));
      return !!x && Object.keys(c).every((k) => k === 'progress' || norm(c[k]) === norm(k === 'mode' ? x.mode || 'auto' : x[k]));
    });
    const fastOk = (changes) => view === 'board' && progressOnly(changes);
    function patchLocal(changes) {
      const before = [];
      for (const [id, ch] of Object.entries(changes)) {
        const x = g.tasks.find((k) => k.id === Number(id));
        if (x && 'progress' in ch) { before.push([x, x.progress]); x.progress = ch.progress; }
      }
      board.render();
      return () => { for (const [x, v] of before) x.progress = v; board.render(); };
    }

    async function applyChanges(changes, undo, opt) {
      return queued(async () => {
        let res;
        try { res = await api('POST', `${base}/schedule/apply`, { changes }); } catch (e) {
          toast(e.message, 'err');
          if (opt) {
            pending--;
            if (opt.undo) { const i = undoStack.indexOf(opt.undo); if (i >= 0) undoStack.splice(i, 1); }
            if (opt.restore) undoStack.push(opt.restore);
            g.canUndo = undoStack.length > 0;
            opt.revert();
          } else g.render();
          return false;
        }
        if (opt) pending--;
        else if (undo) { undoStack.push(undo); if (undoStack.length > 30) undoStack.shift(); }
        g.canUndo = undoStack.length > 0;
        if (!opt || pending === 0) { data = res; g.setData(res); banner(); }
        return true;
      });
    }

    function impactDialog(pv) {
      return new Promise((resolve) => {
        let answered = false;
        const shiftCell = (i) => {
          if (!i.before) return `<span class="chip green">${t('new')}</span>`;
          const d = U.diff(i.before.finish, i.after.finish);
          return d === 0 ? `<span class="muted">${t('start_moved')}</span>` : `<span class="shift ${d > 0 ? 'late' : 'early'}">${d > 0 ? '+' : ''}${d} ${t('days')}</span>`;
        };
        const rows = pv.impacts.map((i) => `<tr><td><b>${esc(i.name)}</b>${i.direct ? ` <span class="chip blue">${t('moved_by_you')}</span>` : ''}</td><td class="nowrap">${i.before ? `${i.before.start}<br><span class="muted">${i.before.finish}</span>` : ''}</td><td class="nowrap">${i.after.start}<br><span class="muted">${i.after.finish}</span></td><td>${shiftCell(i)}</td></tr>`).join('');
        const cons = pv.constrained.map((c) => `<div class="banner warn small" style="margin-bottom:8px">${icon('alert')}<div>${t('constrained_note', { name: esc(c.name), want: c.requested, actual: c.actual })}</div></div>`).join('');
        const endChange = pv.projectEnd.before !== pv.projectEnd.after ? `<div class="banner ${pv.projectEnd.after > pv.projectEnd.before ? 'warn' : 'ok'}" style="margin-bottom:10px">${icon('flag')}<div><b>${t('project_end_moves')}</b> ${pv.projectEnd.before} → ${pv.projectEnd.after}</div></div>` : '';
        const m = modal({
          title: t('impact_title'), size: 'lg', noBackdropClose: true,
          onClose: () => { if (!answered) resolve(false); },
          body: `<p class="muted" style="margin-top:0">${t('impact_intro', { n: pv.impacts.filter((i) => !i.direct).length })}</p>${endChange}${cons}<div class="table-wrap"><table class="t"><thead><tr><th>${t('g_task')}</th><th>${t('before')}</th><th>${t('after')}</th><th>${t('shift')}</th></tr></thead><tbody>${rows}</tbody></table></div>`,
          footer: `<label class="check grow small muted"><input type="checkbox" id="noAsk"> ${t('dont_ask_again')}</label><button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="impOk">${icon('check')}${t('apply_changes')}</button>`,
        });
        m.$('#impOk').onclick = async () => {
          answered = true;
          if (m.$('#noAsk').checked) { await api('PUT', base, { impact_check: false }).catch(() => {}); g.impactOn = false; g.updateToolbar(); toast(t('impact_off_hint'), '', null); }
          resolve(true); m.close();
        };
        m.$('#impOk').focus();
      });
    }

    async function commit(changes, meta = {}) {
      // finishing a task can close its deliverable, invoice a payment or mitigate a risk: ask first
      let ops = [];
      if (Object.values(changes).some((c) => c.progress >= 100)) {
        const r = await PM.completion.flow(p.id, changes, data, p.currency);
        if (r === null) { g.render(); return; }
        ops = r;
      }
      const ids = Object.keys(changes).map(Number);
      const affectsDates = Object.values(changes).some((c) => 'start' in c || 'duration' in c || 'deps' in c || 'mode' in c);
      let impactIds = ids;
      if (affectsDates) {
        let pv;
        try { pv = await api('POST', `${base}/schedule/preview`, { changes }); } catch (e) { toast(e.message, 'err'); g.render(); return; }
        impactIds = [...new Set([...ids, ...pv.impacts.map((i) => i.id)])];
        const others = pv.impacts.filter((i) => !i.direct).length;
        const significant = others || pv.constrained.length || pv.projectEnd.before !== pv.projectEnd.after;
        if (g.impactOn && significant) {
          if (!(await impactDialog(pv))) { g.render(); return; }
        } else if (pv.constrained.length) {
          const c = pv.constrained[0];
          toast(t('constrained_toast', { name: c.name, actual: c.actual }));
        }
      }
      const inverse = {};
      for (const id of impactIds) { const x = g.tasks.find((k) => k.id === id); if (x) inverse[id] = pickFields(x); }
      const undo = { label: meta.label, changes: inverse, ops };
      const after = async (done) => {
        if (done && ops.length) {
          await PM.completion.commit(ops);
          data = await api('GET', `${base}/schedule`); g.setData(data);
          toast(t('cm_done'), 'ok');
        }
        return done;
      };
      if (fastOk(changes)) {
        // instant: the board shows the move now, the server catches up behind it
        undoStack.push(undo); if (undoStack.length > 30) undoStack.shift();
        g.canUndo = true; pending++;
        const revert = patchLocal(changes);
        applyChanges(changes, null, { undo, revert }).then(after);
        return;
      }
      await after(await applyChanges(changes, undo));
    }

    // ----- dependency editor and schedule check -----
    function linkDialog(pred, succ) {
      const s = g.tasks.find((x) => x.id === succ), pr = g.tasks.find((x) => x.id === pred);
      const dep = s && (s.deps || []).find((d) => d.id === pred);
      if (!s || !pr || !dep) return;
      const types = ['FS', 'SS', 'FF', 'SF'];
      const m = modal({
        title: t('link_title'),
        body: `<p class="muted" style="margin-top:0"><b>${esc(pr.name)}</b> &rarr; <b>${esc(s.name)}</b></p>
          <div class="form-grid"><label class="f full">${t('link_type')}<select id="lk_type">${types.map((k) => `<option value="${k}" ${(dep.type || 'FS') === k ? 'selected' : ''}>${k}: ${t('link_' + k)}</option>`).join('')}</select></label>
          <label class="f full">${t('link_lag')}<input type="number" id="lk_lag" min="-365" max="365" value="${dep.lag || 0}"><span class="small faint">${t('link_lag_hint')}</span></label></div>`,
        footer: `<button class="btn danger" id="lkDel" style="margin-inline-end:auto">${icon('trash')}${t('remove')}</button><button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="lkOk">${t('save')}</button>`,
      });
      m.$('#lkOk').onclick = async () => {
        const lag = Math.round(Number(m.$('#lk_lag').value) || 0), type = m.$('#lk_type').value;
        m.close();
        if (lag === (dep.lag || 0) && type === (dep.type || 'FS')) return;
        await commit({ [succ]: { deps: s.deps.map((d) => (d.id === pred ? { ...d, lag, type } : d)) } }, { label: 'link' });
      };
      m.$('#lkDel').onclick = async () => { m.close(); await commit({ [succ]: { deps: s.deps.filter((d) => d.id !== pred) } }, { label: 'unlink' }); };
    }

    // ----- schedule check: logic, links and overall health -----
    const CHK_CAT = { isolated: 'logic', no_pred: 'logic', no_succ: 'logic', milestone_duration: 'logic', long_lag: 'logic', negative_lag: 'logic', conflict: 'logic', link: 'logic', depth: 'logic', duration: 'logic', start: 'logic', out_of_sequence: 'logic',
      del_unlinked: 'links', pay_unlinked: 'links', req_unlinked: 'links', risk_unlinked: 'links', pay_late_work: 'links', closed_open_tasks: 'links', ready_to_close: 'links', broken_link: 'links',
      over_contract: 'overall', late: 'overall', overdue: 'overall', not_started: 'overall', no_baseline: 'overall', too_critical: 'overall', no_owner: 'overall' };
    const chkText = (key, i) => { const k = key + i.code, v = t(k, i.params || {}); return v === k ? null : v; };
    async function validateDialog(cat = 'all') {
      let r = await busy(null, () => api('GET', `${base}/schedule/validate`));
      if (!r) return;
      let ai = null, running = false; const dismissed = new Set();
      const sev = { error: 'red', warn: 'amber', info: 'blue' };
      const catOf = (i) => CHK_CAT[i.code] || 'overall';
      const buildTiles = () => {
      const st = r.stats || { coverage: {} };
      const counts = { all: r.issues.length, logic: 0, links: 0, overall: 0 };
      r.issues.forEach((i) => { counts[catOf(i)]++; });
      const score = st.score ?? 100, band = score >= 85 ? 'good' : score >= 65 ? 'mid' : 'bad';
      const cov = (k, label) => { const c = (st.coverage || {})[k] || { total: 0, linked: 0 }; const pc = c.total ? Math.round(100 * c.linked / c.total) : 100; return `<button type="button" class="chk-tile" data-cat="links"><span class="small muted">${t(label)}</span><b>${c.total ? `${c.linked}/${c.total}` : '-'}</b><div class="progress"><i style="width:${pc}%"></i></div></button>`; };
      const tiles = `<div class="chk-tiles"><div class="chk-score ${band}" style="--v:${score}"><b>${score}</b></div>
        <div class="grow"><div style="font-weight:var(--fw)">${t('chk_band_' + band)}</div><div class="small muted">${t('validate_summary', { e: r.errors, w: r.warnings })}${st.finish ? ` &middot; ${t('chk_finish', { d: st.finish })}${st.contract_end ? ` ${t('chk_vs_contract', { d: st.contract_end })}` : ''}` : ''}</div></div></div>
        <div class="chk-tiles four"><button type="button" class="chk-tile" data-cat="logic"><span class="small muted">${t('chk_logic')}</span><b>${st.logic_ok ?? 100}%</b><div class="progress"><i style="width:${st.logic_ok ?? 100}%"></i></div></button>${cov('deliverable', 'kind_deliverable')}${cov('milestone', 'kind_milestone')}${cov('requirement', 'kind_requirement')}</div>`;
        counts_ = counts; return tiles;
      };
      let counts_ = null;
      const m = modal({ title: t('validate_title'), size: 'lg', body: '', footer: `<button class="btn primary" data-close>${t('close')}</button>` });
      const aiAction = (a) => {
        const nm = (x) => `<b>${esc(x)}</b>`;
        if (a.type === 'link') return t('asst_a_link', { kind: t('asst_k_' + a.kind), item: nm(a.item_title), tasks: (a.task_names || []).map(nm).join(', ') });
        if (a.type === 'dep') return t('asst_a_dep', { task: nm(a.task_name), pred: nm(a.pred_name) });
        if (a.type === 'close') return t('asst_a_close', { item: nm(a.item_title) });
        if (a.type === 'duration') return t('asst_a_duration', { task: nm(a.task_name) });
        return t('asst_a_unlink', { task: nm(a.task_name) });
      };
      const confChip = (c) => `<span class="conf ${c >= 0.85 ? 'hi' : c >= 0.7 ? 'mid' : 'lo'}">${t(c >= 0.85 ? 'rv_c_hi' : c >= 0.7 ? 'rv_c_mid' : 'rv_c_lo')} · ${Math.round(c * 100)}%</span>`;
      const aiHtml = () => {
        if (running) return `<div class="asst">${PM.loader.html({ size: 'sm' })}<div class="grow"><b>${t('asst_running')}</b><div class="small muted">${t('asst_running_hint')}</div></div></div>`;
        if (!ai) return `<div class="asst"><span class="asst-ic">${icon('spark')}</span><div class="grow"><b>${t('asst_title')}</b><div class="small muted">${t('asst_hint')}</div></div><button class="btn primary" id="asstRun">${icon('spark')}${t('asst_btn')}</button></div>`;
        const sugg = ai.suggestions.filter((x) => !dismissed.has(x.key));
        const warn = ai.note ? `<div class="banner mb">${icon('x')}<div class="grow small">${t(ai.note === 'budget' || ai.note === 'bad_key' ? 'asst_note_key' : 'asst_note_rules')}</div></div>` : '';
        const done = ai.applied.length ? `<div class="asst-sec ok"><div class="asst-h"><span class="chip green">${icon('check')}${t('asst_applied_h', { n: ai.applied.length })}</span><span class="grow"></span>${ai.token ? `<button class="btn sm" id="asstUndo">${t('asst_undo')}</button>` : ''}</div>${ai.applied.slice(0, 12).map((a) => `<div class="asst-row"><div class="grow">${aiAction(a)}<div class="small muted">${esc(a.reason || '')}</div></div></div>`).join('')}${ai.applied.length > 12 ? `<div class="small muted">+${ai.applied.length - 12}</div>` : ''}</div>` : '';
        const sg = sugg.length ? `<div class="asst-sec"><div class="asst-h"><b>${t('asst_sugg_h', { n: sugg.length })}</b><span class="grow"></span><button class="btn sm primary" id="asstAll">${t('asst_apply_all')}</button></div>${sugg.map((a) => `<div class="asst-row"><div class="grow">${aiAction(a)}<div class="small muted">${esc(a.reason || '')}${a.moves ? ` ${t('asst_moves', { d: esc(a.start_from || '') })}` : ''}</div><div>${confChip(a.confidence)}</div></div><div class="asst-acts"><button class="btn sm primary" data-apply="${a.key}">${t('asst_apply')}</button><button class="btn sm ghost" data-dismiss="${a.key}">${t('asst_dismiss')}</button></div></div>`).join('')}</div>` : (!ai.applied.length ? `<div class="asst-sec"><div class="small muted">${t('asst_none')}</div></div>` : '');
        return `${warn}${done}${sg}<div class="row" style="margin:8px 0"><button class="btn sm ghost" id="asstRun">${icon('refresh')}${t('asst_again')}</button></div>`;
      };
      const refresh = async (res) => { if (res && res.tasks) { data = res; g.setData(res); } r = await api('GET', `${base}/schedule/validate`); draw(); };
      const draw = () => {
        const tiles = buildTiles(); const counts = counts_;
        const list = r.issues.filter((i) => cat === 'all' || catOf(i) === cat);
        const byCode = new Map(); list.forEach((i) => { if (!byCode.has(i.code)) byCode.set(i.code, []); byCode.get(i.code).push(i); });
        const grp = [...byCode.entries()].map(([code, arr]) => {
          const top = arr[0], shown = arr.slice(0, 6);
          const row = (i) => {
            const label = chkText('chk_', i) || i.message;
            const fix = i.item_id ? (i.code === 'ready_to_close' || i.code === 'closed_open_tasks' ? `<button class="btn sm" data-close-del="${i.item_id}" data-to="${i.code === 'ready_to_close' ? 'closed' : 'open'}">${t(i.code === 'ready_to_close' ? 'chk_fix_close' : 'chk_fix_reopen')}</button>` : `<button class="btn sm" data-link-item="${i.item_id}">${icon('link')}${t('chk_fix_link')}</button>`) : i.task_id && ['isolated', 'no_pred', 'no_succ', 'overdue', 'milestone_duration', 'duration'].includes(i.code) ? `<button class="btn sm" data-fix="${i.task_id}">${t('chk_fix_edit')}</button>` : '';
            const who = i.task || i.item_title;
            return `<div class="list-item" ${i.task_id ? `data-pick="${i.task_id}" style="cursor:pointer"` : ''}><div class="grow">${who ? `<b>${esc(who)}</b> ` : ''}<span class="${who ? 'muted' : ''}">${esc(label)}</span></div>${fix}</div>`;
          };
          return `<div class="chk-grp"><div class="chk-h"><span class="chip ${sev[top.severity]}">${t('sev_' + top.severity)}</span><b class="grow">${esc(chkText('chk_t_', top) || top.message)}</b><span class="small muted">${arr.length}</span></div>${shown.map(row).join('')}${arr.length > shown.length ? `<div class="small muted" style="padding:6px 2px">${t('chk_more', { n: arr.length - shown.length })}</div>` : ''}</div>`;
        }).join('');
        m.setBody(`${tiles}<div class="asst-wrap">${aiHtml()}</div><div class="chk-tabs" role="tablist">${['all', 'logic', 'links', 'overall'].map((k) => `<button type="button" class="filter-chip ${cat === k ? 'on' : ''}" data-cat="${k}">${t('chk_cat_' + k)} <b>${counts[k]}</b></button>`).join('')}</div>
          ${list.length ? grp : `<div class="empty"><div class="big ok">${icon('check')}</div><p>${t('validate_ok')}</p></div>`}`);
        m.$$('[data-cat]').forEach((el) => (el.onclick = () => { cat = el.dataset.cat; draw(); }));
        const run = m.$('#asstRun');
        if (run) run.onclick = async () => { running = true; dismissed.clear(); draw(); try { ai = await api('POST', `${base}/schedule/assist`); } catch (e) { toast(e.message, 'err'); ai = null; } running = false; await refresh(ai); };
        const undo = m.$('#asstUndo');
        if (undo) undo.onclick = async () => { const res = await busy(undo, () => api('POST', `${base}/schedule/assist/undo`, { token: ai.token })); if (res) { toast(t('asst_undone'), 'ok'); ai = null; await refresh(res); } };
        const applyKeys = async (keys, btn) => {
          const acts = ai.suggestions.filter((x) => keys.includes(x.key));
          const res = await busy(btn, () => api('POST', `${base}/schedule/assist/apply`, { actions: acts }));
          if (!res) return;
          toast(t('asst_done', { n: res.applied }), 'ok');
          ai.suggestions = ai.suggestions.filter((x) => !keys.includes(x.key));
          if (res.token) { ai.token = res.token; ai.applied = [...ai.applied, ...acts]; }
          await refresh(res);
        };
        m.$$('[data-apply]').forEach((el) => (el.onclick = () => applyKeys([el.dataset.apply], el)));
        m.$$('[data-dismiss]').forEach((el) => (el.onclick = () => { dismissed.add(el.dataset.dismiss); draw(); }));
        const all = m.$('#asstAll'); if (all) all.onclick = () => applyKeys(ai.suggestions.filter((x) => !dismissed.has(x.key)).map((x) => x.key), all);
        m.$$('[data-pick]').forEach((el) => (el.onclick = (e) => { if (e.target.closest('button')) return; m.close(); g.goTo(Number(el.dataset.pick)); }));
        m.$$('[data-fix]').forEach((el) => (el.onclick = () => { m.close(); editDialog(g.tasks.find((x) => x.id === Number(el.dataset.fix))); }));
        m.$$('[data-link-item]').forEach((el) => (el.onclick = () => { m.close(); itemLinkDialog(data.items.find((x) => x.id === Number(el.dataset.linkItem)), () => validateDialog(cat)); }));
        m.$$('[data-close-del]').forEach((el) => (el.onclick = async () => { await busy(el, () => api('PUT', `/api/items/${el.dataset.closeDel}`, { state: el.dataset.to })); m.close(); data = await api('GET', `${base}/schedule`); g.setData(data); validateDialog(cat); }));
      };
      draw();
    }

    // ----- links between tasks and deliverables, payments, requirements and risks -----
    const kindOrder = ['deliverable', 'milestone', 'requirement', 'risk'];
    const taskLabel = (tk) => { const w = g._wbsAll && g._wbsAll.get(tk.id); return `${w ? w + '  ' : ''}${tk.name}`; };
    const itemTasks = (item) => g.tasks.filter((tk) => !tk.summary && g.linkIds(tk).includes(item.id));
    // pick the items a task delivers
    function taskLinkDialog(tk) {
      if (!tk) return;
      const checked = new Set(g.linkIds(tk));
      let q = '';
      const m = modal({ title: t('lk_task_title'), size: 'lg', body: '', footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="lkSave">${t('save')}</button>` });
      const draw = () => {
        const items = data.items.filter((i) => !q || i.title.toLowerCase().includes(q));
        m.setBody(`<p class="muted" style="margin-top:0">${t('lk_task_intro', { name: `<b>${esc(tk.name)}</b>` })}</p>
          <label class="sf rb-search wide">${icon('search')}<input type="search" id="lkQ" placeholder="${esc(t('g_find'))}" value="${esc(q)}"></label>
          ${kindOrder.map((k) => { const list = items.filter((i) => i.kind === k); return list.length ? `<div class="lk-kind">${t('kind_' + k)}</div>${list.map((i) => `<label class="cm-row"><input type="checkbox" data-it="${i.id}" ${checked.has(i.id) ? 'checked' : ''}><span class="grow"><b>${esc(i.title)}</b></span><span class="chip ${i.state === 'closed' || i.state === 'paid' || i.state === 'invoiced' || i.state === 'mitigated' ? 'green' : 'gray'}">${esc(t('state_' + i.state) === 'state_' + i.state ? i.state : t('state_' + i.state))}</span></label>`).join('')}` : ''; }).join('') || `<div class="empty small">${t('lk_none')}</div>`}`);
        m.$$('[data-it]').forEach((c) => (c.onchange = () => { c.checked ? checked.add(Number(c.dataset.it)) : checked.delete(Number(c.dataset.it)); }));
        const inp = m.$('#lkQ'); inp.oninput = () => { q = inp.value.toLowerCase(); draw(); const n = m.$('#lkQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
      };
      draw();
      m.$('#lkSave').onclick = async () => {
        let did = tk.deliverable_id && checked.has(tk.deliverable_id) ? tk.deliverable_id : null;
        const rest = [...checked].filter((id) => id !== did);
        if (!did) { const d = rest.find((id) => (g.itemMap.get(id) || {}).kind === 'deliverable'); if (d) { did = d; rest.splice(rest.indexOf(d), 1); } }
        m.close();
        const before = JSON.stringify([tk.deliverable_id || null, [...(tk.links || [])].sort()]);
        if (before === JSON.stringify([did, [...rest].sort()])) return;
        await commit({ [tk.id]: { deliverable_id: did, links: rest } }, { label: 'links' });
        toast(t('lk_saved'), 'ok');
      };
    }
    // pick the tasks that deliver one item
    function itemLinkDialog(item, then) {
      if (!item) return;
      const leaves = g.tasks.filter((x) => !x.summary);
      const was = new Set(itemTasks(item).map((x) => x.id)), checked = new Set(was);
      let q = '';
      const m = modal({ title: t('lk_item_title'), size: 'lg', body: '', footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="lkSave">${t('save')}</button>` });
      const draw = () => {
        const list = leaves.filter((x) => !q || x.name.toLowerCase().includes(q) || (g._wbsAll.get(x.id) || '') === q);
        m.setBody(`<p class="muted" style="margin-top:0">${t('lk_item_intro', { kind: esc(t('kind_' + item.kind)), name: `<b>${esc(item.title)}</b>` })}</p>
          <label class="sf rb-search wide">${icon('search')}<input type="search" id="lkQ" placeholder="${esc(t('g_find'))}" value="${esc(q)}"></label>
          <div class="lk-list">${list.slice(0, 200).map((x) => `<label class="cm-row"><input type="checkbox" data-tk="${x.id}" ${checked.has(x.id) ? 'checked' : ''}><span class="grow">${esc(taskLabel(x))}</span><span class="small muted">${esc(x.finish || '')}</span></label>`).join('') || `<div class="empty small">${t('lk_none')}</div>`}${list.length > 200 ? `<div class="small muted">${t('chk_more', { n: list.length - 200 })}</div>` : ''}</div>`);
        m.$$('[data-tk]').forEach((c) => (c.onchange = () => { c.checked ? checked.add(Number(c.dataset.tk)) : checked.delete(Number(c.dataset.tk)); }));
        const inp = m.$('#lkQ'); inp.oninput = () => { q = inp.value.toLowerCase(); draw(); const n = m.$('#lkQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
      };
      draw();
      m.$('#lkSave').onclick = async () => {
        const changes = {};
        for (const id of new Set([...was, ...checked])) {
          if (was.has(id) === checked.has(id)) continue;
          const tk = g.tasks.find((x) => x.id === id); if (!tk) continue;
          if (checked.has(id)) changes[id] = tk.deliverable_id || item.kind !== 'deliverable' ? { links: [...(tk.links || []), item.id] } : { deliverable_id: item.id };
          else changes[id] = { links: (tk.links || []).filter((k) => k !== item.id), ...(tk.deliverable_id === item.id ? { deliverable_id: null } : {}) };
        }
        m.close();
        if (Object.keys(changes).length) { await commit(changes, { label: 'links' }); toast(t('lk_saved'), 'ok'); }
        then && then();
      };
    }
    // every deliverable, payment, requirement and risk with the tasks behind it
    function linkManager() {
      let kind = 'all';
      const m = modal({ title: t('lk_manager_title'), size: 'lg', body: '', footer: `<button class="btn primary" data-close>${t('close')}</button>` });
      const draw = () => {
        const covered = (i) => itemTasks(i).length > 0 || (i.kind === 'milestone' && i.data && i.data.deliverable_id && itemTasks({ id: Number(i.data.deliverable_id) }).length > 0);
        const items = data.items.filter((i) => kind === 'all' || i.kind === kind || (kind === 'none' && !covered(i)));
        const chips = ['all', ...kindOrder, 'none'].map((k) => `<button type="button" class="filter-chip ${kind === k ? 'on' : ''}" data-k="${k}">${t(k === 'all' ? 'g_f_all' : k === 'none' ? 'g_f_unlinked' : 'kind_' + k)}</button>`).join('');
        m.setBody(`<p class="muted" style="margin-top:0">${t('lk_manager_intro')}</p><div class="chk-tabs">${chips}</div>
          ${items.map((i) => { const ts = itemTasks(i); const via = !ts.length && i.kind === 'milestone' && i.data && i.data.deliverable_id ? (data.items.find((x) => x.id === Number(i.data.deliverable_id)) || {}).title : null;
            return `<div class="list-item"><div class="grow"><div><span class="chip gray">${esc(t('kind_' + i.kind))}</span> <b>${esc(i.title)}</b></div><div class="small ${ts.length || via ? 'muted' : ''}" style="${ts.length || via ? '' : 'color:var(--warning)'}">${ts.length ? ts.slice(0, 3).map((x) => esc(x.name)).join(', ') + (ts.length > 3 ? ` +${ts.length - 3}` : '') : via ? t('lk_via', { title: esc(via) }) : t('lk_no_task')}</div></div><button class="btn sm" data-li="${i.id}">${icon('link')}${t(ts.length ? 'lk_change' : 'chk_fix_link')}</button></div>`; }).join('') || `<div class="empty small">${t('lk_none')}</div>`}`);
        m.$$('[data-k]').forEach((c) => (c.onclick = () => { kind = c.dataset.k; draw(); }));
        m.$$('[data-li]').forEach((c) => (c.onclick = () => { m.close(); itemLinkDialog(data.items.find((x) => x.id === Number(c.dataset.li)), linkManager); }));
      };
      draw();
    }

    // ----- version history -----
    const verSummary = (v) => {
      const x = v.meta || {}, bits = [];
      if (v.source === 'initial') return t('ver_initial', { n: v.task_count });
      if (v.source === 'restore') return t('ver_restored', { v: esc(v.label || '') });
      if (v.source === 'baseline') bits.push(t('ver_baseline'));
      if (x.added) bits.push(t('ver_added', { n: x.added }));
      if (x.removed) bits.push(t('ver_removed', { n: x.removed }));
      if (x.changed) bits.push(t('ver_changed', { n: x.changed }));
      if (!bits.length && x.reordered) bits.push(t('ver_reordered'));
      if (x.end_from && x.end_to && x.end_from !== x.end_to) { const d = U.diff(x.end_from, x.end_to); bits.push(t('ver_end', { d: `${d > 0 ? '+' : ''}${d}` })); }
      return bits.join(', ');
    };
    async function versionsDialog() {
      let list = (await busy(null, () => api('GET', `${base}/schedule/versions`)));
      if (!list) return;
      list = list.versions;
      const m = modal({ title: t('ver_title'), size: 'lg', body: '', footer: `<button class="btn primary" data-close>${t('close')}</button>` });
      const draw = (diff) => {
        m.setBody(`<p class="muted" style="margin-top:0">${t('ver_intro')}</p>
          <div class="row mb" style="gap:8px"><input type="text" id="vName" class="grow" maxlength="80" placeholder="${esc(t('ver_name_ph'))}"><button class="btn" id="vSave">${icon('check')}${t('g_save_version')}</button></div>
          <div class="ver-list">${list.map((v) => `<div class="ver ${v.current ? 'cur' : ''}"><span class="ver-dot ${v.level}"></span><div class="grow"><div class="ver-h"><b>${esc(v.version)}</b><span class="chip ${v.level === 'major' ? 'red' : v.level === 'minor' ? 'amber' : 'gray'}">${t('ver_' + v.level)}</span>${v.source === 'manual' ? `<span class="chip blue">${esc(v.label || '')}</span>` : ''}${v.current ? `<span class="chip green">${t('ver_current')}</span>` : ''}</div><div class="small muted">${verSummary(v)}</div><div class="small faint">${esc(String(v.created_at).slice(0, 16))} &middot; ${esc(v.author || '')} &middot; ${t('ver_tasks', { n: v.task_count })}${v.project_end ? ` &middot; ${t('chk_finish', { d: v.project_end })}` : ''}</div></div>
            ${v.current ? '' : `<button class="btn sm" data-cmp="${v.id}">${t('ver_compare')}</button><button class="btn sm" data-rest="${v.id}">${icon('undo')}${t('ver_restore')}</button>`}</div>${diff && diff.version.id === v.id ? diffHtml(diff) : ''}`).join('')}</div>`);
        m.$('#vSave').onclick = async () => {
          const label = m.$('#vName').value.trim(); if (!label) { m.$('#vName').focus(); return; }
          const r = await busy(m.$('#vSave'), () => api('POST', `${base}/schedule/versions`, { label }));
          if (r) { list = r.versions; toast(t('ver_saved'), 'ok'); draw(); }
        };
        m.$$('[data-cmp]').forEach((b) => (b.onclick = async () => { const d = await busy(b, () => api('GET', `${base}/schedule/versions/${b.dataset.cmp}/diff`)); if (d) draw(d); }));
        m.$$('[data-rest]').forEach((b) => (b.onclick = () => restore(list.find((v) => v.id === Number(b.dataset.rest)), m)));
      };
      const diffHtml = (d) => {
        const fl = (f) => t('ver_f_' + f) === 'ver_f_' + f ? f : t('ver_f_' + f);
        const rows = d.changes.slice(0, 12).map((c) => `<div class="small"><b>${esc(c.name)}</b> <span class="muted">${c.fields.map(fl).join(', ')}</span></div>`).join('');
        return `<div class="ver-diff"><div class="small"><b>${t('ver_diff_head', { v: esc(d.version.version) })}</b> ${t('ver_diff_sum', { a: d.added, r: d.removed, c: d.changed })}${d.end_then !== d.end_now ? ` &middot; ${t('ver_diff_end', { a: d.end_then || '-', b: d.end_now || '-' })}` : ''}</div>${rows}${d.changed > 12 ? `<div class="small muted">${t('chk_more', { n: d.changed - 12 })}</div>` : ''}${d.added_names.length ? `<div class="small">+ ${d.added_names.slice(0, 5).map(esc).join(', ')}</div>` : ''}${d.removed_names.length ? `<div class="small">- ${d.removed_names.slice(0, 5).map(esc).join(', ')}</div>` : ''}</div>`;
      };
      draw();
    }
    async function restore(v, dlg) {
      if (!v) return;
      const ok = await confirmDlg({ title: t('ver_restore_title', { v: v.version }), message: t('ver_restore_msg', { v: esc(v.version), n: v.task_count }), ok: t('ver_restore') });
      if (!ok) return;
      const r = await busy(null, () => api('POST', `${base}/schedule/versions/${v.id}/restore`));
      if (!r) return;
      undoStack.length = 0; g.canUndo = false;
      data = r; g.ui.selected = null; g.setData(r); banner();
      if (dlg) dlg.close();
      toast(t('ver_restored_toast', { v: v.version }), 'ok');
    }
    async function saveVersion() {
      const m = modal({ title: t('g_save_version'), body: `<p class="muted" style="margin-top:0">${t('ver_save_intro')}</p><input type="text" id="vName" maxlength="80" placeholder="${esc(t('ver_name_ph'))}" style="width:100%">`, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="vOk">${t('save')}</button>` });
      const go = async () => { const label = m.$('#vName').value.trim(); if (!label) { m.$('#vName').focus(); return; } const r = await busy(m.$('#vOk'), () => api('POST', `${base}/schedule/versions`, { label })); if (r) { m.close(); toast(t('ver_saved'), 'ok'); } };
      m.$('#vOk').onclick = go; m.$('#vName').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      setTimeout(() => m.$('#vName').focus(), 40);
    }

    // ----- quick actions from the ribbon -----
    const plannedPct = (tk) => {
      if (!tk.start || !tk.finish) return 0;
      const a = Date.parse(tk.start), b = Date.parse(tk.finish), n = Date.parse(data.today);
      if (n < a) return 0; if (n > b) return 100;
      return Math.max(0, Math.min(100, Math.round(100 * (n - a + 86400000) / (b - a + 86400000))));
    };
    function exportCsv() {
      const q = (v) => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x) && !/^[-+]?\d+([.,]\d+)?$/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
      const wb = g._wbsAll || new Map();
      const xk = g.extraFieldKeys();
      const head = [t('g_wbs'), t('g_task'), t('start'), t('g_finish'), t('duration_days'), t('progress'), t('g_owner'), t('predecessors'), t('g_mode'), t('g_link_items'), ...xk.map((k) => g.fieldTitle(k))];
      const rows = g.tasks.slice().sort((a, b2) => String(wb.get(a.id)).localeCompare(String(wb.get(b2.id)), undefined, { numeric: true })).map((x) => [wb.get(x.id), x.name, x.start, x.finish, x.duration, x.progress, x.assignee, (x.deps || []).map((d) => wb.get(d.id)).join(' '), x.mode, g.linkIds(x).map((id) => (g.itemMap.get(id) || {}).title).join(' | '), ...xk.map((k) => g.fieldValue(x, k))]);
      const csv = '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a2.download = `${(p.code || 'schedule').replace(/[^\w-]+/g, '_')}-schedule.csv`;
      document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(a2.href), 5000);
      toast(t('csv_exported'), 'ok');
    }

    // ----- Microsoft Project exchange -----
    function msDialog() {
      const m = modal({
        title: t('msp_title'), size: 'lg',
        body: `<p class="muted" style="margin-top:0">${t('msp_intro')}</p>
          <div class="card" style="box-shadow:none"><div class="card-head"><h3>${t('msp_export')}</h3></div><p class="small muted" style="margin-top:0">${t('msp_export_hint')}</p>
            <button class="btn primary" id="mspExp">${icon('dl')}${t('msp_export_btn')}</button><div id="mspXml"></div></div>
          <div class="card mt" style="box-shadow:none"><div class="card-head"><h3>${t('msp_import')}</h3></div><p class="small muted" style="margin-top:0">${t('msp_import_hint')}</p>
            <input type="file" id="mspFile" accept=".xml,text/xml,application/xml">
            <div class="row mt wrap" style="gap:16px"><label class="check"><input type="radio" name="mspMode" value="merge" checked> ${t('msp_merge')}</label><label class="check"><input type="radio" name="mspMode" value="replace"> ${t('msp_replace')}</label></div>
            <div id="mspPrev" class="mt"></div></div>`,
        footer: `<button class="btn" data-close>${t('close')}</button><button class="btn primary" id="mspGo" disabled>${t('msp_apply')}</button>`,
      });
      let xml = null;
      const mode = () => m.$('input[name=mspMode]:checked').value;
      const showPreview = async () => {
        if (!xml) return;
        try {
          const r = await api('POST', `${base}/msproject/import`, { xml, mode: mode(), preview: true });
          const s = r.summary;
          const warn = (s.warnings || []).slice(0, 5).map((w) => `<div class="small" style="color:var(--warning)">${esc(w)}</div>`).join('');
          m.$('#mspPrev').innerHTML = `<div class="banner">${icon('spark')}<div class="grow"><b>${t('msp_found', { n: s.tasks })}</b> ${t('msp_found_detail', { a: s.added, u: s.updated, l: s.links, lv: s.levels })}${mode() === 'replace' ? ` ${t('msp_replace_warn')}` : r.summary.missing ? ` ${t('msp_missing', { n: s.missing })}` : ''}</div></div>${warn}`;
          m.$('#mspGo').disabled = false;
        } catch (e) { m.$('#mspPrev').innerHTML = `<div class="small" style="color:var(--danger)">${esc(e.message)}</div>`; m.$('#mspGo').disabled = true; }
      };
      m.$('#mspFile').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { xml = await f.text(); } catch (x) { toast(t('msp_read_fail'), 'err'); return; }
        // Large Microsoft Project files are mostly detail the import ignores. Trim it here so the upload stays small.
        try { if (window.__MSP && window.__MSP.slim) xml = window.__MSP.slim(xml); } catch (x) { /* send the file as it is */ }
        showPreview();
      };
      m.$$('input[name=mspMode]').forEach((r) => (r.onchange = showPreview));
      m.$('#mspExp').onclick = async () => {
        const r = await busy(m.$('#mspExp'), () => api('GET', `${base}/msproject/export?format=json`));
        if (!r) return;
        const a2 = document.createElement('a');
        a2.href = URL.createObjectURL(new Blob([r.xml], { type: 'application/xml' }));
        a2.download = r.filename;
        document.body.appendChild(a2); a2.click(); a2.remove();
        setTimeout(() => URL.revokeObjectURL(a2.href), 5000);
        toast(t('msp_exported'), 'ok');
      };
      m.$('#mspGo').onclick = async () => {
        const r = await busy(m.$('#mspGo'), () => api('POST', `${base}/msproject/import`, { xml, mode: mode() }));
        if (!r) return;
        m.close();
        data = r; g.setData(r); banner();
        toast(t('msp_done', { a: r.summary.added, u: r.summary.updated }) + (r.issues && r.issues.length ? ` ${t('msp_issues', { n: r.issues.length })}` : ''), r.issues && r.issues.length ? '' : 'ok');
      };
    }

    // ----- add / edit / delete -----
    function addDialog(isMs) {
      const selT = g.sel();
      const defStart = selT ? selT.finish : data.tasks.length ? '' : p.start_date || data.today;
      const m = modal({
        title: isMs ? t('g_add_milestone') : t('g_add_task'),
        body: `<div class="form-grid"><label class="f full">${t('g_task')}<input type="text" id="nt_name" placeholder="${t('task_name_ph')}"></label>
          <label class="f">${t(isMs ? 'date' : 'start')}<input type="date" id="nt_start" value="${defStart || ''}"></label>${isMs ? '' : `<label class="f">${t('duration_days')}<input type="number" id="nt_dur" min="1" value="5"></label>`}
          <label class="f">${t('g_owner')}<input type="text" id="nt_owner" list="nt_res">${`<datalist id="nt_res">${(data.resources || []).map((r) => `<option value="${esc(r)}">`).join('')}</datalist>`}</label>
          <label class="f">${t('g_mode')}<select id="nt_mode"><option value="auto">${t('g_mode_auto')}</option><option value="manual">${t('g_mode_manual')}</option></select></label>
          ${selT ? `<label class="f">${t('position')}<select id="nt_pos"><option value="after">${t('pos_after')}</option><option value="child">${t('pos_child')}</option><option value="end">${t('pos_end')}</option></select></label>` : ''}</div>`,
        footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="ntOk">${t('add')}</button>`,
      });
      const go = async () => {
        const name = m.$('#nt_name').value.trim();
        if (!name) { m.$('#nt_name').focus(); return; }
        const pos = selT ? m.$('#nt_pos').value : 'end';
        const body = { name, start: m.$('#nt_start').value || null, duration: isMs ? 0 : Number(m.$('#nt_dur').value) || 1, is_milestone: !!isMs, assignee: m.$('#nt_owner').value || null, mode: m.$('#nt_mode').value };
        if (selT && pos === 'after') { body.after_id = selT.id; body.parent_id = selT.parent_id; }
        if (selT && pos === 'child') { body.after_id = selT.id; body.parent_id = selT.id; }
        const r = await busy(m.$('#ntOk'), () => api('POST', `${base}/tasks`, body));
        if (r) { m.close(); data = r; g.setData(r); banner(); g.select(r.created); }
      };
      m.$('#ntOk').onclick = go;
      m.$('#nt_name').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      setTimeout(() => m.$('#nt_name').focus(), 40);
    }

    function editDialog(tk) {
      if (!tk) return;
      window.PM.openTaskEditor(tk, { tasks: () => g.tasks, data: () => data, finishOf: (s, d, ms) => g.finishOf(s, d, ms), commit, del, linkItems: taskLinkDialog, linkCount: (x) => g.linkCount(x) });
    }

    async function del(tk) {
      if (!tk) return;
      const many = g.selTasks();
      if (many.length > 1) {
        const ok = await confirmDlg({ title: t('g_delete'), message: t('confirm_delete_many', { n: many.length }), ok: t('delete'), danger: true });
        if (!ok) return;
        const changes = {}; for (const x of many) changes[x.id] = { deleted: true };
        g.select(null);
        await applyChanges(changes, null);
        return;
      }
      const ok = await confirmDlg({ title: t('g_delete'), message: t(tk.summary ? 'confirm_delete_summary' : 'confirm_delete_task', { name: esc(tk.name) }), ok: t('delete'), danger: true });
      if (!ok) return;
      g.ui.selected = null; g.ui.multi = new Set();
      await applyChanges({ [tk.id]: { deleted: true } }, null);
    }

    // Moves every selected task. The tasks are handled in the order they appear on screen.
    async function reorder(mutate, failKey) {
      const picked = g.selTasks();
      if (!picked.length) return;
      const by = byParent();
      const ids = new Set(g.tasks.map((x) => x.id));
      const chosen = new Set(picked.map((x) => x.id));
      const parents = new Map(g.tasks.map((x) => [x, x.parent_id]));
      const undo = () => parents.forEach((v, x) => { x.parent_id = v; });
      if (!mutate(by, picked, chosen, ids)) { undo(); toast(t(failKey), ''); return; }
      try { data = await api('POST', `${base}/schedule/reorder`, { order: flatten(by) }); g.setData(data); } catch (e) { undo(); toast(e.message, 'err'); }
    }
    const sibsOf = (by, tk, ids) => by.get(key(tk, ids));
    const moveUp = (by, picked, chosen, ids) => { let moved = false; for (const sibs of new Set(picked.map((x) => sibsOf(by, x, ids)))) for (let i = 1; i < sibs.length; i++) if (chosen.has(sibs[i].id) && !chosen.has(sibs[i - 1].id)) { [sibs[i - 1], sibs[i]] = [sibs[i], sibs[i - 1]]; moved = true; } return moved; };
    const moveDown = (by, picked, chosen, ids) => { let moved = false; for (const sibs of new Set(picked.map((x) => sibsOf(by, x, ids)))) for (let i = sibs.length - 2; i >= 0; i--) if (chosen.has(sibs[i].id) && !chosen.has(sibs[i + 1].id)) { [sibs[i + 1], sibs[i]] = [sibs[i], sibs[i + 1]]; moved = true; } return moved; };
    const indentAll = (by, picked, chosen, ids) => {
      let moved = false;
      for (const tk of picked) {
        const sibs = by.get(key(tk, ids)), i = sibs.indexOf(tk);
        if (i <= 0) continue;
        const prev = sibs[i - 1]; sibs.splice(i, 1); by.set(prev.id, [...(by.get(prev.id) || []), tk]); tk.parent_id = prev.id; moved = true;
      }
      return moved;
    };
    const outdentAll = (by, picked, chosen, ids) => {
      let moved = false; const placed = new Map();
      for (const tk of picked) {
        const k = key(tk, ids); if (!k) continue;
        const parent = g.tasks.find((x) => x.id === k), gp = key(parent, ids), ps = by.get(gp), sibs = by.get(k);
        sibs.splice(sibs.indexOf(tk), 1);
        const n = placed.get(k) || 0; placed.set(k, n + 1);
        ps.splice(ps.indexOf(parent) + 1 + n, 0, tk); tk.parent_id = gp || null; moved = true;
      }
      return moved;
    };

    // Drag and drop: move a task above or below another task, or inside it as a subtask.
    async function moveTo(id, targetId, pos) {
      const tk = g.tasks.find((x) => x.id === id), tg = g.tasks.find((x) => x.id === targetId);
      if (!tk || !tg || id === targetId) return;
      const by = byParent();
      const ids = new Set(g.tasks.map((x) => x.id));
      const from = by.get(key(tk, ids));
      from.splice(from.indexOf(tk), 1);
      if (pos === 'into' || (pos === 'after' && tg.summary && !g.ui.collapsed.has(tg.id))) {
        const kids = by.get(tg.id) || [];
        if (pos === 'into') kids.push(tk); else kids.unshift(tk);
        by.set(tg.id, kids);
      } else {
        const sibs = by.get(key(tg, ids));
        const i = sibs.indexOf(tg);
        sibs.splice(pos === 'before' ? i : i + 1, 0, tk);
      }
      try { data = await api('POST', `${base}/schedule/reorder`, { order: flatten(by) }); g.setData(data); g.select(id); toast(t('g_moved'), 'ok'); } catch (e) { toast(e.message, 'err'); }
    }

    // the plus button between two rows: new task right there, name ready to type
    async function insertBetween(prev, next) {
      const body = { name: t('g_new_task'), duration: 1 };
      if (prev) {
        const asChild = !!(next && next.parent_id === prev.id);
        body.after_id = prev.id;
        body.parent_id = asChild ? prev.id : prev.parent_id || null;
        body.start = asChild || prev.summary ? prev.start : U.addD(prev.finish, 1);
      }
      const r = await busy(null, () => api('POST', `${base}/tasks`, body));
      if (!r) return;
      data = r; g.setData(r); banner(); g.select(r.created);
      setTimeout(() => g.startEdit(r.created, 'name'), 60);
    }

    g = new window.Gantt($('#gt', root), {
      t, lang: S.lang, commit, toast,
      onInsert: insertBetween, onMoveTo: moveTo, onAdd: () => addDialog(false), onAddMilestone: () => addDialog(true), onEdit: editDialog, onDelete: del,
      onIndent: () => reorder(indentAll, 'cant_indent'),
      onOutdent: () => reorder(outdentAll, 'cant_outdent'),
      onUp: () => reorder(moveUp, 'cant_move'),
      onDown: () => reorder(moveDown, 'cant_move'),
      onUndo: async () => {
        const u = undoStack.pop();
        if (!u) return;
        let opt;
        if (fastOk(u.changes)) { g.canUndo = undoStack.length > 0; pending++; opt = { restore: u, revert: patchLocal(u.changes) }; toast(t('undone'), 'ok'); }
        const ok = await applyChanges(u.changes, null, opt);
        if (ok && u.ops && u.ops.length) { await PM.completion.revert(u.ops); data = await api('GET', `${base}/schedule`); g.setData(data); }
        g.canUndo = undoStack.length > 0; g.updateToolbar();
        if (ok && !opt) toast(t('undone'), 'ok');
      },
      onToggleImpact: async () => {
        g.impactOn = !g.impactOn;
        await busy(null, () => api('PUT', base, { impact_check: g.impactOn }));
        g.updateToolbar();
        toast(g.impactOn ? t('impact_on_msg') : t('impact_off_hint'));
      },
      onSetBaseline: async () => {
        const ok = await confirmDlg({ title: t(data.has_baseline ? 'g_update_baseline' : 'g_set_baseline'), message: t('baseline_confirm'), ok: t('save') });
        if (!ok) return;
        data = await busy(null, () => api('POST', `${base}/schedule/baseline`));
        if (data) { g.setData(data); toast(t('baseline_saved'), 'ok'); }
      },
      onAddDep: (pred, succ, type = 'FS') => {
        const s = g.tasks.find((x) => x.id === succ);
        if (s.deps.some((d) => d.id === pred)) { toast(t('already_linked')); g.render(); return linkDialog(pred, succ); }
        commit({ [succ]: { deps: [...s.deps, { id: pred, lag: 0, type }] } }, { label: 'link' });
      },
      onEditDep: (pred, succ) => linkDialog(pred, succ),
      onValidate: () => validateDialog(),
      onProgress: (n, tk) => { const l = g.selTasks().filter((x) => !x.summary); if (!l.length) return; const c = {}; for (const x of l) if ((x.progress || 0) !== n) c[x.id] = { progress: n }; if (Object.keys(c).length) commit(c, { label: 'progress' }); },
      onMode: (mode, tk) => { const l = g.selTasks().filter((x) => !x.summary && (x.mode || 'auto') !== mode); if (l.length) commit(Object.fromEntries(l.map((x) => [x.id, { mode }])), { label: 'mode' }); },
      onMarkTrack: (tk) => {
        const l = g.selTasks().filter((x) => !x.summary); if (!l.length) return;
        const c = {}; for (const x of l) { const n = plannedPct(x); if (n !== (x.progress || 0)) c[x.id] = { progress: n }; }
        if (!Object.keys(c).length) return toast(l.length === 1 ? t('g_on_track_same', { n: plannedPct(l[0]) }) : t('g_on_track_same_many'), '');
        commit(c, { label: 'progress' });
      },
      onRelink: (tk) => {
        const l = g.selTasks().filter((x) => !x.summary && (x.deps || []).length); if (!l.length) return toast(t('g_relink_none'), '');
        commit(Object.fromEntries(l.map((x) => [x.id, { mode: 'auto', deps: x.deps.map((d) => ({ ...d })) }])), { label: 'mode' });
      },
      onFlag: (tk) => { const l = g.selTasks(); if (!l.length) return; const on = l.every((x) => x.flag) ? 0 : 1; commit(Object.fromEntries(l.map((x) => [x.id, { flag: on }])), { label: 'flag' }); },
      onLinkItems: (tk) => taskLinkDialog(tk || g.sel()),
      onLinkManager: () => linkManager(),
      onVersions: () => versionsDialog(),
      onSaveVersion: () => saveVersion(),
      onCsv: () => exportCsv(),
      onPrint: () => { g.setMax(true); setTimeout(() => { window.print(); g.setMax(false); }, 350); },
      onMsProject: () => msDialog(),
      onRemoveDep: async (pred, succ) => {
        const s = g.tasks.find((x) => x.id === succ);
        const a = g.tasks.find((x) => x.id === pred);
        if (!(await confirmDlg({ title: t('remove_link'), message: t('remove_link_q', { a: esc(a.name), b: esc(s.name) }), ok: t('remove'), danger: true }))) return;
        commit({ [succ]: { deps: s.deps.filter((d) => d.id !== pred) } }, { label: 'unlink' });
      },
    });
    // ----- Gantt and Board views share one data set -----
    const boardState = { q: '', owner: '', phase: '', late: false, limit: { todo: 40, prog: 40, done: 40 }, hl: null, focusId: null };
    const board = new window.PM.Board($('#bd', root), { state: boardState, tasks: () => g.tasks, today: () => data.today, commit, edit: editDialog, undo: () => g.o.onUndo(), canUndo: () => undoStack.length > 0 });
    let view = 'gantt', ganttDirty = false, inited = false;
    try { view = (q && q.view) || localStorage.getItem('pm_sched_view') || 'gantt'; } catch (e) { view = (q && q.view) || 'gantt'; }
    if (view !== 'board') view = 'gantt';
    const baseSet = g.setData.bind(g);
    // while the board is showing, the hidden Gantt only keeps its data in step and redraws when it is shown again
    g.setData = (d) => {
      if (view === 'board' && inited) {
        data = d; g.tasks = d.tasks; g.cal = { days: new Set(d.calendar.work_days), holidays: new Set(d.calendar.holidays) };
        g.today = d.today; g.hasBaseline = d.has_baseline; g.resources = d.resources || []; g.deliverables = d.deliverables || []; g.items = d.items || []; g.itemMap = new Map(g.items.map((i) => [i.id, i]));
        if (d.impact_check !== undefined) g.impactOn = d.impact_check;
        ganttDirty = true; board.render();
      } else baseSet(d);
      inited = true;
    };
    function setView(v) {
      view = v;
      $('#gt', root).hidden = v === 'board'; $('#bd', root).hidden = v !== 'board';
      $$('#svSeg button', root).forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      try { localStorage.setItem('pm_sched_view', v); } catch (e) { /* storage blocked */ }
      if (v === 'board') board.render();
      else if (ganttDirty) { ganttDirty = false; baseSet(data); } else g.render();
    }
    $('#svSeg', root).onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b && b.dataset.v !== view) setView(b.dataset.v); };
    g.setData(data);
    banner();
    setView(view);
  };
})();
