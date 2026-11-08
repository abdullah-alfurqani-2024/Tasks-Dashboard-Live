/**
 * ============================================================
 *  تغذية الملف الرئيسي من ملفات المهندسين — Google Apps Script
 * ============================================================
 *  كيف تعمل التغذية اللحظية:
 *  - لكل مهندس ورقة (مخفية) في الملف الرئيسي فيها IMPORTRANGE من ملفه
 *  - معادلة QUERY في Report!B37 تجمع هذه الأوراق مع كل خيارات الفرز الحالية
 *  - IMPORTRANGE تتحدث تلقائياً خلال ثوانٍ من إدخال المهندس، بلا مشغّلات (Triggers)
 *    ولا حدود تنفيذ، وتستمر بالعمل بعد التسليم دون أي تدخل
 *
 *  قوائم الاختيار:
 *  - مصدرها الوحيد ورقة «Lists» في الملف الرئيسي
 *  - السكربت ينسخها إلى قالب المهندس وكل ملفات المهندسين وخانات الفرز في Report
 *
 *  الوظائف:
 *    syncListsFromMaster()  ← تجهيز Lists ونشر القوائم (شغّلها قبل إنشاء ملفات المهندسين)
 *    setupMasterFeed()      ← ربط ملفات المهندسين بالملف الرئيسي وبناء معادلة QUERY
 *    checkMasterFeed()      ← فحص حالة الربط لكل مهندس
 *
 *  يتطلب وجود EngineerFilesGenerator.gs في نفس المشروع (يستخدم سجل الملفات واكتشاف الأعمدة)
 * ============================================================
 */

const MASTERFEED = {
  MASTER_FILE_ID: '',               // معرّف الملف الرئيسي — مطلوب
  REPORT_SHEET: 'Report',
  LISTS_SHEET: 'Lists',
  HEADER_ROW: 36,                   // صف عناوين جدول التفاصيل في Report
  FIRST_HEADER: 'اسم المهندس',       // أول عمود تكتب فيه QUERY (B)
  LAST_HEADER: 'تاريخ الإدخال',      // آخر عمود (O)
  HIDE_ENGINEER_TABS: true,
  BACKUP_SHEET: 'نسخ_احتياطية',      // تُحفظ فيها معادلة B37 القديمة قبل استبدالها

  // خانات الفرز في Report
  FILTERS: {
    engineer: '$B$4', taskType: '$D$4', corrType: '$F$4', status: '$H$4',
    from: '$L$4', to: '$M$4', year: '$N$4', sortField: '$C$34', sortDir: '$F$34'
  },
  DESC_LABEL: 'تنازلي',

  // ورقة Lists: عمود أسماء المهندسين (تستخدمه جداول Report في A16 و G16)
  ENGINEERS_COL: 'F',
  ENGINEERS_HEADER: 'المهندسون',
  // القوائم: عنوانها في الصف الأول من Lists. إن لم يوجد العنوان يُضاف عمود جديد بالقيم الافتراضية
  LIST_HEADERS: { taskType: 'نوع المهمة', corrType: 'نوع المراسلة', status: 'الحالة' },
  DEFAULT_LISTS: {
    taskType: ['صيانة أجهزة', 'تركيب أجهزة جديدة', 'تثبيت وتحديث البرامج', 'دعم فني للبرامج',
               'فورمات وإعادة تثبيت النظام', 'شبكات واتصال', 'طابعات', 'حسابات وصلاحيات',
               'بريد إلكتروني', 'أخرى'],
    corrType: ['مراسلة', 'طلب خدمة', 'اتصال', 'حضور مباشر', 'تكليف مباشر'],
    status:   ['مكتمل', 'غير مكتمل', 'قيد التنفيذ', 'ملغي']
  },
  // خانات الفرز في Report وما يقابلها من قوائم
  FILTER_LISTS: { '$B$4': 'engineers', '$D$4': 'taskType', '$F$4': 'corrType', '$H$4': 'status' }
};

/* ======================= نقاط الدخول ======================= */

function syncListsFromMaster() {
  mfGuard_(() => {
    const r = mfSyncLists_();
    tgNotify_('✅ تمت مزامنة القوائم\n\n' + r.join('\n'));
  });
}

function setupMasterFeed() {
  mfGuard_(() => {
    const t0 = Date.now();
    const listsReport = mfSyncLists_();
    const master = mfMaster_();
    const engineers = mfEngineers_();
    if (!engineers.length) throw new Error('لا توجد ملفات مهندسين في السجل. شغّل generateEngineerFiles أولاً.');

    const tpl = mfTemplateLayout_();
    const report = master.getSheetByName(MASTERFEED.REPORT_SHEET);
    const mcols = mfMasterColumns_(report);
    mfCheckColumnsMatch_(tpl, mcols);

    // 1) ورقة IMPORTRANGE لكل مهندس + حذف أوراق مهندسين لم يعودوا في السجل
    const tabs = mfBuildTabs_(master, engineers, tpl);

    // 2) السماح لـ IMPORTRANGE بالوصول (مرة واحدة لكل ملف)
    let allowed = 0;
    engineers.forEach(e => { if (mfAllowImport_(master.getId(), e.id)) allowed++; });

    // 3) معادلة QUERY الموحّدة في Report
    mfWriteQuery_(master, report, mcols, tabs);
    SpreadsheetApp.flush();

    Utilities.sleep(5000);
    const status = mfStatus_(master, engineers);
    tgNotify_('✅ تم ربط الملف الرئيسي بملفات المهندسين\n\n' +
      'المهندسون: ' + engineers.length + ' | أوراق الربط: ' + tabs.length +
      ' | تم السماح تلقائياً: ' + allowed + '\n' +
      'معادلة QUERY كُتبت في ' + MASTERFEED.REPORT_SHEET + '!' + mcols.queryA1 + '\n\n' +
      listsReport.join('\n') + '\n\n' + status.text +
      '\n\n(' + Math.round((Date.now() - t0) / 1000) + ' ثانية)');
  });
}

function checkMasterFeed() {
  mfGuard_(() => {
    const st = mfStatus_(mfMaster_(), mfEngineers_());
    tgNotify_(st.text);
  });
}

function mfGuard_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { tgNotify_('يوجد تنفيذ آخر قيد التشغيل.'); return; }
  try { fn(); }
  catch (e) { tgNotify_('حدث خطأ: ' + e.message); throw e; }
  finally { lock.releaseLock(); }
}

/* ======================= القوائم ======================= */

/** يجهّز ورقة Lists في الملف الرئيسي ثم ينشر القوائم إلى القالب وملفات المهندسين وخانات الفرز */
function mfSyncLists_() {
  const M = MASTERFEED, out = [];
  const master = mfMaster_();
  let sh = master.getSheetByName(M.LISTS_SHEET);
  if (!sh) { sh = master.insertSheet(M.LISTS_SHEET); sh.setRightToLeft(true); out.push('• أُنشئت ورقة ' + M.LISTS_SHEET); }

  // القوائم الثلاث: تُقرأ من Lists إن وُجدت، وإلا تُضاف من ملف البيانات أو القيم الافتراضية
  const lists = {}, ranges = {};
  const engColIdx = mfColIndex_(M.ENGINEERS_COL);
  Object.keys(M.LIST_HEADERS).forEach(k => {
    const header = M.LIST_HEADERS[k];
    let col = mfFindHeaderCol_(sh, header);
    if (!col) {
      col = mfFirstFreeCol_(sh, [engColIdx]);
      const vals = mfSeedValues_(k);
      sh.getRange(1, col).setValue(header).setFontWeight('bold');
      sh.getRange(2, col, vals.length, 1).setValues(vals.map(v => [v]));
      out.push('• أُضيفت قائمة «' + header + '» في العمود ' + tgColLetter_(col) + ' (' + vals.length + ' قيم)');
    }
    const last = Math.max(sh.getLastRow(), 2);
    lists[k] = tgUnique_(sh.getRange(2, col, last - 1, 1).getDisplayValues().map(r => tgClean_(r[0])));
    ranges[k] = sh.getRange(2, col, sh.getMaxRows() - 1, 1);
    if (!lists[k].length) throw new Error('قائمة «' + header + '» في ورقة ' + M.LISTS_SHEET + ' فارغة.');
  });

  // أسماء المهندسين في العمود F (تستخدمها جداول Report)
  const engineers = mfEngineers_();
  if (engineers.length) {
    const max = sh.getMaxRows();
    sh.getRange(2, engColIdx, max - 1, 1).clearContent();
    if (!tgClean_(sh.getRange(1, engColIdx).getValue())) {
      sh.getRange(1, engColIdx).setValue(M.ENGINEERS_HEADER).setFontWeight('bold');
    }
    sh.getRange(2, engColIdx, engineers.length, 1).setValues(engineers.map(e => [e.name]));
    out.push('• أسماء المهندسين في ' + M.LISTS_SHEET + '!' + M.ENGINEERS_COL + ': ' + engineers.length);
    if (engineers.length > 16) out.push('  ⚠️ جداول Report (الصفوف 16–31) تتسع لـ 16 مهندساً فقط');
  }
  ranges.engineers = sh.getRange(2, engColIdx, sh.getMaxRows() - 1, 1);

  // خانات الفرز في Report
  const report = master.getSheetByName(M.REPORT_SHEET);
  if (report) {
    Object.keys(M.FILTER_LISTS).forEach(a1 => {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(ranges[M.FILTER_LISTS[a1]], true).setAllowInvalid(false).build();
      report.getRange(a1.replace(/\$/g, '')).setDataValidation(rule);
    });
    out.push('• خانات الفرز في ' + M.REPORT_SHEET + ' مرتبطة بورقة ' + M.LISTS_SHEET);
  }

  // القالب + ملفات المهندسين
  const files = [TASKGEN.TEMPLATE_FILE_ID].concat(engineers.map(e => e.id)).filter(Boolean);
  let pushed = 0;
  files.forEach(id => {
    try {
      const ss = SpreadsheetApp.openById(id);
      const s = tgTaskSheet_(ss);
      const layout = tgDetectLayout_(s);
      Object.keys(M.LIST_HEADERS).forEach(k => {
        const c = layout.cols[k];
        if (!c) return;
        const rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(lists[k], true).setAllowInvalid(false).build();
        s.getRange(layout.firstRow, c, s.getMaxRows() - layout.firstRow + 1, 1).setDataValidation(rule);
      });
      pushed++;
    } catch (e) {
      out.push('  ⚠️ تعذّر تحديث القوائم في ملف ' + id + ': ' + e.message);
    }
  });
  out.push('• القوائم نُشرت إلى ' + pushed + ' ملف (القالب + ملفات المهندسين)');
  return out;
}

/** القيم الأولية لقائمة غير موجودة: من ورقة Lists في ملف البيانات، وإلا القيم الافتراضية */
function mfSeedValues_(k) {
  try {
    const sh = tgDataSS_().getSheetByName(TASKGEN.SHEETS.LISTS);
    if (sh && sh.getLastRow() > 1) {
      const col = mfFindHeaderCol_(sh, MASTERFEED.LIST_HEADERS[k]);
      if (col) {
        const v = tgUnique_(sh.getRange(2, col, sh.getLastRow() - 1, 1).getDisplayValues().map(r => tgClean_(r[0])));
        if (v.length) return v;
      }
    }
  } catch (e) {}
  return MASTERFEED.DEFAULT_LISTS[k];
}

/* ======================= الربط ======================= */

function mfMaster_() {
  if (!MASTERFEED.MASTER_FILE_ID) throw new Error('ضع معرّف الملف الرئيسي في MASTERFEED.MASTER_FILE_ID.');
  return SpreadsheetApp.openById(MASTERFEED.MASTER_FILE_ID);
}

/** المهندسون وملفاتهم من ورقة «ملفات_المهندسين» بترتيبها */
function mfEngineers_() {
  const sh = tgDataSS_().getSheetByName(TASKGEN.SHEETS.REGISTRY);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .map(r => ({ name: tgClean_(r[0]), dept: tgClean_(r[1]), id: tgClean_(r[2]) }))
    .filter(e => e.name && e.id && tgOpenFile_(e.id));
}

/** أعمدة ملف المهندس التي تُسحب: من «اسم المهندس» إلى «تاريخ الإدخال» */
function mfTemplateLayout_() {
  const M = MASTERFEED;
  const ss = SpreadsheetApp.openById(TASKGEN.TEMPLATE_FILE_ID);
  const sh = tgTaskSheet_(ss);
  const layout = tgDetectLayout_(sh);
  // آخر عمود يُسحب: «رمز المهمة» إن وُجد (TaskCodes.gs)، وإلا «تاريخ الإدخال»
  const first = layout.cols.engineer, last = tcCodeCol_(sh, layout.headerRow) || layout.cols.entryDate;
  if (!first || !last) throw new Error('لم أجد عمودي «' + M.FIRST_HEADER + '» و«' + M.LAST_HEADER + '» في ملف القالب.');
  const headers = sh.getRange(layout.headerRow, first, 1, last - first + 1).getDisplayValues()[0].map(tgNorm_);
  return {
    headerRow: layout.headerRow, firstCol: first, lastCol: last, headers: headers,
    a1: tgColLetter_(first) + layout.headerRow + ':' + tgColLetter_(last)
  };
}

/** أعمدة جدول التفاصيل في Report */
function mfMasterColumns_(report) {
  const M = MASTERFEED;
  if (!report) throw new Error('ورقة ' + M.REPORT_SHEET + ' غير موجودة في الملف الرئيسي.');
  const row = report.getRange(M.HEADER_ROW, 1, 1, report.getLastColumn()).getDisplayValues()[0].map(tgNorm_);
  const first = row.indexOf(tgNorm_(M.FIRST_HEADER)) + 1;
  // آخر عمود: «رمز المهمة» إن وُجد بعد «تاريخ الإدخال» (TaskCodes.gs)، وإلا «تاريخ الإدخال»
  const codeAt = row.indexOf(tgNorm_(TASKCODE.HEADER)) + 1;
  const last = codeAt > first ? codeAt : row.indexOf(tgNorm_(M.LAST_HEADER)) + 1;
  if (!first || !last || last < first) {
    throw new Error('لم أجد عناوين الجدول في ' + M.REPORT_SHEET + '!' + M.HEADER_ROW + '.');
  }
  const headers = row.slice(first - 1, last);
  const col = name => {
    const i = headers.indexOf(tgNorm_(name));
    if (i < 0) throw new Error('عمود غير موجود في ' + M.REPORT_SHEET + ': ' + name);
    return i + 1;
  };
  const C = TASKGEN.COLUMNS;
  return {
    first: first, last: last, count: last - first + 1, headers: headers,
    queryA1: tgColLetter_(first) + (M.HEADER_ROW + 1),
    headerA1: "'" + M.REPORT_SHEET + "'!" + tgColLetter_(first) + M.HEADER_ROW + ':' + tgColLetter_(last) + M.HEADER_ROW,
    engineer: col(C.engineer), taskType: col(C.taskType), corrType: col(C.corrType),
    status: col(C.status), received: col(C.received)
  };
}

function mfCheckColumnsMatch_(tpl, mcols) {
  const a = tpl.headers.join(' | '), b = mcols.headers.join(' | ');
  if (a !== b) {
    throw new Error('ترتيب الأعمدة مختلف بين ملف المهندس والملف الرئيسي.\n\nالمهندس: ' + a + '\n\nالرئيسي: ' + b);
  }
}

/** ورقة لكل مهندس فيها IMPORTRANGE، مُعلَّمة ببيانات وصفية حتى لا يمس السكربت أوراقك الأخرى */
function mfBuildTabs_(master, engineers, tpl) {
  const KEY = 'mf_engineer_file';
  const tabs = [], keep = new Set();
  engineers.forEach(e => {
    const ss = SpreadsheetApp.openById(e.id);
    const srcSheet = tgTaskSheet_(ss).getName();
    let sh = mfTabByFileId_(master, e.id, KEY) || master.getSheetByName(e.name);
    if (!sh) {
      sh = master.insertSheet(e.name, master.getSheets().length);
      sh.addDeveloperMetadata(KEY, e.id);
    } else if (!mfTabByFileId_(master, e.id, KEY)) {
      sh.addDeveloperMetadata(KEY, e.id);
    }
    if (sh.getName() !== e.name) sh.setName(e.name);
    const formula = '=IMPORTRANGE("' + e.id + '","\'' + srcSheet.replace(/'/g, "''") + '\'!' + tpl.a1 + '")';
    if (sh.getRange('A1').getFormula() !== formula) {
      sh.clearContents();
      sh.getRange('A1').setFormula(formula);
    }
    if (MASTERFEED.HIDE_ENGINEER_TABS) sh.hideSheet();
    keep.add(sh.getSheetId());
    tabs.push(e.name);
  });
  // حذف أوراق ربط قديمة أنشأها السكربت لمهندسين لم يعودوا في السجل
  master.getSheets().forEach(sh => {
    const md = sh.getDeveloperMetadata().filter(m => m.getKey() === KEY);
    if (md.length && !keep.has(sh.getSheetId())) master.deleteSheet(sh);
  });
  return tabs;
}

function mfTabByFileId_(master, fileId, key) {
  const hit = master.getSheets().filter(sh =>
    sh.getDeveloperMetadata().some(m => m.getKey() === key && m.getValue() === fileId));
  return hit.length ? hit[0] : null;
}

/** السماح لـ IMPORTRANGE بالوصول برمجياً (بدل زر «السماح بالوصول»). محاولة فقط، ولا يتوقف عند الفشل */
function mfAllowImport_(masterId, srcId) {
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + masterId +
      '/externaldata/addimportrangepermissions?donorDocId=' + srcId;
    const res = UrlFetchApp.fetch(url, {
      method: 'post', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    });
    return res.getResponseCode() === 200;
  } catch (e) {
    return false;
  }
}

/** معادلة QUERY الموحّدة — نفس منطق الفرز الحالي، مع كل أوراق المهندسين */
function mfWriteQuery_(master, report, mcols, tabs) {
  const M = MASTERFEED, F = M.FILTERS;
  const lastLetter = tgColLetter_(mcols.count);
  const data = tabs.map(n => "'" + n.replace(/'/g, "''") + "'!A2:" + lastLetter).join(';');
  const cols = Array.from({ length: mcols.count }, (_, i) => 'Col' + (i + 1)).join(',');
  const eq = (cell, c) =>
    ' & IF(' + cell + '="", "", " and Col' + c + ' = \'" & SUBSTITUTE(' + cell + ',"\'","\'\'") & "\'")';
  const d = mcols.received;

  const f = '=IFERROR(QUERY({' + data + '},' +
    '"select ' + cols + ' where Col1 <> \'\'"' +
    eq(F.engineer, mcols.engineer) +
    eq(F.taskType, mcols.taskType) +
    eq(F.corrType, mcols.corrType) +
    eq(F.status, mcols.status) +
    ' & IF(' + F.from + '<>"", " and Col' + d + ' >= date \'" & TEXT(' + F.from + ',"yyyy-MM-dd") & "\'", "")' +
    ' & IF(' + F.to + '<>"", " and Col' + d + ' <= date \'" & TEXT(' + F.to + ',"yyyy-MM-dd") & "\'", "")' +
    ' & IF(' + F.year + '<>"", " and Col' + d + ' >= date \'" & ' + F.year + ' & "-01-01\' and Col' + d +
      ' <= date \'" & ' + F.year + ' & "-12-31\'", "")' +
    ' & IF(' + F.sortField + '="", "", " order by Col" & IFERROR(MATCH(TRIM(' + F.sortField + '),' +
      ' ARRAYFORMULA(TRIM(' + mcols.headerA1 + ')), 0), 1) & IF(' + F.sortDir + '="' + M.DESC_LABEL +
      '", " desc", " asc"))' +
    ', 0), "لا توجد بيانات")';

  const cell = report.getRange(mcols.queryA1);
  const old = cell.getFormula();
  if (old && old !== f) mfBackup_(master, old);
  // تفريغ منطقة النتائج حتى لا تمنع قيمٌ قديمة تمدد QUERY
  const below = report.getMaxRows() - M.HEADER_ROW;
  report.getRange(M.HEADER_ROW + 1, mcols.first, below, mcols.count).clearContent();
  cell.setFormula(f);
}

function mfBackup_(master, formula) {
  const name = MASTERFEED.BACKUP_SHEET;
  let sh = master.getSheetByName(name);
  if (!sh) {
    sh = master.insertSheet(name, master.getSheets().length);
    sh.getRange(1, 1, 1, 2).setValues([['التاريخ', 'معادلة B37 السابقة']]).setFontWeight('bold');
    sh.hideSheet();
  }
  sh.appendRow([new Date(), "'" + formula]);
}

/** حالة كل ورقة ربط */
function mfStatus_(master, engineers) {
  const ok = [], pending = [], denied = [], missing = [];
  engineers.forEach(e => {
    const sh = mfTabByFileId_(master, e.id, 'mf_engineer_file');
    if (!sh) { missing.push(e.name); return; }
    const v = sh.getRange('A1').getDisplayValue();
    if (v === '#REF!') denied.push(e.name);
    else if (!v || /^Loading|جارٍ التحميل|جار التحميل/.test(v)) pending.push(e.name);
    else ok.push(e.name);
  });
  const lines = ['— متصل: ' + ok.length + ' من ' + engineers.length];
  if (pending.length) lines.push('— قيد التحميل (افحص بعد دقيقة بـ checkMasterFeed): ' + pending.join('، '));
  if (denied.length) lines.push('⚠️ يحتاج «السماح بالوصول» يدوياً — أظهر الورقة واضغط على A1 ثم «السماح بالوصول»: ' + denied.join('، '));
  if (missing.length) lines.push('⚠️ بدون ورقة ربط (شغّل setupMasterFeed): ' + missing.join('، '));
  return { text: lines.join('\n'), ok: ok, pending: pending, denied: denied };
}

/* ======================= أدوات ======================= */

function mfFindHeaderCol_(sh, header) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const row = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(tgNorm_);
  const i = row.indexOf(tgNorm_(header));
  return i < 0 ? 0 : i + 1;
}

function mfFirstFreeCol_(sh, reserved) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const row = sh.getRange(1, 1, 1, lastCol + 10).getDisplayValues()[0];
  for (let c = 1; c <= row.length; c++) {
    if (reserved.indexOf(c) > -1) continue;
    const used = sh.getRange(1, c, Math.max(sh.getLastRow(), 1), 1).getDisplayValues().some(r => tgClean_(r[0]));
    if (!used) return c;
  }
  return lastCol + 1;
}

function mfColIndex_(letter) {
  return String(letter).toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
