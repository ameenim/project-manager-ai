/* Platform loader: the Project Manager AI mark sits in the middle and circles move around it.
   PM.loader.html(opts) gives the markup for an inline spot (a page that is still loading, a card that is applying).
   PM.loader.show(label) covers the main area with a loading screen until the matching hide(). The screen waits a
   moment before it appears, so quick actions never flash it, and once it shows it stays long enough to read.
   Only transform and opacity move. Reduced motion keeps a still mark with a soft pulse of opacity. */
(function () {
  'use strict';
  const PM = window.PM = window.PM || {};
  Object.assign(PM.I18N.en, { ld_loading: 'Loading', ld_working: 'Working on it', ld_applying: 'Applying your changes', ld_undoing: 'Undoing your changes' });
  Object.assign(PM.I18N.ar, { ld_loading: 'جار التحميل', ld_working: 'جار العمل على الطلب', ld_applying: 'جار تطبيق التغييرات', ld_undoing: 'جار التراجع عن التغييرات' });
  const tr = (k) => (PM.t ? PM.t(k) : k);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // size is sm (inline in a card), md (a page spot) or lg (the loading screen)
  function html(o) {
    const x = o || {}; const size = x.size || 'md'; const label = x.label == null ? tr('ld_loading') : x.label;
    return `<div class="pmld ${size}" role="status" aria-live="polite" aria-label="${esc(label)}"><div class="pmld-orbit" aria-hidden="true"><i class="pmld-ring r1"></i><i class="pmld-ring r2"></i><i class="pmld-ring r3"></i><span class="pmld-arm a1"><b></b></span><span class="pmld-arm a2"><b></b></span><span class="pmld-arm a3"><b></b></span><span class="pmld-mark">${PM.logo ? PM.logo.mark() : ''}</span></div>${x.size === 'sm' || !label ? '' : `<div class="pmld-label">${esc(label)}</div>`}</div>`;
  }

  const WAIT = 140;    // ms before the screen appears
  const KEEP = 420;    // ms it stays once it appeared
  let el = null, count = 0, timer = 0, shownAt = 0, hideTimer = 0;
  function mount(label) {
    el = document.createElement('div');
    el.className = 'pmld-screen';
    el.innerHTML = html({ size: 'lg', label });
    document.body.appendChild(el);
    requestAnimationFrame(() => { if (el) el.classList.add('on'); });
    shownAt = Date.now();
  }
  function show(label) {
    count++;
    clearTimeout(hideTimer);
    if (el) { const l = el.querySelector('.pmld-label'); if (l && label) l.textContent = label; }
    else if (!timer) timer = setTimeout(() => { timer = 0; if (count > 0 && !el) mount(label || tr('ld_working')); }, WAIT);
    let done = false;
    return () => { if (done) return; done = true; hide(); };
  }
  function hide() {
    count = Math.max(0, count - 1);
    if (count > 0) return;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!el) return;
    const wait = Math.max(0, KEEP - (Date.now() - shownAt));
    hideTimer = setTimeout(() => {
      const node = el; if (!node || count > 0) return;
      el = null; node.classList.remove('on');
      setTimeout(() => node.remove(), 220);
    }, wait);
  }
  // runs a promise (or a function that returns one) behind the loading screen
  async function wrap(work, label) {
    const end = show(label);
    try { return await (typeof work === 'function' ? work() : work); } finally { end(); }
  }
  PM.loader = { html, show, hide, wrap };
})();
