/**
 * حقل تاريخ بصيغة يوم/شهر/سنة في كل المتصفحات.
 * (حقل التاريخ الأصلي في المتصفح يتبع لغة المتصفح، فيظهر أحياناً شهر/يوم/سنة)
 *
 * الشكل: نص يكتب فيه المستخدم 31/10/2026 + زر تقويم.
 * القيمة الفعلية في حقل مخفي يحمل name ويُرجع 'YYYY-MM-DD'، فبقية الكود يعمل كما هو:
 *   form.elements.from.value        ← '2026-10-31'
 *   form.elements.from.value = iso  ← يحدّث النص المعروض
 *   .disabled / .focus()            ← تنعكس على الحقل الظاهر
 *   حدث change يصدر من الحقل المخفي (e.target.name صحيح)
 */
import { html } from '../core/dom.js';
import { fmtDate, parseDate, DATE_FORMAT_HINT } from '../core/format.js';
import { icon } from './icons.js';

// علامات LRM تجعل الكلمات بنفس ترتيب الأرقام داخل الحقل: يوم/شهر/سنة
const PLACEHOLDER = DATE_FORMAT_HINT.split('/').join('\u200E/');

export function dateInput({ name, id, value = '', required = false, disabled = false }) {
  return html`<span class="date-field">
    <input type="hidden" name="${name}" value="${value || ''}" data-date-iso ${disabled ? 'disabled' : ''}>
    <input class="input date-text" type="text" id="${id}" value="${fmtDate(value)}" placeholder="${PLACEHOLDER}"
      inputmode="numeric" autocomplete="off" maxlength="10" dir="ltr" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}>
    <button type="button" class="date-btn" tabindex="-1" aria-label="اختيار من التقويم" ${disabled ? 'disabled' : ''}>${icon('calendar')}</button>
    <input type="date" class="date-native" tabindex="-1" aria-hidden="true">
  </span>`;
}

const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const protoDis = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'disabled');

function enhance(box) {
  box.dataset.ready = '1';
  const hidden = box.querySelector('[data-date-iso]');
  const text = box.querySelector('.date-text');
  const btn = box.querySelector('.date-btn');
  const native = box.querySelector('.date-native');
  let iso = proto.get.call(hidden) || '';

  const setDisabled = (v) => { protoDis.set.call(hidden, v); text.disabled = v; btn.disabled = v; };
  setDisabled(protoDis.get.call(hidden) || text.disabled);
  text.value = fmtDate(iso);

  Object.defineProperty(hidden, 'value', {
    configurable: true,
    get: () => iso,
    set: (v) => { iso = parseDate(v) || ''; proto.set.call(hidden, iso); text.value = fmtDate(iso); box.classList.remove('bad-date'); },
  });
  Object.defineProperty(hidden, 'disabled', { configurable: true, get: () => text.disabled, set: setDisabled });
  hidden.focus = () => text.focus();

  const emit = () => hidden.dispatchEvent(new Event('change', { bubbles: true }));
  const commit = () => {
    const raw = text.value.trim();
    const next = raw ? parseDate(raw) : '';
    box.classList.toggle('bad-date', !!raw && !next);
    if (raw && !next) return; // نترك النص ليصححه المستخدم
    const changed = next !== iso;
    iso = next || '';
    proto.set.call(hidden, iso);
    text.value = fmtDate(iso);
    if (changed) emit();
  };

  // إضافة / تلقائياً أثناء الكتابة: 31 ← 31/ ، 3110 ← 31/10/
  text.addEventListener('input', (e) => {
    if (e.inputType?.startsWith('delete')) return;
    let v = text.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d/.-]/g, '').replace(/[.-]/g, '/');
    if (/^\d{2}$/.test(v) || /^\d{1,2}\/\d{2}$/.test(v)) v += '/';
    text.value = v;
  });
  text.addEventListener('change', (e) => { e.stopPropagation(); commit(); });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); } });

  btn.addEventListener('click', () => {
    native.value = iso;
    try { native.showPicker(); } catch { native.focus(); native.click(); }
  });
  native.addEventListener('change', (e) => {
    e.stopPropagation();
    if (!native.value || native.value === iso) return;
    hidden.value = native.value;
    emit();
  });
}

/** يجهّز كل حقول التاريخ الجديدة تلقائياً (الصفحات والنوافذ) */
export function watchDateFields(root = document.body) {
  const run = () => root.querySelectorAll('.date-field:not([data-ready])').forEach(enhance);
  new MutationObserver(run).observe(root, { childList: true, subtree: true });
  run();
}
