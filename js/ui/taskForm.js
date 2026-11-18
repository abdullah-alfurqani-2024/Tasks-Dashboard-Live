/**
 * نافذة إضافة/تعديل/عرض مهمة.
 * التحقق هنا للراحة فقط؛ قاعدة البيانات تفرض نفس القواعد بشكل مستقل.
 */
import { db } from '../data/index.js';
import { html, $, formData } from '../core/dom.js';
import { state, can, canEditTask, isLocked, engineers, activeItems, userName, refreshReviewCount } from '../core/store.js';
import { today, daysBetween, fmtDateTime, daysAr, normalizeAr } from '../core/format.js';
import { LABEL, PRIORITY_LABELS } from '../core/fields.js';
import { navigate } from '../core/router.js';
import { modal, busy, toast, confirmBox, toastError } from './feedback.js';
import { options } from './parts.js';
import { icon } from './icons.js';
import { dateInput } from './dateField.js';
import { lookupField } from './lookupField.js';
import { directory, recent, pushRecent } from '../core/directory.js';

/** أسباب «تحتاج مراجعة» من الربط: نص حر لم يُربط بالهيكل أو بقائمة الموظفين */
export const linkReasons = (t) => [
  t.requester && !t.requesterUnitId ? `الجهة الطالبة «${t.requester}» ليست من الهيكل التنظيمي` : '',
  t.employeeName && !t.employeeId ? `الموظف «${t.employeeName}» غير مسجّل في قائمة الموظفين` : '',
].filter(Boolean);
const kindOf = (statusId) => state.lookups.statuses.find((s) => s.id === Number(statusId))?.kind;
// «نوع المراسلة» يخص نوع المهمة «مراسلة» فقط (يُعرف بالاسم في قائمة أنواع المهام)
const isCorrType = (taskTypeId) => normalizeAr(state.lookups.taskTypes.find((x) => x.id === Number(taskTypeId))?.name || '').startsWith(normalizeAr('مراسل'));

/**
 * task: مهمة موجودة أو null لمهمة جديدة
 * copyOf: مهمة تُنسخ منها مهمة جديدة (تُفتح معبّأة، ولا يُحفظ شيء قبل «إضافة»)
 * requesters: قائمة الجهات السابقة للاقتراح
 * onSaved(task, action) action: 'create'|'update'|'delete'|'restore'
 */
export function openTaskForm({ task = null, copyOf = null, requesters = [], onSaved }) {
  if (copyOf) task = null;
  const isNew = !task;
  const editable = isNew ? can('tasks.create') : canEditTask(task);
  const locked = !isNew && isLocked(task);
  const fresh = {
    engineerId: state.user.id,
    receivedDate: today(),
    statusId: state.lookups.statuses.find((s) => s.isActive && s.kind === 'open')?.id || '',
  };
  // النسخ: الجهة والموظف والموضوع والنوعان والأولوية والملاحظات.
  // ورقم القيد والتواريخ والحالة وسبب التأخير والمراجعة تبدأ من جديد
  const t = task || (copyOf ? {
    ...fresh,
    engineerId: can('tasks.assign') ? copyOf.engineerId : state.user.id,
    requester: copyOf.requester, employeeName: copyOf.employeeName, subject: copyOf.subject,
    requesterUnitId: copyOf.requesterUnitId, employeeId: copyOf.employeeId,
    taskTypeId: copyOf.taskTypeId, correspondenceTypeId: copyOf.correspondenceTypeId,
    priority: copyOf.priority, notes: copyOf.notes,
  } : fresh);
  const dis = editable ? '' : 'disabled';
  const delayDays = state.settings?.delayThresholdDays || 7;

  const ref = (x) => x.taskCode || `#${x.id}`;   // رمز المهمة، أو رقمها إن لم يكن لها رمز
  const title = copyOf ? `مهمة جديدة (نسخة من ${ref(copyOf)})` : isNew ? 'مهمة جديدة' : editable ? `تعديل المهمة ${ref(t)}` : `المهمة ${ref(t)}`;
  const body = html`
    ${locked ? html`<div class="alert warn" style="margin-bottom:14px">${icon('lock')} هذه المهمة مقفلة: مضى على إنجازها أكثر من ${daysAr(state.settings.editLockDays)}. اطلب من مدير النظام أو رئيس القسم تعديلها.</div>` : ''}
    ${t.deletedAt ? html`<div class="alert bad" style="margin-bottom:14px">هذه المهمة محذوفة (${fmtDateTime(t.deletedAt)}).</div>` : ''}
    ${!isNew && t.reviewReasons?.length ? html`<div class="alert warn" style="margin-bottom:14px" id="t-review">
      <b>تحتاج مراجعة</b> (من الاستيراد):
      <ul style="margin:6px 0 0;padding-inline-start:20px">${t.reviewReasons.map((x) => html`<li>${x}</li>`)}</ul>
      ${editable ? html`<label class="check" style="margin-top:8px"><input type="checkbox" id="t-reviewed"> <b>تمت المراجعة</b>: أصلحت ما يلزم، وتُزال العلامة عند الحفظ</label>
        <div class="small muted">يمكنك الحفظ دون هذا الاختيار لإصلاح جزء، وتبقى المهمة في «تحتاج مراجعة».</div>` : ''}
    </div>` : ''}
    ${!isNew && t.needsLink ? html`<div class="alert warn" style="margin-bottom:14px" id="t-link">
      <b>تحتاج مراجعة</b>:
      <ul style="margin:6px 0 0;padding-inline-start:20px">${linkReasons(t).map((x) => html`<li>${x}</li>`)}</ul>
      ${editable ? html`<div class="small" style="margin-top:6px">اخترها من القائمة في الحقل لتُربط، وتُزال العلامة عند الحفظ. إن لم تكن في القائمة فمدير النظام يضيفها.</div>` : ''}
    </div>` : ''}
    <form class="form-grid" novalidate id="task-form">
      ${can('tasks.assign') ? html`
        <div class="field span-2"><label for="t-eng">${LABEL.engineerId} <span class="req">*</span></label>
          <select class="input" id="t-eng" name="engineerId" ${dis} required>${options(
            engineers({ includeInactive: true }).filter((e) => e.isActive || e.id === t.engineerId).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })),
            t.engineerId, '— اختر —')}</select></div>`
        : !isNew && t.engineerId !== state.user.id ? html`<div class="field span-2"><span class="label">${LABEL.engineerId}</span><div>${t.engineerName}</div></div>` : ''}
      <div class="field span-2"><label for="t-subject">${LABEL.subject} <span class="req">*</span></label>
        <textarea class="input" id="t-subject" name="subject" rows="2" maxlength="2000" required ${dis}>${t.subject || ''}</textarea></div>
      <div class="field" data-f="requester"><label for="t-req">${LABEL.requester}</label><div data-req></div></div>
      <div class="field" data-f="employeeName"><label for="t-emp">${LABEL.employeeName}</label><div data-emp></div></div>
      ${editable ? html`<div class="span-2 small muted" data-link-hint style="margin-top:-6px">الجهة الطالبة أو اسم الموظف، أحدهما على الأقل. اختيار الموظف يملأ الجهة من وحدته في تاريخ الاستقبال.</div>` : ''}
      <div class="field"><label for="t-ref">${LABEL.refNo}</label>
        <input class="input" id="t-ref" name="refNo" value="${t.refNo || ''}" maxlength="100" ${dis}></div>
      <div class="field"><label for="t-prio">${LABEL.priority}</label>
        <select class="input" id="t-prio" name="priority" ${dis}>${options(Object.entries(PRIORITY_LABELS), t.priority || 'normal')}</select></div>
      <div class="field"><label for="t-type">${LABEL.taskTypeId}</label>
        <select class="input" id="t-type" name="taskTypeId" ${dis}>${options(activeItems('taskTypes', t.taskTypeId), t.taskTypeId, '—')}</select></div>
      <div class="field" data-corr><label for="t-corr">${LABEL.correspondenceTypeId} <span class="req">*</span></label>
        <select class="input" id="t-corr" name="correspondenceTypeId" ${dis}>${options(activeItems('correspondenceTypes', t.correspondenceTypeId), t.correspondenceTypeId, '— اختر —')}</select>
        <span class="hint" data-corr-hint hidden>نوع المهمة ليس «مراسلة»: هذه القيمة من الاستيراد وتبقى حتى «تمت المراجعة».</span></div>
      <div class="field"><label for="t-status">${LABEL.statusId} <span class="req">*</span></label>
        <select class="input" id="t-status" name="statusId" required ${dis}>${options(activeItems('statuses', t.statusId), t.statusId, '— اختر —')}</select></div>
      <div class="field"><label for="t-rec">${LABEL.receivedDate} <span class="req">*</span></label>
        ${dateInput({ name: 'receivedDate', id: 't-rec', value: t.receivedDate, required: true, disabled: !editable })}</div>
      <div class="field"><label for="t-done">${LABEL.completedDate} <span class="req" data-done-req hidden>*</span></label>
        ${dateInput({ name: 'completedDate', id: 't-done', value: t.completedDate, disabled: !editable })}</div>
      <div class="field"><span class="label">${LABEL.durationDays}</span>
        <div class="input" id="t-dur" readonly aria-live="polite" style="display:flex;align-items:center">—</div></div>
      <div class="field" data-delay><label for="t-delay">${LABEL.delayReason}</label>
        <input class="input" id="t-delay" name="delayReason" value="${t.delayReason || ''}" maxlength="1000" ${dis}>
        <span class="hint">وضّحه إذا تجاوزت المدة ${daysAr(delayDays)}.</span></div>
      <div class="field span-2"><label for="t-notes">${LABEL.notes}</label>
        <textarea class="input" id="t-notes" name="notes" rows="2" maxlength="4000" ${dis}>${t.notes || ''}</textarea></div>
      <div class="alert bad span-2" id="t-err" role="alert" hidden></div>
      ${!isNew ? html`<div class="span-2 small muted">
        ${t.taskCode ? html`${LABEL.taskCode} <b class="num">${t.taskCode}</b> · ` : ''}أُدخلت ${fmtDateTime(t.enteredAt || t.createdAt)} بواسطة ${userName(t.createdBy)}${t.importedAt ? html` · من Google Sheets (آخر استيراد ${fmtDateTime(t.importedAt)})` : ''}${t.updatedAt && t.updatedAt !== t.createdAt && t.updatedAt !== t.importedAt ? html` · آخر تعديل ${fmtDateTime(t.updatedAt)} بواسطة ${userName(t.updatedBy)}` : ''}</div>` : ''}
    </form>`;

  const footer = html`
    ${editable ? html`<button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'إضافة' : 'حفظ'}</button>` : ''}
    <button class="btn" data-cancel>${editable ? 'إلغاء' : 'إغلاق'}</button>
    <span class="spacer"></span>
    ${!isNew && can('audit.view') ? html`<button class="btn btn-ghost" data-history>${icon('history')}السجل</button>` : ''}
    ${!isNew && can('tasks.create') && !t.deletedAt ? html`<button class="btn btn-ghost" data-copy title="مهمة جديدة بنفس البيانات">${icon('copy')}نسخ كمهمة جديدة</button>` : ''}
    ${!isNew && can('tasks.delete') && !t.deletedAt ? html`<button class="btn btn-danger" data-delete>${icon('trash')}حذف</button>` : ''}
    ${!isNew && can('tasks.delete') && t.deletedAt ? html`<button class="btn" data-restore>${icon('restore')}استعادة</button>` : ''}`;

  const m = modal({ title, body, footer });
  const form = $('#task-form', m.el);
  const errBox = $('#t-err', m.el);
  const f = (n) => form.elements[n];

  /* ───── الجهة الطالبة واسم الموظف: من الهيكل وقائمة الموظفين ───── */
  let D = null;           // الدليل بعد تحميله
  let autoUnit = false;   // الجهة مملوءة تلقائياً من وحدة الموظف (تتبع تغيير الموظف أو التاريخ)
  const free = state.settings?.allowUnlisted !== false;
  const uid = state.user.id;
  /** مسار قصير: أقرب وحدتين أعلى */
  const shortPath = (u) => D.M.ancestors(u).slice(-2).map((a) => a.name).join(' ← ');
  const unitItem = (u) => ({ id: u.id, label: u.name, badge: D.M.level.get(u.levelId)?.name || '', sub: shortPath(u) || 'وحدة رئيسية' });
  const unitDesc = (id) => { const u = D.M.unit.get(id); if (!u) return null; const lv = D.M.level.get(u.levelId)?.name || ''; return { sub: [lv, shortPath(u)].filter(Boolean).join(' · ') }; };
  const empUnitName = (e) => D.unitAt(e.id, f('receivedDate').value || today())?.name || '';
  const empItem = (e) => ({ id: e.id, label: e.nameAr, sub: [e.employeeNo, empUnitName(e)].filter(Boolean).join(' · ') });
  const req = lookupField($('[data-req]', m.el), {
    id: 't-req', value: { id: t.requesterUnitId, text: t.requester }, disabled: !editable, free,
    placeholder: 'اكتب للبحث في الهيكل…', freeNote: 'ليست في الهيكل: تُحفظ نصاً، والمهمة «تحتاج مراجعة»',
    search: (q) => (D ? D.searchUnits(q).map(unitItem) : []),
    recent: () => (D ? recent('unit', uid).map((id) => D.M.unit.get(id)).filter((u) => u?.isActive).map(unitItem) : []),
    describe: (id) => (D ? unitDesc(id) : { sub: 'من الهيكل' }),
    onChange: () => { autoUnit = false; syncLinkHint(); },
  });
  const emp = lookupField($('[data-emp]', m.el), {
    id: 't-emp', value: { id: t.employeeId, text: t.employeeName }, disabled: !editable, free,
    placeholder: 'اكتب الاسم أو الرقم الوظيفي…', freeNote: 'غير مسجّل في قائمة الموظفين: يُحفظ نصاً، والمهمة «تحتاج مراجعة»',
    search: (q) => (D ? D.searchEmployees(q).map(empItem) : []),
    recent: () => (D ? recent('emp', uid).map((id) => D.emp.get(id)).filter((e) => e?.isActive).map(empItem) : []),
    describe: (id) => (D ? (D.emp.get(id) ? { sub: [D.emp.get(id).employeeNo, empUnitName(D.emp.get(id))].filter(Boolean).join(' · ') || 'مسجّل' } : null) : { sub: 'مسجّل' }),
    onChange: (v, picked) => { if (picked) fillUnitFromEmployee(); syncLinkHint(); },
  });
  /** اختيار الموظف: الجهة من وحدته في تاريخ الاستقبال، إن كانت فارغة أو مملوءة تلقائياً من قبل */
  function fillUnitFromEmployee() {
    const e = emp.value;
    if (!D || !e.id || (req.value.text && !autoUnit)) return;
    const u = D.unitAt(e.id, f('receivedDate').value || today());
    if (!u) { if (autoUnit) req.set({ id: null, text: '' }); autoUnit = false; return; }
    req.set({ id: u.id, text: u.name });
    autoUnit = true;
  }
  function syncLinkHint() { form.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('invalid')); }
  if (editable) {
    directory().then((d) => { D = d; req.set(req.value.id && !d.M.unit.get(req.value.id) ? { id: null, text: req.value.text } : req.value); emp.set(emp.value); })
      .catch((e) => { const h = $('[data-link-hint]', m.el); if (h) { h.textContent = `تعذّر تحميل الهيكل وقائمة الموظفين (${e.message}) — يُكتب الحقلان نصاً.`; h.style.color = 'var(--warn)'; } });
  } else directory().then((d) => { D = d; req.set(req.value); emp.set(emp.value); }).catch(() => {});

  // المهمة المستوردة تُعرض كما في الملف: لا نمسح تاريخ انتهائها عند الفتح حتى لو كانت حالتها مفتوحة
  let keepAsIs = !isNew && !!t.reviewReasons?.length;
  // نوع المراسلة يظهر مع «مراسلة» فقط. المهمة المستوردة التي تنتظر المراجعة تُعرض قيمتها كما في الملف
  const flagged = () => !isNew && !!t.reviewReasons?.length && !$('#t-reviewed', m.el)?.checked;
  function syncCorr() {
    const corr = isCorrType(f('taskTypeId').value);
    const legacy = !corr && !!f('correspondenceTypeId').value && flagged();
    $('[data-corr]', m.el).hidden = !corr && !legacy;
    $('[data-corr] .req', m.el).hidden = !corr;
    $('[data-corr-hint]', m.el).hidden = !legacy;
  }
  function sync() {
    syncCorr();
    const kind = kindOf(f('statusId').value);
    const done = f('completedDate');
    $('[data-done-req]', m.el).hidden = kind !== 'done';
    if (editable && !keepAsIs) {
      done.disabled = kind === 'open';
      if (kind === 'open') done.value = '';
    }
    const dur = done.value && f('receivedDate').value ? daysBetween(f('receivedDate').value, done.value) : null;
    const box = $('#t-dur', m.el);
    box.textContent = dur == null ? '—' : dur < 0 ? 'تاريخ غير صحيح' : dur === 0 ? 'نفس اليوم' : daysAr(dur);
    box.style.color = dur != null && (dur < 0 || dur > delayDays) ? 'var(--bad)' : '';
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'receivedDate' && autoUnit) fillUnitFromEmployee();
    if (e.target.name === 'statusId') keepAsIs = false;
    if (e.target.name === 'statusId' && kindOf(e.target.value) === 'done' && !f('completedDate').value) f('completedDate').value = today();
    sync();
  });
  form.addEventListener('input', sync);
  $('#t-reviewed', m.el)?.addEventListener('change', syncCorr);
  sync();

  function validate(v) {
    if (can('tasks.assign') && !v.engineerId) return ['engineerId', 'اختر المهندس.'];
    if (!v.subject.trim()) return ['subject', 'اكتب الموضوع.'];
    if (!v.statusId) return ['statusId', 'اختر الحالة.'];
    if (!v.receivedDate) return ['receivedDate', 'اكتب تاريخ الاستقبال.'];
    if (isCorrType(v.taskTypeId) && !v.correspondenceTypeId) return ['correspondenceTypeId', 'اختر نوع المراسلة.'];
    const kind = kindOf(v.statusId);
    if (kind === 'done' && !v.completedDate) return ['completedDate', 'المهمة المكتملة تحتاج تاريخ الانتهاء.'];
    if (v.completedDate && v.completedDate < v.receivedDate) return ['completedDate', 'تاريخ الانتهاء قبل تاريخ الاستقبال.'];
    if (v.receivedDate > today()) return ['receivedDate', 'تاريخ الاستقبال في المستقبل.'];
    const r = req.value, e = emp.value;
    if (!r.text && !e.text && (isNew || t.requester || t.employeeName)) return ['requester', 'حدّد الجهة الطالبة أو اسم الموظف (أحدهما على الأقل).'];
    if (!free && D && r.text && !r.id && r.text !== (t.requester || '')) return ['requester', 'اختر الجهة الطالبة من الهيكل التنظيمي.'];
    if (!free && D && e.text && !e.id && e.text !== (t.employeeName || '')) return ['employeeName', 'اختر اسم الموظف من قائمة الموظفين.'];
    return null;
  }

  async function save(btn) {
    const v = formData(form);
    if (v.completedDate === undefined) v.completedDate = null;
    form.querySelectorAll('.field.invalid').forEach((x) => x.classList.remove('invalid'));
    // مهمة مستوردة ما زالت تنتظر المراجعة: يمكن حفظ إصلاح جزئي، والقواعد كاملة عند «تمت المراجعة»
    const stillFlagged = !isNew && t.reviewReasons?.length && !$('#t-reviewed', m.el)?.checked;
    const bad = stillFlagged ? (can('tasks.assign') && !v.engineerId ? ['engineerId', 'اختر المهندس.'] : !v.statusId ? ['statusId', 'اختر الحالة.'] : null) : validate(v);
    if (bad) {
      errBox.textContent = bad[1]; errBox.hidden = false;
      const lk = { requester: req, employeeName: emp }[bad[0]];
      (lk ? lk.input : f(bad[0]))?.closest('.field')?.classList.add('invalid');
      (lk ? lk.input : f(bad[0]))?.focus();
      return;
    }
    errBox.hidden = true;
    const input = {
      engineerId: can('tasks.assign') ? v.engineerId : undefined,
      refNo: v.refNo, subject: v.subject,
      requester: req.value.text, employeeName: emp.value.text,
      // قبل تحميل الدليل لا يُرسل الربط (يبقى كما هو)
      ...(D ? { requesterUnitId: req.value.id || null, employeeId: emp.value.id || null } : {}),
      receivedDate: v.receivedDate || null, completedDate: v.completedDate || null, notes: v.notes,
      taskTypeId: v.taskTypeId ? Number(v.taskTypeId) : null,
      // غير «مراسلة»: تُمسح عند الحفظ، إلا في مهمة مستوردة تنتظر المراجعة فتبقى كما في الملف
      correspondenceTypeId: v.correspondenceTypeId && (isCorrType(v.taskTypeId) || stillFlagged) ? Number(v.correspondenceTypeId) : null,
      statusId: Number(v.statusId), delayReason: v.delayReason, priority: v.priority === 'urgent' ? 'urgent' : 'normal',
    };
    if ($('#t-reviewed', m.el)?.checked) input.reviewReasons = [];
    await busy(btn, async () => {
      try {
        const saved = isNew ? await db.tasks.create(input) : await db.tasks.update(t.id, input);
        pushRecent('unit', uid, input.requesterUnitId); pushRecent('emp', uid, input.employeeId);
        if (t.needsLink && !saved?.needsLink) refreshReviewCount();
        toast(isNew ? `أُضيفت المهمة #${saved.id}.` : input.reviewReasons ? 'تم الحفظ وأُزيلت علامة المراجعة.' : 'تم حفظ التعديلات.', 'ok');
        if (input.reviewReasons) refreshReviewCount();
        m.close();
        onSaved?.(saved, isNew ? 'create' : 'update');
      } catch (e) {
        errBox.textContent = e.message; errBox.hidden = false;
      }
    });
  }

  $('[data-save]', m.el)?.addEventListener('click', (e) => save(e.currentTarget));
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && editable) save($('[data-save]', m.el)); });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (editable) save($('[data-save]', m.el)); });
  $('[data-cancel]', m.el).onclick = () => m.close();
  $('[data-history]', m.el)?.addEventListener('click', () => { m.close(); navigate(`/audit?task=${t.id}`); });
  $('[data-copy]', m.el)?.addEventListener('click', () => { m.close(); openTaskForm({ copyOf: t, requesters, onSaved }); });
  $('[data-delete]', m.el)?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'حذف المهمة', message: `حذف المهمة #${t.id} «${t.subject}»؟ يمكن استعادتها لاحقاً من فلتر «المحذوفة».`, okText: 'حذف', danger: true }))) return;
    try { await db.tasks.remove(t.id); refreshReviewCount(); toast('حُذفت المهمة.', 'ok'); m.close(); onSaved?.({ ...t, deletedAt: new Date().toISOString() }, 'delete'); } catch (e) { toastError(e); }
  });
  $('[data-restore]', m.el)?.addEventListener('click', async () => {
    try { await db.tasks.restore(t.id); refreshReviewCount(); toast('استُعيدت المهمة.', 'ok'); m.close(); onSaved?.({ ...t, deletedAt: null }, 'restore'); } catch (e) { toastError(e); }
  });
  return m;
}
