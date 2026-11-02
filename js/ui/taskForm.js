/**
 * نافذة إضافة/تعديل/عرض مهمة.
 * التحقق هنا للراحة فقط؛ قاعدة البيانات تفرض نفس القواعد بشكل مستقل.
 */
import { db } from '../data/index.js';
import { html, $, formData } from '../core/dom.js';
import { state, can, canEditTask, isLocked, engineers, activeItems, userName, refreshReviewCount } from '../core/store.js';
import { today, daysBetween, fmtDateTime, daysAr } from '../core/format.js';
import { LABEL } from '../core/fields.js';
import { navigate } from '../core/router.js';
import { modal, busy, toast, confirmBox, toastError } from './feedback.js';
import { options } from './parts.js';
import { icon } from './icons.js';
import { dateInput } from './dateField.js';

const kindOf = (statusId) => state.lookups.statuses.find((s) => s.id === Number(statusId))?.kind;

/**
 * task: مهمة موجودة أو null لمهمة جديدة
 * requesters: قائمة الجهات السابقة للاقتراح
 * onSaved(task, action) action: 'create'|'update'|'delete'|'restore'
 */
export function openTaskForm({ task = null, requesters = [], onSaved }) {
  const isNew = !task;
  const editable = isNew ? can('tasks.create') : canEditTask(task);
  const locked = !isNew && isLocked(task);
  const t = task || {
    engineerId: state.user.id,
    receivedDate: today(),
    statusId: state.lookups.statuses.find((s) => s.isActive && s.kind === 'open')?.id || '',
  };
  const dis = editable ? '' : 'disabled';
  const delayDays = state.settings?.delayThresholdDays || 7;

  const title = isNew ? 'مهمة جديدة' : editable ? `تعديل المهمة #${t.id}` : `المهمة #${t.id}`;
  const body = html`
    ${locked ? html`<div class="alert warn" style="margin-bottom:14px">${icon('lock')} هذه المهمة مقفلة: مضى على إنجازها أكثر من ${daysAr(state.settings.editLockDays)}. اطلب من مدير النظام أو رئيس القسم تعديلها.</div>` : ''}
    ${t.deletedAt ? html`<div class="alert bad" style="margin-bottom:14px">هذه المهمة محذوفة (${fmtDateTime(t.deletedAt)}).</div>` : ''}
    ${!isNew && t.reviewReasons?.length ? html`<div class="alert warn" style="margin-bottom:14px" id="t-review">
      <b>تحتاج مراجعة</b> (من الاستيراد):
      <ul style="margin:6px 0 0;padding-inline-start:20px">${t.reviewReasons.map((x) => html`<li>${x}</li>`)}</ul>
      ${editable ? html`<label class="check" style="margin-top:8px"><input type="checkbox" id="t-reviewed"> <b>تمت المراجعة</b>: أصلحت ما يلزم، وتُزال العلامة عند الحفظ</label>
        <div class="small muted">يمكنك الحفظ دون هذا الاختيار لإصلاح جزء، وتبقى المهمة في «تحتاج مراجعة».</div>` : ''}
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
      <div class="field"><label for="t-ref">${LABEL.refNo}</label>
        <input class="input" id="t-ref" name="refNo" value="${t.refNo || ''}" maxlength="100" ${dis}></div>
      <div class="field"><label for="t-corr">${LABEL.correspondenceTypeId}</label>
        <select class="input" id="t-corr" name="correspondenceTypeId" ${dis}>${options(activeItems('correspondenceTypes', t.correspondenceTypeId), t.correspondenceTypeId, '—')}</select></div>
      <div class="field"><label for="t-req">${LABEL.requester}</label>
        <input class="input" id="t-req" name="requester" value="${t.requester || ''}" list="dl-req" maxlength="300" autocomplete="off" ${dis}>
        <datalist id="dl-req">${requesters.slice(0, 300).map((r) => html`<option value="${r}">`)}</datalist></div>
      <div class="field"><label for="t-emp">${LABEL.employeeName}</label>
        <input class="input" id="t-emp" name="employeeName" value="${t.employeeName || ''}" maxlength="300" ${dis}></div>
      <div class="field"><label for="t-type">${LABEL.taskTypeId}</label>
        <select class="input" id="t-type" name="taskTypeId" ${dis}>${options(activeItems('taskTypes', t.taskTypeId), t.taskTypeId, '—')}</select></div>
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
        أُدخلت ${fmtDateTime(t.createdAt)} بواسطة ${userName(t.createdBy)}${t.updatedAt && t.updatedAt !== t.createdAt ? html` · آخر تعديل ${fmtDateTime(t.updatedAt)} بواسطة ${userName(t.updatedBy)}` : ''}</div>` : ''}
    </form>`;

  const footer = html`
    ${editable ? html`<button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'إضافة' : 'حفظ'}</button>` : ''}
    <button class="btn" data-cancel>${editable ? 'إلغاء' : 'إغلاق'}</button>
    <span class="spacer"></span>
    ${!isNew && can('audit.view') ? html`<button class="btn btn-ghost" data-history>${icon('history')}السجل</button>` : ''}
    ${!isNew && can('tasks.delete') && !t.deletedAt ? html`<button class="btn btn-danger" data-delete>${icon('trash')}حذف</button>` : ''}
    ${!isNew && can('tasks.delete') && t.deletedAt ? html`<button class="btn" data-restore>${icon('restore')}استعادة</button>` : ''}`;

  const m = modal({ title, body, footer });
  const form = $('#task-form', m.el);
  const errBox = $('#t-err', m.el);
  const f = (n) => form.elements[n];

  // المهمة المستوردة تُعرض كما في الملف: لا نمسح تاريخ انتهائها عند الفتح حتى لو كانت حالتها مفتوحة
  let keepAsIs = !isNew && !!t.reviewReasons?.length;
  function sync() {
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
    if (e.target.name === 'statusId') keepAsIs = false;
    if (e.target.name === 'statusId' && kindOf(e.target.value) === 'done' && !f('completedDate').value) f('completedDate').value = today();
    sync();
  });
  form.addEventListener('input', sync);
  sync();

  function validate(v) {
    if (can('tasks.assign') && !v.engineerId) return ['engineerId', 'اختر المهندس.'];
    if (!v.subject.trim()) return ['subject', 'اكتب الموضوع.'];
    if (!v.statusId) return ['statusId', 'اختر الحالة.'];
    if (!v.receivedDate) return ['receivedDate', 'اكتب تاريخ الاستقبال.'];
    const kind = kindOf(v.statusId);
    if (kind === 'done' && !v.completedDate) return ['completedDate', 'المهمة المكتملة تحتاج تاريخ الانتهاء.'];
    if (v.completedDate && v.completedDate < v.receivedDate) return ['completedDate', 'تاريخ الانتهاء قبل تاريخ الاستقبال.'];
    if (v.receivedDate > today()) return ['receivedDate', 'تاريخ الاستقبال في المستقبل.'];
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
      f(bad[0])?.closest('.field')?.classList.add('invalid');
      f(bad[0])?.focus();
      return;
    }
    errBox.hidden = true;
    const input = {
      engineerId: can('tasks.assign') ? v.engineerId : undefined,
      refNo: v.refNo, requester: v.requester, employeeName: v.employeeName, subject: v.subject,
      receivedDate: v.receivedDate || null, completedDate: v.completedDate || null, notes: v.notes,
      taskTypeId: v.taskTypeId ? Number(v.taskTypeId) : null, correspondenceTypeId: v.correspondenceTypeId ? Number(v.correspondenceTypeId) : null,
      statusId: Number(v.statusId), delayReason: v.delayReason,
    };
    if ($('#t-reviewed', m.el)?.checked) input.reviewReasons = [];
    await busy(btn, async () => {
      try {
        const saved = isNew ? await db.tasks.create(input) : await db.tasks.update(t.id, input);
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
  $('[data-delete]', m.el)?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'حذف المهمة', message: `حذف المهمة #${t.id} «${t.subject}»؟ يمكن استعادتها لاحقاً من فلتر «المحذوفة».`, okText: 'حذف', danger: true }))) return;
    try { await db.tasks.remove(t.id); toast('حُذفت المهمة.', 'ok'); m.close(); onSaved?.({ ...t, deletedAt: new Date().toISOString() }, 'delete'); } catch (e) { toastError(e); }
  });
  $('[data-restore]', m.el)?.addEventListener('click', async () => {
    try { await db.tasks.restore(t.id); toast('استُعيدت المهمة.', 'ok'); m.close(); onSaved?.({ ...t, deletedAt: null }, 'restore'); } catch (e) { toastError(e); }
  });
  return m;
}
