/* Project Manager AI, front end core. Plain JavaScript, hash routing, no build step. */
(function () {
  const PM = (window.PM = Object.assign(window.PM || {}, { views: {}, state: { token: localStorage.getItem('pm_token'), user: null, lang: localStorage.getItem('pm_lang') || 'en', theme: localStorage.getItem('pm_theme') || 'light', status: {}, projects: [], project: null, nav: 0 } }));
  const S = PM.state;

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k, vars) => {
    // a key with a _1 twin has its own text when the count is one ("1 task", not "1 tasks")
    const one = vars && Number(vars.n) === 1 ? ((PM.I18N[S.lang] && PM.I18N[S.lang][k + '_1']) ?? (S.lang === 'ar' ? undefined : PM.I18N.en[k + '_1'])) : undefined;
    let s = one ?? (PM.I18N[S.lang] && PM.I18N[S.lang][k]) ?? PM.I18N.en[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, b);
    return s;
  };
  const ICONS = {
    life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', shrink: '<path d="M14 10h6V4M10 14H4v6M20 4l-7 7M4 20l7-7"/>',
    vline: '<polyline points="3 17 9 11 13 14 21 5"/><path d="M3 21h18"/>', varea: '<path d="M3 20v-6l6-5 4 3 8-6v14z"/>', vcombo: '<rect x="4" y="13" width="4" height="7"/><rect x="10" y="9" width="4" height="11"/><rect x="16" y="15" width="4" height="5"/><polyline points="3 8 9 4 14 6 21 3"/>',
    vradar: '<polygon points="12 3 20.5 9 17.5 19.5 6.5 19.5 3.5 9"/><polygon points="12 8 16 10.8 14.6 15.5 9.4 15.5 8 10.8"/>', vfunnel: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
    star: '<polygon points="12 2.5 14.9 8.7 21.7 9.5 16.6 14.1 18 20.8 12 17.4 6 20.8 7.4 14.1 2.3 9.5 9.1 8.7 12 2.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>', more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', eyeoff: '<path d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4-.9"/>', img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    home: '<path d="m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>', inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>', chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2.5 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/>', chev_l: '<path d="m15 18-6-6 6-6"/>', chev_d: '<path d="m6 9 6 6 6-6"/>', chev_u: '<path d="m18 15-6-6-6 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', chev_r: '<path d="m9 18 6-6-6-6"/>',
    minus: '<path d="M5 12h14"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    cols: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h6M3 15h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>', down: '<path d="m6 9 6 6 6-6"/>', dl: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>', up: '<path d="M12 15V3m0 0L8 7m4-4 4 4M4 21h16"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>', alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>', jira: '<path d="M12 2 3 11l9 9 9-9ZM12 7l4 4-4 4-4-4Z"/>', upload: '<path d="M12 3v12m0-12L8 7m4-4 4 4M4 21h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12A9 9 0 0 1 18.5 5.7L21 8M21 3v5h-5M3 21v-5h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>', pin: '<path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3Z"/>', play: '<path d="m6 4 14 8-14 8Z"/>', skip: '<path d="m5 4 10 8-10 8ZM19 5v14"/>', back: '<path d="m15 18-6-6 6-6"/>', fwd: '<path d="m9 18 6-6-6-6"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;
  const money = (n, cur) => (n == null || n === '' ? '' : `${cur || ''} ${Number(n).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-US', { maximumFractionDigits: 0 })}`.trim());
  const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const today = () => new Date().toLocaleDateString('en-CA');
  const avatarHtml = (u, cls = '') => `<div class="avatar ${cls}">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : esc(initials(u.name))}</div>`;
  Object.assign(PM, { esc, t, icon, money, initials, $, $$, avatarHtml, today });

  function applyPrefs() {
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('pm_theme', S.theme);
    localStorage.setItem('pm_lang', S.lang);
  }

  // ---------- api ----------
  async function api(method, path, body) {
    const init = { method, headers: {} };
    if (S.token) init.headers.Authorization = `Bearer ${S.token}`;
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r;
    const t0 = performance.now();
    try { r = await fetch(path, init); } catch { if (PM.tickets) PM.tickets.note(method, path, 0, '', t('err_network')); if (PM.track) PM.track.call(path, performance.now() - t0, false); throw new Error(t('err_network')); }
    let data = null;
    try { data = await r.json(); } catch { /* not json */ }
    if (PM.track) PM.track.call(path, performance.now() - t0, r.ok || r.status === 401 || (r.status >= 400 && r.status < 500 && r.status !== 429));
    if (r.status === 401 && !path.startsWith('/api/auth/')) { signOut(true); throw new Error(t('err_session')); }
    if (PM.tickets && (!r.ok || path.startsWith('/api/'))) PM.tickets.note(method, path, r.status, data && data.ref, data && data.error);
    if (!r.ok) throw new Error((data && data.error) || r.statusText);
    return data;
  }
  async function download(path, filename) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${S.token}` } });
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (e) { /* not JSON */ } toast(m || t('err_download'), 'err'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  Object.assign(PM, { api, download });

  // ---------- toast and modal ----------
  function toast(msg, type = '', action) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; }
    const host = document.fullscreenElement || document.body;
    if (box.parentNode !== host) host.appendChild(box);
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    if (!action && type === 'err' && PM.tickets && PM.tickets.recentFailure()) action = { label: t('sp_report_it'), fn: () => PM.tickets.open() };
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.fn(); el.remove(); };
    box.appendChild(el);
    setTimeout(() => el.remove(), action ? 9000 : type === 'err' ? 6000 : 3500);
  }
  function modal({ title, body, footer, size = '', onClose, noBackdropClose }) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="modal-head"><h2>${esc(title || '')}</h2><button class="btn ghost icon" data-close aria-label="${t('close')}">${icon('x')}</button></div><div class="modal-body">${body || ''}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
    // inside full screen only the fullscreen element is visible, so dialogs must live there
    (document.fullscreenElement || document.body).appendChild(ov);
    const api2 = {
      el: ov, $: (s) => $(s, ov), $$: (s) => $$(s, ov),
      close(v) { if (ov.isConnected) { ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(v); } },
      setBody(h) { $('.modal-body', ov).innerHTML = h; }, setFooter(h) { let f = $('.modal-foot', ov); if (!f) { f = document.createElement('div'); f.className = 'modal-foot'; $('.modal', ov).appendChild(f); } f.innerHTML = h; },
    };
    const onKey = (e) => { if (e.key === 'Escape' && ov.isConnected && [...document.querySelectorAll('.overlay')].pop() === ov) api2.close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && !noBackdropClose) api2.close(); });
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api2.close(); });
    return api2;
  }
  function confirmDlg({ title, message, ok, danger }) {
    return new Promise((res) => {
      let answered = false;
      const m = modal({ title, body: `<p style="margin:0">${message}</p>`, size: '', onClose: () => { if (!answered) res(false); }, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok || t('ok'))}</button>` });
      m.$('[data-ok]').onclick = () => { answered = true; res(true); m.close(); };
      m.$('[data-ok]').focus();
    });
  }
  Object.assign(PM, { toast, modal, confirmDlg });

  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = PM.loader.html({ size: 'sm' }); }
    try { return await fn(); } catch (e) { toast(e.message, 'err'); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.html; } }
  }
  PM.busy = busy;

  // ---------- markdown ----------
  function mdToHtml(md) {
    const lines = String(md || '').split(/\r?\n/);
    const inline = (s) => esc(s).replace(/\{#([0-9a-fA-F]{6}):([^{}]*)\}/g, '<span style="color:#$1">$2</span>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<i>$1</i>');
    let out = '', i = 0, list = false;
    const close = () => { if (list) { out += '</ul>'; list = false; } };
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if (!l.trim()) { close(); i++; continue; }
      if ((m = l.match(/^:::chart\s+(\{.*\})\s*$/))) {
        close(); i++;
        try {
          const X = PM.exporter, sp = X && X.chartSpec ? X.chartSpec(JSON.parse(m[1])) : null;
          if (sp) { out += `<figure class="md-chart"><img alt="${esc(sp.alt)}" src="${X.chartPreview(sp)}"><figcaption>${esc(sp.title)}</figcaption></figure>`; continue; }
        } catch (e) { /* show nothing for a broken chart line */ }
        continue;
      }
      if (/^\s*\|/.test(l)) {
        close();
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
        const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
        out += `<div class="table-wrap"><table><thead><tr>${body[0].map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        continue;
      }
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { close(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; } else if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(m[1])}</li>`; } else { close(); out += `<p>${inline(l)}</p>`; }
      i++;
    }
    close();
    return out;
  }
  PM.mdToHtml = mdToHtml;

  function dropzone(root, { multiple = true, accept = '', label, onFiles }) {
    root.innerHTML = `<div class="dropzone" tabindex="0">${icon('upload')} <b>${label || t('drop_files')}</b><div class="small">${t('drop_hint')}</div><input type="file" ${multiple ? 'multiple' : ''} accept="${accept}" class="hidden"></div>`;
    const dz = $('.dropzone', root), inp = $('input', root);
    dz.onclick = () => inp.click();
    dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') inp.click(); };
    inp.onchange = () => { onFiles([...inp.files]); inp.value = ''; };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); onFiles([...e.dataTransfer.files]); };
  }
  PM.dropzone = dropzone;

  // ---------- auth ----------
  function signOut(expired) {
    if (!expired && S.token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${S.token}` } }).catch(() => {});
    S.token = null; S.user = null; localStorage.removeItem('pm_token'); localStorage.removeItem('pm_session');
    location.replace('index.html');
    return;
  }
  PM.signOut = signOut;

  function authView(mode) {
    $('#app').innerHTML = `<div class="auth"><div class="card"><div class="brand" style="padding-inline:0"><div class="logo">${PM.logo.mark()}</div><span>${t('app_name')}</span></div>
      <h2 style="margin:6px 0 4px">${mode === 'login' ? t('sign_in') : t('create_account')}</h2><p class="muted" style="margin:0 0 ${mode === 'register' ? '8px' : '16px'}">${t('auth_sub')}</p>${mode === 'register' ? `<p class="small" style="margin:0 0 16px;color:var(--primary-600);font-weight:600">${t('ob_trial_note')}</p>` : ''}
      <form id="authForm" class="col">
        ${mode === 'register' ? `<label class="f">${t('name')}<input type="text" name="name" required autocomplete="name"></label>` : ''}
        <label class="f">${t('email')}<input type="email" name="email" required autocomplete="email"></label>
        <label class="f">${t('password')}<input type="password" name="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
        <div id="authErr" class="small" style="color:var(--danger);min-height:18px"></div>
        <button class="btn primary" style="justify-content:center">${mode === 'login' ? t('sign_in') : t('create_account')}</button>
      </form>
      <p class="small muted" style="margin:14px 0 0;text-align:center">${mode === 'login' ? `${t('no_account')} <a href="#/register">${t('create_account')}</a>` : `${t('have_account')} <a href="#/login">${t('sign_in')}</a>`}</p>
</div></div>`;
    $('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const btn = $('button', e.target);
      btn.disabled = true;
      try {
        const r = await api('POST', `/api/auth/${mode}`, fd);
        S.token = r.token; localStorage.setItem('pm_token', r.token); setUser(r.user);
        location.hash = '#/';
      } catch (err) { $('#authErr').textContent = err.message; btn.disabled = false; }
    };
  }
  function setUser(u) {
    S.user = u;
    if (u.language) S.lang = u.language;
    if (u.theme) S.theme = u.theme;
    applyPrefs();
  }

  // ---------- shell ----------
  async function loadProjects() {
    try { S.projects = (await api('GET', '/api/projects')).projects; } catch { /* handled */ }
  }
  function shell(active, content, projHead) {
    $('#app').innerHTML = `${PM.billing ? PM.billing.ribbon() : ''}<div class="shell"><aside class="sidebar"><div class="brand"><div class="logo">${PM.logo.mark()}</div><span class="grow">${t('app_name')}</span><button class="btn ghost icon sm" id="navHide" type="button" aria-label="${t('nav_hide')}" title="${t('nav_hide')}">${icon('chev_l')}</button></div>
      <nav class="nav"><a href="#/" class="${active === 'dash' ? 'active' : ''}">${icon('home')}${t('nav_dashboard')}</a><div class="nav-fly" id="navFly"><a href="#/projects" class="${active === 'projects' ? 'active' : ''}" aria-haspopup="true" aria-expanded="false">${icon('folder')}<span class="grow">${t('nav_projects')}</span><span class="nav-caret">${icon('chev_r')}</span></a></div><a href="#/thinking" class="${active === 'thinking' ? 'active' : ''}">${icon('spark')}${t('nav_thinking')}</a><a href="#/calendar" class="${active === 'calendar' ? 'active' : ''}">${icon('cal')}${t('nav_calendar')}</a><a href="#/widgets" class="${active === 'widgets' ? 'active' : ''}">${icon('grid')}${t('nav_widgets')}</a><a href="#/billing" class="${active === 'billing' ? 'active' : ''}">${icon('coin')}${t('nav_billing')}</a><a href="#/support" id="navSupport" class="${active === 'support' ? 'active' : ''}">${icon('life')}${t('nav_support')}</a>${S.user && S.user.is_super ? `<a href="/admin">${icon('gear')}${t('nav_admin')}</a>` : ''}</nav>
      <div class="spacer"></div>
      <div class="side-prefs">
        <div class="pref"><span class="pref-ic">${icon(S.theme === 'dark' ? 'moon' : 'sun')}</span><span class="grow">${t('dark_mode')}</span><button type="button" class="tgl ${S.theme === 'dark' ? 'on' : ''}" id="themeBtn" role="switch" aria-checked="${S.theme === 'dark'}" aria-label="${t('dark_mode')}" data-tip="${t('dark_mode')}"><i>${icon(S.theme === 'dark' ? 'moon' : 'sun')}</i></button></div>
        <div class="pref"><span class="pref-ic">${icon('globe')}</span><span class="grow">${t('language')}</span><button type="button" class="seg2" id="langBtn" aria-label="${t('language')}" data-tip="${t('language')}"><span class="${S.lang !== 'ar' ? 'on' : ''}">EN</span><span class="${S.lang === 'ar' ? 'on' : ''}">عربي</span></button></div>
      </div>
      <div class="user-row"><a class="user-chip grow" href="#/account" style="text-decoration:none;color:inherit">${avatarHtml(S.user)}<div class="grow" style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.user.name)}</div><div class="small muted">${t('account_settings')}</div></div></a>
        <button type="button" class="btn ghost icon" id="logoutBtn" aria-label="${t('sign_out')}" data-tip="${t('sign_out')}">${icon('logout')}</button></div></aside>
      <main class="main" id="main">${projHead || ''}<div id="content">${content}</div></main></div>`;
    // hide and show the side menu, remembered between visits
    const shellEl = $('.shell'), mob = () => window.matchMedia('(max-width: 820px)').matches;
    let navOff = false; try { navOff = localStorage.getItem('pm_nav') === 'off'; } catch (e) { /* storage may be blocked */ }
    shellEl.classList.toggle('nav-off', navOff);
    const fab = document.createElement('button');
    fab.className = 'btn nav-fab'; fab.id = 'navShow'; fab.type = 'button'; fab.setAttribute('aria-label', t('nav_show')); fab.title = t('nav_show'); fab.innerHTML = icon('list');
    shellEl.appendChild(fab);
    // collapsed menu on desktop is an icon rail on the start side, labels become tooltips
    $$('.nav > a, .nav-fly > a', shellEl).forEach((a) => { [...a.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).forEach((n) => { const sp = document.createElement('span'); sp.className = 'nl'; sp.textContent = n.textContent.trim(); a.replaceChild(sp, n); }); });
    const hideBtn = $('#navHide');
    const railTips = (off) => {
      $$('.nav > a, .nav-fly > a', shellEl).forEach((a) => { if (off) a.setAttribute('data-tip', a.textContent.trim()); else a.removeAttribute('data-tip'); });
      const user = $('.user-chip', shellEl); if (user) { if (off) user.setAttribute('data-tip', S.user.name); else user.removeAttribute('data-tip'); }
      const lbl = t(off ? 'nav_show' : 'nav_hide'); hideBtn.setAttribute('aria-label', lbl); hideBtn.setAttribute('data-tip', lbl); hideBtn.removeAttribute('title');
    };
    const setNav = (off) => { if (mob()) { shellEl.classList.toggle('nav-open', !off); return; } shellEl.classList.toggle('nav-off', off); railTips(off); try { localStorage.setItem('pm_nav', off ? 'off' : 'on'); } catch (e) { /* ignore */ } };
    fab.onclick = () => setNav(false);
    hideBtn.onclick = () => setNav(mob() ? true : !shellEl.classList.contains('nav-off'));
    railTips(shellEl.classList.contains('nav-off'));
    $$('.sidebar a', shellEl).forEach((a) => a.addEventListener('click', () => shellEl.classList.remove('nav-open')));
    projectFlyout();
    $('#themeBtn').onclick = () => setPref({ theme: S.theme === 'dark' ? 'light' : 'dark' });
    $('#langBtn').onclick = () => setPref({ language: S.lang === 'ar' ? 'en' : 'ar' });
    $('#logoutBtn').onclick = () => signOut();
    if (PM.billing) PM.billing.bind();
  }
  // hover the Projects menu item to see every project, click one to open its workspace
  function projectFlyout() {
    const host = $('#navFly'); if (!host) return;
    const link = $('a', host);
    const fly = document.createElement('div');
    fly.className = 'fly'; fly.setAttribute('role', 'menu'); fly.setAttribute('aria-label', t('nav_projects'));
    const dot = (h) => `var(--${h === 'red' ? 'danger' : h === 'amber' ? 'warning' : 'success'})`;
    fly.innerHTML = `<div class="fly-head">${t('fly_title')}</div><div class="fly-list">${S.projects.map((p) => `<div class="fly-row ${S.project && S.project.id === p.id ? 'cur' : ''}" role="none"><a role="menuitem" class="fly-main" href="#/p/${p.id}/overview"><span class="dot" style="background:${dot(p.stats.health)}"></span><span class="grow"><b>${esc(p.name)}</b><span class="small muted">${esc(p.client || p.code || '')}</span></span><span class="small muted">${p.stats.progress}%</span></a><span class="fly-quick"><a role="menuitem" href="#/p/${p.id}/schedule" data-tip="${t('tab_schedule')}" aria-label="${t('tab_schedule')}">${icon('cal')}</a><a role="menuitem" href="#/p/${p.id}/inbox" data-tip="${t('tab_inbox')}" aria-label="${t('tab_inbox')}">${icon('inbox')}</a></span></div>`).join('') || `<div class="small faint" style="padding:10px">${t('no_projects_yet')}</div>`}</div><div class="fly-foot"><a href="#/projects">${t('fly_all')}</a></div>`;
    document.body.appendChild(fly);
    let timer;
    const place = () => {
      const r = host.getBoundingClientRect(), side = $('.sidebar').getBoundingClientRect(), rtl = document.documentElement.dir === 'rtl';
      fly.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - fly.offsetHeight - 8)) + 'px';
      if (rtl) { fly.style.right = (innerWidth - side.left) + 'px'; fly.style.left = 'auto'; } else { fly.style.left = side.right + 'px'; fly.style.right = 'auto'; }
    };
    const open = () => { clearTimeout(timer); if (fly.classList.contains('on')) return; fly.classList.add('on'); link.setAttribute('aria-expanded', 'true'); place(); };
    const close = (now) => { clearTimeout(timer); timer = setTimeout(() => { fly.classList.remove('on'); link.setAttribute('aria-expanded', 'false'); }, now ? 0 : 160); };
    host.addEventListener('mouseenter', open); host.addEventListener('mouseleave', () => close());
    fly.addEventListener('mouseenter', () => clearTimeout(timer)); fly.addEventListener('mouseleave', () => close());
    host.addEventListener('focusin', open);
    fly.addEventListener('focusout', (e) => { if (!fly.contains(e.relatedTarget) && !host.contains(e.relatedTarget)) close(); });
    fly.addEventListener('click', (e) => { if (e.target.closest('a')) close(true); });
    document.addEventListener('keydown', function esc2(e) { if (!fly.isConnected) return document.removeEventListener('keydown', esc2); if (e.key === 'Escape') close(true); });
    // the page re-renders the shell on every route, so remove the old pop up with it
    const mo = new MutationObserver(() => { if (!host.isConnected) { fly.remove(); mo.disconnect(); } });
    mo.observe(document.getElementById('app'), { childList: true });
  }
  async function setPref(p) {
    try { const r = await api('PUT', '/api/me', p); setUser(r.user); PM.vt(route); } catch (e) { toast(e.message, 'err'); }
  }
  PM.setPref = setPref;
  PM.shell = shell;
  PM.loadProjects = loadProjects;

  const healthChip = (h) => `<span class="chip ${h === 'red' ? 'red' : h === 'amber' ? 'amber' : 'green'}"><span class="dotc ${h}"></span>${t('health_' + h)}</span>`;
  PM.healthChip = healthChip;
  // A closed project shows Closed in place of its health, which no longer means anything.
  PM.statusChip = (p) => (p.status === 'closed' ? `<span class="chip">${icon('check')}${t('pc_closed')}</span>` : healthChip(p.stats.health));

  // ---------- dashboard ----------
  PM.views.dashboard = async function () {
    shell('dash', spot());
    const [d] = await Promise.all([api('GET', '/api/dashboard'), loadProjects()]);
    if (S.projects.length) shell('dash', '<div class="page"></div>');
    const unassigned = d.unassigned ? (await api('GET', '/api/inbox/unassigned')).inbox : [];
    const kpi = (v, l, cls = '') => `<div class="card kpi"><div class="v ${cls}">${v}</div><div class="l">${l}</div></div>`;
    const totals = Object.entries(d.totalValue).map(([c, v]) => money(v, c)).join(' + ') || '0';
    const rows = d.projects.map((p) => `<tr style="cursor:pointer" data-go="#/p/${p.id}/overview"><td><div style="font-weight:600">${esc(p.name)}</div><div class="small muted">${esc(p.client || '')}</div></td><td>${healthChip(p.stats.health)}</td>
      <td style="min-width:150px"><div class="row small"><span class="grow">${p.stats.progress}%</span>${p.stats.planned != null ? `<span class="muted">${t('planned')} ${p.stats.planned}%</span>` : ''}</div><div class="progress"><i style="width:${p.stats.progress}%"></i></div></td>
      <td class="nowrap">${p.stats.forecast_end || '-'}</td><td>${p.stats.overdue ? `<span class="chip red">${p.stats.overdue}</span>` : '<span class="muted">0</span>'}</td>
      <td>${p.stats.pendingItems + p.stats.pendingInbox ? `<span class="badge-count">${p.stats.pendingItems + p.stats.pendingInbox}</span>` : ''}</td></tr>`).join('');
    const pay = d.payments.map((x) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.title)}</div><div class="small muted">${esc(x.project)}</div></div><div class="right"><div>${x.amount != null ? money(x.amount, x.currency) : ''}</div><div class="small ${x.late ? '' : 'muted'}" style="${x.late ? 'color:var(--danger)' : ''}">${x.due}${x.late ? ` (${t('late')})` : ''}</div></div></div>`).join('');
    const od = d.overdue.map((x) => `<div class="list-item"><div class="grow"><div style="font-weight:600">${esc(x.task)}</div><div class="small muted">${esc(x.project)}${x.assignee ? ` · ${esc(x.assignee)}` : ''}</div></div><div class="right small" style="color:var(--danger)">${x.finish}<div class="muted">${x.progress}%</div></div></div>`).join('');
    const act = d.activity.map((a) => `<div class="list-item"><div class="grow"><div>${esc(a.detail.summary || a.action)}</div><div class="small muted">${esc(a.project)} · ${esc(a.actor)} · ${esc((a.ts || '').slice(0, 16))}</div></div></div>`).join('');
    $('#content').innerHTML = `<div class="page dash">
      <div class="page-head"><h1>${t('welcome', { name: esc(S.user.name.split(' ')[0]) })}</h1><button class="btn primary" id="newProj">${icon('plus')}${t('new_project')}</button></div>
      ${PM.onboard ? PM.onboard.banner() : ''}
      ${d.pendingItems + d.pendingInbox ? `<div class="banner mb">${icon('spark')}<div class="grow"><b>${t('needs_attention')}</b> ${t('attention_detail', { items: d.pendingItems, updates: d.pendingInbox })}</div></div>` : ''}
      <div id="dashHost"></div>
      ${unassigned.length ? `<div class="card mt"><div class="card-head"><h3>${t('unassigned_msgs')}</h3></div>${unassigned.map((m) => `<div class="list-item"><div class="grow"><div class="small muted">${esc(m.source)} · ${esc(m.sender || '')}</div><div>${esc((m.body || '').slice(0, 200))}</div></div><select data-assign="${m.id}" style="width:180px"><option value="">${t('assign_to')}</option>${d.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>`).join('')}</div>` : ''}</div>`;
    if (PM.onboard) PM.onboard.bind($('#content'));
    PM.dash.mount($('#dashHost'), d);
    $$('[data-assign]').forEach((s) => (s.onchange = async () => { if (!s.value) return; await busy(null, () => api('POST', `/api/inbox/${s.dataset.assign}/assign`, { project_id: Number(s.value) })); toast(t('assigned'), 'ok'); route(); }));
    const np = $('#newProj'); if (np) np.onclick = newProjectDialog;
  };

  PM.views.projects = async function () {
    shell('projects', spot());
    await loadProjects();
    shell('projects', '');
    const cards = S.projects.map((p) => `<a class="card" href="#/p/${p.id}/overview" style="text-decoration:none;color:inherit;display:block"><div class="row">${p.client_logo ? `<img src="${esc(p.client_logo)}" alt="" style="height:30px;max-width:90px;object-fit:contain">` : ''}<div class="grow"><h3>${esc(p.name)}</h3><div class="small muted">${esc(p.client || t('no_client'))}</div></div>${healthChip(p.stats.health)}</div>
      <div class="mt"><div class="row small"><span class="grow">${t('progress')} ${p.stats.progress}%</span><span class="muted">${p.value ? money(p.value, p.currency) : ''}</span></div><div class="progress" style="margin-top:6px"><i style="width:${p.stats.progress}%"></i></div></div>
      <div class="row small muted mt wrap"><span>${p.start_date || '?'} to ${p.end_date || '?'}</span>${p.stats.pendingItems + p.stats.pendingInbox ? `<span class="chip blue">${p.stats.pendingItems + p.stats.pendingInbox} ${t('to_review')}</span>` : ''}</div></a>`).join('');
    $('#content').innerHTML = `<div class="page"><div class="page-head"><h1>${t('nav_projects')}</h1><button class="btn primary" id="newProj">${icon('plus')}${t('new_project')}</button></div>
      ${S.projects.length ? `<div class="grid g3">${cards}</div>` : `<div class="card empty"><div class="big">${icon('folder')}</div><p>${t('empty_projects')}</p></div>`}</div>`;
    $('#newProj').onclick = newProjectDialog;
  };

  function newProjectDialog() {
    let files = [];
    const m = modal({ title: t('new_project'), size: 'lg', body: `<form id="npForm" class="col gap-lg"><label class="f">${t('project_name')}<input type="text" id="npName" required placeholder="${t('project_name_ph')}"></label>
      <div><div style="font-weight:600;margin-bottom:4px">${t('attach_docs')}</div><div class="small muted" style="margin-bottom:8px">${t('attach_docs_hint')}</div><div id="npDrop"></div><div class="filelist" id="npFiles"></div></div>
      <div class="banner">${icon('spark')}<div class="small">${t('np_explain')}</div></div></form>`, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="npGo">${icon('spark')}${t('create_analyze')}</button>` });
    const list = () => { m.$('#npFiles').innerHTML = files.map((f, i) => `<div class="fi">${icon('file')}<span class="grow">${esc(f.name)}</span><span class="small muted">${(f.size / 1024).toFixed(0)} KB</span><button type="button" class="btn ghost icon sm" data-rm="${i}">${icon('x')}</button></div>`).join(''); m.$$('[data-rm]').forEach((b) => (b.onclick = () => { files.splice(Number(b.dataset.rm), 1); list(); })); };
    dropzone(m.$('#npDrop'), { accept: '.pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.xml,.mpp', onFiles: (f) => { files = files.concat(f).slice(0, 12); list(); } });
    const go = async () => {
      const name = m.$('#npName').value.trim();
      if (!name) { m.$('#npName').focus(); return; }
      const fd = new FormData();
      fd.append('name', name);
      files.forEach((f) => fd.append('files', f));
      const r = await busy(m.$('#npGo'), () => api('POST', '/api/projects', fd));
      if (r) { m.close(); await loadProjects(); location.hash = `#/p/${r.project.id}/review`; }
    };
    m.$('#npGo').onclick = go;
    m.$('#npForm').onsubmit = (e) => { e.preventDefault(); go(); };
    setTimeout(() => m.$('#npName').focus(), 50);
  }
  PM.newProjectDialog = newProjectDialog;

  // ---------- account ----------
  PM.views.account = async function () {
    shell('', '');
    const u = S.user;
    $('#content').innerHTML = `<div class="page" style="max-width:760px"><div class="page-head"><h1>${t('account_settings')}</h1></div>
      <div class="card"><div class="row gap-lg">${avatarHtml(u, 'lg')}<div class="grow"><div style="font-weight:600;font-size:var(--fs-heading)">${esc(u.name)}</div><div class="muted">${esc(u.email)}</div></div><label class="btn"><input type="file" id="avFile" accept="image/*" class="hidden">${icon('upload')}${t('upload_photo')}</label></div></div>
      <div class="card mt"><div class="card-head"><h3>${t('profile')}</h3></div><div class="form-grid"><label class="f">${t('name')}<input type="text" id="acName" value="${esc(u.name)}"></label><label class="f">${t('email')}<input type="text" value="${esc(u.email)}" disabled></label>
        <label class="f">${t('ob_mobile')}<input type="tel" id="acPhone" dir="ltr" value="${esc(PM.onboard ? PM.onboard.phone() : '')}" placeholder="+971501234567" inputmode="tel" autocomplete="tel"></label><span></span>
        <label class="f">${t('interface_language')}<select id="acLang"><option value="en" ${S.lang === 'en' ? 'selected' : ''}>English</option><option value="ar" ${S.lang === 'ar' ? 'selected' : ''}>العربية</option></select></label>
        <label class="f">${t('appearance')}<select id="acTheme"><option value="light" ${S.theme === 'light' ? 'selected' : ''}>${t('light')}</option><option value="dark" ${S.theme === 'dark' ? 'selected' : ''}>${t('dark')}</option></select></label></div>
        <div class="row mt"><button class="btn primary" id="acSave">${t('save')}</button></div></div>
      ${PM.onboard ? PM.onboard.accountCards() : ''}
      ${PM.data ? PM.data.accountCard() : ''}
      <div class="card mt"><div class="card-head"><h3>${t('change_password')}</h3></div><div class="form-grid"><label class="f">${t('current_password')}<input type="password" id="pwCur" autocomplete="current-password"></label><label class="f">${t('new_password')}<input type="password" id="pwNew" autocomplete="new-password" minlength="8"></label></div><div class="row mt"><button class="btn" id="pwSave">${t('update_password')}</button></div></div>
      <div class="card mt"><div class="card-head"><h3>${t('cw_connections')}</h3></div><div class="small muted mb">${t('cw_connections_hint')}</div><div id="connHost" class="conn-list"></div></div>
      <div class="card mt"><div class="card-head"><h3>${t('ai_engine')}</h3></div><div class="row wrap"><span class="chip ${S.status.claude ? 'green' : 'amber'}">${S.status.claude ? `${t('ai_on')} (${esc(S.status.model)})` : t('ai_rules')}</span><span class="chip ${S.status.jira ? 'green' : ''}">Jira ${S.status.jira ? t('connected') : t('not_configured')}</span><span class="chip ${S.status.graph ? 'green' : ''}">Microsoft 365 ${S.status.graph ? t('connected') : t('not_configured')}</span></div><p class="small muted" style="margin-bottom:0">${t('ai_engine_hint')}</p></div></div>`;
    if ($('#connHost') && PM.connect) PM.connect.mountRows($('#connHost'));
    if (PM.onboard) PM.onboard.bindAccount($('#content'));
    if (PM.data) PM.data.bindAccount($('#content'));
    $('#acSave').onclick = () => busy($('#acSave'), async () => { const pe = PM.onboard ? PM.onboard.savePhone($('#acPhone').value) : ''; if (pe) { toast(pe, 'err'); $('#acPhone').focus(); return; } await api('PUT', '/api/me', { name: $('#acName').value.trim() || u.name, language: $('#acLang').value, theme: $('#acTheme').value }).then((r) => setUser(r.user)); toast(t('saved'), 'ok'); route(); });
    $('#pwSave').onclick = () => busy($('#pwSave'), async () => { const pr = await api('POST', '/api/me/password', { current: $('#pwCur').value, next: $('#pwNew').value }); if (pr && pr.token) { S.token = pr.token; localStorage.setItem('pm_token', pr.token); } $('#pwCur').value = ''; $('#pwNew').value = ''; toast(t('saved'), 'ok'); });
    $('#avFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const r = await busy(null, () => api('POST', '/api/me/avatar', fd)); if (r) { setUser(r.user); toast(t('saved'), 'ok'); route(); } };
  };

  // ---------- project shell ----------
  const TABS = [['overview', 'chart'], ['review', 'check'], ['schedule', 'cal'], ['logs', 'list'], ['meetings', 'mic'], ['inbox', 'inbox'], ['documents', 'file'], ['reports', 'spark'], ['closure', 'flag'], ['thinking', 'chat'], ['settings', 'gear']];
  // Project shortcuts in the header: icon only buttons, each with a tooltip and an accessible name.
  const projLinks = (p) => {
    const items = [['sharepoint_url', 'folder', 'pl_open_sp'], ['jira_url', 'jira', 'pl_open_jira']].filter(([k]) => p[k]);
    return items.length ? `<div class="proj-links" role="group" aria-label="${esc(t('pl_title'))}">${items.map(([k, ic, name]) => `<a class="btn ghost icon" href="${esc(p[k])}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t(name))}" data-tip="${esc(t(name))}">${icon(ic)}</a>`).join('')}</div>` : '';
  };
  const spot = () => `${PM.loader.html({ size: 'page' })}`;
  // A soft refresh keeps the side menu and the page frame and only reloads the project header and the open tab.
  PM.projectView = async function (id, tab, query, opts) {
    const soft = !!(opts && opts.soft) && S.project && S.project.id === id && !!$('#main > .proj-head') && !!$('#content');
    if (!soft && (!S.project || S.project.id !== id)) shell('', spot());
    let p;
    // the project and the project list are independent, so they load together
    try { p = (await Promise.all([api('GET', `/api/projects/${id}`), loadProjects()]))[0].project; } catch (e) { toast(e.message, 'err'); location.hash = '#/projects'; return; }
    S.project = p;
    const badge = (k) => (k === 'review' && p.stats.pendingItems ? `<span class="badge-count">${p.stats.pendingItems}</span>` : k === 'inbox' && p.stats.pendingInbox ? `<span class="badge-count">${p.stats.pendingInbox}</span>` : '');
    const endCounter = (pr) => {
      if (pr.status === 'closed') return `<div class="endctr" role="status"><b>${t('pc_closed')}</b><span>${esc(String(pr.closed_at || '').slice(0, 10))}</span></div>`;
      const end = pr.end_date || pr.stats.forecast_end; if (!end) return '';
      const U = (x) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10)) / 86400000;
      const d = U(end) - U(pr.stats.today || today());
      const cls = d < 0 ? 'bad' : d <= 30 ? 'warn' : 'ok';
      const fc = pr.stats.forecast_end, drift = pr.end_date && fc ? U(fc) - U(pr.end_date) : 0;
      const tip = `${t('end_counter_end')}: ${end}${drift > 0 ? `\n${t('end_counter_forecast')}: ${fc} (+${drift} ${t('days')})` : ''}`;
      const big = d === 0 ? t('end_counter_today') : String(Math.abs(d));
      return `<div class="endctr ${cls}" data-tip="${esc(tip)}" role="status" aria-label="${esc(tip)}"><b>${big}</b><span>${d === 0 ? '' : d < 0 ? t('end_counter_past') : t('end_counter_left')}</span></div>`;
    };
    const head = `<div class="proj-head"><div class="proj-title">${p.client_logo ? `<img class="logo" src="${esc(p.client_logo)}" alt="">` : ''}<h1>${esc(p.name)}</h1>${PM.statusChip(p)}<span class="muted small">${esc(p.client || '')}</span><span class="grow"></span>${projLinks(p)}${endCounter(p)}${p.analyzing ? `<span class="chip blue">${PM.loader.html({ size: 'sm' })}${t('analyzing')}</span>` : ''}</div>
      <div class="tabs">${TABS.map(([k, ic]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/p/${id}/${k}">${icon(ic)}${t('tab_' + k)}${badge(k)}</a>`).join('')}</div>${p.status === 'closed' && tab !== 'closure' ? `<div class="banner cl-head-note" role="status"><span class="grow">${t('cl_banner_head')}</span><a class="btn sm" href="#/p/${id}/closure">${t('cl_banner_go')}</a></div>` : ''}</div>`;
    if (soft) $('#main > .proj-head').outerHTML = head; else shell('', spot(), head);
    const view = PM.views['tab_' + tab];
    if (!view) { $('#content').innerHTML = ''; return; }
    const token = ++S.nav;
    // a tab that is still fetching its data shows the loading screen instead of an empty page
    const endLoad = PM.loader.show(t('ld_loading'));
    try { await view($('#content'), p, query, token); } catch (e) { console.error(e); $('#content').innerHTML = `<div class="page"><div class="card empty">${esc(e.message)}${PM.tickets ? `<div style="margin-top:12px"><button class="btn" id="spRep">${t('sp_report_problem')}</button></div>` : ''}</div></div>`; const rb = $('#spRep'); if (rb) rb.onclick = () => PM.tickets.open(); } finally { endLoad(); }
  };
  PM.stale = (token) => token !== S.nav;

  // ---------- router ----------
  async function route() {
    const soft = S.soft; S.soft = false;
    applyPrefs();
    const h = location.hash.replace(/^#/, '') || '/';
    const [pathPart, qs] = h.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    if (!S.token) { location.replace('index.html'); return; }
    if (!S.user) {
      try { const r = await api('GET', '/api/me'); setUser(r.user); S.status = r.status; } catch { return; }
    }
    if (parts[0] === 'login' || parts[0] === 'register') { location.hash = '#/'; return; }
    if (PM.onboard) PM.onboard.gate();
    S.nav++;
    if (!parts.length) return PM.views.dashboard();
    if (parts[0] === 'billing') { S.project = null; return PM.views.billing(); }
    if (parts[0] === 'support') { S.project = null; return PM.views.support(parts[1] ? Number(parts[1]) : null); }
    if (parts[0] === 'brand') { S.project = null; return PM.views.brand(); }
    if (parts[0] === 'projects') { S.project = null; return PM.views.projects(); }
    if (parts[0] === 'trends') { location.hash = '#/'; return; }
    if (parts[0] === 'thinking') { S.project = null; return PM.views.thinking(); }
    if (parts[0] === 'calendar') { S.project = null; return PM.views.calendar(); }
    if (parts[0] === 'widgets') {
      S.project = null;
      if (parts[1] === 'new') return PM.views.widgetBuilder(null);
      if (parts[1] && parts[2] === 'edit') return PM.views.widgetBuilder(Number(parts[1]));
      return PM.views.widgets(new URLSearchParams(qs || ''));
    }
    if (parts[0] === 'account') return PM.views.account();
    if (parts[0] === 'p' && parts[1]) return PM.projectView(Number(parts[1]), parts[2] && parts[2] !== 'trends' ? parts[2] : 'overview', new URLSearchParams(qs || ''), { soft });
    location.hash = '#/';
  }
  PM.route = route;
  // reload what is on screen after a change made somewhere else (the chat), without rebuilding the page frame
  PM.refresh = () => { S.soft = true; return route(); };
  // page transitions: cross fade the whole view where the browser supports it
  PM.vt = (fn) => { const rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; if (document.startViewTransition && !rm && S.token) { try { const tr = document.startViewTransition(fn); ['ready', 'finished'].forEach((k) => tr[k] && tr[k].catch(() => {})); return tr; } catch (e) { /* fall through */ } } return fn(); };
  // Problems in the browser are reported to the server so the super admin can see them. At most five per page visit.
  (function reportErrors() {
    let sent = 0; const seen = new Set();
    const send = (message, stack) => {
      const key = String(message).slice(0, 120); if (sent >= 5 || seen.has(key)) return; seen.add(key); sent++;
      try { fetch('/api/client-error', { method: 'POST', keepalive: true, headers: Object.assign({ 'content-type': 'application/json' }, S.token ? { Authorization: `Bearer ${S.token}` } : {}), body: JSON.stringify({ message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 3000), url: location.pathname + location.hash }) }).catch(() => {}); } catch (e) { /* best effort */ }
    };
    let offered = 0;
    const offer = () => { if (offered++ || !PM.tickets) return; setTimeout(() => toast(t('sp_unexpected'), 'err', { label: t('sp_report_it'), fn: () => PM.tickets.open() }), 400); };
    window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver loop/.test(e.message)) { send(e.message, e.error && e.error.stack); offer(); } });
    window.addEventListener('unhandledrejection', (e) => { const r = e.reason; send('Unhandled promise rejection: ' + ((r && r.message) || r), r && r.stack); });
  })();
  PM.start = () => { window.addEventListener('hashchange', () => PM.vt(route)); route(); };
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-go]'); if (a && a.tagName !== 'TR') location.hash = a.dataset.go; });
})();
