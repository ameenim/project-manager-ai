/* Logs tab: every deliverable, requirement, payment milestone and risk of a project in one table, with filters, paging and quick actions. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, modal, confirmDlg, busy } = PM;

  const KINDS = ['deliverable', 'requirement', 'milestone', 'risk', 'action', 'decision'];
  const STATES = { deliverable: ['open', 'progress', 'closed'], requirement: ['open', 'progress', 'closed'], milestone: ['pending', 'invoiced', 'paid'], risk: ['open', 'mitigated', 'transferred', 'closed'], action: ['open', 'progress', 'closed'], decision: ['active', 'superseded'] };
  const DONE = { deliverable: ['closed'], requirement: ['closed'], milestone: ['paid'], risk: ['closed', 'mitigated', 'transferred'], action: ['closed'], decision: ['active', 'superseded'] };
  const LEVELS = ['Low', 'Medium', 'High'];
  const SIZES = [20, 50, 100];
  const first = (kind) => STATES[kind][0];
  const stOf = (it) => it.state || first(it.kind);

  Object.assign(PM.I18N.en, {
    tab_logs: 'Logs', state_progress: 'In progress', state_transferred: 'Transferred', state_active: 'Active', state_superseded: 'Superseded',
    lg_kind_action: 'Action', lg_kind_decision: 'Decision', lg_details_action: 'Action details', lg_details_decision: 'Decision details', lg_s_action_open: 'Not started', lg_s_action_progress: 'In progress', lg_s_action_closed: 'Done', lg_s_decision_active: 'Active', lg_s_decision_superseded: 'Superseded', lg_a_supersede: 'Supersede',
    lg_c_source: 'Source', lg_src_manual: 'Manual', lg_src_document: 'Document', lg_src_meeting: 'Meeting',
    lg_title: 'Logs', lg_lead: 'Every deliverable, requirement, payment milestone and risk in one place. Update status, owner and dates right here.',
    lg_add: 'Add', lg_export: 'Export CSV', lg_search: 'Search by title or description', lg_type: 'Type', lg_status: 'Status', lg_any_status: 'Any status', lg_prob: 'Probability', lg_imp: 'Impact', lg_any: 'Any',
    lg_due: 'Due date', lg_due_any: 'Any date', lg_due_over: 'Overdue', lg_due_7: 'Next 7 days', lg_due_30: 'Next 30 days', lg_due_none: 'No date', lg_review: 'Review', lg_rs_live: 'Approved and needs review', lg_rs_confirmed: 'Approved only', lg_rs_proposed: 'Needs review only', lg_rs_ignored: 'Ignored only', lg_rs_all: 'Everything',
    lg_clear: 'Clear filters', lg_item: 'Item', lg_owner: 'Owner', lg_amount: 'Invoice amount', lg_actions: 'Actions', lg_level: 'Level',
    lg_kind_deliverable: 'Deliverable', lg_kind_requirement: 'Requirement', lg_kind_milestone: 'Payment', lg_kind_risk: 'Risk',
    lg_s_deliverable_open: 'Not started', lg_s_deliverable_progress: 'In progress', lg_s_deliverable_closed: 'Completed',
    lg_s_requirement_open: 'Not started', lg_s_requirement_progress: 'In progress', lg_s_requirement_closed: 'Completed',
    lg_s_milestone_pending: 'Not invoiced', lg_s_milestone_invoiced: 'Invoiced', lg_s_milestone_paid: 'Paid',
    lg_s_risk_open: 'Open', lg_s_risk_mitigated: 'Mitigated', lg_s_risk_transferred: 'Transferred', lg_s_risk_closed: 'Closed',
    lg_a_start: 'Start', lg_a_complete: 'Complete', lg_a_reopen: 'Reopen', lg_a_invoice: 'Invoice', lg_a_paid: 'Mark paid', lg_a_mitigate: 'Mitigate', lg_a_transfer: 'Transfer', lg_a_close: 'Close',
    lg_showing: 'Showing {a} to {b} of {n}', lg_none: 'Nothing matches these filters.', lg_empty: 'No items yet. Add the first one.', lg_per_page: 'Per page', lg_first: 'First page', lg_prev: 'Previous page', lg_next: 'Next page', lg_last: 'Last page', lg_page: 'Page {n}',
    lg_updated: 'Updated', lg_added: 'Item added', lg_deleted: 'Item deleted', lg_overdue: 'Overdue', lg_review_chip: 'Needs review', lg_ignored_chip: 'Ignored',
    lg_new: 'New item', lg_edit: 'Edit item', lg_details_deliverable: 'Deliverable details', lg_details_requirement: 'Requirement details', lg_details_milestone: 'Payment details', lg_details_risk: 'Risk details',
    lg_f_title: 'Title', lg_f_desc: 'Description', lg_f_review_date: 'Review date', lg_f_mit: 'Mitigation or response', lg_f_pct: 'Share of contract %', lg_f_amt: 'Invoice amount', lg_delete_q: 'Delete this item? This cannot be undone.', lg_source: 'Where the AI found it', lg_conf: 'AI confidence', lg_open_project: 'Open review page', lg_notfound: 'This item no longer exists.',
    lg_columns: 'Columns', lg_columns_hint: 'Choose the columns to show. Every field of an item is here.', lg_cols_reset: 'Reset columns', lg_col_required: 'Always shown',
    lg_c_review: 'Review status', lg_rv_confirmed: 'Approved', lg_rv_proposed: 'Needs review', lg_rv_ignored: 'Ignored', lg_c_linked: 'Linked deliverable', lg_c_doc: 'Source document', lg_c_quote: 'Source quote', lg_c_created: 'Created', lg_c_conf: 'AI confidence',
    lg_for_risk: 'Risks', lg_for_milestone: 'Payments',
    lg_views: 'Saved views', lg_view_all: 'All items', lg_view_save: 'Save as view', lg_view_update: 'Update view', lg_view_rename: 'Rename view', lg_view_delete: 'Delete view', lg_view_changed: 'Changed since saved',
    lg_view_name: 'View name', lg_view_name_ph: 'For example Risk log', lg_view_save_title: 'Save this view', lg_view_save_hint: 'Saves the columns, filters, search and sort you have now. Open it again with one click from the tabs above the table.', lg_view_name_req: 'Give the view a name.', lg_view_exists: 'A view with this name already exists. Saving will replace it.', lg_view_saved: 'View saved', lg_view_updated: 'View updated', lg_view_deleted: 'View deleted', lg_view_delete_q: 'Delete the view "{n}"? Your items are not affected.', lg_view_fail: 'The view could not be saved. Try again.', lg_view_restart: 'Saved views are not available on the server yet. Restart the app so the latest update loads, then try again.',
  });
  Object.assign(PM.I18N.ar, {
    tab_logs: 'السجلات', state_progress: 'قيد التنفيذ', state_transferred: 'تم النقل', state_active: 'ساري', state_superseded: 'تم استبداله',
    lg_kind_action: 'إجراء', lg_kind_decision: 'قرار', lg_details_action: 'تفاصيل الإجراء', lg_details_decision: 'تفاصيل القرار', lg_s_action_open: 'لم يبدأ', lg_s_action_progress: 'قيد التنفيذ', lg_s_action_closed: 'تم', lg_s_decision_active: 'ساري', lg_s_decision_superseded: 'تم استبداله', lg_a_supersede: 'استبدل',
    lg_c_source: 'المصدر', lg_src_manual: 'يدوي', lg_src_document: 'مستند', lg_src_meeting: 'اجتماع',
    lg_title: 'السجلات', lg_lead: 'كل المخرجات والمتطلبات ودفعات الدفع والمخاطر في مكان واحد. حدث الحالة والمسؤول والتواريخ من هنا مباشرة.',
    lg_add: 'إضافة', lg_export: 'تصدير CSV', lg_search: 'ابحث بالعنوان أو الوصف', lg_type: 'النوع', lg_status: 'الحالة', lg_any_status: 'أي حالة', lg_prob: 'الاحتمال', lg_imp: 'الأثر', lg_any: 'الكل',
    lg_due: 'تاريخ الاستحقاق', lg_due_any: 'أي تاريخ', lg_due_over: 'متأخر', lg_due_7: 'خلال 7 أيام', lg_due_30: 'خلال 30 يوما', lg_due_none: 'بدون تاريخ', lg_review: 'المراجعة', lg_rs_live: 'المعتمد وما يحتاج مراجعة', lg_rs_confirmed: 'المعتمد فقط', lg_rs_proposed: 'ما يحتاج مراجعة فقط', lg_rs_ignored: 'المتجاهل فقط', lg_rs_all: 'كل شيء',
    lg_clear: 'مسح التصفية', lg_item: 'العنصر', lg_owner: 'المسؤول', lg_amount: 'مبلغ الفاتورة', lg_actions: 'الإجراءات', lg_level: 'المستوى',
    lg_kind_deliverable: 'مخرج', lg_kind_requirement: 'متطلب', lg_kind_milestone: 'دفعة', lg_kind_risk: 'خطر',
    lg_s_deliverable_open: 'لم يبدأ', lg_s_deliverable_progress: 'قيد التنفيذ', lg_s_deliverable_closed: 'مكتمل',
    lg_s_requirement_open: 'لم يبدأ', lg_s_requirement_progress: 'قيد التنفيذ', lg_s_requirement_closed: 'مكتمل',
    lg_s_milestone_pending: 'لم تصدر فاتورة', lg_s_milestone_invoiced: 'صدرت الفاتورة', lg_s_milestone_paid: 'مدفوعة',
    lg_s_risk_open: 'مفتوح', lg_s_risk_mitigated: 'تمت المعالجة', lg_s_risk_transferred: 'تم النقل', lg_s_risk_closed: 'مغلق',
    lg_a_start: 'ابدأ', lg_a_complete: 'أكمل', lg_a_reopen: 'أعد الفتح', lg_a_invoice: 'فوتر', lg_a_paid: 'تم الدفع', lg_a_mitigate: 'عالج', lg_a_transfer: 'انقل', lg_a_close: 'أغلق',
    lg_showing: 'عرض {a} إلى {b} من {n}', lg_none: 'لا توجد نتائج تطابق هذه التصفية.', lg_empty: 'لا توجد عناصر بعد. أضف أول عنصر.', lg_per_page: 'في الصفحة', lg_first: 'الصفحة الأولى', lg_prev: 'الصفحة السابقة', lg_next: 'الصفحة التالية', lg_last: 'الصفحة الأخيرة', lg_page: 'الصفحة {n}',
    lg_updated: 'تم التحديث', lg_added: 'تمت إضافة العنصر', lg_deleted: 'تم حذف العنصر', lg_overdue: 'متأخر', lg_review_chip: 'يحتاج مراجعة', lg_ignored_chip: 'متجاهل',
    lg_new: 'عنصر جديد', lg_edit: 'تعديل العنصر', lg_details_deliverable: 'تفاصيل المخرج', lg_details_requirement: 'تفاصيل المتطلب', lg_details_milestone: 'تفاصيل الدفعة', lg_details_risk: 'تفاصيل الخطر',
    lg_f_title: 'العنوان', lg_f_desc: 'الوصف', lg_f_review_date: 'تاريخ المراجعة', lg_f_mit: 'المعالجة أو الاستجابة', lg_f_pct: 'نسبة من العقد %', lg_f_amt: 'مبلغ الفاتورة', lg_delete_q: 'حذف هذا العنصر؟ لا يمكن التراجع.', lg_source: 'أين وجده الذكاء الاصطناعي', lg_conf: 'ثقة الذكاء الاصطناعي', lg_open_project: 'فتح صفحة المراجعة', lg_notfound: 'هذا العنصر لم يعد موجودا.',
    lg_columns: 'الأعمدة', lg_columns_hint: 'اختر الأعمدة التي تريد عرضها. كل حقول العنصر موجودة هنا.', lg_cols_reset: 'إعادة الأعمدة', lg_col_required: 'ظاهر دائما',
    lg_c_review: 'حالة المراجعة', lg_rv_confirmed: 'معتمد', lg_rv_proposed: 'يحتاج مراجعة', lg_rv_ignored: 'متجاهل', lg_c_linked: 'المخرج المرتبط', lg_c_doc: 'المستند المصدر', lg_c_quote: 'مقتطف المصدر', lg_c_created: 'تاريخ الإنشاء', lg_c_conf: 'ثقة الذكاء الاصطناعي',
    lg_for_risk: 'المخاطر', lg_for_milestone: 'الدفعات',
    lg_views: 'العروض المحفوظة', lg_view_all: 'كل العناصر', lg_view_save: 'حفظ كعرض', lg_view_update: 'تحديث العرض', lg_view_rename: 'إعادة تسمية العرض', lg_view_delete: 'حذف العرض', lg_view_changed: 'تغير منذ الحفظ',
    lg_view_name: 'اسم العرض', lg_view_name_ph: 'مثال سجل المخاطر', lg_view_save_title: 'حفظ هذا العرض', lg_view_save_hint: 'يحفظ الأعمدة والتصفية والبحث والترتيب الحالية. افتحه من جديد بنقرة واحدة من التبويبات فوق الجدول.', lg_view_name_req: 'أدخل اسما للعرض.', lg_view_exists: 'يوجد عرض بهذا الاسم. الحفظ سيستبدله.', lg_view_saved: 'تم حفظ العرض', lg_view_updated: 'تم تحديث العرض', lg_view_deleted: 'تم حذف العرض', lg_view_delete_q: 'حذف العرض "{n}"؟ عناصرك لن تتأثر.', lg_view_fail: 'تعذر حفظ العرض. حاول مرة أخرى.', lg_view_restart: 'العروض المحفوظة غير متاحة على الخادم بعد. أعد تشغيل التطبيق ليتم تحميل آخر تحديث ثم حاول مرة أخرى.',
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
    if (it.kind === 'decision') return s === 'active' ? [A('supersede', 'superseded')] : [A('reopen', 'active')];
    return s === 'open' ? [A('start', 'progress'), A('complete', 'closed', 'good')] : s === 'progress' ? [A('complete', 'closed', 'good')] : [A('reopen', 'open')];
  }
  const ACT_ICON = { start: 'play', complete: 'check', mitigate: 'check', transfer: 'link', close: 'x', supersede: 'x', invoice: 'dl', paid: 'check', reopen: 'undo' };

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
  const DEFAULT_COLS = ['type', 'item', 'status', 'owner', 'due', 'amount', 'source'];
  const ALL_COL_IDS = ['type', 'item', 'description', 'status', 'review', 'owner', 'due', 'amount', 'percent', 'prob', 'imp', 'mitigation', 'linked', 'conf', 'doc', 'quote', 'source', 'created'];
  const defaults = () => ({ q: '', kinds: [], st: '', prob: '', imp: '', due: '', rs: 'live', sort: 'type', dir: 1, page: 1, size: 20, cols: DEFAULT_COLS.slice(), view: '' });
  const cleanCols = (c) => { const k = Array.isArray(c) ? ALL_COL_IDS.filter((id) => id === 'item' || c.includes(id)) : []; return k.length > 1 ? k : DEFAULT_COLS.slice(); };
  const loadF = (id) => { try { const F = { ...defaults(), ...(JSON.parse(sessionStorage.getItem(KEY(id))) || {}) }; F.cols = cleanCols(F.cols); return F; } catch { return defaults(); } };
  const saveF = (id, F) => { try { sessionStorage.setItem(KEY(id), JSON.stringify(F)); } catch { /* optional */ } };
  // the part of the screen state a saved view remembers
  const CFG_KEYS = ['cols', 'kinds', 'st', 'prob', 'imp', 'due', 'rs', 'q', 'sort', 'dir', 'size'];
  const cfgOf = (F) => { const o = {}; for (const k of CFG_KEYS) o[k] = F[k]; o.cols = cleanCols(o.cols); return o; };
  const sameCfg = (a, b) => JSON.stringify(cfgOf({ ...defaults(), ...a })) === JSON.stringify(cfgOf({ ...defaults(), ...b }));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  PM.views.tab_logs = async function (root, p, q, token) {
    const [itemsRes, viewsRes] = await Promise.all([api('GET', `/api/projects/${p.id}/items`), api('GET', '/api/me/log-views').catch(() => ({ views: [] }))]);
    let items = itemsRes.items.filter((i) => KINDS.includes(i.kind));
    let views = viewsRes.views || [];
    if (PM.stale(token)) return;
    const F = loadF(p.id);
    if (!SIZES.includes(F.size)) F.size = 20;
    if (F.view && !views.some((v) => v.id === F.view)) F.view = '';
    const reload = async () => { items = (await api('GET', `/api/projects/${p.id}/items`)).items.filter((i) => KINDS.includes(i.kind)); drawTable(); counts(); };
    const itemTitle = (id) => { const x = items.find((k) => k.id === Number(id)); return x ? x.title : ''; };

    const stOptions = () => {
      const kinds = F.kinds.length ? F.kinds : KINDS;
      return `<option value="">${t('lg_any_status')}</option>${kinds.map((k) => `<optgroup label="${esc(t('lg_kind_' + k))}">${STATES[k].map((s) => `<option value="${k}|${s}" ${F.st === k + '|' + s ? 'selected' : ''}>${esc(label(k, s))}</option>`).join('')}</optgroup>`).join('')}`;
    };

    // ---- every field of an item as a column ----
    const dash = '<span class="muted">-</span>';
    const txt = (v, n = 160) => (v ? `<div class="lg-cell-txt">${esc(String(v).slice(0, n))}${String(v).length > n ? '…' : ''}</div>` : dash);
    const lower = (v) => String(v || '').toLowerCase();
    const reviewOf = (i) => (i.status === 'proposed' ? 'proposed' : i.status === 'ignored' ? 'ignored' : 'confirmed');
    const lvSel = (i, field, val) => `<select class="lg-sel" data-f="${field}" data-id="${i.id}" aria-label="${esc(t(field === 'probability' ? 'lg_prob' : 'lg_imp'))}">${LEVELS.map((v) => `<option value="${v}" ${v === (val || 'Medium') ? 'selected' : ''}>${t('lv_' + v)}</option>`).join('')}</select>`;
    const COLS = [
      { id: 'type', lab: 'lg_type', sort: (i) => KINDS.indexOf(i.kind), cell: (i) => `<td><span class="chip">${t('lg_kind_' + i.kind)}</span></td>`, csv: (i) => t('lg_kind_' + i.kind) },
      { id: 'item', lab: 'lg_item', req: true, sort: (i) => lower(i.title),
        cell: (i) => `<td class="lg-item"><div class="lg-title" data-edit="${i.id}" tabindex="0" role="button">${esc(i.title)}</div>${!F.cols.includes('description') && i.description && i.description !== i.title ? `<div class="small muted lg-desc">${esc(i.description.slice(0, 140))}</div>` : ''}${i.status === 'proposed' ? `<span class="chip amber">${t('lg_review_chip')}</span>` : i.status === 'ignored' ? `<span class="chip">${t('lg_ignored_chip')}</span>` : ''}</td>`, csv: (i) => i.title },
      { id: 'description', lab: 'lg_f_desc', sort: (i) => lower(i.description), cell: (i) => `<td class="lg-wide">${txt(i.description)}</td>`, csv: (i) => i.description },
      { id: 'status', lab: 'lg_status', sort: (i) => STATES[i.kind].indexOf(stOf(i)),
        cell: (i) => `<td><select class="lg-sel st ${stClass(i)}" data-f="state" data-id="${i.id}" aria-label="${esc(t('lg_status'))}">${STATES[i.kind].map((x) => `<option value="${x}" ${x === stOf(i) ? 'selected' : ''}>${esc(label(i.kind, x))}</option>`).join('')}</select></td>`, csv: (i) => label(i.kind, stOf(i)) },
      { id: 'review', lab: 'lg_c_review', sort: (i) => reviewOf(i), cell: (i) => `<td class="nowrap">${t('lg_rv_' + reviewOf(i))}</td>`, csv: (i) => t('lg_rv_' + reviewOf(i)) },
      { id: 'owner', lab: 'lg_owner', sort: (i) => lower((i.data || {}).owner), cell: (i) => `<td class="nowrap">${(i.data || {}).owner ? esc(i.data.owner) : dash}</td>`, csv: (i) => (i.data || {}).owner },
      { id: 'due', lab: 'lg_due', sort: (i) => dueOf(i) || '9999',
        cell: (i) => { const due = dueOf(i), late = due && due < today() && !isDone(i); return `<td class="nowrap lg-due ${late ? 'neg' : ''}">${due ? esc(due) : dash}${late ? ` <span class="chip red">${t('lg_overdue')}</span>` : ''}</td>`; }, csv: (i) => dueOf(i) },
      { id: 'amount', lab: 'lg_amount', cls: 'right', only: 'milestone', sort: (i) => (i.kind === 'milestone' ? amountOf(i, p) ?? -1 : -1),
        cell: (i) => { const a = i.kind === 'milestone' ? amountOf(i, p) : null; return `<td class="nowrap right">${a != null ? money(a, p.currency) : dash}</td>`; }, csv: (i) => (i.kind === 'milestone' ? amountOf(i, p) : '') },
      { id: 'percent', lab: 'lg_f_pct', cls: 'right', only: 'milestone', sort: (i) => ((i.data || {}).percent == null || i.data.percent === '' ? -1 : Number(i.data.percent)),
        cell: (i) => { const v = (i.data || {}).percent; return `<td class="nowrap right">${v != null && v !== '' ? esc(v) + '%' : dash}</td>`; }, csv: (i) => (i.data || {}).percent },
      { id: 'prob', lab: 'lg_prob', only: 'risk', sort: (i) => LEVELS.indexOf((i.data || {}).probability), cell: (i) => `<td>${i.kind === 'risk' ? lvSel(i, 'probability', (i.data || {}).probability) : dash}</td>`, csv: (i) => (i.kind === 'risk' ? (i.data || {}).probability : '') },
      { id: 'imp', lab: 'lg_imp', only: 'risk', sort: (i) => LEVELS.indexOf((i.data || {}).impact), cell: (i) => `<td>${i.kind === 'risk' ? lvSel(i, 'impact', (i.data || {}).impact) : dash}</td>`, csv: (i) => (i.kind === 'risk' ? (i.data || {}).impact : '') },
      { id: 'mitigation', lab: 'lg_f_mit', only: 'risk', sort: (i) => lower((i.data || {}).mitigation), cell: (i) => `<td class="lg-wide">${txt((i.data || {}).mitigation)}</td>`, csv: (i) => (i.data || {}).mitigation },
      { id: 'linked', lab: 'lg_c_linked', only: 'milestone', sort: (i) => lower(itemTitle((i.data || {}).deliverable_id)), cell: (i) => `<td class="lg-wide">${txt(itemTitle((i.data || {}).deliverable_id), 80)}</td>`, csv: (i) => itemTitle((i.data || {}).deliverable_id) },
      { id: 'conf', lab: 'lg_c_conf', cls: 'right', sort: (i) => (i.confidence == null ? -1 : i.confidence), cell: (i) => `<td class="nowrap right">${i.confidence != null ? Math.round(i.confidence * 100) + '%' : dash}</td>`, csv: (i) => (i.confidence != null ? Math.round(i.confidence * 100) + '%' : '') },
      { id: 'doc', lab: 'lg_c_doc', sort: (i) => lower(i.doc_name), cell: (i) => `<td class="lg-wide">${txt(i.doc_name, 80)}</td>`, csv: (i) => i.doc_name },
      { id: 'quote', lab: 'lg_c_quote', sort: (i) => lower(i.quote), cell: (i) => `<td class="lg-wide">${txt(i.quote, 200)}</td>`, csv: (i) => i.quote },
      { id: 'source', lab: 'lg_c_source', sort: (i) => srcOf(i), cell: (i) => `<td class="nowrap">${srcCell(i)}</td>`, csv: (i) => t('lg_src_' + srcOf(i)) },
      { id: 'created', lab: 'lg_c_created', sort: (i) => i.created_at || '', cell: (i) => `<td class="nowrap">${i.created_at ? esc(String(i.created_at).slice(0, 10)) : dash}</td>`, csv: (i) => String(i.created_at || '').slice(0, 10) },
    ];
    const srcOf = (i) => ((i.data || {}).meeting_id ? 'meeting' : i.doc_name || i.doc_id ? 'document' : 'manual');
    const srcCell = (i) => { const k = srcOf(i); return k === 'meeting' ? `<a class="chip blue" href="#/p/${p.id}/meetings?m=${i.data.meeting_id}" data-tip="${esc(t('mt_from_meeting'))}">${icon('mic')} ${t('lg_src_meeting')}</a>` : `<span class="chip">${t('lg_src_' + k)}</span>`; };
    const shown = () => COLS.filter((c) => F.cols.includes(c.id));

    root.innerHTML = `<div class="page wide lg-page">
      <div class="lg-head"><div class="grow"><h2>${t('lg_title')}</h2><div class="muted">${t('lg_lead')}</div></div>
        <div class="lg-colwrap"><button class="btn" id="lgCols" aria-haspopup="true" aria-expanded="false">${icon('list')}${t('lg_columns')} <span class="small muted" id="lgColN"></span></button><div class="lg-pop" id="lgPop" hidden></div></div>
        <button class="btn" id="lgExport">${icon('dl')}${t('lg_export')}</button><button class="btn primary" id="lgAdd">${icon('plus')}${t('lg_add')}</button></div>
      <div class="lg-views" id="lgViews" role="group" aria-label="${esc(t('lg_views'))}"></div>
      <div class="card lg-filters">
        <div class="lg-row"><label class="sf lg-search">${icon('search')}<input type="search" id="lgQ" placeholder="${esc(t('lg_search'))}" value="${esc(F.q)}" aria-label="${esc(t('lg_search'))}"></label>
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
      const col = COLS.find((c) => c.id === F.sort), key = col ? col.sort : (i) => i.id;
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * F.dir || a.id - b.id; });
      return rows;
    }
    function counts() {
      const base = items.filter(rsOk);
      KINDS.forEach((k) => { const el = $(`[data-count="${k}"]`, root); if (el) el.textContent = base.filter((i) => i.kind === k).length; });
    }

    const th = (c) => `<th class="${c.cls || ''}"><button class="lg-sort ${F.sort === c.id ? 'on' : ''}" data-sort="${c.id}" aria-label="${esc(t(c.lab))}">${t(c.lab)}<span aria-hidden="true">${F.sort === c.id ? (F.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
    function row(i, cols) {
      const acts = quick(i).map((a) => `<button class="btn sm ${a.cls}" data-qa="${a.to}" data-id="${i.id}">${t('lg_a_' + a.act)}</button>`).join('');
      return `<tr class="${i.status === 'ignored' ? 'lg-ign' : ''}" data-row="${i.id}">${cols.map((c) => c.cell(i)).join('')}
        <td class="lg-acts"><div class="row">${acts}<button class="btn sm ghost icon" data-edit="${i.id}" aria-label="${esc(t('edit'))}" data-tip="${esc(t('edit'))}">${icon('edit')}</button><button class="btn sm ghost icon" data-del="${i.id}" aria-label="${esc(t('delete'))}" data-tip="${esc(t('delete'))}">${icon('trash')}</button></div></td></tr>`;
    }
    function drawTable() {
      const rows = filtered(), n = rows.length, pages = Math.max(1, Math.ceil(n / F.size)), cols = shown();
      F.page = Math.min(Math.max(1, F.page), pages);
      const from = (F.page - 1) * F.size, slice = rows.slice(from, from + F.size);
      saveF(p.id, F);
      $('#lgColN', root).textContent = `(${cols.length})`;
      $('#lgTable', root).innerHTML = n
        ? `<div class="table-wrap"><table class="t lg-t"><thead><tr>${cols.map(th).join('')}<th>${t('lg_actions')}</th></tr></thead><tbody>${slice.map((i) => row(i, cols)).join('')}</tbody></table></div>`
        : `<div class="empty">${items.length ? t('lg_none') : t('lg_empty')}</div>`;
      const win = []; for (let k = Math.max(1, F.page - 2); k <= Math.min(pages, F.page + 2); k++) win.push(k);
      const nb = (cls, ic, lab, go, off) => `<button class="btn sm ghost icon ${cls}" data-pg="${go}" ${off ? 'disabled' : ''} aria-label="${esc(lab)}" data-tip="${esc(lab)}">${icon(ic)}${cls === 'dbl' ? icon(ic) : ''}</button>`;
      $('#lgPager', root).innerHTML = n ? `<div class="small muted">${t('lg_showing', { a: from + 1, b: Math.min(n, from + F.size), n })}</div><div class="grow"></div>
        <label class="small muted lg-pp">${t('lg_per_page')} <select id="lgSize" class="lg-sel">${SIZES.map((s) => `<option value="${s}" ${s === F.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <div class="lg-pages" role="navigation">${nb('dbl flip', 'chev_l', t('lg_first'), 1, F.page === 1)}${nb('flip', 'chev_l', t('lg_prev'), F.page - 1, F.page === 1)}${win.map((k) => `<button class="btn sm ${k === F.page ? 'primary' : 'ghost'}" data-pg="${k}" aria-label="${esc(t('lg_page', { n: k }))}" ${k === F.page ? 'aria-current="page"' : ''}>${k}</button>`).join('')}${nb('', 'chev_r', t('lg_next'), F.page + 1, F.page === pages)}${nb('dbl', 'chev_r', t('lg_last'), pages, F.page === pages)}</div>` : '';
      if (PM.bindTips) PM.bindTips(root);
      drawViews();
    }

    // ---- saved views: one click tabs above the table ----
    const activeView = () => views.find((v) => v.id === F.view) || null;
    function drawViews() {
      const av = activeView(), dirty = av && !sameCfg(av.cfg, cfgOf(F));
      const tab = (id, name, on) => `<button type="button" class="rd-chip lg-vt ${on ? 'on' : ''}" data-view="${esc(id)}" aria-pressed="${on}">${esc(name)}</button>`;
      $('#lgViews', root).innerHTML = `<span class="small muted lg-vlab">${t('lg_views')}</span>${tab('', t('lg_view_all'), !av)}${views.map((v) => tab(v.id, v.name, av && av.id === v.id)).join('')}
        <span class="lg-vact">${av && dirty ? `<span class="chip amber">${t('lg_view_changed')}</span><button class="btn sm" id="lgVUpd">${t('lg_view_update')}</button>` : ''}${av ? `<button class="btn sm ghost icon" id="lgVRen" aria-label="${esc(t('lg_view_rename'))}" data-tip="${esc(t('lg_view_rename'))}">${icon('edit')}</button><button class="btn sm ghost icon" id="lgVDel" aria-label="${esc(t('lg_view_delete'))}" data-tip="${esc(t('lg_view_delete'))}">${icon('trash')}</button>` : ''}<button class="btn sm" id="lgVSave">${icon('plus')}${t('lg_view_save')}</button></span>`;
      if (PM.bindTips) PM.bindTips($('#lgViews', root));
    }
    async function persistViews(next) {
      try { const r = await api('PUT', '/api/me/log-views', { views: next }); views = r.views; return true; } catch (e) { toast(e.message === 'Not found' ? t('lg_view_restart') : e.message || t('lg_view_fail'), 'err'); return false; }
    }
    function syncControls() {
      $('#lgQ', root).value = F.q; $('#lgProbF', root).value = F.prob; $('#lgImpF', root).value = F.imp; $('#lgDueF', root).value = F.due; $('#lgRs', root).value = F.rs;
      $$('[data-kind]', root).forEach((x) => { const on = F.kinds.includes(x.dataset.kind); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      $('#lgSt', root).innerHTML = stOptions(); drawColPop(); counts();
    }
    function openView(id) {
      const v = views.find((x) => x.id === id);
      Object.assign(F, defaults(), v ? v.cfg : {}, { cols: cleanCols(v ? v.cfg.cols : DEFAULT_COLS), view: v ? v.id : '', page: 1 });
      syncControls(); drawTable();
    }
    function nameDialog(title, current, onOk) {
      const m = modal({ title, body: `<p class="muted" style="margin-top:0">${t('lg_view_save_hint')}</p><label class="f">${t('lg_view_name')}<input type="text" id="lgVName" maxlength="60" value="${esc(current || '')}" placeholder="${esc(t('lg_view_name_ph'))}"></label><div class="small" id="lgVWarn" style="color:var(--warning);margin-top:6px"></div>`, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="lgVOk">${t('save')}</button>` });
      const inp = m.$('#lgVName'); inp.focus(); inp.select();
      const clash = () => views.find((v) => lower(v.name) === lower(inp.value.trim()) && v.id !== (activeView() || {}).id);
      inp.oninput = () => { m.$('#lgVWarn').textContent = clash() ? t('lg_view_exists') : ''; };
      const go = async () => { const nm = inp.value.trim(); if (!nm) { toast(t('lg_view_name_req'), 'err'); return; } if (await busy(m.$('#lgVOk'), () => onOk(nm))) m.close(); };
      m.$('#lgVOk').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    }
    function saveAsNew() {
      nameDialog(t('lg_view_save_title'), '', async (nm) => {
        const existing = views.find((v) => lower(v.name) === lower(nm));
        const id = existing ? existing.id : newId(), cfg = cfgOf(F);
        const ok = await persistViews(existing ? views.map((v) => (v.id === id ? { id, name: existing.name, cfg } : v)) : [...views, { id, name: nm, cfg }]);
        if (ok) { F.view = id; toast(t('lg_view_saved'), 'ok'); drawTable(); }
        return ok;
      });
    }

    // ---- column picker ----
    function drawColPop() {
      $('#lgPop', root).innerHTML = `<div class="small muted lg-pop-h">${t('lg_columns_hint')}</div><div class="lg-pop-list">${COLS.map((c) => `<label class="check lg-pop-i"><input type="checkbox" data-col="${c.id}" ${F.cols.includes(c.id) ? 'checked' : ''} ${c.req ? 'disabled' : ''}> <span>${t(c.lab)}</span>${c.only ? ` <span class="small muted">${t('lg_for_' + c.only)}</span>` : ''}${c.req ? ` <span class="small muted">${t('lg_col_required')}</span>` : ''}</label>`).join('')}</div><div class="lg-pop-f"><button class="btn sm ghost" id="lgColReset">${t('lg_cols_reset')}</button></div>`;
    }
    const popEl = () => $('#lgPop', root);
    function togglePop(on) { const el = popEl(), b = $('#lgCols', root); el.hidden = !on; b.setAttribute('aria-expanded', String(on)); if (on) drawColPop(); }

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
    // clearing removes the filters and search; the chosen columns and the open view stay
    $('#lgClear', root).onclick = () => { const keep = { size: F.size, cols: F.cols, view: F.view }; Object.assign(F, defaults(), keep); syncControls(); drawTable(); };
    $('#lgAdd', root).onclick = () => itemDialog(null, p, () => reload());
    $('#lgCols', root).onclick = (e) => { e.stopPropagation(); togglePop(popEl().hidden); };
    popEl().onclick = (e) => e.stopPropagation();
    popEl().onchange = (e) => {
      const c = e.target.closest('[data-col]'); if (!c) return;
      const on = ALL_COL_IDS.filter((id) => (id === c.dataset.col ? c.checked : F.cols.includes(id)));
      F.cols = cleanCols(on); drawTable();
    };
    popEl().addEventListener('click', (e) => { if (e.target.closest('#lgColReset')) { F.cols = DEFAULT_COLS.slice(); drawColPop(); drawTable(); } });
    // these two live on the document, so they remove themselves once the tab has been replaced
    const closePop = (e) => { if (!root.isConnected) { document.removeEventListener('click', closePop); document.removeEventListener('keydown', onEsc); return; } if (!popEl().hidden) togglePop(false); };
    const onEsc = (e) => { if (e.key === 'Escape') closePop(); };
    document.addEventListener('click', closePop);
    document.addEventListener('keydown', onEsc);
    $('#lgViews', root).addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-view]'); if (tb) return openView(tb.dataset.view);
      if (e.target.closest('#lgVSave')) return saveAsNew();
      const av = activeView(); if (!av) return;
      if (e.target.closest('#lgVUpd')) { if (await persistViews(views.map((v) => (v.id === av.id ? { ...v, cfg: cfgOf(F) } : v)))) { toast(t('lg_view_updated'), 'ok'); drawViews(); } return; }
      if (e.target.closest('#lgVRen')) return nameDialog(t('lg_view_rename'), av.name, async (nm) => { const ok = await persistViews(views.map((v) => (v.id === av.id ? { ...v, name: nm } : v)).filter((v, i, a) => a.findIndex((x) => lower(x.name) === lower(v.name)) === i)); if (ok) drawViews(); return ok; });
      if (e.target.closest('#lgVDel')) {
        if (!(await confirmDlg({ title: t('lg_view_delete'), message: t('lg_view_delete_q', { n: av.name }), ok: t('delete'), danger: true }))) return;
        if (await persistViews(views.filter((v) => v.id !== av.id))) { F.view = ''; toast(t('lg_view_deleted'), 'ok'); drawTable(); }
      }
    });
    $('#lgExport', root).onclick = () => {
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, cols = shown();
      const lines = [cols.map((c) => cell(t(c.lab))).join(',')];
      for (const i of filtered()) lines.push(cols.map((c) => cell(c.csv(i))).join(','));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `${p.name}-${(activeView() || { name: 'logs' }).name}.csv`.replace(/[\\/:*?"<>|]+/g, ' '); document.body.appendChild(a); a.click(); a.remove();
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
