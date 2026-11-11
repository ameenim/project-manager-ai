/* Guided Connect wizard for Jira and Outlook, and the connection rows used on the account page, onboarding and project settings. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, busy, state: S } = PM;

  const KINDS = {
    jira: { icon: 'jira', name: 'Jira', can: ['cx_jira_can1', 'cx_jira_can2'], console: 'https://developer.atlassian.com/console/myapps/' },
    outlook: { icon: 'mail', name: 'Outlook', can: ['cx_out_can1', 'cx_out_can2'], console: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
  };
  const refreshStatus = async () => { try { S.status = (await api('GET', '/api/me')).status; } catch { /* status refreshes on the next load */ } };

  function wizard(kind, onDone) {
    const K = KINDS[kind], STEPS = ['cx_s_start', 'cx_s_signin', 'cx_s_done'];
    let step = 0, info = null, popup = null, poll = null, view = 'main', closed = false;
    const m = modal({ title: t('cw_title', { name: K.name }), size: 'md', body: '', footer: '', onClose: () => { closed = true; stop(); } });
    const stop = () => { clearInterval(poll); poll = null; window.removeEventListener('message', onMsg); };
    const onMsg = (e) => {
      if (e.origin !== location.origin || !e.data || e.data.pmConnect !== kind) return;
      if (e.data.ok) arrived(); else draw({ text: e.data.msg || t('cx_failed') });
    };
    const dots = () => `<ol class="cw-steps" aria-label="${esc(t('cw_progress'))}">${STEPS.map((s, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><i>${i < step ? icon('check') : i + 1}</i><span>${t(s)}</span></li>`).join('')}</ol>`;
    const frame = (body, msg) => `${view === 'token' || view === 'setup' || (!info.configured && step === 0 && kind !== 'jira') ? '' : dots()}<div class="cw-body">${body}</div><div class="cw-msg ${msg && msg.ok ? 'ok' : 'bad'}" role="status" ${msg ? '' : 'hidden'}>${msg ? esc(msg.text) : ''}</div>`;
    const foot = (html) => m.setFooter(html);

    async function load() { info = (await api('GET', '/api/connections')).connections[kind]; return info; }

    // step 1: what will happen, or what the app owner still has to do once
    function drawStart(msg) {
      if (!info.configured) { if (kind === 'jira') { view = 'token'; return drawToken(msg); } return drawOff(msg); }
      m.setBody(frame(`<p style="margin-top:0">${t('cx_start_intro', { name: K.name })}</p>
        <div class="cw-sum"><div class="muted small">${t('cx_can_title', { name: K.name })}</div><ul class="cw-list">${K.can.map((c) => `<li>${t(c)}</li>`).join('')}</ul></div>
        <p class="small muted">${t('cx_safe')}</p>`, msg));
      foot(`<button class="btn" data-close>${t('cancel')}</button>${kind === 'jira' ? `<button class="btn ghost" id="cxTok">${t('cx_use_token')}</button>` : ''}<button class="btn primary" id="cxGo">${t('cx_continue')}</button>`);
      m.$('#cxGo').onclick = () => { step = 1; draw(); };
      m.$('#cxTok') && (m.$('#cxTok').onclick = () => { view = 'token'; step = 1; draw(); });
    }
    // email is not switched on yet: say so in plain words and let the owner switch it on in one form
    function drawOff(msg) {
      m.setBody(frame(`<div class="cx-off">${icon(K.icon)}<h3>${t('cx_off_h', { name: K.name })}</h3><p class="muted">${t('cx_off_p', { name: K.name })}</p></div>`, msg));
      foot(`<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="cxOwner">${t('cx_owner_btn')}</button>`);
      m.$('#cxOwner').onclick = () => { view = 'setup'; draw(); };
    }
    // owner only: paste the two values from the service, the app saves them, no restart needed
    function drawSetup(msg) {
      const s = info.setup;
      m.setBody(frame(`<p style="margin-top:0">${t('cx_owner_intro', { name: K.name })}</p>
        <div class="form-grid"><label class="f full">${t('cx_cid')}<input id="cxCid" autocomplete="off" spellcheck="false"></label>
        <label class="f full">${t('cx_csecret')}<input id="cxCsec" type="password" autocomplete="off"></label></div>
        <details class="cx-how"><summary>${t('cx_how')}</summary>
        <ol class="cw-list"><li>${t('cx_setup_1', { name: K.name })} <a target="_blank" rel="noopener" href="${esc(s.url || K.console)}">${t('cx_setup_open')}</a></li>
        <li>${t('cx_setup_2')}<div class="cx-copy"><code id="cxUri">${esc(s.redirect_uri)}</code><button class="btn sm" id="cxCopy" type="button">${t('cx_copy')}</button></div></li>
        <li>${t('cx_how_3')}</li></ol></details>`, msg));
      foot(`<button class="btn" id="cxBack">${t('cw_back')}</button><button class="btn primary" id="cxSaveCfg">${icon('check')}${t('cx_save_cont')}</button>`);
      m.$('#cxCid').focus();
      m.$('#cxBack').onclick = () => { view = 'main'; draw(); };
      m.$('#cxCopy').onclick = async () => { try { await navigator.clipboard.writeText(s.redirect_uri); toast(t('cx_copied')); } catch { const r = document.createRange(); r.selectNodeContents(m.$('#cxUri')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
      m.$('#cxSaveCfg').onclick = () => busy(m.$('#cxSaveCfg'), async () => {
        const id = m.$('#cxCid').value.trim(), sec = m.$('#cxCsec').value.trim();
        if (!id || !sec) return drawSetup({ text: t('cx_cfg_missing') });
        try { await api('POST', `/api/connections/${kind}/setup`, { client_id: id, client_secret: sec }); await load(); } catch (e) { return drawSetup({ text: e.message }); }
        view = 'main'; step = 0; draw({ ok: true, text: t('cx_ready') });
      });
    }

    // step 2: sign in at the service in a separate window
    function drawSignin(msg, waiting) {
      m.setBody(frame(waiting
        ? `<div class="cx-wait">${PM.loader.html({ size: 'sm' })}<div><b>${t('cx_waiting', { name: K.name })}</b><div class="small muted">${t('cx_waiting_hint')}</div></div></div>`
        : `<p style="margin-top:0">${t('cx_signin_intro', { name: K.name })}</p><p class="small muted">${t('cx_signin_hint')}</p>`, msg));
      foot(`<button class="btn" id="cxBack">${t('cw_back')}</button><button class="btn primary" id="cxOpen">${icon('link')}${waiting ? t('cx_open_again') : t('cx_open', { name: K.name })}</button>`);
      m.$('#cxBack').onclick = () => { stop(); step = 0; draw(); };
      m.$('#cxOpen').onclick = () => busy(m.$('#cxOpen'), async () => {
        let url;
        try { url = (await api('POST', `/api/connections/${kind}/start`, {})).url; } catch (e) { return drawSignin({ text: e.message }); }
        const w = 520, h = 680, left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - h) / 4);
        popup = window.open(url, 'pm_connect', `width=${w},height=${h},left=${left},top=${top}`);
        if (!popup) { drawSignin({ text: t('cx_blocked') }, false); m.$('.cw-msg').insertAdjacentHTML('beforeend', ` <a href="${esc(url)}" target="_blank" rel="noopener">${t('cx_open_tab')}</a>`); return; }
        window.addEventListener('message', onMsg);
        clearInterval(poll);
        const was = !!info.connected;
        poll = setInterval(async () => {
          if (closed) return stop();
          try { const x = await load(); if (x.connected && !was) arrived(); } catch { /* keep waiting */ }
        }, 2000);
        drawSignin(null, true);
      });
    }

    // step 3: choose a site when there are several, check it works, finish
    async function arrived() {
      if (step === 2) return;
      stop(); try { popup && popup.close(); } catch { /* already closed */ }
      step = 2; m.setBody(frame(`<div class="cx-wait">${PM.loader.html({ size: 'sm' })}<b>${t('cx_testing')}</b></div>`)); foot('');
      try { await load(); } catch (e) { return draw({ text: e.message }); }
      drawDone();
    }
    async function drawDone(msg) {
      const sites = info.sites || [];
      const pick = sites.length > 1 ? `<label class="f">${t('cx_site')}<select id="cxSite">${sites.map((s) => `<option value="${esc(s.id)}" ${s.id === info.site_id ? 'selected' : ''}>${esc(s.name)} (${esc(String(s.url).replace(/^https:\/\//, ''))})</option>`).join('')}</select></label>` : '';
      m.setBody(frame(`<div class="cw-done">${icon('check')}<h3>${t('cw_done_title', { name: K.name })}</h3><p class="muted" id="cxLabel">${esc(info.label || '')}</p></div>${pick}<div class="cx-test small muted" id="cxTest">${PM.loader.html({ size: 'sm' })} ${t('cx_testing')}</div><p class="small muted">${t('cw_done_hint')}</p>`, msg));
      foot(`<button class="btn" id="cxRetest">${t('cx_test_again')}</button><button class="btn primary" id="cxFinish">${t('cw_finish')}</button>`);
      const test = async () => {
        const box = m.$('#cxTest'); box.innerHTML = `${PM.loader.html({ size: 'sm' })} ${t('cx_testing')}`;
        try { const r = await api('POST', `/api/connections/${kind}/test`, {}); box.innerHTML = `<span class="chip green">${icon('check')}${t('cx_test_ok')}</span>`; if (r.label) m.$('#cxLabel').textContent = r.label; }
        catch (e) { box.innerHTML = `<span class="chip red">${esc(e.message)}</span>`; }
      };
      m.$('#cxRetest').onclick = test;
      m.$('#cxSite') && (m.$('#cxSite').onchange = async (e) => { try { const r = await api('POST', `/api/connections/${kind}/site`, { site_id: e.target.value }); info = r.connections[kind]; m.$('#cxLabel').textContent = info.label || ''; test(); } catch (er) { toast(er.message, 'err'); } });
      m.$('#cxFinish').onclick = async () => { await refreshStatus(); m.close && m.close(); onDone && onDone((await api('GET', '/api/connections')).connections); };
      test();
      await refreshStatus();
    }

    // Jira without any owner setup: the person's own API token, checked live
    function drawToken(msg) {
      m.setBody(frame(`<p style="margin-top:0">${t('cx_tok_lead')}</p>
        <ol class="cx-steps">
          <li><div><b>${t('cx_tok_s1')}</b><div class="small muted">${t('cx_tok_s1h')}</div></div><a class="btn sm" target="_blank" rel="noopener" href="https://id.atlassian.com/manage-profile/security/api-tokens">${icon('link')}${t('cw_open_atlassian')}</a></li>
          <li><div><b>${t('cx_tok_s2')}</b></div></li></ol>
        <div class="form-grid"><label class="f full">${t('cw_jira_site')}<input type="text" id="cxBase" placeholder="yourcompany.atlassian.net" autocomplete="off" inputmode="url" spellcheck="false"></label>
        <label class="f full">${t('cw_jira_email')}<input type="email" id="cxEmail" autocomplete="off"></label>
        <label class="f full">${t('cw_jira_token')}<input type="password" id="cxToken" autocomplete="off"></label></div>
        <p class="small muted">${t('cx_tok_safe')}</p>${info.configured ? '' : `<p class="small"><a href="#" id="cxOwnerLink">${t('cx_owner_link')}</a></p>`}`, msg));
      foot(`<button class="btn" data-close>${t('cancel')}</button>${info.configured ? `<button class="btn ghost" id="cxBack">${t('cw_back')}</button>` : ''}<button class="btn primary" id="cxSave">${icon('check')}${t('cw_connect_now')}</button>`);
      m.$('#cxBase').focus();
      m.$('#cxBack') && (m.$('#cxBack').onclick = () => { view = 'main'; step = 0; draw(); });
      m.$('#cxOwnerLink') && (m.$('#cxOwnerLink').onclick = (e) => { e.preventDefault(); view = 'setup'; draw(); });
      const save = () => busy(m.$('#cxSave'), async () => {
        // accept "yourcompany", "yourcompany.atlassian.net" or the full address
        let site = m.$('#cxBase').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        if (site && !site.includes('.')) site += '.atlassian.net';
        const body = { base_url: site ? 'https://' + site : '', email: m.$('#cxEmail').value.trim(), token: m.$('#cxToken').value.trim() };
        if (!/^https:\/\/.+\..+/.test(body.base_url)) return drawToken({ text: t('cw_err_site') });
        if (!body.email || !body.token) return drawToken({ text: t('cw_err_creds') });
        try { await api('POST', '/api/connections/jira/token', body); } catch (e) { return drawToken({ text: e.message }); }
        try { await load(); } catch { /* shown on the next screen */ }
        view = 'main'; step = 2; drawDone();
      });
      m.$('#cxSave').onclick = save;
      m.el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } };
    }

    function draw(msg) {
      if (!info) return;
      if (view === 'token') return drawToken(msg);
      if (view === 'setup') return drawSetup(msg);
      if (step === 0) return drawStart(msg);
      if (step === 1) return drawSignin(msg, false);
      return drawDone(msg);
    }
    m.setBody(`<div class="empty small">${PM.skeleton.list(3)}</div>`);
    load().then((x) => { if (x.connected) { step = 2; return drawDone(); } draw(); }).catch((e) => { m.setBody(`<div class="empty small">${esc(e.message)}</div>`); });
  }

  // the rows shown on the account page, in onboarding and in project settings
  function rows(c) {
    const row = (kind) => {
      const K = KINDS[kind], x = c[kind] || {};
      return `<div class="conn-row"><div class="avatar conn-ic">${icon(K.icon)}</div><div class="grow"><div class="conn-name">${K.name}</div><div class="small muted">${x.connected ? esc(x.label || '') : t('cw_not_connected')}</div></div>
        ${x.connected ? `<span class="chip green">${icon('check')}${t('cw_connected')}</span><button class="btn sm ghost" data-conn-test="${kind}">${t('cx_test_short')}</button>${x.managed ? '' : `<button class="btn sm ghost" data-conn-off="${kind}">${t('cw_disconnect')}</button>`}` : `<button class="btn primary sm" data-conn="${kind}">${t('cw_connect')}</button>`}</div>`;
    };
    return row('jira') + row('outlook');
  }
  async function mountRows(host) {
    const draw = (c) => {
      host.innerHTML = rows(c);
      $$('[data-conn]', host).forEach((b) => (b.onclick = () => wizard(b.dataset.conn, draw)));
      $$('[data-conn-test]', host).forEach((b) => (b.onclick = () => busy(b, async () => {
        try { await api('POST', `/api/connections/${b.dataset.connTest}/test`, {}); toast(t('cx_test_ok')); } catch (e) { toast(e.message, 'err'); }
      })));
      $$('[data-conn-off]', host).forEach((b) => (b.onclick = async () => {
        if (!(await PM.confirmDlg({ title: t('cw_disconnect'), message: t('cw_disconnect_q', { name: KINDS[b.dataset.connOff].name }), ok: t('cw_disconnect'), danger: true }))) return;
        try { const r = await api('DELETE', `/api/connections/${b.dataset.connOff}`); draw(r.connections); await refreshStatus(); } catch (e) { toast(e.message, 'err'); }
      }));
    };
    host.innerHTML = `<div class="empty small">${PM.skeleton.list(3)}</div>`;
    try { draw((await api('GET', '/api/connections')).connections); } catch (e) { host.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
  }
  PM.connect = { wizard, mountRows };
})();
