/* Super admin console. Plain JavaScript, hash routing, no build step. Talks to /api/admin with the person's own sign in. */
(function () {
  'use strict';
  const KEY = 'pm_admin_token';
  const S = { token: null, me: null, timer: null };
  try { S.token = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  try { const th = localStorage.getItem('pm_theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* storage blocked */ }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const ICONS = {
    home: '<path d="m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>', coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2.5 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>', pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="m15 18-6-6 6-6"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', dl: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>',
  };
  const ic = (n) => `<svg class="ad-ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const nf = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const tok = (n) => (n >= 1e9 ? nf(n / 1e9, 2) + ' B' : n >= 1e6 ? nf(n / 1e6, 2) + ' M' : n >= 1e3 ? nf(n / 1e3, 1) + ' K' : nf(n));
  const money = (cents, cur) => `${cur || 'USD'} ${nf(Number(cents || 0) / 100, 2)}`;
  const usd = (v, d = 2) => `$${nf(v, d)}`;
  const dt = (s) => (s ? new Date(s).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never');
  const day = (s) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'None');
  const ago = (s) => { if (!s) return 'Never'; const m = Math.round((Date.now() - new Date(s)) / 60000); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : day(s); };
  const dur = (sec) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const dateInput = (s) => (s ? new Date(s).toISOString().slice(0, 10) : '');
  const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;
  const STATE = { trial: ['blue', 'Trial'], active: ['green', 'Active'], expired: ['red', 'Expired'], cancelled: ['amber', 'Cancelled'], ended: ['gray', 'Ended'], none: ['gray', 'None'] };
  const stateChip = (s) => chip(...(STATE[s] || ['gray', s]));
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  async function api(method, path, body) {
    const init = { method, headers: {} };
    if (S.token) init.headers.Authorization = `Bearer ${S.token}`;
    if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    let r; try { r = await fetch(path, init); } catch (e) { throw new Error('The server could not be reached. Check your connection and try again.'); }
    let data = null; try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401) { signOut(); throw new Error('Your session has ended. Sign in again.'); }
    if (!r.ok) throw new Error((data && data.error) || r.statusText);
    return data;
  }
  async function download(path, name) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${S.token}` } });
    if (!r.ok) { toast('The file could not be downloaded.', 'err'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function toast(msg, type) {
    let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = `toast ${type || ''}`; el.setAttribute('role', 'status'); el.innerHTML = `<span>${esc(msg)}</span>`; box.appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
  }
  function modal({ title, body, footer, size = '' }) {
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-close aria-label="Close">&times;</button></div><div class="modal-body">${body || ''}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
    const prev = document.activeElement; document.body.appendChild(ov);
    const m = { el: ov, $: (s) => $(s, ov), close() { if (ov.isConnected) { ov.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); } } };
    const onKey = (e) => { if (e.key === 'Escape') m.close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) m.close(); });
    const first = $('input, select, textarea, .btn.primary', ov); if (first) first.focus();
    return m;
  }
  function confirmDlg({ title, message, ok, danger }) {
    return new Promise((res) => {
      let done = false;
      const m = modal({ title, body: `<p style="margin:0">${message}</p>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok || 'Confirm')}</button>` });
      m.$('[data-ok]').onclick = () => { done = true; res(true); m.close(); };
      m.el.addEventListener('click', (e) => { if (!done && e.target.closest('[data-close]')) res(false); });
      m.$('[data-ok]').focus();
    });
  }
  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.h = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; }
    try { return await fn(); } catch (e) { toast(e.message, 'err'); return undefined; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.h; } }
  }
  const tip = (s) => `title="${esc(s)}" aria-label="${esc(s)}"`;
  const loading = () => '<div style="display:grid;place-items:center;padding:60px"><span class="spinner"></span></div>';
  const empty = (t) => `<div class="empty">${esc(t)}</div>`;
  const kpi = (v, l, h, tone) => `<div class="ad-kpi ${tone || ''}"><div class="v">${v}</div><div class="l">${esc(l)}</div>${h ? `<div class="h">${esc(h)}</div>` : ''}</div>`;
  const note = (t, cls) => `<div class="ad-note ${cls || ''}" role="note">${esc(t)}</div>`;
  function bars(list, { fmt = nf, cls = '', label = 'Chart' } = {}) {
    const max = Math.max(1, ...list.map((x) => x.v));
    return `<div class="ad-bars ${cls}" role="img" aria-label="${esc(label)}">${list.map((x) => `<i class="${x.v ? '' : 'zero'}" style="height:${x.v ? Math.max(3, Math.round((x.v / max) * 100)) : 2}%" tabindex="0" title="${esc(x.t || x.d)}: ${esc(fmt(x.v))}"></i>`).join('')}</div><div class="ad-axis"><span>${esc(list[0] ? (list[0].t || list[0].d) : '')}</span><span>${esc(list.length ? (list[list.length - 1].t || list[list.length - 1].d) : '')}</span></div>`;
  }
  function pager(r, onPage) {
    const pages = Math.max(1, Math.ceil(r.total / r.size));
    const html = `<div class="ad-pager"><span>${nf(r.total)} total</span><button class="btn sm" data-pg="-1" ${r.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${r.page} of ${pages}</span><button class="btn sm" data-pg="1" ${r.page >= pages ? 'disabled' : ''}>Next</button></div>`;
    return { html, bind(root) { $$('[data-pg]', root).forEach((b) => (b.onclick = () => onPage(r.page + Number(b.dataset.pg)))); } };
  }
  const field = (label, input, help) => `<label class="f">${esc(label)}${input}${help ? `<span class="small muted">${esc(help)}</span>` : ''}</label>`;
  const view = () => $('#view');
  const setView = (h) => { const v = view(); if (v) v.innerHTML = h; };
  const fail = (e) => setView(`<div class="page"><div class="card"><div class="ad-note bad" role="alert">${esc(e.message)}</div><button class="btn" onclick="location.reload()">Try again</button></div></div>`);

  // ---------- sign in ----------
  function signOut() {
    if (S.token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${S.token}` } }).catch(() => {});
    S.token = null; S.me = null; try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
    clearInterval(S.timer); showLogin();
  }
  function showLogin(msg) {
    $('#app').innerHTML = `<div class="ad-login"><div class="card"><div class="brand" style="padding:0"><img src="brand/mark.svg" alt="" width="32" height="32"><span>Project Manager AI<span class="ad-tag">Super admin</span></span></div>
      <div><h1 style="font-size:var(--fs-title)">Sign in</h1><p class="muted" style="margin:6px 0 0">Use your normal account. Only super admins can enter.</p></div>
      <form id="lf" novalidate><label class="f">Email<input type="email" name="email" autocomplete="email" required></label><label class="f">Password<input type="password" name="password" autocomplete="current-password" required></label>
      <div class="ad-err" id="lerr" role="alert">${esc(msg || '')}</div><button class="btn primary" style="justify-content:center">Sign in</button></form></div></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault(); const b = $('button', e.target); b.disabled = true; $('#lerr').textContent = '';
      try {
        const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Sign in failed');
        S.token = d.token; const me = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${S.token}` } });
        if (me.status === 403) { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${S.token}` } }).catch(() => {}); S.token = null; throw new Error('This account is not a super admin.'); }
        try { localStorage.setItem(KEY, S.token); } catch (x) { /* storage blocked */ }
        boot();
      } catch (x) { $('#lerr').textContent = x.message; b.disabled = false; }
    };
  }

  // ---------- shell ----------
  const NAV = [
    ['overview', 'Overview', 'home'], ['users', 'Users', 'users'], ['subscriptions', 'Subscriptions', 'card'], ['finance', 'Finance and income', 'coin'], ['ai', 'AI consumption', 'spark'],
    ['projects', 'Projects', 'folder'], ['widgets', 'Widgets', 'grid'], ['config', 'Configuration', 'gear'], ['health', 'System health', 'pulse'], ['errors', 'Error log', 'alert'], ['audit', 'Audit log', 'list'],
  ];
  function shell() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#app').innerHTML = `<div class="shell" id="shell"><button class="btn icon ad-menu-btn" id="menuBtn" aria-label="Open the menu">${ic('menu')}</button>
      <aside class="sidebar"><div class="brand"><img src="brand/mark.svg" alt="" width="30" height="30"><span>Project Manager AI</span></div><span class="ad-tag" style="align-self:flex-start;margin:0 0 6px 8px">Super admin</span>
      <nav class="nav" aria-label="Super admin">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${ic(i)}<span class="nl">${l}</span></a>`).join('')}</nav>
      <div class="ad-side-foot"><b>${esc(S.me.name)}</b><span style="overflow:hidden;text-overflow:ellipsis">${esc(S.me.email)}</span>
      <div class="row"><a class="btn sm" href="/app.html">${ic('back')}App</a><button class="btn sm" id="themeBtn" ${tip('Switch between light and dark')}>${ic(dark ? 'sun' : 'moon')}</button><button class="btn sm" id="outBtn" ${tip('Sign out')}>${ic('logout')}</button></div></div></aside>
      <main class="ad-main" id="main"><div id="view"></div></main></div>`;
    $('#outBtn').onclick = signOut;
    $('#menuBtn').onclick = () => $('#shell').classList.toggle('open');
    $('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('pm_theme', t); } catch (e) { /* storage blocked */ } $('#themeBtn').innerHTML = ic(t === 'dark' ? 'sun' : 'moon'); };
    $('#main').addEventListener('click', () => $('#shell').classList.remove('open'));
  }

  // ---------- router ----------
  const VIEWS = {};
  async function route() {
    clearInterval(S.timer);
    const parts = location.hash.replace(/^#\/?/, '').split('/'); const key = parts[0] || 'overview';
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
    document.title = `${(NAV.find((n) => n[0] === key) || ['', 'Super admin'])[1]} | Super admin`;
    const fn = VIEWS[key] || VIEWS.overview;
    setView(loading());
    try { await fn(parts.slice(1)); } catch (e) { fail(e); }
    window.scrollTo(0, 0); const m = $('#main'); if (m) m.scrollTop = 0;
  }
  const head = (title, actions, sub) => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted" style="margin:4px 0 0">${esc(sub)}</p>` : ''}</div><div class="row">${actions || ''}</div></div>`;
  const refresh = () => route();

  // ---------- overview ----------
  VIEWS.overview = async () => {
    const o = await api('GET', '/api/admin/overview'); const cur = o.currency;
    const up = o.uptime.d7.pct;
    setView(`<div class="page">${head('Overview', '', 'The whole platform at a glance.')}
      <div class="ad-kpis">
        ${kpi(nf(o.users.total), 'Users', `${nf(o.users.new7)} new in 7 days, ${nf(o.users.active30)} active in 30 days`, 'info')}
        ${kpi(nf(o.subscriptions.active), 'Paying subscribers', `${nf(o.subscriptions.trial)} on trial, ${nf(o.subscriptions.expired)} expired`, 'good')}
        ${kpi(money(o.income.month_cents, cur), 'Income this month', `${money(o.income.total_cents, cur)} all time`, 'good')}
        ${kpi(money(o.mrr_cents, cur), 'Monthly recurring revenue', 'From active subscriptions', 'info')}
        ${kpi(tok(o.ai30.total), 'AI tokens, 30 days', `${nf(o.ai30.calls)} calls`, 'info')}
        ${kpi(usd(o.ai30.cost), 'AI cost, 30 days', 'Estimated at your rates', 'warn')}
        ${kpi(nf(o.errors24.open), 'Open errors, 24 hours', `${nf(o.errors24.total)} logged in total`, o.errors24.open ? 'bad' : 'good')}
        ${kpi(up == null ? 'No data' : up + '%', 'Uptime, 7 days', `${o.uptime.d1.pct == null ? 'No data' : o.uptime.d1.pct + '%'} in 24 hours`, up == null ? '' : up >= 99 ? 'good' : up >= 95 ? 'warn' : 'bad')}
      </div>
      <div class="ad-grid3 mt">
        <section class="card"><div class="card-head"><h3>New users, 30 days</h3></div>${bars(o.series.signups, { label: 'New users per day' })}</section>
        <section class="card"><div class="card-head"><h3>AI tokens, 30 days</h3></div>${bars(o.series.tokens, { cls: 'orange', fmt: tok, label: 'AI tokens per day' })}</section>
        <section class="card"><div class="card-head"><h3>Income, 30 days</h3></div>${bars(o.series.income.map((x) => ({ ...x })), { cls: 'green', fmt: (v) => money(v, cur), label: 'Income per day' })}</section>
      </div>
      <p class="small muted mt">${nf(o.projects)} projects on the platform. ${nf(o.users.suspended)} suspended accounts.</p></div>`);
  };

  // ---------- users ----------
  const F = { users: { q: '', status: '', role: '', page: 1 }, subs: { q: '', state: '', page: 1 }, projects: { q: '', page: 1 }, widgets: { page: 1 }, errors: { kind: '', resolved: '0', q: '', page: 1 }, audit: { q: '', page: 1 }, fin: { from: '', to: '', page: 1 }, aiDays: 30 };
  VIEWS.users = async (rest) => {
    if (rest[0]) return userDetail(Number(rest[0]));
    const f = F.users;
    async function draw() {
      const r = await api('GET', '/api/admin/users?' + qs(f)); const pg = pager(r, (p) => { f.page = p; draw(); });
      $('#tbl').innerHTML = r.users.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Plan</th><th class="num">Projects</th><th>Last seen</th></tr></thead><tbody>${r.users.map((u) => `<tr class="click" data-id="${u.id}" tabindex="0"><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${u.is_super ? chip('blue', 'Super admin') : chip('gray', 'User')}</td><td>${u.status === 'suspended' ? chip('red', 'Suspended') : chip('green', 'Active')}</td><td>${stateChip(u.subscription)}</td><td class="num">${nf(u.projects)}</td><td>${ago(u.last_seen_at)}</td></tr>`).join('')}</tbody></table></div>${pg.html}` : empty('No users match these filters.');
      $$('#tbl tr.click').forEach((tr) => { const go = () => (location.hash = `#/users/${tr.dataset.id}`); tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
      pg.bind($('#tbl'));
    }
    setView(`<div class="page">${head('Users', '<button class="btn primary" id="addUser">' + ic('plus') + 'Add user</button>', 'Every account on the platform.')}
      <div class="ad-toolbar"><input type="search" id="fq" placeholder="Search name or email" value="${esc(f.q)}" aria-label="Search users"><select id="fs" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select><select id="fr" aria-label="Role"><option value="">Any role</option><option value="super">Super admins</option></select></div>
      <div class="card" id="tbl">${loading()}</div></div>`);
    $('#fs').value = f.status; $('#fr').value = f.role;
    let t; $('#fq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; f.page = 1; draw(); }, 250); };
    $('#fs').onchange = (e) => { f.status = e.target.value; f.page = 1; draw(); }; $('#fr').onchange = (e) => { f.role = e.target.value; f.page = 1; draw(); };
    $('#addUser').onclick = addUserDlg;
    await draw();
  };
  function addUserDlg() {
    const m = modal({ title: 'Add user', body: `<div class="ad-modal-form">${field('Full name', '<input type="text" id="nm" maxlength="120">')}${field('Email', '<input type="email" id="em">')}${field('Password', '<input type="text" id="pw" autocomplete="off">', 'At least 8 characters. Share it securely.')}<label class="row"><button type="button" class="tgl" id="su" role="switch" aria-checked="false" aria-label="Super admin"><i></i></button><span>Make this person a super admin</span></label></div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Add user</button>' });
    $$('.tgl', m.el).forEach((b) => (b.onclick = () => { b.classList.toggle('on'); b.setAttribute('aria-checked', b.classList.contains('on')); }));
    m.$('#go').onclick = () => busy(m.$('#go'), async () => { await api('POST', '/api/admin/users', { name: m.$('#nm').value, email: m.$('#em').value, password: m.$('#pw').value, is_super: m.$('#su').classList.contains('on') }); m.close(); toast('User added'); refresh(); });
  }
  async function userDetail(id) {
    const d = await api('GET', `/api/admin/users/${id}`); const u = d.user, s = d.subscription;
    const pct = s.token_limit ? Math.min(100, Math.round((d.tokens_used / s.token_limit) * 100)) : 0;
    setView(`<div class="page"><a class="ad-back" href="#/users">${ic('back')}All users</a>${head(u.name, `<button class="btn" id="eEdit">Edit details</button><button class="btn" id="eSusp">${u.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button><button class="btn" id="eSuper">${u.is_super ? 'Remove super admin' : 'Make super admin'}</button><button class="btn" id="ePw">Reset password</button><button class="btn" id="eOut">Sign out everywhere</button><button class="btn danger" id="eDel">Delete</button>`, u.email)}
      <div class="ad-chips">${u.is_super ? chip('blue', 'Super admin') : ''}${u.status === 'suspended' ? chip('red', 'Account suspended') : chip('green', 'Account active')}${chip(...(STATE[s.state] || ['gray', s.state]).map((x, i) => (i ? 'Plan: ' + x : x)))}<span class="muted small">Joined ${day(u.created_at)}. Last seen ${ago(u.last_seen_at)}.</span></div>
      <div class="ad-grid2">
        <section class="card"><div class="card-head"><h3>Subscription</h3><div class="row"><button class="btn sm" id="sEdit">Edit</button><button class="btn sm primary" id="sAct">Activate or renew</button></div></div>
          <dl class="ad-dl"><dt>Plan</dt><dd>${esc(s.plan)}</dd><dt>State</dt><dd>${stateChip(s.state)}</dd><dt>Trial ends</dt><dd>${day(s.trial_end)}</dd><dt>Paid period</dt><dd>${s.period_end ? `${day(s.period_start)} to ${day(s.period_end)}` : 'None'}</dd><dt>Price</dt><dd>${money(s.price_cents)}</dd><dt>Renews automatically</dt><dd>${s.auto_renew ? 'Yes' : 'No'}</dd><dt>Notes</dt><dd>${esc(s.notes || 'None')}</dd></dl></section>
        <section class="card"><div class="card-head"><h3>Token use this period</h3></div><div class="kpi"><div class="v" style="font-size:var(--fs-metric)">${tok(d.tokens_used)}</div><div class="l">${s.token_limit ? `of ${tok(s.token_limit)} (${pct}%)` : 'No limit set'}</div></div><div class="progress mt"><i style="width:${pct}%"></i></div></section>
      </div>
      <section class="card mt"><div class="card-head"><h3>Projects</h3></div>${d.projects.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Name</th><th>Their role</th><th>Updated</th></tr></thead><tbody>${d.projects.map((p) => `<tr><td>${esc(p.name)}</td><td>${chip('gray', p.role || 'member')}</td><td>${dt(p.updated_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('This person has no projects.')}</section>
      <section class="card mt"><div class="card-head"><h3>Payments</h3><button class="btn sm" id="pAdd">${ic('plus')}Record payment</button></div>${d.payments.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Date</th><th class="num">Amount</th><th>Kind</th><th>Method</th><th>Reference</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${dt(p.paid_at)}</td><td class="num">${money(p.amount_cents, p.currency)}</td><td>${p.status === 'demo' ? chip('amber', 'Demo') : chip(p.kind === 'refund' ? 'red' : 'green', p.kind)}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td></tr>`).join('')}</tbody></table></div>` : empty('No payments recorded.')}</section>
      <section class="card mt"><div class="card-head"><h3>Recent errors</h3></div>${d.errors.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>When</th><th>Where</th><th>Message</th></tr></thead><tbody>${d.errors.map((e) => `<tr><td>${dt(e.created_at)}</td><td>${chip(e.kind === 'server' ? 'red' : 'amber', e.kind)} ${esc(e.path)}</td><td class="wrap">${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : empty('No errors for this person.')}</section></div>`);
    $('#eEdit').onclick = () => { const m = modal({ title: 'Edit details', body: `<div class="ad-modal-form">${field('Full name', `<input type="text" id="nm" maxlength="120" value="${esc(u.name)}">`)}${field('Email', `<input type="email" id="em" value="${esc(u.email)}">`)}</div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button>' }); m.$('#go').onclick = () => busy(m.$('#go'), async () => { await api('PUT', `/api/admin/users/${id}`, { name: m.$('#nm').value, email: m.$('#em').value }); m.close(); toast('Saved'); refresh(); }); };
    $('#eSusp').onclick = async () => { const to = u.status === 'suspended' ? 'active' : 'suspended'; if (to === 'suspended' && !(await confirmDlg({ title: 'Suspend this account', message: `${esc(u.name)} will be signed out and cannot sign in until you reactivate the account.`, ok: 'Suspend', danger: true }))) return; await busy(null, async () => { await api('PUT', `/api/admin/users/${id}`, { status: to }); toast(to === 'active' ? 'Account reactivated' : 'Account suspended'); refresh(); }); };
    $('#eSuper').onclick = async () => { const to = !u.is_super; if (!(await confirmDlg({ title: to ? 'Grant super admin' : 'Remove super admin', message: to ? `${esc(u.name)} will be able to manage everything on the platform, including users, money and settings.` : `${esc(u.name)} will lose access to this console.`, ok: to ? 'Grant access' : 'Remove access', danger: to }))) return; await busy(null, async () => { await api('PUT', `/api/admin/users/${id}`, { is_super: to }); toast('Saved'); refresh(); }); };
    $('#ePw').onclick = () => { const m = modal({ title: 'Reset password', body: `<div class="ad-modal-form">${field('New password', '<input type="text" id="pw" autocomplete="off">', 'At least 8 characters. All devices are signed out.')}</div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Reset password</button>' }); m.$('#go').onclick = () => busy(m.$('#go'), async () => { await api('POST', `/api/admin/users/${id}/password`, { password: m.$('#pw').value }); m.close(); toast('Password reset'); }); };
    $('#eOut').onclick = () => busy(null, async () => { await api('POST', `/api/admin/users/${id}/sign-out`, {}); toast('Signed out on every device'); });
    $('#eDel').onclick = async () => {
      if (!(await confirmDlg({ title: 'Delete this user', message: `This permanently deletes ${esc(u.name)}. It cannot be undone.${d.projects.some((p) => p.role === 'manager') ? ' Projects they own will be deleted too.' : ''}`, ok: 'Delete user', danger: true }))) return;
      await busy(null, async () => { try { await api('DELETE', `/api/admin/users/${id}`); } catch (e) { if (/owns/.test(e.message)) { if (!(await confirmDlg({ title: 'Delete their projects too', message: esc(e.message), ok: 'Delete everything', danger: true }))) return; await api('DELETE', `/api/admin/users/${id}?delete_projects=1`); } else throw e; } toast('User deleted'); location.hash = '#/users'; });
    };
    $('#sEdit').onclick = () => subEditDlg(id, s); $('#sAct').onclick = () => activateDlg(id, s); $('#pAdd').onclick = () => paymentDlg({ email: u.email, user_id: id });
  }

  // ---------- subscriptions ----------
  function subEditDlg(id, s) {
    const m = modal({ title: 'Edit subscription', size: 'lg', body: `<div class="ad-modal-form"><div class="two">${field('Status', `<select id="st"><option value="trial">Trial</option><option value="active">Active</option><option value="cancelled">Cancelled</option></select>`)}${field('Plan name', `<input type="text" id="pl" value="${esc(s.plan)}" maxlength="60">`)}</div>
      <div class="two">${field('Trial ends', `<input type="date" id="te" value="${dateInput(s.trial_end)}">`)}${field('Price in cents', `<input type="number" id="pr" min="0" value="${s.price_cents}">`, 'For example 2500 is 25.00')}</div>
      <div class="two">${field('Paid period starts', `<input type="date" id="ps" value="${dateInput(s.period_start)}">`)}${field('Paid period ends', `<input type="date" id="pe" value="${dateInput(s.period_end)}">`)}</div>
      <div class="two">${field('Token limit per period', `<input type="number" id="tl" min="0" value="${s.token_limit}">`, 'Zero means no limit.')}<label class="row" style="align-self:end"><button type="button" class="tgl ${s.auto_renew ? 'on' : ''}" id="ar" role="switch" aria-checked="${s.auto_renew}" aria-label="Renews automatically"><i></i></button><span>Renews automatically</span></label></div>
      ${field('Notes', `<input type="text" id="nt" maxlength="1000" value="${esc(s.notes)}">`)}</div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button>' });
    m.$('#st').value = s.status; const ar = m.$('#ar'); ar.onclick = () => { ar.classList.toggle('on'); ar.setAttribute('aria-checked', ar.classList.contains('on')); };
    m.$('#go').onclick = () => busy(m.$('#go'), async () => {
      await api('PUT', `/api/admin/subscriptions/${id}`, { status: m.$('#st').value, plan: m.$('#pl').value, trial_end: m.$('#te').value, period_start: m.$('#ps').value || null, period_end: m.$('#pe').value || null, price_cents: Number(m.$('#pr').value), token_limit: Number(m.$('#tl').value), auto_renew: ar.classList.contains('on'), notes: m.$('#nt').value });
      m.close(); toast('Subscription saved'); refresh();
    });
  }
  function activateDlg(id, s) {
    const m = modal({ title: 'Activate or renew', body: `<div class="ad-modal-form">${field('Days to add', '<input type="number" id="dy" min="1" max="3660" value="30">', 'A renewal adds days after the current period ends.')}<label class="row"><button type="button" class="tgl on" id="rp" role="switch" aria-checked="true" aria-label="Record the payment"><i></i></button><span>Record the payment in the ledger</span></label><div class="two">${field('Amount in cents', `<input type="number" id="am" min="1" value="${s.price_cents}">`)}${field('Method', '<input type="text" id="md" value="bank transfer" maxlength="60">')}</div>${field('Reference', '<input type="text" id="rf" maxlength="120">', 'Invoice or transfer number.')}</div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn good" id="go">Activate</button>' });
    const rp = m.$('#rp'); rp.onclick = () => { rp.classList.toggle('on'); rp.setAttribute('aria-checked', rp.classList.contains('on')); };
    m.$('#go').onclick = () => busy(m.$('#go'), async () => { await api('POST', `/api/admin/subscriptions/${id}/activate`, { days: Number(m.$('#dy').value), record_payment: rp.classList.contains('on'), amount_cents: Number(m.$('#am').value), method: m.$('#md').value, reference: m.$('#rf').value }); m.close(); toast('Subscription activated'); refresh(); });
  }
  VIEWS.subscriptions = async () => {
    const f = F.subs;
    async function draw() {
      const r = await api('GET', '/api/admin/subscriptions?' + qs(f)); const pg = pager(r, (p) => { f.page = p; draw(); });
      $('#tbl').innerHTML = r.subscriptions.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Person</th><th>Plan</th><th>State</th><th>Ends</th><th>Tokens used</th><th class="num">Price</th><th></th></tr></thead><tbody>${r.subscriptions.map((s) => { const pct = s.token_limit ? Math.min(100, Math.round((s.tokens_used / s.token_limit) * 100)) : 0; return `<tr><td><a href="#/users/${s.user_id}"><b>${esc(s.name)}</b></a><div class="small muted">${esc(s.email)}</div></td><td>${esc(s.plan)}</td><td>${stateChip(s.state)}</td><td>${day(s.status === 'active' || s.status === 'cancelled' ? s.period_end : s.trial_end)}</td><td style="min-width:170px">${tok(s.tokens_used)} of ${s.token_limit ? tok(s.token_limit) : 'no limit'}<div class="progress"><i style="width:${pct}%"></i></div></td><td class="num">${money(s.price_cents)}</td><td><div class="ad-acts"><button class="btn sm" data-e="${s.user_id}">Edit</button><button class="btn sm primary" data-a="${s.user_id}">Renew</button></div></td></tr>`; }).join('')}</tbody></table></div>${pg.html}` : empty('No subscriptions match these filters.');
      pg.bind($('#tbl'));
      $$('[data-e]').forEach((b) => (b.onclick = () => subEditDlg(Number(b.dataset.e), r.subscriptions.find((x) => x.user_id == b.dataset.e))));
      $$('[data-a]').forEach((b) => (b.onclick = () => activateDlg(Number(b.dataset.a), r.subscriptions.find((x) => x.user_id == b.dataset.a))));
    }
    setView(`<div class="page">${head('Subscriptions', '', 'Plans, trials and token use for every person.')}<div class="ad-toolbar"><input type="search" id="fq" placeholder="Search name or email" value="${esc(f.q)}" aria-label="Search subscriptions"><select id="fs" aria-label="State"><option value="">Any state</option><option value="trial">Trial</option><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="ended">Ended</option></select></div><div class="card" id="tbl">${loading()}</div></div>`);
    $('#fs').value = f.state; let t; $('#fq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; f.page = 1; draw(); }, 250); }; $('#fs').onchange = (e) => { f.state = e.target.value; f.page = 1; draw(); };
    await draw();
  };

  // ---------- finance ----------
  function paymentDlg(p) {
    const edit = !!p.id;
    const m = modal({ title: edit ? 'Edit payment' : 'Record payment', body: `<div class="ad-modal-form">${field('Customer email', `<input type="email" id="em" value="${esc(p.email || '')}" ${edit || p.user_id ? 'disabled' : ''}>`)}<div class="two">${field('Amount in cents', `<input type="number" id="am" min="1" value="${p.amount_cents || ''}">`, 'For example 2500 is 25.00')}${field('Currency', `<input type="text" id="cu" maxlength="3" value="${esc(p.currency || 'USD')}">`)}</div><div class="two">${field('Kind', `<select id="kd"><option value="payment">Payment</option><option value="refund">Refund</option></select>`)}${field('Date', `<input type="date" id="dd" value="${dateInput(p.paid_at || new Date())}">`)}</div><div class="two">${field('Method', `<input type="text" id="md" maxlength="60" value="${esc(p.method || '')}" placeholder="Bank transfer, card">`)}${field('Reference', `<input type="text" id="rf" maxlength="120" value="${esc(p.reference || '')}">`)}</div>${field('Note', `<input type="text" id="nt" maxlength="500" value="${esc(p.note || '')}">`)}</div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button>' });
    m.$('#kd').value = p.kind || 'payment';
    m.$('#go').onclick = () => busy(m.$('#go'), async () => {
      const body = { amount_cents: Number(m.$('#am').value), currency: m.$('#cu').value, kind: m.$('#kd').value, paid_at: m.$('#dd').value, method: m.$('#md').value, reference: m.$('#rf').value, note: m.$('#nt').value };
      if (edit) await api('PUT', `/api/admin/payments/${p.id}`, body); else await api('POST', '/api/admin/payments', { ...body, email: m.$('#em').value, user_id: p.user_id });
      m.close(); toast('Payment saved'); refresh();
    });
  }
  VIEWS.finance = async () => {
    const f = F.fin;
    const r = await api('GET', '/api/admin/finance?' + qs(f)); const t = r.totals; const cur = r.currency;
    const pg = pager(r.payments, (p) => { f.page = p; refresh(); });
    const mx = Math.max(1, ...r.by_month.map((x) => x.cents));
    setView(`<div class="page">${head('Finance and income', '<button class="btn" id="exp">' + ic('dl') + 'Export CSV</button><button class="btn primary" id="add">' + ic('plus') + 'Record payment</button>', `${day(r.from)} to ${day(r.to)}`)}
      ${note(r.note)}
      <div class="ad-toolbar"><label class="small muted">From <input type="date" id="ff" value="${f.from}"></label><label class="small muted">To <input type="date" id="ft" value="${f.to}"></label><button class="btn" id="fa">Apply</button><button class="btn ghost" id="fc">Last 12 months</button></div>
      <div class="ad-kpis">${kpi(money(t.net_cents, cur), 'Net income', `${money(t.gross_cents, cur)} gross, ${money(t.refunds_cents, cur)} refunds`, 'good')}${kpi(money(t.mrr_cents, cur), 'Monthly recurring revenue', `${nf(t.active_subscribers)} active subscribers`, 'info')}${kpi(money(t.arr_cents, cur), 'Annual run rate', 'MRR times twelve', 'info')}${kpi(usd(t.margin_usd), 'Income after AI cost', `AI cost ${usd(t.ai_cost_usd)} for this range`, t.margin_usd >= 0 ? 'good' : 'bad')}</div>
      <div class="ad-grid2 mt"><section class="card"><div class="card-head"><h3>Income by month</h3></div>${r.by_month.length ? bars(r.by_month.map((x) => ({ d: x.month, v: x.cents })), { cls: 'green', fmt: (v) => money(v, cur), label: 'Income by month' }) : empty('No income recorded in this range.')}</section>
      <section class="card"><div class="card-head"><h3>By method</h3></div>${r.by_method.length ? r.by_method.map((x) => `<div class="ad-bar-row"><span>${esc(x.method)}</span><div class="progress"><i style="width:${Math.max(2, Math.round((x.cents / Math.max(1, r.by_method[0].cents)) * 100))}%"></i></div><span class="n">${money(x.cents, cur)}</span></div>`).join('') : empty('No payments yet.')}</section></div>
      <div class="ad-grid2 mt"><section class="card"><div class="card-head"><h3>Top customers</h3></div>${r.top_customers.length ? r.top_customers.map((x) => `<div class="ad-bar-row"><span title="${esc(x.email)}" style="overflow:hidden;text-overflow:ellipsis">${esc(x.email)}</span><div class="progress"><i style="width:${Math.max(2, Math.round((x.cents / Math.max(1, r.top_customers[0].cents)) * 100))}%"></i></div><span class="n">${money(x.cents, cur)}</span></div>`).join('') : empty('No customers yet.')}</section>
      <section class="card"><div class="card-head"><h3>Demo payments</h3></div><div class="kpi"><div class="v">${money(t.demo_cents, cur)}</div><div class="l">From the in app demo subscribe step. Not counted as income.</div></div></section></div>
      <section class="card mt"><div class="card-head"><h3>Ledger</h3></div>${r.payments.rows.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Date</th><th>Customer</th><th class="num">Amount</th><th>Kind</th><th>Method</th><th>Reference</th><th></th></tr></thead><tbody>${r.payments.rows.map((p) => `<tr><td>${dt(p.paid_at)}</td><td>${esc(p.name || '')}<div class="small muted">${esc(p.email)}</div></td><td class="num">${money(p.amount_cents, p.currency)}</td><td>${p.status === 'demo' ? chip('amber', 'Demo') : chip(p.kind === 'refund' ? 'red' : 'green', p.kind)}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td><td><div class="ad-acts"><button class="btn sm" data-pe="${p.id}">Edit</button><button class="btn sm danger" data-pd="${p.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>${pg.html}` : empty('The ledger is empty. Record a payment to start.')}</section></div>`);
    pg.bind(view());
    $('#add').onclick = () => paymentDlg({}); $('#exp').onclick = () => download('/api/admin/finance/export.csv', 'payments.csv');
    $('#fa').onclick = () => { f.from = $('#ff').value; f.to = $('#ft').value; f.page = 1; refresh(); }; $('#fc').onclick = () => { f.from = ''; f.to = ''; f.page = 1; refresh(); };
    $$('[data-pe]').forEach((b) => (b.onclick = () => paymentDlg(r.payments.rows.find((x) => x.id == b.dataset.pe))));
    $$('[data-pd]').forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: 'Delete payment', message: 'This removes the payment from the ledger and from the totals.', ok: 'Delete', danger: true })) busy(null, async () => { await api('DELETE', `/api/admin/payments/${b.dataset.pd}`); toast('Payment deleted'); refresh(); }); }));
  };

  // ---------- AI consumption ----------
  VIEWS.ai = async () => {
    const days = F.aiDays; const r = await api('GET', `/api/admin/ai?days=${days}`); const t = r.totals;
    setView(`<div class="page">${head('AI consumption', `<div class="seg" role="group" aria-label="Range">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${d} days</button>`).join('')}</div>`, `Tokens and estimated cost for the last ${days} days.`)}
      ${note(r.note)}${r.configured ? '' : note('No Anthropic API key is set, so no AI calls are being made.', 'bad')}
      <div class="ad-kpis">${kpi(tok(t.total), 'Total tokens', `${nf(t.calls)} calls`, 'info')}${kpi(tok(t.input), 'Input tokens', `$${nf(r.rates.input_per_m, 2)} per million`, '')}${kpi(tok(t.output), 'Output tokens', `$${nf(r.rates.output_per_m, 2)} per million`, '')}${kpi(usd(t.cost), 'Estimated cost', `${usd(t.cost / days)} per day on average`, 'warn')}</div>
      <div class="ad-grid2 mt"><section class="card"><div class="card-head"><h3>Tokens per day</h3></div>${bars(r.daily.map((x) => ({ d: x.d, v: x.input + x.output })), { cls: 'orange', fmt: tok, label: 'Tokens per day' })}</section><section class="card"><div class="card-head"><h3>Cost per day</h3></div>${bars(r.daily.map((x) => ({ d: x.d, v: x.cost })), { cls: 'green', fmt: (v) => usd(v, 4), label: 'Cost per day' })}</section></div>
      <div class="ad-grid2 mt"><section class="card"><div class="card-head"><h3>By feature</h3></div>${r.by_source.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Feature</th><th class="num">Calls</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead><tbody>${r.by_source.map((s) => `<tr><td>${esc(s.source)}</td><td class="num">${nf(s.calls)}</td><td class="num">${tok(s.input + s.output)}</td><td class="num">${usd(s.cost, 4)}</td></tr>`).join('')}</tbody></table></div>` : empty('No AI use in this range.')}</section>
      <section class="card"><div class="card-head"><h3>By model</h3></div>${r.by_model.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Model</th><th class="num">Calls</th><th class="num">Tokens</th></tr></thead><tbody>${r.by_model.map((s) => `<tr><td>${esc(s.model)}</td><td class="num">${nf(s.calls)}</td><td class="num">${tok(s.input + s.output)}</td></tr>`).join('')}</tbody></table></div>` : empty('No model data yet.')}</section></div>
      <section class="card mt"><div class="card-head"><h3>Top users</h3></div>${r.top_users.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Person</th><th class="num">Calls</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead><tbody>${r.top_users.map((u) => `<tr><td><a href="#/users/${u.id}"><b>${esc(u.name)}</b></a><div class="small muted">${esc(u.email)}</div></td><td class="num">${nf(u.calls)}</td><td class="num">${tok(u.input)}</td><td class="num">${tok(u.output)}</td><td class="num">${usd(u.cost, 4)}</td></tr>`).join('')}</tbody></table></div>` : empty('No one has used AI in this range.')}</section></div>`);
    $$('[data-d]').forEach((b) => (b.onclick = () => { F.aiDays = Number(b.dataset.d); refresh(); }));
  };

  // ---------- projects ----------
  VIEWS.projects = async () => {
    const f = F.projects;
    async function draw() {
      const r = await api('GET', '/api/admin/projects?' + qs(f)); const pg = pager(r, (p) => { f.page = p; draw(); });
      $('#tbl').innerHTML = r.projects.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Project</th><th>Owner</th><th class="num">Members</th><th class="num">Tasks</th><th>Updated</th><th></th></tr></thead><tbody>${r.projects.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><a href="#/users/${p.owner_id}">${esc(p.owner_name)}</a><div class="small muted">${esc(p.owner_email)}</div></td><td class="num">${nf(p.members)}</td><td class="num">${nf(p.tasks)}</td><td>${dt(p.updated_at)}</td><td><div class="ad-acts"><button class="btn sm" data-t="${p.id}">Transfer</button><button class="btn sm danger" data-x="${p.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>${pg.html}` : empty('No projects match.');
      pg.bind($('#tbl'));
      $$('[data-t]').forEach((b) => (b.onclick = () => { const p = r.projects.find((x) => x.id == b.dataset.t); const m = modal({ title: 'Transfer ownership', body: `<div class="ad-modal-form"><p class="muted" style="margin:0">${esc(p.name)} is owned by ${esc(p.owner_email)}.</p>${field('New owner email', '<input type="email" id="em">', 'The person must already have an account. They become the project manager.')}</div>`, footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Transfer</button>' }); m.$('#go').onclick = () => busy(m.$('#go'), async () => { const em = m.$('#em').value.trim().toLowerCase(); const found = (await api('GET', '/api/admin/users?' + qs({ q: em }))).users.find((u) => u.email === em); if (!found) throw new Error('No account uses that email'); await api('PUT', `/api/admin/projects/${p.id}`, { owner_id: found.id }); m.close(); toast('Ownership transferred'); draw(); }); }));
      $$('[data-x]').forEach((b) => (b.onclick = async () => { const p = r.projects.find((x) => x.id == b.dataset.x); if (await confirmDlg({ title: 'Delete project', message: `This permanently deletes ${esc(p.name)} with all its tasks, documents and reports. It cannot be undone.`, ok: 'Delete project', danger: true })) busy(null, async () => { await api('DELETE', `/api/admin/projects/${p.id}`); toast('Project deleted'); draw(); }); }));
    }
    setView(`<div class="page">${head('Projects', '', 'Every project across all accounts.')}<div class="ad-toolbar"><input type="search" id="fq" placeholder="Search project or owner email" value="${esc(f.q)}" aria-label="Search projects"></div><div class="card" id="tbl">${loading()}</div></div>`);
    let t; $('#fq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; f.page = 1; draw(); }, 250); };
    await draw();
  };

  // ---------- widgets ----------
  VIEWS.widgets = async () => {
    const f = F.widgets;
    async function draw() {
      const r = await api('GET', '/api/admin/widgets?' + qs(f)); const pg = pager(r, (p) => { f.page = p; draw(); });
      $('#tbl').innerHTML = r.widgets.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>Widget</th><th>Group</th><th>Owner</th><th>Status</th><th class="num">Installs</th><th class="num">Rating</th><th></th></tr></thead><tbody>${r.widgets.map((w) => `<tr><td><b>${esc(w.title)}</b></td><td>${esc(w.group)}</td><td>${esc(w.owner)}</td><td>${chip(w.status === 'published' ? 'green' : w.status === 'draft' ? 'gray' : 'amber', w.status)}</td><td class="num">${nf(w.installs)}</td><td class="num">${w.rating == null ? 'None' : w.rating}</td><td><div class="ad-acts">${w.status === 'published' ? `<button class="btn sm" data-s="${w.id}|unpublished">Unpublish</button>` : w.status === 'unpublished' ? `<button class="btn sm" data-s="${w.id}|published">Republish</button>` : ''}<button class="btn sm danger" data-x="${w.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>${pg.html}` : empty('No widgets have been created yet.');
      pg.bind($('#tbl'));
      $$('[data-s]').forEach((b) => (b.onclick = () => busy(b, async () => { const [id, st] = b.dataset.s.split('|'); await api('POST', `/api/admin/widgets/${id}/status`, { status: st }); toast('Widget updated'); draw(); })));
      $$('[data-x]').forEach((b) => (b.onclick = async () => { if (await confirmDlg({ title: 'Delete widget', message: 'This removes the widget and takes it off every overview where it was added.', ok: 'Delete widget', danger: true })) busy(null, async () => { await api('DELETE', `/api/admin/widgets/${b.dataset.x}`); toast('Widget deleted'); draw(); }); }));
    }
    setView(`<div class="page">${head('Widgets', '', 'Marketplace widgets built by people on the platform.')}<div class="card" id="tbl">${loading()}</div></div>`);
    await draw();
  };

  // ---------- configuration ----------
  VIEWS.config = async () => {
    const r = await api('GET', '/api/admin/config'); const e = r.environment;
    setView(`<div class="page">${head('Configuration', '<button class="btn primary" id="save">Save changes</button>', 'Settings take effect within a few seconds. Every change is written to the audit log.')}
      <section class="card"><div class="card-head"><h3>Platform settings</h3></div><div class="ad-cfg" id="cfg">${r.settings.map((s) => `<div class="ad-cfg-row"><div><b>${esc(s.label)}</b><div class="d">Default ${esc(String(s.default))}</div></div><div>${s.type === 'bool' ? `<button type="button" class="tgl ${s.value ? 'on' : ''}" data-k="${s.key}" data-t="bool" role="switch" aria-checked="${!!s.value}" aria-label="${esc(s.label)}"><i></i></button>` : `<input ${s.type === 'text' ? 'type="text" maxlength="' + (s.max || 300) + '"' : 'type="number" step="' + (s.type === 'num' ? 'any' : '1') + '" min="' + s.min + '" max="' + s.max + '"'} data-k="${s.key}" data-t="${s.type}" value="${esc(s.value)}" aria-label="${esc(s.label)}">`}</div></div>`).join('')}</div></section>
      <section class="card mt"><div class="card-head"><h3>Environment</h3></div><dl class="ad-dl"><dt>Anthropic API key</dt><dd>${e.anthropic_key ? chip('green', 'Set') : chip('red', 'Missing')}</dd><dt>Database</dt><dd>${e.database === 'pg' ? 'Postgres' : 'Embedded Postgres'}</dd><dt>Published app</dt><dd>${e.replit_deployment ? 'Yes' : 'No'}</dd><dt>Site address</dt><dd>${esc(e.site_url || 'Not set')}</dd><dt>Time zone</dt><dd>${esc(e.app_tz)}</dd><dt>Jira sign in</dt><dd>${e.jira_oauth ? chip('green', 'Configured') : chip('gray', 'Not configured')}</dd><dt>Outlook sign in</dt><dd>${e.outlook_oauth ? chip('green', 'Configured') : chip('gray', 'Not configured')}</dd><dt>Demo account</dt><dd>${e.demo_account ? chip('amber', 'On') : chip('gray', 'Off')}</dd><dt>Super admin emails</dt><dd>${esc(e.super_admin_emails.join(', '))}</dd></dl><p class="small muted" style="margin-bottom:0">${esc(e.note)}</p></section></div>`);
    $$('#cfg .tgl').forEach((b) => (b.onclick = () => { b.classList.toggle('on'); b.setAttribute('aria-checked', b.classList.contains('on')); }));
    $('#save').onclick = () => busy($('#save'), async () => {
      const settings = {}; $$('#cfg [data-k]').forEach((el) => { settings[el.dataset.k] = el.dataset.t === 'bool' ? el.classList.contains('on') : el.dataset.t === 'text' ? el.value : el.value === '' ? NaN : Number(el.value); });
      await api('PUT', '/api/admin/config', { settings }); toast('Settings saved'); refresh();
    });
  };

  // ---------- system health ----------
  VIEWS.health = async () => {
    async function draw() {
      const h = await api('GET', '/api/admin/health'); const sy = h.system; const dot = h.status === 'healthy' ? 'good' : h.status === 'degraded' ? 'warn' : 'bad';
      const up = (u) => (u.pct == null ? 'No data' : u.pct + '%');
      const v = view(); if (!v || !$('#hv')) return;
      $('#hv').innerHTML = `<div class="ad-note ${h.status === 'healthy' ? 'ok' : h.status === 'down' ? 'bad' : ''}" role="status"><span class="ad-status"><span class="ad-dot ${dot}"></span>${h.status === 'healthy' ? 'All systems healthy' : h.status === 'degraded' ? 'Degraded' : 'Down'}</span></div>${h.issues.length ? `<div class="card mb"><div class="card-head"><h3>Needs attention</h3></div><ul style="margin:0;padding-inline-start:18px">${h.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
        <div class="ad-kpis">${kpi(up(h.uptime.d1), 'Uptime, 24 hours', `${nf(h.uptime.d1.beats)} of ${nf(h.uptime.d1.expected)} minutes`, h.uptime.d1.pct >= 99 ? 'good' : 'warn')}${kpi(up(h.uptime.d7), 'Uptime, 7 days', '', h.uptime.d7.pct >= 99 ? 'good' : 'warn')}${kpi(up(h.uptime.d30), 'Uptime, 30 days', '', h.uptime.d30.pct >= 99 ? 'good' : 'warn')}${kpi(dur(sy.uptime_seconds), 'Running since last restart', `Started ${dt(sy.started_at)}`, 'info')}
        ${kpi(`${h.database.latency_ms} ms`, 'Database response', h.database.kind === 'pg' ? 'Postgres' : 'Embedded Postgres', h.database.ok ? (h.database.latency_ms > 500 ? 'warn' : 'good') : 'bad')}${kpi(`${sy.rss_mb} MB`, 'Memory in use', `Heap ${sy.heap_mb} MB`, '')}${kpi(nf(h.server_errors.last_hour), 'Server errors, last hour', `${nf(h.server_errors.last_24h)} in 24 hours`, h.server_errors.last_hour ? 'bad' : 'good')}${kpi(nf(sy.requests_since_start), 'Requests since restart', `${nf(sy.errors_since_start)} errors`, '')}</div>
        <div class="ad-grid2 mt"><section class="card"><div class="card-head"><h3>Database response, last 3 hours</h3></div>${h.beats.length ? bars(h.beats.map((b) => ({ d: new Date(b.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), v: b.db_ms })), { fmt: (x) => x + ' ms', label: 'Database response per minute' }) : empty('No heartbeats yet. The first one is recorded within a minute.')}</section>
        <section class="card"><div class="card-head"><h3>System</h3></div><dl class="ad-dl"><dt>Node</dt><dd>${esc(sy.node)}</dd><dt>Platform</dt><dd>${esc(sy.platform)} with ${sy.cpus} CPUs</dd><dt>Load average</dt><dd>${sy.load.join(', ')}</dd><dt>Users</dt><dd>${nf(h.counts.users)}</dd><dt>Projects</dt><dd>${nf(h.counts.projects)}</dd><dt>Live sessions</dt><dd>${nf(h.counts.sessions)}</dd></dl><p class="small muted" style="margin-bottom:0">Uptime counts the minutes the server was running. A restart or an outage shows as lost minutes.</p></section></div>`;
    }
    setView(`<div class="page">${head('System health', '<button class="btn" id="rf">Refresh</button>', 'Updates every 30 seconds.')}<div id="hv">${loading()}</div></div>`);
    $('#rf').onclick = () => draw().catch((e) => toast(e.message, 'err'));
    await draw(); S.timer = setInterval(() => draw().catch(() => {}), 30000);
  };

  // ---------- error log ----------
  VIEWS.errors = async () => {
    const f = F.errors;
    async function draw() {
      const r = await api('GET', '/api/admin/errors?' + qs(f)); const pg = pager(r, (p) => { f.page = p; draw(); }); const v = $('#ev'); if (!v) return;
      v.innerHTML = `${r.groups.length ? `<div class="card mb"><div class="card-head"><h3>Most frequent in the last 24 hours</h3></div>${r.groups.map((g) => `<div class="ad-bar-row" style="grid-template-columns:auto 1fr auto"><span>${chip(g.kind === 'server' ? 'red' : 'amber', g.kind)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(g.message)}">${esc(g.message)}</span><span class="n">${nf(g.count)} ${g.count === 1 ? 'time' : 'times'}</span></div>`).join('')}</div>` : ''}
      <div class="card">${r.errors.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>When</th><th>Type</th><th>Where</th><th>Person</th><th>Message</th><th></th></tr></thead><tbody>${r.errors.map((e) => `<tr style="${e.resolved ? 'opacity:.6' : ''}"><td>${dt(e.created_at)}</td><td>${chip(e.kind === 'server' ? 'red' : 'amber', e.kind)}${e.ref ? `<div class="small muted">Ref ${esc(e.ref)}</div>` : ''}</td><td class="wrap">${e.method ? esc(e.method) + ' ' : ''}${esc(e.path)}${e.status ? ' ' + chip('gray', e.status) : ''}</td><td>${esc(e.email || 'Not signed in')}</td><td class="wrap">${esc(e.message)}</td><td><div class="ad-acts"><button class="btn sm" data-v="${e.id}">Details</button><button class="btn sm" data-r="${e.id}|${e.resolved ? 0 : 1}">${e.resolved ? 'Reopen' : 'Resolve'}</button><button class="btn sm danger" data-d="${e.id}" aria-label="Delete this error">Delete</button></div></td></tr>`).join('')}</tbody></table></div>${pg.html}` : empty(f.resolved === '0' ? 'No open errors. Everything is quiet.' : 'No errors match these filters.')}</div>`;
      pg.bind(v);
      $$('[data-v]', v).forEach((b) => (b.onclick = () => { const e = r.errors.find((x) => x.id == b.dataset.v); modal({ title: 'Error details', size: 'lg', body: `<dl class="ad-dl"><dt>When</dt><dd>${dt(e.created_at)}</dd><dt>Type</dt><dd>${esc(e.kind)}</dd><dt>Reference</dt><dd>${esc(e.ref || 'None')}</dd><dt>Request</dt><dd>${esc((e.method + ' ' + e.path).trim() || 'None')}</dd><dt>Person</dt><dd>${esc(e.email || 'Not signed in')}</dd><dt>Browser</dt><dd>${esc(e.agent || 'Unknown')}</dd></dl><h4 style="margin:14px 0 6px">Message</h4><pre class="ad-pre">${esc(e.message)}</pre><h4 style="margin:14px 0 6px">Stack</h4><pre class="ad-pre">${esc(e.stack || 'No stack was recorded.')}</pre>` }); }));
      $$('[data-r]', v).forEach((b) => (b.onclick = () => busy(b, async () => { const [id, res] = b.dataset.r.split('|'); await api('POST', `/api/admin/errors/${id}/resolve`, { resolved: res === '1' }); draw(); })));
      $$('[data-d]', v).forEach((b) => (b.onclick = () => busy(b, async () => { await api('DELETE', `/api/admin/errors/${b.dataset.d}`); draw(); })));
    }
    setView(`<div class="page">${head('Error log', '<button class="btn" id="ra">Resolve all</button><button class="btn" id="cr">Clear resolved</button>', 'Server errors and problems reported by browsers. Updates every 30 seconds.')}
      <div class="ad-toolbar"><input type="search" id="fq" placeholder="Search message, page, reference or person" value="${esc(f.q)}" aria-label="Search errors"><select id="fk" aria-label="Type"><option value="">All types</option><option value="server">Server</option><option value="browser">Browser</option></select><select id="fr" aria-label="State"><option value="0">Open</option><option value="1">Resolved</option><option value="">All</option></select></div><div id="ev">${loading()}</div></div>`);
    $('#fk').value = f.kind; $('#fr').value = f.resolved; let t; $('#fq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; f.page = 1; draw(); }, 250); };
    $('#fk').onchange = (e) => { f.kind = e.target.value; f.page = 1; draw(); }; $('#fr').onchange = (e) => { f.resolved = e.target.value; f.page = 1; draw(); };
    $('#ra').onclick = () => busy($('#ra'), async () => { const r = await api('POST', '/api/admin/errors/resolve-all', {}); toast(`${r.count} errors resolved`); draw(); });
    $('#cr').onclick = async () => { if (await confirmDlg({ title: 'Clear resolved errors', message: 'This permanently deletes every error marked as resolved.', ok: 'Clear', danger: true })) busy($('#cr'), async () => { const r = await api('DELETE', '/api/admin/errors?resolved=1'); toast(`${r.count} errors cleared`); draw(); }); };
    await draw(); S.timer = setInterval(() => draw().catch(() => {}), 30000);
  };

  // ---------- audit ----------
  VIEWS.audit = async () => {
    const f = F.audit;
    async function draw() {
      const r = await api('GET', '/api/admin/audit?' + qs(f)); const pg = pager(r, (p) => { f.page = p; draw(); });
      $('#tbl').innerHTML = r.entries.length ? `<div class="table-wrap"><table class="t ad-tbl"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>${r.entries.map((e) => `<tr><td>${dt(e.at)}</td><td>${esc(e.admin)}</td><td>${chip('blue', e.action)}</td><td>${esc(e.target)}</td><td class="wrap small muted">${esc(JSON.stringify(e.detail))}</td></tr>`).join('')}</tbody></table></div>${pg.html}` : empty('No admin actions recorded yet.');
      pg.bind($('#tbl'));
    }
    setView(`<div class="page">${head('Audit log', '', 'Every change made in this console.')}<div class="ad-toolbar"><input type="search" id="fq" placeholder="Search action, target or admin" value="${esc(f.q)}" aria-label="Search the audit log"></div><div class="card" id="tbl">${loading()}</div></div>`);
    let t; $('#fq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; f.page = 1; draw(); }, 250); };
    await draw();
  };

  // ---------- start ----------
  async function boot() {
    if (!S.token) return showLogin();
    try { S.me = (await api('GET', '/api/admin/me')).user; }
    catch (e) {
      const denied = /super admins only/i.test(e.message);
      if (denied) { S.token = null; try { localStorage.removeItem(KEY); } catch (x) { /* storage blocked */ } }
      return showLogin(denied ? 'This account is not a super admin.' : e.message);
    }
    shell(); if (!S.bound) { S.bound = true; window.addEventListener('hashchange', route); } route();
  }
  window.addEventListener('error', (e) => { try { navigator.sendBeacon && navigator.sendBeacon('/api/client-error', new Blob([JSON.stringify({ message: e.message, stack: e.error && e.error.stack, url: location.pathname + location.hash })], { type: 'application/json' })); } catch (x) { /* best effort */ } });
  boot();
})();
