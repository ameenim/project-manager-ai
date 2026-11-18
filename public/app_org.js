/* Organization (Team plan). Shown only when the owner has switched organization features on. One screen: the person's
   workspaces, invitations, and for an organization the members, seats, the shared AI units and the handover queue. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;
  const $c = () => document.getElementById('content');
  const $ = (s) => document.querySelector(s);

  Object.assign(PM.I18N.en, {
    nav_org: 'Organization', org_title: 'Organization', org_sub: 'Your workspaces, your team and the AI units you share.',
    org_mine: 'Your workspaces', org_personal: 'Personal', org_convert: 'Convert my workspace', org_convert_hint: 'Keep every project and invite your team. Unused days of your plan become a credit.',
    org_create: 'Create an organization', org_name: 'Organization name', org_invites: 'Invitations', org_accept: 'Accept', org_role_admin: 'Admin', org_role_project_manager: 'Project Manager', org_role_viewer: 'Viewer',
    org_role_pmo_director: 'PMO Director', org_role_program_manager: 'Program Manager', org_members: 'Members', org_invite: 'Invite', org_email: 'Email', org_role: 'Role', org_remove: 'Remove', org_leave: 'Leave',
    org_pending: 'Pending invitations', org_revoke: 'Cancel', org_seats: 'Seats', org_seats_used: '{used} of {total} seats in use', org_set_seats: 'Change seats',
    org_pool: 'Shared AI units', org_pool_used: '{used} of {total} units used this period', org_by_member: 'Use by member', org_overage: 'When the units run out', org_stop: 'Stop AI use until the next period', org_capped: 'Allow up to a limit',
    org_cap: 'Extra units allowed', org_save: 'Save', org_queue: 'Projects waiting for a new manager', org_queue_empty: 'No projects are waiting.', org_from: 'Left by {name}', org_assign: 'Hand over to', org_hand: 'Hand over',
    org_done: 'Done', org_confirm_remove: 'Remove this person? Their active projects go to the handover queue and the rest are archived.', org_confirm_leave: 'Leave this organization?',
    org_credit: 'Your workspace is now an organization. A credit of {amount} for unused days goes on the first invoice.', org_none: 'You are not part of an organization yet.', org_events: 'Billing history',
  });
  Object.assign(PM.I18N.ar, {
    nav_org: 'المؤسسة', org_title: 'المؤسسة', org_sub: 'مساحات عملك وفريقك ووحدات الذكاء الاصطناعي المشتركة.',
    org_mine: 'مساحات عملك', org_personal: 'شخصية', org_convert: 'حوّل مساحة عملي', org_convert_hint: 'احتفظ بكل مشاريعك وادعُ فريقك. الأيام غير المستخدمة من خطتك تصبح رصيدا.',
    org_create: 'إنشاء مؤسسة', org_name: 'اسم المؤسسة', org_invites: 'الدعوات', org_accept: 'قبول', org_role_admin: 'مدير', org_role_project_manager: 'مدير مشروع', org_role_viewer: 'مشاهد',
    org_role_pmo_director: 'مدير مكتب المشاريع', org_role_program_manager: 'مدير برنامج', org_members: 'الأعضاء', org_invite: 'دعوة', org_email: 'البريد الإلكتروني', org_role: 'الدور', org_remove: 'إزالة', org_leave: 'مغادرة',
    org_pending: 'الدعوات المعلقة', org_revoke: 'إلغاء', org_seats: 'المقاعد', org_seats_used: '{used} من {total} مقاعد مستخدمة', org_set_seats: 'تغيير المقاعد',
    org_pool: 'وحدات الذكاء الاصطناعي المشتركة', org_pool_used: 'تم استخدام {used} من {total} وحدة في هذه الفترة', org_by_member: 'الاستخدام حسب العضو', org_overage: 'عند نفاد الوحدات', org_stop: 'إيقاف الذكاء الاصطناعي حتى الفترة التالية', org_capped: 'السماح حتى حد معين',
    org_cap: 'وحدات إضافية مسموحة', org_save: 'حفظ', org_queue: 'مشاريع تنتظر مديرا جديدا', org_queue_empty: 'لا توجد مشاريع بالانتظار.', org_from: 'غادرها {name}', org_assign: 'التسليم إلى', org_hand: 'تسليم',
    org_done: 'تم', org_confirm_remove: 'هل تريد إزالة هذا الشخص؟ تنتقل مشاريعه النشطة إلى قائمة التسليم وتؤرشف البقية.', org_confirm_leave: 'هل تريد مغادرة هذه المؤسسة؟',
    org_credit: 'أصبحت مساحة عملك مؤسسة. سيُضاف رصيد بقيمة {amount} عن الأيام غير المستخدمة إلى أول فاتورة.', org_none: 'لست جزءا من مؤسسة بعد.', org_events: 'سجل الفوترة',
  });

  const fail = (e) => PM.toast(e.message, 'err');
  const roleName = (r) => t('org_role_' + r);
  const money = (c) => (Math.abs(c) / 100).toFixed(2);

  PM.views.organization = async function (wid) {
    PM.shell('organization', '');
    try { wid ? await detail(wid) : await home(); } catch (e) { $c().innerHTML = `<div class="page"><div class="card empty">${esc(e.message)}</div></div>`; }
  };

  async function home() {
    const r = await PM.api('GET', '/api/orgs');
    const orgs = r.organizations.filter((x) => !x.personal);
    const rows = r.organizations.map((x) => `<a class="card row" href="${x.personal ? '#/organization' : '#/organization/' + x.id}"><div class="grow"><b>${esc(x.name)}</b><div class="small muted">${x.personal ? t('org_personal') : x.roles.map(roleName).join(', ')}</div></div>${x.personal ? '' : icon('chev_r')}</a>`).join('');
    const inv = r.invites.length ? `<div class="card mt"><div class="card-head"><h3>${t('org_invites')}</h3></div>${r.invites.map((i) => `<div class="row"><div class="grow"><b>${esc(i.organization)}</b> <span class="small muted">${roleName(i.role)}</span></div><button class="btn primary" data-acc="${i.id}">${t('org_accept')}</button></div>`).join('')}</div>` : '';
    const convert = `<div class="card mt"><div class="card-head"><h3>${t('org_convert')}</h3></div><p class="muted">${t('org_convert_hint')}</p><div class="row wrap"><input id="orgName" maxlength="80" placeholder="${esc(t('org_name'))}"><button class="btn primary" id="orgConv">${t('org_convert')}</button><button class="btn" id="orgNew">${t('org_create')}</button></div></div>`;
    $c().innerHTML = `<div class="page org-page"><div class="page-head"><div><h1>${t('org_title')}</h1><p class="muted">${t('org_sub')}</p></div></div><div class="stack">${rows}</div>${inv}${orgs.length ? '' : `<p class="muted mt">${t('org_none')}</p>`}${convert}</div>`;
    document.querySelectorAll('[data-acc]').forEach((b) => { b.onclick = async () => { try { const x = await PM.api('POST', `/api/orgs/invites/${b.dataset.acc}/accept`, {}); location.hash = '#/organization/' + x.organization_id; } catch (e) { fail(e); } }; });
    $('#orgConv').onclick = async () => { try { const x = await PM.api('POST', '/api/orgs/convert', { name: $('#orgName').value }); PM.toast(t('org_credit', { amount: money(x.credit_cents) }), 'ok'); location.hash = '#/organization/' + x.id; } catch (e) { fail(e); } };
    $('#orgNew').onclick = async () => { try { const x = await PM.api('POST', '/api/orgs', { name: $('#orgName').value }); location.hash = '#/organization/' + x.id; } catch (e) { fail(e); } };
  }

  async function detail(wid) {
    const o = await PM.api('GET', `/api/orgs/${wid}`);
    const admin = o.roles.includes('admin');
    const m = await PM.api('GET', `/api/orgs/${wid}/members`);
    const q = o.roles.some((x) => ['admin', 'pmo_director', 'program_manager'].includes(x)) ? (await PM.api('GET', `/api/orgs/${wid}/handovers`)).handovers : [];
    const me = PM.state.user && PM.state.user.id;
    const pct = o.pool && o.pool.total ? Math.min(100, Math.round((o.pool.used / o.pool.total) * 100)) : 0;
    const roleSel = (x) => `<select data-role="${x.user_id}">${['admin', 'project_manager', 'viewer'].map((r) => `<option value="${r}" ${x.roles.includes(r) && (r === 'admin' || !x.roles.includes('admin')) ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select>`;
    const members = m.members.map((x) => `<div class="row"><div class="grow"><b>${esc(x.name)}</b><div class="small muted">${esc(x.email)}</div></div>${admin ? roleSel(x) : `<span class="chip">${x.roles.map(roleName).join(', ')}</span>`}${admin || x.user_id === me ? `<button class="btn" data-rm="${x.user_id}">${x.user_id === me ? t('org_leave') : t('org_remove')}</button>` : ''}</div>`).join('');
    const pending = admin && m.invites.length ? `<h4>${t('org_pending')}</h4>${m.invites.map((i) => `<div class="row"><div class="grow">${esc(i.email)} <span class="small muted">${roleName(i.role)}</span></div><button class="btn" data-rv="${i.id}">${t('org_revoke')}</button></div>`).join('')}` : '';
    const inviteForm = admin ? `<div class="row wrap mt"><input id="inE" type="email" placeholder="${esc(t('org_email'))}"><select id="inR"><option value="project_manager">${roleName('project_manager')}</option><option value="viewer">${roleName('viewer')}</option><option value="admin">${roleName('admin')}</option></select><button class="btn primary" id="inGo">${t('org_invite')}</button></div>` : '';
    const byMember = admin && o.by_member && o.by_member.length ? `<h4>${t('org_by_member')}</h4>${o.by_member.map((x) => `<div class="row"><div class="grow">${esc(x.name || '')}</div><span>${Math.round(x.units)}</span></div>`).join('')}` : '';
    const overage = admin && o.pool ? `<h4>${t('org_overage')}</h4><div class="row wrap"><select id="ovP"><option value="stop" ${o.pool.policy === 'stop' ? 'selected' : ''}>${t('org_stop')}</option><option value="capped" ${o.pool.policy === 'capped' ? 'selected' : ''}>${t('org_capped')}</option></select><input id="ovC" type="number" min="0" value="${o.pool.overage_cap}" placeholder="${esc(t('org_cap'))}"><button class="btn" id="ovS">${t('org_save')}</button></div>` : '';
    const seats = `<div class="card mt"><div class="card-head"><h3>${t('org_seats')}</h3></div><p>${t('org_seats_used', { used: o.seats_used, total: o.seats })}</p>${admin ? `<div class="row wrap"><input id="stN" type="number" min="1" value="${o.seats}"><button class="btn" id="stS">${t('org_set_seats')}</button></div>` : ''}</div>`;
    const pool = o.pool ? `<div class="card mt"><div class="card-head"><h3>${t('org_pool')}</h3></div><p>${t('org_pool_used', { used: Math.round(o.pool.used), total: Math.round(o.pool.total) })}</p><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>${byMember}${overage}</div>` : '';
    const queue = q.length || admin ? `<div class="card mt"><div class="card-head"><h3>${t('org_queue')}</h3></div>${q.length ? q.map((h) => `<div class="row wrap"><div class="grow"><b>${esc(h.project_name || '')}</b><div class="small muted">${t('org_from', { name: esc(h.from_name || '') })}</div></div><select data-to="${h.id}">${m.members.filter((x) => x.roles.includes('project_manager')).map((x) => `<option value="${x.user_id}">${esc(x.name)}</option>`).join('')}</select><button class="btn primary" data-ho="${h.id}">${t('org_hand')}</button></div>`).join('') : `<p class="muted">${t('org_queue_empty')}</p>`}</div>` : '';
    const events = admin && o.events && o.events.length ? `<div class="card mt"><div class="card-head"><h3>${t('org_events')}</h3></div>${o.events.map((e) => `<div class="row small"><div class="grow">${esc(e.kind.replace('_', ' '))}</div><span>${Number(e.amount_cents) < 0 ? '-' : ''}${money(e.amount_cents)} ${esc(e.currency)}</span></div>`).join('')}</div>` : '';
    $c().innerHTML = `<div class="page org-page"><a class="small" href="#/organization">${icon('chev_l')} ${t('org_title')}</a><div class="page-head"><div><h1>${esc(o.name)}</h1></div></div>
      <div class="card"><div class="card-head"><h3>${t('org_members')}</h3></div>${members}${pending}${inviteForm}</div>${seats}${pool}${queue}${events}</div>`;
    const go = async (fn) => { try { await fn(); await detail(wid); } catch (e) { fail(e); } };
    document.querySelectorAll('[data-role]').forEach((s) => { s.onchange = () => go(() => PM.api('PUT', `/api/orgs/${wid}/members/${s.dataset.role}`, { role: s.value })); });
    document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { const self = Number(b.dataset.rm) === me; if (!(await PM.confirmDlg({ title: self ? t('org_leave') : t('org_remove'), message: t(self ? 'org_confirm_leave' : 'org_confirm_remove'), ok: self ? t('org_leave') : t('org_remove'), danger: true }))) return; try { await PM.api('DELETE', `/api/orgs/${wid}/members/${b.dataset.rm}`); if (self) location.hash = '#/organization'; else await detail(wid); } catch (e) { fail(e); } }; });
    document.querySelectorAll('[data-rv]').forEach((b) => { b.onclick = () => go(() => PM.api('DELETE', `/api/orgs/${wid}/invites/${b.dataset.rv}`)); });
    document.querySelectorAll('[data-ho]').forEach((b) => { b.onclick = () => go(() => PM.api('POST', `/api/orgs/${wid}/handovers/${b.dataset.ho}/transfer`, { user_id: Number(document.querySelector(`[data-to="${b.dataset.ho}"]`).value) })); });
    if ($('#inGo')) $('#inGo').onclick = () => go(() => PM.api('POST', `/api/orgs/${wid}/invites`, { email: $('#inE').value, role: $('#inR').value }));
    if ($('#stS')) $('#stS').onclick = () => go(() => PM.api('PUT', `/api/orgs/${wid}/seats`, { seats: Number($('#stN').value) }));
    if ($('#ovS')) $('#ovS').onclick = () => go(() => PM.api('PUT', `/api/orgs/${wid}/overage`, { policy: $('#ovP').value, cap_units: Number($('#ovC').value) }));
  }
})();
