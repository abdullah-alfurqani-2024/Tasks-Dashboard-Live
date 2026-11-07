/**
 * الدخول — نسخة Oracle APEX
 * صفحة الدخول هي صفحة APEX رقم 9999 (بنفس تصميم النظام)، لأن APEX هي التي تنشئ الجلسة.
 * إذا وصل المستخدم إلى هنا (خروج أو انتهاء الجلسة) نعيده إليها عبر رابط الخروج من APEX.
 */
import { CONFIG } from '../config.js';
import { html, mount } from '../core/dom.js';
import { setTitle } from '../core/session.js';

export default function login(ctx, main) {
  setTitle('تسجيل الدخول');
  mount(main, html`<div class="boot"><div class="spinner" aria-hidden="true"></div><p>جارٍ فتح صفحة الدخول…</p></div>`);
  location.replace(CONFIG.apex.logoutUrl || location.pathname);
}
