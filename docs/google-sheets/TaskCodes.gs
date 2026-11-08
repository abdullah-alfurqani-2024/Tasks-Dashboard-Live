/**
 * ============================================================
 *  رمز المهمة — Google Apps Script (في مشروع الملف الرئيسي)
 * ============================================================
 *  لكل مهمة رمز ثابت لا يتكرر: رمز المهندس + تسلسل، مثل E03-0142
 *  - رمز المهندس في ورقة «ملفات_المهندسين» (عمود «رمز المهندس»)، ويُعطى تلقائياً إن كان فارغاً
 *  - التسلسل = أكبر رقم مستخدم في ملف المهندس + 1 (بلا عدّاد، ولا يتأثر بالفرز أو حذف الصفوف)
 *  - الرمز قيمة ثابتة لا معادلة، وعموده محمي بتحذير عند التعديل اليدوي
 *  - الرمز المكرر لا يُعدَّل تلقائياً، بل يُكتب في ورقة «تقرير_رموز_المهام» لتصلحه
 *  - ملفات المهندسين لا تحتاج أي سكربت: كل شيء يعمل من الملف الرئيسي
 *
 *  الوظائف:
 *    previewTaskCodes()        ← معاينة بدون كتابة أي شيء (شغّلها أولاً)
 *    setupTaskCodes()          ← مرة واحدة: رموز المهندسين + عمود «رمز المهمة» في القالب وكل الملفات وفي Report
 *    assignTaskCodes()         ← ترقيم الصفوف التي بلا رمز + فحص التكرار (قبل كل تصدير للاستيراد)
 *    installTaskCodesTrigger() ← الترقيم التلقائي كل ساعة
 *    removeTaskCodesTrigger()  ← إيقاف الترقيم التلقائي
 *    clearTaskCodesForTesting()← للملفات التجريبية فقط: يمسح كل رموز المهام
 *
 *  يتطلب EngineerFilesGenerator.gs و MasterFeed.gs في نفس المشروع
 * ============================================================
 */

const TASKCODE = {
  HEADER: 'رمز المهمة',            // عنوان العمود في ملفات المهندسين وفي Report
  ENGINEER_HEADER: 'رمز المهندس',  // عنوان العمود في ورقة «ملفات_المهندسين»
  LETTER: 'E',                     // حرف رموز المهندسين: E01، E02…
  ENGINEER_DIGITS: 2,
  SEQ_DIGITS: 4,                   // E03-0142 (يكمل بعد 9999 بخمس خانات تلقائياً)
  REPORT_SHEET: 'تقرير_رموز_المهام',
  PROTECT_DESC: 'رمز المهمة — يكتبه السكربت، لا تعدّله يدوياً',
  TRIGGER_FN: 'taskCodesHourly'
};

/* ======================= نقاط الدخول ======================= */

function previewTaskCodes() {
  mfGuard_(() => {
    const setup = tcSetup_(true);
    const assign = tcAssign_(true);
    tgNotify_('🔍 معاينة رمز المهمة (لم يُكتب شيء)\n\n' + setup.join('\n') + '\n\n' + assign.text);
  });
}

function setupTaskCodes() {
  mfGuard_(() => {
    const lines = tcSetup_(false);
    tgNotify_('✅ تم تجهيز رمز المهمة\n\n' + lines.join('\n') +
      '\n\nالخطوتان التاليتان:\n1) «تحديث المهندسين والربط» (أو setupMasterFeed) ليشمل الربط العمود الجديد\n' +
      '2) «ترقيم المهام وفحص التكرار»');
  });
}

function assignTaskCodes() {
  mfGuard_(() => tgNotify_(tcAssign_(false).text));
}

/** يشغّله المشغّل كل ساعة (بلا نوافذ) */
function taskCodesHourly() {
  mfGuard_(() => Logger.log(tcAssign_(false).text));
}

function installTaskCodesTrigger() {
  removeTaskCodesTrigger(true);
  ScriptApp.newTrigger(TASKCODE.TRIGGER_FN).timeBased().everyHours(1).create();
  tgNotify_('✅ الترقيم التلقائي يعمل كل ساعة.\nالمكرر يظهر في ورقة «' + TASKCODE.REPORT_SHEET + '».');
}

function removeTaskCodesTrigger(silent) {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === TASKCODE.TRIGGER_FN) { ScriptApp.deleteTrigger(t); n++; }
  });
  if (silent !== true) tgNotify_(n ? 'أُوقف الترقيم التلقائي.' : 'الترقيم التلقائي لم يكن مفعّلاً.');
}

/** للملفات التجريبية فقط: يمسح «رمز المهمة» من كل ملفات المهندسين */
function clearTaskCodesForTesting() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('مسح كل رموز المهام',
    'للملفات التجريبية فقط.\nيمسح عمود «' + TASKCODE.HEADER + '» من كل ملفات المهندسين، ولا يمس أي عمود آخر.\n\nمتابعة؟',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  mfGuard_(() => {
    let files = 0;
    tcEngineers_(false).forEach(e => {
      const f = tcOpenTaskFile_(e.id);
      if (!f || !f.col) return;
      const last = f.sheet.getLastRow();
      if (last >= f.layout.firstRow) f.sheet.getRange(f.layout.firstRow, f.col, last - f.layout.firstRow + 1, 1).clearContent();
      files++;
    });
    tgNotify_('مُسحت الرموز من ' + files + ' ملف.');
  });
}

/* ======================= التجهيز ======================= */

function tcSetup_(dryRun) {
  const out = [];

  // 1) رموز المهندسين
  const engineers = tcEngineers_(!dryRun);
  const fresh = engineers.filter(e => e.isNew);
  out.push('• رموز المهندسين: ' + engineers.length + (fresh.length
    ? ' (' + (dryRun ? 'ستُعطى' : 'أُعطيت') + ' رموز جديدة لـ ' + fresh.length + ': ' + fresh.map(e => e.name + ' = ' + e.code).join('، ') + ')'
    : ' (كلها موجودة)'));

  // 2) عمود «رمز المهمة» في القالب وملفات المهندسين
  const files = [{ name: 'القالب', id: TASKGEN.TEMPLATE_FILE_ID }].concat(engineers);
  let added = 0, had = 0;
  files.forEach(f => {
    if (!f.id) { out.push('  ⚠️ ' + f.name + ': لا يوجد معرّف ملف'); return; }
    try {
      const r = tcEnsureColumn_(SpreadsheetApp.openById(f.id), dryRun);
      if (r.added) added++; else had++;
    } catch (e) {
      out.push('  ⚠️ ' + f.name + ': ' + e.message);
    }
  });
  out.push('• عمود «' + TASKCODE.HEADER + '»: ' + (dryRun ? 'سيُضاف إلى ' : 'أُضيف إلى ') + added + ' ملف، وموجود في ' + had);

  // 3) عنوان العمود في جدول Report
  out.push('• ' + tcEnsureReportHeader_(dryRun));
  return out;
}

/** المهندسون من ورقة «ملفات_المهندسين» مع رموزهم. write=true يضيف العمود ويعطي الرموز الناقصة */
function tcEngineers_(write) {
  const T = TASKCODE;
  const sh = tgDataSS_().getSheetByName(TASKGEN.SHEETS.REGISTRY);
  if (!sh || sh.getLastRow() < 2) throw new Error('ورقة «' + TASKGEN.SHEETS.REGISTRY + '» فارغة أو غير موجودة.');

  let col = mfFindHeaderCol_(sh, T.ENGINEER_HEADER);
  if (!col) {
    col = tgClean_(sh.getRange(1, 7).getValue()) ? mfFirstFreeCol_(sh, [8]) : 7;   // G، والعمود H لكتلة المعرّفات
    if (write) {
      sh.getRange(1, col).setValue(T.ENGINEER_HEADER)
        .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF').setHorizontalAlignment('center');
    }
  }

  const n = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, n, 3).getValues();
  const codes = sh.getRange(2, col, n, 1).getDisplayValues().map(r => tgClean_(r[0]).toUpperCase());
  const valid = new RegExp('^[A-Z]\\d{' + T.ENGINEER_DIGITS + ',}$');

  const list = [], seen = {};
  rows.forEach((r, i) => {
    const name = tgClean_(r[0]), id = tgClean_(r[2]);
    if (!name) return;
    const code = codes[i];
    if (code && !valid.test(code)) throw new Error('رمز المهندس «' + code + '» لـ ' + name + ' غير صحيح. الصيغة: حرف ثم ' + T.ENGINEER_DIGITS + ' أرقام، مثل ' + T.LETTER + '03.');
    if (code && seen[code]) throw new Error('رمز المهندس «' + code + '» مكرر: ' + seen[code] + ' و' + name + '.');
    if (code) seen[code] = name;
    list.push({ name: name, id: id, code: code, row: i + 2, isNew: false });
  });

  // رموز جديدة لمن ليس له رمز، بترتيب الورقة
  let k = 0;
  const next = () => {
    let c;
    do { c = T.LETTER + String(++k).padStart(T.ENGINEER_DIGITS, '0'); } while (seen[c]);
    return c;
  };
  list.forEach(e => {
    if (e.code) return;
    e.code = next(); e.isNew = true; seen[e.code] = e.name;
    if (write) sh.getRange(e.row, col).setNumberFormat('@').setValue(e.code);
  });
  return list;
}

/** ملف المهندس: ورقة المهام وعمود الرمز (إن وُجد) */
function tcOpenTaskFile_(id) {
  if (!tgOpenFile_(id)) return null;
  const ss = SpreadsheetApp.openById(id);
  const sheet = tgTaskSheet_(ss);
  const layout = tgDetectLayout_(sheet);
  return { ss: ss, sheet: sheet, layout: layout, col: tcCodeCol_(sheet, layout.headerRow) };
}

/** رقم عمود «رمز المهمة» في صف العناوين، أو 0 */
function tcCodeCol_(sh, headerRow) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const row = sh.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0].map(tgNorm_);
  return row.indexOf(tgNorm_(TASKCODE.HEADER)) + 1;
}

/** يضيف العمود بعد «تاريخ الإدخال» مباشرة: نص عادي، بلا قوائم، ومحمي بتحذير */
function tcEnsureColumn_(ss, dryRun) {
  const sh = tgTaskSheet_(ss);
  const layout = tgDetectLayout_(sh);
  let col = tcCodeCol_(sh, layout.headerRow);
  if (col) { if (!dryRun) tcProtect_(sh, col, layout); return { added: false, col: col }; }
  const after = layout.cols.entryDate || sh.getLastColumn();
  if (dryRun) return { added: true, col: after + 1 };

  sh.insertColumnAfter(after);
  col = after + 1;
  const head = sh.getRange(layout.headerRow, col);
  sh.getRange(layout.headerRow, after).copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  head.setValue(TASKCODE.HEADER);
  // العمود الجديد يرث تنسيق عمود التاريخ: نجعله نصاً عادياً بلا قوائم اختيار
  const body = sh.getRange(layout.firstRow, col, sh.getMaxRows() - layout.firstRow + 1, 1);
  body.clearDataValidations().clearContent().setNumberFormat('@').setHorizontalAlignment('center');
  sh.setColumnWidth(col, 110);
  tcProtect_(sh, col, layout);
  return { added: true, col: col };
}

function tcProtect_(sh, col, layout) {
  const has = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .some(p => p.getDescription() === TASKCODE.PROTECT_DESC);
  if (has) return;
  sh.getRange(layout.firstRow, col, sh.getMaxRows() - layout.firstRow + 1, 1)
    .protect().setDescription(TASKCODE.PROTECT_DESC).setWarningOnly(true);
}

/** عنوان «رمز المهمة» في جدول Report: الخلية التي بعد «تاريخ الإدخال» مباشرة */
function tcEnsureReportHeader_(dryRun) {
  const M = MASTERFEED;
  const master = mfMaster_();
  const report = master.getSheetByName(M.REPORT_SHEET);
  if (!report) throw new Error('ورقة ' + M.REPORT_SHEET + ' غير موجودة في الملف الرئيسي.');
  const lastCol = Math.max(report.getLastColumn(), 1);
  const row = report.getRange(M.HEADER_ROW, 1, 1, lastCol + 1).getDisplayValues()[0].map(tgNorm_);
  if (row.indexOf(tgNorm_(TASKCODE.HEADER)) > -1) return 'عنوان العمود موجود في ' + M.REPORT_SHEET;
  const entry = row.indexOf(tgNorm_(M.LAST_HEADER)) + 1;
  if (!entry) throw new Error('لم أجد «' + M.LAST_HEADER + '» في ' + M.REPORT_SHEET + '!' + M.HEADER_ROW + '.');
  const col = entry + 1, a1 = tgColLetter_(col) + M.HEADER_ROW;

  // الخلية والعمود تحتها يجب أن يكونا فارغين، لأن QUERY ستكتب فيهما
  const cell = tgClean_(report.getRange(M.HEADER_ROW, col).getDisplayValue());
  if (cell) throw new Error('الخلية ' + M.REPORT_SHEET + '!' + a1 + ' فيها «' + cell + '». أفرغها أولاً لأن عمود «' + TASKCODE.HEADER + '» سيكون فيها.');
  const below = report.getMaxRows() - M.HEADER_ROW;
  const used = below > 0 && report.getRange(M.HEADER_ROW + 1, col, below, 1).getFormulas().some(r => r[0]) ||
    below > 0 && report.getRange(M.HEADER_ROW + 1, col, below, 1).getDisplayValues().some(r => tgClean_(r[0]));
  if (used) throw new Error('العمود ' + tgColLetter_(col) + ' تحت ' + a1 + ' فيه بيانات. أفرغه أولاً لأن نتائج QUERY ستمتد إليه.');

  if (dryRun) return 'سيُضاف العنوان في ' + M.REPORT_SHEET + '!' + a1;
  const head = report.getRange(M.HEADER_ROW, col);
  report.getRange(M.HEADER_ROW, entry).copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  head.setValue(TASKCODE.HEADER);
  return 'أُضيف العنوان في ' + M.REPORT_SHEET + '!' + a1;
}

/* ======================= الترقيم وفحص التكرار ======================= */

function tcAssign_(dryRun) {
  const T = TASKCODE;
  const t0 = Date.now();
  const engineers = tcEngineers_(false);
  const all = {};           // الرمز ← مواضعه
  const issues = [];        // [الرمز، المشكلة، المهندس، الصف، الموضوع، الرابط]
  const lines = [];
  let total = 0, files = 0;
  const general = /^[A-Z]\d+-\d+$/;

  engineers.forEach(e => {
    if (e.isNew && !dryRun) { lines.push('⚠️ ' + e.name + ': بلا رمز مهندس — شغّل «رمز المهمة: تجهيز» أولاً'); return; }
    let f;
    try { f = tcOpenTaskFile_(e.id); } catch (err) { lines.push('⚠️ ' + e.name + ': ' + err.message); return; }
    if (!f) { lines.push('⚠️ ' + e.name + ': تعذّر فتح الملف'); return; }
    if (!f.col) {
      if (!dryRun) { lines.push('⚠️ ' + e.name + ': لا يوجد عمود «' + T.HEADER + '» — شغّل «رمز المهمة: تجهيز»'); return; }
      // المعاينة قبل التجهيز: عدد الصفوف التي ستُرقَّم
      const last0 = f.sheet.getLastRow(), first0 = f.layout.firstRow;
      const k0 = last0 < first0 ? 0 : f.sheet.getRange(first0, f.layout.cols.subject, last0 - first0 + 1, 1)
        .getDisplayValues().filter(r => tgClean_(r[0])).length;
      total += k0; files++;
      lines.push('• ' + e.name + ' (' + e.code + '): سيُرقَّم ' + k0 + ' بعد التجهيز');
      return;
    }
    files++;

    const first = f.layout.firstRow, last = f.sheet.getLastRow();
    if (last < first) { lines.push('• ' + e.name + ' (' + e.code + '): لا مهام'); return; }
    const n = last - first + 1;
    const subjects = f.sheet.getRange(first, f.layout.cols.subject, n, 1).getDisplayValues().map(r => tgClean_(r[0]));
    const range = f.sheet.getRange(first, f.col, n, 1);
    const codes = range.getDisplayValues().map(r => tgClean_(r[0]).toUpperCase());

    const own = new RegExp('^' + e.code + '-(\\d+)$');
    let max = 0;
    codes.forEach(c => { const m = own.exec(c); if (m) max = Math.max(max, Number(m[1])); });

    const out = codes.slice();
    let count = 0;
    const link = r => f.ss.getUrl() + '#gid=' + f.sheet.getSheetId() + '&range=A' + r;
    subjects.forEach((s, i) => {
      if (!s) return;                                   // صف بلا موضوع: لا رمز ولا فحص
      if (!out[i]) { out[i] = e.code + '-' + String(++max).padStart(T.SEQ_DIGITS, '0'); count++; }
      const code = out[i], row = first + i;
      (all[code] = all[code] || []).push({ eng: e.name, row: row, subject: s, url: link(row) });
      if (!general.test(code)) issues.push([code, 'صيغة غير صحيحة', e.name, row, s, link(row)]);
      else if (!own.test(code)) issues.push([code, 'رمز مهندس آخر (ربما نُسخ الصف من ملف آخر)', e.name, row, s, link(row)]);
    });

    if (count && !dryRun) range.setValues(out.map(c => [c]));
    total += count;
    lines.push('• ' + e.name + ' (' + e.code + '): ' + (count ? (dryRun ? 'سيُرقَّم ' : 'رُقّم ') + count : 'لا جديد'));
  });

  // التكرار داخل الملف الواحد وبين الملفات
  Object.keys(all).forEach(code => {
    if (all[code].length < 2) return;
    all[code].forEach(p => issues.push([code, 'مكرر (' + all[code].length + ' صفوف)', p.eng, p.row, p.subject, p.url]));
  });

  if (!dryRun) tcWriteReport_(issues);
  const head = (dryRun ? '🔍 ' : '✅ ') + (dryRun ? 'سيُرقَّم ' : 'رُقّم ') + total + ' مهمة في ' + files + ' ملف' +
    ' | مشكلات: ' + issues.length + (issues.length && !dryRun ? ' (التفاصيل في ورقة «' + T.REPORT_SHEET + '»)' : '');
  return { text: head + '\n\n' + lines.join('\n') + '\n\n(' + Math.round((Date.now() - t0) / 1000) + ' ثانية)', issues: issues, total: total };
}

function tcWriteReport_(issues) {
  const T = TASKCODE;
  const master = mfMaster_();
  let sh = master.getSheetByName(T.REPORT_SHEET);
  if (!sh) { sh = master.insertSheet(T.REPORT_SHEET, master.getSheets().length); sh.setRightToLeft(true); }
  sh.clear();
  const head = [['الرمز', 'المشكلة', 'المهندس', 'الصف', 'الموضوع', 'الرابط']];
  sh.getRange(1, 1, 1, 6).setValues(head)
    .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF').setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  if (issues.length) {
    issues.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])) || a[3] - b[3]);
    sh.getRange(2, 1, issues.length, 6).setValues(issues.map(r => [r[0], r[1], r[2], r[3], r[4],
      '=HYPERLINK("' + r[5] + '","فتح الصف")']));
  } else {
    sh.getRange(2, 1).setValue('لا توجد مشكلات ✓');
  }
  sh.getRange(1, 8).setValue('آخر فحص: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  sh.autoResizeColumns(1, 4);
  sh.setColumnWidth(5, 380);
}
