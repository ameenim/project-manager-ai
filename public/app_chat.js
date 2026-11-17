/* Thinking Area (the former Project Chat).
   A button at the bottom corner of every screen opens a side panel, and Open as a full page shows the same threads in a
   workspace with a thread list. The project manager thinks with AI here and turns the result into changes. The chat is about the project on screen, or about
   all projects. It answers from the person's own data with sources, and it proposes changes as a card that waits for
   Apply. All rules live on the server: this file only sends a message and shows what comes back. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon } = PM;

  Object.assign(PM.I18N.en, {
    th_expand: 'Open as a full page', th_collapse: 'Back to the side panel', th_deep: 'Think deeper', th_deep_tip: 'Think deeper takes longer and uses more of your tokens. Best for schedules and trade offs.', th_deep_on: 'Think deeper is on', th_attach: 'Attach a file', th_attach_tip: 'Attach a file to this project. I can read it and create related documents. Nothing changes until you press Apply.', th_attach_need: 'Open a project first, then attach a file to it.', th_attach_fail: 'The file could not be attached.', th_att_rm: 'Remove from this message', th_uploading: 'Uploading',
    th_sees: 'The AI can see', th_ctx_docs: 'Documents of this project', th_ctx_data: 'Data of this project', th_ctx_portfolio: 'Data of all your projects',
    th_sug_h: 'Suggestions', th_sug_count: '{n} suggestions', th_sug_one: '1 suggestion', cht_todo: 'What to do', th_img: 'Add an image', th_img_tip: 'Add an image to analyze. You can also paste or drop one.', th_img_max: 'You can add up to 3 images.', th_img_fail: 'That image could not be read.', th_img_rm: 'Remove image', th_img_only: 'Images only for now. Send to analyze.', th_sug_more: 'Show all {n}', th_sug_less: 'Show less', th_sug_discuss: 'Discuss', th_sug_snooze: 'Snooze 7 days', th_sug_dismiss: 'Dismiss', th_sug_dismissed: 'Suggestion dismissed', th_sug_snoozed: 'Snoozed for 7 days', th_sug_none: 'No suggestions right now.',
    cht_s_late_tasks: 'Late tasks: {n}', cht_s_low_spi: 'The schedule index is {n}', cht_s_forecast_late: 'The forecast end {n} is after the contract end', cht_s_no_baseline: 'Tasks without a baseline: {n}', cht_s_deliverable_no_task: 'Deliverables due within 7 days with no task: {n}', cht_s_late_payments: 'Late payments: {n}', cht_s_waiting_updates: 'Updates waiting for review: {n}', cht_s_weekly: 'Your weekly summary is ready to write',
    cht_qs_low_spi: 'The schedule index is below 0.95. Why is the project behind plan and what should I do to recover?', cht_qs_forecast_late: 'The forecast end of the project is after the contract end. Suggest an updated schedule to recover.', cht_qs_no_baseline: 'This project has no baseline. Explain what a baseline would lock in and when to set it.', cht_qs_deliverable_no_task: 'Which deliverables due within 7 days have no task in the schedule? Propose tasks for them.', cht_qs_weekly: 'Write my weekly summary across my projects with progress, risks, late items and next steps.',
    th_start: 'Start with', th_quick: 'Quick questions',
    th_threads: 'Threads', th_search: 'Search threads', th_new: 'New thread', th_pin: 'Pin this thread', th_unpin: 'Unpin this thread', th_rename: 'Rename this thread', th_rename_title: 'Rename thread', th_name_ph: 'Thread name', th_pinned: 'Pinned', th_no_match: 'No threads match.', th_renamed: 'Thread renamed', th_save: 'Save', th_cancel: 'Cancel',
    nav_thinking: 'Thinking Area', tab_thinking: 'Thinking',
    cht_history: 'Thinking history', cht_hist_back: 'Back to the conversation', cht_hist_empty: 'No threads yet. Your threads will be kept here.', cht_hist_msgs: '{n} messages', cht_hist_now: 'Open now', cht_hist_del: 'Delete this thread', cht_hist_sure: 'Delete', cht_hist_deleted: 'Thread deleted', cht_untitled: 'Untitled thread', cht_hist_fail: 'The history could not load. Try again.',
    cht_wide: 'Make the Thinking Area wider', cht_narrow: 'Make the Thinking Area narrower', cht_resize: 'Drag to resize. Double click to reset.', cht_grow: 'Drag to make the message box taller. Double click to reset.',
    cht_title: 'Thinking Area', cht_all: 'All projects', cht_open: 'Open the Thinking Area', cht_close: 'Close', cht_new: 'Start a new thread',
    cht_ph: 'Ask or think through your projects', cht_send: 'Send', cht_stop: 'Stop', cht_thinking: 'Thinking', cht_tool: 'Checking your data',
    cht_sources: 'Sources', cht_apply: 'Apply', cht_cancel: 'Cancel', cht_edit: 'Edit', cht_undo: 'Undo', cht_back: 'Back', cht_yes: 'Yes, apply',
    cht_s_pending: 'Waiting for you', cht_s_applied: 'Applied', cht_s_canceled: 'Canceled', cht_s_expired: 'Expired', cht_s_undone: 'Undone', cht_s_failed: 'Not saved', cht_s_applied_final: 'Applied', cht_s_applying: 'Applying', cht_s_undoing: 'Undoing',
    cht_strong: 'Please confirm. This removes records from the project. You can undo it for 7 days.', cht_many: 'This card changes more than 5 records. Please confirm.',
    cht_copy: 'Copy', cht_copied: 'Copied', cht_good: 'Helpful', cht_bad: 'Not helpful', cht_stopped: 'Stopped', cht_failed: 'The Thinking Area could not answer. Try again.',
    cht_view_only: 'You have view only access here. I can answer questions but I cannot change anything.', cht_left: '{n} messages left today',
    cht_applied_toast: 'Changes applied', cht_undone_toast: 'Changes undone', cht_edit_prefix: 'Change the proposal: ',
    cht_f_type: 'Type', cht_f_title: 'Title', cht_f_description: 'Description', cht_f_owner: 'Owner', cht_f_due_date: 'Due date', cht_f_probability: 'Probability', cht_f_impact: 'Impact', cht_f_mitigation: 'Mitigation', cht_f_amount: 'Amount', cht_f_percent: 'Percent', cht_f_status: 'Status', cht_f_name: 'Name', cht_f_start: 'Start', cht_f_duration: 'Duration', cht_f_notes: 'Notes', cht_f_task: 'Task', cht_f_deliverable: 'Deliverable', cht_f_requirement: 'Requirement', cht_f_risk: 'Risk', cht_f_payment: 'Payment',
    cht_empty_title: 'What are you thinking about?', cht_none: 'none', cht_days: '{n} days',
    cht_sum_add: 'Add {kind} "{title}"', cht_sum_upd: 'Update {kind} "{title}"', cht_sum_del: 'Delete {kind} "{title}"', cht_sum_pay: 'Mark payment "{title}" as {state}', cht_sum_addtask: 'Add task "{title}"', cht_sum_updtask: 'Update task "{title}"', cht_sum_deltask: 'Delete task "{title}"',
    cht_sum_saveversion: 'Save the schedule version "{title}"', cht_sum_baseline: 'Set the baseline for "{title}"', cht_sum_restore: 'Restore the schedule to version {title}', cht_f_version: 'Version', cht_f_predecessors: 'Predecessors', cht_f_end_then: 'Project end', cht_f_tasks: 'Tasks', cht_f_replaces: 'Replaces',
    cht_sum_layout: 'Save the layout "{title}"', cht_f_show: 'Shown', cht_f_hide: 'Hidden',
    cht_sum_gen: 'Generate the document "{title}"', cht_sum_review: 'Review decision for {kind} "{title}": {state}', cht_sum_closure: 'Update the closure steps of {title}', cht_sum_close: 'Close the project {title}', cht_sum_reopen: 'Reopen the project {title}', cht_sum_addres: 'Add {title} to the team list', cht_sum_updres: 'Update {title} on the team list', cht_sum_delres: 'Remove {title} from the team list', cht_sum_addteam: 'Add {title} schedule owners to the team list', cht_sum_updrep: 'Update the document "{title}"', cht_sum_delrep: 'Delete the document "{title}"', cht_sum_addfold: 'Create the folder "{title}"', cht_sum_renfold: 'Rename the folder "{title}"', cht_sum_delfold: 'Delete the folder "{title}"', cht_sum_updtpl: 'Update the template "{title}"', cht_sum_deltpl: 'Delete the template "{title}"', cht_sum_updmeet: 'Update the meeting "{title}"', cht_sum_speakers: 'Rename the speakers of "{title}"', cht_sum_minutes: 'Write the minutes of "{title}" again', cht_sum_restoreupd: 'Bring back the update "{title}"', cht_sum_sync: 'Sync {title} now', cht_sum_syncsched: 'Set the automatic sync of {title} to {state}', cht_sum_jirasite: 'Use the Jira site {title}', cht_sum_reorder: 'Move the task "{title}"', cht_sum_savelog: 'Save the Logs view "{title}"', cht_sum_dellog: 'Delete the Logs view "{title}"', cht_sum_notif: 'Mark notifications as {state}', cht_sum_instw: 'Add the widget "{title}"', cht_sum_uninstw: 'Remove the widget "{title}"', cht_sum_delw: 'Delete the widget "{title}"', cht_sum_dellay: 'Delete the layout "{title}"', cht_sum_newproj: 'Create the project "{title}"', cht_sum_ticket: 'Send the support ticket "{title}"', cht_v_confirm: 'confirm', cht_v_ignore: 'ignore', cht_v_reopen: 'reopen', cht_v_read: 'read', cht_v_dismiss: 'dismissed', cht_v_off: 'off', cht_v_hourly: 'every hour', cht_v_every4h: 'every 4 hours', cht_v_daily: 'daily', cht_v_weekdays: 'weekdays',  cht_f_format: 'Format', cht_open_reports: 'Open Reports', cht_wp_edit: 'Edit', cht_wp_all: 'Open my {n} widgets', cht_wp_pub: 'Publish', cht_wp_upd: 'Publish update', cht_wp_done: 'Published', cht_wp_draft: 'Private draft', cht_wp_loading: 'Loading the preview', cht_wp_fail: 'The preview could not be drawn.', cht_wp_ok: '"{title}" is published', cht_doc_open: 'Open', cht_doc_dl: 'Download', cht_doc_ready: 'Download ready', cht_doc_fail: 'The document could not be opened.', cht_f_related_project: 'Related project', cht_dr_draft: 'Draft', cht_dr_save: 'Save to project', cht_dr_save_to: 'Save to {p}', cht_dr_saved: 'Saved to {p}', cht_dr_open_rep: 'Open in Reports', cht_dr_ready: 'This is a draft. Save it to {p} to keep it with that project in Reports.', cht_dr_portfolio: 'Portfolio document. It covers more than one project, so it cannot be saved to a single project. Open or download it here.', cht_dr_saved_toast: 'Saved to {p}', cht_dr_fail: 'The draft could not be opened.', cht_sum_sched: 'Change the schedule of task "{title}"', cht_sum_plan: 'Update the schedule: {title}', cht_f_reason: 'Reason', cht_sum_widget: 'Create the widget "{title}"', cht_sum_meeting: 'Send items from the meeting "{title}"', cht_sum_project: 'Change the settings of project "{title}"', cht_sum_template: 'Save the template "{title}"', cht_f_meeting: 'Meeting', cht_f_takes: 'Takes', cht_f_client: 'Client', cht_f_start_date: 'Start date', cht_f_end_date: 'End date', cht_f_value: 'Value', cht_f_action: 'Action', cht_f_decision: 'Decision', cht_f_group: 'Group', cht_f_data: 'Data', cht_f_display: 'Display', cht_f_added_to: 'Added to', cht_f_template: 'Template', cht_sum_applyupd: 'Apply update "{title}"', cht_sum_dismiss: 'Dismiss update "{title}"', cht_sum_addupd: 'Add a message to the Updates inbox',
    cht_f_progress: 'Progress', cht_f_update: 'Update', cht_f_message: 'Message', cht_impact_h: 'Impact on the schedule', cht_impact_none: 'No other task moves.', cht_impact_n: '{n} other tasks move.', cht_impact_n1: '1 other task moves.', cht_impact_end: 'Project end: {a} to {b}.', cht_impact_same: 'Project end stays {b}.',
    cht_brief_h: 'Today', cht_brief_clear: 'Nothing needs your attention right now.',
    cht_b_late_tasks: '{n} late tasks', cht_b_connect: 'Connect Jira or Outlook', cht_q_connect: 'Guide me step by step through connecting Jira or Outlook.', cht_b_late_payments: '{n} late payments', cht_b_updates: '{n} updates waiting', cht_b_at_risk: '{n} projects off track', cht_b_high_risks: '{n} high risks open',
    cht_q_late_tasks: 'Which tasks are late? Suggest an updated schedule to recover.', cht_q_late_payments: 'Which payments are late?', cht_q_updates: 'What is waiting in Updates?', cht_q_at_risk: 'Which projects are at risk?', cht_q_high_risks: 'Show the high risks',
    cht_note_kids: '{n} child tasks move up one level.', cht_note_kids1: '1 child task moves up one level.', cht_note_succ: '{n} tasks lose this predecessor.', cht_note_succ1: '1 task loses this predecessor.',
    cht_v_open: 'Open', cht_v_progress: 'In progress', cht_v_closed: 'Closed', cht_v_mitigated: 'Mitigated', cht_v_transferred: 'Transferred', cht_v_pending: 'Pending', cht_v_invoiced: 'Invoiced', cht_v_paid: 'Paid', cht_v_low: 'Low', cht_v_medium: 'Medium', cht_v_high: 'High',
  });
  Object.assign(PM.I18N.ar, {
    th_expand: 'افتح كصفحة كاملة', th_collapse: 'العودة إلى اللوحة الجانبية', th_deep: 'فكّر بعمق', th_deep_tip: 'التفكير بعمق يستغرق وقتا أطول ويستهلك رموزا أكثر. مناسب للجداول والمفاضلات.', th_deep_on: 'التفكير بعمق مفعّل', th_attach: 'أرفق ملفا', th_attach_tip: 'أرفق ملفا بهذا المشروع. يمكنني قراءته وإنشاء مستندات مرتبطة به. لا يتغير شيء حتى تضغط تطبيق.', th_attach_need: 'افتح مشروعا أولا ثم أرفق الملف به.', th_attach_fail: 'تعذر إرفاق الملف.', th_att_rm: 'أزل من هذه الرسالة', th_uploading: 'جار الرفع',
    th_sees: 'ما يراه الذكاء الاصطناعي', th_ctx_docs: 'مستندات هذا المشروع', th_ctx_data: 'بيانات هذا المشروع', th_ctx_portfolio: 'بيانات كل مشاريعك',
    th_sug_h: 'اقتراحات', th_sug_count: '{n} اقتراحات', th_sug_one: 'اقتراح واحد', cht_todo: 'ما يجب فعله', th_img: 'أضف صورة', th_img_tip: 'أضف صورة لتحليلها. يمكنك أيضا لصقها أو إفلاتها هنا.', th_img_max: 'يمكنك إضافة 3 صور كحد أقصى.', th_img_fail: 'تعذرت قراءة هذه الصورة.', th_img_rm: 'إزالة الصورة', th_img_only: 'صور فقط حاليا. أرسل للتحليل.', th_sug_more: 'عرض الكل ({n})', th_sug_less: 'عرض أقل', th_sug_discuss: 'ناقش', th_sug_snooze: 'تأجيل 7 أيام', th_sug_dismiss: 'تجاهل', th_sug_dismissed: 'تم تجاهل الاقتراح', th_sug_snoozed: 'تم التأجيل 7 أيام', th_sug_none: 'لا توجد اقتراحات الآن.',
    cht_s_late_tasks: 'مهام متأخرة: {n}', cht_s_low_spi: 'مؤشر الجدول {n}', cht_s_forecast_late: 'نهاية المشروع المتوقعة {n} بعد نهاية العقد', cht_s_no_baseline: 'مهام بلا خط أساس: {n}', cht_s_deliverable_no_task: 'مخرجات مستحقة خلال 7 أيام بلا مهمة: {n}', cht_s_late_payments: 'دفعات متأخرة: {n}', cht_s_waiting_updates: 'تحديثات بانتظار المراجعة: {n}', cht_s_weekly: 'ملخصك الأسبوعي جاهز للكتابة',
    cht_qs_low_spi: 'مؤشر الجدول أقل من 0.95. لماذا المشروع متأخر عن الخطة وماذا أفعل للتعافي؟', cht_qs_forecast_late: 'نهاية المشروع المتوقعة بعد نهاية العقد. اقترح جدولا محدثا للتعافي.', cht_qs_no_baseline: 'هذا المشروع بلا خط أساس. اشرح ما الذي يثبته خط الأساس ومتى أحدده.', cht_qs_deliverable_no_task: 'ما المخرجات المستحقة خلال 7 أيام وليس لها مهمة في الجدول؟ اقترح مهاما لها.', cht_qs_weekly: 'اكتب ملخصي الأسبوعي لمشاريعي مع التقدم والمخاطر والبنود المتأخرة والخطوات القادمة.',
    th_start: 'ابدأ بـ', th_quick: 'أسئلة سريعة',
    th_threads: 'المحادثات', th_search: 'ابحث في المحادثات', th_new: 'محادثة جديدة', th_pin: 'تثبيت هذه المحادثة', th_unpin: 'إلغاء تثبيت هذه المحادثة', th_rename: 'إعادة تسمية هذه المحادثة', th_rename_title: 'إعادة تسمية المحادثة', th_name_ph: 'اسم المحادثة', th_pinned: 'مثبتة', th_no_match: 'لا توجد محادثات مطابقة.', th_renamed: 'تمت إعادة تسمية المحادثة', th_save: 'حفظ', th_cancel: 'إلغاء',
    nav_thinking: 'مساحة التفكير', tab_thinking: 'التفكير',
    cht_history: 'سجل التفكير', cht_hist_back: 'العودة إلى المحادثة', cht_hist_empty: 'لا توجد محادثات بعد. ستُحفظ محادثاتك هنا.', cht_hist_msgs: '{n} رسائل', cht_hist_now: 'مفتوحة الآن', cht_hist_del: 'حذف هذه المحادثة', cht_hist_sure: 'حذف', cht_hist_deleted: 'تم حذف المحادثة', cht_untitled: 'محادثة بلا عنوان', cht_hist_fail: 'تعذر تحميل السجل. حاول مرة أخرى.',
    cht_wide: 'وسّع مساحة التفكير', cht_narrow: 'قلّل عرض مساحة التفكير', cht_resize: 'اسحب لتغيير الحجم. انقر مرتين للإعادة.', cht_grow: 'اسحب لتكبير مربع الرسالة. انقر مرتين للإعادة.',
    cht_title: 'مساحة التفكير', cht_all: 'كل المشاريع', cht_open: 'افتح مساحة التفكير', cht_close: 'إغلاق', cht_new: 'ابدأ محادثة جديدة',
    cht_ph: 'اسأل أو فكّر في مشاريعك', cht_send: 'إرسال', cht_stop: 'إيقاف', cht_thinking: 'جار التفكير', cht_tool: 'جار فحص بياناتك',
    cht_sources: 'المصادر', cht_apply: 'تطبيق', cht_cancel: 'إلغاء', cht_edit: 'تعديل', cht_undo: 'تراجع', cht_back: 'رجوع', cht_yes: 'نعم، طبّق',
    cht_s_pending: 'بانتظارك', cht_s_applied: 'تم التطبيق', cht_s_canceled: 'تم الإلغاء', cht_s_expired: 'انتهت الصلاحية', cht_s_undone: 'تم التراجع', cht_s_failed: 'لم يُحفظ', cht_s_applied_final: 'تم التطبيق', cht_s_applying: 'جار التطبيق', cht_s_undoing: 'جار التراجع',
    cht_strong: 'يرجى التأكيد. هذا يحذف سجلات من المشروع. يمكنك التراجع خلال 7 أيام.', cht_many: 'تغير هذه البطاقة أكثر من 5 سجلات. يرجى التأكيد.',
    cht_copy: 'نسخ', cht_copied: 'تم النسخ', cht_good: 'مفيد', cht_bad: 'غير مفيد', cht_stopped: 'تم الإيقاف', cht_failed: 'تعذر على مساحة التفكير الرد. حاول مرة أخرى.',
    cht_view_only: 'لديك صلاحية العرض فقط هنا. أستطيع الإجابة عن الأسئلة لكن لا أستطيع تغيير أي شيء.', cht_left: 'تبقّت {n} رسالة اليوم',
    cht_applied_toast: 'تم تطبيق التغييرات', cht_undone_toast: 'تم التراجع عن التغييرات', cht_edit_prefix: 'عدّل الاقتراح: ',
    cht_f_type: 'النوع', cht_f_title: 'العنوان', cht_f_description: 'الوصف', cht_f_owner: 'المسؤول', cht_f_due_date: 'تاريخ الاستحقاق', cht_f_probability: 'الاحتمال', cht_f_impact: 'الأثر', cht_f_mitigation: 'المعالجة', cht_f_amount: 'المبلغ', cht_f_percent: 'النسبة', cht_f_status: 'الحالة', cht_f_name: 'الاسم', cht_f_start: 'البداية', cht_f_duration: 'المدة', cht_f_notes: 'ملاحظات', cht_f_task: 'المهمة', cht_f_deliverable: 'مخرج', cht_f_requirement: 'متطلب', cht_f_risk: 'خطر', cht_f_payment: 'دفعة',
    cht_empty_title: 'فيمَ تفكر اليوم؟', cht_none: 'لا شيء', cht_days: '{n} أيام',
    cht_sum_add: 'إضافة {kind} "{title}"', cht_sum_upd: 'تحديث {kind} "{title}"', cht_sum_del: 'حذف {kind} "{title}"', cht_sum_pay: 'تحديد الدفعة "{title}" على أنها {state}', cht_sum_addtask: 'إضافة المهمة "{title}"', cht_sum_updtask: 'تحديث المهمة "{title}"', cht_sum_deltask: 'حذف المهمة "{title}"',
    cht_sum_saveversion: 'حفظ نسخة الجدول "{title}"', cht_sum_baseline: 'تحديد خط الأساس لـ "{title}"', cht_sum_restore: 'استعادة الجدول إلى النسخة {title}', cht_f_version: 'النسخة', cht_f_predecessors: 'المهام السابقة', cht_f_end_then: 'نهاية المشروع', cht_f_tasks: 'المهام', cht_f_replaces: 'يستبدل',
    cht_sum_layout: 'حفظ التخطيط "{title}"', cht_f_show: 'الظاهر', cht_f_hide: 'المخفي',
    cht_sum_gen: 'إنشاء المستند "{title}"', cht_sum_review: 'قرار مراجعة لـ {kind} "{title}": {state}', cht_sum_closure: 'تحديث خطوات إغلاق {title}', cht_sum_close: 'إغلاق المشروع {title}', cht_sum_reopen: 'إعادة فتح المشروع {title}', cht_sum_addres: 'إضافة {title} إلى قائمة الفريق', cht_sum_updres: 'تحديث {title} في قائمة الفريق', cht_sum_delres: 'إزالة {title} من قائمة الفريق', cht_sum_addteam: 'إضافة {title} من مسؤولي الجدول إلى قائمة الفريق', cht_sum_updrep: 'تحديث المستند "{title}"', cht_sum_delrep: 'حذف المستند "{title}"', cht_sum_addfold: 'إنشاء المجلد "{title}"', cht_sum_renfold: 'إعادة تسمية المجلد "{title}"', cht_sum_delfold: 'حذف المجلد "{title}"', cht_sum_updtpl: 'تحديث القالب "{title}"', cht_sum_deltpl: 'حذف القالب "{title}"', cht_sum_updmeet: 'تحديث الاجتماع "{title}"', cht_sum_speakers: 'إعادة تسمية المتحدثين في "{title}"', cht_sum_minutes: 'كتابة محضر "{title}" من جديد', cht_sum_restoreupd: 'استعادة التحديث "{title}"', cht_sum_sync: 'مزامنة {title} الآن', cht_sum_syncsched: 'ضبط المزامنة التلقائية لـ {title} على {state}', cht_sum_jirasite: 'استخدام موقع جيرا {title}', cht_sum_reorder: 'نقل المهمة "{title}"', cht_sum_savelog: 'حفظ عرض السجلات "{title}"', cht_sum_dellog: 'حذف عرض السجلات "{title}"', cht_sum_notif: 'تعليم الإشعارات على أنها {state}', cht_sum_instw: 'إضافة الأداة "{title}"', cht_sum_uninstw: 'إزالة الأداة "{title}"', cht_sum_delw: 'حذف الأداة "{title}"', cht_sum_dellay: 'حذف التخطيط "{title}"', cht_sum_newproj: 'إنشاء المشروع "{title}"', cht_sum_ticket: 'إرسال تذكرة الدعم "{title}"', cht_v_confirm: 'تأكيد', cht_v_ignore: 'تجاهل', cht_v_reopen: 'إعادة فتح', cht_v_read: 'مقروءة', cht_v_dismiss: 'مستبعدة', cht_v_off: 'متوقفة', cht_v_hourly: 'كل ساعة', cht_v_every4h: 'كل 4 ساعات', cht_v_daily: 'يوميا', cht_v_weekdays: 'أيام الأسبوع',  cht_f_format: 'الصيغة', cht_open_reports: 'افتح التقارير', cht_wp_edit: 'تعديل', cht_wp_all: 'فتح أدواتي ({n})', cht_wp_pub: 'نشر', cht_wp_upd: 'نشر التحديث', cht_wp_done: 'منشورة', cht_wp_draft: 'مسودة خاصة', cht_wp_loading: 'جار تحميل المعاينة', cht_wp_fail: 'تعذر رسم المعاينة.', cht_wp_ok: 'تم نشر "{title}"', cht_doc_open: 'فتح', cht_doc_dl: 'تنزيل', cht_doc_ready: 'التنزيل جاهز', cht_doc_fail: 'تعذر فتح المستند.', cht_f_related_project: 'المشروع المرتبط', cht_dr_draft: 'مسودة', cht_dr_save: 'حفظ في مشروع', cht_dr_save_to: 'حفظ في {p}', cht_dr_saved: 'تم الحفظ في {p}', cht_dr_open_rep: 'فتح في التقارير', cht_dr_ready: 'هذه مسودة. احفظها في {p} لتبقى مع ذلك المشروع في التقارير.', cht_dr_portfolio: 'مستند على مستوى المحفظة. يشمل أكثر من مشروع، لذلك لا يمكن حفظه في مشروع واحد. افتحه أو نزّله من هنا.', cht_dr_saved_toast: 'تم الحفظ في {p}', cht_dr_fail: 'تعذر فتح المسودة.', cht_sum_sched: 'تغيير جدول المهمة "{title}"', cht_sum_plan: 'تحديث الجدول: {title}', cht_f_reason: 'السبب', cht_sum_widget: 'إنشاء الأداة "{title}"', cht_sum_meeting: 'إرسال بنود من الاجتماع "{title}"', cht_sum_project: 'تغيير إعدادات المشروع "{title}"', cht_sum_template: 'حفظ القالب "{title}"', cht_f_meeting: 'الاجتماع', cht_f_takes: 'يأخذ', cht_f_client: 'العميل', cht_f_start_date: 'تاريخ البدء', cht_f_end_date: 'تاريخ الانتهاء', cht_f_value: 'القيمة', cht_f_action: 'إجراء', cht_f_decision: 'قرار', cht_f_group: 'المجموعة', cht_f_data: 'البيانات', cht_f_display: 'العرض', cht_f_added_to: 'أضيفت إلى', cht_f_template: 'القالب', cht_sum_applyupd: 'تطبيق التحديث "{title}"', cht_sum_dismiss: 'تجاهل التحديث "{title}"', cht_sum_addupd: 'إضافة رسالة إلى صندوق التحديثات',
    cht_f_progress: 'التقدم', cht_f_update: 'التحديث', cht_f_message: 'الرسالة', cht_impact_h: 'الأثر على الجدول', cht_impact_none: 'لا تتحرك مهام أخرى.', cht_impact_n: 'تتحرك {n} مهام أخرى.', cht_impact_n1: 'تتحرك مهمة أخرى واحدة.', cht_impact_end: 'نهاية المشروع: من {a} إلى {b}.', cht_impact_same: 'تبقى نهاية المشروع {b}.',
    cht_brief_h: 'اليوم', cht_brief_clear: 'لا شيء يحتاج إلى انتباهك الآن.',
    cht_b_late_tasks: '{n} مهام متأخرة', cht_b_connect: 'اربط Jira أو Outlook', cht_q_connect: 'أرشدني خطوة بخطوة لربط Jira أو Outlook.', cht_b_late_payments: '{n} دفعات متأخرة', cht_b_updates: '{n} تحديثات بالانتظار', cht_b_at_risk: '{n} مشاريع خارج المسار', cht_b_high_risks: '{n} مخاطر عالية مفتوحة',
    cht_q_late_tasks: 'ما هي المهام المتأخرة؟ اقترح جدولا محدثا للتعافي.', cht_q_late_payments: 'ما هي الدفعات المتأخرة؟', cht_q_updates: 'ما الذي ينتظر في التحديثات؟', cht_q_at_risk: 'أي المشاريع معرضة للخطر؟', cht_q_high_risks: 'اعرض المخاطر العالية',
    cht_note_kids: 'تنتقل {n} مهام فرعية مستوى واحدا للأعلى.', cht_note_kids1: 'تنتقل مهمة فرعية واحدة مستوى واحدا للأعلى.', cht_note_succ: 'تفقد {n} مهام هذا السابق.', cht_note_succ1: 'تفقد مهمة واحدة هذا السابق.',
    cht_v_open: 'مفتوح', cht_v_progress: 'قيد التنفيذ', cht_v_closed: 'مغلق', cht_v_mitigated: 'تمت المعالجة', cht_v_transferred: 'تم النقل', cht_v_pending: 'قيد الانتظار', cht_v_invoiced: 'تمت الفوترة', cht_v_paid: 'مدفوعة', cht_v_low: 'منخفض', cht_v_medium: 'متوسط', cht_v_high: 'مرتفع',
  });

  Object.assign(PM.I18N.en, {
    th_plus: 'Add to your message', th_cam: 'Take a photo', th_photos: 'Add photos', th_files: 'Add files', th_files_h: 'PDF, Word, Excel or PowerPoint', th_deep_h: 'Slower, more careful answers for schedules and trade offs',
    th_mic: 'Voice input', th_mic_ok: 'Use this text', th_mic_no: 'Cancel recording', th_listening: 'Listening', th_transcribing: 'Writing down your words',
    th_mic_blocked: 'The microphone is blocked. Allow it in your browser settings and try again.', th_mic_fail: 'Voice input could not understand that. Try again.', th_mic_long: 'That recording is too long. Keep it under two minutes.', th_mic_none: 'No speech was heard.',
    th_deep_off: 'Turn off Think deeper', th_sheet_x: 'Close', th_full: 'Full screen', th_full_off: 'Exit full screen',
  });
  Object.assign(PM.I18N.ar, {
    th_plus: 'إضافة إلى الرسالة', th_cam: 'التقاط صورة', th_photos: 'إضافة صور', th_files: 'إضافة ملفات', th_files_h: 'مستندات وجداول وعروض تقديمية', th_deep_h: 'إجابات أبطأ وأدق للجداول والمفاضلات',
    th_mic: 'إدخال صوتي', th_mic_ok: 'استخدم هذا النص', th_mic_no: 'إلغاء التسجيل', th_listening: 'جار الاستماع', th_transcribing: 'جار كتابة كلامك',
    th_mic_blocked: 'الميكروفون محظور. اسمح بالوصول إليه من إعدادات المتصفح وحاول مرة أخرى.', th_mic_fail: 'تعذر فهم الصوت. حاول مرة أخرى.', th_mic_long: 'التسجيل طويل جدا. اجعله أقل من دقيقتين.', th_mic_none: 'لم أسمع أي كلام.',
    th_deep_off: 'إيقاف التفكير بعمق', th_sheet_x: 'إغلاق', th_full: 'ملء الشاشة', th_full_off: 'الخروج من ملء الشاشة',
  });

  Object.assign(PM.I18N.en, {
    th_g_today: 'Today', th_g_yest: 'Yesterday', th_g_week: 'Previous 7 days', th_g_older: 'Older', th_side_hide: 'Hide threads', th_side_show: 'Show threads',
  });
  Object.assign(PM.I18N.ar, {
    th_g_today: 'اليوم', th_g_yest: 'أمس', th_g_week: 'آخر 7 أيام', th_g_older: 'أقدم', th_side_hide: 'إخفاء المحادثات', th_side_show: 'إظهار المحادثات',
  });

  // The suggested schedule card: the plan, its end against the contract, and the checks against due dates.
  Object.assign(PM.I18N.en, {
    cht_sum_newsched: 'Create the schedule "{title}"', cht_f_phases: 'Phases', cht_f_tasks: 'Tasks', cht_f_milestones: 'Milestones', cht_f_forecast_end: 'Project end', cht_f_contract_end: 'Contract end',
    cht_plan_range: '{a} to {b}', cht_plan_end_ok: 'Project end {e}, on or before the contract end {c}.', cht_plan_end_over: 'Project end {e}, {d} days after the contract end {c}.', cht_plan_end_only: 'Project end {e}.',
    cht_plan_dates_h: 'Deliverables and payments against their due dates', cht_plan_due: 'due {d}', cht_plan_nodue: 'no due date', cht_plan_planned: 'planned {d}', cht_plan_ontime: 'On time', cht_plan_late: '{n} days late', cht_plan_late1: '1 day late',
    cht_plan_gap_h: 'No task covers these yet', cht_plan_k_del: 'Deliverables', cht_plan_k_pay: 'Payments', cht_plan_k_req: 'Requirements',
    cht_plan_ms: 'Milestone', cht_plan_produces: 'Delivers {d}', cht_plan_score: 'Schedule check score {n} of 100', cht_plan_phases_h: 'Phases and tasks',
    cht_plan_legend: 'Bars show the planned dates and red bars are on the critical path. The dates come from the schedule engine, so the Schedule tab shows the same ones after you apply.',
    cht_open_schedule: 'Open the schedule',
  });
  Object.assign(PM.I18N.ar, {
    cht_sum_newsched: 'إنشاء الجدول "{title}"', cht_f_phases: 'المراحل', cht_f_tasks: 'المهام', cht_f_milestones: 'المعالم', cht_f_forecast_end: 'نهاية المشروع', cht_f_contract_end: 'نهاية العقد',
    cht_plan_range: '{a} إلى {b}', cht_plan_end_ok: 'نهاية المشروع {e}، وهي في موعد نهاية العقد {c} أو قبله.', cht_plan_end_over: 'نهاية المشروع {e}، بعد نهاية العقد {c} بمقدار {d} يوما.', cht_plan_end_only: 'نهاية المشروع {e}.',
    cht_plan_dates_h: 'المخرجات والدفعات مقابل مواعيد استحقاقها', cht_plan_due: 'الاستحقاق {d}', cht_plan_nodue: 'بلا تاريخ استحقاق', cht_plan_planned: 'المخطط {d}', cht_plan_ontime: 'في الموعد', cht_plan_late: 'متأخر {n} يوما', cht_plan_late1: 'متأخر يوم واحد',
    cht_plan_gap_h: 'لا توجد مهمة تغطي هذه العناصر بعد', cht_plan_k_del: 'المخرجات', cht_plan_k_pay: 'الدفعات', cht_plan_k_req: 'المتطلبات',
    cht_plan_ms: 'معلم', cht_plan_produces: 'تسلّم {d}', cht_plan_score: 'نتيجة فحص الجدول {n} من 100', cht_plan_phases_h: 'المراحل والمهام',
    cht_plan_legend: 'تعرض الأشرطة التواريخ المخططة، والأشرطة الحمراء على المسار الحرج. التواريخ من محرك الجدولة، لذلك يعرض تبويب الجدول التواريخ نفسها بعد التطبيق.',
    cht_open_schedule: 'افتح الجدول',
  });

  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; };
  const DEF_W = 420, MIN_W = 340, WIDE_W = 760, MIN_IN = 38;
  const S = { open: false, busy: false, ctl: null, ctx: { projectId: null, screen: 'portfolio' }, data: null, msgs: [], confirming: null, raf: 0, mode: 'chat', hist: null, w: Number(pref('pm_chat_w')) || DEF_W, inH: Number(pref('pm_chat_inh')) || 0, dragging: false, page: false, att: [], upl: false, deep: pref('pm_think_deep') === '1', side: pref('pm_th_side') !== '0', th: { items: null, q: '', confirm: null } };
  let root = null;
  const $q = (sel) => (root ? root.querySelector(sel) : null);
  const ctxFromHash = () => {
    const m = String(location.hash || '').match(/^#\/p\/(\d+)(?:\/([a-z]+))?/);
    return m ? { projectId: Number(m[1]), screen: m[2] || 'overview' } : { projectId: null, screen: 'portfolio' };
  };
  const safeHref = (h) => (/^#\//.test(String(h || '')) ? h : '#/');
  const keep = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; };
  const fieldLabel = (f) => { const k = 'cht_f_' + f; return PM.I18N[PM.state.lang] && PM.I18N[PM.state.lang][k] ? t(k) : f.replace(/_/g, ' '); };
  const has = (k) => !!(PM.I18N[PM.state.lang] && PM.I18N[PM.state.lang][k]);
  const valText = (v, field) => {
    if (v == null || v === '') return t('cht_none');
    if (field === 'duration') return t('cht_days', { n: v });
    if (field === 'progress') return v + '%';
    if (field === 'type' && has('cht_f_' + v)) return t('cht_f_' + v);
    const k = 'cht_v_' + String(v).toLowerCase();
    return has(k) && (field === 'status' || field === 'probability' || field === 'impact') ? t(k) : String(v);
  };
  const sumText = (it) => {
    const x = it.sum; if (!x) return it.summary;
    const kind = x.kind && has('cht_f_' + x.kind) ? t('cht_f_' + x.kind).toLowerCase() : (x.kind || '');
    const map = { generate: 'cht_sum_gen', change_schedule: 'cht_sum_sched', schedule_plan: 'cht_sum_plan', new_schedule: 'cht_sum_newsched', create_widget: 'cht_sum_widget', save_layout: 'cht_sum_layout', save_version: 'cht_sum_saveversion', set_baseline: 'cht_sum_baseline', restore_version: 'cht_sum_restore', meeting_items: 'cht_sum_meeting', update_project: 'cht_sum_project', create_template: 'cht_sum_template', apply_update: 'cht_sum_applyupd', dismiss_update: 'cht_sum_dismiss', add_update: 'cht_sum_addupd', create_item: 'cht_sum_add', update_item: 'cht_sum_upd', delete_item: 'cht_sum_del', set_payment: 'cht_sum_pay', create_task: 'cht_sum_addtask', update_task: 'cht_sum_updtask', delete_task: 'cht_sum_deltask', review_item: 'cht_sum_review', update_closure: 'cht_sum_closure', close_project: 'cht_sum_close', reopen_project: 'cht_sum_reopen', create_resource: 'cht_sum_addres', update_resource: 'cht_sum_updres', delete_resource: 'cht_sum_delres', add_team: 'cht_sum_addteam', update_report: 'cht_sum_updrep', delete_report: 'cht_sum_delrep', create_folder: 'cht_sum_addfold', rename_folder: 'cht_sum_renfold', delete_folder: 'cht_sum_delfold', update_template: 'cht_sum_updtpl', delete_template: 'cht_sum_deltpl', update_meeting: 'cht_sum_updmeet', rename_speakers: 'cht_sum_speakers', regenerate_minutes: 'cht_sum_minutes', restore_update: 'cht_sum_restoreupd', run_sync: 'cht_sum_sync', set_sync_schedule: 'cht_sum_syncsched', choose_jira_site: 'cht_sum_jirasite', reorder_task: 'cht_sum_reorder', save_log_view: 'cht_sum_savelog', delete_log_view: 'cht_sum_dellog', mark_notifications: 'cht_sum_notif', install_widget: 'cht_sum_instw', uninstall_widget: 'cht_sum_uninstw', delete_widget: 'cht_sum_delw', delete_layout: 'cht_sum_dellay', create_project: 'cht_sum_newproj', create_support_ticket: 'cht_sum_ticket' };
    return t(map[x.op] || 'cht_sum_upd', { kind, title: '\u2068' + x.title + '\u2069', state: x.state && has('cht_v_' + x.state) ? t('cht_v_' + x.state).toLowerCase() : x.state });
  };
  const impactHtml = (it) => {
    const m = it.impact; if (!m) return '';
    const ex = (m.examples || []).map((e) => `<div class="small muted cht-ex"><span class="cht-exn">${esc(e.name)}</span> <span>${esc(e.from || '')}</span>${icon('down', 'flip cht-arrow')}<b>${esc(e.to || '')}</b></div>`).join('');
    const line = (m.moved ? t(m.moved === 1 ? 'cht_impact_n1' : 'cht_impact_n', { n: m.moved }) : t('cht_impact_none')) + ' ' + (m.endBefore && m.endAfter && m.endBefore !== m.endAfter ? t('cht_impact_end', { a: m.endBefore, b: m.endAfter }) : t('cht_impact_same', { b: m.endAfter || m.endBefore || '' }));
    return `<div class="cht-impact small"><b>${esc(t('cht_impact_h'))}</b><div>${esc(line)}</div>${ex}</div>`;
  };
  // A suggested schedule on a card: the counts, the project end against the contract end, a bar for every task, the checks
  // against the due dates of deliverables and payments, and what no task covers yet.
  const dayN = (d) => Math.floor(Date.parse(String(d) + 'T00:00:00Z') / 864e5);
  const LRI = (d) => '\u2066' + d + '\u2069';
  function planHtml(it) {
    const p = it.plan; if (!p || !Array.isArray(p.phases)) return '';
    const a = p.start ? dayN(p.start) : 0, span = Math.max(1, (p.end ? dayN(p.end) : a) - a + 1);
    const bar = (tk) => {
      if (!tk.start || !tk.finish) return '';
      const l = Math.max(0, Math.min(99, (dayN(tk.start) - a) / span * 100));
      if (tk.milestone) return `<span class="cht-pbar" aria-hidden="true"><i class="ms ${tk.critical ? 'crit' : ''}" style="inset-inline-start:${l.toFixed(1)}%"></i></span>`;
      const w = Math.max(1.5, Math.min(100 - l, (dayN(tk.finish) - dayN(tk.start) + 1) / span * 100));
      return `<span class="cht-pbar" aria-hidden="true"><i class="${tk.critical ? 'crit' : ''}" style="inset-inline-start:${l.toFixed(1)}%;inline-size:${w.toFixed(1)}%"></i></span>`;
    };
    const c = p.counts || {};
    const counts = `<div class="cht-pcounts">${[['cht_f_phases', c.phases], ['cht_f_tasks', c.tasks], ['cht_f_milestones', c.milestones]].map(([k, n]) => `<span class="chip">${esc(t(k))} <b>${esc(String(n || 0))}</b></span>`).join('')}</div>`;
    const over = p.over_days > 0;
    const end = p.project_end ? `<div class="small ${over ? 'cht-plan-bad' : ''}" role="${over ? 'alert' : 'status'}">${esc(p.contract_end ? t(over ? 'cht_plan_end_over' : 'cht_plan_end_ok', { e: LRI(p.project_end), c: LRI(p.contract_end), d: p.over_days }) : t('cht_plan_end_only', { e: LRI(p.project_end) }))}</div>` : '';
    const dates = (p.dates || []).length ? `<div class="cht-pdates"><div class="small muted">${esc(t('cht_plan_dates_h'))}</div>${p.dates.map((d) => `<div class="cht-pdate small"><span class="cht-pdn"><bdi>${esc(d.title)}</bdi></span><span class="muted">${esc(d.due ? t('cht_plan_due', { d: LRI(d.due) }) : t('cht_plan_nodue'))}</span><span class="muted">${esc(t('cht_plan_planned', { d: LRI(d.finish) }))}</span><span class="chip ${d.late_days > 0 ? 'red' : 'green'}">${esc(d.late_days > 0 ? t(d.late_days === 1 ? 'cht_plan_late1' : 'cht_plan_late', { n: d.late_days }) : t('cht_plan_ontime'))}</span></div>`).join('')}</div>` : '';
    const u = p.uncovered || {};
    const gaps = [['cht_plan_k_del', u.deliverables], ['cht_plan_k_pay', u.payments], ['cht_plan_k_req', u.requirements]].filter((x) => x[1] > 0);
    const gap = gaps.length ? `<div class="cht-pgap small"><span class="muted">${esc(t('cht_plan_gap_h'))}</span>${gaps.map(([k, n]) => `<span class="chip amber">${esc(t(k))} <b>${esc(String(n))}</b></span>`).join('')}</div>` : '';
    const phases = `<div class="small muted cht-pph-h">${esc(t('cht_plan_phases_h'))}</div>${p.phases.map((ph) => `<details class="cht-pph"><summary><span class="cht-pph-n"><bdi>${esc(ph.name)}</bdi></span><span class="small muted">${esc(t('cht_plan_range', { a: LRI(ph.start), b: LRI(ph.finish) }))}</span></summary>${ph.tasks.map((tk) => {
      const meta = [tk.owner, tk.deliverable ? t('cht_plan_produces', { d: tk.deliverable }) : ''].filter(Boolean).join(', ');
      return `<div class="cht-ptk small"><span class="cht-ptn"><bdi>${esc(tk.name)}</bdi>${tk.milestone ? ` <span class="chip blue">${esc(t('cht_plan_ms'))}</span>` : ''}${meta ? `<span class="muted cht-ptm"><bdi>${esc(meta)}</bdi></span>` : ''}</span><span class="muted cht-ptd">${esc(tk.milestone ? tk.start : t('cht_plan_range', { a: LRI(tk.start), b: LRI(tk.finish) }))}</span>${bar(tk)}</div>`;
    }).join('')}</details>`).join('')}`;
    const score = p.score != null ? `<div class="small muted">${esc(t('cht_plan_score', { n: p.score }))}</div>` : '';
    return `<div class="cht-plan">${counts}${end}${dates}${gap}${phases}${score}<div class="small muted">${esc(t('cht_plan_legend'))}</div></div>`;
  }
  const noteText = (it) => { const n = it.noteData; if (!n) return it.note || ''; return [n.kids ? t(n.kids === 1 ? 'cht_note_kids1' : 'cht_note_kids', { n: n.kids }) : '', n.succ ? t(n.succ === 1 ? 'cht_note_succ1' : 'cht_note_succ', { n: n.succ }) : ''].filter(Boolean).join(' '); };

  const CAM_ICON = '<svg class="i" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>';
  // ---------- building the shell once ----------
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'chtRoot';
    root.innerHTML = `
      <button class="cht-fab" id="chtFab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(t('cht_open'))}" data-tip="${esc(t('cht_open'))}">${icon('chat')}</button>
      <section class="cht-panel" id="chtPanel" role="dialog" aria-modal="false" aria-labelledby="chtHead" hidden>
        <aside class="cht-threads" id="chtThreads" aria-label="${esc(t('th_threads'))}" hidden></aside>
        <div class="cht-resize" id="chtResize" role="separator" aria-orientation="vertical" aria-label="${esc(t('cht_resize'))}" data-tip="${esc(t('cht_resize'))}"></div>
        <header class="cht-head">
          <button class="btn ghost icon cht-side-btn" type="button" data-act="tside" id="chtSideBtn" aria-label="${esc(t('th_side_hide'))}" data-tip="${esc(t('th_side_hide'))}" hidden>${icon('cols')}</button>
          <div class="grow"><h2 id="chtHead">${esc(t('cht_title'))}</h2><div class="small muted cht-ctx" id="chtCtx"></div></div>
          <button class="btn ghost icon cht-full-btn" type="button" data-act="full" id="chtFullBtn" aria-label="${esc(t('th_full'))}" data-tip="${esc(t('th_full'))}">${icon('expand')}</button>
          <button class="btn ghost icon" type="button" data-act="hist" id="chtHistBtn" aria-label="${esc(t('cht_history'))}" data-tip="${esc(t('cht_history'))}">${icon('clock')}</button>
          <button class="btn ghost icon" type="button" data-act="expand" id="chtExpandBtn" aria-label="${esc(t('th_expand'))}" data-tip="${esc(t('th_expand'))}">${icon('cols')}</button>
          <button class="btn ghost icon cht-wide-btn" type="button" data-act="wide" id="chtWideBtn" aria-label="${esc(t('cht_wide'))}" data-tip="${esc(t('cht_wide'))}">${icon('expand')}</button>
          <button class="btn ghost icon" type="button" data-act="new" aria-label="${esc(t('cht_new'))}" data-tip="${esc(t('cht_new'))}">${icon('plus')}</button>
          <button class="btn ghost icon" type="button" data-act="close" aria-label="${esc(t('cht_close'))}" data-tip="${esc(t('cht_close'))}">${icon('x')}</button>
        </header>
        <div class="cht-body" id="chtBody" role="log" aria-live="polite" tabindex="0"></div>
        <footer class="cht-foot">
          <div class="cht-grip" id="chtGrip" role="separator" aria-orientation="horizontal" aria-label="${esc(t('cht_grow'))}" data-tip="${esc(t('cht_grow'))}"></div>
          <div class="cht-ctxbar small" id="chtCtxBar"></div>
          <div class="small muted cht-note" id="chtNote"></div>
          <div class="cht-box" id="chtBox">
            <div class="cht-atts small" id="chtAtts"></div>
            <div class="cht-composer">
              <button class="btn ghost icon cht-plus" id="chtPlus" type="button" data-act="plus" aria-haspopup="dialog" aria-label="${esc(t('th_plus'))}" data-tip="${esc(t('th_plus'))}">${icon('plus')}</button>
              <button class="btn ghost icon cht-attach" id="chtAttach" type="button" data-act="attach" aria-label="${esc(t('th_attach'))}" data-tip="${esc(t('th_attach_tip'))}">${icon('file')}</button>
              <input type="file" id="chtFile" multiple hidden accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv">
              <button class="btn ghost icon cht-imgbtn" id="chtImgBtn" type="button" data-act="img" aria-label="${esc(t('th_img'))}" data-tip="${esc(t('th_img_tip'))}">${icon('image')}</button>
              <input type="file" id="chtImg" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif">
              <input type="file" id="chtCam" hidden accept="image/*" capture="environment">
              <button class="btn ghost icon cht-deep" id="chtDeep" type="button" data-act="deep" aria-pressed="false" aria-label="${esc(t('th_deep'))}" data-tip="${esc(t('th_deep_tip'))}">${icon('spark')}</button>
              <button class="cht-deep-pill" id="chtDeepPill" type="button" data-act="deep" aria-label="${esc(t('th_deep_off'))}" data-tip="${esc(t('th_deep_off'))}" hidden>${icon('spark')}<span>${esc(t('th_deep'))}</span>${icon('x')}</button>
              <textarea id="chtIn" rows="1" maxlength="4000" placeholder="${esc(t('cht_ph'))}" aria-label="${esc(t('cht_ph'))}"></textarea>
              <button class="btn ghost icon cht-mic" id="chtMic" type="button" data-act="mic" aria-label="${esc(t('th_mic'))}" data-tip="${esc(t('th_mic'))}" hidden>${icon('mic')}</button>
              <button class="btn primary icon" id="chtSend" type="button" data-act="send" aria-label="${esc(t('cht_send'))}" data-tip="${esc(t('cht_send'))}">${icon('up')}</button>
            </div>
            <div class="cht-rec" id="chtRec" role="status" aria-live="polite">
              <button class="btn ghost icon" type="button" data-act="micno" aria-label="${esc(t('th_mic_no'))}" data-tip="${esc(t('th_mic_no'))}">${icon('x')}</button>
              <span class="cht-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
              <span class="cht-rec-l" id="chtRecL"></span><span class="cht-rec-t" id="chtRecT">0:00</span>
              <button class="btn primary icon" type="button" data-act="micok" aria-label="${esc(t('th_mic_ok'))}" data-tip="${esc(t('th_mic_ok'))}">${icon('check')}</button>
            </div>
          </div>
        </footer>
        <div class="cht-sheet" id="chtSheet" hidden>
          <div class="cht-sheet-bg" data-act="sheetx"></div>
          <div class="cht-sheet-card" role="dialog" aria-modal="true" aria-label="${esc(t('th_plus'))}">
            <div class="cht-sheet-grip" aria-hidden="true"></div>
            <button class="cht-sheet-i" type="button" data-act="cam">${CAM_ICON}<span class="cht-sheet-t"><b>${esc(t('th_cam'))}</b></span></button>
            <button class="cht-sheet-i" type="button" data-act="img">${icon('image')}<span class="cht-sheet-t"><b>${esc(t('th_photos'))}</b></span></button>
            <button class="cht-sheet-i" type="button" data-act="attach">${icon('file')}<span class="cht-sheet-t"><b>${esc(t('th_files'))}</b><span class="small muted">${esc(t('th_files_h'))}</span></span></button>
            <button class="cht-sheet-i" id="chtSheetDeep" type="button" data-act="deep" aria-pressed="false">${icon('spark')}<span class="cht-sheet-t"><b>${esc(t('th_deep'))}</b><span class="small muted">${esc(t('th_deep_h'))}</span></span><span class="cht-sw" aria-hidden="true"></span></button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(root);
    document.body.classList.add('chat-on');
    root.addEventListener('click', onClick);
    const inp = $q('#chtIn');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    inp.addEventListener('input', grow);
    applyWidth(); applyInputHeight(); bindResize();
    root.addEventListener('input', (e) => { if (e.target && e.target.id === 'thSearch') onSearch(e); });
    root.addEventListener('change', (e) => { if (e.target && e.target.id === 'chtFile') onFiles(e); if (e.target && (e.target.id === 'chtImg' || e.target.id === 'chtCam')) { const fl = [...(e.target.files || [])]; e.target.value = ''; addImages(fl); } });
    root.addEventListener('paste', (e) => { if (e.target && e.target.id === 'chtIn') onPaste(e); });
    root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
    root.addEventListener('drop', onDrop);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) { e.stopPropagation(); closeSheet(); $q('#chtPlus').focus(); } else if (e.key === 'Escape' && V) { e.stopPropagation(); cancelVoice(); } else if (e.key === 'Escape' && S.full) { e.stopPropagation(); exitFull(); } else if (e.key === 'Escape' && S.open && !S.page) { e.stopPropagation(); close(); } else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('cht-h-item')) { e.preventDefault(); openChat(e.target.dataset.id); } else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('th-item')) { e.preventDefault(); openThread(e.target.dataset.id); } });
  }
  // the message box grows with the text up to a cap. A person can raise the base height by dragging its top line.
  function grow() { const i = $q('#chtIn'); if (!i) return; syncHas(); const base = S.inH || 0; i.style.height = 'auto'; i.style.height = Math.max(base, Math.min(i.scrollHeight, Math.max(base, 200))) + 'px'; }
  function applyInputHeight() { const i = $q('#chtIn'); if (!i) return; i.style.minHeight = S.inH ? S.inH + 'px' : ''; i.style.maxHeight = S.inH ? Math.max(S.inH, 200) + 'px' : ''; grow(); }
  const maxWidth = () => Math.max(MIN_W, Math.min(1000, window.innerWidth - 280));
  function applyWidth() {
    S.w = Math.round(Math.max(MIN_W, Math.min(maxWidth(), S.w || DEF_W)));
    document.documentElement.style.setProperty('--chat-w', S.w + 'px');
    const b = $q('#chtWideBtn'); if (!b) return;
    const wide = S.w > DEF_W + 40, lab = t(wide ? 'cht_narrow' : 'cht_wide');
    b.innerHTML = icon(wide ? 'shrink' : 'expand'); b.setAttribute('aria-label', lab); b.dataset.tip = lab;
  }
  // a drag on a handle: the callback gets every pointer move, the end callback runs once
  function dragHandle(el, move, end) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId); S.dragging = true; document.body.classList.add('cht-dragging');
      const mv = (ev) => move(ev, e);
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); S.dragging = false; document.body.classList.remove('cht-dragging'); if (end) end(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  function bindResize() {
    const rtl = document.documentElement.dir === 'rtl';
    dragHandle($q('#chtResize'), (ev) => { S.w = rtl ? ev.clientX : window.innerWidth - ev.clientX; applyWidth(); }, () => pref('pm_chat_w', String(S.w)));
    $q('#chtResize').addEventListener('dblclick', () => { S.w = DEF_W; applyWidth(); pref('pm_chat_w', null); });
    const grip = $q('#chtGrip'); let startH = 0;
    grip.addEventListener('pointerdown', () => { startH = $q('#chtIn').offsetHeight; });
    dragHandle(grip, (ev, first) => { S.inH = Math.round(Math.max(MIN_IN, Math.min(window.innerHeight * 0.5, startH + (first.clientY - ev.clientY)))); applyInputHeight(); }, () => { if (S.inH <= MIN_IN + 2) S.inH = 0; applyInputHeight(); pref('pm_chat_inh', S.inH ? String(S.inH) : null); });
    grip.addEventListener('dblclick', () => { S.inH = 0; applyInputHeight(); pref('pm_chat_inh', null); });
  }

  // ---------- open, close, load ----------
  async function open() {
    build();
    S.open = true; keep('pm_chat_open', '1');
    $q('#chtPanel').hidden = false; $q('#chtFab').setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-open');
    requestAnimationFrame(() => $q('#chtPanel').classList.add('on'));
    await load();
    const i = $q('#chtIn'); if (i) i.focus();
  }
  function close(quiet) {
    if (!root) return;
    cancelVoice(); closeSheet(); exitFull();
    S.open = false; keep('pm_chat_open', '0');
    const p = $q('#chtPanel'); p.classList.remove('on');
    document.body.classList.remove('chat-open');
    $q('#chtFab').setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!S.open) p.hidden = true; }, 260);
    if (quiet !== true) $q('#chtFab').focus();
  }
  async function load() {
    S.ctx = ctxFromHash();
    try {
      const q = new URLSearchParams({ screen: S.ctx.screen }); if (S.ctx.projectId) q.set('project_id', S.ctx.projectId);
      const d = await PM.api('GET', '/api/chat?' + q);
      S.data = d; S.msgs = d.messages.slice(); S.loadError = ''; S.loadTries = 0;
      await loadSug();
    } catch (e) {
      // keep the conversation already on screen, show what failed with a way to try again, and try once more by itself
      if (!S.data) { S.data = { suggestions: [], capabilities: '', ai: true, can_write: true, project: null }; S.msgs = []; }
      S.loadError = e.message || t('err_network');
      if ((S.loadTries = (S.loadTries || 0) + 1) <= 2) setTimeout(() => { if (S.loadError && !S.busy) load(); }, 2500 * S.loadTries);
    }
    paint(true);
  }

  // ---------- painting ----------
  function ctxName() {
    if (!S.ctx.projectId) return t('cht_all');
    const p = (S.data && S.data.project) || (PM.state.projects || []).find((x) => x.id === S.ctx.projectId);
    return p ? p.name : t('cht_all');
  }
  // The closing "What to do" section is shown as a highlighted line so the project manager sees the action first.
  const TODO_RE = /(^|\n)\s*(?:\*\*|__)?\s*(What to do|ما يجب فعله)\s*:?\s*(?:\*\*|__)?\s*:?[ \t]*/i;
  function mdBody(text) {
    const m = TODO_RE.exec(text);
    if (!m) return `<div class="md">${PM.mdToHtml(text)}</div>`;
    const before = text.slice(0, m.index).trim(); const rest = text.slice(m.index + m[0].length).trim();
    const label = /[\u0600-\u06FF]/.test(m[2]) ? m[2] : t('cht_todo');
    return `${before ? `<div class="md">${PM.mdToHtml(before)}</div>` : ''}<div class="cht-todo" role="note"><div class="cht-todo-h">${icon('check')}<span>${esc(label)}</span></div><div class="md">${PM.mdToHtml(rest)}</div></div>`;
  }
  function msgHtml(m) {
    if (m.role === 'user') return `<div class="cht-msg user"><div class="cht-bub">${(m.thumbs || []).length ? `<div class="cht-thumbs">${m.thumbs.map((u) => `<img src="${u}" alt="">`).join('')}</div>` : ''}${esc(m.text)}</div></div>`;
    const body = m.pending && !m.text ? `<span class="cht-typing" aria-label="${esc(m.status || t('cht_thinking'))}"><i></i><i></i><i></i></span><span class="small muted">${esc(m.status || t('cht_thinking'))}</span>` : mdBody(m.text || '');
    const err = m.error ? `<div class="cht-err small" role="alert">${esc(m.error)}</div>` : '';
    const stop = m.stopped ? `<div class="small muted">${esc(t('cht_stopped'))}</div>` : '';
    const status = m.pending && m.text && m.status ? `<div class="small muted">${esc(m.status)}</div>` : '';
    const src = (m.sources || []).length ? `<div class="cht-srcs"><span class="small muted">${esc(t('cht_sources'))}</span>${m.sources.map((s) => `<a class="cht-src" href="${esc(safeHref(s.href))}" data-act="nav">${icon('link')}<span>${esc(s.label)}</span></a>`).join('')}</div>` : '';
    const links = (m.links || []).length ? `<div class="cht-srcs">${m.links.map((s) => `<a class="btn sm" href="${esc(safeHref(s.href))}" data-act="nav">${esc(s.label)}</a>`).join('')}</div>` : '';
    const card = m.card ? cardHtml(m) : '';
    const acts = !m.pending && m.id && !String(m.id).startsWith('b') && m.text ? `<div class="cht-acts"><button class="btn ghost icon sm" type="button" data-act="copy" data-id="${esc(m.id)}" aria-label="${esc(t('cht_copy'))}" data-tip="${esc(t('cht_copy'))}">${icon('copy')}</button><button class="btn ghost icon sm ${m.feedback === 1 ? 'on' : ''}" type="button" data-act="up" data-id="${esc(m.id)}" aria-pressed="${m.feedback === 1}" aria-label="${esc(t('cht_good'))}" data-tip="${esc(t('cht_good'))}">${icon('check')}</button><button class="btn ghost icon sm ${m.feedback === -1 ? 'on' : ''}" type="button" data-act="down" data-id="${esc(m.id)}" aria-pressed="${m.feedback === -1}" aria-label="${esc(t('cht_bad'))}" data-tip="${esc(t('cht_bad'))}">${icon('flag')}</button></div>` : '';
    return `<div class="cht-msg bot" data-mid="${esc(m.id)}"><div class="cht-bub">${body}${status}${err}${stop}${src}${links}</div>${card}${acts}</div>`;
  }
  // ---------- a widget made from a card is drawn right in the chat ----------
  S.wprev = S.wprev || {}; S.wstat = S.wstat || {}; S.wpack = S.wpack || {};
  const wOf = (c, ix) => (c.status !== 'pending' ? (c.widgets || []).find((w) => w.ix === ix) || null : null);
  const wkey = (m, ix, c) => { const w = wOf(c, ix); return w ? 'w' + w.id : m.id + ':' + ix; };
  function wprevHtml(m, c, ix, it) {
    const key = wkey(m, ix, c); const done = S.wprev[key];
    const g = it.widget; const wo = wOf(c, ix), st = wo ? S.wstat[wo.id] : null;
    const tag = c.status === 'pending' ? '' : `<span class="chip ${st && st.status === 'published' ? 'green' : ''}">${esc(t(st && st.status === 'published' ? 'cht_wp_done' : 'cht_wp_draft'))}</span>`;
    if (!done) queueMicrotask(() => fillWidget(m.id, ix));
    return `<div class="cht-wprev" data-wkey="${esc(key)}" data-m="${esc(m.id)}" data-ix="${ix}"><div class="cht-wp-h"><b>${esc(g.title)}</b>${tag}</div><div class="cht-wp-b">${done || `<div class="small muted">${esc(t('cht_wp_loading'))}</div>`}</div></div>`;
  }
  function wfootHtml(w) {
    const st = S.wstat[w.id]; const pub = st && st.status === 'published';
    const btn = pub && !st.dirty ? `<span class="chip green">${esc(t('cht_wp_done'))}</span>` : `<button class="btn sm" type="button" data-act="wpub" data-id="${w.id}">${esc(t(pub ? 'cht_wp_upd' : 'cht_wp_pub'))}</button>`;
    return `<a class="btn primary sm" href="#/widgets/${w.id}/edit" data-act="nav">${icon('edit')}${esc(t('cht_wp_edit'))}</a>${btn}`;
  }
  async function fillWidget(mid, ix) {
    const msg = S.msgs.find((x) => String(x.id) === String(mid)); const c = msg && msg.card; const it = c && c.items[ix]; if (!it || !it.widget) return;
    const key = wkey(msg, ix, c); if (S.wprev[key] || S.wbusy === key) return; S.wbusy = key;
    try {
      let g = it.widget; const w = wOf(c, ix);
      if (w) { const r = (await PM.api('GET', `/api/widgets/${w.id}`)).widget; g = { title: r.title, spec: r.spec }; S.wstat[w.id] = { status: r.status, dirty: !!r.dirty }; }
      const pid = (c.projects[0] || {}).id || S.ctx.projectId || '';
      if (!S.wpack[pid]) { const r = await PM.api('GET', `/api/widgets/datasets${pid ? `?project_id=${pid}` : ''}`); S.wpack[pid] = { datasets: r.datasets, today: r.today, truncated: r.truncated || {} }; }
      const holder = document.createElement('div');
      PM.widgets.renderSpec(holder, { title: g.title, spec: g.spec }, S.wpack[pid], {}, { limit: true });
      S.wprev[key] = holder.innerHTML;
    } catch (e) { S.wprev[key] = `<div class="small muted">${esc(t('cht_wp_fail'))}</div>`; }
    finally { S.wbusy = null; }
    soon();
  }
  async function wPublish(id, el) {
    if (el.disabled) return; el.disabled = true;
    try {
      const r = (await PM.api('GET', `/api/widgets/${id}`)).widget; const upd = r.status === 'published';
      const ok = await PM.confirmDlg({ title: t(upd ? 'wm_publish_update' : 'wm_publish'), message: esc(t('wm_publish_msg', { title: r.title })), ok: t(upd ? 'wm_publish_update' : 'wm_publish') });
      if (!ok) return;
      await PM.api('POST', `/api/widgets/${id}/publish`);
      S.wstat[id] = { status: 'published', dirty: false }; PM.toast(t('cht_wp_ok', { title: r.title }), 'ok'); soon();
    } catch (e) { PM.toast(e.message || t('cht_wp_fail'), 'err'); }
    finally { el.disabled = false; }
  }
  // A card names the projects it touches. A document that covers the whole portfolio touches none, so the card says All projects.
  const cardScope = (c) => ((c.projects || []).length ? c.projects.map((p) => p.name).join(', ') : c.items.some((x) => x.sum && x.sum.op === 'generate') ? t('cht_all') : '');
  // A draft document made in All projects. Save to project is on when the document has a related project and off when it covers the portfolio.
  function draftBtns(m, d) {
    const mid = esc(m.id), at = `data-id="${mid}" data-ix="${d.ix}"`;
    const open = `<button class="btn primary sm" type="button" data-act="dropen" ${at}>${icon('eye')}${esc(t('cht_doc_open'))}</button><button class="btn sm" type="button" data-act="drdl" ${at}>${icon('dl')}${esc(t('cht_doc_dl'))}</button>`;
    if (d.saved) return `${open}<a class="btn sm" href="#/p/${d.saved.project_id}/reports" data-act="nav">${esc(t('cht_dr_open_rep'))}</a>`;
    if (d.related_project_id) return `${open}<button class="btn sm" type="button" data-act="drsave" ${at}>${icon('check')}${esc(t('cht_dr_save_to', { p: d.related_project || '' }))}</button>`;
    return `${open}<button class="btn sm" type="button" aria-disabled="true" disabled data-tip="${esc(t('cht_dr_portfolio'))}">${icon('check')}${esc(t('cht_dr_save'))}</button>`;
  }
  const draftNote = (d) => `<div class="cht-draft-note small muted" role="note"><span class="chip ${d.saved ? 'green' : ''}">${esc(d.saved ? t('cht_dr_saved', { p: d.saved.project }) : t('cht_dr_draft'))}</span> ${esc(d.saved ? '' : d.related_project_id ? t('cht_dr_ready', { p: d.related_project || '' }) : t('cht_dr_portfolio'))}</div>`;
  function cardHtml(m) {
    const c = m.card; const id = esc(m.id);
    const live = c.status === 'pending';
    const confirming = S.confirming === m.id && live;
    const items = c.items.map((it, ix) => `<li class="cht-item ${it.destructive ? 'bad' : ''}"><div class="cht-it-h">${esc(sumText(it))}</div>${it.widget ? wprevHtml(m, c, ix, it) : ''}${it.project && (c.projects || []).length > 1 ? `<div class="small muted">${esc(it.project)}</div>` : ''}${(it.changes || []).filter((ch) => !it.plan || ch.field === 'reason').map((ch) => `<div class="cht-chg small"><span class="muted">${esc(fieldLabel(ch.field))}</span> ${ch.before != null ? `<span class="cht-old">${esc(valText(ch.before, ch.field))}</span><span class="muted">${icon('down', 'flip cht-arrow')}</span>` : ''}${ch.after != null ? `<b class="cht-new">${esc(valText(ch.after, ch.field))}</b>` : `<b class="cht-new">${esc(t('cht_none'))}</b>`}</div>`).join('')}${planHtml(it)}${impactHtml(it)}${noteText(it) ? `<div class="small muted">${esc(noteText(it))}</div>` : ''}</li>`).join('');
    const state = live ? '' : `<span class="chip ${c.status === 'applied' || c.status === 'applied_final' ? 'green' : c.status === 'failed' ? 'red' : c.status === 'undone' ? 'blue' : ''}">${esc(t('cht_s_' + c.status))}</span>`;
    const msg = c.message ? `<div class="small ${c.status === 'failed' ? 'cht-err' : 'muted'}" role="${c.status === 'failed' ? 'alert' : 'status'}">${esc(c.message)}</div>` : '';
    let foot = '';
    if (c.busy === 'apply' || c.busy === 'undo') foot = `<div class="cht-card-foot cht-busy small" role="status">${PM.loader.html({ size: 'sm', label: t(c.busy === 'undo' ? 'cht_s_undoing' : 'cht_s_applying') })}<span>${esc(t(c.busy === 'undo' ? 'cht_s_undoing' : 'cht_s_applying'))}</span></div>`;
    else if (live && !confirming) foot = `<div class="cht-card-foot"><button class="btn primary sm" type="button" data-act="apply" data-id="${id}">${esc(t('cht_apply'))}</button><button class="btn sm" type="button" data-act="edit" data-id="${id}">${esc(t('cht_edit'))}</button><button class="btn ghost sm" type="button" data-act="cancel" data-id="${id}">${esc(t('cht_cancel'))}</button></div>`;
    else if (confirming) foot = `<div class="cht-warn small" role="alert">${esc(c.items.some((x) => x.destructive) ? t('cht_strong') : t('cht_many'))}</div><div class="cht-card-foot"><button class="btn danger sm" type="button" data-act="confirm" data-id="${id}">${esc(t('cht_yes'))}</button><button class="btn ghost sm" type="button" data-act="back" data-id="${id}">${esc(t('cht_back'))}</button></div>`;
    else if (c.status === 'applied') foot = `<div class="cht-card-foot">${(c.widgets || []).length > 1 ? `<a class="btn primary sm" href="#/widgets?tab=mine" data-act="nav">${icon('grid')}${esc(t('cht_wp_all', { n: c.widgets.length }))}</a>` : (c.widgets || []).map(wfootHtml).join('')}${(c.drafts || []).map((d) => draftBtns(m, d)).join('')}${(c.docs || []).map((d) => `<button class="btn primary sm" type="button" data-act="docopen" data-id="${d.id}">${icon('eye')}${esc(t('cht_doc_open'))}</button><button class="btn sm" type="button" data-act="docdl" data-id="${d.id}">${icon('dl')}${esc(t('cht_doc_dl'))}</button>`).join('')}${!(c.docs || []).length && !(c.drafts || []).length && (c.projects || []).length && c.items.some((x) => x.sum && x.sum.op === 'generate') ? `<a class="btn primary sm" href="#/p/${(c.projects[0] || {}).id}/reports" data-act="nav">${esc(t('cht_open_reports'))}</a>` : ''}${(c.projects || []).length && c.items.some((x) => x.sum && x.sum.op === 'new_schedule') ? `<a class="btn primary sm" href="#/p/${(c.projects[0] || {}).id}/schedule" data-act="nav">${esc(t('cht_open_schedule'))}</a>` : ''}<button class="btn sm" type="button" data-act="undo" data-id="${id}">${icon('undo')}${esc(t('cht_undo'))}</button></div>${(c.drafts || []).map(draftNote).join('')}`;
    return `<div class="cht-card ${live ? 'live' : ''}" data-card="${id}"><div class="cht-card-h"><span class="small muted">${icon('spark')}${esc(cardScope(c))}</span>${state}</div><ul class="cht-items">${items}</ul>${msg}${foot}</div>`;
  }
  function emptyHtml() {
    const d = S.data || {};
    const starters = (d.starters || []).length ? `<div class="cht-starters"><div class="small muted">${esc(t('th_start'))}</div><div class="cht-starter-grid">${d.starters.map((x) => `<button class="cht-starter" type="button" data-act="sug" data-q="${esc(x.q)}"><span class="cht-starter-ic">${icon('spark')}</span><span>${esc(x.label)}</span></button>`).join('')}</div></div>` : '';
    const sug = (d.suggestions || []).map((s) => `<button class="btn sm cht-sug" type="button" data-act="sug" data-q="${esc(s)}">${esc(s)}</button>`).join('');
    const b = d.brief || [];
    const brief = d.brief ? `<div class="cht-brief"><div class="small muted">${esc(t('cht_brief_h'))}</div>${b.length ? b.map((x) => `<button class="cht-tile" type="button" data-act="sug" data-q="${esc(t('cht_q_' + x.key))}"><b>${esc(String(x.n))}</b><span>${esc(t('cht_b_' + x.key, { n: '' }).trim())}</span></button>`).join('') : `<div class="small muted">${esc(t('cht_brief_clear'))}</div>`}</div>` : '';
    return `<div class="cht-empty"><div class="cht-empty-ic">${icon('spark')}</div><h3>${esc(t('cht_empty_title'))}</h3><p class="muted cht-caps">${esc(d.capabilities || '')}</p>${S.loadError ? `<p class="cht-err small" role="alert">${esc(S.loadError)} <button class="btn sm" type="button" data-act="reload">${esc(t('fly_retry'))}</button></p>` : ''}${proact()}${brief}${starters}${sug ? `<div class="small muted cht-quick">${esc(t('th_quick'))}</div>` : ''}<div class="cht-sugs">${sug}</div></div>`;
  }
  const when = (x) => { try { return new Date(x).toLocaleString(PM.state.lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } };
  function historyHtml() {
    const H = S.hist || {};
    if (H.items == null) return `<div class="cht-h-wait">${PM.skeleton.list(4)}</div>`;
    if (H.error) return `<div class="cht-empty"><p class="cht-err small" role="alert">${esc(H.error)} <button class="btn sm" type="button" data-act="hreload">${esc(t('fly_retry'))}</button></p></div>`;
    if (!H.items.length) return `<div class="cht-empty"><div class="cht-empty-ic">${icon('clock')}</div><p class="muted">${esc(t('cht_hist_empty'))}</p></div>`;
    return `<div class="cht-h-list">${H.items.map((x) => {
      const sure = H.confirm === x.id;
      const end = sure
        ? `<button class="btn danger sm" type="button" data-act="hdel2" data-id="${x.id}">${esc(t('cht_hist_sure'))}</button><button class="btn ghost sm" type="button" data-act="hkeep">${esc(t('cht_back'))}</button>`
        : `<button class="btn ghost icon sm" type="button" data-act="hdel" data-id="${x.id}" aria-label="${esc(t('cht_hist_del'))}" data-tip="${esc(t('cht_hist_del'))}">${icon('trash')}</button>`;
      return `<div class="cht-h-item ${x.current ? 'cur' : ''}" role="button" tabindex="0" data-act="hopen" data-id="${x.id}"><div class="cht-h-body"><div class="cht-h-t" dir="auto">${esc(x.title || t('cht_untitled'))}</div><div class="small muted">${esc(when(x.updated_at))} · ${esc(t('cht_hist_msgs', { n: x.messages }))}${x.current ? ` <span class="chip blue">${esc(t('cht_hist_now'))}</span>` : ''}</div></div>${end}</div>`;
    }).join('')}</div>`;
  }
  // the header names the open thread on the full page, like the Claude app
  function headTitle(hist) {
    const h = $q('#chtHead'); if (!h) return;
    const cur = S.page && !hist && S.msgs.length ? (S.th.items || []).find((x) => x.current && x.title) : null;
    h.textContent = cur ? cur.title : t(hist ? 'cht_history' : 'cht_title');
    if (cur) h.setAttribute('dir', 'auto'); else h.removeAttribute('dir');
  }
  function paint(toEnd) {
    if (!root) return;
    $q('#chtCtx').textContent = ctxName();
    paintShell();
    const hist = S.mode === 'history' && (!S.page || window.matchMedia('(max-width: 820px)').matches);
    root.classList.toggle('hist', hist);
    headTitle(hist);
    const hb = $q('#chtHistBtn'); const hl = t(hist ? 'cht_hist_back' : 'cht_history');
    hb.innerHTML = icon(hist ? 'back' : 'clock'); hb.setAttribute('aria-label', hl); hb.dataset.tip = hl; hb.classList.toggle('on', hist);
    const body = $q('#chtBody');
    if (hist) { body.innerHTML = historyHtml(); return; }
    const near = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    body.innerHTML = S.msgs.length ? S.msgs.map(msgHtml).join('') : emptyHtml();
    // the empty state starts at its title, a conversation starts at its latest message
    if (!S.msgs.length) body.scrollTop = 0; else if (toEnd || near) body.scrollTop = body.scrollHeight;
    const d = S.data || {};
    const note = d.can_write === false ? t('cht_view_only') : (d.remaining_today != null && d.remaining_today <= 20 ? t('cht_left', { n: d.remaining_today }) : '');
    $q('#chtNote').textContent = note; $q('#chtNote').hidden = !note;
    const send = $q('#chtSend');
    send.innerHTML = icon(S.busy ? 'x' : 'up'); send.dataset.act = S.busy ? 'stop' : 'send';
    const bx = $q('#chtBox'); if (bx) bx.classList.toggle('busy', !!S.busy);
    const mic = $q('#chtMic'); if (mic) { mic.hidden = !micOk(); mic.disabled = !!S.busy; }
    syncHas();
    const lab = S.busy ? t('cht_stop') : t('cht_send'); send.setAttribute('aria-label', lab); send.dataset.tip = lab;
  }

  // the parts of the panel that depend on the page mode, the context and the Think deeper switch
  function paintShell() {
    root.classList.toggle('page', S.page);
    const pnl = $q('#chtPanel'); if (pnl) pnl.classList.toggle('page', S.page);
    paintAtts();
    const ex = $q('#chtExpandBtn');
    if (ex) { const lab = t(S.page ? 'th_collapse' : 'th_expand'); ex.dataset.act = S.page ? 'collapse' : 'expand'; ex.innerHTML = icon(S.page ? 'shrink' : 'cols'); ex.setAttribute('aria-label', lab); ex.dataset.tip = lab; }
    const narrow = window.matchMedia('(max-width: 820px)').matches;
    const hb = $q('#chtHistBtn'); if (hb) hb.hidden = S.page && !narrow;
    const wb = $q('#chtWideBtn'); if (wb) wb.hidden = S.page;
    const cl = root.querySelector('[data-act="close"]'); if (cl) cl.hidden = S.page;
    const th = $q('#chtThreads'); if (th) { th.hidden = !S.page || !S.side; if (S.page) th.innerHTML = threadsHtml(); }
    if (pnl) pnl.classList.toggle('side-off', S.page && !S.side);
    const sb = $q('#chtSideBtn'); if (sb) { sb.hidden = !S.page || narrow; const sl = t(S.side ? 'th_side_hide' : 'th_side_show'); sb.setAttribute('aria-label', sl); sb.dataset.tip = sl; sb.setAttribute('aria-pressed', String(S.side)); }
    const cb = $q('#chtCtxBar');
    if (cb) {
      const chips = S.ctx.projectId ? [ctxName(), t('th_ctx_data'), t('th_ctx_docs')] : [t('th_ctx_portfolio')];
      cb.innerHTML = `<span class="muted">${esc(t('th_sees'))}</span>${chips.map((c) => `<span class="chip gray">${esc(c)}</span>`).join('')}`;
    }
    paintFull();
    const pill = $q('#chtDeepPill'); if (pill) pill.hidden = !S.deep;
    const sd = $q('#chtSheetDeep'); if (sd) { sd.classList.toggle('on', S.deep); sd.setAttribute('aria-pressed', String(S.deep)); }
    const dp = $q('#chtDeep'); if (dp) { dp.classList.toggle('on', S.deep); dp.setAttribute('aria-pressed', String(S.deep)); dp.dataset.tip = t(S.deep ? 'th_deep_on' : 'th_deep') + '. ' + t('th_deep_tip'); }
  }

  // ---------- the full page workspace ----------
  const isPage = () => /^#\/(thinking|p\/\d+\/thinking)(\/|\?|$)/.test(String(location.hash || ''));
  let hostObs = null;
  // The panel is drawn over the page's own empty host, so it fills the space beside the side menu and the project header.
  function place() {
    if (!root || !S.page) return;
    if (S.full) return fitFull();
    const host = document.getElementById('thHost'); if (!host) return;
    const r = host.getBoundingClientRect();
    // on a phone the chat uses the whole width and the space above the keyboard, like a messaging app
    const phone = window.matchMedia('(max-width: 600px)').matches;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const h = phone ? Math.max(280, vh - r.top) : Math.max(360, window.innerHeight - r.top - 16);
    host.style.height = h + 'px';
    const p = $q('#chtPanel');
    p.style.top = r.top + 'px'; p.style.left = (phone ? 0 : r.left) + 'px'; p.style.width = (phone ? document.documentElement.clientWidth : r.width) + 'px'; p.style.height = h + 'px';
  }
  async function mountPage() {
    if (!root) { build(); bindFab(); }
    if (!root.isConnected) document.body.appendChild(root);
    const c = ctxFromHash();
    const again = S.page && S.data && c.projectId === S.ctx.projectId;
    S.page = true; S.open = true; S.ctx = c; S.mode = 'chat'; S.hist = null;
    document.body.classList.add('chat-page'); document.body.classList.remove('chat-open');
    const p = $q('#chtPanel'); p.hidden = false; p.classList.add('on');
    place();
    if (hostObs) hostObs.disconnect();
    const host = document.getElementById('thHost');
    if (host && window.ResizeObserver) { hostObs = new ResizeObserver(() => place()); hostObs.observe(host.parentElement || host); }
    if (again) { paint(); } else { await Promise.all([load(), loadThreads()]); }
    place();
  }
  function unmountPage() {
    if (!S.page || !root) return;
    cancelVoice(); closeSheet(); exitFull();
    S.page = false; S.open = false;
    if (hostObs) { hostObs.disconnect(); hostObs = null; }
    document.body.classList.remove('chat-page');
    const p = $q('#chtPanel'); p.classList.remove('on', 'page'); p.hidden = true;
    ['top', 'left', 'width', 'height'].forEach((k) => { p.style[k] = ''; });
    paint();
  }
  // ---------- the thread list of the workspace ----------
  async function loadThreads() {
    try {
      const q = new URLSearchParams(); if (S.ctx.projectId) q.set('project_id', S.ctx.projectId); if (S.th.q) q.set('q', S.th.q);
      S.th.items = (await PM.api('GET', '/api/chat/history?' + q)).items; S.th.error = '';
    } catch (e) { S.th.items = S.th.items || []; S.th.error = t('cht_hist_fail'); if (!S.th.retried) { S.th.retried = true; setTimeout(() => { S.th.retried = false; if (S.th.error) loadThreads(); }, 3000); } }
    if (S.page) { const th = $q('#chtThreads'); if (th && !th.contains(document.activeElement)) th.innerHTML = threadsHtml(); else if (th) { const l = th.querySelector('.th-list'); if (l) l.innerHTML = threadRows(); } headTitle(S.mode === 'history'); }
  }
  function threadRows() {
    const T = S.th; const items = T.items || [];
    if (T.items == null) return `<div class="cht-h-wait">${PM.skeleton.list(4)}</div>`;
    if (T.error && !items.length) return `<div class="small muted th-none" role="alert">${esc(T.error)} <button class="btn sm" type="button" data-act="treload">${esc(t('fly_retry'))}</button></div>`;
    if (!items.length) return `<div class="small muted th-none">${esc(T.q ? t('th_no_match') : t('cht_hist_empty'))}</div>`;
    const row = (x) => {
      const sure = T.confirm === x.id;
      const end = sure
        ? `<button class="btn danger sm" type="button" data-act="tdel2" data-id="${x.id}">${esc(t('cht_hist_sure'))}</button><button class="btn ghost sm" type="button" data-act="tkeep">${esc(t('cht_back'))}</button>`
        : `<button class="btn ghost icon sm ${x.pinned ? 'on' : ''}" type="button" data-act="tpin" data-id="${x.id}" aria-pressed="${!!x.pinned}" aria-label="${esc(t(x.pinned ? 'th_unpin' : 'th_pin'))}" data-tip="${esc(t(x.pinned ? 'th_unpin' : 'th_pin'))}">${icon('pin')}</button><button class="btn ghost icon sm" type="button" data-act="tren" data-id="${x.id}" aria-label="${esc(t('th_rename'))}" data-tip="${esc(t('th_rename'))}">${icon('edit')}</button><button class="btn ghost icon sm" type="button" data-act="tdel" data-id="${x.id}" aria-label="${esc(t('cht_hist_del'))}" data-tip="${esc(t('cht_hist_del'))}">${icon('trash')}</button>`;
      return `<div class="th-item ${x.current ? 'cur' : ''} ${sure ? 'sure' : ''}" role="button" tabindex="0" data-act="topen" data-id="${x.id}" ${x.current ? 'aria-current="true"' : ''}><div class="th-body"><div class="th-t" dir="auto" title="${esc(when(x.updated_at) + ' · ' + t('cht_hist_msgs', { n: x.messages }))}">${esc(x.title || t('cht_untitled'))}</div></div><div class="th-end">${end}</div></div>`;
    };
    // like the Claude app: pinned threads first, then the rest grouped by how recently they were used
    const day = 86400000; const now = new Date(); const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const bucket = (x) => { if (x.pinned) return 'pin'; const d = new Date(x.updated_at).getTime(); if (!d || d >= t0) return 'today'; if (d >= t0 - day) return 'yest'; if (d >= t0 - 7 * day) return 'week'; return 'older'; };
    const names = { pin: 'th_pinned', today: 'th_g_today', yest: 'th_g_yest', week: 'th_g_week', older: 'th_g_older' };
    const groups = { pin: [], today: [], yest: [], week: [], older: [] };
    items.forEach((x) => groups[bucket(x)].push(x));
    return Object.keys(groups).filter((k) => groups[k].length).map((k) => `<div class="th-group" role="group" aria-label="${esc(t(names[k]))}"><div class="th-gh">${esc(t(names[k]))}</div>${groups[k].map(row).join('')}</div>`).join('');
  }
  function threadsHtml() {
    return `<div class="th-head"><h3>${esc(t('th_threads'))}</h3><button class="btn primary sm" type="button" data-act="tnew">${icon('plus')}${esc(t('th_new'))}</button></div><label class="th-search">${icon('search')}<input type="search" id="thSearch" value="${esc(S.th.q || '')}" placeholder="${esc(t('th_search'))}" aria-label="${esc(t('th_search'))}"></label><div class="th-list">${threadRows()}</div>`;
  }
  let searchTimer = 0;
  function onSearch(e) { S.th.q = e.target.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(loadThreads, 250); }
  async function openThread(id) {
    const it = (S.th.items || []).find((x) => String(x.id) === String(id)); if (!it || S.busy) return;
    if (it.current) return;
    try { await PM.api('POST', `/api/chat/threads/${id}/open`, {}); await Promise.all([load(), loadThreads()]); }
    catch (e) { PM.toast(e.message, 'err'); }
  }
  async function pinThread(id) {
    const it = (S.th.items || []).find((x) => String(x.id) === String(id)); if (!it) return;
    try { await PM.api('POST', `/api/chat/threads/${id}/update`, { pinned: !it.pinned }); await loadThreads(); }
    catch (e) { PM.toast(e.message, 'err'); }
  }
  function renameThread(id) {
    const it = (S.th.items || []).find((x) => String(x.id) === String(id)); if (!it) return;
    const m = PM.modal({ title: t('th_rename_title'), size: 'sm', body: `<label class="f">${esc(t('th_name_ph'))}<input type="text" id="thName" maxlength="90" value="${esc(it.title || '')}" placeholder="${esc(t('th_name_ph'))}"></label>`, footer: `<button class="btn" data-close>${esc(t('th_cancel'))}</button><button class="btn primary" id="thSave">${esc(t('th_save'))}</button>` });
    const inp = m.$('#thName'); inp.focus(); inp.select();
    const go = async () => { try { await PM.api('POST', `/api/chat/threads/${id}/update`, { title: inp.value }); m.close(); PM.toast(t('th_renamed'), 'ok'); await loadThreads(); } catch (e) { PM.toast(e.message, 'err'); } };
    m.$('#thSave').onclick = go; inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  async function deleteThread(id) {
    const it = (S.th.items || []).find((x) => String(x.id) === String(id));
    try {
      await PM.api('DELETE', `/api/chat/threads/${id}`);
      S.th.confirm = null; PM.toast(t('cht_hist_deleted'), 'ok');
      if (it && it.current) { S.msgs = []; await load(); }
      await loadThreads();
    } catch (e) { PM.toast(e.message, 'err'); }
  }

  const soon = () => { if (S.raf) return; S.raf = requestAnimationFrame(() => { S.raf = 0; paint(); }); };

  // ---------- full screen: the chat covers the whole browser view ----------
  // The chat is drawn as an overlay over the whole browser window. The browser's own full screen mode is not used.
  function fitFull() {
    const p = $q('#chtPanel'); if (!p || !S.full) return;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    p.style.top = '0px'; p.style.left = '0px'; p.style.width = document.documentElement.clientWidth + 'px'; p.style.height = vh + 'px';
  }
  function paintFull() {
    const p = $q('#chtPanel'); if (p) p.classList.toggle('full', !!S.full);
    document.body.classList.toggle('chat-full', !!S.full);
    const b = $q('#chtFullBtn'); if (!b) return;
    const lab = t(S.full ? 'th_full_off' : 'th_full');
    b.innerHTML = icon(S.full ? 'shrink' : 'expand'); b.setAttribute('aria-label', lab); b.dataset.tip = lab; b.classList.toggle('on', !!S.full);
  }
  function enterFull() {
    if (S.full) return;
    S.full = true; paintFull(); fitFull();
  }
  function exitFull() {
    if (!S.full) return;
    S.full = false; paintFull();
    const p = $q('#chtPanel'); if (p) { if (S.page) place(); else { ['top', 'left', 'width', 'height'].forEach((k) => { p.style[k] = ''; }); } }
    grow();
  }

  // ---------- the plus menu, shown as a bottom sheet on a phone ----------
  const sheetOpen = () => { const e = $q('#chtSheet'); return !!e && !e.hidden; };
  function openSheet() {
    const e = $q('#chtSheet'); if (!e || V) return;
    e.hidden = false; requestAnimationFrame(() => e.classList.add('on'));
    const b = $q('#chtPlus'); if (b) b.setAttribute('aria-expanded', 'true');
    const f = e.querySelector('.cht-sheet-i'); if (f) f.focus();
  }
  function closeSheet() {
    const e = $q('#chtSheet'); if (!e || e.hidden) return;
    e.classList.remove('on'); e.hidden = true;
    const b = $q('#chtPlus'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  // the send button and the mic button swap places like in the Claude app: text or an image shows Send, an empty box shows the mic
  function syncHas() {
    const box = $q('#chtBox'), i = $q('#chtIn'); if (!box || !i) return;
    box.classList.toggle('has', !!(i.value.trim() || (S.imgs || []).length));
  }

  // ---------- voice input ----------
  // The browser's own speech recognition is used when there is one, so words appear while the person speaks. Without it a short
  // recording is sent to the server, which turns it into text. The words land in the message box and nothing is sent by itself.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const micOk = () => !!SR || (canRecord() && !!(S.data && S.data.dictation));
  const mmss = (ms) => { const n = Math.floor(ms / 1000); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
  let V = null;
  function recPaint() {
    const box = $q('#chtBox'); if (!box) return;
    box.classList.toggle('rec', !!V); box.classList.toggle('wait', !!(V && V.busy));
    const l = $q('#chtRecL'), tm = $q('#chtRecT'), i = $q('#chtIn');
    if (l) l.textContent = V ? t(V.busy ? 'th_transcribing' : 'th_listening') : '';
    if (tm) tm.textContent = V ? mmss(Date.now() - V.t0) : '0:00';
    if (i) i.readOnly = !!(V && V.busy);
  }
  function showVoiceText(interim) {
    const i = $q('#chtIn'); if (!i || !V) return;
    const lead = V.base ? V.base.replace(/\s+$/, '') + ' ' : '';
    i.value = (lead + V.text + (interim ? (V.text ? ' ' : '') + interim.trim() : '')).slice(0, 4000);
    grow(); i.scrollTop = i.scrollHeight;
  }
  function endVoice() {
    if (!V) return;
    clearInterval(V.timer); clearTimeout(V.limit);
    if (V.stream) V.stream.getTracks().forEach((x) => { try { x.stop(); } catch (e) { /* already stopped */ } });
    V = null; recPaint(); syncHas();
  }
  // a hard stop: the text goes back to what it was
  function cancelVoice() {
    if (!V) return;
    const v = V; v.cancelled = true;
    try { if (v.sr) { v.sr.onend = null; v.sr.abort(); } if (v.mr && v.mr.state !== 'inactive') v.mr.stop(); } catch (e) { /* already stopped */ }
    const i = $q('#chtIn'); if (i) { i.value = v.base; grow(); }
    endVoice();
  }
  function finishVoice() { const i = $q('#chtIn'); endVoice(); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) { /* not focusable */ } } }
  function confirmVoice() {
    if (!V || V.busy) return;
    V.stopping = true;
    try { if (V.sr) V.sr.stop(); else if (V.mr && V.mr.state !== 'inactive') V.mr.stop(); else finishVoice(); } catch (e) { finishVoice(); }
  }
  function startSR() {
    const r = new SR(); V.sr = r; const born = Date.now(); let got = false;
    r.lang = PM.state.lang === 'ar' ? 'ar-SA' : 'en-US'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) { const x = e.results[k]; if (x.isFinal) V.text += (V.text ? ' ' : '') + x[0].transcript.trim(); else interim += x[0].transcript; }
      got = true; showVoiceText(interim);
    };
    r.onerror = (e) => { if (V && V.sr === r) V.err = e.error; };
    r.onend = () => {
      if (!V || V.sr !== r) return;
      const err = V.err; V.err = null;
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') { cancelVoice(); PM.toast(t('th_mic_blocked'), 'err'); return; }
      if (err && err !== 'no-speech' && err !== 'aborted') {
        // the browser service failed. Fall back to a recording the server can read.
        if (S.data && S.data.dictation && canRecord()) { V.sr = null; startMR(); return; }
        cancelVoice(); PM.toast(t('th_mic_fail'), 'err'); return;
      }
      if (V.stopping) return finishVoice();
      // the browser ends a session after a pause, so listen again until the person is done
      V.quick = Date.now() - born < 700 && !got ? (V.quick || 0) + 1 : 0;
      if (V.quick >= 3) { const none = !V.text; cancelVoice(); if (none) PM.toast(t('th_mic_none'), 'err'); return; }
      try { startSR(); } catch (x) { finishVoice(); }
    };
    r.start();
  }
  async function startMR() {
    const v = V;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (V !== v) { stream.getTracks().forEach((x) => x.stop()); return; }
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mime = types.find((x) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || '';
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
      v.mr = rec; v.stream = stream; v.chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) v.chunks.push(e.data); };
      rec.onstop = () => mrDone(v, rec.mimeType || mime || 'audio/webm');
      rec.start();
      v.limit = setTimeout(() => { if (V === v) confirmVoice(); }, 110000);
    } catch (e) { if (V === v) { cancelVoice(); PM.toast(t('th_mic_blocked'), 'err'); } }
  }
  async function mrDone(v, mime) {
    if (v.stream) v.stream.getTracks().forEach((x) => { try { x.stop(); } catch (e) { /* already stopped */ } });
    if (v.cancelled || V !== v) return;
    const blob = new Blob(v.chunks, { type: mime });
    if (!blob.size) { cancelVoice(); PM.toast(t('th_mic_none'), 'err'); return; }
    if (blob.size > 3 * 1024 * 1024) { cancelVoice(); PM.toast(t('th_mic_long'), 'err'); return; }
    v.busy = true; recPaint();
    try {
      const audio = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob); });
      const r = await PM.api('POST', '/api/chat/dictate', { audio, mime, language: PM.state.lang === 'ar' ? 'ar' : 'en' });
      if (V !== v) return;
      v.text = String(r.text || '').trim(); showVoiceText('');
      finishVoice();
    } catch (e) {
      if (V !== v) return;
      cancelVoice(); PM.toast(e.status === 402 || e.status === 413 || e.status === 429 || e.status === 422 ? e.message : t('th_mic_fail'), 'err');
    }
  }
  async function startVoice() {
    if (V || S.busy) return;
    if (!micOk()) return PM.toast(t('th_mic_fail'), 'err');
    closeSheet();
    const i = $q('#chtIn');
    V = { t0: Date.now(), base: i ? i.value : '', text: '', busy: false };
    V.timer = setInterval(recPaint, 500); recPaint();
    try { if (SR) startSR(); else await startMR(); } catch (e) { cancelVoice(); PM.toast(t('th_mic_blocked'), 'err'); }
  }

  // ---------- attachments ----------
  function paintAtts() {
    const box = $q('#chtAtts'); if (!box) return;
    if (S.att.length && S.attPid !== S.ctx.projectId) S.att = [];
    const imgs = (S.imgs || []).map((a, i) => `<span class="cht-att img"><img src="${a.thumb}" alt=""><button class="btn ghost icon" type="button" data-act="imgrm" data-i="${i}" aria-label="${esc(t('th_img_rm'))}" data-tip="${esc(t('th_img_rm'))}">${icon('x')}</button></span>`).join('');
    box.innerHTML = imgs + S.att.map((a) => `<span class="cht-att"><span class="cht-att-n">${esc(a.filename)}</span><button class="btn ghost icon" type="button" data-act="attrm" data-id="${a.id}" aria-label="${esc(t('th_att_rm'))}" data-tip="${esc(t('th_att_rm'))}">${icon('x')}</button></span>`).join('') + (S.upl ? `<span class="muted">${esc(t('th_uploading'))}</span>` : '');
    const b = $q('#chtAttach'); if (b) b.disabled = S.upl || S.busy;
    syncHas();
  }
  async function onFiles(e) {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length) return;
    if (!S.ctx.projectId) return PM.toast(t('th_attach_need'), 'err');
    S.upl = true; paintAtts();
    try {
      const fd = new FormData(); fd.append('purpose', 'store'); files.forEach((f) => fd.append('files', f));
      const r = await PM.api('POST', `/api/projects/${S.ctx.projectId}/documents`, fd);
      S.attPid = S.ctx.projectId;
      for (const x of (r.results || [])) { if (x.handled === 'failed' || x.error) PM.toast(`${x.filename}: ${x.error || t('th_attach_fail')}`, 'err'); if (x.id && x.handled !== 'failed') S.att.push({ id: x.id, filename: x.filename }); }
    } catch (x) { PM.toast(x.message || t('th_attach_fail'), 'err'); }
    S.upl = false; paintAtts();
    const i = $q('#chtIn'); if (i) i.focus();
  }

  // ---------- pasted images ----------
  // An image is shrunk in the browser first (long side at most 1568 px) so it is small, fast and cheap to analyze.
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * k)); const h = Math.max(1, Math.round(img.naturalHeight * k));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
          let q = 0.86; let out = c.toDataURL('image/jpeg', q);
          while (out.length > 2.2 * 1024 * 1024 && q > 0.4) { q -= 0.15; out = c.toDataURL('image/jpeg', q); }
          const t2 = document.createElement('canvas'); const tk = Math.min(1, 96 / Math.max(w, h)); t2.width = Math.round(w * tk) || 1; t2.height = Math.round(h * tk) || 1;
          t2.getContext('2d').drawImage(c, 0, 0, t2.width, t2.height);
          resolve({ media_type: 'image/jpeg', data: out.split(',')[1], thumb: t2.toDataURL('image/jpeg', 0.7) });
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  async function addImages(files) {
    const list = files.filter((f) => /^image\/(png|jpe?g|webp|gif)$/i.test(f.type));
    if (!list.length) return false;
    S.imgs = S.imgs || [];
    for (const f of list) {
      if (S.imgs.length >= 3) { PM.toast(t('th_img_max'), 'err'); break; }
      try { S.imgs.push(await readImage(f)); } catch (e) { PM.toast(t('th_img_fail'), 'err'); }
    }
    paintAtts(); const i = $q('#chtIn'); if (i) i.focus();
    return true;
  }
  function onPaste(e) {
    const files = [...((e.clipboardData && e.clipboardData.items) || [])].filter((it) => it.kind === 'file' && /^image\//.test(it.type)).map((it) => it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addImages(files); }
  }
  function onDrop(e) {
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addImages(files); }
  }

  // A draft made in All projects is opened, downloaded or saved to its related project right on the card.
  async function draftAct(act, el) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return; el.disabled = true;
    const mid = el.dataset.id, ix = el.dataset.ix;
    try {
      if (act === 'drsave') {
        const r = await PM.api('POST', `/api/chat/messages/${mid}/drafts/${ix}/save`, {});
        const m = find(mid); if (m) m.card = r.card;
        if (!r.already && r.saved) PM.toast(t('cht_dr_saved_toast', { p: r.saved.project }), 'ok');
        paint(); refreshScreen(); return;
      }
      const g = (await PM.api('GET', `/api/chat/messages/${mid}/drafts/${ix}`)).generated;
      if (act === 'drdl') { await PM.exporter.download(g); PM.toast(t('cht_doc_ready'), 'ok'); return; }
      const m = PM.modal({ title: g.title, size: 'xl', body: `<div class="md">${PM.mdToHtml(g.content)}</div>`, footer: '' });
      m.setFooter(`<button class="btn primary" id="drDl">${icon('dl')}${esc(t('cht_doc_dl'))}</button>`);
      const b = m.el.querySelector('#drDl'); if (b) b.onclick = async () => { b.disabled = true; try { await PM.exporter.download(g); PM.toast(t('cht_doc_ready'), 'ok'); } catch (e) { PM.toast(e.message || t('cht_dr_fail'), 'err'); } finally { b.disabled = false; } };
    } catch (e) { PM.toast(e.message || t('cht_dr_fail'), 'err'); }
    finally { el.disabled = false; }
  }
  // A document made from a card can be opened or downloaded right there, no trip to Reports.
  async function docAct(act, id, el) {
    if (el.disabled) return; el.disabled = true;
    try {
      const g = (await PM.api('GET', `/api/generated/${id}`)).generated;
      if (act === 'docdl') { await PM.exporter.download(g); PM.toast(t('cht_doc_ready'), 'ok'); }
      else {
        const R = window.__Reports; const slide = !!(R && R.DEFAULTS && R.DEFAULTS[g.doc_type] && R.DEFAULTS[g.doc_type].oneSlide && !g.custom);
        if (slide || !PM.docEditor) { location.hash = `#/p/${g.project_id || S.ctx.projectId || ''}/reports`; if (S.page === false) close(); }
        else PM.docEditor.open(g, {});
      }
    } catch (e) { PM.toast(e.message || t('cht_doc_fail'), 'err'); }
    finally { el.disabled = false; }
  }
  // ---------- sending ----------
  function submit() {
    const i = $q('#chtIn'); let text = i.value.trim(); const images = S.imgs || [];
    if ((!text && !images.length) || S.busy || S.upl) return;
    if (text && S.att.length && S.attPid === S.ctx.projectId) { text += '\n[Attached: ' + S.att.map((a) => a.filename).join(', ') + ']'; S.att = []; }
    S.imgs = []; paintAtts();
    i.value = ''; grow(); send(text, images);
  }
  async function send(text, images) {
    if (S.busy) return;
    S.busy = true;
    const user = { id: 'u' + Date.now(), role: 'user', text: text || '', thumbs: (images || []).map((a) => a.thumb) };
    const bot = { id: 'b' + Date.now(), role: 'assistant', text: '', pending: true, status: t('cht_thinking'), sources: [], links: [] };
    S.msgs.push(user, bot); paint(true);
    const ctl = new AbortController(); S.ctl = ctl;
    try {
      const r = await fetch('/api/chat/message', { method: 'POST', headers: { 'content-type': 'application/json', 'X-CSRF-Token': PM.csrf() }, credentials: 'same-origin', body: JSON.stringify({ project_id: S.ctx.projectId, text, screen: S.ctx.screen, deep: S.deep, ...(images && images.length ? { images: images.map((a) => ({ media_type: a.media_type, data: a.data })) } : {}) }), signal: ctl.signal });
      if (!r.ok || !r.body) { let msg = t('cht_failed'); try { const j = await r.json(); msg = j.error || msg; } catch (e) { /* not json */ } if (r.status === 401) msg = t('err_session'); throw new Error(msg); }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { let ev; try { ev = JSON.parse(line); } catch (e) { continue; } onEvent(user, bot, ev); } }
      }
    } catch (e) {
      if (e.name === 'AbortError') bot.stopped = true; else bot.error = e.message || t('cht_failed');
    } finally {
      bot.pending = false; bot.status = ''; S.busy = false; S.ctl = null;
      if (!bot.text && !bot.error && !bot.stopped && !bot.card) bot.error = t('cht_failed');
      paint(true);
      if (S.data && S.data.remaining_today != null) S.data.remaining_today = Math.max(0, S.data.remaining_today - 1);
      if (S.page) loadThreads();
    }
  }
  function onEvent(user, bot, ev) {
    if (ev.type === 'user') user.id = ev.id;
    else if (ev.type === 'text') { bot.text += ev.text; bot.status = ''; soon(); }
    else if (ev.type === 'replace') { bot.text = ev.text; soon(); }
    else if (ev.type === 'tool') { bot.status = t('cht_tool'); soon(); }
    else if (ev.type === 'done') { Object.assign(bot, ev.message, { pending: false, status: '' }); soon(); }
    else if (ev.type === 'error') { bot.error = ev.message; bot.text = bot.text || ''; soon(); }
  }

  // ---------- history ----------
  async function showHistory() {
    if (S.busy) return;
    S.mode = 'history'; S.hist = { items: null, confirm: null, error: '' }; paint();
    try {
      const q = new URLSearchParams(); if (S.ctx.projectId) q.set('project_id', S.ctx.projectId);
      S.hist.items = (await PM.api('GET', '/api/chat/history?' + q)).items;
    } catch (e) { S.hist.items = []; S.hist.error = t('cht_hist_fail'); }
    paint();
  }
  function backToChat() { S.mode = 'chat'; S.hist = null; paint(true); const i = $q('#chtIn'); if (i) i.focus(); }
  async function openChat(id) {
    const it = (S.hist && S.hist.items || []).find((x) => String(x.id) === String(id)); if (!it || S.busy) return;
    if (it.current) return backToChat();
    try { await PM.api('POST', `/api/chat/threads/${id}/open`, {}); S.mode = 'chat'; S.hist = null; await load(); }
    catch (e) { PM.toast(e.message, 'err'); }
  }
  async function deleteChat(id) {
    try {
      const it = S.hist.items.find((x) => String(x.id) === String(id));
      await PM.api('DELETE', `/api/chat/threads/${id}`);
      S.hist.items = S.hist.items.filter((x) => String(x.id) !== String(id)); S.hist.confirm = null;
      if (it && it.current) { S.msgs = []; S.needReload = true; }
      PM.toast(t('cht_hist_deleted'), 'ok'); paint();
    } catch (e) { PM.toast(e.message, 'err'); }
  }

  // ---------- actions ----------
  const find = (id) => S.msgs.find((m) => String(m.id) === String(id));
  async function cardCall(id, what, body) {
    const m = find(id); if (!m || !m.card || m.card.busy) return;
    // the card answers at once: buttons are replaced by a progress line, and apply and undo cover the page with the loading screen
    m.card.busy = what; S.confirming = null; paint();
    const long = what === 'apply' || what === 'undo';
    const endLoad = long ? PM.loader.show(t(what === 'apply' ? 'ld_applying' : 'ld_undoing')) : null;
    try {
      const r = await PM.api('POST', `/api/chat/messages/${id}/${what}`, body || {});
      m.card = r.card;
      if (long && !r.already) {
        PM.toast(t(what === 'apply' ? 'cht_applied_toast' : 'cht_undone_toast'), 'ok');
        m.card.busy = false; paint();
        await refreshScreen();
      }
    } catch (e) {
      m.card.busy = false;
      // the server says what happened. A refused card shows its reason on the card itself.
      if (what === 'apply') { try { const v = await PM.api('GET', '/api/chat?' + new URLSearchParams({ ...(S.ctx.projectId ? { project_id: S.ctx.projectId } : {}), screen: S.ctx.screen })); const fresh = v.messages.find((x) => String(x.id) === String(id)); if (fresh) { m.card = fresh.card; } } catch (x) { /* keep the card as is */ } }
      PM.toast(e.message, 'err');
    } finally { if (endLoad) endLoad(); }
    if (m.card) m.card.busy = false;
    paint();
  }
  // the page frame stays, only the project header and the open tab reload
  function refreshScreen() { try { return Promise.resolve(PM.refresh ? PM.refresh() : PM.route && PM.route()).catch(() => {}); } catch (e) { return Promise.resolve(); } }
  function onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
    const act = el.dataset.act; const id = el.dataset.id;
    if (act === 'nav') { if (window.matchMedia('(max-width: 600px)').matches) close(); return; }
    if (act === 'close') return close();
    if (act === 'reload') { S.loadTries = 0; return load(); }
    if (act === 'treload') return loadThreads();
    if (act === 'hreload') return showHistory();
    if (act === 'hist') return S.mode === 'history' ? (S.needReload ? (S.needReload = false, S.mode = 'chat', load()) : backToChat()) : showHistory();
    if (act === 'expand') { location.hash = S.ctx.projectId ? `#/p/${S.ctx.projectId}/thinking` : '#/thinking'; return; }
    if (act === 'collapse') { const to = S.ctx.projectId ? `#/p/${S.ctx.projectId}/overview` : '#/'; location.hash = to; setTimeout(() => { if (!S.page) open(); }, 80); return; }
    if (act === 'full') return S.full ? exitFull() : enterFull();
    if (act === 'plus') return sheetOpen() ? closeSheet() : openSheet();
    if (act === 'sheetx') return closeSheet();
    if (act === 'mic') return startVoice();
    if (act === 'micok') return confirmVoice();
    if (act === 'micno') return cancelVoice();
    if (act === 'cam') { closeSheet(); const f = $q('#chtCam'); if (f) f.click(); return; }
    if (act === 'deep') { closeSheet(); S.deep = !S.deep; pref('pm_think_deep', S.deep ? '1' : null); paintShell(); return; }
    if (act === 'tside') { S.side = !S.side; pref('pm_th_side', S.side ? null : '0'); return paintShell(); }
    if (act === 'topen') return openThread(id);
    if (act === 'tpin') return pinThread(id);
    if (act === 'tren') return renameThread(id);
    if (act === 'tdel') { S.th.confirm = Number(id); return paintShell(); }
    if (act === 'tkeep') { S.th.confirm = null; return paintShell(); }
    if (act === 'tdel2') return deleteThread(id);
    if (act === 'tnew') { if (S.busy) return; S.mode = 'chat'; PM.api('POST', '/api/chat/clear', { project_id: S.ctx.projectId }).then(() => Promise.all([load(), loadThreads()])).catch((x) => PM.toast(x.message, 'err')); return; }
    if (act === 'wide') { S.w = S.w > DEF_W + 40 ? DEF_W : WIDE_W; applyWidth(); pref('pm_chat_w', String(S.w)); return; }
    if (act === 'hopen') return openChat(id);
    if (act === 'hdel') { S.hist.confirm = Number(id); return paint(); }
    if (act === 'hkeep') { S.hist.confirm = null; return paint(); }
    if (act === 'hdel2') return deleteChat(id);
    if (act === 'wpub') return wPublish(id, el);
    if (act === 'docopen' || act === 'docdl') return docAct(act, id, el);
    if (act === 'dropen' || act === 'drdl' || act === 'drsave') return draftAct(act, el);
    if (act === 'img') { closeSheet(); const f = $q('#chtImg'); if (f) f.click(); return; }
    if (act === 'imgrm') { (S.imgs || []).splice(Number(el.dataset.i), 1); return paintAtts(); }
    if (act === 'attach') { closeSheet(); const f = $q('#chtFile'); if (f) f.click(); return; }
    if (act === 'attrm') { S.att = S.att.filter((a) => String(a.id) !== String(id)); return paintAtts(); }
    if (act === 'send') return submit();
    if (act === 'stop') { if (S.ctl) S.ctl.abort(); return; }
    if (act === 'sug') { return send(el.dataset.q); }
    if (act === 'sgmore') { S.sugAll = !S.sugAll; return paint(); }
    if (act === 'sgdo' || act === 'sgsn' || act === 'sgdm') return sugAct(act, id);
    if (act === 'new') { if (S.busy) return; S.mode = 'chat'; S.hist = null; S.needReload = false; PM.api('POST', '/api/chat/clear', { project_id: S.ctx.projectId }).then(() => { load(); if (S.page) loadThreads(); }).catch((x) => PM.toast(x.message, 'err')); return; }
    if (act === 'copy') { const m = find(id); if (m && navigator.clipboard) navigator.clipboard.writeText(m.text).then(() => PM.toast(t('cht_copied'), 'ok')).catch(() => {}); return; }
    if (act === 'up' || act === 'down') {
      const m = find(id); if (!m) return; const want = act === 'up' ? 1 : -1; const v = m.feedback === want ? 0 : want;
      m.feedback = v; paint(); PM.api('POST', `/api/chat/messages/${id}/feedback`, { value: v }).catch(() => {}); return;
    }
    if (act === 'apply') { const m = find(id); if (m && m.card && (m.card.strong)) { S.confirming = m.id; paint(); const b = root.querySelector('[data-act="confirm"]'); if (b) b.focus(); return; } return cardCall(id, 'apply'); }
    if (act === 'confirm') return cardCall(id, 'apply', { confirmed: true });
    if (act === 'back') { S.confirming = null; return paint(); }
    if (act === 'cancel') return cardCall(id, 'cancel');
    if (act === 'undo') return cardCall(id, 'undo');
    if (act === 'edit') { const i = $q('#chtIn'); i.value = t('cht_edit_prefix'); grow(); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }


  // ---------- proactive suggestions ----------
  const inProject = () => !!ctxFromHash().projectId;
  const sugText = (x) => (x.project && !inProject() ? x.project + ': ' : '') + t('cht_s_' + x.rule, { n: x.n });
  const sugQ = (x) => {
    const q = x.rule === 'late_tasks' ? t('cht_q_late_tasks') : x.rule === 'late_payments' ? t('cht_q_late_payments') : x.rule === 'waiting_updates' ? t('cht_q_updates') : t('cht_qs_' + x.rule);
    return x.project && !inProject() ? x.project + ': ' + q : q;
  };
  async function loadSug() {
    try { const q = S.ctx.projectId ? '?project_id=' + S.ctx.projectId : ''; S.sug = (await PM.api('GET', '/api/chat/suggestions' + q)).items || []; }
    catch (e) { S.sug = []; }
  }
  const sugRows = (all) => (all ? (S.sug || []) : (S.sug || []).slice(0, 3)).map((x) => `<div class="sg-row"><span class="sg-t">${esc(sugText(x))}</span><span class="sg-a"><button class="btn sm primary" type="button" data-act="sgdo" data-id="${esc(x.id)}">${esc(t('th_sug_discuss'))}</button><button class="btn sm" type="button" data-act="sgsn" data-id="${esc(x.id)}">${esc(t('th_sug_snooze'))}</button><button class="btn sm ghost" type="button" data-act="sgdm" data-id="${esc(x.id)}">${esc(t('th_sug_dismiss'))}</button></span></div>`).join('');
  const proact = () => {
    const n = (S.sug || []).length; if (!n) return '';
    const more = n > 3 ? `<button class="btn sm ghost sg-more" type="button" data-act="sgmore">${esc(S.sugAll ? t('th_sug_less') : t('th_sug_more').replace('{n}', n))}</button>` : '';
    return `<div class="sg-box"><div class="small muted">${esc(t('th_sug_h'))}</div>${sugRows(S.sugAll)}${more}</div>`;
  };
  async function sugAct(act, id) {
    const x = (S.sug || []).find((y) => y.id === id); if (!x) return;
    if (act === 'sgdo') { closePop(); if (S.busy) return; if (!S.open) await open(); S.mode = 'chat'; S.hist = null; return send(sugQ(x)); }
    try {
      await PM.api('POST', '/api/chat/suggestions/dismiss', { project_id: x.project_id, rule: x.rule, mode: act === 'sgsn' ? 'snooze' : 'dismiss' });
      S.sug = S.sug.filter((y) => y.id !== id);
      PM.toast(t(act === 'sgsn' ? 'th_sug_snoozed' : 'th_sug_dismissed'), 'ok');
      if (S.data && !S.msgs.length) paint(); popRefresh(); chipRefresh();
    } catch (e) { PM.toast(e.message, 'err'); }
  }
  // a small count on the Overview, the Schedule and the portfolio dashboard, with the same list in a popover
  let pop = null, chipTimer = 0, chipAt = 0;
  function closePop() { if (pop) { pop.remove(); pop = null; } const c = document.querySelector('.sug-chip'); if (c) c.setAttribute('aria-expanded', 'false'); }
  function popRefresh() { if (!pop) return; if (!(S.sug || []).length) return closePop(); pop.innerHTML = `<div class="small muted">${esc(t('th_sug_h'))}</div>${sugRows(true)}`; }
  function openPop(chipEl) {
    if (pop) return closePop();
    pop = document.createElement('div'); pop.className = 'sg-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('th_sug_h'));
    pop.innerHTML = `<div class="small muted">${esc(t('th_sug_h'))}</div>${sugRows(true)}`;
    document.body.appendChild(pop);
    const r = chipEl.getBoundingClientRect(); const w = Math.min(380, window.innerWidth - 16);
    pop.style.width = w + 'px'; pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    chipEl.setAttribute('aria-expanded', 'true');
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) sugAct(b.dataset.act, b.dataset.id); });
  }
  function chipHost() {
    const c = ctxFromHash();
    const ph = document.querySelector('#main > .proj-head');
    if (ph && c.projectId && (c.screen === 'overview' || c.screen === 'schedule')) return { pid: c.projectId, place: (el) => { const g = ph.querySelector('.grow'); if (g) g.before(el); else ph.appendChild(el); } };
    const dh = document.querySelector('#content .page.dash .page-head');
    if (dh && !c.projectId) return { pid: null, place: (el) => { const h1 = dh.querySelector('h1'); if (h1) h1.after(el); else dh.prepend(el); } };
    return null;
  }
  async function chipRefresh() {
    if (!PM.state.token) return;
    const host = chipHost(); const old = document.querySelector('.sug-chip');
    if (!host) { if (old) old.remove(); closePop(); return; }
    if (Date.now() - chipAt > 15000 || !S.sugFor || S.sugFor !== String(host.pid)) {
      chipAt = Date.now(); S.sugFor = String(host.pid);
      try { S.sug = (await PM.api('GET', '/api/chat/suggestions' + (host.pid ? '?project_id=' + host.pid : ''))).items || []; } catch (e) { S.sug = []; }
      if (!chipHost()) return;
    }
    const n = (S.sug || []).length;
    if (!n) { if (old) old.remove(); closePop(); return; }
    const label = n === 1 ? t('th_sug_one') : t('th_sug_count', { n });
    let el = document.querySelector('.sug-chip');
    if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'sug-chip'; el.addEventListener('click', () => openPop(el)); host.place(el); }
    el.innerHTML = `${icon('spark')}<span>${esc(String(n))}</span>`;
    el.setAttribute('aria-label', label); el.setAttribute('data-tip', label); el.setAttribute('aria-haspopup', 'dialog');
  }
  function chipSoon() { clearTimeout(chipTimer); chipTimer = setTimeout(() => { if (!document.querySelector('.sug-chip') || chipHost()) chipRefresh(); }, 350); }
  function startChips() {
    window.addEventListener('hashchange', () => { closePop(); chipAt = 0; chipSoon(); });
    const main = document.getElementById('app') || document.body;
    new MutationObserver(() => { const h = chipHost(); if (h && !document.querySelector('.sug-chip') && (S.sug || []).length && S.sugFor === String(h.pid)) chipSoon(); else if (!h && document.querySelector('.sug-chip')) chipSoon(); }).observe(main, { childList: true, subtree: true });
    document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.sug-chip'))) closePop(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) closePop(); });
    chipSoon();
  }

  // ---------- start ----------
  function onHash() {
    const c = ctxFromHash();
    if (!root) return;
    if (S.page && !isPage()) unmountPage();
    if (isPage()) return;
    if (c.projectId !== S.ctx.projectId) { if (S.busy && S.ctl) S.ctl.abort(); S.mode = 'chat'; S.hist = null; S.needReload = false; if (S.open) load(); else S.ctx = c; }
    else S.ctx = c;
  }
  // a language change rebuilds the shell so every label follows
  function rebuild() {
    if (!root) return;
    cancelVoice(); exitFull();
    const was = S.open; const pg = S.page; S.mode = 'chat'; S.hist = null; root.remove(); root = null; document.body.classList.remove('chat-open');
    build(); bindFab();
    if (pg) { S.page = false; mountPage(); } else if (was) { S.open = false; open(); } else paint();
  }
  function bindFab() { $q('#chtFab').addEventListener('click', () => (S.open ? close() : open())); }
  function init() {
    if (!PM.state.token) return;
    build(); bindFab();
    new MutationObserver(() => rebuild()).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    window.addEventListener('hashchange', onHash);
    startChips();
    window.addEventListener('resize', () => { if (root) { applyWidth(); place(); if (S.full) fitFull(); } });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (root && S.full) fitFull(); else if (root && S.page) place(); });
    // a click anywhere outside the chat closes it. Dialogs, toasts, tooltips and the loading screen are not "outside".
    document.addEventListener('pointerdown', (e) => {
      if (!S.open || S.page || !root || S.dragging || root.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.pmld-screen, #toasts, .overlay, .modal, .gt-tip, .viz-tip, .g-tip, .dw-menu, [data-keep-chat]')) return;
      close(true);
    }, true);
    if (!isPage() && keep('pm_chat_open') === '1' && !window.matchMedia('(max-width: 820px)').matches) open();
  }
  // Lets a screen start a request in the Thinking Area, for example the empty Schedule screen. The person still sees the
  // message and the answer in the thread, and every rule is applied by the server as for a typed message.
  async function ask(text) {
    if (!PM.state.token || !text) return false;
    build();
    if (!S.open && !isPage()) await open();
    if (S.busy || S.mode !== 'chat') { if (S.mode !== 'chat') { S.mode = 'chat'; paint(); } if (S.busy) return false; }
    await send(String(text));
    return true;
  }
  PM.chat = { init, open, close, mountPage, ask };
  const pageHtml = '<div class="page th-page"><div id="thHost" class="th-host" aria-hidden="true"></div></div>';
  PM.views.thinking = async function () { PM.shell('thinking', pageHtml); await mountPage(); };
  PM.views.tab_thinking = async function (root) { root.innerHTML = pageHtml; await mountPage(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
