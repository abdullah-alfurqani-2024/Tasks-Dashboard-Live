/** إدارة المستخدمين (مدير النظام فقط) */
import { db, isDemo } from '../data/index.js';
import { html, mount, $, formData, on } from '../core/dom.js';
import { state, ROLE_LABELS, loadReference } from '../core/store.js';
import { setTitle, refreshChrome, actAs } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { modal, busy, toast, toastError, confirmBox } from '../ui/feedback.js';
import { dataTable } from '../ui/table.js';
import { pageHead, options, loading, newPage, searchBox } from '../ui/parts.js';
import { normalizeAr, latinDigits } from '../core/format.js';
import { CONFIG } from '../config.js';
import { normalizeSettings } from '../core/settings.js';

const pwRules = () => normalizeSettings(state.settings || {});

const ROLE_HELP = {
  admin: 'كل الصلاحيات: المستخدمون، الإعدادات، الحذف والاستعادة، الاستيراد.',
  head: 'يرى كل المهام والتقارير والسجل، ويعدّل أي مهمة، ويدير القوائم. لا يحذف ولا يدير المستخدمين.',
  engineer: 'يرى مهامه فقط، ويضيفها ويعدّلها (حسب مدة القفل). لا يحذف.',
  viewer: 'قراءة فقط: يرى كل المهام والمؤشرات والتقارير دون أي تعديل.',
};
const ROLE_BADGE = { admin: 'bad', head: 'warn', engineer: 'info', viewer: '' };

/** كلمة مرور مؤقتة سهلة القراءة (بدون حروف متشابهة) */
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(a, (n) => chars[n % chars.length]).join('');
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('نُسخ.', 'ok', 1800); } catch { toast('انسخ النص يدوياً.', 'warn'); }
}

function showCredentials(title, u, password) {
  const force = pwRules().forcePasswordChange;
  const who = u.loginNo ? `الرقم: ${u.loginNo}` : `البريد: ${u.email}`;
  const text = `${who}\nكلمة المرور${force ? ' المؤقتة' : ''}: ${password}\nالرابط: ${location.origin}${location.pathname}${force ? '\n(سيُطلب منك تغيير كلمة المرور عند أول دخول)' : ''}`;
  const m = modal({
    title, size: 'sm',
    body: html`<p style="margin-top:0">أرسل هذه البيانات للمستخدم. لن تظهر كلمة المرور مرة أخرى.</p>
      <pre class="input" style="white-space:pre-wrap;direction:rtl;min-height:0;font:inherit">${text}</pre>`,
    footer: html`<button class="btn btn-primary" data-copy>${icon('copy')}نسخ</button><button class="btn" data-x>تم</button>`,
  });
  $('[data-copy]', m.el).onclick = () => copy(text);
  $('[data-x]', m.el).onclick = () => m.close();
}

export default async function users(ctx, main) {
  setTitle('المستخدمون');
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'المستخدمون', sub: 'المدير يضيف الحسابات ويحدد الأدوار. لا يوجد تسجيل ذاتي.', actions: html`<button class="btn" data-act="reset-all">${icon('key')}كلمات المرور للكل</button><button class="btn btn-primary" data-act="new">${icon('plus')}مستخدم جديد</button>` })}
    ${isDemo ? '' : html`<div class="alert small" style="margin-bottom:14px">إضافة المستخدمين وتعطيلهم وإعادة كلمات المرور تتم عبر دالة <span class="ltr">admin-users</span> على Supabase. إذا ظهر خطأ «غير منشورة» راجع دليل التركيب.</div>`}
    <div class="card filters"><div class="field wide">${searchBox('', 'الاسم أو الرقم أو البريد…')}</div></div>
    <div class="card" id="tbl" style="margin-top:14px">${loading()}</div>`);

  let list = [];
  let q = '';
  // الدخول بحساب مستخدم آخر: نسخة التجربة (والوضع التجريبي) فقط
  const canActAs = isDemo || CONFIG.env === 'staging';
  const columns = [
    { key: 'fullName', label: 'الاسم', render: (u) => html`<b>${u.fullName}</b>${u.id === state.user.id ? html` <span class="badge info">أنت</span>` : ''}${u.shortName ? html`<div class="small muted">${u.shortName}</div>` : ''}` },
    { key: 'loginNo', label: 'الرقم', cls: 'num', render: (u) => html`<span class="ltr">${u.loginNo || '—'}</span>` },
    { key: 'email', label: 'البريد', render: (u) => html`<span class="ltr">${u.email || ''}</span>` },
    { key: 'role', label: 'الدور', render: (u) => html`<span class="badge ${ROLE_BADGE[u.role]}">${ROLE_LABELS[u.role]}</span>` },
    { key: 'isActive', label: 'الحالة', render: (u) => (u.isActive ? html`<span class="badge ok">نشط</span>` : html`<span class="badge">معطّل</span>`) },
    { key: 'mustChangePassword', label: 'كلمة المرور', render: (u) => (u.mustChangePassword ? html`<span class="small muted">بانتظار التغيير</span>` : '') },
    { key: 'act', label: '', sort: false, render: (u) => html`<div class="row-actions">
      <button class="btn btn-sm" data-edit="${u.id}">${icon('edit')}تعديل</button>
      <button class="btn btn-sm" data-reset="${u.id}" title="إعادة تعيين كلمة المرور">${icon('key')}</button>
      ${canActAs && u.id !== state.user.id && u.isActive ? html`<button class="btn btn-sm" data-as="${u.id}" title="الدخول بحسابه دون كلمة مروره">${icon('eye')}الدخول بحسابه</button>` : ''}</div>` },
  ];
  const view = () => list.filter((u) => !q || normalizeAr(`${u.fullName} ${u.shortName} ${u.email} ${u.loginNo}`).includes(q));
  let table;
  async function load() {
    try {
      list = await db.users.list();
      state.users = list;
      if (!table) table = dataTable($('#tbl', root), { columns, rows: view(), sortKey: 'fullName', sortDir: 'asc', pageSize: 50 });
      else table.setRows(view());
    } catch (e) { mount($('#tbl', root), html`<div class="card-pad"><div class="alert bad">${e.message}</div></div>`); }
  }

  function form(u) {
    const isNew = !u;
    const self = u?.id === state.user.id;
    const pw = tempPassword();
    const m = modal({
      title: isNew ? 'مستخدم جديد' : `تعديل: ${u.fullName}`,
      body: html`<form class="form-grid" novalidate>
        <div class="field span-2"><label for="u-name">الاسم الكامل <span class="req">*</span></label>
          <input class="input" id="u-name" name="fullName" value="${u?.fullName || ''}" maxlength="200" required></div>
        <div class="field"><label for="u-short">الاسم المختصر</label>
          <input class="input" id="u-short" name="shortName" value="${u?.shortName || ''}" maxlength="60"><span class="hint">يظهر في الجداول والرسوم.</span></div>
        <div class="field"><label for="u-no">الرقم المدني أو الوظيفي <span class="req">*</span></label>
          <input class="input ltr" style="display:block;text-align:left" id="u-no" name="loginNo" inputmode="numeric" maxlength="20" value="${u?.loginNo || ''}">
          <span class="hint">يدخل به المستخدم. أرقام فقط.</span></div>
        <div class="field"><label for="u-email">البريد الإلكتروني (اختياري)</label>
          <input class="input ltr" style="display:block;text-align:left" id="u-email" name="email" type="email" value="${u?.email || ''}">
          <span class="hint">${isNew ? 'يمكن الدخول به أيضاً.' : 'تغييره يغيّر بريد الدخول فوراً، وتبقى كلمة المرور كما هي.'}${CONFIG.env === 'staging' && !isNew ? ' ⚠️ حسابات الدخول مشتركة مع الإنتاج: تغيير البريد هنا يغيّره هناك أيضاً.' : ''}</span></div>
        <div class="field"><label for="u-role">الدور <span class="req">*</span></label>
          <select class="input" id="u-role" name="role" ${self ? 'disabled' : ''}>${options(Object.entries(ROLE_LABELS), u?.role || 'engineer')}</select>
          <span class="hint" id="u-role-help">${ROLE_HELP[u?.role || 'engineer']}</span></div>
        ${isNew ? html`<div class="field"><label for="u-pw">كلمة المرور <span class="req">*</span></label>
          <input class="input ltr" style="display:block;text-align:left" id="u-pw" name="password" value="${pw}" minlength="${pwRules().minPasswordLength}" required>
          <span class="hint">يمكنك كتابة غيرها (${pwRules().minPasswordLength} أحرف على الأقل).${pwRules().forcePasswordChange ? ' سيُطلب تغييرها عند أول دخول.' : ''}</span></div>`
          : html`<div class="field"><span class="label">الحساب</span>
          <label class="check"><input type="checkbox" name="isActive" ${u.isActive ? 'checked' : ''} ${self ? 'disabled' : ''}> نشط (يستطيع الدخول)</label>
          ${self ? html`<span class="hint">لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.</span>` : ''}</div>`}
        <div class="alert bad span-2" data-err hidden></div>
      </form>`,
      footer: html`<button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'إضافة' : 'حفظ'}</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el);
    const err = $('[data-err]', m.el);
    f.elements.role.onchange = () => { $('#u-role-help', m.el).textContent = ROLE_HELP[f.elements.role.value]; };
    $('[data-x]', m.el).onclick = () => m.close();
    const submit = async () => {
      const v = formData(f);
      const fail = (t) => { err.textContent = t; err.hidden = false; };
      if (!v.fullName?.trim()) return fail('اكتب الاسم الكامل.');
      const loginNo = latinDigits(v.loginNo || '').replace(/\s+/g, '');
      const email = (v.email || '').trim().toLowerCase();
      if (!loginNo && !email) return fail('اكتب الرقم المدني أو الوظيفي (أو البريد على الأقل).');
      if (loginNo && !/^[0-9]{1,20}$/.test(loginNo)) return fail('الرقم أرقام فقط (حتى 20 خانة).');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('البريد الإلكتروني غير صحيح.');
      if (isNew && (v.password || '').length < pwRules().minPasswordLength) return fail(`كلمة المرور ${pwRules().minPasswordLength} أحرف على الأقل.`);
      if (!isNew && !self && u.isActive && v.isActive === false
        && !(await confirmBox({ title: 'تعطيل الحساب', message: `تعطيل حساب ${u.fullName}؟ لن يستطيع الدخول، وتبقى مهامه محفوظة.`, okText: 'تعطيل', danger: true }))) return;
      await busy($('[data-save]', m.el), async () => {
        try {
          if (isNew) {
            await db.users.create({ loginNo, email, password: v.password, fullName: v.fullName.trim(), shortName: v.shortName?.trim(), role: v.role });
            m.close();
            showCredentials('تمت إضافة المستخدم', { loginNo, email }, v.password);
          } else {
            const patch = { fullName: v.fullName.trim(), shortName: v.shortName?.trim() || '' };
            if (email !== (u.email || '')) patch.email = email;
            if (loginNo !== (u.loginNo || '')) patch.loginNo = loginNo;
            if (!self) { patch.role = v.role; patch.isActive = v.isActive; }
            const saved = await db.users.update(u.id, patch);
            if (self) { Object.assign(state.user, { fullName: saved.fullName, shortName: saved.shortName, email: saved.email, loginNo: saved.loginNo }); refreshChrome(); }
            toast('تم الحفظ.', 'ok');
            m.close();
          }
          await load();
        } catch (e) { fail(e.message); }
      });
    };
    $('[data-save]', m.el).onclick = submit;
    f.onsubmit = (e) => { e.preventDefault(); submit(); };
  }

  on(root, 'click', '[data-act="new"]', () => form(null));
  on(root, 'click', '[data-act="reset-all"]', () => resetAllDialog());

  /** إعادة تعيين كلمات المرور لكل المستخدمين عدا الحساب الحالي */
  function resetAllDialog() {
    const { minPasswordLength: min, forcePasswordChange } = pwRules();
    const others = list.filter((u) => u.id !== state.user.id);
    const WORD = 'تأكيد';
    const m = modal({
      title: 'إعادة تعيين كلمات المرور للكل',
      body: html`<form class="stack" novalidate>
        <div class="alert warn">
          تتغير كلمة مرور <b>${others.length}</b> مستخدماً، أي كل المستخدمين عدا حسابك أنت. ستتوقف كلماتهم الحالية عن العمل فوراً.
          ${html`<br><b>حسابات الدخول مشتركة بين نسختي التجربة والإنتاج</b>، فالتغيير يسري على الإنتاج أيضاً أينما نُفّذ.`}
        </div>
        <div class="field"><span class="label">كلمة المرور الجديدة</span>
          <label class="check"><input type="radio" name="mode" value="same" checked> كلمة مرور موحدة للجميع</label>
          <input class="input ltr" style="display:block;text-align:left" name="password" value="${tempPassword()}" minlength="${min}" aria-label="كلمة المرور الموحدة">
          <label class="check"><input type="radio" name="mode" value="loginNo"> الرقم المدني/الوظيفي لكل مستخدم</label>
          <span class="hint">من ليس له رقم، أو رقمه أقصر من ${min} خانات (حد Supabase)، يُترك كما هو ويظهر في النتيجة.</span></div>
        <label class="check"><input type="checkbox" name="force" ${forcePasswordChange ? 'checked' : ''}> إلزام كل مستخدم بتغييرها عند أول دخول</label>
        <label class="check"><input type="checkbox" name="includeInactive"> تشمل الحسابات المعطّلة</label>
        <div class="field"><label for="ra-confirm">للتأكيد اكتب كلمة «${WORD}»</label>
          <input class="input" id="ra-confirm" name="confirm" autocomplete="off"></div>
        <div class="alert bad" data-err hidden></div>
      </form>`,
      footer: html`<button class="btn btn-danger" data-save>${icon('key')}إعادة التعيين</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el), err = $('[data-err]', m.el);
    const sync = () => { f.elements.password.disabled = f.elements.mode.value !== 'same'; };
    f.addEventListener('change', sync); sync();
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-save]', m.el).onclick = (e) => busy(e.currentTarget, async () => {
      const v = formData(f);
      const mode = f.elements.mode.value;
      const fail = (t) => { err.textContent = t; err.hidden = false; };
      err.hidden = true;
      if (mode === 'same' && (v.password || '').length < min) return fail(`كلمة المرور ${min} أحرف على الأقل.`);
      if ((v.confirm || '').trim() !== WORD) return fail(`اكتب كلمة «${WORD}» للتأكيد.`);
      try {
        const r = await db.users.resetAll({ mode, password: v.password, force: v.force, includeInactive: v.includeInactive });
        m.close();
        const text = (mode === 'same' ? `كلمة المرور الجديدة للجميع: ${v.password}` : 'كلمة المرور الجديدة: الرقم المدني/الوظيفي لكل مستخدم')
          + `\nالرابط: ${location.origin}${location.pathname}` + (v.force ? '\n(سيُطلب تغييرها عند أول دخول)' : '');
        const res = modal({
          title: 'تمت إعادة التعيين', size: 'sm',
          body: html`<p style="margin-top:0">أُعيد تعيين كلمة مرور <b>${r.reset}</b> مستخدماً.</p>
            ${r.skipped?.length ? html`<div class="alert warn small"><b>لم تتغير (${r.skipped.length}):</b>
              ${r.skipped.map((x) => html`<div>${x.name} — ${x.reason}</div>`)}</div>` : ''}
            <pre class="input" style="white-space:pre-wrap;direction:rtl;min-height:0;font:inherit;margin-top:12px">${text}</pre>`,
          footer: html`<button class="btn btn-primary" data-copy>${icon('copy')}نسخ</button><button class="btn" data-x>تم</button>`,
        });
        $('[data-copy]', res.el).onclick = () => copy(text);
        $('[data-x]', res.el).onclick = () => res.close();
        await load();
      } catch (ex) { fail(ex.message); }
    });
  }
  on(root, 'click', '[data-as]', async (e, b) => {
    const u = list.find((x) => x.id === b.dataset.as);
    if (!u) return;
    const ok = await confirmBox({
      title: 'الدخول بحساب مستخدم',
      message: `ستتصفح نسخة التجربة بحساب «${u.fullName}» بنفس صلاحياته، دون معرفة كلمة مروره ودون تغييرها، ولن يلاحظ ذلك. للعودة اضغط «العودة لحسابي» في الشريط أعلى الصفحة.`,
      okText: 'الدخول بحسابه',
    });
    if (!ok) return;
    await busy(b, async () => {
      try { await actAs(u.id); toast(`أنت الآن بحساب ${u.fullName}.`, 'ok'); } catch (ex) { toastError(ex); }
    });
  });
  on(root, 'click', '[data-edit]', (e, b) => form(list.find((u) => u.id === b.dataset.edit)));
  on(root, 'click', '[data-reset]', async (e, b) => {
    const u = list.find((x) => x.id === b.dataset.reset);
    const { minPasswordLength: min, forcePasswordChange: force } = pwRules();
    const m = modal({
      title: `كلمة مرور جديدة: ${u.fullName}`, size: 'sm',
      body: html`<form novalidate class="stack">
        <div class="field"><label for="r-pw">كلمة المرور الجديدة</label>
          <input class="input ltr" style="display:block;text-align:left" id="r-pw" name="password" value="${tempPassword()}" minlength="${min}" required autofocus>
          <span class="hint">مقترحة عشوائياً، ويمكنك كتابة غيرها (${min} أحرف على الأقل). ستتوقف كلمة المرور الحالية عن العمل${force ? '، وسيُطلب منه تغييرها عند الدخول' : ''}.</span></div>
        <div class="alert bad" data-err hidden></div></form>`,
      footer: html`<button class="btn btn-primary" data-save>${icon('key')}تعيين</button><button class="btn" data-x>إلغاء</button>`,
    });
    const f = $('form', m.el), err = $('[data-err]', m.el);
    $('[data-x]', m.el).onclick = () => m.close();
    const submit = () => busy($('[data-save]', m.el), async () => {
      const pw = f.elements.password.value;
      if (pw.length < min) { err.textContent = `كلمة المرور ${min} أحرف على الأقل.`; err.hidden = false; return; }
      try {
        await db.users.resetPassword(u.id, pw);
        m.close();
        showCredentials('كلمة المرور الجديدة', u, pw);
        await load();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    $('[data-save]', m.el).onclick = submit;
    f.onsubmit = (ev) => { ev.preventDefault(); submit(); };
  });
  root.addEventListener('input', (e) => { if (e.target.name === 'q') { q = normalizeAr(e.target.value); table?.setRows(view()); } });

  await load();
  ctx.onLeave(() => loadReference({ force: true }).catch(() => {}));
}
