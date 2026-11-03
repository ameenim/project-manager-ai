/* Overview dashboard: a grid of widgets that can be moved, resized, hidden and exported. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, money, $, $$, api, toast, state: S } = PM;
  const DAY = 864e5;
  const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const ymd = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const num = (n) => Number(n || 0).toLocaleString(S.lang === 'ar' ? 'ar-AE' : 'en-US', { maximumFractionDigits: 0 });
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
    const segs = parts.filter((p) => p.v > 0).map((p) => {
      const len = (p.v / total) * 100;
      const gap = parts.filter((x) => x.v > 0).length > 1 ? 1.2 : 0;
      const el = `<circle class="dn ${p.cls}" cx="${C}" cy="${C}" r="${R}" pathLength="100" stroke-dasharray="${Math.max(len - gap, 0.1)} ${100 - Math.max(len - gap, 0.1)}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${C} ${C})" ${tip(`${p.label}: ${p.v}`)}/>`;
      acc += len;
      return el;
    }).join('');
    return `<div class="donut-box"><svg class="viz donut" viewBox="0 0 140 140" role="img" aria-label="${esc(centerBot)}: ${parts.map((p) => `${p.label} ${p.v}`).join(', ')}"><circle class="dn-track" cx="${C}" cy="${C}" r="${R}"/>${segs}</svg><div class="dn-center"><b>${centerTop}</b><span>${esc(centerBot)}</span></div></div>`;
  }

  let CW = 560; // usable chart width of the widget being drawn, set by frame()
  function hbars(rows, opts) {
    // rows: [{label, sub, segs:[{v, cls, label}], mark, tipHtml, href}]
    const W = Math.max(240, Math.min(1600, Math.round(CW))), LW = opts.labelW || 130, PR = 44, RH = opts.rowH || 34, BH = 10;
    const max = opts.max || Math.max(1, ...rows.map((r) => r.segs.reduce((s, x) => s + x.v, 0)));
    const pw = W - LW - PR;
    const H = rows.length * RH + 6;
    let g = '';
    rows.forEach((r, i) => {
      const y = i * RH + 4;
      let x = LW;
      const total = r.segs.reduce((s, p) => s + p.v, 0);
      g += `<g class="hb-row" ${r.href ? `data-go="${r.href}" style="cursor:pointer"` : ''} ${tip(r.tipHtml || '')}><rect class="hit" x="0" y="${y - 2}" width="${W}" height="${RH}"/>`;
      g += `<text class="lab" x="0" y="${y + 12}">${esc(trunc(r.label, 20))}</text>`;
      if (r.sub) g += `<text class="lab-sub" x="0" y="${y + 24}">${esc(r.sub)}</text>`;
      g += `<rect class="hb-track" x="${LW}" y="${y + 7}" width="${pw}" height="${BH}" rx="${BH / 2}"/>`;
      const live = r.segs.filter((p) => p.v > 0);
      live.forEach((p, k) => {
        const w = (p.v / max) * pw;
        const last = k === live.length - 1;
        g += `<rect class="hb-seg ${p.cls}" x="${x}" y="${y + 7}" width="${Math.max(w - (last ? 0 : 2), 1)}" height="${BH}" rx="${last ? 4 : 1}" style="--i:${k}"/>`;
        x += w;
      });
      if (r.mark != null) { const mx = LW + (r.mark / max) * pw; g += `<line class="hb-mark" x1="${mx}" x2="${mx}" y1="${y + 2}" y2="${y + 24}"/>`; }
      g += `<text class="val" x="${W}" y="${y + 17}" text-anchor="end">${esc(r.valueLabel != null ? r.valueLabel : String(total))}</text></g>`;
    });
    return `<svg class="viz hbars" style="max-width:${W}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">${g}</svg>`;
  }

  // ---------------- widgets ----------------
  const csvOf = (rows) => rows.map((r) => r.map((c) => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');

  const WIDGETS = {
    kpi: {
      size: 'l', title: 'w_kpi',
      render(body, d) {
        const A = d.analytics, P = A.projects;
        const avg = (k) => { const v = P.filter((p) => p[k] != null).map((p) => p[k]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
        const prog = avg('progress'), plan = avg('planned'), spi = avg('spi');
        const high = d.radar.counts.high, od = d.overdue.length;
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
        return { csv: () => [[t('metric'), t('value')], ...tiles.map((x) => [t(x.k), x.v])] };
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
          p.phases.forEach((ph, k) => {
            const x1 = x(dnum(ph.start)), x2 = x(dnum(ph.finish) + 1), w = Math.max(x2 - x1 - 2, 3);
            if (w > 54) g += `<text class="tl-ph" x="${x1}" y="${y0 + 16}">${esc(trunc(ph.name, Math.floor(w / 6.4)))}</text>`;
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
        body.innerHTML = `<svg class="viz timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('w_schedule'))}">${g}</svg>${legend([['tl-l-prog', t('g_l_prog')], ['tl-l-diamond paid', t('state_paid')], ['tl-l-diamond inv', t('state_invoiced')], ['tl-l-diamond pend', t('state_pending')], ['tl-l-diamond late', t('late')], ['tl-l-end', t('contract_end')]])}`;
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
        const rows = M.map((x) => ({ label: x.currency || '-', sub: money(Math.round(x.total), x.currency), segs: [{ v: x.paid / x.total, cls: 'ok' }, { v: x.invoiced / x.total, cls: 'c1' }, { v: x.pending / x.total, cls: 'idle' }, { v: x.late / x.total, cls: 'bad' }], valueLabel: Math.round((x.paid / x.total) * 100) + '%', tipHtml: `${t('state_paid')} ${money(x.paid, x.currency)}<br>${t('state_invoiced')} ${money(x.invoiced, x.currency)}<br>${t('state_pending')} ${money(x.pending, x.currency)}<br>${t('late')} ${money(x.late, x.currency)}` }));
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
        body.innerHTML = hbars(rows, { max: 100, aria: t('w_progress'), rowH: 40 }) + legend([['c1', t('progress')], ['mark', t('planned')]]);
        return { csv: () => [[t('project'), t('progress'), t('planned'), t('kpi_spi')], ...P.map((p) => [p.name, p.progress, p.planned ?? '', p.spi ?? ''])], chart: true };
      },
    },

    workload: {
      size: 'm', title: 'w_workload',
      render(body, d) {
        const Wk = d.analytics.workload;
        if (!Wk.length) { body.innerHTML = empty(); return { csv: () => [] }; }
        const rows = Wk.map((o) => ({ label: o.name, sub: t('tasks_n', { n: o.total }), segs: [{ v: o.done, cls: 'ok' }, { v: o.active, cls: 'c1' }, { v: o.todo, cls: 'idle' }, { v: o.late, cls: 'bad' }], tipHtml: `<b>${esc(o.name)}</b><br>${t('g_l_done')} ${o.done}<br>${t('g_l_prog')} ${o.active}<br>${t('g_l_todo')} ${o.todo}<br>${t('g_l_late')} ${o.late}` }));
        body.innerHTML = hbars(rows, { aria: t('w_workload'), rowH: 38 }) + legend([['ok', t('g_l_done')], ['c1', t('g_l_prog')], ['idle', t('g_l_todo')], ['bad', t('g_l_late')]]);
        return { csv: () => [[t('g_owner'), t('g_l_done'), t('g_l_prog'), t('g_l_todo'), t('g_l_late')], ...Wk.map((o) => [o.name, o.done, o.active, o.todo, o.late])], chart: true };
      },
    },

    portfolio: {
      size: 'l', title: 'portfolio',
      render(body, d) {
        if (!d.projects.length) { body.innerHTML = `<div class="empty"><div class="big">📁</div><p>${t('empty_projects')}</p><button class="btn primary" data-newproj>${icon('plus')}${t('new_project')}</button></div>`; return { csv: () => [] }; }
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
  const planned = (p) => (p.planned != null ? `· ${t('planned')} ${p.planned}%` : '');
  const DEFAULT_ORDER = ['kpi', 'radar', 'schedule', 'health', 'deliverables', 'payments', 'progress', 'workload', 'portfolio', 'payments_list', 'overdue', 'activity'];
  const SIZES = ['s', 'm', 'l'];

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

  // ---------------- export ----------------
  const demo = () => !!window.DEMO_SEED;
  function fileOut(name, blob, text) {
    if (demo()) {
      const m = PM.modal({ title: name, size: 'lg', body: `<p class="small muted" style="margin-top:0">${t('msp_demo_note')}</p><textarea readonly style="width:100%;height:260px;font-family:monospace;font-size:var(--fs-small)">${esc(text || '')}</textarea>`, footer: `<button class="btn primary" data-close>${t('close')}</button>` });
      return m;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(t('exported_ok'), 'ok');
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  function exportCsv(id, info, cfg) {
    const text = '﻿' + csvOf(info.csv());
    fileOut(`${slug(t(cfg.widgets[id].title))}.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }), text);
  }
  const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'opacity', 'fill-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'letter-spacing'];
  function exportPng(id, body, cfg) {
    const svg = $('svg.viz', body);
    if (!svg) return;
    if (demo()) { toast(t('png_demo_note')); return; }
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
      c.fillStyle = ink; c.font = '600 20px sans-serif'; c.fillText(t(cfg.widgets[id].title), pad, pad + 16);
      c.drawImage(img, pad, pad + head, w, h);
      cv.toBlob((b) => fileOut(`${slug(t(cfg.widgets[id].title))}.png`, b), 'image/png');
    };
    img.onerror = () => toast(t('err_download'), 'err');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
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
  const MAIN = { widgets: WIDGETS, order: DEFAULT_ORDER, key: null, currencyToggle: true, fetch: () => api('GET', '/api/dashboard') };
  function mount(host, d, cfg) {
    cfg = cfg || MAIN;
    const animate = (cfg.always || firstPaint) && !reduced();
    if (!cfg.always) firstPaint = false;
    let L = loadLayout(cfg);
    if (cfg.currencyToggle && !PM.fx.choices.includes(L.cur)) L.cur = 'USD';
    const modeNow = () => (cfg.currencyToggle ? L.cur : 'native');
    const infos = {};

    host.innerHTML = `<div class="dw-bar"><div class="dw-bar-l"><span class="muted small" id="dwCount"></span></div><div class="row" style="gap:8px">${cfg.currencyToggle ? `<div class="seg" id="dwCur" role="group" aria-label="${esc(t('fx_display'))}" title="${esc(t('fx_note', { r: PM.fx.rateNote('AED') + ', ' + PM.fx.rateNote('SAR') }))}">${PM.fx.choices.map((c) => `<button data-cur="${c}" aria-pressed="${c === L.cur}" class="${c === L.cur ? 'on' : ''}">${c}</button>`).join('')}</div>` : ''}<button class="btn sm ghost" id="dwReset" hidden>${t('dash_reset')}</button><button class="btn sm" id="dwCustom" aria-expanded="false">${icon('cols')}${t('dash_customize')}</button></div></div>
      <div class="dw-panel" id="dwPanel" aria-hidden="true"><div><div class="dw-panel-in" id="dwChips"></div></div></div>
      <div class="dw-grid ${animate ? 'anim' : ''}" id="dwGrid"></div>`;
    const grid = $('#dwGrid', host);

    const sizeOf = (id) => (SIZES.includes(L.size[id]) ? L.size[id] : cfg.widgets[id].size);
    const visible = () => L.order.filter((id) => !L.hidden.includes(id));

    // any widget with more than five rows shows five and a toggle for the rest
    const MAXR = 5, openRows = {};
    function limitRows(el, body, id) {
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
      body.appendChild(btn);
    }

    // widgets receive a context so an action inside one can refresh the others
    const ctx = {
      get data() { return d; },
      async reload() { d = await cfg.fetch(); refreshWidgets(); return d; },
      async reloadExcept(id) { d = await cfg.fetch(); refreshWidgets(id); return d; },
    };
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
      const w = cfg.widgets[id];
      const el = document.createElement('section');
      el.className = `dw sz-${sizeOf(id)}`; el.dataset.w = id; el.style.setProperty('--i', i);
      el.innerHTML = `<header class="dw-h"><button class="dw-grip" aria-label="${esc(t('dash_move'))}" title="${esc(t('dash_drag_hint'))}">${icon('grip')}</button><h3>${esc(t(w.title))}</h3><span class="grow"></span><button class="dw-more btn ghost icon" aria-haspopup="menu" aria-label="${esc(t('dash_widget_menu'))}">${icon('more')}</button></header><div class="dw-body"></div>`;
      const body = $('.dw-body', el);
      const span = { l: 12, m: 6, s: 4 }[sizeOf(id)] || 12, gw = grid.clientWidth || 1100, vw = innerWidth, cols = vw <= 860 ? 1 : vw <= 1180 && span === 4 ? 2 : 0;
      const sp = cols === 1 ? 12 : cols === 2 ? 6 : span;
      CW = (gw - 11 * 16) / 12 * sp + (sp - 1) * 16 - 38;
      PM.fx.mode = modeNow();
      infos[id] = w.render(body, d, ctx) || { csv: () => [] };
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
      $('#dwChips', host).innerHTML = L.order.map((id) => { const on = !L.hidden.includes(id); return `<button class="dw-chip ${on ? 'on' : ''}" data-toggle="${id}" aria-pressed="${on}">${icon(on ? 'eye' : 'eyeoff')}${esc(t(cfg.widgets[id].title))}</button>`; }).join('');
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
      menu.innerHTML = item('csv', t('dash_export_csv'), 'dl') + (info.chart ? item('png', t('dash_export_png'), 'img') : '') + '<hr>' +
        item('up', t('dash_move_earlier'), 'up', idx <= 0) + item('down', t('dash_move_later'), 'down', idx >= vis.length - 1) + '<hr>' +
        `<div class="dw-sizes" role="group" aria-label="${esc(t('dash_size'))}">${SIZES.map((s) => `<button data-size="${s}" class="${sizeOf(id) === s ? 'on' : ''}" aria-pressed="${sizeOf(id) === s}">${t('dash_size_' + s)}</button>`).join('')}</div><hr>` + item('hide', t('dash_hide'), 'eyeoff');
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
        else if (a.dataset.act === 'hide') { L.hidden.push(id); persist(); flip(() => { el.remove(); }); chips(); $('#dwCount', host).textContent = t('dash_hidden_n', { n: L.hidden.length }); $('#dwReset', host).hidden = false; }
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
    grid.addEventListener('click', (e) => {
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
      const place = (ev) => {
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList && n.classList.contains('dw') && n !== el);
        if (!under) return;
        const b = under.getBoundingClientRect();
        const sameRow = Math.abs(ev.clientY - (b.top + b.height / 2)) < b.height / 2 && Math.abs(b.top - ph.getBoundingClientRect().top) < 40;
        const before = sameRow ? ev.clientX < b.left + b.width / 2 : ev.clientY < b.top + b.height / 2;
        if (before ? under.previousElementSibling === ph : under.nextElementSibling === ph) return;
        flip(() => { if (before) grid.insertBefore(ph, under); else under.after(ph); });
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
        cancelAnimationFrame(raf);
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        const from = el.getBoundingClientRect();
        el.classList.remove('dragging'); el.style.cssText = '';
        ph.replaceWith(el);
        const to = el.getBoundingClientRect();
        if (!reduced()) el.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px)`, boxShadow: 'var(--shadow-lg)' }, { transform: 'none', boxShadow: 'var(--shadow)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
        const ids = $$('.dw', grid).map((n) => n.dataset.w);
        const hidden = L.order.filter((id) => L.hidden.includes(id));
        L.order = [...ids, ...hidden];
        persist(); chips(); $('#dwReset', host).hidden = false;
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

  PM.dash = { mount, h: { listRow, projLink, stamp, width: () => CW, tipAttr: tip, hbars, donut, legend, empty, tip, num, dnum, ymd, trunc, countUp, csvOf, reduced, WIDGETS } };
})();
