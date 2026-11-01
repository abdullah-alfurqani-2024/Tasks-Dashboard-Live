/**
 * جدول بيانات: ترتيب بالنقر على العنوان، وتقسيم صفحات، ونقر على الصف
 *
 * columns: [{ key, label, sort?: (row)=>value, render?: (row)=>html, cls?, thCls? }]
 */
import { html, mount, on } from '../core/dom.js';
import { icon } from './icons.js';

export function dataTable(el, { columns, rows = [], pageSize = 50, sortKey = null, sortDir = 'desc', onRow, rowClass, empty = 'لا توجد بيانات.' }) {
  const st = { rows, page: 1, pageSize, sortKey, sortDir };

  const sorted = () => {
    const col = columns.find((c) => c.key === st.sortKey);
    if (!col) return st.rows;
    const get = col.sort || ((r) => r[col.key]);
    const dir = st.sortDir === 'asc' ? 1 : -1;
    return [...st.rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'ar', { numeric: true }) * dir;
    });
  };

  function draw() {
    const all = sorted();
    const pages = Math.max(1, Math.ceil(all.length / st.pageSize));
    st.page = Math.min(st.page, pages);
    const start = (st.page - 1) * st.pageSize;
    const view = all.slice(start, start + st.pageSize);
    mount(el, html`
      <div class="table-wrap"><table class="table">
        <thead><tr>${columns.map((c) => html`
          <th class="${c.sort !== false ? 'sortable' : ''} ${c.thCls || ''}" data-key="${c.key}" scope="col"
              aria-sort="${st.sortKey === c.key ? (st.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}">
            ${c.label}${st.sortKey === c.key ? html`<span class="arrow">${st.sortDir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`)}
        </tr></thead>
        <tbody>${view.length ? view.map((r, i) => html`
          <tr data-i="${start + i}" class="${onRow ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}">
            ${columns.map((c) => html`<td class="${c.cls || ''}">${c.render ? c.render(r, start + i) : (r[c.key] ?? '')}</td>`)}
          </tr>`) : html`<tr><td colspan="${columns.length}"><div class="empty">${icon('empty')}<div>${empty}</div></div></td></tr>`}
        </tbody></table></div>
      ${all.length > 0 ? html`<div class="table-foot">
        <span>${(start + 1).toLocaleString('en-US')}–${Math.min(start + st.pageSize, all.length).toLocaleString('en-US')} من ${all.length.toLocaleString('en-US')}</span>
        <div class="pager">
          <select class="input" data-size aria-label="عدد الصفوف">${[25, 50, 100, 250].map((n) => html`<option ${n === st.pageSize ? 'selected' : ''}>${n}</option>`)}</select>
          <button class="btn btn-sm" data-page="-1" ${st.page <= 1 ? 'disabled' : ''}>السابق</button>
          <span>${st.page} / ${pages}</span>
          <button class="btn btn-sm" data-page="1" ${st.page >= pages ? 'disabled' : ''}>التالي</button>
        </div></div>` : ''}`);
    st.view = all;
  }

  on(el, 'click', 'th.sortable', (e, th) => {
    const k = th.dataset.key;
    if (st.sortKey === k) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
    else { st.sortKey = k; st.sortDir = 'asc'; }
    draw();
  });
  on(el, 'click', '[data-page]', (e, b) => { st.page += Number(b.dataset.page); draw(); el.scrollIntoView({ block: 'nearest' }); });
  on(el, 'change', '[data-size]', (e, s) => { st.pageSize = Number(s.value); st.page = 1; draw(); });
  if (onRow) {
    on(el, 'click', 'tbody tr[data-i]', (e, tr) => {
      if (e.target.closest('button, a, input, select')) return;
      onRow(st.view[Number(tr.dataset.i)], e);
    });
  }

  draw();
  return {
    setRows(r) { st.rows = r; st.page = 1; draw(); },
    redraw: draw,
    get viewRows() { return st.view || []; },
  };
}
