/**
 * تقويم داخل الصفحة بخط النظام (الحاسوب، كل المتصفحات).
 *
 * تقويم المتصفح الأصلي (input type=date) يرسمه المتصفح نفسه بخط الجهاز ولغته، فلا يتبع خط النظام.
 * على الحاسوب يُعرض هذا بدله من زر التقويم في حقل التاريخ (js/ui/dateField.js).
 * على الهواتف يبقى منتقي التاريخ الخاص بالهاتف كما هو (الإصدار 1.19.1).
 *
 * الأسبوع يبدأ بالأحد. التواريخ نصوص 'YYYY-MM-DD' كبقية النظام.
 */
import { MONTHS, today } from '../core/format.js';

// سهم: يمين = السابق، يسار = التالي (اتجاه الصفحة من اليمين لليسار)
const ARROW = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d === 'r' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'}"/></svg>`;

const DAYS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

let pop = null;
let box = null;      // .date-field صاحب التقويم
let opts = null;     // { value, required, onPick }
let view = 'days';   // 'days' | 'months'
let y = 0, m = 0;    // الشهر المعروض (m من 0)
let focus = '';      // اليوم المحدد بلوحة المفاتيح
let watcher = null;

const pad = (n) => String(n).padStart(2, '0');
const iso = (yy, mm, dd) => { const d = new Date(Date.UTC(yy, mm, dd)); return d.toISOString().slice(0, 10); };
const parts = (s) => { const [a, b, c] = s.split('-').map(Number); return [a, b - 1, c]; };
const addDays = (s, n) => { const [a, b, c] = parts(s); return iso(a, b, c + n); };
const addMonths = (s, n) => {
  const [a, b, c] = parts(s);
  const last = new Date(Date.UTC(a, b + n + 1, 0)).getUTCDate();
  return iso(a, b + n, Math.min(c, last));
};

export const calendarOwner = () => box;

export function closeCalendar() {
  if (!pop) return;
  pop.remove();
  watcher?.disconnect();
  pop = box = opts = watcher = null;
}

/** يفتح التقويم تحت حقل التاريخ. onPick(iso) ('' = مسح) */
export function openCalendar(field, { value = '', required = false, onPick }) {
  closeCalendar();
  box = field; opts = { value, required, onPick };
  focus = value || today();
  [y, m] = parts(focus);
  view = 'days';
  pop = document.createElement('div');
  pop.className = 'cal-pop';
  pop.dir = 'rtl';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'التقويم');
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // التركيز يبقى في حقل التاريخ
  pop.addEventListener('click', onClick);
  pop.addEventListener('wheel', (e) => { if (view === 'days') { e.preventDefault(); move(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
  render();
  document.body.append(pop);
  place();
  watcher = new MutationObserver(() => { if (!box?.isConnected) closeCalendar(); });
  watcher.observe(document.body, { childList: true, subtree: true });
}

function move(months) {
  const d = new Date(Date.UTC(y, m + months, 1));
  y = d.getUTCFullYear(); m = d.getUTCMonth();
  render();
}

function render() {
  const t = today();
  if (view === 'months') {
    pop.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-12" aria-label="السنة السابقة">${ARROW('r')}</button>
        <button type="button" class="cal-title" data-view="days">${y}</button>
        <button type="button" class="cal-nav" data-nav="12" aria-label="السنة التالية">${ARROW('l')}</button>
      </div>
      <div class="cal-months">${MONTHS.map((name, i) => {
        const cls = ['cal-month', i === m ? 'sel' : '', `${y}-${pad(i + 1)}` === t.slice(0, 7) ? 'today' : ''].join(' ');
        return `<button type="button" class="${cls}" data-month="${i}">${name}</button>`;
      }).join('')}</div>`;
    return;
  }
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = iso(y, m, i - first + 1);
    const out = Number(d.slice(5, 7)) - 1 !== m;
    const cls = ['cal-day', out ? 'out' : '', d === t ? 'today' : '', d === opts.value ? 'sel' : '', d === focus ? 'focus' : ''].join(' ');
    cells.push(`<button type="button" class="${cls}" data-day="${d}" tabindex="-1" aria-label="${DAY_NAMES[i % 7]} ${d.replace(/-/g, '/')}">${Number(d.slice(8))}</button>`);
  }
  pop.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="الشهر السابق">${ARROW('r')}</button>
      <button type="button" class="cal-title" data-view="months" title="اختيار الشهر والسنة">${MONTHS[m]} ${y}</button>
      <button type="button" class="cal-nav" data-nav="1" aria-label="الشهر التالي">${ARROW('l')}</button>
    </div>
    <div class="cal-grid">${DAYS.map((d, i) => `<span class="cal-dow" title="${DAY_NAMES[i]}">${d}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-foot">
      <button type="button" class="btn btn-sm" data-pick="${t}">اليوم</button>
      ${opts.required ? '' : '<button type="button" class="btn btn-sm btn-ghost" data-pick="">مسح</button>'}
    </div>`;
}

function place() {
  const r = box.getBoundingClientRect();
  if (!r.width && !r.height) return closeCalendar();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const down = vh - r.bottom - 8 >= h || vh - r.bottom >= r.top;
  pop.style.top = `${Math.max(8, down ? r.bottom + 3 : r.top - 3 - h)}px`;
  pop.style.left = `${Math.min(Math.max(8, r.right - w), vw - w - 8)}px`;
}

function pick(v) {
  const cb = opts.onPick;
  closeCalendar();
  cb(v);
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.day) return pick(b.dataset.day);
  if (b.dataset.pick != null) return pick(b.dataset.pick);
  if (b.dataset.nav) return move(Number(b.dataset.nav));
  if (b.dataset.view) { view = b.dataset.view; return render(); }
  if (b.dataset.month) { m = Number(b.dataset.month); view = 'days'; focus = iso(y, m, Math.min(Number(focus.slice(8)), new Date(Date.UTC(y, m + 1, 0)).getUTCDate())); render(); }
}

function setFocus(d) {
  focus = d;
  [y, m] = parts(d);
  view = 'days';
  render();
}

/** مفاتيح حقل التاريخ والتقويم مفتوح. يرجع true إن عالج المفتاح */
export function calendarKey(e) {
  if (!pop) return false;
  const k = e.key;
  // اتجاه الصفحة من اليمين لليسار: السهم الأيسر = اليوم التالي
  const steps = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 };
  if (k in steps && !e.altKey) { setFocus(addDays(focus, steps[k])); return true; }
  if (k === 'PageDown' || k === 'PageUp') { setFocus(addMonths(focus, (k === 'PageDown' ? 1 : -1) * (e.shiftKey ? 12 : 1))); return true; }
  if (k === 'Enter') { pick(focus); return true; }
  if (k === 'Escape' || (e.altKey && k === 'ArrowUp')) { closeCalendar(); return true; }
  if (k === 'Tab') { closeCalendar(); return false; }
  return false;
}

// الإغلاق: نقرة خارج التقويم، أو تمرير الصفحة، أو تغيير حجم النافذة
document.addEventListener('mousedown', (e) => {
  if (pop && !pop.contains(e.target) && !e.target.closest?.('.date-btn')) closeCalendar();
}, true);
document.addEventListener('scroll', (e) => { if (pop && !(e.target instanceof Node && pop.contains(e.target))) closeCalendar(); }, true);
window.addEventListener('resize', closeCalendar);
window.addEventListener('blur', closeCalendar);
