/* Usage tracker: tells the server which screens a project manager opens and which controls they use, so the super admin
   can see where the journey is smooth and where it is not. It sends screen and action names only. It never reads what
   people type or the names of their projects. Steps are batched and sent every few seconds and when the page is hidden.
   A failure here never reaches the person: every call is wrapped and the tracker stays silent. */
(function () {
  'use strict';
  const PM = window.PM = window.PM || {};
  const FLUSH = 12000, IDLE = 30 * 60e3, MAX = 60;
  let queue = [], cur = '', since = 0, visibleMs = 0, lastTick = 0, lastAt = Date.now(), sid = '', clicks = [];

  const safe = (fn) => function () { try { return fn.apply(this, arguments); } catch (e) { /* tracking never breaks the page */ } };
  const slug = (s) => String(s == null ? '' : s).toLowerCase().replace(/\d{3,}/g, '#').replace(/[^a-z0-9_:/.\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 48);
  const device = () => { const w = window.innerWidth || 1200; return w < 700 ? 'phone' : w < 1100 ? 'tablet' : 'desktop'; };

  function session() {
    const now = Date.now();
    if (!sid || now - lastAt > IDLE) {
      sid = '';
      try { const s = JSON.parse(sessionStorage.getItem('pm_sid') || 'null'); if (s && now - s.at <= IDLE) sid = s.id; } catch (e) { /* storage blocked */ }
      if (!sid) sid = Math.random().toString(36).slice(2, 10) + now.toString(36);
    }
    lastAt = now;
    try { sessionStorage.setItem('pm_sid', JSON.stringify({ id: sid, at: now })); } catch (e) { /* storage blocked */ }
    return sid;
  }

  function push(e) {
    e.t = Date.now(); queue.push(e);
    if (queue.length >= MAX) flush();
  }

  // which screen the hash shows, without ids or names
  function screenOf() {
    const parts = (location.hash.replace(/^#/, '').split('?')[0] || '/').split('/').filter(Boolean);
    if (!parts.length) return 'dashboard';
    if (parts[0] === 'p' && parts[1]) return 'project:' + slug(parts[2] && parts[2] !== 'trends' ? parts[2] : 'overview');
    if (parts[0] === 'widgets') return 'widgets';
    return slug(parts[0]) || 'dashboard';
  }

  function leave() {
    if (!cur) return;
    tick();
    push({ k: 'dwell', s: cur, ms: visibleMs });
  }
  function tick() {
    const now = Date.now();
    if (lastTick && !document.hidden) visibleMs += now - lastTick;
    lastTick = document.hidden ? 0 : now;
  }
  const enter = safe(function () {
    const next = screenOf();
    if (next === cur) return;
    session(); leave();
    cur = next; visibleMs = 0; lastTick = document.hidden ? 0 : Date.now(); since = Date.now();
    if (!vitScreen) vitScreen = cur;
    push({ k: 'view', s: cur });
  });

  // the control a click landed on, by its own tracking name, action name, id or label
  function targetOf(el) {
    const n = el && el.closest ? el.closest('[data-track],[data-act],button,a,[role=button],[role=tab],input[type=checkbox],select') : null;
    if (!n) return '';
    const name = n.getAttribute('data-track') || n.getAttribute('data-act') || n.id || n.getAttribute('aria-label') || n.getAttribute('data-tab') || '';
    if (!name && n.tagName === 'A') { const h = n.getAttribute('href') || ''; if (h.startsWith('#/')) return slug('link ' + h.slice(2).split('?')[0].replace(/\/\d+/g, '')); }
    if (!name) return '';
    const chat = n.closest('[class*="cht-"],#chtPanel,#chat') ? 'chat_' : '';
    return slug(chat + name);
  }
  const onClick = safe(function (ev) {
    const target = targetOf(ev.target); if (!target) return;
    session();
    const now = Date.now();
    push({ k: 'act', s: cur || screenOf(), a: target });
    clicks = clicks.filter((c) => now - c.t < 1000 && c.a === target); clicks.push({ t: now, a: target });
    if (clicks.length === 3) push({ k: 'rage', s: cur || screenOf(), a: target });
  });


  // ---------- real user speed ----------
  // The browser's own measures of how the first page load felt: when the first content showed (FCP), when the main content
  // showed (LCP), how much the layout jumped (CLS), the slowest response to a tap or click (INP) and how long the server took
  // to answer (TTFB). They are sent once, when the page is hidden or closed, as steps of kind "vital" with the first screen.
  // Nothing about the content of the page is read. A page opened in a background tab is skipped, because its timings measure
  // the tab and not the app.
  const vit = {};
  let vitSent = false, vitScreen = '', vitHidden = document.visibilityState === 'hidden' || !!document.prerendering, cls = 0, win = 0, winStart = 0, lastShift = 0;
  const inter = {};
  function watch(type, cb, extra) {
    try { const po = new PerformanceObserver((l) => { try { l.getEntries().forEach(cb); } catch (e) { /* ignore */ } }); po.observe(Object.assign({ type: type, buffered: true }, extra || {})); } catch (e) { /* not supported here */ }
  }
  watch('largest-contentful-paint', (e) => { vit.lcp = Math.round(e.startTime); });
  watch('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (e.startTime - lastShift > 1000 || e.startTime - winStart > 5000) { win = 0; winStart = e.startTime; }
    lastShift = e.startTime; win += e.value; if (win > cls) cls = win;
  });
  watch('event', (e) => { if (e.interactionId) { inter[e.interactionId] = Math.max(inter[e.interactionId] || 0, e.duration); vit.inp = Math.max(vit.inp || 0, Math.round(inter[e.interactionId])); } }, { durationThreshold: 40 });
  const sendVitals = safe(function () {
    if (vitSent || vitHidden) return;
    vitSent = true;
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.responseStart > 0) vit.ttfb = Math.round(nav.responseStart);
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]; if (fcp) vit.fcp = Math.round(fcp.startTime);
    } catch (e) { /* older browser */ }
    vit.cls = Math.round(cls * 1000);
    const at = vitScreen || cur || screenOf();
    for (const k of Object.keys(vit)) if (Number.isFinite(vit[k]) && (vit[k] > 0 || k === 'cls')) push({ k: 'vital', s: at, a: k, ms: vit[k] });
  });

  // called by the api wrapper for every request
  const endpoint = (path) => slug(String(path).split('?')[0].replace(/^\/api\//, '').replace(/\/\d+/g, '/:id').split('/').slice(0, 3).join('/'));
  const call = safe(function (path, ms, ok) {
    if (/^\/api\/usage/.test(path) || /^\/api\/auth\//.test(path)) return;
    if (!ok) push({ k: 'fail', s: cur, a: endpoint(path), ms: Math.round(ms) });
    else if (ms > 1500) push({ k: 'slow', s: cur, a: endpoint(path), ms: Math.round(ms) });
  });
  // a named step from the code itself, for moments a click does not describe
  const act = safe(function (name) { push({ k: 'act', s: cur || screenOf(), a: slug(name) }); });

  const flush = safe(function (final) {
    if (!queue.length) return;
    const token = PM.state && PM.state.token; if (!token) { queue = []; return; }
    const now = Date.now();
    const events = queue.splice(0, MAX).map((e) => ({ k: e.k, s: e.s, a: e.a, ms: e.ms, ago: now - e.t }));
    fetch('/api/usage', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'X-CSRF-Token': (PM.csrf ? PM.csrf() : '') }, credentials: 'same-origin', body: JSON.stringify({ sid: session(), device: device(), events }) }).catch(() => {});
    if (queue.length && !final) setTimeout(flush, 300);
  });

  PM.track = { call, act, flush, screen: enter, vitals: () => Object.assign({}, vit, { cls: Math.round(cls * 1000) / 1000 }) };
  window.addEventListener('hashchange', enter);
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', safe(() => { tick(); if (document.hidden) { sendVitals(); push({ k: 'dwell', s: cur, ms: visibleMs }); visibleMs = 0; flush(true); } else lastTick = Date.now(); }));
  window.addEventListener('pagehide', safe(() => { sendVitals(); leave(); flush(true); }));
  setInterval(flush, FLUSH);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enter); else setTimeout(enter, 0);
})();
