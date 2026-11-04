/* Logs tab: every deliverable, requirement, payment milestone and risk of a project in one table, with filters, paging and quick actions. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, modal, confirmDlg, busy } = PM;

  const KINDS = ['deliverable', 'requirement', 'milestone', 'risk'];
  const STATES = { deliverable: ['open', 'progress', 'closed'], requirement: ['open', 'progress', 'closed'], milestone: ['pending', 'invoiced', 'paid'], risk: ['open', 'mitigated', 'transferred', 'closed'] };
  const DONE = { deliverable: ['closed'], requirement: ['closed'], milestone: ['paid'], risk: ['closed', 'mitigated', 'transferred'] };
  const LEVELS = ['Low', 'Medium', 'High'];
  const SIZES = [20, 50, 100];
  const first = (kind) => STATES[kind][0];
  const stOf = (it) => it.state || first(it.kind);

  Object.assign(PM.I18N.en, {
    tab_logs: 'Logs', state_progress: 'In progress', state_transferred: 'Transferred',
    lg_title: 'Logs', lg_lead: 'Every deliverable, requirement, payment milestone and risk in one place. Update status, owner and dates right here.',
    lg_add: 'Add', lg_export: 'Export CSV', lg_search: 'Search by title or description', lg_type: 'Type', lg_status: 'Status', lg_any_status: 'Any status', lg_prob: 'Probability', lg_imp: 'Impact', lg_any: 'Any',
    lg_due: 'Due date', lg_due_any: 'Any date', lg_due_over: 'Overdue', lg_due_7: 'Next 7 days', lg_due_30: 'Next 30 days', lg_due_none: 'No date', lg_review: 'Review', lg_rs_live: 'Approved and needs review', lg_rs_confirmed: 'Approved only', lg_rs_proposed: 'Needs review only', lg_rs_ignored: 'Ignored only', lg_rs_all: 'Everything',
    lg_clear: 'Clear filters', lg_item: 'Item', lg_owner: 'Owner', lg_amount: 'Amount', lg_actions: 'Actions', lg_level: 'Level',
    lg_kind_deliverable: 'Deliverable', lg_kind_requirement: 'Requirement', lg_kind_milestone: 'Payment', lg_kind_risk: 'Risk',
    lg_s_deliverable_open: 'Not started', lg_s_deliverable_progress: 'In progress', lg_s_deliverable_closed: 'Completed',
    lg_s_requirement_open: 'Not started', lg_s_requirement_progress: 'In progress', lg_s_requirement_closed: 'Completed',
    lg_s_milestone_pending: 'Not invoiced', lg_s_milestone_invoiced: 'Invoiced', lg_s_milestone_paid: 'Paid',
    lg_s_risk_open: 'Open', lg_s_risk_mitigated: 'Mitigated', lg_s_risk_transferred: 'Transferred', lg_s_risk_closed: 'Closed',
    lg_a_start: 'Start', lg_a_complete: 'Complete', lg_a_reopen: 'Reopen', lg_a_invoice: 'Invoice', lg_a_paid: 'Mark paid', lg_a_mitigate: 'Mitigate', lg_a_transfer: 'Transfer', lg_a_close: 'Close',
    lg_showing: 'Showing {a} to {b} of {n}', lg_none: 'Nothing matches these filters.', lg_empty: 'No items yet. Add the first one.', lg_per_page: 'Per page', lg_first: 'First page', lg_prev: 'Previous page', lg_next: 'Next page', lg_last: 'Last page', lg_page: 'Page {n}',
    lg_updated: 'Updated', lg_added: 'Item added', lg_deleted: 'Item deleted', lg_overdue: 'Overdue', lg_review_chip: 'Needs review', lg_ignored_chip: 'Ignored',
    lg_new: 'New item', lg_edit: 'Edit item', lg_details_deliverable: 'Deliverable details', lg_details_requirement: 'Requirement details', lg_details_milestone: 'Payment details', lg_details_risk: 'Risk details',
    lg_f_title: 'Title', lg_f_desc: 'Description', lg_f_review_date: 'Review date', lg_f_mit: 'Mitigation or response', lg_f_pct: 'Share of contract %', lg_f_amt: 'Amount', lg_delete_q: 'Delete this item? This cannot be undone.', lg_source: 'Where the AI found it', lg_conf: 'AI confidence', lg_open_project: 'Open review page', lg_notfound: 'This item no longer exists.',
  });
  Object.assign(PM.I18N.ar, {
    tab_logs: 'السجلات', state_progress: 'قيد التنفيذ', state_transferred: 'تم النقل',
    lg_title: 'السجلات', lg_lead: 'كل المخرجات والمتطلبات ودفعات الدفع والمخاطر في مكان واحد. حدث الحالة والمسؤول والتواريخ من هنا مباشرة.',
    lg_add: 'إضافة', lg_export: 'تصدير CSV', lg_search: 'ابحث بالعنوان أو الوصف', lg_type: 'النوع', lg_status: 'الحالة', lg_any_status: 'أي حالة', lg_prob: 'الاحتمال', lg_imp: 'الأثر', lg_any: 'الكل',
    lg_due: 'تاريخ الاستحقاق', lg_due_any: 'أي تاريخ', lg_due_over: 'متأخر', lg_due_7: 'خلال 7 أيام', lg_due_30: 'خلال 30 يوما', lg_due_none: 'بدون تاريخ', lg_review: 'المراجعة', lg_rs_live: 'المعتمد وما يحتاج مراجعة', lg_rs_confirmed: 'المعتمد فقط', lg_rs_proposed: 'ما يحتاج مراجعة فقط', lg_rs_ignored: 'المتجاهل فقط', lg_rs_all: 'كل شيء',
    lg_clear: 'مسح التصفية', lg_item: 'العنصر', lg_owner: 'المسؤول', lg_amount: 'المبلغ', lg_actions: 'الإجراءات', lg_level: 'المستوى',
    lg_kind_deliverable: 'مخرج', lg_kind_requirement: 'متطلب', lg_kind_milestone: 'دفعة', lg_kind_risk: 'خطر',
    lg_s_deliverable_open: 'لم يبدأ', lg_s_deliverable_progress: 'قيد التنفيذ', lg_s_deliverable_closed: 'مكتمل',
    lg_s_requirement_open: 'لم يبدأ', lg_s_requirement_progress: 'قيد التنفيذ', lg_s_requirement_closed: 'مكتمل',
    lg_s_milestone_pending: 'لم تصدر فاتورة', lg_s_milestone_invoiced: 'صدرت الفاتورة', lg_s_milestone_paid: 'مدفوعة',
    lg_s_risk_open: 'مفتوح', lg_s_risk_mitigated: 'تمت المعالجة', lg_s_risk_transferred: 'تم النقل', lg_s_risk_closed: 'مغلق',
    lg_a_start: 'ابدأ', lg_a_complete: 'أكمل', lg_a_reopen: 'أعد الفتح', lg_a_invoice: 'فوتر', lg_a_paid: 'تم الدفع', lg_a_mitigate: 'عالج', lg_a_transfer: 'انقل', lg_a_close: 'أغلق',
    lg_showing: 'عرض {a} إلى {b} من {n}', lg_none: 'لا توجد نتائج تطابق هذه التصفية.', lg_empty: 'لا توجد عناصر بعد. أضف أول عنصر.', lg_per_page: 'في الصفحة', lg_first: 'الصفحة الأولى', lg_prev: 'الصفحة السابقة', lg_next: 'الصفحة التالية', lg_last: 'الصفحة الأخيرة', lg_page: 'الصفحة {n}',
    lg_updated: 'تم التحديث', lg_added: 'تمت إضافة العنصر', lg_deleted: 'تم حذف العنصر', lg_overdue: 'متأخر', lg_review_chip: 'يحتاج مراجعة', lg_ignored_chip: 'متجاهل',
    lg_new: 'عنصر جديد', lg_edit: 'تعديل العنصر', lg_details_deliverable: 'تفاصيل المخرج', lg_details_requirement: 'تفاصيل المتطلب', lg_details_milestone: 'تفاصيل الدفعة', lg_details_risk: 'تفاصيل الخطر',
    lg_f_title: 'العنوان', lg_f_desc: 'الوصف', lg_f_review_date: 'تاريخ المراجعة', lg_f_mit: 'المعالجة أو الاستجابة', lg_f_pct: 'نسبة من العقد %', lg_f_amt: 'المبلغ', lg_delete_q: 'حذف هذا العنصر؟ لا يمكن التراجع.', lg_source: 'أين وجده الذكاء الاصطناعي', lg_conf: 'ثقة الذكاء الاصطناعي', lg_open_project: 'فتح صفحة المراجعة', lg_notfound: 'هذا العنصر لم يعد موجودا.',
  });

  const label = (kind, s) => t(`lg_s_${kind}_${s}`);
  PM.logLabel = label;
  const lvl = (v) => (v ? t('lv_' + v) : '');
  const amountOf = (it, p) => { const d = it.data || {}; if (d.amount != null && d.amount !== '') return Number(d.amount); if (d.percent != null && d.percent !== '' && p.value) return (p.value * Number(d.percent)) / 100; return null; };
  const dueOf = (it) => { const d = it.data || {}; return d.due_date || (it.kind === 'risk' ? d.review_date : null) || null; };
  const isDone = (it) => DONE[it.kind].includes(stOf(it));
  const today = () => PM.today();
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const stClass = (it) => (isDone(it) ? 'ok' : ['progress', 'invoiced'].includes(stOf(it)) ? 'prog' : '');

  // quick actions per type and state, each one click
  function quick(it) {
    const s = stOf(it), A = (act, to, cls = '') => ({ act, to, cls });
    if (it.kind === 'risk') return s === 'open' ? [A('mitigate', 'mitigated', 'good'), A('transfer', 'transferred'), A('close', 'closed')] : [A('reopen', 'open')];
    if (it.kind === 'milestone') return s === 'pending' ? [A('invoice', 'invoiced'), A('paid', 'paid', 'good')] : s === 'invoiced' ? [A('paid', 'paid', 'good')] : [A('reopen', 'pending')];
    return s === 'open' ? [A('start', 'progress'), A('complete', 'closed', 'good')] : s === 'progress' ? [A('complete', 'closed', 'good')] : [A('reopen', 'open')];
  }
  const ACT_ICON = { start: 'play', complete: 'check', mitigate: 'check', transfer: 'link', close: 'x', invoice: 'dl', paid: 'check', reopen: 'undo' };

  // ---------------- add and edit dialog ----------------
  function itemDialog(it, p, done) {
    const isNew = !it || !it.id;
    const cur = it || { kind: 'deliverable', title: '', description: '', data: {} };
    let kind = cur.kind;
    const sel = (id, opts, val, tr) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const f = (id, lab, val, type = 'text', extra = '') => `<label class="f ${extra}">${lab}<input type="${type}" id="${id}" value="${esc(val ?? '')}"></label>`;
    const d = cur.data || {};
    const dyn = () => {
      const stOpts = STATES[kind].map((s) => [s, label(kind, s)]);
      const curState = STATES[kind].includes(cur.state) && kind === cur.kind ? cur.state : first(kind);
      let h = `<label class="f">${t('lg_status')}${sel('lgState', stOpts, curState)}</label>${f('lgOwner', t('lg_owner'), d.owner)}`;
      if (kind === 'risk') h += `<label class="f">${t('lg_prob')}${sel('lgProb', LEVELS.map((v) => [v, t('lv_' + v)]), d.probability || 'Medium')}</label><label class="f">${t('lg_imp')}${sel('lgImp', LEVELS.map((v) => [v, t('lv_' + v)]), d.impact || 'Medium')}</label>${f('lgDue', t('lg_f_review_date'), d.due_date, 'date')}<label class="f full">${t('lg_f_mit')}<textarea id="lgMit">${esc(d.mitigation || '')}</textarea></label>`;
      else if (kind === 'milestone') h += `${f('lgDue', t('lg_due'), d.due_date, 'date')}${f('lgPct', t('lg_f_pct'), d.percent, 'number')}${f('lgAmt', t('lg_f_amt'), d.amount, 'number')}`;
      else h += f('lgDue', t('lg_due'), d.due_date, 'date');
      return h;
    };
    const src = cur.quote ? `<div class="lg-src small muted"><b>${t('lg_source')}</b><br>${esc(cur.quote)}${cur.doc_name ? ` <span>(${esc(cur.doc_name)})</span>` : ''}</div>` : '';
    const body = `<div class="form-grid">
      <label class="f">${t('lg_type')}<select id="lgKind" ${isNew ? '' : 'disabled'}>${KINDS.map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${t('lg_kind_' + k)}</option>`).join('')}</select></label><span></span>
      ${f('lgTitle', t('lg_f_title'), cur.title, 'text', 'full')}<label class="f full">${t('lg_f_desc')}<textarea id="lgDesc">${esc(cur.description || '')}</textarea></label>
      <div class="lg-dyn full" id="lgDyn">${dyn()}</div></div>${src}${cur.confidence != null ? `<div class="small muted">${t('lg_conf')} ${Math.round(cur.confidence * 100)}%</div>` : ''}`;
    const m = modal({ title: isNew ? t('lg_new') : t('lg_details_' + cur.kind), size: 'lg', body, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="lgSave">${t('save')}</button>` });
    m.$('#lgKind').onchange = (e) => { kind = e.target.value; m.$('#lgDyn').innerHTML = dyn(); };
    m.$('#lgTitle').focus();
    m.$('#lgSave').onclick = async () => {
      const v = (id) => { const el = m.$('#' + id); return el ? el.value : undefined; };
      const title = String(v('lgTitle') || '').trim();
      if (!title) { toast(t('title_required'), 'err'); return; }
      const data = { owner: v('lgOwner') || null, due_date: v('lgDue') || null };
      if (kind === 'risk') Object.assign(data, { probability: v('lgProb'), impact: v('lgImp'), mitigation: v('lgMit') || '' });
      if (kind === 'milestone') Object.assign(data, { percent: v('lgPct') === '' ? null : Number(v('lgPct')), amount: v('lgAmt') === '' ? null : Number(v('lgAmt')) });
      const payload = { title, description: v('lgDesc') || '', state: v('lgState'), data };
      const r = await busy(m.$('#lgSave'), () => (isNew ? api('POST', `/api/projects/${p.id}/items`, { kind, ...payload }) : api('PUT', `/api/items/${cur.id}`, payload)));
      if (r) { m.close(); toast(isNew ? t('lg_added') : t('saved'), 'ok'); if (done) done(r.item, isNew); }
    };
  }
  PM.itemDialog = itemDialog;
  // used by the risk radar and other lists: open one item by id
  PM.openItem = async function (itemId, projectId, done) {
    let p, it;
    try { p = (await api('GET', `/api/projects/${projectId}`)).project; it = ((await api('GET', `/api/projects/${projectId}/items`)).items || []).find((x) => x.id === Number(itemId)); } catch (e) { return toast(e.message, 'err'); }
    if (!it || !KINDS.includes(it.kind)) return toast(t('lg_notfound'), 'err');
    itemDialog(it, p, () => done && done());
  };

  // ---------------- the tab ----------------
  const KEY = (id) => 'pm_logs_' + id;
  const defaults = () => ({ q: '', kinds: [], st: '', prob: '', imp: '', due: '', rs: 'live', sort: 'type', dir: 1, page: 1, size: 20 });
  const loadF = (id) => { try { return { ...defaults(), ...(JSON.parse(sessionStorage.getItem(KEY(id))) || {}) }; } catch { return defaults(); } };
  const saveF = (id, F) => { try { sessionStorage.setItem(KEY(id), JSON.stringify(F)); } catch { /* optional */ } };

  PM.views.tab_logs = async function (root, p, q, token) {
    let items = (await api('GET', `/api/projects/${p.id}/items`)).items.filter((i) => KINDS.includes(i.kind));
    if (PM.stale(token)) return;
    const F = loadF(p.id);
    if (!SIZES.includes(F.size)) F.size = 20;
    const reload = async () => { items = (await api('GET', `/api/projects/${p.id}/items`)).items.filter((i) => KINDS.includes(i.kind)); drawTable(); counts(); };

    const stOptions = () => {
      const kinds = F.kinds.length ? F.kinds : KINDS;
      return `<option value="">${t('lg_any_status')}</option>${kinds.map((k) => `<optgroup label="${esc(t('lg_kind_' + k))}">${STATES[k].map((s) => `<option value="${k}|${s}" ${F.st === k + '|' + s ? 'selected' : ''}>${esc(label(k, s))}</option>`).join('')}</optgroup>`).join('')}`;
    };
    root.innerHTML = `<div class="page wide lg-page">
      <div class="lg-head"><div class="grow"><h2>${t('lg_title')}</h2><div class="muted">${t('lg_lead')}</div></div>
        <button class="btn" id="lgExport">${icon('dl')}${t('lg_export')}</button><button class="btn primary" id="lgAdd">${icon('plus')}${t('lg_add')}</button></div>
      <div class="card lg-filters">
        <div class="lg-row"><label class="lg-search">${icon('search')}<input type="search" id="lgQ" placeholder="${esc(t('lg_search'))}" value="${esc(F.q)}" aria-label="${esc(t('lg_search'))}"></label>
          <div class="lg-kinds" role="group" aria-label="${esc(t('lg_type'))}">${KINDS.map((k) => `<button type="button" class="rd-chip ${F.kinds.includes(k) ? 'on' : ''}" data-kind="${k}" aria-pressed="${F.kinds.includes(k)}">${t('lg_kind_' + k)} <span data-count="${k}"></span></button>`).join('')}</div></div>
        <div class="lg-row lg-sels">
          <label class="f">${t('lg_status')}<select id="lgSt">${stOptions()}</select></label>
          <label class="f">${t('lg_prob')}<select id="lgProbF"><option value="">${t('lg_any')}</option>${LEVELS.map((v) => `<option value="${v}" ${F.prob === v ? 'selected' : ''}>${t('lv_' + v)}</option>`).join('')}</select></label>
          <label class="f">${t('lg_imp')}<select id="lgImpF"><option value="">${t('lg_any')}</option>${LEVELS.map((v) => `<option value="${v}" ${F.imp === v ? 'selected' : ''}>${t('lv_' + v)}</option>`).join('')}</select></label>
          <label class="f">${t('lg_due')}<select id="lgDueF">${[['', 'lg_due_any'], ['over', 'lg_due_over'], ['7', 'lg_due_7'], ['30', 'lg_due_30'], ['none', 'lg_due_none']].map(([v, k]) => `<option value="${v}" ${F.due === v ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></label>
          <label class="f">${t('lg_review')}<select id="lgRs">${['live', 'confirmed', 'proposed', 'ignored', 'all'].map((v) => `<option value="${v}" ${F.rs === v ? 'selected' : ''}>${t('lg_rs_' + v)}</option>`).join('')}</select></label>
          <button class="btn ghost" id="lgClear">${t('lg_clear')}</button></div></div>
      <div class="card lg-card"><div id="lgTable"></div><div id="lgPager" class="lg-pager"></div></div></div>`;

    const rsOk = (i) => (F.rs === 'all' ? true : F.rs === 'live' ? i.status !== 'ignored' : i.status === F.rs);
    function filtered() {
      const qq = F.q.trim().toLowerCase(), t7 = addDays(7), t30 = addDays(30), td = today();
      let rows = items.filter((i) => {
        if (!rsOk(i)) return false;
        if (F.kinds.length && !F.kinds.includes(i.kind)) return false;
        if (F.st) { const [k, s] = F.st.split('|'); if (i.kind !== k || stOf(i) !== s) return false; }
        if (F.prob && (i.kind !== 'risk' || (i.data || {}).probability !== F.prob)) return false;
        if (F.imp && (i.kind !== 'risk' || (i.data || {}).impact !== F.imp)) return false;
        const due = dueOf(i);
        if (F.due === 'over' && !(due && due < td && !isDone(i))) return false;
        if (F.due === '7' && !(due && due >= td && due <= t7)) return false;
        if (F.due === '30' && !(due && due >= td && due <= t30)) return false;
        if (F.due === 'none' && due) return false;
        if (qq && !(`${i.title} ${i.description || ''} ${(i.data || {}).owner || ''}`.toLowerCase().includes(qq))) return false;
        return true;
      });
      const key = { type: (i) => KINDS.indexOf(i.kind), item: (i) => i.title.toLowerCase(), status: (i) => STATES[i.kind].indexOf(stOf(i)), due: (i) => dueOf(i) || '9999', amount: (i) => amountOf(i, p) ?? -1, owner: (i) => String((i.data || {}).owner || '').toLowerCase(), prob: (i) => LEVELS.indexOf((i.data || {}).probability), imp: (i) => LEVELS.indexOf((i.data || {}).impact) }[F.sort] || ((i) => i.id);
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * F.dir || a.id - b.id; });
      return rows;
    }
    function counts() {
      const base = items.filter(rsOk);
      KINDS.forEach((k) => { const el = $(`[data-count="${k}"]`, root); if (el) el.textContent = base.filter((i) => i.kind === k).length; });
    }

    const th = (key, lab, cls = '') => `<th class="${cls}"><button class="lg-sort ${F.sort === key ? 'on' : ''}" data-sort="${key}" aria-label="${esc(lab)}">${lab}<span aria-hidden="true">${F.sort === key ? (F.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
    function row(i) {
      const d = i.data || {}, s = stOf(i), due = dueOf(i), amt = i.kind === 'milestone' ? amountOf(i, p) : null;
      const late = due && due < today() && !isDone(i);
      const opts = STATES[i.kind].map((x) => `<option value="${x}" ${x === s ? 'selected' : ''}>${esc(label(i.kind, x))}</option>`).join('');
      const lvSel = (field, val) => `<select class="lg-sel" data-f="${field}" data-id="${i.id}" aria-label="${esc(t(field === 'probability' ? 'lg_prob' : 'lg_imp'))}">${LEVELS.map((v) => `<option value="${v}" ${v === (val || 'Medium') ? 'selected' : ''}>${t('lv_' + v)}</option>`).join('')}</select>`;
      const acts = quick(i).map((a) => `<button class="btn sm ${a.cls}" data-qa="${a.to}" data-id="${i.id}">${t('lg_a_' + a.act)}</button>`).join('');
      return `<tr class="${i.status === 'ignored' ? 'lg-ign' : ''}" data-row="${i.id}">
        <td><span class="chip">${t('lg_kind_' + i.kind)}</span></td>
        <td class="lg-item"><div class="lg-title" data-edit="${i.id}" tabindex="0" role="button">${esc(i.title)}</div>${i.description && i.description !== i.title ? `<div class="small muted lg-desc">${esc(i.description.slice(0, 140))}</div>` : ''}${i.status === 'proposed' ? `<span class="chip amber">${t('lg_review_chip')}</span>` : i.status === 'ignored' ? `<span class="chip">${t('lg_ignored_chip')}</span>` : ''}</td>
        <td><select class="lg-sel st ${stClass(i)}" data-f="state" data-id="${i.id}" aria-label="${esc(t('lg_status'))}">${opts}</select></td>
        <td>${i.kind === 'risk' ? lvSel('probability', d.probability) : '<span class="muted">-</span>'}</td>
        <td>${i.kind === 'risk' ? lvSel('impact', d.impact) : '<span class="muted">-</span>'}</td>
        <td class="nowrap">${d.owner ? esc(d.owner) : '<span class="muted">-</span>'}</td>
        <td class="nowrap ${late ? 'neg' : ''}">${due ? esc(due) : '<span class="muted">-</span>'}${late ? ` <span class="chip red">${t('lg_overdue')}</span>` : ''}</td>
        <td class="nowrap right">${amt != null ? money(amt, p.currency) : '<span class="muted">-</span>'}</td>
        <td class="lg-acts"><div class="row">${acts}<button class="btn sm ghost icon" data-edit="${i.id}" aria-label="${esc(t('edit'))}" data-tip="${esc(t('edit'))}">${icon('edit')}</button><button class="btn sm ghost icon" data-del="${i.id}" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('trash')}</button></div></td></tr>`;
    }
    function drawTable() {
      const rows = filtered(), n = rows.length, pages = Math.max(1, Math.ceil(n / F.size));
      F.page = Math.min(Math.max(1, F.page), pages);
      const from = (F.page - 1) * F.size, slice = rows.slice(from, from + F.size);
      saveF(p.id, F);
      $('#lgTable', root).innerHTML = n
        ? `<div class="table-wrap"><table class="t lg-t"><thead><tr>${th('type', t('lg_type'))}${th('item', t('lg_item'))}${th('status', t('lg_status'))}${th('prob', t('lg_prob'))}${th('imp', t('lg_imp'))}${th('owner', t('lg_owner'))}${th('due', t('lg_due'))}${th('amount', t('lg_amount'), 'right')}<th>${t('lg_actions')}</th></tr></thead><tbody>${slice.map(row).join('')}</tbody></table></div>`
        : `<div class="empty">${items.length ? t('lg_none') : t('lg_empty')}</div>`;
      const win = []; for (let k = Math.max(1, F.page - 2); k <= Math.min(pages, F.page + 2); k++) win.push(k);
      const nb = (cls, ic, lab, go, off) => `<button class="btn sm ghost icon ${cls}" data-pg="${go}" ${off ? 'disabled' : ''} aria-label="${esc(lab)}" data-tip="${esc(lab)}">${icon(ic)}${cls === 'dbl' ? icon(ic) : ''}</button>`;
      $('#lgPager', root).innerHTML = n ? `<div class="small muted">${t('lg_showing', { a: from + 1, b: Math.min(n, from + F.size), n })}</div><div class="grow"></div>
        <label class="small muted lg-pp">${t('lg_per_page')} <select id="lgSize" class="lg-sel">${SIZES.map((s) => `<option value="${s}" ${s === F.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <div class="lg-pages" role="navigation">${nb('dbl flip', 'chev_l', t('lg_first'), 1, F.page === 1)}${nb('flip', 'chev_l', t('lg_prev'), F.page - 1, F.page === 1)}${win.map((k) => `<button class="btn sm ${k === F.page ? 'primary' : 'ghost'}" data-pg="${k}" aria-label="${esc(t('lg_page', { n: k }))}" ${k === F.page ? 'aria-current="page"' : ''}>${k}</button>`).join('')}${nb('', 'chev_r', t('lg_next'), F.page + 1, F.page === pages)}${nb('dbl', 'chev_r', t('lg_last'), pages, F.page === pages)}</div>` : '';
      if (PM.bindTips) PM.bindTips(root);
    }

    // change one item with an Undo toast
    async function change(id, patch) {
      const it = items.find((x) => x.id === Number(id)); if (!it) return;
      const before = { state: it.state, data: {} };
      for (const k of Object.keys(patch.data || {})) before.data[k] = (it.data || {})[k] ?? null;
      let r;
      try { r = await api('PUT', `/api/items/${id}`, patch); } catch (e) { toast(e.message, 'err'); return drawTable(); }
      Object.assign(it, r.item);
      toast(t('lg_updated'), 'ok', { label: t('g_undo'), fn: async () => { try { const b = await api('PUT', `/api/items/${id}`, before.state ? { state: before.state, data: before.data } : { data: before.data }); Object.assign(it, b.item); } catch (e) { toast(e.message, 'err'); } drawTable(); } });
      drawTable();
    }

    // ---- events ----
    let qt = null;
    $('#lgQ', root).oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { F.q = e.target.value; F.page = 1; drawTable(); }, 160); };
    $('#lgSt', root).onchange = (e) => { F.st = e.target.value; F.page = 1; drawTable(); };
    $('#lgProbF', root).onchange = (e) => { F.prob = e.target.value; F.page = 1; drawTable(); };
    $('#lgImpF', root).onchange = (e) => { F.imp = e.target.value; F.page = 1; drawTable(); };
    $('#lgDueF', root).onchange = (e) => { F.due = e.target.value; F.page = 1; drawTable(); };
    $('#lgRs', root).onchange = (e) => { F.rs = e.target.value; F.page = 1; counts(); drawTable(); };
    $$('[data-kind]', root).forEach((b) => (b.onclick = () => {
      const k = b.dataset.kind; F.kinds = F.kinds.includes(k) ? F.kinds.filter((x) => x !== k) : [...F.kinds, k];
      if (F.st && F.kinds.length && !F.kinds.includes(F.st.split('|')[0])) F.st = '';
      $$('[data-kind]', root).forEach((x) => { const on = F.kinds.includes(x.dataset.kind); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      $('#lgSt', root).innerHTML = stOptions(); F.page = 1; drawTable();
    }));
    $('#lgClear', root).onclick = () => { Object.assign(F, { ...defaults(), size: F.size }); $('#lgQ', root).value = ''; $('#lgProbF', root).value = ''; $('#lgImpF', root).value = ''; $('#lgDueF', root).value = ''; $('#lgRs', root).value = 'live'; $$('[data-kind]', root).forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); $('#lgSt', root).innerHTML = stOptions(); counts(); drawTable(); };
    $('#lgAdd', root).onclick = () => itemDialog(null, p, () => reload());
    $('#lgExport', root).onclick = () => {
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [[t('lg_type'), t('lg_item'), t('lg_status'), t('lg_prob'), t('lg_imp'), t('lg_owner'), t('lg_due'), t('lg_amount')].map(cell).join(',')];
      for (const i of filtered()) { const d = i.data || {}; lines.push([t('lg_kind_' + i.kind), i.title, label(i.kind, stOf(i)), i.kind === 'risk' ? d.probability : '', i.kind === 'risk' ? d.impact : '', d.owner, dueOf(i), i.kind === 'milestone' ? amountOf(i, p) : ''].map(cell).join(',')); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `${p.name}-logs.csv`.replace(/[\\/:*?"<>|]+/g, ' '); document.body.appendChild(a); a.click(); a.remove();
    };
    root.addEventListener('change', (e) => {
      const s = e.target.closest('select[data-f]');
      if (s) { const f = s.dataset.f; return change(s.dataset.id, f === 'state' ? { state: s.value } : { data: { [f]: s.value } }); }
      if (e.target.id === 'lgSize') { F.size = Number(e.target.value); F.page = 1; drawTable(); }
    });
    root.addEventListener('click', async (e) => {
      const go = e.target.closest('[data-pg]'); if (go && !go.disabled) { F.page = Number(go.dataset.pg); drawTable(); return; }
      const so = e.target.closest('[data-sort]'); if (so) { const k = so.dataset.sort; if (F.sort === k) F.dir = -F.dir; else { F.sort = k; F.dir = 1; } F.page = 1; drawTable(); return; }
      const qa = e.target.closest('[data-qa]'); if (qa) return change(qa.dataset.id, { state: qa.dataset.qa });
      const ed = e.target.closest('[data-edit]'); if (ed) { const it = items.find((x) => x.id === Number(ed.dataset.edit)); if (it) itemDialog(it, p, () => reload()); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!(await confirmDlg({ title: t('delete'), message: t('lg_delete_q'), ok: t('delete'), danger: true }))) return;
        try { await api('DELETE', `/api/items/${del.dataset.del}`); toast(t('lg_deleted'), 'ok'); reload(); } catch (er) { toast(er.message, 'err'); }
      }
    });
    root.addEventListener('keydown', (e) => { const ed = e.target.closest && e.target.closest('.lg-title'); if (ed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ed.click(); } });
    counts(); drawTable();
  };
})();
