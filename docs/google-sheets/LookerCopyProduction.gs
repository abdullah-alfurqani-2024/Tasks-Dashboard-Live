// =====================================================================
//  نسخ Report إلى ملف لوكر — نسخة الإنتاج الحالية (copySheetsForLooker) بعد تعديلها
//  نفس اسم الدالة ونفس الإعدادات، فيبقى مؤقتها كما هو.
//
//  ما تغيّر عن السابق:
//   1. ينسخ صفوف المهام فقط (لا الصفوف الفارغة تحت نتيجة المعادلة حتى آخر الورقة).
//   2. يمسح كل البقايا القديمة في الوجهة (حتى آخر صف)، لا بقدر البيانات الجديدة فقط.
//   3. يضيف صفوفاً للوجهة إن لم تتسع، ويقصّ الصفوف الفارغة تحت آخر صف بعد كل نسخ.
//   4. إن كانت Report في المصدر تعرض «لا توجد بيانات» أو خطأ، لا يمس الوجهة ويسجّل تحذيراً،
//      فلا يُمسح لوكر بسبب عطل مؤقت في المصدر.
// =====================================================================

function copySheetsForLooker() {
  // ==== CONFIG ====
  var SOURCE_FILE_ID = 'ضع_معرّف_المصدر';   // source file === (Data-Processing-Live)
  var DEST_FILE_ID   = 'ضع_معرّف_لوكر';     // destination (formatted) file === (Tasks-Reports-Looker-Live)

  // Each entry: {sheet: "SheetName", sourceRange: "B37:N", destStart: "B2"}
  var SHEETS_TO_COPY = [
    { sheet: 'Report', sourceRange: 'B37:N', destStart: 'B2' }
  ];
  // ==================

  var lock = LockService.getScriptLock();   // لا يعمل في نفس لحظة التنظيف أو الترميز في هذا المشروع
  if (!lock.tryLock(120000)) { Logger.log('تشغيل آخر قيد العمل، أُجّل نسخ لوكر.'); return; }
  try {
    var source = SpreadsheetApp.openById(SOURCE_FILE_ID);
    var dest = SpreadsheetApp.openById(DEST_FILE_ID);

    SHEETS_TO_COPY.forEach(function (config) {
      var s = source.getSheetByName(config.sheet);
      var d = dest.getSheetByName(config.sheet);
      if (!s || !d) { Logger.log('لا توجد ورقة ' + config.sheet + ' في أحد الملفين.'); return; }

      var data = s.getRange(config.sourceRange).getValues();
      var first = data.length ? String(data[0][0]).trim() : '';
      if (!first || first === 'لا توجد بيانات' || first.charAt(0) === '#') {
        Logger.log('⚠ المصدر يعرض «' + (first || 'فارغ') + '» في أول خلية، لم يُنسخ شيء ولم تُمس الوجهة.');
        return;
      }
      // صفوف المهام فقط
      var rows = data.filter(function (r) {
        return r.some(function (v) { return v instanceof Date || String(v).trim() !== ''; });
      });
      var width = data[0].length;

      var destCell = d.getRange(config.destStart);
      var row = destCell.getRow(), col = destCell.getColumn();

      // مسح كل المحتوى القديم (التنسيق يبقى)
      var last = d.getLastRow();
      if (last >= row) d.getRange(row, col, last - row + 1, width).clearContent();
      // صفوف إضافية إن لم تتسع الوجهة
      var need = row + rows.length - 1;
      if (d.getMaxRows() < need) d.insertRowsAfter(d.getMaxRows(), need - d.getMaxRows());
      if (rows.length) d.getRange(row, col, rows.length, width).setValues(rows);
      // قصّ الصفوف الفارغة تحت آخر صف (ملف قيم فقط، فلا حاجة لاحتياطي: النسخ التالي يضيف إن احتاج)
      var keep = Math.max(need, row);
      if (d.getMaxRows() > keep) d.deleteRows(keep + 1, d.getMaxRows() - keep);
      Logger.log('نُسخ ' + rows.length + ' صفاً إلى ' + dest.getName() + ' ‹ ' + config.sheet);
    });
  } finally {
    lock.releaseLock();
  }
}
