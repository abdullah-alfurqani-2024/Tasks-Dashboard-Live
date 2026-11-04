/** الإعدادات العامة وقيمها الافتراضية (نفس القيم في قاعدة البيانات ودالة admin-users) */

/** أقل طول تقبله خدمة الدخول في Supabase نفسها، ولا يمكن النزول عنه */
export const PW_FLOOR = 6;

export const SETTING_DEFAULTS = {
  editLockDays: 0,             // قفل تعديل المهمة المكتملة للمهندس بعد عدد أيام (0 = بدون قفل)
  delayThresholdDays: 7,       // المهمة المفتوحة أطول من هذا تُعد متأخرة
  minPasswordLength: PW_FLOOR, // أقل طول لكلمة المرور
  forcePasswordChange: true,   // إلزام تغيير كلمة المرور المؤقتة عند أول دخول
  allowPurgeTasks: false,      // السماح بـ«حذف كل المهام» في الإنتاج (مرحلة التجهيز فقط)
  announcement: '',            // إعلان من مدير النظام يظهر لكل المستخدمين (فارغ = لا إعلان)
  announcementType: 'normal',  // normal: يستطيع المستخدم إخفاءه — important: لا يُخفى حتى يمسحه المدير
  announcementExpiresAt: '',   // تاريخ ووقت (ISO) يختفي بعده الإعلان تلقائياً ('' = بلا انتهاء)
};

export const ANNOUNCEMENT_MAX = 500;

const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.trunc(Number(v)) : d);

export function normalizeSettings(s = {}) {
  const D = SETTING_DEFAULTS;
  return {
    editLockDays: Math.max(0, int(s.editLockDays, D.editLockDays)),
    delayThresholdDays: Math.max(1, int(s.delayThresholdDays, D.delayThresholdDays)),
    minPasswordLength: Math.min(72, Math.max(PW_FLOOR, int(s.minPasswordLength, D.minPasswordLength))),
    forcePasswordChange: s.forcePasswordChange == null ? D.forcePasswordChange : s.forcePasswordChange === true || s.forcePasswordChange === 'true',
    allowPurgeTasks: s.allowPurgeTasks == null ? D.allowPurgeTasks : s.allowPurgeTasks === true || s.allowPurgeTasks === 'true',
    announcement: typeof s.announcement === 'string' ? s.announcement.trim().slice(0, ANNOUNCEMENT_MAX) : D.announcement,
    announcementType: s.announcementType === 'important' ? 'important' : 'normal',
    announcementExpiresAt: typeof s.announcementExpiresAt === 'string' && !Number.isNaN(Date.parse(s.announcementExpiresAt)) ? new Date(s.announcementExpiresAt).toISOString() : '',
  };
}

/** الإعلان الظاهر الآن: نصه ونوعه، أو null إن لم يوجد أو انتهى وقته */
export function activeAnnouncement(s, now = Date.now()) {
  if (!s?.announcement) return null;
  if (s.announcementExpiresAt && Date.parse(s.announcementExpiresAt) <= now) return null;
  return { text: s.announcement, type: s.announcementType === 'important' ? 'important' : 'normal', expiresAt: s.announcementExpiresAt || '' };
}
