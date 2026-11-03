/* Connect wizards for Jira and Outlook, and the connection rows used in project settings. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, busy, state: S } = PM;

  const KINDS = {
    jira: {
      icon: 'jira', name: 'Jira',
      steps: ['cw_step_site', 'cw_step_token', 'cw_step_test'],
      fields: { base_url: '', email: '', token: '' },
      body(step, v) {
        if (step === 0) return `<p class="muted" style="margin-top:0">${t('cw_jira_site_help')}</p><label class="f">${t('cw_jira_site')}<input type="url" id="cwBase" value="${esc(v.base_url)}" placeholder="https://yourcompany.atlassian.net" autocomplete="off" inputmode="url"></label>`;
        if (step === 1) return `<p class="muted" style="margin-top:0">${t('cw_jira_token_help')}</p><p><a class="btn sm" target="_blank" rel="noopener" href="https://id.atlassian.com/manage-profile/security/api-tokens">${icon('link')}${t('cw_open_atlassian')}</a></p>
          <div class="form-grid"><label class="f full">${t('cw_jira_email')}<input type="email" id="cwEmail" value="${esc(v.email)}" autocomplete="off"></label><label class="f full">${t('cw_jira_token')}<input type="password" id="cwToken" value="${esc(v.token)}" autocomplete="off"></label></div>`;
        return `<p class="muted" style="margin-top:0">${t('cw_test_help')}</p><div class="cw-sum"><div><span class="muted">${t('cw_jira_site')}</span> <b>${esc(v.base_url)}</b></div><div><span class="muted">${t('cw_jira_email')}</span> <b>${esc(v.email)}</b></div></div>`;
      },
      read(step, m, v) { if (step === 0) v.base_url = m.$('#cwBase').value.trim(); if (step === 1) { v.email = m.$('#cwEmail').value.trim(); v.token = m.$('#cwToken').value.trim(); } },
      valid(step, v) { if (step === 0) return /^https:\/\/.+\..+/.test(v.base_url) ? '' : t('cw_err_site'); if (step === 1) return v.email && v.token ? '' : t('cw_err_creds'); return ''; },
    },
    outlook: {
      icon: 'mail', name: 'Outlook',
      steps: ['cw_step_access', 'cw_step_paste', 'cw_step_test'],
      fields: { token: '' },
      body(step, v) {
        if (step === 0) return `<p class="muted" style="margin-top:0">${t('cw_out_help')}</p><ol class="cw-list"><li>${t('cw_out_1')}</li><li>${t('cw_out_2')}</li><li>${t('cw_out_3')}</li></ol><p><a class="btn sm" target="_blank" rel="noopener" href="https://developer.microsoft.com/graph/graph-explorer">${icon('link')}${t('cw_open_graph')}</a></p><div class="small muted">${t('cw_out_note')}</div>`;
        if (step === 1) return `<p class="muted" style="margin-top:0">${t('cw_out_paste_help')}</p><label class="f">${t('cw_out_token')}<textarea id="cwToken" rows="4" autocomplete="off" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:var(--fs-small)">${esc(v.token)}</textarea></label>`;
        return `<p class="muted" style="margin-top:0">${t('cw_test_help')}</p><div class="cw-sum"><div><span class="muted">${t('cw_out_token')}</span> <b>${'•'.repeat(12)} ${esc(v.token.slice(-4))}</b></div></div>`;
      },
      read(step, m, v) { if (step === 1) v.token = m.$('#cwToken').value.trim(); },
      valid(step, v) { return step === 1 && v.token.length < 20 ? t('cw_err_token') : ''; },
    },
  };

  function wizard(kind, onDone) {
    const K = KINDS[kind], v = { ...K.fields };
    let step = 0;
    const m = modal({ title: t('cw_title', { name: K.name }), size: 'md', body: '', footer: '' });
    const dots = () => `<ol class="cw-steps" aria-label="${esc(t('cw_progress'))}">${K.steps.map((s, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><i>${i < step ? icon('check') : i + 1}</i><span>${t(s)}</span></li>`).join('')}</ol>`;
    function draw(msg) {
      m.setBody(`${dots()}<div class="cw-body">${K.body(step, v)}</div><div class="cw-msg ${msg && msg.ok ? 'ok' : 'bad'}" role="status" ${msg ? '' : 'hidden'}>${msg ? esc(msg.text) : ''}</div>`);
      const last = step === K.steps.length - 1;
      m.setFooter(`<button class="btn" data-close>${t('cancel')}</button>${step ? `<button class="btn" id="cwBack">${t('cw_back')}</button>` : ''}<button class="btn primary" id="cwNext">${last ? icon('check') + t('cw_connect_now') : t('cw_next')}</button>`);
      const first = m.$('input,textarea'); if (first) first.focus();
      m.$('#cwBack') && (m.$('#cwBack').onclick = () => { K.read(step, m, v); step--; draw(); });
      m.$('#cwNext').onclick = async () => {
        K.read(step, m, v);
        const err = K.valid(step, v);
        if (err) return draw({ text: err });
        if (!last) { step++; return draw(); }
        const r = await busy(m.$('#cwNext'), async () => { try { return await api('POST', `/api/connections/${kind}`, v); } catch (e) { draw({ text: e.message }); return null; } });
        if (!r) return;
        m.setBody(`<div class="cw-done">${icon('check')}<h3>${t('cw_done_title', { name: K.name })}</h3><p class="muted">${esc(r.connections[kind].label || '')}</p><p class="small muted">${t('cw_done_hint')}</p></div>`);
        m.setFooter(`<button class="btn primary" data-close>${t('cw_finish')}</button>`);
        try { const me = await api('GET', '/api/me'); S.status = me.status; } catch { /* status refreshes on the next load */ }
        onDone && onDone(r.connections);
      };
      m.el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); m.$('#cwNext').click(); } };
    }
    draw();
  }

  // the two rows shown in project settings
  function rows(c) {
    const row = (kind) => {
      const K = KINDS[kind], x = c[kind] || {};
      return `<div class="conn-row"><div class="avatar conn-ic">${icon(K.icon)}</div><div class="grow"><div class="conn-name">${K.name}</div><div class="small muted">${x.connected ? esc(x.label || '') : t('cw_not_connected')}</div></div>
        ${x.connected ? `<span class="chip green">${icon('check')}${t('cw_connected')}</span>${x.managed ? '' : `<button class="btn sm ghost" data-conn-off="${kind}">${t('cw_disconnect')}</button>`}` : `<button class="btn primary sm" data-conn="${kind}">${t('cw_connect')}</button>`}</div>`;
    };
    return row('jira') + row('outlook');
  }
  async function mountRows(host) {
    const draw = (c) => {
      host.innerHTML = rows(c);
      $$('[data-conn]', host).forEach((b) => (b.onclick = () => wizard(b.dataset.conn, draw)));
      $$('[data-conn-off]', host).forEach((b) => (b.onclick = async () => {
        if (!(await PM.confirmDlg({ title: t('cw_disconnect'), message: t('cw_disconnect_q', { name: KINDS[b.dataset.connOff].name }), ok: t('cw_disconnect'), danger: true }))) return;
        try { const r = await api('DELETE', `/api/connections/${b.dataset.connOff}`); draw(r.connections); const me = await api('GET', '/api/me'); S.status = me.status; } catch (e) { toast(e.message, 'err'); }
      }));
    };
    host.innerHTML = `<div class="empty small"><span class="spinner"></span></div>`;
    try { draw((await api('GET', '/api/connections')).connections); } catch (e) { host.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
  }
  PM.connect = { wizard, mountRows };
})();
