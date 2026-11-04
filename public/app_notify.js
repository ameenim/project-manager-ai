/* Analysis in the background.
   While documents are analyzed a small progress card stays on every screen, so the project manager can keep working.
   When the analysis ends a pop-up says the project is ready for review, with a button that opens it. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;

  Object.assign(PM.I18N.en, {
    nt_running: 'Analyzing documents', nt_view: 'View', nt_stage: 'Step', nt_hide: 'Hide',
    nt_ready_h: '{name} is ready for review', nt_ready_p: '{a} items were filled in for you and {b} need your review.',
    nt_review_now: 'Review now', nt_later: 'Later',
    nt_warn_h: '{name} needs your attention', nt_warn_p: 'The analysis finished with a problem. Open the project to see what happened and try again.',
    nt_open: 'Open project', nt_title_ready: 'Ready: {name}',
  });
  Object.assign(PM.I18N.ar, {
    nt_running: 'جار تحليل المستندات', nt_view: 'عرض', nt_stage: 'الخطوة', nt_hide: 'إخفاء',
    nt_ready_h: 'المشروع {name} جاهز للمراجعة', nt_ready_p: 'تمت تعبئة {a} عنصر تلقائيا و{b} عنصر بانتظار مراجعتك.',
    nt_review_now: 'راجع الآن', nt_later: 'لاحقا',
    nt_warn_h: 'المشروع {name} يحتاج إلى انتباهك', nt_warn_p: 'انتهى التحليل مع وجود مشكلة. افتح المشروع لترى ما حدث وحاول مرة أخرى.',
    nt_open: 'افتح المشروع', nt_title_ready: 'جاهز: {name}',
  });

  const running = new Map();   // project id to the latest progress event
  const cards = new Map();     // project id to a finished card (ready or needs attention)
  let baseTitle = document.title;

  function dock() {
    let d = document.getElementById('anDock');
    if (!d) { d = document.createElement('div'); d.id = 'anDock'; d.className = 'an-dock'; d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); }
    return d;
  }
  // The person is already looking at the results of this project, so no pop-up is needed.
  const looking = (id) => document.visibilityState === 'visible' && new RegExp(`#/p/${id}/review`).test(location.hash);

  function runCard(id, e) {
    const pct = Math.max(1, Math.min(99, e.pct || 1));
    const stage = e.stage ? t('stage_' + e.stage) : '';
    return `<div class="an-card running" data-an="${id}"><span class="spinner"></span><div class="grow"><b class="an-name">${esc(e.name || '')}</b><div class="small muted">${esc(t('nt_running'))}${stage ? ` · ${esc(stage)}` : ''} · ${pct}%</div><div class="progress"><i style="width:${pct}%"></i></div></div><a class="btn sm" href="#/p/${id}/review">${esc(t('nt_view'))}</a></div>`;
  }
  function doneCard(id, c) {
    const bad = c.failed || (c.warning && !c.filled);
    const head = bad ? t('nt_warn_h', { name: c.name }) : t('nt_ready_h', { name: c.name });
    const body = bad ? t('nt_warn_p') : t('nt_ready_p', { a: (c.filled && c.filled.confirmed) || 0, b: (c.filled && c.filled.review) || 0 });
    return `<div class="an-card ${bad ? 'warn' : 'ready'}" data-an-done="${id}"><span class="an-ic ${bad ? 'warn' : 'ok'}">${icon(bad ? 'x' : 'check')}</span><div class="grow"><b class="an-name">${esc(head)}</b><div class="small muted">${esc(body)}</div><div class="row gap" style="margin-top:10px"><a class="btn sm primary" href="#/p/${id}/review" data-go="${id}">${esc(bad ? t('nt_open') : t('nt_review_now'))}</a><button class="btn sm" type="button" data-close="${id}">${esc(t('nt_later'))}</button></div></div></div>`;
  }
  function paint() {
    const d = dock();
    const html = [...cards.entries()].map(([id, c]) => doneCard(id, c)).join('') + [...running.entries()].map(([id, e]) => runCard(id, e)).join('');
    d.innerHTML = html;
    d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => { cards.delete(Number(b.dataset.close)); resetTitle(); paint(); }));
    d.querySelectorAll('[data-go]').forEach((a) => (a.onclick = () => { cards.delete(Number(a.dataset.go)); resetTitle(); setTimeout(paint, 0); }));
    d.hidden = !html;
  }
  function resetTitle() { if (!cards.size) document.title = baseTitle; }

  window.addEventListener('pm:analysis', (ev) => {
    const e = ev.detail || {};
    const id = Number(e.id);
    if (!id) return;
    if (e.type === 'start') { cards.delete(id); running.set(id, e); }
    else if (e.type === 'progress') { if (running.has(id) || true) running.set(id, e); }
    else if (e.type === 'done') {
      running.delete(id);
      if (!looking(id)) {
        cards.set(id, e);
        if (!e.failed && !(e.warning && !e.filled)) { baseTitle = document.title.startsWith('✓') ? baseTitle : document.title; document.title = '✓ ' + t('nt_title_ready', { name: e.name }); }
        try { if (window.Notification && Notification.permission === 'granted' && document.visibilityState !== 'visible') new Notification(t('nt_ready_h', { name: e.name })); } catch (x) { /* optional */ }
      }
    }
    paint();
  });
  window.addEventListener('focus', resetTitle);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resetTitle(); });
  // Opening the results of a project clears its pop-up.
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/#\/p\/(\d+)\/review/);
    if (m && cards.has(Number(m[1]))) { cards.delete(Number(m[1])); resetTitle(); paint(); }
  });

  PM.analysisRunning = (id) => running.has(Number(id));
})();
