/** الإعدادات العامة وقيمها الافتراضية (نفس القيم في قاعدة البيانات ودالة admin-users) */

/** أقل طول تقبله خدمة الدخول في Supabase نفسها، ولا يمكن النزول عنه */
export const PW_FLOOR = 6;

export const SETTING_DEFAULTS = {
  editLockDays: 0,             // قفل تعديل المهمة المكتملة للمهندس بعد عدد أيام (0 = بدون قفل)
  delayThresholdDays: 7,       // المهمة المفتوحة أطول من هذا تُعد متأخرة
  minPasswordLength: PW_FLOOR, // أقل طول لكلمة المرور
  forcePasswordChange: true,   // إلزام تغيير كلمة المرور المؤقتة عند أول دخول
};

const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.trunc(Number(v)) : d);

export function normalizeSettings(s = {}) {
  const D = SETTING_DEFAULTS;
  return {
    editLockDays: Math.max(0, int(s.editLockDays, D.editLockDays)),
    delayThresholdDays: Math.max(1, int(s.delayThresholdDays, D.delayThresholdDays)),
    minPasswordLength: Math.min(72, Math.max(PW_FLOOR, int(s.minPasswordLength, D.minPasswordLength))),
    forcePasswordChange: s.forcePasswordChange == null ? D.forcePasswordChange : s.forcePasswordChange === true || s.forcePasswordChange === 'true',
  };
}
