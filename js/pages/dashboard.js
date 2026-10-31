/** لوحة المؤشرات (بديل Looker Studio) */
import { db } from '../data/index.js';
import { html, mount, $, formData, on } from '../core/dom.js';
import { state, can, engineers } from '../core/store.js';
import { num, pct, dec1, fmtDate, today, daysBetween } from '../core/format.js';
import { daysAr } from '../core/format.js';
import { setTitle } from '../core/session.js';
import { summarize, groupCount, monthly, isDelayed } from '../lib/stats.js';
import { hbars, columns, donut } from '../lib/charts.js';
import { icon } from '../ui/icons.js';
import { pageHead, periodFields, options, rangeOf, loading, newPage } from '../ui/parts.js';

const KEY = 'tsk.filters.dash';
const DEFAULTS = { period: 'year', from: '', to: '', engineerId: '' };
const SERIES = [
  { name: 'مكتملة', color: 'var(--c2)', key: 'done' },
  { name: 'مفتوحة', color: 'var(--c1)', key: 'open' },
  { name: 'ملغاة', color: 'var(--c7)', key: 'cancelled' },
];
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c8)', 'var(--c7)'];

export default async function dashboard(ctx, main) {
  setTitle('لوحة المؤشرات');
  let F = DEFAULTS;
  try { F = { ...DEFAULTS, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { /* */ }
  const viewAll = can('tasks.viewAll');
  const delayDays = state.settings?.delayThresholdDays || 7;

  const root = newPage(main);
  mount(root, html`
    ${pageHead({
      title: viewAll ? 'لوحة المؤشرات' : 'مؤشراتي',
      actions: html`<button class="btn" data-act="print">${icon('print')}طباعة</button>`,
    })}
    <form class="card filters" id="filters">
      ${periodFields(F)}
      ${viewAll ? html`<div class="field"><label for="f-eng">المهندس</label>
        <select class="input" id="f-eng" name="engineerId">${options(engineers({ includeInactive: true }).map((e) => ({ id: e.id, name: e.fullName, isActive: e.isActive })), F.engineerId, 'كل المهندسين')}</select></div>` : ''}
    </form>
    <div id="body" style="margin-top:16px">${loading()}</div>`);

  const form = $('#filters', root);
  const body = $('#body', root);
  let tasks = [];

  function draw() {
    const t0 = today();
    const s = summarize(tasks, { delayDays, today: t0 });
    const { from, to } = rangeOf(F);
    const byEng = groupCount(tasks, (t) => t.engineerId, (t) => t.engineerShort || t.engineerName);
    const fullName = new Map(tasks.map((t) => [t.engineerId, t.engineerName]));
    const months = monthly(tasks, from || undefined, to && to < t0 ? to : t0);
    const byType = groupCount(tasks, (t) => t.taskTypeId, (t) => t.taskType);
    const byCorr = groupCount(tasks, (t) => t.correspondenceTypeId, (t) => t.correspondenceType);
    const byStatus = groupCount(tasks, (t) => t.statusId, (t) => t.status);
    const delayedList = tasks.filter((t) => isDelayed(t, delayDays, t0)).sort((a, b) => a.receivedDate.localeCompare(b.receivedDate)).slice(0, 10);
    const delayedByEng = new Map();
    for (const t of tasks) if (isDelayed(t, delayDays, t0)) delayedByEng.set(t.engineerId, (delayedByEng.get(t.engineerId) || 0) + 1);
    const stack = (g) => SERIES.map((x) => g[x.key]);
    // ألوان الحالات حسب نوعها: مكتملة أخضر، مفتوحة أزرق/برتقالي، ملغاة رمادي
    const kindIdx = { done: 0, open: 0, cancelled: 0 };
    const KIND_COLORS = { done: ['var(--c2)', 'var(--c6)'], open: ['var(--c1)', 'var(--c3)', 'var(--c8)', 'var(--c4)'], cancelled: ['var(--c7)', 'var(--c5)'] };
    const statusColor = (id, i) => {
      const k = state.lookups.statuses.find((x) => x.id === id)?.kind;
      if (!k) return PALETTE[i % PALETTE.length];
      const list = KIND_COLORS[k];
      return list[kindIdx[k]++ % list.length];
    };

    mount(body, html`
      <div class="kpis">
        <div class="card kpi" style="--accent:var(--c1)"><span class="label">إجمالي المهام</span><span class="value num">${num(s.total)}</span><span class="note">${from ? `${fmtDate(from)} – ${fmtDate(to)}` : 'كل الفترات'}</span></div>
        <div class="card kpi" style="--accent:var(--c2)"><span class="label">مكتملة</span><span class="value num">${num(s.done)}</span><span class="note">نسبة الإنجاز ${pct(s.rate)}</span></div>
        <div class="card kpi" style="--accent:var(--c3)"><span class="label">مفتوحة</span><span class="value num">${num(s.open)}</span><span class="note">منها متأخرة ${num(s.delayed)}</span></div>
        <div class="card kpi" style="--accent:var(--c5)"><span class="label">متأخرة</span><span class="value num">${num(s.delayed)}</span><span class="note">مفتوحة أكثر من ${daysAr(delayDays)}</span></div>
        <div class="card kpi" style="--accent:var(--c6)"><span class="label">متوسط مدة الإنجاز</span><span class="value num">${dec1(s.avgDuration)}</span><span class="note">يوم · تجاوزت المهلة ${num(s.lateDone)}</span></div>
        <div class="card kpi" style="--accent:var(--c7)"><span class="label">ملغاة</span><span class="value num">${num(s.cancelled)}</span><span class="note">لا تدخل في نسبة الإنجاز</span></div>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        ${viewAll && !F.engineerId ? html`<div class="card"><div class="card-head"><h2>المهام حسب المهندس</h2></div><div class="card-pad">
          ${hbars({ rows: byEng.map((g) => ({ label: g.label, parts: stack(g) })), series: SERIES })}</div></div>` : ''}
        <div class="card ${viewAll && !F.engineerId ? '' : 'span-2'}"><div class="card-head"><h2>الاتجاه الشهري</h2></div><div class="card-pad">
          ${columns({ labels: months.map((m) => m.label), series: SERIES.map((x) => ({ ...x, values: months.map((m) => m[x.key]) })) })}</div></div>
        <div class="card"><div class="card-head"><h2>حسب نوع المهمة</h2></div><div class="card-pad">
          ${hbars({ rows: byType.map((g) => ({ label: g.label, parts: stack(g) })), series: SERIES })}</div></div>
        <div class="card"><div class="card-head"><h2>الحالات ونوع المراسلة</h2></div><div class="card-pad grid grid-2">
          <div>${donut({ items: byStatus.map((g, i) => ({ label: g.label, value: g.total, color: statusColor(g.key, i) })), center: num(s.total), sub: 'مهمة' })}</div>
          <div>${donut({ items: byCorr.map((g, i) => ({ label: g.label, value: g.total, color: PALETTE[(i + 2) % PALETTE.length] })), center: pct(s.rate), sub: 'نسبة الإنجاز' })}</div>
        </div></div>
      </div>

      ${viewAll && !F.engineerId ? html`<div class="card" style="margin-top:16px"><div class="card-head"><h2>أداء المهندسين</h2></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>المهندس</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متأخرة</th><th>ملغاة</th><th>نسبة الإنجاز</th><th>متوسط المدة</th></tr></thead>
          <tbody>${byEng.map((g) => html`<tr class="clickable" data-eng="${g.key}">
            <td>${fullName.get(g.key) || g.label}</td><td class="num">${num(g.total)}</td><td class="num">${num(g.done)}</td><td class="num">${num(g.open)}</td>
            <td class="num" style="${delayedByEng.get(g.key) ? 'color:var(--warn);font-weight:600' : ''}">${num(delayedByEng.get(g.key) || 0)}</td>
            <td class="num">${num(g.cancelled)}</td>
            <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${Math.round((g.rate || 0) * 100)}%"></div></div><span class="num">${pct(g.rate)}</span></div></td>
            <td class="num">${dec1(g.avgDuration)}</td></tr>`)}
          ${byEng.length ? '' : html`<tr><td colspan="8"><div class="empty">لا توجد بيانات.</div></td></tr>`}</tbody>
        </table></div></div>` : ''}

      <div class="card" style="margin-top:16px"><div class="card-head"><h2>أقدم المهام المتأخرة</h2>
        <div class="actions"><a class="btn btn-sm" href="#/tasks?status=k:delayed&period=all">عرض الكل</a></div></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>#</th><th>الاستقبال</th>${viewAll ? html`<th>المهندس</th>` : ''}<th>الموضوع</th><th>الحالة</th><th>منذ</th></tr></thead>
          <tbody>${delayedList.map((t) => html`<tr>
            <td class="num muted">${t.id}</td><td class="num nowrap">${fmtDate(t.receivedDate)}</td>
            ${viewAll ? html`<td class="nowrap">${t.engineerShort || t.engineerName}</td>` : ''}
            <td class="subject"><div class="clip">${t.subject}</div></td><td><span class="badge warn">${t.status}</span></td>
            <td class="num nowrap" style="color:var(--bad);font-weight:600">${daysBetween(t.receivedDate, t0)} يوم</td></tr>`)}
          ${delayedList.length ? '' : html`<tr><td colspan="6"><div class="empty">${icon('check')}<div>لا توجد مهام متأخرة.</div></div></td></tr>`}</tbody>
        </table></div></div>`);
  }

  async function load() {
    const { from, to } = rangeOf(F);
    mount(body, loading());
    try {
      tasks = await db.tasks.list({ from, to, engineerId: viewAll ? F.engineerId || undefined : undefined });
      draw();
    } catch (e) {
      mount(body, html`<div class="alert bad">${e.message}</div>`);
    }
  }

  form.addEventListener('change', () => {
    F = { ...F, ...formData(form) };
    form.querySelectorAll('[data-custom]').forEach((el) => { el.hidden = F.period !== 'custom'; });
    try { sessionStorage.setItem(KEY, JSON.stringify(F)); } catch { /* */ }
    if (F.period !== 'custom' || (F.from && F.to)) load();
  });
  on(root, 'click', '[data-act="print"]', () => window.print());
  on(root, 'click', 'tr[data-eng]', (e, tr) => {
    form.elements.engineerId.value = tr.dataset.eng;
    form.dispatchEvent(new Event('change'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  const onTheme = () => tasks.length && draw();
  window.addEventListener('themechange', onTheme);
  ctx.onLeave(() => window.removeEventListener('themechange', onTheme));
  await load();
}
