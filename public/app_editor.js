/* Visual document editor.
   A generated document is stored as Markdown plus a page layout (logo position, header and footer).
   This editor shows it as a page: the project manager edits text, moves sections, adds tables, sets the header,
   footer and logo, and can save the result as a template. Markdown stays the stored format, so every export keeps working. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, confirmDlg, busy } = PM;

  // ---------- inline text: Markdown <-> HTML ----------
  const INL = /(\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|(?<!\w)_[^_]+_(?!\w))/g;
  function inlineToHtml(md) {
    return String(md == null ? '' : md).split(INL).filter((s) => s !== '').map((p) => {
      let m;
      if ((m = p.match(/^\*\*([^*]+)\*\*$/)) || (m = p.match(/^__([^_]+)__$/))) return `<b>${esc(m[1])}</b>`;
      if ((m = p.match(/^_([^_]+)_$/))) return `<i>${esc(m[1])}</i>`;
      return esc(p);
    }).join('');
  }
  function htmlToInline(el) {
    const walk = (n) => {
      let out = '';
      n.childNodes.forEach((c) => {
        if (c.nodeType === 3) { out += c.nodeValue.replace(/[ ​]/g, ' ').replace(/\s*\n\s*/g, ' '); return; }
        if (c.nodeType !== 1) return;
        const tag = c.tagName, st = c.style || {};
        if (tag === 'BR') { out += ' '; return; }
        const inner = walk(c);
        const bold = tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(st.fontWeight || '');
        const ital = tag === 'I' || tag === 'EM' || st.fontStyle === 'italic';
        let r = inner;
        if (r.trim()) {
          const lead = r.match(/^\s*/)[0], trail = r.match(/\s*$/)[0], core = r.trim();
          if (ital) r = `${lead}_${core}_${trail}`;
          if (bold) r = `${lead}**${ital ? `_${core}_` : core}**${trail}`;
        }
        out += (tag === 'DIV' || tag === 'P') && out && !/\s$/.test(out) ? ' ' + r : r;
      });
      return out;
    };
    return walk(el).replace(/\s+/g, ' ').trim();
  }

  // ---------- Markdown <-> blocks ----------
  let uid = 1;
  const nb = (type, o) => Object.assign({ id: uid++, type }, o);
  function parse(md) {
    const lines = String(md || '').split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { out.push(nb('h' + m[1].length, { html: inlineToHtml(m[2].replace(/[*_]/g, '').trim()) })); continue; }
      if (/^\s*\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        i--;
        const cells = rows.map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        const body = cells.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
        const cols = Math.max(1, ...body.map((r) => r.length));
        out.push(nb('table', { rows: body.map((r) => Array.from({ length: cols }, (_, c) => inlineToHtml(r[c] || ''))) }));
        continue;
      }
      if (/^\s*[-*]\s+/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(inlineToHtml(lines[i].replace(/^\s*[-*]\s+/, ''))); i++; }
        i--; out.push(nb('ul', { items })); continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(inlineToHtml(lines[i].replace(/^\s*\d+[.)]\s+/, ''))); i++; }
        i--; out.push(nb('ol', { items })); continue;
      }
      const para = [l.trim()];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*(#{1,3}\s|\||[-*]\s+|\d+[.)]\s+)/.test(lines[i + 1])) { i++; para.push(lines[i].trim()); }
      out.push(nb('p', { html: inlineToHtml(para.join(' ')) }));
    }
    return out;
  }
  const htmlMd = (h) => { const d = document.createElement('div'); d.innerHTML = h; return htmlToInline(d); };
  function blockMd(b) {
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') return `${'#'.repeat(+b.type[1])} ${htmlMd(b.html).replace(/[*_]/g, '')}`;
    if (b.type === 'p') return htmlMd(b.html);
    if (b.type === 'ul') return b.items.map((x) => `- ${htmlMd(x)}`).join('\n');
    if (b.type === 'ol') return b.items.map((x, i) => `${i + 1}. ${htmlMd(x)}`).join('\n');
    if (b.type === 'table') {
      const cell = (h) => htmlMd(h).replace(/\|/g, '/');
      const rows = b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
      rows.splice(1, 0, `| ${b.rows[0].map(() => '---').join(' | ')} |`);
      return rows.join('\n');
    }
    return '';
  }
  const toMd = (blocks) => blocks.map(blockMd).filter((x) => x.trim()).join('\n\n') + '\n';

  // ---------- layout ----------
  const POS = ['left', 'center', 'right', 'hidden'];
  const TOKENS = [['project', 'ed_tok_project'], ['client', 'ed_tok_client'], ['title', 'ed_tok_title'], ['date', 'ed_tok_date'], ['code', 'ed_tok_code'], ['pm', 'ed_tok_pm'], ['page', 'ed_tok_page'], ['pages', 'ed_tok_pages']];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- the editor ----------
  async function open(g, opts) {
    opts = opts || {};
    const X = PM.exporter;
    const defLayout = X.DEFAULT_LAYOUT;
    let blocks = parse(g.content);
    if (!blocks.length) blocks = [nb('h1', { html: esc(t('ed_new_section')) }), nb('p', { html: '' })];
    let layout = X.layoutOf(g);
    let title = g.title;
    let lastSaved = '';
    let focusId = null, cellPos = null, lastField = null;
    const hist = [], redo = [];
    let histTimer = null;
    const meta = g.meta || {};
    // A document made from a client template is drawn with the client's colors, fonts and logo.
    const brand = g.brand || null;
    const logoSrc = brand ? (brand.logo ? brand.logo.dataUrl : null) : 'brand/full-light.png';
    const logoImg = () => (logoSrc ? `<img src="${logoSrc}" alt="" class="lg">` : '');

    const ov = document.createElement('div');
    ov.className = 'ded-ov';
    ov.innerHTML = `<div class="ded" role="dialog" aria-modal="true" aria-label="${esc(t('ed_title'))}">
      <header class="ded-top">
        <input type="text" id="dTitle" maxlength="120" aria-label="${esc(t('doc_name'))}" value="${esc(title)}">
        <div class="ded-actions">
          <button class="btn sm" id="dTpl">${icon('copy')}<span>${t('ed_save_tpl')}</span></button>
          <button class="btn sm" id="dDl">${icon('dl')}<span>${t('download_fmt', { f: X.FORMATS[g.format || 'docx'].label })}</span></button>
          <button class="btn sm" id="dClose">${t('cancel')}</button>
          <button class="btn sm primary" id="dSave">${icon('check')}<span>${t('save')}</span></button>
        </div>
      </header>
      <div class="ded-bar" role="toolbar" aria-label="${esc(t('ed_toolbar'))}">
        <button class="btn sm icon" id="tUndo" aria-label="${esc(t('ed_undo'))}" data-tip="${esc(t('ed_undo'))}">${icon('undo')}</button>
        <button class="btn sm icon" id="tRedo" aria-label="${esc(t('ed_redo'))}" data-tip="${esc(t('ed_redo'))}"><span style="display:inline-flex;transform:scaleX(-1)">${icon('undo')}</span></button>
        <span class="sep"></span>
        <button class="btn sm icon fmt" id="tBold" aria-label="${esc(t('ed_bold'))}" data-tip="${esc(t('ed_bold'))}"><b>B</b></button>
        <button class="btn sm icon fmt" id="tItal" aria-label="${esc(t('ed_italic'))}" data-tip="${esc(t('ed_italic'))}"><i>I</i></button>
        <span class="sep"></span>
        <span class="lbl">${t('ed_insert')}</span>
        <button class="btn sm" data-ins="h1">${t('ed_h')}</button><button class="btn sm" data-ins="p">${t('ed_p')}</button><button class="btn sm" data-ins="ul">${t('ed_ul')}</button><button class="btn sm" data-ins="ol">${t('ed_ol')}</button><button class="btn sm" data-ins="table">${icon('plus')}${t('ed_table')}</button>
      </div>
      <div class="ded-main">
        <aside class="ded-side" aria-label="${esc(t('ed_sections'))}"><h3>${t('ed_sections')}</h3><p class="small muted">${t('ed_sections_hint')}</p><ol id="dOutline"></ol></aside>
        <main class="ded-canvas"><div class="ded-page" id="dPage"></div></main>
        <aside class="ded-lay" aria-label="${esc(t('ed_layout'))}"><h3>${t('ed_layout')}</h3><div id="dLay"></div></aside>
      </div></div>`;
    (document.fullscreenElement || document.body).appendChild(ov);
    document.body.classList.add('ded-open');
    const q = (s) => $(s, ov);
    const page = q('#dPage');
    if (brand) {
      const k = X.brandTokens(brand);
      page.style.cssText = `--primary:#${k.primary};--primary-soft:#${k.primarySoft};--g-sum:#${k.gSum};--on-primary:#${k.onPrimary};--text:#${k.text};--muted:#${k.muted};--border:#${k.border};--ded-head:'${brand.fonts.heading}',Calibri,Arial,sans-serif;font-family:'${brand.fonts.body}',Calibri,Arial,sans-serif;color:#${k.text};`;
      page.classList.add('branded');
    }

    // ----- model <-> DOM -----
    const byId = (id) => blocks.find((b) => b.id === id);
    const idxOf = (id) => blocks.findIndex((b) => b.id === id);
    function collect() {
      $$('.ded-blk', page).forEach((el) => {
        const b = byId(Number(el.dataset.id));
        if (!b) return;
        if (b.type === 'ul' || b.type === 'ol') b.items = $$('li', el).map((li) => li.innerHTML);
        else if (b.type === 'table') b.rows = $$('tr', el).map((tr) => $$('th,td', tr).map((c) => c.innerHTML));
        else { const c = $('.ded-txt', el); if (c) b.html = c.innerHTML; }
      });
      title = q('#dTitle').value;
    }
    const state = () => JSON.stringify({ md: toMd(blocks), layout, title });
    function snap() {
      const s = state();
      if (hist.length && hist[hist.length - 1] === s) return;
      hist.push(s); if (hist.length > 80) hist.shift(); redo.length = 0; buttons();
    }
    function restore(s) {
      const o = JSON.parse(s);
      blocks = parse(o.md); layout = o.layout; title = o.title; q('#dTitle').value = title;
      draw(); drawLayout(); buttons();
    }
    function undo() { collect(); snap(); if (hist.length < 2) return; redo.push(hist.pop()); restore(hist[hist.length - 1]); }
    function redoIt() { if (!redo.length) return; const s = redo.pop(); hist.push(s); restore(s); }
    function buttons() { q('#tUndo').disabled = hist.length < 2; q('#tRedo').disabled = !redo.length; }
    function changed() { clearTimeout(histTimer); histTimer = setTimeout(() => { collect(); snap(); outline(); drawPreviewStrips(); }, 500); }
    function structural(fn) { collect(); fn(); draw(); snap(); }

    function blockHtml(b) {
      const lbl = { h1: 'ed_h1', h2: 'ed_h2', h3: 'ed_h3', p: 'ed_p', ul: 'ed_ul', ol: 'ed_ol', table: 'ed_table' }[b.type];
      const styleSel = b.type === 'table' ? '' : `<select class="ded-style" aria-label="${esc(t('ed_style'))}">${[['p', 'ed_p'], ['h1', 'ed_h1'], ['h2', 'ed_h2'], ['h3', 'ed_h3'], ['ul', 'ed_ul'], ['ol', 'ed_ol']].map(([v, k]) => `<option value="${v}" ${v === b.type ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select>`;
      const sec = b.type === 'h1';
      const tools = `<div class="ded-tools"><span class="grip" data-grip aria-hidden="true" data-tip="${esc(t('ed_drag'))}">${icon('grip')}</span>${styleSel || `<span class="tag">${esc(t(lbl))}</span>`}
        <button class="btn sm ghost icon" data-up aria-label="${esc(t(sec ? 'ed_move_sec_up' : 'ed_move_up'))}" data-tip="${esc(t(sec ? 'ed_move_sec_up' : 'ed_move_up'))}"><span style="display:inline-flex;transform:rotate(180deg)">${icon('down')}</span></button>
        <button class="btn sm ghost icon" data-down aria-label="${esc(t(sec ? 'ed_move_sec_down' : 'ed_move_down'))}" data-tip="${esc(t(sec ? 'ed_move_sec_down' : 'ed_move_down'))}">${icon('down')}</button>
        <button class="btn sm ghost icon" data-del aria-label="${esc(t('ed_delete'))}" data-tip="${esc(t('ed_delete'))}">${icon('trash')}</button></div>`;
      let body;
      if (b.type === 'ul' || b.type === 'ol') body = `<${b.type} class="ded-list" contenteditable="true" spellcheck="true">${b.items.map((x) => `<li>${x}</li>`).join('') || '<li><br></li>'}</${b.type}>`;
      else if (b.type === 'table') {
        body = `<div class="ded-ttools" role="group" aria-label="${esc(t('ed_table'))}"><button class="btn sm" data-tt="row">${icon('plus')}${t('ed_add_row')}</button><button class="btn sm" data-tt="col">${icon('plus')}${t('ed_add_col')}</button><button class="btn sm" data-tt="delrow">${icon('minus')}${t('ed_del_row')}</button><button class="btn sm" data-tt="delcol">${icon('minus')}${t('ed_del_col')}</button></div>
          <div class="ded-twrap"><table class="ded-table"><tbody>${b.rows.map((r, ri) => `<tr>${r.map((c) => `<${ri ? 'td' : 'th'} contenteditable="true">${c}</${ri ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      } else body = `<div class="ded-txt ${b.type}" contenteditable="true" role="textbox" aria-label="${esc(t(lbl))}" spellcheck="true" data-ph="${esc(t('ed_ph'))}">${b.html}</div>`;
      return `<div class="ded-blk" data-id="${b.id}" data-type="${b.type}">${tools}${body}</div>`;
    }
    function draw() {
      const cover = `<section class="ded-cover" aria-label="${esc(t('ed_cover'))}"><div class="cap">${t('ed_cover')}</div>
        <div class="row" style="justify-content:${{ left: 'flex-start', center: 'center', right: 'flex-end', hidden: 'flex-start' }[layout.logo.cover]}">${layout.logo.cover === 'hidden' ? `<span class="small muted">${t('ed_logo_hidden')}</span>` : `${logoImg()}`}</div>
        <div class="ct">${esc(title)}</div><div class="small muted">${esc(meta.project || '')}${meta.client ? ' · ' + esc(meta.client) : ''}</div></section>`;
      page.innerHTML = `${cover}<div class="ded-hf" id="dHead"></div><div id="dBlocks">${blocks.map(blockHtml).join('')}</div><button class="btn sm ded-addend" id="dAddEnd">${icon('plus')}${t('ed_add_block')}</button><div class="ded-hf foot" id="dFoot"></div>`;
      wire(); outline(); drawPreviewStrips();
      if (focusId != null) { const el = $(`.ded-blk[data-id="${focusId}"] [contenteditable]`, page); if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
    }
    function sectionRange(i) { let j = i + 1; while (j < blocks.length && blocks[j].type !== 'h1') j++; return [i, j]; }
    function moveBlock(id, dir) {
      structural(() => {
        const i = idxOf(id), b = blocks[i];
        if (b.type === 'h1') {
          const [a, z] = sectionRange(i), seg = blocks.slice(a, z);
          const heads = blocks.map((x, k) => (x.type === 'h1' ? k : -1)).filter((k) => k >= 0);
          const at = heads.indexOf(a);
          const to = at + dir;
          if (to < 0 || to >= heads.length) return;
          blocks.splice(a, z - a);
          const [na] = (() => { const hs = blocks.map((x, k) => (x.type === 'h1' ? k : -1)).filter((k) => k >= 0); return [hs[to] != null ? hs[to] : blocks.length]; })();
          blocks.splice(na, 0, ...seg);
        } else { const j = i + dir; if (j < 0 || j >= blocks.length) return; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
        focusId = id;
      });
    }
    function convert(b, to) {
      const txt = b.type === 'ul' || b.type === 'ol' ? b.items.join(' ') : b.html || '';
      if (to === 'ul' || to === 'ol') { const items = b.type === 'ul' || b.type === 'ol' ? b.items : [txt]; return { ...b, type: to, items, html: undefined }; }
      return { ...b, type: to, html: txt, items: undefined };
    }
    function insertAfter(type, afterId) {
      const b = type === 'table' ? nb('table', { rows: [['', '', ''], ['', '', ''], ['', '', '']].map((r, i) => r.map((_, c) => (i ? '' : esc(t('ed_col_n', { n: c + 1 }))))) }) : type === 'ul' || type === 'ol' ? nb(type, { items: [''] }) : nb(type, { html: type === 'h1' ? esc(t('ed_new_section')) : '' });
      structural(() => {
        const i = afterId != null ? idxOf(afterId) : blocks.length - 1;
        // a new section goes after the whole current section
        const at = type === 'h1' && i >= 0 ? (() => { let k = i; while (k >= 0 && blocks[k].type !== 'h1') k--; return k >= 0 ? sectionRange(k)[1] : i + 1; })() : i + 1;
        blocks.splice(at, 0, b); focusId = b.id;
      });
    }
    function caretSplit(el) {
      const sel = getSelection(); if (!sel.rangeCount) return ['', ''];
      const r = sel.getRangeAt(0);
      const tail = document.createRange(); tail.selectNodeContents(el); tail.setStart(r.endContainer, r.endOffset);
      const frag = tail.extractContents(); const d = document.createElement('div'); d.appendChild(frag);
      return [el.innerHTML, d.innerHTML];
    }

    function wire() {
      $$('.ded-blk', page).forEach((el) => {
        const id = Number(el.dataset.id);
        el.addEventListener('focusin', () => { focusId = id; $$('.ded-blk.on', page).forEach((x) => x.classList.remove('on')); el.classList.add('on'); });
        $('[data-up]', el).onclick = () => moveBlock(id, -1);
        $('[data-down]', el).onclick = () => moveBlock(id, 1);
        $('[data-del]', el).onclick = () => structural(() => { blocks.splice(idxOf(id), 1); if (!blocks.length) blocks.push(nb('p', { html: '' })); focusId = null; });
        const sel = $('.ded-style', el);
        if (sel) sel.onchange = () => structural(() => { const i = idxOf(id); blocks[i] = convert(blocks[i], sel.value); focusId = blocks[i].id; });
        // drag a block (or a whole section by its heading) by the handle
        const grip = $('[data-grip]', el);
        grip.onmousedown = () => { el.draggable = true; };
        el.ondragend = () => { el.draggable = false; el.classList.remove('drag'); $$('.ded-blk.over', page).forEach((x) => x.classList.remove('over')); };
        el.ondragstart = (e) => { if (!el.draggable) return; dragId = id; el.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'b' + id); } catch (x) { /* blocked */ } };
        el.ondragover = (e) => { if (dragId == null || dragId === id) return; e.preventDefault(); el.classList.add('over'); };
        el.ondragleave = () => el.classList.remove('over');
        el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); dropOn(id); };
        // text keys
        const txt = $('.ded-txt', el);
        if (txt) {
          txt.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const [head, tail] = caretSplit(txt);
              structural(() => { const i = idxOf(id); blocks[i].html = head; const n = nb('p', { html: tail }); blocks.splice(i + 1, 0, n); focusId = n.id; });
            } else if (e.key === 'Backspace' && !txt.textContent.length && blocks.length > 1) {
              e.preventDefault();
              structural(() => { const i = idxOf(id); blocks.splice(i, 1); focusId = blocks[Math.max(0, i - 1)].id; });
            }
          });
        }
        $$('[contenteditable]', el).forEach((c) => {
          c.addEventListener('input', changed);
          c.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r/g, '');
            const parts = text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
            if (parts.length <= 1 || !c.classList.contains('ded-txt')) { document.execCommand('insertText', false, parts.join(' ')); return; }
            const [head, tail] = caretSplit(c);
            structural(() => { const i = idxOf(id); blocks[i].html = head + esc(parts[0]); const add = parts.slice(1).map((x, k) => nb('p', { html: esc(x) + (k === parts.length - 2 ? tail : '') })); blocks.splice(i + 1, 0, ...add); focusId = add[add.length - 1].id; });
          });
        });
        // tables
        $$('th,td', el).forEach((c) => {
          c.addEventListener('focus', () => { const tr = c.parentElement; cellPos = { id, r: $$('tr', el).indexOf(tr), c: [...tr.children].indexOf(c) }; });
          c.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); return; }
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const cells = $$('th,td', el), k = cells.indexOf(c) + (e.shiftKey ? -1 : 1);
            if (k >= cells.length) { tableOp(id, 'row', { r: $$('tr', el).length - 1, c: 0 }, true); return; }
            if (cells[k]) cells[k].focus();
          });
        });
        $$('[data-tt]', el).forEach((btn) => { btn.onmousedown = (e) => e.preventDefault(); btn.onclick = () => tableOp(id, btn.dataset.tt, cellPos && cellPos.id === id ? cellPos : null); });
      });
      q('#dAddEnd').onclick = () => insertAfter('p', blocks.length ? blocks[blocks.length - 1].id : null);
    }
    function tableOp(id, op, pos, focusNew) {
      structural(() => {
        const b = byId(id), cols = b.rows[0].length;
        const r = pos ? pos.r : b.rows.length - 1, c = pos ? pos.c : cols - 1;
        if (op === 'row') b.rows.splice(r + 1, 0, Array.from({ length: cols }, () => ''));
        else if (op === 'col') b.rows.forEach((row, i) => row.splice(c + 1, 0, i ? '' : esc(t('ed_col_n', { n: cols + 1 }))));
        else if (op === 'delrow') { if (b.rows.length > 1) b.rows.splice(Math.max(r, 1) === r ? r : 1, 1); }
        else if (op === 'delcol') { if (cols > 1) b.rows.forEach((row) => row.splice(c, 1)); }
        focusId = null;
      });
      if (focusNew) { const cell = $$('tr', $(`.ded-blk[data-id="${id}"]`, page)).pop(); if (cell && cell.children[0]) cell.children[0].focus(); }
    }

    // ----- sections outline, with drag and drop -----
    let dragId = null, dragSec = null;
    function dropOn(targetId) {
      const from = dragId; dragId = null;
      if (from == null || from === targetId) return;
      structural(() => {
        const i = idxOf(from); if (i < 0) return;
        const b = blocks[i];
        let seg = [b], a = i, z = i + 1;
        if (b.type === 'h1') { [a, z] = sectionRange(i); seg = blocks.slice(a, z); }
        if (idxOf(targetId) >= a && idxOf(targetId) < z) return;
        blocks.splice(a, z - a);
        const at = idxOf(targetId), tb = blocks[at];
        // a block lands before the target block, a section lands before the target's section
        if (b.type !== 'h1' || tb.type === 'h1') blocks.splice(at, 0, ...seg);
        else { let k = at; while (k > 0 && blocks[k].type !== 'h1') k--; blocks.splice(k, 0, ...seg); }
        focusId = from;
      });
    }
    function outline() {
      const ol = q('#dOutline');
      const heads = blocks.filter((b) => b.type === 'h1');
      ol.innerHTML = heads.length ? heads.map((b, k) => `<li draggable="true" data-sec="${b.id}"><span class="grip" aria-hidden="true">${icon('grip')}</span><button class="nm" data-go="${b.id}">${esc(htmlText(b.html) || t('ed_untitled'))}</button>
        <button class="btn sm ghost icon" data-su="${b.id}" ${k === 0 ? 'disabled' : ''} aria-label="${esc(t('ed_move_sec_up'))}"><span style="display:inline-flex;transform:rotate(180deg)">${icon('down')}</span></button>
        <button class="btn sm ghost icon" data-sd="${b.id}" ${k === heads.length - 1 ? 'disabled' : ''} aria-label="${esc(t('ed_move_sec_down'))}">${icon('down')}</button></li>`).join('') : `<li class="small muted">${t('ed_no_sections')}</li>`;
      $$('[data-go]', ol).forEach((b) => (b.onclick = () => { const el = $(`.ded-blk[data-id="${b.dataset.go}"]`, page); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const c = $('[contenteditable]', el); if (c) c.focus(); } }));
      $$('[data-su]', ol).forEach((b) => (b.onclick = () => moveBlock(Number(b.dataset.su), -1)));
      $$('[data-sd]', ol).forEach((b) => (b.onclick = () => moveBlock(Number(b.dataset.sd), 1)));
      $$('li[data-sec]', ol).forEach((li) => {
        li.ondragstart = (e) => { dragSec = Number(li.dataset.sec); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 's' + dragSec); } catch (x) { /* blocked */ } };
        li.ondragover = (e) => { if (dragSec != null) { e.preventDefault(); li.classList.add('over'); } };
        li.ondragleave = () => li.classList.remove('over');
        li.ondragend = () => { dragSec = null; $$('li.over', ol).forEach((x) => x.classList.remove('over')); };
        li.ondrop = (e) => { e.preventDefault(); li.classList.remove('over'); const from = dragSec; dragSec = null; if (from != null && from !== Number(li.dataset.sec)) { dragId = from; dropOn(Number(li.dataset.sec)); } };
      });
    }
    const htmlText = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };

    // ----- page layout panel -----
    const posRow = (key, label) => `<div class="f"><span class="lb" id="lb_${key}">${esc(label)}</span><div class="seg" role="radiogroup" aria-labelledby="lb_${key}">${POS.map((p) => `<button type="button" role="radio" aria-checked="${layout.logo[key] === p}" class="${layout.logo[key] === p ? 'on' : ''}" data-pos="${key}:${p}">${esc(t('ed_pos_' + p))}</button>`).join('')}</div></div>`;
    function drawLayout() {
      const field = (grp, k, rows) => `<label class="f"><span class="lb">${esc(t('ed_pos_' + k))}</span>${rows > 1 ? `<textarea rows="${rows}" data-lay="${grp}.${k}" maxlength="320">${esc(layout[grp][k])}</textarea>` : `<input type="text" data-lay="${grp}.${k}" maxlength="160" value="${esc(layout[grp][k])}">`}</label>`;
      q('#dLay').innerHTML = `${posRow('cover', t('ed_logo_cover'))}${posRow('header', t('ed_logo_header'))}
        <h4>${t('ed_header')}</h4>${['left', 'center', 'right'].map((k) => field('header', k, 2)).join('')}
        <h4>${t('ed_footer')}</h4>${['left', 'center', 'right'].map((k) => field('footer', k, 1)).join('')}
        <div class="small muted" style="margin:8px 0 6px">${t('ed_tokens_hint')}</div>
        <div class="toks">${TOKENS.map(([k, lab]) => `<button type="button" class="chip" data-tok="${k}" aria-label="${esc(t(lab))}" data-tip="${esc(t(lab))}">{{${k}}}</button>`).join('')}</div>
        <button class="btn sm mt" id="lReset">${icon('undo')}${t('ed_reset')}</button>`;
      $$('[data-pos]', ov).forEach((b) => (b.onclick = () => { const [k, p] = b.dataset.pos.split(':'); collect(); layout.logo[k] = p; snap(); drawLayout(); draw(); }));
      $$('[data-lay]', ov).forEach((f) => {
        f.addEventListener('focus', () => { lastField = f; });
        f.addEventListener('input', () => { const [grp, k] = f.dataset.lay.split('.'); layout[grp][k] = f.value; drawPreviewStrips(); clearTimeout(histTimer); histTimer = setTimeout(() => { collect(); snap(); }, 500); });
      });
      $$('[data-tok]', ov).forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => { const f = lastField && lastField.isConnected ? lastField : $('[data-lay="footer.left"]', ov); f.focus(); const s = f.selectionStart == null ? f.value.length : f.selectionStart, e2 = f.selectionEnd == null ? s : f.selectionEnd; f.setRangeText(`{{${b.dataset.tok}}}`, s, e2, 'end'); f.dispatchEvent(new Event('input')); }; });
      q('#lReset').onclick = () => { collect(); layout = clone(defLayout); snap(); drawLayout(); draw(); };
    }
    function drawPreviewStrips() {
      const head = $('#dHead', page), foot = $('#dFoot', page);
      if (!head || !foot) return;
      const pages = blocks.filter((b) => b.type === 'h1').length + 1;
      const fill = (txt) => esc(X.fillPlain(txt, { title, date: X.fmtDate(meta.date), meta }, 2, pages)).replace(/\n/g, '<br>');
      const cell = (grp, k) => `<div class="c ${k}">${grp === 'header' && layout.logo.header === k ? logoImg() : ''}${fill(layout[grp][k])}</div>`;
      head.innerHTML = layout.logo.header === 'hidden' && !['left', 'center', 'right'].some((k) => layout.header[k].trim()) ? '' : ['left', 'center', 'right'].map((k) => cell('header', k)).join('');
      foot.innerHTML = ['left', 'center', 'right'].some((k) => layout.footer[k].trim()) ? ['left', 'center', 'right'].map((k) => cell('footer', k)).join('') : '';
      head.classList.toggle('empty', !head.innerHTML); foot.classList.toggle('empty', !foot.innerHTML);
    }

    // ----- toolbar -----
    ['tBold', 'tItal'].forEach((id) => { const b = q('#' + id); b.onmousedown = (e) => e.preventDefault(); b.onclick = () => { document.execCommand(id === 'tBold' ? 'bold' : 'italic'); changed(); }; });
    $$('[data-ins]', ov).forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => insertAfter(b.dataset.ins, focusId); });
    q('#tUndo').onclick = undo; q('#tRedo').onclick = redoIt;
    q('#dTitle').addEventListener('input', changed);
    ov.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) { if (e.target.id === 'dTitle' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return; e.preventDefault(); if (k === 'y' || e.shiftKey) redoIt(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); q('#dSave').click(); }
      else if (e.key === 'Escape' && !document.querySelector('.overlay')) { q('#dClose').click(); }
    });

    // ----- save, download, close, template -----
    const outLayout = () => (sameLayout(layout, defLayout) ? null : layout);
    const current = () => { collect(); return { ...g, title: title.trim() || g.title, content: toMd(blocks), layout: outLayout() || undefined }; };
    const dirty = () => { collect(); return state() !== lastSaved; };
    function close() { document.body.classList.remove('ded-open'); ov.remove(); }
    q('#dClose').onclick = async () => {
      if (dirty() && !(await confirmDlg({ title: t('ed_discard'), message: t('ed_unsaved'), ok: t('ed_discard'), danger: true }))) return;
      close(); opts.onClose && opts.onClose();
    };
    q('#dSave').onclick = async () => {
      const c = current();
      if (!c.title) { q('#dTitle').focus(); return; }
      const r = await busy(q('#dSave'), () => api('PUT', `/api/generated/${g.id}`, { title: c.title, content: c.content, layout: outLayout() }));
      if (!r) return;
      g.title = r.generated.title; g.content = c.content; if (outLayout()) g.layout = layout; else delete g.layout;
      title = g.title; lastSaved = state(); toast(t('saved'), 'ok');
      opts.onSaved && opts.onSaved(g);
    };
    q('#dDl').onclick = async () => { const c = current(); const ok = await busy(q('#dDl'), async () => { await X.download(c); return true; }); if (ok) toast(t('download_ready'), 'ok'); };
    q('#dTpl').onclick = () => templateDialog();

    function templateDialog() {
      collect();
      const R = window.__Reports;
      const heads = blocks.filter((b) => b.type === 'h1');
      const keyOf = (h) => (R && R.matchGenerator ? R.matchGenerator(htmlText(h), g.doc_type) : null);
      const m = modal({
        title: t('ed_save_tpl'), size: 'lg',
        body: `<div class="form-grid"><label class="f full">${t('template_name')}<input type="text" id="tplName" maxlength="120" value="${esc(title.trim())}"></label>
          <fieldset class="f full" style="border:0;padding:0;margin:0"><legend class="lb">${t('ed_tpl_scope')}</legend>
            <label class="radio"><input type="radio" name="tplScope" value="type" checked> ${esc(t('ed_scope_type'))}</label>
            <label class="radio"><input type="radio" name="tplScope" value="all"> ${esc(t('ed_scope_all'))}</label></fieldset>
          <div class="full"><div class="lb">${t('ed_tpl_sections')}</div><div class="small muted mb">${t('ed_tpl_note')}</div>
            <div id="tplSecs">${heads.map((h, i) => { const k = keyOf(h.html); return `<div class="ded-tsec"><span class="nm">${esc(htmlText(h.html) || t('ed_untitled'))}</span><select data-sec="${i}" aria-label="${esc(htmlText(h.html))}" ${k ? '' : 'disabled'}><option value="refresh" ${k ? 'selected' : ''}>${esc(t('ed_tpl_refresh'))}</option><option value="fixed" ${k ? '' : 'selected'}>${esc(t('ed_tpl_fixed'))}</option></select></div>`; }).join('') || `<div class="small muted">${t('ed_no_sections')}</div>`}</div></div></div>`,
        footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="tplOk">${t('save')}</button>`,
      });
      m.$('#tplOk').onclick = async () => {
        const name = m.$('#tplName').value.trim();
        if (!name) { m.$('#tplName').focus(); return; }
        const names = [[meta.project, '{{project.name}}'], [meta.client, '{{project.client}}'], [meta.pm, '{{pm.name}}']].filter((x) => x[0] && String(x[0]).length > 2);
        const tok = (s) => names.reduce((a, [v, tk]) => a.split(v).join(tk), s);
        const secTok = (s) => [[meta.project, '{{project}}'], [meta.client, '{{client}}'], [meta.pm, '{{pm}}']].filter((x) => x[0] && String(x[0]).length > 2).reduce((a, [v, tk]) => a.split(v).join(tk), s);
        const modes = $$('#tplSecs select', m.el).map((s) => s.value);
        let out = '', si = -1, cur = null;
        const flush = () => { if (cur) { out += `# ${cur.head}\n\n${cur.fixed ? '<!-- fixed -->\n' : ''}${cur.fixed ? tok(cur.body.join('\n\n')) : ''}\n\n`; cur = null; } };
        for (const b of blocks) {
          if (b.type === 'h1') { flush(); si++; cur = { head: tok(htmlMd(b.html).replace(/[*_]/g, '')), fixed: modes[si] === 'fixed', body: [] }; }
          else { if (!cur) { cur = { head: 'Overview', fixed: true, body: [] }; } cur.body.push(blockMd(b)); }
        }
        flush();
        const lay = clone(layout); for (const grp of ['header', 'footer']) for (const k of ['left', 'center', 'right']) lay[grp][k] = secTok(lay[grp][k]);
        const fd = new FormData();
        fd.append('name', name); fd.append('doc_type', (m.$('input[name=tplScope]:checked') || {}).value === 'all' ? '*' : g.doc_type); fd.append('body', out.trim() + '\n'); fd.append('layout', JSON.stringify(lay)); if (brand) fd.append('brand', JSON.stringify(brand));
        const r = await busy(m.$('#tplOk'), () => api('POST', '/api/templates', fd));
        if (r) { m.close(); toast(t('ed_tpl_saved'), 'ok'); opts.onTemplate && opts.onTemplate(r.template); }
      };
      m.$('#tplName').focus();
    }

    draw(); drawLayout();
    lastSaved = state(); hist.push(lastSaved); buttons();
    const first = $('.ded-blk [contenteditable]', page); if (first) first.focus();
    return { close };
  }

  PM.docEditor = { open, parse, toMd, inlineToHtml, htmlToInline };
})();
