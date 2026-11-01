import { db } from '../data/index.js';
import { html, mount, $, formData } from '../core/dom.js';
import { state } from '../core/store.js';
import { normalizeSettings } from '../core/settings.js';
import { navigate } from '../core/router.js';
import { homePath, setTitle, refreshChrome } from '../core/session.js';
import { busy, toast } from '../ui/feedback.js';

export default function password(ctx, main) {
  setTitle('تغيير كلمة المرور');
  const forced = state.user.mustChangePassword;
  const min = normalizeSettings(state.settings || {}).minPasswordLength;
  mount(main, html`
    <div class="auth-wrap">
      <div class="card auth-card">
        <h1 style="text-align:center;margin-bottom:6px">تغيير كلمة المرور</h1>
        <p class="lead">${forced ? 'هذا أول دخول لك أو أعاد المدير تعيين كلمة مرورك. اختر كلمة مرور جديدة للمتابعة.' : 'اختر كلمة مرور جديدة لحسابك.'}</p>
        <form novalidate>
          <div class="field"><label for="pw1">كلمة المرور الجديدة</label>
            <input class="input" id="pw1" name="pw1" type="password" autocomplete="new-password" minlength="${min}" required autofocus>
            <span class="hint">${min} أحرف على الأقل.</span></div>
          <div class="field"><label for="pw2">تأكيد كلمة المرور</label>
            <input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password" required></div>
          <div class="alert bad" id="pw-err" role="alert" hidden></div>
          <button class="btn btn-primary btn-block" type="submit">حفظ كلمة المرور</button>
          ${forced ? '' : html`<a class="btn btn-ghost btn-block" href="#${homePath()}">إلغاء</a>`}
        </form>
      </div>
    </div>`);

  const form = $('form', main);
  const errBox = $('#pw-err', main);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { pw1, pw2 } = formData(form);
    const fail = (m) => { errBox.textContent = m; errBox.hidden = false; };
    errBox.hidden = true;
    if (pw1.length < min) return fail(`كلمة المرور يجب أن تكون ${min} أحرف على الأقل.`);
    if (pw1 !== pw2) return fail('كلمتا المرور غير متطابقتين.');
    await busy($('button[type=submit]', form), async () => {
      try {
        await db.auth.changePassword(pw1);
        state.user.mustChangePassword = false;
        toast('تم تغيير كلمة المرور.', 'ok');
        refreshChrome();
        navigate(homePath(), { replace: true });
      } catch (err) { fail(err.message); }
    });
  };
}
