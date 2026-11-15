/* Chart drawers for custom widgets: gauge, waterfall, stacked, 100 percent, clustered, multi line, heat map, pivot,
   scatter and pie. renderSpec in app_widgets.js computes the numbers and the labels and hands them over in x.
   Each drawer returns { html, csv } or { empty: true }. Numbers are HTML, or SVG drawn at the real width, so text keeps its size. */
(function () {
  const PM = window.PM;
  const { esc, t } = PM;
  const SER = ['wx-s1', 'wx-s2', 'wx-s3', 'wx-s4'];
  const serCls = (key, i) => (key === '__other' ? 'wx-s0' : SER[i % 4]);
  const legend = (items) => `<div class="wx-legend">${items.map(([cls, label]) => `<span class="${cls}"><i class="wx-sw"></i>${esc(label)}</span>`).join('')}</div>`;
  const niceMax = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const pctH = (v, max) => Math.max(0, Math.min(100, max ? (v / max) * 100 : 0)).toFixed(1);
  const tip = (s) => esc(s);

  // A dashed target line across the plot, drawn once per column so it reads as one line
  const targetLine = (x, max, last) => (x.spec.target != null && x.spec.target <= max ? `<i class="wx-target" style="bottom:${pctH(x.spec.target, max)}%">${last ? `<b>${esc(t('wk_target', { v: x.fmtPlain(x.spec.target) }))}</b>` : ''}</i>` : '');

  function gauge(x) {
    const { res } = x;
    if (res.value == null) return { empty: true };
    const pct = Math.max(0, Math.min(100, (res.value / res.max) * 100)), d = 'M 10 90 A 80 80 0 0 1 170 90';
    const tone = res.tone ? `<span class="wk-mark k-${res.tone}"><i></i>${esc(t('wk_tone_' + res.tone))}</span>` : '';
    const html = `<div class="wx-gauge ${res.tone ? 'k-' + res.tone : ''}" role="img" aria-label="${esc(x.aria)}"><svg viewBox="0 0 180 100" aria-hidden="true"><path class="wx-g-track" d="${d}" pathLength="100"/><path class="wx-g-val" d="${d}" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100"/></svg><div class="wx-g-num"><b class="wk-v">${esc(x.fmt(res.value))}</b><span class="small muted">${esc(t('wk_gauge_of', { max: x.fmtPlain(res.max) }))}</span>${tone}</div></div>${x.ruleLegend()}<div class="small muted wk-note">${esc(t('wk_rows_n', { n: x.num(res.count) }))}</div>`;
    return { html, csv: [[x.title, x.metric], [x.fmt(res.value), x.fmtPlain(res.max)]] };
  }

  function waterfall(x) {
    const { res } = x, steps = res.steps;
    if (!steps.length) return { empty: true };
    const all = steps.flatMap((s) => [s.start, s.end]).concat([0, res.sum]);
    const lo = Math.min(0, ...all), hi = Math.max(1, ...all), span = hi - lo || 1, pos = (v) => ((v - lo) / span) * 100;
    const bar = (a, b, cls) => `<i class="wx-float ${cls}" style="bottom:${pos(Math.min(a, b)).toFixed(1)}%;height:${Math.max(1, Math.abs(pos(b) - pos(a))).toFixed(1)}%"></i>`;
    const cols = steps.map((s) => `<div class="wx-col" data-tip="${tip(`${x.name(s)}: ${x.fmt(s.value)} (${t('wk_rows_n', { n: x.num(s.count) })})`)}"><span class="wx-v">${esc(x.fmt(s.value))}</span><span class="wx-plot">${bar(s.start, s.end, s.value < 0 ? 'k-bad' : 'k-good')}</span><span class="wk-cl">${esc(x.name(s))}</span></div>`).join('');
    const total = `<div class="wx-col" data-tip="${tip(`${t('wk_total')}: ${x.fmt(res.sum)}`)}"><span class="wx-v"><b>${esc(x.fmt(res.sum))}</b></span><span class="wx-plot">${bar(0, res.sum, 'k-info')}</span><span class="wk-cl">${esc(t('wk_total'))}</span></div>`;
    return { html: `<div class="wx-cols" role="img" aria-label="${esc(x.aria)}">${cols}${total}</div>`, csv: [[x.groupLabel, x.metric, t('wk_running')], ...steps.map((s) => [x.name(s), s.value, s.end]), [t('wk_total'), res.sum, res.sum]] };
  }

  function pie(parts) {
    const total = parts.reduce((a, p) => a + p.v, 0), R = 70, C = 75;
    if (!(total > 0)) return '';
    if (parts.length === 1) return `<svg viewBox="0 0 150 150" aria-hidden="true"><circle class="wx-pie ${parts[0].cls}" cx="${C}" cy="${C}" r="${R}" data-tip="${tip(parts[0].tip)}"/></svg>`;
    let a0 = -Math.PI / 2;
    const paths = parts.map((p) => {
      const a1 = a0 + (p.v / total) * 2 * Math.PI, large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${C} ${C} L${(C + R * Math.cos(a0)).toFixed(2)} ${(C + R * Math.sin(a0)).toFixed(2)} A${R} ${R} 0 ${large} 1 ${(C + R * Math.cos(a1)).toFixed(2)} ${(C + R * Math.sin(a1)).toFixed(2)} Z`;
      a0 = a1;
      return `<path class="wx-pie ${p.cls}" d="${d}" data-tip="${tip(p.tip)}"/>`;
    }).join('');
    return `<svg viewBox="0 0 150 150" aria-hidden="true">${paths}</svg>`;
  }

  function scatter(x) {
    const { res, spec } = x, pts = res.points;
    if (pts.length < 2) return { empty: true, need: 2 };
    const Wd = Math.max(240, Math.round(x.h.width())), Ht = 250, L = 50, R = 14, T = 14, B = 40, pw = Wd - L - R, ph = Ht - T - B;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const xlo = Math.min(0, ...xs), ylo = Math.min(0, ...ys), xhi = Math.max(xlo + 1, niceMax(Math.max(...xs))), yhi = Math.max(ylo + 1, niceMax(Math.max(...ys)));
    const px = (v) => L + ((v - xlo) / (xhi - xlo)) * pw, py = (v) => T + ph - ((v - ylo) / (yhi - ylo)) * ph;
    let g = '';
    [ylo, (ylo + yhi) / 2, yhi].forEach((v) => { g += `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/><text x="${L - 6}" y="${(py(v) + 4).toFixed(1)}" text-anchor="end" direction="ltr">${esc(x.short(v))}</text>`; });
    [xlo, (xlo + xhi) / 2, xhi].forEach((v) => { g += `<text x="${px(v).toFixed(1)}" y="${T + ph + 16}" text-anchor="middle" direction="ltr">${esc(x.short(v))}</text>`; });
    g += `<text x="${L + pw / 2}" y="${Ht - 6}" text-anchor="middle">${esc(x.fieldLabel(spec.x))}</text><text x="${L}" y="${T - 2}" text-anchor="start">${esc(x.fieldLabel(spec.y))}</text>`;
    if (res.trend) {
      const y1 = res.trend.slope * xlo + res.trend.intercept, y2 = res.trend.slope * xhi + res.trend.intercept;
      g += `<line class="wx-trend" x1="${px(xlo).toFixed(1)}" y1="${py(Math.max(ylo, Math.min(yhi, y1))).toFixed(1)}" x2="${px(xhi).toFixed(1)}" y2="${py(Math.max(ylo, Math.min(yhi, y2))).toFixed(1)}"/>`;
    }
    g += pts.map((p) => {
      const i = res.colors.indexOf(p.c), cls = i < 0 ? 'wx-s1' : i > 3 ? 'wx-s0' : SER[i];
      return `<circle class="wx-dot ${cls}" cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="5" data-tip="${tip(`${p.name ? p.name + ': ' : ''}${x.fieldLabel(spec.x)} ${x.fmtPlain(p.x)}, ${x.fieldLabel(spec.y)} ${x.fmtPlain(p.y)}`)}"/>`;
    }).join('');
    const lg = spec.colorBy && spec.legend !== false ? legend(res.colors.slice(0, 4).map((c, i) => [SER[i], c === '' ? t('wk_blank') : x.valueLabel(c)]).concat(res.colors.length > 4 ? [['wx-s0', t('wk_other')]] : [])) : '';
    const tr = res.trend ? legend([['', t('wk_trendline')]]).replace('<i class="wx-sw"></i>', '<i class="wx-sw" style="height:2px"></i>') : '';
    return { html: `<svg class="viz wx-svg" viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}" role="img" aria-label="${esc(x.aria)}">${g}</svg>${lg}${tr}`, csv: [[x.fieldLabel(spec.x), x.fieldLabel(spec.y), x.fieldLabel(spec.colorBy || spec.y)].slice(0, spec.colorBy ? 3 : 2), ...pts.map((p) => (spec.colorBy ? [p.x, p.y, p.c] : [p.x, p.y]))] };
  }

  function matrix(x) {
    const { res, spec } = x, cats = res.cats, series = res.series, viz = spec.viz;
    if (!cats.length || !series.length) return { empty: true };
    const names = series.map((s, i) => x.ser(s, i)), cname = cats.map((c) => x.name(c));
    const csv = [[x.groupLabel, ...names], ...cats.map((c, ci) => [cname[ci], ...series.map((s) => s.values[ci])])];
    const lg = spec.legend === false || series.length < 2 ? '' : legend(series.map((s, i) => [serCls(s.key, i), names[i]]));
    const tipOf = (ci) => `<b>${esc(cname[ci])}</b>${series.map((s, i) => `<br>${esc(names[i])}: ${esc(x.fv(s.values[ci], i))}`).join('')}<br>${esc(t('wk_rows_n', { n: x.num(cats[ci].count) }))}`;
    const aria = esc(x.aria);

    if (viz === 'stacked' || viz === 'pct') {
      const totals = cats.map((_, ci) => series.reduce((a, s) => a + Math.max(s.values[ci], 0), 0));
      const max = viz === 'pct' ? 100 : Math.max(1, ...totals, spec.target || 0);
      const html = cats.map((c, ci) => {
        const segs = series.map((s, i) => { const v = Math.max(s.values[ci], 0); return v > 0 ? `<i class="wx-seg ${serCls(s.key, i)}" style="flex:${v} 1 0">${cats.length <= 8 && series.length <= 4 && totals[ci] && v / totals[ci] >= 0.18 ? esc(x.short(v, i)) : ''}</i>` : ''; }).join('');
        return `<div class="wx-col" data-tip="${tipOf(ci).replace(/"/g, '&quot;')}"><span class="wx-v">${viz === 'pct' ? '' : esc(x.fmt(totals[ci]))}</span><span class="wx-plot"><span class="wx-stack" style="height:${pctH(totals[ci], max)}%">${segs}</span>${viz === 'stacked' ? targetLine(x, max, ci === cats.length - 1) : ''}</span><span class="wk-cl">${esc(cname[ci])}</span></div>`;
      }).join('');
      return { html: `<div class="wx-cols" role="img" aria-label="${aria}">${html}</div>${lg}`, csv };
    }

    if (viz === 'stackedbar') {
      const totals = cats.map((_, ci) => series.reduce((a, s) => a + Math.max(s.values[ci], 0), 0)), max = Math.max(1, ...totals);
      const html = cats.map((c, ci) => `<div class="wx-row" data-tip="${tipOf(ci).replace(/"/g, '&quot;')}"><span class="wx-name">${esc(cname[ci])}</span><span class="wx-track"><span class="wx-inner" style="width:${pctH(totals[ci], max)}%">${series.map((s, i) => (s.values[ci] > 0 ? `<i class="wx-hseg ${serCls(s.key, i)}" style="flex:${s.values[ci]} 1 0"></i>` : '')).join('')}</span></span><span class="wx-val">${esc(x.fmt(totals[ci]))}</span></div>`).join('');
      return { html: `<div class="wx-rows" role="img" aria-label="${aria}">${html}</div>${lg}`, csv };
    }

    if (viz === 'cluster') {
      const max = Math.max(1, ...series.flatMap((s) => s.values), spec.target || 0);
      const html = cats.map((c, ci) => `<div class="wx-col" data-tip="${tipOf(ci).replace(/"/g, '&quot;')}"><span class="wx-v"></span><span class="wx-plot"><span class="wx-group">${series.map((s, i) => `<i class="wx-gbar ${serCls(s.key, i)}" style="height:${pctH(Math.max(s.values[ci], 0), max)}%"></i>`).join('')}</span>${targetLine(x, max, ci === cats.length - 1)}</span><span class="wk-cl">${esc(cname[ci])}</span></div>`).join('');
      return { html: `<div class="wx-cols" role="img" aria-label="${aria}">${html}</div>${lg}`, csv };
    }

    if (viz === 'lines') {
      if (cats.length < 2) return { empty: true, need: 2 };
      const n = cats.length, Wd = Math.max(240, Math.round(x.h.width())), Ht = 220, L = 46, R = 14, T = 14, B = 34, pw = Wd - L - R, ph = Ht - T - B, band = pw / n;
      const all = series.flatMap((s) => s.values).concat(spec.target != null ? [spec.target] : []);
      const hi = niceMax(Math.max(1, ...all)), lo = Math.min(0, ...all);
      const px = (i) => L + band * (i + 0.5), py = (v) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
      let g = [lo, (lo + hi) / 2, hi].map((v) => `<line class="tl-grid" x1="${L}" x2="${L + pw}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/><text x="${L - 6}" y="${(py(v) + 4).toFixed(1)}" text-anchor="end" direction="ltr">${esc(x.short(v, 0))}</text>`).join('');
      const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 58))));
      cats.forEach((c, i) => { if (i % step === 0 || (i === n - 1 && step === 1)) g += `<text x="${px(i).toFixed(1)}" y="${Ht - 12}" text-anchor="middle" direction="ltr">${esc(x.clip(cname[i], 9))}</text>`; });
      if (spec.target != null) g += `<line class="wx-ref" x1="${L}" x2="${L + pw}" y1="${py(spec.target).toFixed(1)}" y2="${py(spec.target).toFixed(1)}"/><text x="${L + pw}" y="${(py(spec.target) - 4).toFixed(1)}" text-anchor="end" direction="ltr">${esc(t('wk_target', { v: x.fmtPlain(spec.target) }))}</text>`;
      series.forEach((s, si) => {
        const cls = serCls(s.key, si), path = s.values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join('');
        g += `<path class="wx-line ${cls}" d="${path}"/>` + s.values.map((v, i) => `<circle class="wx-dot ${cls}" cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="4"/>`).join('');
      });
      cats.forEach((c, i) => { g += `<rect class="wk-hit" x="${(L + band * i).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${ph}" data-tip="${tipOf(i).replace(/"/g, '&quot;')}"/>`; });
      return { html: `<svg class="viz wx-svg" viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}" role="img" aria-label="${aria}">${g}</svg>${lg}`, csv };
    }

    // heat map and pivot table share one grid: groups down, series across
    const lim = !!x.limit, hasTot = viz === 'pivot' && !res.showAs && res.rowTotals && res.colTotals;
    const peak = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
    const head = `<tr><th></th>${names.map((n) => `<th class="num">${esc(n)}</th>`).join('')}${hasTot ? `<th class="num">${esc(t('wk_total'))}</th>` : ''}</tr>`;
    const body = cats.map((c, ci) => `<tr class="${lim && ci >= 5 ? 'wk-extra' : ''}" ${lim && ci >= 5 ? 'hidden' : ''}><th class="row" scope="row">${esc(cname[ci])}</th>${series.map((s, i) => { const v = s.values[ci]; return `<td class="num wx-cell" ${viz === 'heatmap' ? `style="--hv:${v ? Math.max(6, Math.round((Math.abs(v) / peak) * 46)) : 0}%"` : ''} data-tip="${tip(`${cname[ci]}, ${names[i]}: ${x.fv(v, i)}`)}">${esc(x.fv(v, i))}</td>`; }).join('')}${hasTot ? `<td class="num wx-tot">${esc(x.fvTotal(res.rowTotals[ci]))}</td>` : ''}</tr>`).join('');
    const foot = hasTot ? `<tfoot><tr><td>${esc(t('wk_total'))}</td>${res.colTotals.map((v) => `<td class="num">${esc(x.fvTotal(v))}</td>`).join('')}<td class="num">${esc(x.fvTotal(res.grand))}</td></tr></tfoot>` : '';
    const more = lim && cats.length > 5 ? `<button class="btn sm ghost wk-more" type="button" data-wk-more>${esc(t('wk_more'))}</button>` : '';
    return { html: `<div class="table-wrap"><table class="wk-table wx-heat" aria-label="${aria}"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>${more}`, csv, more: !!more };
  }

  PM.wchart = { gauge, waterfall, scatter, matrix, pie, legend, niceMax };
})();
