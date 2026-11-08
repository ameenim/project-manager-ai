// How project managers use the product. Browsers send small batches of steps (a screen opened, a button used, a
// repeated click, a slow or failed call). Only screen and action names are kept, never project content. The super admin
// report turns those steps from many project managers into numbers and into suggestions for a smoother journey.
'use strict';

const DAY = 86400e3;
const KINDS = new Set(['view', 'dwell', 'act', 'rage', 'slow', 'fail']);
const DEVICES = new Set(['desktop', 'tablet', 'phone']);
const NAME_RE = /^[a-z0-9_:/.\- ]{1,48}$/;
const num = (v) => Number(v || 0);
const slug = (s) => { const x = String(s == null ? '' : s).toLowerCase().trim().slice(0, 48); return NAME_RE.test(x) ? x : ''; };
const nice = (t) => String(t || '').replace(/^chat_/, 'chat ').replace(/^link[_ ]/, 'link to ').replace(/[_]+/g, ' ');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// What a project manager can open. Screens never opened by anyone are reported as unused.
const SCREENS = {
  dashboard: 'Dashboard', projects: 'Projects list', calendar: 'Calendar', widgets: 'Widgets', billing: 'Billing', account: 'Account settings', brand: 'Brand',
  'project:overview': 'Project overview', 'project:review': 'Project review', 'project:schedule': 'Schedule', 'project:logs': 'Logs', 'project:meetings': 'Meetings',
  'project:inbox': 'Inbox', 'project:documents': 'Documents', 'project:reports': 'Reports', 'project:settings': 'Project settings',
};
const label = (s) => SCREENS[s] || String(s).replace(/[:_]/g, ' ');
const NEEDS_USERS = 2;   // a pattern counts only when at least this many different project managers show it

function createUsage({ db, store }) {
  const q = (t, p) => db.query(t, p);
  const buckets = new Map();   // user id to recent batch times, a gentle limit on top of the address limit

  // ---------- intake ----------
  async function ingest(user, body) {
    const now = Date.now();
    const seen = (buckets.get(user.id) || []).filter((t) => now - t < 60e3);
    if (seen.length >= 40) return { ok: true, saved: 0 };
    seen.push(now); buckets.set(user.id, seen);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 60e3) buckets.delete(k);

    const b = body && typeof body === 'object' ? body : {};
    const sid = String(b.sid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (!sid) return { ok: true, saved: 0 };
    const device = DEVICES.has(b.device) ? b.device : 'desktop';
    const list = Array.isArray(b.events) ? b.events.slice(0, 60) : [];
    const rows = [];
    for (const e of list) {
      if (!e || !KINDS.has(e.k)) continue;
      const screen = slug(e.s); const target = slug(e.a);
      if (!screen && e.k !== 'slow' && e.k !== 'fail') continue;
      const ago = Math.min(Math.max(0, num(e.ago)), 10 * 60e3);   // how long before sending the step happened
      rows.push([store.nid(), user.id, sid, e.k, screen, target, Math.min(Math.max(0, Math.round(num(e.ms))), 3600e3), device, new Date(now - ago)]);
    }
    if (!rows.length) return { ok: true, saved: 0 };
    const vals = []; const params = [];
    rows.forEach((r, i) => { const o = i * 9; vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`); params.push(...r); });
    try { await q(`INSERT INTO usage_events(id, user_id, sid, kind, screen, target, ms, device, created_at) VALUES ${vals.join(',')}`, params); }
    catch (e) { console.error('usage intake', e.message); return { ok: true, saved: 0 }; }
    return { ok: true, saved: rows.length };
  }
  const prune = () => q("DELETE FROM usage_events WHERE created_at < now() - interval '90 days'").catch(() => {});

  // ---------- report ----------
  async function report(daysIn) {
    const days = [7, 14, 30, 60, 90].includes(Number(daysIn)) ? Number(daysIn) : 30;
    const P = [String(days)];
    const W = "created_at >= now() - ($1 || ' days')::interval";
    let tot;
    try { tot = (await q(`SELECT count(DISTINCT user_id) AS users, count(DISTINCT sid) AS sessions, count(*) FILTER (WHERE kind='view') AS views, count(*) FILTER (WHERE kind='act') AS acts, count(*) FILTER (WHERE kind='rage') AS rage, count(*) FILTER (WHERE kind='slow') AS slow, count(*) FILTER (WHERE kind='fail') AS fail, min(created_at) AS first FROM usage_events WHERE ${W}`, P)).rows[0]; }
    catch (e) { return empty(days, 'The usage table is not ready yet. It is created when the server restarts after the update.'); }
    if (!num(tot.users)) return empty(days, '');

    const [sess, daily, screens, trans, loops, firsts, exits, acts, rage, slow, fail, people, devices, newbies, retention] = await Promise.all([
      q(`SELECT avg(len) AS avg_len, avg(acts) AS avg_acts, avg(views) AS avg_views FROM (SELECT sid, extract(epoch FROM max(created_at) - min(created_at)) AS len, count(*) FILTER (WHERE kind='act') AS acts, count(*) FILTER (WHERE kind='view') AS views FROM usage_events WHERE ${W} GROUP BY sid) s`, P),
      q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, count(DISTINCT user_id) AS users, count(DISTINCT sid) AS sessions FROM usage_events WHERE ${W} GROUP BY 1 ORDER BY 1`, P),
      q(`SELECT screen, count(*) FILTER (WHERE kind='view') AS views, count(DISTINCT user_id) FILTER (WHERE kind='view') AS users, COALESCE(avg(ms) FILTER (WHERE kind='dwell'), 0) AS dwell, count(*) FILTER (WHERE kind='dwell') AS dn, count(*) FILTER (WHERE kind='dwell' AND ms < 5000) AS quick FROM usage_events WHERE ${W} AND screen <> '' GROUP BY screen ORDER BY views DESC`, P),
      q(`SELECT a, b, count(*) AS n, count(DISTINCT user_id) AS users FROM (SELECT user_id, screen AS b, lag(screen) OVER (PARTITION BY sid ORDER BY created_at, id) AS a FROM usage_events WHERE ${W} AND kind='view') t WHERE a IS NOT NULL AND a <> b GROUP BY a, b ORDER BY n DESC LIMIT 12`, P),
      q(`SELECT a, b, count(*) AS n, count(DISTINCT user_id) AS users FROM (SELECT user_id, screen AS c, lag(screen) OVER w AS b, lag(screen, 2) OVER w AS a FROM usage_events WHERE ${W} AND kind='view' WINDOW w AS (PARTITION BY sid ORDER BY created_at, id)) t WHERE a IS NOT NULL AND a = c AND a <> b GROUP BY a, b ORDER BY n DESC LIMIT 8`, P),
      q(`SELECT screen, count(*) AS n FROM (SELECT DISTINCT ON (sid) sid, screen FROM usage_events WHERE ${W} AND kind='view' ORDER BY sid, created_at, id) t GROUP BY screen ORDER BY n DESC LIMIT 8`, P),
      q(`SELECT screen, count(*) AS n FROM (SELECT DISTINCT ON (sid) sid, screen FROM usage_events WHERE ${W} AND kind='view' ORDER BY sid, created_at DESC, id DESC) t GROUP BY screen ORDER BY n DESC LIMIT 8`, P),
      q(`SELECT screen, target, count(*) AS n, count(DISTINCT user_id) AS users FROM usage_events WHERE ${W} AND kind='act' AND target <> '' GROUP BY screen, target ORDER BY n DESC LIMIT 25`, P),
      q(`SELECT screen, target, count(*) AS n, count(DISTINCT user_id) AS users FROM usage_events WHERE ${W} AND kind='rage' GROUP BY screen, target ORDER BY n DESC LIMIT 10`, P),
      q(`SELECT target, count(*) AS n, count(DISTINCT user_id) AS users, avg(ms) AS ms FROM usage_events WHERE ${W} AND kind='slow' GROUP BY target ORDER BY n DESC LIMIT 10`, P),
      q(`SELECT target, count(*) AS n, count(DISTINCT user_id) AS users FROM usage_events WHERE ${W} AND kind='fail' GROUP BY target ORDER BY n DESC LIMIT 10`, P),
      q(`SELECT e.user_id, u.name, u.email, u.created_at AS joined, count(DISTINCT e.sid) AS sessions, count(DISTINCT date_trunc('day', e.created_at)) AS active_days, count(*) FILTER (WHERE e.kind='view') AS views, count(*) FILTER (WHERE e.kind='act') AS acts, count(*) FILTER (WHERE e.kind='rage') AS rage, count(*) FILTER (WHERE e.kind='slow') AS slow, count(*) FILTER (WHERE e.kind='fail') AS fail, max(e.created_at) AS last_at, mode() WITHIN GROUP (ORDER BY e.device) AS device, count(DISTINCT e.screen) FILTER (WHERE e.kind='view') AS screens FROM usage_events e JOIN users u ON u.id = e.user_id WHERE e.${W} GROUP BY e.user_id, u.name, u.email, u.created_at ORDER BY sessions DESC, views DESC LIMIT 100`, P),
      q(`SELECT device, count(DISTINCT user_id) AS users, count(DISTINCT sid) AS sessions, count(*) FILTER (WHERE kind IN ('rage','slow','fail')) AS friction, count(*) AS steps FROM usage_events WHERE ${W} GROUP BY device`, P),
      q(`SELECT count(*) AS users, count(*) FILTER (WHERE NOT seen_project) AS stalled FROM (SELECT e.user_id, bool_or(e.kind='view' AND e.screen LIKE 'project:%') AS seen_project FROM usage_events e JOIN users u ON u.id = e.user_id WHERE e.${W} AND u.created_at >= now() - interval '14 days' GROUP BY e.user_id) t`, P),
      q(`SELECT count(*) AS users, count(*) FILTER (WHERE days >= 2) AS back FROM (SELECT user_id, count(DISTINCT date_trunc('day', created_at)) AS days FROM usage_events WHERE ${W} GROUP BY user_id) t`, P),
    ]);

    const users = num(tot.users);
    const seenScreens = new Map(screens.rows.map((r) => [r.screen, r]));
    const unused = Object.keys(SCREENS).filter((s) => !seenScreens.has(s)).map((s) => ({ screen: s, label: label(s) }));
    const sd = sess.rows[0] || {};
    const data = {
      days, generated_at: new Date().toISOString(), since: tot.first ? new Date(tot.first).toISOString() : null,
      kpis: {
        users, sessions: num(tot.sessions), avg_session_min: Math.round((num(sd.avg_len) / 60) * 10) / 10, avg_actions: Math.round(num(sd.avg_acts) * 10) / 10, avg_screens: Math.round(num(sd.avg_views) * 10) / 10,
        returning_pct: pct(num(retention.rows[0].back), num(retention.rows[0].users)), friction_events: num(tot.rage) + num(tot.slow) + num(tot.fail),
        rage: num(tot.rage), slow: num(tot.slow), fail: num(tot.fail),
      },
      daily: daily.rows.map((r) => ({ d: r.d, users: num(r.users), sessions: num(r.sessions) })),
      screens: screens.rows.map((r) => ({ screen: r.screen, label: label(r.screen), views: num(r.views), users: num(r.users), dwell_s: Math.round(num(r.dwell) / 1000), quick_pct: pct(num(r.quick), num(r.dn)) })),
      unused,
      transitions: trans.rows.map((r) => ({ from: label(r.a), to: label(r.b), count: num(r.n), users: num(r.users) })),
      loops: loops.rows.map((r) => ({ a: label(r.a), b: label(r.b), count: num(r.n), users: num(r.users) })),
      first_screens: firsts.rows.map((r) => ({ screen: r.screen, label: label(r.screen), count: num(r.n) })),
      exit_screens: exits.rows.map((r) => ({ screen: r.screen, label: label(r.screen), count: num(r.n) })),
      actions: acts.rows.map((r) => ({ screen: label(r.screen), target: r.target, name: nice(r.target), count: num(r.n), users: num(r.users), adoption_pct: pct(num(r.users), users) })),
      friction: {
        rage: rage.rows.map((r) => ({ screen: label(r.screen), target: r.target, name: nice(r.target), count: num(r.n), users: num(r.users) })),
        slow: slow.rows.map((r) => ({ target: r.target, count: num(r.n), users: num(r.users), avg_s: Math.round(num(r.ms) / 100) / 10 })),
        fail: fail.rows.map((r) => ({ target: r.target, count: num(r.n), users: num(r.users) })),
      },
      devices: devices.rows.map((r) => ({ device: r.device, users: num(r.users), sessions: num(r.sessions), friction_pct: pct(num(r.friction), num(r.steps)) })),
      people: people.rows.map((r) => ({ id: r.user_id, name: r.name, email: r.email, sessions: num(r.sessions), active_days: num(r.active_days), screens: num(r.screens), views: num(r.views), actions: num(r.acts), friction: num(r.rage) + num(r.slow) + num(r.fail), last_at: r.last_at ? new Date(r.last_at).toISOString() : null, device: r.device, is_new: Date.now() - new Date(r.joined).getTime() < 14 * DAY })),
      onboarding: { new_users: num(newbies.rows[0].users), stalled: num(newbies.rows[0].stalled) },
    };
    data.suggestions = suggest(data);
    return data;
  }

  function empty(days, note) {
    return { days, generated_at: new Date().toISOString(), since: null, empty: true, note, kpis: { users: 0, sessions: 0, avg_session_min: 0, avg_actions: 0, avg_screens: 0, returning_pct: 0, friction_events: 0, rage: 0, slow: 0, fail: 0 }, daily: [], screens: [], unused: [], transitions: [], loops: [], first_screens: [], exit_screens: [], actions: [], friction: { rage: [], slow: [], fail: [] }, devices: [], people: [], onboarding: { new_users: 0, stalled: 0 }, suggestions: [] };
  }

  // ---------- suggestions ----------
  // Plain rules over the numbers above. Each one needs the pattern from at least two different project managers, so a
  // single person's habit never becomes advice. Every suggestion carries its evidence so the admin can judge it.
  function suggest(d) {
    const out = []; const users = d.kpis.users;
    const add = (id, priority, area, title, evidence, action, affected) => out.push({ id, priority, area, title, evidence, action, users: affected });
    for (const f of d.friction.fail) if (f.users >= NEEDS_USERS || f.count >= 5) add('fail:' + f.target, f.users >= 3 ? 'high' : 'medium', 'Reliability', `Requests to ${f.target} keep failing`, `${f.count} failed calls hit ${f.users} project managers.`, 'Check the error log for this call, fix the cause, and show a clear message with a retry button instead of a plain failure.', f.users);
    for (const s of d.friction.slow) if (s.users >= NEEDS_USERS && s.count >= 3) add('slow:' + s.target, s.avg_s >= 4 ? 'high' : 'medium', 'Speed', `${s.target} feels slow`, `${s.count} slow calls averaging ${s.avg_s} seconds hit ${s.users} project managers.`, 'Profile this call, save only what changed, load the screen in parts, and keep the loading screen visible so people know the system is working.', s.users);
    for (const r of d.friction.rage) if (r.users >= NEEDS_USERS) add('rage:' + r.screen + r.target, 'high', 'Clarity', `People click ${r.name || 'an element'} on ${r.screen} again and again`, `${r.count} bursts of repeated clicks from ${r.users} project managers.`, 'The control looks clickable but gives no sign that it worked. Add immediate feedback, disable it while it runs, or make the result visible at once.', r.users);
    for (const s of d.screens) {
      const pass = s.screen === 'dashboard';
      if (!pass && s.views >= 6 && s.users >= NEEDS_USERS && s.quick_pct >= 60) add('quick:' + s.screen, 'medium', 'Value', `${s.label} is left within seconds`, `${s.quick_pct}% of visits to ${s.label} last under 5 seconds (${s.views} visits, ${s.users} project managers).`, 'Show the most useful figure or action in the first view, remove steps before the content, and check that the tab name says what is inside.', s.users);
    }
    for (const l of d.loops) if (l.users >= NEEDS_USERS && l.count >= 4) add('loop:' + l.a + l.b, 'medium', 'Flow', `People switch back and forth between ${l.a} and ${l.b}`, `${l.count} round trips from ${l.users} project managers.`, 'The two screens probably hold information that belongs together. Show the key figures of one inside the other or add a shortcut between them.', l.users);
    if (users >= 3) {
      for (const u of d.unused) if (u.screen !== 'billing' && u.screen !== 'brand') add('unused:' + u.screen, 'low', 'Discovery', `${u.label} was never opened`, `None of the ${users} active project managers opened it in the last ${d.days} days.`, 'Add a short hint or a first use tip near the places where people already work, or merge it into a screen they use.', 0);
      const chatOn = d.actions.filter((a) => /chat/.test(a.target)).reduce((m, a) => Math.max(m, a.users), 0);
      if (chatOn < Math.ceil(users * 0.3)) add('chat-adoption', 'medium', 'Discovery', 'The project chat is not widely used', `${chatOn} of ${users} project managers used the chat.`, 'Offer the chat at the moment of need, for example after a long manual edit, and show two example requests on first open.', users - chatOn);
    }
    if (d.onboarding.new_users >= NEEDS_USERS && pct(d.onboarding.stalled, d.onboarding.new_users) >= 30) add('onboarding', 'high', 'Onboarding', 'New project managers stall before opening a project', `${d.onboarding.stalled} of ${d.onboarding.new_users} accounts created in the last 14 days never opened a project.`, 'Guide the first session to one project: offer a sample project or a one click import, and show a single next step on the dashboard.', d.onboarding.stalled);
    if (users >= 3 && d.kpis.returning_pct < 40) add('returning', 'medium', 'Retention', 'Few project managers come back on another day', `${d.kpis.returning_pct}% of project managers were active on two or more days.`, 'Send a weekly digest of what changed and what needs attention, and put a due soon list at the top of the dashboard.', users);
    const phone = d.devices.find((x) => x.device === 'phone'); const desk = d.devices.find((x) => x.device === 'desktop');
    if (phone && phone.users >= NEEDS_USERS && (!desk || phone.friction_pct >= desk.friction_pct * 1.5 + 1)) add('phone', 'medium', 'Mobile', 'Phone sessions hit more friction than desktop', `${phone.friction_pct}% of phone steps were slow, failed or repeated clicks${desk ? ` against ${desk.friction_pct}% on desktop` : ''}.`, 'Review tap sizes, long tables and the schedule view on a small screen, and keep the most used actions within thumb reach.', phone.users);
    const topExit = d.exit_screens[0]; const sessions = d.kpis.sessions;
    if (topExit && sessions >= 10 && topExit.screen !== 'dashboard' && pct(topExit.count, sessions) >= 30) add('exit:' + topExit.screen, 'low', 'Flow', `${topExit.label} is where many sessions end`, `${pct(topExit.count, sessions)}% of sessions ended on ${topExit.label}.`, 'Check whether people finish their task there or get stuck. Add a clear next step or a summary of what was done.', 0);
    const rank = { high: 0, medium: 1, low: 2 };
    out.sort((a, b) => rank[a.priority] - rank[b.priority] || b.users - a.users);
    return out.slice(0, 20);
  }

  return { ingest, report, prune, suggest };
}

module.exports = { createUsage, SCREENS };
