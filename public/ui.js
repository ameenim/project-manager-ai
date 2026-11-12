/* Shared motion layer for every page: pointer light on cards, sliding indicators for the sidebar and tabs, a circular reveal for the
   theme change, and one entrance per visit with count up numbers. Everything here is decoration, so the pages work without it.
   It only moves transform and opacity, skips touch pointers, and stands down under prefers-reduced-motion. */
(function () {
  'use strict';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = function () { return !!(mq && mq.matches); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- pointer light ---------- */
  var GLOW = '.card, .dw, .upd-stat, .feat, .ls-card, .glow';
  var raf = 0, last = null;
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var t = e.target; if (!t || !t.closest) return;
    var c = t.closest(GLOW); if (!c) return;
    last = { c: c, x: e.clientX, y: e.clientY };
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0; if (!last) return; var r = last.c.getBoundingClientRect();
      last.c.style.setProperty('--mx', (last.x - r.left) + 'px'); last.c.style.setProperty('--my', (last.y - r.top) + 'px');
    });
  }, { passive: true });

  /* ---------- sliding indicators ---------- */
  var memo = {};
  function track(key, container, active, axis) {
    var ind = $(':scope > .ui-ind', container);
    if (!active) { if (ind) ind.style.opacity = '0'; container.classList.remove('has-ind'); return; }
    var cr = container.getBoundingClientRect(), ar = active.getBoundingClientRect();
    var pos = axis === 'y' ? { p: ar.top - cr.top + container.scrollTop, s: ar.height } : { p: ar.left - cr.left + container.scrollLeft, s: ar.width };
    var made = false;
    if (!ind) { ind = document.createElement('span'); ind.className = 'ui-ind'; ind.setAttribute('aria-hidden', 'true'); container.insertBefore(ind, container.firstChild); made = true; }
    var set = function (v) { ind.style.opacity = '1'; if (axis === 'y') { ind.style.height = v.s + 'px'; ind.style.transform = 'translateY(' + v.p + 'px)'; } else { ind.style.width = v.s + 'px'; ind.style.transform = 'translateX(' + v.p + 'px)'; } };
    var prev = memo[key];
    if (made && prev && !reduced()) { ind.style.transition = 'none'; set(prev); void ind.offsetWidth; ind.style.transition = ''; }
    else if (made) ind.style.transition = 'none';
    set(pos); container.classList.add('has-ind');
    if (made && !(prev && !reduced())) requestAnimationFrame(function () { ind.style.transition = ''; });
    memo[key] = pos;
  }
  function place() {
    $$('.sidebar .nav').forEach(function (nav) { track('nav', nav, $('a.active', nav), 'y'); });
    $$('.proj-head .tabs').forEach(function (tabs) { var on = $('.tab.active', tabs); track('tabs', tabs, on, 'x'); if (on && tabs.scrollWidth > tabs.clientWidth + 2) tabs.scrollTo({ left: Math.max(0, on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2), behavior: reduced() ? 'auto' : 'smooth' }); });
  }
  var placeQ = 0;
  function schedule() { if (placeQ) return; placeQ = requestAnimationFrame(function () { placeQ = 0; place(); entrance(); }); }

  /* ---------- one entrance per visit and count up ---------- */
  var lastHash = null;
  function countUp(el) {
    var txt = el.textContent.trim(), m = txt.match(/^(-?)(\d[\d,]*)(\.\d+)?(%?)$/); if (!m) return;
    var dec = m[3] ? m[3].length - 1 : 0, to = parseFloat((m[2] + (m[3] || '')).replace(/,/g, '')), t0 = performance.now(), dur = 900, comma = m[2].indexOf(',') > -1;
    if (!isFinite(to) || to === 0 || to > 1e9) return;
    var fmt = function (v) { var s = v.toFixed(dec); if (comma) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); } return m[1] + s + m[4]; };
    (function step(now) { var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = p < 1 ? fmt(to * e) : txt; if (p < 1) requestAnimationFrame(step); })(t0);
  }
  function entrance() {
    var c = $('#content'); if (!c || c.dataset.ui) return;
    var items = $$('.page > .card, .page > .banner, .page-head, .upd-stat, .upd-guide, .page > .cht-card', c).filter(function (el) { return !el.closest('.dw-grid'); }).slice(0, 12);
    if (!items.length) return;
    c.dataset.ui = '1';
    var h = location.hash || '#/'; if (h === lastHash) return; lastHash = h;
    if (reduced()) return;
    items.forEach(function (el, i) { el.style.setProperty('--k', i); el.classList.add('ui-in'); });
    $$('.kpi .v', c).slice(0, 12).forEach(countUp);
    setTimeout(function () { items.forEach(function (el) { el.classList.remove('ui-in'); el.style.removeProperty('--k'); }); }, 1400);
  }

  /* ---------- theme reveal ---------- */
  var pendingTheme = false;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#themeBtn'); if (!b) return;
    var r = b.getBoundingClientRect(); root.style.setProperty('--vx', (r.left + r.width / 2) + 'px'); root.style.setProperty('--vy', (r.top + r.height / 2) + 'px');
    pendingTheme = true; setTimeout(function () { pendingTheme = false; }, 300);
  }, true);
  if (document.startViewTransition) {
    var orig = document.startViewTransition.bind(document);
    document.startViewTransition = function (cb) {
      var themed = pendingTheme; pendingTheme = false;
      if (themed) root.classList.add('vt-theme');
      var tr = orig(cb);
      if (themed && tr && tr.finished) tr.finished.then(function () { root.classList.remove('vt-theme'); }, function () { root.classList.remove('vt-theme'); });
      return tr;
    };
    // pages that switch the theme without a transition of their own (site and login)
    window.PMUI = { theme: function (apply) { if (reduced()) { apply(); return; } try { document.startViewTransition(apply); } catch (e) { apply(); } } };
  } else window.PMUI = { theme: function (apply) { apply(); } };

  /* ---------- wiring ---------- */
  var app = document.getElementById('app');
  if (app) {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { var n = list[i].target; if (!(n.classList && n.classList.contains('ui-ind'))) { schedule(); return; } }
    }).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  }
})();
