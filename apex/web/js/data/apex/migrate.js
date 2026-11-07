/**
 * «تحديث بيانات التجربة من الإنتاج» في نسخة Oracle APEX:
 * نقل كل بيانات نظام الإنتاج (Supabase) إلى قاعدة Oracle.
 *
 * 1) يطلب رقم وكلمة مرور حسابك «مدير النظام» في الإنتاج، ويدخل بهما مباشرة إلى Supabase من متصفحك
 *    (لا تُحفظ في أي مكان، ولا تصل إلى خادم APEX)
 * 2) يقرأ: المستخدمين، والقوائم، والإعدادات، وكل المهام (مع المحذوفة)، وسجل التعديلات كاملاً
 * 3) يرسلها إلى APEX على دفعات (st_api: migrate_begin ثم migrate_tasks ثم migrate_audit ثم migrate_end)
 *
 * الإنتاج يُقرأ فقط ولا يُكتب فيه أبداً.
 * حسابك أنت في APEX يُربط بحسابك في الإنتاج (بنفس الرقم)، وتبقى كلمة مرورك كما هي.
 */
import { html, $ } from '../../core/dom.js';
import { modal } from '../../ui/feedback.js';
import { ApiError } from './index.js';

const iso = (v) => (v ? new Date(v).toISOString() : null);

/** نافذة رقم وكلمة مرور حساب مدير النظام في الإنتاج. تعيد { login, password, ui } أو ترمي عند الإلغاء */
function askCredentials() {
  return new Promise((resolve, reject) => {
    let done = false;
    const m = modal({
      title: 'الدخول إلى نظام الإنتاج (Supabase)', size: 'sm',
      body: html`<div class="stack">
        <div class="alert small">لقراءة بيانات الإنتاج يلزم حساب <b>مدير النظام</b> هناك. يُستخدم الدخول للقراءة فقط، ولا يُحفظ.</div>
        <div class="field"><label for="mg-login">الرقم المدني أو الوظيفي في الإنتاج</label>
          <input class="input ltr" style="display:block;text-align:left" id="mg-login" inputmode="numeric" autocomplete="off" autofocus></div>
        <div class="field"><label for="mg-pw">كلمة المرور في الإنتاج</label>
          <input class="input" id="mg-pw" type="password" autocomplete="off"></div>
        <div class="progress" data-prog hidden><div></div></div>
        <div class="small muted" data-msg></div>
        <div class="alert bad" data-err hidden></div></div>`,
      footer: html`<button class="btn btn-primary" data-ok>متابعة</button><button class="btn" data-x>إلغاء</button>`,
      onClose: () => { if (!done) reject(new ApiError('أُلغي التحديث.')); },
    });
    const ui = {
      progress(text, frac) {
        $('[data-msg]', m.el).textContent = text;
        const bar = $('[data-prog]', m.el);
        bar.hidden = frac == null;
        if (frac != null) bar.firstElementChild.style.width = `${Math.round(frac * 100)}%`;
      },
      error(text) { const e = $('[data-err]', m.el); e.textContent = text; e.hidden = false; },
      lock(on) { m.el.querySelectorAll('input, [data-ok]').forEach((x) => { x.disabled = on; }); },
      close() { done = true; m.close(); },
    };
    const go = () => {
      const login = $('#mg-login', m.el).value.trim();
      const password = $('#mg-pw', m.el).value;
      $('[data-err]', m.el).hidden = true;
      if (!login || !password) { ui.error('اكتب الرقم وكلمة المرور.'); return; }
      resolve({ login, password, ui });
    };
    $('[data-ok]', m.el).onclick = go;
    $('[data-x]', m.el).onclick = () => m.close();
    m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') go(); });
  });
}

export async function migrateFromSupabase({ call, me, config, options }) {
  const P = config.production;
  const { login, password, ui } = await askCredentials();
  ui.lock(true);
  try {
    async function sb(path, { method = 'GET', token, body, headers = {} } = {}) {
      let res;
      try {
        res = await fetch(P.url + path, {
          method,
          headers: {
            apikey: P.anonKey,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new ApiError('تعذّر الاتصال بنظام الإنتاج (Supabase). تحقق من الإنترنت.');
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) throw new ApiError(String(data?.error || data?.message || data?.msg || `خطأ من Supabase (${res.status})`));
      return data;
    }

    // 1) الدخول إلى الإنتاج
    ui.progress('الدخول إلى نظام الإنتاج…');
    const session = await sb(`/functions/v1/${P.loginFunction}`, { method: 'POST', body: { login, password } });
    const token = session?.access_token;
    if (!token) throw new ApiError('تعذّر الدخول إلى نظام الإنتاج.');
    const read = async (table, params) => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = await sb(`/rest/v1/${table}?${new URLSearchParams(params)}`, {
          token, headers: { 'Accept-Profile': P.schema, 'Range-Unit': 'items', Range: `${from}-${from + 999}` },
        });
        out.push(...rows);
        if (rows.length < 1000) break;
      }
      return out;
    };
    const mine = await read('profiles', { id: `eq.${session.user?.id}`, select: 'role,is_active' });
    if (mine[0]?.role !== 'admin' || !mine[0]?.is_active) throw new ApiError('استخدم حساب «مدير النظام» في الإنتاج، فغيره لا يرى كل البيانات.');

    // 2) القراءة (قراءة فقط)
    ui.progress('قراءة المستخدمين والقوائم والإعدادات…');
    let profiles = await read('profiles', { select: 'id,login_no,email,full_name,short_name,role,is_active,created_at', order: 'full_name.asc' });
    const taskTypes = await read('task_types', { select: '*', order: 'id.asc' });
    const corrTypes = await read('correspondence_types', { select: '*', order: 'id.asc' });
    const statuses = await read('task_statuses', { select: '*', order: 'id.asc' });
    let settings = await read('app_settings', { select: 'key,value', order: 'key.asc' });
    ui.progress('قراءة المهام…');
    let tasks = await read('tasks', { select: '*', order: 'id.asc' });
    ui.progress(`قراءة سجل التعديلات… (${tasks.length} مهمة)`);
    let audit = await read('task_audit', { select: '*', order: 'id.asc' });

    // 3) ربط حسابك في APEX بحسابك في الإنتاج (نفس الرقم): كل ما يخص حسابك هناك ينتقل إلى حسابك هنا
    const myId = me.realId || me.id;
    const prodMe = me.loginNo ? profiles.find((p) => p.login_no === me.loginNo) : null;
    const notes = [];
    if (prodMe && prodMe.id !== myId) {
      const swap = (x) => JSON.parse(JSON.stringify(x).split(prodMe.id).join(myId));
      profiles = swap(profiles); tasks = swap(tasks); audit = swap(audit); settings = swap(settings);
    } else if (!prodMe) {
      notes.push({ name: me.fullName, note: 'رقمك غير موجود في الإنتاج، فبقي حسابك هنا مدير نظام إضافياً' });
    }
    profiles = profiles.map((p) => ({ ...p, created_at: iso(p.created_at) }));
    tasks = tasks.map((t) => ({ ...t, created_at: iso(t.created_at), updated_at: iso(t.updated_at), deleted_at: iso(t.deleted_at) }));
    audit = audit.map((a) => ({ ...a, changed_at: iso(a.changed_at) }));

    // 4) الكتابة في APEX على دفعات
    ui.progress('حفظ المستخدمين والقوائم والإعدادات…', 0);
    const begin = await call('migrate_begin', {
      profiles, task_types: taskTypes, correspondence_types: corrTypes, task_statuses: statuses, settings,
      mode: options.mode === 'same' ? 'same' : 'login_no', password: options.password || null, force: !!options.force,
    });
    const total = tasks.length + audit.length || 1;
    let done = 0;
    for (let i = 0; i < tasks.length; i += 300) {
      const rows = tasks.slice(i, i + 300);
      await call('migrate_tasks', { rows });
      done += rows.length;
      ui.progress(`المهام: ${Math.min(i + 300, tasks.length)} من ${tasks.length}`, done / total);
    }
    for (let i = 0; i < audit.length; i += 500) {
      const rows = audit.slice(i, i + 500);
      await call('migrate_audit', { rows });
      done += rows.length;
      ui.progress(`سجل التعديلات: ${Math.min(i + 500, audit.length)} من ${audit.length}`, done / total);
    }
    const end = await call('migrate_end');
    ui.close();
    return {
      users: begin.users, created: begin.created, deactivated: begin.deactivated,
      tasks: end.tasks, skippedTasks: 0, notes: [...notes, ...(begin.notes || [])], at: end.at,
    };
  } catch (e) {
    ui.close();          // يظهر الخطأ في نافذة «تحديث بيانات التجربة»، ويمكن المحاولة مرة أخرى
    throw e;
  }
}
