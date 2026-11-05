/* Project Chat.
   A button at the bottom corner of every screen opens a side panel. The chat is about the project on screen, or about
   all projects. It answers from the person's own data with sources, and it proposes changes as a card that waits for
   Apply. All rules live on the server: this file only sends a message and shows what comes back. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;

  Object.assign(PM.I18N.en, {
    cht_title: 'Project chat', cht_all: 'All projects', cht_open: 'Open the project chat', cht_close: 'Close', cht_new: 'Start a new chat',
    cht_ph: 'Ask about your projects', cht_send: 'Send', cht_stop: 'Stop', cht_thinking: 'Thinking', cht_tool: 'Checking your data',
    cht_sources: 'Sources', cht_apply: 'Apply', cht_cancel: 'Cancel', cht_edit: 'Edit', cht_undo: 'Undo', cht_back: 'Back', cht_yes: 'Yes, apply',
    cht_s_pending: 'Waiting for you', cht_s_applied: 'Applied', cht_s_canceled: 'Canceled', cht_s_expired: 'Expired', cht_s_undone: 'Undone', cht_s_failed: 'Not saved', cht_s_applied_final: 'Applied', cht_s_applying: 'Applying', cht_s_undoing: 'Undoing',
    cht_strong: 'Please confirm. This removes records from the project. You can undo it for 7 days.', cht_many: 'This card changes more than 5 records. Please confirm.',
    cht_copy: 'Copy', cht_copied: 'Copied', cht_good: 'Helpful', cht_bad: 'Not helpful', cht_stopped: 'Stopped', cht_failed: 'The chat could not answer. Try again.',
    cht_view_only: 'You have view only access here. I can answer questions but I cannot change anything.', cht_left: '{n} messages left today',
    cht_applied_toast: 'Changes applied', cht_undone_toast: 'Changes undone', cht_edit_prefix: 'Change the proposal: ',
    cht_f_type: 'Type', cht_f_title: 'Title', cht_f_description: 'Description', cht_f_owner: 'Owner', cht_f_due_date: 'Due date', cht_f_probability: 'Probability', cht_f_impact: 'Impact', cht_f_mitigation: 'Mitigation', cht_f_amount: 'Amount', cht_f_percent: 'Percent', cht_f_status: 'Status', cht_f_name: 'Name', cht_f_start: 'Start', cht_f_duration: 'Duration', cht_f_notes: 'Notes', cht_f_task: 'Task', cht_f_deliverable: 'Deliverable', cht_f_requirement: 'Requirement', cht_f_risk: 'Risk', cht_f_payment: 'Payment',
    cht_empty_title: 'Ask me about your projects', cht_none: 'none', cht_days: '{n} days',
    cht_sum_add: 'Add {kind} "{title}"', cht_sum_upd: 'Update {kind} "{title}"', cht_sum_del: 'Delete {kind} "{title}"', cht_sum_pay: 'Mark payment "{title}" as {state}', cht_sum_addtask: 'Add task "{title}"', cht_sum_updtask: 'Update task "{title}"', cht_sum_deltask: 'Delete task "{title}"',
    cht_sum_sched: 'Change the schedule of task "{title}"', cht_sum_applyupd: 'Apply update "{title}"', cht_sum_dismiss: 'Dismiss update "{title}"', cht_sum_addupd: 'Add a message to the Updates inbox',
    cht_f_progress: 'Progress', cht_f_update: 'Update', cht_f_message: 'Message', cht_impact_h: 'Impact on the schedule', cht_impact_none: 'No other task moves.', cht_impact_n: '{n} other tasks move.', cht_impact_n1: '1 other task moves.', cht_impact_end: 'Project end: {a} to {b}.', cht_impact_same: 'Project end stays {b}.',
    cht_note_kids: '{n} child tasks move up one level.', cht_note_kids1: '1 child task moves up one level.', cht_note_succ: '{n} tasks lose this predecessor.', cht_note_succ1: '1 task loses this predecessor.',
    cht_v_open: 'Open', cht_v_progress: 'In progress', cht_v_closed: 'Closed', cht_v_mitigated: 'Mitigated', cht_v_transferred: 'Transferred', cht_v_pending: 'Pending', cht_v_invoiced: 'Invoiced', cht_v_paid: 'Paid', cht_v_low: 'Low', cht_v_medium: 'Medium', cht_v_high: 'High',
  });
  Object.assign(PM.I18N.ar, {
    cht_title: 'محادثة المشروع', cht_all: 'كل المشاريع', cht_open: 'افتح محادثة المشروع', cht_close: 'إغلاق', cht_new: 'ابدأ محادثة جديدة',
    cht_ph: 'اسأل عن مشاريعك', cht_send: 'إرسال', cht_stop: 'إيقاف', cht_thinking: 'جار التفكير', cht_tool: 'جار فحص بياناتك',
    cht_sources: 'المصادر', cht_apply: 'تطبيق', cht_cancel: 'إلغاء', cht_edit: 'تعديل', cht_undo: 'تراجع', cht_back: 'رجوع', cht_yes: 'نعم، طبّق',
    cht_s_pending: 'بانتظارك', cht_s_applied: 'تم التطبيق', cht_s_canceled: 'تم الإلغاء', cht_s_expired: 'انتهت الصلاحية', cht_s_undone: 'تم التراجع', cht_s_failed: 'لم يُحفظ', cht_s_applied_final: 'تم التطبيق', cht_s_applying: 'جار التطبيق', cht_s_undoing: 'جار التراجع',
    cht_strong: 'يرجى التأكيد. هذا يحذف سجلات من المشروع. يمكنك التراجع خلال 7 أيام.', cht_many: 'تغير هذه البطاقة أكثر من 5 سجلات. يرجى التأكيد.',
    cht_copy: 'نسخ', cht_copied: 'تم النسخ', cht_good: 'مفيد', cht_bad: 'غير مفيد', cht_stopped: 'تم الإيقاف', cht_failed: 'تعذر على المحادثة الرد. حاول مرة أخرى.',
    cht_view_only: 'لديك صلاحية العرض فقط هنا. أستطيع الإجابة عن الأسئلة لكن لا أستطيع تغيير أي شيء.', cht_left: 'تبقّت {n} رسالة اليوم',
    cht_applied_toast: 'تم تطبيق التغييرات', cht_undone_toast: 'تم التراجع عن التغييرات', cht_edit_prefix: 'عدّل الاقتراح: ',
    cht_f_type: 'النوع', cht_f_title: 'العنوان', cht_f_description: 'الوصف', cht_f_owner: 'المسؤول', cht_f_due_date: 'تاريخ الاستحقاق', cht_f_probability: 'الاحتمال', cht_f_impact: 'الأثر', cht_f_mitigation: 'المعالجة', cht_f_amount: 'المبلغ', cht_f_percent: 'النسبة', cht_f_status: 'الحالة', cht_f_name: 'الاسم', cht_f_start: 'البداية', cht_f_duration: 'المدة', cht_f_notes: 'ملاحظات', cht_f_task: 'المهمة', cht_f_deliverable: 'مخرج', cht_f_requirement: 'متطلب', cht_f_risk: 'خطر', cht_f_payment: 'دفعة',
    cht_empty_title: 'اسألني عن مشاريعك', cht_none: 'لا شيء', cht_days: '{n} أيام',
    cht_sum_add: 'إضافة {kind} "{title}"', cht_sum_upd: 'تحديث {kind} "{title}"', cht_sum_del: 'حذف {kind} "{title}"', cht_sum_pay: 'تحديد الدفعة "{title}" على أنها {state}', cht_sum_addtask: 'إضافة المهمة "{title}"', cht_sum_updtask: 'تحديث المهمة "{title}"', cht_sum_deltask: 'حذف المهمة "{title}"',
    cht_sum_sched: 'تغيير جدول المهمة "{title}"', cht_sum_applyupd: 'تطبيق التحديث "{title}"', cht_sum_dismiss: 'تجاهل التحديث "{title}"', cht_sum_addupd: 'إضافة رسالة إلى صندوق التحديثات',
    cht_f_progress: 'التقدم', cht_f_update: 'التحديث', cht_f_message: 'الرسالة', cht_impact_h: 'الأثر على الجدول', cht_impact_none: 'لا تتحرك مهام أخرى.', cht_impact_n: 'تتحرك {n} مهام أخرى.', cht_impact_n1: 'تتحرك مهمة أخرى واحدة.', cht_impact_end: 'نهاية المشروع: من {a} إلى {b}.', cht_impact_same: 'تبقى نهاية المشروع {b}.',
    cht_note_kids: 'تنتقل {n} مهام فرعية مستوى واحدا للأعلى.', cht_note_kids1: 'تنتقل مهمة فرعية واحدة مستوى واحدا للأعلى.', cht_note_succ: 'تفقد {n} مهام هذا السابق.', cht_note_succ1: 'تفقد مهمة واحدة هذا السابق.',
    cht_v_open: 'مفتوح', cht_v_progress: 'قيد التنفيذ', cht_v_closed: 'مغلق', cht_v_mitigated: 'تمت المعالجة', cht_v_transferred: 'تم النقل', cht_v_pending: 'قيد الانتظار', cht_v_invoiced: 'تمت الفوترة', cht_v_paid: 'مدفوعة', cht_v_low: 'منخفض', cht_v_medium: 'متوسط', cht_v_high: 'مرتفع',
  });

  const S = { open: false, busy: false, ctl: null, ctx: { projectId: null, screen: 'portfolio' }, data: null, msgs: [], confirming: null, raf: 0 };
  let root = null;
  const $q = (sel) => (root ? root.querySelector(sel) : null);
  const ctxFromHash = () => {
    const m = String(location.hash || '').match(/^#\/p\/(\d+)(?:\/([a-z]+))?/);
    return m ? { projectId: Number(m[1]), screen: m[2] || 'overview' } : { projectId: null, screen: 'portfolio' };
  };
  const safeHref = (h) => (/^#\//.test(String(h || '')) ? h : '#/');
  const keep = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; };
  const fieldLabel = (f) => { const k = 'cht_f_' + f; return PM.I18N[PM.state.lang] && PM.I18N[PM.state.lang][k] ? t(k) : f.replace(/_/g, ' '); };
  const has = (k) => !!(PM.I18N[PM.state.lang] && PM.I18N[PM.state.lang][k]);
  const valText = (v, field) => {
    if (v == null || v === '') return t('cht_none');
    if (field === 'duration') return t('cht_days', { n: v });
    if (field === 'progress') return v + '%';
    if (field === 'type' && has('cht_f_' + v)) return t('cht_f_' + v);
    const k = 'cht_v_' + String(v).toLowerCase();
    return has(k) && (field === 'status' || field === 'probability' || field === 'impact') ? t(k) : String(v);
  };
  const sumText = (it) => {
    const x = it.sum; if (!x) return it.summary;
    const kind = x.kind && has('cht_f_' + x.kind) ? t('cht_f_' + x.kind).toLowerCase() : (x.kind || '');
    const map = { change_schedule: 'cht_sum_sched', apply_update: 'cht_sum_applyupd', dismiss_update: 'cht_sum_dismiss', add_update: 'cht_sum_addupd', create_item: 'cht_sum_add', update_item: 'cht_sum_upd', delete_item: 'cht_sum_del', set_payment: 'cht_sum_pay', create_task: 'cht_sum_addtask', update_task: 'cht_sum_updtask', delete_task: 'cht_sum_deltask' };
    return t(map[x.op] || 'cht_sum_upd', { kind, title: '\u2068' + x.title + '\u2069', state: x.state && has('cht_v_' + x.state) ? t('cht_v_' + x.state).toLowerCase() : x.state });
  };
  const impactHtml = (it) => {
    const m = it.impact; if (!m) return '';
    const ex = (m.examples || []).map((e) => `<div class="small muted cht-ex"><span class="cht-exn">${esc(e.name)}</span> <span>${esc(e.from || '')}</span>${icon('down', 'flip cht-arrow')}<b>${esc(e.to || '')}</b></div>`).join('');
    const line = (m.moved ? t(m.moved === 1 ? 'cht_impact_n1' : 'cht_impact_n', { n: m.moved }) : t('cht_impact_none')) + ' ' + (m.endBefore && m.endAfter && m.endBefore !== m.endAfter ? t('cht_impact_end', { a: m.endBefore, b: m.endAfter }) : t('cht_impact_same', { b: m.endAfter || m.endBefore || '' }));
    return `<div class="cht-impact small"><b>${esc(t('cht_impact_h'))}</b><div>${esc(line)}</div>${ex}</div>`;
  };
  const noteText = (it) => { const n = it.noteData; if (!n) return it.note || ''; return [n.kids ? t(n.kids === 1 ? 'cht_note_kids1' : 'cht_note_kids', { n: n.kids }) : '', n.succ ? t(n.succ === 1 ? 'cht_note_succ1' : 'cht_note_succ', { n: n.succ }) : ''].filter(Boolean).join(' '); };

  // ---------- building the shell once ----------
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'chtRoot';
    root.innerHTML = `
      <button class="cht-fab" id="chtFab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(t('cht_open'))}" data-tip="${esc(t('cht_open'))}">${icon('chat')}</button>
      <section class="cht-panel" id="chtPanel" role="dialog" aria-modal="false" aria-labelledby="chtHead" hidden>
        <header class="cht-head">
          <div class="grow"><h2 id="chtHead">${esc(t('cht_title'))}</h2><div class="small muted cht-ctx" id="chtCtx"></div></div>
          <button class="btn ghost icon" type="button" data-act="new" aria-label="${esc(t('cht_new'))}" data-tip="${esc(t('cht_new'))}">${icon('plus')}</button>
          <button class="btn ghost icon" type="button" data-act="close" aria-label="${esc(t('cht_close'))}" data-tip="${esc(t('cht_close'))}">${icon('x')}</button>
        </header>
        <div class="cht-body" id="chtBody" role="log" aria-live="polite" tabindex="0"></div>
        <footer class="cht-foot">
          <div class="small muted cht-note" id="chtNote"></div>
          <div class="cht-composer">
            <textarea id="chtIn" rows="1" maxlength="4000" placeholder="${esc(t('cht_ph'))}" aria-label="${esc(t('cht_ph'))}"></textarea>
            <button class="btn primary icon" id="chtSend" type="button" data-act="send" aria-label="${esc(t('cht_send'))}" data-tip="${esc(t('cht_send'))}">${icon('up')}</button>
          </div>
        </footer>
      </section>`;
    document.body.appendChild(root);
    document.body.classList.add('chat-on');
    root.addEventListener('click', onClick);
    const inp = $q('#chtIn');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    inp.addEventListener('input', grow);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) { e.stopPropagation(); close(); } });
  }
  function grow() { const i = $q('#chtIn'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 120) + 'px'; }

  // ---------- open, close, load ----------
  async function open() {
    build();
    S.open = true; keep('pm_chat_open', '1');
    $q('#chtPanel').hidden = false; $q('#chtFab').setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-open');
    requestAnimationFrame(() => $q('#chtPanel').classList.add('on'));
    await load();
    const i = $q('#chtIn'); if (i) i.focus();
  }
  function close() {
    if (!root) return;
    S.open = false; keep('pm_chat_open', '0');
    const p = $q('#chtPanel'); p.classList.remove('on');
    document.body.classList.remove('chat-open');
    $q('#chtFab').setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!S.open) p.hidden = true; }, 260);
    $q('#chtFab').focus();
  }
  async function load() {
    S.ctx = ctxFromHash();
    try {
      const q = new URLSearchParams({ screen: S.ctx.screen }); if (S.ctx.projectId) q.set('project_id', S.ctx.projectId);
      const d = await PM.api('GET', '/api/chat?' + q);
      S.data = d; S.msgs = d.messages.slice();
    } catch (e) { S.data = { suggestions: [], capabilities: '', ai: true, can_write: true, project: null }; S.msgs = []; S.loadError = e.message; }
    paint(true);
  }

  // ---------- painting ----------
  function ctxName() {
    if (!S.ctx.projectId) return t('cht_all');
    const p = (S.data && S.data.project) || (PM.state.projects || []).find((x) => x.id === S.ctx.projectId);
    return p ? p.name : t('cht_all');
  }
  function msgHtml(m) {
    if (m.role === 'user') return `<div class="cht-msg user"><div class="cht-bub">${esc(m.text)}</div></div>`;
    const body = m.pending && !m.text ? `<span class="cht-typing" aria-label="${esc(m.status || t('cht_thinking'))}"><i></i><i></i><i></i></span><span class="small muted">${esc(m.status || t('cht_thinking'))}</span>` : `<div class="md">${PM.mdToHtml(m.text || '')}</div>`;
    const err = m.error ? `<div class="cht-err small" role="alert">${esc(m.error)}</div>` : '';
    const stop = m.stopped ? `<div class="small muted">${esc(t('cht_stopped'))}</div>` : '';
    const status = m.pending && m.text && m.status ? `<div class="small muted">${esc(m.status)}</div>` : '';
    const src = (m.sources || []).length ? `<div class="cht-srcs"><span class="small muted">${esc(t('cht_sources'))}</span>${m.sources.map((s) => `<a class="cht-src" href="${esc(safeHref(s.href))}" data-act="nav">${icon('link')}<span>${esc(s.label)}</span></a>`).join('')}</div>` : '';
    const links = (m.links || []).length ? `<div class="cht-srcs">${m.links.map((s) => `<a class="btn sm" href="${esc(safeHref(s.href))}" data-act="nav">${esc(s.label)}</a>`).join('')}</div>` : '';
    const card = m.card ? cardHtml(m) : '';
    const acts = !m.pending && m.id && !String(m.id).startsWith('b') && m.text ? `<div class="cht-acts"><button class="btn ghost icon sm" type="button" data-act="copy" data-id="${esc(m.id)}" aria-label="${esc(t('cht_copy'))}" data-tip="${esc(t('cht_copy'))}">${icon('copy')}</button><button class="btn ghost icon sm ${m.feedback === 1 ? 'on' : ''}" type="button" data-act="up" data-id="${esc(m.id)}" aria-pressed="${m.feedback === 1}" aria-label="${esc(t('cht_good'))}" data-tip="${esc(t('cht_good'))}">${icon('check')}</button><button class="btn ghost icon sm ${m.feedback === -1 ? 'on' : ''}" type="button" data-act="down" data-id="${esc(m.id)}" aria-pressed="${m.feedback === -1}" aria-label="${esc(t('cht_bad'))}" data-tip="${esc(t('cht_bad'))}">${icon('flag')}</button></div>` : '';
    return `<div class="cht-msg bot" data-mid="${esc(m.id)}"><div class="cht-bub">${body}${status}${err}${stop}${src}${links}</div>${card}${acts}</div>`;
  }
  function cardHtml(m) {
    const c = m.card; const id = esc(m.id);
    const live = c.status === 'pending';
    const confirming = S.confirming === m.id && live;
    const items = c.items.map((it) => `<li class="cht-item ${it.destructive ? 'bad' : ''}"><div class="cht-it-h">${esc(sumText(it))}</div>${it.project && (c.projects || []).length > 1 ? `<div class="small muted">${esc(it.project)}</div>` : ''}${(it.changes || []).map((ch) => `<div class="cht-chg small"><span class="muted">${esc(fieldLabel(ch.field))}</span> ${ch.before != null ? `<span class="cht-old">${esc(valText(ch.before, ch.field))}</span><span class="muted">${icon('down', 'flip cht-arrow')}</span>` : ''}${ch.after != null ? `<b class="cht-new">${esc(valText(ch.after, ch.field))}</b>` : `<b class="cht-new">${esc(t('cht_none'))}</b>`}</div>`).join('')}${impactHtml(it)}${noteText(it) ? `<div class="small muted">${esc(noteText(it))}</div>` : ''}</li>`).join('');
    const state = live ? '' : `<span class="chip ${c.status === 'applied' || c.status === 'applied_final' ? 'green' : c.status === 'failed' ? 'red' : c.status === 'undone' ? 'blue' : ''}">${esc(t('cht_s_' + c.status))}</span>`;
    const msg = c.message ? `<div class="small ${c.status === 'failed' ? 'cht-err' : 'muted'}" role="${c.status === 'failed' ? 'alert' : 'status'}">${esc(c.message)}</div>` : '';
    let foot = '';
    if (live && !confirming) foot = `<div class="cht-card-foot"><button class="btn primary sm" type="button" data-act="apply" data-id="${id}">${esc(t('cht_apply'))}</button><button class="btn sm" type="button" data-act="edit" data-id="${id}">${esc(t('cht_edit'))}</button><button class="btn ghost sm" type="button" data-act="cancel" data-id="${id}">${esc(t('cht_cancel'))}</button></div>`;
    else if (confirming) foot = `<div class="cht-warn small" role="alert">${esc(c.items.some((x) => x.destructive) ? t('cht_strong') : t('cht_many'))}</div><div class="cht-card-foot"><button class="btn danger sm" type="button" data-act="confirm" data-id="${id}">${esc(t('cht_yes'))}</button><button class="btn ghost sm" type="button" data-act="back" data-id="${id}">${esc(t('cht_back'))}</button></div>`;
    else if (c.status === 'applied') foot = `<div class="cht-card-foot"><button class="btn sm" type="button" data-act="undo" data-id="${id}">${icon('undo')}${esc(t('cht_undo'))}</button></div>`;
    return `<div class="cht-card ${live ? 'live' : ''}" data-card="${id}"><div class="cht-card-h"><span class="small muted">${icon('spark')}${esc((c.projects || []).map((p) => p.name).join(', '))}</span>${state}</div><ul class="cht-items">${items}</ul>${msg}${foot}</div>`;
  }
  function emptyHtml() {
    const d = S.data || {};
    const sug = (d.suggestions || []).map((s) => `<button class="btn sm cht-sug" type="button" data-act="sug" data-q="${esc(s)}">${esc(s)}</button>`).join('');
    return `<div class="cht-empty"><div class="cht-empty-ic">${icon('spark')}</div><h3>${esc(t('cht_empty_title'))}</h3><p class="muted">${esc(d.capabilities || '')}</p>${S.loadError ? `<p class="cht-err small" role="alert">${esc(S.loadError)}</p>` : ''}<div class="cht-sugs">${sug}</div></div>`;
  }
  function paint(toEnd) {
    if (!root) return;
    $q('#chtCtx').textContent = ctxName();
    const body = $q('#chtBody');
    const near = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    body.innerHTML = S.msgs.length ? S.msgs.map(msgHtml).join('') : emptyHtml();
    if (toEnd || near) body.scrollTop = body.scrollHeight;
    const d = S.data || {};
    const note = d.can_write === false ? t('cht_view_only') : (d.remaining_today != null && d.remaining_today <= 20 ? t('cht_left', { n: d.remaining_today }) : '');
    $q('#chtNote').textContent = note; $q('#chtNote').hidden = !note;
    const send = $q('#chtSend');
    send.innerHTML = icon(S.busy ? 'x' : 'up'); send.dataset.act = S.busy ? 'stop' : 'send';
    const lab = S.busy ? t('cht_stop') : t('cht_send'); send.setAttribute('aria-label', lab); send.dataset.tip = lab;
  }
  const soon = () => { if (S.raf) return; S.raf = requestAnimationFrame(() => { S.raf = 0; paint(); }); };

  // ---------- sending ----------
  function submit() {
    const i = $q('#chtIn'); const text = i.value.trim();
    if (!text || S.busy) return;
    i.value = ''; grow(); send(text);
  }
  async function send(text) {
    if (S.busy) return;
    S.busy = true;
    const user = { id: 'u' + Date.now(), role: 'user', text };
    const bot = { id: 'b' + Date.now(), role: 'assistant', text: '', pending: true, status: t('cht_thinking'), sources: [], links: [] };
    S.msgs.push(user, bot); paint(true);
    const ctl = new AbortController(); S.ctl = ctl;
    try {
      const r = await fetch('/api/chat/message', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + PM.state.token }, body: JSON.stringify({ project_id: S.ctx.projectId, text, screen: S.ctx.screen }), signal: ctl.signal });
      if (!r.ok || !r.body) { let msg = t('cht_failed'); try { const j = await r.json(); msg = j.error || msg; } catch (e) { /* not json */ } if (r.status === 401) msg = t('err_session'); throw new Error(msg); }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { let ev; try { ev = JSON.parse(line); } catch (e) { continue; } onEvent(user, bot, ev); } }
      }
    } catch (e) {
      if (e.name === 'AbortError') bot.stopped = true; else bot.error = e.message || t('cht_failed');
    } finally {
      bot.pending = false; bot.status = ''; S.busy = false; S.ctl = null;
      if (!bot.text && !bot.error && !bot.stopped && !bot.card) bot.error = t('cht_failed');
      paint(true);
      if (S.data && S.data.remaining_today != null) S.data.remaining_today = Math.max(0, S.data.remaining_today - 1);
    }
  }
  function onEvent(user, bot, ev) {
    if (ev.type === 'user') user.id = ev.id;
    else if (ev.type === 'text') { bot.text += ev.text; bot.status = ''; soon(); }
    else if (ev.type === 'replace') { bot.text = ev.text; soon(); }
    else if (ev.type === 'tool') { bot.status = t('cht_tool'); soon(); }
    else if (ev.type === 'done') { Object.assign(bot, ev.message, { pending: false, status: '' }); soon(); }
    else if (ev.type === 'error') { bot.error = ev.message; bot.text = bot.text || ''; soon(); }
  }

  // ---------- actions ----------
  const find = (id) => S.msgs.find((m) => String(m.id) === String(id));
  async function cardCall(id, what, body) {
    const m = find(id); if (!m || !m.card || m.card.busy) return;
    m.card.busy = true;
    try {
      const r = await PM.api('POST', `/api/chat/messages/${id}/${what}`, body || {});
      m.card = r.card; S.confirming = null;
      if (what === 'apply' && !r.already) { PM.toast(t('cht_applied_toast'), 'ok'); refreshScreen(); }
      if (what === 'undo' && !r.already) { PM.toast(t('cht_undone_toast'), 'ok'); refreshScreen(); }
    } catch (e) {
      m.card.busy = false;
      // the server says what happened. A refused card shows its reason on the card itself.
      if (what === 'apply') { try { const v = await PM.api('GET', '/api/chat?' + new URLSearchParams({ ...(S.ctx.projectId ? { project_id: S.ctx.projectId } : {}), screen: S.ctx.screen })); const fresh = v.messages.find((x) => String(x.id) === String(id)); if (fresh) { m.card = fresh.card; } } catch (x) { /* keep the card as is */ } }
      PM.toast(e.message, 'err');
      S.confirming = null;
    }
    if (m.card) m.card.busy = false;
    paint();
  }
  function refreshScreen() { try { if (PM.route) PM.route(); } catch (e) { /* the screen reloads on the next visit */ } }
  function onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
    const act = el.dataset.act; const id = el.dataset.id;
    if (act === 'nav') { if (window.matchMedia('(max-width: 600px)').matches) close(); return; }
    if (act === 'close') return close();
    if (act === 'send') return submit();
    if (act === 'stop') { if (S.ctl) S.ctl.abort(); return; }
    if (act === 'sug') { return send(el.dataset.q); }
    if (act === 'new') { if (S.busy) return; PM.api('POST', '/api/chat/clear', { project_id: S.ctx.projectId }).then(load).catch((x) => PM.toast(x.message, 'err')); return; }
    if (act === 'copy') { const m = find(id); if (m && navigator.clipboard) navigator.clipboard.writeText(m.text).then(() => PM.toast(t('cht_copied'), 'ok')).catch(() => {}); return; }
    if (act === 'up' || act === 'down') {
      const m = find(id); if (!m) return; const want = act === 'up' ? 1 : -1; const v = m.feedback === want ? 0 : want;
      m.feedback = v; paint(); PM.api('POST', `/api/chat/messages/${id}/feedback`, { value: v }).catch(() => {}); return;
    }
    if (act === 'apply') { const m = find(id); if (m && m.card && (m.card.strong)) { S.confirming = m.id; paint(); const b = root.querySelector('[data-act="confirm"]'); if (b) b.focus(); return; } return cardCall(id, 'apply'); }
    if (act === 'confirm') return cardCall(id, 'apply', { confirmed: true });
    if (act === 'back') { S.confirming = null; return paint(); }
    if (act === 'cancel') return cardCall(id, 'cancel');
    if (act === 'undo') return cardCall(id, 'undo');
    if (act === 'edit') { const i = $q('#chtIn'); i.value = t('cht_edit_prefix'); grow(); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  // ---------- start ----------
  function onHash() {
    const c = ctxFromHash();
    if (!root) return;
    if (c.projectId !== S.ctx.projectId) { if (S.busy && S.ctl) S.ctl.abort(); if (S.open) load(); else S.ctx = c; }
    else S.ctx = c;
  }
  // a language change rebuilds the shell so every label follows
  function rebuild() {
    if (!root) return;
    const was = S.open; root.remove(); root = null; document.body.classList.remove('chat-open');
    build(); bindFab();
    if (was) { S.open = false; open(); } else paint();
  }
  function bindFab() { $q('#chtFab').addEventListener('click', () => (S.open ? close() : open())); }
  function init() {
    if (!PM.state.token) return;
    build(); bindFab();
    new MutationObserver(() => rebuild()).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    window.addEventListener('hashchange', onHash);
    if (keep('pm_chat_open') === '1' && !window.matchMedia('(max-width: 820px)').matches) open();
  }
  PM.chat = { init, open, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
