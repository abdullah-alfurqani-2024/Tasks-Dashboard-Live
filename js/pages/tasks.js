/** صفحة المهام: الفلاتر، الجدول، والإضافة والتعديل */
import { db } from '../data/index.js';
import { CONFIG } from '../config.js';
import { html, mount, $, formData, debounce, on } from '../core/dom.js';
import { state, can, isLocked, canEditTask, engineers, activeItems } from '../core/store.js';
import { fmtDate, normalizeAr, today, num } from '../core/format.js';
import { daysAr } from '../core/format.js';
import { setTitle } from '../core/session.js';
import { exportTasks } from '../core/exporter.js';
import { summarize, isDelayed } from '../lib/stats.js';
import { dataTable } from '../ui/table.js';
import { icon } from '../ui/icons.js';
import { toastError } from '../ui/feedback.js';
import { openTaskForm } from '../ui/taskForm.js';
import { pageHead, periodFields, options, rangeOf, statusBadge, searchBox, loading, newPage } from '../ui/parts.js';

const KEY = `${CONFIG.storagePrefix || 'tsk.'}filters.tasks`;
const DEFAULTS = { period: 'year', from: '', to: '', engineerId: '', status: '', taskTypeId: '', q: '', deleted: 'exclude', review: '', priority: '' };
const loadF = () => { try { return { ...DEFAULTS, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
const saveF = (F) => { try { sessionStorage.setItem(KEY, JSON.stringify(F)); } catch { /* */ } };

// أزرار الإحصائيات: كل زر يضبط الحالة والأولوية والمراجعة معاً، وضغطه مرة ثانية يلغيه
const QUICK = [
  { key: 'done', label: 'مكتملة', color: 'var(--ok)', set: { status: 'k:done' }, count: (s) => s.done },
  { key: 'open', label: 'مفتوحة', color: 'var(--info)', set: { status: 'k:open' }, count: (s) => s.open },
  { key: 'delayed', label: 'متأخرة', color: 'var(--warn)', set: { status: 'k:delayed' }, count: (s) => s.delayed },
  { key: 'cancelled', label: 'مغلقة بدون إنجاز', color: 'var(--muted)', set: { status: 'k:cancelled' }, count: (s) => s.cancelled },
  { key: 'urgent', label: 'عاجلة مفتوحة', color: 'var(--bad)', set: { status: 'k:open', priority: 'urgent' }, count: (s) => s.urgentOpen },
  { key: 'review', label: 'تحتاج مراجعة', color: 'var(--warn)', set: { review: '1' }, count: (s, rows) => rows.filter((t) => t.reviewReasons?.length).length },
];
const QUICK_KEYS = ['status', 'priority', 'review'];
const quickOf = (F) => QUICK.find((c) => QUICK_KEYS.every((k) => (F[k] || '') === (c.set[k] || '')));

export default async function tasksPage(ctx, main) {
  setTitle('المهام');
  // reset=1 (من لوحة المؤشرات): نبدأ من الفلاتر الافتراضية ثم نطبّق ما في الرابط
  const F = ctx.query.reset === '1' ? { ...DEFAULTS } : loadF();
  if (ctx.query.status !== undefined) F.status = ctx.query.status;
  if (ctx.query.engineer !== undefined) F.engineerId = ctx.query.engineer;
  if (ctx.query.period) F.period = ctx.query.period;
  if (F.period === 'custom') { if (ctx.query.from) F.from = ctx.query.from; if (ctx.query.to) F.to = ctx.query.to; }
  if (ctx.query.q) F.q = ctx.query.q;
  if (ctx.query.priority !== undefined) F.priority = ctx.query.priority === 'urgent' ? 'urgent' : '';
  if (ctx.query.review !== undefined) F.review = ctx.query.review === '1' ? '1' : '';
  const FF = F;
  const viewAll = can('tasks.viewAll');
  const delayDays = state.settings?.delayThresholdDays || 7;
  let all = [];

  const root = newPage(main);
  mount(root, html`
    ${pageHead({
      title: viewAll ? 'المهام' : 'مهامي',
      actions: html`
        ${can('tasks.create') ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}مهمة جديدة</button>` : ''}
        <button class="btn" data-act="xlsx" title="تصدير النتائج الظاهرة">${icon('download')}Excel</button>`,
    })}
    <form class="card filters" id="filters" autocomplete="off">
      ${periodFields(F)}
      ${viewAll ? html`<div class="field"><label for="f-eng">المهندس</label>
        <select class="input" id="f-eng" name="engineerId">${options(engineers({ includeInactive: true }).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })), F.engineerId, 'الكل')}</select></div>` : ''}
      <div class="field"><label for="f-status">الحالة</label>
        <select class="input" id="f-status" name="status">
          <option value="">الكل</option>
          <optgroup label="مجموعات">${options([['k:open', 'المفتوحة'], ['k:delayed', `المتأخرة (أكثر من ${daysAr(delayDays)})`], ['k:done', 'المكتملة'], ['k:cancelled', 'المغلقة بدون إنجاز']], F.status)}</optgroup>
          <optgroup label="الحالات">${options(state.lookups.statuses, F.status)}</optgroup>
        </select></div>
      <div class="field"><label for="f-type">نوع المهمة</label>
        <select class="input" id="f-type" name="taskTypeId">${options(state.lookups.taskTypes, F.taskTypeId, 'الكل')}</select></div>
      ${can('tasks.delete') ? html`<div class="field"><label for="f-del">المحذوفة</label>
        <select class="input" id="f-del" name="deleted">${options([['exclude', 'إخفاء المحذوفة'], ['only', 'المحذوفة فقط']], F.deleted)}</select></div>` : ''}
      <div class="field"><label for="f-prio">الأولوية</label>
        <select class="input" id="f-prio" name="priority">${options([['urgent', 'العاجلة فقط']], F.priority, 'الكل')}</select></div>
      <div class="field"><label for="f-review">المراجعة</label>
        <select class="input" id="f-review" name="review">${options([['1', 'تحتاج مراجعة فقط']], F.review, 'الكل')}</select></div>
      <div class="field wide"><label for="f-q">بحث</label>${searchBox(F.q, 'الموضوع، الجهة، الموظف، رقم القيد…', 'f-q')}</div>
      <div class="btns"><button type="button" class="btn btn-ghost" data-act="reset" title="مسح الفلاتر">${icon('x')}مسح</button></div>
    </form>
    <div class="chips" id="chips" style="margin:14px 0"></div>
    <div class="card" id="tbl">${loading()}</div>`);

  const form = $('#filters', root);
  const chips = $('#chips', root);
  let table = null;

  const columns = [
    { key: 'id', label: '#', cls: 'num muted', sort: (r) => r.id },
    { key: 'receivedDate', label: 'الاستقبال', cls: 'nowrap num', render: (r) => fmtDate(r.receivedDate) },
    ...(viewAll ? [{ key: 'engineerName', label: 'المهندس', cls: 'nowrap', render: (r) => r.engineerShort || r.engineerName }] : []),
    { key: 'subject', label: 'الموضوع', cls: 'subject', render: (r) => html`<div class="clip">${r.priority === 'urgent' ? html`<span class="badge bad">عاجلة</span> ` : ''}${r.reviewReasons?.length ? html`<span class="badge warn" title="${r.reviewReasons.join(' | ')}">تحتاج مراجعة</span> ` : ''}${r.subject}</div>${F.review && r.reviewReasons?.length ? html`<div class="small" style="color:var(--warn)">${r.reviewReasons.join(' · ')}</div>` : ''}${r.requester || r.employeeName ? html`<div class="small muted">${[r.requester, r.employeeName].filter(Boolean).join(' · ')}</div>` : ''}` },
    { key: 'taskType', label: 'نوع المهمة', cls: 'nowrap' },
    { key: 'status', label: 'الحالة', render: (r) => statusBadge(r, isDelayed(r, delayDays, today())) },
    { key: 'completedDate', label: 'الانتهاء', cls: 'nowrap num', render: (r) => fmtDate(r.completedDate) },
    { key: 'durationDays', label: 'المدة', cls: 'num', render: (r) => (r.durationDays == null ? '' : html`<span style="${r.durationDays > delayDays ? 'color:var(--bad);font-weight:600' : ''}">${r.durationDays}</span>`) },
    { key: 'act', label: '', sort: false, render: (r) => html`<div class="row-actions">
      ${isLocked(r) ? html`<span class="muted" title="مقفلة">${icon('lock')}</span>` : ''}
      ${can('tasks.create') && !r.deletedAt ? html`<button class="btn btn-ghost btn-icon btn-sm" data-copy="${r.id}" aria-label="نسخ كمهمة جديدة" title="نسخ كمهمة جديدة">${icon('copy')}</button>` : ''}
      ${canEditTask(r) ? html`<button class="btn btn-ghost btn-icon btn-sm" data-edit="${r.id}" aria-label="تعديل" title="تعديل">${icon('edit')}</button>` : ''}</div>` },
  ];

  const requesters = () => [...new Set(all.map((t) => t.requester).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));

  function filtered(F = FF) {
    const q = normalizeAr(F.q);
    const t0 = today();
    return all.filter((t) => {
      if (F.status) {
        if (F.status === 'k:delayed') { if (!isDelayed(t, delayDays, t0)) return false; }
        else if (F.status.startsWith('k:')) { if (t.statusKind !== F.status.slice(2)) return false; }
        else if (t.statusId !== Number(F.status)) return false;
      }
      if (F.taskTypeId && t.taskTypeId !== Number(F.taskTypeId)) return false;
      if (F.review && !t.reviewReasons?.length) return false;
      if (F.priority === 'urgent' && t.priority !== 'urgent') return false;
      if (/^#\d+$/.test(q)) { if (t.id !== Number(q.slice(1))) return false; }
      else if (q) {
        const hay = normalizeAr([t.subject, t.requester, t.employeeName, t.refNo, t.notes, t.engineerName, `#${t.id}`].join(' '));
        if (!q.split(' ').every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }

  // الرابط يحمل الفلاتر الأساسية: يبقى بعد التحديث وزر الرجوع، ويمكن إرساله
  function syncUrl() {
    const q = new URLSearchParams();
    q.set('period', F.period);
    if (F.period === 'custom') { if (F.from) q.set('from', F.from); if (F.to) q.set('to', F.to); }
    if (viewAll && F.engineerId) q.set('engineer', F.engineerId);
    for (const k of QUICK_KEYS) if (F[k]) q.set(k, F[k]);
    history.replaceState(null, '', `#/tasks?${q}`);
  }

  function draw() {
    const rows = filtered();
    // الأعداد بدون فلتر الزر المفعّل، حتى تبقى بقية الأزرار بأعدادها
    const active = quickOf(F);
    const base = active ? filtered({ ...F, status: '', priority: '', review: '' }) : rows;
    const s = summarize(base, { delayDays, today: today() });
    const chip = (c) => {
      const n = c.count(s, base), on = active === c;
      return n || on ? html`<button type="button" class="chip chip-btn ${on ? 'on' : ''}" data-quick="${c.key}" aria-pressed="${on}" title="${on ? 'إلغاء الفلترة' : `عرض ${c.label} فقط`}"><span class="dot" style="color:${c.color}"></span>${c.label} <b>${num(n)}</b>${on ? icon('x') : ''}</button>` : '';
    };
    mount(chips, html`
      <button type="button" class="chip chip-btn ${QUICK_KEYS.some((k) => F[k]) ? '' : 'on'}" data-quick="" aria-pressed="${!QUICK_KEYS.some((k) => F[k])}" title="إلغاء فلاتر الحالة والأولوية والمراجعة">الإجمالي <b>${num(s.total)}</b></button>
      ${QUICK.map(chip)}`);
    if (!table) {
      table = dataTable($('#tbl', root), {
        columns, rows, pageSize: 50, sortKey: 'receivedDate', sortDir: 'desc',
        rowClass: (r) => (r.deletedAt ? 'deleted' : ''),
        onRow: (r) => openTaskForm({ task: r, requesters: requesters(), onSaved }),
        empty: all.length ? 'لا توجد مهام تطابق الفلاتر.' : 'لا توجد مهام في هذه الفترة.',
      });
    } else table.setRows(rows);
  }

  let reqId = 0;
  async function load() {
    const my = ++reqId;
    const { from, to } = rangeOf(F);
    try {
      const list = await db.tasks.list({ from, to, engineerId: viewAll ? F.engineerId : undefined, deleted: F.deleted });
      if (my !== reqId) return;
      all = list;
      draw();
    } catch (e) {
      if (my !== reqId) return;
      mount($('#tbl', root), html`<div class="card-pad"><div class="alert bad">${e.message}</div></div>`);
      table = null;
    }
  }

  function onSaved(task, action) {
    const i = all.findIndex((t) => t.id === task.id);
    const gone = (action === 'delete' && F.deleted === 'exclude') || (action === 'restore' && F.deleted === 'only');
    if (gone) { if (i >= 0) all.splice(i, 1); } else if (i >= 0) all[i] = task; else all.unshift(task);
    draw();
  }

  const serverKeys = new Set(['period', 'from', 'to', 'engineerId', 'deleted']);
  const apply = (name) => {
    Object.assign(F, formData(form));
    form.querySelectorAll('[data-custom]').forEach((el) => { el.hidden = F.period !== 'custom'; });
    saveF(F);
    syncUrl();
    if (serverKeys.has(name)) load(); else draw();
  };
  on(root, 'click', '[data-quick]', (e, b) => {
    const c = QUICK.find((x) => x.key === b.dataset.quick);
    const next = !c || quickOf(F) === c ? {} : c.set;      // الضغطة الثانية (أو «الإجمالي») تلغي
    for (const k of QUICK_KEYS) { F[k] = next[k] || ''; if (form.elements[k]) form.elements[k].value = F[k]; }
    saveF(F); syncUrl(); draw();
  });
  form.addEventListener('change', (e) => { if (e.target.name !== 'q') apply(e.target.name); });
  form.addEventListener('input', debounce((e) => { if (e.target.name === 'q') apply('q'); }, 200));
  form.addEventListener('submit', (e) => e.preventDefault());

  on(root, 'click', '[data-act]', (e, b) => {
    const a = b.dataset.act;
    if (a === 'new') openTaskForm({ requesters: requesters(), onSaved });
    else if (a === 'xlsx') {
      const rows = table?.viewRows || [];
      if (!rows.length) return toastError({ message: 'لا توجد بيانات للتصدير.' });
      exportTasks(rows, { name: 'tasks' });
    } else if (a === 'reset') {
      Object.assign(F, DEFAULTS);
      saveF(F);
      tasksPage({ ...ctx, query: {} }, main);
    }
  });
  on(root, 'click', '[data-copy]', (e, b) => {
    const t = all.find((x) => x.id === Number(b.dataset.copy));
    if (t) openTaskForm({ copyOf: t, requesters: requesters(), onSaved });
  });
  on(root, 'click', '[data-edit]', (e, b) => {
    const t = all.find((x) => x.id === Number(b.dataset.edit));
    if (t) openTaskForm({ task: t, requesters: requesters(), onSaved });
  });

  syncUrl();
  if (ctx.query.new === '1' && can('tasks.create')) setTimeout(() => openTaskForm({ requesters: requesters(), onSaved }), 0);
  await load();
}
