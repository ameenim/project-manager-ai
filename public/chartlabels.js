/* Data labels for every chart, with the position choices of a Microsoft chart (Chart elements, Data labels).
   One module serves the app and the super admin console. A chart asks for its settings with get(kind), writes its
   numbers with text() or html(), and offers the choice to the person with button() or openMenu().
   Settings are kept per chart in this browser. "Use for all charts" applies one choice everywhere. */
(function () {
  'use strict';
  const STORE = 'pm_chart_labels';
  // The positions that make sense for each kind of chart
  const KINDS = {
    hbar: ['center', 'left', 'right', 'above', 'below'],
    column: ['center', 'above', 'below', 'left', 'right'],
    stackcol: ['center', 'above'],
    htmlcol: ['above', 'center', 'below'],
    stackbar: ['center', 'above', 'below'],
    line: ['above', 'below', 'left', 'right', 'center'],
    radar: ['above', 'below', 'left', 'right', 'center'],
    donut: ['center', 'outside'],
  };
  const DEF_POS = { hbar: 'right', column: 'above', htmlcol: 'above', stackcol: 'center', stackbar: 'center', line: 'above', radar: 'above', donut: 'center' };
  const DEF_SHOW = { donut: 'percent' };
  const DEF_OFF = { radar: true }; // the axis names already carry the numbers
  const WORDS = {
    en: { title: 'Chart elements', labels: 'Data labels', position: 'Position', show: 'Show', value: 'Value', percent: 'Percentage', both: 'Value and percentage', all: 'Use for all charts', btn: 'Data labels', center: 'Center', left: 'Left', right: 'Right', above: 'Above', below: 'Below', outside: 'Outside', off: 'None' },
    ar: { title: 'عناصر المخطط', labels: 'تسميات البيانات', position: 'الموضع', show: 'العرض', value: 'القيمة', percent: 'النسبة المئوية', both: 'القيمة والنسبة', all: 'تطبيق على كل المخططات', btn: 'تسميات البيانات', center: 'الوسط', left: 'اليسار', right: 'اليمين', above: 'أعلى', below: 'أسفل', outside: 'خارج', off: 'بدون' },
  };
  const lang = () => { try { return (window.PM && PM.state && PM.state.lang) || document.documentElement.lang || 'en'; } catch (e) { return 'en'; } };
  const w = (k) => (WORDS[lang()] || WORDS.en)[k] || WORDS.en[k];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let data = { all: null, k: {} };
  try { const raw = JSON.parse(localStorage.getItem(STORE) || 'null'); if (raw && typeof raw === 'object') data = { all: raw.all || null, k: raw.k || {} }; } catch (e) { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* storage blocked */ } };

  let cur = 'chart', used = [];
  const scope = (key) => { cur = String(key || 'chart'); used = []; };
  const current = () => cur;
  const collect = () => { const u = used; used = []; return u; };

  // The settings in force for the chart being drawn
  function get(kind, caps) {
    caps = caps || {};
    const s = data.all || data.k[cur] || {};
    const allowed = KINDS[kind] || KINDS.hbar;
    const off = s.pos === 'off' || (!s.pos && !!DEF_OFF[kind]);
    const pos = allowed.includes(s.pos) ? s.pos : DEF_POS[kind] || allowed[0];
    let show = s.show || DEF_SHOW[kind] || 'value';
    if (caps.percent === false) show = 'value';
    used.push({ key: cur, kind, caps });
    return { key: cur, kind, on: !off, pos, show };
  }

  // The words for one label: the value, the percentage, or both
  function str(cfg, o) {
    const v = o.text != null ? String(o.text) : '', p = o.pct != null ? String(o.pct) : '';
    if (v && p && v === p) return v;
    if (cfg.show === 'percent' && p) return p;
    if (cfg.show === 'both' && p && v) return `${v} (${p})`;
    return v || p;
  }
  const pctOf = (v, total) => { if (!(total > 0)) return ''; const p = (v / total) * 100; return `${p >= 10 || Math.abs(p - Math.round(p)) < 0.05 ? Math.round(p) : Math.round(p * 10) / 10}%`; };
  const estW = (s) => String(s).length * 6.4 + 2;

  // An SVG label placed next to a point. The point is where the mark is, the position says which side the label takes.
  function text(x, y, label, pos, o) {
    o = o || {};
    const g = o.gap == null ? 6 : o.gap;
    let px = x, py = y + 4, a = 'middle';
    if (pos === 'above') py = y - g;
    else if (pos === 'below') py = y + g + 9;
    else if (pos === 'left') { px = x - g; a = 'end'; }
    else if (pos === 'right') { px = x + g; a = 'start'; }
    else if (pos === 'outside' && o.anchor) { a = o.anchor; }
    return `<text class="cl ${o.cls || ''}" x="${(+px).toFixed(1)}" y="${(+py).toFixed(1)}" text-anchor="${a}" direction="ltr" pointer-events="none">${esc(label)}</text>`;
  }

  // Menu, like Chart elements, Data labels in Microsoft charts
  let menu = null;
  const close = () => { if (menu) { menu.remove(); menu = null; } };
  document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('[data-cl]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function openMenu(btn, info, onChange) {
    close();
    const key = info.key, kind = info.kind, caps = info.caps || {};
    const allowed = KINDS[kind] || KINDS.hbar;
    const read = () => { const s = data.all || data.k[key] || {}; return { on: !(s.pos === 'off' || (!s.pos && !!DEF_OFF[kind])), pos: allowed.includes(s.pos) ? s.pos : DEF_POS[kind], show: caps.percent === false ? 'value' : (s.show || DEF_SHOW[kind] || 'value'), all: !!data.all }; };
    menu = document.createElement('div'); menu.className = 'cl-menu'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', w('title'));
    const paint = () => {
      const s = read();
      menu.innerHTML = `<div class="cl-h">${esc(w('title'))}</div>
        <label class="cl-row"><input type="checkbox" data-on ${s.on ? 'checked' : ''}> <span>${esc(w('labels'))}</span></label>
        <div class="cl-sub">${esc(w('position'))}</div>
        <div class="cl-opts" role="radiogroup" aria-label="${esc(w('position'))}">${allowed.map((p) => `<button type="button" role="radio" aria-checked="${s.on && s.pos === p}" class="${s.on && s.pos === p ? 'on' : ''}" data-pos="${p}">${esc(w(p))}</button>`).join('')}</div>
        ${caps.percent === false ? '' : `<div class="cl-sub">${esc(w('show'))}</div><div class="cl-opts" role="radiogroup" aria-label="${esc(w('show'))}">${['value', 'percent', 'both'].map((p) => `<button type="button" role="radio" aria-checked="${s.show === p}" class="${s.show === p ? 'on' : ''}" data-show="${p}">${esc(w(p))}</button>`).join('')}</div>`}
        <label class="cl-row cl-all"><input type="checkbox" data-all ${s.all ? 'checked' : ''}> <span>${esc(w('all'))}</span></label>`;
    };
    const apply = (patch) => {
      const s = data.all || data.k[key] || {};
      const next = { pos: s.pos, show: s.show, ...patch };
      const useAll = menu.querySelector('[data-all]').checked;
      if (useAll) data.all = next; else { data.all = null; data.k[key] = next; }
      save(); paint(); if (onChange) onChange();
    };
    paint();
    menu.addEventListener('change', (e) => {
      if (e.target.matches('[data-on]')) apply({ pos: e.target.checked ? (read().pos || DEF_POS[kind]) : 'off' });
      else if (e.target.matches('[data-all]')) { const s = read(); if (e.target.checked) data.all = { pos: s.on ? s.pos : 'off', show: s.show }; else data.all = null; save(); paint(); if (onChange) onChange(); }
    });
    menu.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pos]'), s = e.target.closest('[data-show]');
      if (p) apply({ pos: p.dataset.pos });
      else if (s) { const cur2 = read(); apply({ show: s.dataset.show, pos: cur2.pos }); }
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), mw = menu.offsetWidth;
    menu.style.left = Math.min(Math.max(8, lang() === 'ar' ? r.left : r.right - mw), innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(r.bottom + 6, Math.max(8, innerHeight - menu.offsetHeight - 8)) + 'px';
    const first = menu.querySelector('input,button:not([disabled])'); if (first) first.focus();
  }

  // The small button that opens the menu. Pass the chart settings it belongs to.
  function button(info) {
    const label = w('btn');
    return `<button type="button" class="btn ghost icon cl-btn" data-cl data-cl-key="${esc(info.key)}" data-cl-kind="${esc(info.kind)}" data-cl-pct="${info.caps && info.caps.percent === false ? 0 : 1}" aria-haspopup="dialog" aria-label="${esc(label)}" data-tip="${esc(label)}"><svg class="i sa-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="M13 5h7M13 8h4" stroke-width="2"/></svg></button>`;
  }
  // Wire every labels button under root. onChange runs after the person changes a choice, so the chart can redraw.
  function bind(root, onChange) {
    root.querySelectorAll('[data-cl]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); if (menu && menu.dataset.for === b.dataset.clKey) { close(); return; } openMenu(b, { key: b.dataset.clKey, kind: b.dataset.clKind, caps: { percent: b.dataset.clPct !== '0' } }, () => onChange && onChange(b.dataset.clKey)); if (menu) menu.dataset.for = b.dataset.clKey; };
    });
  }

  window.PMCL = { KINDS, current, scope, collect, get, str, pctOf, estW, text, button, bind, openMenu, close, words: w };
})();
