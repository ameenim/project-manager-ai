// Reads a client's Word or PowerPoint template and turns it into a brand: colors, fonts, logo, headings.
// The files are zip packages, so the theme, the styles and the header parts are read directly.
// Claude (when a key is set) decides which color plays which role. Without it, plain rules do the same job.
'use strict';
const path = require('path');
const JSZip = require('jszip');

// ---------- color helpers ----------
const clean = (v) => String(v || '').replace(/^#/, '').toUpperCase();
const isHex = (v) => /^[0-9A-F]{6}$/.test(clean(v));
const rgb = (h) => [0, 2, 4].map((i) => parseInt(clean(h).slice(i, i + 2), 16));
const toHex = (a) => a.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function hsl(h) {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = (hh * 60 + 360) % 360;
  return { h: hh, s, l };
}
const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0)); };
// darken until the color can carry text on white
function readable(h, min) { let c = clean(h); for (let i = 0; i < 30 && contrast(c, 'FFFFFF') < min; i++) c = mix(c, '000000', 0.12); return c; }

// ---------- zip and xml helpers ----------
const ent = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (s, n) => { const m = String(s).match(new RegExp(`(?:^|\\s)${n}="([^"]*)"`)); return m ? ent(m[1]) : null; };
const textOf = (xml, tag) => { const out = []; const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'); let m; while ((m = re.exec(xml))) out.push(ent(m[1])); return out.join(''); };
const read = async (zip, p) => { const f = zip.file(p); return f ? f.async('string') : ''; };
const names = (zip, re) => Object.keys(zip.files).filter((n) => !zip.files[n].dir && re.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const THEME_COLORS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink'];
function parseTheme(xml) {
  const out = { colors: {}, fonts: { major: '', minor: '' } };
  const block = (xml.match(/<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/) || [])[1] || '';
  for (const n of THEME_COLORS) {
    const m = block.match(new RegExp(`<a:${n}>\\s*<a:(srgbClr|sysClr)([^>]*?)/?>`));
    if (!m) continue;
    const v = m[1] === 'sysClr' ? attr(m[2], 'lastClr') : attr(m[2], 'val');
    if (v && isHex(v)) out.colors[n] = clean(v);
  }
  const f = (tag) => { const m = xml.match(new RegExp(`<a:${tag}>\\s*<a:latin typeface="([^"]*)"`)); return m ? ent(m[1]) : ''; };
  out.fonts.major = f('majorFont'); out.fonts.minor = f('minorFont');
  return out;
}
const SCHEME_MAP = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2', dk1: 'dk1', lt1: 'lt1', dk2: 'dk2', lt2: 'lt2', hlink: 'hlink' };
for (let i = 1; i <= 6; i++) SCHEME_MAP['accent' + i] = 'accent' + i;
const themeColor = (theme, n) => theme.colors[SCHEME_MAP[n] || n] || null;
const wordTheme = (n) => ({ accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2', dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2' }[n] || null);

// ---------- images ----------
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
function imageSize(buf, ext) {
  try {
    if (ext === 'png' && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === 'gif' && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (ext === 'svg') {
      const s = buf.toString('utf8', 0, 2000);
      const vb = s.match(/viewBox="[\d.\s-]*?([\d.]+)[\s,]+([\d.]+)"/);
      if (vb) return { w: Math.round(+vb[1]), h: Math.round(+vb[2]) };
      const w = s.match(/\swidth="([\d.]+)/), h = s.match(/\sheight="([\d.]+)/);
      if (w && h) return { w: Math.round(+w[1]), h: Math.round(+h[1]) };
    }
  } catch (e) { /* unknown size */ }
  return null;
}
async function relImages(zip, relPath) {
  const xml = await read(zip, relPath);
  if (!xml) return [];
  const baseDir = path.posix.dirname(path.posix.dirname(relPath)); // the folder of the part that owns this rels file
  const out = [];
  const re = /<Relationship\s[^>]*>/g; let m;
  while ((m = re.exec(xml))) {
    if (!/relationships\/image"/.test(m[0]) || /TargetMode="External"/.test(m[0])) continue;
    const t = attr(m[0], 'Target'); if (!t) continue;
    const full = t.startsWith('/') ? t.slice(1) : path.posix.normalize(path.posix.join(baseDir, t));
    if (zip.file(full)) out.push(full);
  }
  return out;
}
const MAX_LOGO = 700 * 1024;
async function pickLogo(zip, candidates, warnings) {
  let sawUnsupported = false, sawBig = false;
  for (const c of candidates) {
    const ext = path.posix.extname(c).slice(1).toLowerCase();
    if (!MIME[ext]) { sawUnsupported = true; continue; }
    const buf = await zip.file(c).async('nodebuffer');
    const sz = imageSize(buf, ext);
    if (sz && (sz.w < 24 || sz.h < 12)) continue;                      // a bullet or a rule, not a logo
    if (sz && sz.w >= 1600 && sz.w / sz.h > 1.5) continue;             // a full page or slide background
    if (buf.length > MAX_LOGO) { sawBig = true; continue; }
    return { mime: MIME[ext], dataUrl: `data:${MIME[ext]};base64,${buf.toString('base64')}`, w: sz ? sz.w : 0, h: sz ? sz.h : 0, source: c };
  }
  if (sawBig) warnings.push('logo_too_large');
  else if (sawUnsupported) warnings.push('logo_format');
  return null;
}

// ---------- reading a Word file ----------
async function readWord(zip, theme, warnings) {
  const styles = await read(zip, 'word/styles.xml');
  const doc = await read(zip, 'word/document.xml');
  const fontOf = (rPr) => {
    const rf = (rPr.match(/<w:rFonts\s([^>]*)\/?>/) || [])[1]; if (!rf) return '';
    const direct = attr(rf, 'w:ascii') || attr(rf, 'w:hAnsi');
    if (direct) return direct;
    const th = attr(rf, 'w:asciiTheme') || attr(rf, 'w:hAnsiTheme') || '';
    return /^major/i.test(th) ? theme.fonts.major : /^minor/i.test(th) ? theme.fonts.minor : '';
  };
  const colorOf = (rPr) => {
    const c = (rPr.match(/<w:color\s([^>]*)\/?>/) || [])[1]; if (!c) return null;
    const v = attr(c, 'w:val'); if (v && isHex(v)) return clean(v);
    const tc = attr(c, 'w:themeColor'); const n = tc && wordTheme(tc);
    return n ? themeColor(theme, n) : null;
  };
  const info = {};
  const sty = {};
  const re = /<w:style\s([^>]*)>([\s\S]*?)<\/w:style>/g; let m;
  while ((m = re.exec(styles))) {
    const id = attr(m[1], 'w:styleId'), name = ((m[2].match(/<w:name\s+w:val="([^"]*)"/) || [])[1] || '').toLowerCase();
    const rPr = (m[2].match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || '';
    const sz = attr((rPr.match(/<w:sz\s([^>]*)\/?>/) || [])[1] || '', 'w:val');
    const row = { id, name, font: fontOf(rPr), color: colorOf(rPr), size: sz ? Number(sz) / 2 : null };
    sty[id] = row;
    if (/^heading 1$/.test(name) || id === 'Heading1') info.heading1 = row;
    else if (/^heading 2$/.test(name) || id === 'Heading2') info.heading2 = row;
    else if (name === 'title' || id === 'Title') info.title = row;
    else if (name === 'normal' || id === 'Normal') info.body = row;
  }
  const dd = (styles.match(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/) || [])[1] || '';
  info.defaults = { font: fontOf(dd), color: colorOf(dd) };

  // colors drawn in the document, the headers and the footers
  const used = new Map();
  const bump = (hex, w) => { if (hex && isHex(hex)) used.set(clean(hex), (used.get(clean(hex)) || 0) + w); };
  const headerParts = names(zip, /^word\/header\d*\.xml$/), footerParts = names(zip, /^word\/footer\d*\.xml$/);
  const parts = [doc, ...(await Promise.all([...headerParts, ...footerParts].map((p) => read(zip, p))))];
  for (const x of parts) {
    for (const c of x.matchAll(/<w:color\s[^>]*?w:val="([0-9A-Fa-f]{6})"/g)) bump(c[1], 1);
    for (const c of x.matchAll(/<w:shd\s[^>]*?w:fill="([0-9A-Fa-f]{6})"/g)) bump(c[1], 2);
    for (const c of x.matchAll(/w:themeColor="(\w+)"/g)) { const n = wordTheme(c[1]); if (n) bump(themeColor(theme, n), 1); }
    for (const c of x.matchAll(/w:themeFill="(\w+)"/g)) { const n = wordTheme(c[1]); if (n) bump(themeColor(theme, n), 2); }
  }
  for (const s of [info.heading1, info.heading2, info.title]) if (s && s.color) bump(s.color, 8);
  for (const s of Object.values(sty)) if (s.color && !['body'].includes(s.id)) bump(s.color, 1);

  // headings, in the order they appear
  const ids1 = new Set(Object.values(sty).filter((s) => /^heading 1$/.test(s.name) || s.id === 'Heading1').map((s) => s.id));
  const ids2 = new Set(Object.values(sty).filter((s) => /^heading 2$/.test(s.name) || s.id === 'Heading2').map((s) => s.id));
  const h1 = [], h2 = [];
  for (const p of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const sid = ((p[0].match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1]) || '';
    if (!ids1.has(sid) && !ids2.has(sid)) continue;
    const text = textOf(p[0], 'w:t').replace(/\s+/g, ' ').trim();
    if (text) (ids1.has(sid) ? h1 : h2).push(text);
  }
  const hdr = (await Promise.all(headerParts.map((p) => read(zip, p)))).map((x) => textOf(x, 'w:t').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const ftr = (await Promise.all(footerParts.map((p) => read(zip, p)))).map((x) => textOf(x, 'w:t').replace(/\s+/g, ' ').trim()).filter(Boolean);

  // the logo: first picture in a header, then a footer, then on the first page
  const cand = [];
  for (const p of headerParts) cand.push(...await relImages(zip, `word/_rels/${path.posix.basename(p)}.rels`));
  for (const p of footerParts) cand.push(...await relImages(zip, `word/_rels/${path.posix.basename(p)}.rels`));
  cand.push(...(await relImages(zip, 'word/_rels/document.xml.rels')).slice(0, 3));
  const logo = await pickLogo(zip, [...new Set(cand)], warnings);
  return { info, used, headings: h1.length ? h1 : h2, header: hdr[0] || '', footer: ftr[0] || '', logo };
}

// ---------- reading a PowerPoint file ----------
async function readPpt(zip, theme, warnings) {
  const used = new Map();
  const bump = (hex, w) => { if (hex && isHex(hex)) used.set(clean(hex), (used.get(clean(hex)) || 0) + w); };
  const slides = names(zip, /^ppt\/slides\/slide\d+\.xml$/);
  const masters = names(zip, /^ppt\/slideMasters\/slideMaster\d+\.xml$/);
  const layouts = names(zip, /^ppt\/slideLayouts\/slideLayout\d+\.xml$/);
  const heads = [];
  for (const p of [...slides, ...masters, ...layouts]) {
    const x = await read(zip, p);
    const w = p.includes('/slides/') ? 2 : 1;
    for (const c of x.matchAll(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g)) bump(c[1], w);
    for (const c of x.matchAll(/<a:schemeClr\s+val="(\w+)"/g)) { const col = themeColor(theme, c[1]); if (col && /^accent|^dk2|^hlink/.test(SCHEME_MAP[c[1]] || '')) bump(col, w); }
    if (p.includes('/slides/')) {
      for (const sp of x.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
        if (!/<p:ph[^>]*type="(title|ctrTitle)"/.test(sp[0])) continue;
        const t = textOf(sp[0], 'a:t').replace(/\s+/g, ' ').trim(); if (t) heads.push(t);
      }
    }
  }
  const master = masters[0] ? await read(zip, masters[0]) : '';
  const title = (master.match(/<p:titleStyle>[\s\S]*?<\/p:titleStyle>/) || [''])[0];
  const tfont = (title.match(/<a:latin\s+typeface="([^"]*)"/) || [])[1] || '';
  const tcolor = (() => { const s = (title.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/) || [])[1]; if (s) return clean(s); const sc = (title.match(/<a:schemeClr\s+val="(\w+)"/) || [])[1]; return sc ? themeColor(theme, sc) : null; })();
  if (tcolor) bump(tcolor, 6);
  const cand = [];
  for (const p of masters) cand.push(...await relImages(zip, `ppt/slideMasters/_rels/${path.posix.basename(p)}.rels`));
  for (const p of layouts.slice(0, 4)) cand.push(...await relImages(zip, `ppt/slideLayouts/_rels/${path.posix.basename(p)}.rels`));
  for (const p of slides.slice(0, 2)) cand.push(...await relImages(zip, `ppt/slides/_rels/${path.posix.basename(p)}.rels`));
  const logo = await pickLogo(zip, [...new Set(cand)], warnings);
  const font = (f) => (/^\+m[jn]-/.test(f) ? '' : f);
  return { info: { heading1: { font: font(tfont) || '', color: tcolor, size: null }, body: null, defaults: { font: '', color: null } }, used, headings: heads.slice(1), header: '', footer: '', logo };
}

// ---------- from facts to a brand ----------
const GENERIC = /^(heading\s*\d?|title|click to|click here|insert|your (title|text|name)|lorem|subtitle|text here|enter|add (a )?title|overview of|table of contents|contents|agenda|thank you|questions)\b/i;
function cleanHeadings(list) {
  const seen = new Set(), out = [];
  for (const raw of list || []) {
    const h = String(raw || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^\d+(\.\d+)*[.)]?\s+/, '').trim().slice(0, 100);
    if (h.length < 2 || GENERIC.test(h) || /^[\d\s.,:-]+$/.test(h) || seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase()); out.push(h);
    if (out.length >= 20) break;
  }
  return out.length >= 2 ? out : [];
}
const DEFAULTS = { primary: '2457D6', secondary: '1F2F55', accent: '1BAF7A', text: '1B2437', muted: '5B6680' };
const cleanFont = (f, d) => { const v = String(f == null ? '' : f).replace(/[^\p{L}\p{N} .'\-()]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60); return v || d || ''; };
const GENERIC_FONT = /^(\+|theme|major|minor)/i;

function deriveBrand(facts) {
  const theme = facts.theme;
  const cands = new Map();
  const add = (hex, score) => { if (!hex || !isHex(hex)) return; const h = clean(hex); cands.set(h, (cands.get(h) || 0) + score); };
  for (const [h, n] of facts.used) add(h, n);
  THEME_COLORS.filter((n) => /^accent/.test(n)).forEach((n, i) => add(theme.colors[n], 3 - i * 0.4));
  add(theme.colors.dk2, 1);
  const ranked = [...cands.entries()].map(([hex, score]) => {
    const c = hsl(hex);
    const colorful = c.s >= 0.28 && c.l >= 0.12 && c.l <= 0.82;
    return { hex, score: colorful ? score * (0.6 + c.s) : 0, c };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const picked = [];
  for (const r of ranked) { if (picked.every((p) => dist(p.hex, r.hex) > 80)) picked.push(r); if (picked.length === 3) break; }
  // a heading color that is dark but tinted still beats the platform default
  const h1c = facts.styles.heading1 && facts.styles.heading1.color;
  let primary = picked[0] && picked[0].hex;
  if (!primary && h1c && hsl(h1c).l < 0.9) primary = h1c;
  primary = primary || theme.colors.accent1 || DEFAULTS.primary;
  let secondary = (picked[1] && picked[1].hex) || (theme.colors.dk2 && dist(theme.colors.dk2, primary) > 60 ? theme.colors.dk2 : null) || mix(primary, '000000', 0.55);
  let accent = (picked[2] && picked[2].hex) || (theme.colors.accent2 && dist(theme.colors.accent2, primary) > 60 ? theme.colors.accent2 : null) || DEFAULTS.accent;
  const bodyColor = (facts.styles.body && facts.styles.body.color) || (facts.styles.defaults && facts.styles.defaults.color);
  let text = bodyColor && hsl(bodyColor).l < 0.4 ? bodyColor : (theme.colors.dk1 && hsl(theme.colors.dk1).l < 0.4 ? theme.colors.dk1 : DEFAULTS.text);
  if (hsl(text).l < 0.04) text = mix(text, primary, 0.12); // pure black next to a brand color is harsh
  text = readable(text, 7);
  const muted = readable(mix(text, 'FFFFFF', 0.42), 4.5);
  const heading = [facts.styles.heading1 && facts.styles.heading1.font, facts.styles.title && facts.styles.title.font, theme.fonts.major].map((f) => (f && !GENERIC_FONT.test(f) ? f : '')).find(Boolean);
  const body = [facts.styles.body && facts.styles.body.font, facts.styles.defaults && facts.styles.defaults.font, theme.fonts.minor].map((f) => (f && !GENERIC_FONT.test(f) ? f : '')).find(Boolean);
  return {
    colors: { primary: clean(primary), secondary: clean(secondary), accent: clean(accent), text: clean(text), muted: clean(muted) },
    fonts: { heading: cleanFont(heading, body || 'Calibri'), body: cleanFont(body, heading || 'Calibri') },
  };
}

// Claude chooses the roles from what was found. Anything it returns is checked, and anything wrong falls back to the rules.
async function refine(facts, base, ai) {
  const compact = {
    file: facts.filename, kind: facts.kind,
    themeColors: facts.theme.colors, themeFonts: facts.theme.fonts,
    styles: { heading1: facts.styles.heading1 || null, heading2: facts.styles.heading2 || null, title: facts.styles.title || null, body: facts.styles.body || null },
    colorsUsedInDocument: [...facts.used.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([hex, count]) => ({ hex, count })),
    headingsFound: facts.headings.slice(0, 30), headerText: facts.header, footerText: facts.footer,
  };
  const system = 'You read the style facts of a client document template and decide its brand. Reply with one JSON object only, with no prose and no code fences. Write in US English. Do not use dashes as punctuation and do not use semicolons.';
  const user = `Facts read from the template file:\n${JSON.stringify(compact)}\n\nReturn JSON with these keys:\n- "name": a short template name (the client or document name, under 60 characters)\n- "colors": an object with six digit hex values without a hash for "primary" (the main brand color, used for headings and table headers), "secondary" (a darker supporting color), "accent" (a third color that stands apart from primary), "text" (body text, dark enough to read on white), "muted" (secondary text, still readable on white)\n- "fonts": an object with "heading" and "body" font family names exactly as they appear in the facts\n- "sections": the report section headings this client expects, in order, taken from headingsFound. Remove placeholder text, page furniture and anything that is not a real section. Use an empty array if there are fewer than two real sections\n\nPrefer colors that are really used in the document over theme defaults. Never pick white or near white as primary.`;
  const r = await ai({ system, user, max_tokens: 1200 });
  const a = r.text.indexOf('{'), z = r.text.lastIndexOf('}');
  if (a < 0 || z < a) throw new Error('No JSON in the reply');
  const j = JSON.parse(r.text.slice(a, z + 1));
  const out = { colors: { ...base.colors }, fonts: { ...base.fonts }, name: '', sections: null };
  for (const k of Object.keys(out.colors)) if (j.colors && isHex(j.colors[k])) out.colors[k] = clean(j.colors[k]);
  if (hsl(out.colors.primary).l > 0.92) out.colors.primary = base.colors.primary;
  out.colors.text = readable(out.colors.text, 7); out.colors.muted = readable(out.colors.muted, 4.5);
  if (j.fonts) for (const k of ['heading', 'body']) { const f = cleanFont(j.fonts[k], ''); if (f) out.fonts[k] = f; }
  out.name = String(j.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
  if (Array.isArray(j.sections)) out.sections = cleanHeadings(j.sections);
  return out;
}

// ---------- entry point ----------
async function extract(buffer, filename, opts) {
  opts = opts || {};
  const ext = path.extname(String(filename || '')).slice(1).toLowerCase();
  const kind = /^(docx|dotx|docm|dotm)$/.test(ext) ? 'word' : /^(pptx|potx|ppsx|pptm|potm)$/.test(ext) ? 'ppt' : null;
  if (!kind) throw Object.assign(new Error('Upload a Word (.docx, .dotx) or PowerPoint (.pptx, .potx) template'), { status: 400 });
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch (e) { throw Object.assign(new Error('The file could not be opened. Save it again as .docx or .pptx and try again.'), { status: 400 }); }
  if (!zip.file(kind === 'word' ? 'word/document.xml' : 'ppt/presentation.xml')) throw Object.assign(new Error('This does not look like a Word or PowerPoint file.'), { status: 400 });
  const warnings = [];
  const themePath = names(zip, kind === 'word' ? /^word\/theme\/theme\d+\.xml$/ : /^ppt\/theme\/theme\d+\.xml$/)[0];
  const theme = themePath ? parseTheme(await read(zip, themePath)) : { colors: {}, fonts: { major: '', minor: '' } };
  const part = kind === 'word' ? await readWord(zip, theme, warnings) : await readPpt(zip, theme, warnings);
  const facts = { filename: path.basename(String(filename || '')), kind, theme, styles: part.info, used: part.used, headings: part.headings, header: part.header, footer: part.footer };
  let brand = deriveBrand(facts);
  let engine = 'rules', name = '', sections = cleanHeadings(part.headings);
  if (opts.ai) {
    try {
      const r = await refine(facts, brand, opts.ai);
      brand = { colors: r.colors, fonts: r.fonts }; name = r.name; if (r.sections) sections = r.sections; engine = 'claude';
    } catch (e) { console.error('Brand refine failed:', e.message); warnings.push('ai_failed'); }
  }
  if (!themePath && !part.used.size) warnings.push('few_styles');
  const base = facts.filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return {
    engine, warnings, kind, headings: sections,
    name: name || base || 'Client template',
    brand: { v: 1, colors: brand.colors, fonts: brand.fonts, logo: part.logo ? { dataUrl: part.logo.dataUrl, w: part.logo.w, h: part.logo.h } : null, source: { filename: facts.filename, kind: kind === 'word' ? 'Word' : 'PowerPoint' } },
    header: part.header, footer: part.footer,
  };
}

// ---------- validation for anything the client sends back ----------
const LOGO_RE = /^data:image\/(png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
function cleanBrand(b, prev) {
  if (b == null) return null;
  if (typeof b !== 'object' || Array.isArray(b)) throw Object.assign(new Error('The brand is not valid'), { status: 400 });
  const colors = {}, d = (prev && prev.colors) || DEFAULTS;
  for (const k of Object.keys(DEFAULTS)) { const v = b.colors && b.colors[k]; if (v != null && !isHex(v)) throw Object.assign(new Error(`The ${k} color must be a six digit hex value`), { status: 400 }); colors[k] = clean(v != null ? v : d[k] || DEFAULTS[k]); }
  const fonts = { heading: cleanFont(b.fonts && b.fonts.heading, prev && prev.fonts && prev.fonts.heading || 'Calibri'), body: cleanFont(b.fonts && b.fonts.body, prev && prev.fonts && prev.fonts.body || 'Calibri') };
  let logo = b.logo === undefined && prev && prev.logo ? prev.logo : null;
  if (b.logo) {
    if (typeof b.logo.dataUrl !== 'string' || !LOGO_RE.test(b.logo.dataUrl)) throw Object.assign(new Error('The logo must be a PNG, JPEG, GIF or SVG image'), { status: 400 });
    if (b.logo.dataUrl.length > MAX_LOGO * 1.4) throw Object.assign(new Error('The logo is too large. Use an image under 700 KB.'), { status: 413 });
    logo = { dataUrl: b.logo.dataUrl, w: Math.max(0, Math.min(10000, Number(b.logo.w) || 0)), h: Math.max(0, Math.min(10000, Number(b.logo.h) || 0)) };
  }
  const src = (b.source || (prev && prev.source)) || null;
  return { v: 1, colors, fonts, logo, ...(src ? { source: { filename: String(src.filename || '').slice(0, 160), kind: String(src.kind || '').slice(0, 20) } } : {}) };
}

module.exports = { extract, cleanBrand, cleanHeadings, deriveBrand, parseTheme, DEFAULTS, readable, contrast };
