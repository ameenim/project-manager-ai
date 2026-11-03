/* First login setup, product tour, plan ribbon, subscription and billing page.
   Billing and onboarding state live in the browser here because the demo has no server.
   In the live product the trial start, plan, token counter and onboarding flags belong to the user record on the server. */
(function () {
  'use strict';
  const PM = window.PM;
  const { esc, t, icon, $, $$ } = PM;
  const S = PM.state;

  const DAY = 86400000, TRIAL_DAYS = 15, PERIOD_DAYS = 30, PRICE = 25, LIMIT = 10000000;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const later = (fn) => setTimeout(fn, 60);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  async function waitFor(sel, ms) { const end = Date.now() + ms; while (Date.now() < end) { const el = $(sel); if (el) return el; await delay(100); } return null; }
  const LOCK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  // ---------- text ----------
  Object.assign(PM.I18N.en, {
    nav_billing: 'Billing and plan', u_m: 'M', u_k: 'K',
    ob_title: 'Set up your account', ob_s_welcome: 'Welcome', ob_s_details: 'Your details', ob_s_tools: 'Connect tools',
    ob_welcome_h: 'Welcome to Project Manager AI', ob_welcome_p: 'Three quick steps and you are ready to run your first project. This takes about two minutes.',
    ob_trial_h: '15 days free', ob_trial_p: 'Your trial includes the full product and 10 million tokens. No card needed to start.',
    ob_next_h: 'What we will do', ob_n1: 'Confirm your name and mobile number', ob_n2: 'Connect Jira and your email', ob_n3: 'Take a short tour of the screens',
    ob_start: 'Get started', ob_skip: 'Skip for now', ob_back: 'Back', ob_continue: 'Continue', ob_finish: 'Finish setup',
    ob_details_h: 'Your details', ob_details_p: 'Your name appears on reports and comments. We use your mobile number for account alerts.',
    ob_name: 'Full name', ob_email: 'Email', ob_email_hint: 'This is your sign in email. It cannot be changed here.', ob_mobile: 'Mobile number', ob_country: 'Country code', ob_mobile_hint: 'Digits only, for example 50 123 4567.',
    ob_err_name: 'Enter your full name.', ob_err_phone: 'Enter a valid mobile number with 7 to 12 digits.', ob_err_phone2: 'Enter your mobile number with the country code, for example ‎+971501234567.',
    ob_tools_h: 'Connect your tools', ob_tools_p: 'Jira brings in task updates. Your email brings in messages about your projects. Both are optional now and you can connect them later in Account settings.', ob_tools_hint: 'You can connect or disconnect at any time.',
    ob_trial_note: 'Start with a 15 day free trial. No card needed.',
    ob_ban_h: 'Finish setting up your account', ob_ban_p: '{done} of {total} steps done.', ob_ban_go: 'Continue setup', ob_ban_hide: 'Hide',
    ob_c_details: 'Name and mobile number', ob_c_jira: 'Connect Jira', ob_c_mail: 'Connect email', ob_c_tour: 'Take the tour', ob_replay: 'Replay the tour', ob_guide: 'Setup guide', ob_guide_hint: 'Everything you need to get started.', ob_done: 'Done', ob_open: 'Open',
    tour_step: 'Step {n} of {total}', tour_skip: 'Skip tour', tour_next: 'Next', tour_back: 'Back', tour_done: 'Finish',
    tour_ribbon_t: 'Your plan at a glance', tour_ribbon_b: 'This bar stays on every screen. It shows how many days are left and how many tokens you have used.',
    tour_dash_t: 'Overview', tour_dash_b: 'Start here each day. See project health, late tasks, upcoming payments and items waiting for your review.',
    tour_projects_t: 'Projects', tour_projects_b: 'Open any project to review documents, edit the schedule, read updates and create reports. Hover to see them all.',
    tour_calendar_t: 'Calendar', tour_calendar_b: 'Every task and payment due date across your projects in one place.',
    tour_new_t: 'Create a project', tour_new_b: 'Name it, attach the contract or proposal, and the AI builds a first draft of your plan for you to review.',
    tour_billing_t: 'Billing and plan', tour_billing_b: 'Follow your trial, subscribe for $25 per month and watch your token use.',
    tour_account_t: 'Account settings', tour_account_b: 'Update your details, connect Jira and email, and replay this tour any time.',
    tour_prefs_t: 'Language and appearance', tour_prefs_b: 'Switch between English and Arabic, and between light and dark mode.',
    tour_end_t: 'You are ready to go', tour_end_b: 'Create your first project, or explore the demo project first.', tour_create: 'Create a project', tour_explore: 'Explore the demo',
    rb_label: 'Plan and token usage', rb_trial: 'Free trial ends in {days}', rb_sub: 'Subscription ends in {days}', rb_trial_over: 'Your free trial has ended', rb_sub_over: 'Your subscription has ended',
    rb_tokens: 'Tokens', rb_tokens_of: '{used} of {limit}', rb_tokens_tip: 'Tokens are used when the AI reads documents, writes reports and answers messages. Your {limit} tokens reset each month.',
    rb_subscribe: 'Subscribe for $25 per month', rb_subscribe_short: 'Subscribe', rb_manage: 'Manage plan', rb_out: 'Token limit reached', rb_warn80: 'You have used 80% of your tokens.',
    rb_err_expired: 'Your plan has ended. Subscribe to continue.', rb_err_tokens: 'You have used all of your tokens. They reset on {date}.',
    sub_title: 'Subscribe to Project Manager AI', sub_plan: 'Monthly plan', sub_per: 'per month', sub_f1: '10 million tokens every month', sub_f2: 'All project, schedule and report features', sub_f3: 'Jira and email connections',
    sub_today: 'Due today', sub_renews: 'Renews on', sub_continue: 'Continue to payment', sub_not_now: 'Not now', sub_pay_h: 'Secure payment',
    sub_pay_note: 'Payment is handled by a secure checkout page. Project Manager AI never sees your card details.', sub_demo: 'Demo only. No payment is taken.', sub_pay: 'Pay $25.00',
    sub_ok_h: 'You are subscribed', sub_ok_p: 'Your 10 million tokens are ready to use. Your plan renews on {date}.',
    pw_title: 'Your free trial has ended', pw_body: 'Subscribe for $25 per month to keep creating and updating projects. You can still view your existing projects.', pw_later: 'View only for now',
    bl_title: 'Billing and plan', bl_plan: 'Plan', bl_trial: 'Free trial', bl_active: 'Active', bl_ended: 'Ended', bl_days_left: 'Days left',
    bl_started: 'Started {date}', bl_ends: 'Ends on {date}', bl_renews: 'Renews on {date}', bl_ended_on: 'Ended on {date}', bl_price: '$25 per month', bl_includes: 'Includes 10 million tokens each month',
    bl_tokens: 'Token usage', bl_used: 'used', bl_remaining: '{n} remaining', bl_reset: 'Resets on {date}', bl_uses_h: 'What uses tokens',
    bl_u1: 'Reading and analyzing documents', bl_u2: 'Writing reports and updates', bl_u3: 'Answering project messages', bl_u4: 'Syncing Jira and email',
    bl_daily: 'Usage by day', bl_day: 'Day', bl_tokens_col: 'Tokens', bl_daily_empty: 'No usage yet. Tokens appear here when the AI works on your projects.',
    bl_inv: 'Invoices', bl_inv_empty: 'No invoices yet. Your first invoice appears after you subscribe.', bl_inv_no: 'Invoice', bl_inv_date: 'Date', bl_inv_amt: 'Amount', bl_paid: 'Paid',
    bl_auto: 'Renew automatically', bl_auto_off: 'Renewal turned off. Your plan stays active until {date}.', bl_auto_on: 'Automatic renewal is on.', bl_undo: 'Undo', bl_more: 'Show more', bl_less: 'Show less',
    bl_demo_h: 'Demo controls', bl_demo_p: 'Preview each state of the plan bar. These controls are not part of the live product.', bl_demo_days: 'Days left', bl_demo_tokens: 'Tokens used', bl_demo_reset: 'Start a new trial', bl_sub_cta: 'Subscribe now', bl_acc_view: 'View billing',
  });
  Object.assign(PM.I18N.ar, {
    nav_billing: 'الفوترة والباقة', u_m: ' م', u_k: ' ألف',
    ob_title: 'إعداد حسابك', ob_s_welcome: 'مرحبا', ob_s_details: 'بياناتك', ob_s_tools: 'ربط الأدوات',
    ob_welcome_h: 'مرحبا بك في مدير المشاريع الذكي', ob_welcome_p: 'ثلاث خطوات سريعة وتصبح جاهزا لإدارة أول مشروع. تستغرق نحو دقيقتين.',
    ob_trial_h: '15 يوما مجانا', ob_trial_p: 'تشمل التجربة المنتج كاملا و10 ملايين رمز. لا حاجة إلى بطاقة للبدء.',
    ob_next_h: 'ما الذي سنفعله', ob_n1: 'تأكيد اسمك ورقم جوالك', ob_n2: 'ربط Jira وبريدك الإلكتروني', ob_n3: 'جولة قصيرة في الشاشات',
    ob_start: 'ابدأ', ob_skip: 'تخطي الآن', ob_back: 'رجوع', ob_continue: 'متابعة', ob_finish: 'إنهاء الإعداد',
    ob_details_h: 'بياناتك', ob_details_p: 'يظهر اسمك في التقارير والتعليقات. نستخدم رقم جوالك لتنبيهات الحساب.',
    ob_name: 'الاسم الكامل', ob_email: 'البريد الإلكتروني', ob_email_hint: 'هذا بريد تسجيل الدخول ولا يمكن تغييره من هنا.', ob_mobile: 'رقم الجوال', ob_country: 'رمز الدولة', ob_mobile_hint: 'أرقام فقط، مثل 50 123 4567.',
    ob_err_name: 'أدخل اسمك الكامل.', ob_err_phone: 'أدخل رقم جوال صحيحا من 7 إلى 12 رقما.', ob_err_phone2: 'أدخل رقم جوالك مع رمز الدولة، مثل ‎+971501234567.',
    ob_tools_h: 'ربط أدواتك', ob_tools_p: 'يجلب Jira تحديثات المهام ويجلب بريدك الرسائل الخاصة بمشاريعك. الربط اختياري الآن ويمكنك إجراؤه لاحقا من إعدادات الحساب.', ob_tools_hint: 'يمكنك الربط أو قطع الاتصال في أي وقت.',
    ob_trial_note: 'ابدأ بتجربة مجانية لمدة 15 يوما. لا حاجة إلى بطاقة.',
    ob_ban_h: 'أكمل إعداد حسابك', ob_ban_p: 'اكتملت {done} من {total} خطوات.', ob_ban_go: 'متابعة الإعداد', ob_ban_hide: 'إخفاء',
    ob_c_details: 'الاسم ورقم الجوال', ob_c_jira: 'ربط Jira', ob_c_mail: 'ربط البريد الإلكتروني', ob_c_tour: 'الجولة التعريفية', ob_replay: 'إعادة الجولة', ob_guide: 'دليل الإعداد', ob_guide_hint: 'كل ما تحتاجه للبدء.', ob_done: 'تم', ob_open: 'فتح',
    tour_step: 'الخطوة {n} من {total}', tour_skip: 'تخطي الجولة', tour_next: 'التالي', tour_back: 'رجوع', tour_done: 'إنهاء',
    tour_ribbon_t: 'باقتك في لمحة', tour_ribbon_b: 'يبقى هذا الشريط ظاهرا في كل الشاشات. يعرض الأيام المتبقية وعدد الرموز التي استهلكتها.',
    tour_dash_t: 'نظرة عامة', tour_dash_b: 'ابدأ منها كل يوم. تعرض حالة المشاريع والمهام المتأخرة والدفعات القادمة والبنود التي تنتظر مراجعتك.',
    tour_projects_t: 'المشاريع', tour_projects_b: 'افتح أي مشروع لمراجعة المستندات وتعديل الجدول وقراءة التحديثات وإنشاء التقارير. مرر المؤشر لرؤيتها كلها.',
    tour_calendar_t: 'التقويم', tour_calendar_b: 'تواريخ استحقاق كل المهام والدفعات في مشاريعك في مكان واحد.',
    tour_new_t: 'إنشاء مشروع', tour_new_b: 'سمّه وأرفق العقد أو العرض، ثم يجهز الذكاء الاصطناعي مسودة أولى لخطتك لتراجعها.',
    tour_billing_t: 'الفوترة والباقة', tour_billing_b: 'تابع تجربتك واشترك مقابل 25 دولارا شهريا وراقب استهلاك الرموز.',
    tour_account_t: 'إعدادات الحساب', tour_account_b: 'حدّث بياناتك واربط Jira والبريد الإلكتروني وأعد هذه الجولة في أي وقت.',
    tour_prefs_t: 'اللغة والمظهر', tour_prefs_b: 'بدّل بين العربية والإنجليزية وبين الوضع الفاتح والداكن.',
    tour_end_t: 'أنت جاهز', tour_end_b: 'أنشئ أول مشروع، أو استكشف المشروع التجريبي أولا.', tour_create: 'إنشاء مشروع', tour_explore: 'استكشاف المشروع التجريبي',
    rb_label: 'الباقة واستهلاك الرموز', rb_trial: 'تنتهي التجربة المجانية بعد {days}', rb_sub: 'ينتهي الاشتراك بعد {days}', rb_trial_over: 'انتهت تجربتك المجانية', rb_sub_over: 'انتهى اشتراكك',
    rb_tokens: 'الرموز', rb_tokens_of: '{used} من {limit}', rb_tokens_tip: 'تُستهلك الرموز عندما يقرأ الذكاء الاصطناعي المستندات ويكتب التقارير ويجيب عن الرسائل. تتجدد رموزك البالغة {limit} كل شهر.',
    rb_subscribe: 'اشترك مقابل 25 دولارا شهريا', rb_subscribe_short: 'اشترك', rb_manage: 'إدارة الباقة', rb_out: 'بلغت حد الرموز', rb_warn80: 'استهلكت 80% من رموزك.',
    rb_err_expired: 'انتهت باقتك. اشترك للمتابعة.', rb_err_tokens: 'استهلكت كل رموزك. تتجدد في {date}.',
    sub_title: 'الاشتراك في مدير المشاريع الذكي', sub_plan: 'الباقة الشهرية', sub_per: 'شهريا', sub_f1: '10 ملايين رمز كل شهر', sub_f2: 'كل ميزات المشاريع والجداول والتقارير', sub_f3: 'ربط Jira والبريد الإلكتروني',
    sub_today: 'المستحق اليوم', sub_renews: 'يتجدد في', sub_continue: 'المتابعة إلى الدفع', sub_not_now: 'ليس الآن', sub_pay_h: 'دفع آمن',
    sub_pay_note: 'تتم معالجة الدفع عبر صفحة دفع آمنة. لا يطلع مدير المشاريع الذكي على بيانات بطاقتك.', sub_demo: 'نسخة تجريبية فقط. لا يتم سحب أي مبلغ.', sub_pay: 'ادفع $25.00',
    sub_ok_h: 'تم اشتراكك', sub_ok_p: 'رموزك البالغة 10 ملايين جاهزة للاستخدام. تتجدد باقتك في {date}.',
    pw_title: 'انتهت تجربتك المجانية', pw_body: 'اشترك مقابل 25 دولارا شهريا لمتابعة إنشاء المشاريع وتحديثها. ما زال بإمكانك عرض مشاريعك الحالية.', pw_later: 'العرض فقط الآن',
    bl_title: 'الفوترة والباقة', bl_plan: 'الباقة', bl_trial: 'تجربة مجانية', bl_active: 'نشطة', bl_ended: 'منتهية', bl_days_left: 'الأيام المتبقية',
    bl_started: 'بدأت في {date}', bl_ends: 'تنتهي في {date}', bl_renews: 'تتجدد في {date}', bl_ended_on: 'انتهت في {date}', bl_price: '25 دولارا شهريا', bl_includes: 'تشمل 10 ملايين رمز كل شهر',
    bl_tokens: 'استهلاك الرموز', bl_used: 'مستهلك', bl_remaining: 'المتبقي {n}', bl_reset: 'تتجدد في {date}', bl_uses_h: 'ما الذي يستهلك الرموز',
    bl_u1: 'قراءة المستندات وتحليلها', bl_u2: 'كتابة التقارير والتحديثات', bl_u3: 'الإجابة عن رسائل المشاريع', bl_u4: 'مزامنة Jira والبريد الإلكتروني',
    bl_daily: 'الاستهلاك اليومي', bl_day: 'اليوم', bl_tokens_col: 'الرموز', bl_daily_empty: 'لا يوجد استهلاك بعد. تظهر الرموز هنا عندما يعمل الذكاء الاصطناعي على مشاريعك.',
    bl_inv: 'الفواتير', bl_inv_empty: 'لا توجد فواتير بعد. تظهر أول فاتورة بعد الاشتراك.', bl_inv_no: 'الفاتورة', bl_inv_date: 'التاريخ', bl_inv_amt: 'المبلغ', bl_paid: 'مدفوعة',
    bl_auto: 'التجديد التلقائي', bl_auto_off: 'تم إيقاف التجديد. تبقى باقتك نشطة حتى {date}.', bl_auto_on: 'التجديد التلقائي قيد التشغيل.', bl_undo: 'تراجع', bl_more: 'عرض المزيد', bl_less: 'عرض أقل',
    bl_demo_h: 'عناصر التحكم التجريبية', bl_demo_p: 'استعرض كل حالة من حالات شريط الباقة. هذه العناصر ليست جزءا من المنتج الفعلي.', bl_demo_days: 'الأيام المتبقية', bl_demo_tokens: 'الرموز المستهلكة', bl_demo_reset: 'بدء تجربة جديدة', bl_sub_cta: 'اشترك الآن', bl_acc_view: 'عرض الفوترة',
  });

  // ---------- stored state ----------
  const mem = {};
  const load = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : mem[k] || null; } catch (e) { return mem[k] || null; } };
  const save = (k, v) => { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked, memory copy is used */ } };
  const freshBilling = () => ({ trialStart: Date.now(), paidAt: null, tokens: 0, shift: 0, usage: {}, invoices: [], auto: true, warned: 0 });
  let B = load('pm_billing') || freshBilling();
  let O = load('pm_onboard') || { done: false, tour: false, phone: '', hide: false };
  const saveB = () => save('pm_billing', B);
  const saveO = () => save('pm_onboard', O);
  saveB(); saveO();

  // ---------- plan maths ----------
  const now = () => Date.now() + (B.shift || 0);
  const dkey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const loc = () => (S.lang === 'ar' ? 'ar-AE' : 'en-US');
  const num = (n) => Number(n).toLocaleString(loc());
  const dfmt = (ms) => new Date(ms).toLocaleDateString(loc(), { month: 'short', day: 'numeric', year: 'numeric' });
  const tok = (n) => (n >= 1e6 ? num(Math.round(n / 1e4) / 100) + t('u_m') : n >= 1e3 ? num(Math.round(n / 100) / 10) + t('u_k') : num(n));
  function dayText(n) {
    if (S.lang === 'ar') return n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : n >= 3 && n <= 10 ? `${num(n)} أيام` : `${num(n)} يوما`;
    return n === 1 ? '1 day' : `${num(n)} days`;
  }
  const invoice = (ms) => ({ no: 'PM-' + String(1001 + B.invoices.length), at: ms, amount: PRICE });
  function roll() {
    if (!B.paidAt || !B.auto) return;
    let end = B.paidAt + PERIOD_DAYS * DAY, guard = 0;
    while (now() >= end && guard++ < 24) { B.paidAt = end; B.tokens = 0; B.warned = 0; B.invoices.unshift(invoice(end)); end = B.paidAt + PERIOD_DAYS * DAY; saveB(); }
  }
  function info() {
    roll();
    const paid = !!B.paidAt;
    const end = paid ? B.paidAt + PERIOD_DAYS * DAY : B.trialStart + TRIAL_DAYS * DAY;
    const left = Math.ceil((end - now()) / DAY);
    const days = Math.max(0, left), expired = left <= 0;
    const pct = Math.min(100, Math.round((B.tokens / LIMIT) * 100));
    let tone = paid ? 'paid' : 'ok';
    if ((!paid && days <= 5) || (paid && days <= 3) || pct >= 80) tone = 'warn';
    if (expired || pct >= 100) tone = 'bad';
    return { paid, end, days, expired, pct, tone, out: pct >= 100, tokensLeft: Math.max(0, LIMIT - B.tokens) };
  }

  // ---------- plan ribbon ----------
  function ribbon() {
    const i = info();
    const label = i.expired ? t(i.paid ? 'rb_sub_over' : 'rb_trial_over') : t(i.paid ? 'rb_sub' : 'rb_trial', { days: dayText(i.days) });
    const ic = i.tone === 'bad' || i.tone === 'warn' ? 'alert' : i.paid ? 'check' : 'spark';
    const cta = i.paid && !i.expired ? `<a class="btn sm" href="#/billing">${t('rb_manage')}</a>` : `<button type="button" class="btn sm primary" data-subscribe><span class="rb-long">${t('rb_subscribe')}</span><span class="rb-short">${t('rb_subscribe_short')}</span></button>`;
    const used = i.out ? t('rb_out') : t('rb_tokens_of', { used: tok(B.tokens), limit: tok(LIMIT) });
    const tip = t('rb_tokens_tip', { limit: tok(LIMIT) });
    const tone = i.pct >= 100 ? 'bad' : i.pct >= 80 ? 'warn' : '';
    return `<div class="ribbon ${i.tone}" id="ribbon" role="region" aria-label="${esc(t('rb_label'))}">
      <div class="rb-status">${icon(ic)}<span>${esc(label)}</span></div>
      <div class="rb-tokens ${tone}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(t('rb_tokens') + ': ' + used)}"><span>${t('rb_tokens')}</span><b>${esc(used)}</b><span class="progress rb-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${i.pct}"><i style="width:${i.pct}%"></i></span></div>
      <div class="rb-cta">${cta}</div></div>`;
  }
  function sync() { const el = $('#ribbon'); document.documentElement.style.setProperty('--ribbon-h', (el ? el.offsetHeight : 0) + 'px'); }
  function bindRibbon() {
    const el = $('#ribbon'); if (!el) return;
    $$('[data-subscribe]', el).forEach((b) => (b.onclick = () => subscribe()));
    sync();
  }
  let redraw = null;
  function refresh() {
    const el = $('#ribbon');
    if (el) { el.outerHTML = ribbon(); bindRibbon(); }
    if (redraw && $('#billingPage')) redraw(); else redraw = null;
  }
  window.addEventListener('resize', sync);

  // ---------- token use and limits ----------
  const FREE = /^\/api\/(auth|me|connections|billing)/;
  const COST = [[/\/analyze$/, 60e3, 60e3], [/\/generate$/, 40e3, 50e3], [/\/documents$/, 25e3, 35e3], [/\/messages$/, 8e3, 12e3], [/\/sync$/, 15e3, 25e3], [/\/msproject\/import$/, 10e3, 15e3], [/^\/api\/projects$/, 30e3, 50e3]];
  const costOf = (m, p) => { if (m !== 'POST') return 0; for (const [re, a, b] of COST) if (re.test(p)) return Math.round(a + Math.random() * b); return 0; };
  function addTokens(n) {
    B.tokens = Math.min(LIMIT, B.tokens + n);
    const k = dkey(now()); B.usage[k] = (B.usage[k] || 0) + n;
    const pct = (B.tokens / LIMIT) * 100;
    if (pct >= 100 && B.warned < 2) { B.warned = 2; PM.toast(t('rb_err_tokens', { date: dfmt(info().end) }), 'err'); }
    else if (pct >= 80 && B.warned < 1) { B.warned = 1; PM.toast(t('rb_warn80')); }
    saveB(); refresh();
  }
  const blocked = (msg) => new Response(JSON.stringify({ error: msg }), { status: 402, headers: { 'content-type': 'application/json' } });
  const prevFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || 'GET').toUpperCase();
    const path = String(url).split('?')[0];
    if (/^\/api\//.test(path) && method !== 'GET' && !FREE.test(path)) {
      const i = info();
      if (i.expired) { later(() => subscribe({ expired: !i.paid })); return blocked(t('rb_err_expired')); }
      const cost = costOf(method, path);
      if (cost && i.out) { if (!i.paid) later(() => subscribe()); return blocked(t('rb_err_tokens', { date: dfmt(i.end) })); }
      const res = await prevFetch(input, init);
      if (cost && res.ok) addTokens(cost);
      return res;
    }
    return prevFetch(input, init);
  };

  // ---------- subscribe and pay ----------
  let subOpen = false;
  function subscribe(opt) {
    if (subOpen) return;
    subOpen = true;
    const o = opt || {};
    const m = PM.modal({ title: t('sub_title'), body: '', footer: '', onClose: () => { subOpen = false; } });
    const renews = () => dfmt(now() + PERIOD_DAYS * DAY);
    const plan = () => `${o.expired ? `<div class="banner warn mb">${icon('alert')}<div class="grow"><b>${t('pw_title')}</b><div class="small">${t('pw_body')}</div></div></div>` : ''}
      <div class="sub-plan"><div class="sub-head"><h3>${t('sub_plan')}</h3><div class="sub-price"><b dir="ltr">$${PRICE}</b><span>${t('sub_per')}</span></div></div>
      <ul class="sub-list">${['sub_f1', 'sub_f2', 'sub_f3'].map((k) => `<li>${icon('check')}<span>${t(k)}</span></li>`).join('')}</ul></div>
      <dl class="sub-sum"><div><dt>${t('sub_today')}</dt><dd dir="ltr">$${PRICE}.00</dd></div><div><dt>${t('sub_renews')}</dt><dd>${renews()}</dd></div></dl>`;
    function step1() {
      m.setBody(plan());
      m.setFooter(`<button class="btn" data-close>${t(o.expired ? 'pw_later' : 'sub_not_now')}</button><button class="btn primary" id="subNext">${t('sub_continue')}</button>`);
      m.$('#subNext').onclick = step2; m.$('#subNext').focus();
    }
    function step2() {
      m.setBody(`<h3 style="margin-bottom:8px">${t('sub_pay_h')}</h3><p class="muted" style="margin-top:0">${t('sub_pay_note')}</p><span class="chip amber">${t('sub_demo')}</span>
        <dl class="sub-sum"><div><dt>${t('sub_plan')}</dt><dd dir="ltr">$${PRICE}.00</dd></div><div><dt>${t('sub_renews')}</dt><dd>${renews()}</dd></div></dl>`);
      m.setFooter(`<button class="btn" id="subBack">${t('ob_back')}</button><button class="btn good" id="subPay">${t('sub_pay')}</button>`);
      m.$('#subBack').onclick = step1;
      m.$('#subPay').onclick = async () => {
        const r = await PM.busy(m.$('#subPay'), async () => { await delay(900); return true; });
        if (!r) return;
        B.paidAt = now(); B.tokens = 0; B.warned = 0; B.auto = true; B.invoices.unshift(invoice(now())); saveB(); refresh();
        step3();
      };
      m.$('#subPay').focus();
    }
    function step3() {
      m.setBody(`<div class="cw-done">${icon('check')}<h3>${t('sub_ok_h')}</h3><p class="muted">${t('sub_ok_p', { date: renews() })}</p></div>`);
      m.setFooter(`<button class="btn primary" data-close>${t('ob_done')}</button>`);
    }
    step1();
  }

  // ---------- phone ----------
  const CC = [['+971', 'AE'], ['+966', 'SA'], ['+965', 'KW'], ['+974', 'QA'], ['+968', 'OM'], ['+973', 'BH'], ['+962', 'JO'], ['+20', 'EG'], ['+44', 'GB'], ['+1', 'US'], ['+91', 'IN']];
  const region = (c) => { try { return new Intl.DisplayNames([loc()], { type: 'region' }).of(c) || c; } catch (e) { return c; } };
  const cleanPhone = (s) => String(s || '').replace(/[\s\-().‎]/g, '');
  function validatePhone(s) { const v = cleanPhone(s); if (!v) return t('ob_err_phone2'); return /^\+\d{8,15}$/.test(v) ? '' : t('ob_err_phone2'); }
  function savePhone(s) { const e = validatePhone(s); if (e) return e; O.phone = cleanPhone(s); saveO(); return ''; }
  function splitPhone(p) { const hit = CC.map((c) => c[0]).sort((a, b) => b.length - a.length).find((c) => String(p || '').startsWith(c)); return hit ? [hit, p.slice(hit.length)] : ['+971', '']; }

  // ---------- setup checklist ----------
  const items = () => [
    { k: 'details', done: !!O.phone && O.done, label: t('ob_c_details') },
    { k: 'jira', done: !!S.status.jira, label: t('ob_c_jira') },
    { k: 'mail', done: !!S.status.graph, label: t('ob_c_mail') },
    { k: 'tour', done: !!O.tour, label: t('ob_c_tour') },
  ];
  function nextStep() {
    const next = items().find((x) => !x.done); if (!next) return;
    const after = () => { try { PM.api('GET', '/api/me').then((me) => { S.status = me.status; PM.route(); }); } catch (e) { /* refreshes on next load */ } };
    if (next.k === 'details') wizard();
    else if (next.k === 'jira') PM.connect.wizard('jira', after);
    else if (next.k === 'mail') PM.connect.wizard('outlook', after);
    else tour();
  }
  function banner() {
    const list = items(), done = list.filter((x) => x.done).length;
    if (done === list.length || O.hide) return '';
    return `<div class="banner mb" id="obBanner">${icon('spark')}<div class="grow"><b>${t('ob_ban_h')}</b> <span class="muted">${t('ob_ban_p', { done: String(done), total: String(list.length) })}</span><div class="row wrap" style="margin-top:6px">${list.map((x) => `<span class="chip ${x.done ? 'green' : 'gray'}">${x.done ? icon('check') : ''}${x.label}</span>`).join('')}</div></div>
      <button type="button" class="btn primary sm" data-ob="next">${t('ob_ban_go')}</button><button type="button" class="btn ghost sm" data-ob="hide">${t('ob_ban_hide')}</button></div>`;
  }
  function bind(root) {
    const b = $('#obBanner', root); if (!b) return;
    $('[data-ob=next]', b).onclick = nextStep;
    $('[data-ob=hide]', b).onclick = () => { O.hide = true; saveO(); b.remove(); };
  }
  function accountCards() {
    const i = info();
    const chip = i.expired ? `<span class="chip red">${t('bl_ended')}</span>` : i.paid ? `<span class="chip green">${icon('check')}${t('bl_active')}</span>` : `<span class="chip blue">${t('bl_trial')}</span>`;
    const rows = items().map((x) => `<div class="conn-row"><div class="avatar conn-ic">${icon(x.done ? 'check' : 'list')}</div><div class="grow"><div class="conn-name">${x.label}</div></div>${x.done ? `<span class="chip green">${icon('check')}${t('ob_done')}</span>` : `<button type="button" class="btn sm" data-guide="${x.k}">${t('ob_open')}</button>`}</div>`).join('');
    return `<div class="card mt"><div class="card-head"><h3>${t('nav_billing')}</h3></div><div class="row wrap">${i.paid || i.expired ? chip : ''}<span>${esc(i.expired ? t(i.paid ? 'rb_sub_over' : 'rb_trial_over') : t(i.paid ? 'rb_sub' : 'rb_trial', { days: dayText(i.days) }))}</span><span class="muted small">${t('rb_tokens')}: ${esc(t('rb_tokens_of', { used: tok(B.tokens), limit: tok(LIMIT) }))}</span><span class="grow"></span><a class="btn sm" href="#/billing">${t('bl_acc_view')}</a></div></div>
      <div class="card mt"><div class="card-head"><h3>${t('ob_guide')}</h3><button type="button" class="btn sm" id="obReplay">${t('ob_replay')}</button></div><div class="small muted mb">${t('ob_guide_hint')}</div><div class="conn-list" id="obGuide">${rows}</div></div>`;
  }
  function bindAccount(root) {
    const r = $('#obReplay', root); if (r) r.onclick = () => tour();
    $$('[data-guide]', root).forEach((b) => (b.onclick = () => {
      const k = b.dataset.guide;
      const after = () => PM.api('GET', '/api/me').then((me) => { S.status = me.status; PM.route(); }).catch(() => {});
      if (k === 'details') wizard(); else if (k === 'jira') PM.connect.wizard('jira', after); else if (k === 'mail') PM.connect.wizard('outlook', after); else tour();
    }));
  }

  // ---------- first login setup ----------
  let wizOpen = false;
  function wizard() {
    if (wizOpen) return;
    wizOpen = true;
    let step = 0;
    const [cc0, num0] = splitPhone(O.phone);
    const d = { name: (S.user && S.user.name) || '', cc: cc0, num: num0 };
    const m = PM.modal({ title: t('ob_title'), size: 'lg', body: '', footer: '', noBackdropClose: true, onClose: () => { wizOpen = false; } });
    const bar = () => `<ol class="cw-steps" aria-label="${esc(t('cw_progress'))}">${['ob_s_welcome', 'ob_s_details', 'ob_s_tools'].map((s, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''}><i>${i < step ? icon('check') : i + 1}</i><span>${t(s)}</span></li>`).join('')}</ol>`;
    function body() {
      if (step === 0) return `<div class="ob-hero"><h3>${t('ob_welcome_h')}</h3><p class="muted" style="margin:0">${t('ob_welcome_p')}</p>
        <div class="ob-trial"><b>${t('ob_trial_h')}</b><span>${t('ob_trial_p')}</span></div>
        <div><div class="sub" style="font-weight:600;margin-bottom:4px">${t('ob_next_h')}</div><ol class="cw-list" style="margin:0"><li>${t('ob_n1')}</li><li>${t('ob_n2')}</li><li>${t('ob_n3')}</li></ol></div></div>`;
      if (step === 1) return `<h3 style="margin-bottom:4px">${t('ob_details_h')}</h3><p class="muted" style="margin-top:0">${t('ob_details_p')}</p>
        <div class="form-grid">
          <div class="f full"><label for="obName">${t('ob_name')}</label><input type="text" id="obName" value="${esc(d.name)}" autocomplete="name" aria-describedby="obErrName"><div class="ob-err" id="obErrName" role="alert"></div></div>
          <div class="f full"><label for="obEmail">${t('ob_email')}</label><div class="ob-lock"><input type="email" id="obEmail" value="${esc((S.user && S.user.email) || '')}" disabled aria-describedby="obEmailH">${LOCK}</div><div class="small muted" id="obEmailH">${t('ob_email_hint')}</div></div>
          <div class="f full"><label for="obNum">${t('ob_mobile')}</label><div class="ob-phone"><select id="obCc" aria-label="${esc(t('ob_country'))}">${CC.map(([c, r]) => `<option value="${c}" ${c === d.cc ? 'selected' : ''}>${esc(region(r))} (${c})</option>`).join('')}</select><input type="tel" id="obNum" value="${esc(d.num)}" inputmode="tel" autocomplete="tel-national" dir="ltr" aria-describedby="obErrPhone" placeholder="50 123 4567"></div><div class="small muted">${t('ob_mobile_hint')}</div><div class="ob-err" id="obErrPhone" role="alert"></div></div>
        </div>`;
      return `<h3 style="margin-bottom:4px">${t('ob_tools_h')}</h3><p class="muted" style="margin-top:0">${t('ob_tools_p')}</p><div class="conn-list" id="obConn"></div><p class="small muted" style="margin-bottom:0">${t('ob_tools_hint')}</p>`;
    }
    function draw() {
      m.setBody(bar() + `<div class="cw-body ob-body">${body()}</div>`);
      m.setFooter(step === 0 ? `<button class="btn" data-close>${t('ob_skip')}</button><button class="btn primary" id="obNext">${t('ob_start')}</button>`
        : `<button class="btn" id="obBack">${t('ob_back')}</button><button class="btn primary" id="obNext">${step === 2 ? icon('check') + t('ob_finish') : t('ob_continue')}</button>`);
      if (step === 2 && PM.connect) PM.connect.mountRows($('#obConn', m.el));
      const first = step === 1 ? m.$('#obName') : m.$('#obNext'); if (first) first.focus();
      if (step === 1) { [['#obName', '#obErrName'], ['#obNum', '#obErrPhone']].forEach(([i, e]) => { m.$(i).oninput = () => { m.$(i).setAttribute('aria-invalid', 'false'); m.$(e).textContent = ''; }; }); }
      const back = m.$('#obBack'); if (back) back.onclick = () => { read(); step--; draw(); };
      m.$('#obNext').onclick = next;
      m.el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); next(); } };
    }
    function read() { if (step === 1) { d.name = m.$('#obName').value.trim(); d.cc = m.$('#obCc').value; d.num = m.$('#obNum').value; } }
    async function next() {
      if (step === 1) {
        read();
        const errs = { name: d.name.length < 2 ? t('ob_err_name') : '', phone: '' };
        const digits = d.num.replace(/\D/g, '').replace(/^0+/, '');
        if (digits.length < 7 || digits.length > 12) errs.phone = t('ob_err_phone');
        m.$('#obErrName').textContent = errs.name; m.$('#obErrPhone').textContent = errs.phone;
        m.$('#obName').setAttribute('aria-invalid', errs.name ? 'true' : 'false'); m.$('#obNum').setAttribute('aria-invalid', errs.phone ? 'true' : 'false');
        if (errs.name) return m.$('#obName').focus();
        if (errs.phone) return m.$('#obNum').focus();
        const r = await PM.busy(m.$('#obNext'), () => PM.api('PUT', '/api/me', { name: d.name }));
        if (!r) return;
        S.user.name = r.user.name; O.phone = d.cc + digits; saveO();
        step = 2; return draw();
      }
      if (step === 0) { step = 1; return draw(); }
      O.done = true; saveO(); m.close();
      try { const me = await PM.api('GET', '/api/me'); S.status = me.status; } catch (e) { /* status refreshes on next load */ }
      PM.route(); await delay(500); tour();
    }
    draw();
  }

  // ---------- product tour ----------
  const TOUR = [
    { sel: '#ribbon', k: 'ribbon' },
    { sel: '.nav > a[href="#/"]', k: 'dash', side: true },
    { sel: '#navFly > a', k: 'projects', side: true },
    { sel: '.nav > a[href="#/calendar"]', k: 'calendar', side: true },
    { sel: '#newProj', k: 'new' },
    { sel: '.nav > a[href="#/billing"]', k: 'billing', side: true },
    { sel: '.user-chip', k: 'account', side: true },
    { sel: '.side-prefs', k: 'prefs', side: true },
  ];
  let tourEl = null;
  async function tour() {
    if (tourEl) return;
    if (!/^#\/?$/.test(location.hash)) location.hash = '#/';
    await waitFor('#newProj', 4000);
    const list = TOUR.filter((s) => $(s.sel)).concat([{ k: 'end', end: true }]);
    const mobile = () => window.matchMedia('(max-width: 820px)').matches;
    const rtl = () => document.documentElement.dir === 'rtl';
    const back = document.activeElement;
    const layer = document.createElement('div');
    layer.className = 'ob-tour';
    layer.innerHTML = '<div class="ob-shield"></div><div class="ob-spot" aria-hidden="true"></div><div class="ob-pop" role="dialog" aria-modal="true" aria-labelledby="obTT" tabindex="-1"></div>';
    document.body.appendChild(layer); tourEl = layer;
    const spot = $('.ob-spot', layer), pop = $('.ob-pop', layer);
    let idx = 0;
    function finish(go) {
      O.tour = true; saveO();
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', onFocus, true); window.removeEventListener('resize', onResize);
      const sh = $('.shell'); if (sh) sh.classList.remove('nav-open');
      layer.remove(); tourEl = null;
      if (go === 'create') PM.newProjectDialog();
      else if (go === 'explore') location.hash = S.projects[0] ? `#/p/${S.projects[0].id}/overview` : '#/projects';
      else if (back && back.isConnected) back.focus();
    }
    async function show(n) {
      idx = n; const s = list[n], sh = $('.shell');
      if (sh && mobile()) { sh.classList.toggle('nav-open', !!s.side); await delay(30); }
      const last = !!s.end;
      pop.innerHTML = last
        ? `<h3 id="obTT">${t('tour_end_t')}</h3><p>${t('tour_end_b')}</p><div class="ob-actions"><button class="btn" data-go="explore">${t('tour_explore')}</button><span class="grow"></span><button class="btn primary" data-go="create">${icon('plus')}${t('tour_create')}</button></div>`
        : `<div class="small muted">${t('tour_step', { n: String(n + 1), total: String(list.length - 1) })}</div><h3 id="obTT">${t('tour_' + s.k + '_t')}</h3><p>${t('tour_' + s.k + '_b')}</p><div class="ob-actions"><button class="btn ghost sm" data-act="skip">${t('tour_skip')}</button><span class="grow"></span>${n ? `<button class="btn sm" data-act="back">${t('tour_back')}</button>` : ''}<button class="btn primary sm" data-act="next">${t('tour_next')}</button></div>`;
      $$('[data-act]', pop).forEach((b) => (b.onclick = () => { const a = b.dataset.act; if (a === 'skip') finish(); else if (a === 'back') show(idx - 1); else show(idx + 1); }));
      $$('[data-go]', pop).forEach((b) => (b.onclick = () => finish(b.dataset.go)));
      const w = Math.min(340, innerWidth - 24); pop.style.width = w + 'px';
      const h = pop.offsetHeight;
      let x, y;
      if (last) {
        spot.style.cssText = `left:${innerWidth / 2}px;top:${innerHeight / 2}px;width:0;height:0`;
        x = (innerWidth - w) / 2; y = (innerHeight - h) / 2;
      } else {
        const el = $(s.sel); el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect(), pad = 6;
        spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
        const below = () => { x = r.left + r.width / 2 - w / 2; y = r.bottom + pad + 12; if (y + h > innerHeight - 12) y = r.top - pad - 12 - h; };
        if (s.side) { x = rtl() ? r.left - pad - 14 - w : r.right + pad + 14; y = r.top + r.height / 2 - h / 2; if (x < 12 || x + w > innerWidth - 12) below(); } else below();
      }
      pop.style.left = clamp(x, 12, innerWidth - w - 12) + 'px'; pop.style.top = clamp(y, 12, innerHeight - h - 12) + 'px';
      const primary = $('.btn.primary', pop); if (primary) primary.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const fwd = (e.key === 'ArrowRight') !== rtl();
        if (fwd && idx < list.length - 1) show(idx + 1); else if (!fwd && idx > 0) show(idx - 1);
      }
    }
    function onFocus(e) { if (!pop.contains(e.target)) { const p = $('.btn.primary', pop); if (p) p.focus(); } }
    let rt; function onResize() { clearTimeout(rt); rt = setTimeout(() => show(idx), 120); }
    document.addEventListener('keydown', onKey, true); document.addEventListener('focusin', onFocus, true); window.addEventListener('resize', onResize);
    show(0);
  }

  // ---------- billing page ----------
  PM.views.billing = async function () {
    await PM.loadProjects();
    PM.shell('billing', '<div class="page" id="billingPage"></div>');
    redraw = draw; draw();
  };
  const expand = { use: false, inv: false };
  function draw() {
    const host = $('#billingPage'); if (!host) return;
    const i = info();
    const chip = i.expired ? `<span class="chip red">${t('bl_ended')}</span>` : i.paid ? `<span class="chip green">${icon('check')}${t('bl_active')}</span>` : `<span class="chip blue">${t('bl_trial')}</span>`;
    const when = i.expired ? t('bl_ended_on', { date: dfmt(i.end) }) : i.paid && B.auto ? t('bl_renews', { date: dfmt(i.end) }) : t('bl_ends', { date: dfmt(i.end) });
    const started = t('bl_started', { date: dfmt(i.paid ? B.paidAt : B.trialStart) });
    const meterTone = i.pct >= 100 ? 'red' : i.pct >= 80 ? 'amber' : '';
    const useRows = Object.entries(B.usage).sort((a, b) => b[0].localeCompare(a[0]));
    const shownUse = expand.use ? useRows : useRows.slice(0, 5);
    const maxUse = Math.max(1, ...useRows.map((r) => r[1]));
    const invRows = expand.inv ? B.invoices : B.invoices.slice(0, 5);
    const toggle = (k, n) => (n > 5 ? `<button type="button" class="btn ghost sm mt" data-more="${k}">${t(expand[k] ? 'bl_less' : 'bl_more')}</button>` : '');
    host.innerHTML = `<div class="page-head"><h1>${t('bl_title')}</h1>${i.paid && !i.expired ? '' : `<button type="button" class="btn primary" data-subscribe>${icon('coin')}${t('bl_sub_cta')}</button>`}</div>
      <div class="bl-grid">
        <section class="card"><div class="card-head"><h3>${t('bl_plan')}</h3>${chip}</div>
          <div class="bl-metric" id="blDays">${num(i.days)}</div><div class="small muted">${t('bl_days_left')}</div>
          <p class="small muted" style="margin:12px 0 0">${started}. ${when}.</p>
          <p style="margin:12px 0 0"><b dir="ltr">${t('bl_price')}</b><br><span class="muted">${t('bl_includes')}</span></p>
          ${i.paid ? `<div class="row mt"><span class="grow">${t('bl_auto')}</span><button type="button" class="tgl ${B.auto ? 'on' : ''}" id="blAuto" role="switch" aria-checked="${B.auto}" aria-label="${esc(t('bl_auto'))}"><i></i></button></div>` : ''}
        </section>
        <section class="card"><div class="card-head"><h3>${t('bl_tokens')}</h3></div>
          <div class="bl-metric">${tok(B.tokens)}</div><div class="small muted">${esc(t('rb_tokens_of', { used: t('bl_used'), limit: tok(LIMIT) }))}</div>
          <div class="progress ${meterTone === 'red' ? '' : ''} bl-meter ${meterTone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${i.pct}" aria-label="${esc(t('bl_tokens'))}"><i style="width:${i.pct}%"></i></div>
          <div class="row small muted"><span class="grow">${esc(t('bl_remaining', { n: tok(i.tokensLeft) }))}</span><span>${esc(t(i.paid ? 'bl_reset' : 'bl_ends', { date: dfmt(i.end) }))}</span></div>
          <div class="sub" style="font-weight:600;margin:14px 0 4px">${t('bl_uses_h')}</div>
          <ul class="bl-uses">${['bl_u1', 'bl_u2', 'bl_u3', 'bl_u4'].map((k) => `<li>${t(k)}</li>`).join('')}</ul>
        </section>
      </div>
      <section class="card mt"><div class="card-head"><h3>${t('bl_daily')}</h3></div>${useRows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>${t('bl_day')}</th><th>${t('bl_tokens_col')}</th><th aria-hidden="true"></th></tr></thead><tbody>${shownUse.map(([k, v]) => `<tr><td class="nowrap">${dfmt(Date.parse(k + 'T12:00:00Z'))}</td><td class="nowrap" style="font-variant-numeric:tabular-nums">${num(v)}</td><td style="min-width:120px"><div class="progress"><i style="width:${Math.round((v / maxUse) * 100)}%"></i></div></td></tr>`).join('')}</tbody></table></div>${toggle('use', useRows.length)}` : `<p class="small muted" style="margin:0">${t('bl_daily_empty')}</p>`}</section>
      <section class="card mt"><div class="card-head"><h3>${t('bl_inv')}</h3></div>${B.invoices.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>${t('bl_inv_no')}</th><th>${t('bl_inv_date')}</th><th>${t('bl_inv_amt')}</th><th></th></tr></thead><tbody>${invRows.map((v) => `<tr><td>${esc(v.no)}</td><td class="nowrap">${dfmt(v.at)}</td><td dir="ltr" style="text-align:start">$${v.amount}.00</td><td><span class="chip green">${t('bl_paid')}</span></td></tr>`).join('')}</tbody></table></div>${toggle('inv', B.invoices.length)}` : `<p class="small muted" style="margin:0">${t('bl_inv_empty')}</p>`}</section>
      <section class="card mt"><div class="card-head"><h3>${t('bl_demo_h')}</h3><span class="chip amber">Demo</span></div><p class="small muted" style="margin-top:0">${t('bl_demo_p')}</p>
        <div class="form-grid"><label class="f">${t('bl_demo_days')}<select id="dmDays">${[15, 10, 5, 3, 2, 1, 0].map((d) => `<option value="${d}" ${d === i.days ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="f">${t('bl_demo_tokens')}<select id="dmTok">${[0, 50, 80, 100].map((p) => `<option value="${p}" ${p === i.pct || (p === 50 && i.pct > 0 && i.pct < 80 && ![0, 80, 100].includes(i.pct)) ? 'selected' : ''}>${p}%</option>`).join('')}</select></label></div>
        <div class="row mt"><button type="button" class="btn" id="dmReset">${t('bl_demo_reset')}</button></div></section>`;
    $$('[data-subscribe]', host).forEach((b) => (b.onclick = () => subscribe()));
    $$('[data-more]', host).forEach((b) => (b.onclick = () => { expand[b.dataset.more] = !expand[b.dataset.more]; draw(); }));
    const auto = $('#blAuto', host);
    if (auto) auto.onclick = () => {
      const prev = B.auto; B.auto = !B.auto; saveB();
      PM.toast(t(B.auto ? 'bl_auto_on' : 'bl_auto_off', { date: dfmt(info().end) }), '', { label: t('bl_undo'), fn: () => { B.auto = prev; saveB(); refresh(); } });
      refresh();
    };
    $('#dmDays', host).onchange = (e) => { const target = Number(e.target.value); B.shift = i.end - Date.now() - (target - 0.5) * DAY; saveB(); refresh(); };
    $('#dmTok', host).onchange = (e) => {
      const p = Number(e.target.value); B.tokens = Math.round((LIMIT * p) / 100); B.warned = p >= 100 ? 2 : p >= 80 ? 1 : 0; B.usage = {};
      if (B.tokens) [0.1, 0.15, 0.2, 0.25, 0.3].forEach((w, n) => { B.usage[dkey(now() - (4 - n) * DAY)] = Math.round(B.tokens * w); });
      saveB(); refresh();
    };
    $('#dmReset', host).onclick = () => { B = freshBilling(); saveB(); refresh(); };
  }

  // ---------- first load gate ----------
  let gated = false;
  function gate() {
    if (gated) return; gated = true;
    (async () => {
      await waitFor('.shell', 5000); await delay(400);
      if (!O.done) wizard(); else if (info().expired) subscribe({ expired: !info().paid });
    })();
  }
  function reset() { ['pm_billing', 'pm_onboard'].forEach((k) => { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }); }

  PM.billing = { ribbon, bind: bindRibbon, refresh, subscribe, info };
  PM.onboard = { gate, wizard, tour, banner, bind, accountCards, bindAccount, phone: () => O.phone, validatePhone, savePhone, reset };
})();
