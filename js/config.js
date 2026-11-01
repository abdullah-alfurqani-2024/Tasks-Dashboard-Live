/**
 * إعدادات النظام
 *
 * نسختان من نفس الكود، ويعرف النظام نسخته من رابط الموقع تلقائياً:
 *   الإنتاج  ← abdullah-alfurqani-2024.github.io  (موظفو القسم، البيانات الحقيقية)
 *   التجربة  ← أي رابط آخر (abdullah-alfurqani-2025.github.io، أو جهاز المطوّر)
 * فلا يلزم تعديل هذا الملف عند نقل تحديث من التجربة إلى الإنتاج.
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
    schema: 'support_tasks',               // سكيما البيانات الحقيقية
    adminFunction: 'admin-users',          // دالة إدارة المستخدمين للإنتاج
    loginFunction: 'auth-login',           // دالة الدخول بالرقم للإنتاج
  },
  staging: {
    hosts: [],                             // الافتراضي لكل رابط غير الإنتاج
    label: 'نسخة التجربة — البيانات هنا ليست بيانات القسم الحقيقية',
    schema: 'support_tasks_staging',
    adminFunction: 'admin-users-staging',
    loginFunction: 'auth-login-staging',
  },
};

const host = typeof location !== 'undefined' ? location.hostname : '';
const envName = ENVIRONMENTS.production.hosts.includes(host) ? 'production' : 'staging';
const env = ENVIRONMENTS[envName];

export const CONFIG = {
  appName: 'نظام مهام الدعم الفني',
  orgName: 'قسم الدعم الفني',
  env: envName,                 // 'production' | 'staging'
  envLabel: env.label,          // شريط يظهر أعلى الصفحة في نسخة التجربة
  backend: 'supabase',
  supabase: {
    url: 'https://pfarespmmaphtlscgmar.supabase.co',
    anonKey: 'sb_publishable_1AEljmkY7c2yqSzwNCDuQQ_ggBQvJqI', // المفتاح العام (Publishable) — آمن في المتصفح
    schema: env.schema,                 // يجب إضافتها في Supabase ← Data API ← Exposed schemas
    adminFunction: env.adminFunction,   // Edge Function لإدارة المستخدمين
    loginFunction: env.loginFunction,   // Edge Function للدخول بالرقم المدني/الوظيفي
  },
  timeZone: 'Asia/Muscat',
};
