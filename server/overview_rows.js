'use strict';
// The row level data behind an overview report. The overview dashboards show summaries, and a report in Excel needs the rows
// those summaries come from: every project, task, payment, deliverable, requirement, risk, team member and activity line that
// passes the same filters as the screen. Each table says how its columns read (kind) so the workbook can format them.
//
// kind: text, date, int, pct, money, status, wrap (long text)
const ROW_CAP = 5000;

module.exports = function createOverviewRows({ OF, S, rawProject, TODAY }) {
  const STATUS_LABEL = OF.STATUS_LABEL;
  const dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  const STATE_LABEL = { paid: 'Paid', invoiced: 'Invoiced', pending: 'Pending', closed: 'Closed', open: 'Open', proposed: 'Proposed', accepted: 'Accepted', mitigated: 'Mitigated' };
  const label = (s) => STATE_LABEL[String(s || '').toLowerCase()] || (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
  const LV = { high: 3, medium: 2, low: 1 };
  const lvl = (v) => LV[String(v || 'Medium').toLowerCase()] || 2;
  const level = (p, i) => { const sc = lvl(p) * lvl(i); return sc >= 6 ? 'High' : sc >= 3 ? 'Medium' : 'Low'; };
  const cap = (list, truncated, name) => { if (list.length <= ROW_CAP) return list; truncated[name] = list.length; return list.slice(0, ROW_CAP); };

  // outline numbers such as 2.1.3 and the row position of each task, the way the schedule screen shows them
  function outline(sched) {
    const byParent = new Map(), byId = new Map(sched.map((t) => [t.id, t]));
    for (const t of sched) { const k = t.parent_id == null ? 0 : t.parent_id; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(t); }
    for (const l of byParent.values()) l.sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id);
    const wbs = new Map(), rowNo = new Map();
    let n = 0;
    const walk = (pid, prefix) => (byParent.get(pid) || []).forEach((t, i) => {
      const w = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      wbs.set(t.id, w); rowNo.set(t.id, ++n);
      walk(t.id, w);
    });
    walk(0, '');
    // the phase of a task is its ancestor one level below a single root summary, or the top level ancestor
    const roots = byParent.get(0) || [];
    const lift = roots.length === 1 && roots[0].summary ? 1 : 0;
    const phase = new Map();
    for (const t of sched) {
      const chain = [];
      for (let c = t, g = 0; c && g < 50; c = c.parent_id == null ? null : byId.get(c.parent_id), g++) chain.unshift(c);
      const pick = chain[Math.min(lift, chain.length - 1)];
      phase.set(t.id, pick && pick.id !== t.id ? pick.name : (chain.length > lift + 1 ? chain[lift].name : ''));
    }
    return { wbs, rowNo, phase };
  }
  const predText = (t, rowNo) => (t.deps || []).map((d) => `${rowNo.get(d.id) || '?'}${d.type && d.type !== 'FS' ? d.type : ''}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ');

  // list: the projects in the view, each as { P, st }. f: parsed filters.
  function build(list, f) {
    const today = TODAY(), r = OF.range(f), truncated = {};
    const T = { projects: [], tasks: [], payments: [], deliverables: [], requirements: [], risks: [], team: [], workload: [], activity: [] };
    const owners = new Map();
    for (const { P, st } of list) {
      const raw = rawProject(P), pname = P.p.name, cur = P.p.currency || '';
      const m = S.progressMetrics(P.tasks, raw, today);
      const sc = OF.scope(P, f, m.rows, today);
      if (!OF.includeProject(P, st, f, sc)) continue;
      const sched = S.schedule(P.tasks, raw);
      const { wbs, rowNo, phase } = outline(sched);
      const byId = new Map(sched.map((t) => [t.id, t]));
      const risksOpen = P.items.filter((i) => i.kind === 'risk' && i.status !== 'ignored' && !['mitigated', 'closed', 'resolved', 'done'].includes(String(i.state || '').toLowerCase())).length;
      T.projects.push([pname, P.p.client || '', P.p.code || '', P.p.status === 'closed' ? 'Closed' : 'Active', OF.HEALTH_LABEL[st.health] || st.health, st.progress, st.planned == null ? null : st.planned, st.spi == null ? null : Math.round(st.spi * 100) / 100,
        st.tasks, st.overdue, risksOpen, cur, P.p.value == null ? null : P.p.value, P.p.start_date || '', P.p.end_date || '', st.forecast_end || '',
        st.forecast_end && P.p.end_date ? Math.round(dnum(st.forecast_end) - dnum(P.p.end_date)) : null, st.pendingItems + st.pendingInbox]);
      // tasks
      for (const x of sc.rows) {
        const t = byId.get(x.id) || {};
        const status = OF.taskStatus(x);
        T.tasks.push([pname, wbs.get(x.id) || '', phase.get(x.id) || '', x.name, x.start || '', x.finish || '', x.duration || 0, x.progress || 0, STATUS_LABEL[status], x.assignee || '', x.critical ? 'Yes' : '', x.is_milestone ? 'Yes' : '', predText(t, rowNo), t.notes || '']);
        const who = x.assignee || 'Unassigned';
        const k = `${pname}\u0000${who}`;
        if (!owners.has(k)) owners.set(k, [pname, who, 0, 0, 0, 0, 0]);
        const o = owners.get(k); o[{ done: 2, active: 3, todo: 4, late: 5 }[status]]++; o[6]++;
      }
      // items
      for (const i of sc.items) {
        const d = i.data || {};
        if (i.kind === 'milestone') {
          const amount = d.amount != null ? Number(d.amount) : (d.percent != null && P.p.value ? Math.round((P.p.value * d.percent) / 100) : null);
          const state = i.state || 'pending', late = !!d.due_date && d.due_date < today && state === 'pending';
          T.payments.push([pname, i.title, d.due_date || '', amount, cur, d.percent == null ? null : Number(d.percent), label(state), STATUS_LABEL[OF.payStatus(state, late)], late ? 'Yes' : '']);
        } else if (i.kind === 'deliverable') {
          const late = !!d.due_date && d.due_date < today && i.state !== 'closed';
          T.deliverables.push([pname, i.title, d.due_date || '', i.state === 'closed' ? 'Closed' : 'Open', STATUS_LABEL[OF.delStatus(i.state, late)], late ? 'Yes' : '', d.outcome === 'not_delivered' ? 'Not delivered' : '']);
        } else if (i.kind === 'risk') {
          T.risks.push([pname, i.title, d.category || '', d.probability || 'Medium', d.impact || 'Medium', level(d.probability, d.impact), label(i.state || 'open'), d.owner || '', d.response || '', d.mitigation || '']);
        }
      }
      // requirements are listed by status only, they have no date
      for (const i of P.items) if (i.kind === 'requirement' && i.status !== 'ignored' && (!f.s || OF.delStatus(i.state, false) === f.s)) {
        const d = i.data || {};
        T.requirements.push([pname, i.title, d.category || d.type || '', d.priority || '', i.state === 'closed' ? 'Closed' : 'Open']);
      }
      // team and activity
      const names = new Map();
      for (const x of sc.rows) { const k = (x.assignee || '').toLowerCase(); if (!k) continue; const o = names.get(k) || { open: 0, late: 0 }; if ((x.progress || 0) < 100) o.open++; if (OF.taskStatus(x) === 'late') o.late++; names.set(k, o); }
      for (const p of P.resources || []) { const o = names.get(String(p.name || '').toLowerCase()) || { open: 0, late: 0 }; T.team.push([pname, p.name, p.role || '', p.email || '', o.open, o.late]); }
      for (const a of P.audit || []) {
        if (!OF.inRange(String(a.ts || a.created_at || '').slice(0, 10), r)) continue;
        const dd = a.detail || {};
        T.activity.push([String(a.ts || a.created_at || '').replace('T', ' ').slice(0, 16), pname, a.actor || '', a.action || '', dd.summary || '']);
      }
    }
    T.workload = [...owners.values()].sort((a, b) => b[6] - a[6]);
    T.activity.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    T.tasks.sort((a, b) => a[0].localeCompare(b[0]));
    for (const k of Object.keys(T)) T[k] = cap(T[k], truncated, k);
    return { today, tables: T, truncated, cap: ROW_CAP };
  }
  return { build, outline };
};
