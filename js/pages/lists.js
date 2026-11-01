/** القوائم المنسدلة: أنواع المهام، أنواع المراسلات، الحالات */
import { db } from '../data/index.js';
import { html, mount, $, on } from '../core/dom.js';
import { state, STATUS_KIND_LABELS, loadReference } from '../core/store.js';
import { setTitle } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { busy, toast, toastError } from '../ui/feedback.js';
import { pageHead, options, newPage } from '../ui/parts.js';

const TABS = [
  ['taskTypes', 'أنواع المهام'],
  ['correspondenceTypes', 'أنواع المراسلات'],
  ['statuses', 'الحالات'],
];

export default async function lists(ctx, main) {
  setTitle('القوائم');
  let tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'taskTypes';
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'القوائم', sub: 'القيم التي تظهر في القوائم المنسدلة. لا تُحذف القيمة المستخدمة؛ عطّلها بدلاً من ذلك فتختفي من الإدخال الجديد وتبقى في المهام القديمة.' })}
    <div class="card">
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button role="tab" data-tab="${k}">${l}</button>`)}</div>
      <div id="list"></div>
    </div>`);
  const box = $('#list', root);

  function draw() {
    root.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    const items = state.lookups[tab];
    const isStatus = tab === 'statuses';
    const cls = isStatus ? 'list-row' : 'list-row no-kind';
    const row = (it) => html`
      <form class="${cls}" data-id="${it?.id || ''}" novalidate>
        <input class="input num" name="sortOrder" type="number" min="0" value="${it?.sortOrder ?? (items.length + 1)}" aria-label="الترتيب">
        <input class="input" name="name" value="${it?.name || ''}" maxlength="100" placeholder="${it ? '' : 'قيمة جديدة…'}" aria-label="الاسم" required>
        ${isStatus ? html`<select class="input hide-sm" name="kind" aria-label="نوع الحالة">${options(Object.entries(STATUS_KIND_LABELS), it?.kind || 'open')}</select>` : ''}
        <label class="check hide-sm"><input type="checkbox" name="isActive" ${it?.isActive !== false ? 'checked' : ''}> مفعّل</label>
        <button class="btn btn-sm ${it ? '' : 'btn-primary'}" type="submit">${it ? icon('check') : icon('plus')}${it ? 'حفظ' : 'إضافة'}</button>
      </form>`;
    mount(box, html`
      <div class="${cls} head"><span>الترتيب</span><span>الاسم</span>${isStatus ? html`<span class="hide-sm">نوع الحالة</span>` : ''}<span class="hide-sm">الحالة</span><span></span></div>
      ${items.map(row)}
      ${row(null)}
      ${isStatus ? html`<div class="card-pad small muted">نوع الحالة يحدد السلوك: «مكتملة» تتطلب تاريخ الانتهاء وتدخل في نسبة الإنجاز، «مفتوحة» تمسح تاريخ الانتهاء وتُحسب في المتأخرة، «مغلقة بدون إنجاز» (مثل إعادة تحويل) تُستبعد من نسبة الإنجاز ومن المتأخرة.</div>` : ''}`);
  }

  on(root, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; history.replaceState(null, '', `#/lists?tab=${tab}`); draw(); });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const name = f.elements.name.value.trim();
    if (!name) { f.elements.name.focus(); return toastError({ message: 'اكتب الاسم.' }); }
    const item = { id, name, sortOrder: Number(f.elements.sortOrder.value) || 0, isActive: f.elements.isActive.checked };
    if (f.elements.kind) item.kind = f.elements.kind.value;
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        await db.lookups.save(tab, item);
        await loadReference({ force: true });
        toast(id ? 'تم الحفظ.' : 'أُضيفت القيمة.', 'ok', 2000);
        draw();
      } catch (err) { toastError(err); }
    });
  });

  draw();
}
