// =====================================================================
//  تاريخ الإدخال في ملفات المهندسين (العمود O في ورقة Tasks)
//  يحل محل الملف الحالي الذي فيه onEditHandler و setupTriggersForAllEngineers
//  (مشروع السكربتات في المجلد الأساسي، لا في ملفات المهندسين).
//
//  ما الذي تغيّر عن السكربت السابق:
//   1. يعمل مع اللصق والتعبئة لأي عدد من الصفوف، ومهما كان العمود الذي بدأ منه اللصق
//      (السابق كان يعمل فقط عند كتابة خلية الموضوع وحدها).
//   2. كل صف يأخذ تاريخاً لا يتكرر في نفس الملف (فارق ثانية على الأقل).
//   3. الصف المنسوخ من مهمة سابقة بتاريخ إدخالها يأخذ تاريخاً جديداً، فلا تتشابه مهمتان.
//   4. يكتب تاريخاً ووقتاً حقيقيين (لا نصاً) بتوقيت الملف نفسه، ولا يغيّر تنسيق العمود.
//   5. شبكة أمان كل ساعة تكمل الناقص وتصلح التكرار في كل الملفات، مع سجل.
//   6. التاريخ يُكتب عند أول إدخال في أي عمود من أعمدة الإدخال (C إلى M)، لا الموضوع فقط،
//      لأن بعض المهام تُدخل بلا موضوع. وصف أُفرغ كله يُمسح تاريخه، فلا يرث تاريخَه مهمةٌ تُكتب فيه لاحقاً.
//
//  الدوال التي تُشغَّل يدوياً (من المحرر: اختر الدالة ثم Run):
//   entryDiagnose()               فحص فقط، لا يغيّر شيئاً: حالة كل ملف
//   setupTriggersForAllEngineers() ربط المشغّل بكل الملفات (يحذف القديم أولاً)، ويطبع ما فشل
//   entryBackfillFromReceived()   مرة واحدة: إكمال التواريخ الناقصة القديمة بتاريخ الاستقبال
//   entryInstallHourly()          تفعيل شبكة الأمان كل ساعة
//   entryHighlightMissingSubject() اختياري: تلوين خلية الموضوع الفارغة في مهمة فيها بيانات (تنسيق شرطي)
// =====================================================================

// معرّفات ملفات المهندسين (بين /d/ و /edit في الرابط)
var ENGINEER_SHEET_IDS = [
  // "ضع_ID_ملف_المهندس_هنا",
];

var ENTRY = {
  SHEET: 'Tasks',            // اسم ورقة المهام في ملفات المهندسين
  FIRST_ROW: 3,              // أول صف مهام
  SUBJECT_COL: 6,            // F الموضوع
  // أعمدة الإدخال: الصف مهمة إذا كُتب شيء في أي منها. (A م، B اسم المهندس، N المدة: معادلات، فلا تدخل)
  INPUT_FIRST_COL: 3,        // C رقم القيد
  INPUT_LAST_COL: 13,        // M سبب تأخير إنجاز المهمة
  RECEIVED_COL: 7,           // G تاريخ الاستقبال
  ENTRY_COL: 15,             // O تاريخ الإدخال
  // تنسيق العرض: فارغ = لا يمس التنسيق، فيبقى تنسيق العمود الذي وضعته أنت (مثل 12-Nov-2026 - 19:25:16).
  // لو أردت أن يفرض السكربت تنسيقاً على الخلايا التي يكتبها: 'dd-mmm-yyyy" - "hh:mm:ss'
  FORMAT: '',
  // اختياري: معرّف ملف (مثل الملف الرئيسي) تُكتب فيه ورقة «سجل_تاريخ_الإدخال». فارغ = سجل المحرر فقط.
  LOG_FILE_ID: '',
  LOG_SHEET: 'سجل_تاريخ_الإدخال'
};

// ---------------------------------------------------------------------
//  المشغّل: يعمل تلقائياً عند أي تعديل في أي ملف مهندس
// ---------------------------------------------------------------------
function onEditHandler(e) {
  if (!e || !e.range) return;
  var r = e.range;
  // يخرج فوراً إن لم يشمل التعديل أعمدة الإدخال ولا عمود تاريخ الإدخال
  var c1 = r.getColumn(), c2 = r.getLastColumn();
  var touchesInput = c1 <= ENTRY.INPUT_LAST_COL && c2 >= ENTRY.INPUT_FIRST_COL;
  var touchesEntry = c1 <= ENTRY.ENTRY_COL && c2 >= ENTRY.ENTRY_COL;
  if (!touchesInput && !touchesEntry) return;
  var r1 = Math.max(r.getRow(), ENTRY.FIRST_ROW), r2 = r.getLastRow();
  if (r2 < r1) return;
  var sheet = r.getSheet();
  if (sheet.getName() !== ENTRY.SHEET) return;

  // مسار سريع (أغلب التعديلات: تغيير حالة أو ملاحظة في مهمة لها تاريخ): قراءة صفوف التعديل فقط
  if (!touchesEntry) {
    var w = ENTRY.ENTRY_COL - ENTRY.INPUT_FIRST_COL + 1;
    var rows = sheet.getRange(r1, ENTRY.INPUT_FIRST_COL, r2 - r1 + 1, w).getValues();
    var needed = rows.some(function (row) {
      var has = entryHasData_(row, 0), dated = entryKey_(row[w - 1], 'UTC') !== '';
      return has !== dated;
    });
    if (!needed) return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // شبكة الأمان تكمل ما فات
  try {
    entryFixRows_(sheet, r1, r2, 'now');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------
//  شبكة الأمان كل ساعة: إكمال الناقص وإصلاح التكرار في كل الملفات
// ---------------------------------------------------------------------
function entryHourlyCheck() {
  entryForEachFile_('now', 'فحص كل ساعة');
}

// مرة واحدة: التواريخ الناقصة القديمة تُكمَل بتاريخ الاستقبال (+ ثوانٍ فارقة)، لا بوقت التشغيل
function entryBackfillFromReceived() {
  entryForEachFile_('received', 'إكمال القديم بتاريخ الاستقبال');
}

function entryInstallHourly() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'entryHourlyCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('entryHourlyCheck').timeBased().everyHours(1).create();
  Logger.log('فُعّل الفحص كل ساعة.');
}

// ---------------------------------------------------------------------
//  ربط المشغّل بكل ملفات المهندسين (يحذف القديم أولاً)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
//  اختياري: تلوين خلية الموضوع الفارغة في صف فيه بيانات (تنسيق شرطي في كل ملف، مرة واحدة)
//  لا يمنع الإدخال، لكنه ينبّه المهندس فوراً. لا يكرر القاعدة إن وُجدت.
// ---------------------------------------------------------------------
function entryHighlightMissingSubject() {
  var col = entryColLetter_(ENTRY.SUBJECT_COL), a = entryColLetter_(ENTRY.INPUT_FIRST_COL), z = entryColLetter_(ENTRY.INPUT_LAST_COL);
  var f0 = ENTRY.FIRST_ROW;
  var formula = '=AND(COUNTA($' + a + f0 + ':$' + z + f0 + ')>0,TRIM($' + col + f0 + ')="")';
  var done = 0, skipped = 0, failed = [];
  ENGINEER_SHEET_IDS.forEach(function (id) {
    if (!id || id.indexOf('ضع_ID') !== -1) return;
    try {
      var sh = SpreadsheetApp.openById(id).getSheetByName(ENTRY.SHEET);
      if (!sh) { failed.push(id + ': لا توجد ورقة ' + ENTRY.SHEET); return; }
      var rules = sh.getConditionalFormatRules();
      var exists = rules.some(function (x) {
        var c = x.getBooleanCondition();
        return c && c.getCriteriaValues().join('') === formula;
      });
      if (exists) { skipped++; return; }
      var range = sh.getRange(col + f0 + ':' + col);
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula)
        .setBackground('#fde2e1').setFontColor('#b42318').setRanges([range]).build());
      sh.setConditionalFormatRules(rules);
      done++;
    } catch (err) {
      failed.push(id + ': ' + err.message);
    }
  });
  Logger.log('تلوين الموضوع الفارغ: أُضيف في ' + done + '، وموجود مسبقاً في ' + skipped + (failed.length ? '\nفشل:\n' + failed.join('\n') : ''));
}

function entryColLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

function setupTriggersForAllEngineers() {
  removeExistingTriggers();
  var ok = 0, failed = [];
  ENGINEER_SHEET_IDS.forEach(function (id) {
    if (!id || id.indexOf('ضع_ID') !== -1) return;
    try {
      ScriptApp.newTrigger('onEditHandler').forSpreadsheet(id).onEdit().create();
      ok++;
    } catch (err) {
      failed.push(id + ' ← ' + err.message);
    }
  });
  Logger.log('رُبط ' + ok + ' من ' + ENGINEER_SHEET_IDS.length + ' ملفاً.');
  if (failed.length) Logger.log('فشل:\n' + failed.join('\n'));
}

function removeExistingTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditHandler') ScriptApp.deleteTrigger(t);
  });
}

// ---------------------------------------------------------------------
//  فحص فقط (لا يغيّر شيئاً): حالة كل ملف
// ---------------------------------------------------------------------
function entryDiagnose() {
  var hooked = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditHandler') hooked[t.getTriggerSourceId()] = true;
  });
  var lines = ['الملف | المشغّل | مهام | بلا تاريخ إدخال | تاريخ كنص | مكرر | بلا موضوع | تاريخ في صف فارغ'];
  var tot = { files: 0, tasks: 0, missing: 0, text: 0, dup: 0, noSubject: 0, orphan: 0 };
  ENGINEER_SHEET_IDS.forEach(function (id) {
    if (!id || id.indexOf('ضع_ID') !== -1) return;
    var name = id;
    try {
      var ss = SpreadsheetApp.openById(id);
      name = ss.getName();
      var sh = ss.getSheetByName(ENTRY.SHEET);
      if (!sh) { lines.push(name + ' | ' + (hooked[id] ? 'نعم' : 'لا ✗') + ' | لا توجد ورقة ' + ENTRY.SHEET + ' ✗'); return; }
      var s = entryScan_(sh);
      tot.files++; tot.tasks += s.tasks; tot.missing += s.missing.length; tot.text += s.text; tot.dup += s.dups.length;
      tot.noSubject += s.noSubject; tot.orphan += s.orphan;
      lines.push(name + ' | ' + (hooked[id] ? 'نعم' : 'لا ✗') + ' | ' + s.tasks + ' | ' + s.missing.length + ' | ' + s.text + ' | ' + s.dups.length + ' | ' + s.noSubject + ' | ' + s.orphan);
    } catch (err) {
      lines.push(name + ' | ' + (hooked[id] ? 'نعم' : 'لا ✗') + ' | تعذّر فتح الملف ✗ ' + err.message);
    }
  });
  lines.push('المجموع: ' + tot.files + ' ملفاً، ' + tot.tasks + ' مهمة، بلا تاريخ ' + tot.missing + '، نص ' + tot.text + '، مكرر ' + tot.dup +
    '، بلا موضوع ' + tot.noSubject + '، تاريخ في صف فارغ ' + tot.orphan);
  Logger.log(lines.join('\n'));
  return lines;
}

// =====================================================================
//  الداخلي
// =====================================================================

function entryForEachFile_(mode, title) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('تشغيل آخر قيد العمل، أُجّل.'); return; }
  var out = [], total = { filled: 0, fixed: 0, cleared: 0 };
  try {
    ENGINEER_SHEET_IDS.forEach(function (id) {
      if (!id || id.indexOf('ضع_ID') !== -1) return;
      try {
        var ss = SpreadsheetApp.openById(id);
        var sh = ss.getSheetByName(ENTRY.SHEET);
        if (!sh) { out.push(ss.getName() + ': لا توجد ورقة ' + ENTRY.SHEET); return; }
        var last = sh.getLastRow();
        if (last < ENTRY.FIRST_ROW) return;
        var res = entryFixRows_(sh, ENTRY.FIRST_ROW, last, mode);
        total.filled += res.filled; total.fixed += res.fixed; total.cleared += res.cleared;
        if (res.filled || res.fixed || res.cleared) out.push(ss.getName() + ': أُكمل ' + res.filled + '، وأُصلح تكرار ' + res.fixed + '، ومُسح من صفوف فارغة ' + res.cleared);
      } catch (err) {
        out.push(id + ': تعذّر الفتح ← ' + err.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
  entryLog_(title, total, out);
}

/**
 * يصلح الصفوف r1..r2 في ورقة واحدة:
 *  - صف فيه أي إدخال (C..M) وليس فيه تاريخ إدخال ← تاريخ جديد
 *  - صف أُفرغ كله وفيه تاريخ ← يُمسح التاريخ
 *  - صف تاريخ إدخاله موجود في صف آخر من الورقة ← تاريخ جديد (يبقى الأقدم مكاناً: خارج r1..r2 أولاً، ثم الأعلى)
 * التاريخ الجديد دائماً أكبر من أي تاريخ موجود في الملف بثانية على الأقل، فلا يتكرر.
 * mode = 'now' (وقت التشغيل) أو 'received' (تاريخ الاستقبال للصف + ثوانٍ فارقة).
 */
function entryFixRows_(sheet, r1, r2, mode) {
  var last = Math.max(sheet.getLastRow(), r2);
  var n = last - ENTRY.FIRST_ROW + 1;
  if (n <= 0) return { filled: 0, fixed: 0, cleared: 0 };
  var inputs = sheet.getRange(ENTRY.FIRST_ROW, ENTRY.INPUT_FIRST_COL, n, ENTRY.INPUT_LAST_COL - ENTRY.INPUT_FIRST_COL + 1).getValues();
  var has = inputs.map(function (row) { return entryHasData_(row, 0); });
  var ent = sheet.getRange(ENTRY.FIRST_ROW, ENTRY.ENTRY_COL, n, 1).getValues();
  var recv = mode === 'received' ? sheet.getRange(ENTRY.FIRST_ROW, ENTRY.RECEIVED_COL, n, 1).getValues() : null;
  var tz = sheet.getParent().getSpreadsheetTimeZone();

  var nowMs = Date.now(), maxMs = 0;
  var seen = {}; // مفتاح التاريخ ← أول صف يملكه
  var keys = ent.map(function (row) { return entryKey_(row[0], tz); });
  // الصفوف خارج المنطقة المعدَّلة تملك تواريخها أولاً
  for (var i = 0; i < n; i++) {
    var rowNo = ENTRY.FIRST_ROW + i, inside = rowNo >= r1 && rowNo <= r2;
    var ms = entryMs_(ent[i][0], tz);
    if (ms && ms <= nowMs + 86400000) maxMs = Math.max(maxMs, ms);
    if (!inside && keys[i] && has[i] && !(keys[i] in seen)) seen[keys[i]] = i;
  }

  // آخر تاريخ أعطاه السكربت لهذا الملف (حتى لو مُسح لاحقاً): لا يُعطى نفسه مرة أخرى أبداً
  // (يحتاج صلاحية «خصائص السكربت»: إن لم تُمنح بعد، يكمل الكتابة دونها ولا يتوقف)
  var props = null, propKey = 'entryLast_' + sheet.getParent().getId(), lastIssued = 0;
  try { props = PropertiesService.getScriptProperties(); lastIssued = Number(props.getProperty(propKey)) || 0; }
  catch (err) { props = null; Logger.log('خصائص السكربت غير متاحة (شغّل أي دالة يدوياً ووافق على الصلاحيات): ' + err.message); }
  var changed = [], filled = 0, fixed = 0, cleared = 0, next = Math.max(nowMs, maxMs + 1000, lastIssued + 1000), issued = 0;
  var recvNext = {}; // لكل يوم استقبال: آخر ثانية استُعملت
  var used = {}; keys.forEach(function (x) { if (x) used[x] = true; });
  for (var j = r1 - ENTRY.FIRST_ROW; j <= r2 - ENTRY.FIRST_ROW; j++) {
    var k = keys[j];
    if (!has[j]) {
      // صف أُفرغ كله: يُمسح تاريخه، فالمهمة التي تُكتب فيه لاحقاً تأخذ تاريخاً جديداً
      if (k) { ent[j][0] = ''; keys[j] = ''; changed.push(j); cleared++; }
      continue;
    }
    var need = !k ? 'fill' : (k in seen && seen[k] !== j) ? 'dup' : null;
    if (!need) { seen[k] = j; continue; }
    var value;
    if (mode === 'received' && need === 'fill' && recv[j][0] instanceof Date) {
      value = entryReceivedStamp_(recv[j][0], used, recvNext, tz);
    } else {
      value = new Date(next); issued = next; next += 1000;
    }
    ent[j][0] = value;
    keys[j] = entryKey_(value, tz);
    seen[keys[j]] = j; used[keys[j]] = true;
    changed.push(j);
    if (need === 'fill') filled++; else fixed++;
  }
  if (issued && props) { try { props.setProperty(propKey, String(issued)); } catch (err) { Logger.log(err.message); } }
  // كتابة الخلايا المتغيرة فقط (متجاورة دفعة واحدة)
  for (var a = 0; a < changed.length; ) {
    var b = a;
    while (b + 1 < changed.length && changed[b + 1] === changed[b] + 1) b++;
    var block = ent.slice(changed[a], changed[b] + 1);
    var out = sheet.getRange(ENTRY.FIRST_ROW + changed[a], ENTRY.ENTRY_COL, block.length, 1).setValues(block);
    if (ENTRY.FORMAT) out.setNumberFormat(ENTRY.FORMAT);
    a = b + 1;
  }
  return { filled: filled, fixed: fixed, cleared: cleared };
}

// هل في الصف أي إدخال (من أعمدة الإدخال)؟ row يبدأ من العمود INPUT_FIRST_COL
function entryHasData_(row, from) {
  for (var c = from; c <= from + ENTRY.INPUT_LAST_COL - ENTRY.INPUT_FIRST_COL; c++) {
    var v = row[c];
    if (v instanceof Date || (v !== '' && v !== null && v !== undefined && String(v).trim() !== '')) return true;
  }
  return false;
}

// تاريخ الاستقبال (بدون وقت) + أول ثانية غير مستعملة في ذلك اليوم
function entryReceivedStamp_(day, used, recvNext, tz) {
  var dayKey = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
  var start = entryMs_(dayKey + ' 00:00:00', tz);
  var s = recvNext[dayKey] || 1;
  while (true) {
    var d = new Date(start + s * 1000);
    var k = entryKey_(d, tz);
    s++;
    if (!used[k]) { recvNext[dayKey] = s; return d; }
  }
}

// قيمة الخلية ← نص موحّد للمقارنة (تاريخ أو نص بنفس الشكل)
function entryKey_(v, tz) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]) + ' ' + pad2_(m[4]) + ':' + m[5] + ':' + (m[6] || '00');
  return s;
}

function entryMs_(v, tz) {
  if (v instanceof Date) return v.getTime();
  var k = entryKey_(v, tz);
  var m = k.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  // نص بتوقيت الملف ← ميلي ثانية
  var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  var off = entryOffsetMs_(new Date(guess), tz);
  return guess - off;
}

function entryOffsetMs_(d, tz) {
  var z = Utilities.formatDate(d, tz, 'Z'); // مثل +0400
  var sign = z[0] === '-' ? -1 : 1;
  return sign * (parseInt(z.substr(1, 2), 10) * 60 + parseInt(z.substr(3, 2), 10)) * 60000;
}

function pad2_(x) { x = String(x); return x.length < 2 ? '0' + x : x; }

function entryScan_(sh) {
  var last = sh.getLastRow(), n = last - ENTRY.FIRST_ROW + 1;
  var res = { tasks: 0, missing: [], text: 0, dups: [], noSubject: 0, orphan: 0 };
  if (n <= 0) return res;
  var tz = sh.getParent().getSpreadsheetTimeZone();
  var w = ENTRY.ENTRY_COL - ENTRY.INPUT_FIRST_COL + 1;
  var rows = sh.getRange(ENTRY.FIRST_ROW, ENTRY.INPUT_FIRST_COL, n, w).getValues();
  var subjAt = ENTRY.SUBJECT_COL - ENTRY.INPUT_FIRST_COL;
  var seen = {};
  for (var i = 0; i < n; i++) {
    var row = rows[i];
    if (!entryHasData_(row, 0)) { if (entryKey_(row[w - 1], tz)) res.orphan++; continue; }
    res.tasks++;
    if (String(row[subjAt]).trim() === '') res.noSubject++;
    var v = row[w - 1], k = entryKey_(v, tz);
    if (!k) { res.missing.push(ENTRY.FIRST_ROW + i); continue; }
    if (!(v instanceof Date)) res.text++;
    if (k in seen) res.dups.push(ENTRY.FIRST_ROW + i); else seen[k] = true;
  }
  return res;
}

function entryLog_(title, total, lines) {
  var msg = title + ': أُكمل ' + total.filled + '، وأُصلح تكرار ' + total.fixed + '، ومُسح من صفوف فارغة ' + (total.cleared || 0) + (lines.length ? '\n' + lines.join('\n') : '');
  Logger.log(msg);
  if (!ENTRY.LOG_FILE_ID || (!total.filled && !total.fixed && !total.cleared && !lines.length)) return;
  try {
    var ss = SpreadsheetApp.openById(ENTRY.LOG_FILE_ID);
    var sh = ss.getSheetByName(ENTRY.LOG_SHEET) || ss.insertSheet(ENTRY.LOG_SHEET);
    if (sh.getLastRow() === 0) sh.appendRow(['الوقت', 'العملية', 'أُكمل', 'أُصلح تكرار', 'مُسح من صفوف فارغة', 'التفاصيل']);
    sh.appendRow([new Date(), title, total.filled, total.fixed, total.cleared || 0, lines.join('\n')]);
  } catch (err) {
    Logger.log('تعذّر الكتابة في السجل: ' + err.message);
  }
}
