'use strict';
// The widget marketplace: build, publish, find, add, rate and keep layouts. A widget is plain data (see
// public/widgetspec.js), so a widget published to everyone can only read the viewer's own projects through the fixed
// datasets built here. Nothing a widget author writes is ever run as code.
const MAX_WIDGETS_PER_PERSON = 50;
const MAX_ADDED_PER_SCOPE = 40;
const MAX_LAYOUTS_PER_SCOPE = 20;
const ROW_CAP = { tasks: 3000, default: 2000 };

module.exports = function createWidgets({ OF, on, ctx, err, store, WS, S, rawProject, stats, TODAY, P_, activeList }) {
  const q = (sql, params) => store.db.query(sql, params);
  const uid = () => ctx().user.id;
  const num = (v) => (v == null ? 0 : Number(v));
  const scopeOf = (v) => { if (!WS.SCOPES.includes(v)) throw err(400, 'Choose the portfolio overview or the project overview'); return v; };
  const idOf = (s) => Number(s);

  // A bad spec is the person's mistake, so it is reported as a plain 400 sentence.
  const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof WS.SpecError) throw err(400, e.message); throw e; } };
  const clean = (o) => JSON.parse(JSON.stringify(o)); // out of the sandbox realm, into plain objects

  // ---------- datasets: the rows a widget reads, from the signed in person's own projects ----------
  const LEVEL = { High: 3, Medium: 2, Low: 1 };
  const dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  // f is the overview filter. With one on, every dataset keeps only the rows inside the period and status, the same rows the
  // built in widgets read, so a widget a person added follows the top filters like every other widget.
  function datasetsFor(list, f) {
    const today = TODAY(), fOn = !!(f && (f.y || f.s));
    const out = { projects: [], tasks: [], payments: [], risks: [], deliverables: [] }, truncated = {};
    const push = (name, row) => { const cap = ROW_CAP[name] || ROW_CAP.default; if (out[name].length >= cap) { truncated[name] = true; return; } out[name].push(row); };
    for (const P of list) {
      const raw = rawProject(P), pname = P.p.name, mm = S.progressMetrics(P.tasks, raw, today);
      const sc = fOn ? OF.scope(P, f, mm.rows, today) : null;
      const st = sc ? OF.scopedStats(stats(P), sc, f) : stats(P);
      const keepItem = sc ? new Set(sc.items.map((i) => i.id)) : null;
      push('projects', {
        project_id: P.id, name: pname, client: P.p.client || '', health: st.health, status: P.p.status || '', progress: st.progress, planned: st.planned, spi: st.spi,
        overdue: st.overdue, pending_review: st.pendingItems + st.pendingInbox, value: P.p.value || 0, currency: P.p.currency || '',
        forecast_end: st.forecast_end || null, contract_end: P.p.end_date || null,
        slip_days: st.forecast_end && P.p.end_date ? Math.round(dnum(st.forecast_end) - dnum(P.p.end_date)) : null,
        days_left: P.p.end_date ? Math.round(dnum(P.p.end_date) - dnum(today)) : null,
      });
      for (const r of (sc ? sc.rows : mm.rows)) {
        const p = r.progress || 0;
        push('tasks', { project_id: P.id, project: pname, task_id: r.id, name: r.name, owner: r.assignee || '', start: r.start || null, finish: r.finish || null, duration: r.duration || 0, progress: p, status: p >= 100 ? 'done' : r.overdue ? 'late' : p > 0 ? 'active' : 'todo', critical: r.critical ? 'yes' : 'no', milestone: r.is_milestone ? 'yes' : 'no', days_late: r.overdue && r.finish ? Math.max(0, Math.round(dnum(today) - dnum(r.finish))) : 0 });
      }
      for (const i of P.items) {
        if (i.status === 'ignored') continue;
        if (keepItem && ['milestone', 'deliverable', 'risk'].includes(i.kind) && !keepItem.has(i.id)) continue;
        const d = i.data || {};
        if (i.kind === 'milestone') {
          const amount = d.amount != null ? d.amount : (d.percent != null && P.p.value ? Math.round((P.p.value * d.percent) / 100) : null);
          const state = i.state || 'pending';
          push('payments', { project_id: P.id, project: pname, item_id: i.id, title: i.title, due: d.due_date || null, amount, currency: P.p.currency || '', state, late: d.due_date && d.due_date < today && state === 'pending' ? 'yes' : 'no', days_late: d.due_date && d.due_date < today && state === 'pending' ? Math.round(dnum(today) - dnum(d.due_date)) : 0 });
        } else if (i.kind === 'risk') {
          push('risks', { project_id: P.id, project: pname, item_id: i.id, title: i.title, probability: d.probability || 'Medium', impact: d.impact || 'Medium', state: i.state || 'open', score: (LEVEL[d.probability] || 2) * (LEVEL[d.impact] || 2) });
        } else if (i.kind === 'deliverable') {
          const state = i.state === 'closed' ? 'closed' : 'open';
          push('deliverables', { project_id: P.id, project: pname, item_id: i.id, title: i.title, due: d.due_date || null, state, late: d.due_date && d.due_date < today && state !== 'closed' ? 'yes' : 'no', days_late: d.due_date && d.due_date < today && state !== 'closed' ? Math.round(dnum(today) - dnum(d.due_date)) : 0 });
        }
      }
    }
    return { today, datasets: out, truncated };
  }

  // ---------- reading widgets ----------
  // One query shape for every list. rating_sum and installs are counted here so a list is one round trip.
  const SELECT = `
    SELECT w.id, w.owner_id, u.name AS author, w.title, w.description, w.grp, w.status, w.version, w.published_at, w.updated_at,
      CASE WHEN w.owner_id = $1 THEN w.spec ELSE COALESCE(w.published_spec, w.spec) END AS run_spec,
      w.spec AS draft_spec, w.published_spec,
      COALESCE(r.n, 0)::int AS rating_count, COALESCE(r.sum, 0)::int AS rating_sum,
      COALESCE(i.n, 0)::int AS installs, COALESCE(mi.scopes, '') AS my_scopes, mr.stars AS my_rating, mr.comment AS my_comment,
      ((COALESCE(r.sum, 0) + 10.5) / (COALESCE(r.n, 0) + 3.0))::float8 AS score
    FROM widgets w
    JOIN users u ON u.id = w.owner_id
    LEFT JOIN (SELECT widget_id, SUM(stars) AS sum, COUNT(*) AS n FROM widget_ratings GROUP BY widget_id) r ON r.widget_id = w.id
    LEFT JOIN (SELECT widget_id, COUNT(DISTINCT user_id) AS n FROM widget_installs GROUP BY widget_id) i ON i.widget_id = w.id
    LEFT JOIN (SELECT widget_id, string_agg(scope, ',') AS scopes FROM widget_installs WHERE user_id = $1 GROUP BY widget_id) mi ON mi.widget_id = w.id
    LEFT JOIN widget_ratings mr ON mr.widget_id = w.id AND mr.user_id = $1`;

  const view = (r, full) => {
    const me = uid(), spec = r.run_spec || {}, scopes = String(r.my_scopes || '').split(',');
    const out = {
      id: r.id, title: r.title, description: r.description, group: r.grp, status: r.status, version: r.version, author: r.author, mine: r.owner_id === me,
      rating: { avg: r.rating_count ? Math.round((r.rating_sum / r.rating_count) * 10) / 10 : 0, count: r.rating_count }, installs: r.installs,
      added: { portfolio: scopes.includes('portfolio'), project: scopes.includes('project') }, my_rating: r.my_rating == null ? null : { stars: r.my_rating, comment: r.my_comment || '' },
      dataset: spec.dataset, viz: spec.viz, published_at: r.published_at, updated_at: r.updated_at,
    };
    if (full) {
      out.spec = clean(spec);
      if (r.owner_id === me) out.dirty = r.status !== 'draft' && JSON.stringify(r.draft_spec) !== JSON.stringify(r.published_spec);
    }
    return out;
  };
  const one = async (id) => (await q(SELECT + ' WHERE w.id = $2', [uid(), id])).rows[0] || null;
  // A person sees published widgets, their own widgets in any state, and the widgets they already added (even when the author has since unpublished them).
  const visible = (r) => r && (r.owner_id === uid() || r.status === 'published' || String(r.my_scopes || '') !== '');

  on('GET', '/api/widgets', async (m, query) => {
    const params = [uid()], where = ["w.status = 'published'"];
    const add = (v) => { params.push(v); return '$' + params.length; };
    if (query.group && WS.GROUPS.includes(query.group)) where.push('w.grp = ' + add(query.group));
    const term = String(query.q || '').trim().slice(0, 80);
    if (term) { const p = add('%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); where.push(`(w.title ILIKE ${p} OR w.description ILIKE ${p} OR u.name ILIKE ${p})`); }
    if (query.source === 'mine') where.push('w.owner_id = $1');
    if (query.source === 'added') where.push("COALESCE(mi.scopes, '') <> ''");
    const min = Number(query.min_rating);
    if (min >= 1 && min <= 5) where.push(`COALESCE(r.n, 0) > 0 AND (COALESCE(r.sum, 0)::float8 / COALESCE(r.n, 1)) >= ${add(min)}`);
    const order = { installs: 'installs DESC, score DESC', newest: 'w.published_at DESC NULLS LAST', name: 'lower(w.title) ASC' }[query.sort] || 'score DESC, installs DESC';
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 200);
    const rows = (await q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}, w.id DESC LIMIT ${limit + 1}`, params)).rows;
    return { widgets: rows.slice(0, limit).map((r) => view(r)), truncated: rows.length > limit };
  });

  on('GET', '/api/widgets/mine', async () => {
    const rows = (await q(SELECT + " WHERE w.owner_id = $1 ORDER BY (w.status = 'draft') DESC, w.updated_at DESC", [uid()])).rows;
    return { widgets: rows.map((r) => view(r, true)) };
  });

  // The widgets the person added to one overview, with the definition each one runs. The overviews read the same list.
  async function installedFor(userId, scope) {
    const rows = (await q(`
      SELECT w.id, w.title, w.description, w.grp, w.status, w.version, w.owner_id, u.name AS author,
        CASE WHEN w.owner_id = $1 THEN w.spec ELSE COALESCE(w.published_spec, w.spec) END AS run_spec
      FROM widget_installs i JOIN widgets w ON w.id = i.widget_id JOIN users u ON u.id = w.owner_id
      WHERE i.user_id = $1 AND i.scope = $2 ORDER BY i.added_at, w.id`, [userId, scope])).rows;
    return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, group: r.grp, status: r.status, version: r.version, author: r.author, mine: r.owner_id === userId, spec: clean(r.run_spec) }));
  }
  on('GET', '/api/widgets/installed', async (m, query) => ({ widgets: await installedFor(uid(), scopeOf(query.scope)) }));

  // What the overview pages append to their own payload: nothing at all unless the person added a widget there.
  async function extras(scope, list, f) {
    const widgets = await installedFor(uid(), scope);
    if (!widgets.length) return {};
    const { today, datasets, truncated } = datasetsFor(list, f);
    return { widgets, datasets, datasets_today: today, datasets_truncated: truncated };
  }

  on('GET', '/api/widgets/datasets', async (m, query) => {
    const list = query.project_id ? [P_(Number(query.project_id))] : activeList();
    return { scope: query.project_id ? 'project' : 'portfolio', ...datasetsFor(list) };
  });

  on('GET', '/api/widgets/(\\d+)', async (m) => {
    const r = await one(idOf(m[1]));
    if (!visible(r)) throw err(404, 'Widget not found');
    const reviews = (await q('SELECT r.user_id, r.stars, r.comment, r.updated_at, u.name FROM widget_ratings r JOIN users u ON u.id = r.user_id WHERE r.widget_id = $1 ORDER BY r.updated_at DESC LIMIT 20', [r.id])).rows;
    return { widget: view(r, true), reviews: reviews.map((x) => ({ name: x.name, stars: x.stars, comment: x.comment, at: x.updated_at, mine: x.user_id === uid() })) };
  });

  // ---------- building ----------
  const mineOr404 = async (id) => {
    const r = await one(id);
    if (!r || r.owner_id !== uid()) throw err(404, 'Widget not found');
    return r;
  };
  on('POST', '/api/widgets', async (m, query, b) => {
    const meta = guard(() => WS.meta(b)), spec = guard(() => WS.normalize(b.spec));
    const have = num((await q('SELECT count(*) AS c FROM widgets WHERE owner_id = $1', [uid()])).rows[0].c);
    if (have >= MAX_WIDGETS_PER_PERSON) throw err(400, `You can keep up to ${MAX_WIDGETS_PER_PERSON} widgets. Delete one you no longer use.`);
    const id = store.nid();
    await q('INSERT INTO widgets(id, owner_id, title, description, grp, spec) VALUES ($1, $2, $3, $4, $5, $6::jsonb)', [id, uid(), meta.title, meta.description, meta.group, JSON.stringify(spec)]);
    return { widget: view(await one(id), true) };
  });
  on('PUT', '/api/widgets/(\\d+)', async (m, query, b) => {
    const r = await mineOr404(idOf(m[1]));
    const meta = guard(() => WS.meta({ title: b.title != null ? b.title : r.title, description: b.description != null ? b.description : r.description, group: b.group != null ? b.group : r.grp }));
    const spec = b.spec != null ? guard(() => WS.normalize(b.spec)) : r.draft_spec;
    await q('UPDATE widgets SET title = $2, description = $3, grp = $4, spec = $5::jsonb, updated_at = now() WHERE id = $1', [r.id, meta.title, meta.description, meta.group, JSON.stringify(spec)]);
    return { widget: view(await one(r.id), true) };
  });
  // Publishing copies the draft to what everyone runs. A widget someone already added changes only when its author publishes again.
  on('POST', '/api/widgets/(\\d+)/publish', async (m) => {
    const r = await mineOr404(idOf(m[1]));
    const spec = guard(() => WS.normalize(r.draft_spec));
    await q("UPDATE widgets SET published_spec = $2::jsonb, status = 'published', version = CASE WHEN published_spec IS NULL THEN 1 ELSE version + 1 END, published_at = now(), updated_at = now() WHERE id = $1", [r.id, JSON.stringify(spec)]);
    return { widget: view(await one(r.id), true) };
  });
  on('POST', '/api/widgets/(\\d+)/unpublish', async (m) => {
    const r = await mineOr404(idOf(m[1]));
    if (r.status !== 'published') throw err(400, 'This widget is not published');
    await q("UPDATE widgets SET status = 'unpublished', updated_at = now() WHERE id = $1", [r.id]);
    return { widget: view(await one(r.id), true) };
  });
  on('DELETE', '/api/widgets/(\\d+)', async (m) => {
    const r = await mineOr404(idOf(m[1]));
    const others = num((await q('SELECT count(*) AS c FROM widget_installs WHERE widget_id = $1 AND user_id <> $2', [r.id, uid()])).rows[0].c);
    if (others) throw err(409, `${others} ${others === 1 ? 'person uses' : 'people use'} this widget. Unpublish it instead and it keeps working for them.`);
    await q('DELETE FROM widgets WHERE id = $1', [r.id]);
    return { ok: true };
  });

  // ---------- adding and removing ----------
  async function addTo(widgetRow, scope) {
    if (!(widgetRow.owner_id === uid() || widgetRow.status === 'published')) throw err(404, 'Widget not found');
    const added = num((await q('SELECT count(*) AS c FROM widget_installs WHERE user_id = $1 AND scope = $2', [uid(), scope])).rows[0].c);
    const already = (await q('SELECT 1 FROM widget_installs WHERE user_id = $1 AND widget_id = $2 AND scope = $3', [uid(), widgetRow.id, scope])).rows.length;
    if (!already && added >= MAX_ADDED_PER_SCOPE) throw err(400, `You can add up to ${MAX_ADDED_PER_SCOPE} custom widgets to one overview. Remove one first.`);
    await q('INSERT INTO widget_installs(user_id, widget_id, scope) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [uid(), widgetRow.id, scope]);
  }
  on('POST', '/api/widgets/(\\d+)/install', async (m, query, b) => {
    const r = await one(idOf(m[1]));
    if (!visible(r)) throw err(404, 'Widget not found');
    await addTo(r, scopeOf(b.scope));
    return { widget: view(await one(r.id)) };
  });
  on('DELETE', '/api/widgets/(\\d+)/install', async (m, query) => {
    const id = idOf(m[1]);
    if (query.scope) await q('DELETE FROM widget_installs WHERE user_id = $1 AND widget_id = $2 AND scope = $3', [uid(), id, scopeOf(query.scope)]);
    else await q('DELETE FROM widget_installs WHERE user_id = $1 AND widget_id = $2', [uid(), id]);
    const r = await one(id);
    return { widget: visible(r) ? view(r) : null };
  });
  // Applying a saved layout adds every widget it names that is still available, and reports the ones that are gone.
  on('POST', '/api/widgets/install-many', async (m, query, b) => {
    const scope = scopeOf(b.scope), ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 80);
    const installed = [], missing = [];
    for (const id of ids) {
      const r = await one(id);
      if (r && String(r.my_scopes || '').split(',').includes(scope)) installed.push(id);
      else if (r && (r.owner_id === uid() || r.status === 'published')) { try { await addTo(r, scope); installed.push(id); } catch (e) { missing.push(id); } } else missing.push(id);
    }
    return { installed, missing };
  });

  // ---------- ratings ----------
  on('PUT', '/api/widgets/(\\d+)/rating', async (m, query, b) => {
    const r = await one(idOf(m[1]));
    if (!visible(r) || r.status === 'draft') throw err(404, 'Widget not found');
    if (r.owner_id === uid()) throw err(403, 'You cannot rate your own widget');
    if (!String(r.my_scopes || '')) throw err(403, 'Add the widget to an overview before you rate it');
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw err(400, 'Choose from 1 to 5 stars');
    const comment = String(b.comment == null ? '' : b.comment).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (comment.length > 280) throw err(400, 'The comment is too long (at most 280 characters)');
    await q('INSERT INTO widget_ratings(widget_id, user_id, stars, comment) VALUES ($1, $2, $3, $4) ON CONFLICT (widget_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = now()', [r.id, uid(), stars, comment]);
    return { widget: view(await one(r.id)) };
  });
  on('DELETE', '/api/widgets/(\\d+)/rating', async (m) => {
    await q('DELETE FROM widget_ratings WHERE widget_id = $1 AND user_id = $2', [idOf(m[1]), uid()]);
    const r = await one(idOf(m[1]));
    return { widget: visible(r) ? view(r) : null };
  });

  // ---------- saved layouts ----------
  const ID_RE = /^[A-Za-z0-9_]{1,40}$/, SIZES = ['s', 'm', 'l'];
  function layoutOf(raw) {
    if (!raw || typeof raw !== 'object') throw err(400, 'The layout is missing');
    const list = (v, label) => {
      if (!Array.isArray(v) || v.length > 80) throw err(400, `The ${label} list is not valid`);
      const out = []; for (const id of v) { if (typeof id !== 'string' || !ID_RE.test(id)) throw err(400, `The ${label} list is not valid`); if (!out.includes(id)) out.push(id); }
      return out;
    };
    const order = list(raw.order, 'widget order'), hidden = list(raw.hidden || [], 'hidden widget');
    const size = {};
    for (const [k, v] of Object.entries(raw.size && typeof raw.size === 'object' ? raw.size : {})) { if (ID_RE.test(k) && SIZES.includes(v)) size[k] = v; }
    return { order, hidden, size };
  }
  const nameOf = (v) => {
    const n = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) throw err(400, 'Enter a name for the layout');
    if (n.length > 40) throw err(400, 'The name is too long (at most 40 characters)');
    return n;
  };
  const layoutView = (r) => ({ id: r.id, scope: r.scope, name: r.name, layout: r.layout, updated_at: r.updated_at });
  const layoutRow = async (id) => { const r = (await q('SELECT * FROM dash_layouts WHERE id = $1 AND user_id = $2', [id, uid()])).rows[0]; if (!r) throw err(404, 'Layout not found'); return r; };
  const nameTaken = async (scope, name, exceptId) => (await q('SELECT id FROM dash_layouts WHERE user_id = $1 AND scope = $2 AND lower(name) = lower($3) AND id <> $4', [uid(), scope, name, exceptId || 0])).rows.length > 0;

  on('GET', '/api/layouts', async (m, query) => ({ layouts: (await q('SELECT * FROM dash_layouts WHERE user_id = $1 AND scope = $2 ORDER BY lower(name)', [uid(), scopeOf(query.scope)])).rows.map(layoutView) }));
  on('POST', '/api/layouts', async (m, query, b) => {
    const scope = scopeOf(b.scope), name = nameOf(b.name), layout = layoutOf(b.layout);
    if (num((await q('SELECT count(*) AS c FROM dash_layouts WHERE user_id = $1 AND scope = $2', [uid(), scope])).rows[0].c) >= MAX_LAYOUTS_PER_SCOPE) throw err(400, `You can save up to ${MAX_LAYOUTS_PER_SCOPE} layouts. Delete one you no longer use.`);
    if (await nameTaken(scope, name)) throw err(409, 'A layout with this name already exists');
    const id = store.nid();
    await q('INSERT INTO dash_layouts(id, user_id, scope, name, layout) VALUES ($1, $2, $3, $4, $5::jsonb)', [id, uid(), scope, name, JSON.stringify(layout)]);
    return { layout: layoutView(await layoutRow(id)) };
  });
  on('PUT', '/api/layouts/(\\d+)', async (m, query, b) => {
    const r = await layoutRow(idOf(m[1]));
    const name = b.name != null ? nameOf(b.name) : r.name, layout = b.layout != null ? layoutOf(b.layout) : r.layout;
    if (name.toLowerCase() !== String(r.name).toLowerCase() && (await nameTaken(r.scope, name, r.id))) throw err(409, 'A layout with this name already exists');
    await q('UPDATE dash_layouts SET name = $2, layout = $3::jsonb, updated_at = now() WHERE id = $1', [r.id, name, JSON.stringify(layout)]);
    return { layout: layoutView(await layoutRow(r.id)) };
  });
  on('DELETE', '/api/layouts/(\\d+)', async (m) => {
    const r = await layoutRow(idOf(m[1]));
    await q('DELETE FROM dash_layouts WHERE id = $1', [r.id]);
    return { ok: true };
  });

  return { extras, installedFor, datasetsFor };
};
