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

  function phasesOf(ctx) {
    const tasks = ctx.tasks || [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const rootOf = (t) => { let c = t, g = 0; while (c.parent_id && byId.has(c.parent_id) && g++ < 50) c = byId.get(c.parent_id); return c; };
    const roots = tasks.filter((t) => !t.parent_id || !byId.has(t.parent_id));
    const summaryRoots = roots.filter((t) => t.summary);
    const shown = (summaryRoots.length ? summaryRoots : roots).slice(0, 8);
    const rows = (ctx.metrics && ctx.metrics.rows) || [];
    return shown.map((r) => {
      const leaves = rows.filter((x) => rootOf(x).id === r.id);
      const own = leaves.length ? leaves : rows.filter((x) => x.id === r.id);
      let w = 0, a = 0, p = 0, pw = 0;
      for (const x of own) { const d = Math.max(x.duration || 1, 1); w += d; a += d * (x.progress || 0); if (x.plannedPct != null) { p += d * x.plannedPct; pw += d; } }
      return { name: r.name, start: r.start, finish: r.finish, actual: w ? Math.round(a / w) : (r.progress || 0), planned: pw ? Math.round(p / pw) : null };
    });
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
    };
  }

  window.__Visuals = { fromContext, compact };
})();
