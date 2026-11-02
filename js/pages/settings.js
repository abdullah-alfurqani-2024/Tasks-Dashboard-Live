/** إعدادات النظام (مدير النظام فقط) */
import { CONFIG } from '../config.js';
import { db, backendName, isDemo } from '../data/index.js';
import { html, mount, $, formData } from '../core/dom.js';
import { state, loadReference, refreshReviewCount } from '../core/store.js';
import { PW_FLOOR } from '../core/settings.js';
import { fmtDateTime } from '../core/format.js';
import { setTitle } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { busy, toast, toastError, confirmBox, modal } from '../ui/feedback.js';
import { pageHead, newPage } from '../ui/parts.js';

import { VERSION } from '../version.js';
import { exportTasks } from '../core/exporter.js';

export default async function settings(ctx, main) {
  setTitle('الإعدادات');
  const s = await db.settings.load();
  state.settings = s;
  const root = newPage(main);
  // التجربة (على Supabase): الحذف متاح دائماً. الإنتاج والوضع التجريبي: يحتاج إعداد «السماح بحذف كل المهام» ونسخة احتياطية
  const guarded = isDemo || CONFIG.env !== 'staging';
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
          ${guarded ? html`<h3 style="margin-top:8px">مرحلة التجهيز</h3>
          <label class="check"><input type="checkbox" name="allowPurgeTasks" ${s.allowPurgeTasks ? 'checked' : ''}> السماح بـ«حذف كل المهام»</label>
          <span class="hint">لإعادة الاستيراد من Excel أثناء التجهيز. <b>أطفئه عند بدء العمل الفعلي في النظام</b>، فيرفض الخادم الحذف حتى لو ضُغط الزر.</span>` : ''}
          <div class="alert bad" data-err hidden></div>
          <div><button class="btn btn-primary" type="submit">${icon('check')}حفظ</button></div>
        </div>
      </form>
      <div class="card">
        <div class="card-head"><h2>معلومات النظام</h2></div>
        <div class="card-pad stack small">
          <div>الإصدار: <b class="ltr">${VERSION}</b></div>
          <div>النسخة: <b>${CONFIG.env === 'production' ? 'الإنتاج' : 'التجربة'}</b></div>
          <div>قاعدة البيانات: <b class="ltr">${backendName}</b>${isDemo ? ' (تجريبي — داخل المتصفح)' : html` · السكيما <span class="ltr">${CONFIG.supabase.schema}</span>`}</div>
          ${!isDemo ? html`<div>الخادم: <span class="ltr">${CONFIG.supabase.url}</span></div>` : ''}
          <div>المنطقة الزمنية: <span class="ltr">${CONFIG.timeZone}</span></div>
          <div>وقت الجهاز: ${fmtDateTime(new Date().toISOString())}</div>
          ${isDemo ? html`<div><button class="btn btn-danger" data-reset>${icon('restore')}إعادة البيانات التجريبية</button></div>` : ''}
        </div>
      </div>
      ${CONFIG.env === 'staging' && db.maintenance?.refreshFromProduction ? html`
      <div class="card span-2">
        <div class="card-head"><h2>بيانات نسخة التجربة</h2></div>
        <div class="card-pad stack">
          <p style="margin:0">يستبدل كل بيانات التجربة بنسخة حديثة من الإنتاج: المستخدمون، والقوائم، والإعدادات، وكل المهام.
            ما أضفته أو عدّلته هنا للتجربة سيُحذف. <b>بيانات الإنتاج لا تتغير</b> (تُقرأ فقط).</p>
          <div><button class="btn btn-primary" data-refresh>${icon('download')}تحديث بيانات التجربة من الإنتاج</button></div>
          <div class="small muted" data-refresh-result></div>
        </div>
      </div>` : ''}
      ${db.maintenance?.purgeAllTasks ? html`
      <div class="card span-2">
        <div class="card-head"><h2>حذف كل المهام</h2></div>
        <div class="card-pad stack">
          ${guarded
            ? html`<p style="margin:0">يحذف <b>نهائياً</b> كل المهام وسجل تعديلاتها، لتستورد ملف Excel من جديد.
              قبل الحذف يُنزَّل إلى جهازك ملف Excel بكل المهام الحالية (نسخة احتياطية). المستخدمون والقوائم والإعدادات تبقى كما هي.</p>`
            : html`<p style="margin:0">يحذف <b>نهائياً</b> كل مهام نسخة التجربة وسجل تعديلاتها، لتستورد الملف من جديد. لا يمكن التراجع.
              المستخدمون والقوائم والإعدادات تبقى كما هي، و<b>الإنتاج لا يتأثر</b>.</p>`}
          <div><button class="btn btn-danger" data-purge>${icon('trash')}حذف كل المهام</button></div>
          <div class="small muted" data-purge-off hidden>موقوف: فعّل «السماح بحذف كل المهام» في «قواعد العمل» ثم احفظ.</div>
          <div class="small muted" data-purge-result></div>
        </div>
      </div>` : ''}
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
        state.settings = await db.settings.save({ editLockDays: lock, delayThresholdDays: delay, minPasswordLength: pwMin, forcePasswordChange: v.forcePasswordChange, allowPurgeTasks: !!v.allowPurgeTasks });
        syncPurge();
        toast('تم حفظ الإعدادات.', 'ok');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  };
  $('[data-refresh]', root)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox({ title: 'تحديث بيانات التجربة', message: 'ستُستبدل كل مهام التجربة وسجل تعديلاتها بنسخة من الإنتاج. هل تريد المتابعة؟', okText: 'تحديث', danger: true }))) return;
    await busy(btn, async () => {
      try {
        const r = await db.maintenance.refreshFromProduction();
        await loadReference({ force: true });
        $('[data-refresh-result]', root).textContent = `آخر تحديث: ${fmtDateTime(r.at)} — ${r.users} مستخدم، ${r.tasks} مهمة.`;
        toast(`تم نسخ ${r.tasks} مهمة و${r.users} مستخدماً من الإنتاج.`, 'ok');
      } catch (ex) { toastError(ex); }
    });
  });
  function syncPurge() {
    const btn = $('[data-purge]', root);
    if (!btn || !guarded) return;
    const off = !state.settings?.allowPurgeTasks;
    btn.disabled = off;
    $('[data-purge-off]', root).hidden = !off;
  }
  syncPurge();
  $('[data-purge]', root)?.addEventListener('click', () => {
    const WORD = 'حذف الكل';
    const m = modal({
      title: 'حذف كل المهام', size: 'sm',
      body: html`<form class="stack" novalidate>
        <div class="alert bad">${guarded
          ? html`ستُحذف كل المهام وسجل تعديلاتها <b>نهائياً</b>. سيُنزَّل أولاً ملف Excel بالمهام الحالية، احتفظ به.`
          : html`ستُحذف كل مهام نسخة التجربة وسجل تعديلاتها <b>نهائياً</b>، ولا يمكن استعادتها.`}</div>
        <div class="field"><label for="purge-confirm">للتأكيد اكتب «${WORD}»</label>
          <input class="input" id="purge-confirm" name="confirm" autocomplete="off"></div>
        <div class="alert bad" data-err hidden></div></form>`,
      footer: html`<button class="btn btn-danger" data-ok>${icon('trash')}حذف نهائي</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el), errBox = $('[data-err]', m.el);
    $('[data-x]', m.el).onclick = () => m.close();
    const go = () => busy($('[data-ok]', m.el), async () => {
      errBox.hidden = true;
      if (f.elements.confirm.value.trim() !== WORD) { errBox.textContent = `اكتب «${WORD}» للتأكيد.`; errBox.hidden = false; return; }
      try {
        let saved = 0;
        if (guarded) {
          // نسخة احتياطية قبل الحذف (المهام غير المحذوفة، بنفس أعمدة ملف الاستيراد)
          const all = await db.tasks.list({});
          if (all.length) { exportTasks(all, { format: 'xlsx', name: 'backup_before_delete' }); saved = all.length; }
        }
        const r = await db.maintenance.purgeAllTasks();
        await refreshReviewCount();
        m.close();
        $('[data-purge-result]', root).textContent = `${fmtDateTime(r.at)}: حُذفت ${r.tasks} مهمة.${saved ? ` النسخة الاحتياطية (${saved} مهمة) نُزّلت إلى جهازك.` : ''}`;
        toast(`حُذفت ${r.tasks} مهمة. يمكنك الاستيراد الآن.`, 'ok');
      } catch (ex) { errBox.textContent = ex.message; errBox.hidden = false; }
    });
    $('[data-ok]', m.el).onclick = go;
    f.onsubmit = (ev) => { ev.preventDefault(); go(); };
  });
  $('[data-reset]', root)?.addEventListener('click', async () => {
    if (await confirmBox({ title: 'إعادة البيانات التجريبية', message: 'ستُحذف كل التعديلات التجريبية وتعود البيانات لحالتها الأولى.', okText: 'إعادة', danger: true })) db.resetDemo();
  });
}
