/**
 * إعدادات النظام
 *
 * نسختان من نفس الكود في مستودع واحد، ويعرف النظام نسخته من رابط الموقع تلقائياً:
 *   الإنتاج  ← abdullah-alfurqani-2024.github.io/Tasks-Dashboard-Live/        (الفرع main)
 *   التجربة  ← abdullah-alfurqani-2024.github.io/Tasks-Dashboard-Live/test/   (الفرع staging)
 *             وأي رابط آخر (جهاز المطوّر…) يُعامل كتجربة
 * فلا يلزم تعديل هذا الملف عند نقل تحديث من التجربة إلى الإنتاج.
 *
 * لكل نسخة مشروع Supabase مستقل (حسابات دخول وكلمات مرور مستقلة تماماً).
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
};

const host = typeof location !== 'undefined' ? location.hostname : '';
const path = typeof location !== 'undefined' ? location.pathname : '';
// التجربة منشورة داخل موقع الإنتاج في المجلد /test/ فنفرّق بالمسار أيضاً
const underTest = /\/test(\/|$)/.test(path);
const envName = ENVIRONMENTS.production.hosts.includes(host) && !underTest ? 'production' : 'staging';
const env = ENVIRONMENTS[envName];

export const CONFIG = {
  appName: 'نظام مهام الدعم الفني والصيانة',
  orgName: 'قسم الدعم الفني والصيانة',
  env: envName,                 // 'production' | 'staging'
  envLabel: env.label,          // شريط يظهر أعلى الصفحة في نسخة التجربة
  // النسختان على نفس الموقع: لكل نسخة مفاتيح تخزين مستقلة في المتصفح (جلسة الدخول والفلاتر)
  storagePrefix: envName === 'production' ? 'tsk.' : 'tsk.stg.',
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
