/**
 * اختيار وحدة من الهيكل التنظيمي داخل نموذج.
 * يعرض الوحدة المختارة ومسارها، وزر «اختيار/تغيير» يفتح بحثاً بالاسم والاختصار والرمز الرسمي والأسماء البديلة
 * (كلمات بأي ترتيب)، والنتائج بترتيب الشجرة ومع مسار كل وحدة. Enter يختار أول نتيجة.
 * يُستخدم في الموظفين، ولاحقاً في «الجهة الطالبة».
 *
 * unitPicker(el, { model: () => M, value?, filter?: (unit) => boolean, none?: 'نص خيار «بلا وحدة»'|null,
 *                  emptyText?, onChange?: (id|null) => void })  ← { get value(), set(id), open() }
 * model دالة لأن نموذج الهيكل قد يُعاد تحميله والنافذة مفتوحة.
 */
import { html, mount, $, on, debounce } from '../core/dom.js';
import { searchKey, queryWords } from '../core/format.js';
import { pathText, fullPath, treeOrder } from '../core/orgModel.js';
import { icon } from './icons.js';
import { searchBox } from './parts.js';

const MAX = 100;
let seq = 0;

export function unitPicker(el, { model, value = null, filter = () => true, none = null, emptyText = 'لم تُختر وحدة', onChange } = {}) {
  let cur = value || null;
  const qid = `up-q-${++seq}`;
  mount(el, html`
    <div class="org-where">
      <span data-where></span>
      <button type="button" class="btn btn-sm" data-change>${icon('edit')}<span data-change-label></span></button>
    </div>
    <div class="unit-picker" data-picker hidden>
      ${searchBox('', 'اكتب جزءاً من اسم الوحدة أو اختصارها أو رمزها…', qid)}
      <div class="org-pick" data-list></div>
    </div>`);
  const where = $('[data-where]', el), picker = $('[data-picker]', el), list = $('[data-list]', el), q = $(`#${qid}`, el);

  function drawValue() {
    const M = model();
    const u = cur ? M.unit.get(cur) : null;
    mount(where, u
      ? html`<b>${u.name}</b> <span class="badge">${M.level.get(u.levelId)?.name || ''}</span>${u.isActive ? '' : html` <span class="badge warn">معطّلة</span>`}
        ${M.ancestors(u).length ? html`<div class="small muted">${pathText(M, u)}</div>` : ''}`
      : html`<span class="muted">${cur === null && none ? none : emptyText}</span>`);
    $('[data-change-label]', el).textContent = u ? 'تغيير' : 'اختيار';
  }

  function drawList() {
    const M = model();
    const words = queryWords(q.value);
    const nq = words.length > 0;
    const rows = treeOrder(M).filter(({ u }) => filter(u) && words.every((w) => searchKey(fullPath(M, u)).includes(w) || M.searchText.get(u.id).includes(w)));
    mount(list, html`
      ${none && !nq ? html`<button type="button" class="org-opt ${cur === null ? 'on' : ''}" data-pick=""><b>${none}</b></button>` : ''}
      ${rows.slice(0, MAX).map(({ u }) => html`<button type="button" class="org-opt ${cur === u.id ? 'on' : ''}" data-pick="${u.id}">
        <b>${u.name}</b> <span class="badge">${M.level.get(u.levelId)?.name || ''}</span>
        <span class="small muted">${pathText(M, u) || 'وحدة رئيسية'}</span></button>`)}
      ${rows.length > MAX ? html`<div class="small muted card-pad">تظهر أول ${MAX} من ${rows.length}. اكتب للبحث.</div>` : ''}
      ${!rows.length ? html`<div class="small muted card-pad">${nq ? 'لا توجد وحدة بهذا الاسم.' : 'لا توجد وحدات. أضفها من صفحة «الهيكل التنظيمي».'}</div>` : ''}`);
  }

  const open = () => { picker.hidden = false; q.value = ''; drawList(); q.focus(); };
  $('[data-change]', el).onclick = () => (picker.hidden ? open() : (picker.hidden = true));
  q.addEventListener('input', debounce(drawList, 120));
  q.addEventListener('keydown', (e) => {
    // Enter قبل انتهاء انتظار البحث: تُحدَّث النتائج أولاً حتى لا تُختار وحدة من القائمة السابقة
    if (e.key === 'Enter') { e.preventDefault(); drawList(); list.querySelector('[data-pick]:not([data-pick=""])')?.click(); }
    if (e.key === 'Escape' && !picker.hidden) { e.stopPropagation(); picker.hidden = true; }
  });
  on(list, 'click', '[data-pick]', (e, b) => {
    cur = b.dataset.pick ? Number(b.dataset.pick) : null;
    picker.hidden = true;
    drawValue();
    onChange?.(cur);
  });
  drawValue();
  return {
    get value() { return cur; },
    set(id) { cur = id || null; drawValue(); },
    open,
  };
}
