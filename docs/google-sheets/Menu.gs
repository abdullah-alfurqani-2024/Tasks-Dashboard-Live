/**
 * ============================================================
 *  Menu.gs — قائمة «إدارة المهندسين» في الملف الرئيسي
 * ============================================================
 *  المشروع يقبل دالة onOpen واحدة فقط. لذلك لا توجد هنا onOpen،
 *  بل أضف هذا السطر داخل دالة onOpen الموجودة عندك (مع قائمة «التقارير الشهرية»):
 *
 *      engineersMenu();
 *
 *  وإن لم تكن عندك onOpen أصلاً، أزل علامتي التعليق عن الدالة في آخر هذا الملف.
 * ============================================================
 */

function engineersMenu() {
  SpreadsheetApp.getUi()
    .createMenu('إدارة المهندسين')
    .addItem('تحديث المهندسين والربط', 'syncEngineers')
    .addItem('مزامنة القوائم (بعد تعديل Lists)', 'syncListsFromMaster')
    .addItem('فحص الربط', 'checkMasterFeed')
    .addSeparator()
    .addItem('ربط الملفات الحالية: فحص ومعاينة', 'previewLinkFiles')
    .addItem('ربط الملفات الحالية: تنفيذ', 'linkExistingFiles')
    .addSeparator()
    .addItem('تفعيل التحديث التلقائي كل ساعة', 'installAutoSync')
    .addItem('إيقاف التحديث التلقائي', 'removeAutoSync')
    .addSeparator()
    .addItem('رمز المهمة: معاينة', 'previewTaskCodes')
    .addItem('رمز المهمة: تجهيز (مرة واحدة)', 'setupTaskCodes')
    .addItem('ترقيم المهام وفحص التكرار', 'assignTaskCodes')
    .addItem('تفعيل الترقيم التلقائي كل ساعة', 'installTaskCodesTrigger')
    .addItem('إيقاف الترقيم التلقائي', 'removeTaskCodesTrigger')
    .addToUi();
}

// function onOpen() {
//   engineersMenu();
// }
