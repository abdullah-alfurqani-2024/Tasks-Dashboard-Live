#!/usr/bin/env node
/**
 * بناء تطبيق Oracle APEX من واجهة النظام الحالية
 *
 *   node apex/tools/build.mjs
 *
 * المدخلات:
 *   apex/build/base_f116280.sql   تصدير التطبيق الفارغ من APEX (كما أنشأه APEX)
 *   ملفات الواجهة في جذر المستودع  (css/ fonts/ js/) — نفس ملفات نسخة Supabase، بلا أي تعديل عليها
 *   apex/web/                      ملفات نسخة APEX التي تحل محل نظيراتها (الإعدادات، المحوّل، الدخول…)
 *
 * المخرج:
 *   apex/f116280.sql              تطبيق APEX كامل، يُستورد من App Builder ← Import
 *
 * أي تحديث للواجهة في نسخة Supabase ينتقل إلى APEX بإعادة تشغيل هذا الملف ثم استيراد الناتج.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APEX = join(HERE, '..');
const ROOT = join(APEX, '..');
const WEB = join(APEX, 'web');
const BASE = join(APEX, 'build', 'base_f116280.sql');
const OUT = join(APEX, 'f116280.sql');

const { VERSION } = await import(join(ROOT, 'js', 'version.js'));
const { icon } = await import(join(ROOT, 'js', 'ui', 'icons.js'));

/* ───────────── الملفات ───────────── */

// من نسخة Supabase: كل ملفات الواجهة عدا ما يخص Supabase أو الوضع التجريبي أو يُستبدل
const SKIP = new Set([
  'index.html', 'js/data/contract.js',
  'js/config.js', 'js/data/index.js', 'js/core/updates.js', 'js/pages/login.js',
]);
const versionInfo = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8'));
const files = new Map();   // المسار داخل التطبيق ← المحتوى (Buffer)
for (const f of versionInfo.files) {
  if (SKIP.has(f) || f.startsWith('js/data/supabase/') || f.startsWith('js/data/demo/')) continue;
  files.set(f, readFileSync(join(ROOT, f)));
}
for (const f of readdirSync(join(ROOT, 'fonts'))) if (f.endsWith('.woff2')) files.set(`fonts/${f}`, readFileSync(join(ROOT, 'fonts', f)));

// ملفات نسخة APEX (تحل محل نظيراتها أو تُضاف)
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
for (const p of walk(WEB)) files.set(relative(WEB, p).split('\\').join('/'), readFileSync(p));

// تعديلات نصية صغيرة على شاشات نسخة Supabase (نصوص تذكر Supabase). يتوقف البناء إذا تغيّر النص الأصلي
const PATCHES = [
  ['js/pages/users.js',
    "${isDemo ? '' : html`<div class=\"alert small\" style=\"margin-bottom:14px\">إضافة المستخدمين وتعطيلهم وإعادة كلمات المرور تتم عبر دالة <span class=\"ltr\">admin-users</span> على Supabase. إذا ظهر خطأ «غير منشورة» راجع دليل التركيب.</div>`}",
    ''],
  ['js/pages/users.js', 'أقصر من ${min} خانات (حد Supabase)،', 'أقصر من ${min} خانات،'],
  ['js/pages/settings.js',
    'أقل قيمة ممكنة ${PW_FLOOR}، وهو حد خدمة الدخول في Supabase ولا يمكن النزول عنه. إذا رفعتها هنا فارفعها أيضاً في Supabase ← Authentication ← Providers ← Email ← Minimum password length.',
    'أقل قيمة ممكنة ${PW_FLOOR}.'],
];
for (const [f, from, to] of PATCHES) {
  const text = files.get(f).toString('utf8');
  if (!text.includes(from)) throw new Error(`النص المطلوب تعديله لم يعد موجوداً في ${f}:\n${from}\nحدّث PATCHES في apex/tools/build.mjs`);
  files.set(f, Buffer.from(text.split(from).join(to), 'utf8'));
}

/* ───────────── أدوات ملف التصدير ───────────── */

let nextId = 11949500000000000000n;
const newId = () => String(nextId++);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** نص طويل ← wwv_flow_string.join (سطر لكل عنصر) */
const join_ = (text) => `wwv_flow_string.join(wwv_flow_t_varchar2(\n${text.split('\n').map(q).join(',\n')}))`;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png' };

function staticFile(path, buf) {
  const hex = buf.toString('hex').toUpperCase();
  const lines = [];
  for (let i = 0, n = 1; i < hex.length; i += 400, n++) lines.push(`wwv_flow_imp.g_varchar2_table(${n}) := '${hex.slice(i, i + 400)}';`);
  const mime = MIME[extname(path)] || 'application/octet-stream';
  return `prompt --application/shared_components/files/${path.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}
begin
wwv_flow_imp.g_varchar2_table := wwv_flow_imp.empty_varchar2_table;
${lines.join('\n')}
wwv_flow_imp_shared.create_app_static_file(
 p_id=>wwv_flow_imp.id(${newId()})
,p_file_name=>${q(path)}
,p_mime_type=>${q(mime)}
,p_file_charset=>'utf-8'
,p_file_content=>wwv_flow_imp.varchar2_to_blob(wwv_flow_imp.g_varchar2_table)
);
end;
/
`;
}

function replaceOnce(text, from, to, what) {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + from.length) >= 0) throw new Error(`لم أجد موضعاً واحداً لـ ${what} في ملف التصدير الأساسي`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

function between(text, startMarker, endMarker, replacement, what) {
  const a = text.indexOf(startMarker);
  const b = text.indexOf(endMarker, a + 1);
  if (a < 0 || b < 0) throw new Error(`لم أجد ${what} في ملف التصدير الأساسي`);
  return text.slice(0, a) + replacement + text.slice(b);
}

/* ───────────── أجزاء الصفحات ───────────── */

// رأس الصفحتين: الخط، والتنسيق، والاتجاه والوضع الليلي قبل الرسم
const HEAD = `<link rel="preload" href="#APP_FILES#fonts/noto-kufi-arabic-arabic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/earlyaccess/droidarabickufi.css">
<link rel="stylesheet" href="#APP_FILES#css/app.css" id="st-css">
<link rel="stylesheet" href="#APP_FILES#css/apex.css">
<link rel="stylesheet" href="#APP_FILES#css/print.css" media="print">
<meta name="theme-color" content="#1f5fa8">
<script>
(function () {
  var d = document.documentElement;
  d.lang = 'ar'; d.dir = 'rtl';
  try {
    var t = localStorage.getItem('tsk.theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    d.dataset.theme = t;
  } catch (e) { d.dataset.theme = 'light'; }
})();
</script>`;

// الصفحة 1: نفس index.html في نسخة Supabase.
// تُنقل الواجهة خارج نموذج APEX (wwvFlowForm)، لأن المتصفح يُسقط أي <form> داخل <form>،
// وشاشات النظام كلها مبنية على نماذج. ثم تُحمَّل js/app.js من ملفات التطبيق.
const APP_REGION = `<div id="st-shell">
  <div id="st-env" hidden><a data-logout href="&LOGOUT_URL."></a></div>
  <a class="skip" href="#main">تخطَّ إلى المحتوى</a>
  <header class="topbar" id="topbar" hidden></header>
  <div class="demo-banner" id="demo-banner" hidden></div>
  <div class="as-banner" id="as-banner" role="status" hidden></div>
  <div class="announce-banner" id="announce-banner" role="status" hidden></div>
  <main id="main" class="main" tabindex="-1">
    <div class="boot"><div class="spinner" aria-hidden="true"></div><p>جارٍ التحميل…</p></div>
  </main>
  <div id="modal-root"></div>
  <div id="toasts" class="toasts" role="status" aria-live="polite"></div>
</div>
<script>
(function () {
  document.body.appendChild(document.getElementById('st-shell'));
  var css = document.getElementById('st-css');
  var s = document.createElement('script');
  s.type = 'module';
  s.src = css.href.replace(/css\\/app\\.css(\\?.*)?$/, 'js/app.js');
  document.body.appendChild(s);
})();
</script>`;

// الصفحة 9999: نفس شاشة الدخول في نسخة Supabase. الفحص برسالة عربية (LOGIN_CHECK)،
// ثم تُرسل الصفحة إلى APEX بحقلي APEX الأصليين (مخفيين) فتنشئ الجلسة.
const LOGIN_REGION = `<template id="st-login-tpl">
  <div class="auth-wrap">
    <div class="card auth-card">
      <div class="brand"><span class="brand-mark">${icon('check')}</span><span>نظام مهام الدعم الفني والصيانة</span></div>
      <p class="lead">قسم الدعم الفني والصيانة</p>
      <form novalidate id="st-login-form">
        <div class="field"><label for="st-l-login">الرقم المدني أو الوظيفي</label>
          <input class="input ltr" style="display:block;text-align:left" id="st-l-login" type="text" inputmode="numeric" autocomplete="username" required autofocus>
          <span class="hint">أو البريد الإلكتروني إن كان مسجّلاً لحسابك.</span></div>
        <div class="field"><label for="st-l-pw">كلمة المرور</label>
          <div class="pw-wrap"><input class="input" id="st-l-pw" type="password" autocomplete="current-password" required>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-eye aria-label="إظهار كلمة المرور">${icon('eye')}</button></div></div>
        <div class="alert bad" id="st-l-err" role="alert" hidden></div>
        <button class="btn btn-primary btn-block" type="submit">دخول</button>
      </form>
    </div>
  </div>
</template>
<div id="st-login"></div>
<script>
(function () {
  var host = document.getElementById('st-login');
  host.appendChild(document.getElementById('st-login-tpl').content.cloneNode(true));
  document.body.appendChild(host);
  document.title = 'تسجيل الدخول — نظام مهام الدعم الفني والصيانة';
  var form = document.getElementById('st-login-form');
  var err = document.getElementById('st-l-err');
  var btn = form.querySelector('button[type=submit]');
  var EYE = ${JSON.stringify(String(icon('eye')))}, EYE_OFF = ${JSON.stringify(String(icon('eyeOff')))};
  function latin(s) { return String(s || '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }); }
  function show(m) { err.textContent = m; err.hidden = false; btn.disabled = false; }
  host.querySelector('[data-eye]').onclick = function (e) {
    var inp = document.getElementById('st-l-pw');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = inp.type === 'password' ? EYE : EYE_OFF;
  };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var login = latin(document.getElementById('st-l-login').value).trim();
    var pw = document.getElementById('st-l-pw').value;
    if (!login || !pw) { show('اكتب الرقم وكلمة المرور.'); return; }
    btn.disabled = true;
    apex.server.process('LOGIN_CHECK', { x01: login, x02: pw }, { dataType: 'text', loadingIndicator: null })
      .done(function (t) {
        var d; try { d = JSON.parse(t); } catch (x) { d = { error: 'تعذّر الاتصال بالخادم. حاول مرة أخرى.' }; }
        if (!d.ok) { show(d.error || 'تعذّر الدخول.'); return; }
        apex.item('P9999_USERNAME').setValue(login);
        apex.item('P9999_PASSWORD').setValue(pw);
        apex.submit({ request: 'LOGIN', showWait: true });
      })
      .fail(function () { show('تعذّر الاتصال بالخادم. تحقق من الإنترنت.'); });
  });
})();
</script>`;

/* ───────────── تجميع ملف التصدير ───────────── */

let out = readFileSync(BASE, 'utf8');
const AUTH_ID = newId();
const FILES_VERSION = Math.floor(Date.now() / 1000);

// 1) خصائص التطبيق: المصادقة المخصصة، واللغة العربية، ورقم نسخة الملفات (يجدد ذاكرة المتصفح)
out = replaceOnce(out, ',p_authentication_id=>wwv_flow_imp.id(11949440470417147460)', `,p_authentication_id=>wwv_flow_imp.id(${AUTH_ID})`, 'المصادقة');
out = replaceOnce(out, ",p_flow_language=>'en'", ",p_flow_language=>'ar'", 'اللغة');
out = out.replace(/,p_files_version=>\d+/, `,p_files_version=>${FILES_VERSION}`);
out = replaceOnce(out, ",p_flow_version=>'Release 1.0'", `,p_flow_version=>${q(`Release ${VERSION}-apex`)}`, 'رقم الإصدار');

// 2) ملفات الواجهة (Static Application Files)
const staticBlocks = [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, b]) => staticFile(p, b)).join('');
out = replaceOnce(out, 'prompt --application/shared_components/security/authorizations/administration_rights',
  staticBlocks + 'prompt --application/shared_components/security/authorizations/administration_rights', 'موضع الملفات');

// 3) العملية التي تستقبل كل طلبات الواجهة
const APP_PROCESS = `prompt --application/shared_components/logic/application_processes/api
begin
wwv_flow_imp_shared.create_flow_process(
 p_id=>wwv_flow_imp.id(${newId()})
,p_process_sequence=>1
,p_process_point=>'ON_DEMAND'
,p_process_type=>'NATIVE_PLSQL'
,p_process_name=>'API'
,p_process_sql_clob=>'st_api.ajax;'
,p_process_clob_language=>'PLSQL'
,p_security_scheme=>'MUST_NOT_BE_PUBLIC_USER'
);
end;
/
`;
out = replaceOnce(out, 'prompt --application/shared_components/logic/application_settings',
  APP_PROCESS + 'prompt --application/shared_components/logic/application_settings', 'موضع العملية');

// 4) المصادقة المخصصة: st_api.authenticate (الرقم أو البريد + كلمة المرور من جدول ST_PROFILES)
const AUTH = `prompt --application/shared_components/security/authentications/tasks_custom
begin
wwv_flow_imp_shared.create_authentication(
 p_id=>wwv_flow_imp.id(${AUTH_ID})
,p_name=>'Tasks Custom'
,p_static_id=>'tasks-custom'
,p_scheme_type=>'NATIVE_CUSTOM'
,p_attributes=>wwv_flow_t_plugin_attributes(wwv_flow_t_varchar2(
  'authentication_function', 'st_api.authenticate',
  'enable_legacy_attributes', 'N')).to_clob
,p_invalid_session_type=>'LOGIN'
,p_post_auth_process=>'st_api.post_auth'
,p_use_secure_cookie_yn=>'N'
,p_ras_mode=>0
);
end;
/
`;
out = replaceOnce(out, 'prompt --application/user_interfaces/combined_files', AUTH + 'prompt --application/user_interfaces/combined_files', 'موضع المصادقة');

// 5) الصفحة 1: الواجهة كاملة
const PAGE1 = `prompt --application/pages/page_00001
begin
wwv_flow_imp_page.create_page(
 p_id=>1
,p_name=>'Home'
,p_alias=>'HOME'
,p_step_title=>'نظام مهام الدعم الفني والصيانة'
,p_autocomplete_on_off=>'OFF'
,p_html_page_header=>${join_(HEAD)}
,p_step_template=>4075783602716660119
,p_page_template_options=>'#DEFAULT#'
,p_protection_level=>'C'
,p_page_component_map=>'11'
);
wwv_flow_imp_page.create_page_plug(
 p_id=>wwv_flow_imp.id(${newId()})
,p_plug_name=>'Tasks App'
,p_static_id=>'st-app'
,p_region_template_options=>'#DEFAULT#'
,p_escape_on_http_output=>'Y'
,p_plug_template=>4501440665235496320
,p_plug_display_sequence=>10
,p_plug_display_point=>'BODY'
,p_plug_source=>${join_(APP_REGION)}
,p_attributes=>wwv_flow_t_plugin_attributes(wwv_flow_t_varchar2(
  'expand_shortcuts', 'N',
  'output_as', 'HTML')).to_clob
);
end;
/
`;
out = between(out, 'prompt --application/pages/page_00001', 'prompt --application/pages/page_09999', PAGE1, 'الصفحة 1');

// 6) الصفحة 9999: تصميم الدخول، وفحص LOGIN_CHECK، وإخفاء منطقة APEX الأصلية (حقولها تبقى للإرسال)
const p9999 = out.indexOf('prompt --application/pages/page_09999');
let page = out.slice(p9999);
page = replaceOnce(page, ",p_step_title=>'Tasks-Dashboard-Apex - Log In'",
  `,p_step_title=>'تسجيل الدخول — نظام مهام الدعم الفني والصيانة'\n,p_html_page_header=>${join_(HEAD)}`, 'عنوان صفحة الدخول');
page = replaceOnce(page, ",p_plug_name=>'Tasks-Dashboard-Apex'", ",p_plug_name=>'Tasks-Dashboard-Apex'\n,p_region_css_classes=>'st-hidden'", 'منطقة الدخول الأصلية');
const LOGIN_PARTS = `wwv_flow_imp_page.create_page_plug(
 p_id=>wwv_flow_imp.id(${newId()})
,p_plug_name=>'Tasks Login'
,p_static_id=>'st-login-region'
,p_region_template_options=>'#DEFAULT#'
,p_escape_on_http_output=>'Y'
,p_plug_template=>4501440665235496320
,p_plug_display_sequence=>5
,p_plug_display_point=>'BODY'
,p_plug_source=>${join_(LOGIN_REGION)}
,p_attributes=>wwv_flow_t_plugin_attributes(wwv_flow_t_varchar2(
  'expand_shortcuts', 'N',
  'output_as', 'HTML')).to_clob
);
wwv_flow_imp_page.create_page_process(
 p_id=>wwv_flow_imp.id(${(() => { const id = newId(); return id; })()})
,p_process_sequence=>50
,p_process_point=>'ON_DEMAND'
,p_process_type=>'NATIVE_PLSQL'
,p_process_name=>'LOGIN_CHECK'
,p_static_id=>'login-check'
,p_process_sql_clob=>'st_api.login_check;'
,p_process_clob_language=>'PLSQL'
,p_error_display_location=>'INLINE_IN_NOTIFICATION'
);
`;
page = replaceOnce(page, 'wwv_flow_imp_page.create_page_button(', LOGIN_PARTS + 'wwv_flow_imp_page.create_page_button(', 'موضع أجزاء الدخول');
out = out.slice(0, p9999) + page;

writeFileSync(OUT, out, 'utf8');
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`✔ ${relative(ROOT, OUT)} (${kb(Buffer.byteLength(out))}) — ${files.size} ملفاً، الإصدار ${VERSION}، نسخة الملفات ${FILES_VERSION}`);
