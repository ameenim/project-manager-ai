/* Project Manager AI site script. Shared by the landing page and the login page. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var APP_URL = 'app.html';
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; }

  /* ---------- theme ---------- */
  var saved = store('pmai_theme');
  if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  var themeBtn = $('#themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme');
    if (!cur) cur = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var next = cur === 'dark' ? 'light' : 'dark';
    var apply = function () { root.setAttribute('data-theme', next); store('pmai_theme', next); };
    var r = themeBtn.getBoundingClientRect(); root.style.setProperty('--vx', (r.left + r.width / 2) + 'px'); root.style.setProperty('--vy', (r.top + r.height / 2) + 'px');
    if (window.PMUI && document.startViewTransition) { root.classList.add('vt-theme'); try { var tr = document.startViewTransition(apply); tr.finished.then(function () { root.classList.remove('vt-theme'); }, function () { root.classList.remove('vt-theme'); }); } catch (e) { root.classList.remove('vt-theme'); apply(); } } else apply();
  });

  /* ---------- header, progress, back to top, active nav ---------- */
  var header = $('.site-header');
  var progress = $('#progress');
  var toTop = $('#toTop');
  var navLinks = $$('#nav a[href^="#"]');
  var sections = ['how', 'features', 'product', 'reports', 'faq'].map(function (id) { return document.getElementById(id); }).filter(Boolean);
  var ticking = false;
  function onScroll() {
    ticking = false;
    if (window.__pxu) window.__pxu();
    var y = window.scrollY || root.scrollTop || 0;
    var max = Math.max(1, root.scrollHeight - window.innerHeight);
    var p = Math.min(1, Math.max(0, y / max));
    if (header) header.classList.toggle('scrolled', y > 8);
    if (progress) progress.style.setProperty('--p', p.toFixed(4));
    if (toTop) { toTop.classList.toggle('show', y > 560); toTop.style.setProperty('--sp', p.toFixed(4)); }
    if (navLinks.length && sections.length) {
      var cut = (header ? header.offsetHeight : 70) + 140, current = null;
      sections.forEach(function (s) { if (s.getBoundingClientRect().top <= cut) current = s.id; });
      navLinks.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + current); });
    }
  }
  function requestTick() { if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); } }
  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', requestTick);
  onScroll();
  if (toTop) toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    toTop.blur();
  });

  /* ---------- mobile menu ---------- */
  var menuBtn = $('#menuBtn'), nav = $('#nav');
  function setMenu(open) {
    if (!menuBtn || !nav) return;
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    var use = menuBtn.querySelector('use'); if (use) use.setAttribute('href', open ? '#i-x' : '#i-menu');
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 960) setMenu(false); });
  }

  /* ---------- reveal on scroll ---------- */
  var vh = window.innerHeight || 800;
  function markIn(el) {
    el.classList.add('in');
    window.setTimeout(function () { el.classList.add('done'); }, 700 + (parseInt(getComputedStyle(el).getPropertyValue('--i'), 10) || 0) * 80 + 60);
  }
  var revealEls = $$('.rv');
  if (!('IntersectionObserver' in window) || reduce) {
    revealEls.forEach(function (el) { el.classList.add('in', 'done'); });
  } else {
    revealEls.forEach(function (el) { if (el.getBoundingClientRect().top < vh * 0.92) markIn(el); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { markIn(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { if (!el.classList.contains('in')) io.observe(el); });
  }
  $$('[data-reveal-now]').forEach(function (el) {
    if (reduce) { el.classList.add('in'); return; }
    window.setTimeout(function () { el.classList.add('in'); }, 250);
  });

  /* ---------- parallax ---------- */
  (function () {
    var items = $$('[data-p]');
    if (!items.length) return;
    var on = !reduce && window.innerWidth >= 961, info = [];
    function measure() {
      on = !reduce && window.innerWidth >= 961;
      var sy = window.scrollY || 0;
      info = items.map(function (el) {
        var cur = parseFloat(el.style.getPropertyValue('--py')) || 0;
        var r = el.getBoundingClientRect();
        return { el: el, f: parseFloat(el.getAttribute('data-p')) || 0, c: r.top + sy + r.height / 2 - cur };
      });
      update();
    }
    function update() {
      var sy = window.scrollY || 0, mid = sy + (window.innerHeight || 800) / 2;
      info.forEach(function (o) {
        if (!on) { o.el.style.setProperty('--py', '0px'); return; }
        var d = Math.max(-900, Math.min(900, o.c - mid));
        o.el.style.setProperty('--py', (-d * o.f).toFixed(1) + 'px');
      });
    }
    window.__pxu = update;
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    window.setTimeout(measure, 600);
    measure();
  })();

  /* ---------- hover: spotlight and tilt (mouse only) ---------- */
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduce) {
    document.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.feat, .card, .fact, .step, .who, .ex-row, .fmt-grid > *, .upd');
      var d = e.target.closest && e.target.closest('.dash');
      if (d) {
        var q = d.getBoundingClientRect();
        d.style.setProperty('--ry', (((e.clientX - q.left) / q.width - 0.5) * 6).toFixed(2) + 'deg');
        d.style.setProperty('--rx', (-((e.clientY - q.top) / q.height - 0.5) * 5).toFixed(2) + 'deg');
      }
    }, { passive: true });
    $$('.dash').forEach(function (d) {
      d.addEventListener('pointerleave', function () { d.style.setProperty('--rx', '0deg'); d.style.setProperty('--ry', '0deg'); });
    });
  }

  /* ---------- count up ---------- */
  function fmt(v, dec) { return dec ? v.toFixed(dec) : String(Math.round(v)); }
  function runCount(el) {
    var target = parseFloat(el.getAttribute('data-count')), dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    if (reduce) { el.textContent = fmt(target, dec); return; }
    var start = null, dur = 1100;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(target * e, dec);
      if (t < 1) window.requestAnimationFrame(step); else el.textContent = fmt(target, dec);
    }
    window.requestAnimationFrame(step);
  }
  var counters = $$('[data-count]');
  if (!reduce && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { cio.unobserve(en.target); runCount(en.target); } });
    }, { threshold: 0.6 });
    counters.forEach(function (el) {
      el.textContent = fmt(0, parseInt(el.getAttribute('data-dec') || '0', 10));
      cio.observe(el);
    });
  }

  /* ---------- FAQ ---------- */
  $$('.q button').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = b.closest('.q'), open = !q.classList.contains('open');
      $$('.q.open').forEach(function (o) { o.classList.remove('open'); o.querySelector('button').setAttribute('aria-expanded', 'false'); });
      if (open) { q.classList.add('open'); b.setAttribute('aria-expanded', 'true'); }
    });
  });

  /* ---------- updates demo ---------- */
  var updBox = $('#updDemo');
  if (updBox) {
    var count = $('#updCount');
    var doneHtml = function (txt, btn) { return '<svg class="ico sm"><use href="#i-check"/></svg>' + txt + ' <button class="mini-btn" type="button" data-undo style="margin-inline-start:8px">' + btn + '</button>'; };
    var refresh = function () {
      var n = $$('[data-upd]', updBox).filter(function (r) { return !r.classList.contains('applied'); }).length;
      count.textContent = n ? n + ' waiting' : 'All caught up';
      count.className = 'chip ' + (n ? 'info' : 'ok');
    };
    updBox.addEventListener('click', function (e) {
      var row = e.target.closest('[data-upd]'); if (!row) return;
      var done = $('.done', row);
      if (e.target.closest('[data-apply]')) { row.classList.remove('dismissed'); row.classList.add('applied'); done.innerHTML = doneHtml('Applied', 'Undo'); }
      else if (e.target.closest('[data-dismiss]')) { row.classList.add('applied', 'dismissed'); done.innerHTML = doneHtml('Dismissed', 'Restore'); }
      else if (e.target.closest('[data-undo]')) { row.classList.remove('applied', 'dismissed'); }
      else return;
      refresh();
    });
  }

  /* ---------- charts ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, anchor, cls) { var t = el('text', { x: x, y: y, 'text-anchor': anchor || 'middle' }, parent); if (cls) t.setAttribute('class', cls); t.textContent = str; return t; }

  var L = 40, R = 468, T = 14, B = 206;
  function frame(svg, ticks, max, xLabels) {
    ticks.forEach(function (v) {
      var y = B - (v / max) * (B - T);
      el('line', { x1: L, x2: R, y1: y, y2: y, 'class': v === 0 ? 'axis' : 'grid' }, svg);
      text(svg, L - 8, y + 4, String(v), 'end');
    });
    xLabels.forEach(function (s) { text(svg, s.x, B + 20, s.t, 'middle'); });
  }

  var lineBox = $('#lineChart');
  if (lineBox) {
    var svg = el('svg', { viewBox: '0 0 480 244', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, lineBox);
    var plan = [8, 18, 30, 44, 58, 72, 86, 100], actual = [7, 17, 28, 41, 55, 68];
    var step = (R - L) / 7, X = function (i) { return L + i * step; }, Y = function (v) { return B - v / 100 * (B - T); };
    var labels = plan.map(function (_, i) { return { x: X(i), t: 'M' + (i + 1) }; });
    frame(svg, [0, 25, 50, 75, 100], 100, labels);
    el('path', { 'class': 'line-p', d: plan.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('') }, svg);
    var d = actual.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('');
    el('path', { 'class': 'area', d: d + 'L' + X(5).toFixed(1) + ' ' + B + 'L' + X(0).toFixed(1) + ' ' + B + 'Z' }, svg);
    var line = el('path', { 'class': 'line-a', d: d }, svg);
    try { var len = Math.ceil(line.getTotalLength()) + 2; line.style.setProperty('--len', len); } catch (e) { /* length unavailable */ }
    el('circle', { 'class': 'endpt', cx: X(5), cy: Y(68), r: 5 }, svg);
    var l1 = text(svg, X(5), Y(72) - 12, 'Plan 72%', 'middle', 'lbl');
    var l2 = text(svg, X(5), Y(68) + 24, 'Actual 68%', 'middle', 'lbl'); l2.style.fill = 'var(--primary)'; l2.style.fontWeight = '600';
  }

  var barBox = $('#barChart');
  if (barBox) {
    var s2 = el('svg', { viewBox: '0 0 480 244', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, barBox);
    var data = [{ q: 'Q1', p: 420, i: 80, u: 0 }, { q: 'Q2', p: 380, i: 140, u: 60 }, { q: 'Q3', p: 300, i: 200, u: 150 }, { q: 'Q4', p: 120, i: 160, u: 320 }];
    var MAX = 700, bw = 58, cs = (R - L) / data.length;
    var yv = function (v) { return (v / MAX) * (B - T); };
    frame(s2, [0, 200, 400, 600], MAX, data.map(function (r, k) { return { x: L + cs * k + cs / 2, t: r.q }; }));
    data.forEach(function (r, k) {
      var cx = L + cs * k + cs / 2, x = cx - bw / 2, y = B;
      var grp = el('g', { 'class': 'bar' }, s2);
      grp.style.setProperty('--i', k);
      [['p', 'bar-p'], ['i', 'bar-i'], ['u', 'bar-u']].forEach(function (seg) {
        var v = r[seg[0]]; if (!v) return;
        var h = yv(v); y -= h;
        el('rect', { x: x, y: y.toFixed(1), width: bw, height: h.toFixed(1), rx: 2, 'class': seg[1] }, grp);
      });
      text(s2, cx, y - 7, String(r.p + r.i + r.u), 'middle', 'lbl');
    });
  }

  /* ---------- login page ---------- */
  var form = $('#authForm');
  if (form) {
    var mode = 'in', notice = '';
    try { notice = sessionStorage.getItem('pm_notice') || ''; sessionStorage.removeItem('pm_notice'); } catch (e) { /* storage blocked */ }
    // A reset link looks like login.html#reset=<64 characters>. The token is taken out of the address bar at once, so it does
    // not stay in the history, and it is sent only to /api/auth/reset.
    var resetToken = '';
    function takeReset() {
      var m = location.hash.match(/^#reset=([0-9a-f]{64})$/);
      if (!m) return false;
      resetToken = m[1];
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      return true;
    }
    takeReset();
    var tabIn = $('#tabIn'), tabUp = $('#tabUp'), title = $('#authTitle'), sub = $('#authSub'), submit = $('#submitBtn');
    var nameF = $('#fName'), emailF = $('#fEmail'), passF = $('#fPass'), okBox = $('#okPanel'), card = $('#formBody');
    function setMode(m) {
      mode = m;
      var isReset = m === 'reset';
      var tabs = $('.tabs', card); if (tabs) tabs.hidden = isReset;
      var forgot = $('#forgotNote'); if (forgot) forgot.hidden = m !== 'in';
      emailF.hidden = isReset;
      tabIn.setAttribute('aria-selected', m === 'in'); tabUp.setAttribute('aria-selected', m === 'up');
      tabIn.tabIndex = m === 'in' ? 0 : -1; tabUp.tabIndex = m === 'up' ? 0 : -1;
      nameF.hidden = m !== 'up';
      title.textContent = isReset ? 'Choose a new password' : m === 'in' ? 'Welcome back' : 'Start your free trial';
      sub.textContent = isReset ? 'This link works once and stops working 30 minutes after it was made.' : m === 'in' ? (notice || 'Sign in to your project workspace.') : '15 days free. No card needed.';
      submit.textContent = isReset ? 'Set new password' : m === 'in' ? 'Sign in' : 'Create account';
      passF.querySelector('input').autocomplete = m === 'in' ? 'current-password' : 'new-password';
      $('label', passF).textContent = isReset ? 'New password' : 'Password';
      okBox.hidden = true; card.hidden = false;
      clearErrors();
    }
    function fieldErr(f, msg) { f.classList.toggle('bad', !!msg); var inp = $('input', f); inp.setAttribute('aria-invalid', msg ? 'true' : 'false'); $('.err', f).textContent = msg || ''; }
    function clearErrors() { [nameF, emailF, passF].forEach(function (f) { fieldErr(f, ''); }); }
    function hashMode() { return location.hash === '#create' ? 'up' : 'in'; }
    setMode(resetToken ? 'reset' : hashMode());
    // a reset link opened in a tab that already shows this page only changes the hash, so it is picked up here too
    window.addEventListener('hashchange', function () { if (takeReset()) { setMode('reset'); return; } if (mode !== 'reset') setMode(hashMode()); });
    tabIn.addEventListener('click', function () { setMode('in'); location.hash = 'signin'; });
    tabUp.addEventListener('click', function () { setMode('up'); location.hash = 'create'; });
    [tabIn, tabUp].forEach(function (t) { t.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { (mode === 'in' ? tabUp : tabIn).click(); (mode === 'in' ? tabIn : tabUp).focus(); } }); });
    var eye = $('#eyeBtn');
    eye.addEventListener('click', function () {
      var inp = $('input', passF), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    var submitting = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      if (mode === 'reset') {
        var np = $('input', passF).value;
        if (np.length < 8) { fieldErr(passF, 'Use at least 8 characters.'); return; }
        submitting = true; submit.disabled = true;
        fetch('/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: np }) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) { fieldErr(passF, (res.d && res.d.error) || 'The password could not be changed. Try again.'); return; }
            resetToken = ''; $('input', passF).value = ''; notice = 'Your password was changed. Sign in with the new password.'; setMode('in');
          })
          .catch(function () { fieldErr(passF, 'Could not reach the server. Check your connection and try again.'); })
          .then(function () { submitting = false; submit.disabled = false; });
        return;
      }
      var bad = false;
      if (mode === 'up' && !$('input', nameF).value.trim()) { fieldErr(nameF, 'Enter your name.'); bad = true; } else fieldErr(nameF, '');
      var em = $('input', emailF).value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { fieldErr(emailF, 'Enter a valid email address, for example name@company.com.'); bad = true; } else fieldErr(emailF, '');
      if ($('input', passF).value.length < 8) { fieldErr(passF, 'Use at least 8 characters.'); bad = true; } else fieldErr(passF, '');
      if (bad) { var first = $('.bad input', form); if (first) first.focus(); return; }
      submitting = true; submit.disabled = true;
      var label = submit.textContent; submit.textContent = 'Please wait';
      fetch('/api/auth/' + (mode === 'in' ? 'login' : 'register'), {
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Session-Mode': 'cookie' },
        body: JSON.stringify({ name: $('input', nameF).value.trim(), email: em, password: $('input', passF).value }),
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (res) {
          if (!res.ok) {
            var msg = (res.d && res.d.error) || (res.status === 404 || res.status === 405 || res.status === 501
              ? 'The server is running an older version of the app. Stop and run the app again, then retry.'
              : 'The server did not answer correctly (HTTP ' + res.status + '). Check that the app is running and the database is connected, then retry.');
            if (res.status === 409) fieldErr(emailF, msg); else fieldErr(passF, msg);
            return;
          }
          var saved = false;
          try { localStorage.removeItem('pm_token'); localStorage.setItem('pm_signed', '1'); localStorage.setItem('pm_session', JSON.stringify({ id: res.d.user.id, name: res.d.user.name, email: res.d.user.email })); saved = localStorage.getItem('pm_signed') === '1'; } catch (er) { /* checked below */ }
          if (!saved) { fieldErr(passF, 'Your browser is blocking storage, so you cannot stay signed in.'); return; }
          showOk();
        })
        .catch(function () { fieldErr(passF, 'Could not reach the server. Check your connection and try again.'); })
        .then(function () { submitting = false; submit.disabled = false; submit.textContent = label; });
    });
    function showOk() {
      card.hidden = true; okBox.hidden = false;
      $('#okTitle').textContent = mode === 'in' ? 'You are ready to go' : 'Your trial is ready to start';
      $('#okText').textContent = mode === 'in' ? 'Open Project Manager AI to continue to your workspace.' : 'Your 15 day free trial starts in the app. Continue to open it.';
      var link = $('#okLink'); link.href = APP_URL; link.focus();
    }
    $('#backToForm').addEventListener('click', function () { okBox.hidden = true; card.hidden = false; });
  }
})();
