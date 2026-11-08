/* Meetings tab: record or upload a meeting, review the transcript and minutes, send actions to the project. */
(function () {
  const PM = window.PM;
  const { esc, t, icon, $, $$, api, toast, modal, confirmDlg, busy, state: S } = PM;
  const stale = (tk) => PM.stale(tk);

  Object.assign(PM.I18N.en, {
    tab_meetings: 'Meetings', mt_title: 'Meetings', mt_new: 'New meeting', mt_empty: 'No meetings yet. Record your next meeting and the minutes will be written for you.',
    mt_sub: 'Record a meeting, get a transcript for each speaker and minutes you can send to the project.', mt_no_stt: 'Transcription is not set up on the server yet. Ask an administrator to add GEMINI_API_KEY. You can still paste a transcript.',
    mt_no_claude: 'Minutes need ANTHROPIC_API_KEY on the server.', mt_f_title: 'Meeting title', mt_f_when: 'Date and time', mt_f_lang: 'Spoken language', mt_f_mlang: 'Minutes language', mt_f_att: 'Attendees', mt_f_att_add: 'Add a name and press Enter', mt_f_notes: 'Notes or agenda',
    mt_auto: 'Detect automatically', mt_en: 'English', mt_ar: 'Arabic', mt_how: 'How do you want to capture it?', mt_record: 'Record now', mt_upload: 'Upload a recording', mt_paste: 'Paste a transcript',
    mt_record_hint: 'Uses your microphone. Share a tab or screen with audio to also capture the other people on a call.', mt_upload_hint: 'MP3, WAV, M4A, AAC, OGG, FLAC or WebM audio.', mt_paste_hint: 'One line per turn, for example Sara: We start Monday.',
    mt_start: 'Start recording', mt_create: 'Create meeting', mt_need_title: 'Give the meeting a title', mt_need_file: 'Choose a recording', mt_need_text: 'Paste the transcript',
    mt_rec_title: 'Recording', mt_rec_mic: 'Microphone', mt_rec_sys: 'Meeting audio', mt_rec_sys_off: 'Not shared. Only your microphone is recorded.', mt_rec_pause: 'Pause', mt_rec_resume: 'Resume', mt_rec_stop: 'Stop and write minutes', mt_rec_cancel: 'Discard',
    mt_rec_keep: 'Keep this tab open while recording. The recording is sent when you stop.', mt_rec_nomic: 'The microphone is blocked. Allow microphone access in the browser and try again.', mt_rec_unsupported: 'This browser cannot record. Use Chrome or Edge, or upload a recording.',
    mt_rec_share: 'Share meeting audio', mt_rec_share_hint: 'Choose a browser tab or the whole screen and tick Share audio.', mt_rec_noaudio: 'No meeting audio was shared, so only your voice is recorded.', mt_rec_discard_q: 'Discard this recording? It cannot be recovered.',
    mt_uploading: 'Sending the recording', mt_back: 'All meetings', mt_status_draft: 'Draft', mt_status_uploaded: 'Received', mt_status_transcribing: 'Transcribing', mt_status_summarizing: 'Writing minutes', mt_status_ready: 'Ready', mt_status_failed: 'Failed',
    mt_working: 'Working on it. This page updates by itself.', mt_failed: 'This meeting could not be processed', mt_retry: 'Try again', mt_src_recording: 'Recorded', mt_src_upload: 'Uploaded', mt_src_text: 'Pasted',
    mt_minutes: 'Minutes', mt_transcript: 'Transcript', mt_summary: 'Summary', mt_topics: 'Topics discussed', mt_decisions: 'Decisions', mt_actions: 'Actions', mt_risks: 'Risks raised', mt_updates: 'Schedule updates', mt_questions: 'Open questions',
    mt_none: 'Nothing recorded here', mt_edit: 'Edit minutes', mt_save: 'Save', mt_saved: 'Minutes saved', mt_cancel: 'Cancel', mt_regen: 'Regenerate', mt_regen_all: 'Regenerate all minutes', mt_regen_sec: 'Regenerate {name}',
    mt_regen_ask: 'Anything the AI should do differently? For example, shorter, or focus on the budget.', mt_regen_go: 'Regenerate', mt_regen_done: 'Section updated', mt_regen_started: 'Writing new minutes',
    mt_speakers: 'Speakers', mt_rename: 'Rename', mt_merge: 'Merge into', mt_add_speaker: 'Add speaker', mt_speaker_name: 'Speaker name', mt_merge_pick: 'Pick a speaker', mt_change_speaker: 'Change speaker', mt_edit_text: 'Edit text', mt_del_seg: 'Delete this line', mt_seg_del_q: 'Delete this line from the transcript?',
    mt_no_transcript: 'There is no transcript yet', mt_owner: 'Owner', mt_due: 'Due', mt_quote: 'Said', mt_at: 'At', mt_prob: 'Probability', mt_impact: 'Impact', mt_mitigation: 'Mitigation', mt_progress: 'Progress', mt_delay: 'Delay in days',
    mt_to_project: 'Send to the project', mt_sel: '{n} selected', mt_pick_all: 'Select all', mt_pick_none: 'Clear', mt_add_log: 'Add to log', mt_add_task: 'Add as tasks', mt_add_upd: 'Apply schedule updates', mt_review_first: 'Review in Updates first',
    mt_review_tip: 'Items wait in the Updates tab until you apply them', mt_pick_some: 'Tick the items to send first', mt_sent: '{n} sent to the project', mt_sent_review: '{n} waiting in Updates', mt_none_applicable: 'The selected items do not fit this button',
    mt_in_log: 'In the log', mt_as_task: 'Task created', mt_upd_done: 'Schedule updated', mt_waiting: 'Waiting in Updates', mt_open_updates: 'Open Updates', mt_matches: 'Matches task',
    mt_export: 'Export', mt_export_docx: 'Word document', mt_export_md: 'Markdown', mt_export_tr: 'Include the transcript', mt_delete: 'Delete meeting', mt_delete_q: 'Delete this meeting, its transcript and its minutes? Items already sent to the project stay there.', mt_deleted: 'Meeting deleted',
    mt_attendees: 'Attendees', mt_duration: 'Duration', mt_when: 'When', mt_lines: '{n} lines', mt_n_actions: '{n} actions', mt_n_actions_1: '1 action', mt_show_more: 'Show more', mt_show_less: 'Show less', mt_add_item: 'Add an item', mt_remove: 'Remove', mt_no_att: 'No attendees listed',
    mt_title_ph: 'Weekly progress meeting', mt_source: 'Source', mt_from_meeting: 'From meeting', mt_audio_deleted: 'The audio is deleted after transcription.', mt_t_heading: 'Heading', mt_t_points: 'Points, one per line', mt_text: 'Text',
    mt_busy_err: 'Wait until this meeting has finished processing', mt_edit_info: 'Edit details', mt_info_saved: 'Details saved',
    src_meeting: 'Meeting', upd_type_create_item: 'Add to log', upd_type_create_task: 'Create task',
  });
  Object.assign(PM.I18N.ar, {
    tab_meetings: 'الاجتماعات', mt_title: 'الاجتماعات', mt_new: 'اجتماع جديد', mt_empty: 'لا توجد اجتماعات بعد. سجل اجتماعك القادم وسيتم كتابة المحضر لك.',
    mt_sub: 'سجل اجتماعا واحصل على نص لكل متحدث ومحضر يمكنك إرساله إلى المشروع.', mt_no_stt: 'لم يتم إعداد التفريغ الصوتي على الخادم بعد. اطلب من المسؤول إضافة GEMINI_API_KEY. يمكنك لصق النص مباشرة.',
    mt_no_claude: 'يحتاج المحضر إلى ANTHROPIC_API_KEY على الخادم.', mt_f_title: 'عنوان الاجتماع', mt_f_when: 'التاريخ والوقت', mt_f_lang: 'لغة الحديث', mt_f_mlang: 'لغة المحضر', mt_f_att: 'الحضور', mt_f_att_add: 'اكتب اسما واضغط Enter', mt_f_notes: 'ملاحظات أو جدول الأعمال',
    mt_auto: 'اكتشاف تلقائي', mt_en: 'الإنجليزية', mt_ar: 'العربية', mt_how: 'كيف تريد تسجيله؟', mt_record: 'سجل الآن', mt_upload: 'ارفع تسجيلا', mt_paste: 'الصق نصا',
    mt_record_hint: 'يستخدم الميكروفون. شارك تبويبا أو الشاشة مع الصوت لتسجيل بقية المشاركين في المكالمة.', mt_upload_hint: 'ملفات صوت MP3 أو WAV أو M4A أو AAC أو OGG أو FLAC أو WebM.', mt_paste_hint: 'سطر لكل متحدث، مثل سارة: نبدأ يوم الاثنين.',
    mt_start: 'ابدأ التسجيل', mt_create: 'إنشاء الاجتماع', mt_need_title: 'أدخل عنوانا للاجتماع', mt_need_file: 'اختر تسجيلا', mt_need_text: 'الصق النص',
    mt_rec_title: 'جار التسجيل', mt_rec_mic: 'الميكروفون', mt_rec_sys: 'صوت الاجتماع', mt_rec_sys_off: 'لم تتم المشاركة. يسجل الميكروفون فقط.', mt_rec_pause: 'إيقاف مؤقت', mt_rec_resume: 'استئناف', mt_rec_stop: 'إنهاء وكتابة المحضر', mt_rec_cancel: 'تجاهل',
    mt_rec_keep: 'أبق هذا التبويب مفتوحا أثناء التسجيل. يرسل التسجيل عند الإنهاء.', mt_rec_nomic: 'الميكروفون محظور. اسمح بالوصول إليه من المتصفح وحاول مرة أخرى.', mt_rec_unsupported: 'هذا المتصفح لا يدعم التسجيل. استخدم Chrome أو Edge أو ارفع تسجيلا.',
    mt_rec_share: 'شارك صوت الاجتماع', mt_rec_share_hint: 'اختر تبويبا أو الشاشة كاملة وفعل مشاركة الصوت.', mt_rec_noaudio: 'لم تتم مشاركة صوت الاجتماع، لذلك يسجل صوتك فقط.', mt_rec_discard_q: 'تجاهل هذا التسجيل؟ لا يمكن استرجاعه.',
    mt_uploading: 'جار إرسال التسجيل', mt_back: 'كل الاجتماعات', mt_status_draft: 'مسودة', mt_status_uploaded: 'تم الاستلام', mt_status_transcribing: 'جار التفريغ', mt_status_summarizing: 'جار كتابة المحضر', mt_status_ready: 'جاهز', mt_status_failed: 'فشل',
    mt_working: 'جار العمل عليه. تتحدث الصفحة تلقائيا.', mt_failed: 'تعذرت معالجة هذا الاجتماع', mt_retry: 'حاول مرة أخرى', mt_src_recording: 'مسجل', mt_src_upload: 'مرفوع', mt_src_text: 'ملصوق',
    mt_minutes: 'المحضر', mt_transcript: 'النص', mt_summary: 'الملخص', mt_topics: 'المواضيع المناقشة', mt_decisions: 'القرارات', mt_actions: 'الإجراءات', mt_risks: 'المخاطر المطروحة', mt_updates: 'تحديثات الجدول', mt_questions: 'أسئلة مفتوحة',
    mt_none: 'لا شيء هنا', mt_edit: 'تعديل المحضر', mt_save: 'حفظ', mt_saved: 'تم حفظ المحضر', mt_cancel: 'إلغاء', mt_regen: 'إعادة الإنشاء', mt_regen_all: 'إعادة إنشاء المحضر كاملا', mt_regen_sec: 'إعادة إنشاء {name}',
    mt_regen_ask: 'هل من شيء تريد أن يفعله الذكاء الاصطناعي بشكل مختلف؟ مثلا أقصر أو يركز على الميزانية.', mt_regen_go: 'إعادة الإنشاء', mt_regen_done: 'تم تحديث القسم', mt_regen_started: 'جار كتابة محضر جديد',
    mt_speakers: 'المتحدثون', mt_rename: 'إعادة تسمية', mt_merge: 'دمج في', mt_add_speaker: 'إضافة متحدث', mt_speaker_name: 'اسم المتحدث', mt_merge_pick: 'اختر متحدثا', mt_change_speaker: 'تغيير المتحدث', mt_edit_text: 'تعديل النص', mt_del_seg: 'حذف هذا السطر', mt_seg_del_q: 'حذف هذا السطر من النص؟',
    mt_no_transcript: 'لا يوجد نص بعد', mt_owner: 'المسؤول', mt_due: 'الاستحقاق', mt_quote: 'قيل', mt_at: 'عند', mt_prob: 'الاحتمال', mt_impact: 'الأثر', mt_mitigation: 'المعالجة', mt_progress: 'التقدم', mt_delay: 'التأخير بالأيام',
    mt_to_project: 'إرسال إلى المشروع', mt_sel: 'تم تحديد {n}', mt_pick_all: 'تحديد الكل', mt_pick_none: 'مسح', mt_add_log: 'إضافة إلى السجل', mt_add_task: 'إضافة كمهام', mt_add_upd: 'تطبيق تحديثات الجدول', mt_review_first: 'المراجعة في التحديثات أولا',
    mt_review_tip: 'تنتظر العناصر في تبويب التحديثات حتى تطبقها', mt_pick_some: 'حدد العناصر المراد إرسالها أولا', mt_sent: 'تم إرسال {n} إلى المشروع', mt_sent_review: '{n} بانتظار المراجعة في التحديثات', mt_none_applicable: 'العناصر المحددة لا تناسب هذا الزر',
    mt_in_log: 'في السجل', mt_as_task: 'تم إنشاء مهمة', mt_upd_done: 'تم تحديث الجدول', mt_waiting: 'بانتظار التحديثات', mt_open_updates: 'فتح التحديثات', mt_matches: 'يطابق المهمة',
    mt_export: 'تصدير', mt_export_docx: 'مستند Word', mt_export_md: 'Markdown', mt_export_tr: 'تضمين النص', mt_delete: 'حذف الاجتماع', mt_delete_q: 'حذف هذا الاجتماع ونصه ومحضره؟ العناصر المرسلة إلى المشروع تبقى كما هي.', mt_deleted: 'تم حذف الاجتماع',
    mt_attendees: 'الحضور', mt_duration: 'المدة', mt_when: 'الموعد', mt_lines: '{n} سطر', mt_n_actions: '{n} إجراءات', mt_n_actions_1: 'إجراء واحد', mt_show_more: 'عرض المزيد', mt_show_less: 'عرض أقل', mt_add_item: 'إضافة عنصر', mt_remove: 'إزالة', mt_no_att: 'لم يتم إدراج حضور',
    mt_title_ph: 'اجتماع متابعة أسبوعي', mt_source: 'المصدر', mt_from_meeting: 'من اجتماع', mt_audio_deleted: 'يحذف الصوت بعد التفريغ.', mt_t_heading: 'العنوان', mt_t_points: 'النقاط، نقطة في كل سطر', mt_text: 'النص',
    mt_busy_err: 'انتظر حتى تنتهي معالجة هذا الاجتماع', mt_edit_info: 'تعديل التفاصيل', mt_info_saved: 'تم حفظ التفاصيل',
    src_meeting: 'اجتماع', upd_type_create_item: 'إضافة إلى السجل', upd_type_create_task: 'إنشاء مهمة',
  });

  const BUSY = ['uploaded', 'transcribing', 'summarizing'];
  const SECS = ['summary', 'topics', 'decisions', 'actions', 'risks', 'updates', 'questions'];
  const locale = () => (S.lang === 'ar' ? 'ar' : 'en-US');
  const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }); };
  const fmtDur = (s) => { s = Math.round(Number(s) || 0); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const clock = (sec) => { sec = Math.max(0, Math.round(Number(sec) || 0)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
  const localInput = (d) => { const x = d ? new Date(d) : new Date(); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
  const statusChip = (m) => `<span class="chip ${m.status === 'ready' ? 'green' : m.status === 'failed' ? 'red' : BUSY.includes(m.status) ? 'blue' : ''}">${t('mt_status_' + m.status)}</span>`;
  const bidi = 'style="unicode-bidi:plaintext"';

  // ---------------- recorder ----------------
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  async function startRecorder(meeting, onDone) {
    let mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); } catch { toast(t('mt_rec_nomic'), 'err'); return false; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC(), dest = ctx.createMediaStreamDestination();
    const meter = (stream) => { const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an); src.connect(dest); return an; };
    const micAn = meter(mic);
    let sysAn = null, sysStream = null;
    const sharing = { on: false };
    const hasType = (m) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(hasType) || '';
    const rec = new MediaRecorder(dest.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
    const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    let startedAt = Date.now(), pausedAt = 0, pausedTotal = 0, wake = null, tick = null, closed = false;
    const elapsed = () => Math.round(((pausedAt || Date.now()) - startedAt - pausedTotal) / 1000);
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
    rec.start(5000);
    const m = modal({
      title: t('mt_rec_title'), noBackdropClose: true, size: '',
      body: `<div class="col" style="gap:14px"><div class="row" style="gap:12px"><span class="chip red" id="rcDot">${icon('mic')} <span id="rcTime">0:00</span></span><span class="small muted grow">${t('mt_rec_keep')}</span></div>
        <div><div class="small muted">${t('mt_rec_mic')}</div><div class="progress"><span id="mtMic" style="width:0%"></span></div></div>
        <div><div class="row"><div class="small muted grow" id="sysLabel">${t('mt_rec_sys_off')}</div><button class="btn small" id="rcShare">${icon('expand')} ${t('mt_rec_share')}</button></div><div class="progress mt" id="sysBar"><span id="mtSys" style="width:0%"></span></div><div class="small faint">${t('mt_rec_share_hint')}</div></div></div>`,
      footer: `<button class="btn ghost" id="rcCancel">${t('mt_rec_cancel')}</button><button class="btn" id="rcPause">${icon('pause')} ${t('mt_rec_pause')}</button><button class="btn primary" id="rcStop">${icon('stop')} ${t('mt_rec_stop')}</button>`,
      onClose: () => { if (!closed) finish(false); },
    });
    const level = (an) => { const a = new Uint8Array(an.fftSize); an.getByteTimeDomainData(a); let mx = 0; for (const v of a) mx = Math.max(mx, Math.abs(v - 128)); return Math.min(100, Math.round(mx / 128 * 160)); };
    tick = setInterval(() => {
      if (!m.el.isConnected) return;
      $('#rcTime', m.el).textContent = clock(elapsed());
      $('#mtMic', m.el).style.width = level(micAn) + '%';
      $('#mtSys', m.el).style.width = sysAn ? level(sysAn) + '%' : '0%';
    }, 200);
    function finish(upload) {
      if (closed) return; closed = true;
      clearInterval(tick);
      const dur = elapsed();
      const stopped = new Promise((r) => { rec.onstop = r; });
      if (rec.state !== 'inactive') rec.stop(); else rec.onstop && rec.onstop();
      [mic, sysStream].forEach((s) => s && s.getTracks().forEach((x) => x.stop()));
      try { wake && wake.release(); } catch { /* ignore */ }
      stopped.then(() => { try { ctx.close(); } catch { /* ignore */ } if (upload) onDone(new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] }), dur); });
      m.close();
    }
    $('#rcShare', m.el).onclick = async () => {
      if (sharing.on || !navigator.mediaDevices.getDisplayMedia) return;
      try {
        const d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        d.getVideoTracks().forEach((v) => v.stop());
        if (!d.getAudioTracks().length) { toast(t('mt_rec_noaudio'), 'warn'); return; }
        sysStream = new MediaStream(d.getAudioTracks()); sysAn = meter(sysStream); sharing.on = true;
        $('#sysLabel', m.el).textContent = t('mt_rec_sys'); $('#rcShare', m.el).disabled = true;
        d.getAudioTracks()[0].addEventListener('ended', () => { sysAn = null; $('#sysLabel', m.el).textContent = t('mt_rec_sys_off'); });
      } catch { toast(t('mt_rec_noaudio'), 'warn'); }
    };
    $('#rcPause', m.el).onclick = (e) => {
      const b = e.currentTarget;
      if (rec.state === 'recording') { rec.pause(); pausedAt = Date.now(); b.innerHTML = `${icon('play')} ${t('mt_rec_resume')}`; }
      else if (rec.state === 'paused') { rec.resume(); pausedTotal += Date.now() - pausedAt; pausedAt = 0; b.innerHTML = `${icon('pause')} ${t('mt_rec_pause')}`; }
    };
    $('#rcStop', m.el).onclick = () => finish(true);
    $('#rcCancel', m.el).onclick = async () => { if (await confirmDlg({ title: t('mt_rec_cancel'), message: esc(t('mt_rec_discard_q')), ok: t('mt_rec_cancel'), danger: true })) { finish(false); onDone(null); } };
    window.addEventListener('beforeunload', (e) => { if (!closed) { e.preventDefault(); e.returnValue = ''; } });
    return true;
  }

  // ---------------- new meeting dialog ----------------
  async function newMeeting(p, info, after) {
    let mode = canRecord() ? 'record' : 'upload';
    const att = [];
    const people = info.attendees || [];
    const m = modal({
      title: t('mt_new'), size: 'md',
      body: `<div class="col" style="gap:14px">
        <label class="f">${t('mt_f_title')}<input type="text" id="mtT" maxlength="140" placeholder="${esc(t('mt_title_ph'))}" ${bidi}></label>
        <div class="grid g2" style="gap:14px"><label class="f">${t('mt_f_when')}<input id="mtW" type="datetime-local" value="${localInput()}"></label>
          <label class="f">${t('mt_f_lang')}<select id="mtL"><option value="auto">${t('mt_auto')}</option><option value="en">${t('mt_en')}</option><option value="ar">${t('mt_ar')}</option></select></label></div>
        <label class="f">${t('mt_f_mlang')}<select id="mtM"><option value="auto">${t('mt_auto')}</option><option value="en">${t('mt_en')}</option><option value="ar">${t('mt_ar')}</option></select></label>
        <div><div class="small muted" style="font-weight:600;margin-bottom:6px">${t('mt_f_att')}</div><div class="row wrap" id="mtA" style="gap:6px"></div><input type="text" id="mtAN" class="mt" placeholder="${esc(t('mt_f_att_add'))}" maxlength="80" ${bidi}></div>
        <label class="f">${t('mt_f_notes')}<textarea id="mtN" rows="2" maxlength="4000" ${bidi}></textarea></label>
        <div><div class="small muted" style="font-weight:600;margin-bottom:6px">${t('mt_how')}</div>
          <div class="seg" id="mtMode">${canRecord() ? `<button data-m="record">${icon('mic')} ${t('mt_record')}</button>` : ''}<button data-m="upload">${icon('up')} ${t('mt_upload')}</button><button data-m="text">${icon('file')} ${t('mt_paste')}</button></div>
          <div id="mtModeBody" class="mt"></div></div></div>`,
      footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="mtGo"></button>`,
    });
    const drawAtt = () => {
      $('#mtA', m.el).innerHTML = people.map((x) => `<button type="button" class="chip ${att.some((a) => a.name === x.name) ? 'blue' : ''}" data-p="${esc(x.name)}">${esc(x.name)}</button>`).join('')
        + att.filter((a) => a.external).map((a) => `<button type="button" class="chip blue" data-x="${esc(a.name)}">${esc(a.name)} ${icon('x')}</button>`).join('');
    };
    drawAtt();
    $('#mtA', m.el).onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.p) { const i = att.findIndex((a) => a.name === b.dataset.p); if (i >= 0) att.splice(i, 1); else { const pe = people.find((x) => x.name === b.dataset.p); att.push({ name: pe.name, email: pe.email, role: pe.role }); } }
      if (b.dataset.x) att.splice(att.findIndex((a) => a.name === b.dataset.x), 1);
      drawAtt();
    };
    $('#mtAN', m.el).onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const v = e.target.value.trim(); if (v && !att.some((a) => a.name === v)) { att.push({ name: v, external: !people.some((x) => x.name === v) }); } e.target.value = ''; drawAtt(); };
    const drawMode = () => {
      $$('#mtMode button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      const body = $('#mtModeBody', m.el);
      body.innerHTML = mode === 'record' ? `<p class="small muted">${t('mt_record_hint')}</p>` : mode === 'upload' ? `<input type="file" id="mtF" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"><p class="small muted">${t('mt_upload_hint')} ${t('mt_audio_deleted')}</p>`
        : `<textarea id="mtTx" rows="6" style="width:100%" placeholder="${esc(t('mt_paste_hint'))}" ${bidi}></textarea>`;
      $('#mtGo', m.el).innerHTML = mode === 'record' ? `${icon('mic')} ${t('mt_start')}` : t('mt_create');
    };
    drawMode();
    $('#mtMode', m.el).onclick = (e) => { const b = e.target.closest('button'); if (b) { mode = b.dataset.m; drawMode(); } };
    $('#mtGo', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      const title = $('#mtT', m.el).value.trim();
      if (!title) { toast(t('mt_need_title'), 'err'); $('#mtT', m.el).focus(); return; }
      const file = mode === 'upload' ? $('#mtF', m.el).files[0] : null, text = mode === 'text' ? $('#mtTx', m.el).value.trim() : '';
      if (mode === 'upload' && !file) { toast(t('mt_need_file'), 'err'); return; }
      if (mode === 'text' && !text) { toast(t('mt_need_text'), 'err'); return; }
      const when = $('#mtW', m.el).value;
      const body = { title, meeting_at: when ? new Date(when).toISOString() : undefined, attendees: att, language: $('#mtL', m.el).value, minutes_lang: $('#mtM', m.el).value, notes: $('#mtN', m.el).value, source: mode === 'record' ? 'recording' : mode, transcript_text: text };
      if (mode === 'record') {
        if (!(await startRecorderFor(p, body, after))) return;
        m.close(); return;
      }
      const r = await api('POST', `/api/projects/${p.id}/meetings`, body);
      if (file) await sendAudio(r.meeting.id, file, 0);
      m.close(); after(r.meeting.id);
    });
  }
  async function sendAudio(id, blob, dur) {
    const fd = new FormData();
    fd.append('file', blob, blob.name || 'meeting.webm'); fd.append('duration_sec', String(dur || 0));
    await api('POST', `/api/meetings/${id}/audio`, fd);
  }
  async function startRecorderFor(p, body, after) {
    const r = await api('POST', `/api/projects/${p.id}/meetings`, body);
    const id = r.meeting.id;
    const ok = await startRecorder(r.meeting, async (blob, dur) => {
      if (!blob) { try { await api('DELETE', `/api/meetings/${id}`); } catch { /* ignore */ } after(null); return; }
      toast(t('mt_uploading'));
      try { await sendAudio(id, blob, dur); } catch (e) { toast(e.message, 'err'); }
      after(id);
    });
    if (!ok) { try { await api('DELETE', `/api/meetings/${id}`); } catch { /* ignore */ } }
    return ok;
  }

  // ---------------- list ----------------
  PM.views.tab_meetings = async function (root, p, q, token) {
    if (q && q.get && q.get('m')) return detail(root, p, Number(q.get('m')), token);
    const res = await api('GET', `/api/projects/${p.id}/meetings`);
    if (stale(token)) return;
    let showAll = false;
    const draw = () => {
      const list = res.meetings, rows = showAll ? list : list.slice(0, 5);
      root.innerHTML = `<div class="page">
        <div class="page-head row wrap"><div class="grow"><h1>${t('mt_title')}</h1><div class="muted">${t('mt_sub')}</div></div><button class="btn primary" id="mtNew">${icon('plus')} ${t('mt_new')}</button></div>
        ${!res.stt.configured ? `<div class="banner warn mb">${icon('alert')}<div class="grow">${t('mt_no_stt')}</div></div>` : ''}${res.stt && res.stt.claude === false ? `<div class="banner warn mb">${icon('alert')}<div class="grow">${t('mt_no_claude')}</div></div>` : ''}
        <div class="card">${list.length ? rows.map((m) => `<a class="list-item" href="#/p/${p.id}/meetings?m=${m.id}" style="text-decoration:none;color:inherit">
          <span class="chip blue">${icon('mic')}</span><div class="grow"><div style="font-weight:600" ${bidi}>${esc(m.title)}</div>
          <div class="small muted">${esc(fmtWhen(m.meeting_at))}${m.duration_sec ? ' · ' + fmtDur(m.duration_sec) : ''}${m.attendees.length ? ' · ' + esc(m.attendees.map((a) => a.name).slice(0, 3).join(', ')) + (m.attendees.length > 3 ? ' +' + (m.attendees.length - 3) : '') : ''} · ${t('mt_src_' + m.source)}</div>
          ${m.summary ? `<div class="small" style="margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" ${bidi}>${esc(m.summary)}</div>` : ''}</div>
          <div class="right">${statusChip(m)}${m.actions ? `<div class="small muted" style="margin-top:4px">${t('mt_n_actions', { n: m.actions })}</div>` : ''}</div></a>`).join('')
          + (list.length > 5 ? `<div style="text-align:center;padding-top:10px"><button class="btn ghost small" id="mtMore">${showAll ? t('mt_show_less') : t('mt_show_more')}</button></div>` : '')
          : `<div class="empty" style="padding:28px;text-align:center"><p class="muted">${t('mt_empty')}</p><button class="btn primary" id="mtNew2">${icon('plus')} ${t('mt_new')}</button></div>`}</div></div>`;
      const open = () => newMeeting(p, res, (id) => { location.hash = id ? `#/p/${p.id}/meetings?m=${id}` : `#/p/${p.id}/meetings`; });
      $('#mtNew', root).onclick = open; const n2 = $('#mtNew2', root); if (n2) n2.onclick = open;
      const mo = $('#mtMore', root); if (mo) mo.onclick = () => { showAll = !showAll; draw(); };
    };
    draw();
    if (res.meetings.some((m) => BUSY.includes(m.status))) {
      const iv = setInterval(async () => {
        if (stale(token) || !root.isConnected) return clearInterval(iv);
        try { const r2 = await api('GET', `/api/projects/${p.id}/meetings`); if (stale(token)) return; Object.assign(res, r2); draw(); if (!r2.meetings.some((m) => BUSY.includes(m.status))) clearInterval(iv); } catch { clearInterval(iv); }
      }, 3000);
    }
  };

  // ---------------- detail ----------------
  async function detail(root, p, id, token) {
    let data;
    try { data = await api('GET', `/api/meetings/${id}`); } catch (e) { root.innerHTML = `<div class="page"><div class="banner err">${esc(e.message)}</div><p><a class="btn" href="#/p/${p.id}/meetings">${t('mt_back')}</a></p></div>`; return; }
    if (stale(token)) return;
    let tab = 'minutes', editing = null, sel = new Set(), review = false, poll = null;
    const M = () => data.meeting;
    const spName = (k) => ((M().speakers[k] || {}).name) || k;
    const load = async () => { data = await api('GET', `/api/meetings/${id}`); };
    const refresh = async () => { await load(); if (!stale(token)) draw(); };
    const link = (m) => `#/p/${p.id}/meetings?m=${m.id}`;

    function status(m) {
      if (BUSY.includes(m.status)) return `<div class="card mb"><div class="row" style="gap:14px">${PM.loader ? PM.loader.html({ size: 'md' }) : ''}<div class="grow"><b>${t('mt_status_' + m.status)}</b><div class="small muted">${esc(m.stage || t('mt_working'))}</div><div class="small faint">${t('mt_working')}</div></div></div></div>`;
      if (m.status === 'failed') return `<div class="banner err mb">${icon('alert')}<div class="grow"><b>${t('mt_failed')}</b><div class="small">${esc(m.error || '')}</div></div>${m.source !== 'text' || m.transcript.length ? `<button class="btn" id="mtRetry">${icon('refresh')} ${t('mt_retry')}</button>` : ''}</div>`;
      return '';
    }
    function appliedChips(key) {
      const a = (M().applied || {})[key]; if (!a) return '';
      const c = [];
      if (a.log) c.push(`<span class="chip ${a.log.pending ? 'amber' : 'green'}">${icon(a.log.pending ? 'inbox' : 'check')} ${a.log.pending ? t('mt_waiting') : t('mt_in_log')}</span>`);
      if (a.task) c.push(`<span class="chip ${a.task.pending ? 'amber' : 'green'}">${icon(a.task.pending ? 'inbox' : 'check')} ${a.task.pending ? t('mt_waiting') : t('mt_as_task')}</span>`);
      if (a.update) c.push(`<span class="chip ${a.update.pending ? 'amber' : 'green'}">${icon(a.update.pending ? 'inbox' : 'check')} ${a.update.pending ? t('mt_waiting') : t('mt_upd_done')}</span>`);
      return c.length ? `<div class="row wrap" style="gap:6px;margin-top:6px">${c.join('')}</div>` : '';
    }
    const regenBtn = (s) => `<button class="btn ghost icon" data-regen="${s}" aria-label="${esc(t('mt_regen_sec', { name: t('mt_' + s) }))}" data-tip="${esc(t('mt_regen_sec', { name: t('mt_' + s) }))}">${icon('spark')}</button>`;
    const section = (s, inner, count) => `<div class="card mb"><div class="row"><h2 class="grow" style="margin:0">${t('mt_' + s)}${count != null ? ` <span class="chip">${count}</span>` : ''}</h2>${editing ? '' : regenBtn(s)}</div><div style="margin-top:10px">${inner}</div></div>`;
    const pick = (k) => (editing ? '' : `<input type="checkbox" data-sel="${k}" ${sel.has(k) ? 'checked' : ''} aria-label="${esc(t('mt_pick_all'))}" style="margin-top:3px">`);
    const none = `<div class="small muted">${t('mt_none')}</div>`;

    function minutesView() {
      const m = M().minutes; if (!m) return `<div class="card"><p class="muted">${t('mt_no_transcript')}</p></div>`;
      const E = editing;
      const f = (v, k, extra = '') => `<input type="text" value="${esc(v ?? '')}" data-f="${k}" ${bidi} ${extra}>`;
      const sum = E ? `<textarea rows="5" style="width:100%" data-sum ${bidi}>${esc(E.summary)}</textarea>` : `<p style="margin:0;white-space:pre-wrap" ${bidi}>${esc(m.summary)}</p>`;
      const topics = (E ? E.topics : m.topics).map((x, i) => E ? `<div class="mb" data-row="topics:${i}"><div class="row"><input type="text" class="grow" value="${esc(x.heading)}" data-k="heading" placeholder="${esc(t('mt_t_heading'))}" ${bidi}><button class="btn ghost icon" data-del="topics:${i}" aria-label="${t('mt_remove')}">${icon('trash')}</button></div><textarea rows="3" style="width:100%;margin-top:6px" data-k="points" placeholder="${esc(t('mt_t_points'))}" ${bidi}>${esc(x.points.join('\n'))}</textarea></div>`
        : `<div class="mb"><div style="font-weight:600" ${bidi}>${esc(x.heading)}</div><ul style="margin:4px 0 0;padding-inline-start:20px">${x.points.map((pt) => `<li ${bidi}>${esc(pt)}</li>`).join('')}</ul></div>`).join('') || none;
      const dec = (E ? E.decisions : m.decisions).map((x, i) => E ? `<div class="row mb" data-row="decisions:${i}"><input type="text" class="grow" value="${esc(x.text)}" data-k="text" ${bidi}><button class="btn ghost icon" data-del="decisions:${i}" aria-label="${t('mt_remove')}">${icon('trash')}</button></div>`
        : `<div class="list-item">${pick(x.id)}<div class="grow"><div ${bidi}>${esc(x.text)}</div><div class="small muted">${[x.owner ? t('mt_owner') + ': ' + esc(x.owner) : '', x.time ? t('mt_at') + ' ' + x.time : ''].filter(Boolean).join(' · ')}</div>${appliedChips(x.id)}</div></div>`).join('') || none;
      const act = (E ? E.actions : m.actions).map((x, i) => E ? `<div class="mb" data-row="actions:${i}"><div class="row"><input type="text" class="grow" value="${esc(x.title)}" data-k="title" ${bidi}><button class="btn ghost icon" data-del="actions:${i}" aria-label="${t('mt_remove')}">${icon('trash')}</button></div><div class="grid g2" style="gap:8px;margin-top:6px"><input type="text" value="${esc(x.owner || '')}" data-k="owner" placeholder="${esc(t('mt_owner'))}" ${bidi}><input type="date" value="${esc(x.due_date || '')}" data-k="due_date"></div></div>`
        : `<div class="list-item">${pick(x.id)}<div class="grow"><div style="font-weight:600" ${bidi}>${esc(x.title)}</div><div class="small muted">${[x.owner ? t('mt_owner') + ': ' + esc(x.owner) : '', x.due_date ? t('mt_due') + ': ' + esc(x.due_date) : '', x.time ? t('mt_at') + ' ' + x.time : ''].filter(Boolean).join(' · ')}</div>${x.quote ? `<div class="small faint" ${bidi}>${t('mt_quote')}: ${esc(x.quote)}</div>` : ''}${appliedChips(x.id)}</div></div>`).join('') || none;
      const risks = (E ? E.risks : m.risks).map((x, i) => E ? `<div class="mb" data-row="risks:${i}"><div class="row"><input type="text" class="grow" value="${esc(x.title)}" data-k="title" ${bidi}><button class="btn ghost icon" data-del="risks:${i}" aria-label="${t('mt_remove')}">${icon('trash')}</button></div><input type="text" style="width:100%;margin-top:6px" value="${esc(x.mitigation || '')}" data-k="mitigation" placeholder="${esc(t('mt_mitigation'))}" ${bidi}></div>`
        : `<div class="list-item">${pick(x.id)}<div class="grow"><div style="font-weight:600" ${bidi}>${esc(x.title)}</div><div class="small muted">${t('mt_prob')}: ${esc(x.probability)} · ${t('mt_impact')}: ${esc(x.impact)}${x.mitigation ? ' · ' + t('mt_mitigation') + ': ' + esc(x.mitigation) : ''}</div>${appliedChips(x.id)}</div></div>`).join('') || none;
      const upd = m.updates.map((x) => `<div class="list-item">${pick(x.id)}<div class="grow"><div style="font-weight:600" ${bidi}>${esc(x.task)}</div><div class="small muted">${[x.progress != null ? t('mt_progress') + ': ' + x.progress + '%' : '', x.delay_days != null ? t('mt_delay') + ': ' + x.delay_days : ''].filter(Boolean).join(' · ')}</div>${x.note ? `<div class="small" ${bidi}>${esc(x.note)}</div>` : ''}${appliedChips(x.id)}</div></div>`).join('') || none;
      const qs = (E ? E.questions : m.questions).map((x, i) => E ? `<div class="row mb" data-row="questions:${i}"><input type="text" class="grow" value="${esc(x.text)}" data-k="text" ${bidi}><button class="btn ghost icon" data-del="questions:${i}" aria-label="${t('mt_remove')}">${icon('trash')}</button></div>` : `<div class="list-item"><div class="grow" ${bidi}>${esc(x.text)}${x.owner ? ` <span class="small muted">(${esc(x.owner)})</span>` : ''}</div></div>`).join('') || none;
      const add = (s) => (E ? `<button class="btn ghost small" data-add="${s}">${icon('plus')} ${t('mt_add_item')}</button>` : '');
      return section('summary', sum) + section('topics', topics + add('topics'), m.topics.length) + section('decisions', dec + add('decisions'), m.decisions.length) + section('actions', act + add('actions'), m.actions.length)
        + section('risks', risks + add('risks'), m.risks.length) + (E ? '' : section('updates', upd, m.updates.length)) + section('questions', qs + add('questions'), m.questions.length);
    }
    function transcriptView() {
      const m = M(), tr = m.transcript;
      if (!tr.length) return `<div class="card"><p class="muted">${t('mt_no_transcript')}</p></div>`;
      const keys = Object.keys(m.speakers);
      return `<div class="mt-grid" id="mtTrGrid"><div class="card">${tr.map((s) => `<div class="list-item" data-seg="${s.id}"><span class="small faint" style="min-width:44px">${clock(s.start)}</span><div class="grow">
        <select data-spk="${s.id}" aria-label="${esc(t('mt_change_speaker'))}" style="width:auto;font-weight:600;border:0;background:transparent;padding:0;color:var(--primary)">${keys.map((k) => `<option value="${k}" ${k === s.speaker ? 'selected' : ''}>${esc(spName(k))}</option>`).join('')}</select>
        <div data-txt="${s.id}" tabindex="0" style="cursor:text;white-space:pre-wrap" ${bidi}>${esc(s.text)}</div></div>
        <button class="btn ghost icon" data-edit="${s.id}" aria-label="${esc(t('mt_edit_text'))}" data-tip="${esc(t('mt_edit_text'))}">${icon('edit')}</button><button class="btn ghost icon" data-delseg="${s.id}" aria-label="${esc(t('mt_del_seg'))}" data-tip="${esc(t('mt_del_seg'))}">${icon('trash')}</button></div>`).join('')}</div>
        <div class="card"><h2 style="margin:0 0 10px">${t('mt_speakers')}</h2>${keys.map((k) => `<div class="mb"><div class="row"><input type="text" class="grow" value="${esc(spName(k))}" data-rn="${k}" aria-label="${esc(t('mt_rename'))}" ${bidi}></div>${keys.length > 1 ? `<select data-mg="${k}" style="width:100%;margin-top:4px" aria-label="${esc(t('mt_merge'))}"><option value="">${t('mt_merge')}…</option>${keys.filter((x) => x !== k).map((x) => `<option value="${x}">${esc(spName(x))}</option>`).join('')}</select>` : ''}</div>`).join('')}
        <div class="row"><input type="text" class="grow" id="mtNewSp" placeholder="${esc(t('mt_speaker_name'))}" ${bidi}><button class="btn" id="mtAddSp">${icon('plus')}</button></div></div></div>`;
    }
    function applyBar() {
      const m = M().minutes; if (!m || editing || tab !== 'minutes') return '';
      return `<div class="card" id="mtApply" style="position:sticky;bottom:12px;box-shadow:var(--shadow-lg)"><div class="row wrap" style="gap:10px"><b>${t('mt_to_project')}</b><span class="small muted">${t('mt_sel', { n: sel.size })}</span>
        <button class="btn ghost small" id="mtAll">${t('mt_pick_all')}</button><button class="btn ghost small" id="mtNone">${t('mt_pick_none')}</button><span class="grow"></span>
        <label class="row small" style="gap:6px" data-tip="${esc(t('mt_review_tip'))}"><input type="checkbox" id="mtRev" ${review ? 'checked' : ''}> ${t('mt_review_first')}</label>
        <button class="btn primary" data-ap="log">${icon('list')} ${t('mt_add_log')}</button><button class="btn" data-ap="task">${icon('check')} ${t('mt_add_task')}</button><button class="btn" data-ap="update">${icon('trend')} ${t('mt_add_upd')}</button></div></div>`;
    }

    function draw() {
      const m = M();
      root.innerHTML = `<div class="page">
        <div class="row wrap mb" style="gap:10px"><a class="btn ghost" href="#/p/${p.id}/meetings">${icon('down')} ${t('mt_back')}</a><span class="grow"></span>
          ${m.status === 'ready' ? `<button class="btn" id="mtRegenAll">${icon('spark')} ${t('mt_regen_all')}</button><button class="btn" id="mtExp">${icon('dl')} ${t('mt_export')}</button>` : ''}<button class="btn danger" id="mtDel">${icon('trash')} ${t('mt_delete')}</button></div>
        <div class="card mb"><div class="row wrap" style="gap:12px"><div class="grow"><h1 style="margin:0" ${bidi}>${esc(m.minutes && m.minutes.title || m.title)}</h1>
          <div class="small muted" style="margin-top:6px">${esc(fmtWhen(m.meeting_at))}${m.duration_sec ? ' · ' + t('mt_duration') + ' ' + fmtDur(m.duration_sec) : ''} · ${t('mt_src_' + m.source)}</div>
          <div class="row wrap" style="gap:6px;margin-top:8px">${m.attendees.length ? m.attendees.map((a) => `<span class="chip" ${bidi}>${esc(a.name)}</span>`).join('') : `<span class="small muted">${t('mt_no_att')}</span>`}</div></div>${statusChip(m)}</div></div>
        ${status(m)}
        ${m.status === 'ready' || m.minutes || m.transcript.length ? `<div class="row mb" style="gap:10px"><div class="seg" id="mtTabs"><button data-t="minutes" class="${tab === 'minutes' ? 'on' : ''}">${t('mt_minutes')}</button><button data-t="transcript" class="${tab === 'transcript' ? 'on' : ''}">${t('mt_transcript')} <span class="chip">${m.transcript.length}</span></button></div><span class="grow"></span>
          ${tab === 'minutes' && m.minutes && m.status === 'ready' ? (editing ? `<button class="btn" id="mtEC">${t('mt_cancel')}</button><button class="btn primary" id="mtES">${icon('check')} ${t('mt_save')}</button>` : `<button class="btn" id="mtEdit">${icon('edit')} ${t('mt_edit')}</button>`) : ''}</div>
        ${tab === 'minutes' ? minutesView() + applyBar() : transcriptView()}` : ''}</div>`;
      wire();
    }

    function readEdit() {
      const E = editing;
      const s = $('[data-sum]', root); if (s) E.summary = s.value;
      for (const row of $$('[data-row]', root)) {
        const [sec, i] = row.dataset.row.split(':'); const o = E[sec][Number(i)]; if (!o) continue;
        for (const inp of $$('[data-k]', row)) { const k = inp.dataset.k; o[k] = k === 'points' ? inp.value.split('\n').map((x) => x.trim()).filter(Boolean) : inp.value; }
      }
    }
    const askRegen = (section) => new Promise((res) => {
      const dlg = modal({ title: section ? t('mt_regen_sec', { name: t('mt_' + section) }) : t('mt_regen_all'), size: '', body: `<label class="f">${t('mt_regen_ask')}<textarea id="rgT" rows="3" maxlength="800" ${bidi}></textarea></label>`, footer: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="rgGo">${icon('spark')} ${t('mt_regen_go')}</button>`, onClose: () => res(null) });
      dlg.$('#rgGo').onclick = () => { const v = dlg.$('#rgT').value.trim(); res({ instructions: v }); dlg.close(); };
    });
    function startPolling() {
      clearInterval(poll);
      if (!BUSY.includes(M().status)) return;
      poll = setInterval(async () => {
        if (stale(token) || !root.isConnected) return clearInterval(poll);
        try { await load(); } catch { return; }
        if (stale(token)) return;
        if (!BUSY.includes(M().status)) { clearInterval(poll); draw(); } else { const st = $('.card .small.muted', root); if (st) st.textContent = M().stage || t('mt_working'); }
      }, 2500);
    }
    function wire() {
      startPolling();
      const m = M();
      const r1 = $('#mtRetry', root); if (r1) r1.onclick = (e) => busy(e.currentTarget, async () => { await api('POST', `/api/meetings/${id}/retry`); await refresh(); });
      $('#mtDel', root).onclick = async () => { if (!(await confirmDlg({ title: t('mt_delete'), message: esc(t('mt_delete_q')), ok: t('delete'), danger: true }))) return; try { await api('DELETE', `/api/meetings/${id}`); toast(t('mt_deleted')); location.hash = `#/p/${p.id}/meetings`; } catch (e) { toast(e.message, 'err'); } };
      const ra = $('#mtRegenAll', root); if (ra) ra.onclick = async () => { const o = await askRegen(null); if (!o) return; try { await api('POST', `/api/meetings/${id}/regenerate`, o); toast(t('mt_regen_started')); await refresh(); } catch (e) { toast(e.message, 'err'); } };
      const ex = $('#mtExp', root); if (ex) ex.onclick = () => {
        const dlg = modal({ title: t('mt_export'), size: '', body: `<label class="row" style="gap:8px"><input type="checkbox" id="exT" checked> ${t('mt_export_tr')}</label>`, footer: `<button class="btn" data-fmt="md">${t('mt_export_md')}</button><button class="btn primary" data-fmt="docx">${icon('dl')} ${t('mt_export_docx')}</button>` });
        dlg.el.addEventListener('click', (e) => { const b = e.target.closest('[data-fmt]'); if (!b) return; const tr = dlg.$('#exT').checked ? '&transcript=1' : ''; const name = String(m.title).replace(/[^\p{L}\p{N} ]+/gu, '').trim().replace(/\s+/g, '_') || 'meeting'; PM.download(`/api/meetings/${id}/export?format=${b.dataset.fmt}${tr}`, `${name}.${b.dataset.fmt}`); dlg.close(); });
      };
      const tabs = $('#mtTabs', root); if (tabs) tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; editing = null; draw(); } };
      $$('[data-regen]', root).forEach((b) => b.onclick = async () => { const s = b.dataset.regen; const o = await askRegen(s); if (!o) return; b.disabled = true; try { await api('POST', `/api/meetings/${id}/regenerate`, { section: s, ...o }); toast(t('mt_regen_done')); await refresh(); } catch (e) { toast(e.message, 'err'); b.disabled = false; } });
      // edit minutes
      const ed = $('#mtEdit', root); if (ed) ed.onclick = () => { const x = JSON.parse(JSON.stringify(m.minutes)); editing = { summary: x.summary, topics: x.topics, decisions: x.decisions, actions: x.actions, risks: x.risks, questions: x.questions }; draw(); };
      const ec = $('#mtEC', root); if (ec) ec.onclick = () => { editing = null; draw(); };
      const es = $('#mtES', root); if (es) es.onclick = (e) => busy(e.currentTarget, async () => { readEdit(); await api('PUT', `/api/meetings/${id}/minutes`, { minutes: { ...m.minutes, ...editing } }); editing = null; toast(t('mt_saved'), 'ok'); await refresh(); });
      $$('[data-del]', root).forEach((b) => b.onclick = () => { readEdit(); const [s, i] = b.dataset.del.split(':'); editing[s].splice(Number(i), 1); draw(); });
      $$('[data-add]', root).forEach((b) => b.onclick = () => { readEdit(); const s = b.dataset.add; editing[s].push(s === 'topics' ? { id: '', heading: '', points: [] } : s === 'actions' ? { id: '', title: '', owner: null, due_date: null } : s === 'risks' ? { id: '', title: '', probability: 'Medium', impact: 'Medium', mitigation: '' } : { id: '', text: '' }); draw(); });
      // selection and apply
      $$('[data-sel]', root).forEach((c) => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); const s = $('#mtApply .small.muted', root); if (s) s.textContent = t('mt_sel', { n: sel.size }); });
      const all = $('#mtAll', root); if (all) all.onclick = () => { $$('[data-sel]', root).forEach((c) => { c.checked = true; sel.add(c.dataset.sel); }); const s = $('#mtApply .small.muted', root); if (s) s.textContent = t('mt_sel', { n: sel.size }); };
      const no = $('#mtNone', root); if (no) no.onclick = () => { sel.clear(); $$('[data-sel]', root).forEach((c) => { c.checked = false; }); const s = $('#mtApply .small.muted', root); if (s) s.textContent = t('mt_sel', { n: 0 }); };
      const rv = $('#mtRev', root); if (rv) rv.onchange = () => { review = rv.checked; };
      $$('[data-ap]', root).forEach((b) => b.onclick = () => busy(b, async () => {
        if (!sel.size) { toast(t('mt_pick_some'), 'warn'); return; }
        const mins = m.minutes, kind = b.dataset.ap, items = [];
        for (const id2 of sel) {
          const inSec = (s) => (mins[s] || []).some((x) => x.id === id2);
          if (kind === 'log' && (inSec('actions') || inSec('decisions') || inSec('risks'))) items.push({ id: id2, to: ['log'], mode: review ? 'inbox' : 'now' });
          if (kind === 'task' && inSec('actions')) items.push({ id: id2, to: ['task'], mode: review ? 'inbox' : 'now' });
          if (kind === 'update' && inSec('updates')) items.push({ id: id2, to: ['update'], mode: review ? 'inbox' : 'now' });
        }
        if (!items.length) { toast(t('mt_none_applicable'), 'warn'); return; }
        const r = await api('POST', `/api/meetings/${id}/apply`, { items });
        const ok = r.results.filter((x) => x.ok).length, bad = r.results.find((x) => x.error);
        if (ok) toast(review ? t('mt_sent_review', { n: ok }) : t('mt_sent', { n: ok }), 'ok', review ? { label: t('mt_open_updates'), fn: () => { location.hash = `#/p/${p.id}/inbox`; } } : undefined);
        if (bad) toast(bad.error, 'err');
        sel.clear(); data.meeting = r.meeting; draw();
      }));
      // transcript editing
      $$('[data-spk]', root).forEach((s) => s.onchange = async () => { try { await api('PUT', `/api/meetings/${id}/segments/${s.dataset.spk}`, { speaker: s.value }); await refresh(); } catch (e) { toast(e.message, 'err'); } });
      const editSeg = (sid) => {
        const box = $(`[data-txt="${sid}"]`, root), cur = (M().transcript.find((x) => x.id === Number(sid)) || {}).text || '';
        box.outerHTML = `<div data-ed="${sid}"><textarea rows="3" style="width:100%" ${bidi}>${esc(cur)}</textarea><div class="row" style="gap:6px;margin-top:6px"><button class="btn primary small" data-ok>${t('mt_save')}</button><button class="btn small" data-no>${t('mt_cancel')}</button></div></div>`;
        const w = $(`[data-ed="${sid}"]`, root); w.querySelector('textarea').focus();
        w.querySelector('[data-no]').onclick = () => draw();
        w.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => { await api('PUT', `/api/meetings/${id}/segments/${sid}`, { text: w.querySelector('textarea').value }); await refresh(); });
      };
      $$('[data-edit]', root).forEach((b) => b.onclick = () => editSeg(b.dataset.edit));
      $$('[data-txt]', root).forEach((d) => d.ondblclick = () => editSeg(d.dataset.txt));
      $$('[data-delseg]', root).forEach((b) => b.onclick = async () => { if (!(await confirmDlg({ title: t('mt_del_seg'), message: esc(t('mt_seg_del_q')), ok: t('delete'), danger: true }))) return; try { await api('DELETE', `/api/meetings/${id}/segments/${b.dataset.delseg}`); await refresh(); } catch (e) { toast(e.message, 'err'); } });
      $$('[data-rn]', root).forEach((i) => i.onchange = async () => { if (!i.value.trim()) return refresh(); try { await api('POST', `/api/meetings/${id}/speakers`, { rename: { [i.dataset.rn]: i.value.trim() } }); await refresh(); } catch (e) { toast(e.message, 'err'); } });
      $$('[data-mg]', root).forEach((s) => s.onchange = async () => { if (!s.value) return; try { await api('POST', `/api/meetings/${id}/speakers`, { merge: { from: s.dataset.mg, into: s.value } }); await refresh(); } catch (e) { toast(e.message, 'err'); } });
      const asp = $('#mtAddSp', root); if (asp) asp.onclick = async () => { const v = $('#mtNewSp', root).value.trim(); if (!v) return; try { await api('POST', `/api/meetings/${id}/speakers`, { add: v }); await refresh(); } catch (e) { toast(e.message, 'err'); } };
    }
    draw();
  }
})();
