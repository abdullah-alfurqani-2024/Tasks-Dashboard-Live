/**
 * حقل كتابة مع اختيار من قائمة (الجهة الطالبة من الهيكل، واسم الموظف من قائمة الموظفين).
 * الكتابة تبحث، والاختيار يربط الحقل بعنصر (✓ وتحته وصفه). الكتابة بعد الاختيار تفك الربط.
 * النص غير المختار يبقى نصاً حراً إن سُمح به (free)، وتظهر تحته ملاحظة.
 * الأسهم تتنقل في القائمة، وEnter يختار، وEsc يغلقها. عند التركيز والحقل فارغ: المستخدمة مؤخراً.
 *
 * lookupField(el, { id, value: { id, text }, placeholder, disabled,
 *   search(q) → [item], recent() → [item], item: { id, label, sub?, badge? }, describe(id) → { label, sub } | null,
 *   free: boolean, freeNote, searchOnFocus (البحث بالنص المكتوب عند التركيز), onChange({ id, text }, picked: item|null) })
 *   ← { get value(), set({ id, text }), setFree(bool) }
 */
import { html, mount, $, on, debounce } from '../core/dom.js';
import { icon } from './icons.js';

export function lookupField(el, opts) {
  const { id, placeholder = '', disabled = false, search, recent = () => [], describe = () => null, onChange } = opts;
  let free = !!opts.free;
  let cur = { id: opts.value?.id || null, text: opts.value?.text || '' };
  let items = [], active = -1;
  mount(el, html`<div class="lk"><div class="lk-box">
    <input class="input" id="${id}" value="${cur.text}" autocomplete="off" maxlength="300" placeholder="${placeholder}" ${disabled ? 'disabled' : ''}
      role="combobox" aria-autocomplete="list" aria-expanded="false">
    <div class="lk-list" role="listbox" hidden></div></div>
    <div class="lk-state small" aria-live="polite"></div></div>`);
  const input = $('input', el), list = $('.lk-list', el), state = $('.lk-state', el);

  function drawState() {
    const d = cur.id ? describe(cur.id) : null;
    if (d) {
      mount(state, html`<span class="lk-ok">${icon('check')}</span> ${d.sub ? html`<span class="muted">${d.sub}</span>` : html`<span class="muted">مربوط</span>`}`);
      state.className = 'lk-state small';
    } else if (cur.text) {
      mount(state, free ? html`<span class="lk-free">${opts.freeNote || 'نص حر: ليس في القائمة'}</span>` : opts.pickNote ? html`<span class="muted">${opts.pickNote}</span>` : html`<span class="lk-bad">اختر من القائمة.</span>`);
      state.className = 'lk-state small';
    } else mount(state, '');
    input.classList.toggle('lk-linked', !!d);
    state.title = state.textContent.trim();   // السطر يُختصر بـ«…» إن طال، والنص كاملاً عند المرور عليه
  }

  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
  function draw(rows, title = '') {
    items = rows;
    active = rows.length ? 0 : -1;
    if (!rows.length && !title) { close(); return; }
    mount(list, html`${title ? html`<div class="lk-title small muted">${title}</div>` : ''}
      ${rows.map((x, i) => html`<button type="button" class="lk-opt ${i === active ? 'on' : ''} ${x.id === cur.id ? 'cur' : ''}" role="option" data-i="${i}" tabindex="-1">
        <b>${x.label}</b>${x.badge ? html` <span class="badge">${x.badge}</span>` : ''}${x.sub ? html`<span class="small muted">${x.sub}</span>` : ''}</button>`)}
      ${!rows.length ? html`<div class="small muted lk-empty">${free ? 'لا نتائج؛ يُحفظ النص كما كتبته.' : 'لا نتائج.'}</div>` : ''}`);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  const refresh = () => {
    const q = input.value.trim();
    if (!q) { const r = recent(); r.length ? draw(r, 'المستخدمة مؤخراً') : close(); return; }
    draw(search(q));
  };
  const lazy = debounce(refresh, 120);
  function mark() { list.querySelectorAll('.lk-opt').forEach((b, i) => b.classList.toggle('on', i === active)); list.querySelector('.lk-opt.on')?.scrollIntoView({ block: 'nearest' }); }

  function pick(x) {
    cur = { id: x.id, text: x.label };
    input.value = x.label;
    close(); drawState();
    onChange?.(cur, x);
  }

  input.addEventListener('input', () => {
    const was = cur.id;
    cur = { id: null, text: input.value.trim() };
    drawState();
    if (was) onChange?.(cur, null);
    lazy();
  });
  input.addEventListener('focus', () => { if (!input.value.trim() || (opts.searchOnFocus && !cur.id)) refresh(); });
  input.addEventListener('blur', () => setTimeout(() => { if (!el.contains(document.activeElement)) close(); }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { refresh(); return; }
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      mark();
    } else if (e.key === 'Enter') {
      if (!list.hidden) {
        e.preventDefault(); e.stopPropagation();
        if (input.value.trim()) refresh();   // البحث قبل انتهاء الانتظار: النتائج الحالية أولاً
        if (items[active]) pick(items[active]); else close();
      }
    } else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); e.preventDefault(); close(); }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());   // لا يفقد الحقل التركيز قبل الاختيار
  on(list, 'click', '.lk-opt', (e, b) => pick(items[Number(b.dataset.i)]));
  drawState();

  return {
    get value() { return { ...cur, text: input.value.trim() }; },
    set(v) { cur = { id: v?.id || null, text: v?.text || '' }; input.value = cur.text; close(); drawState(); },
    setFree(v) { free = !!v; drawState(); },
    input,
  };
}
