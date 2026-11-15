/**
 * استيراد المهام من Excel أو CSV (مدير النظام)
 * 1) اختيار الملف  2) مطابقة الأعمدة والخيارات  3) المعاينة  4) الاستيراد
 *
 * لا يُفقد أي صف فيه بيانات، ولا يُغيَّر شيء من قيمه: الصف الذي فيه مشكلة (تاريخ فارغ أو غير مفهوم،
 * موضوع فارغ، مكرر محتمل…) يُستورد كما هو في الملف مع «أسباب المراجعة»، ليصلحه المهندس لاحقاً.
 * لا يمنع الاستيراد إلا اسم مهندس لا يطابق أي حساب، وعلى المدير اختيار الحساب المقابل له.
 *
 * رمز المهمة (عمود «رمز المهمة» من ملف الاستيراد في Google Sheets): المهمة تُعرف برمزها:
 *   رمز جديد ← تُضاف · موجود ← دمج حسب الحقل (أدناه) · مهمته محذوفة ← لا تُستورد · مكرر في الملف ← أول صف فقط ·
 *   صف بلا رمز ← كالسابق + «بدون رمز في الملف» (ويأخذ رمز نظام). و«تاريخ الإدخال» من الملف يُحفظ معها.
 *
 * الدمج حسب الحقل: مع كل مهمة يُحفظ «مرجع آخر استيراد» (قيم الملف، imported_data). ولكل حقل في الملف:
 *   تغيّر في الملف فقط ← يُؤخذ من الملف · في النظام فقط ← يبقى تعديل النظام · في الاثنين بقيمتين ← تعارض
 *   (يبقى النظام افتراضياً، أو يُؤخذ من الملف حسب الخيار). المهمة بلا مرجع (قبل هذه الميزة): كأن كل فرق
 *   تعارض إن عُدّلت في النظام بعد آخر استيراد، وإلا من الملف. والأعمدة غير الموجودة في الملف لا تُمس.
 */
import { db } from '../data/index.js';
import { html, mount, $, on } from '../core/dom.js';
import { state, engineers, loadReference, refreshReviewCount } from '../core/store.js';
import { parseDate, parseDateTime, normalizeAr, latinDigits, fmtDate, fmtDateTime, num, today } from '../core/format.js';
import { parsePriority } from '../core/fields.js';
import { setTitle } from '../core/session.js';
import { readXlsx } from '../lib/xlsx.js';
import { parseCsv, toCsv } from '../lib/csv.js';
import { downloadBlob } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { busy, toast, toastError } from '../ui/feedback.js';
import { pageHead, options, newPage } from '../ui/parts.js';

/** الحقول وأسماء الأعمدة المحتملة لكل حقل */
const TARGETS = [
  { key: 'engineer', label: 'اسم المهندس', aliases: ['اسم المهندس', 'المهندس'] },
  { key: 'refNo', label: 'رقم القيد', aliases: ['رقم القيد', 'رقم المراسلة', 'الرقم المرجعي', 'رقم الكتاب'] },
  { key: 'requester', label: 'الجهة الطالبة', aliases: ['الجهة الطالبة', 'الجهة'] },
  { key: 'employeeName', label: 'اسم الموظف', aliases: ['اسم الموظف', 'الموظف'] },
  { key: 'subject', label: 'الموضوع', aliases: ['الموضوع'], required: true },
  { key: 'receivedDate', label: 'تاريخ الاستقبال', aliases: ['تاريخ الاستقبال', 'تاريخ الاستلام', 'تاريخ الورود'], required: true },
  { key: 'completedDate', label: 'تاريخ الانتهاء', aliases: ['تاريخ الانتهاء', 'تاريخ الإنجاز', 'تاريخ الانجاز'] },
  { key: 'notes', label: 'الملاحظات', aliases: ['الملاحظات', 'ملاحظات'] },
  { key: 'taskType', label: 'نوع المهمة', aliases: ['نوع المهمة', 'التصنيف'] },
  { key: 'correspondenceType', label: 'نوع المراسلة', aliases: ['نوع المراسلة'] },
  { key: 'status', label: 'الحالة', aliases: ['الحالة', 'حالة المهمة'] },
  { key: 'priority', label: 'الأولوية', aliases: ['الأولوية', 'الاولوية', 'الأهمية', 'الاهمية', 'درجة الأهمية'] },
  { key: 'delayReason', label: 'سبب التأخير', aliases: ['سبب تأخير إنجاز المهمة', 'سبب التأخير'] },
  { key: 'enteredAt', label: 'تاريخ الإدخال', aliases: ['تاريخ الإدخال'] },
  { key: 'taskCode', label: 'رمز المهمة', aliases: ['رمز المهمة'] },
];
/** رمز من Sheets (A08-0177)، لا رمز نظام (A08-S0001، S-00001) */
const SHEETS_CODE = /^[A-Z]+[0-9]+-[0-9]+$/;
const LOOKUP_KEYS = { taskType: 'taskTypes', correspondenceType: 'correspondenceTypes', status: 'statuses' };

/** يحدد صف العناوين (أكثر صف فيه أسماء أعمدة معروفة ضمن أول 20 صفاً) */
function detectHeader(rows) {
  const all = TARGETS.flatMap((t) => t.aliases.map(normalizeAr));
  let best = -1, score = 0;
  rows.slice(0, 20).forEach((r, i) => {
    const s = (r || []).filter((c) => c != null && all.includes(normalizeAr(c))).length;
    if (s > score) { score = s; best = i; }
  });
  return score >= 2 ? best : -1;
}

/** مطابقة تلقائية: الاسم المطابق تماماً أولاً، ثم الاسم الذي يحتوي المرادف */
function autoMap(header) {
  const H = header.map((h) => normalizeAr(h ?? ''));
  const map = {}, used = new Set();
  for (const pass of ['exact', 'contains']) {
    for (const t of TARGETS) {
      if (map[t.key] != null) continue;
      for (const a of t.aliases.map(normalizeAr)) {
        const i = H.findIndex((h, j) => !used.has(j) && h && (pass === 'exact' ? h === a : h.includes(a)));
        if (i >= 0) { map[t.key] = i; used.add(i); break; }
      }
    }
  }
  return map;
}

const cellText = (v) => (v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim());
/** رمز المهمة كما في الملف: أرقام لاتينية وحروف كبيرة بلا مسافات */
const latinCode = (v) => latinDigits(cellText(v)).toUpperCase().replace(/\s+/g, '');

export default async function importPage(ctx, main) {
  setTitle('الاستيراد');
  const S = { step: 1, fileName: '', sheets: [], sheetIdx: 0, headerRow: -1, map: {}, engineerMode: 'column', fixedEngineer: '', createMissing: true, skipDup: true, conflict: 'system', blankEngineer: '', parsed: null, alias: {}, allTasks: null, bases: null };
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'استيراد المهام', sub: 'من ملف Excel (xlsx) أو CSV — مثل ملفات المهندسين أو الملف الرئيسي في Google Sheets بعد تنزيله.',
      actions: html`<button class="btn" data-act="template">${icon('download')}ملف نموذجي</button>` })}
    <div class="steps-line" id="steps" style="margin-bottom:14px"></div>
    <div id="step"></div>`);
  const stepBox = $('#step', root);

  const drawSteps = () => mount($('#steps', root), html`${['اختيار الملف', 'مطابقة الأعمدة', 'المعاينة', 'الاستيراد'].map((s, i) => html`<span class="${S.step === i + 1 ? 'on' : ''}">${i + 1}. ${s}</span>`)}`);

  /* ───── الخطوة 1 ───── */
  function step1() {
    S.step = 1; drawSteps();
    mount(stepBox, html`
      <div class="card card-pad">
        <label class="drop" id="drop" tabindex="0">
          ${icon('upload')}<div><b>اسحب الملف هنا أو اضغط للاختيار</b></div>
          <div class="small">xlsx أو csv · الصف الأول الذي يحتوي عناوين مثل «الموضوع» و«تاريخ الاستقبال» يُكتشف تلقائياً</div>
          <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        </label>
      </div>`);
    const drop = $('#drop', stepBox);
    const input = $('input', drop);
    input.onchange = () => input.files[0] && readFile(input.files[0]);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  }

  async function readFile(file) {
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('الملف كبير جداً (أكثر من 30 ميغابايت).');
      S.fileName = file.name;
      S.alias = {}; S.allTasks = null; S.bases = null;
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
        S.sheets = [{ name: 'CSV', rows: parseCsv(await file.text()) }];
      } else if (/\.xlsx$/i.test(file.name)) {
        S.sheets = (await readXlsx(await file.arrayBuffer())).filter((s) => s.rows.length);
      } else throw new Error('نوع الملف غير مدعوم. استخدم xlsx أو csv (ملفات xls القديمة: احفظها بصيغة xlsx أولاً).');
      if (!S.sheets.length) throw new Error('الملف فارغ.');
      // اختيار أول ورقة فيها عناوين معروفة
      S.sheetIdx = Math.max(0, S.sheets.findIndex((s) => detectHeader(s.rows) >= 0));
      prepareSheet();
      step2();
    } catch (e) { toastError(e); }
  }

  function prepareSheet() {
    const rows = S.sheets[S.sheetIdx].rows;
    S.headerRow = detectHeader(rows);
    S.map = S.headerRow >= 0 ? autoMap(rows[S.headerRow]) : {};
    S.engineerMode = S.map.engineer != null ? 'column' : 'fixed';
  }

  /* ───── الخطوة 2 ───── */
  function step2() {
    S.step = 2; drawSteps();
    const rows = S.sheets[S.sheetIdx].rows;
    const header = S.headerRow >= 0 ? rows[S.headerRow] : [];
    const width = Math.max(header.length, ...rows.slice(0, 50).map((r) => r?.length || 0));
    const colOpts = Array.from({ length: width }, (_, i) => [String(i), `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''} — ${cellText(header[i]) || 'بدون عنوان'}`]);
    const engs = engineers({ includeInactive: true });
    mount(stepBox, html`
      <div class="card">
        <div class="card-head"><h2>${S.fileName}</h2><div class="actions"><button class="btn btn-sm" data-act="restart">${icon('x')}ملف آخر</button></div></div>
        <div class="card-pad stack">
          ${S.headerRow < 0 ? html`<div class="alert warn">لم أجد صف عناوين معروفاً. اختر رقم صف العناوين ثم طابق الأعمدة يدوياً.</div>` : ''}
          <div class="form-grid">
            ${S.sheets.length > 1 ? html`<div class="field"><label for="i-sheet">الورقة</label>
              <select class="input" id="i-sheet" data-k="sheet">${options(S.sheets.map((s, i) => [String(i), `${s.name} (${num(s.rows.length)} صف)`]), S.sheetIdx)}</select></div>` : ''}
            <div class="field"><label for="i-head">صف العناوين</label>
              <input class="input num" id="i-head" type="number" min="1" max="${rows.length}" value="${S.headerRow + 1 || 1}" data-k="header">
              <span class="hint">البيانات تبدأ من الصف الذي يليه.</span></div>
          </div>
          <h3>المهندس</h3>
          <div class="row">
            <label class="check"><input type="radio" name="engMode" value="column" ${S.engineerMode === 'column' ? 'checked' : ''}> من عمود «اسم المهندس» في الملف</label>
            <label class="check"><input type="radio" name="engMode" value="fixed" ${S.engineerMode === 'fixed' ? 'checked' : ''}> كل المهام لمهندس واحد (ملف مهندس)</label>
          </div>
          <div class="field" ${S.engineerMode === 'fixed' ? '' : 'hidden'} style="max-width:360px" id="fixed-eng"><label for="i-eng">المهندس</label>
            <select class="input" id="i-eng" data-k="fixedEngineer">${options(engs.map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })), S.fixedEngineer, '— اختر —')}</select></div>
          <h3>مطابقة الأعمدة</h3>
          <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">
            ${TARGETS.filter((t) => t.key !== 'engineer' || S.engineerMode === 'column').map((t) => html`
              <div class="field"><label>${t.label}${t.required ? html` <span class="req">*</span>` : ''}</label>
                <select class="input" data-map="${t.key}">${options(colOpts, S.map[t.key], '— لا يوجد —')}</select></div>`)}
          </div>
          <h3>خيارات</h3>
          <label class="check"><input type="checkbox" data-k="createMissing" ${S.createMissing ? 'checked' : ''}> إضافة قيم القوائم غير الموجودة (نوع المهمة، نوع المراسلة، الحالة) تلقائياً</label>
          <label class="check"><input type="checkbox" data-k="skipDup" ${S.skipDup ? 'checked' : ''}> عدم تكرار المهام الموجودة في النظام مسبقاً (نفس المهندس + تاريخ الاستقبال + الموضوع).
            إذا كانت المهمة موجودة مرة واحدة وتكررت في الملف مرتين، يُستورد الصف الثاني.</label>
          ${S.map.taskCode != null ? html`<div class="alert small">
            <b>الملف فيه «رمز المهمة»:</b> الجديدة تُضاف، ولا تتكرر مهمة. والموجودة تُدمج <b>حسب الحقل</b>: ما تغيّر في الملف منذ آخر استيراد
            يُؤخذ منه، وما عدّله المهندس في النظام يبقى.
            <div style="margin-top:6px"><b>إذا تغيّر الحقل نفسه في النظام وفي الملف بقيمتين مختلفتين (تعارض):</b></div>
            <label class="check"><input type="radio" name="conflict" value="system" ${S.conflict === 'system' ? 'checked' : ''}> يبقى ما في النظام (ويُذكر في المعاينة والتقرير)</label>
            <label class="check"><input type="radio" name="conflict" value="file" ${S.conflict === 'file' ? 'checked' : ''}> يُؤخذ من الملف</label></div>` : ''}
          ${S.engineerMode === 'column' ? html`<div class="field" style="max-width:420px"><label for="i-blank">المهمة التي لا يوجد فيها اسم مهندس تُسند إلى</label>
            <select class="input" id="i-blank" data-k="blankEngineer">${options(engs.map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })), S.blankEngineer, '— اختر (عند الحاجة) —')}</select>
            <span class="hint">وتظهر في «تحتاج مراجعة» ليُسندها رئيس القسم أو المدير للمهندس الصحيح.</span></div>` : ''}
          <div class="alert small">لا يُترك أي صف فيه بيانات، ولا يُغيَّر شيء من قيمه: ما فيه مشكلة (تاريخ فارغ أو غير مفهوم، موضوع فارغ، مهمة مكررة محتملة…)
            يُستورد <b>كما هو في الملف</b> مع علامة <b>«تحتاج مراجعة»</b> وسببها، ليصلحه المهندس لاحقاً.</div>
          <div><button class="btn btn-primary" data-act="preview">${icon('eye')}معاينة</button></div>
        </div>
      </div>`);
  }

  on(root, 'change', '[data-alias]', (e, el) => {
    if (!el.value) return;
    S.alias[normalizeAr(el.dataset.alias)] = el.value;
    step3(null);
  });

  on(root, 'change', '[name="conflict"]', (e, el) => { S.conflict = el.value === 'file' ? 'file' : 'system'; });
  on(root, 'change', '[data-k], [data-map], [name="engMode"]', (e, el) => {
    if (el.dataset.map) { S.map[el.dataset.map] = el.value === '' ? undefined : Number(el.value); if (el.dataset.map === 'taskCode') step2(); return; }
    if (el.name === 'engMode') { S.engineerMode = el.value; step2(); return; }
    const k = el.dataset.k;
    if (k === 'sheet') { S.sheetIdx = Number(el.value); prepareSheet(); step2(); }
    else if (k === 'header') {
      const rows = S.sheets[S.sheetIdx].rows;
      S.headerRow = Math.min(Math.max(1, Number(el.value) || 1), rows.length) - 1;
      S.map = autoMap(rows[S.headerRow] || []);
      step2();
    } else if (k === 'fixedEngineer') S.fixedEngineer = el.value;
    else if (k === 'blankEngineer') S.blankEngineer = el.value;
    else S[k] = el.checked;
  });

  /* ───── تحويل الصفوف ───── */
  async function parseRows() {
    if (S.engineerMode === 'fixed' && !S.fixedEngineer) throw new Error('اختر المهندس الذي تُنسب إليه المهام.');
    const rows = S.sheets[S.sheetIdx].rows.slice(S.headerRow + 1);
    const L = state.lookups;
    const engs = engineers({ includeInactive: true });
    const engIndex = new Map();
    for (const e of engs) for (const n of [e.fullName, e.shortName, e.email, e.loginNo]) if (n) engIndex.set(normalizeAr(n), e);
    // كلمات الاسم بدون «بن/بنت» لمطابقة «أنس الغيلاني» مع «أنس بن سالم بن علي الغيلاني»
    const words = (s) => normalizeAr(s).split(' ').filter((w) => w && !['بن', 'بنت', 'ابن'].includes(w));
    const inOrder = (part, whole) => { let i = 0; for (const w of whole) if (w === part[i]) i++; return i === part.length; };
    const findEng = (name) => {
      const n = normalizeAr(name);
      if (!n) return null;
      if (S.alias[n]) return engs.find((e) => e.id === S.alias[n]) || null;
      if (engIndex.has(n)) return engIndex.get(n);
      const w = words(name);
      const c = engs.filter((e) => [e.fullName, e.shortName].some((full) => {
        const fw = words(full || '');
        return fw.length && w.length && fw[0] === w[0] && (inOrder(w, fw) || inOrder(fw, w));
      }));
      return c.length === 1 ? c[0] : null;
    };
    const unknown = new Map();
    // الحالات الجديدة (غير الموجودة في القوائم): نحدد نوعها مرة واحدة لكل اسم، لا لكل صف
    // من الاسم إن كان واضحاً، وإلا من أغلب صفوفها (لها تاريخ انتهاء = مكتملة)
    const guessKind = (n) => (/ملغ|الغاء/.test(n) ? 'cancelled' : /غير|قيد|جار|مفتوح|معلق|انتظار|متابعه|لم /.test(n) ? 'open' : /مكتمل|منجز|منتهي|انجز|اكتمل|مغلق|^تم/.test(n) ? 'done' : null);
    const pendingKind = {};
    if (S.map.status != null) {
      const stats = {};
      for (const r of rows) {
        const name = cellText(r?.[S.map.status]);
        if (!name || L.statuses.some((x) => normalizeAr(x.name) === normalizeAr(name))) continue;
        const st = (stats[normalizeAr(name)] ||= { with: 0, without: 0 });
        if (S.map.completedDate != null && parseDate(r[S.map.completedDate])) st.with++; else st.without++;
      }
      for (const [n, st] of Object.entries(stats)) pendingKind[n] = guessKind(n) || (st.with >= st.without ? 'done' : 'open');
    }
    S.pendingKind = pendingKind;
    const lk = (kind, name) => L[kind].find((x) => normalizeAr(x.name) === normalizeAr(name));
    const defOpen = L.statuses.find((s) => s.isActive && s.kind === 'open');
    const defDone = L.statuses.find((s) => s.isActive && s.kind === 'done');

    const codeCol = S.map.taskCode != null;
    if ((S.skipDup || codeCol) && !S.allTasks) S.allTasks = await db.tasks.list({ deleted: 'include' });
    if (codeCol && !S.bases) S.bases = await db.tasks.importBase();
    // المهام الموجودة في النظام: كم مرة توجد كل مهمة (لا نكرر الموجود، ونستورد الزائد عليه)
    // existing: لكل الصفوف بلا رمز. bare: للصف الذي رمزه جديد، مقابل مهام النظام التي بلا رمز
    // (مهام قديمة قبل الرموز: لا تتكرر، والأصل حذفها وإعادة الاستيراد)
    const keyOf = (t) => `${t.engineerId}|${t.receivedDate}|${normalizeAr(t.subject)}`;
    const count = (list) => { const m = new Map(); for (const t of list) m.set(keyOf(t), (m.get(keyOf(t)) || 0) + 1); return m; };
    const existing = S.skipDup ? count(S.allTasks) : new Map();
    const bare = S.skipDup && codeCol ? count(S.allTasks.filter((t) => !t.taskCode)) : new Map();
    const byCode = new Map(codeCol ? S.allTasks.filter((t) => t.taskCode).map((t) => [t.taskCode.toUpperCase(), t]) : []);
    const seenCode = new Map();   // الرمز ← سطره الأول في الملف
    const missing = { taskTypes: new Set(), correspondenceTypes: new Set(), statuses: new Set() };
    const out = [];
    const blank = [];      // صفوف فيها خلايا لكن بلا أي بيانات مهمة (مثل اسم مهندس وحده)
    let empty = 0;         // صفوف فارغة تماماً
    const g = (r, k) => (S.map[k] == null ? '' : r[S.map[k]]);
    const blankEng = S.blankEngineer ? engs.find((e) => e.id === S.blankEngineer) : null;

    rows.forEach((r, i) => {
      if (!r || r.every((c) => c == null || String(c).trim() === '')) { empty++; return; }
      const line = S.headerRow + 2 + i;
      const reasons = [];   // أسباب المراجعة (تُحفظ مع المهمة)
      const errors = [];    // ما يمنع الاستيراد: المهندس فقط
      const subject = cellText(g(r, 'subject'));
      const recRaw = g(r, 'receivedDate'), doneRaw = g(r, 'completedDate');
      const receivedParsed = parseDate(recRaw);
      const completedDate = parseDate(doneRaw);
      const content = ['subject', 'receivedDate', 'completedDate', 'refNo', 'requester', 'employeeName', 'notes', 'delayReason'].some((k) => cellText(g(r, k)));
      if (!content) { blank.push({ line, text: r.map(cellText).filter(Boolean).join(' · ') }); return; }

      // القيم كما هي في الملف: لا نضع شيئاً من عندنا، ونسجّل المشكلة سبباً للمراجعة
      const subjectV = subject;
      if (!subject) reasons.push('الموضوع فارغ');
      const completedV = completedDate;
      if (cellText(doneRaw) && !completedDate) reasons.push(`تاريخ الانتهاء غير مفهوم «${cellText(doneRaw)}»`);
      const receivedDate = receivedParsed;
      if (!receivedParsed) reasons.push(cellText(recRaw) ? `تاريخ الاستقبال غير مفهوم «${cellText(recRaw)}»` : 'تاريخ الاستقبال فارغ');
      if (completedV && receivedDate && completedV < receivedDate) reasons.push('تاريخ الانتهاء قبل تاريخ الاستقبال');

      let eng = null;
      const engName = cellText(g(r, 'engineer'));
      if (S.engineerMode === 'fixed') eng = engs.find((e) => e.id === S.fixedEngineer) || null;
      else if (engName) {
        eng = findEng(engName);
        if (!eng) { unknown.set(engName, (unknown.get(engName) || 0) + 1); errors.push(`مهندس غير معروف «${engName}»`); }
      } else if (blankEng) { eng = blankEng; reasons.push('اسم المهندس فارغ في الملف'); }
      else errors.push('اسم المهندس فارغ: اختر في «مطابقة الأعمدة» لمن تُسند هذه المهام');

      const ref = {};
      for (const [k, kind] of Object.entries(LOOKUP_KEYS)) {
        const name = cellText(g(r, k));
        if (!name) continue;
        const item = lk(kind, name);
        if (item) ref[k] = item;
        else if (S.createMissing) { missing[kind].add(name); ref[k] = { pending: name }; }
        else reasons.push(`${TARGETS.find((t) => t.key === k).label} «${name}» غير موجود في القوائم`);
      }
      let status = ref.status;
      if (!status) {
        // الحالة إلزامية في قاعدة البيانات: نختار الأقرب ونطلب مراجعتها
        status = completedV ? defDone : defOpen;
        if (S.map.status != null) reasons.push(`الحالة فارغة في الملف، واختيرت «${status?.name || ''}»`);
      }
      const kind = status?.kind || (status?.pending ? pendingKind[normalizeAr(status.pending)] : null);
      if (kind === 'done' && !completedV && !(cellText(doneRaw))) reasons.push('مكتملة بدون تاريخ انتهاء');
      if (kind === 'open' && completedV) reasons.push('الحالة غير مكتملة ولها تاريخ انتهاء');

      const prioRaw = cellText(g(r, 'priority'));
      let priority = parsePriority(prioRaw);
      if (!priority) { priority = 'normal'; reasons.push(`الأولوية «${prioRaw}» غير معروفة، ووُضعت «عادية»`); }

      // رمز المهمة وتاريخ الإدخال من الملف
      const code = codeCol ? latinCode(g(r, 'taskCode')) : '';
      if (codeCol && !code) reasons.push('بدون رمز في الملف');
      const enteredRaw = g(r, 'enteredAt');
      const enteredAt = parseDateTime(enteredRaw);
      if (cellText(enteredRaw) && !enteredAt) reasons.push(`تاريخ الإدخال غير مفهوم «${cellText(enteredRaw)}»`);

      const task = {
        engineerId: eng?.id, priority, refNo: cellText(g(r, 'refNo')), requester: cellText(g(r, 'requester')), employeeName: cellText(g(r, 'employeeName')),
        subject: subjectV, receivedDate, completedDate: completedV, notes: cellText(g(r, 'notes')), delayReason: cellText(g(r, 'delayReason')),
        taskCode: code, enteredAt, _ref: { ...ref, status },
      };
      const row = { line, code, task, errors, reasons, exists: false, dup: false, engName: eng?.fullName || engName, statusName: status?.name || status?.pending || '' };
      const key = eng ? `${eng.id}|${receivedDate}|${normalizeAr(subjectV)}` : '';
      if (code && seenCode.has(code)) {
        row.dupCode = seenCode.get(code);                    // رمز مكرر في الملف: أول صف فقط
      } else if (code && byCode.has(code)) {
        seenCode.set(code, line);
        const cur = byCode.get(code);
        if (cur.deletedAt) row.deleted = cur; else row.match = cur;
      } else {
        if (code) seenCode.set(code, line);
        const pool = code ? bare : existing;                 // رمز جديد: يُقارن بمهام النظام التي بلا رمز فقط
        if (key && !errors.length && pool.get(key) > 0) { pool.set(key, pool.get(key) - 1); row.exists = true; }
      }
      row.key = key;
      out.push(row);
    });

    // المكرر المحتمل داخل الملف: يُستورد كله، مع علامة مراجعة على كل صفوف المجموعة
    // (بالرموز إن وُجدت، فلا يتغير السبب بتغيّر ترتيب الصفوف بين استيراد وآخر)
    const groups = new Map();
    for (const r of out) if (r.key && !r.exists && !r.errors.length && !r.dupCode && !r.deleted) groups.set(r.key, [...(groups.get(r.key) || []), r]);
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const coded = list.every((x) => x.code);
      for (const r of list) {
        r.dup = true;
        r.reasons.push(coded ? `مكررة محتملة: نفس المهندس والتاريخ والموضوع في الرموز ${list.map((x) => x.code).join('، ')}`
          : `مكررة محتملة: نفس المهندس والتاريخ والموضوع في صفوف الملف ${list.map((x) => x.line).join('، ')}`);
      }
    }

    // المهمة الموجودة برمزها: الدمج حسب الحقل
    for (const r of out) {
      if (!r.match || r.errors.length) continue;
      r.reasons = finalReasons(r);
      mergeOf(r);
    }
    // مهام في النظام برموز Sheets وليست في الملف: لا تُمس، وتُذكر في التقرير
    const inFile = new Set(out.map((r) => r.code).filter(Boolean));
    const fixed = S.engineerMode === 'fixed' ? S.fixedEngineer : '';
    const absent = codeCol ? S.allTasks.filter((t) => !t.deletedAt && SHEETS_CODE.test(t.taskCode || '') && !inFile.has(t.taskCode.toUpperCase()) && (!fixed || t.engineerId === fixed)) : [];
    return { rows: out, missing, unknown, blank, empty, codeCol, absent };
  }

  /** الأسباب النهائية كما ستُحفظ (نفس «الحماية الأخيرة» في الاستيراد) */
  function finalReasons(r) {
    const why = [...r.reasons];
    const st = r.task._ref.status;
    const k = st?.kind || (st?.pending ? S.pendingKind[normalizeAr(st.pending)] : null);
    if (k === 'done' && !r.task.completedDate && !why.some((x) => x.includes('انتهاء'))) why.push('مكتملة بدون تاريخ انتهاء');
    if (k === 'open' && r.task.completedDate && !why.some((x) => x.includes('ولها تاريخ انتهاء'))) why.push('الحالة غير مكتملة ولها تاريخ انتهاء');
    return why;
  }

  /**
   * الحقول التي يُدمج فيها: قيمة النظام وقيمة الملف نصوصاً للمقارنة (الفارغ = '')، وطريقة العرض.
   * col: الحقل لا يُقارن ولا يُغيَّر إلا إذا كان عموده في الملف.
   */
  const nameOf = (x) => x?.name || x?.pending || '';
  const isoOf = (v) => (v ? new Date(v).toISOString() : '');
  const engName = (id) => engineers({ includeInactive: true }).find((e) => e.id === id)?.fullName || id || '—';
  const MERGE = [
    { k: 'engineerId', label: 'المهندس', sys: (c) => c.engineerId, file: (t) => t.engineerId, show: engName },
    { k: 'refNo', col: 'refNo', label: 'رقم القيد', sys: (c) => c.refNo, file: (t) => t.refNo },
    { k: 'requester', col: 'requester', label: 'الجهة الطالبة', sys: (c) => c.requester, file: (t) => t.requester },
    { k: 'employeeName', col: 'employeeName', label: 'اسم الموظف', sys: (c) => c.employeeName, file: (t) => t.employeeName },
    { k: 'subject', label: 'الموضوع', sys: (c) => c.subject, file: (t) => t.subject },
    { k: 'receivedDate', label: 'تاريخ الاستقبال', sys: (c) => c.receivedDate, file: (t) => t.receivedDate, show: fmtDate },
    { k: 'completedDate', col: 'completedDate', label: 'تاريخ الانتهاء', sys: (c) => c.completedDate, file: (t) => t.completedDate, show: fmtDate },
    { k: 'notes', col: 'notes', label: 'الملاحظات', sys: (c) => c.notes, file: (t) => t.notes },
    { k: 'taskType', col: 'taskType', label: 'نوع المهمة', sys: (c) => c.taskType, file: (t) => nameOf(t._ref.taskType) },
    { k: 'correspondenceType', col: 'correspondenceType', label: 'نوع المراسلة', sys: (c) => c.correspondenceType, file: (t) => nameOf(t._ref.correspondenceType) },
    { k: 'status', col: 'status', label: 'الحالة', sys: (c) => c.status, file: (t) => nameOf(t._ref.status) },
    { k: 'priority', col: 'priority', label: 'الأولوية', sys: (c) => c.priority, file: (t) => t.priority, show: (v) => ({ urgent: 'عاجلة', normal: 'عادية' }[v]) },
    { k: 'delayReason', col: 'delayReason', label: 'سبب التأخير', sys: (c) => c.delayReason, file: (t) => t.delayReason },
    { k: 'enteredAt', col: 'enteredAt', label: 'تاريخ الإدخال', sys: (c) => isoOf(c.enteredAt), file: (t) => isoOf(t.enteredAt), show: fmtDateTime, skip: (t) => !t.enteredAt },
    { k: 'reviewReasons', label: 'تحتاج مراجعة', sys: (c) => (c.reviewReasons || []).join(' | '), file: (t, r) => r.reasons.join(' | ') },
  ];
  const showOf = (f, v) => (v === '' || v == null ? '—' : (f.show ? f.show(v) : v) || '—');
  const activeFields = (r) => MERGE.filter((f) => (!f.col || S.map[f.col] != null) && !f.skip?.(r.task));
  /** قيم الملف لهذه المهمة: تُحفظ مرجعاً للاستيراد التالي */
  const snapOf = (r) => Object.fromEntries(activeFields(r).map((f) => [f.k, f.file(r.task, r) ?? '']));
  const sameSnap = (a, b) => !!a && !!b && Object.keys(b).length === Object.keys(a).length && Object.keys(b).every((k) => a[k] === b[k]);

  /** الدمج حسب الحقل ← r.take (من الملف) / r.keep (يبقى تعديل النظام) / r.conflicts، وr.mode */
  function mergeOf(r) {
    const cur = r.match, base = S.bases?.get(cur.id) || null;
    r.edited = !!cur.updatedAt && Date.parse(cur.updatedAt) > Date.parse(cur.importedAt || cur.createdAt);
    r.take = []; r.keep = []; r.conflicts = [];
    for (const f of activeFields(r)) {
      const sv = f.sys(cur) ?? '', fv = f.file(r.task, r) ?? '';
      if (sv === fv) continue;
      const d = { f, sv, fv };
      if (base && f.k in base) {
        d.bv = base[f.k];
        if (sv === d.bv) r.take.push(d);                 // تغيّر في الملف فقط
        else if (fv === d.bv) r.keep.push(d);            // تغيّر في النظام فقط
        else r.conflicts.push(d);                        // تغيّر في الاثنين
      } else if (r.edited) r.conflicts.push(d);          // بلا مرجع: عُدّلت في النظام بعد آخر استيراد
      else r.take.push(d);
    }
    r.taken = S.conflict === 'file' ? [...r.take, ...r.conflicts] : r.take;
    r.snap = snapOf(r);
    r.baseChanged = !sameSnap(base, r.snap);
    r.mode = r.taken.length ? 'update' : r.keep.length || r.conflicts.length ? 'kept' : 'same';
  }
  /** تفاصيل الدمج للعرض والتقرير */
  function mergeText(r) {
    const won = S.conflict === 'file' ? 'من الملف' : 'يبقى النظام';
    return [
      ...r.take.map((d) => `${d.f.label}: ${showOf(d.f, d.sv)} ← ${showOf(d.f, d.fv)}`),
      ...r.conflicts.map((d) => `تعارض في ${d.f.label}: النظام «${showOf(d.f, d.sv)}»، الملف «${showOf(d.f, d.fv)}»${d.bv !== undefined ? `، آخر استيراد «${showOf(d.f, d.bv)}»` : ''} ← ${won}`),
      ...r.keep.map((d) => `يبقى تعديل النظام في ${d.f.label}: «${showOf(d.f, d.sv)}» (في الملف «${showOf(d.f, d.fv)}»)`),
    ];
  }

  /* ───── الخطوة 3 ───── */
  /** تقسيم الصفوف حسب ما سيحدث لكل منها */
  function groupsOf(rows) {
    const stop = rows.filter((r) => r.errors.length);
    const ok = rows.filter((r) => !r.errors.length);
    const go = ok.filter((r) => !r.exists && !r.match && !r.deleted && !r.dupCode);          // تُضاف
    return {
      stop, go,
      review: go.filter((r) => r.reasons.length), dup: go.filter((r) => r.dup),
      exists: ok.filter((r) => r.exists),
      upd: ok.filter((r) => r.mode === 'update'), same: ok.filter((r) => r.mode === 'same'), kept: ok.filter((r) => r.mode === 'kept'),
      conflicts: ok.filter((r) => r.conflicts?.length),
      // تختلف عن Sheets بعد الاستيراد: تعديلات النظام الباقية (وتعارضات بقي فيها النظام)
      differs: ok.filter((r) => r.keep?.length || (S.conflict === 'system' && r.conflicts?.length)),
      deleted: ok.filter((r) => r.deleted), dupCode: ok.filter((r) => r.dupCode),
    };
  }
  const resultOf = (r) => (r.errors.length ? ['تنتظر اختيار المهندس', 'bad']
    : r.exists ? [r.code ? 'موجودة في النظام بلا رمز (لا تُستورد)' : 'موجودة في النظام مسبقاً (لا تُستورد)', '']
    : r.dupCode ? [`رمز مكرر في الملف (الصف ${r.dupCode} يُستورد، وهذا لا)`, 'bad']
    : r.deleted ? ['مهمتها محذوفة في النظام (لا تُستورد)', '']
    : r.mode === 'update' ? [r.conflicts.length ? 'تُحدَّث، وفيها تعارض' : 'تُحدَّث من الملف', r.conflicts.length ? 'warn' : 'info']
    : r.mode === 'kept' ? [r.conflicts.length ? 'تعارض: يبقى ما في النظام' : 'تعديلات النظام باقية', r.conflicts.length ? 'warn' : '']
    : r.mode === 'same' ? ['بلا تغيير', '']
    : r.reasons.length ? ['تُضاف وتحتاج مراجعة', 'warn'] : ['تُضاف', 'ok']);
  const diffText = (r) => (r.match && r.mode !== 'same' ? mergeText(r) : []);

  async function step3(btn) {
    if (S.map.subject == null || S.map.receivedDate == null) return toastError({ message: 'طابق عمودي «الموضوع» و«تاريخ الاستقبال» على الأقل.' });
    if (S.engineerMode === 'column' && S.map.engineer == null) return toastError({ message: 'طابق عمود «اسم المهندس» أو اختر مهندساً واحداً.' });
    try { S.parsed = await busy(btn, parseRows); } catch (e) { return toastError(e); }
    S.step = 3; drawSteps();
    const { rows, missing, unknown, blank, empty, codeCol, absent } = S.parsed;
    const engOpts = engineers({ includeInactive: true }).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive }));
    const G = groupsOf(rows);
    const total = rows.length + blank.length;
    const sum = G.go.length + G.exists.length + blank.length + G.stop.length + G.upd.length + G.same.length + G.kept.length + G.deleted.length + G.dupCode.length;
    const miss = Object.entries(missing).filter(([, v]) => v.size);
    const show = [...G.stop, ...G.conflicts, ...G.upd.filter((r) => !r.conflicts.length), ...G.kept.filter((r) => !r.conflicts.length), ...G.dupCode, ...G.deleted, ...G.review, ...G.go.filter((r) => !r.reasons.length), ...G.exists, ...G.same].slice(0, 300);
    const chip = (n, label, color) => (n ? html`<span class="chip"><span class="dot" style="color:${color}"></span>${label} <b>${num(n)}</b></span>` : '');
    const work = G.go.length + G.upd.length;
    mount(stepBox, html`
      <div class="card">
        <div class="card-head"><h2>المعاينة</h2><div class="actions"><button class="btn btn-sm" data-act="back">رجوع</button></div></div>
        <div class="card-pad stack">
          <div class="chips">
            <span class="chip">صفوف فيها بيانات <b>${num(total)}</b></span>
            <span class="chip"><span class="dot" style="color:var(--ok)"></span>${codeCol ? 'جديدة تُضاف' : 'ستُستورد'} <b>${num(G.go.length)}</b></span>
            <span class="chip"><span class="dot" style="color:var(--warn)"></span>منها تحتاج مراجعة <b>${num(G.review.length)}</b></span>
            ${chip(G.dup.length, 'منها مكررة محتملة', 'var(--warn)')}
            ${codeCol ? html`<span class="chip"><span class="dot" style="color:var(--info)"></span>تُحدَّث من الملف <b>${num(G.upd.length)}</b></span>` : ''}
            ${chip(G.same.length, 'بلا تغيير', 'var(--muted)')}
            ${chip(G.conflicts.length, 'فيها تعارض', 'var(--warn)')}
            ${chip(G.kept.length, 'تعديلات النظام باقية (بلا تحديث)', 'var(--muted)')}
            ${chip(G.deleted.length, 'مهمتها محذوفة في النظام', 'var(--muted)')}
            ${chip(G.dupCode.length, 'رمز مكرر في الملف', 'var(--bad)')}
            ${chip(G.exists.length, 'موجودة في النظام مسبقاً', 'var(--muted)')}
            ${chip(blank.length, 'بلا بيانات مهمة', 'var(--muted)')}
            ${chip(G.stop.length, 'تنتظر اختيار المهندس', 'var(--bad)')}
          </div>
          <div class="small ${sum === total ? 'muted' : 'bad'}">
            المطابقة: ${num(G.go.length)} ${codeCol ? 'جديدة' : 'ستُستورد'}${codeCol ? ` + ${num(G.upd.length)} تُحدَّث + ${num(G.same.length)} بلا تغيير + ${num(G.kept.length)} تعديلات النظام باقية + ${num(G.deleted.length)} محذوفة + ${num(G.dupCode.length)} رمز مكرر` : ''}
            + ${num(G.exists.length)} موجودة مسبقاً + ${num(blank.length)} بلا بيانات مهمة + ${num(G.stop.length)} تنتظر المهندس = <b>${num(total)}</b> صفاً.
            ${empty ? html` (وتجاهلنا ${num(empty)} صفاً فارغاً تماماً)` : ''}</div>
          ${G.differs.length ? html`<div class="alert small">${num(G.differs.length)} مهمة ستبقى <b>مختلفة عن Sheets</b> بسبب تعديلات في النظام لم تُنقل إلى Sheets.
            الحقول وقيمها في «تقرير الصفوف»، لتعديلها في Sheets إن لزم.</div>` : ''}
          ${absent?.length ? html`<div class="alert small">${num(absent.length)} مهمة في النظام برموز من Sheets <b>ليست في هذا الملف</b>، ولا تُمس. قائمتها في «تقرير الصفوف».</div>` : ''}
          ${G.exists.some((r) => r.code) ? html`<div class="alert warn small">${num(G.exists.filter((r) => r.code).length)} صفاً برموز جديدة تطابق مهاماً في النظام <b>بلا رمز</b> (نفس المهندس والتاريخ والموضوع)، فلا تُستورد حتى لا تتكرر.
            لربط كل المهام برموزها: احذف كل المهام من «الإعدادات» ثم استورد الملف.</div>` : ''}
          ${blank.length ? html`<div class="alert small"><b>صفوف بلا بيانات مهمة</b> (لا موضوع ولا تواريخ ولا رقم قيد ولا جهة ولا ملاحظات)، لا تُستورد:
            ${blank.slice(0, 15).map((b) => html`<div>الصف ${b.line}: ${b.text || '—'}</div>`)}${blank.length > 15 ? html`<div>… والبقية في «تقرير الصفوف»</div>` : ''}</div>` : ''}
          ${miss.length ? html`<div class="alert warn">ستُضاف هذه القيم إلى القوائم: ${miss.map(([k, v]) => html`<div><b>${{ taskTypes: 'أنواع المهام', correspondenceTypes: 'أنواع المراسلات', statuses: 'الحالات' }[k]}:</b> ${[...v].join('، ')}</div>`)}
            ${missing.statuses.size ? html`<div class="small">نوع كل حالة جديدة: ${[...missing.statuses].map((n) => `«${n}» ← ${{ done: 'مكتملة', open: 'مفتوحة', cancelled: 'مغلقة بدون إنجاز' }[S.pendingKind[normalizeAr(n)]] || 'مفتوحة'}`).join('، ')}. يمكنك تغييره لاحقاً من صفحة القوائم.</div>` : ''}</div>` : ''}
          ${unknown.size ? html`<div class="alert bad">
            <b>أسماء مهندسين لم تُطابق أي حساب.</b> اختر الحساب المقابل لكل اسم، أو أضف المهندس من «المستخدمون» ثم اضغط «إعادة الفحص».
            <div class="form-grid" style="margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
              ${[...unknown].map(([name, n]) => html`<div class="field"><label>«${name}» (${num(n)} مهمة)</label>
                <select class="input" data-alias="${name}">${options(engOpts, '', '— اختر الحساب —')}</select></div>`)}
            </div>
            <div class="row" style="margin-top:8px"><button class="btn btn-sm" data-act="recheck">${icon('restore')}إعادة الفحص</button></div>
          </div>` : ''}
          ${G.stop.length && !unknown.size ? html`<div class="alert bad">${num(G.stop.length)} صفاً بلا اسم مهندس. اختر في «مطابقة الأعمدة» (زر رجوع) لمن تُسند.</div>` : ''}
          <div class="row">
            <button class="btn btn-primary" data-act="run" ${work && !G.stop.length ? '' : 'disabled'}>${icon('upload')}${G.upd.length
              ? `${G.go.length ? `إضافة ${num(G.go.length)} و` : ''}تحديث ${num(G.upd.length)} مهمة` : `استيراد ${num(G.go.length)} مهمة`}</button>
            <button class="btn" data-act="report">${icon('download')}تقرير الصفوف (CSV)</button>
          </div>
          ${G.stop.length ? html`<div class="small muted">الاستيراد ينتظر اختيار المهندس للصفوف أعلاه حتى لا يُترك أي صف.</div>` : ''}
        </div>
        <div class="table-wrap" style="max-height:60vh"><table class="table">
          <thead><tr><th>الصف</th>${codeCol ? html`<th>الرمز</th>` : ''}<th>المهندس</th><th>الموضوع</th><th>الاستقبال</th><th>الانتهاء</th><th>الحالة</th><th>النتيجة</th></tr></thead>
          <tbody>${show.map((r) => { const [label, cls] = resultOf(r); const why = r.errors.length ? r.errors : r.match ? diffText(r) : r.reasons; return html`<tr>
            <td class="num muted">${r.line}</td>${codeCol ? html`<td class="num nowrap">${r.code}</td>` : ''}<td class="nowrap">${r.engName}</td><td class="subject"><div class="clip">${r.task.subject}</div></td>
            <td class="num nowrap">${fmtDate(r.task.receivedDate)}</td><td class="num nowrap">${fmtDate(r.task.completedDate)}</td><td>${r.statusName}</td>
            <td><span class="badge ${cls}">${label}</span>${why.length ? html` <span class="small">${why.join('، ')}</span>` : ''}</td></tr>`; })}</tbody>
        </table></div>
        ${rows.length > show.length ? html`<div class="table-foot">تُعرض أول ${num(show.length)} من ${num(rows.length)} صف. التفاصيل كاملة في «تقرير الصفوف».</div>` : ''}
      </div>`);
  }

  /* ───── الخطوة 4 ───── */
  async function step4() {
    const { rows, missing, codeCol } = S.parsed;
    const G = groupsOf(rows);
    S.step = 4; drawSteps();
    S.allTasks = null; S.bases = null; // بعد الكتابة تتغير المهام الموجودة ومراجعها
    mount(stepBox, html`<div class="card card-pad stack"><h2>جارٍ الاستيراد…</h2><div class="progress"><div id="bar"></div></div><div class="small muted" id="msg">تجهيز القوائم…</div></div>`);
    const bar = $('#bar', stepBox), msg = $('#msg', stepBox);
    const progress = (label) => (d, total) => { bar.style.width = `${Math.round((d / total) * 100)}%`; msg.textContent = `${label}: ${num(d)} من ${num(total)}`; };
    let n = 0, u = 0;
    try {
      // 1) إضافة القيم الناقصة في القوائم
      const L = state.lookups;
      for (const [kind, names] of Object.entries(missing)) {
        for (const name of names) {
          await db.lookups.save(kind, { name, sortOrder: (L[kind].at(-1)?.sortOrder || 0) + 1, isActive: true, ...(kind === 'statuses' ? { kind: S.pendingKind[normalizeAr(name)] || 'open' } : {}) });
        }
      }
      if (Object.values(missing).some((s) => s.size)) await loadReference({ force: true });
      const idOf = (kind, item) => (item?.pending ? state.lookups[kind].find((x) => normalizeAr(x.name) === normalizeAr(item.pending))?.id : item?.id) || null;
      const fromFile = (r) => {
        const { _ref, taskCode, enteredAt, ...t } = r.task;
        return { ...t, reviewReasons: finalReasons(r), taskTypeId: idOf('taskTypes', _ref.taskType), correspondenceTypeId: idOf('correspondenceTypes', _ref.correspondenceType), statusId: idOf('statuses', _ref.status),
          ...(enteredAt ? { enteredAt } : {}), imported: true };
      };
      // 2) الجديدة على دفعات
      const list = G.go.map((r) => ({ ...fromFile(r), createdBy: r.task.engineerId, ...(r.code ? { taskCode: r.code, importedData: snapOf(r) } : {}) }));
      if (list.length) n = await db.tasks.bulkCreate(list, progress('الإضافة'));
      // 3) التحديث: الحقول المأخوذة من الملف فقط، والباقي كما في النظام
      const kindOf = (id) => state.lookups.statuses.find((x) => x.id === id)?.kind;
      const upd = G.upd.map((r) => {
        const cur = r.match, f = fromFile(r);
        const t = {
          id: cur.id, taskCode: cur.taskCode, engineerId: cur.engineerId, refNo: cur.refNo, requester: cur.requester, employeeName: cur.employeeName,
          subject: cur.subject, receivedDate: cur.receivedDate, completedDate: cur.completedDate, notes: cur.notes,
          taskTypeId: cur.taskTypeId, correspondenceTypeId: cur.correspondenceTypeId, statusId: cur.statusId, priority: cur.priority,
          delayReason: cur.delayReason, reviewReasons: [...(cur.reviewReasons || [])],
          importedData: r.snap, imported: true,
        };
        const set = { taskType: 'taskTypeId', correspondenceType: 'correspondenceTypeId', status: 'statusId' };
        for (const { f: fd } of r.taken) {
          if (fd.k === 'reviewReasons') t.reviewReasons = f.reviewReasons;
          else if (fd.k === 'enteredAt') t.enteredAt = f.enteredAt;
          else if (set[fd.k]) t[set[fd.k]] = f[set[fd.k]];
          else t[fd.k] = f[fd.k];
        }
        // بعد الدمج قد تخالف المهمة قواعد الإدخال (مثل حالة «مكتملة» من الملف وتاريخ انتهاء فارغ في النظام): تُعلَّم للمراجعة
        if (!t.reviewReasons.length) {
          const why = [];
          if (!String(t.subject || '').trim()) why.push('الموضوع فارغ');
          if (!t.receivedDate) why.push('تاريخ الاستقبال فارغ');
          if (kindOf(t.statusId) === 'done' && !t.completedDate) why.push('مكتملة بدون تاريخ انتهاء');
          if (t.completedDate && t.receivedDate && t.completedDate < t.receivedDate) why.push('تاريخ الانتهاء قبل تاريخ الاستقبال');
          t.reviewReasons = why.map((x) => `بعد الدمج مع تعديلات النظام: ${x}`);
        }
        return t;
      });
      if (upd.length) u = await db.tasks.bulkUpdate(upd, progress('التحديث'));
      // مرجع الاستيراد للمهام التي لم تُحدَّث حقولها (بلا تغيير، أو بقيت فيها تعديلات النظام)
      const bases = [...G.same, ...G.kept].filter((r) => r.baseChanged).map((r) => ({ id: r.match.id, data: r.snap }));
      if (bases.length) await db.tasks.saveImportBase(bases, progress('حفظ مرجع الاستيراد'));
      // 4) رموز المهندسين من رموز مهامهم (لمن ليس له رمز)
      let learned = 0;
      if (codeCol) { try { learned = await db.users.learnEngineerCodes(); } catch { /* اختياري */ } }
      await loadReference({ force: true });
      const nReview = list.filter((t) => t.reviewReasons.length).length;
      toast(u && n ? `أُضيفت ${num(n)} وحُدِّثت ${num(u)} مهمة.` : u ? `حُدِّثت ${num(u)} مهمة.` : `تم استيراد ${num(n)} مهمة.`, 'ok');
      await refreshReviewCount();
      mount(stepBox, html`<div class="card card-pad stack"><div class="alert ok">${u || codeCol
        ? html`من «${S.fileName}»: أُضيفت <b>${num(n)}</b> مهمة${nReview ? html` (منها <b>${num(nReview)}</b> تحتاج مراجعة)` : ''}، وحُدِّثت <b>${num(u)}</b>.`
        : html`تم استيراد <b>${num(n)}</b> مهمة من «${S.fileName}»${nReview ? html`، منها <b>${num(nReview)}</b> تحتاج مراجعة` : ''}.`}
        ${learned ? html`<div class="small">وعُرف رمز ${num(learned)} مهندس من رموز مهامه (صفحة المستخدمين).</div>` : ''}</div>
        <div class="row"><a class="btn btn-primary" href="#/tasks?period=all">عرض المهام</a>
          ${nReview ? html`<a class="btn" href="#/tasks?period=all&review=1">${icon('eye')}المهام التي تحتاج مراجعة</a>` : ''}
          <button class="btn" data-act="restart">استيراد ملف آخر</button></div></div>`);
    } catch (e) {
      mount(stepBox, html`<div class="card card-pad stack"><div class="alert bad">توقف الاستيراد: ${e.message}</div>
        <div class="small muted">${n || u ? `اكتمل قبل الخطأ: ${num(n)} إضافة و${num(u)} تحديث، وحُفظت. ` : ''}${codeCol
          ? 'أعد المعاينة واستورد الملف نفسه لإكمال الباقي: المهام تُعرف برموزها فلا تتكرر.'
          : 'الدفعات التي اكتملت قبل الخطأ حُفظت. أعد المعاينة مع خيار «عدم تكرار المهام الموجودة» لإكمال الباقي دون تكرار.'}</div>
        <div class="row"><button class="btn" data-act="back">رجوع للمطابقة</button></div></div>`);
    }
  }

  on(root, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'restart') step1();
    else if (a === 'preview') step3(b);
    else if (a === 'recheck') { await loadReference({ force: true }); step3(b); }
    else if (a === 'back') step2();
    else if (a === 'run') step4();
    else if (a === 'report') {
      // كل صف في الملف ونتيجته: للتأكد أن لا شيء ضاع
      const { rows, blank, absent = [] } = S.parsed;
      const detail = (r) => [...r.errors, ...(r.match ? diffText(r) : r.reasons)].join(' | ');
      const all = [
        ...rows.map((r) => [r.line, r.code, resultOf(r)[0], r.engName, r.task.subject, fmtDate(r.task.receivedDate), fmtDate(r.task.completedDate), detail(r)]),
        ...blank.map((b) => [b.line, '', 'بلا بيانات مهمة (لا تُستورد)', '', '', '', '', b.text]),
      ].sort((x, y) => x[0] - y[0]);
      const out = absent.map((t) => ['', t.taskCode, 'في النظام وليست في الملف (لا تُمس)', t.engineerName, t.subject, fmtDate(t.receivedDate), fmtDate(t.completedDate), '']);
      downloadBlob(toCsv([['الصف', 'رمز المهمة', 'النتيجة', 'المهندس', 'الموضوع', 'الاستقبال', 'الانتهاء', 'التفاصيل'], ...all, ...out]), `import-report_${today()}.csv`);
    } else if (a === 'template') {
      const { writeXlsx } = await import('../lib/xlsx.js');
      // الرمز وتاريخ الإدخال يأتيان من ملف الاستيراد في Google Sheets، لا من الملف النموذجي (النظام يعطيهما)
      const cols = TARGETS.filter((t) => t.key !== 'taskCode' && t.key !== 'enteredAt').map((t) => ({ label: t.label, width: t.key === 'subject' ? 40 : 18, type: /Date$/.test(t.key) ? 'date' : 'text' }));
      const L = state.lookups;
      const sample = [state.user.fullName, '1234', 'دائرة الموارد البشرية', 'محمد بن سعيد', 'إصلاح طابعة الشبكة', today(), today(), '', L.taskTypes[0]?.name || '', L.correspondenceTypes[0]?.name || '', L.statuses.find((s) => s.kind === 'done')?.name || '', 'عادية', ''];
      downloadBlob(writeXlsx([{ name: 'المهام', columns: cols, rows: [sample] }]), 'tasks-import-template.xlsx');
    }
  });

  step1();
}
