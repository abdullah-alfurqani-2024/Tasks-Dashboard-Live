/**
 * إعدادات النظام — الملف الوحيد الذي يُعدَّل عند التركيب
 *
 * backend:
 *   'supabase' ← قاعدة البيانات الحقيقية (اكتب url و anonKey من Supabase ← Project Settings ← API)
 *   'demo'     ← وضع تجريبي ببيانات وهمية داخل المتصفح، بدون قاعدة بيانات
 * إذا تُرك url فارغاً يعمل النظام في الوضع التجريبي تلقائياً.
 *
 * anonKey مفتاح عام مصمَّم ليوضع في المتصفح، والحماية بصلاحيات قاعدة البيانات (RLS).
 * لا تضع هنا مفتاح service_role أبداً.
 */
export const CONFIG = {
  appName: 'نظام مهام الدعم الفني',
  orgName: 'قسم الدعم الفني',
  backend: 'supabase',
  supabase: {
    url: 'https://pfarespmmaphtlscgmar.supabase.co',
    anonKey: 'sb_publishable_1AEljmkY7c2yqSzwNCDuQQ_ggBQvJqI', // المفتاح العام (Publishable) — آمن في المتصفح
    schema: 'support_tasks', // السكيما التي فيها جداول النظام (يجب إضافتها في Exposed schemas)
  },
  timeZone: 'Asia/Muscat',
};
