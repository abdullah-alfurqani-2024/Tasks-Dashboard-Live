/**
 * التحديثات: GitHub Pages يجعل المتصفح يحتفظ بالملفات حتى 10 دقائق،
 * فنقارن رقم الإصدار المحمَّل مع version.json على الخادم:
 *   - عند فتح النظام: إن وُجد إصدار أحدث نجدّد الملفات ونعيد التحميل تلقائياً (مرة واحدة)
 *   - أثناء العمل: نُظهر تنبيهاً بزر «تحديث» ولا نعيد التحميل دون علم المستخدم
 */
import { VERSION } from '../version.js';
import { CONFIG } from '../config.js';
import { html, mount } from './dom.js';

const KEY = `${CONFIG.storagePrefix || 'tsk.'}updatedTo`;

async function latest() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function refresh(info) {
  // تحميل الملفات من الخادم مباشرة لتحديث نسخة المتصفح، ثم إعادة التحميل
  await Promise.all((info.files || []).map((f) => fetch(f, { cache: 'reload' }).catch(() => {})));
  try { sessionStorage.setItem(KEY, info.version); } catch { /* */ }
  location.reload();
}

function showBanner(info) {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar no-print';
  mount(bar, html`<span>يتوفر تحديث جديد للنظام (<span class="ltr">${info.version}</span>). احفظ عملك ثم اضغط «تحديث».</span>
    <button class="btn btn-sm btn-primary" type="button">تحديث</button>`);
  bar.querySelector('button').onclick = () => refresh(info);
  document.body.appendChild(bar);
}

export async function checkOnStart() {
  const info = await latest();
  if (!info || info.version === VERSION) return false;
  let tried = null;
  try { tried = sessionStorage.getItem(KEY); } catch { /* */ }
  if (tried !== info.version) { await refresh(info); return true; }
  showBanner(info); // حاولنا مرة ولم يتحدث (ذاكرة المتصفح عنيدة): نترك القرار للمستخدم
  return false;
}

export function watchUpdates() {
  const check = async () => {
    const info = await latest();
    if (info && info.version !== VERSION) showBanner(info);
  };
  setInterval(check, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
