/** أجزاء واجهة مشتركة بين الصفحات */
import { html } from '../core/dom.js';
import { PERIODS, periodRange } from '../core/format.js';
import { icon } from './icons.js';
import { dateInput } from './dateField.js';

export const loading = (text = 'جارٍ التحميل…') => html`<div class="boot"><div class="spinner" aria-hidden="true"></div><p>${text}</p></div>`;

export function pageHead({ title, sub = '', actions = '' }) {
  return html`<div class="page-head"><h1>${title}</h1>${actions ? html`<div class="actions">${actions}</div>` : ''}${sub ? html`<div class="sub">${sub}</div>` : ''}</div>`;
}

/** خيارات select. items: [{id,name}] أو [[value,label]] */
export function options(items, selected, empty) {
  const sel = String(selected ?? '');
  return html`${empty != null ? html`<option value="">${empty}</option>` : ''}${items.map((it) => {
    const [v, l] = Array.isArray(it) ? it : [it.id, it.name + (it.isActive === false ? ' (معطّل)' : '')];
    return html`<option value="${v}" ${String(v) === sel ? 'selected' : ''}>${l}</option>`;
  })}`;
}

/** حقول الفترة: قائمة + من/إلى عند «فترة محددة» */
export function periodFields(F) {
  const custom = F.period === 'custom';
  return html`
    <div class="field"><label for="f-period">الفترة</label>
      <select class="input" id="f-period" name="period">${options(PERIODS, F.period)}</select></div>
    <div class="field" ${custom ? '' : 'hidden'} data-custom><label for="f-from">من</label>
      ${dateInput({ name: 'from', id: 'f-from', value: F.from })}</div>
    <div class="field" ${custom ? '' : 'hidden'} data-custom><label for="f-to">إلى</label>
      ${dateInput({ name: 'to', id: 'f-to', value: F.to })}</div>`;
}

/** حساب from/to من حالة الفلتر */
export const rangeOf = (F) => periodRange(F.period, F.from, F.to);

const KIND_CLS = { done: 'ok', open: 'info', cancelled: '' };
export function statusBadge(t, delayed = false) {
  if (t.deletedAt) return html`<span class="badge bad">${icon('trash')}محذوفة</span>`;
  return html`<span class="badge ${delayed ? 'warn' : KIND_CLS[t.statusKind] ?? ''}">${t.status || '—'}${delayed ? ' · متأخرة' : ''}</span>`;
}

export function searchBox(value = '', placeholder = 'بحث…') {
  return html`<div class="search">${icon('search')}<input class="input" type="search" name="q" value="${value}" placeholder="${placeholder}" aria-label="بحث"></div>`;
}

/** عنصر جديد للصفحة داخل main (حتى لا تتراكم مستمعات الأحداث بين الصفحات) */
export function newPage(main) {
  const root = document.createElement('div');
  root.className = 'page';
  main.replaceChildren(root);
  return root;
}
