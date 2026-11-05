/* Chart and KPI data for generated documents.
   It is computed once when a document is created, from the same context the text is written from,
   so the figures in the charts always match the figures in the text. The result is plain JSON. */
(function () {
  'use strict';
  const LEVEL = { low: 1, medium: 2, high: 3 };
  const lvl = (s) => LEVEL[String(s || 'medium').toLowerCase()] || 2;
  const band = (p, i) => { const s = p * i; return s >= 6 ? 'High' : s >= 3 ? 'Medium' : 'Low'; };
  const BAND_TONE = { High: 'bad', Medium: 'warn', Low: 'ok' };
  const DAY = 86400000;
  const dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY;

  // 2450000 becomes 2.45M so a figure always fits inside a tile
  function compact(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}K`;
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // With descend, a schedule that has one project root task shows the phases below that root.
  function phasesOf(ctx, descend) {
    const tasks = ctx.tasks || [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const roots = tasks.filter((t) => !t.parent_id || !byId.has(t.parent_id));
    const summaryRoots = roots.filter((t) => t.summary);
    let base = summaryRoots.length ? summaryRoots : roots;
    if (descend && base.length === 1 && base[0].summary) {
      const kids = tasks.filter((t) => t.parent_id === base[0].id), sk = kids.filter((t) => t.summary);
      if (sk.length) base = sk; else if (kids.length) base = kids;
    }
    const shown = base.slice(0, 8);
    const shownIds = new Set(shown.map((t) => t.id));
    const phaseOf = (t) => { let c = t, g = 0; while (c && !shownIds.has(c.id) && c.parent_id && byId.has(c.parent_id) && g++ < 50) c = byId.get(c.parent_id); return c; };
    const rows = (ctx.metrics && ctx.metrics.rows) || [];
    return shown.map((r) => {
      const leaves = rows.filter((x) => { const ph = phaseOf(x); return ph && ph.id === r.id; });
      const own = leaves.length ? leaves : rows.filter((x) => x.id === r.id);
      let w = 0, a = 0, p = 0, pw = 0;
      for (const x of own) { const d = Math.max(x.duration || 1, 1); w += d; a += d * (x.progress || 0); if (x.plannedPct != null) { p += d * x.plannedPct; pw += d; } }
      return { name: r.name, start: r.start, finish: r.finish, actual: w ? Math.round(a / w) : (r.progress || 0), planned: pw ? Math.round(p / pw) : null };
    });
  }

  // ---------- one slide status report ----------
  // Everything the slide shows, as plain data. Text is already short and in US English.
  const clip = (t, n) => {
    const v = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    if (v.length <= n) return v;
    const cut = v.slice(0, n - 1), sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd().replace(/[,;:.]$/, '') + '\u2026';
  };
  const BAND_ORDER = { High: 0, Medium: 1, Low: 2 };
  const nice = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : String(d || ''); };
  function onePager(ctx) {
    const p = ctx.project || {};
    const m = ctx.metrics || {};
    const today = ctx.today;
    const R = window.__Reports;
    const tasks = (ctx.tasks || []).filter((t) => !t.summary && t.finish);
    const forecastEnd = tasks.length ? tasks.map((t) => t.finish).sort().pop() : null;
    const owner = (ctx.resources || []).find((r) => /sponsor|owner|client/i.test(r.role || ''));

    // money, from every payment milestone
    const pays = (ctx.milestones || []).map((x) => {
      const d = x.d || {};
      const amount = d.amount != null ? Number(d.amount) : (d.percent != null && p.value ? p.value * d.percent / 100 : 0);
      return { amount: amount || 0, state: x.state === 'paid' ? 'paid' : x.state === 'invoiced' ? 'invoiced' : 'pending', due: d.due_date || '' };
    });
    const sumOf = (st) => pays.filter((x) => x.state === st).reduce((a, b) => a + b.amount, 0);

    // overall status
    const spi = m.spi;
    let health;
    if ((m.actualPct || 0) >= 100) health = 'done';
    else if (spi == null) health = m.overdue ? 'warn' : (m.actualPct || 0) > 0 ? 'ok' : 'idle';
    else if (spi >= 0.95 && !m.overdue) health = 'ok';
    else if (spi >= 0.8) health = 'warn';
    else health = 'bad';

    // phases as stages and as table rows
    const phases = phasesOf(ctx, true);
    const stages = phases.map((ph) => ({ name: ph.name, state: ph.actual >= 100 ? 'done' : ph.actual > 0 ? 'active' : 'todo' }));
    const due = pays.filter((x) => x.state !== 'paid' && x.due);
    const rows = phases.slice(0, 8).map((ph) => {
      let tone = 'ok', label = 'On track';
      if (ph.actual >= 100) { tone = 'done'; label = 'Completed'; }
      else if (ph.finish && today && ph.finish < today) { tone = 'bad'; label = 'Off track'; }
      else if (ph.planned != null && ph.actual < ph.planned - 5) { tone = 'warn'; label = 'At risk'; }
      else if (ph.actual === 0 && (!ph.planned)) { tone = 'idle'; label = 'Not started'; }
      return { name: clip(ph.name, 48), pct: ph.actual, pay: due.some((x) => x.due >= ph.start && x.due <= ph.finish), start: ph.start || '', end: ph.finish || '', tone, label };
    });

    // risks and delays
    const rk = (ctx.risks || []).filter((r) => r.state !== 'closed').map((r) => ({ title: r.title, mitigation: (r.d && r.d.mitigation) || 'To be defined', level: band(lvl(r.d && r.d.probability), lvl(r.d && r.d.impact)) }));
    rk.sort((a, b) => BAND_ORDER[a.level] - BAND_ORDER[b.level]);
    const risks = rk.slice(0, 3).map((r) => ({ title: clip(r.title, 70), mitigation: clip(r.mitigation, 110), level: r.level }));
    const late = (m.rows || []).filter((r) => r.slipDays > 0).sort((a, b) => b.slipDays - a.slipDays);
    const lateIds = new Set(late.map((r) => r.id));
    const delays = late.slice(0, 3).map((r) => clip(`${r.name} is ${r.slipDays} working day${r.slipDays === 1 ? '' : 's'} behind baseline.`, 130))
      .concat((m.rows || []).filter((r) => r.overdue && !lateIds.has(r.id)).slice(0, 2).map((r) => clip(`${r.name} is overdue. It was due on ${nice(r.finish)}.`, 130))).slice(0, 3);

    // wording lists
    const done = R ? R.activityLines(ctx, 5).map((a) => clip(a.text, 130)) : [];
    const next = R ? R.nextRows(ctx, 5).map((t) => clip(`${t.name}, ${nice(t.start)} to ${nice(t.finish)}`, 130)) : [];
    const ask = R ? R.decisionLines(ctx).map((x) => clip(x, 130)) : [];
    const sum = (ctx.docs || []).find((d) => d.summary && !/^Rule based reading/.test(d.summary) && ['proposal', 'contract'].includes(d.kind));
    const brief = sum ? clip(sum.summary, 270) : clip(`${p.name || 'This project'} is delivered for ${p.client || 'the client'}${p.start_date && p.end_date ? `. It runs from ${nice(p.start_date)} to ${nice(p.end_date)}` : ''}.`, 270);
    const left = p.end_date && today ? Math.round(dnum(p.end_date) - dnum(today)) : null;

    return {
      v: 1, period: ctx.period ? { start: ctx.period.start, end: ctx.period.end } : null,
      info: { client: p.client || '', owner: owner ? owner.name : '', pm: (ctx.user && ctx.user.name) || '', start: p.start_date || '', plannedEnd: p.end_date || '', forecastEnd, daysLeft: left, currency: p.currency || '', value: p.value || 0, paid: sumOf('paid'), invoiced: sumOf('invoiced'), pending: sumOf('pending') },
      pct: { current: m.actualPct || 0, last: ctx.lastWeek && ctx.lastWeek.progress != null ? ctx.lastWeek.progress : null, planned: m.plannedPct == null ? null : m.plannedPct },
      health, stages, rows, risks, delays, done, next, ask, brief,
    };
  }

  function fromContext(ctx, isProgress) {
    const p = ctx.project || {};
    const m = ctx.metrics || {};
    const cur = p.currency || '';
    const today = ctx.today;
    const rows = m.rows || [];

    // task status
    let done = 0, prog = 0, todo = 0, late = 0;
    for (const r of rows) {
      if ((r.progress || 0) >= 100) done++;
      else if (r.overdue) late++;
      else if ((r.progress || 0) > 0) prog++;
      else todo++;
    }
    const status = [{ label: 'Done', n: done, tone: 'ok' }, { label: 'In progress', n: prog, tone: 'info' }, { label: 'Not started', n: todo, tone: 'idle' }, { label: 'Late', n: late, tone: 'bad' }].filter((x) => x.n > 0);

    // deliverables
    const dl = ctx.deliverables || [];
    const dClosed = dl.filter((d) => d.state === 'closed').length;
    const dOver = dl.filter((d) => d.state !== 'closed' && d.d && d.d.due_date && d.d.due_date < today).length;
    const deliverables = [{ label: 'Closed', n: dClosed, tone: 'ok' }, { label: 'Open', n: dl.length - dClosed - dOver, tone: 'info' }, { label: 'Overdue', n: dOver, tone: 'bad' }].filter((x) => x.n > 0);

    // payments
    const items = (ctx.milestones || []).map((x) => {
      const d = x.d || {};
      const amount = d.amount != null ? Number(d.amount) : (d.percent != null && p.value ? p.value * d.percent / 100 : null);
      return { name: x.title, amount, state: x.state === 'paid' ? 'Paid' : x.state === 'invoiced' ? 'Invoiced' : 'Pending', due: d.due_date || '' };
    }).filter((x) => x.amount != null && x.amount > 0).slice(0, 8);
    const sum = (s) => items.filter((x) => x.state === s).reduce((a, b) => a + b.amount, 0);
    const payments = items.length ? { currency: cur, items, byState: [{ label: 'Paid', n: sum('Paid'), tone: 'ok' }, { label: 'Invoiced', n: sum('Invoiced'), tone: 'info' }, { label: 'Pending', n: sum('Pending'), tone: 'idle' }].filter((x) => x.n > 0) } : null;

    // risks (open only)
    const rk = (ctx.risks || []).filter((r) => r.state !== 'closed');
    const order = [3, 2, 1];
    const matrix = order.map((pv) => order.map((iv) => rk.filter((r) => lvl(r.d && r.d.probability) === pv && lvl(r.d && r.d.impact) === iv).length));
    const counts = { High: 0, Medium: 0, Low: 0 };
    for (const r of rk) counts[band(lvl(r.d && r.d.probability), lvl(r.d && r.d.impact))]++;
    const risks = rk.length ? { open: rk.length, matrix, byLevel: ['High', 'Medium', 'Low'].map((k) => ({ label: k, n: counts[k], tone: BAND_TONE[k] })), top: rk.slice(0, 5).map((r) => ({ title: r.title, level: band(lvl(r.d && r.d.probability), lvl(r.d && r.d.impact)) })) } : null;

    // schedule variance (working days late against baseline)
    const slip = rows.filter((r) => r.slipDays > 0).sort((a, b) => b.slipDays - a.slipDays).slice(0, 6).map((r) => ({ name: r.name, days: r.slipDays }));

    // key dates on the timeline
    const marks = (ctx.milestones || []).filter((x) => x.d && x.d.due_date).slice(0, 8).map((x) => ({ name: x.title, date: x.d.due_date, state: x.state === 'paid' ? 'Paid' : x.state === 'invoiced' ? 'Invoiced' : 'Pending' }));

    // key figures
    const spiTone = m.spi == null ? 'info' : m.spi >= 0.95 ? 'ok' : m.spi >= 0.8 ? 'warn' : 'bad';
    const high = counts.High;
    const riskTile = { id: 'risks', label: 'Open risks', value: String(rk.length), hint: `${high} high`, tone: high > 0 ? 'bad' : rk.length ? 'warn' : 'ok' };
    let kpis;
    if (isProgress) {
      kpis = [
        { id: 'actual', label: 'Actual progress', value: `${m.actualPct || 0}%`, hint: m.plannedPct != null ? `Planned ${m.plannedPct}%` : 'No baseline set', tone: spiTone },
        { id: 'spi', label: 'Schedule index', value: m.spi != null ? String(m.spi) : 'Not set', hint: m.spi != null ? '1.00 means on plan' : 'Set a baseline', tone: spiTone },
        { id: 'late', label: 'Overdue tasks', value: String(m.overdue || 0), hint: `of ${m.taskCount || 0} tasks`, tone: m.overdue ? 'bad' : 'ok' },
        riskTile,
      ];
    } else {
      let left = null;
      if (p.end_date && today) left = Math.round(dnum(p.end_date) - dnum(today));
      kpis = [
        { id: 'value', label: 'Contract value', value: p.value ? `${cur} ${compact(p.value)}`.trim() : 'Not set', hint: p.start_date && p.end_date ? `${p.start_date} to ${p.end_date}` : 'Dates to be confirmed', tone: 'info' },
        { id: 'deliv', label: 'Deliverables', value: String(dl.length), hint: `${dClosed} closed`, tone: dOver ? 'bad' : 'info' },
        { id: 'days', label: 'Days to end', value: left == null ? 'Not set' : String(Math.max(left, 0)), hint: left == null ? 'No end date' : left < 0 ? `${-left} days past end` : `Ends ${p.end_date}`, tone: left == null ? 'idle' : left < 0 ? 'bad' : left <= 30 ? 'warn' : 'ok' },
        riskTile,
      ];
    }

    return {
      v: 1, today, period: ctx.period ? { start: ctx.period.start, end: ctx.period.end } : null,
      progress: { actual: m.actualPct || 0, planned: m.plannedPct == null ? null : m.plannedPct, spi: m.spi == null ? null : m.spi, overdue: m.overdue || 0, taskCount: m.taskCount || 0 },
      kpis, phases: phasesOf(ctx), status, deliverables, payments, risks, slip, marks,
      onepager: isProgress ? onePager(ctx) : null,
    };
  }

  window.__Visuals = { fromContext, compact };
})();
