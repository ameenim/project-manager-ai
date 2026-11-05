/* Trends dashboards: the key figures and how they change over time.
   Everything here is drawn from the daily snapshots the server keeps (one row per project per day), through
   GET /api/trends for the whole portfolio and GET /api/projects/:id/trends for one project. A day with no snapshot
   stays empty, nothing is estimated, and a line never claims a value for a day nobody recorded. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, state: S } = PM;
  const H = () => PM.dash.h;

  Object.assign(PM.I18N.en, {
    nav_trends: 'Trends', tab_trends: 'Trends', tr_title: 'Trends', tr_period: 'Period',
    tr_days_7: '7 days', tr_days_30: '30 days', tr_days_90: '90 days', tr_days_365: '1 year',
    tr_note: 'Each day shows the last figures recorded that day. Days with no snapshot stay empty and nothing is estimated.',
    tr_start_h: 'Trends start today.', tr_start_p: 'A snapshot of your key figures is saved every day, so the charts fill in from tomorrow.',
    tr_none: 'No snapshots yet.', tr_not_tracked: 'Not enough data to draw this yet.',
    tr_nt_spi: 'SPI needs planned dates. Add task dates to see it.', tr_nt_slip: 'This needs a contract end date and a schedule.', tr_nt_pay: 'No payment milestones are recorded yet.',
    tr_since: 'since {date}', tr_week: 'vs 7 days ago', tr_same: 'No change', tr_no_prev: 'No earlier day recorded yet.', tr_no_week: 'The comparison with a week ago appears after 7 days of history.',
    tr_up: 'Up {n}', tr_down: 'Down {n}', tr_to_review: 'To review', tr_at_risk: 'Projects at risk', tr_of_projects: 'of {n} projects', tr_slip: 'Days past contract end', tr_on_time: 'On time',
    tw_kpi: 'Key figures and change', tw_progress: 'Progress and plan', tw_spi: 'Schedule performance (SPI)', tw_overdue: 'Overdue tasks over time', tw_risk: 'High risks and items to review',
    tw_health: 'Health mix', tw_health_p: 'Health history', tw_slip: 'Forecast drift', tw_slip_p: 'Forecast end against contract end', tw_pay: 'Payments over time', tw_proj: 'What changed by project', tw_snap: 'Daily snapshot',
    tr_takeaway: '{label} went from {from} on {fromDate} to {to} on {toDate}.', tr_flat: '{label} stayed at {v} since {fromDate}.',
    tr_building: 'Only one day is recorded so far. The line appears from the second day.',
    tr_gap_legend: 'Days without a snapshot', tr_projects_n: '{n} projects', tr_healthy: 'Healthy from 0.95',
    tr_proj_note: 'Change compared with the latest snapshot at least 7 days old. A dash means there is none yet.', tr_no_snap: 'No snapshot yet', tr_col_projects: 'Projects',
    tr_slip_total: 'Total days past contract end', tr_behind_n: '{n} projects behind', tr_health_counts: 'Green {g}, amber {a}, red {r}', tr_open_proj: 'Open the project trends', tr_latest: 'Latest',
  });
  Object.assign(PM.I18N.ar, {
    nav_trends: 'الاتجاهات', tab_trends: 'الاتجاهات', tr_title: 'الاتجاهات', tr_period: 'الفترة',
    tr_days_7: '7 أيام', tr_days_30: '30 يوما', tr_days_90: '90 يوما', tr_days_365: 'سنة',
    tr_note: 'يعرض كل يوم آخر الأرقام المسجلة في ذلك اليوم. الأيام التي لا توجد لها لقطة تبقى فارغة ولا يتم تقدير أي شيء.',
    tr_start_h: 'تبدأ الاتجاهات اليوم.', tr_start_p: 'تحفظ لقطة من أرقامك الرئيسية كل يوم، لذلك تمتلئ المخططات ابتداء من الغد.',
    tr_none: 'لا توجد لقطات بعد.', tr_not_tracked: 'لا توجد بيانات كافية لرسم هذا بعد.',
    tr_nt_spi: 'يحتاج مؤشر الأداء إلى تواريخ مخططة. أضف تواريخ المهام لعرضه.', tr_nt_slip: 'يحتاج هذا إلى تاريخ نهاية العقد وجدول زمني.', tr_nt_pay: 'لا توجد دفعات مسجلة بعد.',
    tr_since: 'منذ {date}', tr_week: 'مقارنة بـ 7 أيام', tr_same: 'لا تغيير', tr_no_prev: 'لا يوجد يوم سابق مسجل بعد.', tr_no_week: 'تظهر المقارنة مع الأسبوع الماضي بعد 7 أيام من السجل.',
    tr_up: 'ارتفاع {n}', tr_down: 'انخفاض {n}', tr_to_review: 'بانتظار المراجعة', tr_at_risk: 'مشاريع في خطر', tr_of_projects: 'من {n} مشروع', tr_slip: 'أيام التأخر عن نهاية العقد', tr_on_time: 'في الموعد',
    tw_kpi: 'الأرقام الرئيسية والتغير', tw_progress: 'التقدم والخطة', tw_spi: 'أداء الجدول الزمني (SPI)', tw_overdue: 'المهام المتأخرة عبر الزمن', tw_risk: 'المخاطر العالية وعناصر المراجعة',
    tw_health: 'توزيع الصحة', tw_health_p: 'سجل الصحة', tw_slip: 'انحراف التوقعات', tw_slip_p: 'نهاية التوقعات مقابل نهاية العقد', tw_pay: 'الدفعات عبر الزمن', tw_proj: 'ما تغير في كل مشروع', tw_snap: 'اللقطة اليومية',
    tr_takeaway: '{label} انتقل من {from} في {fromDate} إلى {to} في {toDate}.', tr_flat: '{label} بقي عند {v} منذ {fromDate}.',
    tr_building: 'سجل يوم واحد فقط حتى الآن. يظهر الخط ابتداء من اليوم الثاني.',
    tr_gap_legend: 'أيام بلا لقطة', tr_projects_n: '{n} مشاريع', tr_healthy: 'سليم ابتداء من 0.95',
    tr_proj_note: 'التغير مقارنة بآخر لقطة عمرها 7 أيام على الأقل. تعني الشرطة أنه لا توجد لقطة بعد.', tr_no_snap: 'لا توجد لقطة بعد', tr_col_projects: 'المشاريع',
    tr_slip_total: 'مجموع أيام التأخر عن نهاية العقد', tr_behind_n: '{n} مشاريع متأخرة', tr_health_counts: 'أخضر {g}، أصفر {a}، أحمر {r}', tr_open_proj: 'افتح اتجاهات المشروع', tr_latest: 'الأحدث',
  });

  // ---------------- small helpers ----------------
  const DAY = 864e5;
  const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const loc = () => (S.lang === 'ar' ? 'ar-AE' : 'en-US');
  const dayShort = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString(loc(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dayLong = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString(loc(), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const nf = (v, o) => Number(v).toLocaleString(loc(), { maximumFractionDigits: 0, ...(o || {}) });
  const num = (v) => v != null && Number.isFinite(v);
  const W = () => Math.max(300, Math.min(1600, Math.round(H().width())));
  const nice = (max) => { const p = Math.pow(10, Math.floor(Math.log10(max || 1))); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const short = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)));
  const pct = (v) => (num(v) ? Math.round(v) + '%' : '-');
  const spiText = (v) => (num(v) ? Number(v).toFixed(2) : '-');
  const signed = (v) => (v > 0 ? '+' : '') + nf(v);
  const csvDate = (v) => (v == null ? '' : v);

  // Money in the display currency. The portfolio converts with the same indicative rates as the overview dashboard
  // (each currency is converted first and the results are added, then rounded once for display). A project shows
  // its own currency.
  const mode = () => PM.fx.mode;
  const moneyOf = (r, k) => {
    const e = Object.entries(r.money || {});
    if (!e.length) return null;
    return e.reduce((a, [c, m]) => a + (mode() === 'native' ? Number(m[k]) || 0 : PM.fx.convert(Number(m[k]) || 0, c, mode())), 0);
  };
  const moneyText = (d) => (v) => PM.money(Math.round(v), mode() === 'native' ? (d.projects[0] && d.projects[0].currency) || '' : mode());

  // ---------------- charts ----------------
  // One line chart for every trend. spec.series: [{ get, cls, label, fmt }], spec.min and spec.max, spec.ref, spec.tick.
  // Points sit at their real date. A line only joins two points that are one day apart. Across missing days it turns
  // dashed so the gap is visible and not passed off as data.
  function line(body, d, spec) {
    const h = H(), rows = d.series, n = rows.length;
    if (!n) { body.innerHTML = h.empty(t('tr_none')); return { csv: () => [] }; }
    const defs = spec.series;
    const all = defs.flatMap((s) => rows.map((r) => s.get(r))).filter(num);
    if (!all.length) { body.innerHTML = h.empty(spec.empty || t('tr_not_tracked')); return { csv: () => [] }; }
    const Wd = W(), Ht = 220, L = 44, R = 16, T = 14, B = 28, pw = Wd - L - R, ph = Ht - T - B;
    const lo = spec.min != null ? Math.min(spec.min, ...all) : Math.min(0, ...all);
    let hi = spec.max != null ? Math.max(spec.max, ...all) : nice(Math.max(1, ...all));
    if (hi <= lo) hi = lo + 1;
    const d0 = dnum(rows[0].date), d1 = dnum(rows[n - 1].date), span = Math.max(d1 - d0, 1);
    const x = (date) => (n === 1 ? L + pw / 2 : L + ((dnum(date) - d0) / span) * pw);
    const y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;
    const tick = spec.tick || ((v) => nf(v));
    let g = [lo, (lo + hi) / 2, hi].map((v) => `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(tick(v))}</text>`).join('');
    const ticks = Math.min(4, Math.max(1, Math.floor(pw / 90)));
    for (let i = 0; i <= ticks && n > 1; i++) { const day = Math.round(d0 + (span * i) / ticks); g += `<text x="${(L + (pw * i) / ticks).toFixed(1)}" y="${Ht - 8}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${esc(dayShort(h.ymd(day)))}</text>`; }
    if (n === 1) g += `<text x="${L + pw / 2}" y="${Ht - 8}" text-anchor="middle">${esc(dayShort(rows[0].date))}</text>`;
    if (spec.ref && spec.ref.v >= lo && spec.ref.v <= hi) g += `<line class="tr-ref" x1="${L}" x2="${L + pw}" y1="${y(spec.ref.v).toFixed(1)}" y2="${y(spec.ref.v).toFixed(1)}"/><text class="tr-ref-lab" direction="ltr" x="${L + 4}" y="${(y(spec.ref.v) - 4).toFixed(1)}" text-anchor="start">${esc(spec.ref.label)}</text>`;
    let gaps = false;
    for (const s of defs) {
      const pts = rows.filter((r) => num(s.get(r))).map((r) => ({ r, px: x(r.date), py: y(s.get(r)) }));
      let solid = '', dashed = '', run = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[i - 1];
        if (!q) { solid += `M${p.px.toFixed(1)} ${p.py.toFixed(1)}`; run = true; continue; }
        if (dnum(p.r.date) - dnum(q.r.date) <= 1) { solid += `${run ? 'L' : `M${q.px.toFixed(1)} ${q.py.toFixed(1)}L`}${p.px.toFixed(1)} ${p.py.toFixed(1)}`; run = true; }
        else { dashed += `M${q.px.toFixed(1)} ${q.py.toFixed(1)}L${p.px.toFixed(1)} ${p.py.toFixed(1)}`; solid += `M${p.px.toFixed(1)} ${p.py.toFixed(1)}`; run = true; gaps = true; }
      }
      if (solid) g += `<path class="tr-line ${s.cls}" d="${solid}"/>`;
      if (dashed) g += `<path class="tr-line gap ${s.cls}" d="${dashed}"/>`;
      const showAll = pts.length <= 31;
      pts.forEach((p, i) => { if (showAll || i === pts.length - 1) g += `<circle class="tr-dot ${s.cls}" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="${showAll ? 4 : 5}"/>`; });
    }
    const hw = Math.max(14, Math.min(40, pw / Math.max(1, span + 1)));
    for (const r of rows) {
      const tip = `<b>${esc(dayLong(r.date))}</b><br>${defs.filter((s) => num(s.get(r))).map((s) => `${esc(s.label)}: ${esc((s.fmt || nf)(s.get(r)))}`).join('<br>')}${spec.extra ? '<br>' + spec.extra(r) : ''}<br><span class="muted">${esc(t('tr_projects_n', { n: r.n }))}</span>`;
      g += `<rect class="tr-hit" x="${(x(r.date) - hw / 2).toFixed(1)}" y="${T}" width="${hw.toFixed(1)}" height="${ph}" ${h.tipAttr(tip)}/>`;
    }
    const first = defs[0], pv = rows.filter((r) => num(first.get(r)));
    const fmt0 = first.fmt || nf;
    let take = '';
    if (pv.length > 1) { const a = pv[0], b = pv[pv.length - 1]; take = fmt0(first.get(a)) === fmt0(first.get(b)) ? t('tr_flat', { label: first.label, v: fmt0(first.get(b)), fromDate: dayShort(a.date) }) : t('tr_takeaway', { label: first.label, from: fmt0(first.get(a)), fromDate: dayShort(a.date), to: fmt0(first.get(b)), toDate: dayShort(b.date) }); }
    else take = t('tr_building');
    const last = rows[n - 1];
    const legend = defs.map((s) => [`line ${s.cls}`, s.label, num(s.get(last)) ? esc((s.fmt || nf)(s.get(last))) : null]);
    if (gaps) legend.push(['line dash', t('tr_gap_legend')]);
    body.innerHTML = `<svg class="viz tr-chart" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(spec.aria + '. ' + take)}">${g}</svg>${h.legend(legend)}<div class="small muted mt">${esc(take)}</div>`;
    return { csv: () => [[t('date'), ...defs.map((s) => s.label)], ...rows.map((r) => [r.date, ...defs.map((s) => (num(s.get(r)) ? s.get(r) : ''))])], chart: true };
  }

  // Stacked columns, one per recorded day, green then amber then red. The columns sit at their real dates.
  function healthCols(body, d, scope) {
    const h = H(), rows = d.series, n = rows.length;
    if (!n) { body.innerHTML = h.empty(t('tr_none')); return { csv: () => [] }; }
    const Wd = W(), Ht = 220, L = 34, R = 12, T = 14, B = 28, pw = Wd - L - R, ph = Ht - T - B;
    const top = Math.max(1, ...rows.map((r) => r.n)), y = (v) => T + ph - (v / top) * ph;
    const d0 = dnum(rows[0].date), d1 = dnum(rows[n - 1].date), span = Math.max(d1 - d0, 0);
    const slot = pw / (span + 1), bw = Math.min(28, Math.max(3, slot * 0.7));
    const cx = (date) => L + (dnum(date) - d0) * slot + slot / 2;
    let g = (top > 1 ? [0, top] : [0, 1]).map((v) => `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('');
    const ticks = Math.min(4, Math.max(1, Math.floor(pw / 90)));
    for (let i = 0; i <= ticks && span > 0; i++) { const day = Math.round(d0 + (span * i) / ticks); g += `<text x="${(L + slot / 2 + (slot * span * i) / ticks).toFixed(1)}" y="${Ht - 8}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${esc(dayShort(h.ymd(day)))}</text>`; }
    if (span === 0) g += `<text x="${cx(rows[0].date).toFixed(1)}" y="${Ht - 8}" text-anchor="middle">${esc(dayShort(rows[0].date))}</text>`;
    for (const r of rows) {
      let acc = 0;
      const segs = [['ok', r.green], ['warn', r.amber], ['bad', r.red]].filter((s) => s[1] > 0);
      const tip = `<b>${esc(dayLong(r.date))}</b><br>${esc(t('tr_health_counts', { g: r.green, a: r.amber, r: r.red }))}<br><span class="muted">${esc(t('tr_projects_n', { n: r.n }))}</span>`;
      g += `<g class="cb" ${h.tipAttr(tip)}><rect class="hit" x="${(cx(r.date) - Math.max(bw, 12) / 2).toFixed(1)}" y="${T}" width="${Math.max(bw, 12)}" height="${ph}"/>`;
      segs.forEach(([c, v], k) => { const y1 = y(acc + v), y0 = y(acc); acc += v; g += `<rect class="hb-seg ${c}" x="${(cx(r.date) - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(y0 - y1 - (k < segs.length - 1 ? 2 : 0), 1).toFixed(1)}" rx="${k === segs.length - 1 ? 3 : 1}"/>`; });
      g += '</g>';
    }
    const last = rows[n - 1];
    const take = t('tr_health_counts', { g: last.green, a: last.amber, r: last.red });
    body.innerHTML = `<svg class="viz tr-chart" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(t(scope === 'project' ? 'tw_health_p' : 'tw_health') + '. ' + take)}">${g}</svg>${h.legend([['ok', t('health_green'), last.green], ['warn', t('health_amber'), last.amber], ['bad', t('health_red'), last.red]])}<div class="small muted mt">${esc(dayShort(last.date))}: ${esc(take)}</div>`;
    return { csv: () => [[t('date'), t('health_green'), t('health_amber'), t('health_red'), t('tr_col_projects')], ...rows.map((r) => [r.date, r.green, r.amber, r.red, r.n])], chart: true };
  }

  // ---------------- change figures ----------------
  // Which direction is good for each tile: more progress is good, more overdue work is not.
  function change(cur, ref, goodUp, digits) {
    if (!num(cur) || !ref || !num(ref.v)) return null;
    const f = Math.pow(10, digits || 0), diff = Math.round((cur - ref.v) * f) / f;
    if (diff === 0) return { diff, text: t('tr_same'), cls: '', sentence: `${t('tr_same')} ${t('tr_since', { date: dayShort(ref.date) })}` };
    const up = diff > 0, amount = Math.abs(diff).toLocaleString(loc(), { maximumFractionDigits: digits || 0 });
    const cls = (up && goodUp) || (!up && !goodUp) ? 'good' : 'bad';
    return { diff, cls, text: `${up ? '▲' : '▼'} ${amount}`, sentence: `${t(up ? 'tr_up' : 'tr_down', { n: amount })} ${t('tr_since', { date: dayShort(ref.date) })}` };
  }
  function tileList(d, scope) {
    const L = d.latest;
    const spiTone = (v) => (!num(v) ? '' : v >= 0.95 ? 'good' : v >= 0.8 ? 'warn' : 'bad');
    const tiles = [
      { k: 'kpi_progress', get: (r) => r.progress, f: pct, up: true, digits: 0, sub: num(L.planned) ? `${t('planned')} ${pct(L.planned)}` : t('no_baseline'), tone: num(L.progress) && num(L.planned) ? (L.progress + 5 >= L.planned ? 'good' : L.progress + 15 >= L.planned ? 'warn' : 'bad') : '' },
      { k: 'kpi_spi', get: (r) => r.spi, f: spiText, up: true, digits: 2, sub: t('kpi_spi_hint'), tone: spiTone(L.spi) },
      { k: 'kpi_overdue', get: (r) => r.overdue, f: (v) => nf(v), up: false, digits: 0, sub: t('tasks_n', { n: L.tasks }), tone: L.overdue ? 'bad' : 'good' },
      { k: 'kpi_high_risks', get: (r) => r.high_risks, f: (v) => nf(v), up: false, digits: 0, sub: '', tone: L.high_risks ? 'bad' : 'good' },
      { k: 'tr_to_review', get: (r) => r.pending_review, f: (v) => nf(v), up: false, digits: 0, sub: '', tone: '' },
    ];
    if (scope === 'portfolio') tiles.push({ k: 'tr_at_risk', get: (r) => r.amber + r.red, f: (v) => nf(v), up: false, digits: 0, sub: t('tr_of_projects', { n: L.n }), tone: L.red ? 'bad' : L.amber ? 'warn' : 'good' });
    else tiles.push({ k: 'tr_slip', get: (r) => r.slip_days, f: (v) => (num(v) ? signed(v) : '-'), up: false, digits: 0, sub: num(L.slip_days) ? (L.slip_days > 0 ? t('forecast_end') + ' ' + (L.forecast_end || '') : t('tr_on_time')) : t('tr_nt_slip'), tone: num(L.slip_days) ? (L.slip_days > 0 ? 'bad' : 'good') : '' });
    return tiles;
  }

  // ---------------- widgets ----------------
  const widgets = (scope) => {
    const P = scope === 'portfolio';
    return {
      tkpi: {
        size: 'l', title: 'tw_kpi',
        render(body, d) {
          if (!d.latest) { body.innerHTML = H().empty(t('tr_none')); return { csv: () => [] }; }
          const tiles = tileList(d, scope), L = d.latest;
          const rows = tiles.map((x, i) => {
            const v = x.get(L);
            const prev = d.prev && num(x.get(d.prev)) ? { v: x.get(d.prev), date: d.prev.date } : null;
            const week = d.week && num(x.get(d.week)) ? { v: x.get(d.week), date: d.week.date } : null;
            const c1 = change(v, prev, x.up, x.digits), c2 = change(v, week, x.up, x.digits);
            return { x, v, c1, c2, i };
          });
          body.innerHTML = `<div class="kpis">${rows.map(({ x, v, c1, c2, i }) => `<div class="kpi-t ${x.tone}" style="--i:${i}"><div class="kv">${esc(x.f(v))}</div><div class="kl">${esc(t(x.k))}</div>${x.sub ? `<div class="ks">${esc(x.sub)}</div>` : ''}${c1 ? `<div class="kd ${c1.cls}" ${H().tipAttr(c1.sentence)} aria-label="${esc(c1.sentence)}">${esc(c1.text)} <span class="muted">${esc(t('tr_since', { date: dayShort(d.prev.date) }))}</span></div>` : `<div class="kd muted">${esc(t('tr_no_prev'))}</div>`}${c2 ? `<div class="kd ${c2.cls}" ${H().tipAttr(c2.sentence)} aria-label="${esc(c2.sentence)}">${esc(c2.text)} <span class="muted">${esc(t('tr_week'))}</span></div>` : ''}</div>`).join('')}</div>${d.week ? '' : `<div class="small muted mt">${esc(t('tr_no_week'))}</div>`}`;
          return { csv: () => [[t('metric'), t('value'), t('tr_since', { date: d.prev ? d.prev.date : '' }), t('tr_week')], ...rows.map(({ x, v, c1, c2 }) => [t(x.k), x.f(v), c1 ? c1.diff : '', c2 ? c2.diff : ''])] };
        },
      },
      tprog: {
        size: 'm', title: 'tw_progress',
        render: (body, d) => line(body, d, { aria: t('tw_progress'), min: 0, max: 100, tick: (v) => Math.round(v) + '%', series: [{ get: (r) => r.progress, cls: 'ok', label: t('progress'), fmt: pct }, { get: (r) => r.planned, cls: 'c1', label: t('planned'), fmt: pct }] }),
      },
      tspi: {
        size: 'm', title: 'tw_spi',
        render: (body, d) => line(body, d, { aria: t('tw_spi'), min: 0, max: 1.2, empty: t('tr_nt_spi'), tick: (v) => v.toFixed(1), ref: { v: 0.95, label: t('tr_healthy') }, series: [{ get: (r) => r.spi, cls: 'c1', label: t('kpi_spi'), fmt: spiText }] }),
      },
      toverdue: {
        size: 'm', title: 'tw_overdue',
        render: (body, d) => line(body, d, { aria: t('tw_overdue'), series: [{ get: (r) => r.overdue, cls: 'bad', label: t('kpi_overdue') }] }),
      },
      trisk: {
        size: 'm', title: 'tw_risk',
        render: (body, d) => line(body, d, { aria: t('tw_risk'), series: [{ get: (r) => r.high_risks, cls: 'bad', label: t('kpi_high_risks') }, { get: (r) => r.pending_review, cls: 'c2', label: t('tr_to_review') }] }),
      },
      thealth: {
        size: 'm', title: P ? 'tw_health' : 'tw_health_p',
        render: (body, d) => healthCols(body, d, scope),
      },
      tslip: {
        size: 'm', title: P ? 'tw_slip' : 'tw_slip_p',
        render: (body, d) => line(body, d, P
          ? { aria: t('tw_slip'), empty: t('tr_nt_slip'), series: [{ get: (r) => (r.slip_n ? r.slip_total : null), cls: 'bad', label: t('tr_slip_total') }], extra: (r) => esc(t('tr_behind_n', { n: r.behind })) }
          : { aria: t('tw_slip_p'), empty: t('tr_nt_slip'), ref: { v: 0, label: t('tr_on_time') }, tick: (v) => signed(v), series: [{ get: (r) => r.slip_days, cls: 'bad', label: t('tr_slip'), fmt: signed }] }),
      },
      tpay: {
        size: 'm', title: 'tw_pay',
        render(body, d) {
          const fmt = moneyText(d);
          const info = line(body, d, { aria: t('tw_pay'), empty: t('tr_nt_pay'), tick: short, series: [{ get: (r) => moneyOf(r, 'paid'), cls: 'ok', label: t('state_paid'), fmt }, { get: (r) => moneyOf(r, 'late'), cls: 'bad', label: t('late'), fmt }] });
          if (d.series.length && PM.fx.mode !== 'native') body.insertAdjacentHTML('beforeend', `<div class="small muted">${esc(t('fx_converted', { cur: PM.fx.mode }))}</div>`);
          return info;
        },
      },
      ...(P ? {
        tproj: {
          size: 'l', title: 'tw_proj',
          render(body, d) {
            const h = H(), list = d.changes;
            if (!list.length) { body.innerHTML = h.empty(t('tr_none')); return { csv: () => [] }; }
            const cell = (now, then, f, goodUp) => {
              if (!now || !num(now)) return '<span class="muted">-</span>';
              const c = then ? change(now, { v: then.v, date: then.date }, goodUp, 0) : null;
              return `${esc(f(now))} ${c ? `<span class="small kd ${c.cls}" ${h.tipAttr(c.sentence)}>${esc(c.text)}</span>` : `<span class="small muted" ${h.tipAttr(t('tr_no_snap'))}>-</span>`}`;
            };
            const rows = list.map((c) => {
              const n = c.now, th = c.then;
              if (!n) return `<tr><td><div style="font-weight:600">${esc(c.name)}</div></td><td colspan="5" class="muted small">${esc(t('tr_no_snap'))}</td></tr>`;
              const was = th && th.health !== n.health ? `<div class="small muted">${esc(t('health_' + th.health))} ${esc(t('tr_since', { date: dayShort(th.date) }))}</div>` : '';
              const pr = (k) => (th ? { v: th[k], date: th.date } : null);
              return `<tr style="cursor:pointer" data-go="#/p/${c.id}/trends" ${h.tipAttr(t('tr_open_proj'))}><td><div style="font-weight:600">${esc(c.name)}</div></td><td>${PM.healthChip(n.health)}${was}</td><td class="nowrap">${cell(n.progress, th && pr('progress'), pct, true)}</td><td class="nowrap">${cell(n.overdue, th && pr('overdue'), (v) => nf(v), false)}</td><td class="nowrap">${cell(n.high_risks, th && pr('high_risks'), (v) => nf(v), false)}</td><td class="nowrap">${num(n.slip_days) ? esc(n.slip_days > 0 ? signed(n.slip_days) : t('tr_on_time')) : '<span class="muted">-</span>'}</td></tr>`;
            }).join('');
            body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>${t('project')}</th><th>${t('health')}</th><th>${t('progress')}</th><th>${t('overdue')}</th><th>${t('kpi_high_risks')}</th><th>${t('tr_slip')}</th></tr></thead><tbody>${rows}</tbody></table></div><div class="small muted mt">${esc(t('tr_proj_note'))}</div>`;
            return { csv: () => [[t('project'), t('date'), t('health'), t('progress'), t('overdue'), t('kpi_high_risks'), t('tr_slip'), t('tr_week') + ' ' + t('date'), t('health') + ' ' + t('tr_week'), t('progress') + ' ' + t('tr_week'), t('overdue') + ' ' + t('tr_week'), t('kpi_high_risks') + ' ' + t('tr_week')], ...list.map((c) => [c.name, c.now ? c.now.date : '', c.now ? c.now.health : '', c.now ? c.now.progress : '', c.now ? c.now.overdue : '', c.now ? c.now.high_risks : '', c.now && c.now.slip_days != null ? c.now.slip_days : '', c.then ? c.then.date : '', c.then ? c.then.health : '', c.then ? csvDate(c.then.progress) : '', c.then ? c.then.overdue : '', c.then ? c.then.high_risks : ''])] };
          },
        },
      } : {}),
      tsnap: {
        size: 'l', title: 'tw_snap',
        render(body, d) {
          const h = H(), rows = d.series.slice().reverse();
          if (!rows.length) { body.innerHTML = h.empty(t('tr_none')); return { csv: () => [] }; }
          const health = (r) => (P ? `<span ${h.tipAttr(t('tr_health_counts', { g: r.green, a: r.amber, r: r.red }))}>${r.green}/${r.amber}/${r.red}</span>` : PM.healthChip(r.red ? 'red' : r.amber ? 'amber' : 'green'));
          const trs = rows.map((r) => `<tr><td class="nowrap">${esc(dayLong(r.date))}</td>${P ? `<td>${r.n}</td>` : ''}<td>${esc(pct(r.progress))}</td><td>${esc(pct(r.planned))}</td><td>${esc(spiText(r.spi))}</td><td>${r.overdue ? `<span class="chip red">${r.overdue}</span>` : '<span class="muted">0</span>'}</td><td>${r.high_risks}</td><td>${r.pending_review}</td><td class="nowrap">${health(r)}</td></tr>`).join('');
          body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>${t('date')}</th>${P ? `<th>${t('tr_col_projects')}</th>` : ''}<th>${t('progress')}</th><th>${t('planned')}</th><th>${t('kpi_spi')}</th><th>${t('overdue')}</th><th>${t('kpi_high_risks')}</th><th>${t('tr_to_review')}</th><th>${t('health')}${P ? ' ' + t('tr_health_counts', { g: '', a: '', r: '' }).replace(/[^\p{L}\s,/]/gu, '').trim() : ''}</th></tr></thead><tbody>${trs}</tbody></table></div>`;
          const cur = [...new Set(d.series.flatMap((r) => Object.keys(r.money || {})))].filter(Boolean);
          const moneyCols = cur.flatMap((c) => ['paid', 'invoiced', 'pending', 'late'].map((k) => `${t(k === 'late' ? 'late' : 'state_' + k)} ${c}`));
          return { csv: () => [[t('date'), t('tr_col_projects'), t('progress'), t('planned'), t('kpi_spi'), t('overdue'), t('kpi_high_risks'), t('tr_to_review'), t('health_green'), t('health_amber'), t('health_red'), t('deliverables') + ' ' + t('state_open'), t('deliverables') + ' ' + t('state_closed'), t('tr_slip_total'), ...moneyCols],
            ...d.series.map((r) => [r.date, r.n, r.progress ?? '', r.planned ?? '', r.spi ?? '', r.overdue, r.high_risks, r.pending_review, r.green, r.amber, r.red, r.deliv_open, r.deliv_closed, r.slip_n ? r.slip_total : '', ...cur.flatMap((c) => ['paid', 'invoiced', 'pending', 'late'].map((k) => (r.money && r.money[c] ? r.money[c][k] : '')))])] };
        },
      },
    };
  };
  const ORDER = { portfolio: ['tkpi', 'tprog', 'tspi', 'toverdue', 'trisk', 'thealth', 'tslip', 'tpay', 'tproj', 'tsnap'], project: ['tkpi', 'tprog', 'tspi', 'toverdue', 'trisk', 'thealth', 'tslip', 'tpay', 'tsnap'] };

  // The same widgets, offered on the two overview pages. Those pages already load a 30 day trend with their data
  // (d.trends), so a widget only needs to hand its own slice to the render function above.
  const wrapped = (scope) => {
    const set = widgets(scope), out = {};
    for (const id of ORDER[scope]) out['tr_' + id] = { size: set[id].size, title: set[id].title, render: (body, d, ctx) => (d.trends ? set[id].render(body, d.trends, ctx) : (body.innerHTML = H().empty(t('tr_none')), { csv: () => [] })) };
    return out;
  };
  PM.trends = { wrapped, ids: (scope) => ORDER[scope].map((id) => 'tr_' + id) };
  Object.assign(PM.dash.h.WIDGETS, wrapped('portfolio'));
  PM.dash.main.order.push(...PM.trends.ids('portfolio'));

  // ---------------- screens ----------------
  const PERIODS = [7, 30, 90, 365];
  const getDays = () => { let v = 30; try { v = Number(sessionStorage.getItem('tr_days')) || 30; } catch (e) { /* storage may be blocked */ } return PERIODS.includes(v) ? v : 30; };
  const setDays = (v) => { try { sessionStorage.setItem('tr_days', String(v)); } catch (e) { /* ignore */ } };
  const periodSeg = (days) => `<div class="seg" role="radiogroup" aria-label="${esc(t('tr_period'))}">${PERIODS.map((v) => `<button type="button" role="radio" aria-checked="${v === days}" class="${v === days ? 'on' : ''}" data-days="${v}">${esc(t('tr_days_' + v))}</button>`).join('')}</div>`;

  // Draws the dashboard into root. root holds .tr-note, .tr-host and the period buttons.
  async function paint(root, o, first) {
    const host = $('.tr-host', root), note = $('.tr-note', root);
    $$('[data-days]', root).forEach((b) => { b.disabled = true; });
    let d;
    try { d = await api('GET', `${o.url}?days=${o.days}`); } catch (e) { if (!PM.stale(o.token)) host.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    if (PM.stale(o.token) || !host.isConnected) return;
    $$('[data-days]', root).forEach((b) => { b.disabled = false; const on = Number(b.dataset.days) === o.days; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    note.innerHTML = d.series.length < 2 && d.latest ? `<div class="banner mb">${icon('spark')}<div class="grow"><b>${esc(t('tr_start_h'))}</b> ${esc(t('tr_start_p'))}</div></div>` : '';
    const set = widgets(o.scope);
    PM.dash.mount(host, d, { widgets: set, order: ORDER[o.scope], key: o.scope === 'portfolio' ? 'trends' : 'ptrends', always: !!first, currencyToggle: o.scope === 'portfolio', fetch: () => api('GET', `${o.url}?days=${o.days}`) });
  }
  function wire(root, o) {
    const seg = $('[role=radiogroup]', root);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-days]'); if (!b || b.disabled) return;
      const v = Number(b.dataset.days); if (v === o.days) return;
      o.days = v; setDays(v); paint(root, o, false);
    });
  }

  PM.views.trends = async function () {
    PM.shell('trends', `<div class="page"><div class="empty"><span class="spinner"></span></div></div>`);
    const token = S.nav;
    await PM.loadProjects();
    if (PM.stale(token)) return;
    PM.shell('trends', `<div class="page"><div class="page-head"><h1>${esc(t('tr_title'))}</h1>${periodSeg(getDays())}</div><div class="small muted mb">${esc(t('tr_note'))}</div><div class="tr-note"></div><div class="tr-host"><div class="empty"><span class="spinner"></span></div></div></div>`);
    const root = $('#content'), o = { url: '/api/trends', scope: 'portfolio', days: getDays(), token };
    wire(root, o);
    await paint(root, o, true);
  };

  // The Trends tab of one project. It also opens in the side panel.
  PM.views.tab_trends = async function (root, p, q, token) {
    root.innerHTML = `<div class="page"><div class="qa-bar"><span class="qa-lab">${icon('trend')}${esc(t('tr_period'))}</span>${periodSeg(getDays())}</div><div class="small muted mb">${esc(t('tr_note'))}</div><div class="tr-note"></div><div class="tr-host"><div class="empty"><span class="spinner"></span></div></div></div>`;
    const o = { url: `/api/projects/${p.id}/trends`, scope: 'project', days: getDays(), token };
    wire(root, o);
    await paint(root, o, true);
  };
})();
