/* Platform loader: the Project Manager AI mark sits in the middle and circles move around it.
   PM.loader.html(opts) gives the markup: size page (whole screen), md (a spot in a panel) or sm (inline).
   PM.loader.show(label) puts the same loading screen over everything until the matching hide(). The screen waits a
   moment before it appears, so quick actions never flash it, and once it shows it stays long enough to read.
   Only transform and opacity move. Reduced motion keeps a still mark with a soft pulse of opacity. */
(function () {
  'use strict';
  const PM = window.PM = window.PM || {};
  const EN = { ld_loading: 'Loading', ld_working: 'Working on it', ld_applying: 'Applying your changes', ld_undoing: 'Undoing your changes' };
  if (PM.I18N) {
    Object.assign(PM.I18N.en, EN);
    Object.assign(PM.I18N.ar, { ld_loading: 'جار التحميل', ld_working: 'جار العمل على الطلب', ld_applying: 'جار تطبيق التغييرات', ld_undoing: 'جار التراجع عن التغييرات' });
  }
  const tr = (k) => (PM.t ? PM.t(k) : EN[k] || k);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mark = () => (PM.logo ? PM.logo.mark() : '<img src="brand/mark.svg" alt="">');

  // The loader itself: the mark with rings and orbiting circles. Spans only, so it can sit inside buttons and sentences.
  function core(size, label) {
    return `<span class="pmld ${size}" role="status" aria-live="polite" aria-label="${esc(label)}"><span class="pmld-orbit" aria-hidden="true"><i class="pmld-ring r1"></i><i class="pmld-ring r2"></i><i class="pmld-ring r3"></i><span class="pmld-arm a1"><b></b></span><span class="pmld-arm a2"><b></b></span><span class="pmld-arm a3"><b></b></span><span class="pmld-mark">${mark()}</span></span>${size === 'sm' || !label ? '' : `<span class="pmld-label">${esc(label)}</span>`}</span>`;
  }
  // size is page (the whole screen: centered, with everything behind it dimmed and blurred),
  // md (a spot inside a panel, a list or a dialog) or sm (inline in a button, a banner or a card)
  function html(o) {
    const x = o || {}; const size = x.size || 'md'; const label = x.label == null ? tr('ld_loading') : x.label;
    return size === 'page' ? `<div class="pmld-screen on">${core('lg', label)}</div>` : core(size, label);
  }

  const WAIT = 140;    // ms before the screen appears
  const KEEP = 420;    // ms it stays once it appeared
  let el = null, count = 0, timer = 0, shownAt = 0, hideTimer = 0;
  function mount(label) {
    el = document.createElement('div');
    el.className = 'pmld-screen';
    el.innerHTML = core('lg', label);
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

  // Skeletons: the shape of the page in quiet gray blocks while its data is on the way. They show at once and leave as soon as
  // the data lands, so they never add waiting time the way a loading screen with a minimum display time does. The logo loader
  // stays for starting the app and for long actions. A skeleton is only a stand in: it says "loading" to a screen reader and
  // carries no content. Each helper returns markup, so it can sit inside any card, list or page.
  const bar = (cls) => `<span class="sk sk-line ${cls || ''}"></span>`;
  const row = () => `<div class="sk-row"><span class="sk sk-dot"></span><div class="sk-col">${bar('l')}${bar('s')}</div><span class="sk sk-chip"></span></div>`;
  const rows = (n) => Array.from({ length: n }, row).join('');
  const skeleton = {
    line: bar,
    list: (n) => `<div class="sk-wrap" role="status" aria-busy="true" aria-label="${esc(tr('ld_loading'))}">${rows(n || 5)}</div>`,
    cards: (n) => `<div class="sk-wrap sk-cards" role="status" aria-busy="true" aria-label="${esc(tr('ld_loading'))}">${Array.from({ length: n || 3 }, () => `<div class="card sk-card">${bar('m')}${bar('xl')}${bar('l')}</div>`).join('')}</div>`,
    table: (n, cols) => `<div class="sk-wrap" role="status" aria-busy="true" aria-label="${esc(tr('ld_loading'))}"><div class="sk-trow sk-thead" style="--cols:${cols || 4}">${Array.from({ length: cols || 4 }, () => bar('s')).join('')}</div>${Array.from({ length: n || 6 }, () => `<div class="sk-trow" style="--cols:${cols || 4}">${Array.from({ length: cols || 4 }, () => bar('m')).join('')}</div>`).join('')}</div>`,
    // a whole page: a title, a row of summary cards and a list card
    page: () => `<div class="page sk-page" role="status" aria-busy="true" aria-label="${esc(tr('ld_loading'))}"><span class="sk sk-title"></span><div class="sk-cards">${Array.from({ length: 3 }, () => `<div class="card sk-card">${bar('s')}<span class="sk sk-metric"></span>${bar('m')}</div>`).join('')}</div><div class="card sk-card">${bar('m')}${rows(5)}</div></div>`,
  };
  PM.skeleton = skeleton;
})();
