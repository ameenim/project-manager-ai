/* Backup, restore, sample projects and team access.
   Everything here talks to the server, so it works the same on every device. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, confirmDlg, busy, state: S } = PM;

  Object.assign(PM.I18N.en, {
    dt_backup_h: 'Backup and restore', dt_backup_p: 'Download everything you can edit as one file, or bring projects back from a backup file. Imported projects are added as new projects and never replace existing ones.',
    dt_export_ws: 'Export all projects', dt_import: 'Import a backup', dt_sample: 'Load sample projects', dt_sample_done: 'Sample projects added',
    dt_import_h: 'Import a backup', dt_import_p: 'Choose a backup file made by Project Manager AI. The projects in it are added to your workspace as new projects.',
    dt_choose: 'Choose a backup file', dt_importing: 'Importing', dt_import_ok: '{n} project imported', dt_import_ok_n: '{n} projects imported',
    dt_open: 'Open', dt_none: 'No file chosen', dt_warnings: 'Notes about the import',
    dt_exp_h: 'Export this project', dt_exp_p: 'Download the project to keep a copy, move it, or open the schedule in Excel.',
    dt_exp_json: 'Project backup', dt_exp_json_files: 'Backup with original documents', dt_exp_csv: 'Schedule as CSV', dt_exp_xlsx: 'Schedule as Excel',
    dt_team_h: 'Project access', dt_team_p: 'The project manager owns the project and is the only person who can delete it. Editors change content. Viewers can only read.',
    dt_role_manager: 'Project manager', dt_role_editor: 'Editor', dt_role_viewer: 'Viewer', dt_you: 'You',
    dt_invite: 'Add person', dt_invite_ph: 'Email of an existing account', dt_remove: 'Remove', dt_leave: 'Leave project',
    dt_invited: 'Person added', dt_removed: 'Access removed', dt_updated: 'Role updated',
    dt_viewer_note: 'You can view this project but not change it.', dt_empty_h: 'No projects yet',
    dt_empty_p: 'Create your first project from your documents, import a backup, or load the sample projects to explore.',
    dt_import_btn: 'Import project',
  });
  Object.assign(PM.I18N.ar, {
    dt_backup_h: 'النسخ الاحتياطي والاستعادة', dt_backup_p: 'نزّل كل ما يمكنك تعديله في ملف واحد، أو استعد المشاريع من ملف نسخة احتياطية. تضاف المشاريع المستوردة كمشاريع جديدة ولا تستبدل الموجودة.',
    dt_export_ws: 'تصدير كل المشاريع', dt_import: 'استيراد نسخة احتياطية', dt_sample: 'تحميل مشاريع نموذجية', dt_sample_done: 'تمت إضافة المشاريع النموذجية',
    dt_import_h: 'استيراد نسخة احتياطية', dt_import_p: 'اختر ملف نسخة احتياطية أنشأه مدير المشاريع الذكي. تضاف المشاريع التي فيه إلى مساحة عملك كمشاريع جديدة.',
    dt_choose: 'اختر ملف النسخة الاحتياطية', dt_importing: 'جار الاستيراد', dt_import_ok: 'تم استيراد {n} مشروع', dt_import_ok_n: 'تم استيراد {n} مشاريع',
    dt_open: 'فتح', dt_none: 'لم يتم اختيار ملف', dt_warnings: 'ملاحظات حول الاستيراد',
    dt_exp_h: 'تصدير هذا المشروع', dt_exp_p: 'نزّل المشروع للاحتفاظ بنسخة أو نقله أو فتح الجدول الزمني في إكسل.',
    dt_exp_json: 'نسخة احتياطية للمشروع', dt_exp_json_files: 'نسخة مع المستندات الأصلية', dt_exp_csv: 'الجدول الزمني بصيغة CSV', dt_exp_xlsx: 'الجدول الزمني بصيغة إكسل',
    dt_team_h: 'صلاحيات المشروع', dt_team_p: 'مدير المشروع يملك المشروع وهو الوحيد الذي يستطيع حذفه. المحرر يغير المحتوى. المشاهد يقرأ فقط.',
    dt_role_manager: 'مدير المشروع', dt_role_editor: 'محرر', dt_role_viewer: 'مشاهد', dt_you: 'أنت',
    dt_invite: 'إضافة شخص', dt_invite_ph: 'بريد حساب موجود', dt_remove: 'إزالة', dt_leave: 'مغادرة المشروع',
    dt_invited: 'تمت إضافة الشخص', dt_removed: 'تمت إزالة الصلاحية', dt_updated: 'تم تحديث الدور',
    dt_viewer_note: 'يمكنك عرض هذا المشروع دون تعديله.', dt_empty_h: 'لا توجد مشاريع بعد',
    dt_empty_p: 'أنشئ مشروعك الأول من مستنداتك، أو استورد نسخة احتياطية، أو حمّل المشاريع النموذجية للاستكشاف.',
    dt_import_btn: 'استيراد مشروع',
  });

  const fileOf = (r) => r;
  async function pick(accept) {
    return new Promise((ok) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
      i.onchange = () => { ok(i.files[0] || null); i.remove(); };
      document.body.appendChild(i); i.click();
    });
  }

  function importDialog() {
    const m = modal({ title: t('dt_import_h'), body: `<p class="muted" style="margin-top:0">${t('dt_import_p')}</p><div class="row"><button class="btn" id="dtPick">${icon('upload')}${t('dt_choose')}</button><span class="small muted" id="dtName">${t('dt_none')}</span></div><div id="dtOut" class="mt"></div>`, footer: `<button class="btn" data-close>${t('close')}</button><button class="btn primary" id="dtGo" disabled>${t('dt_import')}</button>` });
    let file = null;
    m.$('#dtPick').onclick = async () => { const f = await pick('.json,application/json'); if (!f) return; file = f; m.$('#dtName').textContent = f.name; m.$('#dtGo').disabled = false; };
    m.$('#dtGo').onclick = async () => {
      const fd = new FormData(); fd.append('file', file);
      const r = await busy(m.$('#dtGo'), () => api('POST', '/api/projects/import', fd));
      if (!r) return;
      const list = r.imported || [];
      const warn = list.flatMap((x) => (x.warnings || []).map((w) => `${x.name}: ${w}`));
      m.$('#dtOut').innerHTML = `<div class="banner ok small">${icon('check')}<div>${t(list.length === 1 ? 'dt_import_ok' : 'dt_import_ok_n', { n: list.length })}</div></div>${warn.length ? `<div class="small mt"><b>${t('dt_warnings')}</b><ul>${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`;
      m.$('#dtGo').remove();
      await PM.loadProjects();
      if (list.length === 1) m.setFooter(`<button class="btn" data-close>${t('close')}</button><a class="btn primary" href="#/p/${list[0].id}/overview" data-close>${t('dt_open')}</a>`);
      else if (location.hash.startsWith('#/projects') || location.hash === '' || location.hash === '#/') window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    return m;
  }

  async function loadSample(btn) {
    const r = await busy(btn, () => api('POST', '/api/workspace/sample'));
    if (!r) return;
    S.user.sample_loaded = true;
    toast(t('dt_sample_done'), 'ok');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  function accountCard() {
    return `<div class="card mt"><div class="card-head"><h3>${t('dt_backup_h')}</h3></div><p class="small muted" style="margin-top:0">${t('dt_backup_p')}</p>
      <div class="row wrap"><button class="btn" id="dtExpWs">${icon('dl')}${t('dt_export_ws')}</button><button class="btn" id="dtImp">${icon('upload')}${t('dt_import')}</button>${S.user.sample_loaded ? '' : `<button class="btn" id="dtSample">${icon('spark')}${t('dt_sample')}</button>`}</div></div>`;
  }
  function bindAccount(root) {
    const a = $('#dtExpWs', root); if (a) a.onclick = () => PM.download('/api/workspace/export', 'project-manager-ai-workspace.pmai.json');
    const b = $('#dtImp', root); if (b) b.onclick = importDialog;
    const c = $('#dtSample', root); if (c) c.onclick = () => loadSample(c);
  }

  const ROLES = ['manager', 'editor', 'viewer'];
  function projectCards(p) {
    return `<div class="card"><div class="card-head"><h3>${t('dt_exp_h')}</h3></div><p class="small muted" style="margin-top:0">${t('dt_exp_p')}</p>
      <div class="row wrap"><button class="btn" data-dtx="json">${icon('dl')}${t('dt_exp_json')}</button><button class="btn" data-dtx="files">${icon('dl')}${t('dt_exp_json_files')}</button><button class="btn" data-dtx="csv">${icon('dl')}${t('dt_exp_csv')}</button><button class="btn" data-dtx="xlsx">${icon('dl')}${t('dt_exp_xlsx')}</button></div></div>
      <div class="card"><div class="card-head"><h3>${t('dt_team_h')}</h3></div><p class="small muted" style="margin-top:0">${t('dt_team_p')}</p>${p.can_edit === false ? `<div class="banner small mb">${t('dt_viewer_note')}</div>` : ''}<div id="dtMembers">${PM.loader.html({ size: 'sm' })}</div></div>`;
  }
  function bindProject(root, p) {
    const slug = (p.name || 'project').replace(/[^\w .-]+/g, '_').trim().slice(0, 80) || 'project';
    const go = { json: [`/api/projects/${p.id}/export`, `${slug}.pmai.json`], files: [`/api/projects/${p.id}/export?files=1`, `${slug}.pmai.json`], csv: [`/api/projects/${p.id}/schedule/export?format=csv`, `${slug} schedule.csv`], xlsx: [`/api/projects/${p.id}/schedule/export?format=xlsx`, `${slug} schedule.xlsx`] };
    $$('[data-dtx]', root).forEach((b) => (b.onclick = () => PM.download(...go[b.dataset.dtx])));
    const host = $('#dtMembers', root);
    if (!host) return;
    const isMgr = p.role === 'manager';
    const draw = (members) => {
      host.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td>${esc(m.name)}${m.user_id === S.user.id ? ` <span class="chip">${t('dt_you')}</span>` : ''}</td><td>${esc(m.email)}</td>
        <td>${isMgr ? `<select data-mrole="${m.user_id}">${ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${t('dt_role_' + r)}</option>`).join('')}</select>` : t('dt_role_' + m.role)}</td>
        <td class="right">${isMgr || m.user_id === S.user.id ? `<button class="btn sm ghost" data-mdel="${m.user_id}">${m.user_id === S.user.id && !isMgr ? t('dt_leave') : t('dt_remove')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        ${isMgr ? `<div class="row mt wrap"><input type="email" id="dtEmail" placeholder="${t('dt_invite_ph')}" style="max-width:280px"><select id="dtRole"><option value="editor">${t('dt_role_editor')}</option><option value="viewer">${t('dt_role_viewer')}</option><option value="manager">${t('dt_role_manager')}</option></select><button class="btn" id="dtAdd">${icon('plus')}${t('dt_invite')}</button></div>` : ''}`;
      const after = (msg) => (r) => { if (r) { draw(r.members); toast(t(msg), 'ok'); } };
      $$('[data-mrole]', host).forEach((s) => (s.onchange = async () => { const r = await busy(null, () => api('PUT', `/api/projects/${p.id}/members/${s.dataset.mrole}`, { role: s.value })); if (r) after('dt_updated')(r); else load(); }));
      $$('[data-mdel]', host).forEach((b) => (b.onclick = async () => {
        const self = Number(b.dataset.mdel) === S.user.id;
        const r = await busy(null, () => api('DELETE', `/api/projects/${p.id}/members/${b.dataset.mdel}`));
        if (!r) return;
        if (self && !isMgr) { location.hash = '#/projects'; return; }
        after('dt_removed')(r);
      }));
      const add = $('#dtAdd', host);
      if (add) add.onclick = async () => { const email = $('#dtEmail', host).value.trim(); if (!email) { $('#dtEmail', host).focus(); return; } after('dt_invited')(await busy(add, () => api('POST', `/api/projects/${p.id}/members`, { email, role: $('#dtRole', host).value }))); };
    };
    const load = () => api('GET', `/api/projects/${p.id}/members`).then((r) => draw(r.members)).catch((e) => { host.textContent = e.message; });
    load();
  }

  function emptyState() {
    return `<div class="card empty"><div class="big">📁</div><h3>${t('dt_empty_h')}</h3><p>${t('dt_empty_p')}</p><div class="row wrap" style="justify-content:center"><button class="btn primary" data-newproj>${icon('plus')}${t('new_project')}</button><button class="btn" data-impproj>${icon('upload')}${t('dt_import_btn')}</button>${S.user && S.user.sample_loaded ? '' : `<button class="btn" data-sample>${icon('spark')}${t('dt_sample')}</button>`}</div></div>`;
  }
  function bindEmpty(root) {
    $$('[data-newproj]', root).forEach((b) => (b.onclick = PM.newProjectDialog));
    $$('[data-impproj]', root).forEach((b) => (b.onclick = importDialog));
    $$('[data-sample]', root).forEach((b) => (b.onclick = () => loadSample(b)));
  }

  PM.data = { importDialog, loadSample, accountCard, bindAccount, projectCards, bindProject, emptyState, bindEmpty };
})();
