// The notification center. It tells the project manager what changed without opening each screen: tasks that are late,
// payments that are late, and the state of the plan (trial, tokens, renewal). Plain rules, no AI call. A notification
// is kept per person, project and kind. It is read when opened, can be dismissed, and comes back only when the
// condition itself changes (for example another task goes late).
'use strict';
const { rulesFor } = require('./chat/suggest');

const err = (status, message) => Object.assign(new Error(message), { status, expose: true });
const DAY = 86400e3;

// the plan state, with the same thresholds the old ribbon used
function planState(v, now) {
  const paid = v.status !== 'trial' && !!v.period_start;
  const end = paid ? v.period_end : v.trial_end;
  const days = end ? Math.ceil((end - now) / DAY) : 0;
  const expired = v.state === 'expired' || v.state === 'ended';
  const pct = v.token_limit ? Math.round((v.tokens_used / v.token_limit) * 100) : 0;
  let sig = null;
  if (expired) sig = paid ? 'ended' : 'trial_over';
  else if (pct >= 100) sig = 'tokens100';
  else if (pct >= 80) sig = 'tokens80';
  else if (paid) sig = days <= 3 ? 'paid_3' : null;
  else sig = days <= 3 ? 'trial_3' : days <= 5 ? 'trial_5' : 'trial';
  return { sig, days: Math.max(0, days), pct };
}

function createNotifications({ db, store, api }) {
  const q = (text, params) => db.query(text, params);

  // everything that holds right now: [{ project_id, kind, sig, n, extra, project }]
  async function conditions(user) {
    return api.runAs({
      user,
      async fn(h) {
        const today = h.TODAY();
        const out = [];
        const all = (await h.call('GET', '/api/projects')).projects || [];
        for (const p of all.filter((x) => x.status !== 'archived')) {
          h.P(p.id);
          const [sc, it] = await Promise.all([h.call('GET', `/api/projects/${p.id}/schedule`), h.call('GET', `/api/projects/${p.id}/items`)]);
          for (const r of rulesFor(p, sc, it.items, [], today)) {
            if (r.rule === 'late_tasks' || r.rule === 'late_payments') out.push({ project_id: Number(p.id), kind: r.rule, sig: r.sig, n: r.n, extra: {}, project: p.name });
          }
        }
        try {
          const ps = planState((await h.call('GET', '/api/billing')).billing, Date.now());
          if (ps.sig) out.push({ project_id: 0, kind: 'plan', sig: ps.sig, n: ps.days, extra: { days: ps.days, pct: ps.pct }, project: '' });
        } catch (e) { /* the plan is optional here */ }
        return out;
      },
    });
  }

  // Brings the stored notifications in line with what is true now. It runs on every list, so it must cost a few queries
  // however many notifications there are: rows whose figures did not change are left alone, new rows go in with one insert
  // and rows that no longer apply are removed with one delete.
  async function sync(user) {
    const now = await conditions(user);
    const have = (await q('SELECT id, project_id, kind, sig, n, extra FROM notifications WHERE user_id = $1', [user.id])).rows;
    const key = (a) => Number(a.project_id) + ':' + a.kind;
    const mine = new Map(have.map((r) => [key(r), r]));
    const live = new Set();
    const fresh = [];
    for (const c of now) {
      live.add(key(c));
      const r = mine.get(key(c));
      if (!r) { fresh.push(c); continue; }
      if (r.sig !== c.sig) await q('UPDATE notifications SET sig = $2, n = $3, extra = $4::jsonb, read_at = NULL, dismissed = false, updated_at = now() WHERE id = $1', [r.id, c.sig, c.n, JSON.stringify(c.extra)]);
      else if (Number(r.n) !== Number(c.n) || JSON.stringify(r.extra || {}) !== JSON.stringify(c.extra || {})) await q('UPDATE notifications SET n = $2, extra = $3::jsonb WHERE id = $1', [r.id, c.n, JSON.stringify(c.extra)]);
    }
    if (fresh.length) {
      const vals = [], params = [];
      fresh.forEach((c, i) => { const o = i * 7; vals.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}::jsonb)`); params.push(store.nid(), user.id, c.project_id, c.kind, c.sig, c.n, JSON.stringify(c.extra)); });
      await q(`INSERT INTO notifications(id, user_id, project_id, kind, sig, n, extra) VALUES ${vals.join(', ')}`, params);
    }
    const gone = have.filter((r) => !live.has(key(r))).map((r) => r.id);
    if (gone.length) await q('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [gone]);
    return now;
  }

  async function list(user) {
    let live;
    try { live = await sync(user); } catch (e) { if (process.env.NOTIFY_DEBUG) console.error(e); return { available: false, items: [], unread: 0 }; } // the table arrives with the next Publish
    const names = new Map(live.map((c) => [c.project_id, c.project]));
    // pinned ones come first and are never pushed out of the 50 by newer ones. Before the pinned column arrives
    // with the next Publish, the same list is read without it.
    let rows;
    try { rows = (await q('SELECT * FROM notifications WHERE user_id = $1 AND dismissed = false ORDER BY pinned DESC, (read_at IS NULL) DESC, updated_at DESC LIMIT 50', [user.id])).rows; }
    catch (e) { rows = (await q('SELECT * FROM notifications WHERE user_id = $1 AND dismissed = false ORDER BY (read_at IS NULL) DESC, updated_at DESC LIMIT 50', [user.id])).rows; }
    const items = rows.map((r) => ({ id: String(r.id), kind: r.kind, sig: r.sig, project_id: Number(r.project_id) || null, project: names.get(Number(r.project_id)) || '', n: r.n, extra: r.extra || {}, read: !!r.read_at, pinned: !!r.pinned, at: r.updated_at }));
    return { available: true, items, unread: items.filter((x) => !x.read).length };
  }
  // The items behind one notification, so the inbox page can show them and act on each: the late tasks of a project
  // or its late payments. Computed fresh with the same rules as the counts, so the detail always matches the number.
  async function entries(user, id) {
    const row = (await q('SELECT id, project_id, kind FROM notifications WHERE user_id = $1 AND id = $2', [user.id, Number(id)])).rows[0];
    if (!row) throw err(404, 'This notification is no longer there');
    if (row.kind === 'plan') return { id: String(row.id), kind: 'plan', entries: [] };
    const pid = Number(row.project_id);
    const out = await api.runAs({
      user,
      async fn(h) {
        const today = h.TODAY();
        const ago = (day) => Math.max(1, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / DAY));
        h.P(pid);
        const p = ((await h.call('GET', '/api/projects')).projects || []).find((x) => Number(x.id) === pid);
        if (!p) return null;
        if (row.kind === 'late_tasks') {
          const sc = await h.call('GET', `/api/projects/${pid}/schedule`);
          return (sc.tasks || []).filter((t) => !t.summary && (t.progress || 0) < 100 && t.finish && t.finish < today)
            .sort((a, b) => a.finish.localeCompare(b.finish))
            .map((t) => ({ task_id: t.id, title: t.name, due: t.finish, late_days: ago(t.finish), progress: t.progress || 0, assignee: t.assignee || null }));
        }
        const it = await h.call('GET', `/api/projects/${pid}/items`);
        return (it.items || []).filter((i) => i.status !== 'ignored' && i.kind === 'milestone' && i.state === 'pending' && i.data && i.data.due_date && i.data.due_date < today)
          .sort((a, b) => a.data.due_date.localeCompare(b.data.due_date))
          .map((i) => ({ item_id: i.id, title: i.title, due: i.data.due_date, late_days: ago(i.data.due_date), amount: i.data.amount ?? null, currency: p.currency || null, state: i.state }));
      },
    });
    return { id: String(row.id), kind: row.kind, project_id: pid, entries: out || [] };
  }
  // read and dismiss (delete) act on one or all of a person's notifications. Pin, unpin and restore (the Undo of a
  // delete) act on one. A dismissed notification still returns when its condition changes.
  const SETS = {
    read: 'read_at = COALESCE(read_at, now())',
    dismiss: 'dismissed = true, read_at = COALESCE(read_at, now())',
    restore: 'dismissed = false',
    pin: 'pinned = true',
    unpin: 'pinned = false',
  };
  async function mark(user, body, set) {
    const all = body.all === true && (set === 'read' || set === 'dismiss');
    const id = all ? null : Number(body.id);
    if (!all && !Number.isFinite(id)) throw err(400, 'Choose a notification');
    await q(`UPDATE notifications SET ${SETS[set]} WHERE user_id = $1` + (all ? '' : ' AND id = $2'), all ? [user.id] : [user.id, id]);
    return { ok: true };
  }

  async function route(req, res, url, user, io) {
    const p = url.pathname; const method = req.method;
    if (!p.startsWith('/api/notifications')) return false;
    const read = async () => { const raw = await io.readBody(req, 8 * 1024); if (!raw.length) return {}; try { return JSON.parse(raw.toString('utf8')); } catch (e) { throw err(400, 'The request body is not valid JSON'); } };
    if (method === 'GET' && p === '/api/notifications') { io.json(res, 200, await list(user)); return true; }
    const one = /^\/api\/notifications\/(\d+)$/.exec(p);
    if (method === 'GET' && one) { io.json(res, 200, await entries(user, one[1])); return true; }
    const act = /^\/api\/notifications\/(read|dismiss|restore|pin|unpin)$/.exec(p);
    if (method === 'POST' && act) {
      try { io.json(res, 200, await mark(user, await read(), act[1])); } catch (e) { if (e.expose) throw e; io.json(res, 503, { error: 'Notifications need a database update that is not in place yet. Publish the latest version, then try again.' }); }
      return true;
    }
    return false;
  }
  return { route, list, entries, mark, planState };
}

module.exports = { createNotifications, planState };
