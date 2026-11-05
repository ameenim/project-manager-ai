/* Support and tickets.
   Anyone can report a problem, suggest an idea or ask a question. When something fails, the app offers to open a ticket
   and fills in the details for them. The reporter follows the status in "Support": reported, being fixed, fixed on dev,
   ready to publish, published. Only plain words reach the reporter. The technical package goes to the super admin. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;

  Object.assign(PM.I18N.en, {
    nav_support: 'Support', sp_title: 'Support', sp_sub: 'Report a problem, suggest an idea or ask a question. We follow every report to the end.',
    sp_new: 'New report', sp_report_problem: 'Report this problem', sp_report_it: 'Report it', sp_empty: 'No reports yet. If something goes wrong, tell us and we will look into it.',
    sp_kind_bug: 'Problem', sp_kind_enhancement: 'Idea', sp_kind_question: 'Question',
    sp_h_bug: 'Report a problem', sp_h_enhancement: 'Suggest an idea', sp_h_question: 'Ask a question',
    sp_f_title: 'Short title', sp_f_desc: 'What happened', sp_f_desc_ph: 'What were you doing and what did you expect to happen?',
    sp_f_desc_idea: 'What would you like', sp_tech: 'Send technical details to help us fix it faster',
    sp_tech_view: 'What is sent', sp_tech_note: 'Only the page, your last few clicks and the error. Never passwords, files or project content.',
    sp_send: 'Send report', sp_sent: 'Thank you. Your report {ref} was sent.', sp_known: 'We already know about this problem and are working on it. Your report will be added to it.',
    sp_status_reported: 'Received', sp_status_triaged: 'Reviewed', sp_status_needs_info: 'We need more information', sp_status_fixing: 'Being fixed',
    sp_status_in_review: 'Being reviewed by our team', sp_status_fixed_dev: 'Fixed, being tested', sp_status_ready_publish: 'Ready to go live', sp_status_published: 'Live',
    sp_status_wont_fix: 'Closed', sp_status_duplicate: 'Received',
    sp_steps: 'Received,Reviewed,Being fixed,Fixed,Ready,Live',
    sp_back: 'All reports', sp_reply_ph: 'Write a message', sp_reply: 'Send', sp_confirm: 'It works now', sp_reopen: 'Still not working',
    sp_confirmed: 'You confirmed it works. Thank you.', sp_reopen_ph: 'What is still wrong?', sp_you: 'You', sp_team: 'Support team', sp_unexpected: 'Something went wrong.',
    sp_shared: 'Others reported the same problem. You will see the same updates.', sp_updated: 'Updated', sp_cancel: 'Cancel',
  });
  Object.assign(PM.I18N.ar, {
    nav_support: 'الدعم', sp_title: 'الدعم', sp_sub: 'أبلغ عن مشكلة أو اقترح فكرة أو اطرح سؤالا. نتابع كل بلاغ حتى نهايته.',
    sp_new: 'بلاغ جديد', sp_report_problem: 'أبلغ عن هذه المشكلة', sp_report_it: 'أبلغ', sp_empty: 'لا توجد بلاغات بعد. إذا حدث خطأ أخبرنا وسنتابع الأمر.',
    sp_kind_bug: 'مشكلة', sp_kind_enhancement: 'فكرة', sp_kind_question: 'سؤال',
    sp_h_bug: 'الإبلاغ عن مشكلة', sp_h_enhancement: 'اقتراح فكرة', sp_h_question: 'اطرح سؤالا',
    sp_f_title: 'عنوان قصير', sp_f_desc: 'ماذا حدث', sp_f_desc_ph: 'ماذا كنت تفعل وماذا توقعت أن يحدث؟',
    sp_f_desc_idea: 'ماذا تريد', sp_tech: 'أرسل تفاصيل تقنية لنصلح المشكلة أسرع',
    sp_tech_view: 'ما الذي يرسل', sp_tech_note: 'الصفحة وآخر نقراتك والخطأ فقط. لا كلمات مرور ولا ملفات ولا محتوى المشاريع.',
    sp_send: 'إرسال البلاغ', sp_sent: 'شكرا لك. تم إرسال بلاغك {ref}.', sp_known: 'نعرف هذه المشكلة ونعمل عليها. سيضاف بلاغك إليها.',
    sp_status_reported: 'تم الاستلام', sp_status_triaged: 'تمت المراجعة', sp_status_needs_info: 'نحتاج إلى مزيد من المعلومات', sp_status_fixing: 'قيد الإصلاح',
    sp_status_in_review: 'يراجعه فريقنا', sp_status_fixed_dev: 'تم الإصلاح وقيد الاختبار', sp_status_ready_publish: 'جاهز للنشر', sp_status_published: 'منشور',
    sp_status_wont_fix: 'مغلق', sp_status_duplicate: 'تم الاستلام',
    sp_steps: 'استلام,مراجعة,إصلاح,تم الإصلاح,جاهز,منشور',
    sp_back: 'كل البلاغات', sp_reply_ph: 'اكتب رسالة', sp_reply: 'إرسال', sp_confirm: 'يعمل الآن', sp_reopen: 'ما زال لا يعمل',
    sp_confirmed: 'أكدت أنه يعمل. شكرا لك.', sp_reopen_ph: 'ما الذي ما زال خاطئا؟', sp_you: 'أنت', sp_team: 'فريق الدعم', sp_unexpected: 'حدث خطأ ما.',
    sp_shared: 'أبلغ آخرون عن المشكلة نفسها. ستظهر لك التحديثات نفسها.', sp_updated: 'آخر تحديث', sp_cancel: 'إلغاء',
  });

  // ---------- what the browser remembers so a report can carry it ----------
  const crumbs = [], reqs = [], logs = [];
  const push = (arr, v, n) => { arr.push(v); if (arr.length > n) arr.shift(); };
  const now = () => new Date().toISOString();
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('button, a, [role=button], input, select');
    if (!el) return;
    const label = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
    push(crumbs, { at: now(), a: 'click', l: label, r: location.hash }, 15);
  }, true);
  window.addEventListener('hashchange', () => push(crumbs, { at: now(), a: 'go', l: location.hash, r: location.hash }, 15));
  ['error', 'warn'].forEach((k) => { const o = console[k]; console[k] = function () { try { push(logs, { at: now(), k, m: Array.from(arguments).map((x) => (x && x.message) || String(x)).join(' ').slice(0, 300) }, 10); } catch (e) { /* ignore */ } return o.apply(console, arguments); }; });

  const api = {
    lastFailure: null, lastError: null,
    note(method, path, status, ref, message) {
      if (/^\/api\/(tickets|client-error)/.test(path)) return;
      push(reqs, { at: now(), m: method, p: path.split('?')[0].slice(0, 120), s: status }, 10);
      if (status === 0 || status >= 500) api.lastFailure = { at: Date.now(), method, path: path.split('?')[0], status, ref: ref || '', message: String(message || '').slice(0, 300) };
    },
    context(technical) {
      const s = PM.state || {};
      const ctx = { route: location.hash || '#/', lang: s.lang || 'en', technical: !!technical };
      const m = /^#\/p\/(\d+)/.exec(location.hash); if (m) ctx.project_id = Number(m[1]);
      if (technical) {
        ctx.breadcrumbs = crumbs.slice(); ctx.requests = reqs.slice(); ctx.console = logs.slice();
        if (api.lastFailure && Date.now() - api.lastFailure.at < 120000) ctx.failed_request = api.lastFailure;
        if (api.lastError && Date.now() - api.lastError.at < 120000) ctx.error = { message: api.lastError.message, stack: api.lastError.stack };
      }
      return ctx;
    },
    recentFailure() { return !!(api.lastFailure && Date.now() - api.lastFailure.at < 30000) || !!(api.lastError && Date.now() - api.lastError.at < 30000); },
  };
  window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver loop/.test(e.message)) api.lastError = { at: Date.now(), message: e.message, stack: e.error && e.error.stack }; });
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; api.lastError = { at: Date.now(), message: (r && r.message) || String(r), stack: r && r.stack }; });
  PM.tickets = api;

  // ---------- the report dialog ----------
  function open(opts) {
    const o = opts || {};
    let kind = o.kind || 'bug';
    const failed = api.recentFailure();
    const draft = o.title || (api.lastFailure && Date.now() - api.lastFailure.at < 120000 ? `${t('sp_unexpected')} (${api.lastFailure.method} ${api.lastFailure.path.replace(/\/\d+/g, '/:id').slice(0, 60)})` : '');
    const m = PM.modal({
      title: t('sp_h_' + kind), size: 'sm',
      body: `<div class="sp-kinds" role="tablist">${['bug', 'enhancement', 'question'].map((k) => `<button type="button" class="sp-kind ${k === kind ? 'on' : ''}" data-k="${k}">${t('sp_kind_' + k)}</button>`).join('')}</div>
        <label class="sp-l">${t('sp_f_title')}<input id="spT" maxlength="140" value="${esc(draft)}"></label>
        <label class="sp-l"><span id="spDL">${t('sp_f_desc')}</span><textarea id="spD" rows="4" maxlength="4000" placeholder="${esc(t('sp_f_desc_ph'))}"></textarea></label>
        <div id="spKnown" class="sp-known" hidden>${esc(t('sp_known'))}</div>
        <label class="sp-chk"><input type="checkbox" id="spTech" checked> <span>${t('sp_tech')}</span></label>
        <details class="sp-det"><summary>${t('sp_tech_view')}</summary><p class="small muted">${t('sp_tech_note')}</p><pre id="spPre" class="sp-pre"></pre></details>`,
      footer: `<button class="btn" data-close>${t('sp_cancel')}</button><button class="btn primary" id="spGo">${t('sp_send')}</button>`,
    });
    const $ = (s) => m.$(s);
    const pre = () => { const c = api.context($('#spTech').checked); $('#spPre').textContent = JSON.stringify(c, null, 1); return c; };
    pre(); $('#spTech').onchange = pre;
    m.$$('.sp-kind').forEach((b) => { b.onclick = () => { kind = b.dataset.k; m.$$('.sp-kind').forEach((x) => x.classList.toggle('on', x === b)); m.el.querySelector('h2').textContent = t('sp_h_' + kind); $('#spDL').textContent = t(kind === 'bug' ? 'sp_f_desc' : 'sp_f_desc_idea'); }; });
    let timer = null;
    const check = () => { clearTimeout(timer); timer = setTimeout(async () => { try { const r = await PM.api('POST', '/api/tickets/check', { kind, title: $('#spT').value, description: $('#spD').value, context: api.context(true) }); $('#spKnown').hidden = !r.known; } catch (e) { /* the hint is optional */ } }, 500); };
    $('#spT').oninput = check; $('#spD').oninput = check; if (failed) check();
    $('#spGo').onclick = async () => {
      const btn = $('#spGo'); const title = $('#spT').value.trim();
      if (!title) { $('#spT').focus(); return; }
      btn.disabled = true;
      try {
        const r = await PM.api('POST', '/api/tickets', { kind, title, description: $('#spD').value, context: pre() });
        m.close(); PM.toast(t('sp_sent', { ref: r.ticket.ref })); badge();
        if (location.hash.startsWith('#/support')) PM.refresh();
      } catch (e) { btn.disabled = false; PM.toast(e.message, 'err'); }
    };
    setTimeout(() => $('#spT').focus(), 50);
    return m;
  }
  api.open = open;

  // ---------- the Support page ----------
  const dt = (iso) => { try { return new Date(iso).toLocaleString(PM.state.lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } };
  const chip = (st) => `<span class="sp-chip sp-${esc(st)}">${t('sp_status_' + st)}</span>`;
  const STEP_AT = { reported: 0, duplicate: 0, triaged: 1, needs_info: 1, in_review: 2, fixing: 2, fixed_dev: 3, ready_publish: 4, published: 5, wont_fix: 5 };
  const stepper = (st) => { const names = t('sp_steps').split(','); const at = STEP_AT[st] != null ? STEP_AT[st] : 0; return `<ol class="sp-steps">${names.map((n, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i></i><span>${esc(n)}</span></li>`).join('')}</ol>`; };

  async function list() {
    const r = await PM.api('GET', '/api/tickets');
    const rows = r.tickets.map((x) => `<a class="card sp-row" href="#/support/${x.id}"><div class="grow"><div class="sp-top"><b>${esc(x.title)}</b>${x.unread ? '<span class="sp-dot" aria-hidden="true"></span>' : ''}</div><div class="small muted">${esc(x.ref)} · ${t('sp_kind_' + x.kind)} · ${dt(x.updated_at)}</div></div>${chip(x.status)}</a>`).join('');
    $c().innerHTML = `<div class="page sp-page"><div class="page-head"><div><h1>${t('sp_title')}</h1><p class="muted">${t('sp_sub')}</p></div><button class="btn primary" id="spNew">${icon('plus')}${t('sp_new')}</button></div>${rows || `<div class="card empty">${t('sp_empty')}</div>`}</div>`;
    $('#spNew').onclick = () => open();
  }
  async function detail(id) {
    const r = await PM.api('GET', `/api/tickets/${id}`); const x = r.ticket;
    const tl = r.timeline.map((e) => `<li class="${e.by === 'you' ? 'me' : ''}"><div class="small muted">${e.by === 'you' ? t('sp_you') : t('sp_team')} · ${dt(e.at)}</div><div>${esc(e.message)}</div></li>`).join('');
    $c().innerHTML = `<div class="page sp-page"><a class="small" href="#/support">${icon('chev_l')} ${t('sp_back')}</a>
      <div class="card"><div class="sp-top"><h1 style="margin:0">${esc(x.title)}</h1>${chip(x.status)}</div><div class="small muted">${esc(x.ref)} · ${t('sp_kind_' + x.kind)} · ${dt(x.created_at)}</div>
      ${x.status === 'wont_fix' ? '' : stepper(x.status)}${x.shared ? `<p class="small muted">${t('sp_shared')}</p>` : ''}${x.description ? `<p class="sp-desc">${esc(x.description)}</p>` : ''}
      ${x.confirmed ? `<p class="sp-ok">${t('sp_confirmed')}</p>` : ''}
      <div class="sp-acts">${x.can_confirm ? `<button class="btn primary" id="spOk">${t('sp_confirm')}</button>` : ''}${x.can_reopen ? `<button class="btn" id="spRe">${t('sp_reopen')}</button>` : ''}</div></div>
      <ul class="sp-tl">${tl}</ul>
      ${x.can_reply ? `<div class="card sp-reply"><textarea id="spMsg" rows="2" maxlength="2000" placeholder="${esc(t('sp_reply_ph'))}"></textarea><button class="btn primary" id="spSend">${t('sp_reply')}</button></div>` : ''}</div>`;
    const act = async (path, body) => { try { await PM.api('POST', `/api/tickets/${id}/${path}`, body); badge(); await detail(id); } catch (e) { PM.toast(e.message, 'err'); } };
    if ($('#spOk')) $('#spOk').onclick = () => act('confirm', {});
    if ($('#spRe')) $('#spRe').onclick = () => { const m = PM.modal({ title: t('sp_reopen'), body: `<textarea id="spRM" rows="3" maxlength="2000" placeholder="${esc(t('sp_reopen_ph'))}" style="width:100%"></textarea>`, footer: `<button class="btn" data-close>${t('sp_cancel')}</button><button class="btn primary" id="spRG">${t('sp_send')}</button>` }); m.$('#spRG').onclick = () => { const v = m.$('#spRM').value; m.close(); act('reopen', { message: v }); }; };
    if ($('#spSend')) $('#spSend').onclick = () => { const v = $('#spMsg').value.trim(); if (v) act('reply', { message: v }); };
  }
  const $c = () => document.getElementById('content');
  const $ = (s) => document.querySelector(s);
  PM.views.support = async function (id) {
    PM.shell('support', '');
    try { if (id) await detail(id); else await list(); } catch (e) { $c().innerHTML = `<div class="page"><div class="card empty">${esc(e.message)}</div></div>`; }
    badge();
  };

  // ---------- the number on the menu ----------
  async function badge() {
    const a = document.getElementById('navSupport'); if (!a || !PM.state.token) return;
    try { const s = await PM.api('GET', '/api/tickets/summary'); let b = a.querySelector('.sp-badge'); if (!s.unread) { if (b) b.remove(); return; } if (!b) { b = document.createElement('span'); b.className = 'sp-badge'; a.appendChild(b); } b.textContent = s.unread; } catch (e) { /* the badge is optional */ }
  }
  PM.tickets.badge = badge;
  setInterval(() => { if (!document.hidden) badge(); }, 60000);
  window.addEventListener('hashchange', () => setTimeout(badge, 300));
  setTimeout(badge, 1500);
})();
