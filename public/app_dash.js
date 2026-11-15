/* Overview dashboard: a grid of widgets that can be moved, resized, hidden and exported. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, state: S } = PM;
  const DAY = 864e5;
  const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const ymd = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const num = (n) => Number(n || 0).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-US', { maximumFractionDigits: 0 });
  const cnum = (n) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e4 ? Math.round(n / 1e3) + 'K' : num(n); };
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, Math.max(n - 1, 1)) + '…' : String(s));
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tip = (html) => `data-tip="${esc(html)}"`;
  let firstPaint = true; // the entrance sequence plays once per visit to the page

  // ---------------- chart helpers ----------------
  const empty = (msg) => `<div class="empty small">${esc(msg || t('nothing_here'))}</div>`;
  // One row layout for every list widget: title, meta line, optional action buttons, value and sub line on the end side
  const listRow = (r) => `<div class="list-item"><div class="grow"><div class="li-title">${esc(r.title)}</div><div class="small muted">${r.meta}</div>${r.actions ? `<div class="row qa">${r.actions}</div>` : ''}</div><div class="right"><div class="li-val${r.valCls ? ' ' + r.valCls : ''}">${esc(r.val == null ? '' : r.val)}</div><div class="small muted">${esc(r.sub == null ? '' : r.sub)}</div></div></div>`;
  const projLink = (id, name) => `<span class="li-link" data-go="#/p/${id}/overview">${esc(name)}</span>`;
  const stamp = (ts) => { const v = String(ts || '').replace('T', ' '); return [v.slice(5, 10), v.slice(11, 16)]; };
  const legend = (items) => `<div class="viz-legend">${items.map(([cls, label, v]) => `<span><i class="sw ${cls}"></i>${esc(label)}${v != null ? ` <b>${v}</b>` : ''}</span>`).join('')}</div>`;

  function donut(parts, centerTop, centerBot) {
    const total = parts.reduce((s, p) => s + p.v, 0);
    let acc = 0;
    const R = 54, C = 70;
    const cl = PMCL.get('donut');
    const live = parts.filter((p) => p.v > 0);
    let labs = '';
    const placed = [];
    const segs = live.map((p) => {
      const len = (p.v / total) * 100;
      const gap = live.length > 1 ? 1.2 : 0;
      const el = `<circle class="dn ${p.cls}" cx="${C}" cy="${C}" r="${R}" pathLength="100" stroke-dasharray="${Math.max(len - gap, 0.1)} ${100 - Math.max(len - gap, 0.1)}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${C} ${C})" ${tip(`${p.label}: ${p.v}`)}/>`;
      if (cl.on) {
        const mid = ((acc + len / 2) / 100) * 2 * Math.PI - Math.PI / 2;
        const lab = PMCL.str(cl, { text: p.lab != null ? p.lab : num(p.v), pct: PMCL.pctOf(p.v, total) });
        const tw = PMCL.estW(lab), clash = (px, py) => placed.some(([ox, oy, ow]) => Math.abs(ox - px) < (ow + tw) / 2 + 2 && Math.abs(oy - py) < 12);
        if (cl.pos === 'center') {
          const px = C + Math.cos(mid) * R, py = C + Math.sin(mid) * R;
          if ((len >= 7 || live.length === 1) && !clash(px, py)) { labs += PMCL.text(px, py, lab, 'center'); placed.push([px, py, tw]); }
        } else {
          const rx = C + Math.cos(mid) * (R + 15), ry = C + Math.sin(mid) * (R + 15);
          const a = Math.abs(Math.cos(mid)) < 0.2 ? 'middle' : Math.cos(mid) > 0 ? 'start' : 'end';
          const cx0 = a === 'start' ? rx + tw / 2 : a === 'end' ? rx - tw / 2 : rx;
          if (!clash(cx0, ry)) { labs += PMCL.text(rx, ry, lab, 'outside', { anchor: a }); placed.push([cx0, ry, tw]); }
        }
      }
      acc += len;
      return el;
    }).join('');
    const out = cl.on && cl.pos === 'outside';
    return `<div class="donut-box" style="width:${out ? 220 : 140}px"><svg class="viz donut" viewBox="${out ? '-40 -8 220 156' : '0 0 140 140'}" role="img" aria-label="${esc(centerBot)}: ${parts.map((p) => `${p.label} ${p.v}`).join(', ')}"><circle class="dn-track" cx="${C}" cy="${C}" r="${R}"/>${segs}${labs}</svg><div class="dn-center"><b>${centerTop}</b><span>${esc(centerBot)}</span></div></div>`;
  }

  let CW = 560; // usable chart width of the widget being drawn, set by frame()
  function hbars(rows, opts) {
    // rows: [{label, sub, segs:[{v, cls, label, lab, pct}], mark, tipHtml, href, valueLabel, pctLabel}]
    const cl = PMCL.get('hbar');
    const W = Math.max(240, Math.min(1600, Math.round(CW))), LW = opts.labelW || 130, PR = 44, RH = opts.rowH || 38, BH = cl.on ? 14 : 10;
    const max = opts.max || Math.max(1, ...rows.map((r) => r.segs.reduce((s, x) => s + x.v, 0)));
    const pw = W - LW - PR;
    const H = rows.length * RH + 6;
    const grand = rows.reduce((s, r) => s + r.segs.reduce((a, x) => a + x.v, 0), 0);
    let g = '';
    rows.forEach((r, i) => {
      const y = i * RH + 4;
      let x = LW;
      const total = r.segs.reduce((s, p) => s + p.v, 0);
      const live = r.segs.filter((p) => p.v > 0);
      const single = r.segs.length === 1;
      const by = y + 7, ym = by + BH / 2;
      g += `<g class="hb-row" ${r.href ? `data-go="${r.href}" style="cursor:pointer"` : ''} ${tip(r.tipHtml || '')}><rect class="hit" x="0" y="${y - 2}" width="${W}" height="${RH}"/>`;
      g += `<text class="lab" x="0" y="${y + 12}">${esc(trunc(r.label, 20))}</text>`;
      if (r.sub) g += `<text class="lab-sub" x="0" y="${y + 24}">${esc(r.sub)}</text>`;
      g += `<rect class="hb-track" x="${LW}" y="${by}" width="${pw}" height="${BH}" rx="${BH / 2}"/>`;
      let marks = '', lastEnd = -1e9;
      live.forEach((p, k) => {
        const w = (p.v / max) * pw;
        const last = k === live.length - 1;
        g += `<rect class="hb-seg ${p.cls}" x="${x}" y="${by}" width="${Math.max(w - (last ? 0 : 2), 1)}" height="${BH}" rx="${last ? Math.min(4, BH / 2) : 1}" style="--i:${k}"/>`;
        if (cl.on) {
          const own = single && r.valueLabel != null;
          const txt = PMCL.str(cl, { text: own ? r.valueLabel : (p.lab != null ? p.lab : String(Math.round(p.v * 10) / 10)), pct: p.pct != null ? p.pct : own ? (r.pctLabel != null ? r.pctLabel : /%$/.test(String(r.valueLabel)) ? r.valueLabel : PMCL.pctOf(p.v, grand)) : PMCL.pctOf(p.v, total) });
          const x0 = x, x1 = x + w, xc = x + w / 2, tw = PMCL.estW(txt);
          let m = '';
          if (cl.pos === 'center') { if (w >= tw + 4) m = PMCL.text(xc, ym, txt, 'center'); }
          else if (cl.pos === 'left') { if (single || w >= tw + 8) m = PMCL.text(x0, ym, txt, 'right', { gap: 5 }); }
          else if (cl.pos === 'right') { if (single && x1 + tw + 6 <= W) m = PMCL.text(x1, ym, txt, 'right', { gap: 5 }); else if (w >= tw + 8) m = PMCL.text(x1, ym, txt, 'left', { gap: 5 }); }
          else if (xc - tw / 2 > lastEnd + 3) { m = PMCL.text(xc, cl.pos === 'above' ? by : by + BH, txt, cl.pos, { gap: 3 }); lastEnd = xc + tw / 2; }
          marks += m;
        }
        x += w;
      });
      if (r.mark != null) { const mx = LW + (r.mark / max) * pw; g += `<line class="hb-mark" x1="${mx}" x2="${mx}" y1="${y + 2}" y2="${y + 24}"/>`; }
      g += marks;
      if (!single) g += `<text class="val" x="${W}" y="${y + 17}" text-anchor="end">${esc(r.valueLabel != null ? r.valueLabel : String(total))}</text>`;
      g += '</g>';
    });
    return `<svg class="viz hbars" style="max-width:${W}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">${g}</svg>`;
  }

  // ---------------- widget filters ----------------
  // A viewer filter for one widget: year, quarter, month, status and project. The choice is kept on this device.
  const WFK = 'pm_wf';
  const wfRead = () => { try { return JSON.parse(localStorage.getItem(WFK) || '{}') || {}; } catch { return {}; } };
  const wfGet = (key) => { const f = wfRead()[key]; return f && typeof f === 'object' ? f : {}; };
  const wfPut = (key, f) => {
    try {
      const a = wfRead(), c = {};
      for (const k of ['y', 'q', 'm', 's', 'p', 'b']) if (f[k]) c[k] = String(f[k]);
      if (c.y || c.q || c.m || c.s || c.p) a[key] = c; else delete a[key];
      localStorage.setItem(WFK, JSON.stringify(a));
    } catch { /* storage may be blocked */ }
  };
  const wfOn = (f) => !!(f && (f.y || f.q || f.m || f.s || f.p));
  const pad2 = (n) => String(n).padStart(2, '0');
  // the chosen period as a date range, or null when no year is chosen
  function wfRange(f) {
    if (!f || !f.y) return null;
    const y = Number(f.y); let a = 1, b = 12;
    if (f.m) a = b = Number(f.m); else if (f.q) { a = (Number(f.q) - 1) * 3 + 1; b = a + 2; }
    return { lo: `${y}-${pad2(a)}-01`, hi: `${y}-${pad2(b)}-${pad2(new Date(Date.UTC(y, b, 0)).getUTCDate())}` };
  }
  const wfPoint = (date, r) => !r || (!!date && String(date).slice(0, 10) >= r.lo && String(date).slice(0, 10) <= r.hi);
  const wfSpan = (a, b, r) => !r || (!!(a || b) && String(a || b).slice(0, 10) <= r.hi && String(b || a).slice(0, 10) >= r.lo);
  const monthName = (m) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString(S.lang === 'ar' ? 'ar-AE' : 'en-US', { month: 'long', timeZone: 'UTC' });
  const wfLabel = (F, w, d) => {
    const out = [];
    if (F.y) out.push(F.y);
    if (F.q && !F.m) out.push(t('wfl_q', { n: F.q }));
    if (F.m) out.push(monthName(Number(F.m)));
    if (F.s) { const o = ((w.wf.statuses && w.wf.statuses(d)) || []).find((x) => x.v === F.s); out.push(o ? o.label : F.s); }
    if (F.p) out.push(F.p);
    return out.join(' · ');
  };

  // ---------------- widgets ----------------
  const csvOf = (rows) => rows.map((r) => r.map((c) => { let s = c == null ? '' : String(c); if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+([.,]\d+)?$/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');

  // tiles for the report: label, plain value, hint and a status tone the exports understand
  const kpiList = (tiles) => tiles.map((x) => ({ label: t(x.k), value: String(x.v == null ? '' : x.v).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'), hint: String(x.sub || ''), tone: x.tone === 'good' ? 'ok' : x.tone === 'warn' ? 'warn' : x.tone === 'bad' ? 'bad' : 'info' }));

  const WIDGETS = {
    kpi: {
      size: 'l', title: 'w_kpi',
      render(body, d) {
        const A = d.analytics, P = A.projects;
        const avg = (k) => { const v = P.filter((p) => p[k] != null).map((p) => p[k]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
        const prog = avg('progress'), plan = avg('planned'), spi = avg('spi');
        const high = d.radar.counts.high, od = d.overdueTotal != null ? d.overdueTotal : d.overdue.length;
        const totals = PM.fx.mode === 'native' ? (Object.entries(d.totalValue).map(([c, v]) => money(v, c)).join(' + ') || '0') : PM.fmt(Object.entries(d.totalValue).reduce((a, [c, v]) => a + PM.fx.convert(v, c, PM.fx.mode), 0), PM.fx.mode);
        const tiles = [
          { k: 'kpi_active', v: d.counts.active, n: d.counts.active, sub: t('kpi_on_track_n', { n: d.counts.green }), tone: '' },
          { k: 'kpi_progress', v: prog == null ? '-' : Math.round(prog) + '%', n: prog == null ? null : Math.round(prog), suffix: '%', sub: plan == null ? '' : t('planned') + ' ' + Math.round(plan) + '%', tone: prog != null && plan != null && prog + 5 < plan ? 'warn' : 'good' },
          { k: 'kpi_spi', v: spi == null ? '-' : spi.toFixed(2), sub: t('kpi_spi_hint'), tone: spi == null ? '' : spi >= 0.95 ? 'good' : spi >= 0.8 ? 'warn' : 'bad' },
          { k: 'kpi_high_risks', v: high, n: high, sub: t('kpi_of_signals', { n: d.radar.items.length }), tone: high ? 'bad' : 'good' },
          { k: 'kpi_overdue', v: od, n: od, sub: od ? t('kpi_late_tasks') : t('nothing_overdue'), tone: od ? 'bad' : 'good' },
          { k: 'kpi_value', v: totals, sub: t('kpi_across', { n: P.length }), tone: '', small: true },
        ];
        body.innerHTML = `<div class="kpis">${tiles.map((x, i) => `<div class="kpi-t ${x.tone}" style="--i:${i}"><div class="kv ${x.small ? 'sm' : ''}" ${x.n != null ? `data-count="${x.n}" data-suffix="${x.suffix || ''}"` : ''}>${esc(String(x.v))}</div><div class="kl">${t(x.k)}</div><div class="ks">${esc(x.sub || '')}</div></div>`).join('')}</div>`;
        return { csv: () => [[t('metric'), t('value')], ...tiles.map((x) => [t(x.k), x.v])], kpis: kpiList(tiles) };
      },
    },

    radar: {
      size: 'l', title: 'radar_title',
      render(body, d, ctx) {
        PM.radar.mount(body, d.radar, { fetch: async () => (await ctx.reloadExcept('radar')).radar });
        return { csv: () => [[t('severity'), t('type'), t('dimension'), t('project'), t('item'), t('detail'), t('score')], ...d.radar.items.map((x) => [x.sev, x.type, x.dim, x.project, x.title, PM.radar.describe(x), x.score])] };
      },
    },

    schedule: {
      size: 'l', title: 'w_schedule',
      render(body, d) {
        const T = d.analytics.timeline;
        if (!T.projects.length || !T.min) { body.innerHTML = empty(t('no_tasks_hint')); return { csv: () => [] }; }
        const today = dnum(T.today);
        let lo = Math.min(dnum(T.min), today) - 12, hi = Math.max(dnum(T.max), today) + 18;
        const W = Math.max(720, Math.round(CW)), LW = 180, PR = 18, PW = W - LW - PR, RH = 62, AX = 34;
        const H = AX + T.projects.length * RH + 18;
        const x = (n) => LW + ((n - lo) / (hi - lo)) * PW;
        const months = [];
        const dt = new Date(lo * DAY); let y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1;
        const step = (hi - lo) > 800 ? 3 : (hi - lo) > 400 ? 2 : 1;
        for (let g = 0; g < 80; g++) { const n = Date.UTC(y, m, 1) / DAY; if (n > hi) break; months.push(n); m += step; if (m > 11) { y += Math.floor(m / 12); m %= 12; } }
        const loc = S.lang === 'ar' ? 'ar-AE' : 'en-US';
        let g = '';
        months.forEach((n) => { const lbl = new Date(n * DAY).toLocaleDateString(loc, { month: 'short', year: '2-digit', timeZone: 'UTC' }); g += `<line class="tl-grid" x1="${x(n)}" x2="${x(n)}" y1="${AX - 6}" y2="${H}"/><text class="tl-mon" x="${x(n) + 4}" y="${AX - 12}">${esc(lbl)}</text>`; });
        const rows = [];
        T.projects.forEach((p, i) => {
          const y0 = AX + i * RH;
          g += `<g class="tl-proj" data-go="#/p/${p.id}/schedule" style="cursor:pointer" ${tip(`<b>${esc(p.name)}</b><br>${p.progress}% ${t('complete_word')}`)}><rect class="hit" x="0" y="${y0}" width="${LW - 10}" height="${RH - 6}"/><circle class="hd ${p.health}" cx="6" cy="${y0 + 22}" r="4.5"/><text class="lab" x="18" y="${y0 + 26}">${esc(trunc(p.name, 22))}</text><text class="lab-sub" x="18" y="${y0 + 41}">${p.progress}% ${planned(p)}</text></g>`;
          g += `<line class="tl-row" x1="0" x2="${W}" y1="${y0 + RH - 3}" y2="${y0 + RH - 3}"/>`;
          // Phase names sit above their bars. Each name gets only the room up to the next name (and no more than its own bar),
          // so names of phases that overlap or follow closely never print over each other. A name with too little room is
          // left out and is still in the tooltip.
          const lay = p.phases.map((ph) => { const a = x(dnum(ph.start)), b = x(dnum(ph.finish) + 1); return { ph, x1: a, w: Math.max(b - a - 2, 3) }; }).sort((u, v) => u.x1 - v.x1 || v.w - u.w);
          let edge = -Infinity;
          for (let i = 0; i < lay.length; i++) {
            const c = lay[i];
            if (c.x1 < edge) continue;                                    // starts inside the name before it
            const next = lay.slice(i + 1).find((o) => o.x1 > c.x1 + 1);   // the next name that starts later
            const room = Math.min(c.w, next ? next.x1 - c.x1 - 8 : Infinity);
            if (room > 40) { g += `<text class="tl-ph" x="${c.x1}" y="${y0 + 16}">${esc(trunc(c.ph.name, Math.floor(room / 6.4)))}</text>`; edge = c.x1 + Math.min(room, trunc(c.ph.name, Math.floor(room / 6.4)).length * 6.4 + 6); }
          }
          p.phases.forEach((ph, k) => {
            const x1 = x(dnum(ph.start)), x2 = x(dnum(ph.finish) + 1), w = Math.max(x2 - x1 - 2, 3);
            g += `<g ${tip(`<b>${esc(ph.name)}</b><br>${ph.start} ${t('to')} ${ph.finish}<br>${ph.progress}% ${t('complete_word')}`)}><rect class="tl-bar" x="${x1}" y="${y0 + 22}" width="${w}" height="16" rx="4"/><rect class="tl-fill" x="${x1}" y="${y0 + 22}" width="${w * (ph.progress / 100)}" height="16" rx="4" style="--i:${k}"/></g>`;
            rows.push([p.name, ph.name, ph.start, ph.finish, ph.progress]);
          });
          if (p.contract_end) {
            const cx = x(dnum(p.contract_end));
            g += `<line class="tl-end" x1="${cx}" x2="${cx}" y1="${y0 + 17}" y2="${y0 + 44}"/>`;
            if (p.forecast && p.forecast > p.contract_end) g += `<rect class="tl-over" x="${cx}" y="${y0 + 40}" width="${Math.max(x(dnum(p.forecast)) - cx, 2)}" height="3" rx="1.5" ${tip(`${t('contract_end')} ${p.contract_end}<br>${t('forecast_end')} ${p.forecast}<br>${t('rd_days_late', { n: dnum(p.forecast) - dnum(p.contract_end) })}`)}/>`;
          }
          for (const pay of p.payments) {
            const px = x(dnum(pay.due));
            const st = pay.state === 'paid' ? 'paid' : pay.state === 'invoiced' ? 'inv' : pay.due < T.today ? 'late' : 'pend';
            g += `<path class="tl-pay ${st}" d="M${px} ${y0 + 45} l4.5 4.5 l-4.5 4.5 l-4.5 -4.5 Z" ${tip(`<b>${esc(pay.title)}</b><br>${pay.due}${pay.amount != null ? `<br>${PM.fmt(pay.amount, p.currency)}` : ''}<br>${t('state_' + pay.state)}`)}/>`;
          }
        });
        g += `<line class="tl-today" x1="${x(today)}" x2="${x(today)}" y1="${AX - 4}" y2="${H}"/><text class="tl-todaylab" x="${x(today)}" y="${H + 10}" text-anchor="middle">${esc(t('g_today'))}</text>`;
        body.innerHTML = `<svg class="viz timeline" style="width:${W}px;max-width:none;min-width:100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('w_schedule'))}">${g}</svg>${legend([['tl-l-prog', t('g_l_prog')], ['tl-l-diamond paid', t('state_paid')], ['tl-l-diamond inv', t('state_invoiced')], ['tl-l-diamond pend', t('state_pending')], ['tl-l-diamond late', t('late')], ['tl-l-end', t('contract_end')]])}`;
        return { csv: () => [[t('project'), t('phase'), t('start'), t('finish'), t('progress')], ...rows], chart: true };
      },
    },

    health: {
      size: 's', title: 'w_health',
      render(body, d) {
        const H = d.analytics.health, n = H.green + H.amber + H.red;
        if (!n) { body.innerHTML = empty(); return { csv: () => [] }; }
        const parts = [{ v: H.green, cls: 'ok', label: t('health_green') }, { v: H.amber, cls: 'warn', label: t('health_amber') }, { v: H.red, cls: 'bad', label: t('health_red') }];
        body.innerHTML = `<div class="donut-wrap">${donut(parts, n, t('nav_projects'))}${legend(parts.map((p) => [p.cls, p.label, p.v]))}</div>`;
        return { csv: () => [[t('project'), t('health')], ...d.analytics.projects.map((p) => [p.name, p.health])], chart: true };
      },
    },

    deliverables: {
      size: 's', title: 'w_deliverables',
      render(body, d) {
        const D = d.analytics.deliverables.filter((x) => x.open + x.closed > 0);
        if (!D.length) { body.innerHTML = empty(); return { csv: () => [] }; }
        const rows = D.map((x) => ({ label: x.name, sub: t('deliv_of', { a: x.closed, b: x.open + x.closed }), segs: [{ v: x.closed, cls: 'ok' }, { v: x.open, cls: 'idle' }], valueLabel: Math.round((x.closed / (x.open + x.closed)) * 100) + '%', max: x.open + x.closed, tipHtml: `${esc(x.name)}: ${x.closed}/${x.open + x.closed}`, href: `#/p/${x.id}/review` }));
        const max = Math.max(...D.map((x) => x.open + x.closed));
        body.innerHTML = hbars(rows, { max, aria: t('w_deliverables') }) + legend([['ok', t('state_closed')], ['idle', t('state_open')]]);
        return { csv: () => [[t('project'), t('state_closed'), t('state_open')], ...D.map((x) => [x.name, x.closed, x.open])], chart: true };
      },
    },

    payments: {
      size: 's', title: 'w_payments',
      render(body, d) {
        let M = d.analytics.payments.filter((x) => x.total > 0);
        const conv = PM.fx.mode !== 'native', mode = PM.fx.mode;
        if (conv && M.length) { const sum = (k) => M.reduce((a, x) => a + PM.fx.convert(x[k], x.currency, mode), 0); M = [{ currency: mode, paid: sum('paid'), invoiced: sum('invoiced'), pending: sum('pending'), late: sum('late'), total: sum('total') }]; }
        if (!M.length) { body.innerHTML = empty(); return { csv: () => [] }; }
        const rows = M.map((x) => ({ label: x.currency || '-', sub: money(Math.round(x.total), x.currency), segs: [{ v: x.paid / x.total, cls: 'ok', lab: cnum(x.paid) }, { v: x.invoiced / x.total, cls: 'c1', lab: cnum(x.invoiced) }, { v: x.pending / x.total, cls: 'idle', lab: cnum(x.pending) }, { v: x.late / x.total, cls: 'bad', lab: cnum(x.late) }], valueLabel: Math.round((x.paid / x.total) * 100) + '%', tipHtml: `${t('state_paid')} ${money(x.paid, x.currency)}<br>${t('state_invoiced')} ${money(x.invoiced, x.currency)}<br>${t('state_pending')} ${money(x.pending, x.currency)}<br>${t('late')} ${money(x.late, x.currency)}` }));
        body.innerHTML = hbars(rows, { max: 1, aria: t('w_payments'), labelW: 96 }) + legend([['ok', t('state_paid')], ['c1', t('state_invoiced')], ['idle', t('state_pending')], ['bad', t('late')]]) +
          `<div class="small muted" style="margin-top:8px">${conv ? esc(t('fx_converted', { cur: mode })) + '<br>' : ''}${M.map((x) => `${esc(x.currency)}: ${t('state_paid')} ${num(x.paid)} · ${t('late')} ${num(x.late)}`).join('<br>')}</div>`;
        return { csv: () => [[t('currency'), t('state_paid'), t('state_invoiced'), t('state_pending'), t('late'), t('total')], ...M.map((x) => [x.currency, x.paid, x.invoiced, x.pending, x.late, x.total])], chart: true };
      },
    },

    progress: {
      size: 'm', title: 'w_progress',
      render(body, d) {
        const P = d.analytics.projects;
        if (!P.length) { body.innerHTML = empty(); return { csv: () => [] }; }
        const rows = P.map((p) => ({ label: p.name, sub: p.planned != null ? `${t('planned')} ${p.planned}%` : '', segs: [{ v: p.progress, cls: p.health === 'red' ? 'bad' : p.health === 'amber' ? 'warn' : 'c1' }], mark: p.planned, valueLabel: p.progress + '%', tipHtml: `<b>${esc(p.name)}</b><br>${t('progress')} ${p.progress}%${p.planned != null ? `<br>${t('planned')} ${p.planned}%` : ''}${p.spi != null ? `<br>${t('kpi_spi')} ${p.spi}` : ''}`, href: `#/p/${p.id}/overview` }));
        body.innerHTML = hbars(rows, { max: 100, aria: t('w_progress') }) + legend([['c1', t('progress')], ['mark', t('planned')]]);
        return { csv: () => [[t('project'), t('progress'), t('planned'), t('kpi_spi')], ...P.map((p) => [p.name, p.progress, p.planned ?? '', p.spi ?? ''])], chart: true };
      },
    },

    workload: {
      size: 'm', title: 'w_workload',
      render(body, d) {
        const Wk = d.analytics.workload;
        if (!Wk.length) { body.innerHTML = empty(); return { csv: () => [] }; }
        const rows = Wk.map((o) => ({ label: o.name === 'Unassigned' ? t('unassigned') : o.name, sub: t('tasks_n', { n: o.total }), segs: [{ v: o.done, cls: 'ok' }, { v: o.active, cls: 'c1' }, { v: o.todo, cls: 'idle' }, { v: o.late, cls: 'bad' }], tipHtml: `<b>${esc(o.name)}</b><br>${t('g_l_done')} ${o.done}<br>${t('g_l_prog')} ${o.active}<br>${t('g_l_todo')} ${o.todo}<br>${t('g_l_late')} ${o.late}` }));
        body.innerHTML = hbars(rows, { aria: t('w_workload') }) + legend([['ok', t('g_l_done')], ['c1', t('g_l_prog')], ['idle', t('g_l_todo')], ['bad', t('g_l_late')]]) + (d.analytics.workloadTotal > Wk.length ? `<div class="small muted dw-note">${esc(t('dash_top_owners', { n: Wk.length, total: d.analytics.workloadTotal }))}</div>` : '');
        return { csv: () => [[t('g_owner'), t('g_l_done'), t('g_l_prog'), t('g_l_todo'), t('g_l_late')], ...Wk.map((o) => [o.name, o.done, o.active, o.todo, o.late])], chart: true };
      },
    },

    portfolio: {
      size: 'l', title: 'portfolio',
      render(body, d) {
        if (!d.projects.length) { body.innerHTML = PM.data.emptyState(); PM.data.bindEmpty(body); return { csv: () => [] }; }
        const rows = d.projects.map((p) => `<tr style="cursor:pointer" data-go="#/p/${p.id}/overview"><td><div style="font-weight:600">${esc(p.name)}</div><div class="small muted">${esc(p.client || '')}</div></td><td>${PM.healthChip(p.stats.health)}</td>
          <td style="min-width:150px"><div class="row small"><span class="grow">${p.stats.progress}%</span>${p.stats.planned != null ? `<span class="muted">${t('planned')} ${p.stats.planned}%</span>` : ''}</div><div class="progress"><i style="width:${p.stats.progress}%"></i></div></td>
          <td class="nowrap">${p.stats.forecast_end || '-'}</td><td>${p.stats.overdue ? `<span class="chip red">${p.stats.overdue}</span>` : '<span class="muted">0</span>'}</td>
          <td>${p.stats.pendingItems + p.stats.pendingInbox ? `<span class="badge-count">${p.stats.pendingItems + p.stats.pendingInbox}</span>` : ''}</td></tr>`).join('');
        body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>${t('project')}</th><th>${t('health')}</th><th>${t('progress')}</th><th>${t('forecast_end')}</th><th>${t('overdue')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
        return { csv: () => [[t('project'), t('client'), t('health'), t('progress'), t('planned'), t('forecast_end'), t('overdue'), t('to_review')], ...d.projects.map((p) => [p.name, p.client || '', p.stats.health, p.stats.progress, p.stats.planned ?? '', p.stats.forecast_end || '', p.stats.overdue, p.stats.pendingItems + p.stats.pendingInbox])] };
      },
    },

    payments_list: {
      size: 's', title: 'upcoming_payments',
      render(body, d, ctx) {
        const act = (x) => (x.state === 'pending' ? `<button class="btn sm" data-pay="invoiced" data-i="${x.item_id}" data-prev="${x.state}">${t('state_invoiced')}</button>` : '') + (x.state !== 'paid' ? `<button class="btn sm" data-pay="paid" data-i="${x.item_id}" data-prev="${x.state}">${t('ra_paid')}</button>` : '');
        body.innerHTML = d.payments.map((x) => listRow({ title: x.title, meta: `${projLink(x.project_id, x.project)} · <span style="white-space:nowrap">${esc(x.due)}</span>${x.late ? ` <span class="li-late">(${esc(t('late'))})</span>` : ''}`, actions: act(x), val: x.amount != null ? PM.fmt(x.amount, x.currency) : '', sub: t('state_' + x.state) })).join('') || empty();
        $$('[data-pay]', body).forEach((b) => (b.onclick = () => PM.act.setState(Number(b.dataset.i), b.dataset.pay, b.dataset.prev, () => ctx.reload())));
        return { csv: () => [[t('project'), t('milestone'), t('due_date'), t('amount'), t('currency'), t('col_state')], ...d.payments.map((x) => [x.project, x.title, x.due, x.amount ?? '', x.currency || '', x.state])] };
      },
    },

    overdue: {
      size: 's', title: 'overdue_tasks',
      render(body, d, ctx) {
        body.innerHTML = d.overdue.map((x, i) => listRow({ title: x.task, meta: `${projLink(x.project_id, x.project)}${x.assignee ? ` · ${esc(x.assignee)}` : ''}`, actions: `<button class="btn sm" data-prog="${i}">${t('ra_update')}</button>`, val: x.finish, valCls: 'bad', sub: x.progress + '%' })).join('') || empty(t('nothing_overdue'));
        if (d.overdueTotal > d.overdue.length) body.insertAdjacentHTML('beforeend', `<div class="small muted dw-note">${esc(t('dash_top_n', { n: d.overdue.length, total: d.overdueTotal }))}</div>`);
        $$('[data-prog]', body).forEach((b) => (b.onclick = () => { const x = d.overdue[Number(b.dataset.prog)]; PM.act.progress({ project_id: x.project_id, task_id: x.task_id, title: x.task, project: x.project, progress: x.progress }, () => ctx.reload()); }));
        return { csv: () => [[t('project'), t('g_task'), t('g_finish'), t('progress'), t('g_owner')], ...d.overdue.map((x) => [x.project, x.task, x.finish, x.progress, x.assignee || ''])] };
      },
    },

    activity: {
      size: 's', title: 'recent_activity',
      render(body, d) {
        body.innerHTML = d.activity.map((a) => { const [day, hm] = stamp(a.ts); return listRow({ title: a.detail.summary || a.action, meta: `${a.project_id ? projLink(a.project_id, a.project) : esc(a.project)}${a.actor ? ` · ${esc(a.actor)}` : ''}`, val: day, sub: hm }); }).join('') || empty();
        return { csv: () => [[t('time'), t('project'), t('actor'), t('action')], ...d.activity.map((a) => [a.ts, a.project, a.actor, a.detail.summary || a.action])] };
      },
    },
  };
  // Which built in widgets can be filtered, and how their data narrows. Project level widgets read the timeline rows, which
  // carry every project's dates, health and payments.
  const healthOpts = () => [['green', 'health_green'], ['amber', 'health_amber'], ['red', 'health_red']].map(([v, k]) => ({ v, label: t(k) }));
  const payOpts = (late) => [['pending', 'state_pending'], ['invoiced', 'state_invoiced'], ...(late ? [['paid', 'state_paid']] : []), ['late', 'late']].map(([v, k]) => ({ v, label: t(k) }));
  const namesOf = (d) => d.analytics.projects.map((p) => p.name);
  const tpDates = (d) => d.analytics.timeline.projects.flatMap((p) => [p.start, p.forecast, p.contract_end]).filter(Boolean);
  const tpOf = (d, F) => { const r = wfRange(F); return d.analytics.timeline.projects.filter((p) => (!F.p || p.name === F.p) && (!F.s || p.health === F.s) && wfSpan(p.start || p.forecast, p.forecast || p.contract_end, r)); };
  const byIds = (d, F) => new Set(tpOf(d, F).map((p) => p.id));
  const projWF = (extra) => ({ dates: tpDates, statuses: healthOpts, projects: namesOf, ...extra });
  WIDGETS.health.wf = projWF({ apply(d, F) { const ids = byIds(d, F), P = d.analytics.projects.filter((p) => ids.has(p.id)), H = { green: 0, amber: 0, red: 0 }; P.forEach((p) => { H[p.health] = (H[p.health] || 0) + 1; }); return { ...d, analytics: { ...d.analytics, projects: P, health: H } }; } });
  WIDGETS.progress.wf = projWF({ apply(d, F) { const ids = byIds(d, F); return { ...d, analytics: { ...d.analytics, projects: d.analytics.projects.filter((p) => ids.has(p.id)) } }; } });
  WIDGETS.deliverables.wf = projWF({ apply(d, F) { const ids = byIds(d, F); return { ...d, analytics: { ...d.analytics, deliverables: d.analytics.deliverables.filter((p) => ids.has(p.id)) } }; } });
  WIDGETS.portfolio.wf = projWF({ apply(d, F) { const ids = byIds(d, F); return { ...d, projects: d.projects.filter((p) => ids.has(p.id)) }; } });
  WIDGETS.schedule.wf = projWF({
    apply(d, F) {
      const r = wfRange(F), T = d.analytics.timeline;
      const P = tpOf(d, F).map((p) => ({ ...p, phases: r ? p.phases.filter((ph) => wfSpan(ph.start, ph.finish, r)) : p.phases, payments: r ? p.payments.filter((x) => wfPoint(x.due, r)) : p.payments }));
      const all = P.flatMap((p) => [p.start, p.forecast, p.contract_end, ...p.phases.flatMap((ph) => [ph.start, ph.finish])]).filter(Boolean).sort();
      return { ...d, analytics: { ...d.analytics, timeline: { ...T, min: all[0] || null, max: all[all.length - 1] || null, projects: P } } };
    },
  });
  WIDGETS.payments.wf = {
    dates: (d) => d.analytics.timeline.projects.flatMap((p) => p.payments.map((x) => x.due)), statuses: () => payOpts(true), projects: namesOf,
    apply(d, F) {
      const r = wfRange(F), today = d.analytics.timeline.today, money = {};
      for (const p of d.analytics.timeline.projects) {
        if (F.p && p.name !== F.p) continue;
        const cur = p.currency || '';
        for (const x of p.payments) {
          if (!wfPoint(x.due, r)) continue;
          const b = x.state === 'paid' ? 'paid' : x.state === 'invoiced' ? 'invoiced' : x.due < today ? 'late' : 'pending';
          if (F.s && F.s !== b) continue;
          if (!money[cur]) money[cur] = { currency: cur, paid: 0, invoiced: 0, pending: 0, late: 0, total: 0 };
          money[cur][b] += x.amount || 0; money[cur].total += x.amount || 0;
        }
      }
      return { ...d, analytics: { ...d.analytics, payments: Object.values(money) } };
    },
  };
  WIDGETS.payments_list.wf = {
    dates: (d) => (d.payments_all || d.payments).map((x) => x.due), statuses: () => payOpts(false), projects: (d) => [...new Set((d.payments_all || d.payments).map((x) => x.project))],
    apply(d, F) { const r = wfRange(F); return { ...d, payments: (d.payments_all || d.payments).filter((x) => wfPoint(x.due, r) && (!F.p || x.project === F.p) && (!F.s || (F.s === 'late' ? x.late : x.state === F.s && !x.late))) }; },
  };
  WIDGETS.overdue.wf = {
    dates: (d) => (d.overdue_all || d.overdue).map((x) => x.finish), projects: (d) => [...new Set((d.overdue_all || d.overdue).map((x) => x.project))],
    apply(d, F) { const r = wfRange(F), L = (d.overdue_all || d.overdue).filter((x) => wfPoint(x.finish, r) && (!F.p || x.project === F.p)); return { ...d, overdue: L, overdueTotal: L.length }; },
  };
  WIDGETS.activity.wf = {
    dates: (d) => d.activity.map((a) => a.ts), projects: (d) => [...new Set(d.activity.map((a) => a.project))],
    apply(d, F) { const r = wfRange(F); return { ...d, activity: d.activity.filter((a) => wfPoint(a.ts, r) && (!F.p || a.project === F.p)) }; },
  };

  const planned = (p) => (p.planned != null ? `· ${t('planned')} ${p.planned}%` : '');
  const DEFAULT_ORDER = ['kpi', 'radar', 'schedule', 'health', 'deliverables', 'payments', 'progress', 'workload', 'portfolio', 'payments_list', 'overdue', 'activity'];
  const SIZES = ['s', 'm', 'l'];
  // A built in widget names its title with a translation key. A custom widget carries its own text (label), so a title
  // someone typed can never be mistaken for a key.
  const wlabel = (w) => (w.label != null ? w.label : t(w.title));

  // ---------------- layout storage ----------------
  function fullLayout() {
    let F = {};
    try { F = JSON.parse((S.user && S.user.dash_layout) || '{}') || {}; } catch { F = {}; }
    return F;
  }
  function loadLayout(cfg) {
    const F = fullLayout();
    const L = cfg.key ? F[cfg.key] || {} : F;
    const order = (L.order || []).filter((id) => cfg.widgets[id]);
    for (const id of cfg.order) if (!order.includes(id)) order.push(id);
    return { order, hidden: (L.hidden || []).filter((id) => cfg.widgets[id]), size: L.size || {}, cur: F.cur };
  }
  let saveTimer = null;
  function saveLayout(L, cfg) {
    const F = fullLayout();
    const part = { order: L.order, hidden: L.hidden, size: L.size };
    if (cfg.key) F[cfg.key] = part; else Object.assign(F, part);
    if (L.cur) F.cur = L.cur;
    const txt = JSON.stringify(F);
    if (S.user) S.user.dash_layout = txt;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api('PUT', '/api/me', { dash_layout: txt }).catch(() => {}), 350);
  }

  // Read and write one overview's layout from outside the grid (the marketplace adds and removes widgets, saved layouts apply).
  const layoutApi = {
    read(key) { const F = fullLayout(), L = key ? F[key] || {} : F; return { order: (L.order || []).slice(), hidden: (L.hidden || []).slice(), size: { ...(L.size || {}) } }; },
    async write(key, part) {
      const F = fullLayout(), p = { order: part.order, hidden: part.hidden, size: part.size };
      if (key) F[key] = p; else Object.assign(F, p);
      const txt = JSON.stringify(F);
      if (S.user) S.user.dash_layout = txt;
      clearTimeout(saveTimer);
      await api('PUT', '/api/me', { dash_layout: txt });
    },
  };

  // ---------------- export ----------------
  function fileOut(name, blob, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(t('exported_ok'), 'ok');
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  function exportCsv(id, info, cfg) {
    const text = '﻿' + csvOf(info.csv());
    fileOut(`${slug(wlabel(cfg.widgets[id]))}.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }), text);
  }
  const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'opacity', 'fill-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'letter-spacing', 'paint-order', 'stroke-linejoin', 'direction'];
  function exportPng(id, body, cfg) {
    const svg = $('svg.viz', body);
    if (!svg) return;
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((el, i) => { const cs = getComputedStyle(el); let css = ''; for (const p of STYLE_PROPS) css += `${p}:${cs.getPropertyValue(p)};`; dst[i].setAttribute('style', css); dst[i].removeAttribute('class'); });
    clone.querySelectorAll('.hit').forEach((n) => n.remove());
    const vb = svg.viewBox.baseVal;
    const w = 1000, h = Math.round((vb.height / vb.width) * w);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', h);
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
    const img = new Image();
    img.onload = () => {
      const pad = 28, head = 44, scale = 2;
      const cv = document.createElement('canvas'); cv.width = (w + pad * 2) * scale; cv.height = (h + pad * 2 + head) * scale;
      const c = cv.getContext('2d'); c.scale(scale, scale);
      c.fillStyle = surface; c.fillRect(0, 0, cv.width, cv.height);
      c.fillStyle = ink; c.font = '700 20px Tajawal, sans-serif'; c.fillText(wlabel(cfg.widgets[id]), pad, pad + 16);
      c.drawImage(img, pad, pad + head, w, h);
      cv.toBlob((b) => fileOut(`${slug(wlabel(cfg.widgets[id]))}.png`, b), 'image/png');
    };
    img.onerror = () => toast(t('err_download'), 'err');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  }


  // The chart as it is on screen, drawn as a PNG in the light theme so it reads on paper. Returns null when the widget has no chart.
  async function rasterSvg(body) {
    const svg = body && $('svg.viz', body);
    if (!svg || !svg.viewBox || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width) return null;
    const root = document.documentElement, prev = root.getAttribute('data-theme');
    let xml = '', surface = '#ffffff';
    try {
      if (prev !== 'light') root.setAttribute('data-theme', 'light');
      const clone = svg.cloneNode(true);
      const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
      src.forEach((el, i) => { const cs = getComputedStyle(el); let css = ''; for (const p of STYLE_PROPS) css += `${p}:${cs.getPropertyValue(p)};`; dst[i].setAttribute('style', css); dst[i].removeAttribute('class'); });
      clone.querySelectorAll('.hit').forEach((n) => n.remove());
      const vb = svg.viewBox.baseVal, w = 1000, h = Math.round((vb.height / vb.width) * w);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', h);
      surface = getComputedStyle(root).getPropertyValue('--surface').trim() || '#ffffff';
      xml = new XMLSerializer().serializeToString(clone);
      var W = w, H = h;
    } finally { if (prev !== 'light') { if (prev == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prev); } }
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
    const sc = 2, cv = document.createElement('canvas'); cv.width = W * sc; cv.height = H * sc;
    const c = cv.getContext('2d'); c.scale(sc, sc); c.fillStyle = surface; c.fillRect(0, 0, W, H); c.drawImage(img, 0, 0, W, H);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    return { data: new Uint8Array(await blob.arrayBuffer()), w: W, h: H };
  }

  // ---------------- tooltips ----------------
  function bindTips(root) {
    let el = $('#vizTip');
    if (!el) { el = document.createElement('div'); el.id = 'vizTip'; el.className = 'viz-tip'; document.body.appendChild(el); }
    const show = (e) => {
      const n = e.target.closest && e.target.closest('[data-tip]');
      if (!n || !n.getAttribute('data-tip')) { el.classList.remove('on'); return; }
      el.innerHTML = n.getAttribute('data-tip');
      el.classList.add('on');
      const r = el.getBoundingClientRect();
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
      el.style.transform = `translate(${x}px,${y}px)`;
    };
    root.addEventListener('pointermove', show);
    root.addEventListener('pointerleave', () => el.classList.remove('on'));
    root.addEventListener('pointerdown', () => el.classList.remove('on'));
  }

  // ---------------- count up ----------------
  function countUp(root) {
    if (reduced()) return;
    $$('[data-count]', root).forEach((el) => {
      const to = Number(el.dataset.count), suf = el.dataset.suffix || '';
      if (!Number.isFinite(to) || to === 0) return;
      const t0 = performance.now(), dur = 700;
      const tick = (now) => { const k = Math.min(1, (now - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - k, 3))); el.textContent = v + suf; if (k < 1) requestAnimationFrame(tick); };
      el.textContent = '0' + suf; requestAnimationFrame(tick);
    });
  }

  // ---------------- mount ----------------
  const MAIN = { widgets: WIDGETS, order: DEFAULT_ORDER, key: null, currencyToggle: true, filters: 'portfolio', fkey: 'main', reportUrl: '/api/dashboard/report-data', fetch: (qs) => api('GET', '/api/dashboard' + (qs || '')) };
  function mount(host, d, cfg) {
    cfg = cfg || MAIN;
    const scope = cfg.key ? 'project' : 'portfolio';
    if (PM.widgets) cfg = PM.widgets.extend(cfg, d, scope); // widgets the person added from the marketplace
    const animate = (cfg.always || firstPaint) && !reduced();
    if (!cfg.always) firstPaint = false;
    let L = loadLayout(cfg);
    if (cfg.currencyToggle && !PM.fx.choices.includes(L.cur)) L.cur = 'USD';
    const modeNow = () => (cfg.currencyToggle ? L.cur : 'native');
    const infos = {};

    host.innerHTML = `<div class="dw-bar"><div class="dw-bar-l"><span class="muted small" id="dwCount"></span></div><div class="row" style="gap:8px">${cfg.currencyToggle ? `<div class="seg" id="dwCur" role="group" aria-label="${esc(t('fx_display'))}" title="${esc(t('fx_note', { r: PM.fx.rateNote('AED') + ', ' + PM.fx.rateNote('SAR') }))}">${PM.fx.choices.map((c) => `<button data-cur="${c}" aria-pressed="${c === L.cur}" class="${c === L.cur ? 'on' : ''}">${c}</button>`).join('')}</div>` : ''}<button class="btn sm ghost" id="dwReset" hidden>${t('dash_reset')}</button>${PM.widgets ? `<a class="btn sm" id="dwAdd" href="#/widgets?scope=${scope}">${icon('plus')}${t('wm_add_widgets')}</a><button class="btn sm" id="dwLayouts" type="button">${icon('list')}${t('wl_layouts')}</button>` : ''}${cfg.filters && PM.dashReport ? `<button class="btn sm" id="dwExport" type="button">${icon('file')}${t('ex_report')}</button>` : ''}<button class="btn sm" id="dwCustom" aria-expanded="false">${icon('cols')}${t('dash_customize')}</button></div></div>
      ${cfg.filters ? '<div class="dw-flt" id="dwFlt"></div><div class="dw-empty" id="dwEmpty" role="status" hidden></div>' : ''}
      <div class="dw-panel" id="dwPanel" aria-hidden="true"><div><div class="dw-panel-in" id="dwChips"></div></div></div>
      <div class="dw-grid ${animate ? 'anim' : ''}" id="dwGrid"></div>`;
    const grid = $('#dwGrid', host);

    const sizeOf = (id) => (SIZES.includes(L.size[id]) ? L.size[id] : cfg.widgets[id].size);
    const visible = () => L.order.filter((id) => !L.hidden.includes(id));

    // any widget with more than five rows shows five and a toggle for the rest
    const MAXR = 5, openRows = {};
    function limitBars(body, id) {
      const svg = $('svg.hbars', body), gs = svg ? $$('.hb-row', svg) : [];
      if (gs.length <= MAXR) return;
      const vb = svg.viewBox.baseVal, rh = (vb.height - 6) / gs.length, shortH = MAXR * rh + 6, fullH = vb.height, extra = gs.length - MAXR;
      const btn = document.createElement('button');
      btn.className = 'dw-more-rows'; btn.type = 'button';
      const apply = () => {
        const on = !!openRows[id];
        gs.slice(MAXR).forEach((g) => { g.style.display = on ? '' : 'none'; });
        svg.setAttribute('viewBox', `0 0 ${vb.width} ${on ? fullH : shortH}`);
        btn.innerHTML = `${on ? t('dash_show_less') : t('dash_show_more', { n: extra })}${icon('down', on ? 'flip' : '')}`;
        btn.setAttribute('aria-expanded', String(on));
      };
      btn.onclick = () => { openRows[id] = !openRows[id]; apply(); };
      apply();
      ($(':scope > .viz-legend', body) || svg).after(btn);
    }
    function limitRows(el, body, id) {
      limitBars(body, id);
      const trs = $$('tbody tr', body);
      const rows = trs.length > MAXR ? trs : $$(':scope > .list-item', body);
      if (rows.length <= MAXR) return;
      const extra = rows.slice(MAXR);
      const btn = document.createElement('button');
      btn.className = 'dw-more-rows'; btn.type = 'button';
      const apply = (instant) => {
        const on = !!openRows[id];
        extra.forEach((r) => { r.hidden = !on; });
        btn.innerHTML = `${on ? t('dash_show_less') : t('dash_show_more', { n: extra.length })}${icon('down', on ? 'flip' : '')}`;
        btn.setAttribute('aria-expanded', String(on));
        if (on && !instant && !reduced()) extra.forEach((r, k) => r.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: k * 25, easing: 'ease-out', fill: 'backwards' }));
      };
      btn.onclick = () => { openRows[id] = !openRows[id]; apply(); };
      apply(true);
      const note = $(':scope > .dw-note', body);
      if (note) note.before(btn); else body.appendChild(btn);
    }

    // widgets receive a context so an action inside one can refresh the others
    const ctx = {
      get data() { return d; },
      async reload() { d = await load(); refreshWidgets(); afterLoad(); return d; },
      live(id) { const el = $(`.dw[data-w="${id}"]`, grid); return { info: infos[id], body: el && $('.dw-body', el) }; },
      async reloadExcept(id) { d = await load(); refreshWidgets(id); afterLoad(); return d; },
    };
    // filters: the saved filter is sent with every fetch and only the latest answer is used
    const fq = () => (cfg.filters && PM.dashFilters ? PM.dashFilters.query(cfg.fkey) : '');
    let seq = 0, flt = null;
    const load = async () => { const n = ++seq, r = await cfg.fetch(fq()); if (n !== seq) throw Object.assign(new Error('stale'), { stale: true }); return r; };
    function afterLoad() {
      if (flt) flt.update(d);
      const em = $('#dwEmpty', host); if (!em) return;
      const none = PM.dashFilters.isOn(PM.dashFilters.get(cfg.fkey)) && (cfg.key ? d.filter_empty === true : !(d.projects && d.projects.length));
      em.hidden = !none; em.textContent = none ? t(cfg.key ? 'gf_none_project' : 'gf_none_portfolio') : '';
    }
    function refreshWidgets(except) {
      visible().forEach((id, i) => {
        if (id === except) return;
        const old = $(`.dw[data-w="${id}"]`, grid), n = frame(id, i);
        if (old) old.replaceWith(n); else grid.appendChild(n);
      });
      countUp(grid);
    }

    // redraw one widget so charts and text fit its current width
    const SKIP_RELAYOUT = new Set(['radar', 'pradar']); // the radar adapts with CSS and keeps its filters
    function rerender(id) {
      const old = $(`.dw[data-w="${id}"]`, grid);
      if (!old) return;
      const n = frame(id, Number(old.style.getPropertyValue('--i')) || 0);
      n.classList.remove('dragging');
      old.replaceWith(n);
      countUp(n);
    }
    let lastW = 0, rlTimer = null;
    const relayout = () => {
      const w = grid.clientWidth;
      if (!w || Math.abs(w - lastW) < 24) return;
      lastW = w;
      visible().forEach((id) => { if (!SKIP_RELAYOUT.has(id)) rerender(id); });
    };
    function frame(id, i) {
      const w = cfg.widgets[id], wkey = (cfg.key || 'main') + ':' + id, F = w.wf ? wfGet(wkey) : null, fon = wfOn(F);
      const el = document.createElement('section');
      el.className = `dw sz-${sizeOf(id)}`; el.dataset.w = id; el.style.setProperty('--i', i);
      el.innerHTML = `<header class="dw-h"><button class="dw-grip" aria-label="${esc(t('dash_move'))}" title="${esc(t('dash_drag_hint'))}">${icon('grip')}</button><h3>${esc(wlabel(w))}</h3><span class="grow"></span>${w.wf ? `<button class="dw-wf btn ghost icon${fon ? ' on' : ''}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(t('wfl_title'))}" title="${esc(t('wfl_title'))}">${icon('filter')}</button>` : ''}<button class="dw-more btn ghost icon" aria-haspopup="menu" aria-label="${esc(t('dash_widget_menu'))}">${icon('more')}</button></header><div class="dw-body"></div>`;
      const body = $('.dw-body', el);
      const span = { l: 12, m: 6, s: 4 }[sizeOf(id)] || 12, gw = grid.clientWidth || 1100, vw = innerWidth, cols = vw <= 860 ? 1 : vw <= 1180 && span === 4 ? 2 : 0;
      const sp = cols === 1 ? 12 : cols === 2 ? 6 : span;
      CW = (gw - 11 * 16) / 12 * sp + (sp - 1) * 16 - 38;
      PM.fx.mode = modeNow();
      PMCL.scope(id);
      if (fon) { const bar = document.createElement('div'); bar.className = 'dw-fs'; bar.innerHTML = `<span class="dw-fs-t">${icon('filter')}<span>${esc(wfLabel(F, w, d))}</span></span><button type="button" class="dw-fx" aria-label="${esc(t('wfl_clear_chip'))}" title="${esc(t('wfl_clear_chip'))}">${icon('x')}</button>`; body.before(bar); }
      infos[id] = w.render(body, fon && w.wf.apply ? w.wf.apply(d, F) : d, ctx, F) || { csv: () => [] };
      const cl = PMCL.collect()[0];
      if (cl) { const more = $('.dw-more', el); if (more) more.insertAdjacentHTML('beforebegin', PMCL.button(cl)); PMCL.bind(el, () => rerender(id)); }
      if (id !== 'radar') limitRows(el, body, id);
      if (animate) body.classList.add('anim-in');
      return el;
    }

    function draw() {
      grid.innerHTML = '';
      visible().forEach((id, i) => grid.appendChild(frame(id, i)));
      countUp(grid);
      chips();
      $('#dwCount', host).textContent = L.hidden.length ? t('dash_hidden_n', { n: L.hidden.length }) : '';
      $('#dwReset', host).hidden = !(L.hidden.length || L.size && Object.keys(L.size).length || L.order.join() !== cfg.order.join());
      $$('[data-newproj]', grid).forEach((b) => (b.onclick = PM.newProjectDialog));
    }
    function chips() {
      $('#dwChips', host).innerHTML = L.order.map((id) => { const on = !L.hidden.includes(id); return `<button class="dw-chip ${on ? 'on' : ''}" data-toggle="${id}" aria-pressed="${on}">${icon(on ? 'eye' : 'eyeoff')}${esc(wlabel(cfg.widgets[id]))}</button>`; }).join('');
    }
    const persist = () => saveLayout(L, cfg);

    // FLIP helper: animate siblings from their old to new rects
    function flip(change) {
      const els = $$('.dw', grid).filter((e) => !e.classList.contains('dragging'));
      const before = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
      change();
      if (reduced()) return;
      for (const e of els) {
        const a = before.get(e), b = e.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (dx || dy) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }

    // ----- toolbar and chips -----
    const panel = $('#dwPanel', host), custom = $('#dwCustom', host);
    custom.onclick = () => { const open = panel.classList.toggle('open'); custom.setAttribute('aria-expanded', open); panel.setAttribute('aria-hidden', !open); };
    $('#dwChips', host).onclick = (e) => {
      const b = e.target.closest('[data-toggle]'); if (!b) return;
      const id = b.dataset.toggle;
      if (L.hidden.includes(id)) L.hidden = L.hidden.filter((x) => x !== id); else L.hidden.push(id);
      persist(); draw();
      const el = $(`.dw[data-w="${id}"]`, grid); if (el && !reduced()) el.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
    };
    const curBox = $('#dwCur', host);
    if (curBox) curBox.onclick = (e) => { const b = e.target.closest('[data-cur]'); if (!b || b.dataset.cur === L.cur) return; L.cur = b.dataset.cur; $$('#dwCur button', host).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); persist(); draw(); };
    $('#dwReset', host).onclick = () => { L = { order: cfg.order.slice(), hidden: [], size: {}, cur: L.cur }; persist(); draw(); };
    const layoutsBtn = $('#dwLayouts', host);
    if (layoutsBtn) layoutsBtn.onclick = () => PM.widgets.layoutsDialog({ scope, key: cfg.key, current: () => ({ order: L.order.slice(), hidden: L.hidden.slice(), size: { ...L.size } }) });

    // ----- widget menu -----
    let menu = null;
    const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.dw-more')) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    function openMenu(btn, id) {
      closeMenu();
      const info = infos[id], el = btn.closest('.dw');
      const idx = visible().indexOf(id), vis = visible();
      const item = (act, label, ic, dis) => `<button role="menuitem" data-act="${act}" ${dis ? 'disabled' : ''}>${icon(ic)}${esc(label)}</button>`;
      menu = document.createElement('div'); menu.className = 'dw-menu'; menu.setAttribute('role', 'menu');
      const cw = cfg.widgets[id].community;
      menu.innerHTML = (cw ? `<div class="dw-menu-note small muted">${esc(t('wm_by', { name: cw.author }))}${cw.version > 1 ? ` · ${esc(t('wm_version', { n: cw.version }))}` : ''}</div>` : '') + item('csv', t('dash_export_csv'), 'dl') + (info.chart ? item('png', t('dash_export_png'), 'img') : '') + '<hr>' +
        item('up', t('dash_move_earlier'), 'up', idx <= 0) + item('down', t('dash_move_later'), 'down', idx >= vis.length - 1) + '<hr>' +
        `<div class="dw-sizes" role="group" aria-label="${esc(t('dash_size'))}">${SIZES.map((s) => `<button data-size="${s}" class="${sizeOf(id) === s ? 'on' : ''}" aria-pressed="${sizeOf(id) === s}">${t('dash_size_' + s)}</button>`).join('')}</div><hr>` + item('hide', t('dash_hide'), 'eyeoff') + (cw ? item('remove', t('wm_remove_widget'), 'trash') : '');
      document.body.appendChild(menu);
      const r = btn.getBoundingClientRect(), mw = menu.offsetWidth;
      const left = Math.min(Math.max(8, S.lang === 'ar' ? r.left : r.right - mw), innerWidth - mw - 8);
      menu.style.left = left + 'px'; menu.style.top = Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8) + 'px';
      menu.onclick = (e) => {
        const a = e.target.closest('[data-act]'), sz = e.target.closest('[data-size]');
        if (sz) { flip(() => { L.size[id] = sz.dataset.size; el.className = `dw sz-${sz.dataset.size}`; rerender(id); }); persist(); closeMenu(); $('#dwReset', host).hidden = false; return; }
        if (!a || a.disabled) return;
        closeMenu();
        if (a.dataset.act === 'csv') exportCsv(id, info, cfg);
        else if (a.dataset.act === 'png') exportPng(id, $('.dw-body', el), cfg);
        else if (a.dataset.act === 'remove') {
          PM.widgets.removeFromOverview({ scope, key: cfg.key, id, cw, L, undo: () => PM.vt(PM.route) }).then((ok) => {
            if (!ok) return;
            delete cfg.widgets[id]; L.order = L.order.filter((x) => x !== id); L.hidden = L.hidden.filter((x) => x !== id); delete L.size[id];
            persist(); draw();
          });
        } else if (a.dataset.act === 'hide') { L.hidden.push(id); persist(); flip(() => { el.remove(); }); chips(); $('#dwCount', host).textContent = t('dash_hidden_n', { n: L.hidden.length }); $('#dwReset', host).hidden = false; }
        else { // move earlier or later among visible widgets
          const v = visible(), i = v.indexOf(id), j = a.dataset.act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= v.length) return;
          const other = v[j];
          const from = L.order.indexOf(id), to = L.order.indexOf(other);
          L.order.splice(from, 1); L.order.splice(to, 0, id);
          flip(() => { const oe = $(`.dw[data-w="${other}"]`, grid); if (a.dataset.act === 'up') grid.insertBefore(el, oe); else oe.after(el); });
          persist(); chips(); $('#dwReset', host).hidden = false;
        }
      };
      $('button:not([disabled])', menu).focus();
    }
    // ----- widget filter -----
    let fpop = null, fpFor = null;
    const closeFilter = () => { if (fpop) { fpop.remove(); fpop = null; const b = fpFor && $(`.dw[data-w="${fpFor}"] .dw-wf`, grid); if (b) b.setAttribute('aria-expanded', 'false'); fpFor = null; } };
    document.addEventListener('pointerdown', (e) => { if (fpop && !fpop.contains(e.target) && !e.target.closest('.dw-wf')) closeFilter(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilter(); });
    function openFilter(btn, id) {
      closeMenu();
      if (fpop && fpFor === id) { closeFilter(); return; }
      closeFilter();
      const w = cfg.widgets[id], wkey = (cfg.key || 'main') + ':' + id, W = w.wf;
      let F = { ...wfGet(wkey) };
      const years = () => { const set = new Set((W.dates ? W.dates(d, F) : []).map((x) => String(x).slice(0, 4)).filter((x) => /^\d{4}$/.test(x))); set.add(String(new Date().getFullYear())); if (F.y) set.add(F.y); return [...set].sort(); };
      const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
      const sel = (k, label, all, list) => `<label class="dw-fp-f"><span>${esc(label)}</span><select data-f="${k}">${opt('', all, F[k])}${list.map((o) => opt(o.v, o.label, F[k])).join('')}</select></label>`;
      const draw = () => {
        const period = !!(W.dates || W.bases), bases = W.bases ? W.bases(d) : null;
        const qs = [1, 2, 3, 4].map((n) => ({ v: String(n), label: t('wfl_q', { n }) }));
        const ms = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => !F.q || Math.ceil(m / 3) === Number(F.q)).map((m) => ({ v: String(m), label: monthName(m) }));
        const st = W.statuses ? W.statuses(d) : null, pr = W.projects ? W.projects(d) : null;
        fpop.innerHTML = `<div class="dw-fp-h"><b>${esc(t('wfl_title'))}</b><button type="button" class="btn sm ghost" data-clear ${wfOn(F) ? '' : 'disabled'}>${esc(t('wfl_clear'))}</button></div>` +
          (period ? sel('y', t('wfl_year'), t('wfl_all_years'), years().map((y) => ({ v: y, label: y }))) + `<div class="dw-fp-2">${sel('q', t('wfl_quarter'), t('wfl_all_quarters'), qs)}${sel('m', t('wfl_month'), t('wfl_all_months'), ms)}</div>` : '') +
          (bases && bases.length > 1 ? sel('b', t('wfl_based'), bases[0].label, bases.slice(1)) : '') +
          (st && st.length ? sel('s', t('wfl_status'), t('wfl_all_status'), st) : '') + (pr && pr.length > 1 ? sel('p', t('wfl_project'), t('wfl_all_projects'), pr.map((x) => ({ v: x, label: x }))) : '');
      };
      fpop = document.createElement('div'); fpop.className = 'dw-fp'; fpop.setAttribute('role', 'dialog'); fpop.setAttribute('aria-label', t('wfl_title')); fpFor = id;
      document.body.appendChild(fpop); draw();
      btn.setAttribute('aria-expanded', 'true');
      const place = () => { const r = btn.getBoundingClientRect(), mw = fpop.offsetWidth; fpop.style.left = Math.min(Math.max(8, S.lang === 'ar' ? r.left : r.right - mw), innerWidth - mw - 8) + 'px'; fpop.style.top = Math.min(r.bottom + 6, Math.max(8, innerHeight - fpop.offsetHeight - 8)) + 'px'; };
      place();
      const apply = (focusK) => { wfPut(wkey, F); rerender(id); const nb = $(`.dw[data-w="${id}"] .dw-wf`, grid); if (nb) { nb.setAttribute('aria-expanded', 'true'); btn = nb; } draw(); place(); const fe = focusK && $(`[data-f="${focusK}"]`, fpop); if (fe) fe.focus(); };
      fpop.onchange = (e) => {
        const k = e.target.dataset && e.target.dataset.f; if (!k) return;
        F[k] = e.target.value;
        if ((k === 'q' || k === 'm') && F[k] && !F.y) F.y = String(new Date().getFullYear());
        if (k === 'q' && F.q && F.m && Math.ceil(Number(F.m) / 3) !== Number(F.q)) F.m = '';
        if (k === 'y' && !F.y) { F.q = ''; F.m = ''; }
        apply(k);
      };
      fpop.onclick = (e) => { if (e.target.closest('[data-clear]')) { F = {}; apply(); } };
      const first = $('select', fpop); if (first) first.focus();
    }

    grid.addEventListener('click', (e) => {
      const fb = e.target.closest('.dw-wf'); if (fb) { openFilter(fb, fb.closest('.dw').dataset.w); return; }
      const fx = e.target.closest('.dw-fx'); if (fx) { const fid = fx.closest('.dw').dataset.w; wfPut((cfg.key || 'main') + ':' + fid, {}); closeFilter(); rerender(fid); return; }
      const b = e.target.closest('.dw-more'); if (b) { openMenu(b, b.closest('.dw').dataset.w); return; }
      const go = e.target.closest('[data-go]'); if (go && !e.target.closest('.dw-h') && !e.target.closest('button')) { e.stopPropagation(); const m = /^#\/p\/(\d+)\/?(\w+)?/.exec(go.dataset.go); if (m && PM.act) PM.act.peek(Number(m[1]), m[2] && m[2] !== 'overview' ? m[2] : null); else location.hash = go.dataset.go; }
    });

    // ----- drag to reorder -----
    grid.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.dw-grip');
      if (!grip || e.button) return;
      e.preventDefault();
      closeMenu();
      const el = grip.closest('.dw'), r = el.getBoundingClientRect();
      const ph = document.createElement('div'); ph.className = `dw-ph ${[...el.classList].find((c) => c.startsWith('sz-'))}`; ph.style.height = r.height + 'px';
      el.after(ph);
      const off = { x: e.clientX - r.left, y: e.clientY - r.top };
      el.classList.add('dragging');
      el.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:90;pointer-events:none;margin:0`;
      grip.setPointerCapture(e.pointerId);
      const scroller = (() => { let n = grid; while (n && n !== document.body) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; n = n.parentElement; } return document.scrollingElement; })();
      let raf = 0, last = e;
      const placeOld = (ev) => {
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList && n.classList.contains('dw') && n !== el);
        if (!under) return;
        const b = under.getBoundingClientRect();
        const sameRow = Math.abs(ev.clientY - (b.top + b.height / 2)) < b.height / 2 && Math.abs(b.top - ph.getBoundingClientRect().top) < 40;
        const before = sameRow ? ev.clientX < b.left + b.width / 2 : ev.clientY < b.top + b.height / 2;
        if (before ? under.previousElementSibling === ph : under.nextElementSibling === ph) return;
        flip(() => { if (before) grid.insertBefore(ph, under); else under.after(ph); });
      };

      // Row snapping (desktop): drop on the middle of a row to join it, on its top or bottom edge to start a new row.
      // A row holds at most three widgets and they share the width equally: 1 is full, 2 is half, 3 is a third.
      const multi = innerWidth > 1180;
      const DRAG = '__drag', sizeFor = (n) => (n >= 3 ? 's' : n === 2 ? 'm' : 'l');
      const base = [];
      let curKey = '', applied = null;
      if (multi) {
        let lastTop = null;
        for (const n of [...grid.children]) {
          if (n === el || !(n.classList.contains('dw') || n === ph)) continue;
          const tp = n.getBoundingClientRect().top;
          if (lastTop === null || Math.abs(tp - lastTop) > 4) { base.push({ ids: [], src: false }); lastTop = tp; }
          const row = base[base.length - 1];
          if (n === ph) row.src = true; else row.ids.push(n.dataset.w);
        }
        for (let k = base.length - 1; k >= 0; k--) if (!base[k].ids.length) base.splice(k, 1);
      }
      const origSz = new Map($$('.dw, .dw-ph', grid).map((n) => [n, (n.className.match(/sz-\w/) || ['sz-l'])[0]]));
      const nodeOf = (id) => (id === DRAG ? ph : $(`.dw[data-w="${id}"]`, grid));
      const apply = (rows) => {
        const sizes = {};
        for (const r of rows) if (r.src || r.tgt) { const sz = sizeFor(r.ids.length); r.ids.forEach((id) => { sizes[id] = sz; }); }
        flip(() => {
          const order = rows.flatMap((r) => r.ids);
          origSz.forEach((c, n) => { if (n !== el) n.className = n.className.replace(/sz-\w/, c); });
          order.forEach((id) => { const n = nodeOf(id); if (!n) return; grid.appendChild(n); if (sizes[id]) n.className = n.className.replace(/sz-\w/, 'sz-' + sizes[id]); });
        });
        applied = sizes;
      };
      let pendKey = '', pendTimer = 0;
      const place = (ev) => {
        if (!multi) return placeOld(ev);
        const hits = document.elementsFromPoint(ev.clientX, ev.clientY);
        if (hits.includes(ph)) { clearTimeout(pendTimer); pendKey = ''; return; }
        const under = hits.find((n) => n.classList && n.classList.contains('dw') && n !== el);
        if (!under) return;
        const ri = base.findIndex((r) => r.ids.includes(under.dataset.w));
        if (ri < 0) return;
        const b = under.getBoundingClientRect(), edge = Math.min(48, b.height * 0.25), dy = ev.clientY - b.top;
        const mode = dy < edge ? 'above' : dy > b.height - edge ? 'below' : base[ri].ids.length < 3 ? 'into' : dy < b.height / 2 ? 'above' : 'below';
        let idx = 0;
        if (mode === 'into') idx = base[ri].ids.filter((id) => { const n = nodeOf(id); const q = n && n.getBoundingClientRect(); return q && (document.documentElement.dir === 'rtl' ? ev.clientX < q.left + q.width / 2 : ev.clientX > q.left + q.width / 2); }).length;
        const key = mode + ri + ':' + idx;
        if (key === curKey) { clearTimeout(pendTimer); pendKey = ''; return; }
        if (key === pendKey) return;
        pendKey = key; clearTimeout(pendTimer);
        // wait a moment so passing over a widget does not rearrange the page
        pendTimer = setTimeout(() => {
          curKey = key; pendKey = '';
          const rows = base.map((r) => ({ ids: r.ids.slice(), src: r.src, tgt: false }));
          if (mode === 'into') { rows[ri].ids.splice(idx, 0, DRAG); rows[ri].tgt = true; }
          else rows.splice(mode === 'above' ? ri : ri + 1, 0, { ids: [DRAG], src: false, tgt: true });
          apply(rows);
        }, 130);
      };
      const move = (ev) => {
        last = ev;
        el.style.left = ev.clientX - off.x + 'px'; el.style.top = ev.clientY - off.y + 'px';
        place(ev);
        cancelAnimationFrame(raf);
        const edge = 70; let dy = 0;
        if (ev.clientY < edge) dy = -14; else if (ev.clientY > innerHeight - edge) dy = 14;
        if (dy) { const loop = () => { scroller.scrollBy(0, dy); place(last); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
      };
      const up = () => {
        cancelAnimationFrame(raf); clearTimeout(pendTimer);
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        const from = el.getBoundingClientRect();
        el.classList.remove('dragging'); el.style.cssText = '';
        ph.replaceWith(el);
        const to = el.getBoundingClientRect();
        if (!reduced()) el.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px)`, boxShadow: 'var(--shadow-lg)' }, { transform: 'none', boxShadow: 'var(--shadow)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
        const ids = $$('.dw', grid).map((n) => n.dataset.w);
        const hidden = L.order.filter((id) => L.hidden.includes(id));
        L.order = [...ids, ...hidden];
        const changed = [];
        if (applied) for (const [id0, sz] of Object.entries(applied)) { const id = id0 === DRAG ? el.dataset.w : id0; if (sizeOf(id) !== sz) { L.size[id] = sz; changed.push(id); } }
        persist(); chips(); $('#dwReset', host).hidden = false;
        changed.forEach((id) => { const n = $(`.dw[data-w="${id}"]`, grid); if (n) n.className = n.className.replace(/sz-\w/, 'sz-' + sizeOf(id)); rerender(id); });
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    // keyboard: arrow keys on the grip move the widget
    grid.addEventListener('keydown', (e) => {
      const grip = e.target.closest('.dw-grip'); if (!grip || !/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
      e.preventDefault();
      const id = grip.closest('.dw').dataset.w, v = visible(), i = v.indexOf(id), j = i + (/Up|Left/.test(e.key) ? -1 : 1);
      if (j < 0 || j >= v.length) return;
      const from = L.order.indexOf(id), to = L.order.indexOf(v[j]);
      L.order.splice(from, 1); L.order.splice(to, 0, id);
      persist(); draw(); const g2 = $(`.dw[data-w="${id}"] .dw-grip`, grid); if (g2) g2.focus();
    });

    // The top filters rule the page: a widget filter that disagrees with a changed top filter is rewritten to match it,
    // and the viewer is told which widgets were changed.
    function syncWidgetFilters(f, prev) {
      if (!flt) return;
      const names = {};
      for (const x of (d && d.filter_options && d.filter_options.projects) || []) names[x.id] = x.name;
      const touched = [];
      for (const id of Object.keys(cfg.widgets)) {
        const w = cfg.widgets[id]; if (!w.wf) continue;
        const wkey = (cfg.key || 'main') + ':' + id, cur = wfGet(wkey);
        if (!wfOn(cur)) continue;
        let st = null; try { st = w.wf.statuses ? w.wf.statuses(d).map((x) => x.v) : null; } catch { st = null; }
        const next = PM.dashFilters.align(cur, f, prev, st, names);
        if (!next) continue;
        wfPut(wkey, next); touched.push(wlabel(w));
      }
      closeFilter();
      flt.warn(touched.length ? t('gf_sync_warn', { n: touched.length, list: touched.join(', ') }) : '');
    }
    if (cfg.filters && PM.dashFilters && $('#dwFlt', host)) {
      flt = PM.dashFilters.mountBar($('#dwFlt', host), { key: cfg.fkey, scope: cfg.key ? 'project' : 'portfolio', d, onChange: (f, prev) => {
        syncWidgetFilters(f, prev);
        grid.setAttribute('aria-busy', 'true'); grid.classList.add('dw-load');
        ctx.reload().catch((e) => { if (!e.stale) PM.toast(t('gf_failed'), 'err'); }).finally(() => { grid.removeAttribute('aria-busy'); grid.classList.remove('dw-load'); });
      } });
      afterLoad();
    }
    const exb = $('#dwExport', host);
    if (exb) exb.onclick = () => PM.dashReport.open({ scope, fkey: cfg.fkey, ctx, mode: modeNow, reportUrl: cfg.reportUrl, items: visible().map((id) => ({ id, label: wlabel(cfg.widgets[id]), w: cfg.widgets[id] })) });
    bindTips(host);
    lastW = grid.clientWidth;
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { clearTimeout(rlTimer); rlTimer = setTimeout(() => { if (!host.isConnected) return ro.disconnect(); relayout(); }, 140); });
      ro.observe(grid);
    }
    const onPeek = () => { if (!host.isConnected) return document.removeEventListener('pm-peek-close', onPeek); if (cfg.fetch) ctx.reload().catch(() => {}); };
    document.addEventListener('pm-peek-close', onPeek);
    draw();
    if (animate) setTimeout(() => grid.classList.remove('anim'), 2200);
  }

  PM.dash = { mount, main: MAIN, layout: layoutApi, wf: { range: wfRange, point: wfPoint, on: wfOn }, h: { rasterSvg, kpiList, setWidth: (n) => { CW = n; }, bindTips, listRow, projLink, stamp, width: () => CW, tipAttr: tip, hbars, donut, legend, empty, tip, num, dnum, ymd, trunc, countUp, csvOf, reduced, WIDGETS } };
})();
