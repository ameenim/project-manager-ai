/* Date picker: replaces the browser's own calendar on every date field in the app and the admin console.
   Fields keep their value as YYYY-MM-DD, so the code that reads them does not change.
   A datetime-local field becomes a date field plus a time field, with the same value format as before (YYYY-MM-DDTHH:mm).
   Needs no other script. Reads the page language and direction from the root element. */
(function () {
  'use strict';
  const L = {
    en: { today: 'Today', clear: 'Clear', prev: 'Previous', next: 'Next', open: 'Open calendar', choose: 'Choose a date', month: 'Choose a month', year: 'Choose a year', ph: 'YYYY-MM-DD', time: 'Time' },
    ar: { today: 'اليوم', clear: 'مسح', prev: 'السابق', next: 'التالي', open: 'فتح التقويم', choose: 'اختر تاريخا', month: 'اختر الشهر', year: 'اختر السنة', ph: 'YYYY-MM-DD', time: 'الوقت' },
  };
  const lang = () => (document.documentElement.lang === 'ar' ? 'ar' : 'en');
  const tx = (k) => L[lang()][k];
  const loc = () => (lang() === 'ar' ? 'ar-AE' : 'en-US');
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m + 1)}-${pad(d)}`;
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const ICON = {
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
  };
  const svg = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

  // Reads 2025-05-22, 2025/5/22 and 2025.5.22. Returns [y, m (0 to 11), d] or null.
  function parse(s) {
    const m = String(s || '').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (mo < 0 || mo > 11 || d < 1 || d > daysIn(y, mo)) return null;
    return [y, mo, d];
  }
  const today = () => { const n = new Date(); return [n.getFullYear(), n.getMonth(), n.getDate()]; };
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const shiftDay = ([y, m, d], n) => { const t = new Date(Date.UTC(y, m, d + n)); return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]; };
  const shiftMonth = ([y, m, d], n) => { const t = new Date(Date.UTC(y, m + n, 1)); const mm = t.getUTCMonth(); return [t.getUTCFullYear(), mm, Math.min(d, daysIn(t.getUTCFullYear(), mm))]; };

  // ---------- the popup, one for the whole page ----------
  let pop = null, cur = null;

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'dp-pop'; pop.setAttribute('role', 'dialog'); pop.hidden = true;
    pop.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); }); // the field keeps focus
    pop.addEventListener('click', onPopClick);
    document.body.appendChild(pop);
    document.addEventListener('pointerdown', (e) => { if (cur && !pop.contains(e.target) && !cur.wrap.contains(e.target)) close(); }, true);
    window.addEventListener('resize', () => cur && place());
    window.addEventListener('scroll', (e) => { if (cur && !pop.contains(e.target)) close(); }, true);
    return pop;
  }

  function bounds(input) {
    const get = (a) => parse(input.getAttribute(a));
    return { min: get('min'), max: get('max') };
  }

  function render() {
    const { view, y, m } = cur, sel = cur.sel, now = today(), { min, max } = bounds(cur.input);
    const fmt = (o, d) => new Intl.DateTimeFormat(loc(), { timeZone: 'UTC', ...o }).format(d);
    const nav = (title, lbl) => `<div class="dp-head"><button type="button" class="dp-nav" data-a="prev" aria-label="${tx('prev')}">${svg('left')}</button><button type="button" class="dp-title" data-a="up" aria-label="${lbl}">${title}</button><button type="button" class="dp-nav" data-a="next" aria-label="${tx('next')}">${svg('right')}</button></div>`;
    let body = '';
    if (view === 'days') {
      const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
      const heads = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.UTC(2023, 0, 1 + i)); const full = fmt({ weekday: 'long' }, d); const short = lang() === 'ar' ? fmt({ weekday: 'narrow' }, d) : fmt({ weekday: 'short' }, d).slice(0, 2); return `<span class="dp-wd${i > 4 ? ' wk' : ''}" title="${full}" aria-label="${full}">${short}</span>`; }).join('');
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const dt = shiftDay([y, m, 1], i - first), off = dt[1] !== m, wk = [5, 6].includes(new Date(Date.UTC(dt[0], dt[1], dt[2])).getUTCDay());
        const dis = (min && cmp(dt, min) < 0) || (max && cmp(dt, max) > 0);
        const cls = ['dp-d', off ? 'off' : '', wk ? 'wk' : '', cmp(dt, now) === 0 ? 'today' : '', sel && cmp(dt, sel) === 0 ? 'sel' : '', cur.focus && cmp(dt, cur.focus) === 0 ? 'foc' : ''].filter(Boolean).join(' ');
        cells += `<button type="button" class="${cls}" data-d="${iso(...dt)}" ${dis ? 'disabled' : ''} tabindex="-1" aria-label="${fmt({ dateStyle: 'full' }, new Date(Date.UTC(...dt)))}" ${sel && cmp(dt, sel) === 0 ? 'aria-pressed="true"' : ''}>${dt[2].toLocaleString(loc(), { useGrouping: false })}</button>`;
      }
      body = nav(fmt({ month: 'long', year: 'numeric' }, new Date(Date.UTC(y, m, 1))), tx('month')) + `<div class="dp-grid dp-wds" aria-hidden="true">${heads}</div><div class="dp-grid" role="grid">${cells}</div>`;
    } else if (view === 'months') {
      const cells = Array.from({ length: 12 }, (_, i) => `<button type="button" class="dp-m${sel && sel[0] === y && sel[1] === i ? ' sel' : ''}${now[0] === y && now[1] === i ? ' today' : ''}" data-m="${i}" tabindex="-1">${fmt({ month: 'short' }, new Date(Date.UTC(y, i, 1)))}</button>`).join('');
      body = nav(String(y), tx('year')) + `<div class="dp-pick">${cells}</div>`;
    } else {
      const start = y - (y % 12);
      const cells = Array.from({ length: 12 }, (_, i) => `<button type="button" class="dp-m${sel && sel[0] === start + i ? ' sel' : ''}${now[0] === start + i ? ' today' : ''}" data-y="${start + i}" tabindex="-1">${(start + i).toLocaleString(loc(), { useGrouping: false })}</button>`).join('');
      body = nav(`${start} to ${start + 11}`.replace(/ to /, ' – '), tx('year')) + `<div class="dp-pick">${cells}</div>`;
    }
    pop.innerHTML = body + `<div class="dp-foot"><button type="button" class="dp-link" data-a="today">${tx('today')}</button><button type="button" class="dp-link" data-a="clear">${tx('clear')}</button></div>`;
    pop.setAttribute('aria-label', tx('choose'));
    pop.dir = document.documentElement.dir || 'ltr';
  }

  function place() {
    const r = cur.wrap.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, vw = innerWidth, vh = innerHeight, rtl = pop.dir === 'rtl';
    let left = rtl ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = r.bottom + 6, above = false;
    if (top + h > vh - 8 && r.top - h - 6 > 8) { top = r.top - h - 6; above = true; }
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
    pop.classList.toggle('above', above);
  }

  function open(input, wrap) {
    if (input.disabled || input.readOnly) return;
    ensurePop();
    if (cur && cur.input !== input) close();
    const v = parse(input.value) || null, base = v || today();
    cur = { input, wrap, view: 'days', y: base[0], m: base[1], sel: v, focus: v || today() };
    render(); pop.hidden = false; place();
    requestAnimationFrame(() => pop && pop.classList.add('on'));
    wrap.classList.add('open'); input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!cur) return;
    cur.wrap.classList.remove('open'); cur.input.setAttribute('aria-expanded', 'false');
    pop.classList.remove('on'); pop.hidden = true; cur = null;
  }

  function commit(input, v) {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pick(dt) {
    const input = cur.input; close();
    commit(input, iso(...dt)); input.focus();
  }

  function move(dt) {
    cur.focus = dt; cur.y = dt[0]; cur.m = dt[1]; cur.view = 'days'; render(); place();
  }

  function onPopClick(e) {
    const b = e.target.closest('button'); if (!b || !cur) return;
    if (b.dataset.d) { const p = parse(b.dataset.d); if (p) pick(p); return; }
    if (b.dataset.m != null) { cur.m = +b.dataset.m; cur.view = 'days'; cur.focus = [cur.y, cur.m, Math.min((cur.focus || [0, 0, 1])[2], daysIn(cur.y, cur.m))]; render(); return; }
    if (b.dataset.y != null) { cur.y = +b.dataset.y; cur.view = 'months'; render(); return; }
    const a = b.dataset.a;
    if (a === 'prev' || a === 'next') {
      const s = a === 'next' ? 1 : -1;
      if (cur.view === 'days') { const t = shiftMonth([cur.y, cur.m, 1], s); cur.y = t[0]; cur.m = t[1]; }
      else if (cur.view === 'months') cur.y += s; else cur.y += 12 * s;
      render();
    } else if (a === 'up') { cur.view = cur.view === 'days' ? 'months' : 'years'; render(); }
    else if (a === 'today') { const t = today(), { min, max } = bounds(cur.input); if ((min && cmp(t, min) < 0) || (max && cmp(t, max) > 0)) { move(t); return; } pick(t); }
    else if (a === 'clear') { const input = cur.input; close(); commit(input, ''); input.focus(); }
  }

  // ---------- the field ----------
  function wrapField(input, extra) {
    const wrap = document.createElement('span');
    wrap.className = 'dp-w' + (extra ? ' ' + extra : '');
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    return wrap;
  }

  function enhanceDate(input) {
    if (input.dataset.dp) return;
    input.dataset.dp = '1';
    const min = input.getAttribute('min'), max = input.getAttribute('max');
    input.type = 'text';
    if (min) input.setAttribute('min', min); if (max) input.setAttribute('max', max);
    input.setAttribute('inputmode', 'numeric'); input.setAttribute('autocomplete', 'off'); input.setAttribute('maxlength', '10');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-haspopup', 'dialog'); input.setAttribute('aria-expanded', 'false');
    if (!input.placeholder) input.placeholder = tx('ph');
    const wrap = wrapField(input);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dp-btn'; btn.tabIndex = -1; btn.innerHTML = svg('cal');
    btn.setAttribute('aria-label', tx('open')); btn.setAttribute('data-tip', tx('open'));
    wrap.appendChild(btn);
    let last = parse(input.value) ? input.value : '';
    btn.addEventListener('click', () => { if (cur && cur.input === input) close(); else { input.focus(); open(input, wrap); } });
    input.addEventListener('click', () => { if (!cur || cur.input !== input) open(input, wrap); });
    // A typed date is checked before any other code sees the change. A bad one goes back to the last good value.
    input.addEventListener('change', (e) => {
      const p = parse(input.value);
      if (input.value.trim() === '') { last = ''; return; }
      if (!p) { e.stopImmediatePropagation(); input.value = last; return; }
      input.value = iso(...p); last = input.value;
    }, true);
    input.addEventListener('input', () => { if (parse(input.value)) last = input.value; });
    input.addEventListener('keydown', (e) => {
      const isOpen = cur && cur.input === input;
      if (!isOpen) { if (e.key === 'ArrowDown') { e.preventDefault(); open(input, wrap); } return; }
      const f = cur.focus || today();
      const go = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (cur.view === 'days' && go != null && !e.altKey) { e.preventDefault(); move(shiftDay(f, (pop.dir === 'rtl' && Math.abs(go) === 1 ? -go : go))); }
      else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); move(shiftMonth(f, (e.key === 'PageDown' ? 1 : -1) * (e.shiftKey ? 12 : 1))); }
      else if (e.key === 'Enter' && cur.view === 'days' && cur.focus) { e.preventDefault(); const { min, max } = bounds(input); const c = cur.focus; if (!((min && cmp(c, min) < 0) || (max && cmp(c, max) > 0))) pick(c); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') close();
    });
    input.addEventListener('input', () => { if (cur && cur.input === input) { const p = parse(input.value); if (p) { cur.sel = p; cur.focus = p; cur.y = p[0]; cur.m = p[1]; cur.view = 'days'; render(); } } });
    return wrap;
  }

  // A datetime-local field: the original stays as a hidden field that holds YYYY-MM-DDTHH:mm, next to a date field and a time field.
  function enhanceDateTime(input) {
    if (input.dataset.dp) return;
    input.dataset.dp = '1';
    const v = String(input.value || ''), [d0, t0] = v.split('T');
    const row = document.createElement('span');
    row.className = 'dp-row';
    input.parentNode.insertBefore(row, input);
    const dateIn = document.createElement('input'); dateIn.type = 'date'; dateIn.value = d0 || ''; dateIn.setAttribute('aria-label', tx('choose'));
    const timeIn = document.createElement('input'); timeIn.type = 'time'; timeIn.value = (t0 || '').slice(0, 5); timeIn.className = 'dp-time'; timeIn.setAttribute('aria-label', tx('time'));
    row.append(dateIn, timeIn);
    input.type = 'hidden'; row.appendChild(input);
    const sync = () => { input.value = dateIn.value ? `${dateIn.value}T${timeIn.value || '00:00'}` : ''; input.dispatchEvent(new Event('change', { bubbles: true })); };
    dateIn.addEventListener('change', sync); timeIn.addEventListener('change', sync);
    enhanceDate(dateIn);
    // the label points at the hidden field, so a click on the label opens the date field instead
    const lab = input.closest('label'); if (lab) lab.addEventListener('click', (e) => { if (!e.target.closest('.dp-row')) dateIn.focus(); });
  }

  function scan(root) {
    if (!root.querySelectorAll) return;
    root.querySelectorAll('input[type=date]:not([data-dp])').forEach(enhanceDate);
    root.querySelectorAll('input[type=datetime-local]:not([data-dp])').forEach(enhanceDateTime);
  }

  function start() {
    scan(document);
    new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); }); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.PMDate = { open, close, parse, iso };
})();
