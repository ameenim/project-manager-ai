/* Project Manager AI landing page: the scroll morph story and the screen gallery.
   One sticky stage holds a window with the real product screens. The window, the small cards, the shapes and the
   colors morph from chapter to chapter while the page scrolls. Works left to right and right to left. */
(function () {
  'use strict';
  var root = document.documentElement;
  var stage = document.getElementById('lsStage');
  var story = document.getElementById('how');
  if (!stage || !story) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var frame = document.getElementById('lsFrame');
  var shotsEl = document.getElementById('lsShots');
  var satsEl = document.getElementById('lsSats');
  var rail = document.getElementById('lsRail');
  var hint = document.getElementById('lsHint');
  var texts = Array.prototype.slice.call(stage.querySelectorAll('.ls-ch'));
  var lbls = Array.prototype.slice.call(stage.querySelectorAll('.ls-lbls span'));
  var N = texts.length;
  var shapes = [document.getElementById('lsS1'), document.getElementById('lsS2'), document.getElementById('lsS3')];
  var blobs = [document.getElementById('lsB1'), document.getElementById('lsB2')];

  /* size of each screen image, so the window keeps the right shape before the files arrive */
  var META = { hero: [1300, 812], review: [1100, 725], gantt: [1300, 520], inbox: [1000, 831], thinking: [1000, 786], reports: [1100, 483], closure: [1100, 752], meeting: [640, 1046], risk: [1100, 570], widgets: [1100, 752],
    s_sugg: [760, 211], s_stats: [760, 83], s_matrix: [420, 451], s_keys: [760, 90], s_think: [520, 172], notif: [480, 638] };
  /* window position (center x, center y), tilt and turn for each chapter, as fractions of the stage */
  var W = [.6, .54, .62, .4, .25, .45, .58, .55, .42, .88];
  var FR = [[.64, .52, -12, 4, 0], [.67, .5, -8, 2, 0], [.66, .5, 6, 0, -1], [.70, .5, -10, 0, 2], [.73, .5, 12, 0, -3], [.69, .5, -6, 0, 1], [.66, .5, 8, 0, 0], [.67, .5, -6, 0, -1], [.70, .5, 10, 0, 1.5], [.5, .6, 0, 0, 0]];
  /* small cards that fly out of the window in their own chapter (D desktop, M mobile) */
  var SATS = [
    { k: 's_keys', c: 0, D: { x: .55, y: .85, w: .28, r: -2 }, M: { x: .5, y: .9, w: .86, r: 0 } },
    { k: 's_stats', c: 1, D: { x: .46, y: .17, w: .27, r: -3 }, M: { x: .5, y: .9, w: .8, r: 0 } },
    { k: 's_sugg', c: 3, D: { x: .5, y: .8, w: .26, r: -3 }, M: { x: .5, y: .9, w: .8, r: -2 } },
    { k: 's_think', c: 5, D: { x: .47, y: .82, w: .22, r: 2 }, M: { x: .5, y: .9, w: .7, r: 2 } },
    { k: 'notif', c: 6, D: { x: .48, y: .8, w: .13, r: -3 }, M: { x: .15, y: .84, w: .28, r: -3 } },
    { k: 's_matrix', c: 6, D: { x: .93, y: .8, w: .12, r: 3 }, M: { x: .86, y: .84, w: .26, r: 3 } }
  ];
  var RADS = ['50%', '22%', '50% 20% 50% 20%', '36%', '50%', '14%', '50% 30%', '28%', '50%', '18%'];

  var chapters = texts.map(function (el) {
    var a = (el.getAttribute('data-acc') || '36,87,214').split(',').map(Number);
    return { img: el.getAttribute('data-img'), acc: a };
  });
  var S = { w: 1, h: 1, vh: 1, mob: false, rtl: false };
  var STEP = 1, top0 = 0, cur = 0, tgt = 0, mx = 0, my = 0, tmx = 0, tmy = 0, lastKey = '', last = 0;

  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a === undefined ? 0 : a, v)); };
  var sm = function (t) { return t * t * (3 - 2 * t); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* build the screens and the small cards */
  chapters.forEach(function (c, i) {
    var im = document.createElement('img');
    im.setAttribute('data-shot', c.img); im.alt = ''; im.decoding = 'async';
    if (i > 1) im.loading = 'lazy';
    shotsEl.appendChild(im);
  });
  SATS.forEach(function (s) {
    var d = document.createElement('div'); d.className = 'ls-sat';
    var im = document.createElement('img'); im.setAttribute('data-shot', s.k); im.alt = ''; im.decoding = 'async'; im.loading = 'lazy';
    d.appendChild(im); satsEl.appendChild(d); s.el = d; s.img = im;
  });
  var railBtns = [];
  chapters.forEach(function (c, i) {
    var b = rail.querySelector('button[data-i="' + i + '"]');
    if (b) { railBtns.push(b); b.addEventListener('click', function () { goto(i); }); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.addEventListener('click', function () { goto(+b.getAttribute('data-go')); }); });
  if (window.PMShots) window.PMShots.apply();

  function measure() {
    S.w = stage.clientWidth; S.h = stage.clientHeight; S.vh = window.innerHeight;
    S.mob = S.w < 900 || S.w / S.h < .95; S.rtl = root.dir === 'rtl';
    STEP = S.h * .85;
    story.style.height = Math.round((N - 1) * STEP + S.h) + 'px';
    top0 = story.getBoundingClientRect().top + (window.scrollY || root.scrollTop || 0) - 60;
  }
  function ratio(img) { var m = META[img]; return m[0] / m[1]; }
  function frameKey(i) {
    var f = FR[i], w = W[i], cx = f[0], cy = f[1], hm = .8, ry = f[2], rot = f[4], capw = i === 9 ? 1500 : 1180;
    if (S.mob) {
      w = i === 4 ? .5 : .9; cx = .5; cy = i === 9 ? .62 : .64; hm = .5; ry = ry * .4; capw = 99999;
    } else if (i === 9) { hm = .6; cy = .68; }
    else { w = Math.min(w, .54); cx = Math.min(.98 - w / 2, Math.max(cx, .44 + w / 2)); }
    if (S.rtl) { cx = 1 - cx; ry = -ry; rot = -rot; }
    return { cx: cx, cy: cy, w: w, A: ratio(chapters[i].img), hm: hm, ry: ry, rx: f[3], rot: rot, rad: i === 4 ? 36 : 22, capw: capw };
  }
  function satKey(s, j) {
    var F = frameKey(j), P = S.mob ? s.M : s.D;
    if (j === s.c) return { x: S.rtl ? 1 - P.x : P.x, y: P.y, w: P.w, r: S.rtl ? -P.r : P.r, a: 1 };
    return { x: F.cx, y: F.cy, w: P.w * .4, r: 0, a: 0 };
  }
  function tt(frac, stag) {
    if (reduce) return frac < .5 ? 0 : 1;
    return sm(clamp((frac - .2 - stag * .1) / .5));
  }
  function accAt(p) {
    var i = clamp(Math.floor(p), 0, N - 2), f = p - i, t = sm(clamp((f - .2) / .5));
    return chapters[i].acc.map(function (v, k) { return Math.round(lerp(v, chapters[i + 1].acc[k], t)); });
  }

  function render() {
    var p = cur, i0 = clamp(Math.floor(p), 0, N - 2), fr = p - i0, sw = S.w, sh = S.h;
    var tf = tt(fr, 0), pf = i0 + tf;
    var a = frameKey(i0), b = frameKey(i0 + 1);
    var g = function (k) { return lerp(a[k], b[k], tf); };
    var wpx = Math.min(g('w') * sw, g('capw')), A = g('A'), h = wpx / A + 26;
    var hmax = g('hm') * sh;
    if (h > hmax) { h = hmax; wpx = (h - 26) * A; }
    var cx = g('cx') * sw, cy = g('cy') * sh;
    var ry = g('ry') + mx * 3, rx = g('rx') - my * 2, rot = g('rot');
    frame.style.width = wpx + 'px'; frame.style.height = h + 'px'; frame.style.borderRadius = Math.max(8, g('rad')) + 'px';
    frame.style.transform = 'translate3d(' + (cx - wpx / 2) + 'px,' + (cy - h / 2) + 'px,0) perspective(1500px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) rotateZ(' + rot + 'deg)';
    for (var i = 0; i < shotsEl.children.length; i++) shotsEl.children[i].style.opacity = clamp(1 - Math.abs(pf - i));

    SATS.forEach(function (s, n) {
      var t = tt(fr, .4 + n * .12), A1 = satKey(s, i0), B1 = satKey(s, i0 + 1);
      var x = lerp(A1.x, B1.x, t) * sw, y = lerp(A1.y, B1.y, t) * sh, w = lerp(A1.w, B1.w, t) * sw, r = lerp(A1.r, B1.r, t);
      var al = clamp(lerp(A1.a, B1.a, t));
      var ar = s.img.naturalWidth ? s.img.naturalHeight / s.img.naturalWidth : META[s.k][1] / META[s.k][0];
      var hh = w * ar;
      s.el.style.width = w + 'px'; s.el.style.opacity = al; s.el.style.visibility = al > .01 ? 'visible' : 'hidden';
      s.el.style.transform = 'translate3d(' + (x - w / 2 + mx * 8 * (n % 2 ? 1 : -1)) + 'px,' + (y - hh / 2) + 'px,0) rotate(' + r + 'deg)';
    });

    shapes.forEach(function (el, n) {
      var t = tt(fr, .2 + n * .25);
      var sk = function (j) {
        var F = frameKey(j), side = [[-1, -1], [1, 1], [-1, .9]][n], dir = S.rtl ? -1 : 1;
        var sz = [110, 150, 80][n] * (S.mob ? .6 : 1);
        return { x: (F.cx + side[0] * dir * F.w * .5) * sw, y: F.cy * sh + side[1] * Math.min(h, sh * .8) * .5, s: sz * (1 + .25 * Math.sin(j * 1.7 + n)), r: (j * 37 + n * 50) % 360 };
      };
      var A2 = sk(i0), B2 = sk(i0 + 1), x = lerp(A2.x, B2.x, t), y = lerp(A2.y, B2.y, t), s = lerp(A2.s, B2.s, t), r = lerp(A2.r, B2.r, t);
      el.style.width = s + 'px'; el.style.height = s + 'px'; el.style.borderRadius = t < .5 ? RADS[i0] : RADS[i0 + 1];
      el.style.transform = 'translate3d(' + (x - s / 2) + 'px,' + (y - s / 2) + 'px,0) rotate(' + r + 'deg)';
      el.style.opacity = i0 + tf > 8.5 ? clamp(9 - (i0 + tf)) : .9;
    });

    var acc = accAt(p); stage.style.setProperty('--acc', acc.join(','));
    blobs.forEach(function (el, n) {
      var F = frameKey(i0), G = frameKey(i0 + 1);
      var bx = lerp(F.cx, G.cx, tf) * sw + (n ? sw * .18 : -sw * .2), by = lerp(F.cy, G.cy, tf) * sh + (n ? sh * .25 : -sh * .2);
      var sz = Math.max(sw, sh) * (n ? .5 : .62);
      el.style.width = el.style.height = sz + 'px'; el.style.background = 'rgba(' + acc.join(',') + ',' + (n ? .2 : .26) + ')';
      el.style.transform = 'translate3d(' + (bx - sz / 2) + 'px,' + (by - sz / 2) + 'px,0)';
    });

    var pt = i0 + tt(fr, 0);
    texts.forEach(function (el, i) {
      var d = pt - i, al = clamp(1 - Math.abs(d) * 2), center = el.classList.contains('center');
      el.style.opacity = al; el.style.visibility = al > .02 ? 'visible' : 'hidden';
      el.style.transform = (S.mob || center) ? 'translateY(' + (d * -36) + 'px)' : 'translateY(calc(-50% + ' + (d * -36) + 'px))';
      el.style.filter = al < 1 ? 'blur(' + ((1 - al) * 6) + 'px)' : 'none';
      el.classList.toggle('on', al > .6);
    });
    var act = Math.round(pt);
    railBtns.forEach(function (bn, i) { bn.classList.toggle('a', i === act); bn.setAttribute('aria-current', i === act ? 'true' : 'false'); });
    lbls.forEach(function (l, i) { l.classList.toggle('a', i === act); });
    if (hint) hint.style.opacity = p < .3 ? 1 : 0;
  }

  function goto(i) {
    window.scrollTo({ top: top0 + i * STEP + 2, behavior: reduce ? 'auto' : 'smooth' });
  }
  function loop(now) {
    var dt = Math.min(.05, (now - last) / 1000); last = now;
    tgt = clamp(((window.scrollY || root.scrollTop || 0) - top0) / STEP, 0, N - 1);
    var k = reduce ? 1 : 1 - Math.exp(-dt * 7);
    cur += (tgt - cur) * k;
    if (Math.abs(tgt - cur) < .0004) cur = tgt;
    mx += (tmx - mx) * .06; my += (tmy - my) * .06;
    var key = cur.toFixed(4) + '|' + mx.toFixed(3) + '|' + my.toFixed(3) + '|' + S.w + '|' + S.h + '|' + S.rtl;
    if (key !== lastKey) { lastKey = key; render(); }
    window.requestAnimationFrame(loop);
  }
  if (!reduce) window.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') { tmx = (e.clientX / window.innerWidth - .5) * 2; tmy = (e.clientY / window.innerHeight - .5) * 2; } }, { passive: true });
  function remeasure() { measure(); lastKey = ''; }
  window.addEventListener('resize', remeasure);
  window.addEventListener('load', remeasure);
  /* language changes flip the layout and the theme changes the screens, so measure again */
  if (window.MutationObserver) new MutationObserver(remeasure).observe(root, { attributes: true, attributeFilter: ['dir'] });

  /* screen gallery */
  var tabs = document.getElementById('lsTabs'), gal = document.getElementById('lsGal');
  if (tabs && gal) {
    var gimgs = Array.prototype.slice.call(gal.querySelectorAll('img'));
    var setTab = function (n) {
      Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
        var on = +b.getAttribute('data-t') === n; b.classList.toggle('a', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      gimgs.forEach(function (im, i) { im.classList.toggle('a', i === n); });
      var m = META[gimgs[n].getAttribute('data-shot')]; gal.style.setProperty('--ar', (m[0] / m[1]).toFixed(3));
    };
    tabs.addEventListener('click', function (e) { var bt = e.target.closest('button[data-t]'); if (bt) setTab(+bt.getAttribute('data-t')); });
    setTab(0);
  }

  measure(); render();
  window.requestAnimationFrame(function (t) { last = t; loop(t); });
})();
