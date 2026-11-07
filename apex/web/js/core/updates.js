/**
 * التحديثات — نسخة Oracle APEX
 * APEX يغيّر رابط الملفات مع كل استيراد جديد للتطبيق (رقم الإصدار في الرابط)،
 * فيحصل المتصفح على الملفات الجديدة تلقائياً ولا حاجة لفحص version.json كما في GitHub Pages.
 */
export async function checkOnStart() { return false; }
export function watchUpdates() {}
