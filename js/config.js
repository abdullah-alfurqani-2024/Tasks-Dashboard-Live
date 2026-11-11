/**
 * إعدادات النظام
 *
 * ثلاث نسخ من نفس الكود في مستودع واحد، ويعرف النظام نسخته من رابط الموقع تلقائياً:
 *   الإنتاج  ← abdullah-alfurqani-2024.github.io/Tasks-Dashboard-Live/        (الفرع main)
 *   التجربة  ← abdullah-alfurqani-2024.github.io/Tasks-Dashboard-Live/test/   (الفرع staging)
 *   التطوير  ← abdullah-alfurqani-2024.github.io/Tasks-Dashboard-Live/dev/    (الفرع dev: التعديلات الجذرية)
 *             وأي رابط آخر (جهاز المطوّر…) يُعامل كتجربة
 *   المسار يُفحص قبل النطاق: /dev/ و/test/ لا يمكن أن تُعامل كإنتاج أبداً
 * فلا يلزم تعديل هذا الملف عند نقل تحديث من التجربة إلى الإنتاج.
 *
 * الإنتاج في مشروع Supabase مستقل. التجربة والتطوير في مشروع Tasks-Test، كل منهما في سكيما مستقلة.
 *
 * backend:
 *   'supabase' ← قاعدة البيانات الحقيقية
 *   'demo'     ← بيانات وهمية داخل المتصفح بدون قاعدة بيانات (يعمل تلقائياً إذا تُرك url فارغاً)
 *
 * anonKey مفتاح عام مصمَّم ليوضع في المتصفح، والحماية بصلاحيات قاعدة البيانات (RLS).
 * لا تضع هنا مفتاح service_role أبداً.
 */

const ENVIRONMENTS = {
  production: {
    hosts: ['abdullah-alfurqani-2024.github.io'],
    label: '',
    url: 'https://lklbdvepqvmvagjjedht.supabase.co',                 // مشروع الإنتاج
    anonKey: 'sb_publishable_cnWw7HvKe54fr6wWlouOAw_WtfNoCAJ',
    schema: 'support_tasks',               // سكيما البيانات الحقيقية
    adminFunction: 'admin-users',          // دالة إدارة المستخدمين للإنتاج
    loginFunction: 'auth-login',           // دالة الدخول بالرقم للإنتاج
  },
  staging: {
    hosts: [],                             // الافتراضي لكل رابط غير الإنتاج
    label: 'نسخة التجربة — البيانات هنا ليست بيانات القسم الحقيقية',
    url: 'https://iwawaoweyldzqtuyzbyt.supabase.co',                 // مشروع التجربة (Tasks-Test)
    anonKey: 'sb_publishable_il_y9CA-Zc18ioM2WDZ8mg_TaOieIyN',
    schema: 'support_tasks_staging',
    adminFunction: 'admin-users-staging',
    loginFunction: 'auth-login-staging',
    refreshFunction: 'refresh-staging',    // نسخ بيانات الإنتاج إلى التجربة (دالة في مشروع التجربة)
  },
  dev: {
    hosts: [],
    label: 'نسخة التطوير — للتعديلات الجذرية قبل التجربة، والبيانات ليست بيانات القسم الحقيقية',
    url: 'https://iwawaoweyldzqtuyzbyt.supabase.co',                 // نفس مشروع التجربة (Tasks-Test)
    anonKey: 'sb_publishable_il_y9CA-Zc18ioM2WDZ8mg_TaOieIyN',
    schema: 'support_tasks_dev',           // سكيما مستقلة عن التجربة
    adminFunction: 'admin-users-dev',
    loginFunction: 'auth-login-dev',
    refreshFunction: 'refresh-dev',
  },
};

const host = typeof location !== 'undefined' ? location.hostname : '';
const path = typeof location !== 'undefined' ? location.pathname : '';
// التجربة والتطوير منشورتان داخل موقع الإنتاج في /test/ و/dev/: المسار أولاً ثم النطاق
const underDev = /\/dev(\/|$)/.test(path);
const underTest = /\/test(\/|$)/.test(path);
const envName = underDev ? 'dev'
  : !underTest && ENVIRONMENTS.production.hosts.includes(host) ? 'production'
  : 'staging';
const env = ENVIRONMENTS[envName];
const ENV_NAMES = { production: 'الإنتاج', staging: 'التجربة', dev: 'التطوير' };

export const CONFIG = {
  appName: 'نظام مهام الدعم الفني والصيانة',
  orgName: 'قسم الدعم الفني والصيانة',
  env: envName,                 // 'production' | 'staging' | 'dev'
  envName: ENV_NAMES[envName],  // الاسم العربي للنسخة
  isTest: envName !== 'production',   // التجربة والتطوير: أدوات التجربة متاحة (الدخول بحساب، نسخ البيانات، الحذف بلا قفل)
  envLabel: env.label,          // شريط يظهر أعلى الصفحة في نسختي التجربة والتطوير
  // النسخ على نفس الموقع: لكل نسخة مفاتيح تخزين مستقلة في المتصفح (جلسة الدخول والفلاتر)
  storagePrefix: { production: 'tsk.', staging: 'tsk.stg.', dev: 'tsk.dev.' }[envName],
  backend: 'supabase',
  supabase: {
    url: env.url,
    anonKey: env.anonKey,               // المفتاح العام (Publishable) — آمن في المتصفح
    schema: env.schema,                 // يجب إضافتها في Supabase ← Data API ← Exposed schemas
    adminFunction: env.adminFunction,   // Edge Function لإدارة المستخدمين
    loginFunction: env.loginFunction,   // Edge Function للدخول بالرقم المدني/الوظيفي
    refreshFunction: env.refreshFunction || '',
  },
  timeZone: 'Asia/Muscat',
};
