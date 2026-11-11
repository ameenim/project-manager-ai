/* The notification center.
   A bell in the side menu with an unread count. It lists late tasks, late payments and the state of the plan, and takes
   the place of the top plan ribbon. The ribbon returns only when the server cannot provide notifications. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;

  Object.assign(PM.I18N.en, {
    nc_title: 'Notifications', nc_bell: 'Notifications', nc_unread: '{n} unread', nc_none: 'You are all caught up.', nc_mark_all: 'Mark all read', nc_dismiss: 'Dismiss',
    nc_late_tasks: 'Late tasks: {n}', nc_late_payments: 'Late payments: {n}', nc_plan: 'Plan',
    nc_d0: 'less than a day', nc_d1: '1 day', nc_dn: '{n} days',
    nc_trial: 'Your free trial ends in {d}', nc_trial_over: 'Your free trial has ended. Subscribe to keep using the AI.', nc_tokens80: 'You used {pct}% of your tokens', nc_tokens100: 'You reached your token limit',
    nc_paid_3: 'Your subscription ends in {d}', nc_ended: 'Your subscription has ended', nc_tokens: 'Tokens used', nc_billing: 'Billing and plan', nc_failed: 'The notification could not be updated.',
  });
  Object.assign(PM.I18N.ar, {
    nc_title: 'الإشعارات', nc_bell: 'الإشعارات', nc_unread: '{n} غير مقروء', nc_none: 'لا يوجد شيء جديد.', nc_mark_all: 'تعليم الكل كمقروء', nc_dismiss: 'تجاهل',
    nc_late_tasks: 'مهام متأخرة: {n}', nc_late_payments: 'دفعات متأخرة: {n}', nc_plan: 'الباقة',
    nc_d0: 'أقل من يوم', nc_d1: 'يوم واحد', nc_dn: '{n} أيام',
    nc_trial: 'تنتهي تجربتك المجانية بعد {d}', nc_trial_over: 'انتهت تجربتك المجانية. اشترك لمتابعة استخدام الذكاء الاصطناعي.', nc_tokens80: 'استهلكت {pct}% من رموزك', nc_tokens100: 'وصلت إلى حد الرموز',
    nc_paid_3: 'ينتهي اشتراكك بعد {d}', nc_ended: 'انتهى اشتراكك', nc_tokens: 'الرموز المستخدمة', nc_billing: 'الفوترة والباقة', nc_failed: 'تعذر تحديث الإشعار.',
  });

  const S = { items: [], unread: 0, ok: null, at: 0, busy: false, tok: null };
  let pop = null, timer = 0, soon = 0;
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
    if (S.tok !== PM.state.token) { S.tok = PM.state.token; S.items = []; S.unread = 0; S.ok = null; S.at = 0; }
    if (!force && Date.now() - S.at < 25000) return;
    S.at = Date.now();
    try {
      const d = await PM.api('GET', '/api/notifications');
      S.ok = d.available !== false; S.items = d.items || []; S.unread = d.unread || 0;
      const off = !S.ok;
      if (off !== wasOff()) { flag(off); if (PM.billing) PM.billing.refresh(); }
    } catch (e) {
      // the server could not be reached: keep what the bell already showed and ask again soon, never mark the center as off
      if (e && e.network) { S.at = Date.now() - 20000; paintBell(); if (pop) paintPop(); return; }
      // the center answered with an error or does not exist (a demo, or a release without it): keep the plan ribbon
      S.ok = false; S.items = []; S.unread = 0;
      if (!wasOff()) { flag(true); if (PM.billing) PM.billing.refresh(); }
    }
    paintBell(); if (pop) paintPop();
  }
  async function act(kind, body) {
    if (S.busy) return; S.busy = true;
    try { await PM.api('POST', '/api/notifications/' + kind, body); await load(true); }
    catch (e) { PM.toast(e.message || t('nc_failed'), 'err'); }
    finally { S.busy = false; }
  }

  // ---------- the bell ----------
  function paintBell() {
    const slot = document.getElementById('ntSlot');
    const fab = document.getElementById('navShow');
    if (fab) { let b = fab.querySelector('.nt-badge'); if (S.unread && S.ok) { if (!b) { b = document.createElement('span'); b.className = 'nt-badge'; fab.appendChild(b); } b.textContent = S.unread > 9 ? '9+' : String(S.unread); } else if (b) b.remove(); }
    if (!slot) return;
    if (!S.ok) { slot.innerHTML = ''; return; }
    const label = S.unread ? `${t('nc_bell')}, ${t('nc_unread', { n: S.unread })}` : t('nc_bell');
    slot.innerHTML = `<button class="nt-bell" id="ntBell" type="button" aria-haspopup="dialog" aria-expanded="${pop ? 'true' : 'false'}" aria-label="${esc(label)}" data-tip="${esc(label)}">${icon('bell')}<span class="grow">${esc(t('nc_bell'))}</span>${S.unread ? `<span class="badge-count nt-count">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</button>`;
    document.getElementById('ntBell').onclick = (e) => { e.stopPropagation(); togglePop(); };
  }
  function itemHtml(x) {
    return `<div class="nc-item${x.read ? '' : ' unread'}"><a class="nc-main" href="${esc(linkOf(x))}" data-open="${esc(x.id)}"><span class="nc-ic ${warn(x) ? 'warn' : ''}">${icon(warn(x) ? 'alert' : 'spark')}</span><span class="nc-text"><b>${esc(titleOf(x))}</b><span class="small muted">${esc(textOf(x))}</span></span>${x.read ? '' : '<span class="nc-dot" aria-hidden="true"></span>'}</a><button class="btn ghost icon sm" type="button" data-dismiss="${esc(x.id)}" aria-label="${esc(t('nc_dismiss'))}" data-tip="${esc(t('nc_dismiss'))}">${icon('x')}</button></div>`;
  }
  function footer() {
    let pct = null; try { pct = PM.billing && PM.billing.info ? Math.min(100, Math.round(PM.billing.info().pct)) : null; } catch (e) { pct = null; }
    const meter = pct == null ? '' : `<div class="nc-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(t('nc_tokens'))}"><i style="width:${pct}%"></i></div><span class="small muted">${esc(t('nc_tokens'))}: ${pct}%</span>`;
    return `<div class="nc-foot">${meter}<a class="small" href="#/billing" data-close>${esc(t('nc_billing'))}</a></div>`;
  }
  function paintPop() {
    if (!pop) return;
    pop.innerHTML = `<div class="nc-head"><h3>${esc(t('nc_title'))}</h3>${S.unread ? `<button class="btn sm ghost" type="button" data-all>${esc(t('nc_mark_all'))}</button>` : ''}</div><div class="nc-list">${S.items.length ? S.items.map(itemHtml).join('') : `<div class="muted small nc-empty">${esc(t('nc_none'))}</div>`}</div>${footer()}`;
  }
  function closePop() { if (pop) { pop.remove(); pop = null; const b = document.getElementById('ntBell'); if (b) { b.setAttribute('aria-expanded', 'false'); b.setAttribute('data-tip', b.getAttribute('aria-label') || ''); b.focus({ preventScroll: true }); } } }
  function togglePop() {
    if (pop) return closePop();
    const bell = document.getElementById('ntBell'); if (!bell) return;
    pop = document.createElement('div'); pop.className = 'nc-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('nc_title'));
    document.body.appendChild(pop); paintPop();
    const r = bell.getBoundingClientRect(); const w = Math.min(380, window.innerWidth - 16);
    pop.style.width = w + 'px'; pop.style.top = Math.max(8, Math.min(r.top, window.innerHeight - 440)) + 'px'; pop.style.left = Math.max(8, Math.min(r.right + 8, window.innerWidth - w - 8)) + 'px';
    bell.setAttribute('aria-expanded', 'true'); bell.removeAttribute('data-tip');
    pop.addEventListener('click', (e) => {
      const d = e.target.closest('[data-dismiss]'); if (d) { e.preventDefault(); return act('dismiss', { id: d.dataset.dismiss }); }
      if (e.target.closest('[data-all]')) return act('read', { all: true });
      const o = e.target.closest('[data-open]'); if (o) { act('read', { id: o.dataset.open }); closePop(); return; }
      if (e.target.closest('[data-close]')) closePop();
    });
    load(true);
  }
  function mount() {
    paintBell();
    if (S.ok === null) load(true); else load(false);
  }
  function start() {
    document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('#ntBell'))) closePop(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) closePop(); });
    window.addEventListener('hashchange', () => { closePop(); clearTimeout(soon); soon = setTimeout(() => load(false), 900); });
    timer = setInterval(() => { if (!document.hidden) load(true); }, 90000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
  }
  PM.notify = { mount, refresh: () => load(true), unread: () => S.unread };
  start();
})();
