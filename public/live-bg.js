/* Live network background for every page. A CSS gradient (glass.css) gives the color, this canvas draws the drifting nodes and lines.
   Colors come from --lv-ink in tokens.css, so light, dark and the system setting all work. It pauses when the tab is hidden, draws one
   still frame under reduced motion, follows the pointer lightly, and never blocks clicks. */
(function () {
  'use strict';
  if (window.__pmLive) return; window.__pmLive = true;
  var root = document.documentElement;
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var wrap = document.createElement('div'); wrap.className = 'amb'; wrap.setAttribute('aria-hidden', 'true');
  var cv = document.createElement('canvas'); wrap.appendChild(cv);
  var ctx = cv.getContext('2d'); if (!ctx) return;
  function mount() { if (!wrap.parentNode) document.body.insertBefore(wrap, document.body.firstChild); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  var W = 0, H = 0, dpr = 1, nodes = [], raf = 0, last = 0, ink = [74, 107, 232], mx = -9999, my = -9999;
  function readInk() {
    var v = getComputedStyle(root).getPropertyValue('--lv-ink').trim().replace('#', '');
    if (v.length === 3) v = v.replace(/./g, function (c) { return c + c; });
    var n = parseInt(v, 16); if (!isNaN(n)) ink = [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgba(a) { return 'rgba(' + ink[0] + ',' + ink[1] + ',' + ink[2] + ',' + a + ')'; }
  function size() {
    W = window.innerWidth; H = window.innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.min(110, Math.max(28, Math.round(W * H / 17000))); nodes = [];
    for (var i = 0; i < n; i++) nodes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: .8 + Math.random() * 1.8 });
  }
  function draw(dt) {
    var L = Math.max(120, Math.min(190, W / 9)), i, j, a, b, dx, dy, d2, k;
    ctx.clearRect(0, 0, W, H);
    for (i = 0; i < nodes.length; i++) { a = nodes[i]; a.x += a.vx * dt * .06; a.y += a.vy * dt * .06; if (a.x < -20) a.x = W + 20; if (a.x > W + 20) a.x = -20; if (a.y < -20) a.y = H + 20; if (a.y > H + 20) a.y = -20; }
    ctx.lineWidth = 1;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) { b = nodes[j]; dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy; if (d2 < L * L) { k = 1 - Math.sqrt(d2) / L; ctx.strokeStyle = rgba((k * k * .5).toFixed(3)); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
      dx = a.x - mx; dy = a.y - my; d2 = dx * dx + dy * dy; if (d2 < L * L * 1.7) { k = 1 - Math.sqrt(d2) / (L * 1.3); ctx.strokeStyle = rgba((k * .7).toFixed(3)); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mx, my); ctx.stroke(); }
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i]; var g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.r * 7); g.addColorStop(0, rgba(.5)); g.addColorStop(1, rgba(0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 7, 0, 6.2832); ctx.fill();
      ctx.fillStyle = rgba(.9); ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.2832); ctx.fill();
    }
  }
  function reduced() { return !!(reduceMq && reduceMq.matches); }
  function frame(now) { raf = 0; var dt = Math.min(64, last ? now - last : 16); last = now; draw(reduced() ? 0 : dt); if (!reduced() && !document.hidden) raf = requestAnimationFrame(frame); }
  function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  window.addEventListener('pointermove', function (e) { if (e.pointerType && e.pointerType !== 'mouse') return; mx = e.clientX; my = e.clientY; }, { passive: true });
  document.addEventListener('pointerleave', function () { mx = my = -9999; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else kick(); });
  var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { size(); kick(); }, 120); });
  new MutationObserver(function () { readInk(); kick(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) { var dm = window.matchMedia('(prefers-color-scheme: dark)'); (dm.addEventListener ? dm.addEventListener.bind(dm, 'change') : dm.addListener.bind(dm))(function () { readInk(); kick(); }); }
  if (reduceMq) (reduceMq.addEventListener ? reduceMq.addEventListener.bind(reduceMq, 'change') : reduceMq.addListener.bind(reduceMq))(kick);
  readInk(); size(); kick();
})();
