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
    org_programs: 'Programs', org_program: 'Program', org_new_program: 'New program', org_program_name: 'Program name', org_add: 'Add', org_projects_n: '{n} projects', org_close_program: 'Close program', org_close_confirm: 'Close this program? Its projects return to the organization level.',
    org_kpi_projects: 'Projects', org_kpi_progress: 'Progress', org_kpi_spi: 'Schedule index', org_kpi_overdue: 'Overdue tasks', org_kpi_review: 'Waiting for review', org_kpi_value: 'Contract value', org_kpi_end: 'Latest forecast end',
    org_col_project: 'Project', org_col_health: 'Health', org_col_progress: 'Progress', org_col_overdue: 'Overdue', org_col_end: 'Forecast end', org_none_projects: 'No projects in this program yet.', org_restricted: 'This program has {n} projects. Your role manages the structure and does not open project numbers.',
    org_place: 'Place a project', org_unplaced: 'Choose a project', org_to_program: 'Choose a program', org_no_program: 'Organization level', org_role_extra: 'Add a role', org_for_program: 'Program',
    org_portfolios: 'Portfolios', org_portfolio: 'Portfolio', org_new_portfolio: 'New portfolio', org_portfolio_name: 'Portfolio name', org_overview: 'Organization overview', org_programs_n: '{n} programs', org_close_portfolio: 'Close portfolio', org_close_portfolio_confirm: 'Close this portfolio? Its programs and projects return to the organization level.', org_not_in_portfolio: 'Programs outside a portfolio', org_unplaced_projects: 'Projects outside any program', org_col_name: 'Name', org_role_viewer_portfolio: 'Viewer of one portfolio', org_restricted_org: 'This organization has {n} projects. Your role manages the structure and does not open project numbers.',
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
    org_programs: 'البرامج', org_program: 'برنامج', org_new_program: 'برنامج جديد', org_program_name: 'اسم البرنامج', org_add: 'إضافة', org_projects_n: '{n} مشاريع', org_close_program: 'إغلاق البرنامج', org_close_confirm: 'هل تريد إغلاق هذا البرنامج؟ تعود مشاريعه إلى مستوى المؤسسة.',
    org_kpi_projects: 'المشاريع', org_kpi_progress: 'التقدم', org_kpi_spi: 'مؤشر الجدول', org_kpi_overdue: 'مهام متأخرة', org_kpi_review: 'بانتظار المراجعة', org_kpi_value: 'قيمة العقود', org_kpi_end: 'أحدث تاريخ انتهاء متوقع',
    org_col_project: 'المشروع', org_col_health: 'الحالة', org_col_progress: 'التقدم', org_col_overdue: 'متأخر', org_col_end: 'الانتهاء المتوقع', org_none_projects: 'لا توجد مشاريع في هذا البرنامج بعد.', org_restricted: 'يضم هذا البرنامج {n} مشاريع. دورك يدير الهيكل ولا يفتح أرقام المشاريع.',
    org_place: 'وضع مشروع', org_unplaced: 'اختر مشروعا', org_to_program: 'اختر برنامجا', org_no_program: 'مستوى المؤسسة', org_role_extra: 'إضافة دور', org_for_program: 'البرنامج',
    org_portfolios: 'المحافظ', org_portfolio: 'محفظة', org_new_portfolio: 'محفظة جديدة', org_portfolio_name: 'اسم المحفظة', org_overview: 'نظرة عامة على المؤسسة', org_programs_n: '{n} برامج', org_close_portfolio: 'إغلاق المحفظة', org_close_portfolio_confirm: 'هل تريد إغلاق هذه المحفظة؟ تعود برامجها ومشاريعها إلى مستوى المؤسسة.', org_not_in_portfolio: 'برامج خارج المحافظ', org_unplaced_projects: 'مشاريع خارج أي برنامج', org_col_name: 'الاسم', org_role_viewer_portfolio: 'مشاهد لمحفظة واحدة', org_restricted_org: 'تضم هذه المؤسسة {n} مشاريع. دورك يدير الهيكل ولا يفتح أرقام المشاريع.',
    org_credit: 'أصبحت مساحة عملك مؤسسة. سيُضاف رصيد بقيمة {amount} عن الأيام غير المستخدمة إلى أول فاتورة.', org_none: 'لست جزءا من مؤسسة بعد.', org_events: 'سجل الفوترة',
  });

  const fail = (e) => PM.toast(e.message, 'err');
  const roleName = (r) => t('org_role_' + r);
  const money = (c) => (Math.abs(c) / 100).toFixed(2);

  PM.views.organization = async function (wid, pid, kind) {
    PM.shell('organization', '');
    try { wid && kind === 'overview' ? await overviewPage(wid) : wid && pid && kind === 'portfolio' ? await portfolioPage(wid, pid) : wid && pid ? await programPage(wid, pid) : wid ? await detail(wid) : await home(); } catch (e) { $c().innerHTML = `<div class="page"><div class="card empty">${esc(e.message)}</div></div>`; }
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
    let programs = []; try { programs = (await PM.api('GET', `/api/orgs/${wid}/programs`)).programs; } catch (e) { programs = []; }
    let portfolios = []; try { portfolios = (await PM.api('GET', `/api/orgs/${wid}/portfolios`)).portfolios; } catch (e) { portfolios = []; }
    const manage = o.roles.some((x) => ['admin', 'pmo_director'].includes(x));
    const q = o.roles.some((x) => ['admin', 'pmo_director', 'program_manager'].includes(x)) ? (await PM.api('GET', `/api/orgs/${wid}/handovers`)).handovers : [];
    const me = PM.state.user && PM.state.user.id;
    const pct = o.pool && o.pool.total ? Math.min(100, Math.round((o.pool.used / o.pool.total) * 100)) : 0;
    const roleSel = (x) => `<select data-role="${x.user_id}">${['admin', 'project_manager', 'viewer'].map((r) => `<option value="${r}" ${x.roles.includes(r) && (r === 'admin' || !x.roles.includes('admin')) ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select>`;
    const members = m.members.map((x) => `<div class="row"><div class="grow"><b>${esc(x.name)}</b><div class="small muted">${esc(x.email)}</div></div>${admin ? roleSel(x) : `<span class="chip">${x.roles.map(roleName).join(', ')}</span>`}${admin || x.user_id === me ? `<button class="btn" data-rm="${x.user_id}">${x.user_id === me ? t('org_leave') : t('org_remove')}</button>` : ''}</div>`).join('');
    const pending = admin && m.invites.length ? `<h4>${t('org_pending')}</h4>${m.invites.map((i) => `<div class="row"><div class="grow">${esc(i.email)} <span class="small muted">${roleName(i.role)}</span></div><button class="btn" data-rv="${i.id}">${t('org_revoke')}</button></div>`).join('')}` : '';
    const inviteForm = admin ? `<div class="row wrap mt"><input id="inE" type="email" placeholder="${esc(t('org_email'))}"><select id="inR"><option value="project_manager">${roleName('project_manager')}</option><option value="viewer">${roleName('viewer')}</option><option value="admin">${roleName('admin')}</option><option value="pmo_director">${roleName('pmo_director')}</option>${portfolios.some((x) => x.status === 'active') ? `<option value="viewer_portfolio">${t('org_role_viewer_portfolio')}</option>` : ''}${programs.some((x) => x.status === 'active') ? `<option value="program_manager">${roleName('program_manager')}</option>` : ''}</select><select id="inP" hidden>${programs.filter((x) => x.status === 'active').map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><select id="inF" hidden>${portfolios.filter((x) => x.status === 'active').map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn primary" id="inGo">${t('org_invite')}</button></div>` : '';
    const byMember = admin && o.by_member && o.by_member.length ? `<h4>${t('org_by_member')}</h4>${o.by_member.map((x) => `<div class="row"><div class="grow">${esc(x.name || '')}</div><span>${Math.round(x.units)}</span></div>`).join('')}` : '';
    const overage = admin && o.pool ? `<h4>${t('org_overage')}</h4><div class="row wrap"><select id="ovP"><option value="stop" ${o.pool.policy === 'stop' ? 'selected' : ''}>${t('org_stop')}</option><option value="capped" ${o.pool.policy === 'capped' ? 'selected' : ''}>${t('org_capped')}</option></select><input id="ovC" type="number" min="0" value="${o.pool.overage_cap}" placeholder="${esc(t('org_cap'))}"><button class="btn" id="ovS">${t('org_save')}</button></div>` : '';
    const pfs = portfolios.length || manage ? `<div class="card mt"><div class="card-head"><h3>${t('org_portfolios')}</h3></div>${portfolios.filter((x) => x.status === 'active').map((x) => `<a class="row" href="#/organization/${wid}/portfolio/${x.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.name)}</b></div><span class="small muted">${t('org_programs_n', { n: x.programs })}</span>${icon('chev_r')}</a>`).join('')}${manage ? `<div class="row wrap mt"><input id="pfN" maxlength="80" placeholder="${esc(t('org_portfolio_name'))}"><button class="btn" id="pfGo">${t('org_new_portfolio')}</button></div>` : ''}</div>` : '';
    const ovl = o.roles.some((x) => ['admin', 'pmo_director', 'viewer'].includes(x)) ? `<a class="card row mt" href="#/organization/${wid}/overview" style="text-decoration:none;color:inherit"><div class="grow"><b>${t('org_overview')}</b></div>${icon('chev_r')}</a>` : '';
    const prog = programs.length || manage ? `<div class="card mt"><div class="card-head"><h3>${t('org_programs')}</h3></div>${programs.filter((x) => x.status === 'active').map((x) => `<a class="row" href="#/organization/${wid}/program/${x.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(x.name)}</b></div><span class="small muted">${t('org_projects_n', { n: x.projects })}</span>${icon('chev_r')}</a>`).join('')}${manage ? `<div class="row wrap mt"><input id="pgN" maxlength="80" placeholder="${esc(t('org_program_name'))}"><button class="btn" id="pgGo">${t('org_new_program')}</button></div>` : ''}</div>` : '';
    const seats = `<div class="card mt"><div class="card-head"><h3>${t('org_seats')}</h3></div><p>${t('org_seats_used', { used: o.seats_used, total: o.seats })}</p>${admin ? `<div class="row wrap"><input id="stN" type="number" min="1" value="${o.seats}"><button class="btn" id="stS">${t('org_set_seats')}</button></div>` : ''}</div>`;
    const pool = o.pool ? `<div class="card mt"><div class="card-head"><h3>${t('org_pool')}</h3></div><p>${t('org_pool_used', { used: Math.round(o.pool.used), total: Math.round(o.pool.total) })}</p><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>${byMember}${overage}</div>` : '';
    const queue = q.length || admin ? `<div class="card mt"><div class="card-head"><h3>${t('org_queue')}</h3></div>${q.length ? q.map((h) => `<div class="row wrap"><div class="grow"><b>${esc(h.project_name || '')}</b><div class="small muted">${t('org_from', { name: esc(h.from_name || '') })}</div></div><select data-to="${h.id}">${m.members.filter((x) => x.roles.includes('project_manager')).map((x) => `<option value="${x.user_id}">${esc(x.name)}</option>`).join('')}</select><button class="btn primary" data-ho="${h.id}">${t('org_hand')}</button></div>`).join('') : `<p class="muted">${t('org_queue_empty')}</p>`}</div>` : '';
    const events = admin && o.events && o.events.length ? `<div class="card mt"><div class="card-head"><h3>${t('org_events')}</h3></div>${o.events.map((e) => `<div class="row small"><div class="grow">${esc(e.kind.replace('_', ' '))}</div><span>${Number(e.amount_cents) < 0 ? '-' : ''}${money(e.amount_cents)} ${esc(e.currency)}</span></div>`).join('')}</div>` : '';
    $c().innerHTML = `<div class="page org-page"><a class="small" href="#/organization">${icon('chev_l')} ${t('org_title')}</a><div class="page-head"><div><h1>${esc(o.name)}</h1></div></div>
      <div class="card"><div class="card-head"><h3>${t('org_members')}</h3></div>${members}${pending}${inviteForm}</div>${ovl}${pfs}${prog}${seats}${pool}${queue}${events}</div>`;
    const go = async (fn) => { try { await fn(); await detail(wid); } catch (e) { fail(e); } };
    document.querySelectorAll('[data-role]').forEach((s) => { s.onchange = () => go(() => PM.api('PUT', `/api/orgs/${wid}/members/${s.dataset.role}`, { role: s.value })); });
    document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { const self = Number(b.dataset.rm) === me; if (!(await PM.confirmDlg({ title: self ? t('org_leave') : t('org_remove'), message: t(self ? 'org_confirm_leave' : 'org_confirm_remove'), ok: self ? t('org_leave') : t('org_remove'), danger: true }))) return; try { await PM.api('DELETE', `/api/orgs/${wid}/members/${b.dataset.rm}`); if (self) location.hash = '#/organization'; else await detail(wid); } catch (e) { fail(e); } }; });
    document.querySelectorAll('[data-rv]').forEach((b) => { b.onclick = () => go(() => PM.api('DELETE', `/api/orgs/${wid}/invites/${b.dataset.rv}`)); });
    document.querySelectorAll('[data-ho]').forEach((b) => { b.onclick = () => go(() => PM.api('POST', `/api/orgs/${wid}/handovers/${b.dataset.ho}/transfer`, { user_id: Number(document.querySelector(`[data-to="${b.dataset.ho}"]`).value) })); });
    if ($('#inR')) $('#inR').onchange = () => { $('#inP').hidden = $('#inR').value !== 'program_manager'; $('#inF').hidden = $('#inR').value !== 'viewer_portfolio'; };
    if ($('#inGo')) $('#inGo').onclick = () => go(() => { const r = $('#inR').value; return PM.api('POST', `/api/orgs/${wid}/invites`, { email: $('#inE').value, role: r === 'viewer_portfolio' ? 'viewer' : r, program_id: r === 'program_manager' ? Number($('#inP').value) : undefined, portfolio_id: r === 'viewer_portfolio' ? Number($('#inF').value) : undefined }); });
    if ($('#pfGo')) $('#pfGo').onclick = () => go(() => PM.api('POST', `/api/orgs/${wid}/portfolios`, { name: $('#pfN').value }));
    if ($('#pgGo')) $('#pgGo').onclick = () => go(() => PM.api('POST', `/api/orgs/${wid}/programs`, { name: $('#pgN').value }));
    if ($('#stS')) $('#stS').onclick = () => go(() => PM.api('PUT', `/api/orgs/${wid}/seats`, { seats: Number($('#stN').value) }));
    if ($('#ovS')) $('#ovS').onclick = () => go(() => PM.api('PUT', `/api/orgs/${wid}/overage`, { policy: $('#ovP').value, cap_units: Number($('#ovC').value) }));
  }

  async function programPage(wid, pid) {
    const d = await PM.api('GET', `/api/orgs/${wid}/programs/${pid}/dashboard`);
    const back = `<a class="small" href="#/organization/${wid}">${icon('chev_l')} ${t('org_title')}</a>`;
    if (d.restricted) { $c().innerHTML = `<div class="page org-page">${back}<div class="page-head"><div><h1>${esc(d.name)}</h1></div></div><div class="card"><p>${t('org_restricted', { n: d.project_count })}</p></div></div>`; return; }
    const T = d.totals, kpi = (l, v, sub) => `<div class="card"><div class="small muted">${l}</div><div style="font-size:var(--fs-h2,26px);font-weight:var(--fw)">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
    const val = Object.keys(T.value_by_currency).map((c) => `${Math.round(T.value_by_currency[c]).toLocaleString()} ${esc(c)}`).join(', ') || '0';
    const health = ['red', 'amber', 'green'].filter((h) => T.health[h]).map((h) => `${PM.healthChip(h)} ${T.health[h]}`).join(' ');
    const rows = d.projects.map((p) => `<tr><td><a href="#/p/${p.id}/overview"><b>${esc(p.name)}</b></a></td><td>${PM.healthChip(p.health)}</td><td>${p.progress == null ? '' : p.progress + '%'}</td><td>${p.overdue}</td><td>${esc(p.forecast_end || '')}</td></tr>`).join('');
    let place = '';
    let all = [], progs = [];
    try { all = (await PM.api('GET', `/api/orgs/${wid}/projects`)).projects; progs = (await PM.api('GET', `/api/orgs/${wid}/programs`)).programs.filter((x) => x.status === 'active'); } catch (e) { all = []; }
    let structure = false, ports = [];
    try { structure = (await PM.api('GET', `/api/orgs/${wid}`)).roles.some((x) => ['admin', 'pmo_director'].includes(x)); if (structure) ports = (await PM.api('GET', `/api/orgs/${wid}/portfolios`)).portfolios.filter((x) => x.status === 'active'); } catch (e) { structure = false; }
    const manage = all.length || progs.length;
    const cur = progs.find((x) => x.id === Number(pid));
    const pfSel = structure ? `<div class="card mt"><div class="card-head"><h3>${t('org_portfolio')}</h3></div><div class="row wrap"><select id="pgF"><option value="">${t('org_no_program')}</option>${ports.map((x) => `<option value="${x.id}" ${cur && cur.portfolio_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn" id="pgFGo">${t('org_add')}</button></div></div>` : '';
    if (manage) place = `<div class="card mt"><div class="card-head"><h3>${t('org_place')}</h3></div><div class="row wrap"><select id="plP"><option value="">${t('org_unplaced')}</option>${all.map((x) => `<option value="${x.id}">${esc(x.name)}${x.program_id ? '' : ''}</option>`).join('')}</select><select id="plG"><option value="${pid}">${esc(d.name)}</option><option value="">${t('org_no_program')}</option>${progs.filter((x) => x.id !== Number(pid)).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn" id="plGo">${t('org_add')}</button>${structure ? `<button class="btn" id="pgCl">${t('org_close_program')}</button>` : ''}</div></div>${pfSel}`;
    $c().innerHTML = `<div class="page org-page">${back}<div class="page-head"><div><h1>${esc(d.name)}</h1><div class="row wrap">${health}</div></div></div>
      <div class="grid g4">${kpi(t('org_kpi_projects'), T.active + ' / ' + T.projects)}${kpi(t('org_kpi_progress'), T.progress + '%', T.planned + '%')}${kpi(t('org_kpi_spi'), T.spi == null ? '-' : T.spi)}${kpi(t('org_kpi_overdue'), T.overdue)}</div>
      <div class="grid g3 mt">${kpi(t('org_kpi_review'), T.pending_review)}${kpi(t('org_kpi_value'), val)}${kpi(t('org_kpi_end'), esc(T.latest_forecast_end || '-'))}</div>
      <div class="card mt"><div class="table-wrap">${d.projects.length ? `<table><thead><tr><th>${t('org_col_project')}</th><th>${t('org_col_health')}</th><th>${t('org_col_progress')}</th><th>${t('org_col_overdue')}</th><th>${t('org_col_end')}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">${t('org_none_projects')}</p>`}</div></div>${place}</div>`;
    if ($('#plGo')) $('#plGo').onclick = async () => { if (!$('#plP').value) return; try { await PM.api('PUT', `/api/orgs/${wid}/projects/${$('#plP').value}/program`, { program_id: $('#plG').value ? Number($('#plG').value) : null }); await programPage(wid, pid); } catch (e) { fail(e); } };
    if ($('#pgFGo')) $('#pgFGo').onclick = async () => { try { await PM.api('PUT', `/api/orgs/${wid}/programs/${pid}/portfolio`, { portfolio_id: $('#pgF').value ? Number($('#pgF').value) : null }); PM.toast(t('org_done'), 'ok'); } catch (e) { fail(e); } };
    if ($('#pgCl')) $('#pgCl').onclick = async () => { if (!(await PM.confirmDlg({ title: t('org_close_program'), message: t('org_close_confirm'), ok: t('org_close_program'), danger: true }))) return; try { await PM.api('DELETE', `/api/orgs/${wid}/programs/${pid}`); location.hash = '#/organization/' + wid; } catch (e) { fail(e); } };
  }

  const kpi = (l, v, sub) => `<div class="card"><div class="small muted">${l}</div><div style="font-size:var(--fs-h2,26px);font-weight:var(--fw)">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const totalsHtml = (T) => {
    const val = Object.keys(T.value_by_currency).map((c) => `${Math.round(T.value_by_currency[c]).toLocaleString()} ${esc(c)}`).join(', ') || '0';
    const health = ['red', 'amber', 'green'].filter((h) => T.health[h]).map((h) => `${PM.healthChip(h)} ${T.health[h]}`).join(' ');
    return `<div class="row wrap">${health}</div><div class="grid g4 mt">${kpi(t('org_kpi_projects'), T.active + ' / ' + T.projects)}${kpi(t('org_kpi_progress'), T.progress + '%', T.planned + '%')}${kpi(t('org_kpi_spi'), T.spi == null ? '-' : T.spi)}${kpi(t('org_kpi_overdue'), T.overdue)}</div>
      <div class="grid g3 mt">${kpi(t('org_kpi_review'), T.pending_review)}${kpi(t('org_kpi_value'), val)}${kpi(t('org_kpi_end'), esc(T.latest_forecast_end || '-'))}</div>`;
  };
  const childTable = (title, rows, href) => rows.length ? `<div class="card mt"><div class="card-head"><h3>${title}</h3></div><div class="table-wrap"><table><thead><tr><th>${t('org_col_name')}</th><th>${t('org_col_health')}</th><th>${t('org_col_progress')}</th><th>${t('org_col_overdue')}</th><th>${t('org_kpi_projects')}</th></tr></thead><tbody>${rows.map((c) => { const T = c.totals, h = T.health.red ? 'red' : T.health.amber ? 'amber' : 'green'; return `<tr><td><a href="${href(c)}"><b>${esc(c.name)}</b></a></td><td>${T.active ? PM.healthChip(h) : ''}</td><td>${T.progress}%</td><td>${T.overdue}</td><td>${T.projects}</td></tr>`; }).join('')}</tbody></table></div></div>` : '';
  const projectTable = (title, list) => list.length ? `<div class="card mt"><div class="card-head"><h3>${title}</h3></div><div class="table-wrap"><table><thead><tr><th>${t('org_col_project')}</th><th>${t('org_col_health')}</th><th>${t('org_col_progress')}</th><th>${t('org_col_overdue')}</th><th>${t('org_col_end')}</th></tr></thead><tbody>${list.map((p) => `<tr><td><a href="#/p/${p.id}/overview"><b>${esc(p.name)}</b></a></td><td>${PM.healthChip(p.health)}</td><td>${p.progress == null ? '' : p.progress + '%'}</td><td>${p.overdue}</td><td>${esc(p.forecast_end || '')}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  const head = (wid, name, back) => `<a class="small" href="${back || '#/organization/' + wid}">${icon('chev_l')} ${back ? t('org_overview') : t('org_title')}</a><div class="page-head"><div><h1>${esc(name)}</h1></div></div>`;

  async function overviewPage(wid) {
    const d = await PM.api('GET', `/api/orgs/${wid}/overview`);
    if (d.restricted) { $c().innerHTML = `<div class="page org-page">${head(wid, t('org_overview'))}<div class="card"><p>${t('org_restricted_org', { n: d.project_count })}</p></div></div>`; return; }
    $c().innerHTML = `<div class="page org-page">${head(wid, t('org_overview'))}${totalsHtml(d.totals)}
      ${childTable(t('org_portfolios'), d.portfolios, (c) => `#/organization/${wid}/portfolio/${c.id}`)}${childTable(t('org_not_in_portfolio'), d.programs, (c) => `#/organization/${wid}/program/${c.id}`)}${projectTable(t('org_unplaced_projects'), d.unplaced.projects)}</div>`;
  }
  async function portfolioPage(wid, id) {
    const d = await PM.api('GET', `/api/orgs/${wid}/portfolios/${id}/dashboard`);
    if (d.restricted) { $c().innerHTML = `<div class="page org-page">${head(wid, d.name)}<div class="card"><p>${t('org_restricted', { n: d.project_count })}</p></div></div>`; return; }
    let closeBtn = '';
    try { await PM.api('GET', `/api/orgs/${wid}/members`); const o = await PM.api('GET', `/api/orgs/${wid}`); if (o.roles.some((x) => ['admin', 'pmo_director'].includes(x))) closeBtn = `<div class="row mt"><button class="btn" id="pfCl">${t('org_close_portfolio')}</button></div>`; } catch (e) { closeBtn = ''; }
    $c().innerHTML = `<div class="page org-page">${head(wid, d.name)}${totalsHtml(d.totals)}${childTable(t('org_programs'), d.programs, (c) => `#/organization/${wid}/program/${c.id}`)}${projectTable(t('org_kpi_projects'), d.projects)}${closeBtn}</div>`;
    if ($('#pfCl')) $('#pfCl').onclick = async () => { if (!(await PM.confirmDlg({ title: t('org_close_portfolio'), message: t('org_close_portfolio_confirm'), ok: t('org_close_portfolio'), danger: true }))) return; try { await PM.api('DELETE', `/api/orgs/${wid}/portfolios/${id}`); location.hash = '#/organization/' + wid; } catch (e) { fail(e); } };
  }
})();
