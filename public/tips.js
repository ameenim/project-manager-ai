/* Tooltips everywhere: any element with data-tip, a title, or an icon only aria-label shows a tip after a short pause. */
(function () {
  'use strict';
  let el, timer, cur;
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function box() {
    if (el) return el;
    el = document.createElement('div'); el.id = 'gTip'; el.className = 'g-tip'; el.setAttribute('role', 'tooltip');
    (document.fullscreenElement || document.body).appendChild(el);
    return el;
  }
  function textOf(n) {
    if (n.closest('.dw-grid') && n.hasAttribute('data-tip')) return ''; // dashboards have their own rich tooltips
    const d = n.getAttribute('data-tip');
    if (d) return d;
    const ti = n.getAttribute('title');
    if (ti) { n.setAttribute('data-tip', ti); n.removeAttribute('title'); return ti; }
    if (n.matches('button,a,[role=button]') && !n.textContent.trim()) return n.getAttribute('aria-label') || '';
    return '';
  }
  function find(t) {
    for (let n = t; n && n !== document.body; n = n.parentElement) { if (n.nodeType === 1 && !n.closest('.gt-tip,.g-tip')) { const x = textOf(n); if (x) return [n, x]; } }
    return null;
  }
  function hide() { clearTimeout(timer); cur = null; if (el) el.classList.remove('on'); }
  function show(n, txt) {
    const b = box(); b.textContent = txt; b.style.maxWidth = '280px';
    if (!b.isConnected || (document.fullscreenElement && !document.fullscreenElement.contains(b))) (document.fullscreenElement || document.body).appendChild(b);
    const r = n.getBoundingClientRect(); b.classList.add('on');
    const w = b.offsetWidth, h = b.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8, up = false;
    if (y + h > innerHeight - 8) { y = r.top - h - 8; up = true; }
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    b.style.left = x + 'px'; b.style.top = y + 'px'; b.dataset.up = up ? '1' : '';
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const f = find(e.target);
    if (!f) { hide(); return; }
    if (cur === f[0]) return;
    hide(); cur = f[0];
    const quick = el && el.classList.contains('warm');
    timer = setTimeout(() => { if (cur) { show(f[0], f[1]); box().classList.add('warm'); setTimeout(() => box().classList.remove('warm'), 900); } }, reduced() ? 0 : quick ? 60 : 380);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', () => { if (el && el.classList.contains('on')) hide(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  document.addEventListener('focusin', (e) => { const f = find(e.target); if (f && e.target.matches(':focus-visible')) { cur = f[0]; show(f[0], f[1]); } });
  document.addEventListener('focusout', hide);
  window.PM = window.PM || {}; window.PM.hideTip = hide;
})();
