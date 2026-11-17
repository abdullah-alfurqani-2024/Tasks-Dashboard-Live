// =====================================================================
//  نسخ ورقة Report إلى ملف الاستيراد + رمز ثابت لكل مهمة
//  يحل محل دالة النسخ الحالية لملف الاستيراد (لا دالة نسخ ملف Looker). بعد الاستبدال
//  اجعل المؤقت الحالي يشغّل importCopyWithCodes بدل الدالة القديمة.
//
//  الفكرة:
//   - ورقة Report في ملف الاستيراد تُبنى من جديد في كل تشغيل كما كانت (صورة من الملف الرئيسي)،
//     مرتبة تنازلياً حسب تاريخ الاستقبال (مثل Looker)، مع عمود جديد في آخرها: «رمز المهمة».
//   - الرموز محفوظة في ورقة دائمة «سجل_الرموز» في ملف الاستيراد، لا في Report، فلا تضيع عند إعادة البناء.
//   - هوية المهمة = رمز المهندس + تاريخ الإدخال (يكتبه EntryDate.gs في ملفات المهندسين).
//     وإن تغيّرت كتابة اسم مهندس، يُعرف من تواريخ إدخال مهامه فيبقى رمزه ورموز مهامه.
//     فتعديل الحالة أو الموضوع أو أي حقل آخر لا يغيّر الرمز، والفرز والحذف والإضافة لا تغيّره.
//   - المهمة التي تختفي من المصدر تبقى في السجل برمزها («غير موجودة في المصدر»)، ورمزها لا يُعطى لغيرها أبداً،
//     وإن عادت تستعيده.
//   - الرمز: رمز المهندس + تسلسل، مثل A03-0142. رموز المهندسين في ورقة «رموز_المهندسين» (تُعطى تلقائياً
//     بترتيب الظهور، ويمكن تعديلها يدوياً قبل أول تشغيل). لا تحذف صفوفاً من «سجل_الرموز» أبداً:
//     هو ما يضمن ألا يتكرر رمز. المهام الجديدة في التشغيل الواحد تُرقَّم بترتيب تاريخ إدخالها.
//   - كل تشغيل يُسجَّل في ورقة «سجل_الترميز»: كم مهمة، وكم جديدة، وما اختفى، وما يحتاج مراجعة.
//
//  الدوال:
//   importCopyWithCodes()  النسخ والترميز (يشغّله المؤقت، أو يدوياً)
//   codesCheck()           فحص فقط، لا يكتب شيئاً: هل الأعمدة معروفة، وكم مهمة بلا تاريخ إدخال، وكم تكرار
// =====================================================================

var CODES = {
  SOURCE_FILE_ID: 'ضع_معرّف_الملف_الرئيسي',     // Data-Processing-Live
  DEST_FILE_ID: 'ضع_معرّف_ملف_الاستيراد',      // ملف الاستيراد (لا ملف Looker)
  SHEET: 'Report',
  SOURCE_RANGE: 'B37:O',     // حتى العمود O ليصل تاريخ الإدخال (كان B37:N)
  DEST_START: 'B2',
  CODE_HEADER: 'رمز المهمة',
  PREFIX: 'A',               // A03-0142
  ENG_DIGITS: 2,
  SEQ_DIGITS: 4,
  REGISTRY_SHEET: 'سجل_الرموز',
  ENGINEERS_SHEET: 'رموز_المهندسين',
  LOG_SHEET: 'سجل_الترميز',
  // أسماء الأعمدة كما في صف العناوين (يبحث عنها السكربت، فلا يعتمد على ترتيبها)
  H: {
    engineer: 'اسم المهندس', ref: 'رقم القيد', requester: 'الجهة الطالبة', employee: 'اسم الموظف',
    subject: 'الموضوع', received: 'تاريخ الاستقبال', taskType: 'نوع المهمة', entry: 'تاريخ الإدخال'
  },
  REQUIRED: ['engineer', 'entry', 'subject', 'received'],
  // حماية من عطل مؤقت في Report («لا توجد بيانات» مثلاً): إن قلّ عدد المهام عن هذه النسبة من آخر تشغيل
  // ناجح، يتوقف دون أن يكتب. لحذف كبير مقصود (أرشفة مثلاً) اجعلها 0 لتشغيل واحد ثم أعدها.
  MIN_RATIO: 0.8,
  // حد جوجل لأي تشغيل 6 دقائق. إن استغرقت القراءة أكثر من هذا (المصدر يُعاد حسابه مثلاً)، يتوقف قبل الكتابة
  // بدل أن يُقطع في منتصفها، ويحاول في التشغيل التالي.
  MAX_SECONDS_BEFORE_WRITE: 240
};

var CODES_REG_HEAD = ['رمز المهمة', 'رمز المهندس', 'اسم المهندس', 'تاريخ الإدخال', 'البصمة', 'أول ظهور', 'آخر ظهور', 'الحالة', 'ملاحظة'];
var CODES_RC = { code: 0, engCode: 1, eng: 2, entry: 3, print: 4, first: 5, last: 6, state: 7, note: 8 };
var CODES_LOG_HEAD = ['الوقت', 'مهام', 'ثابتة', 'جديدة', 'اختفت', 'عادت', 'بلا تاريخ إدخال', 'تاريخ إدخال مكرر', 'مهندسون جدد', 'التفاصيل'];
var CODES_PRESENT = 'موجودة', CODES_MISSING = 'غير موجودة في المصدر';

// ---------------------------------------------------------------------
function importCopyWithCodes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { Logger.log('تشغيل آخر قيد العمل، أُجّل.'); return; }
  try {
    var t0 = Date.now();
    var ctx = codesLoad_();
    if (!ctx) return;
    var tRead = Math.round((Date.now() - t0) / 1000);
    var prev = codesLastTotal_(ctx.dst);
    if (prev && ctx.rows.length < prev * CODES.MIN_RATIO) {
      var why = 'أُوقف: ' + ctx.rows.length + ' مهمة فقط في المصدر مقابل ' + prev + ' في آخر تشغيل ناجح (أقل من ' +
        Math.round(CODES.MIN_RATIO * 100) + '%). لم يُكتب شيء. راجع Report في المصدر.';
      Logger.log('⚠ ' + why);
      codesSheet_(ctx.dst, CODES.LOG_SHEET, CODES_LOG_HEAD).appendRow([ctx.now, ctx.rows.length, '', '', '', '', '', '', '', why]);
      return;
    }
    var res = codesAssign_(ctx);
    var spent = Math.round((Date.now() - t0) / 1000);
    if (spent > CODES.MAX_SECONDS_BEFORE_WRITE) {
      var late = 'أُوقف: القراءة استغرقت ' + spent + ' ثانية (المصدر قيد إعادة الحساب غالباً). لم يُكتب شيء، ويحاول التشغيل التالي.';
      Logger.log('⚠ ' + late);
      codesSheet_(ctx.dst, CODES.LOG_SHEET, CODES_LOG_HEAD).appendRow([ctx.now, ctx.rows.length, '', '', '', '', '', '', '', late]);
      return;
    }
    // السجل أولاً: هو مرجع الرموز. لو قُطع التشغيل بعده، يُصلح التشغيل التالي ورقة Report
    codesSaveRegistry_(ctx);
    codesWriteReport_(ctx, res);
    res.timing = 'المدة: قراءة ' + tRead + ' ث، المجموع ' + Math.round((Date.now() - t0) / 1000) + ' ث';
    codesLog_(ctx, res);
    Logger.log(codesSummary_(res) + '\n' + res.timing);
  } finally {
    lock.releaseLock();
  }
}

// فحص فقط
function codesCheck() {
  var ctx = codesLoad_();
  if (!ctx) return;
  var res = codesAssign_(ctx);
  Logger.log('فحص فقط (لم يُكتب شيء):\nالأعمدة: ' + JSON.stringify(ctx.colNames) + '\n' + codesSummary_(res));
}

// =====================================================================
//  الداخلي
// =====================================================================

function codesLoad_() {
  var src = SpreadsheetApp.openById(codesId_(CODES.SOURCE_FILE_ID, 'SOURCE_FILE_ID'));
  var dst = SpreadsheetApp.openById(codesId_(CODES.DEST_FILE_ID, 'DEST_FILE_ID'));
  var s = src.getSheetByName(CODES.SHEET), d = dst.getSheetByName(CODES.SHEET);
  if (!s || !d) { Logger.log('لا توجد ورقة ' + CODES.SHEET + ' في أحد الملفين.'); return null; }
  var tz = dst.getSpreadsheetTimeZone();

  var range = s.getRange(CODES.SOURCE_RANGE);
  var data = range.getValues();
  var width = data.length ? data[0].length : 0;

  // صف العناوين: الصف الذي فوق بداية النسخ في المصدر، وإلا الذي فوق بداية اللصق في ملف الاستيراد
  var destCell = d.getRange(CODES.DEST_START);
  var heads = [];
  if (range.getRow() > 1) heads = s.getRange(range.getRow() - 1, range.getColumn(), 1, width).getValues()[0];
  var col = codesFindCols_(heads);
  if (!col && destCell.getRow() > 1) {
    heads = d.getRange(destCell.getRow() - 1, destCell.getColumn(), 1, width).getValues()[0];
    col = codesFindCols_(heads);
  }
  if (!col) {
    Logger.log('لم أجد الأعمدة المطلوبة (' + CODES.REQUIRED.map(function (k) { return CODES.H[k]; }).join('، ') +
      ') في صف العناوين. العناوين الموجودة: ' + heads.join(' | ') + '\nلم يُكتب شيء.');
    return null;
  }

  // المهام فقط (صف فيه أي إدخال غير اسم المهندس والمعادلات)
  var inputCols = ['ref', 'requester', 'employee', 'subject', 'received', 'taskType', 'entry']
    .map(function (k) { return col[k]; }).filter(function (i) { return i !== undefined; });
  var rows = data.filter(function (row) {
    return inputCols.some(function (i) { var v = row[i]; return v instanceof Date || String(v).trim() !== ''; });
  });

  var reg = codesSheet_(dst, CODES.REGISTRY_SHEET, CODES_REG_HEAD);
  var regData = reg.getLastRow() > 1 ? reg.getRange(2, 1, reg.getLastRow() - 1, CODES_REG_HEAD.length).getValues() : [];
  var engSh = codesSheet_(dst, CODES.ENGINEERS_SHEET, ['اسم المهندس', 'رمز المهندس']);
  var engData = engSh.getLastRow() > 1 ? engSh.getRange(2, 1, engSh.getLastRow() - 1, 2).getValues() : [];

  return {
    src: src, dst: dst, d: d, tz: tz, destCell: destCell, width: width, col: col, rows: rows,
    reg: reg, regData: regData, engSh: engSh, engData: engData, now: new Date(),
    colNames: Object.keys(col).reduce(function (o, k) { o[CODES.H[k]] = codesColLetter_(range.getColumn() + col[k]); return o; }, {})
  };
}

function codesFindCols_(heads) {
  var norm = heads.map(codesNorm_), col = {};
  Object.keys(CODES.H).forEach(function (k) {
    var i = norm.indexOf(codesNorm_(CODES.H[k]));
    if (i >= 0) col[k] = i;
  });
  return CODES.REQUIRED.every(function (k) { return col[k] !== undefined; }) ? col : null;
}

function codesAssign_(ctx) {
  var col = ctx.col, tz = ctx.tz;
  var res = { total: ctx.rows.length, kept: 0, added: [], missing: [], back: [], adopted: 0, noEntry: 0, dupEntry: [], newEng: [], renamed: [] };

  // رموز المهندسين
  var engCode = {}, usedEng = {};
  ctx.engData.forEach(function (r) { var n = codesNorm_(r[0]), c = String(r[1]).trim(); if (n && c) { engCode[n] = c; usedEng[c] = true; } });

  // السجل: فهرس بالهوية (رمز المهندس + تاريخ الإدخال)، وبالبصمة لما لا تاريخ له، وآخر تسلسل لكل مهندس
  var byId = {}, byPrint = {}, byEntry = {}, maxSeq = {}, claimed = {};
  ctx.regData.forEach(function (r, i) {
    var ec = String(r[CODES_RC.engCode]).trim(), k = codesKey_(r[CODES_RC.entry], tz);
    if (k) { byId[ec + '|' + k] = i; (byEntry[k.replace(/#\d+$/, '')] = byEntry[k.replace(/#\d+$/, '')] || []).push(ec); }
    else (byPrint[ec + '|' + r[CODES_RC.print]] = byPrint[ec + '|' + r[CODES_RC.print]] || []).push(i);
    var m = String(r[CODES_RC.code]).match(/^(.+)-(\d+)$/);
    if (m) maxSeq[m[1]] = Math.max(maxSeq[m[1]] || 0, parseInt(m[2], 10));
  });

  // أسماء جديدة: تغيّر اسم مهندس موجود (نفس تواريخ الإدخال في السجل) أم مهندس جديد؟
  var unknown = {};
  ctx.rows.forEach(function (row) {
    var eng = codesNorm_(row[col.engineer]);
    if (engCode[eng]) return;
    (unknown[eng] = unknown[eng] || { raw: String(row[col.engineer]).trim(), entries: [] }).entries.push(codesKey_(row[col.entry], tz));
  });
  Object.keys(unknown).forEach(function (eng) {
    var u = unknown[eng], count = {}, best = null;
    u.entries.forEach(function (k) { (byEntry[k] || []).forEach(function (ec) { count[ec] = (count[ec] || 0) + 1; }); });
    Object.keys(count).forEach(function (ec) { if (!best || count[ec] > count[best]) best = ec; });
    if (best && count[best] >= Math.max(1, Math.ceil(u.entries.length / 2))) {
      engCode[eng] = best;
      ctx.engData.push([u.raw, best]);
      res.renamed.push(u.raw + ' = ' + best + ' (تغيّر الاسم، ' + count[best] + ' مهمة مطابقة)');
    } else {
      var n = 1, c;
      do { c = CODES.PREFIX + codesPad_(n++, CODES.ENG_DIGITS); } while (usedEng[c]);
      engCode[eng] = c; usedEng[c] = true;
      ctx.engData.push([u.raw, c]);
      res.newEng.push(u.raw + ' = ' + c);
    }
  });

  var codes = new Array(ctx.rows.length), fresh = [], seenId = {};
  ctx.rows.forEach(function (row, idx) {
    var ec = engCode[codesNorm_(row[col.engineer])];
    var entry = codesKey_(row[col.entry], tz);
    var print = codesPrint_(row, col, tz);
    var regIdx, id = '';
    if (entry) {
      id = entry;
      if (seenId[ec + '|' + entry] !== undefined) {
        res.dupEntry.push('«' + String(row[col.subject]).slice(0, 40) + '» (' + String(row[col.engineer]).trim() + ' — ' + entry + ')');
        seenId[ec + '|' + entry]++;
        id = entry + '#' + seenId[ec + '|' + entry];
      } else seenId[ec + '|' + entry] = 0;
      regIdx = byId[ec + '|' + id];
      // مهمة سُجّلت سابقاً بلا تاريخ إدخال ثم أُكمل تاريخها: تُعرف من بصمتها
      if (regIdx === undefined || claimed[regIdx]) {
        var cand = (byPrint[ec + '|' + print] || []).filter(function (i) { return !claimed[i]; });
        if (cand.length) { regIdx = cand[0]; ctx.regData[regIdx][CODES_RC.entry] = id; ctx.regData[regIdx][CODES_RC.note] = ''; res.adopted++; }
      }
    } else {
      res.noEntry++;
      var cand2 = (byPrint[ec + '|' + print] || []).filter(function (i) { return !claimed[i]; });
      if (cand2.length) regIdx = cand2[0];
    }
    if (regIdx !== undefined && !claimed[regIdx]) {
      claimed[regIdx] = true;
      var r = ctx.regData[regIdx];
      if (r[CODES_RC.state] !== CODES_PRESENT) { res.back.push(r[CODES_RC.code]); r[CODES_RC.note] = ''; }
      r[CODES_RC.last] = ctx.now; r[CODES_RC.state] = CODES_PRESENT; r[CODES_RC.print] = print; r[CODES_RC.eng] = String(row[col.engineer]).trim();
      codes[idx] = r[CODES_RC.code];
      res.kept++;
    } else {
      fresh.push({ idx: idx, ec: ec, id: id, print: print, ms: codesMs_(row[col.entry]) });
    }
  });

  // الجديدة: تسلسل لكل مهندس بترتيب تاريخ الإدخال
  fresh.sort(function (a, b) { return (a.ms || Infinity) - (b.ms || Infinity) || a.idx - b.idx; });
  fresh.forEach(function (f) {
    maxSeq[f.ec] = (maxSeq[f.ec] || 0) + 1;
    var code = f.ec + '-' + codesPad_(maxSeq[f.ec], CODES.SEQ_DIGITS);
    var row = ctx.rows[f.idx];
    ctx.regData.push([code, f.ec, String(row[col.engineer]).trim(), f.id, f.print, ctx.now, ctx.now, CODES_PRESENT, f.id ? '' : 'بلا تاريخ إدخال']);
    claimed[ctx.regData.length - 1] = true;
    codes[f.idx] = code;
    res.added.push(code);
  });

  // ما اختفى من المصدر في هذا التشغيل
  ctx.regData.forEach(function (r, i) {
    if (!claimed[i] && r[CODES_RC.state] === CODES_PRESENT) { r[CODES_RC.state] = CODES_MISSING; r[CODES_RC.note] = 'اختفت ' + Utilities.formatDate(ctx.now, tz, 'yyyy-MM-dd HH:mm'); res.missing.push(r[CODES_RC.code]); }
  });

  ctx.codes = codes;
  return res;
}

function codesWriteReport_(ctx, res) {
  var d = ctx.d, row0 = ctx.destCell.getRow(), col0 = ctx.destCell.getColumn(), w = ctx.width + 1;
  // مسح المنطقة القديمة (المحتوى فقط، التنسيق يبقى)
  var last = d.getLastRow();
  if (last >= row0) d.getRange(row0, col0, last - row0 + 1, w).clearContent();
  var need = row0 + ctx.rows.length - 1;
  if (d.getMaxRows() < need) d.insertRowsAfter(d.getMaxRows(), need - d.getMaxRows());   // صفوف إضافية إن لم تتسع
  if (ctx.rows.length) {
    var c = ctx.col;
    var out = ctx.rows.map(function (r, i) { return r.concat([ctx.codes[i]]); });
    // ترتيب تنازلي حسب تاريخ الاستقبال (مثل Looker)، ثم تاريخ الإدخال، ثم ترتيب المصدر. بلا تاريخ استقبال في الآخر
    var order = out.map(function (r, i) { return { r: r, i: i, rec: codesMs_(r[c.received]), ent: codesMs_(r[c.entry]) }; });
    order.sort(function (a, b) {
      var ra = a.rec || -Infinity, rb = b.rec || -Infinity;
      if (ra !== rb) return rb > ra ? 1 : -1;
      var ea = a.ent || -Infinity, eb = b.ent || -Infinity;
      if (ea !== eb) return eb > ea ? 1 : -1;
      return a.i - b.i;
    });
    out = order.map(function (o) { return o.r; });
    d.getRange(row0, col0, out.length, w).setValues(out);
  }
  // قصّ الصفوف الفارغة تحت آخر مهمة (ملف قيم فقط؛ التشغيل التالي يضيف صفوفاً إن احتاج)
  var keep = Math.max(need, row0);
  if (d.getMaxRows() > keep) d.deleteRows(keep + 1, d.getMaxRows() - keep);
  if (row0 > 1) {
    var h = d.getRange(row0 - 1, col0 + ctx.width);
    if (String(h.getValue()).trim() === '') h.setValue(CODES.CODE_HEADER);
    var he = d.getRange(row0 - 1, col0 + ctx.col.entry);
    if (String(he.getValue()).trim() === '') he.setValue(CODES.H.entry);
  }
}

function codesSaveRegistry_(ctx) {
  if (ctx.regData.length) ctx.reg.getRange(2, 1, ctx.regData.length, CODES_REG_HEAD.length).setValues(ctx.regData);
  if (ctx.engData.length) ctx.engSh.getRange(2, 1, ctx.engData.length, 2).setValues(ctx.engData);
}

function codesLog_(ctx, res) {
  var sh = codesSheet_(ctx.dst, CODES.LOG_SHEET, CODES_LOG_HEAD);
  var details = [];
  if (res.added.length) details.push('جديدة: ' + codesRangeText_(res.added));
  if (res.missing.length) details.push('اختفت: ' + res.missing.join('، '));
  if (res.back.length) details.push('عادت: ' + res.back.join('، '));
  if (res.dupEntry.length) details.push('تاريخ إدخال مكرر (راجعها): ' + res.dupEntry.join('؛ '));
  if (res.renamed.length) details.push('تغيّر اسم مهندس: ' + res.renamed.join('، '));
  if (res.timing) details.push(res.timing);
  sh.appendRow([ctx.now, res.total, res.kept, res.added.length, res.missing.length, res.back.length, res.noEntry, res.dupEntry.length,
    res.newEng.join('، '), details.join('\n')]);
}

// عدد المهام في آخر تشغيل ناجح (يتجاهل أسطر «أُوقف»)
function codesLastTotal_(dst) {
  var sh = dst.getSheetByName(CODES.LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, CODES_LOG_HEAD.length).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][9]).indexOf('أُوقف') === 0) continue;
    var n = Number(rows[i][1]);
    if (n > 0) return n;
  }
  return 0;
}

function codesSummary_(res) {
  return 'مهام: ' + res.total + '، ثابتة: ' + res.kept + '، جديدة: ' + res.added.length + '، اختفت: ' + res.missing.length +
    '، عادت: ' + res.back.length + '، بلا تاريخ إدخال: ' + res.noEntry + '، تاريخ إدخال مكرر: ' + res.dupEntry.length +
    (res.newEng.length ? '\nمهندسون جدد: ' + res.newEng.join('، ') : '') +
    (res.renamed.length ? '\nتغيّر اسم مهندس: ' + res.renamed.join('، ') : '');
}

// البصمة: الحقول التي لا تتغير عادة (احتياط لمهمة بلا تاريخ إدخال)
function codesPrint_(row, col, tz) {
  return '¦' + ['ref', 'requester', 'employee', 'subject', 'received', 'taskType'].map(function (k) {
    if (col[k] === undefined) return '';
    var v = row[col[k]];
    return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : codesNorm_(v);
  }).join('¦');
}

function codesKey_(v, tz) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(#\d+)?$/);
  if (m) return m[1] + '-' + codesPad_(m[2], 2) + '-' + codesPad_(m[3], 2) + ' ' + codesPad_(m[4], 2) + ':' + m[5] + ':' + (m[6] || '00') + (m[7] || '');
  return s;
}

function codesMs_(v) {
  if (v instanceof Date) return v.getTime();
  var m = String(v || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0;
}
function codesNorm_(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }
function codesPad_(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
function codesColLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

// معرّف ملف من النص المكتوب في الإعدادات: يقبل المعرّف وحده أو رابط الملف كاملاً
function codesId_(v, label) {
  var s = String(v || '').trim(), m = s.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (m) s = m[1];
  if (!/^[A-Za-z0-9_-]{20,}$/.test(s)) {
    throw new Error('قيمة ' + label + ' في أعلى السكربت ليست معرّف ملف: «' + String(v) + '». ' +
      'ضع الجزء من رابط الملف بين ‎/d/‎ و ‎/edit‎ (أو الرابط كاملاً) بين علامتي التنصيص.');
  }
  return s;
}

function codesSheet_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

// «A01-0001 … A01-0005، A02-0001» بدل قائمة طويلة
function codesRangeText_(list) {
  var by = {};
  list.forEach(function (c) { var m = c.match(/^(.+)-(\d+)$/); (by[m[1]] = by[m[1]] || []).push(parseInt(m[2], 10)); });
  return Object.keys(by).sort().map(function (k) {
    var a = by[k].sort(function (x, y) { return x - y; });
    var f = function (n) { return k + '-' + codesPad_(n, CODES.SEQ_DIGITS); };
    return a.length > 2 && a[a.length - 1] - a[0] === a.length - 1 ? f(a[0]) + ' … ' + f(a[a.length - 1]) + ' (' + a.length + ')' : a.map(f).join('، ');
  }).join('، ');
}
