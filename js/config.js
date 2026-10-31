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
    url: '',        // مثال: 'https://abcdefghijkl.supabase.co'
    anonKey: '',    // المفتاح العام: anon public (أو Publishable key في المشاريع الجديدة)
    schema: 'support_tasks', // السكيما التي فيها جداول النظام (يجب إضافتها في Exposed schemas)
  },
  timeZone: 'Asia/Muscat',
};
