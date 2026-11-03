/* Brand kit view: logo versions for light and dark backgrounds, English and Arabic, plus the responsive logo. */
(function () {
  const PM = window.PM;
  Object.assign(PM.I18N.en, {
    nav_brand: 'Brand kit', brand_title: 'Brand kit', brand_sub: 'Logo files for Project Manager AI. Choose the version that matches the background and the space.',
    brand_full: 'Full logo', brand_full_hint: 'Use on websites, documents and presentations. The wordmark follows the language of the product.',
    brand_on_light: 'Light background', brand_on_dark: 'Dark background', brand_en: 'English', brand_ar: 'Arabic',
    brand_icon: 'App icon', brand_icon_hint: 'The mark works alone at small sizes. It is the favicon, the app icon and the avatar.',
    brand_stacked: 'Stacked logo', brand_stacked_hint: 'Use on splash screens, covers and square spaces.',
    brand_resp: 'Responsive logo', brand_resp_hint: 'The full logo switches to the mark when the space is narrower than 220 px. Drag the slider to try it.',
    brand_width: 'Available width', brand_mode_full: 'Showing the full logo', brand_mode_mark: 'Showing the mark only',
    brand_colors: 'Colors', brand_clear: 'Clear space and size', brand_clear_text: 'Keep a margin of one quarter of the mark height around the logo. Do not place text or edges inside it. The mark is never smaller than 16 px. The full logo is never narrower than 160 px.',
    brand_files: 'Files', brand_file: 'File', brand_version: 'Version', brand_copy: 'Copy SVG', brand_copied: 'SVG copied', brand_copy_fail: 'Copy is not available here. Select the logo file from the list and copy it from there.',
    brand_png: 'PNG, 2000 px wide', brand_png_mark: 'PNG, 512 px',
    brand_c_blue: 'Brand blue', brand_c_violet: 'Brand violet', brand_c_ai_light: 'AI accent on light', brand_c_ai_dark: 'AI accent on dark', brand_c_ink: 'Ink', brand_c_night: 'Night',
  });
  Object.assign(PM.I18N.ar, {
    nav_brand: 'هوية العلامة', brand_title: 'هوية العلامة', brand_sub: 'ملفات شعار مدير المشاريع الذكي. اختر النسخة التي تناسب الخلفية والمساحة.',
    brand_full: 'الشعار الكامل', brand_full_hint: 'للمواقع والمستندات والعروض. تتبع الكلمة لغة المنتج.',
    brand_on_light: 'خلفية فاتحة', brand_on_dark: 'خلفية داكنة', brand_en: 'الإنجليزية', brand_ar: 'العربية',
    brand_icon: 'أيقونة التطبيق', brand_icon_hint: 'تعمل العلامة وحدها بالأحجام الصغيرة. وهي أيقونة المتصفح وأيقونة التطبيق والصورة الرمزية.',
    brand_stacked: 'الشعار العمودي', brand_stacked_hint: 'لشاشات البداية والأغلفة والمساحات المربعة.',
    brand_resp: 'الشعار المتجاوب', brand_resp_hint: 'يتحول الشعار الكامل إلى العلامة وحدها عندما تقل المساحة عن 220 بكسل. حرّك المؤشر لتجربته.',
    brand_width: 'العرض المتاح', brand_mode_full: 'يظهر الشعار الكامل', brand_mode_mark: 'تظهر العلامة وحدها',
    brand_colors: 'الألوان', brand_clear: 'المساحة الحرة والحجم', brand_clear_text: 'اترك هامشا يساوي ربع ارتفاع العلامة حول الشعار. لا تضع نصا أو حافة داخله. لا يقل حجم العلامة عن 16 بكسل، ولا يقل عرض الشعار الكامل عن 160 بكسل.',
    brand_files: 'الملفات', brand_file: 'الملف', brand_version: 'النسخة', brand_copy: 'نسخ SVG', brand_copied: 'تم نسخ SVG', brand_copy_fail: 'النسخ غير متاح هنا. اختر ملف الشعار من القائمة وانسخه منه.',
    brand_png: 'PNG بعرض 2000 بكسل', brand_png_mark: 'PNG بعرض 512 بكسل',
    brand_c_blue: 'الأزرق', brand_c_violet: 'البنفسجي', brand_c_ai_light: 'لون الذكاء على الفاتح', brand_c_ai_dark: 'لون الذكاء على الداكن', brand_c_ink: 'الحبر', brand_c_night: 'الليل',
  });

  const SWATCHES = [['brand_c_blue', '#3B82F6'], ['brand_c_violet', '#8B5CF6'], ['brand_c_ai_light', '#7C3AED'], ['brand_c_ai_dark', '#A78BFA'], ['brand_c_ink', '#10172B'], ['brand_c_night', '#0B1020']];
  const THRESHOLD = 220;

  function html() {
    const t = PM.t, L = PM.logo, lang = PM.state.lang === 'ar' ? 'ar' : 'en';
    const lbl = (l, th) => `${t(l === 'ar' ? 'brand_ar' : 'brand_en')}, ${t(th === 'dark' ? 'brand_on_dark' : 'brand_on_light')}`;
    const svg = (kind, l, cls) => (kind === 'mark' ? L.mark(cls) : kind === 'full' ? L.full(l, cls) : L.stacked(l, cls));
    const panel = (kind, l, th, cls) => `<figure class="lg-panel ${th}"><div class="lg-stage">${svg(kind, l, cls)}</div><figcaption><span class="grow">${lbl(l, th)}</span><button class="btn sm" type="button" data-copy="${kind}|${l}|${th}">${t('brand_copy')}</button></figcaption></figure>`;
    const four = (kind, cls) => `<div class="grid g2">${['light', 'dark'].map((th) => panel(kind, 'en', th, cls)).join('')}${['light', 'dark'].map((th) => panel(kind, 'ar', th, cls)).join('')}</div>`;
    const sizes = (th) => `<figure class="lg-panel ${th}"><div class="lg-stage lg-sizes">${[96, 48, 32, 16].map((s) => `<div class="lg-size"><span class="lg-sz s${s}">${L.mark('')}</span><span class="small">${s} px</span></div>`).join('')}</div><figcaption><span class="grow">${t(th === 'dark' ? 'brand_on_dark' : 'brand_on_light')}</span><button class="btn sm" type="button" data-copy="mark|en|${th}">${t('brand_copy')}</button></figcaption></figure>`;
    const sec = (title, hint, body) => `<section class="card mt"><div class="card-head"><h3>${title}</h3></div><p class="small muted lg-hint">${hint}</p>${body}</section>`;
    const label = (f) => `${t(f.kind === 'mark' ? 'brand_icon' : f.kind === 'full' ? 'brand_full' : 'brand_stacked')}${f.kind === 'mark' ? '' : `, ${t(f.lang === 'ar' ? 'brand_ar' : 'brand_en')}, ${t(f.theme === 'dark' ? 'brand_on_dark' : 'brand_on_light')}`}`;
    const rows = L.files.map((f) => `<tr><td><code class="lg-code">${f.path}</code></td><td>${label(f)}</td></tr>`)
      .concat([['brand/full-light.png', `${t('brand_full')}, ${t('brand_en')}, ${t('brand_on_light')}, ${t('brand_png')}`], ['brand/full-dark.png', `${t('brand_full')}, ${t('brand_en')}, ${t('brand_on_dark')}, ${t('brand_png')}`], ['brand/mark-512.png', `${t('brand_icon')}, ${t('brand_png_mark')}`]].map((r) => `<tr><td><code class="lg-code">${r[0]}</code></td><td>${r[1]}</td></tr>`)).join('');
    return `<div class="page lg-page" id="brandPage">
      <div class="page-head"><h1>${t('brand_title')}</h1></div>
      <p class="muted lg-lead">${t('brand_sub')}</p>
      ${sec(t('brand_full'), t('brand_full_hint'), four('full', 'sz-full'))}
      ${sec(t('brand_icon'), t('brand_icon_hint'), `<div class="grid g2">${sizes('light')}${sizes('dark')}</div>`)}
      ${sec(t('brand_stacked'), t('brand_stacked_hint'), four('stacked', 'sz-stacked'))}
      ${sec(t('brand_resp'), t('brand_resp_hint'), `<label class="f" for="lgWidth"><span>${t('brand_width')}: <b id="lgWidthV" class="lg-num">320 px</b></span><input id="lgWidth" type="range" min="64" max="520" step="4" value="320"></label>
        <div class="lg-demo-stage"><div class="lg-demo-box" id="lgBox" style="width:320px">${L.responsive(lang)}</div></div>
        <div class="row mt"><span class="chip blue" id="lgMode">${t('brand_mode_full')}</span></div>`)}
      <div class="grid g2 mt">
        <section class="card"><div class="card-head"><h3>${t('brand_colors')}</h3></div><div class="lg-swatches">${SWATCHES.map((s) => `<div class="lg-sw"><span class="lg-chip" style="background:${s[1]}"></span><div><div class="lg-sw-name">${t(s[0])}</div><div class="small muted lg-num">${s[1]}</div></div></div>`).join('')}</div></section>
        <section class="card"><div class="card-head"><h3>${t('brand_clear')}</h3></div><div class="lg-clear-wrap"><span class="lg-clear">${L.mark('lg-clear-mark')}</span><p class="small muted lg-hint">${t('brand_clear_text')}</p></div></section>
      </div>
      <section class="card mt"><div class="card-head"><h3>${t('brand_files')}</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>${t('brand_file')}</th><th>${t('brand_version')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    </div>`;
  }
  PM.brandHtml = html;

  function copyText(text) {
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;inset-inline-start:0;top:0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); return ok; };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    return Promise.resolve(fallback());
  }

  PM.views.brand = async function () {
    await PM.loadProjects();
    PM.shell('brand', html());
    const root = document.getElementById('brandPage');
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-copy]'); if (!b) return;
      const [kind, l, th] = b.dataset.copy.split('|');
      const ok = await copyText(PM.logo.source(kind, l, th));
      PM.toast(PM.t(ok ? 'brand_copied' : 'brand_copy_fail'), ok ? 'ok' : 'err');
    });
    const range = document.getElementById('lgWidth'), box = document.getElementById('lgBox'), val = document.getElementById('lgWidthV'), mode = document.getElementById('lgMode');
    range.addEventListener('input', () => {
      const w = Number(range.value), full = w >= THRESHOLD;
      box.style.width = w + 'px'; val.textContent = w + ' px';
      mode.textContent = PM.t(full ? 'brand_mode_full' : 'brand_mode_mark'); mode.className = 'chip ' + (full ? 'blue' : 'gray');
    });
  };
})();
