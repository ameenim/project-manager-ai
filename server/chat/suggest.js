// Proactive suggestions. Plain rules over the project data, with no AI call, using the same formulas as health and the
// Today brief so the counts always match. A person can dismiss a suggestion (it stays away until the condition
// changes) or snooze it for 7 days. The state belongs to the person, never to the project.
'use strict';

const SNOOZE_DAYS = 7;
const DONE_STATES = ['accepted', 'delivered', 'done', 'approved', 'closed', 'paid'];

const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ids = (rows) => rows.map((r) => r.id).sort().join(',');

// Every rule for one project. Each returns null when the condition does not hold, or { n, sig }.
// sig describes the condition, so a dismissed suggestion comes back only when the condition itself changes.
function rulesFor(p, sc, items, inbox, today) {
  const out = [];
  const tasks = (sc.tasks || []).filter((t) => !t.summary);
  const late = tasks.filter((t) => (t.progress || 0) < 100 && t.finish && t.finish < today);
  if (late.length) out.push({ rule: 'late_tasks', n: late.length, sig: ids(late) });
  const st = p.stats || {};
  if (st.spi != null && st.spi < 0.95) out.push({ rule: 'low_spi', n: Math.round(st.spi * 100) / 100, sig: st.spi < 0.8 ? 'red' : 'amber' });
  if (st.forecast_end && p.end_date && st.forecast_end > p.end_date) out.push({ rule: 'forecast_late', n: st.forecast_end, sig: st.forecast_end });
  if (tasks.length && !sc.has_baseline) out.push({ rule: 'no_baseline', n: tasks.length, sig: 'none' });
  const live = (items || []).filter((i) => i.status !== 'ignored');
  const soon = addDays(today, 7);
  const linked = new Set((sc.tasks || []).map((t) => t.deliverable_id).filter((x) => x != null).map(String));
  const bare = live.filter((i) => i.kind === 'deliverable' && !DONE_STATES.includes(String(i.state || '').toLowerCase()) && i.data && i.data.due_date && i.data.due_date >= today && i.data.due_date <= soon && !linked.has(String(i.id)));
  if (bare.length) out.push({ rule: 'deliverable_no_task', n: bare.length, sig: ids(bare) });
  const pay = live.filter((i) => i.kind === 'milestone' && i.state === 'pending' && i.data && i.data.due_date && i.data.due_date < today);
  if (pay.length) out.push({ rule: 'late_payments', n: pay.length, sig: ids(pay) });
  const wait = (inbox || []).filter((r) => r.status === 'pending');
  if (wait.length) out.push({ rule: 'waiting_updates', n: wait.length, sig: ids(wait) });
  return out;
}

function createSuggest({ q, api, access }) {
  async function states(userId) {
    const r = await q('SELECT project_id, rule, sig, mode, until_day FROM chat_suggest_state WHERE user_id = $1', [userId]);
    const m = new Map();
    for (const x of r.rows) m.set(Number(x.project_id) + ':' + x.rule, x);
    return m;
  }
  // everything that currently holds, before the person's dismiss and snooze choices are applied
  async function raw(user, projectId) {
    return api.runAs({
      user,
      async fn(h) {
        const today = h.TODAY();
        const all = (await h.call('GET', '/api/projects')).projects || [];
        const list = projectId ? all.filter((p) => Number(p.id) === Number(projectId)) : all.filter((p) => p.status !== 'archived');
        const out = [];
        for (const p of list) {
          h.P(p.id);
          const [sc, it, inb] = await Promise.all([h.call('GET', `/api/projects/${p.id}/schedule`), h.call('GET', `/api/projects/${p.id}/items`), h.call('GET', `/api/projects/${p.id}/inbox`)]);
          for (const r of rulesFor(p, sc, it.items, inb.inbox, today)) out.push({ ...r, project_id: Number(p.id), project: p.name });
        }
        // the weekly summary shows from Monday to Wednesday, once per week
        const wd = new Date(today + 'T00:00:00Z').getUTCDay();
        if (!projectId && all.length && wd >= 1 && wd <= 3) out.push({ rule: 'weekly', n: all.length, sig: addDays(today, 1 - wd), project_id: 0, project: '' });
        return { today, items: out };
      },
    });
  }
  async function list(user, projectId) {
    if (projectId != null) await access(user, projectId);
    const [r, st] = await Promise.all([raw(user, projectId), states(user.id)]);
    const items = r.items.filter((x) => {
      const s = st.get(x.project_id + ':' + x.rule);
      if (!s) return true;
      if (s.mode === 'snooze') return !(s.until_day && s.until_day > r.today);
      return s.sig !== x.sig;
    }).map((x) => ({ id: x.rule + ':' + x.project_id, rule: x.rule, project_id: x.project_id || null, project: x.project, n: x.n }));
    return { items, count: items.length };
  }
  async function dismiss(user, body) {
    const projectId = body.project_id ? Number(body.project_id) : null;
    const rule = String(body.rule || '');
    const mode = body.mode === 'snooze' ? 'snooze' : 'dismiss';
    if (projectId != null) await access(user, projectId);
    const r = await raw(user, projectId);
    const hit = r.items.find((x) => x.rule === rule && x.project_id === (projectId || 0));
    if (!hit) return { ok: true, gone: true };
    const until = mode === 'snooze' ? addDays(r.today, SNOOZE_DAYS) : null;
    await q('INSERT INTO chat_suggest_state(user_id, project_id, rule, sig, mode, until_day) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, project_id, rule) DO UPDATE SET sig = $4, mode = $5, until_day = $6, created_at = now()', [user.id, projectId || 0, rule, hit.sig, mode, until]);
    return { ok: true, mode, until };
  }
  return { list, dismiss };
}

module.exports = { createSuggest, rulesFor, SNOOZE_DAYS };
