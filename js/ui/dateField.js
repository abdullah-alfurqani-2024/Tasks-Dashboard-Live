/**
 * حقل تاريخ بصيغة سنة/شهر/يوم في كل المتصفحات.
 * (حقل التاريخ الأصلي في المتصفح يتبع لغة المتصفح، فيظهر أحياناً شهر/يوم/سنة)
 *
 * الشكل: نص يكتب فيه المستخدم 2026/10/31 + زر تقويم.
 * التقويم: حقل التاريخ الأصلي شفاف فوق زر التقويم، فتصله لمسة المستخدم أو نقرته مباشرة.
 *   هكذا يفتح كل متصفح تقويمه بنفسه (iPhone وAndroid والحاسوب) دون الاعتماد على showPicker()
 *   وحده، فهو غير مدعوم في كل المتصفحات، ولا يعمل على حقل مخفي في بعضها.
 * القيمة الفعلية في حقل مخفي يحمل name ويُرجع 'YYYY-MM-DD'، فبقية الكود يعمل كما هو:
 *   form.elements.from.value        ← '2026-10-31'
 *   form.elements.from.value = iso  ← يحدّث النص المعروض
 *   .disabled / .focus()            ← تنعكس على الحقل الظاهر
 *   حدث change يصدر من الحقل المخفي (e.target.name صحيح)
 */
import { html } from '../core/dom.js';
import { fmtDate, parseDate, DATE_FORMAT_HINT } from '../core/format.js';
import { icon } from './icons.js';

// علامات LRM تجعل الكلمات بنفس ترتيب الأرقام داخل الحقل: سنة/شهر/يوم
const PLACEHOLDER = DATE_FORMAT_HINT.split('/').join('\u200E/');

export function dateInput({ name, id, value = '', required = false, disabled = false }) {
  return html`<span class="date-field">
    <input type="hidden" name="${name}" value="${value || ''}" data-date-iso ${disabled ? 'disabled' : ''}>
    <input class="input date-text" type="text" id="${id}" value="${fmtDate(value)}" placeholder="${PLACEHOLDER}"
      inputmode="numeric" autocomplete="off" maxlength="10" dir="ltr" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}>
    <input type="date" class="date-native" tabindex="-1" aria-label="اختيار من التقويم" title="اختيار من التقويم" ${disabled ? 'disabled' : ''}>
    <span class="date-btn" aria-hidden="true">${icon('calendar')}</span>
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

  const setDisabled = (v) => { protoDis.set.call(hidden, v); text.disabled = v; native.disabled = v; btn.classList.toggle('off', !!v); };
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

  // إضافة / تلقائياً أثناء الكتابة: 2026 ← 2026/ ، 202610 ← 2026/10/
  text.addEventListener('input', (e) => {
    if (e.inputType?.startsWith('delete')) return;
    let v = text.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d/.-]/g, '').replace(/[.-]/g, '/');
    if (/^\d{4}$/.test(v) || /^\d{4}\/\d{2}$/.test(v)) v += '/';
    else if (/^\d{5,8}$/.test(v)) v = [v.slice(0, 4), v.slice(4, 6), v.slice(6)].filter(Boolean).join('/'); // لصق 20261031
    text.value = v;
  });
  text.addEventListener('change', (e) => { e.stopPropagation(); commit(); });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); } });

  // قبل فتح التقويم: يبدأ على التاريخ المكتوب
  const prime = () => { if (native.value !== iso) native.value = iso; };
  native.addEventListener('pointerdown', prime);
  native.addEventListener('touchstart', prime, { passive: true });
  native.addEventListener('focus', prime);
  // الحاسوب: showPicker() يفتح التقويم من أي نقطة في الزر. الهاتف يفتحه باللمس نفسه، والخطأ هنا لا يضر
  native.addEventListener('click', () => { prime(); try { native.showPicker?.(); } catch { /* المتصفح يفتحه بنفسه */ } });
  // iPhone يرسل القيمة عند «تم» أو عند مغادرة الحقل، وغيره عند الاختيار: نستقبلها في الحالتين
  const take = (e) => {
    e?.stopPropagation?.();
    if (!native.value || native.value === iso) return;
    hidden.value = native.value;
    emit();
  };
  native.addEventListener('change', take);
  native.addEventListener('blur', () => take());
  native.addEventListener('input', (e) => e.stopPropagation());
}

/** يجهّز كل حقول التاريخ الجديدة تلقائياً (الصفحات والنوافذ) */
export function watchDateFields(root = document.body) {
  const run = () => root.querySelectorAll('.date-field:not([data-ready])').forEach(enhance);
  new MutationObserver(run).observe(root, { childList: true, subtree: true });
  run();
}
