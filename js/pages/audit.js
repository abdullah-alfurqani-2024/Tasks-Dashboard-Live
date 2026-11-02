/** سجل التعديلات: من غيّر ماذا ومتى */
import { db } from '../data/index.js';
import { html, mount, $, formData } from '../core/dom.js';
import { state, userName } from '../core/store.js';
import { fmtDate, fmtDateTime, today, addDays } from '../core/format.js';
import { LABEL_BY_COL } from '../core/fields.js';
import { setTitle } from '../core/session.js';
import { dateInput } from '../ui/dateField.js';
import { dataTable } from '../ui/table.js';
import { pageHead, options, loading, newPage } from '../ui/parts.js';

const ACTIONS = { insert: ['إضافة', 'ok'], update: ['تعديل', 'info'], delete: ['حذف', 'bad'], restore: ['استعادة', 'warn'] };
const LOOKUP_OF = { status_id: 'statuses', task_type_id: 'taskTypes', correspondence_type_id: 'correspondenceTypes' };

function value(col, v) {
  if (v == null || v === '') return '—';
  if (col === 'engineer_id') return userName(v);
  if (LOOKUP_OF[col]) return state.lookups[LOOKUP_OF[col]].find((x) => x.id === Number(v))?.name || `#${v}`;
  if (col === 'received_date' || col === 'completed_date') return fmtDate(v);
  if (col === 'deleted_at') return fmtDateTime(v);
  if (Array.isArray(v)) return v.length ? v.join('، ') : '—';
  return String(v);
}

function changes(a) {
  if (a.action === 'insert') {
    const d = a.newData || {};
    return html`<div class="diff"><div><b>${d.subject || ''}</b></div>
      <div class="muted">${value('engineer_id', d.engineer_id)} · ${value('status_id', d.status_id)} · ${value('received_date', d.received_date)}</div></div>`;
  }
  if (a.action === 'delete' || a.action === 'restore') return html`<span class="muted">${a.action === 'delete' ? 'حذف ناعم (يمكن الاستعادة)' : 'أُعيدت المهمة'}</span>`;
  const fields = (a.changedFields || []).filter((c) => c !== 'deleted_at' && c !== 'deleted_by');
  if (!fields.length) return html`<span class="muted">—</span>`;
  return html`<div class="diff">${fields.map((c) => html`<div><b>${LABEL_BY_COL[c] || c}:</b>
    <span class="old">${value(c, a.oldData?.[c])}</span> ← <span class="new">${value(c, a.newData?.[c])}</span></div>`)}</div>`;
}

export default async function audit(ctx, main) {
  setTitle('سجل التعديلات');
  const F = { from: ctx.query.task ? '' : addDays(today(), -30), to: ctx.query.task ? '' : today(), taskId: ctx.query.task || '', userId: '', action: '' };
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'سجل التعديلات', sub: 'كل إضافة وتعديل وحذف على المهام تُسجَّل تلقائياً في قاعدة البيانات ولا يمكن تعديل السجل.' })}
    <form class="card filters" id="filters">
      <div class="field"><label for="a-from">من</label>${dateInput({ name: 'from', id: 'a-from', value: F.from })}</div>
      <div class="field"><label for="a-to">إلى</label>${dateInput({ name: 'to', id: 'a-to', value: F.to })}</div>
      <div class="field"><label for="a-task">رقم المهمة</label><input class="input num" id="a-task" name="taskId" type="number" min="1" value="${F.taskId}" placeholder="الكل"></div>
      <div class="field"><label for="a-user">بواسطة</label><select class="input" id="a-user" name="userId">${options((state.users || []).map((u) => ({ id: u.id, name: u.fullName })), F.userId, 'الكل')}</select></div>
      <div class="field"><label for="a-act">العملية</label><select class="input" id="a-act" name="action">${options(Object.entries(ACTIONS).map(([k, [l]]) => [k, l]), F.action, 'الكل')}</select></div>
    </form>
    <div class="card" id="tbl" style="margin-top:14px">${loading()}</div>`);

  const form = $('#filters', root);
  let rows = [];
  let table;
  const columns = [
    { key: 'changedAt', label: 'الوقت', cls: 'nowrap num', render: (a) => fmtDateTime(a.changedAt) },
    { key: 'changedBy', label: 'بواسطة', cls: 'nowrap', sort: (a) => userName(a.changedBy), render: (a) => userName(a.changedBy) },
    { key: 'action', label: 'العملية', render: (a) => html`<span class="badge ${ACTIONS[a.action][1]}">${ACTIONS[a.action][0]}</span>` },
    { key: 'taskId', label: 'المهمة', cls: 'num', render: (a) => html`<a href="#/tasks?q=%23${a.taskId}&period=all">#${a.taskId}</a>` },
    { key: 'changes', label: 'التغييرات', sort: false, render: changes },
  ];
  const view = () => rows.filter((a) => (!F.userId || a.changedBy === F.userId) && (!F.action || a.action === F.action));

  async function load() {
    try {
      rows = await db.audit.list({ from: F.from || undefined, to: F.to || undefined, taskId: F.taskId || undefined, limit: 1000 });
      if (!table) table = dataTable($('#tbl', root), { columns, rows: view(), sortKey: 'changedAt', sortDir: 'desc', pageSize: 50, empty: 'لا توجد تعديلات في هذه الفترة.' });
      else table.setRows(view());
    } catch (e) { mount($('#tbl', root), html`<div class="card-pad"><div class="alert bad">${e.message}</div></div>`); table = null; }
  }
  form.addEventListener('change', (e) => {
    Object.assign(F, formData(form));
    if (e.target.name === 'userId' || e.target.name === 'action') table?.setRows(view()); else load();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  await load();
}
