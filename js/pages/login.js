import { CONFIG } from '../config.js';
import { db, isDemo } from '../data/index.js';
import { html, mount, $, formData } from '../core/dom.js';
import { ROLE_LABELS } from '../core/store.js';
import { navigate } from '../core/router.js';
import { startSession, homePath, setTitle } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { busy } from '../ui/feedback.js';

export default function login(ctx, main) {
  setTitle('تسجيل الدخول');
  mount(main, html`
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="brand"><span class="brand-mark">${icon('check')}</span><span>${CONFIG.appName}</span></div>
        <p class="lead">${CONFIG.orgName}</p>
        <form novalidate>
          <div class="field"><label for="login">الرقم المدني أو الوظيفي</label>
            <input class="input ltr" style="display:block;text-align:left" id="login" name="login" type="text" inputmode="numeric" autocomplete="username" required autofocus>
            <span class="hint">أو البريد الإلكتروني إن كان مسجّلاً لحسابك.</span></div>
          <div class="field"><label for="password">كلمة المرور</label>
            <div class="pw-wrap"><input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" data-eye aria-label="إظهار كلمة المرور">${icon('eye')}</button></div></div>
          <div class="alert bad" id="login-err" role="alert" hidden></div>
          <button class="btn btn-primary btn-block" type="submit">دخول</button>
        </form>
        ${isDemo ? html`<div class="alert warn small" style="margin-top:18px">
          <b>حسابات تجريبية</b> (كلمة المرور <span class="ltr">${db.demoPassword}</span>):
          <div style="display:grid;gap:4px;margin-top:6px">${db.demoAccounts.map((a) => html`
            <button type="button" class="btn btn-sm" data-demo="${a.loginNo}" style="justify-content:space-between">
              <span>${ROLE_LABELS[a.role]}</span><span class="ltr">${a.loginNo}</span></button>`)}</div></div>` : ''}
      </div>
    </div>`);

  const form = $('form', main);
  const errBox = $('#login-err', main);
  $('[data-eye]', main).onclick = (e) => {
    const inp = $('#password', main);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = String(icon(inp.type === 'password' ? 'eye' : 'eyeOff'));
  };
  main.querySelectorAll('[data-demo]').forEach((b) => {
    b.onclick = () => { $('#login', main).value = b.dataset.demo; $('#password', main).value = db.demoPassword; form.requestSubmit(); };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const { login: id, password } = formData(form);
    if (!id.trim() || !password) {
      errBox.textContent = 'اكتب الرقم وكلمة المرور.';
      errBox.hidden = false;
      return;
    }
    await busy($('button[type=submit]', form), async () => {
      try {
        const user = await db.auth.signIn(id, password);
        await startSession(user);
        const next = ctx.query.next && ctx.query.next.startsWith('/') && ctx.query.next !== '/login' ? ctx.query.next : homePath();
        navigate(user.mustChangePassword ? '/password' : next, { replace: true });
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  };
}
