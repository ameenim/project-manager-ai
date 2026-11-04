/* Review tab and the confirm or ignore wizard. */
(function () {
  const { esc, t, icon, money, $, $$, api, toast, modal, confirmDlg, busy, state: S } = window.PM;
  const KINDS = ['field', 'deliverable', 'requirement', 'milestone', 'risk', 'schedule'];
  const STATES = { deliverable: ['open', 'closed'], milestone: ['pending', 'invoiced', 'paid'], risk: ['open', 'mitigated', 'closed'] };
  const FIELD_INPUT = { start_date: 'date', end_date: 'date', value: 'number', currency: 'text', client: 'text' };

  Object.assign(window.PM.I18N.en, {
    rv_hide: 'Minimize', rv_show: 'Expand', rv_title: 'Review the extracted data', rv_sub: 'The AI filled in what it was sure about. Check the rest, then confirm, edit or ignore each item.',
    rv_extracted: 'Extracted', rv_filled: 'Filled by the AI', rv_toreview: 'Needs your review', rv_conf: 'Confidence',
    rv_start: 'Start guided review', rv_confirm_hi: 'Confirm {n} high confidence items', rv_done_all: 'Everything is reviewed. The project is up to date.',
    rv_f_review: 'Needs review', rv_f_conf: 'Confirmed', rv_f_ign: 'Ignored', rv_f_all: 'All',
    rv_c_hi: 'High confidence', rv_c_mid: 'Please check', rv_c_lo: 'Low confidence', rv_why: 'Why the AI thinks so', rv_from: 'From {doc}', rv_no_quote: 'This item was added without a quote.',
    rv_n_review: '{n} to review', rv_plan_h: 'Plan summary and cross checks', rv_docs_h: 'Documents read', rv_selected: '{n} selected', rv_confirm_sel: 'Confirm selected', rv_clear: 'Clear',
    rv_tasks_n: '{n} tasks', rv_meth: 'Delivery approach', rv_none_review: 'Nothing here needs review.', rv_price: 'Price', rv_due: 'Due', rv_phase: 'Phase', rv_accept: 'Acceptance', rv_verify: 'Verification',
    rv_share: 'Share', rv_amount: 'Amount', rv_terms: 'Payment terms', rv_days: '{n} days', rv_trigger: 'Trigger', rv_owner: 'Owner', rv_after: 'After', rv_dur: 'Duration', rv_prob: 'Probability', rv_imp: 'Impact', rv_mit: 'Mitigation',
    rv_conf_all_sec: 'Confirm all in this section', rv_open_wiz: 'Guided review', rv_progress: '{a} of {b} reviewed',
    wz_why_h: 'Why the AI did not approve this automatically', wz_r_conf: 'The AI was {pct}% sure. It approves automatically at {min}% or higher.',
    wz_r_basic: 'The document {doc} was only read with basic rules, so nothing from it is approved without you.', wz_r_noquote: 'No sentence in the documents states this directly.',
    wz_r_implied: 'The AI added this itself because the documents imply it.', wz_r_conflict: 'The documents disagree on this value. Pick the one that is right.',
    wz_r_similar: 'It looks like an item that is already approved: {name}. It may be a duplicate.', wz_r_missing: 'Not found in the document: {list}.',
    wz_r_check: 'A cross check raised it: {title}.', wz_r_other: 'The AI could not tie it to a clear statement, so please check it.',
    wz_ctx_h: 'Already approved in this section', wz_ctx_by_ai: 'by the AI', wz_ctx_by_you: 'by you', wz_ctx_none: 'Nothing is approved in this section yet.', wz_ctx_show: 'Show the approved items',
    wz_sim_h: 'Similar items already approved', wz_proj_h: 'Project so far', wz_pay_total: 'Approved payments total {a} of {v} ({p}%).', wz_pay_after: 'With this payment the total becomes {a} ({p}%).',
    wz_pay_over: 'That is more than the contract value.', wz_decide_h: 'How to decide', wz_h_field: 'Confirm the value that matches the signed contract. Ignore the others.',
    wz_h_deliverable: 'Confirm it if the client expects to receive it. Ignore it if it is a general statement or already covered by another deliverable.',
    wz_h_requirement: 'Confirm it if the team must meet it. Ignore it if it is background text or a duplicate.', wz_h_milestone: 'Confirm it if the client pays on this event. Check the share, the amount and the due date.',
    wz_h_risk: 'Confirm it if it could really hurt the project and the mitigation is realistic. Edit the level if you disagree.', wz_h_schedule: 'Confirm it if the task, the duration and the order make sense for the delivery approach.',
    wz_proj_val: 'Contract value', wz_proj_dates: 'Dates', wz_also: 'Also found in {docs}', wz_approved_n: '{n} approved',
    wz_item: 'Item {a} of {b}', wz_found: 'What the AI found', wz_edit: 'Edit details', wz_edit_done: 'Hide editing', wz_evidence: 'From the document',
    wz_tips: 'Tips: Enter confirms, S skips, X ignores, E edits, the left arrow goes back.', wz_hi_bulk: 'Confirm the {n} remaining high confidence items in this section',
    wz_saved: 'Your progress is saved as you go.', wz_sections: 'Sections', wz_stat_c: 'Confirmed', wz_stat_i: 'Ignored', wz_stat_s: 'Skipped', wz_choose: 'Choose the value to keep',
    wz_finish_p: 'Every item you confirmed is now part of the project.', wz_next: 'Confirm and next', ap_eta: 'This can take about {lo} to {hi} minutes. You can keep working on other screens or projects. A pop-up will tell you when {name} is ready for review.',
    ap_eta_short: 'This can take a few minutes. You can keep working on other screens or projects. A pop-up will tell you when {name} is ready for review.', ap_keep: 'Keep working', ap_total: 'Overall progress',
  });
  Object.assign(window.PM.I18N.ar, {
    rv_hide: 'تصغير', rv_show: 'توسيع', rv_title: 'مراجعة البيانات المستخرجة', rv_sub: 'عبأ الذكاء الاصطناعي ما كان متأكدا منه. راجع الباقي ثم أكد كل عنصر أو عدله أو تجاهله.',
    rv_extracted: 'المستخرج', rv_filled: 'عبأه الذكاء الاصطناعي', rv_toreview: 'بانتظار مراجعتك', rv_conf: 'مستوى الثقة',
    rv_start: 'ابدأ المراجعة الموجهة', rv_confirm_hi: 'أكد {n} عنصر عالي الثقة', rv_done_all: 'تمت مراجعة كل شيء. المشروع محدث.',
    rv_f_review: 'بانتظار المراجعة', rv_f_conf: 'مؤكد', rv_f_ign: 'متجاهل', rv_f_all: 'الكل',
    rv_c_hi: 'ثقة عالية', rv_c_mid: 'يرجى التحقق', rv_c_lo: 'ثقة منخفضة', rv_why: 'لماذا يعتقد الذكاء الاصطناعي ذلك', rv_from: 'من {doc}', rv_no_quote: 'أضيف هذا العنصر دون اقتباس.',
    rv_n_review: '{n} للمراجعة', rv_plan_h: 'ملخص الخطة وفحوصات التحقق', rv_docs_h: 'المستندات المقروءة', rv_selected: 'تم تحديد {n}', rv_confirm_sel: 'تأكيد المحدد', rv_clear: 'مسح',
    rv_tasks_n: '{n} مهمة', rv_meth: 'منهجية التنفيذ', rv_none_review: 'لا شيء هنا بحاجة إلى مراجعة.', rv_price: 'السعر', rv_due: 'الاستحقاق', rv_phase: 'المرحلة', rv_accept: 'القبول', rv_verify: 'التحقق',
    rv_share: 'النسبة', rv_amount: 'المبلغ', rv_terms: 'شروط الدفع', rv_days: '{n} يوما', rv_trigger: 'المحفز', rv_owner: 'المسؤول', rv_after: 'بعد', rv_dur: 'المدة', rv_prob: 'الاحتمالية', rv_imp: 'الأثر', rv_mit: 'المعالجة',
    rv_conf_all_sec: 'تأكيد كل عناصر هذا القسم', rv_open_wiz: 'المراجعة الموجهة', rv_progress: 'تمت مراجعة {a} من {b}',
    wz_why_h: 'لماذا لم يعتمد الذكاء الاصطناعي هذا العنصر تلقائيا', wz_r_conf: 'كان الذكاء الاصطناعي متأكدا بنسبة {pct}%. يعتمد تلقائيا عند {min}% أو أكثر.',
    wz_r_basic: 'تمت قراءة المستند {doc} بقواعد بسيطة فقط، لذلك لا يعتمد أي شيء منه دون موافقتك.', wz_r_noquote: 'لا توجد جملة في المستندات تذكر هذا بشكل مباشر.',
    wz_r_implied: 'أضاف الذكاء الاصطناعي هذا العنصر بنفسه لأن المستندات تدل عليه.', wz_r_conflict: 'المستندات غير متفقة على هذه القيمة. اختر القيمة الصحيحة.',
    wz_r_similar: 'يشبه عنصرا معتمدا بالفعل: {name}. قد يكون مكررا.', wz_r_missing: 'غير موجود في المستند: {list}.',
    wz_r_check: 'أثاره فحص التطابق: {title}.', wz_r_other: 'لم يستطع الذكاء الاصطناعي ربطه بعبارة واضحة، لذا يرجى مراجعته.',
    wz_ctx_h: 'المعتمد سابقا في هذا القسم', wz_ctx_by_ai: 'بواسطة الذكاء الاصطناعي', wz_ctx_by_you: 'بواسطتك', wz_ctx_none: 'لا يوجد شيء معتمد في هذا القسم بعد.', wz_ctx_show: 'عرض العناصر المعتمدة',
    wz_sim_h: 'عناصر مشابهة معتمدة بالفعل', wz_proj_h: 'المشروع حتى الآن', wz_pay_total: 'مجموع الدفعات المعتمدة {a} من {v} ({p}%).', wz_pay_after: 'مع هذه الدفعة يصبح المجموع {a} ({p}%).',
    wz_pay_over: 'وهذا أكثر من قيمة العقد.', wz_decide_h: 'كيف تقرر', wz_h_field: 'اعتمد القيمة المطابقة للعقد الموقع وتجاهل البقية.',
    wz_h_deliverable: 'اعتمده إذا كان العميل ينتظر استلامه. تجاهله إذا كان عبارة عامة أو مغطى بمخرج آخر.',
    wz_h_requirement: 'اعتمده إذا كان على الفريق الالتزام به. تجاهله إذا كان نصا تمهيديا أو مكررا.', wz_h_milestone: 'اعتمدها إذا كان العميل يدفع عند هذا الحدث. راجع النسبة والمبلغ وتاريخ الاستحقاق.',
    wz_h_risk: 'اعتمده إذا كان قادرا فعلا على الإضرار بالمشروع وكان التخفيف واقعيا. عدل المستوى إذا اختلفت.', wz_h_schedule: 'اعتمدها إذا كانت المهمة والمدة والترتيب منطقية لأسلوب التنفيذ.',
    wz_proj_val: 'قيمة العقد', wz_proj_dates: 'التواريخ', wz_also: 'موجود أيضا في {docs}', wz_approved_n: '{n} معتمد',
    wz_item: 'العنصر {a} من {b}', wz_found: 'ما وجده الذكاء الاصطناعي', wz_edit: 'تعديل التفاصيل', wz_edit_done: 'إخفاء التعديل', wz_evidence: 'من المستند',
    wz_tips: 'نصائح: Enter للتأكيد وS للتخطي وX للتجاهل وE للتعديل والسهم الأيسر للعودة.', wz_hi_bulk: 'أكد العناصر المتبقية عالية الثقة في هذا القسم وعددها {n}',
    wz_saved: 'يتم حفظ تقدمك أولا بأول.', wz_sections: 'الأقسام', wz_stat_c: 'مؤكد', wz_stat_i: 'متجاهل', wz_stat_s: 'متخطى', wz_choose: 'اختر القيمة التي ستبقى',
    wz_finish_p: 'كل عنصر أكدته أصبح جزءا من المشروع.', wz_next: 'تأكيد والتالي', ap_eta: 'قد يستغرق هذا من {lo} إلى {hi} دقائق تقريبا. يمكنك متابعة عملك في شاشات أو مشاريع أخرى. ستظهر لك نافذة عندما يصبح {name} جاهزا للمراجعة.',
    ap_eta_short: 'قد يستغرق هذا بضع دقائق. يمكنك متابعة عملك في شاشات أو مشاريع أخرى. ستظهر لك نافذة عندما يصبح {name} جاهزا للمراجعة.', ap_keep: 'تابع عملك', ap_total: 'التقدم الكلي',
  });


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

  // ---------- document reading status ----------
  const AN_KEY = { waiting: 'an_waiting', reading: 'an_reading', done: 'an_done', partial: 'an_partial', basic: 'an_basic', empty: 'an_empty', failed: 'an_failed' };
  const AN_CHIP = { waiting: '', reading: 'blue', done: 'green', partial: 'amber', basic: 'amber', empty: 'amber', failed: 'red' };
  // Cards that can be minimized. The choice is remembered for the session, closed by default once the analysis is done.
  const foldOpen = (key, dflt) => { try { const v = sessionStorage.getItem('fold_' + key); return v == null ? dflt : v === '1'; } catch (e) { return dflt; } };
  const foldBtn = (key, open, label, extra) => `<button type="button" class="fold-btn" data-fold="${key}" aria-expanded="${open}" data-tip="${open ? t('rv_hide') : t('rv_show')}"><span class="fold-ic ${open ? 'open' : ''}">${icon('back')}</span><h3>${label}</h3>${extra || ''}</button>`;
  function analysisCard(an, analyzing, itemCount) {
    if (!an || !an.docs || !an.docs.length) return '';
    const issues = an.docs.some((d) => !['done'].includes(d.status));
    if (!analyzing && !issues && itemCount) return '';
    const rows = an.docs.map((d) => {
      const found = d.counts ? d.counts.deliverable + d.counts.requirement + d.counts.risk + d.counts.milestone + d.counts.schedule + d.counts.field : 0;
      const cov = d.coverage ? t('an_coverage', { sent: d.coverage.chars_sent.toLocaleString('en-US'), total: d.coverage.chars_total.toLocaleString('en-US') }) : '';
      const drop = d.coverage && d.coverage.dropped_no_quote ? t('an_dropped', { n: d.coverage.dropped_no_quote }) : '';
      const detail = [d.status === 'reading' && d.progress ? d.progress : '', d.message, d.status === 'done' || d.status === 'partial' ? t('an_found', { n: found }) : '', cov, drop].filter(Boolean).map((s) => String(s).replace(/\.$/, '')).join('. ');
      return `<div class="list-item"><div class="grow"><b>${esc(d.filename)}</b>${detail ? `<div class="small muted">${esc(detail)}</div>` : ''}</div><span class="chip ${AN_CHIP[d.status] || ''}">${d.status === 'reading' ? '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span>' : ''}${t(AN_KEY[d.status] || 'an_waiting')}</span></div>`;
    }).join('');
    const retry = !analyzing ? `<button class="btn sm primary" id="anRetry">${icon('refresh')}${t('reanalyze')}</button>` : '';
    const failed = an.failed ? `<div class="banner err mb">${icon('x')}<div class="grow"><b>${t('ap_failed')}</b><div class="small">${esc(an.failed.message)}</div></div></div>` : '';
    const open = analyzing || foldOpen('docs', false);
    const bad = an.docs.filter((d) => d.status !== 'done').length;
    return `<div class="card mb" id="anCard"><div class="card-head">${analyzing ? `<h3>${t('an_title')}</h3>` : foldBtn('docs', open, t('an_title'), bad ? `<span class="chip amber">${bad}</span>` : `<span class="chip green">${an.docs.length}</span>`)}${open ? retry : ''}</div><div class="fold-body" ${open ? '' : 'hidden'}>${failed}${rows}</div></div>`;
  }
  // Starts the analysis again for every document of the project and shows the progress page.
  async function retryAnalysis(btn, p) {
    const r = await busy(btn, () => api('POST', `/api/projects/${p.id}/analyze`));
    if (r) window.PM.projectView(p.id, 'review', new URLSearchParams());
  }

  const CHECK_CHIP = { Pass: 'green', Warn: 'amber', Fail: 'red' };
  function planCard(an, proposedSched) {
    const sy = an && an.synthesis;
    if (!sy) return '';
    const checks = (sy.checks || []).map((c) => `<div class="list-item"><div class="grow"><b>${esc(c.title)}</b><div class="small muted">${esc(c.detail)}</div></div><span class="chip ${CHECK_CHIP[c.status] || ''}">${t('chk_' + c.status)}</span></div>`).join('');
    const notes = (sy.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
    const basis = sy.anchor ? t('plan_anchor', { date: sy.anchor, basis: sy.anchor_basis || '' }) : t('plan_no_anchor');
    const open = foldOpen('plan', false);
    return `<div class="card mb" id="planCard"><div class="card-head">${foldBtn('plan', open, t('plan_title'))}${proposedSched ? `<button class="btn primary" id="applySched">${icon('cal')}${t('apply_schedule', { n: proposedSched })}</button>` : ''}</div>
      <div class="fold-body" ${open ? '' : 'hidden'}>${sy.summary ? `<p>${esc(sy.summary)}</p>` : ''}<div class="small muted mb">${basis}</div>
      ${notes ? `<div class="mb"><b>${t('plan_notes')}</b><ul class="small">${notes}</ul></div>` : ''}
      ${checks ? `<div><b>${t('plan_checks')}</b>${checks}</div>` : ''}</div></div>`;
  }

  // ---------- loading page shown while documents are analyzed ----------
  const CONF_CLS = (c) => (c == null ? '' : c >= 0.85 ? 'hi' : c >= 0.7 ? 'mid' : 'lo');
  const pct = (c) => (c == null ? '–' : Math.round(c * 100) + '%');
  function confBar(label, c) {
    return `<div class="ap-bar"><span class="small">${label}</span><div class="progress"><i style="width:${c == null ? 0 : Math.round(c * 100)}%"></i></div><b class="small conf ${CONF_CLS(c)}">${pct(c)}</b></div>`;
  }
  function analysisPage(p) {
    const an = p.analysis || { stages: [], docs: [], confidence: {} };
    const fin = an.finished && !p.analyzing;
    const cf = an.confidence || {};
    const rows = (an.stages || []).map((st, i) => {
      const ic = st.status === 'done' ? `<span class="ap-ic done">${icon('check')}</span>` : st.status === 'active' ? '<span class="ap-ic act"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span></span>' : st.status === 'failed' ? `<span class="ap-ic fail">${icon('x')}</span>` : `<span class="ap-ic">${i + 1}</span>`;
      return `<div class="ap-step ${st.status}">${ic}<div class="grow"><b>${t('stage_' + st.key)}</b>${st.detail ? `<div class="small muted">${esc(st.detail)}</div>` : ''}</div></div>`;
    }).join('');
    const kinds = [['info', 'kind_field'], ['deliverable', 'kind_deliverable'], ['requirement', 'kind_requirement'], ['payment', 'kind_milestone'], ['schedule', 'kind_schedule'], ['risk', 'kind_risk']];
    const bars = kinds.map(([k, lab]) => confBar(t(lab), (cf.by || {})[k])).join('');
    const files = (an.docs || []).map((d) => {
      const found = d.counts ? d.counts.deliverable + d.counts.requirement + d.counts.risk + d.counts.milestone + d.counts.schedule + d.counts.field : 0;
      const detail = [d.role_label, d.status === 'reading' && d.progress ? d.progress : '', d.message, d.status === 'done' || d.status === 'partial' ? t('an_found', { n: found }) : '', d.coverage ? t('an_coverage', { sent: d.coverage.chars_sent.toLocaleString('en-US'), total: d.coverage.chars_total.toLocaleString('en-US') }) : ''].filter(Boolean).map((x) => String(x).replace(/\.$/, '')).join('. ');
      return `<div class="list-item"><div class="grow"><b>${esc(d.filename)}</b>${detail ? `<div class="small muted">${esc(detail)}</div>` : ''}</div><span class="chip ${AN_CHIP[d.status] || ''}">${d.status === 'reading' ? '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span>' : ''}${t(AN_KEY[d.status] || 'an_waiting')}</span></div>`;
    }).join('');
    const f = an.filled;
    const total = (an.docs || []).reduce((n, d) => n + (d.counts ? d.counts.deliverable + d.counts.requirement + d.counts.risk + d.counts.milestone + d.counts.schedule + d.counts.field : 0), 0);
    const bad = fin && (an.failed || !total);
    const warn = fin && !bad && an.warning ? `<div class="card mb ap-done"><div class="card-head"><h3>${t('ap_warn_h')}</h3></div><p>${esc(an.warning.message)}</p><div class="row gap"><button class="btn primary" id="apRetry">${icon('refresh')}${t('reanalyze')}</button><button class="btn" id="apReview">${icon('check')}${t('ap_review')}</button></div></div>` : '';
    const badCard = bad ? `<div class="card mb ap-done"><div class="card-head"><h3>${an.failed ? t('ap_failed') : t('ap_empty_h')}</h3></div>
      <p>${esc(an.failed ? an.failed.message : t('ap_empty_p'))}</p>
      <div class="row gap"><button class="btn primary" id="apRetry">${icon('refresh')}${t('reanalyze')}</button><button class="btn" id="apReview">${icon('check')}${t('ap_review')}</button></div></div>` : '';
    const done = fin && !bad && !warn ? `<div class="card mb ap-done"><div class="card-head"><h3>${t('ap_done')}</h3></div>
      <p>${f ? t('ap_filled', { a: f.confirmed, b: f.review }) : ''}</p>
      ${an.synthesis && an.synthesis.summary ? `<p class="small">${esc(an.synthesis.summary)}</p>` : ''}
      ${f && f.conflicts && f.conflicts.length ? `<ul class="small muted">${f.conflicts.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <div class="row gap"><button class="btn primary" id="apReview">${icon('check')}${t('ap_review')}</button><a class="btn" href="#/p/${p.id}/schedule" id="apSched">${icon('cal')}${t('open_schedule')}</a></div></div>` : '';
    const eta = !fin && an.eta ? `<div class="ap-eta">${icon('spark')}<div class="grow"><div>${an.eta.low ? t('ap_eta', { lo: an.eta.low, hi: an.eta.high, name: esc(p.name) }) : t('ap_eta_short', { name: esc(p.name) })}</div><div style="margin-top:10px"><a class="btn sm" href="#/projects" id="apKeep">${icon('fwd', 'flip')}${t('ap_keep')}</a></div></div></div>` : !fin ? `<div class="ap-eta">${icon('spark')}<div class="grow">${t('ap_eta_short', { name: esc(p.name) })}</div></div>` : '';
    const total2 = !fin ? `<div class="ap-total"><span class="small muted">${t('ap_total')}</span><div class="progress"><i style="width:${an.pct || 2}%"></i></div><b class="small">${an.pct || 2}%</b></div>` : '';
    return `<div class="page">
      <div class="card mb"><div class="card-head"><h3>${fin ? (bad ? (an.failed ? t('ap_failed') : t('ap_empty_h')) : an.warning ? t('ap_warn_h') : t('ap_done')) : t('ap_title')}</h3><span class="small muted">${esc(p.name)}</span></div>
        ${eta}${total2}<div class="ap-grid"><div class="ap-steps">${rows}</div>
          <div class="ap-conf"><div class="small muted">${t('ap_conf')}</div><div class="ap-big conf ${CONF_CLS(cf.overall)}">${pct(cf.overall)}</div>
            ${cf.coverage != null ? `<div class="small muted mb">${t('ap_cov', { n: Math.round(cf.coverage * 100) })}</div>` : ''}${bars}</div></div></div>
      ${done}${badCard}${warn}
      <div class="card"><div class="card-head"><h3>${t('an_title')}</h3></div>${files}</div></div>`;
  }

  // ---------- section facts and rows ----------
  const confWord = (c) => (c == null ? '' : `<span class="conf ${c >= 0.85 ? 'hi' : c >= 0.7 ? 'mid' : 'lo'}" title="${t('confidence')}">${t(c >= 0.85 ? 'rv_c_hi' : c >= 0.7 ? 'rv_c_mid' : 'rv_c_lo')} · ${Math.round(c * 100)}%</span>`);
  const lvChip = (x) => `<span class="chip ${x === 'High' ? 'red' : x === 'Low' ? 'green' : 'amber'}">${t('lv_' + (x || 'Medium'))}</span>`;
  const fact = (label, val) => (val == null || val === '' ? '' : `<span class="rv-fact"><span>${label}</span><b>${val}</b></span>`);
  const titleOf = (kind, it) => (kind === 'field' ? t('fld_' + (it.data || {}).field) : kind === 'requirement' ? (it.description || it.title || '') : it.title || '');
  function facts(kind, it, p) {
    const d = it.data || {};
    if (kind === 'field') return fact(t('value'), d.field === 'value' ? money(d.value, p.currency) : esc(d.value)) + (d.conflict ? `<span class="chip amber">${t('conflict')}</span>` : '');
    if (kind === 'deliverable') return fact(t('rv_price'), d.amount != null ? money(d.amount, p.currency) : '') + fact(t('rv_due'), esc(d.due_date)) + fact(t('rv_phase'), esc(d.phase)) + fact(t('rv_accept'), esc((d.acceptance || '').slice(0, 90)));
    if (kind === 'requirement') return (d.priority ? `<span class="chip ${d.priority === 'Must' ? 'red' : d.priority === 'Could' ? '' : 'blue'}">${esc(d.priority)}</span>` : '') + fact(t('rv_verify'), esc((d.verification || '').slice(0, 90)));
    if (kind === 'milestone') {
      const amt = d.amount != null ? money(d.amount, p.currency) : d.percent != null && p.value ? money(Math.round((p.value * d.percent) / 100), p.currency) : '';
      return fact(t('rv_share'), d.percent != null ? d.percent + '%' : '') + fact(t('rv_amount'), amt) + fact(t('rv_due'), esc(d.due_date)) + fact(t('rv_terms'), d.terms_days ? t('rv_days', { n: d.terms_days }) : '') + fact(t('rv_trigger'), esc((d.trigger || d.deliverable || '').slice(0, 80)));
    }
    if (kind === 'risk') return fact(t('rv_prob'), lvChip(d.probability)) + fact(t('rv_imp'), lvChip(d.impact)) + fact(t('rv_mit'), esc((d.mitigation || '').slice(0, 160)));
    if (kind === 'schedule') {
      const dates = d.start ? esc(d.start) + (d.end && d.end !== d.start ? ` to ${esc(d.end)}` : '') : d.start_week ? `${t('week')} ${d.start_week}${d.end_week ? ` to ${d.end_week}` : ''}` : '';
      return fact(t('start'), dates) + fact(t('rv_dur'), d.duration_days ? t('rv_days', { n: d.duration_days }) : '') + (d.type === 'review' || d.type === 'approval' ? `<span class="chip violet">${t('type_' + d.type)}</span>` : '') + fact(t('rv_owner'), esc(d.owner)) + fact(t('rv_after'), esc((d.depends_on || []).slice(0, 2).join(', '))) + (d.implied ? `<span class="chip violet">${t('ai_added')}</span>` : '');
    }
    return '';
  }
  const evidenceHtml = (it) => {
    const d = it.data || {};
    const doc = it.doc_name || (d.analysis ? t('ai_analysis') : '');
    const note = d.implied && d.note ? `<div class="small">${esc(d.note)}</div>` : '';
    if (!it.quote && !doc && !note) return '';
    return `<details class="rv-ev"><summary>${t('rv_why')}</summary>${note}${it.quote ? `<div class="quote">${esc(it.quote)}</div>` : `<div class="small muted">${t('rv_no_quote')}</div>`}${doc ? `<div class="small muted">${icon('file')} ${t('rv_from', { doc: esc(doc) })}${d.also_in && d.also_in.length ? ` +${d.also_in.length}` : ''}</div>` : ''}</details>`;
  };
  function rowHtml(kind, i, p, picked, compact) {
    const proposed = i.status === 'proposed';
    const stSel = STATES[kind] && i.status === 'confirmed' ? `<select data-state="${i.id}" class="rv-state">${STATES[kind].map((s) => `<option value="${s}" ${i.state === s ? 'selected' : ''}>${t('state_' + s)}</option>`).join('')}</select>` : '';
    const dl = i.evidence_name ? `<a href="#" class="small" data-dl="${i.evidence_doc_id}" data-name="${esc(i.evidence_name)}">${icon('file')} ${esc(i.evidence_name)}</a>` : '';
    const acts = proposed
      ? `<button class="btn sm primary" data-confirm="${i.id}">${icon('check')}${t('confirm')}</button><button class="btn sm icon ghost" data-edit="${i.id}" aria-label="${t('edit')}" data-tip="${t('edit')}">${icon('edit')}</button><button class="btn sm icon ghost" data-ignore="${i.id}" aria-label="${t('ignore')}" data-tip="${t('ignore')}">${icon('x')}</button>`
      : i.status === 'ignored'
        ? `<button class="btn sm" data-reopen="${i.id}">${t('reopen')}</button><button class="btn sm icon ghost" data-del="${i.id}" aria-label="${t('delete')}" data-tip="${t('delete')}">${icon('trash')}</button>`
        : `<button class="btn sm icon ghost" data-edit="${i.id}" aria-label="${t('edit')}" data-tip="${t('edit')}">${icon('edit')}</button><button class="btn sm icon ghost" data-ignore="${i.id}" aria-label="${t('ignore')}" data-tip="${t('ignore')}">${icon('x')}</button><button class="btn sm icon ghost" data-del="${i.id}" aria-label="${t('delete')}" data-tip="${t('delete')}">${icon('trash')}</button>`;
    return `<div class="rv-row ${i.status} ${compact ? 'compact' : ''}"><div class="rv-pick">${proposed ? `<input type="checkbox" data-pick="${i.id}" ${picked.has(i.id) ? 'checked' : ''} aria-label="${t('confirm')}">` : ''}</div>
      <div class="rv-main"><div class="rv-title">${esc(titleOf(kind, i))}</div>${kind === 'deliverable' && i.description ? `<div class="small muted rv-desc">${esc(i.description.slice(0, 200))}</div>` : ''}<div class="rv-facts">${facts(kind, i, p)}</div>${stSel ? `<div class="rv-facts">${stSel}${dl}</div>` : dl ? `<div class="rv-facts">${dl}</div>` : ''}${evidenceHtml(i)}</div>
      <div class="rv-side">${proposed ? confWord(i.confidence) : statusChip(i.status)}<div class="rv-acts">${acts}</div></div></div>`;
  }
  // The schedule is shown grouped by phase so a long plan stays readable.
  function scheduleList(list, p, picked) {
    const groups = [];
    const byName = new Map();
    const phaseOf = (i) => (i.data.level === 'phase' && !i.data.phase ? i.title : i.data.phase || '');
    for (const i of list) {
      const g = phaseOf(i);
      if (!byName.has(g)) { const o = { name: g, head: null, rows: [] }; byName.set(g, o); groups.push(o); }
      const o = byName.get(g);
      if (i.data.level === 'phase' && !i.data.phase) o.head = i; else o.rows.push(i);
    }
    return groups.map((g) => {
      const n = g.rows.length + (g.head ? 1 : 0);
      const hp = g.head ? rowHtml('schedule', g.head, p, picked, false) : `<div class="rv-group-h"><b>${esc(g.name || '')}</b></div>`;
      return `<div class="rv-group"><div class="rv-group-top"><span class="small muted">${t('rv_tasks_n', { n })}</span></div>${hp}${g.rows.map((r) => rowHtml('schedule', r, p, picked, true)).join('')}</div>`;
    }).join('');
  }

  // ---------- tab ----------
  window.PM.views.tab_review = async function (root, p, q, token) {
    const seenKey = p.analysis ? `an_seen_${p.id}_${p.analysis.at}` : null;
    const seen = () => { try { return sessionStorage.getItem(seenKey); } catch (e) { return null; } };
    if (p.analysis && p.analysis.stages && p.analysis.stages.length && (p.analyzing || (p.analysis.finished && p.analysis.show_summary && !seen()))) {
      const show = (pp) => {
        root.innerHTML = analysisPage(pp);
        const go = $('#apReview', root);
        if (go) go.onclick = () => { try { sessionStorage.setItem(seenKey, '1'); } catch (e) { /* ignore */ } window.PM.projectView(p.id, 'review', new URLSearchParams()); };
        const ar = $('#apRetry', root);
        if (ar) ar.onclick = () => retryAnalysis(ar, p);
        const sc = $('#apSched', root);
        if (sc) sc.addEventListener('click', () => { try { sessionStorage.setItem(seenKey, '1'); } catch (e) { /* ignore */ } });
      };
      show(p);
      if (p.analyzing) {
        const poll = async () => {
          if (window.PM.stale(token)) return;
          const np = (await api('GET', `/api/projects/${p.id}`)).project;
          if (np.analyzing) { show(np); setTimeout(poll, 1200); }
          else window.PM.projectView(p.id, 'review', new URLSearchParams());
        };
        setTimeout(poll, 1200);
      }
      return;
    }
    let items = (await api('GET', `/api/projects/${p.id}/items`)).items;
    let kind = q.get('kind') || sessionStorage.getItem('rv_kind') || null;
    let status = sessionStorage.getItem('rv_f') || null;
    let search = '';
    const picked = new Set();
    const proposedBy = () => KINDS.reduce((o, k) => ((o[k] = items.filter((i) => i.kind === k && i.status === 'proposed').length), o), {});
    if (!kind || !KINDS.includes(kind)) { const pb = proposedBy(); kind = KINDS.find((k) => pb[k]) || 'deliverable'; }
    if (!status) status = Object.values(proposedBy()).some(Boolean) ? 'proposed' : 'all';
    let an = p.analysis || null;
    const reload = async () => { items = (await api('GET', `/api/projects/${p.id}/items`)).items; S.project = (await api('GET', `/api/projects/${p.id}`)).project; an = S.project.analysis || null; picked.clear(); draw(); };
    const hiOf = (list) => list.filter((i) => i.status === 'proposed' && (i.confidence || 0) >= 0.8);

    function draw() {
      if (window.PM.stale(token)) return;
      const pb = proposedBy();
      const total = Object.values(pb).reduce((a, b) => a + b, 0);
      const live = items.filter((i) => i.status !== 'ignored');
      const confirmed = items.filter((i) => i.status === 'confirmed').length;
      const hi = hiOf(items);
      let list = items.filter((i) => i.kind === kind);
      if (status !== 'all') list = list.filter((i) => i.status === status);
      if (search) list = list.filter((i) => `${i.title} ${i.description}`.toLowerCase().includes(search.toLowerCase()));
      const cnt = (s) => items.filter((i) => i.kind === kind && (s === 'all' || i.status === s)).length;
      const cf = an && an.confidence && an.confidence.overall != null ? Math.round(an.confidence.overall * 100) + '%' : '–';
      const tile = (n, label, cls = '') => `<div class="rv-stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
      const reviewedPct = live.length ? Math.round((confirmed / live.length) * 100) : 0;
      const hero = `<div class="card rv-hero mb"><div class="rv-hero-main"><h2>${t('rv_title')}</h2><p class="muted">${t('rv_sub')}</p>
          <div class="rv-stats">${tile(live.length, t('rv_extracted'))}${tile(confirmed, t('rv_filled'), 'ok')}${tile(total, t('rv_toreview'), total ? 'warn' : '')}${tile(cf, t('rv_conf'))}</div>
          <div class="rv-prog"><div class="progress"><i style="width:${reviewedPct}%"></i></div><span class="small muted">${t('rv_progress', { a: confirmed, b: live.length })}</span></div></div>
        <div class="rv-hero-cta">${total ? `<button class="btn primary lg" id="wizBtn">${icon('play')}${t('rv_start')} (${total})</button>` : `<div class="banner ok">${icon('check')}<div class="grow"><b>${t('rv_done_all')}</b></div></div>`}
          ${hi.length ? `<button class="btn" id="hiBtn">${icon('check')}${t('rv_confirm_hi', { n: hi.length })}</button>` : ''}
          ${an && an.docs && an.docs.length ? `<button class="btn ghost" id="anRetry">${icon('refresh')}${t('reanalyze')}</button>` : ''}</div></div>`;
      const tabs = `<div class="rv-tabs" role="tablist">${KINDS.map((k) => { const n = items.filter((i) => i.kind === k && i.status !== 'ignored').length; return `<button class="rv-tab ${k === kind ? 'on' : ''}" role="tab" aria-selected="${k === kind}" data-kind="${k}"><span class="rv-tab-t">${t('kind_' + k)}</span><span class="rv-tab-n">${n}</span>${pb[k] ? `<span class="chip amber">${t('rv_n_review', { n: pb[k] })}</span>` : n ? `<span class="chip green">${icon('check')}</span>` : ''}</button>`; }).join('')}</div>`;
      const filters = ['proposed', 'confirmed', 'ignored', 'all'].map((s) => `<button class="rv-seg ${status === s ? 'on' : ''}" data-status="${s}">${t(s === 'proposed' ? 'rv_f_review' : s === 'confirmed' ? 'rv_f_conf' : s === 'ignored' ? 'rv_f_ign' : 'rv_f_all')} <span>${cnt(s)}</span></button>`).join('');
      const secHi = hiOf(items.filter((i) => i.kind === kind));
      const toolbar = `<div class="rv-bar"><div class="rv-segs">${filters}</div><span class="grow"></span><div class="rv-search"><input type="text" id="rvSearch" placeholder="${t('search')}" value="${esc(search)}" aria-label="${t('search')}"></div>
          ${secHi.length ? `<button class="btn sm" id="secBtn">${icon('check')}${t('rv_conf_all_sec')} (${secHi.length})</button>` : ''}
          ${['deliverable', 'requirement', 'risk', 'milestone'].includes(kind) ? `<button class="btn sm" id="addItem">${icon('plus')}${t('add')}</button>` : ''}</div>
        <div class="rv-sel" id="rvSel" ${picked.size ? '' : 'hidden'}><b>${t('rv_selected', { n: picked.size })}</b><button class="btn sm primary" id="selOk">${icon('check')}${t('rv_confirm_sel')}</button><button class="btn sm ghost" id="selClear">${t('rv_clear')}</button></div>`;
      const rows = !list.length ? `<div class="empty">${status === 'proposed' ? t('rv_none_review') : t('nothing_here')}</div>` : kind === 'schedule' ? scheduleList(list, p, picked) : list.map((i) => rowHtml(kind, i, p, picked, false)).join('');
      root.innerHTML = `<div class="page rv">
        ${p.analyzing ? `<div class="banner mb"><span class="spinner"></span><div class="grow"><b>${t('ai_reading')}</b><div class="small muted">${t('ai_reading_hint')}</div></div></div>` : ''}
        ${!p.analyzing && items.length ? hero : ''}
        ${analysisCard(an, p.analyzing, items.length)}
        ${p.analyzing ? '' : planCard(an, items.filter((i) => i.kind === 'schedule' && i.status === 'proposed').length)}
        ${!p.analyzing && !items.length ? `<div class="card empty mb"><div class="big">📄</div><p>${t('no_items_yet')}</p><a class="btn primary" href="#/p/${p.id}/documents">${icon('upload')}${t('upload_docs')}</a></div>` : ''}
        ${items.length ? `<div class="card">${tabs}${kind === 'schedule' ? `<div class="small muted mb">${t('schedule_note')} <a href="#/p/${p.id}/schedule">${t('open_schedule')}</a></div>` : ''}${toolbar}<div class="rv-list">${rows}</div></div>` : ''}</div>`;
      bind();
    }

    function bind() {
      $$('[data-fold]', root).forEach((b) => (b.onclick = () => {
        const card = b.closest('.card'); const body = $('.fold-body', card); const open = body.hidden;
        body.hidden = !open; b.setAttribute('aria-expanded', open); $('.fold-ic', b).classList.toggle('open', open);
        try { sessionStorage.setItem('fold_' + b.dataset.fold, open ? '1' : '0'); } catch (e) { /* ignore */ }
      }));
      $$('[data-kind]', root).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; picked.clear(); sessionStorage.setItem('rv_kind', kind); draw(); }));
      $$('[data-status]', root).forEach((b) => (b.onclick = () => { status = b.dataset.status; sessionStorage.setItem('rv_f', status); draw(); }));
      const si = $('#rvSearch', root); if (si) si.oninput = () => { search = si.value; const pos = si.selectionStart; draw(); const n = $('#rvSearch', root); n.focus(); n.setSelectionRange(pos, pos); };
      const act = async (e, fn) => { const b = e.currentTarget; await busy(b, fn); await reload(); };
      $$('[data-confirm]', root).forEach((b) => (b.onclick = (e) => act(e, () => api('POST', `/api/items/${b.dataset.confirm}/confirm`))));
      $$('[data-ignore]', root).forEach((b) => (b.onclick = (e) => act(e, () => api('POST', `/api/items/${b.dataset.ignore}/ignore`))));
      $$('[data-reopen]', root).forEach((b) => (b.onclick = (e) => act(e, () => api('POST', `/api/items/${b.dataset.reopen}/reopen`))));
      $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: t('delete'), message: t('confirm_delete_item'), ok: t('delete'), danger: true })) { await busy(null, () => api('DELETE', `/api/items/${b.dataset.del}`)); reload(); } }));
      $$('[data-edit]', root).forEach((b) => (b.onclick = () => editItem(items.find((i) => i.id === Number(b.dataset.edit)))));
      $$('[data-state]', root).forEach((s) => (s.onchange = async () => { await busy(null, () => api('PUT', `/api/items/${s.dataset.state}`, { state: s.value })); reload(); }));
      $$('[data-dl]', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.PM.download(`/api/projects/${p.id}/documents/${a.dataset.dl}/file`, a.dataset.name); }));
      // selecting rows shows a bar with one action, without redrawing the list
      const bar = $('#rvSel', root);
      $$('[data-pick]', root).forEach((c) => (c.onchange = () => { const id = Number(c.dataset.pick); if (c.checked) picked.add(id); else picked.delete(id); if (bar) { bar.hidden = !picked.size; const b = $('b', bar); if (b) b.textContent = t('rv_selected', { n: picked.size }); } }));
      const sc = $('#selClear', root); if (sc) sc.onclick = () => { picked.clear(); draw(); };
      const so = $('#selOk', root); if (so) so.onclick = async () => { const ids = [...picked]; await busy(so, () => api('POST', `/api/projects/${p.id}/items/bulk`, { ids, action: 'confirm' })); toast(t('saved'), 'ok'); reload(); };
      const hb = $('#hiBtn', root);
      if (hb) hb.onclick = async () => { const ids = hiOf(items).map((i) => i.id); if (!(await confirmDlg({ title: t('confirm'), message: t('confirm_bulk', { n: ids.length }), ok: t('confirm') }))) return; await busy(hb, () => api('POST', `/api/projects/${p.id}/items/bulk`, { ids, action: 'confirm' })); toast(t('saved'), 'ok'); reload(); };
      const sb = $('#secBtn', root);
      if (sb) sb.onclick = async () => { const ids = hiOf(items.filter((i) => i.kind === kind)).map((i) => i.id); if (!(await confirmDlg({ title: t('confirm'), message: t('confirm_bulk', { n: ids.length }), ok: t('confirm') }))) return; await busy(sb, () => api('POST', `/api/projects/${p.id}/items/bulk`, { ids, action: 'confirm' })); toast(t('saved'), 'ok'); reload(); };
      const apply = $('#applySched', root);
      if (apply) apply.onclick = async () => {
        const ids = items.filter((i) => i.kind === 'schedule' && i.status === 'proposed').sort((a, b) => a.id - b.id).map((i) => i.id);
        await busy(apply, async () => { await api('POST', `/api/projects/${p.id}/items/bulk`, { ids, action: 'confirm' }); });
        toast(t('schedule_applied'));
        location.hash = `#/p/${p.id}/schedule`;
      };
      const add = $('#addItem', root); if (add) add.onclick = () => editItem({ kind, title: '', description: '', data: {}, isNew: true });
      const wb = $('#wizBtn', root); if (wb) wb.onclick = () => startWizard(p, reload, kind);
      const rt = $('#anRetry', root); if (rt) rt.onclick = () => retryAnalysis(rt, p);
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
        if (np.analyzing) {
          const host = root.querySelector('#anCard');
          if (host && np.analysis) { const tmp = document.createElement('div'); tmp.innerHTML = analysisCard(np.analysis, true, 0); if (tmp.firstElementChild) host.replaceWith(tmp.firstElementChild); }
          setTimeout(poll, 1500);
        }
        else { window.PM.projectView(p.id, 'review', new URLSearchParams()); }
      };
      setTimeout(poll, 1500);
    } else if (new URLSearchParams(location.hash.split('?')[1] || '').get('wizard') === '1' && Object.values(proposedBy()).some(Boolean)) startWizard(p, reload);
  };

  // ---------- context for a decision in the wizard ----------
  const AUTO_AT = { field: 0.7, schedule: 0.7 };
  const autoAt = (kind) => AUTO_AT[kind] || 0.8;
  const tokSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const sim = (a, b) => { const A = tokSet(a), B = tokSet(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((w) => B.has(w) && n++); return n / Math.min(A.size, B.size); };
  const MISSING = {
    deliverable: [['due_date', 'rv_due'], ['acceptance', 'rv_accept']],
    milestone: [['percent', 'rv_share'], ['due_date', 'rv_due'], ['trigger', 'rv_trigger']],
    risk: [['mitigation', 'rv_mit']], requirement: [['verification', 'rv_verify']], schedule: [['start', 'start']],
  };
  function reasonsFor(it, c) {
    const out = [];
    const d = it.data || {};
    const conf = it.confidence || 0;
    if (conf < autoAt(it.kind)) out.push(t('wz_r_conf', { pct: Math.round(conf * 100), min: Math.round(autoAt(it.kind) * 100) }));
    const doc = ((c.an && c.an.docs) || []).find((x) => x.filename === it.doc_name);
    if (doc && doc.engine && doc.engine !== 'claude' && doc.engine !== 'msp') out.push(t('wz_r_basic', { doc: esc(doc.filename) }));
    if (it.kind === 'field' && d.conflict) out.push(t('wz_r_conflict'));
    if (!it.quote && !d.implied) out.push(t('wz_r_noquote'));
    if (d.implied) out.push(t('wz_r_implied'));
    const miss = (MISSING[it.kind] || []).filter(([k]) => d[k] == null || d[k] === '' || (k === 'percent' && d.amount != null && d.percent == null ? false : false)).filter(([k]) => !(k === 'percent' && d.amount != null)).filter(([k]) => !(k === 'trigger' && d.deliverable)).map(([, l]) => t(l));
    if (miss.length) out.push(t('wz_r_missing', { list: miss.join(', ') }));
    const sims = c.similar(it);
    if (sims.length) out.push(t('wz_r_similar', { name: esc(sims[0].title) }));
    const title = titleOf(it.kind, it).toLowerCase();
    const chk = ((c.an && c.an.synthesis && c.an.synthesis.checks) || []).find((k) => k.status !== 'Pass' && title.length > 8 && String(k.detail || '').toLowerCase().includes(title.slice(0, 40)));
    if (chk) out.push(t('wz_r_check', { title: esc(chk.title) }));
    if (!out.length) out.push(t('wz_r_other'));
    return out;
  }
  function contextHtml(it, c, p) {
    const approved = c.all.filter((x) => x.kind === it.kind && x.status === 'confirmed');
    const sims = c.similar(it);
    const d = it.data || {};
    const why = `<div class="wz-why"><div class="wz-box-h">${icon('spark')}${t('wz_why_h')}</div><ul>${reasonsFor(it, c).map((r) => `<li>${r}</li>`).join('')}</ul></div>`;
    const how = t('wz_h_' + it.kind) !== 'wz_h_' + it.kind ? `<div class="wz-how"><b>${t('wz_decide_h')}</b> ${t('wz_h_' + it.kind)}</div>` : '';
    const simBox = sims.length ? `<div class="wz-ctx"><div class="wz-box-h">${t('wz_sim_h')}</div>${sims.map((x) => `<div class="wz-mini"><b>${esc(titleOf(x.kind, x))}</b><span class="small muted">${facts(x.kind, x, p).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}</span></div>`).join('')}</div>` : '';
    let proj = '';
    const bits = [];
    if (p.value) bits.push(`<span class="rv-fact"><span>${t('wz_proj_val')}</span><b>${money(p.value, p.currency)}</b></span>`);
    if (p.start_date || p.end_date) bits.push(`<span class="rv-fact"><span>${t('wz_proj_dates')}</span><b>${esc(p.start_date || '?')} to ${esc(p.end_date || '?')}</b></span>`);
    if (it.kind === 'milestone' && p.value) {
      const val = (x) => (x.data.amount != null ? Number(x.data.amount) : x.data.percent != null ? (p.value * Number(x.data.percent)) / 100 : 0);
      const sum = approved.reduce((a, x) => a + val(x), 0);
      const mine = val(it);
      const pc = (n) => Math.round((n / p.value) * 100);
      bits.push(`<div class="small">${t('wz_pay_total', { a: money(Math.round(sum), p.currency), v: money(p.value, p.currency), p: pc(sum) })} ${mine ? t('wz_pay_after', { a: money(Math.round(sum + mine), p.currency), p: pc(sum + mine) }) : ''} ${sum + mine > p.value * 1.001 ? `<b class="neg">${t('wz_pay_over')}</b>` : ''}</div>`);
    }
    if (bits.length) proj = `<div class="wz-ctx"><div class="wz-box-h">${t('wz_proj_h')}</div><div class="rv-facts">${bits.join('')}</div></div>`;
    const by = (x) => (x.decided_by === 'AI' ? t('wz_ctx_by_ai') : x.decided_by === 'user' ? t('wz_ctx_by_you') : '');
    const list = approved.slice(0, 40).map((x) => `<div class="wz-mini"><b>${esc(titleOf(x.kind, x))}</b><span class="small muted">${by(x)}</span></div>`).join('');
    const appr = `<details class="wz-ctx wz-appr"><summary><span class="wz-box-h">${t('wz_ctx_h')}</span> <span class="chip green">${t('wz_approved_n', { n: approved.length })}</span></summary>${approved.length ? `<div class="wz-list">${list}${approved.length > 40 ? `<div class="small muted">+${approved.length - 40}</div>` : ''}</div>` : `<div class="small muted">${t('wz_ctx_none')}</div>`}</details>`;
    return why + how + simBox + proj + appr;
  }

  // ---------- guided review ----------
  async function startWizard(p, onDone, startKind) {
    const w = await api('GET', `/api/projects/${p.id}/wizard`);
    const Q = w.items;
    if (!Q.length) { toast(t('all_reviewed'), 'ok'); return; }
    const ctx = { all: (await api('GET', `/api/projects/${p.id}/items`)).items, an: p.analysis || null };
    const pj = (await api('GET', `/api/projects/${p.id}`)).project; ctx.an = pj.analysis || ctx.an; p = pj;
    ctx.similar = (it) => ctx.all.filter((x) => x.kind === it.kind && x.status === 'confirmed' && x.id !== it.id && sim(titleOf(x.kind, x), titleOf(it.kind, it)) >= 0.7 && it.kind !== 'field').sort((a, b) => sim(titleOf(b.kind, b), titleOf(it.kind, it)) - sim(titleOf(a.kind, a), titleOf(it.kind, it))).slice(0, 3);
    const mark = (ids, st) => ids.forEach((id) => { const x = ctx.all.find((y) => y.id === id); if (x) { x.status = st; x.decided_by = 'user'; } });
    const done = new Set();
    const tally = { confirmed: 0, ignored: 0, skipped: 0 };
    let idx = startKind ? Math.max(0, Q.findIndex((x) => x.kind === startKind)) : 0;
    let editing = false;
    const history = [];
    const m = modal({ title: t('wizard_title'), size: 'xl', noBackdropClose: true, body: '<div class="wz2" id="wz"></div>', footer: '' });
    const order = KINDS.filter((k) => Q.some((i) => i.kind === k));
    const rtl = S.lang === 'ar';

    const onKey = (e) => {
      if (!document.body.contains(m.el)) { document.removeEventListener('keydown', onKey); return; }
      const tag = ((e.target && e.target.tagName) || '').toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag);
      const click = (id) => { const b = $('#' + id, m.el); if (b && !b.disabled) { e.preventDefault(); b.click(); } };
      if (e.key === 'Enter' && !typing && !e.shiftKey && !e.target.closest('button,a,summary')) click('wzOk');
      else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') click('wzSkip'); else if (k === 'x') click('wzIgnore'); else if (k === 'e') click('wzEdit');
        else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) click('wzBack');
      }
    };
    document.addEventListener('keydown', onKey);

    const hiLeft = (kind) => Q.filter((x) => x.kind === kind && !done.has(x.id) && (x.confidence || 0) >= 0.8);
    const show = () => {
      while (idx < Q.length && done.has(Q[idx].id)) idx++;
      if (idx >= Q.length) { const nx = Q.findIndex((x) => !done.has(x.id)); if (nx < 0) return finish(); idx = nx; }
      const it = Q[idx];
      const group = it.kind === 'field' && it.data.conflict ? Q.filter((x) => x.kind === 'field' && x.data.field === it.data.field && !done.has(x.id)) : null;
      const isGroup = !!(group && group.length > 1);
      const remaining = Q.filter((x) => !done.has(x.id)).length;
      const pct = Math.round(((Q.length - remaining) / Q.length) * 100);
      const rail = order.map((k) => { const left = Q.filter((x) => x.kind === k && !done.has(x.id)).length; return `<button type="button" class="wz-sec ${k === it.kind ? 'cur' : ''} ${left === 0 ? 'done' : ''}" data-sec="${k}"><span>${t('kind_' + k)}</span><b>${left ? left : icon('check')}</b></button>`; }).join('');
      let main;
      if (isGroup) {
        main = `<div class="small muted" style="margin-bottom:6px">${t('conflict_help')}</div><h3 class="wz-title">${t('fld_' + it.data.field)}</h3><div class="col" id="opts">${group.map((g, i) => `<label class="option ${i === 0 ? 'sel' : ''}" data-opt="${g.id}"><input type="radio" name="opt" ${i === 0 ? 'checked' : ''} style="margin-top:3px"><div class="grow"><div class="wz-opt-v">${g.data.field === 'value' ? money(g.data.value, p.currency) : esc(g.data.value)}</div><div class="small muted">${esc(g.doc_name || '')} ${confWord(g.confidence)}</div>${g.quote ? `<div class="quote">${esc(g.quote)}</div>` : ''}</div></label>`).join('')}</div>`;
      } else {
        const bulk = hiLeft(it.kind);
        main = `<div class="row" style="margin-bottom:10px"><span class="chip blue">${t('kind_' + it.kind)}</span>${confWord(it.confidence)}<span class="grow"></span><span class="small muted">${icon('file')} ${esc(it.doc_name || '')}${it.data.also_in && it.data.also_in.length ? ` +${esc(it.data.also_in.join(', '))}` : ''}</span></div>
          <div class="small muted">${t('wz_found')}</div><h3 class="wz-title">${esc(titleOf(it.kind, it))}</h3>${it.kind === 'deliverable' && it.description ? `<p class="muted wz-desc">${esc(it.description.slice(0, 280))}</p>` : ''}
          <div class="rv-facts big">${facts(it.kind, it, p)}</div>
          ${editing ? `<div class="wz-edit">${formFields(it.kind, it)}</div>` : ''}
          ${it.quote ? `<div class="wz-ev"><div class="small muted">${icon('file')} ${t('wz_evidence')}</div><div class="quote">${esc(it.quote)}</div></div>` : ''}
          ${contextHtml(it, ctx, p)}
          ${bulk.length >= 2 ? `<button type="button" class="btn sm ghost" id="wzBulk">${icon('check')}${t('wz_hi_bulk', { n: bulk.length })}</button>` : ''}`;
      }
      $('#wz', m.el).innerHTML = `<aside class="wz-rail"><div class="small muted wz-rail-h">${t('wz_sections')}</div>${rail}<div class="small muted wz-saved">${t('wz_saved')}</div></aside>
        <section class="wz-main"><div class="wz-top"><b>${t('wz_item', { a: Q.length - remaining + 1, b: Q.length })}</b><div class="progress"><i style="width:${pct}%"></i></div><span class="small muted">${pct}%</span></div><div class="wz-card">${main}</div><div class="small muted wz-tips">${t('wz_tips')}</div></section>`;
      m.setFooter(`<button class="btn ghost" id="wzLater">${t('finish_later')}</button><span class="grow"></span><button class="btn" id="wzBack" ${history.length ? '' : 'disabled'}>${icon('back', 'flip')}${t('back')}</button><button class="btn" id="wzSkip">${icon('skip', 'flip')}${t('skip')}</button>${isGroup ? '' : `<button class="btn" id="wzEdit">${icon('edit')}${editing ? t('wz_edit_done') : t('wz_edit')}</button>`}<button class="btn" id="wzIgnore">${icon('x')}${t('ignore')}</button><button class="btn good" id="wzOk">${icon('check')}${t('wz_next')}</button>`);
      const okb = $('#wzOk', m.el); if (okb) okb.focus({ preventScroll: true });
      if (isGroup) $$('[data-opt]', m.el).forEach((o) => (o.onclick = () => { $$('[data-opt]', m.el).forEach((x) => x.classList.remove('sel')); o.classList.add('sel'); $('input', o).checked = true; }));
      $$('[data-sec]', m.el).forEach((b) => (b.onclick = () => { const nx = Q.findIndex((x) => x.kind === b.dataset.sec && !done.has(x.id)); if (nx >= 0) { idx = nx; editing = false; show(); } }));
      $('#wzLater', m.el).onclick = () => { document.removeEventListener('keydown', onKey); m.close(); onDone && onDone(); };
      $('#wzBack', m.el).onclick = () => { const h = history.pop(); if (h) { h.ids.forEach((id) => done.delete(id)); tally[h.kind] = Math.max(0, tally[h.kind] - 1); idx = Q.findIndex((x) => x.id === h.ids[0]); editing = false; show(); } };
      $('#wzSkip', m.el).onclick = () => { tally.skipped++; const ids = isGroup ? group.map((g) => g.id) : [it.id]; ids.forEach((id) => done.add(id)); history.push({ ids, kind: 'skipped' }); editing = false; show(); };
      const ed = $('#wzEdit', m.el); if (ed) ed.onclick = () => { editing = !editing; show(); };
      $('#wzIgnore', m.el).onclick = async () => {
        const ids = isGroup ? [Number(($('[data-opt].sel', m.el) || {}).dataset.opt)] : [it.id];
        await busy($('#wzIgnore', m.el), async () => { for (const id of ids) await api('POST', `/api/items/${id}/ignore`); });
        const all = isGroup ? group.map((g) => g.id) : ids;
        mark(all, 'ignored'); all.forEach((id) => done.add(id)); tally.ignored++; history.push({ ids: all, kind: 'ignored' }); editing = false;
        show();
      };
      const bb = $('#wzBulk', m.el);
      if (bb) bb.onclick = async () => {
        const ids = hiLeft(it.kind).map((x) => x.id);
        await busy(bb, () => api('POST', `/api/projects/${p.id}/items/bulk`, { ids, action: 'confirm' }));
        mark(ids, 'confirmed'); ids.forEach((id) => done.add(id)); tally.confirmed += ids.length; history.push({ ids, kind: 'confirmed' }); editing = false;
        show();
      };
      $('#wzOk', m.el).onclick = async () => {
        let chosen = it;
        if (isGroup) chosen = Q.find((x) => x.id === Number(($('[data-opt].sel', m.el) || {}).dataset.opt));
        const ok = await busy($('#wzOk', m.el), async () => {
          if (!isGroup && editing) { const v = readForm(m.el, it.kind, it); await api('PUT', `/api/items/${it.id}`, v); }
          await api('POST', `/api/items/${chosen.id}/confirm`);
          return true;
        });
        if (!ok) return;
        const ids = isGroup ? group.map((g) => g.id) : [it.id];
        mark([chosen.id], 'confirmed'); ids.forEach((id) => done.add(id)); tally.confirmed++; history.push({ ids, kind: 'confirmed' }); editing = false;
        show();
      };
    };
    async function finish() {
      document.removeEventListener('keydown', onKey);
      await api('POST', `/api/projects/${p.id}/wizard/finish`).catch(() => {});
      const sched = Q.some((x) => x.kind === 'schedule');
      const tl = (n, l, c) => `<div class="rv-stat ${c}"><b>${n}</b><span>${l}</span></div>`;
      $('#wz', m.el).innerHTML = `<div class="wz-finish"><div class="big">🎉</div><h2>${t('review_complete')}</h2><p class="muted">${t('wz_finish_p')}</p><div class="rv-stats center">${tl(tally.confirmed, t('wz_stat_c'), 'ok')}${tl(tally.ignored, t('wz_stat_i'), '')}${tl(tally.skipped, t('wz_stat_s'), tally.skipped ? 'warn' : '')}</div></div>`;
      m.setFooter(`<button class="btn" id="wzClose">${t('close')}</button>${sched ? `<a class="btn primary" href="#/p/${p.id}/schedule" id="wzSched">${icon('cal')}${t('open_schedule')}</a>` : ''}`);
      $('#wzClose', m.el).onclick = () => { m.close(); onDone && onDone(); };
      const a = $('#wzSched', m.el); if (a) a.onclick = () => m.close();
    }
    show();
  }
  window.PM.startWizard = startWizard;
})();
