/* Language toggle: English and Arabic (right to left). Translates text nodes and labels in place. */
(function () {
  'use strict';
  var AR = {
    'AI Project Management Software | Project Manager AI': 'برنامج إدارة المشاريع بالذكاء الاصطناعي | Project Manager AI',
    'Upload a contract and get a Gantt schedule, risk radar and payment tracking. AI project management software with a 15 day free trial. No card needed.': 'ارفع عقدًا لتحصل على جدول غانت ورادار المخاطر وتتبع الدفعات. برنامج إدارة مشاريع بالذكاء الاصطناعي مع تجربة مجانية لمدة 15 يومًا دون بطاقة.',
    'Sign in to Project Manager AI': 'تسجيل الدخول إلى Project Manager AI',
    'Sign in to Project Manager AI or start a 15 day free trial of the AI project management tool.': 'سجّل الدخول إلى Project Manager AI أو ابدأ تجربة مجانية لمدة 15 يومًا.',
    'Features': 'المزايا', 'How it works': 'كيف يعمل', 'Product': 'المنتج', 'Reports': 'التقارير', 'FAQ': 'الأسئلة الشائعة',
    'Start free trial': 'ابدأ التجربة المجانية', 'Sign in': 'تسجيل الدخول',
    'AI project management software': 'برنامج إدارة المشاريع بالذكاء الاصطناعي',
    'The project management tool that turns your contract into a': 'أداة إدارة المشاريع التي تحوّل عقدك إلى',
    'live plan': 'خطة حيّة',
    'Stop retyping contracts into spreadsheets. Upload one and get the schedule, risks and payment milestones, then keep them current from Teams, Outlook and Jira.': 'توقف عن إعادة كتابة العقود في الجداول. ارفع عقدًا لتحصل على الجدول الزمني والمخاطر ومراحل الدفع، ثم حدّثها من Teams وOutlook وJira.',
    'See how it works': 'شاهد كيف يعمل',
    '15 day free trial. No card needed.': 'تجربة مجانية لمدة 15 يومًا. بدون بطاقة.',
    'Gantt scheduling': 'جدولة غانت', 'Risk radar': 'رادار المخاطر', 'Payment tracking': 'تتبع الدفعات', 'Automatic reports': 'تقارير تلقائية',
    'Portfolio overview': 'نظرة عامة على المحفظة', 'Illustrative data': 'بيانات توضيحية',
    'Active projects': 'المشاريع النشطة', '9 on track': '9 على المسار', 'Progress': 'التقدم', 'Portfolio': 'المحفظة',
    'Schedule index': 'مؤشر الجدول', 'Behind plan': 'متأخر عن الخطة', 'Late tasks': 'مهام متأخرة', 'Past finish date': 'تجاوزت تاريخ الانتهاء',
    'Task': 'المهمة', 'Discovery': 'الاستكشاف', 'Design': 'التصميم', 'Build': 'البناء', 'Integration': 'التكامل', 'Go live': 'الإطلاق',
    'AI suggestion': 'اقتراح الذكاء الاصطناعي', 'Teams, just now': 'Teams، الآن',
    'Close deliverable "Design package"': 'إغلاق المخرج "حزمة التصميم"',
    '2 high signals': 'إشارتان عاليتان', 'Risk radar needs a look': 'رادار المخاطر يحتاج إلى نظرة', 'Integration is 4 days late': 'التكامل متأخر 4 أيام',
    'Dependency types': 'أنواع الاعتماديات', 'Risk dimensions': 'أبعاد المخاطر', 'Report formats': 'صيغ التقارير', 'Day free trial': 'يومًا تجربة مجانية',
    'From signed contract to running plan in three steps': 'من العقد الموقّع إلى خطة تعمل في ثلاث خطوات',
    'The AI proposes. You confirm.': 'الذكاء الاصطناعي يقترح وأنت تعتمد.',
    'Upload your documents': 'ارفع مستنداتك', 'Contracts, proposals and purchase orders. PDF, Word, Excel or text.': 'العقود والعروض وأوامر الشراء بصيغة PDF أو Word أو Excel أو نص.',
    'Review what the AI found': 'راجع ما وجده الذكاء الاصطناعي', 'Confirm, edit or ignore each item. Conflicts are flagged.': 'اعتمد كل بند أو عدّله أو تجاهله. تُعلَّم التعارضات لك.',
    'Run the project': 'أدر المشروع', 'Track progress, risks and payments, then send reports.': 'تابع التقدم والمخاطر والدفعات، ثم أرسل التقارير.',
    'Everything a project manager needs, in one workspace': 'كل ما يحتاجه مدير المشروع في مساحة عمل واحدة',
    'Plan, track and report without switching tools.': 'خطط وتابع وأعدّ التقارير دون التنقل بين الأدوات.',
    'AI document reading': 'قراءة المستندات بالذكاء الاصطناعي',
    'No retyping. Dates, value, deliverables and risks are ready to confirm.': 'دون إعادة كتابة. التواريخ والقيمة والمخرجات والمخاطر جاهزة للاعتماد.',
    'Gantt chart scheduling': 'جدولة مخطط غانت', 'Drag, link and baseline every task.': 'اسحب واربط وثبّت خط الأساس لكل مهمة.',
    'Board view': 'عرض اللوحة', 'The same tasks as To do, In progress and Done.': 'المهام نفسها في أعمدة: قيد الانتظار وقيد التنفيذ ومكتملة.',
    'Updates inbox': 'صندوق التحديثات', 'Teams, Outlook and Jira messages become suggested changes.': 'رسائل Teams وOutlook وJira تتحول إلى تغييرات مقترحة.',
    'Rank risks by probability, impact and exposure.': 'رتّب المخاطر حسب الاحتمالية والأثر والتعرض.',
    'Portfolio dashboard': 'لوحة المحفظة', 'Health, progress and value across every project.': 'الحالة والتقدم والقيمة لكل مشروع.',
    'Payment milestones': 'مراحل الدفع', 'Never miss an invoice. Track pending, invoiced and paid.': 'لا تفوّت أي فاتورة. تابع الدفعات المعلقة والمفوترة والمدفوعة.',
    'English and Arabic': 'العربية والإنجليزية', 'Right to left layout, dark mode, USD, AED and SAR.': 'تخطيط من اليمين إلى اليسار ووضع داكن والدولار والدرهم والريال.',
    'See the project management software at work': 'شاهد برنامج إدارة المشاريع أثناء العمل', 'Example data shown.': 'البيانات المعروضة أمثلة.',
    'Your contract becomes structured project data': 'عقدك يتحول إلى بيانات مشروع منظمة',
    'Skip the data entry. The AI fills in the project from your documents.': 'وفّر إدخال البيانات. يعبّئ الذكاء الاصطناعي المشروع من مستنداتك.',
    'Confirm, edit or ignore every extracted item': 'اعتمد كل بند مستخرج أو عدّله أو تجاهله',
    'Conflicts are flagged for you': 'يتم تنبيهك إلى التعارضات',
    'Extracted from Contract.pdf': 'مستخرج من Contract.pdf', 'AI reading': 'قراءة الذكاء الاصطناعي',
    'Project value': 'قيمة المشروع', 'AED 4,200,000': '4,200,000 درهم', 'Start date': 'تاريخ البدء', '15 Jan 2027': '15 يناير 2027',
    'End date': 'تاريخ الانتهاء', 'Conflict': 'تعارض', '30 Sep 2027 or 31 Oct 2027': '30 سبتمبر 2027 أو 31 أكتوبر 2027',
    'Client': 'العميل', 'Example Client Authority': 'هيئة العميل النموذجية',
    '9 deliverables': '9 مخرجات', '4 payment milestones': '4 مراحل دفع', '6 risks': '6 مخاطر', '12 requirements': '12 متطلبًا', 'Confirm all 4': 'اعتماد الكل (4)',
    'A Gantt chart that behaves like one': 'مخطط غانت يعمل كما ينبغي',
    'Drag to move, resize or set progress. Linked tasks reschedule for you.': 'اسحب للنقل أو تغيير الحجم أو ضبط التقدم. تُعاد جدولة المهام المرتبطة تلقائيًا.',
    'Four link types with lag': 'أربعة أنواع روابط مع تأخير', 'Baseline and critical path': 'خط الأساس والمسار الحرج',
    'Import and export Microsoft Project XML': 'استيراد وتصدير ملفات Microsoft Project XML',
    'Smart Portal Rollout': 'إطلاق البوابة الذكية', 'At risk': 'في خطر',
    'Discovery phase': 'مرحلة الاستكشاف', 'Requirements signed off': 'اعتماد المتطلبات', 'Solution design': 'تصميم الحل',
    'Build core features': 'بناء الميزات الأساسية', 'Integrations': 'التكاملات', 'User acceptance testing': 'اختبار قبول المستخدم', 'Training': 'التدريب',
    'Done': 'مكتمل', 'In progress': 'قيد التنفيذ', 'Late': 'متأخر', 'Critical path': 'المسار الحرج', 'Milestone': 'معلم', 'Baseline': 'خط الأساس',
    'Status updates arrive as suggestions you can apply': 'تصلك التحديثات كاقتراحات يمكنك تطبيقها',
    'Stop chasing status. Messages arrive as suggestions and you decide.': 'توقف عن ملاحقة الحالة. تصل الرسائل كاقتراحات وأنت تقرر.',
    'Every change can be undone': 'يمكن التراجع عن كل تغيير', 'Updates': 'التحديثات',
    'from Ahmed': 'من أحمد', 'Design is done and signed off by the client.': 'اكتمل التصميم واعتمده العميل.',
    'Close a deliverable': 'إغلاق مخرج', 'Design package': 'حزمة التصميم', 'Dismiss': 'تجاهل', 'Apply': 'تطبيق', 'Applied': 'تم التطبيق', 'Undo': 'تراجع',
    'Dismissed': 'تم التجاهل', 'Restore': 'استعادة', 'All caught up': 'لا شيء متبقٍ',
    'from Finance': 'من المالية', 'Invoice for milestone 2 was sent on Monday.': 'أُرسلت فاتورة المرحلة 2 يوم الاثنين.',
    'Mark a payment as invoiced': 'تحديد دفعة كمفوترة', 'Milestone 2': 'المرحلة 2', 'comment on API-214': 'تعليق على API-214',
    'The API integration is built and tested. We are at 40 percent overall.': 'اكتمل بناء تكامل الواجهة واختباره. نحن عند 40 بالمئة إجمالًا.',
    'Update a task': 'تحديث مهمة', 'Integrations to 40%': 'التكاملات إلى 40%', 'Example updates. Try Apply.': 'تحديثات توضيحية. جرّب زر تطبيق.',
    'Spot the risks before they reach the client': 'اكتشف المخاطر قبل أن تصل إلى العميل',
    'Logged risks, late tasks and payments in one place.': 'المخاطر المسجلة والمهام المتأخرة والدفعات في مكان واحد.',
    'Probability and impact matrix': 'مصفوفة الاحتمالية والأثر', 'Six exposure dimensions': 'ستة أبعاد للتعرض',
    'Probability and impact': 'الاحتمالية والأثر', 'High': 'مرتفع', 'Medium': 'متوسط', 'Low': 'منخفض', 'Impact': 'الأثر',
    'Exposure by dimension': 'التعرض حسب البعد', 'Schedule': 'الجدول', 'Resources': 'الموارد', 'Scope': 'النطاق', 'Financial': 'المالي',
    'Technical': 'التقني', 'Governance': 'الحوكمة', 'Score from 0 to 100.': 'الدرجة من 0 إلى 100.',
    'One portfolio view for leadership and the PMO': 'عرض واحد للمحفظة للقيادة ومكتب إدارة المشاريع',
    'Progress, schedule index and payments for every project.': 'التقدم ومؤشر الجدول والدفعات لكل مشروع.',
    'Portfolio value': 'قيمة المحفظة', '$18.4M': '18.4 مليون دولار', 'Across 12 projects': 'عبر 12 مشروعًا',
    '1.00 means on plan': '1.00 يعني وفق الخطة', 'Past their finish date': 'تجاوزت تاريخ انتهائها',
    'Progress against plan': 'التقدم مقابل الخطة', 'Actual': 'الفعلي', 'Plan': 'الخطة', 'Plan 72%': 'الخطة 72%', 'Actual 68%': 'الفعلي 68%',
    'Payment pipeline': 'مسار الدفعات', 'Paid': 'مدفوعة', 'Invoiced': 'مفوترة', 'Pending': 'معلقة',
    'Illustrative data. Amounts in thousands of US dollars.': 'بيانات توضيحية. المبالغ بآلاف الدولارات الأمريكية.',
    'Reports and exports': 'التقارير والتصدير', 'Send the report, not the spreadsheet': 'أرسل التقرير لا جدول البيانات',
    'Progress reports built from live data and compared with your baseline.': 'تقارير تقدم مبنية على بيانات حيّة ومقارنة بخط الأساس.',
    'Word documents': 'مستندات Word', 'Progress reports ready to send.': 'تقارير تقدم جاهزة للإرسال.', 'Excel workbooks': 'مصنفات Excel', 'Schedules and registers.': 'الجداول والسجلات.',
    'PowerPoint decks': 'عروض PowerPoint', 'Status decks for steering meetings.': 'عروض حالة لاجتماعات اللجان التوجيهية.', 'Import and export.': 'استيراد وتصدير.',
    'Dashboard data': 'بيانات اللوحة', 'Widget data.': 'بيانات الودجات.',
    'SharePoint and OneDrive links': 'روابط SharePoint وOneDrive', 'Project calendar': 'تقويم المشروع',
    'Who it is for': 'لمن هو', 'Built for teams that deliver against contracts': 'مصمم للفرق التي تنفذ مشاريعها وفق العقود',
    'Project managers': 'مديرو المشاريع', 'Spend less time on paperwork and more time delivering.': 'اقضِ وقتًا أقل في الأوراق ووقتًا أكثر في التنفيذ.',
    'PMOs and delivery leads': 'مكاتب إدارة المشاريع وقادة التنفيذ', 'One structure across every project.': 'هيكل موحد لكل المشاريع.',
    'Executives and sponsors': 'التنفيذيون والرعاة', 'See what needs a decision.': 'اطّلع على ما يحتاج إلى قرار.',
    'Questions about this project management tool': 'أسئلة عن أداة إدارة المشاريع هذه',
    'What is Project Manager AI?': 'ما هو Project Manager AI؟',
    'Project Manager AI is a project management tool that reads your project documents, proposes the project data and schedule, and keeps the plan current from the tools your team already uses.': 'Project Manager AI أداة لإدارة المشاريع تقرأ مستندات مشروعك، وتقترح بيانات المشروع والجدول الزمني، وتبقي الخطة محدّثة من الأدوات التي يستخدمها فريقك.',
    'How does the AI read my project documents?': 'كيف يقرأ الذكاء الاصطناعي مستندات مشروعي؟',
    'You upload a proposal, contract or purchase order in PDF, Word, Excel or text. The AI extracts dates, value, deliverables, requirements, risks and payment milestones. Nothing becomes final until you confirm it.': 'ترفع عرضًا أو عقدًا أو أمر شراء بصيغة PDF أو Word أو Excel أو نص. يستخرج الذكاء الاصطناعي التواريخ والقيمة والمخرجات والمتطلبات والمخاطر ومراحل الدفع. ولا يصبح أي شيء نهائيًا حتى تعتمده.',
    'Can I import a schedule from Microsoft Project?': 'هل يمكنني استيراد جدول من Microsoft Project؟',
    'Yes. You can import and export the standard Microsoft Project XML format. Outline levels, link types, lags, the baseline and the working calendar travel with the file.': 'نعم. يمكنك استيراد وتصدير صيغة Microsoft Project XML القياسية. وتنتقل مستويات الهيكل وأنواع الروابط والتأخيرات وخط الأساس وتقويم العمل مع الملف.',
    'Which tools does it connect to?': 'ما الأدوات التي يتصل بها؟',
    'Messages from Teams, Outlook email and Jira are matched to tasks and payments as suggested changes. You can also paste a message or upload a document as evidence, and add SharePoint, OneDrive and Jira links to each project.': 'تُطابَق رسائل Teams والبريد في Outlook وJira مع المهام والدفعات كتغييرات مقترحة. ويمكنك أيضًا لصق رسالة أو رفع مستند كدليل، وإضافة روابط SharePoint وOneDrive وJira لكل مشروع.',
    'Can I undo a change the AI suggests?': 'هل يمكنني التراجع عن تغيير يقترحه الذكاء الاصطناعي؟',
    'Yes. Every suggestion waits for your decision, and every automatic change is logged and can be undone. You choose the confidence threshold for automatic updates.': 'نعم. كل اقتراح ينتظر قرارك، وكل تغيير تلقائي يُسجَّل ويمكن التراجع عنه. وأنت تحدد حد الثقة للتحديثات التلقائية.',
    'Does it support Arabic?': 'هل يدعم اللغة العربية؟',
    'Yes. The app works in English and Arabic with a full right to left layout, and in light and dark mode.': 'نعم. يعمل التطبيق بالعربية والإنجليزية مع تخطيط كامل من اليمين إلى اليسار، وبالوضعين الفاتح والداكن.',
    'Is there a free trial?': 'هل توجد تجربة مجانية؟',
    'Yes. You can start with a 15 day free trial. No card is needed.': 'نعم. يمكنك البدء بتجربة مجانية لمدة 15 يومًا دون الحاجة إلى بطاقة.',
    'Upload your first contract and see the plan': 'ارفع أول عقد لك وشاهد الخطة',
    'Start a 15 day free trial. No card needed.': 'ابدأ تجربة مجانية لمدة 15 يومًا. بدون بطاقة.',
    'Charts and figures on this page are illustrative examples.': 'المخططات والأرقام في هذه الصفحة أمثلة توضيحية.',
    /* attributes */
    'Project Manager AI home': 'Project Manager AI، الرئيسية', 'Main': 'القائمة الرئيسية',
    'Switch between light and dark mode': 'التبديل بين الوضع الفاتح والداكن', 'Switch theme': 'تبديل المظهر',
    'Open menu': 'فتح القائمة', 'Close menu': 'إغلاق القائمة', 'Product facts': 'حقائق المنتج', 'Connected tools': 'الأدوات المتصلة', 'Footer': 'التذييل', 'Back to top': 'العودة إلى الأعلى',
    'Illustrative portfolio dashboard showing 12 active projects, 68 percent progress, a schedule index of 0.94 and 7 late tasks, with a project Gantt chart below.': 'لوحة محفظة توضيحية تعرض 12 مشروعًا نشطًا وتقدمًا بنسبة 68 بالمئة ومؤشر جدول 0.94 و7 مهام متأخرة، ومخطط غانت للمشروع أسفلها.',
    'Risk matrix. High probability: 1 low impact risk, 2 medium and 2 high. Medium probability: 1, 3 and 1. Low probability: 2, 1 and 0.': 'مصفوفة المخاطر. احتمالية مرتفعة: خطر واحد بأثر منخفض واثنان بأثر متوسط واثنان بأثر مرتفع. احتمالية متوسطة: 1 و3 و1. احتمالية منخفضة: 2 و1 و0.',
    'Line chart. Planned progress reaches 72 percent in month 6. Actual progress reaches 68 percent.': 'مخطط خطي. يصل التقدم المخطط إلى 72 بالمئة في الشهر 6 والتقدم الفعلي إلى 68 بالمئة.',
    'Stacked bar chart of payments in thousands of dollars by quarter. Paid and invoiced amounts shrink while pending amounts grow toward the fourth quarter.': 'مخطط أعمدة مكدسة للدفعات بآلاف الدولارات حسب الربع. تتراجع المبالغ المدفوعة والمفوترة وتزداد المعلقة نحو الربع الرابع.',
    /* login */
    'Your contract, turned into a live plan.': 'عقدك، وقد تحوّل إلى خطة حيّة.',
    'Upload the documents. Review what the AI found. Run the project from one workspace.': 'ارفع المستندات. راجع ما وجده الذكاء الاصطناعي. وأدر المشروع من مساحة عمل واحدة.',
    'AI reads proposals, contracts and purchase orders': 'يقرأ الذكاء الاصطناعي العروض والعقود وأوامر الشراء',
    'Gantt schedule with dependencies and baseline': 'جدول غانت مع الاعتماديات وخط الأساس',
    'Risk radar and payment tracking': 'رادار المخاطر وتتبع الدفعات',
    '68% portfolio progress': '68% تقدم المحفظة', '9 of 12 projects on track. Example data.': '9 من 12 مشروعًا على المسار. بيانات توضيحية.',
    'Back to home': 'العودة إلى الرئيسية', 'Create account': 'إنشاء حساب', 'Welcome back': 'مرحبًا بعودتك',
    'Sign in to your project workspace.': 'سجّل الدخول إلى مساحة عمل مشاريعك.',
    'Start your free trial': 'ابدأ تجربتك المجانية', '15 days free. No card needed.': '15 يومًا مجانًا. بدون بطاقة.',
    'Full name': 'الاسم الكامل', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور',
    'Demo login: pm@example.com and demo1234.': 'دخول تجريبي: pm@example.com و demo1234.', 'Fill demo details': 'تعبئة البيانات التجريبية',
    'You are ready to go': 'أنت جاهز للانطلاق', 'Your trial is ready to start': 'تجربتك جاهزة للبدء',
    'Open Project Manager AI': 'افتح Project Manager AI', 'Back': 'رجوع',
    'Open Project Manager AI to continue to your workspace.': 'افتح Project Manager AI للمتابعة إلى مساحة عملك.',
    'Your 15 day free trial starts in the app. Continue to open it.': 'تبدأ تجربتك المجانية لمدة 15 يومًا داخل التطبيق. تابع لفتحه.',
    'This page is the front door to the demo workspace. Your details are not sent anywhere from here.': 'هذه الصفحة مدخل إلى مساحة العمل التجريبية. لا تُرسل بياناتك إلى أي جهة من هنا.',
    'Enter your name.': 'أدخل اسمك.', 'Enter a valid email address, for example name@company.com.': 'أدخل بريدًا إلكترونيًا صالحًا، مثل name@company.com.',
    'Use at least 8 characters.': 'استخدم 8 أحرف على الأقل.',
    'Email or password is not correct.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'No account found for this email. Create an account first.': 'لا يوجد حساب بهذا البريد الإلكتروني. أنشئ حسابًا أولًا.',
    'An account with this email already exists. Sign in instead.': 'يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بدلًا من ذلك.',
    'Your browser is blocking storage, so you cannot stay signed in.': 'المتصفح يمنع التخزين، لذلك لا يستطيع العرض التجريبي إبقاءك مسجلا الدخول.',
    'Your projects are stored securely on the server and are available wherever you sign in.': 'تُحفظ مشاريعك بأمان على الخادم وتتوفر أينما سجلت الدخول.',
    'About Project Manager AI': 'عن Project Manager AI', 'Project Manager AI, back to home': 'Project Manager AI، العودة إلى الرئيسية',
    'Example: portfolio progress 68 percent, 9 of 12 projects on track': 'مثال: تقدم المحفظة 68 بالمئة و9 من 12 مشروعًا على المسار',
    'Sign in or create account': 'تسجيل الدخول أو إنشاء حساب', 'Your name': 'اسمك', 'At least 8 characters': '8 أحرف على الأقل',
    'Show password': 'إظهار كلمة المرور', 'Hide password': 'إخفاء كلمة المرور',
    'What\'s new': 'الجديد',
    'Upload it. Review what the AI found. Run the project from one place.': 'ارفعه. راجع ما وجده الذكاء الاصطناعي. وأدر المشروع من مكان واحد.',
    'Read': 'اقرأ',
    'Update': 'حدّث',
    'Capture': 'سجّل',
    'Think': 'فكّر',
    'Watch': 'راقب',
    'Report': 'أبلغ',
    'Close': 'أغلق',
    'Intro': 'البداية',
    'Workspace': 'مساحة العمل',
    'Your workspace': 'مساحة عملك',
    'New': 'جديد',
    'Drop in the contract. Get the project.': 'ارفع العقد. احصل على المشروع.',
    'Dates, deliverables, payments and risks arrive ready to confirm.': 'التواريخ والمخرجات والدفعات والمخاطر تصلك جاهزة للاعتماد.',
    'A schedule you can drag.': 'جدول تسحبه بيدك.',
    'Linked tasks move together and the critical path stays in view.': 'المهام المرتبطة تتحرك معًا ويبقى المسار الحرج أمامك.',
    'Status arrives as suggestions.': 'الحالة تصلك كاقتراحات.',
    'Teams, Outlook and Jira messages become changes you apply with one click.': 'رسائل Teams وOutlook وJira تتحول إلى تغييرات تطبّقها بنقرة واحدة.',
    'Record the meeting. Keep the minutes.': 'سجّل الاجتماع. واحتفظ بالمحضر.',
    'A transcript per speaker, editable minutes, and actions that can go to your log and schedule.': 'نص لكل متحدث، ومحضر قابل للتعديل، وإجراءات يمكن إرسالها إلى سجلك وجدولك.',
    'Think it through with AI.': 'فكّر مع الذكاء الاصطناعي.',
    'Ask, plan and draft in the Thinking Area. Nothing changes until you press Apply.': 'اسأل وخطّط واكتب مسوداتك في مساحة التفكير. لا يتغير شيء قبل أن تضغط تطبيق.',
    'Risks, late tasks and payments in one radar.': 'المخاطر والمهام المتأخرة والدفعات في رادار واحد.',
    'The notification bell tells you what slipped before the client does.': 'جرس الإشعارات يخبرك بما تأخر قبل أن يلاحظ العميل.',
    'Send the report, not the spreadsheet.': 'أرسل التقرير لا جدول البيانات.',
    'Word, Excel and PowerPoint, with your own template and logo.': 'Word وExcel وPowerPoint، بقالبك وشعارك.',
    'Close with lessons learned.': 'أغلق المشروع بالدروس المستفادة.',
    'A closure checklist, a lessons learned report and a certificate of completion.': 'قائمة إغلاق وتقرير دروس مستفادة وشهادة إتمام.',
    'Scroll to explore': 'مرّر للاستكشاف',
    'Story chapters': 'فصول القصة',
    'Fresh in this release': 'جديد في هذا الإصدار',
    'The newest parts of the product, all built into the same workspace.': 'أحدث أجزاء المنتج، وكلها داخل مساحة العمل نفسها.',
    'Thinking Area': 'مساحة التفكير',
    'Meeting capture': 'تسجيل الاجتماعات',
    'Notification center': 'مركز الإشعارات',
    'Widget marketplace': 'سوق الأدوات',
    'Your own templates': 'قوالبك الخاصة',
    'Project closure': 'إغلاق المشروع',
    'Trends over time': 'الاتجاهات عبر الزمن',
    'See the real screens': 'شاهد الشاشات الحقيقية',
    'Captured from the running app with sample project data.': 'ملتقطة من التطبيق الفعلي ببيانات مشروع تجريبية.',
    'Screens': 'الشاشات',
    'Screens from the product': 'شاشات من المنتج',
    'Overview': 'نظرة عامة',
    'Widgets': 'الأدوات',
    'Light and dark themes. English and Arabic with right to left layout.': 'مظهر فاتح وداكن. الإنجليزية والعربية بتخطيط من اليمين إلى اليسار.',
    'Less typing. More steering.': 'كتابة أقل. وقيادة أكثر.',
    'Before': 'قبل',
    'With Project Manager AI': 'مع Project Manager AI',
    'Retype the contract into a sheet': 'إعادة كتابة العقد في جدول',
    'Upload and confirm': 'ارفع واعتمد',
    'Chase status by email': 'ملاحقة الحالة بالبريد',
    'Apply suggestions': 'طبّق الاقتراحات',
    'Build the weekly report by hand': 'بناء التقرير الأسبوعي يدويًا',
    'Download Word, Excel or PowerPoint': 'نزّل Word أو Excel أو PowerPoint',
    'Lose the lessons at the end': 'ضياع الدروس في النهاية',
    'Close with a report and a certificate': 'أغلق بتقرير وشهادة',
    'Screens on this page show sample project data.': 'الشاشات في هذه الصفحة تعرض بيانات مشروع تجريبية.',
    'Sample project data': 'بيانات مشروع تجريبية'
  };

  var PAT = [
    [/^(\d+)% sure$/, function (m) { return 'متأكد بنسبة ' + m[1] + '%'; }],
    [/^(\d+) waiting$/, function (m) { return m[1] + ' بانتظار المراجعة'; }]
  ];
  var root = document.documentElement, cur = 'en', mo = null, queued = false;
  var TITLE_EN = document.title;
  var metaDesc = document.querySelector('meta[name="description"]');
  var DESC_EN = metaDesc ? metaDesc.getAttribute('content') : '';
  var ATTRS = ['aria-label', 'title', 'placeholder'];

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function tr(k) {
    if (Object.prototype.hasOwnProperty.call(AR, k)) return AR[k];
    for (var i = 0; i < PAT.length; i++) { var m = k.match(PAT[i][0]); if (m) return PAT[i][1](m); }
    return null;
  }
  function applyText() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { var p = n.parentNode && n.parentNode.nodeName; return (p === 'SCRIPT' || p === 'STYLE') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (cur === 'ar') {
        var k = norm(n.nodeValue); if (!k) continue;
        var t = tr(k);
        if (t !== null) {
          n._en = n.nodeValue;
          var m = n._en.match(/^(\s*)[\s\S]*?(\s*)$/);
          n.nodeValue = m[1] + t + m[2];
        }
      } else if (n._en !== undefined) { n.nodeValue = n._en; n._en = undefined; }
    }
  }
  function applyAttrs() {
    var els = document.querySelectorAll('[aria-label],[title],[placeholder]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      for (var j = 0; j < ATTRS.length; j++) {
        var a = ATTRS[j]; if (!el.hasAttribute(a)) continue;
        var v = el.getAttribute(a);
        if (cur === 'ar') {
          var t = tr(norm(v));
          if (t !== null) { el._o = el._o || {}; el._o[a] = v; el.setAttribute(a, t); }
        } else if (el._o && el._o[a] !== undefined) {
          var o = el._o[a];
          if (el.getAttribute(a) === tr(norm(o))) el.setAttribute(a, o);
          delete el._o[a];
        }
      }
    }
  }
  function applyMeta() {
    document.title = cur === 'ar' ? (tr(TITLE_EN) || TITLE_EN) : TITLE_EN;
    if (metaDesc) metaDesc.setAttribute('content', cur === 'ar' ? (tr(DESC_EN) || DESC_EN) : DESC_EN);
  }
  function apply() {
    if (mo) mo.disconnect();
    applyText(); applyAttrs(); applyMeta();
    if (mo) mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  mo = new MutationObserver(function (muts) {
    if (cur !== 'ar' || queued) return;
    var real = muts.some(function (m) {
      var t = m.target.nodeType === 3 ? m.target.parentNode : m.target;
      return !(t && t.closest && t.closest('[data-count]'));
    });
    if (!real) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; apply(); });
  });

  var btn = document.getElementById('langBtn'), label = document.getElementById('langLabel');
  function set(l) {
    cur = l === 'ar' ? 'ar' : 'en';
    root.lang = cur; root.dir = cur === 'ar' ? 'rtl' : 'ltr';
    apply();
    if (label) label.textContent = cur === 'ar' ? 'English' : 'العربية';
    if (btn) btn.setAttribute('aria-label', cur === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    try { localStorage.setItem('pmai_lang', cur); } catch (e) { /* storage blocked */ }
    window.dispatchEvent(new Event('resize'));
  }
  if (btn) btn.addEventListener('click', function () { set(cur === 'ar' ? 'en' : 'ar'); });
  var saved = null; try { saved = localStorage.getItem('pmai_lang'); } catch (e) { /* storage blocked */ }
  set(saved === 'ar' ? 'ar' : 'en');
  window.PMLang = { set: set, get: function () { return cur; }, apply: apply };
})();
