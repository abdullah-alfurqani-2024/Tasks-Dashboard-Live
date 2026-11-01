/** إدارة المستخدمين (مدير النظام فقط) */
import { db, isDemo } from '../data/index.js';
import { html, mount, $, formData, on } from '../core/dom.js';
import { state, ROLE_LABELS, loadReference } from '../core/store.js';
import { setTitle, refreshChrome } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { modal, busy, toast, toastError, confirmBox } from '../ui/feedback.js';
import { dataTable } from '../ui/table.js';
import { pageHead, options, loading, newPage, searchBox } from '../ui/parts.js';
import { normalizeAr } from '../core/format.js';
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

function showCredentials(title, email, password) {
  const force = pwRules().forcePasswordChange;
  const text = `البريد: ${email}\nكلمة المرور${force ? ' المؤقتة' : ''}: ${password}\nالرابط: ${location.origin}${location.pathname}${force ? '\n(سيُطلب منك تغيير كلمة المرور عند أول دخول)' : ''}`;
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
    ${pageHead({ title: 'المستخدمون', sub: 'المدير يضيف الحسابات ويحدد الأدوار. لا يوجد تسجيل ذاتي.', actions: html`<button class="btn btn-primary" data-act="new">${icon('plus')}مستخدم جديد</button>` })}
    ${isDemo ? '' : html`<div class="alert small" style="margin-bottom:14px">إضافة المستخدمين وتعطيلهم وإعادة كلمات المرور تتم عبر دالة <span class="ltr">admin-users</span> على Supabase. إذا ظهر خطأ «غير منشورة» راجع دليل التركيب.</div>`}
    <div class="card filters"><div class="field wide">${searchBox('', 'الاسم أو البريد…')}</div></div>
    <div class="card" id="tbl" style="margin-top:14px">${loading()}</div>`);

  let list = [];
  let q = '';
  const columns = [
    { key: 'fullName', label: 'الاسم', render: (u) => html`<b>${u.fullName}</b>${u.id === state.user.id ? html` <span class="badge info">أنت</span>` : ''}${u.shortName ? html`<div class="small muted">${u.shortName}</div>` : ''}` },
    { key: 'email', label: 'البريد', render: (u) => html`<span class="ltr">${u.email}</span>` },
    { key: 'role', label: 'الدور', render: (u) => html`<span class="badge ${ROLE_BADGE[u.role]}">${ROLE_LABELS[u.role]}</span>` },
    { key: 'isActive', label: 'الحالة', render: (u) => (u.isActive ? html`<span class="badge ok">نشط</span>` : html`<span class="badge">معطّل</span>`) },
    { key: 'mustChangePassword', label: 'كلمة المرور', render: (u) => (u.mustChangePassword ? html`<span class="small muted">بانتظار التغيير</span>` : '') },
    { key: 'act', label: '', sort: false, render: (u) => html`<div class="row-actions">
      <button class="btn btn-sm" data-edit="${u.id}">${icon('edit')}تعديل</button>
      <button class="btn btn-sm" data-reset="${u.id}" title="إعادة تعيين كلمة المرور">${icon('key')}</button></div>` },
  ];
  const view = () => list.filter((u) => !q || normalizeAr(`${u.fullName} ${u.shortName} ${u.email}`).includes(q));
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
        <div class="field"><label for="u-email">البريد الإلكتروني <span class="req">*</span></label>
          <input class="input ltr" style="display:block;text-align:left" id="u-email" name="email" type="email" value="${u?.email || ''}" required>
          ${isNew ? '' : html`<span class="hint">تغييره يغيّر بريد الدخول فوراً، وتبقى كلمة المرور كما هي.</span>`}</div>
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
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v.email || '').trim())) return fail('البريد الإلكتروني غير صحيح.');
      if (isNew && (v.password || '').length < pwRules().minPasswordLength) return fail(`كلمة المرور ${pwRules().minPasswordLength} أحرف على الأقل.`);
      if (!isNew && !self && u.isActive && v.isActive === false
        && !(await confirmBox({ title: 'تعطيل الحساب', message: `تعطيل حساب ${u.fullName}؟ لن يستطيع الدخول، وتبقى مهامه محفوظة.`, okText: 'تعطيل', danger: true }))) return;
      await busy($('[data-save]', m.el), async () => {
        try {
          if (isNew) {
            await db.users.create({ email: v.email.trim().toLowerCase(), password: v.password, fullName: v.fullName.trim(), shortName: v.shortName?.trim(), role: v.role });
            m.close();
            showCredentials('تمت إضافة المستخدم', v.email.trim().toLowerCase(), v.password);
          } else {
            const patch = { fullName: v.fullName.trim(), shortName: v.shortName?.trim() || '' };
            const email = v.email.trim().toLowerCase();
            if (email !== u.email) patch.email = email;
            if (!self) { patch.role = v.role; patch.isActive = v.isActive; }
            const saved = await db.users.update(u.id, patch);
            if (self) { Object.assign(state.user, { fullName: saved.fullName, shortName: saved.shortName, email: saved.email }); refreshChrome(); }
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
        showCredentials('كلمة المرور الجديدة', u.email, pw);
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
