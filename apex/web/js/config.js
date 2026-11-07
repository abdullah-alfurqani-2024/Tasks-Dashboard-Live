/**
 * إعدادات النظام — نسخة Oracle APEX
 * (تحل محل js/config.js عند بناء تطبيق APEX بالأداة apex/tools/build.mjs، ولا تؤثر على نسخة Supabase)
 *
 * الواجهة نفسها تعمل داخل صفحة APEX، والبيانات من قاعدة Oracle عبر المحوّل js/data/apex/.
 * الدخول والجلسة من APEX نفسها (صفحة الدخول 9999)، فلا توجد مفاتيح أو روابط خوادم هنا.
 */

const envEl = typeof document !== 'undefined' ? document.getElementById('st-env') : null;
const logoutEl = envEl?.querySelector('a[data-logout]');

export const CONFIG = {
  appName: 'نظام مهام الدعم الفني والصيانة',
  orgName: 'قسم الدعم الفني والصيانة',
  // نسخة APEX للتجربة: يظهر شريط التجربة، ويتاح «الدخول بحساب مستخدم»
  env: 'staging',
  envLabel: 'نسخة Oracle APEX التجريبية — البيانات هنا ليست بيانات القسم الحقيقية',
  storagePrefix: 'tsk.apex.',
  backend: 'apex',
  apex: {
    logoutUrl: logoutEl?.href || '',          // رابط الخروج من APEX (يعود لصفحة الدخول)
    process: 'API',                           // Application Process الذي يستقبل كل الطلبات
  },
  // للعرض في «معلومات النظام» في صفحة الإعدادات (يُملأ اسم الـ Schema بعد الدخول)
  supabase: { schema: '', url: typeof location !== 'undefined' ? location.host : '' },
  // مصدر «تحديث بيانات التجربة من الإنتاج»: نظام الإنتاج على Supabase (مفتاح عام، والقراءة بحساب مدير النظام هناك)
  production: {
    url: 'https://lklbdvepqvmvagjjedht.supabase.co',
    anonKey: 'sb_publishable_cnWw7HvKe54fr6wWlouOAw_WtfNoCAJ',
    schema: 'support_tasks',
    loginFunction: 'auth-login',
  },
  timeZone: 'Asia/Muscat',
};
