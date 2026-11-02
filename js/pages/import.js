/**
 * استيراد المهام من Excel أو CSV (مدير النظام)
 * 1) اختيار الملف  2) مطابقة الأعمدة والخيارات  3) المعاينة  4) الاستيراد
 *
 * لا يُفقد أي صف فيه بيانات: الصف الذي فيه مشكلة (تاريخ غير مفهوم، موضوع فارغ، مكرر محتمل…)
 * يُصلَح تلقائياً ويُستورد مع «أسباب المراجعة»، فيظهر في «تحتاج مراجعة» ليصلحه المهندس لاحقاً.
 * لا يمنع الاستيراد إلا اسم مهندس لا يطابق أي حساب، وعلى المدير اختيار الحساب المقابل له.
 */
import { db } from '../data/index.js';
import { html, mount, $, on } from '../core/dom.js';
import { state, engineers, loadReference, refreshReviewCount } from '../core/store.js';
import { parseDate, normalizeAr, fmtDate, num, today } from '../core/format.js';
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
  { key: 'delayReason', label: 'سبب التأخير', aliases: ['سبب تأخير إنجاز المهمة', 'سبب التأخير'] },
];
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

export default async function importPage(ctx, main) {
  setTitle('الاستيراد');
  const S = { step: 1, fileName: '', sheets: [], sheetIdx: 0, headerRow: -1, map: {}, engineerMode: 'column', fixedEngineer: '', createMissing: true, skipDup: true, blankEngineer: '', parsed: null, alias: {}, existing: null };
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
      S.alias = {}; S.existing = null;
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
          ${S.engineerMode === 'column' ? html`<div class="field" style="max-width:420px"><label for="i-blank">المهمة التي لا يوجد فيها اسم مهندس تُسند إلى</label>
            <select class="input" id="i-blank" data-k="blankEngineer">${options(engs.map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })), S.blankEngineer, '— اختر (عند الحاجة) —')}</select>
            <span class="hint">وتظهر في «تحتاج مراجعة» ليُسندها رئيس القسم أو المدير للمهندس الصحيح.</span></div>` : ''}
          <div class="alert small">لا يُترك أي صف فيه بيانات: ما فيه مشكلة (تاريخ غير مفهوم، موضوع فارغ، مهمة مكررة محتملة…) يُصلَح تلقائياً
            ويُستورد مع علامة <b>«تحتاج مراجعة»</b> وسببها، ليصلحه المهندس لاحقاً.</div>
          <div><button class="btn btn-primary" data-act="preview">${icon('eye')}معاينة</button></div>
        </div>
      </div>`);
  }

  on(root, 'change', '[data-alias]', (e, el) => {
    if (!el.value) return;
    S.alias[normalizeAr(el.dataset.alias)] = el.value;
    step3(null);
  });

  on(root, 'change', '[data-k], [data-map], [name="engMode"]', (e, el) => {
    if (el.dataset.map) { S.map[el.dataset.map] = el.value === '' ? undefined : Number(el.value); return; }
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

    // المهام الموجودة في النظام: كم مرة توجد كل مهمة (لا نكرر الموجود، ونستورد الزائد عليه)
    let existing = new Map();
    if (S.skipDup) {
      if (!S.existing) {
        const all = await db.tasks.list({ deleted: 'include' });
        S.existing = new Map();
        for (const t of all) { const k = `${t.engineerId}|${t.receivedDate}|${normalizeAr(t.subject)}`; S.existing.set(k, (S.existing.get(k) || 0) + 1); }
      }
      existing = new Map(S.existing);
    }
    const missing = { taskTypes: new Set(), correspondenceTypes: new Set(), statuses: new Set() };
    const out = [];
    const blank = [];      // صفوف فيها خلايا لكن بلا أي بيانات مهمة (مثل اسم مهندس وحده)
    let empty = 0;         // صفوف فارغة تماماً
    const g = (r, k) => (S.map[k] == null ? '' : r[S.map[k]]);
    const blankEng = S.blankEngineer ? engs.find((e) => e.id === S.blankEngineer) : null;
    const t0 = today();

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

      let subjectV = subject;
      if (!subject) { subjectV = '(بدون موضوع)'; reasons.push('الموضوع فارغ'); }
      let completedV = completedDate;
      if (cellText(doneRaw) && !completedDate) reasons.push(`تاريخ الانتهاء غير مفهوم «${cellText(doneRaw)}»`);
      let receivedDate = receivedParsed;
      if (!receivedParsed) {
        receivedDate = completedV || t0;
        reasons.push(`${cellText(recRaw) ? `تاريخ الاستقبال غير مفهوم «${cellText(recRaw)}»` : 'تاريخ الاستقبال فارغ'}، ووُضع ${completedV ? 'تاريخ الانتهاء' : 'تاريخ الاستيراد'} مكانه`);
      }
      if (completedV && completedV < receivedDate) {
        reasons.push(`تاريخ الانتهاء ${fmtDate(completedV)} قبل تاريخ الاستقبال، ووُضع تاريخ الاستقبال مكانه`);
        completedV = receivedDate;
      }

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
      if (!status) status = completedV ? defDone : defOpen;
      const kind = status?.kind || (status?.pending ? pendingKind[normalizeAr(status.pending)] : null);
      if (kind === 'done' && !completedV) { completedV = receivedDate; reasons.push('مكتملة بدون تاريخ انتهاء، ووُضع تاريخ الاستقبال'); }

      const task = {
        engineerId: eng?.id, refNo: cellText(g(r, 'refNo')), requester: cellText(g(r, 'requester')), employeeName: cellText(g(r, 'employeeName')),
        subject: subjectV, receivedDate, completedDate: kind === 'open' ? null : completedV, notes: cellText(g(r, 'notes')), delayReason: cellText(g(r, 'delayReason')),
        _ref: { ...ref, status },
      };
      let exists = false;
      const key = eng ? `${eng.id}|${receivedDate}|${normalizeAr(subjectV)}` : '';
      if (key && existing.get(key) > 0) { existing.set(key, existing.get(key) - 1); exists = true; }
      out.push({ line, key, task, errors, reasons, exists, dup: false, engName: eng?.fullName || engName, statusName: status?.name || status?.pending || '' });
    });

    // المكرر المحتمل داخل الملف: يُستورد كله، مع علامة مراجعة على كل صفوف المجموعة
    const groups = new Map();
    for (const r of out) if (r.key && !r.exists && !r.errors.length) groups.set(r.key, [...(groups.get(r.key) || []), r]);
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      for (const r of list) {
        r.dup = true;
        r.reasons.push(`مكررة محتملة: نفس المهندس والتاريخ والموضوع في صفوف الملف ${list.map((x) => x.line).join('، ')}`);
      }
    }
    return { rows: out, missing, unknown, blank, empty };
  }

  /* ───── الخطوة 3 ───── */
  async function step3(btn) {
    if (S.map.subject == null || S.map.receivedDate == null) return toastError({ message: 'طابق عمودي «الموضوع» و«تاريخ الاستقبال» على الأقل.' });
    if (S.engineerMode === 'column' && S.map.engineer == null) return toastError({ message: 'طابق عمود «اسم المهندس» أو اختر مهندساً واحداً.' });
    try { S.parsed = await busy(btn, parseRows); } catch (e) { return toastError(e); }
    S.step = 3; drawSteps();
    const { rows, missing, unknown, blank, empty } = S.parsed;
    const engOpts = engineers({ includeInactive: true }).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive }));
    const go = rows.filter((r) => !r.errors.length && !r.exists);
    const review = go.filter((r) => r.reasons.length), dup = go.filter((r) => r.dup);
    const exists = rows.filter((r) => r.exists), stop = rows.filter((r) => r.errors.length);
    const total = rows.length + blank.length;
    const miss = Object.entries(missing).filter(([, v]) => v.size);
    const show = [...stop, ...review, ...go.filter((r) => !r.reasons.length), ...exists].slice(0, 300);
    mount(stepBox, html`
      <div class="card">
        <div class="card-head"><h2>المعاينة</h2><div class="actions"><button class="btn btn-sm" data-act="back">رجوع</button></div></div>
        <div class="card-pad stack">
          <div class="chips">
            <span class="chip">صفوف فيها بيانات <b>${num(total)}</b></span>
            <span class="chip"><span class="dot" style="color:var(--ok)"></span>ستُستورد <b>${num(go.length)}</b></span>
            <span class="chip"><span class="dot" style="color:var(--warn)"></span>منها تحتاج مراجعة <b>${num(review.length)}</b></span>
            ${dup.length ? html`<span class="chip"><span class="dot" style="color:var(--warn)"></span>منها مكررة محتملة <b>${num(dup.length)}</b></span>` : ''}
            ${exists.length ? html`<span class="chip"><span class="dot" style="color:var(--muted)"></span>موجودة في النظام مسبقاً <b>${num(exists.length)}</b></span>` : ''}
            ${blank.length ? html`<span class="chip"><span class="dot" style="color:var(--muted)"></span>بلا بيانات مهمة <b>${num(blank.length)}</b></span>` : ''}
            ${stop.length ? html`<span class="chip"><span class="dot" style="color:var(--bad)"></span>تنتظر اختيار المهندس <b>${num(stop.length)}</b></span>` : ''}
          </div>
          <div class="small ${go.length + exists.length + blank.length + stop.length === total ? 'muted' : 'bad'}">
            المطابقة: ${num(go.length)} ستُستورد + ${num(exists.length)} موجودة مسبقاً + ${num(blank.length)} بلا بيانات مهمة + ${num(stop.length)} تنتظر المهندس = <b>${num(total)}</b> صفاً.
            ${empty ? html` (وتجاهلنا ${num(empty)} صفاً فارغاً تماماً)` : ''}</div>
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
          ${stop.length && !unknown.size ? html`<div class="alert bad">${num(stop.length)} صفاً بلا اسم مهندس. اختر في «مطابقة الأعمدة» (زر رجوع) لمن تُسند.</div>` : ''}
          <div class="row">
            <button class="btn btn-primary" data-act="run" ${go.length && !stop.length ? '' : 'disabled'}>${icon('upload')}استيراد ${num(go.length)} مهمة</button>
            <button class="btn" data-act="report">${icon('download')}تقرير الصفوف (CSV)</button>
          </div>
          ${stop.length ? html`<div class="small muted">الاستيراد ينتظر اختيار المهندس للصفوف أعلاه حتى لا يُترك أي صف.</div>` : ''}
        </div>
        <div class="table-wrap" style="max-height:60vh"><table class="table">
          <thead><tr><th>الصف</th><th>المهندس</th><th>الموضوع</th><th>الاستقبال</th><th>الانتهاء</th><th>الحالة</th><th>النتيجة</th></tr></thead>
          <tbody>${show.map((r) => html`<tr>
            <td class="num muted">${r.line}</td><td class="nowrap">${r.engName}</td><td class="subject"><div class="clip">${r.task.subject}</div></td>
            <td class="num nowrap">${fmtDate(r.task.receivedDate)}</td><td class="num nowrap">${fmtDate(r.task.completedDate)}</td><td>${r.statusName}</td>
            <td>${r.errors.length ? html`<span class="badge bad">تنتظر</span> <span class="small">${r.errors.join('، ')}</span>`
              : r.exists ? html`<span class="badge">موجودة مسبقاً</span>`
              : r.reasons.length ? html`<span class="badge warn">تحتاج مراجعة</span> <span class="small">${r.reasons.join('، ')}</span>`
              : html`<span class="badge ok">جاهزة</span>`}</td></tr>`)}</tbody>
        </table></div>
        ${rows.length > show.length ? html`<div class="table-foot">تُعرض أول ${num(show.length)} من ${num(rows.length)} صف. التفاصيل كاملة في «تقرير الصفوف».</div>` : ''}
      </div>`);
  }
  const completedHint = () => 'مكتملة إذا كان لها تاريخ انتهاء، وإلا مفتوحة';

  /* ───── الخطوة 4 ───── */
  async function step4() {
    const { rows, missing, unknown } = S.parsed;
    const engOpts = engineers({ includeInactive: true }).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive }));
    const ok = rows.filter((r) => !r.errors.length && !r.exists);
    S.step = 4; drawSteps();
    S.existing = null; // بعد الإدخال تتغير قائمة المكرر
    mount(stepBox, html`<div class="card card-pad stack"><h2>جارٍ الاستيراد…</h2><div class="progress"><div id="bar"></div></div><div class="small muted" id="msg">تجهيز القوائم…</div></div>`);
    const bar = $('#bar', stepBox), msg = $('#msg', stepBox);
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
      const list = ok.map(({ task, reasons }) => {
        const { _ref, ...t } = task;
        const why = [...reasons];
        const statusId = idOf('statuses', _ref.status);
        // حماية أخيرة: نفس قاعدة قاعدة البيانات (المكتملة تحتاج تاريخ انتهاء، والمفتوحة بدونه)
        const k = state.lookups.statuses.find((x) => x.id === statusId)?.kind;
        let completedDate = t.completedDate;
        if (k === 'open') completedDate = null;
        if (k === 'done' && !completedDate) {
          completedDate = t.receivedDate;
          why.push('مكتملة بدون تاريخ انتهاء، ووُضع تاريخ الاستقبال');
        }
        return { ...t, completedDate, reviewReasons: why, taskTypeId: idOf('taskTypes', _ref.taskType), correspondenceTypeId: idOf('correspondenceTypes', _ref.correspondenceType), statusId };
      });
      // 2) إدخال المهام على دفعات
      const n = await db.tasks.bulkCreate(list, (d, total) => { bar.style.width = `${Math.round((d / total) * 100)}%`; msg.textContent = `${num(d)} من ${num(total)}`; });
      toast(`تم استيراد ${num(n)} مهمة.`, 'ok');
      const nReview = list.filter((t) => t.reviewReasons.length).length;
      await refreshReviewCount();
      mount(stepBox, html`<div class="card card-pad stack"><div class="alert ok">تم استيراد <b>${num(n)}</b> مهمة من «${S.fileName}»${nReview ? html`، منها <b>${num(nReview)}</b> تحتاج مراجعة` : ''}.</div>
        <div class="row"><a class="btn btn-primary" href="#/tasks?period=all">عرض المهام</a>
          ${nReview ? html`<a class="btn" href="#/tasks?period=all&review=1">${icon('eye')}المهام التي تحتاج مراجعة</a>` : ''}
          <button class="btn" data-act="restart">استيراد ملف آخر</button></div></div>`);
    } catch (e) {
      mount(stepBox, html`<div class="card card-pad stack"><div class="alert bad">توقف الاستيراد: ${e.message}</div>
        <div class="small muted">الدفعات التي اكتملت قبل الخطأ حُفظت. أعد المعاينة مع خيار «عدم تكرار المهام الموجودة» لإكمال الباقي دون تكرار.</div>
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
      const { rows, blank } = S.parsed;
      const res = (r) => (r.errors.length ? 'تنتظر اختيار المهندس' : r.exists ? 'موجودة في النظام مسبقاً (لا تُستورد)' : r.reasons.length ? 'تُستورد وتحتاج مراجعة' : 'تُستورد');
      const all = [
        ...rows.map((r) => [r.line, res(r), r.engName, r.task.subject, fmtDate(r.task.receivedDate), fmtDate(r.task.completedDate), [...r.errors, ...r.reasons].join(' | ')]),
        ...blank.map((b) => [b.line, 'بلا بيانات مهمة (لا تُستورد)', '', '', '', '', b.text]),
      ].sort((x, y) => x[0] - y[0]);
      downloadBlob(toCsv([['الصف', 'النتيجة', 'المهندس', 'الموضوع', 'الاستقبال', 'الانتهاء', 'التفاصيل'], ...all]), `import-report_${today()}.csv`);
    } else if (a === 'template') {
      const { writeXlsx } = await import('../lib/xlsx.js');
      const cols = TARGETS.map((t) => ({ label: t.label, width: t.key === 'subject' ? 40 : 18, type: /Date$/.test(t.key) ? 'date' : 'text' }));
      const L = state.lookups;
      const sample = [state.user.fullName, '1234', 'دائرة الموارد البشرية', 'محمد بن سعيد', 'إصلاح طابعة الشبكة', today(), today(), '', L.taskTypes[0]?.name || '', L.correspondenceTypes[0]?.name || '', L.statuses.find((s) => s.kind === 'done')?.name || '', ''];
      downloadBlob(writeXlsx([{ name: 'المهام', columns: cols, rows: [sample] }]), 'tasks-import-template.xlsx');
    }
  });

  step1();
}
