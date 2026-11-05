/** صفحة التقرير (بديل ورقة Report): فلاتر مفصلة، ترتيب، تصدير Excel/CSV، وطباعة PDF */
import { CONFIG } from '../config.js';
import { db } from '../data/index.js';
import { html, mount, $, formData, on } from '../core/dom.js';
import { state, can, engineers } from '../core/store.js';
import { fmtDate, fmtDateTime, today, num, pct, dec1 } from '../core/format.js';
import { setTitle } from '../core/session.js';
import { exportTasks } from '../core/exporter.js';
import { summarize } from '../lib/stats.js';
import { icon } from '../ui/icons.js';
import { dateInput } from '../ui/dateField.js';
import { toastError } from '../ui/feedback.js';
import { pageHead, options, loading, newPage } from '../ui/parts.js';

const KEY = `${CONFIG.storagePrefix || 'tsk.'}filters.report`;
const year = Number(today().slice(0, 4));
const DEFAULTS = { engineerId: '', taskTypeId: '', correspondenceTypeId: '', statusId: '', year: String(year), from: `${year}-01-01`, to: `${year}-12-31`, sort: 'receivedDate', dir: 'asc', kind: '' };
// أزرار الإحصائيات: تفلتر التقرير حسب نوع الحالة، والضغطة الثانية تلغي
const KINDS = [['done', 'مكتملة', 'var(--ok)'], ['open', 'مفتوحة', 'var(--info)'], ['cancelled', 'مغلقة بدون إنجاز', 'var(--muted)']];
const KIND_LABEL = { done: 'المكتملة', open: 'المفتوحة', cancelled: 'المغلقة بدون إنجاز' };
const SORTS = [['receivedDate', 'تاريخ الاستقبال'], ['completedDate', 'تاريخ الانتهاء'], ['engineerName', 'اسم المهندس'], ['taskType', 'نوع المهمة'],
  ['correspondenceType', 'نوع المراسلة'], ['status', 'الحالة'], ['durationDays', 'المدة'], ['requester', 'الجهة الطالبة'], ['id', 'الرقم']];

export default async function report(ctx, main) {
  setTitle('التقرير');
  let F = { ...DEFAULTS };
  try { F = { ...DEFAULTS, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { /* */ }
  if (ctx.query.kind !== undefined) F.kind = KIND_LABEL[ctx.query.kind] ? ctx.query.kind : '';
  const viewAll = can('tasks.viewAll');
  const L = state.lookups;
  const years = [];
  for (let y = year + 1; y >= 2020; y--) years.push([String(y), String(y)]);

  const root = newPage(main);
  mount(root, html`
    ${pageHead({
      title: 'تقرير المهام',
      actions: html`
        <button class="btn" data-act="xlsx">${icon('download')}Excel</button>
        <button class="btn" data-act="csv">${icon('file')}CSV</button>
        <button class="btn btn-primary" data-act="print">${icon('print')}طباعة / PDF</button>`,
    })}
    <form class="card filters" id="filters">
      ${viewAll ? html`<div class="field"><label for="r-eng">المهندس</label>
        <select class="input" id="r-eng" name="engineerId">${options(engineers({ includeInactive: true }).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })), F.engineerId, 'الكل')}</select></div>` : ''}
      <div class="field"><label for="r-type">نوع المهمة</label><select class="input" id="r-type" name="taskTypeId">${options(L.taskTypes, F.taskTypeId, 'الكل')}</select></div>
      <div class="field"><label for="r-corr">نوع المراسلة</label><select class="input" id="r-corr" name="correspondenceTypeId">${options(L.correspondenceTypes, F.correspondenceTypeId, 'الكل')}</select></div>
      <div class="field"><label for="r-st">الحالة</label><select class="input" id="r-st" name="statusId">${options(L.statuses, F.statusId, 'الكل')}</select></div>
      <div class="field"><label for="r-year">السنة</label><select class="input" id="r-year" name="year">${options(years, F.year, '—')}</select></div>
      <div class="field"><label for="r-from">من</label>${dateInput({ name: 'from', id: 'r-from', value: F.from })}</div>
      <div class="field"><label for="r-to">إلى</label>${dateInput({ name: 'to', id: 'r-to', value: F.to })}</div>
      <div class="field"><label for="r-sort">الترتيب حسب</label><select class="input" id="r-sort" name="sort">${options(SORTS, F.sort)}</select></div>
      <div class="field"><label for="r-dir">الاتجاه</label><select class="input" id="r-dir" name="dir">${options([['asc', 'تصاعدي'], ['desc', 'تنازلي']], F.dir)}</select></div>
      <div class="btns">
        <button type="button" class="btn" data-act="today">${icon('calendar')}اليوم</button>
        <button type="button" class="btn btn-ghost" data-act="reset">${icon('x')}مسح</button>
      </div>
    </form>
    <div id="out" style="margin-top:16px">${loading()}</div>`);

  const form = $('#filters', root);
  const out = $('#out', root);
  let rows = [];
  const shown = () => (F.kind ? rows.filter((t) => t.statusKind === F.kind) : rows);
  const syncUrl = () => history.replaceState(null, '', F.kind ? `#/report?kind=${F.kind}` : '#/report');

  const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name;
  function criteria() {
    const c = [];
    if (F.from || F.to) c.push(`الفترة: ${F.from ? fmtDate(F.from) : '…'} – ${F.to ? fmtDate(F.to) : '…'}`);
    if (viewAll) c.push(`المهندس: ${F.engineerId ? engineers({ includeInactive: true }).find((e) => e.id === F.engineerId)?.fullName : 'الكل'}`);
    else c.push(`المهندس: ${state.user.fullName}`);
    if (F.taskTypeId) c.push(`نوع المهمة: ${nameOf(L.taskTypes, F.taskTypeId)}`);
    if (F.correspondenceTypeId) c.push(`نوع المراسلة: ${nameOf(L.correspondenceTypes, F.correspondenceTypeId)}`);
    if (F.statusId) c.push(`الحالة: ${nameOf(L.statuses, F.statusId)}`);
    if (F.kind) c.push(`عرض: ${KIND_LABEL[F.kind]} فقط`);
    return c;
  }

  function sortRows() {
    const k = F.sort, d = F.dir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ar', { numeric: true });
      return (r || a.id - b.id) * d;
    });
  }

  function draw() {
    sortRows();
    const s = summarize(rows, { delayDays: state.settings?.delayThresholdDays || 7, today: today() });
    const list = shown();
    const kindBtn = ([k, label, color]) => html`<button type="button" class="chip chip-btn ${F.kind === k ? 'on' : ''}" data-kind="${k}" aria-pressed="${F.kind === k}" title="${F.kind === k ? 'إلغاء الفلترة' : `عرض ${KIND_LABEL[k]} فقط`}"><span class="dot" style="color:${color}"></span>${label} <b>${num(s[k])}</b>${F.kind === k ? icon('x') : ''}</button>`;
    mount(out, html`
      <div class="card">
        <div class="print-only" style="padding:0 0 10px">
          <h2>${CONFIG.orgName} — تقرير المهام</h2>
          <div class="small">${criteria().join(' · ')}</div>
          <div class="small muted">أُعدّ في ${fmtDateTime(new Date().toISOString())} بواسطة ${state.user.fullName}</div>
        </div>
        <div class="card-head no-print"><div class="small muted">${criteria().join(' · ')}</div></div>
        <div class="chips" style="padding:12px 16px">
          <button type="button" class="chip chip-btn ${F.kind ? '' : 'on'}" data-kind="" aria-pressed="${!F.kind}" title="كل المهام">الإجمالي <b>${num(s.total)}</b></button>
          ${KINDS.map(kindBtn)}
          <span class="chip">نسبة الإنجاز <b>${pct(s.rate)}</b></span>
          <span class="chip">متوسط المدة <b>${dec1(s.avgDuration)}</b> يوم</span>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>م</th>${viewAll ? html`<th>اسم المهندس</th>` : ''}<th>رقم القيد</th><th>الجهة الطالبة</th><th>اسم الموظف</th><th>الموضوع</th>
            <th>الاستقبال</th><th>الانتهاء</th><th>نوع المهمة</th><th>نوع المراسلة</th><th>الحالة</th><th>المدة</th><th>سبب التأخير</th><th>الملاحظات</th></tr></thead>
          <tbody>${list.length ? list.map((t, i) => html`<tr>
            <td class="num muted">${i + 1}</td>${viewAll ? html`<td class="nowrap">${t.engineerName}</td>` : ''}<td class="num">${t.refNo}</td>
            <td>${t.requester}</td><td>${t.employeeName}</td><td class="subject">${t.subject}</td>
            <td class="num nowrap">${fmtDate(t.receivedDate)}</td><td class="num nowrap">${fmtDate(t.completedDate)}</td>
            <td>${t.taskType}</td><td>${t.correspondenceType}</td><td class="nowrap">${t.status}</td><td class="num">${t.durationDays ?? ''}</td>
            <td>${t.delayReason}</td><td>${t.notes}</td></tr>`)
            : html`<tr><td colspan="14"><div class="empty">${icon('empty')}<div>لا توجد مهام تطابق المعايير.</div></div></td></tr>`}</tbody>
        </table></div>
      </div>`);
  }

  let reqId = 0;
  async function load() {
    const my = ++reqId;
    mount(out, loading());
    try {
      const list = await db.tasks.list({
        from: F.from || undefined, to: F.to || undefined, engineerId: viewAll ? F.engineerId || undefined : undefined,
        taskTypeId: F.taskTypeId || undefined, correspondenceTypeId: F.correspondenceTypeId || undefined, statusId: F.statusId || undefined,
      });
      if (my !== reqId) return;
      rows = list;
      draw();
    } catch (e) { if (my === reqId) mount(out, html`<div class="alert bad">${e.message}</div>`); }
  }

  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(F)); } catch { /* */ } };
  form.addEventListener('change', (e) => {
    const n = e.target.name;
    F = { ...F, ...formData(form) };
    if (n === 'year' && F.year) { F.from = `${F.year}-01-01`; F.to = `${F.year}-12-31`; form.elements.from.value = F.from; form.elements.to.value = F.to; }
    if (n === 'from' || n === 'to') { F.year = ''; form.elements.year.value = ''; }
    save();
    if (n === 'sort' || n === 'dir') draw(); else load();
  });

  on(root, 'click', '[data-kind]', (e, b) => {
    const k = b.dataset.kind;
    F.kind = !k || F.kind === k ? '' : k;
    save(); syncUrl(); draw();
  });
  on(root, 'click', '[data-act]', (e, b) => {
    const a = b.dataset.act;
    if (a === 'print') window.print();
    else if (a === 'xlsx' || a === 'csv') {
      if (!shown().length) return toastError({ message: 'لا توجد بيانات للتصدير.' });
      exportTasks(shown(), { format: a, name: 'tasks-report', sheet: 'التقرير' });
    } else if (a === 'today') {
      const t = today();
      Object.assign(F, { from: t, to: t, year: '' });
      form.elements.from.value = t; form.elements.to.value = t; form.elements.year.value = '';
      save(); load();
    } else if (a === 'reset') {
      sessionStorage.removeItem(KEY);
      report({ ...ctx, query: {} }, main);
    }
  });

  syncUrl();
  await load();
}
