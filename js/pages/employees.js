/**
 * الموظفون (مدير النظام): موظفو الوزارة كلهم، ومكان عمل كل منهم بالإسناد (أصيل، تكليف، ندب، قيام بالأعمال…)
 * بتاريخ بداية ونهاية، وأنواع الإسناد، واستيراد الموظفين من Excel.
 * قاعدة البيانات تفرض القواعد نفسها مستقلة عن هذه الصفحة.
 */
import { invalidateDirectory } from '../core/directory.js';
import { db } from '../data/index.js';
import { html, mount, $, on, debounce, formData, downloadBlob } from '../core/dom.js';
import { state } from '../core/store.js';
import { setTitle } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { modal, busy, toast, toastError, confirmBox } from '../ui/feedback.js';
import { dataTable } from '../ui/table.js';
import { pageHead, options, loading, newPage, searchBox } from '../ui/parts.js';
import { dateInput } from '../ui/dateField.js';
import { unitPicker } from '../ui/unitPicker.js';
import { normalizeAr, searchKey, queryWords, latinDigits, fmtDate, today } from '../core/format.js';
import { buildModel, pathText, treeOrder } from '../core/orgModel.js';
import { readXlsx, writeXlsx } from '../lib/xlsx.js';
import { parseCsv } from '../lib/csv.js';
import { assignImportTab } from './assignImport.js';

const TABS = [['list', 'الموظفون'], ['types', 'أنواع الإسناد'], ['import', 'الاستيراد']];
const digits = (v) => latinDigits(String(v ?? '')).replace(/\s+/g, '');

export default async function employees(ctx, main) {
  setTitle('الموظفون');
  let tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'list';
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'الموظفون', sub: 'موظفو الوزارة كلهم، ومكان عمل كل منهم: الإسناد الأصيل، والتكليف والندب والقيام بالأعمال، بتاريخ بداية ونهاية فيبقى التاريخ محفوظاً.',
      actions: html`<button class="btn" data-act="link" title="ربط حسابات الدخول بسجلاتها الوظيفية: رقم الدخول = الرقم المدني أو الوظيفي">${icon('key')}ربط المستخدمين</button>
        <button class="btn btn-primary" data-act="new">${icon('plus')}موظف جديد</button>` })}
    <div class="card">
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button role="tab" data-tab="${k}">${l}</button>`)}</div>
      <div id="body">${loading()}</div>
    </div>`);
  const body = $('#body', root);

  /* ───────────── البيانات ───────────── */
  const D = { emps: [], asg: [], types: [], M: null, users: [], byEmp: new Map(), emp: new Map(), type: new Map() };
  const F = { q: '', unit: '', sub: true, status: 'active', reason: '' };
  /** أسباب المراجعة كما تبدأ بها ملاحظاتها */
  const REASONS = ['لا يوجد رقم مدني', 'رقم مدني غير صحيح', 'رقم مدني مكرر', 'لا يوجد رقم وظيفي', 'رقم وظيفي غير صحيح', 'رقم وظيفي مكرر', 'رقم وظيفي مسجّل لموظف آخر', 'لا يوجد اسم بالعربي'];
  let T = today();

  async function reload() {
    invalidateDirectory();   // حقلا الجهة والموظف في المهام يُعاد تحميلهما
    const [emps, asg, types, org, users] = await Promise.all([
      db.employees.list(), db.employees.assignments(), db.employees.types(), db.org.load(), db.users.list(),
    ]);
    T = today();
    Object.assign(D, { emps, asg, types, M: buildModel(org), users });
    state.users = users;
    D.emp = new Map(emps.map((e) => [e.id, e]));
    D.type = new Map(types.map((t) => [t.id, t]));
    D.byEmp = new Map();
    for (const a of asg) { if (!D.byEmp.has(a.employeeId)) D.byEmp.set(a.employeeId, []); D.byEmp.get(a.employeeId).push(a); }
    D.userOf = new Map(users.filter((u) => u.employeeId).map((u) => [u.employeeId, u]));
  }

  const isCurrent = (a) => a.startDate <= T && (!a.endDate || a.endDate >= T);
  const stateOf = (a) => (a.startDate > T ? 'upcoming' : a.endDate && a.endDate < T ? 'ended' : 'current');
  const STATE = { current: ['قائم', 'ok'], upcoming: ['قادم', 'info'], ended: ['منتهٍ', ''] };
  const primaryType = () => D.types.find((t) => t.isPrimary);
  const currentOf = (empId) => (D.byEmp.get(empId) || []).filter(isCurrent);
  const primaryOf = (empId) => currentOf(empId).find((a) => D.type.get(a.typeId)?.isPrimary);
  /** وصف الرئاسة: «المدير العام» للأصيل، و«قائم بأعمال المدير العام» لغيره */
  function headLabel(a) {
    if (!a.isHead) return '';
    const u = D.M.unit.get(a.unitId);
    const title = D.M.level.get(u?.levelId)?.headTitle || 'رئيس الوحدة';
    return D.type.get(a.typeId)?.isPrimary ? title : `قائم بأعمال ${title}`;
  }
  const unitName = (id) => D.M.unit.get(id)?.name || `#${id}`;

  /* ───────────── تبويب الموظفين ───────────── */
  let table = null;
  function drawList() {
    table = null;
    const unitOpts = treeOrder(D.M).map(({ u, depth }) => [u.id, `${'— '.repeat(depth)}${u.name}${u.isActive ? '' : ' (معطّلة)'}`]);
    mount(body, html`
      <div class="filters emp-filters">
        <div class="field wide">${searchBox(F.q, 'الاسم أو الرقم المدني أو الوظيفي…', 'emp-q')}</div>
        <div class="field wide"><label for="emp-unit">الوحدة</label>
          <select class="input" id="emp-unit">${options([['none', 'بلا إسناد أصيل قائم'], ...unitOpts], F.unit, 'كل الوحدات')}</select></div>
        <label class="check"><input type="checkbox" id="emp-sub" ${F.sub ? 'checked' : ''}> وما تحتها</label>
        <div class="field"><label for="emp-status">الحالة</label>
          <select class="input" id="emp-status">${options([['active', 'النشطون'], ['review', 'تحتاج مراجعة'], ['inactive', 'غير النشطين'], ['all', 'الكل']], F.status)}</select></div>
        <div class="field" id="emp-reason-f" ${F.status === 'review' ? '' : 'hidden'}><label for="emp-reason">السبب</label>
          <select class="input" id="emp-reason">${options(REASONS.map((r) => [r, r]), F.reason, 'كل الأسباب')}</select></div>
        <span class="small muted org-count" id="emp-count"></span>
      </div>
      <div id="emp-table"></div>`);
    drawTable();
  }

  function filtered() {
    const words = queryWords(F.q);
    const units = F.unit && F.unit !== 'none' ? new Set(F.sub ? D.M.subtree(Number(F.unit)) : [Number(F.unit)]) : null;
    return D.emps.filter((e) => {
      if (F.status === 'active' && !e.isActive) return false;
      if (F.status === 'inactive' && e.isActive) return false;
      if (F.status === 'review' && !e.needsReview) return false;
      if (F.status === 'review' && F.reason && !(e.reviewNotes || '').includes(F.reason)) return false;
      if (words.length) {
        const t = searchKey(`${e.nameAr} ${e.nameEn} ${e.civilNo} ${e.employeeNo}`);
        if (!words.every((w) => t.includes(w))) return false;
      }
      if (F.unit === 'none') return !primaryOf(e.id);
      if (units) return currentOf(e.id).some((a) => units.has(a.unitId));
      return true;
    });
  }

  function drawTable() {
    const rows = filtered();
    const nRev = D.emps.filter((e) => e.needsReview).length;
    mount($('#emp-count', body), html`${rows.length.toLocaleString('en-US')} من ${D.emps.length.toLocaleString('en-US')} موظف
      ${nRev && F.status !== 'review' ? html` · <button type="button" class="chip chip-btn" data-show-review>${nRev.toLocaleString('en-US')} تحتاج مراجعة</button>` : ''}`);
    const columns = [
      { key: 'nameAr', label: 'الاسم', render: (e) => html`<b>${e.nameAr}</b>${e.nameEn ? html`<div class="small muted"><span dir="ltr">${e.nameEn}</span></div>` : ''}` },
      { key: 'civilNo', label: 'الرقم المدني', cls: 'num', render: (e) => (e.civilNo ? html`<span class="ltr">${e.civilNo}</span>` : html`<span class="badge warn">بلا رقم</span>`) },
      { key: 'employeeNo', label: 'الرقم الوظيفي', cls: 'num', render: (e) => html`<span class="ltr">${e.employeeNo}</span>` },
      { key: 'unit', label: 'الوحدة (أصيل)', sort: (e) => { const p = primaryOf(e.id); return p ? unitName(p.unitId) : ''; }, render: (e) => {
        const p = primaryOf(e.id);
        if (!p) return html`<span class="small muted">—</span>`;
        const u = D.M.unit.get(p.unitId);
        return html`<span title="${u ? pathText(D.M, u) : ''}">${unitName(p.unitId)}</span>${p.isHead ? html` <span class="badge ok">${headLabel(p)}</span>` : ''}`;
      } },
      { key: 'other', label: 'إسنادات أخرى', sort: false, render: (e) => html`${currentOf(e.id).filter((a) => !D.type.get(a.typeId)?.isPrimary).map((a) =>
        html`<span class="badge info" title="${a.endDate ? `حتى ${fmtDate(a.endDate)}` : 'بلا تاريخ نهاية'}">${D.type.get(a.typeId)?.name}: ${unitName(a.unitId)}${a.isHead ? ` (${headLabel(a)})` : ''}</span> `)}` },
      { key: 'user', label: 'حساب النظام', sort: (e) => (D.userOf.get(e.id) ? 1 : 0), render: (e) => {
        const u = D.userOf.get(e.id);
        return u ? html`<span class="badge" title="${u.fullName}">${icon('key')}${u.shortName || u.fullName.split(' ')[0]}</span>` : '';
      } },
      { key: 'isActive', label: 'الحالة', render: (e) => html`${e.isActive ? html`<span class="badge ok">نشط</span>` : html`<span class="badge">غير نشط</span>`}
        ${e.needsReview ? html` <span class="badge warn">تحتاج مراجعة</span>
          ${e.reviewNotes ? html`<div class="small muted emp-why">${e.reviewNotes.split(/\s·\s|\n/).map((t) => html`<div>${t}</div>`)}</div>` : ''}` : ''}` },
    ];
    if (!table) {
      table = dataTable($('#emp-table', body), {
        columns, rows, sortKey: 'nameAr', sortDir: 'asc', pageSize: 50, onRow: (e) => empForm(e),
        empty: D.emps.length ? 'لا يوجد موظف يطابق البحث.' : 'لا يوجد موظفون بعد. أضفهم من «موظف جديد» أو من تبويب «الاستيراد».',
      });
    } else table.setRows(rows);
  }

  /* ───────────── سجل الموظف ───────────── */
  function empForm(emp) {
    const isNew = !emp;
    const u = emp ? D.userOf.get(emp.id) : null;
    const free = D.users.filter((x) => !x.employeeId || x.employeeId === emp?.id).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
    const m = modal({
      size: 'lg',
      title: isNew ? 'موظف جديد' : emp.nameAr,
      body: html`<form class="form-grid" novalidate data-emp>
        <div class="field"><label for="e-civil">الرقم المدني ${isNew || emp.civilNo ? html`<span class="req">*</span>` : ''}</label>
          <input class="input ltr" style="display:block;text-align:left" id="e-civil" name="civilNo" inputmode="numeric" maxlength="20" value="${emp?.civilNo || ''}" required autofocus>
          <span class="hint">معرّف الموظف في النظام، لا يتكرر.</span></div>
        <div class="field"><label for="e-no">الرقم الوظيفي</label>
          <input class="input ltr" style="display:block;text-align:left" id="e-no" name="employeeNo" maxlength="30" value="${emp?.employeeNo || ''}">
          <span class="hint">لا يتكرر.</span></div>
        <div class="field"><label for="e-ar">الاسم بالعربي <span class="req">*</span></label>
          <input class="input" id="e-ar" name="nameAr" maxlength="200" value="${emp?.nameAr || ''}" required></div>
        <div class="field"><label for="e-en">الاسم بالإنجليزي</label>
          <input class="input" dir="ltr" style="text-align:left" id="e-en" name="nameEn" maxlength="200" value="${emp?.nameEn || ''}"></div>
        ${isNew ? html`
          <div class="field span-2"><span class="label">مكان العمل (أصيل)</span><div data-unit></div>
            <span class="hint">اختياري؛ يمكن تحديده لاحقاً من سجل الموظف.</span></div>
          <div class="field"><label for="e-from">من تاريخ</label>${dateInput({ name: 'startDate', id: 'e-from', value: T })}</div>
          <div class="field"><span class="label">الرئاسة</span><label class="check"><input type="checkbox" name="isHead"> رئيس هذه الوحدة</label></div>` : ''}
        ${isNew ? '' : html`<div class="field span-2 emp-review ${emp.needsReview ? 'on' : ''}">
          <label class="check"><input type="checkbox" name="needsReview" ${emp.needsReview ? 'checked' : ''}> تحتاج مراجعة</label>
          <textarea class="input" name="reviewNotes" rows="2" placeholder="سبب المراجعة">${emp.reviewNotes || ''}</textarea>
          <span class="hint">${emp.civilNo ? 'بعد تصحيح البيانات أزل العلامة.' : 'يبقى «تحتاج مراجعة» حتى يُكتب رقمه المدني.'}</span></div>`}
        <div class="alert bad span-2" data-err hidden></div>
      </form>
      ${isNew ? '' : html`
        <div class="emp-section">
          <div class="emp-section-head"><h3>مكان العمل والإسنادات</h3>
            <div class="row-actions">
              <button class="btn btn-sm" data-asg-transfer>${icon('move')}${primaryOf(emp.id) ? 'نقل' : 'تحديد الوحدة'}</button>
              <button class="btn btn-sm" data-asg-new>${icon('plus')}إسناد جديد</button></div></div>
          <div data-asg-list></div>
        </div>
        <div class="emp-section">
          <div class="emp-section-head"><h3>حساب النظام</h3></div>
          <div class="row">
            <select class="input" data-user style="max-width:340px">${options(free.map((x) => [x.id, `${x.fullName}${x.loginNo ? ` (${x.loginNo})` : ''}`]), u?.id || '', 'غير مرتبط بحساب')}</select>
            <button class="btn btn-sm" data-user-save>${icon('check')}حفظ الربط</button>
          </div>
          <span class="small muted">يرتبط تلقائياً إن كان رقم الدخول هو الرقم المدني أو الوظيفي.</span>
        </div>`}`,
      footer: html`<button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'إضافة' : 'حفظ البيانات'}</button>
        ${isNew ? '' : emp.isActive
          ? html`<button class="btn btn-danger" data-deact>${icon('ban')}إنهاء الخدمة (تعطيل)</button>`
          : html`<button class="btn" data-react>${icon('restore')}تفعيل</button>`}
        <button class="btn" data-x>إغلاق</button>`,
    });
    const f = $('form[data-emp]', m.el), err = $('[data-err]', m.el);
    const fail = (t) => { err.textContent = t; err.hidden = false; };
    f.addEventListener('input', () => { err.hidden = true; });
    $('[data-x]', m.el).onclick = () => m.close();
    const picker = isNew ? unitPicker($('[data-unit]', m.el), { model: () => D.M, filter: (x) => x.isActive, none: 'بلا وحدة الآن', emptyText: 'بلا وحدة الآن' }) : null;
    if (picker) picker.set(null);

    const drawAsg = () => {
      mount($('[data-asg-transfer]', m.el), html`${icon('move')}${primaryOf(emp.id) ? 'نقل' : 'تحديد الوحدة'}`);
      const list = [...(D.byEmp.get(emp.id) || [])].sort((a, b) => ({ current: 0, upcoming: 1, ended: 2 }[stateOf(a)] - { current: 0, upcoming: 1, ended: 2 }[stateOf(b)]) || b.startDate.localeCompare(a.startDate));
      mount($('[data-asg-list]', m.el), list.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>النوع</th><th>الوحدة</th><th>من</th><th>إلى</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${list.map((a) => {
          const unit = D.M.unit.get(a.unitId);
          const [st, cls] = STATE[stateOf(a)];
          return html`<tr>
            <td><span class="badge ${D.type.get(a.typeId)?.isPrimary ? 'ok' : 'info'}">${D.type.get(a.typeId)?.name || '—'}</span></td>
            <td><b>${unitName(a.unitId)}</b>${a.isHead ? html` <span class="badge warn">${headLabel(a)}</span>` : ''}
              ${unit && D.M.ancestors(unit).length ? html`<div class="small muted">${pathText(D.M, unit)}</div>` : ''}
              ${a.notes ? html`<div class="small muted">${a.notes}</div>` : ''}</td>
            <td class="num"><span class="ltr">${fmtDate(a.startDate)}</span></td>
            <td class="num">${a.endDate ? html`<span class="ltr">${fmtDate(a.endDate)}</span>` : html`<span class="small muted">—</span>`}</td>
            <td><span class="badge ${cls}">${st}</span></td>
            <td><div class="row-actions">
              <button class="btn btn-ghost btn-icon btn-sm" data-asg-edit="${a.id}" title="تعديل" aria-label="تعديل">${icon('edit')}</button>
              ${stateOf(a) !== 'ended' ? html`<button class="btn btn-ghost btn-icon btn-sm" data-asg-end="${a.id}" title="إنهاء" aria-label="إنهاء">${icon('ban')}</button>` : ''}
              <button class="btn btn-ghost btn-icon btn-sm danger" data-asg-del="${a.id}" title="حذف (لتصحيح خطأ)" aria-label="حذف">${icon('trash')}</button>
            </div></td></tr>`;
        })}</tbody></table></div>`
        : html`<div class="small muted card-pad">لا توجد إسنادات. حدّد وحدته من «تحديد الوحدة».</div>`);
    };
    const refresh = async () => { await reload(); if (tab === 'list') drawTable(); if (!isNew) { const e = D.emp.get(emp.id); if (e) Object.assign(emp, e); drawAsg(); } };

    const submit = async (btn) => {
      const v = formData(f);
      const civilNo = digits(v.civilNo), employeeNo = digits(v.employeeNo).toUpperCase();
      if (!civilNo && (isNew || emp.civilNo)) return fail('الرقم المدني مطلوب.');
      if (civilNo && !/^[0-9]{1,20}$/.test(civilNo)) return fail('الرقم المدني أرقام فقط (حتى 20 خانة).');
      if (!v.nameAr.trim()) return fail('الاسم بالعربي مطلوب.');
      const dup = civilNo && D.emps.find((x) => x.civilNo === civilNo && x.id !== emp?.id);
      if (dup) return fail(`الرقم المدني ${civilNo} مسجّل للموظف «${dup.nameAr}».`);
      await busy(btn, async () => {
        try {
          const saved = await db.employees.save({ id: emp?.id, civilNo, employeeNo, nameAr: v.nameAr, nameEn: v.nameEn,
            needsReview: isNew ? false : !!f.elements.needsReview.checked || !civilNo, reviewNotes: isNew ? '' : v.reviewNotes });
          if (isNew && picker.value) {
            try {
              await db.employees.saveAssignment({ employeeId: saved.id, unitId: picker.value, typeId: primaryType().id, isHead: !!v.isHead, startDate: v.startDate || T });
            } catch (e2) {
              toastError({ message: `أُضيف الموظف، لكن تعذّر إسناده للوحدة: ${e2.message}` });
            }
          }
          await reload();
          if (tab === 'list') drawTable();
          toast(isNew ? 'أُضيف الموظف.' : 'تم الحفظ.', 'ok', 2000);
          m.close();
          if (isNew) empForm(D.emp.get(saved.id));
        } catch (e) { fail(e.message); }
      });
    };
    $('[data-save]', m.el).onclick = (e) => submit(e.currentTarget);
    f.onsubmit = (e) => { e.preventDefault(); submit($('[data-save]', m.el)); };
    if (isNew) return;

    drawAsg();
    $('[data-asg-new]', m.el).onclick = () => asgForm({ emp, onDone: refresh });
    $('[data-asg-transfer]', m.el).onclick = () => transferForm({ emp, onDone: refresh });
    on(m.el, 'click', '[data-asg-edit]', (e, b) => asgForm({ emp, a: D.asg.find((x) => x.id === Number(b.dataset.asgEdit)), onDone: refresh }));
    on(m.el, 'click', '[data-asg-end]', (e, b) => endForm({ a: D.asg.find((x) => x.id === Number(b.dataset.asgEnd)), onDone: refresh }));
    on(m.el, 'click', '[data-asg-del]', async (e, b) => {
      const a = D.asg.find((x) => x.id === Number(b.dataset.asgDel));
      if (!(await confirmBox({ title: 'حذف الإسناد', message: `حذف إسناد «${D.type.get(a.typeId)?.name}» في «${unitName(a.unitId)}» نهائياً؟ الحذف لتصحيح خطأ في الإدخال؛ الإسناد الذي انتهى يُنهى بتاريخ ولا يُحذف.`, okText: 'حذف', danger: true }))) return;
      try { await db.employees.deleteAssignment(a.id); toast('حُذف الإسناد.', 'ok', 2000); await refresh(); } catch (er) { toastError(er); }
    });
    $('[data-user-save]', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      try { await db.employees.setUser(emp.id, $('[data-user]', m.el).value || null); toast('حُفظ الربط.', 'ok', 2000); await refresh(); } catch (er) { toastError(er); }
    });
    $('[data-deact]', m.el)?.addEventListener('click', () => deactivate(emp, m));
    $('[data-react]', m.el)?.addEventListener('click', async (e) => busy(e.currentTarget, async () => {
      try { await db.employees.setActive(emp.id, true); toast('فُعّل الموظف.', 'ok', 2000); await reload(); drawTable(); m.close(); empForm(D.emp.get(emp.id)); } catch (er) { toastError(er); }
    }));
  }

  function deactivate(emp, parent) {
    const n = (D.byEmp.get(emp.id) || []).filter((a) => stateOf(a) !== 'ended').length;
    const m = modal({
      title: 'إنهاء خدمة الموظف', size: 'sm',
      body: html`<form novalidate><p style="margin-top:0">تعطيل «${emp.nameAr}»${n ? ` وإنهاء ${n} إسناد قائم أو قادم له` : ''}. يبقى سجله وتاريخ إسناداته محفوظاً، ويمكن تفعيله لاحقاً.</p>
        <div class="field"><label for="d-date">تنتهي إسناداته في</label>${dateInput({ name: 'date', id: 'd-date', value: T })}</div>
        <div class="alert bad" data-err hidden style="margin-top:10px"></div></form>`,
      footer: html`<button class="btn btn-danger" data-ok>${icon('ban')}تعطيل</button><button class="btn" data-x>إلغاء</button>`,
    });
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-ok]', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      try {
        await db.employees.setActive(emp.id, false, $('form', m.el).elements.date.value || T);
        toast('عُطّل الموظف.', 'ok', 2000);
        m.close(); parent.close();
        await reload(); drawTable();
      } catch (er) { const x = $('[data-err]', m.el); x.textContent = er.message; x.hidden = false; }
    });
  }

  /* ───────────── الإسناد: إضافة وتعديل، ونقل، وإنهاء ───────────── */
  function asgForm({ emp, a = null, onDone }) {
    const types = D.types.filter((t) => t.isActive || t.id === a?.typeId);
    const def = a?.typeId ?? (primaryOf(emp.id) ? types.find((t) => !t.isPrimary)?.id : primaryType()?.id) ?? types[0]?.id;
    const m = modal({
      title: a ? 'تعديل الإسناد' : `إسناد جديد: ${emp.nameAr}`,
      body: html`<form class="form-grid" novalidate>
        <div class="field"><label for="a-type">النوع <span class="req">*</span></label>
          <select class="input" id="a-type" name="typeId">${options(types.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive })), def)}</select></div>
        <div class="field"><span class="label">الرئاسة</span>
          <label class="check"><input type="checkbox" name="isHead" ${a?.isHead ? 'checked' : ''}> <span data-head-label>رئيس الوحدة</span></label></div>
        <div class="field span-2"><span class="label">الوحدة <span class="req">*</span></span><div data-unit></div></div>
        <div class="field"><label for="a-from">من تاريخ <span class="req">*</span></label>${dateInput({ name: 'startDate', id: 'a-from', value: a?.startDate || T })}</div>
        <div class="field"><label for="a-to">إلى تاريخ</label>${dateInput({ name: 'endDate', id: 'a-to', value: a?.endDate || '' })}
          <span class="hint">فارغ = قائم حتى يُنهى.</span></div>
        <div class="field span-2"><label for="a-notes">ملاحظات</label>
          <input class="input" id="a-notes" name="notes" maxlength="300" value="${a?.notes || ''}" placeholder="مثل رقم القرار"></div>
        <div class="alert bad span-2" data-err hidden></div>
      </form>`,
      footer: html`<button class="btn btn-primary" data-ok>${icon('check')}${a ? 'حفظ' : 'إضافة'}</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el), err = $('[data-err]', m.el);
    const picker = unitPicker($('[data-unit]', m.el), { model: () => D.M, value: a?.unitId, filter: (x) => x.isActive || x.id === a?.unitId });
    const syncHead = () => {
      const t = D.type.get(Number(f.elements.typeId.value));
      const box = f.elements.isHead;
      box.disabled = !!t?.impliesHead;
      if (t?.impliesHead) box.checked = true;
      $('[data-head-label]', m.el).textContent = t?.isPrimary ? 'رئيس الوحدة' : 'يقوم بأعمال رئيس الوحدة';
    };
    f.elements.typeId.onchange = syncHead;
    syncHead();
    if (!a) setTimeout(() => picker.open(), 60);
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-ok]', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      const v = formData(f);
      const fail = (t) => { err.textContent = t; err.hidden = false; };
      if (!picker.value) return fail('اختر الوحدة.');
      if (!v.startDate) return fail('تاريخ البداية مطلوب.');
      if (v.endDate && v.endDate < v.startDate) return fail('تاريخ النهاية قبل تاريخ البداية.');
      try {
        await db.employees.saveAssignment({ id: a?.id, employeeId: emp.id, unitId: picker.value, typeId: Number(v.typeId),
          isHead: f.elements.isHead.checked, startDate: v.startDate, endDate: v.endDate || null, notes: v.notes });
        m.close();
        toast(a ? 'تم الحفظ.' : 'أُضيف الإسناد.', 'ok', 2000);
        await onDone();
      } catch (er) { fail(er.message); }
    });
  }

  function transferForm({ emp, onDone }) {
    const cur = primaryOf(emp.id);
    const m = modal({
      title: cur ? `نقل: ${emp.nameAr}` : `تحديد الوحدة: ${emp.nameAr}`,
      body: html`<form class="form-grid" novalidate>
        ${cur ? html`<p class="span-2" style="margin:0">الوحدة الحالية: <b>${unitName(cur.unitId)}</b>${cur.isHead ? ` (${headLabel(cur)})` : ''}، من ${fmtDate(cur.startDate)}.
          ينتهي إسناده فيها في اليوم السابق لتاريخ النقل، ويبقى في سجله.</p>` : ''}
        <div class="field span-2"><span class="label">${cur ? 'الوحدة الجديدة' : 'الوحدة'} <span class="req">*</span></span><div data-unit></div></div>
        <div class="field"><label for="t-date">${cur ? 'تاريخ النقل' : 'من تاريخ'} <span class="req">*</span></label>${dateInput({ name: 'date', id: 't-date', value: T })}</div>
        <div class="field"><span class="label">الرئاسة</span><label class="check"><input type="checkbox" name="isHead"> رئيس الوحدة الجديدة</label></div>
        <div class="alert bad span-2" data-err hidden></div>
      </form>`,
      footer: html`<button class="btn btn-primary" data-ok>${icon(cur ? 'move' : 'check')}${cur ? 'نقل' : 'حفظ'}</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el), err = $('[data-err]', m.el);
    const picker = unitPicker($('[data-unit]', m.el), { model: () => D.M, filter: (x) => x.isActive && x.id !== cur?.unitId });
    setTimeout(() => picker.open(), 60);
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-ok]', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      const fail = (t) => { err.textContent = t; err.hidden = false; };
      if (!picker.value) return fail('اختر الوحدة.');
      const date = f.elements.date.value;
      if (!date) return fail('التاريخ مطلوب.');
      if (cur && date < cur.startDate) return fail(`تاريخ النقل قبل بداية إسناده الحالي (${fmtDate(cur.startDate)}).`);
      try {
        await db.employees.transfer({ employeeId: emp.id, unitId: picker.value, date, isHead: f.elements.isHead.checked });
        m.close();
        toast(cur ? 'نُقل الموظف.' : 'حُدّدت وحدته.', 'ok', 2000);
        await onDone();
      } catch (er) { fail(er.message); }
    });
  }

  function endForm({ a, onDone }) {
    const m = modal({
      title: 'إنهاء الإسناد', size: 'sm',
      body: html`<form novalidate><p style="margin-top:0">إنهاء إسناد «${D.type.get(a.typeId)?.name}» في «${unitName(a.unitId)}». يبقى في سجل الموظف.</p>
        <div class="field"><label for="x-date">آخر يوم فيه</label>${dateInput({ name: 'date', id: 'x-date', value: T < a.startDate ? a.startDate : T })}</div>
        <div class="alert bad" data-err hidden style="margin-top:10px"></div></form>`,
      footer: html`<button class="btn btn-primary" data-ok>${icon('check')}إنهاء</button><button class="btn" data-x>إلغاء</button>`,
    });
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-ok]', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      const date = $('form', m.el).elements.date.value;
      const err = $('[data-err]', m.el);
      if (!date || date < a.startDate) { err.textContent = `التاريخ لا يكون قبل بداية الإسناد (${fmtDate(a.startDate)}).`; err.hidden = false; return; }
      try { await db.employees.saveAssignment({ ...a, endDate: date }); m.close(); toast('انتهى الإسناد.', 'ok', 2000); await onDone(); }
      catch (er) { err.textContent = er.message; err.hidden = false; }
    });
  }

  /* ───────────── تبويب أنواع الإسناد ───────────── */
  function drawTypes() {
    const used = new Map();
    for (const a of D.asg) used.set(a.typeId, (used.get(a.typeId) || 0) + 1);
    const row = (t) => html`<form class="list-row emp-type" data-id="${t?.id || ''}" novalidate>
      <input class="input num" name="sortOrder" type="number" min="0" value="${t?.sortOrder ?? (D.types.length + 1)}" aria-label="ترتيب العرض">
      <input class="input" name="name" value="${t?.name || ''}" maxlength="60" placeholder="${t ? '' : 'نوع جديد…'}" aria-label="الاسم" required>
      <label class="check hide-sm" title="الإسناد بهذا النوع يعني القيام بأعمال رئيس الوحدة"><input type="checkbox" name="impliesHead" ${t?.impliesHead ? 'checked' : ''} ${t?.isPrimary ? 'disabled' : ''}> رئاسة</label>
      <span class="small muted hide-sm">${t ? `${(used.get(t.id) || 0).toLocaleString('en-US')} إسناد` : ''}</span>
      <label class="check hide-sm"><input type="checkbox" name="isActive" ${t?.isActive !== false ? 'checked' : ''} ${t?.isPrimary ? 'disabled' : ''}> مفعّل</label>
      <div class="row-actions">
        <button class="btn btn-sm ${t ? '' : 'btn-primary'}" type="submit">${t ? icon('check') : icon('plus')}${t ? 'حفظ' : 'إضافة'}</button>
        ${t && !t.isPrimary && !used.get(t.id) ? html`<button class="btn btn-sm btn-ghost danger" type="button" data-del-type="${t.id}" title="حذف (غير مستخدم)" aria-label="حذف">${icon('trash')}</button>` : ''}
        ${t?.isPrimary ? html`<span class="badge ok" title="مكان العمل الأساسي للموظف: واحد في أي يوم">أساسي</span>` : ''}
      </div></form>`;
    mount(body, html`
      <div class="list-row emp-type head"><span>الترتيب</span><span>النوع</span><span class="hide-sm">رئاسة</span><span class="hide-sm">الاستخدام</span><span class="hide-sm">الحالة</span><span></span></div>
      ${D.types.map(row)}${row(null)}
      <div class="card-pad small muted">«أصيل» هو مكان العمل الأساسي: للموظف إسناد أصيل واحد في أي يوم، ولا يُحذف هذا النوع ولا يُعطَّل.
        بقية الأنواع تجتمع مع الأصيل. «رئاسة» تعني أن الإسناد بهذا النوع قيام بأعمال رئيس الوحدة (مثل «قيام بالأعمال»).
        النوع المستخدم لا يُحذف؛ عطّله فيختفي من الإسناد الجديد ويبقى في القديم.</div>`);
  }

  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('form.emp-type');
    if (!f) return;
    e.preventDefault();
    const name = f.elements.name.value.trim();
    if (!name) { f.elements.name.focus(); return toastError({ message: 'اكتب اسم النوع.' }); }
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        await db.employees.saveType({ id: f.dataset.id ? Number(f.dataset.id) : null, name, sortOrder: Number(f.elements.sortOrder.value) || 0,
          impliesHead: f.elements.impliesHead.checked, isActive: f.elements.isActive.checked });
        await reload(); toast('تم الحفظ.', 'ok', 2000); drawTypes();
      } catch (er) { toastError(er); }
    });
  });

  /* ───────────── تبويب الاستيراد ───────────── */
  const FIELDS = [
    ['civilNo', 'الرقم المدني', true], ['employeeNo', 'الرقم الوظيفي', false], ['nameAr', 'الاسم بالعربي', true], ['nameEn', 'الاسم بالإنجليزي', false],
    ['reviewNotes', 'سبب المراجعة', false],   // في النسخة الاحتياطية: تبقى علامة «تحتاج مراجعة» بعد إعادة الاستيراد
  ];
  /** يتعرف على عمود من عنوانه */
  function guess(h) {
    const t = normalizeAr(h);
    if (/سبب/.test(t) && /مراجع/.test(t)) return 'reviewNotes';
    if (/مدني|civil/.test(t)) return 'civilNo';
    if (/وظيفي|employee|staff/.test(t)) return 'employeeNo';
    if (/انجليز|english|\ben\b/.test(t)) return 'nameEn';
    if (/اسم|name/.test(t)) return 'nameAr';
    return '';
  }
  const I = { file: '', rows: [], header: [], map: {}, preview: null, filter: 'all' };
  /** إسناد الموظفين إلى وحداتهم من ملف الهيكل (js/pages/assignImport.js) */
  const asgTab = assignImportTab({
    data: () => ({
      emps: D.emps, M: D.M,
      primaryAt: (empId, d) => (D.byEmp.get(empId) || []).find((a) => D.type.get(a.typeId)?.isPrimary && a.startDate <= d && (!a.endDate || a.endDate >= d)),
    }),
    reload,
  });
  const cell = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v))) : String(v ?? '').trim());

  function drawImport() {
    mount(body, html`<div class="card-pad">
      <label class="drop" id="emp-drop" tabindex="0">
        ${icon('upload')}<div><b>اسحب ملف الموظفين هنا أو اضغط للاختيار</b></div>
        <div class="small">xlsx أو csv. الأعمدة: الرقم المدني، الرقم الوظيفي، الاسم بالعربي، الاسم بالإنجليزي (تُكتشف من العناوين، ويمكن تعديلها).
          الموظف يُعرف برقمه المدني: الجديد يُضاف، والموجود تُحدَّث بياناته، والخانة الفارغة في الملف لا تمسح الموجود.
          الصف الناقص يُستورد «تحتاج مراجعة»، والصف بلا اسم (فارغ أو «0») لا يُستورد.</div>
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      </label>
      <div id="imp-step"></div></div>
      ${D.emps.length ? html`<div id="asg-imp"></div>` : ''}
      ${D.emps.length ? html`<div class="card-pad emp-danger">
        <h3>حذف كل الموظفين</h3>
        <p>يحذف <b>نهائياً</b> كل الموظفين (${D.emps.length.toLocaleString('en-US')}) وإسناداتهم وسجلها، ويفك ربطهم بحسابات النظام، لتستورد الملف من جديد.
          قبل الحذف يُنزَّل إلى جهازك ملف Excel بالموظفين الحاليين (يمكن استيراده). الهيكل وأنواع الإسناد والمستخدمون يبقون كما هم.</p>
        <button class="btn btn-danger" data-purge-emp>${icon('trash')}حذف كل الموظفين</button>
      </div>` : ''}`);
    const drop = $('#emp-drop', body), input = $('input', drop);
    input.onchange = () => input.files[0] && readFile(input.files[0]);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    if (I.rows.length) drawMapping();
    const asgEl = $('#asg-imp', body);
    if (asgEl) asgTab.draw(asgEl);
  }

  async function readFile(file) {
    try {
      let sheets;
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') sheets = [{ rows: parseCsv(await file.text()) }];
      else if (/\.xlsx$/i.test(file.name)) sheets = (await readXlsx(await file.arrayBuffer())).filter((s) => s.rows.length);
      else throw new Error('نوع الملف غير مدعوم. استخدم xlsx أو csv.');
      // أول ورقة وأول صف فيهما عنوان الرقم المدني
      let found = null;
      for (const s of sheets) {
        const hi = s.rows.slice(0, 20).findIndex((r) => r.some((c) => guess(cell(c)) === 'civilNo'));
        if (hi >= 0) { found = { s, hi }; break; }
      }
      if (!found) throw new Error('لم يُعثر على عمود «الرقم المدني» في أول 20 صفاً من أي ورقة.');
      I.file = file.name;
      I.header = found.s.rows[found.hi].map(cell);
      I.rows = found.s.rows.slice(found.hi + 1).filter((r) => r.some((c) => cell(c)));
      I.map = {};
      I.header.forEach((h, i) => { const k = guess(h); if (k && I.map[k] == null) I.map[k] = i; });
      I.filter = 'all';
      drawMapping();
    } catch (e) { toastError(e); }
  }

  /**
   * تصنيف صفوف الملف: new، update، same، review، skip
   *   review: فيه نقص أو خطأ، يُستورد «تحتاج مراجعة» والسبب مع القيمة الأصلية يُحفظ في سجل الموظف:
   *     - بلا رقم مدني (أو غير صحيح، أو مكرر باسم آخر) ← يُعطى الرقم الوظيفي رقماً مدنياً إن أمكن
   *     - بلا رقم وظيفي (أو غير صحيح، أو مسجّل لغيره) ← يُعطى الرقم المدني رقماً وظيفياً إن أمكن
   *     - بلا الاثنين ← يُستورد بدونهما
   *   skip: صف بلا اسم (فارغ، أو «0» ونحوه)، أو مكرر بالبيانات نفسها في الملف
   */
  function analyze() {
    const byCivil = new Map(D.emps.filter((e) => e.civilNo).map((e) => [e.civilNo, e]));
    const byNo = new Map(D.emps.filter((e) => e.employeeNo).map((e) => [e.employeeNo.toUpperCase(), e]));
    const noCivil = D.emps.filter((e) => !e.civilNo);
    const seen = new Map(), seenNo = new Map();
    const get = (r, k) => (I.map[k] == null ? '' : cell(r[I.map[k]]));
    const zero = (v) => (/^0*$/.test(v) ? '' : v);          // «0» و«000» = فارغ
    const hasName = (v) => /[A-Za-z؀-ۿ]/.test(v);   // اسم فيه حرف واحد على الأقل
    const civilFree = (v) => /^[0-9]{1,20}$/.test(v) && !byCivil.has(v) && !seen.has(v);
    const noFree = (v) => /^[0-9A-Z/-]{1,30}$/.test(v) && !byNo.has(v) && !seenNo.has(v);
    return I.rows.map((r, i) => {
      const raw = get(r, 'civilNo');
      const x = { line: i + 1, civilNo: zero(digits(raw)), employeeNo: zero(digits(get(r, 'employeeNo')).toUpperCase()),
        nameAr: get(r, 'nameAr').replace(/\s+/g, ' '), nameEn: get(r, 'nameEn').replace(/\s+/g, ' ') };
      const note = get(r, 'reviewNotes').trim();
      if (!hasName(x.nameAr)) x.nameAr = '';
      if (!hasName(x.nameEn)) x.nameEn = '';
      if (!x.nameAr && !x.nameEn) return { ...x, st: 'skip', why: 'صف فارغ أو بلا اسم' };

      // بلا رقم مدني ورقمه الوظيفي لموظف موجود: هو نفسه (ولو صُحّح رقمه المدني في النظام)
      const sameByNo = !x.civilNo && x.employeeNo ? byNo.get(x.employeeNo) : null;
      if (sameByNo) {
        const ch = [];
        if (x.nameAr && x.nameAr !== sameByNo.nameAr) ch.push(`الاسم: ${sameByNo.nameAr} ← ${x.nameAr}`);
        if (x.nameEn && x.nameEn !== sameByNo.nameEn) ch.push(`الاسم بالإنجليزي: ${sameByNo.nameEn || '—'} ← ${x.nameEn}`);
        return ch.length ? { ...x, st: 'update', why: `طوبق بالرقم الوظيفي · ${ch.join(' · ')}` } : { ...x, st: 'same', why: 'طوبق بالرقم الوظيفي' };
      }
      if (!x.civilNo && x.nameAr && noCivil.some((e) => e.nameAr === x.nameAr && (!x.employeeNo || !e.employeeNo || e.employeeNo.toUpperCase() === x.employeeNo))) {
        return { ...x, st: 'same', why: 'سبق استيراده للمراجعة' };
      }

      const rev = [];   // [النوع، السبب]
      // الرقم المدني
      if (!x.civilNo) rev.push(['civil', 'لا يوجد رقم مدني']);
      else if (!/^[0-9]{1,20}$/.test(x.civilNo)) { rev.push(['civil', `رقم مدني غير صحيح: «${raw}»`]); x.civilNo = ''; }
      else if (seen.has(x.civilNo)) {
        const f = seen.get(x.civilNo);
        if (f.nameAr === x.nameAr && (f.employeeNo === x.employeeNo || !x.employeeNo)) return { ...x, st: 'skip', why: `مكرر بالبيانات نفسها (صف ${f.line})` };
        rev.push(['civil', `رقم مدني مكرر: ${x.civilNo} (صف ${f.line}: ${f.nameAr})`]);
        x.civilNo = '';
      }
      const cur = x.civilNo ? byCivil.get(x.civilNo) : null;
      // الرقم الوظيفي
      if (x.employeeNo) {
        const o = byNo.get(x.employeeNo);
        if (!/^[0-9A-Z/-]{1,30}$/.test(x.employeeNo)) { rev.push(['eno', `رقم وظيفي غير صحيح: «${x.employeeNo}»`]); x.employeeNo = ''; }
        else if (o && o !== cur) { rev.push(['eno', `رقم وظيفي مسجّل لموظف آخر: ${x.employeeNo} («${o.nameAr}»)`]); x.employeeNo = ''; }
        else if (seenNo.has(x.employeeNo)) { rev.push(['eno', `رقم وظيفي مكرر: ${x.employeeNo} (صف ${seenNo.get(x.employeeNo)})`]); x.employeeNo = ''; }
      } else if (!cur?.employeeNo) rev.push(['eno', 'لا يوجد رقم وظيفي']);
      // أحدهما مكان الآخر مؤقتاً
      if (!x.civilNo && x.employeeNo && civilFree(x.employeeNo)) {
        x.civilNo = x.employeeNo;
        const c = rev.findLast((v) => v[0] === 'civil');
        c[1] += ` (وُضع الرقم الوظيفي ${x.employeeNo} مكانه مؤقتاً)`;
      } else if (x.civilNo && !x.employeeNo && !cur?.employeeNo && noFree(x.civilNo)) {
        x.employeeNo = x.civilNo;
        const c = rev.findLast((v) => v[0] === 'eno');
        c[1] += ` (وُضع الرقم المدني ${x.civilNo} مكانه مؤقتاً)`;
      }
      if (x.civilNo) seen.set(x.civilNo, x);
      if (x.employeeNo) seenNo.set(x.employeeNo, x.line);
      if (!cur && !x.nameAr) rev.push(['name', 'لا يوجد اسم بالعربي (وُضع الإنجليزي مكانه)']);
      if (note && !rev.length) rev.push(['note', note]);   // سبب مراجعة سابق من النسخة الاحتياطية

      if (rev.length) {
        const why = rev.map((v) => v[1]).join(' · ');
        // سبق استيراده للمراجعة، أو صُحّح في النظام: لا يُعلَّم من جديد
        if (cur && ((cur.reviewNotes || '').includes(why) || cur.needsReview)) return { ...x, st: 'same', why: 'سبق استيراده للمراجعة' };
        if (cur && rev.every((v) => v[0] === 'eno') && cur.employeeNo) return { ...x, st: 'same', why: 'الرقم الوظيفي في النظام يبقى' };
        return { ...x, st: 'review', why, review: why, kinds: [...new Set(rev.map((v) => v[0]))] };
      }
      if (!cur) return { ...x, st: 'new' };
      const ch = [];
      if (x.employeeNo && x.employeeNo !== cur.employeeNo.toUpperCase()) ch.push(`الرقم الوظيفي: ${cur.employeeNo || '—'} ← ${x.employeeNo}`);
      if (x.nameAr && x.nameAr !== cur.nameAr) ch.push(`الاسم: ${cur.nameAr} ← ${x.nameAr}`);
      if (x.nameEn && x.nameEn !== cur.nameEn) ch.push(`الاسم بالإنجليزي: ${cur.nameEn || '—'} ← ${x.nameEn}`);
      return ch.length ? { ...x, st: 'update', why: ch.join(' · ') } : { ...x, st: 'same' };
    });
  }

  const IMP = { new: ['جديد', 'ok'], update: ['تحديث', 'info'], same: ['بلا تغيير', ''], review: ['للمراجعة', 'warn'], skip: ['لا يُستورد', ''] };
  const KIND = { civil: 'الرقم المدني', eno: 'الرقم الوظيفي', name: 'الاسم', note: 'مراجعة سابقة' };
  function drawMapping() {
    const step = $('#imp-step', body);
    if (!step) return;
    I.preview = analyze();
    const count = (s) => I.preview.filter((r) => r.st === s).length;
    const shown = I.preview.filter((r) => I.filter === 'all' || r.st === I.filter);
    const go = count('new') + count('update') + count('review');
    const kinds = new Map();
    for (const r of I.preview) for (const k of r.kinds || []) kinds.set(k, (kinds.get(k) || 0) + 1);
    mount(step, html`
      <h3 style="margin:18px 0 8px">${I.file} — ${I.rows.length.toLocaleString('en-US')} صف</h3>
      <div class="filters" style="padding:0 0 10px">${FIELDS.map(([k, label, req]) => html`<div class="field"><label>${label}${req ? html` <span class="req">*</span>` : ''}</label>
        <select class="input" data-map="${k}">${options(I.header.map((h, i) => [i, h || `عمود ${i + 1}`]), I.map[k] ?? '', '— لا يوجد —')}</select></div>`)}</div>
      <div class="chips" style="margin-bottom:10px">
        ${[['all', 'الكل', I.preview.length], ['new', 'جديد', count('new')], ['update', 'تحديث', count('update')], ['same', 'بلا تغيير', count('same')], ['review', 'للمراجعة', count('review')], ['skip', 'لا يُستورد', count('skip')]]
          .map(([k, l, n]) => html`<button type="button" class="chip chip-btn ${I.filter === k ? 'on' : ''}" data-imp-filter="${k}">${l} (${n.toLocaleString('en-US')})</button>`)}
      </div>
      <div class="table-wrap" style="max-height:50vh"><table class="table"><thead><tr><th>صف</th><th>الرقم المدني</th><th>الرقم الوظيفي</th><th>الاسم بالعربي</th><th>الاسم بالإنجليزي</th><th>النتيجة</th></tr></thead>
        <tbody>${shown.slice(0, 300).map((r) => html`<tr><td class="num">${r.line}</td><td class="num"><span class="ltr">${r.civilNo}</span></td><td class="num"><span class="ltr">${r.employeeNo}</span></td>
          <td>${r.nameAr}</td><td dir="ltr" style="text-align:left">${r.nameEn}</td>
          <td><span class="badge ${IMP[r.st][1]}">${IMP[r.st][0]}</span>${r.why ? html`<div class="small muted">${r.why}</div>` : ''}</td></tr>`)}
        </tbody></table></div>
      ${shown.length > 300 ? html`<div class="small muted" style="padding:6px 0">تظهر أول 300 من ${shown.length.toLocaleString('en-US')}.</div>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" data-imp-go ${go ? '' : 'disabled'}>${icon('upload')}استيراد ${go.toLocaleString('en-US')} موظف (${count('new')} جديد، ${count('update')} تحديث، ${count('review')} للمراجعة)</button>
        ${count('review') ? html`<span class="small muted">الصفوف التي فيها خطأ (${count('review')}: ${[...kinds].map(([k, n]) => `${KIND[k]} ${n}`).join('، ')}) تُستورد بعلامة «تحتاج مراجعة»:
          الرقم الناقص أو الخاطئ يُعطى الرقم الآخر مؤقتاً إن أمكن، وإلا يبقى فارغاً، والسبب يُحفظ في سجل الموظف لتصحيحه لاحقاً. الصف بلا اسم لا يُستورد.</span>` : ''}
      </div>
      <div class="progress" data-imp-progress hidden style="margin-top:10px"><div></div></div>`);
  }

  on(root, 'change', '[data-map]', (e, s) => { I.map[s.dataset.map] = s.value === '' ? null : Number(s.value); drawMapping(); });
  on(root, 'click', '[data-show-review]', () => { F.status = 'review'; const s2 = $('#emp-status', body); if (s2) s2.value = 'review'; const r = $('#emp-reason-f', body); if (r) r.hidden = false; drawTable(); });
  on(root, 'click', '[data-imp-filter]', (e, b) => { I.filter = b.dataset.impFilter; drawMapping(); });
  on(root, 'click', '[data-imp-go]', (e, b) => busy(b, async () => {
    if (I.map.civilNo == null || I.map.nameAr == null) return toastError({ message: 'حدّد عمودي «الرقم المدني» و«الاسم بالعربي».' });
    const rows = I.preview.filter((r) => r.st === 'new' || r.st === 'update' || r.st === 'review');
    const bar = $('[data-imp-progress]', body); bar.hidden = false;
    try {
      const r = await db.employees.import(rows, (d, n) => { bar.firstElementChild.style.width = `${Math.round((d / n) * 100)}%`; });
      await reload();
      toast(`تم الاستيراد: ${r.created} جديد، ${r.updated} تحديث${r.review ? `، منها ${r.review} تحتاج مراجعة` : ''}${r.linked ? `، وارتبط ${r.linked} مستخدم بسجله` : ''}.`, 'ok', 7000);
      drawMapping();
    } catch (er) { toastError(er); }
  }));

  /** نسخة احتياطية بأعمدة ملف الاستيراد نفسها، ومعها الوحدة والمراجعة والحساب */
  function backupEmployees() {
    const cols = [
      { label: 'الرقم المدني', width: 14 }, { label: 'الرقم الوظيفي', width: 14 }, { label: 'الاسم بالعربي', width: 34 },
      { label: 'الاسم بالانجليزي', width: 30 }, { label: 'الوحدة (أصيل)', width: 34 }, { label: 'الحالة', width: 10 },
      { label: 'تحتاج مراجعة', width: 12 }, { label: 'سبب المراجعة', width: 40 }, { label: 'حساب النظام', width: 22 },
    ];
    const rows = D.emps.map((e) => {
      const p = primaryOf(e.id);
      return [e.civilNo, e.employeeNo, e.nameAr, e.nameEn, p ? unitName(p.unitId) : '', e.isActive ? 'نشط' : 'غير نشط',
        e.needsReview ? 'نعم' : '', e.reviewNotes, D.userOf.get(e.id)?.fullName || ''];
    });
    downloadBlob(writeXlsx([{ name: 'الموظفون', columns: cols, rows }]), `employees_backup_${today()}.xlsx`);
    return rows.length;
  }

  on(root, 'click', '[data-purge-emp]', () => {
    const WORD = 'حذف الكل';
    const m = modal({
      title: 'حذف كل الموظفين', size: 'sm',
      body: html`<form class="stack" novalidate>
        <div class="alert bad">سيُحذف ${D.emps.length.toLocaleString('en-US')} موظف وإسناداتهم وسجلها <b>نهائياً</b>، ويُفك ربطهم بحسابات النظام.
          سيُنزَّل أولاً ملف Excel بالموظفين الحاليين، احتفظ به.</div>
        <div class="field"><label for="emp-purge-confirm">للتأكيد اكتب «${WORD}»</label>
          <input class="input" id="emp-purge-confirm" name="confirm" autocomplete="off"></div>
        <div class="alert bad" data-err hidden></div></form>`,
      footer: html`<button class="btn btn-danger" data-ok>${icon('trash')}حذف نهائي</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el), errBox = $('[data-err]', m.el);
    $('[data-x]', m.el).onclick = () => m.close();
    const go = () => busy($('[data-ok]', m.el), async () => {
      errBox.hidden = true;
      if (f.elements.confirm.value.trim() !== WORD) { errBox.textContent = `اكتب «${WORD}» للتأكيد.`; errBox.hidden = false; return; }
      try {
        const saved = backupEmployees();
        const r = await db.employees.purge();
        m.close();
        I.rows = []; I.preview = null;
        await reload();
        draw();
        toast(`حُذف ${r.employees.toLocaleString('en-US')} موظف و${r.assignments.toLocaleString('en-US')} إسناد${r.users ? `، وفُك ربط ${r.users} مستخدم` : ''}. النسخة الاحتياطية (${saved} موظف) نُزّلت إلى جهازك.`, 'ok', 8000);
      } catch (ex) { errBox.textContent = ex.message; errBox.hidden = false; }
    });
    $('[data-ok]', m.el).onclick = go;
    f.onsubmit = (ev) => { ev.preventDefault(); go(); };
  });

  /* ───────────── الأحداث ───────────── */
  function draw() {
    root.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    if (tab === 'list') drawList();
    else if (tab === 'types') drawTypes();
    else drawImport();
  }
  on(root, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; history.replaceState(null, '', `#/employees?tab=${tab}`); draw(); });
  on(root, 'click', '[data-act]', (e, b) => {
    if (!D.M) return;
    if (b.dataset.act === 'new') empForm(null);
    else if (b.dataset.act === 'link') busy(b, async () => {
      try { const n = await db.employees.linkUsers(); await reload(); if (tab === 'list') drawTable(); toast(n ? `ارتبط ${n} مستخدم بسجله الوظيفي.` : 'لا يوجد مستخدم جديد يطابق رقمه موظفاً.', n ? 'ok' : 'info', 4000); }
      catch (er) { toastError(er); }
    });
  });
  on(root, 'click', '[data-del-type]', async (e, b) => {
    const t = D.type.get(Number(b.dataset.delType));
    if (!(await confirmBox({ title: 'حذف النوع', message: `حذف نوع الإسناد «${t.name}»؟`, okText: 'حذف', danger: true }))) return;
    try { await db.employees.deleteType(t.id); await reload(); toast('حُذف النوع.', 'ok', 2000); drawTypes(); } catch (er) { toastError(er); }
  });
  const onSearch = debounce(() => drawTable(), 150);
  root.addEventListener('input', (e) => { if (e.target.id === 'emp-q') { F.q = e.target.value; onSearch(); } });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'emp-unit') { F.unit = e.target.value; drawTable(); }
    else if (e.target.id === 'emp-sub') { F.sub = e.target.checked; drawTable(); }
    else if (e.target.id === 'emp-status') { F.status = e.target.value; const r = $('#emp-reason-f', body); if (r) r.hidden = F.status !== 'review'; drawTable(); }
    else if (e.target.id === 'emp-reason') { F.reason = e.target.value; drawTable(); }
  });

  try {
    await reload();
    draw();
  } catch (e) {
    mount(body, html`<div class="card-pad"><div class="alert bad">${e.message}</div></div>`);
  }
}
