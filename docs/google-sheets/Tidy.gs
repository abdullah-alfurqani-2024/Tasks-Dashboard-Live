// =====================================================================
//  Tidy.gs — تنظيف الصفوف الفارغة (للمظهر)، بأمان
//  يحل محل الدالة deleteEmptyRowsMultipleFiles السابقة بنفس اسمها، فيبقى مؤقتها كما هو.
//
//  لماذا لا يُقصّ كل شيء إلى آخر صف (كما كان السكربت السابق)؟
//   ورقة Report فيها QUERY، وأوراق المهندسين في الملف الرئيسي فيها IMPORTRANGE، وكلاهما يتمدد للأسفل.
//   لو قُصّت الورقة إلى آخر صف، فأول مهمة جديدة لا تجد صفاً، فتعطي المعادلة خطأ، و IFERROR يجعل Report كلها
//   «لا توجد بيانات» حتى يُضاف صف يدوياً. وملف المهندس يحتاج صفوفاً فارغة ليُدخل فيها.
//
//  ما يفعله، بهذا الترتيب:
//   1. ملفات المهندسين (Tasks): يحذف الصفوف الفارغة كلياً بين المهام (من C إلى O)، ويُبقي ENG_BUFFER صفاً
//      فارغاً تحت آخر مهمة (يضيف صفوفاً إن كانت أقل). يتخطى الملف المعدَّل في آخر SKIP_IF_EDITED_MIN دقيقة.
//   2. الملف الرئيسي و Data-Processing: كل ورقة مهندس (المذكورة في معادلة Report) تُبقي FEED_BUFFER صفاً
//      احتياطياً، ولا تقل أبداً عن عدد صفوف ملف المهندس نفسه (لتتسع IMPORTRANGE)، ثم Report بـ FEED_BUFFER احتياطياً.
//      إن كانت Report تعرض «لا توجد بيانات» أو خطأ، يُتخطى الملف كله ولا يُحذف منه شيء.
//   3. ملفات القيم (لوكر): يُبقي VALUE_BUFFER صفاً بعد آخر صف.
//   الحذف من الأسفل إلى الأعلى، دفعة لكل مجموعة متجاورة، وكل شيء يُسجَّل.
//
//  الدوال:
//   tidyCheck()                       فحص فقط: يعرض ما سيُحذف أو يُضاف، ولا يغيّر شيئاً
//   deleteEmptyRowsMultipleFiles()    التنظيف (يشغّله المؤقت)
// =====================================================================

var TIDY = {
  ENGINEER_IDS: [
    // "ضع_ID_ملف_المهندس_هنا",
  ],
  ENGINEER_SHEET: 'Tasks',
  ENG_FIRST_ROW: 3,          // أول صف مهام
  // الصف مهمة إذا كان فيه شيء في هذه الأعمدة: C..M (الإدخال) و O (تاريخ الإدخال).
  // A «م» و B «اسم المهندس» و N «المدة» معادلات، فلا تُحسب (N ممدودة حتى آخر الورقة في بعض الملفات).
  ENG_CHECK_COLS: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15],
  ENG_DELETE_GAPS: true,     // حذف الصفوف الفارغة بين المهام
  ENG_BUFFER: 200,          // صفوف فارغة تبقى تحت آخر مهمة
  ENG_GROW_BELOW: 100,      // لا تُضاف صفوف إلا إن قلّ الاحتياطي عن هذا (فلا يضيف في كل تشغيل)
  SKIP_IF_EDITED_MIN: 30,

  FEED_FILES: [              // الملف الرئيسي و Data-Processing
    // { id: 'ضع_ID', name: 'الملف الرئيسي' },
  ],
  REPORT_SHEET: 'Report',
  REPORT_FORMULA_CELL: 'B37',
  FEED_BUFFER: 300,

  VALUE_FILES: [             // ملفات فيها قيم منسوخة فقط (لوكر)
    // { id: 'ضع_ID', name: 'لوكر', sheet: 'Report' },
  ],
  VALUE_BUFFER: 20
};

function tidyCheck() { tidyRun_(true); }
function deleteEmptyRowsMultipleFiles() { tidyRun_(false); }

// =====================================================================
function tidyRun_(dry) {
  var lock = LockService.getScriptLock();   // لا يعمل في نفس لحظة النسخ أو الترميز في هذا المشروع
  if (!lock.tryLock(120000)) { Logger.log('تشغيل آخر قيد العمل، أُجّل التنظيف.'); return; }
  var log = [dry ? 'فحص فقط (لم يُحذف شيء):' : 'التنظيف:'];
  try {
    var engRows = {};   // اسم ملف المهندس ← عدد صفوفه بعد التنظيف
    TIDY.ENGINEER_IDS.forEach(function (id) {
      if (!id || id.indexOf('ضع_ID') !== -1) return;
      try { tidyEngineer_(id, dry, log, engRows); }
      catch (err) { log.push('✗ ملف مهندس ' + id + ': ' + err.message); }
    });
    TIDY.FEED_FILES.forEach(function (f) {
      if (!f.id || f.id.indexOf('ضع_ID') !== -1) return;
      try { tidyFeed_(f, dry, log, engRows); }
      catch (err) { log.push('✗ ' + (f.name || f.id) + ': ' + err.message); }
    });
    TIDY.VALUE_FILES.forEach(function (f) {
      if (!f.id || f.id.indexOf('ضع_ID') !== -1) return;
      try {
        var sh = SpreadsheetApp.openById(f.id).getSheetByName(f.sheet || TIDY.REPORT_SHEET);
        if (!sh) { log.push('✗ ' + f.name + ': لا توجد ورقة ' + (f.sheet || TIDY.REPORT_SHEET)); return; }
        tidyTrim_(sh, sh.getLastRow() + TIDY.VALUE_BUFFER, dry, log, f.name + ' ‹ ' + sh.getName());
      } catch (err) { log.push('✗ ' + (f.name || f.id) + ': ' + err.message); }
    });
  } finally {
    lock.releaseLock();
  }
  if (log.length === 1) log.push('لا شيء يحتاج تنظيفاً.');
  Logger.log(log.join('\n'));
}

function tidyEngineer_(id, dry, log, engRows) {
  var file = DriveApp.getFileById(id), ss = SpreadsheetApp.openById(id), name = ss.getName();
  var sh = ss.getSheetByName(TIDY.ENGINEER_SHEET);
  if (!sh) { log.push('✗ ' + name + ': لا توجد ورقة ' + TIDY.ENGINEER_SHEET); return; }
  engRows[name] = sh.getMaxRows();
  var mins = (Date.now() - file.getLastUpdated().getTime()) / 60000;
  if (mins < TIDY.SKIP_IF_EDITED_MIN) { log.push('… ' + name + ': عُدّل قبل ' + Math.round(mins) + ' دقيقة، تُخطّي'); return; }

  var f0 = TIDY.ENG_FIRST_ROW, last = sh.getLastRow(), lastTask = f0 - 1, gaps = [];
  if (last >= f0) {
    var c1 = Math.min.apply(null, TIDY.ENG_CHECK_COLS), c2 = Math.max.apply(null, TIDY.ENG_CHECK_COLS);
    var vals = sh.getRange(f0, c1, last - f0 + 1, c2 - c1 + 1).getValues();
    var empty = vals.map(function (r) { return TIDY.ENG_CHECK_COLS.every(function (c) { return tidyBlank_(r[c - c1]); }); });
    for (var i = empty.length - 1; i >= 0; i--) if (!empty[i]) { lastTask = f0 + i; break; }
    if (TIDY.ENG_DELETE_GAPS) for (var j = 0; j < lastTask - f0 + 1; j++) if (empty[j]) gaps.push(f0 + j);
  }
  var label = name + ' ‹ ' + sh.getName();
  if (gaps.length) {
    log.push((dry ? '؟ ' : '✓ ') + label + ': ' + gaps.length + ' صفاً فارغاً بين المهام' + (dry ? ' سيُحذف' : ' حُذف'));
    if (!dry) tidyDeleteRows_(sh, gaps);
    lastTask -= gaps.length;
  }
  var rows = tidyTrim_(sh, Math.max(lastTask, f0 - 1) + TIDY.ENG_BUFFER, dry, log, label, { gaps: gaps.length, grow: true });
  engRows[name] = rows;
}

function tidyFeed_(f, dry, log, engRows) {
  var ss = SpreadsheetApp.openById(f.id), name = f.name || ss.getName();
  var report = ss.getSheetByName(TIDY.REPORT_SHEET);
  if (!report) { log.push('✗ ' + name + ': لا توجد ورقة ' + TIDY.REPORT_SHEET); return; }
  var cell = report.getRange(TIDY.REPORT_FORMULA_CELL);
  var shown = String(cell.getDisplayValue()).trim();
  if (shown === '' || shown === 'لا توجد بيانات' || shown.charAt(0) === '#') {
    log.push('⚠ ' + name + ': Report تعرض «' + (shown || 'فارغ') + '»، تُخطّي الملف كله. راجعها.');
    return;
  }
  // أوراق المهندسين: المذكورة في معادلة Report ('اسم'!B2:O)
  var tabs = {}, m, re = /'([^']+)'!/g, formula = cell.getFormula();
  while ((m = re.exec(formula))) tabs[m[1]] = true;
  Object.keys(tabs).forEach(function (t) {
    var sh = ss.getSheetByName(t);
    if (!sh) { log.push('⚠ ' + name + ': الورقة «' + t + '» مذكورة في المعادلة وغير موجودة'); return; }
    if (engRows[t] === undefined) { log.push('… ' + name + ' ‹ ' + t + ': لا أعرف حجم ملف المهندس، تُركت كما هي'); return; }
    // IMPORTRANGE تحتاج صفوفاً بعدد صفوف ملف المهندس على الأقل
    tidyTrim_(sh, Math.max(sh.getLastRow() + TIDY.FEED_BUFFER, engRows[t] + 10), dry, log, name + ' ‹ ' + t);
  });
  tidyTrim_(report, report.getLastRow() + TIDY.FEED_BUFFER, dry, log, name + ' ‹ ' + TIDY.REPORT_SHEET);
}

// يجعل عدد صفوف الورقة = keep: يحذف الزائد في الأسفل، ويضيف إن كان أقل (ملفات المهندسين فقط). يعيد العدد الجديد.
function tidyTrim_(sh, keep, dry, log, label, opts) {
  opts = opts || {};
  var max = sh.getMaxRows() - (dry && opts.gaps ? opts.gaps : 0);
  if (max > keep) {
    log.push((dry ? '؟ ' : '✓ ') + label + ': ' + (max - keep) + ' صفاً في الأسفل' + (dry ? ' سيُحذف' : ' حُذف') + ' (يبقى ' + keep + ')');
    if (!dry) sh.deleteRows(keep + 1, max - keep);
    return keep;
  }
  if (max < keep && opts.grow && keep - max > TIDY.ENG_BUFFER - TIDY.ENG_GROW_BELOW) {
    log.push((dry ? '؟ ' : '✓ ') + label + ': ' + (keep - max) + ' صفاً' + (dry ? ' سيُضاف' : ' أُضيف') + ' ليبقى الاحتياطي ' + TIDY.ENG_BUFFER);
    if (!dry) tidyGrow_(sh, keep - max);
    return keep;
  }
  return max;
}

// إضافة صفوف في آخر ملف المهندس بنفس معادلات آخر صف وتنسيقه وقوائمه المنسدلة (بلا قيم)،
// حتى يكون في الصف الجديد «م» و«اسم المهندس» و«المدة» إن كانت معادلات صفّية لا ARRAYFORMULA
function tidyGrow_(sh, n) {
  var last = sh.getMaxRows(), cols = sh.getMaxColumns();
  sh.insertRowsAfter(last, n);
  var tpl = sh.getRange(last, 1, 1, cols), dest = sh.getRange(last + 1, 1, n, cols);
  tpl.copyTo(dest, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  tpl.copyTo(dest, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  var f = tpl.getFormulasR1C1()[0];
  if (f.some(function (x) { return x; })) {
    // لكل عمود فيه معادلة صفّية: نفس المعادلة (R1C1 نسبية فتتكيّف مع رقم الصف). باقي الخلايا تبقى فارغة.
    f.forEach(function (x, c) {
      if (!x) return;
      var col = []; for (var i = 0; i < n; i++) col.push([x]);
      sh.getRange(last + 1, c + 1, n, 1).setFormulasR1C1(col);
    });
  }
}

// حذف صفوف متفرقة: من الأسفل إلى الأعلى، دفعة لكل مجموعة متجاورة
function tidyDeleteRows_(sh, rows) {
  rows = rows.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < rows.length; ) {
    var end = rows[i], start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { i++; start--; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
}

function tidyBlank_(v) { return !(v instanceof Date) && (v === '' || v === null || v === undefined || String(v).trim() === ''); }
