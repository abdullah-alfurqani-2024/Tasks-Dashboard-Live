/**
 * نقطة البداية: الإطار العام، والمسارات، والصلاحيات لكل صفحة
 */
import { CONFIG } from './config.js';
import { db, isDemo } from './data/index.js';
import { html, mount, $, on } from './core/dom.js';
import { state, can, loadReference, ROLE_LABELS, setReviewCountListener } from './core/store.js';
import { route, fallback, setGuard, start, navigate, currentPath, resolve } from './core/router.js';
import { setChrome, homePath, endSession, stopActing } from './core/session.js';
import { icon } from './ui/icons.js';
import { toast, toastError } from './ui/feedback.js';
import { watchDateFields } from './ui/dateField.js';
import { checkOnStart, watchUpdates } from './core/updates.js';
import { VERSION } from './version.js';
import { activeAnnouncement } from './core/settings.js';

watchDateFields(document.body);

const main = document.getElementById('main');
const topbar = document.getElementById('topbar');

/* ───────────── الصفحات (تُحمّل عند الحاجة) ───────────── */
const NAV = [
  { path: '/dashboard', label: 'لوحة المؤشرات', icon: 'dashboard', page: 'dashboard' },
  { path: '/tasks', label: 'المهام', icon: 'tasks', page: 'tasks' },
  { path: '/report', label: 'التقرير', icon: 'report', page: 'report' },
  { path: '/audit', label: 'سجل التعديلات', icon: 'history', page: 'audit', perm: 'audit.view' },
  { path: '/lists', label: 'القوائم', icon: 'list', page: 'lists', perm: 'lists.manage' },
  { path: '/users', label: 'المستخدمون', icon: 'users', page: 'users', perm: 'users.manage' },
  { path: '/import', label: 'الاستيراد', icon: 'upload', page: 'import', perm: 'import.run' },
  { path: '/settings', label: 'الإعدادات', icon: 'settings', page: 'settings', perm: 'settings.manage' },
];

function page(name) {
  return async (ctx) => {
    window.scrollTo(0, 0);
    try {
      const mod = await import(`./pages/${name}.js`);
      await mod.default(ctx, main);
    } catch (e) {
      console.error(e);
      mount(main, html`<div class="card card-pad"><div class="alert bad">تعذّر فتح الصفحة: ${e.message}</div>
        <p><button class="btn" onclick="location.reload()">إعادة التحميل</button></p></div>`);
    }
    markActive();
  };
}

route('/login', page('login'), { public: true });
route('/password', page('password'), { auth: true });
for (const n of NAV) route(n.path, page(n.page), { perm: n.perm });
fallback(() => navigate(state.user ? homePath() : '/login', { replace: true }));

setGuard((r, path) => {
  const u = state.user;
  if (!u) return r.meta.public ? null : `/login?next=${encodeURIComponent(path)}`;
  if (u.actingAs && path === '/password') return homePath(); // لا تغيير لكلمة المرور أثناء التصفح بحساب آخر
  if (u.mustChangePassword && path !== '/password') return '/password';
  if (r.meta.public) return homePath();
  if (r.meta.perm && !can(r.meta.perm)) return homePath();
  return null;
});

/* ───────────── الشريط العلوي ───────────── */
const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 1).map((w) => w[0]).join('') || '؟';

/** إخفاء الإعلان خاص بكل مستخدم (لا بالمتصفح)، فإخفاؤه في حساب لا يخفيه عن حساب آخر على نفس الجهاز */
const annKey = (u) => `${CONFIG.storagePrefix}announcement.hidden.${u.id}`;

// يختفي الإعلان في لحظة انتهائه حتى لو بقيت الصفحة مفتوحة
let expiryTimer = 0;
function scheduleExpiry(live) {
  clearTimeout(expiryTimer);
  if (!live?.expiresAt) return;
  const ms = Date.parse(live.expiresAt) - Date.now();
  if (ms > 0 && ms < 864e5) expiryTimer = setTimeout(() => renderChrome(), ms + 500);
}

function renderChrome() {
  const u = state.user;
  const banner = document.getElementById('demo-banner');
  if (isDemo) {
    banner.hidden = false;
    mount(banner, html`وضع تجريبي: البيانات وهمية ومحفوظة في متصفحك فقط. لربط قاعدة البيانات اكتب بيانات Supabase في <span class="ltr">js/config.js</span>.`);
  } else if (CONFIG.envLabel) {
    banner.hidden = false;
    banner.classList.add(CONFIG.env === 'dev' ? 'env-dev' : 'env-staging');
    mount(banner, html`${CONFIG.envLabel}`);
  }
  // إعلان مدير النظام: يُخفيه المستخدم لهذا الإعلان فقط، ويعود عند إعلان جديد
  // «مهم»: لا يُخفى. وبعد وقت الانتهاء يختفي تلقائياً
  const ann = document.getElementById('announce-banner');
  const live = u ? activeAnnouncement(state.settings) : null;
  let hidden = '';
  try { if (u) hidden = localStorage.getItem(annKey(u)) || ''; } catch { /* */ }
  const important = live?.type === 'important';
  ann.classList.toggle('important', important);
  if (live && (important || hidden !== live.text)) {
    ann.hidden = false;
    mount(ann, html`<span class="txt">${important ? '⚠️' : '📢'} ${live.text}</span>
      ${important ? '' : html`<button class="btn btn-ghost btn-icon btn-sm" data-act="hide-announcement" aria-label="إخفاء الإعلان" title="إخفاء">${icon('x')}</button>`}`);
  } else { ann.hidden = true; ann.innerHTML = ''; }
  scheduleExpiry(live);
  const asBar = document.getElementById('as-banner');
  if (u?.actingAs) {
    asBar.hidden = false;
    mount(asBar, html`<span>${icon('eye')} أنت تتصفح النظام بحساب: <b>${u.fullName}</b> (${ROLE_LABELS[u.role]})</span>
      <button class="btn btn-sm" data-act="stop-acting">العودة لحسابي</button>`);
  } else { asBar.hidden = true; asBar.innerHTML = ''; }
  document.body.classList.toggle('acting', !!u?.actingAs);
  if (!u) { topbar.hidden = true; topbar.innerHTML = ''; return; }
  topbar.hidden = false;
  const theme = document.documentElement.dataset.theme;
  const links = NAV.filter((n) => !n.perm || can(n.perm));
  mount(topbar, html`
    <button class="btn btn-ghost btn-icon menu-btn" data-act="menu" aria-label="القائمة" aria-expanded="false">${icon('menu')}</button>
    <a class="brand" href="#${homePath()}"><span class="brand-mark">${icon('check')}</span><span class="name">${CONFIG.appName}</span></a>
    <nav class="nav" id="nav" aria-label="القائمة الرئيسية">
      ${links.filter((n) => !n.perm).map((n) => html`<a href="#${n.path}" data-path="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`)}
      ${state.reviewCount ? html`<a href="#/tasks?period=all&review=1" data-path="/review" title="مهام من الاستيراد تحتاج مراجعة">${icon('eye')}<span>تحتاج مراجعة</span><span class="badge warn">${state.reviewCount}</span></a>` : ''}
      ${links.some((n) => n.perm) ? html`<div class="dropdown nav-more">
        <button data-act="more" aria-haspopup="true" aria-expanded="false">${icon('settings')}<span>الإدارة</span><span aria-hidden="true">▾</span></button>
        <div class="dropdown-menu" id="more-menu" hidden>
          ${links.filter((n) => n.perm).map((n) => html`<a href="#${n.path}" data-path="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`)}
        </div></div>` : ''}
    </nav>
    <div class="topbar-end">
      <button class="btn btn-ghost btn-icon" data-act="theme" title="${theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}" aria-label="تبديل الوضع الليلي">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>
      <div class="dropdown">
        <button class="user-chip" data-act="user" aria-haspopup="true" aria-expanded="false">
          <span class="avatar">${initials(u.fullName)}</span>
          <span class="who"><b>${u.shortName || u.fullName.split(' ').slice(0, 2).join(' ')}</b><span>${ROLE_LABELS[u.role]}</span></span>
        </button>
        <div class="dropdown-menu" id="user-menu" hidden>
          <div class="small muted" style="padding:6px 10px">${u.fullName}<br><span class="ltr">${u.loginNo || u.email}</span>
            <br><span title="رقم إصدار النظام: اذكره عند الإبلاغ عن أي مشكلة">الإصدار <span class="ltr">${VERSION}</span></span></div>
          ${u.actingAs ? html`<button data-act="stop-acting">${icon('logout')}العودة لحسابي</button>` : html`
          <a href="#/password">${icon('key')}تغيير كلمة المرور</a>
          ${isDemo ? html`<button data-act="reset-demo">${icon('restore')}إعادة البيانات التجريبية</button>` : ''}
          <button data-act="logout">${icon('logout')}تسجيل الخروج</button>`}
        </div>
      </div>
    </div>`);
  markActive();
}

function markActive() {
  const p = currentPath();
  for (const a of topbar.querySelectorAll('.nav a')) a.classList.toggle('active', a.dataset.path === p);
  $('[data-act="more"]', topbar)?.classList.toggle('active', !!$('#more-menu a.active', topbar));
}

function closeMenus() {
  $('#user-menu', topbar)?.setAttribute('hidden', '');
  $('#more-menu', topbar)?.setAttribute('hidden', '');
  $('[data-act="more"]', topbar)?.setAttribute('aria-expanded', 'false');
  $('[data-act="user"]', topbar)?.setAttribute('aria-expanded', 'false');
  $('#nav', topbar)?.classList.remove('open');
  $('[data-act="menu"]', topbar)?.setAttribute('aria-expanded', 'false');
}

on(topbar, 'click', '[data-act]', async (e, b) => {
  const act = b.dataset.act;
  if (act === 'theme') {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('tsk.theme', t); } catch { /* */ }
    renderChrome();
    window.dispatchEvent(new Event('themechange'));
  } else if (act === 'user') {
    e.stopPropagation();
    const m = $('#user-menu', topbar);
    const open = m.hasAttribute('hidden');
    closeMenus();
    if (open) { m.removeAttribute('hidden'); b.setAttribute('aria-expanded', 'true'); }
  } else if (act === 'more') {
    e.stopPropagation();
    const m = $('#more-menu', topbar);
    const open = m.hasAttribute('hidden');
    closeMenus();
    if (open) { m.removeAttribute('hidden'); b.setAttribute('aria-expanded', 'true'); }
  } else if (act === 'menu') {
    e.stopPropagation();
    const n = $('#nav', topbar);
    const open = !n.classList.contains('open');
    closeMenus();
    n.classList.toggle('open', open);
    b.setAttribute('aria-expanded', String(open));
  } else if (act === 'logout') {
    closeMenus();
    await endSession();
  } else if (act === 'stop-acting') {
    closeMenus();
    await backToAdmin();
  } else if (act === 'reset-demo') {
    db.resetDemo?.();
  }
});
async function backToAdmin(msg) {
  try { await stopActing(); if (msg) toast(msg, 'warn'); } catch (e) { toastError(e); }
}
on(document.getElementById('announce-banner'), 'click', '[data-act="hide-announcement"]', () => {
  try { if (state.user) localStorage.setItem(annKey(state.user), state.settings?.announcement || ''); } catch { /* */ }
  renderChrome();
});
on(document.getElementById('as-banner'), 'click', '[data-act="stop-acting"]', (e, b) => { b.disabled = true; backToAdmin(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown, .nav, .menu-btn')) closeMenus(); });
topbar.addEventListener('click', (e) => { if (e.target.closest('.nav a, .dropdown-menu a')) closeMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

setChrome(renderChrome);
setReviewCountListener(() => { if (state.user) renderChrome(); });

/* ───────────── الإقلاع ───────────── */
async function boot() {
  if (await checkOnStart()) return; // إصدار أحدث على الخادم: يُعاد التحميل تلقائياً
  watchUpdates();
  db.auth.onExpired((kind) => {
    if (kind === 'acting') { if (state.user?.actingAs) backToAdmin('انتهت مدة الدخول بحساب المستخدم، وعدت إلى حسابك.'); return; }
    if (!state.user) return;
    toast('انتهت الجلسة، سجّل الدخول من جديد.', 'warn');
    endSession({ silent: true });
  });
  try {
    state.user = await db.auth.restore();
    if (state.user) await loadReference();
  } catch (e) {
    toastError(e);
    state.user = null;
  }
  renderChrome();
  await start();
}

// إعادة تحميل القوائم عند العودة للتبويب بعد فترة طويلة (تغييرات من مستخدمين آخرين)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (state.user && hiddenAt && Date.now() - hiddenAt > 10 * 60e3) loadReference({ force: true }).catch(() => {});
});

boot();

export { resolve };
