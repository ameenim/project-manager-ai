/* The notification center.
   A bell in the side menu with an unread count opens a full page in the style of an inbox. The notifications are on the
   start side and the details of the selected one are next to them: the late tasks or late payments behind it, each with
   quick actions that work in place and offer Undo. It takes the place of the top plan ribbon. The ribbon returns only
   when the server cannot provide notifications. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;

  Object.assign(PM.I18N.en, {
    nc_title: 'Notifications', nc_bell: 'Notifications', nc_unread: '{n} unread', nc_none: 'You are all caught up.', nc_mark_all: 'Mark all read', nc_dismiss: 'Delete',
    nc_late_tasks: 'Late tasks: {n}', nc_late_payments: 'Late payments: {n}', nc_plan: 'Plan',
    nc_d0: 'less than a day', nc_d1: '1 day', nc_dn: '{n} days',
    nc_trial: 'Your free trial ends in {d}', nc_trial_over: 'Your free trial has ended. Subscribe to keep using the AI.', nc_tokens80: 'You used {pct}% of your tokens', nc_tokens100: 'You reached your token limit',
    nc_paid_3: 'Your subscription ends in {d}', nc_ended: 'Your subscription has ended', nc_tokens: 'Tokens used', nc_billing: 'Billing and plan', nc_failed: 'The notification could not be updated.',
    nc_all: 'All', nc_f_unread: 'Unread', nc_f_tasks: 'Late tasks', nc_f_pay: 'Late payments', nc_f_plan: 'Plan', nc_filters: 'Filter notifications',
    nc_pick: 'Select a notification to see the details.', nc_back: 'Back to the inbox', nc_open_project: 'Open project', nc_open_sched: 'Open schedule', nc_open_overview: 'Open project overview',
    nc_day_late: '1 day late', nc_days_late: '{n} days late', nc_due: 'Due {d}', nc_done: 'Mark done', nc_progress: 'Update progress', nc_invoiced: 'Mark invoiced', nc_paid: 'Mark paid',
    nc_move: 'Change due date', nc_new_due: 'New due date', nc_move_hint: 'The payment leaves the late list when the new date is today or later.',
    nc_tasks_sub: 'These tasks are past their finish date and not complete.', nc_pay_sub: 'These payments are past due and still pending.',
    nc_more: 'Show {n} more', nc_less: 'Show less', nc_off: 'Notifications are not available right now.', nc_loading: 'Loading the details', nc_detail_failed: 'The details could not be loaded.', nc_retry: 'Try again',
    nc_filter_none: 'Nothing here.', nc_just_now: 'Just now', nc_plan_sub: 'About your plan and AI tokens', nc_unread_dot: 'Unread', nc_list: 'Notifications list', nc_detail: 'Notification details', nc_gone: 'This notification was cleared because nothing is late anymore.', nc_assignee: 'Owner',
    nc_none_filter: 'No notifications match this filter.', nc_pin: 'Pin', nc_unpin: 'Unpin', nc_pinned: 'Pinned', nc_view: 'Sort and group', nc_v_time: 'Newest first', nc_v_project: 'By project', nc_deleted: 'Notification deleted', nc_pin_tip: 'Pin to the top', nc_unpin_tip: 'Remove the pin',
  });
  Object.assign(PM.I18N.ar, {
    nc_title: 'الإشعارات', nc_bell: 'الإشعارات', nc_unread: '{n} غير مقروء', nc_none: 'لا يوجد شيء جديد.', nc_mark_all: 'تعليم الكل كمقروء', nc_dismiss: 'حذف',
    nc_late_tasks: 'مهام متأخرة: {n}', nc_late_payments: 'دفعات متأخرة: {n}', nc_plan: 'الباقة',
    nc_d0: 'أقل من يوم', nc_d1: 'يوم واحد', nc_dn: '{n} أيام',
    nc_trial: 'تنتهي تجربتك المجانية بعد {d}', nc_trial_over: 'انتهت تجربتك المجانية. اشترك لمتابعة استخدام الذكاء الاصطناعي.', nc_tokens80: 'استهلكت {pct}% من رموزك', nc_tokens100: 'وصلت إلى حد الرموز',
    nc_paid_3: 'ينتهي اشتراكك بعد {d}', nc_ended: 'انتهى اشتراكك', nc_tokens: 'الرموز المستخدمة', nc_billing: 'الفوترة والباقة', nc_failed: 'تعذر تحديث الإشعار.',
    nc_all: 'الكل', nc_f_unread: 'غير مقروء', nc_f_tasks: 'مهام متأخرة', nc_f_pay: 'دفعات متأخرة', nc_f_plan: 'الباقة', nc_filters: 'تصفية الإشعارات',
    nc_pick: 'اختر إشعارا لعرض تفاصيله.', nc_back: 'العودة إلى صندوق الإشعارات', nc_open_project: 'فتح المشروع', nc_open_sched: 'فتح الجدول الزمني', nc_open_overview: 'فتح نظرة المشروع',
    nc_day_late: 'متأخرة يوم واحد', nc_days_late: 'متأخرة {n} أيام', nc_due: 'الاستحقاق {d}', nc_done: 'تحديد كمكتملة', nc_progress: 'تحديث التقدم', nc_invoiced: 'تحديد كمفوترة', nc_paid: 'تحديد كمدفوعة',
    nc_move: 'تغيير تاريخ الاستحقاق', nc_new_due: 'تاريخ الاستحقاق الجديد', nc_move_hint: 'تخرج الدفعة من قائمة المتأخرات إذا كان التاريخ الجديد اليوم أو بعده.',
    nc_tasks_sub: 'تجاوزت هذه المهام تاريخ انتهائها ولم تكتمل.', nc_pay_sub: 'تجاوزت هذه الدفعات موعد استحقاقها وما زالت قيد الانتظار.',
    nc_more: 'عرض {n} أخرى', nc_less: 'عرض أقل', nc_off: 'الإشعارات غير متاحة الآن.', nc_loading: 'جار تحميل التفاصيل', nc_detail_failed: 'تعذر تحميل التفاصيل.', nc_retry: 'حاول مرة أخرى',
    nc_filter_none: 'لا يوجد شيء هنا.', nc_just_now: 'الآن', nc_plan_sub: 'عن باقتك ورموز الذكاء الاصطناعي', nc_unread_dot: 'غير مقروء', nc_list: 'قائمة الإشعارات', nc_detail: 'تفاصيل الإشعار', nc_gone: 'تم مسح هذا الإشعار لأنه لم يعد هناك شيء متأخر.', nc_assignee: 'المسؤول',
    nc_none_filter: 'لا توجد إشعارات تطابق هذا الفلتر.', nc_pin: 'تثبيت', nc_unpin: 'إلغاء التثبيت', nc_pinned: 'المثبتة', nc_view: 'الترتيب والتجميع', nc_v_time: 'الأحدث أولا', nc_v_project: 'حسب المشروع', nc_deleted: 'تم حذف الإشعار', nc_pin_tip: 'تثبيت في الأعلى', nc_unpin_tip: 'إزالة التثبيت',
  });

  function view() { try { return localStorage.getItem('pm_nc_group') === 'project' ? 'project' : 'time'; } catch (e) { return 'time'; } }
  const S = { items: [], unread: 0, ok: null, at: 0, busy: false, tok: null, sel: null, filter: 'all', group: view(), open: false, more: false };
  const E = { id: null, data: null, state: 'idle', seq: 0 }; // the details of the selected notification
  let timer = 0, soon = 0, host = null;
  const flag = (off) => { try { localStorage.setItem('pm_nc_off', off ? '1' : '0'); } catch (e) { /* ignore */ } };
  const wasOff = () => { try { return localStorage.getItem('pm_nc_off') === '1'; } catch (e) { return false; } };

  const dd = (n) => (n <= 0 ? t('nc_d0') : n === 1 ? t('nc_d1') : t('nc_dn', { n }));
  function textOf(x) {
    if (x.kind === 'late_tasks') return t('nc_late_tasks', { n: x.n });
    if (x.kind === 'late_payments') return t('nc_late_payments', { n: x.n });
    const e = x.extra || {};
    if (x.sig === 'trial_over') return t('nc_trial_over');
    if (x.sig === 'ended') return t('nc_ended');
    if (x.sig === 'tokens100') return t('nc_tokens100');
    if (x.sig === 'tokens80') return t('nc_tokens80', { pct: e.pct != null ? e.pct : 80 });
    if (x.sig === 'paid_3') return t('nc_paid_3', { d: dd(e.days || 0) });
    return t('nc_trial', { d: dd(e.days || 0) });
  }
  const titleOf = (x) => (x.kind === 'plan' ? t('nc_plan') : x.project);
  const linkOf = (x) => (x.kind === 'plan' ? '#/billing' : x.kind === 'late_tasks' ? `#/p/${x.project_id}/schedule` : `#/p/${x.project_id}`);
  const warn = (x) => x.kind !== 'plan' || ['trial_over', 'ended', 'tokens100', 'tokens80', 'trial_3', 'paid_3'].includes(x.sig);

  // ---------- data ----------
  async function load(force) {
    if (!PM.state.token) return;
    if (S.tok !== PM.state.token) { S.tok = PM.state.token; S.items = []; S.unread = 0; S.ok = null; S.at = 0; S.sel = null; E.id = null; E.data = null; }
    if (!force && Date.now() - S.at < 25000) return;
    S.at = Date.now();
    try {
      const d = await PM.api('GET', '/api/notifications');
      S.ok = d.available !== false; S.items = d.items || []; S.unread = d.unread || 0;
      const off = !S.ok;
      if (off !== wasOff()) { flag(off); if (PM.billing) PM.billing.refresh(); }
    } catch (e) {
      // the server could not be reached: keep what the bell already showed and ask again soon, never mark the center as off
      if (e && e.network) { S.at = Date.now() - 20000; paintBell(); repaint(); return; }
      // the center answered with an error or does not exist (a demo, or a release without it): keep the plan ribbon
      S.ok = false; S.items = []; S.unread = 0;
      if (!wasOff()) { flag(true); if (PM.billing) PM.billing.refresh(); }
    }
    paintBell(); repaint();
  }
  // The list changes on screen at once and the server is told after. If the server says no, the list goes back to what it was
  // and the person is told, so a dismissed or read notification never waits on the network to look dismissed or read.
  async function act(kind, body) {
    if (S.busy) return; S.busy = true;
    const was = { items: S.items.slice(), unread: S.unread };
    if (kind === 'dismiss') S.items = S.items.filter((x) => String(x.id) !== String(body.id));
    else if (kind === 'read') S.items = S.items.map((x) => (body.all || String(x.id) === String(body.id) ? Object.assign({}, x, { read: true }) : x));
    S.unread = S.items.filter((x) => !x.read).length;
    paintBell(); repaint();
    try { await PM.api('POST', '/api/notifications/' + kind, body); await load(true); }
    catch (e) { S.items = was.items; S.unread = was.unread; paintBell(); repaint(); PM.toast(e.message || t('nc_failed'), 'err'); }
    finally { S.busy = false; }
  }

  // ---------- the bell ----------
  const onPage = () => /^#\/notifications/.test(location.hash);
  function paintBell() {
    const slot = document.getElementById('ntSlot');
    const fab = document.getElementById('navShow');
    if (fab) { let b = fab.querySelector('.nt-badge'); if (S.unread && S.ok) { if (!b) { b = document.createElement('span'); b.className = 'nt-badge'; fab.appendChild(b); } b.textContent = S.unread > 9 ? '9+' : String(S.unread); } else if (b) b.remove(); }
    if (!slot) return;
    if (!S.ok) { slot.innerHTML = ''; return; }
    const label = S.unread ? `${t('nc_bell')}, ${t('nc_unread', { n: S.unread })}` : t('nc_bell');
    slot.innerHTML = `<a class="nt-bell${onPage() ? ' active' : ''}" id="ntBell" href="#/notifications"${onPage() ? ' aria-current="page"' : ''} aria-label="${esc(label)}" data-tip="${esc(label)}">${icon('bell')}<span class="grow">${esc(t('nc_bell'))}</span>${S.unread ? `<span class="badge-count nt-count">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</a>`;
  }

  // ---------- helpers for the page ----------
  const loc = () => (PM.state.lang === 'ar' ? 'ar-AE' : 'en-US');
  const day = (d) => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString(loc(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return d; } };
  function ago(at) {
    const ms = Date.now() - new Date(at).getTime();
    if (!isFinite(ms) || ms < 60000) return t('nc_just_now');
    const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto', style: 'short' });
    const m = Math.round(ms / 60000);
    if (m < 60) return rtf.format(-m, 'minute');
    const h = Math.round(m / 60);
    if (h < 24) return rtf.format(-h, 'hour');
    return rtf.format(-Math.round(h / 24), 'day');
  }
  const lateText = (n) => (n === 1 ? t('nc_day_late') : t('nc_days_late', { n }));
  const FILTERS = [['all', 'nc_all'], ['unread', 'nc_f_unread'], ['late_tasks', 'nc_f_tasks'], ['late_payments', 'nc_f_pay'], ['plan', 'nc_f_plan']];
  const filtered = () => S.items.filter((x) => (S.filter === 'all' ? true : S.filter === 'unread' ? !x.read : x.kind === S.filter));
  const newer = (a, b) => new Date(b.at) - new Date(a.at);
  // The list as sections in the order they appear: pinned first, then either one run of newest first or one section per project.
  function layout() {
    const rows = filtered().sort(newer);
    const out = [];
    const pins = rows.filter((x) => x.pinned);
    if (pins.length) out.push({ key: 'pin', head: t('nc_pinned'), items: pins });
    const rest = rows.filter((x) => !x.pinned);
    if (S.group === 'project') {
      const by = new Map();
      for (const x of rest) { const k = x.kind === 'plan' ? 'plan' : String(x.project_id); if (!by.has(k)) by.set(k, { key: k, head: x.kind === 'plan' ? t('nc_plan') : x.project, items: [] }); by.get(k).items.push(x); }
      out.push(...by.values()); // each section starts with its newest notification, so the sections are newest first too
    } else if (rest.length) out.push({ key: 'all', head: pins.length ? t('nc_all') : '', items: rest });
    return out;
  }
  const shown = () => layout().flatMap((g) => g.items);
  const current = () => S.items.find((x) => String(x.id) === String(S.sel)) || null;

  // ---------- the page ----------
  function listHtml() {
    const tabs = FILTERS.map(([k, key]) => {
      const n = k === 'all' ? S.items.length : k === 'unread' ? S.unread : S.items.filter((x) => x.kind === k).length;
      return `<button class="ib-tab${S.filter === k ? ' on' : ''}" type="button" role="tab" aria-selected="${S.filter === k}" data-filter="${k}">${esc(t(key))}${n ? `<span class="ib-n">${n}</span>` : ''}</button>`;
    }).join('');
    const item = (x) => {
      const sel = String(x.id) === String(S.sel);
      return `<div class="ib-w${sel ? ' sel' : ''}"><button class="ib-item${x.read ? '' : ' unread'}${sel ? ' sel' : ''}" type="button" role="option" aria-selected="${sel}" data-id="${esc(x.id)}"><span class="nc-ic ${warn(x) ? 'warn' : ''}">${icon(warn(x) ? 'alert' : 'spark')}</span><span class="nc-text"><b>${esc(titleOf(x))}</b><span class="small muted">${esc(textOf(x))}</span></span><span class="ib-side"><span class="small faint">${esc(ago(x.at))}</span>${x.pinned ? `<span class="ib-pinmark" role="img" aria-label="${esc(t('nc_pinned'))}">${icon('pin')}</span>` : x.read ? '' : `<span class="nc-dot" role="img" aria-label="${esc(t('nc_unread_dot'))}"></span>`}</span></button><span class="ib-quick"><button class="btn ghost icon sm${x.pinned ? ' on' : ''}" type="button" data-act="${x.pinned ? 'unpin' : 'pin'}" data-id="${esc(x.id)}" aria-pressed="${!!x.pinned}" aria-label="${esc(t(x.pinned ? 'nc_unpin' : 'nc_pin'))}" data-tip="${esc(t(x.pinned ? 'nc_unpin' : 'nc_pin'))}">${icon('pin')}</button><button class="btn ghost icon sm" type="button" data-act="del" data-id="${esc(x.id)}" aria-label="${esc(t('nc_dismiss'))}" data-tip="${esc(t('nc_dismiss'))}">${icon('trash')}</button></span></div>`;
    };
    const groups = layout();
    const body = groups.length ? groups.map((g) => `${g.head ? `<div class="ib-grp"><span>${esc(g.head)}</span><span class="ib-n">${g.items.length}</span></div>` : ''}${g.items.map(item).join('')}`).join('') : `<div class="ib-empty muted small">${icon('check')}<span>${esc(S.items.length ? t('nc_none_filter') : t('nc_none'))}</span></div>`;
    const views = `<div class="ib-view seg" role="radiogroup" aria-label="${esc(t('nc_view'))}">${[['time', 'nc_v_time'], ['project', 'nc_v_project']].map(([k, key]) => `<button type="button" role="radio" aria-checked="${S.group === k}" class="${S.group === k ? 'on' : ''}" data-view="${k}">${esc(t(key))}</button>`).join('')}</div>`;
    return `<div class="ib-tabs" role="tablist" aria-label="${esc(t('nc_filters'))}">${tabs}</div>${views}<div class="ib-items" role="listbox" aria-label="${esc(t('nc_list'))}">${body}</div>`;
  }
  function rowHtml(x, kind) {
    const late = `<span class="chip red">${icon('clock')}${esc(lateText(x.late_days))}</span>`;
    if (kind === 'late_tasks') {
      const bits = [esc(t('nc_due', { d: day(x.due) })), `${x.progress}%`]; if (x.assignee) bits.push(`${esc(t('nc_assignee'))}: ${esc(x.assignee)}`);
      return `<div class="ib-row" data-task="${x.task_id}"><div class="ib-row-main"><div class="ib-row-t">${esc(x.title)}</div><div class="small muted ib-row-m">${late}<span>${bits.join(' · ')}</span></div></div><div class="ib-acts"><button class="btn sm good" type="button" data-act="done" data-task="${x.task_id}">${icon('check')}${esc(t('nc_done'))}</button><button class="btn sm tonal" type="button" data-act="progress" data-task="${x.task_id}">${esc(t('nc_progress'))}</button><button class="btn sm ghost" type="button" data-act="schedule">${esc(t('nc_open_sched'))}</button></div></div>`;
    }
    const cur = x.currency || '';
    return `<div class="ib-row" data-item="${x.item_id}"><div class="ib-row-main"><div class="ib-row-t">${esc(x.title)}</div><div class="small muted ib-row-m">${late}<span>${esc(t('nc_due', { d: day(x.due) }))}</span></div></div>${x.amount != null ? `<div class="ib-amt">${esc(PM.money(x.amount, cur))}</div>` : ''}<div class="ib-acts"><button class="btn sm good" type="button" data-act="paid" data-item="${x.item_id}">${icon('coin')}${esc(t('nc_paid'))}</button><button class="btn sm tonal" type="button" data-act="invoiced" data-item="${x.item_id}">${esc(t('nc_invoiced'))}</button><button class="btn sm ghost" type="button" data-act="move" data-item="${x.item_id}">${icon('cal')}${esc(t('nc_move'))}</button></div></div>`;
  }
  function detailHtml() {
    const x = current();
    if (!x) return `<div class="ib-blank muted">${icon('bell')}<p>${esc(t('nc_pick'))}</p></div>`;
    const back = `<button class="btn sm ghost ib-back" type="button" data-act="back">${icon('chev_l')}${esc(t('nc_back'))}</button>`;
    const head = `<header class="ib-dh">${back}<div class="ib-dt"><span class="nc-ic lg ${warn(x) ? 'warn' : ''}">${icon(warn(x) ? 'alert' : 'spark')}</span><div class="nc-text"><h2>${esc(titleOf(x))}</h2><span class="muted">${esc(textOf(x))}</span><span class="small faint">${esc(ago(x.at))}</span></div></div><div class="ib-dtools">${x.kind === 'plan' ? '' : `<a class="btn sm ghost" href="#/p/${x.project_id}">${icon('folder')}${esc(t('nc_open_project'))}</a>`}<button class="btn sm ghost${x.pinned ? ' on' : ''}" type="button" data-act="${x.pinned ? 'unpin' : 'pin'}" data-id="${esc(x.id)}" aria-pressed="${!!x.pinned}">${icon('pin')}${esc(t(x.pinned ? 'nc_unpin' : 'nc_pin'))}</button><button class="btn sm ghost" type="button" data-act="del" data-id="${esc(x.id)}">${icon('trash')}${esc(t('nc_dismiss'))}</button></div></header>`;
    if (x.kind === 'plan') {
      let pct = null; try { pct = PM.billing && PM.billing.info ? Math.min(100, Math.round(PM.billing.info().pct)) : null; } catch (e) { pct = null; }
      const meter = pct == null ? '' : `<div class="nc-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(t('nc_tokens'))}"><i style="width:${pct}%"></i></div><span class="small muted">${esc(t('nc_tokens'))}: ${pct}%</span>`;
      return `${head}<div class="ib-body"><p class="muted" style="margin-top:0">${esc(t('nc_plan_sub'))}</p>${meter}<div class="ib-plan-acts"><a class="btn primary" href="#/billing">${icon('coin')}${esc(t('nc_billing'))}</a></div></div>`;
    }
    let body;
    if (E.state === 'loading' && !E.data) body = `<div class="ib-skel" role="status" aria-label="${esc(t('nc_loading'))}"><i></i><i></i><i></i></div>`;
    else if (E.state === 'error' && !E.data) body = `<div class="ib-empty muted small"><span>${esc(t('nc_detail_failed'))}</span><button class="btn sm" type="button" data-act="retry">${icon('refresh')}${esc(t('nc_retry'))}</button></div>`;
    else {
      const all = (E.data && E.data.entries) || [];
      const list = S.more ? all : all.slice(0, 5); // lists show five rows and a toggle
      body = `<p class="muted small ib-sub">${esc(t(x.kind === 'late_tasks' ? 'nc_tasks_sub' : 'nc_pay_sub'))}</p><div class="ib-rows">${list.map((r) => rowHtml(r, x.kind)).join('')}</div>${all.length > 5 ? `<button class="btn sm ghost ib-more" type="button" data-act="more">${esc(S.more ? t('nc_less') : t('nc_more', { n: all.length - 5 }))}</button>` : ''}`;
    }
    return `${head}<div class="ib-body">${body}</div>`;
  }
  function paintPage() {
    if (!host) return;
    host.querySelector('.ib-list').innerHTML = listHtml();
    host.querySelector('.ib-detail').innerHTML = detailHtml();
    host.querySelector('.ib').classList.toggle('detail-open', S.open && !!current());
    const mk = host.querySelector('[data-all]'); if (mk) mk.hidden = !S.unread;
  }
  const repaint = () => { if (host && !document.body.contains(host)) host = null; if (host) paintPage(); };

  // The details of the selected notification come from the server on demand, so they always match the number.
  async function loadEntries(id, quiet) {
    const my = ++E.seq;
    if (E.id !== id) { E.id = id; E.data = null; }
    if (!quiet) { E.state = 'loading'; repaint(); }
    try {
      const d = await PM.api('GET', '/api/notifications/' + id);
      if (my !== E.seq) return;
      E.data = d; E.state = 'ready';
    } catch (e) {
      if (my !== E.seq) return;
      // the notification is gone when nothing is late anymore
      if (e && e.status === 404) { E.data = { entries: [] }; E.state = 'ready'; } else E.state = 'error';
    }
    repaint();
  }
  function select(id, opts) {
    opts = opts || {};
    S.sel = id == null ? null : String(id); S.more = false; S.open = id != null;
    const x = current();
    try { history.replaceState(null, '', '#/notifications' + (x ? '/' + x.id : '')); } catch (e) { /* ignore */ }
    if (x && x.kind !== 'plan') loadEntries(x.id); else { E.id = x ? x.id : null; E.data = null; E.state = 'idle'; }
    if (x && !x.read) { S.items = S.items.map((i) => (i.id === x.id ? Object.assign({}, i, { read: true }) : i)); S.unread = S.items.filter((i) => !i.read).length; PM.api('POST', '/api/notifications/read', { id: x.id }).catch(() => {}); paintBell(); }
    repaint();
    if (opts.focus) { const b = host && host.querySelector(`.ib-item[data-id="${CSS.escape(String(id))}"]`); if (b) b.focus({ preventScroll: true }); }
  }
  // After an action: refresh the details and the list, then move to a neighbor when this notification is cleared.
  async function afterAction() {
    const id = S.sel;
    await Promise.all([id ? loadEntries(id, true) : null, load(true)]);
    if (S.sel && !current()) {
      const rows = shown();
      select(rows.length ? rows[0].id : null);
      if (!rows.length) { S.open = false; repaint(); }
    }
  }
  // The row leaves at once, the save runs behind it, a failure puts it back, and Undo is offered.
  async function run(msg, doFn, undoFn, drop) {
    const was = E.data;
    if (drop && E.data) { E.data = Object.assign({}, E.data, { entries: E.data.entries.filter((r) => !drop(r)) }); repaint(); }
    try { await doFn(); } catch (e) { E.data = was; repaint(); PM.toast(e.message, 'err'); return; }
    PM.toast(msg, 'ok', { label: t('g_undo'), fn: async () => { try { await undoFn(); } catch (e) { PM.toast(e.message, 'err'); } afterAction(); } });
    afterAction();
  }
  const entry = (kind, id) => ((E.data && E.data.entries) || []).find((r) => String(kind === 'task' ? r.task_id : r.item_id) === String(id));
  const proj = () => { const x = current(); return x ? { id: x.project_id, name: x.project } : {}; };

  async function markDone(r) {
    const P = proj(); const chg = { [r.task_id]: { progress: 100 } };
    const apply = (c) => PM.api('POST', `/api/projects/${P.id}/schedule/apply`, { changes: c, slim: true });
    let ops = [];
    if (PM.completion) { ops = await PM.completion.flow(P.id, chg, null, r.currency); if (ops === null) return; }
    run(t('radar_updated'), async () => { await apply(chg); if (PM.completion) await PM.completion.commit(ops); }, async () => { await apply({ [r.task_id]: { progress: r.progress } }); if (PM.completion) await PM.completion.revert(ops); }, (z) => z.task_id === r.task_id);
  }
  function setPay(r, state) {
    run(t('radar_updated'), () => PM.api('PUT', `/api/items/${r.item_id}`, { state }), () => PM.api('PUT', `/api/items/${r.item_id}`, { state: r.state }), state === 'paid' ? (z) => z.item_id === r.item_id : null);
  }
  function moveDue(r) {
    const m = PM.modal({
      title: t('nc_move'),
      body: `<p class="muted" style="margin-top:0"><b>${esc(r.title)}</b><br>${esc(proj().name || '')}</p><label class="f">${esc(t('nc_new_due'))}<input type="date" id="ncDue" value="${esc(PM.today())}"></label><div class="small muted" style="margin-top:8px">${esc(t('nc_move_hint'))}</div>`,
      footer: `<button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="ncDueGo">${esc(t('save'))}</button>`,
    });
    m.$('#ncDueGo').onclick = () => {
      const v = m.$('#ncDue').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      m.close();
      const put = (d) => PM.api('PUT', `/api/items/${r.item_id}`, { data: { due_date: d } });
      run(t('radar_updated'), () => put(v), () => put(r.due), v >= PM.today() ? (z) => z.item_id === r.item_id : null);
    };
  }

  // Pin changes on screen at once and goes back if the server says no.
  async function pin(id, on) {
    S.items = S.items.map((x) => (String(x.id) === String(id) ? Object.assign({}, x, { pinned: on }) : x)); repaint();
    try { await PM.api('POST', '/api/notifications/' + (on ? 'pin' : 'unpin'), { id }); }
    catch (e) { S.items = S.items.map((x) => (String(x.id) === String(id) ? Object.assign({}, x, { pinned: !on }) : x)); repaint(); PM.toast(e.message || t('nc_failed'), 'err'); }
  }
  // Delete removes the notification at once, moves to its neighbor, and offers Undo. It returns by itself only when the condition changes.
  async function remove(id) {
    const rows = shown(); const i = rows.findIndex((r) => String(r.id) === String(id));
    const was = { items: S.items.slice(), unread: S.unread };
    const next = rows[i + 1] || rows[i - 1] || null;
    S.items = S.items.filter((x) => String(x.id) !== String(id)); S.unread = S.items.filter((x) => !x.read).length; paintBell();
    if (String(S.sel) === String(id)) select(next ? next.id : null); else repaint();
    try { await PM.api('POST', '/api/notifications/dismiss', { id }); }
    catch (e) { S.items = was.items; S.unread = was.unread; paintBell(); repaint(); PM.toast(e.message || t('nc_failed'), 'err'); return; }
    PM.toast(t('nc_deleted'), 'ok', { label: t('g_undo'), fn: async () => { try { await PM.api('POST', '/api/notifications/restore', { id }); await load(true); select(id); } catch (er) { PM.toast(er.message || t('nc_failed'), 'err'); } } });
  }

  function onClick(e) {
    const vw = e.target.closest('[data-view]'); if (vw) { S.group = vw.dataset.view; try { localStorage.setItem('pm_nc_group', S.group); } catch (er) { /* ignore */ } return paintPage(); }
    const it = e.target.closest('.ib-item'); if (it) return select(it.dataset.id);
    const f = e.target.closest('[data-filter]'); if (f) { S.filter = f.dataset.filter; paintPage(); return; }
    if (e.target.closest('[data-all]')) return act('read', { all: true });
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act; const x = current();
    if (a === 'back') { S.open = false; repaint(); const s = host.querySelector('.ib-item.sel'); if (s) s.focus({ preventScroll: true }); return; }
    if (a === 'retry' && x) return loadEntries(x.id);
    if (a === 'more') { S.more = !S.more; return repaint(); }
    if (a === 'del') return remove(b.dataset.id);
    if (a === 'pin' || a === 'unpin') return pin(b.dataset.id, a === 'pin');
    if (a === 'schedule' && x) return PM.act && PM.act.peek ? PM.act.peek(x.project_id, 'schedule') : (location.hash = `#/p/${x.project_id}/schedule`);
    if (a === 'done') { const r = entry('task', b.dataset.task); if (r) markDone(Object.assign({ currency: null }, r)); return; }
    if (a === 'progress') { const r = entry('task', b.dataset.task); if (r) PM.act.progress({ task_id: r.task_id, title: r.title, project: proj().name, project_id: proj().id, progress: r.progress }, afterAction); return; }
    if (a === 'paid' || a === 'invoiced') { const r = entry('item', b.dataset.item); if (r) setPay(r, a); return; }
    if (a === 'move') { const r = entry('item', b.dataset.item); if (r) moveDue(r); }
  }
  function onKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const it = e.target.closest && e.target.closest('.ib-item'); if (!it) return;
    const rows = shown(); const i = rows.findIndex((r) => String(r.id) === it.dataset.id); const n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (n) { e.preventDefault(); select(n.id, { focus: true }); }
  }

  PM.views.notifications = async function (want) {
    PM.shell('notifications', `<div class="page ib-page" id="inboxPage"><div class="page-head"><h1>${esc(t('nc_title'))}</h1><button class="btn sm" type="button" data-all hidden>${esc(t('nc_mark_all'))}</button></div><div class="card flat flush ib"><section class="ib-list" aria-label="${esc(t('nc_list'))}"></section><section class="ib-detail" aria-label="${esc(t('nc_detail'))}" aria-live="polite"></section></div></div>`);
    host = document.getElementById('inboxPage');
    host.addEventListener('click', onClick); host.addEventListener('keydown', onKey);
    if (S.ok === null || Date.now() - S.at > 25000) await load(true);
    if (!S.ok) { host.querySelector('.ib').innerHTML = `<div class="ib-blank muted">${icon('bell')}<p>${esc(t('nc_off'))}</p></div>`; return; }
    const first = want && S.items.find((x) => String(x.id) === String(want)) || (S.sel && current()) || null;
    paintPage();
    if (first) select(first.id); else if (!mobile()) { const rows = shown(); if (rows.length) select(rows[0].id); }
    if (mobile() && !want) S.open = false; // on a phone the list comes first, the details open on a tap
    repaint();
  };
  const mobile = () => window.matchMedia && window.matchMedia('(max-width: 820px)').matches;

  function mount() {
    paintBell();
    if (S.ok === null) load(true); else load(false);
  }
  function start() {
    window.addEventListener('hashchange', () => { clearTimeout(soon); soon = setTimeout(() => load(false), 900); paintBell(); });
    timer = setInterval(() => { if (!document.hidden) load(true); }, 90000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
  }
  PM.notify = { mount, refresh: () => load(true), unread: () => S.unread };
  start();
})();
