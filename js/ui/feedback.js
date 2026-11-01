/** التنبيهات والنوافذ المنبثقة والتأكيد */
import { html, $, mount } from '../core/dom.js';
import { icon } from './icons.js';

export function toast(message, type = 'info', ms = 4500) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  mount(el, html`<p>${message}</p><button aria-label="إغلاق">${icon('x')}</button>`);
  el.querySelector('button').onclick = () => el.remove();
  box.appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
}

export const toastError = (e) => toast(e?.message || 'حدث خطأ غير متوقع.', 'bad', 7000);

let openCount = 0;

/**
 * نافذة منبثقة. body/footer نص html``. تعيد { el, close }.
 * onClose يُستدعى عند الإغلاق بأي طريقة.
 */
export function modal({ title, body, footer = '', size = '', onClose }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  mount(wrap, html`
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="mt-${openCount}">
      <div class="modal-head"><h2 id="mt-${openCount}">${title}</h2>
        <button class="btn btn-ghost btn-icon close" aria-label="إغلاق">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : ''}
    </div>`);
  openCount++;
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    openCount--;
    if (!openCount) document.body.style.overflow = '';
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $('.close', wrap).onclick = close;
  document.addEventListener('keydown', onKey);
  root.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  setTimeout(() => ($('[autofocus]', wrap) || $('.modal-body input, .modal-body select, .modal-body textarea', wrap) || $('.close', wrap))?.focus(), 30);
  return { el: wrap, close };
}

/** تأكيد بنافذة (يعيد Promise<boolean>) */
export function confirmBox({ title = 'تأكيد', message, okText = 'تأكيد', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title, size: 'sm',
      body: html`<p style="margin:0">${message}</p>`,
      footer: html`<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okText}</button>
        <button class="btn" data-cancel>إلغاء</button>`,
      onClose: () => resolve(result),
    });
    $('[data-ok]', m.el).onclick = () => { result = true; m.close(); };
    $('[data-cancel]', m.el).onclick = () => m.close();
  });
}

/** زر في حالة انتظار أثناء عملية */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + old;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
