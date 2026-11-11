// Request tracing without any extra package.
//
// Every request gets a root span, and every database query and outside call made while it runs becomes a child span.
// What this gives:
//   1. A Server-Timing header on each answer (total, database time and number of queries), which browser dev tools show.
//   2. A "slow request" line in the log when a request takes longer than SLOW_REQUEST_MS (default 1000), naming the route
//      with ids replaced and the slowest queries with their text trimmed. Query parameters and bodies are never recorded.
//   3. Optional OpenTelemetry export. Set OTEL_EXPORTER_OTLP_ENDPOINT (for example https://collector:4318) and spans are
//      sent in the standard OTLP over HTTP JSON format to /v1/traces. OTEL_EXPORTER_OTLP_HEADERS ("key=value,key2=value2"),
//      OTEL_SERVICE_NAME and OTEL_TRACES_SAMPLER_ARG (a share from 0 to 1, default 0.1) work as in the standard.
//      Slow requests and failed requests are always exported, whatever the share.
// Nothing here can fail a request: every call is wrapped and a failed export is dropped.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

const als = new AsyncLocalStorage();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const hex = (n) => crypto.randomBytes(n).toString('hex');

// a route as a person would group it: numbers and long tokens become :id
const routeOf = (p) => String(p || '').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:token').slice(0, 120);
const trimSql = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 140);

function config(env = process.env) {
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
  const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || (base ? base.replace(/\/+$/, '') + '/v1/traces' : '');
  const headers = {};
  for (const part of String(env.OTEL_EXPORTER_OTLP_HEADERS || '').split(',')) {
    const i = part.indexOf('='); if (i > 0) headers[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return {
    url,
    headers,
    service: env.OTEL_SERVICE_NAME || 'project-manager-ai',
    ratio: Math.min(1, Math.max(0, num(env.OTEL_TRACES_SAMPLER_ARG, 0.1))),
    slowMs: Math.max(50, num(env.SLOW_REQUEST_MS, 1000)),
    off: env.OTEL_SDK_DISABLED === 'true',
  };
}

const attr = (key, v) => {
  if (typeof v === 'number' && Number.isInteger(v)) return { key, value: { intValue: String(v) } };
  if (typeof v === 'number') return { key, value: { doubleValue: v } };
  if (typeof v === 'boolean') return { key, value: { boolValue: v } };
  return { key, value: { stringValue: String(v).slice(0, 300) } };
};
const nanos = (t) => (BigInt(Math.round((performance.timeOrigin + t) * 1000)) * 1000n).toString();

function createTracer(opts = {}) {
  const cfg = { ...config(opts.env), ...(opts.config || {}) };
  const log = opts.log || ((...a) => console.warn(...a));
  const send = opts.fetch || ((...a) => fetch(...a));
  let buffer = [], timer = null, exporting = false, dropped = 0;
  const MAX_BUFFER = 2000, MAX_SPANS = 400;   // spans kept for one request, so a long chat run cannot grow without limit

  function queue(spans) {
    if (!cfg.url || cfg.off) return;
    for (const s of spans) { if (buffer.length >= MAX_BUFFER) { dropped++; continue; } buffer.push(s); }
    if (buffer.length >= 200) flush().catch(() => {});
    else if (!timer) { timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 5000); if (timer.unref) timer.unref(); }
  }
  async function flush() {
    if (exporting || !buffer.length || !cfg.url) return;
    exporting = true;
    const batch = buffer.splice(0, 500);
    const body = { resourceSpans: [{ resource: { attributes: [attr('service.name', cfg.service)] }, scopeSpans: [{ scope: { name: 'project-manager-ai' }, spans: batch }] }] };
    try {
      const r = await send(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      if (r && r.status >= 400) log(`trace export refused with status ${r.status}`);
    } catch (e) { /* a collector that is down must not slow or break the app */ }
    finally { exporting = false; }
  }

  function makeSpan(trace, parent, name, kind, attrs) {
    return { traceId: trace.id, spanId: hex(8), parentSpanId: parent ? parent.spanId : '', name, kind, t0: performance.now(), t1: 0, attrs: attrs || {}, error: '' };
  }
  function finish(s) { if (!s.t1) s.t1 = performance.now(); return s; }
  function toOtlp(s) {
    return {
      traceId: s.traceId, spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: s.kind,
      startTimeUnixNano: nanos(s.t0), endTimeUnixNano: nanos(s.t1 || s.t0),
      attributes: Object.entries(s.attrs).map(([k, v]) => attr(k, v)),
      status: s.error ? { code: 2, message: String(s.error).slice(0, 200) } : { code: 1 },
    };
  }

  // Runs fn as a child span of the current request. Outside a request it just runs fn.
  function span(name, attrs, fn) {
    const ctx = als.getStore();
    if (!ctx) return fn();
    const s = makeSpan(ctx, ctx.cur, name, 3, attrs);
    if (ctx.spans.length < MAX_SPANS) ctx.spans.push(s);
    return als.run({ ...ctx, cur: s }, async () => {
      try { return await fn(); } catch (e) { s.error = e && e.message || 'error'; throw e; } finally { finish(s); }
    });
  }

  // Wraps a database object so each query is a span. Other members are passed through untouched.
  function instrumentDb(db) {
    const wrap = (q) => (text, params) => {
      const ctx = als.getStore();
      if (!ctx) return q(text, params);
      const s = makeSpan(ctx, ctx.cur, 'db.query', 3, { 'db.system': 'postgresql', 'db.statement': trimSql(text) });
      if (ctx.spans.length < MAX_SPANS) ctx.spans.push(s);
      let out;
      try { out = q(text, params); } catch (e) { s.error = e.message; finish(s); throw e; }
      return Promise.resolve(out).then((r) => { finish(s); return r; }, (e) => { s.error = e && e.message || 'error'; finish(s); throw e; });
    };
    const traced = Object.assign({}, db, { query: wrap((t, p) => db.query(t, p)) });
    if (db.tx) traced.tx = (fn) => db.tx((t) => fn(Object.assign({}, t, { query: wrap((x, p) => t.query(x, p)) })));
    return traced;
  }

  // Runs one request. headersTarget is the response, so Server-Timing can be added just before the headers go out.
  function request(req, res, run) {
    if (cfg.off) return run();
    const path = new URL(req.url, 'http://localhost').pathname;
    const route = routeOf(path);
    const trace = { id: hex(16), spans: [], cur: null };
    const root = makeSpan(trace, null, `${req.method} ${route}`, 2, { 'http.request.method': req.method, 'http.route': route });
    trace.cur = root; trace.spans.push(root);

    const wh = res.writeHead.bind(res);
    res.writeHead = function (status, ...rest) {
      try {
        if (!res.headersSent && !res.getHeader('Server-Timing')) {
          const db = trace.spans.filter((x) => x.name === 'db.query' && x.t1);
          const dbMs = db.reduce((a, x) => a + (x.t1 - x.t0), 0);
          const total = performance.now() - root.t0;
          res.setHeader('Server-Timing', `app;dur=${total.toFixed(1)}, db;dur=${dbMs.toFixed(1)};desc="${db.length} queries"`);
        }
      } catch (e) { /* the header is a convenience */ }
      return wh(status, ...rest);
    };
    res.on('close', () => {
      try {
        finish(root);
        const status = res.statusCode || 0;
        root.attrs['http.response.status_code'] = status;
        if (status >= 500) root.error = `HTTP ${status}`;
        const ms = root.t1 - root.t0;
        const db = trace.spans.filter((x) => x.name === 'db.query');
        const slow = ms >= cfg.slowMs;
        if (slow) {
          const worst = db.slice().sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0)).slice(0, 3).map((x) => ({ ms: Math.round(x.t1 - x.t0), sql: x.attrs['db.statement'] }));
          const outside = trace.spans.filter((x) => x.name !== 'db.query' && x !== root).map((x) => ({ name: x.name, ms: Math.round((x.t1 || performance.now()) - x.t0) }));
          log(JSON.stringify({ slow_request: `${req.method} ${route}`, status, ms: Math.round(ms), db_ms: Math.round(db.reduce((a, x) => a + (x.t1 - x.t0), 0)), db_queries: db.length, worst_queries: worst, outside }));
        }
        if (cfg.url && (slow || status >= 500 || Math.random() < cfg.ratio)) queue(trace.spans.map((x) => toOtlp(finish(x))));
      } catch (e) { /* tracing never fails a request */ }
    });
    return als.run(trace, run);
  }

  return { request, span, instrumentDb, flush, enabled: () => !!cfg.url && !cfg.off, config: cfg, stats: () => ({ buffered: buffer.length, dropped }) };
}

// One shared tracer for the process, so any module can add a span without being handed the tracer.
const shared = createTracer();
module.exports = { createTracer, shared, routeOf, config, als };
