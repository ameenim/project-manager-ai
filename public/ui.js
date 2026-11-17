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
  /* project tabs: arrows and edge fades only where more tabs are hidden, wheel and drag scroll, no native scrollbar */
  function tabsState(wrap) {
    var tabs = $('.tabs', wrap); if (!tabs) return;
    var max = tabs.scrollWidth - tabs.clientWidth, pos = Math.abs(tabs.scrollLeft), rtl = getComputedStyle(tabs).direction === 'rtl';
    var over = max > 2, more = over && pos < max - 2, less = over && pos > 2;
    // scrollLeft is physical: in a right to left page the start is the right edge
    wrap.classList.toggle('can-l', rtl ? more : less);
    wrap.classList.toggle('can-r', rtl ? less : more);
    wrap.classList.toggle('is-over', over);
  }
  function tabsBind(wrap) {
    if (wrap.dataset.tb) return; wrap.dataset.tb = '1';
    var tabs = $('.tabs', wrap), step = function (dir) { tabs.scrollBy({ left: dir * Math.max(120, tabs.clientWidth * 0.7), behavior: reduced() ? 'auto' : 'smooth' }); };
    var upd = function () { tabsState(wrap); };
    tabs.addEventListener('scroll', upd, { passive: true });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { if (!wrap.isConnected) { ro.disconnect(); return; } upd(); }); ro.observe(tabs); }
    $$('.tabs-nav', wrap).forEach(function (b) { b.addEventListener('click', function () { step(b.classList.contains('nl') ? -1 : 1); }); });
    // a mouse wheel over the bar scrolls it sideways while there is more to see
    tabs.addEventListener('wheel', function (e) {
      if (!wrap.classList.contains('is-over') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      var max = tabs.scrollWidth - tabs.clientWidth, rtl = getComputedStyle(tabs).direction === 'rtl', pos = tabs.scrollLeft, d = e.deltaY;
      var lo = rtl ? -max : 0, hi = rtl ? 0 : max; // physical scroll range
      if ((d < 0 && pos <= lo + 1) || (d > 0 && pos >= hi - 1)) return; // already at that end: let the page scroll
      e.preventDefault(); tabs.scrollLeft = Math.min(hi, Math.max(lo, pos + d));
    }, { passive: false });
    // drag with a mouse, a click that ends a drag does not open a tab
    var down = null, moved = false;
    tabs.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse' || e.button !== 0 || !wrap.classList.contains('is-over')) return; down = { x: e.clientX, l: tabs.scrollLeft }; moved = false; });
    window.addEventListener('pointermove', function (e) { if (!down || !wrap.isConnected) return; var dx = e.clientX - down.x; if (!moved && Math.abs(dx) < 5) return; moved = true; wrap.classList.add('dragging'); tabs.scrollLeft = down.l - dx; });
    window.addEventListener('pointerup', function () { if (!down) return; down = null; wrap.classList.remove('dragging'); if (moved) setTimeout(function () { moved = false; }, 0); });
    tabs.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
    // keyboard focus on a hidden tab brings it into view
    tabs.addEventListener('focusin', function (e) { var a = e.target.closest && e.target.closest('.tab'); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); });
  }
  function place() {
    $$('.proj-head .tabs-wrap').forEach(function (w) { tabsBind(w); tabsState(w); });
    $$('.sidebar .nav').forEach(function (nav) { track('nav', nav, $('a.active', nav), 'y'); });
    $$('.proj-head .tabs').forEach(function (tabs) { var on = $('.tab.active', tabs); track('tabs', tabs, on, 'x'); var href = on ? on.getAttribute('href') : ''; var changed = tabs.dataset.centered !== href; tabs.dataset.centered = href; if (on && changed && tabs.scrollWidth > tabs.clientWidth + 2) tabs.scrollTo({ left: Math.max(0, on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2), behavior: reduced() ? 'auto' : 'smooth' }); });
  }
  /* phone tables turn into cards, so every cell carries its column name for the card label */
  function labelTables() {
    $$('table.t').forEach(function (tb) {
      var hr = tb.tHead && tb.tHead.rows[0]; if (!hr) return;
      var heads = [];
      for (var i = 0; i < hr.cells.length; i++) { var c = hr.cells[i], txt = (c.textContent || '').replace(/[\u25B2\u25BC\u2191\u2193]/g, '').replace(/\s+/g, ' ').trim(); for (var k = 0; k < (c.colSpan || 1); k++) heads.push(txt); }
      $$(':scope > tbody > tr:not([data-lb])', tb).forEach(function (tr) {
        tr.setAttribute('data-lb', '1'); var col = 0;
        for (var j = 0; j < tr.cells.length; j++) { var td = tr.cells[j]; if (!td.hasAttribute('data-label') && heads[col]) td.setAttribute('data-label', heads[col]); col += td.colSpan || 1; }
      });
    });
  }
  /* phone project header: everything above the tabs scrolls away and the tab bar stays, so the page keeps its room */
  function headUp() {
    var h = $('.proj-head'), tabs = h && ($('.tabs-wrap', h) || $('.tabs', h)); if (!h || !tabs) { document.documentElement.classList.remove('ph-stuck'); return; }
    var up = Math.max(0, tabs.offsetTop - 8); h.style.setProperty('--ph-up', up + 'px');
    document.documentElement.classList.toggle('ph-stuck', h.getBoundingClientRect().top <= -up + 1);
  }
  document.addEventListener('scroll', function () { headUp(); }, { passive: true, capture: true });
  var placeQ = 0;
  function schedule() { if (placeQ) return; placeQ = requestAnimationFrame(function () { placeQ = 0; place(); labelTables(); headUp(); entrance(); }); }

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


  /* ---------- heading levels ---------- */
  /* Screens style a card title as h3 while the page title is h1. Screen readers navigate by level, so a jump from h1 to h3 is a skipped level.
     This keeps the visual size of each heading and sets aria-level so levels follow the document order with no gaps.
     data-level on a heading overrides its natural level (the Thinking Area title is the page h1). */
  var HROOTS = '#content, .modal, .drawer, #chtPanel';
  var hq = 0;
  function fixHeadings() {
    hq = 0;
    $$(HROOTS).forEach(function (r) {
      var stack = [];
      $$('h1, h2, h3, h4, h5, h6, [role="heading"]', r).forEach(function (h) {
        if (!h.offsetParent && getComputedStyle(h).position !== 'fixed') return;
        var nat = +(h.getAttribute('data-level') || (h.tagName.charAt(0) === 'H' ? h.tagName.charAt(1) : h.getAttribute('aria-level')) || 2);
        while (stack.length && stack[stack.length - 1] >= nat) stack.pop();
        stack.push(nat);
        var eff = stack.length, tag = h.tagName.charAt(0) === 'H' ? +h.tagName.charAt(1) : 0;
        if (eff !== tag) { if (h.getAttribute('aria-level') !== String(eff)) h.setAttribute('aria-level', String(eff)); }
        else if (h.hasAttribute('aria-level') && tag) h.removeAttribute('aria-level');
      });
    });
  }
  function scheduleHeadings() { if (hq) return; hq = setTimeout(fixHeadings, 120); }
  new MutationObserver(scheduleHeadings).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', scheduleHeadings);
  scheduleHeadings();

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
