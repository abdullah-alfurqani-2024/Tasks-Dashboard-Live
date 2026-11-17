/**
 * القوائم المنسدلة بخط النظام في فايرفوكس على الحاسوب.
 *
 * فايرفوكس يرسم قائمة <select> وهي مفتوحة، واقتراحات <datalist>، خارج الصفحة (في واجهة المتصفح نفسها)،
 * وهناك لا تصل خطوط الموقع (@font-face)، فتظهر الخيارات بخط Tahoma أو خط الجهاز.
 * (مشكلة معروفة في فايرفوكس: Bugzilla 1536148 و1576820، ولا حل لها من CSS)
 *
 * الحل: نمنع فتح القائمة الأصلية ونعرض بدلها قائمة داخل الصفحة بنفس الخيارات وبخط النظام.
 * عنصر <select> نفسه يبقى في مكانه كما هو، وهو مصدر القيمة، فبقية الكود لا يتغير:
 *   .value / selectedIndex / form.elements / حدثا input وchange يصدران من <select> نفسه كما في المتصفح
 * وحقل الاقتراحات (input مع list) يبقى حقلاً نصياً عادياً، والاقتراحات تُقرأ من <datalist> نفسه.
 *
 * كروم وEdge وSafari والهواتف: لا يتغير شيء (قوائمها الأصلية تعرض الخط صحيحاً، أو منتقي الهاتف).
 */

const FIREFOX = /\bFirefox\//.test(navigator.userAgent);
const MAC = /Mac/.test(navigator.platform || navigator.userAgent);
const MAX_SUGGEST = 100;

let pop = null;     // div.sel-pop
let owner = null;   // select أو input
let mode = '';      // 'select' | 'list'
let items = [];     // [{ el, value, opt, dis }]
let active = -1;
let watcher = null; // يغلق القائمة إن أُزيل صاحبها من الصفحة (إعادة رسم)
let typed = '', typedAt = 0;
let silent = false; // حدث input الذي نرسله نحن لا يعيد فتح الاقتراحات

const usable = (sel) => sel && sel.tagName === 'SELECT' && !sel.multiple && sel.size <= 1 && !sel.matches(':disabled');
const isList = (el) => el && el.tagName === 'INPUT' && el.dataset.list != null;

function close() {
  if (!pop) return;
  pop.remove();
  watcher?.disconnect();
  owner?.removeAttribute('aria-expanded');
  owner?.removeAttribute('aria-activedescendant');
  pop = owner = watcher = null;
  items = []; active = -1; mode = '';
}

function makePop(el, kind) {
  close();
  owner = el; mode = kind;
  pop = document.createElement('div');
  pop.className = 'sel-pop';
  pop.id = 'sel-pop';
  pop.setAttribute('role', 'listbox');
  const cs = getComputedStyle(el);
  pop.dir = cs.direction;
  pop.style.fontSize = cs.fontSize;
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // التركيز يبقى على الحقل
  pop.addEventListener('click', (e) => { const o = e.target.closest('.sel-opt'); if (o) choose(+o.dataset.i); });
  pop.addEventListener('mousemove', (e) => { const o = e.target.closest('.sel-opt'); if (o && +o.dataset.i !== active) setActive(+o.dataset.i, false); });
  watcher = new MutationObserver(() => { if (!owner?.isConnected) close(); });
  watcher.observe(document.body, { childList: true, subtree: true });
}

function addItem(label, value, { opt = null, dis = false, selected = false, grouped = false } = {}) {
  const el = document.createElement('div');
  el.className = 'sel-opt' + (grouped ? ' in-group' : '');
  el.setAttribute('role', 'option');
  el.id = `sel-pop-${items.length}`;
  el.dataset.i = items.length;
  el.textContent = label || ' ';
  el.title = label.length > 40 ? label : '';
  if (dis) el.setAttribute('aria-disabled', 'true');
  if (selected) el.setAttribute('aria-selected', 'true');
  items.push({ el, value, opt, dis });
  pop.append(el);
}

function show() {
  document.body.append(pop);
  owner.setAttribute('aria-expanded', 'true');
  owner.setAttribute('aria-controls', 'sel-pop');
  place();
}

function place() {
  if (!pop) return;
  const r = owner.getBoundingClientRect();
  if (!r.width && !r.height) return close();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  pop.style.maxHeight = 'none';
  pop.style.minWidth = `${r.width}px`;
  pop.style.maxWidth = `${Math.max(r.width, Math.min(480, vw - 16))}px`;
  const want = Math.min(pop.scrollHeight, 320);
  const below = vh - r.bottom - 8, above = r.top - 8;
  const down = below >= want || below >= above;
  const h = Math.max(60, Math.min(want, down ? below : above));
  pop.style.maxHeight = `${h}px`;
  pop.style.top = `${down ? r.bottom + 3 : r.top - 3 - Math.min(pop.offsetHeight, h)}px`;
  const w = pop.offsetWidth;
  const start = pop.dir === 'rtl' ? r.right - w : r.left;
  pop.style.left = `${Math.min(Math.max(8, start), vw - w - 8)}px`;
}

function setActive(i, scroll = true) {
  items[active]?.el.classList.remove('active');
  active = i;
  const it = items[i];
  if (!it) { owner?.removeAttribute('aria-activedescendant'); return; }
  it.el.classList.add('active');
  owner.setAttribute('aria-activedescendant', it.el.id);
  if (scroll) {
    const { offsetTop: t, offsetHeight: h } = it.el;
    if (t < pop.scrollTop) pop.scrollTop = t - 4;
    else if (t + h > pop.scrollTop + pop.clientHeight) pop.scrollTop = t + h - pop.clientHeight + 4;
  }
}

/** الخيار التالي المتاح (يتخطى المعطّل) */
function step(from, dir, count = 1) {
  let i = from, last = from;
  while (count > 0) {
    i += dir;
    if (i < 0 || i >= items.length) break;
    if (!items[i].dis) { last = i; count--; }
  }
  return last;
}

function choose(i) {
  const it = items[i];
  if (!it || it.dis) return;
  const el = owner, kind = mode;
  close();
  el.focus();
  if (kind === 'select') {
    if (it.opt.selected) return;
    it.opt.selected = true;
  } else {
    if (el.value === it.value) return;
    el.value = it.value;
    silent = true;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  silent = false;
}

/* ---------------- <select> ---------------- */

function openSelect(sel) {
  makePop(sel, 'select');
  const add = (o, grouped, groupDis) => {
    if (o.hidden) return;
    addItem(o.label, o.value, { opt: o, dis: o.disabled || groupDis, selected: o.selected, grouped });
  };
  for (const child of sel.children) {
    if (child.tagName === 'OPTGROUP') {
      if (child.hidden) continue;
      const g = document.createElement('div');
      g.className = 'sel-group';
      g.textContent = child.label;
      pop.append(g);
      for (const o of child.children) if (o.tagName === 'OPTION') add(o, true, child.disabled);
    } else if (child.tagName === 'OPTION') add(child, false, false);
  }
  show();
  const cur = items.findIndex((it) => it.opt.selected);
  setActive(cur >= 0 ? cur : step(-1, 1));
}

function typeAhead(key) {
  const now = Date.now();
  typed = now - typedAt > 700 ? key : typed + key;
  typedAt = now;
  const q = typed.toLowerCase();
  const n = items.length;
  const from = typed.length === 1 ? active + 1 : active;
  for (let k = 0; k < n; k++) {
    const i = (from + k + n) % n;
    if (!items[i].dis && items[i].el.textContent.trim().toLowerCase().startsWith(q)) return setActive(i);
  }
}

/* ---------------- <input list> ---------------- */

/** يحوّل list إلى data-list: فايرفوكس لا يعرض اقتراحاته، ونعرضها نحن */
function adoptLists(root = document) {
  root.querySelectorAll?.('input[list]').forEach((inp) => {
    inp.dataset.list = inp.getAttribute('list');
    inp.removeAttribute('list');
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
  });
}

function openList(inp, all = false) {
  const dl = document.getElementById(inp.dataset.list);
  const q = all ? '' : inp.value.trim().toLowerCase();
  const seen = new Set();
  const found = [];
  for (const o of dl?.options || []) {
    const v = o.value;
    if (!v || o.disabled || seen.has(v)) continue;
    seen.add(v);
    if (q && !v.toLowerCase().includes(q)) continue;
    found.push(v);
    if (found.length >= MAX_SUGGEST) break;
  }
  // لا قائمة إن لم يوجد اقتراح، أو كان الاقتراح الوحيد هو المكتوب نفسه
  if (!found.length || (found.length === 1 && found[0] === inp.value)) return close();
  makePop(inp, 'list');
  for (const v of found) addItem(v, v, { selected: v === inp.value });
  show();
  active = -1;
}

/* ---------------- الأحداث ---------------- */

function onMouseDown(e) {
  const t = e.target;
  if (pop && pop.contains(t)) return;
  const sel = t.closest?.('select');
  if (e.button === 0 && usable(sel)) {
    e.preventDefault(); // يمنع القائمة الأصلية
    if (owner === sel) close(); else openSelect(sel);
    sel.focus();
    return;
  }
  if (e.button === 0 && isList(t) && !t.matches(':disabled') && !t.readOnly && document.activeElement === t) {
    // مثل فايرفوكس: النقر على حقل مركّز عليه يعرض كل الاقتراحات
    if (owner === t) close(); else openList(t, true);
    return;
  }
  if (pop && t !== owner) close();
}

function onKeyDown(e) {
  const t = e.target;
  const key = e.key;
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

  if (!pop || t !== owner) {
    if (pop) close();
    if (usable(t) && (key === ' ' || key === 'F4' || ((e.altKey || MAC) && (key === 'ArrowDown' || key === 'ArrowUp')))) {
      stop(); openSelect(t);
    } else if (isList(t) && key === 'ArrowDown' && !e.altKey && !t.readOnly) {
      openList(t);
      if (pop) { stop(); setActive(step(-1, 1)); }
    }
    return;
  }

  if (e.ctrlKey || e.metaKey) return;
  switch (key) {
    case 'ArrowDown': stop(); setActive(active < 0 ? step(-1, 1) : step(active, 1)); break;
    case 'ArrowUp': stop(); setActive(active < 0 ? step(items.length, -1) : step(active, -1)); break;
    case 'PageDown': stop(); setActive(step(active, 1, 8)); break;
    case 'PageUp': stop(); setActive(step(Math.max(active, 0), -1, 8)); break;
    case 'Home': if (mode === 'select') { stop(); setActive(step(-1, 1)); } break;
    case 'End': if (mode === 'select') { stop(); setActive(step(items.length, -1)); } break;
    case 'Escape': stop(); close(); break;
    case 'Tab': close(); break;
    case 'Enter':
      if (mode === 'select' || active >= 0) { stop(); if (active >= 0) choose(active); else close(); }
      else close();
      break;
    case ' ':
      if (mode === 'select') { stop(); if (Date.now() - typedAt < 700) typeAhead(' '); else choose(active); }
      break;
    default:
      if (mode === 'select' && key.length === 1 && !e.altKey) { stop(); typeAhead(key); }
  }
}

function onInput(e) {
  if (silent || !isList(e.target)) return;
  if (e.target === document.activeElement) openList(e.target);
}

function onFocusOut(e) {
  if (pop && e.target === owner) setTimeout(() => { if (pop && document.activeElement !== owner) close(); }, 0);
}

function onScroll(e) {
  if (pop && !(e.target instanceof Node && pop.contains(e.target))) close();
}

/** يُشغَّل مرة واحدة عند فتح النظام. في غير فايرفوكس على الحاسوب لا يفعل شيئاً */
export function watchSelectPopups() {
  if (!FIREFOX || !window.matchMedia?.('(pointer: fine)').matches) return;
  document.documentElement.classList.add('sel-custom');
  adoptLists();
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) {
      if (n.matches('input[list]')) adoptLists(n.parentNode); else adoptLists(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
}
