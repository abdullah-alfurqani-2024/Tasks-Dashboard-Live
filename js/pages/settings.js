/** إعدادات النظام (مدير النظام فقط) */
import { CONFIG } from '../config.js';
import { db, backendName, isDemo } from '../data/index.js';
import { html, mount, $, formData } from '../core/dom.js';
import { state } from '../core/store.js';
import { PW_FLOOR } from '../core/settings.js';
import { fmtDateTime } from '../core/format.js';
import { setTitle } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { busy, toast, confirmBox } from '../ui/feedback.js';
import { pageHead, newPage } from '../ui/parts.js';

export const VERSION = '1.0.0';

export default async function settings(ctx, main) {
  setTitle('الإعدادات');
  const s = await db.settings.load();
  state.settings = s;
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'الإعدادات' })}
    <div class="grid grid-2">
      <form class="card" id="set-form" novalidate>
        <div class="card-head"><h2>قواعد العمل</h2></div>
        <div class="card-pad stack">
          <div class="field"><label for="s-lock">مدة قفل التعديل للمهندس (بالأيام)</label>
            <input class="input num" id="s-lock" name="editLockDays" type="number" min="0" max="3650" value="${s.editLockDays}">
            <span class="hint">بعد إنجاز المهمة بهذه المدة لا يستطيع المهندس تعديلها. <b>0 = بدون قفل.</b> المدير ورئيس القسم يعدّلان دائماً.</span></div>
          <div class="field"><label for="s-delay">حد التأخير (بالأيام)</label>
            <input class="input num" id="s-delay" name="delayThresholdDays" type="number" min="1" max="365" value="${s.delayThresholdDays}">
            <span class="hint">المهمة المفتوحة أكثر من هذه المدة تُعد «متأخرة» في المهام ولوحة المؤشرات، وتُلوَّن المدة الأطول منها بالأحمر.</span></div>
          <h3 style="margin-top:8px">كلمات المرور</h3>
          <div class="field"><label for="s-pwmin">أقل طول لكلمة المرور</label>
            <input class="input num" id="s-pwmin" name="minPasswordLength" type="number" min="${PW_FLOOR}" max="72" value="${s.minPasswordLength}">
            <span class="hint">أقل قيمة ممكنة ${PW_FLOOR}، وهو حد خدمة الدخول في Supabase ولا يمكن النزول عنه. إذا رفعتها هنا فارفعها أيضاً في Supabase ← Authentication ← Providers ← Email ← Minimum password length.</span></div>
          <label class="check"><input type="checkbox" name="forcePasswordChange" ${s.forcePasswordChange ? 'checked' : ''}> إلزام المستخدم بتغيير كلمة المرور التي يضعها المدير عند أول دخول</label>
          <div class="alert bad" data-err hidden></div>
          <div><button class="btn btn-primary" type="submit">${icon('check')}حفظ</button></div>
        </div>
      </form>
      <div class="card">
        <div class="card-head"><h2>معلومات النظام</h2></div>
        <div class="card-pad stack small">
          <div>الإصدار: <b class="ltr">${VERSION}</b></div>
          <div>قاعدة البيانات: <b class="ltr">${backendName}</b>${isDemo ? ' (تجريبي — داخل المتصفح)' : ''}</div>
          ${!isDemo ? html`<div>الخادم: <span class="ltr">${CONFIG.supabase.url}</span></div>` : ''}
          <div>المنطقة الزمنية: <span class="ltr">${CONFIG.timeZone}</span></div>
          <div>وقت الجهاز: ${fmtDateTime(new Date().toISOString())}</div>
          ${isDemo ? html`<div><button class="btn btn-danger" data-reset>${icon('restore')}إعادة البيانات التجريبية</button></div>` : ''}
        </div>
      </div>
    </div>`);

  const form = $('#set-form', root);
  const err = $('[data-err]', form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(form);
    const lock = Number(v.editLockDays), delay = Number(v.delayThresholdDays), pwMin = Number(v.minPasswordLength);
    err.hidden = true;
    if (!Number.isInteger(lock) || lock < 0) { err.textContent = 'مدة القفل رقم صحيح 0 أو أكثر.'; err.hidden = false; return; }
    if (!Number.isInteger(delay) || delay < 1) { err.textContent = 'حد التأخير رقم صحيح 1 أو أكثر.'; err.hidden = false; return; }
    if (!Number.isInteger(pwMin) || pwMin < PW_FLOOR || pwMin > 72) { err.textContent = `أقل طول لكلمة المرور بين ${PW_FLOOR} و 72.`; err.hidden = false; return; }
    await busy($('button[type=submit]', form), async () => {
      try {
        state.settings = await db.settings.save({ editLockDays: lock, delayThresholdDays: delay, minPasswordLength: pwMin, forcePasswordChange: v.forcePasswordChange });
        toast('تم حفظ الإعدادات.', 'ok');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  };
  $('[data-reset]', root)?.addEventListener('click', async () => {
    if (await confirmBox({ title: 'إعادة البيانات التجريبية', message: 'ستُحذف كل التعديلات التجريبية وتعود البيانات لحالتها الأولى.', okText: 'إعادة', danger: true })) db.resetDemo();
  });
}
