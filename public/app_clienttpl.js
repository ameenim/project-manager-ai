/* Client templates: upload a client's Word or PowerPoint file, review what was read from it, and change it.
   The colors, fonts and logo of a client template replace the platform design in every document made from it. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, confirmDlg, busy } = PM;

  const COLOR_ROLES = [['primary', 'ct_c_primary', 'ct_c_primary_hint'], ['secondary', 'ct_c_secondary', 'ct_c_secondary_hint'], ['accent', 'ct_c_accent', 'ct_c_accent_hint'], ['text', 'ct_c_text', 'ct_c_text_hint'], ['muted', 'ct_c_muted', 'ct_c_muted_hint']];
  const FONTS = ['Calibri', 'Arial', 'Aptos', 'Cambria', 'Garamond', 'Georgia', 'Helvetica', 'IBM Plex Sans', 'Open Sans', 'Roboto', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const DEFAULT_BRAND = () => ({ v: 1, colors: { primary: '2457D6', secondary: '1F2F55', accent: '1BAF7A', text: '1B2437', muted: '5B6680' }, fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' }, logo: null });
  const HEX = /^[0-9A-Fa-f]{6}$/;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // A logo picked by the project manager is redrawn as a PNG no larger than 800 pixels.
  function readLogo(file) {
    return new Promise((ok, no) => {
      if (!/^image\/(png|jpeg|gif|svg\+xml)$/.test(file.type)) return no(new Error(t('ct_logo_type')));
      const fr = new FileReader();
      fr.onerror = () => no(new Error(t('ct_logo_type')));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => no(new Error(t('ct_logo_type')));
        img.onload = () => {
          const nw = img.naturalWidth || 300, nh = img.naturalHeight || 100, k = Math.min(1, 800 / Math.max(nw, nh));
          const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          ok({ dataUrl: cv.toDataURL('image/png'), w, h });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // ---------- upload ----------
  // The PM chooses what to take from the file. A design pattern applies to every document type, so no type is asked for.
  // The structure and both need one document type, and the dialog will not continue without it.
  const MODE_KEYS = ['design', 'structure', 'both'];
  const MODE_ICON = { design: 'spark', structure: 'file', both: 'check' };
  async function upload(opts) {
    opts = opts || {};
    let types = opts.types;
    if (!types) { try { types = (await api('GET', '/api/doc-types')).types; } catch (e) { types = []; } }
    const typeOpts = (list) => list.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('');
    const m = modal({
      title: t('ct_upload_title'), size: 'lg', noBackdropClose: true,
      body: `<div id="ctUp"><p class="small muted" style="margin-top:0">${t('ct_upload_intro')}</p>
        <label class="ct-drop" id="ctDrop" tabindex="0"><span class="ico">${icon('dl')}</span><strong id="ctFileName">${t('ct_drop')}</strong><span class="small muted">${t('ct_drop_hint')}</span>
          <input type="file" id="ctFile" accept=".docx,.dotx,.pptx,.potx,.ppsx,.xlsx,.xltx" hidden></label>
        <div class="fmt-pick" style="margin-top:14px"><span class="lbl" id="ctModeL">${t('ct_mode_label')}</span>
          <div class="seg" role="radiogroup" aria-labelledby="ctModeL">${MODE_KEYS.map((k) => `<button type="button" role="radio" aria-checked="false" data-mode="${k}">${icon(MODE_ICON[k])}${t('ct_mode_' + k)}</button>`).join('')}</div>
          <div class="small muted" id="ctModeHint" role="status">${t('ct_mode_none_hint')}</div></div>
        <label class="f" id="ctTypeWrap" style="margin-top:12px" hidden>${t('ct_type_label')}<select id="ctType" required aria-required="true"><option value="">${t('ct_type_ph')}</option>
          <optgroup label="${t('grp_progress')}">${typeOpts(types.filter((x) => x.progress))}</optgroup><optgroup label="${t('grp_project')}">${typeOpts(types.filter((x) => !x.progress))}</optgroup></select></label>
        <div class="small muted" id="ctAllNote" style="margin-top:12px" hidden>${icon('check')} ${t('ct_type_all')}</div>
        <label class="f" style="margin-top:12px">${t('template_name')}<input type="text" id="ctName" maxlength="120" placeholder="${esc(t('ct_name_ph'))}"></label>
        <div class="small muted" id="ctXlNote" style="margin-top:8px" hidden>${t('ct_excel_note')}</div>
        <div class="small muted" style="margin-top:8px">${t('ct_reads')}</div>
        <div id="ctErr" class="fv-err" role="alert" hidden></div></div>`,
      footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="ctGo" disabled>${icon('spark')}${t('ct_read')}</button>`,
    });
    let file = null, mode = null;
    const needsType = () => mode === 'structure' || mode === 'both';
    const refresh = () => {
      $$('[data-mode]', m.el).forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      $('#ctModeHint', m.el).textContent = mode ? t(`ct_mode_${mode}_hint`) : t('ct_mode_none_hint');
      $('#ctTypeWrap', m.el).hidden = !needsType();
      $('#ctAllNote', m.el).hidden = mode !== 'design';
      $('#ctXlNote', m.el).hidden = !(file && /\.(xlsx|xltx)$/i.test(file.name) && needsType());
      const err = $('#ctErr', m.el);
      const missingType = needsType() && !$('#ctType', m.el).value;
      $('#ctGo', m.el).disabled = !(file && mode && !missingType);
      if (file && mode && missingType) { err.textContent = t('ct_type_need'); err.hidden = false; } else err.hidden = true;
    };
    const pick = (f) => {
      if (!f) return;
      file = f; $('#ctFileName', m.el).textContent = f.name;
      const nm = $('#ctName', m.el); if (!nm.value) nm.placeholder = f.name.replace(/\.[^.]+$/, '');
      refresh();
    };
    const input = $('#ctFile', m.el), drop = $('#ctDrop', m.el);
    input.onchange = () => pick(input.files[0]);
    $$('[data-mode]', m.el).forEach((b) => (b.onclick = () => { mode = b.dataset.mode; refresh(); }));
    $('#ctType', m.el).onchange = refresh;
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
    $('#ctGo', m.el).onclick = async () => {
      const steps = ['ct_s_open', 'ct_s_find', 'ct_s_build'];
      const tplName = $('#ctName', m.el).value.trim();
      const docType = needsType() ? $('#ctType', m.el).value : '';
      $('#ctUp', m.el).innerHTML = `<div class="gen-run" role="status" aria-live="polite"><div class="progress"><i id="ctBar" style="width:8%"></i></div><ul class="gen-steps">${steps.map((k, i) => `<li data-i="${i}" class="${i ? '' : 'on'}"><span class="dot"></span><span>${t(k)}</span></li>`).join('')}</ul></div>`;
      m.setFooter('');
      const lis = $$('.gen-steps li', m.el), bar = $('#ctBar', m.el);
      const at = (i) => { lis.forEach((li, n) => { li.className = n < i ? 'done' : n === i ? 'on' : ''; }); bar.style.width = `${Math.round(((i + 0.5) / steps.length) * 100)}%`; };
      const timer = setTimeout(() => at(1), 700);
      const fd = new FormData(); fd.append('file', file); fd.append('name', tplName); fd.append('mode', mode); if (docType) fd.append('doc_type', docType);
      try {
        const r = await api('POST', '/api/templates/client', fd);
        clearTimeout(timer); at(2);
        await new Promise((ok) => setTimeout(ok, 350));
        m.close();
        toast(t('ct_created'), 'ok');
        opts.onCreated && opts.onCreated(r.template);
        open(r.template.id, { ...opts, fresh: r });
      } catch (e) {
        clearTimeout(timer); m.close();
        toast(e.message, 'err');
      }
    };
    drop.focus();
  }

  // ---------- view and change ----------
  async function open(id, opts) {
    opts = opts || {};
    const tpl = (await api('GET', `/api/templates/${id}`)).template;
    let brand = tpl.brand ? clone(tpl.brand) : null;
    let layout = tpl.layout ? clone(tpl.layout) : null;
    let sections = tpl.sections.slice();
    let name = tpl.name;
    const mode = tpl.mode || (tpl.brand ? 'both' : 'structure');
    const hasDesign = mode !== 'structure', hasStruct = mode !== 'design';
    const docTypes = opts.types || ((await api('GET', '/api/doc-types').catch(() => ({ types: [] }))).types);
    const typeTitle = tpl.doc_type === '*' ? t('all_types') : ((docTypes.find((x) => x.id === tpl.doc_type) || {}).title || tpl.doc_type);
    let dirty = false;
    const X = PM.exporter;
    const fresh = opts.fresh;
    const warn = fresh ? (fresh.warnings || []).map((w) => ({ logo_too_large: 'ct_w_logo_big', logo_format: 'ct_w_logo_format', few_styles: 'ct_w_few', ai_failed: 'ct_w_ai' }[w])).filter(Boolean) : [];
    const m = modal({ title: t('ct_view_title'), size: 'xl', noBackdropClose: true, body: '<div id="ctBody"></div>', footer: '' });
    const body = () => $('#ctBody', m.el);
    const mark = () => { dirty = true; };

    function previewHtml() {
      if (!brand) return `<div class="small muted">${t('ct_no_brand_note')}</div>`;
      const k = X.brandTokens(brand), f = brand.fonts;
      const H = `font-family:'${esc(f.heading)}',${'Calibri,Arial,sans-serif'}`, B = `font-family:'${esc(f.body)}',Calibri,Arial,sans-serif`;
      const logo = brand.logo ? `<img src="${brand.logo.dataUrl}" alt="${esc(t('ct_logo'))}">` : `<span class="ct-nologo">${t('ct_no_logo')}</span>`;
      const lay = layout || X.DEFAULT_LAYOUT;
      const head = (lay.header.right || '').split('\n')[0].replace(/\{\{\s*(\w+)\s*\}\}/g, (a, w) => ({ project: 'Project name', client: 'Client' }[w] || ''));
      return `<div class="ct-pv" style="${B};color:#${k.text}">
        <div class="cv" style="border-bottom:4px solid #${k.primary}"><div class="lg">${logo}</div><div class="ty" style="${H};color:#${k.text}">${esc(t('ct_pv_title'))}</div><div style="color:#${k.muted}" class="sm">${esc(t('ct_pv_sub'))}</div></div>
        <div class="hd" style="border-bottom:1px solid #${k.border};color:#${k.muted}"><span class="lg2">${brand.logo ? `<img src="${brand.logo.dataUrl}" alt="">` : ''}</span><span>${esc(head)}</span></div>
        <h4 style="${H};color:#${k.text};border-bottom:2px solid #${k.primary}">${esc(t('ct_pv_h'))}</h4>
        <p>${esc(t('ct_pv_p'))} <b>${esc(t('ct_pv_b'))}</b></p>
        <table><thead><tr><th style="background:#${k.primary};color:#${k.onPrimary}">${esc(t('ct_pv_th1'))}</th><th style="background:#${k.primary};color:#${k.onPrimary}">${esc(t('ct_pv_th2'))}</th></tr></thead><tbody><tr><td>${esc(t('ct_pv_r1'))}</td><td>82%</td></tr><tr><td style="background:#${k.surface2}">${esc(t('ct_pv_r2'))}</td><td style="background:#${k.surface2}">64%</td></tr></tbody></table>
        <div class="bars"><i style="width:82%;background:#${k.c1}"></i><i style="width:64%;background:#${k.c2}"></i><i style="width:41%;background:#${k.c3}"></i></div>
        <div class="ft" style="border-top:1px solid #${k.border};color:#${k.muted}">${esc(t('ct_pv_foot'))}</div></div>`;
    }
    const readability = (role, hex) => {
      if (!HEX.test(hex)) return '';
      const C = X.contrast, lim = { primary: 3, text: 7, muted: 4.5 }[role];
      if (!lim) return '';
      const c = C(hex.toUpperCase(), 'FFFFFF');
      return c >= lim ? `<span class="ct-ok">${esc(t('ct_readable'))}</span>` : `<span class="ct-warn">${esc(t('ct_too_light'))}</span>`;
    };

    function draw() {
      const warnHtml = warn.length ? `<div class="ct-note warn" role="status">${warn.map((k) => `<div>${esc(t(k))}</div>`).join('')}</div>` : '';
      const src = brand && brand.source ? t('ct_source', { f: brand.source.filename, k: brand.source.kind }) : '';
      const engine = fresh ? ` ${t(fresh.engine === 'claude' ? 'ct_by_ai' : 'ct_by_rules')}` : '';
      const foundKey = mode === 'design' ? (fresh && fresh.found.logo ? 'ct_found_design_logo' : 'ct_found_design_nologo') : mode === 'structure' ? 'ct_found_struct' : (fresh && fresh.found.logo ? 'ct_found_logo' : 'ct_found_nologo');
      const introLine = fresh && hasDesign ? ` ${t(fresh.found.intro ? 'ct_found_intro' : 'ct_found_nointro', { p: t('ed_pos_' + (fresh.found.intro_logo || 'left')).toLowerCase() })}` : '';
      const found = fresh ? `<div class="ct-note ok" role="status">${esc(t(foundKey, { h: fresh.found.headings }) + introLine)}</div>` : '';
      const modeLine = `<div class="small muted" style="margin:10px 0 14px"><span class="chip blue">${esc(t('ct_chip_' + mode))}</span> ${esc(t('ct_type_line', { t: typeTitle }))}</div>`;
      const colorRows = brand && hasDesign ? COLOR_ROLES.map(([k, lab, hint]) => `<div class="ct-row"><div class="nm"><div>${esc(t(lab))}</div><div class="small muted">${esc(t(hint))}</div></div>
          <input type="color" data-cp="${k}" value="#${brand.colors[k]}" aria-label="${esc(t(lab))}"><input type="text" class="hex" data-ch="${k}" value="${brand.colors[k]}" maxlength="7" aria-label="${esc(t(lab))} hex" spellcheck="false"><span class="rd" data-rd="${k}">${readability(k, brand.colors[k])}</span></div>`).join('') : '';
      const fontRows = brand && hasDesign ? ['heading', 'body'].map((k) => `<label class="f"><span class="lb">${esc(t('ct_font_' + k))}</span><input type="text" list="ctFonts" data-font="${k}" value="${esc(brand.fonts[k])}" maxlength="60"></label>`).join('') : '';
      const lay = layout || X.DEFAULT_LAYOUT;
      const posRow = (key, lab) => `<div class="f"><span class="lb">${esc(t(lab))}</span><div class="seg">${['left', 'center', 'right', 'hidden'].map((p) => `<button type="button" class="${lay.logo[key] === p ? 'on' : ''}" data-pos="${key}:${p}" aria-pressed="${lay.logo[key] === p}">${esc(t('ed_pos_' + p))}</button>`).join('')}</div></div>`;
      body().innerHTML = `${found}${warnHtml}
        <div class="ct-grid${hasDesign ? '' : ' one'}"><div class="ct-form">
          <label class="f"><span class="lb">${t('template_name')}</span><input type="text" id="ctN" maxlength="120" value="${esc(name)}"></label>
          ${modeLine}
          ${src ? `<div class="small muted" style="margin:-4px 0 12px">${esc(src)}${esc(engine)}</div>` : ''}
          ${!hasDesign ? '' : brand ? `<section><h3>${t('ct_colors')}</h3>${colorRows}</section>
          <section><h3>${t('ct_fonts')}</h3><div class="ct-fonts">${fontRows}</div><datalist id="ctFonts">${FONTS.map((f) => `<option value="${esc(f)}">`).join('')}</datalist><div class="small muted">${t('ct_font_note')}</div></section>
          <section><h3>${t('ct_logo')}</h3><div class="ct-logo"><div class="box">${brand.logo ? `<img src="${brand.logo.dataUrl}" alt="${esc(t('ct_logo'))}">` : `<span class="small muted">${t('ct_no_logo')}</span>`}</div>
            <div class="col"><label class="btn sm" for="ctLogoIn">${icon('dl')}${t(brand.logo ? 'ct_logo_replace' : 'ct_logo_add')}</label><input type="file" id="ctLogoIn" accept="image/png,image/jpeg,image/gif,image/svg+xml" hidden>
            ${brand.logo ? `<button class="btn sm" id="ctLogoRm">${icon('trash')}${t('ct_logo_remove')}</button>` : ''}<div class="small muted">${t('ct_logo_hint')}</div></div></div>
            ${layout ? `<div class="ct-pos">${posRow('cover', 'ed_logo_cover')}${posRow('header', 'ed_logo_header')}</div>` : ''}</section>`
          : `<section><h3>${t('ct_colors')}</h3><p class="small muted">${t('ct_no_brand_note')}</p><button class="btn sm" id="ctAddBrand">${icon('plus')}${t('ct_add_brand')}</button></section>`}
          ${hasStruct ? `<section><h3>${t('ct_sections')}</h3><div class="small muted mb">${t('ct_sections_hint')}</div><ol class="ct-secs" id="ctSecs">${sections.map((s, i) => `<li><input type="text" data-sec="${i}" value="${esc(s)}" maxlength="100" aria-label="${esc(t('ct_section_n', { n: i + 1 }))}">
            <button class="btn sm ghost icon" data-su="${i}" ${i ? '' : 'disabled'} aria-label="${esc(t('ed_move_up'))}"><span style="display:inline-flex;transform:rotate(180deg)">${icon('down')}</span></button><button class="btn sm ghost icon" data-sd="${i}" ${i < sections.length - 1 ? '' : 'disabled'} aria-label="${esc(t('ed_move_down'))}">${icon('down')}</button><button class="btn sm ghost icon" data-sx="${i}" aria-label="${esc(t('delete'))}">${icon('trash')}</button></li>`).join('') || `<li class="small muted">${t('ct_no_sections')}</li>`}</ol>
            <div class="row" style="gap:8px;margin-top:8px"><input type="text" id="ctNewSec" maxlength="100" placeholder="${esc(t('ct_add_section_ph'))}" style="flex:1"><button class="btn sm" id="ctAddSec">${icon('plus')}${t('ct_add_section')}</button></div></section>` : ''}
          ${layout && hasDesign ? `<details class="ct-det"><summary>${t('ct_hf')}</summary><div class="ct-hf">${['header', 'footer'].map((g) => `<div><div class="lb">${esc(t(g === 'header' ? 'ed_header' : 'ed_footer'))}</div>${['left', 'center', 'right'].map((k) => `<label class="f"><span class="small muted">${esc(t('ed_pos_' + k))}</span><input type="text" data-lay="${g}.${k}" value="${esc(String(lay[g][k]).replace(/\n/g, ' / '))}" maxlength="160"></label>`).join('')}</div>`).join('')}<div class="small muted" style="grid-column:1/-1">${t('ed_tokens_hint')}</div></div></details>` : ''}
        </div>
        ${hasDesign ? `<aside class="ct-side" aria-label="${esc(t('ct_preview'))}"><h3>${t('ct_preview')}</h3><div id="ctPv">${previewHtml()}</div><div class="small muted" style="margin-top:8px">${t('ct_preview_note')}</div></aside>` : ''}</div>`;
      m.setFooter(`<span class="small muted grow">${t('ct_footer_note')}</span><button class="btn" id="ctClose">${t('cancel')}</button>${opts.onUse ? `<button class="btn" id="ctUse">${icon('file')}${t('ct_use')}</button>` : ''}<button class="btn primary" id="ctSave">${icon('check')}${t('save')}</button>`);
      wire();
    }
    const repaint = () => { const pv = $('#ctPv', m.el); if (pv) pv.innerHTML = previewHtml(); };

    function wire() {
      $('#ctN', m.el).oninput = (e) => { name = e.target.value; mark(); };
      $$('[data-cp]', m.el).forEach((p) => (p.oninput = () => { const k = p.dataset.cp, v = p.value.replace('#', '').toUpperCase(); brand.colors[k] = v; $(`[data-ch="${k}"]`, m.el).value = v; $(`[data-rd="${k}"]`, m.el).innerHTML = readability(k, v); mark(); repaint(); }));
      $$('[data-ch]', m.el).forEach((p) => {
        p.oninput = () => { const k = p.dataset.ch, v = p.value.replace('#', ''); p.classList.toggle('bad', !HEX.test(v)); if (!HEX.test(v)) return; brand.colors[k] = v.toUpperCase(); $(`[data-cp="${k}"]`, m.el).value = '#' + v.toLowerCase(); $(`[data-rd="${k}"]`, m.el).innerHTML = readability(k, v); mark(); repaint(); };
        p.onblur = () => { p.value = brand.colors[p.dataset.ch]; p.classList.remove('bad'); };
      });
      $$('[data-font]', m.el).forEach((f) => (f.oninput = () => { brand.fonts[f.dataset.font] = f.value.trim() || brand.fonts[f.dataset.font]; mark(); repaint(); }));
      const li = $('#ctLogoIn', m.el);
      if (li) li.onchange = async () => { try { brand.logo = await readLogo(li.files[0]); mark(); draw(); } catch (e) { toast(e.message, 'err'); } };
      const rm = $('#ctLogoRm', m.el); if (rm) rm.onclick = () => { brand.logo = null; mark(); draw(); };
      const ab = $('#ctAddBrand', m.el); if (ab) ab.onclick = () => { brand = DEFAULT_BRAND(); if (!layout) layout = clone(X.DEFAULT_LAYOUT); mark(); draw(); };
      $$('[data-pos]', m.el).forEach((b) => (b.onclick = () => { const [k, p] = b.dataset.pos.split(':'); layout.logo[k] = p; mark(); draw(); }));
      $$('[data-lay]', m.el).forEach((f) => (f.oninput = () => { const [g, k] = f.dataset.lay.split('.'); layout[g][k] = f.value.replace(/\s\/\s/g, '\n'); mark(); repaint(); }));
      $$('[data-sec]', m.el).forEach((f) => (f.oninput = () => { sections[Number(f.dataset.sec)] = f.value; mark(); }));
      const mv = (i, d) => { const j = i + d; if (j < 0 || j >= sections.length) return; [sections[i], sections[j]] = [sections[j], sections[i]]; mark(); draw(); };
      $$('[data-su]', m.el).forEach((b) => (b.onclick = () => mv(Number(b.dataset.su), -1)));
      $$('[data-sd]', m.el).forEach((b) => (b.onclick = () => mv(Number(b.dataset.sd), 1)));
      $$('[data-sx]', m.el).forEach((b) => (b.onclick = () => { sections.splice(Number(b.dataset.sx), 1); mark(); draw(); }));
      const add = () => { if (!hasStruct) return; const v = $('#ctNewSec', m.el).value.trim(); if (!v) return; sections.push(v); mark(); draw(); $('#ctNewSec', m.el).focus(); };
      if (hasStruct) { $('#ctAddSec', m.el).onclick = add; $('#ctNewSec', m.el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }; }
      $('#ctClose', m.el).onclick = async () => { if (dirty && !(await confirmDlg({ title: t('ed_discard'), message: t('ed_unsaved'), ok: t('ed_discard'), danger: true }))) return; m.close(); opts.onChanged && opts.onChanged(); };
      const save = async () => {
        const secs = sections.map((x) => x.trim()).filter(Boolean);
        const bodyReq = { name: name.trim(), ...(hasStruct ? { sections: secs } : {}), ...(hasDesign && brand ? { brand } : {}), ...(hasDesign && layout ? { layout } : {}) };
        const r = await busy($('#ctSave', m.el), () => api('PUT', `/api/templates/${id}`, bodyReq));
        if (!r) return false;
        brand = r.template.brand ? clone(r.template.brand) : null; layout = r.template.layout ? clone(r.template.layout) : null; sections = r.template.sections.slice(); name = r.template.name; dirty = false;
        toast(t('ct_saved'), 'ok'); opts.onChanged && opts.onChanged();
        return true;
      };
      $('#ctSave', m.el).onclick = async () => { if (await save()) draw(); };
      const use = $('#ctUse', m.el); if (use) use.onclick = async () => { if (dirty && !(await save())) return; m.close(); opts.onUse(id); };
    }
    draw();
    return m;
  }

  PM.clientTpl = { upload, open, readLogo };
})();
