// محاكاة Supabase (GoTrue + PostgREST) لتشغيل دوال Edge محلياً
const handlers = {};
let current = '';
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] },
  serve: (fn) => { handlers[current] = fn; },
};

const auth = new Map();          // id -> { email, password, banned }
const db = { support_tasks: [], support_tasks_staging: [] }; // profiles
let seq = 0;
const links = new Map();         // hashed_token -> user id
const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function match(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    if (op === 'eq' && String(row[k] ?? '') !== val) return false;
    if (op === 'neq' && String(row[k] ?? '') === val) return false;
  }
  return true;
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body ? JSON.parse(init.body) : {};
  if (u.pathname === '/auth/v1/user') {
    const id = (h.authorization || '').replace('Bearer tok-', '');
    return auth.has(id) ? J({ id }) : J({ msg: 'bad jwt' }, 401);
  }
  if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
    if ([...auth.values()].some((a) => a.email === body.email)) return J({ msg: 'A user with this email address has already been registered' }, 422);
    const id = `id${++seq}`; auth.set(id, { email: body.email, password: body.password }); return J({ id });
  }
  if (u.pathname === '/auth/v1/admin/generate_link') {
    const e = [...auth.entries()].find(([, a]) => a.email === body.email);
    if (!e) return J({ msg: 'User not found' }, 404);
    links.set(`hash-${e[0]}`, e[0]);
    return J({ id: e[0], email: body.email, action_link: 'https://x', email_otp: '123456', hashed_token: `hash-${e[0]}`, verification_type: 'magiclink' });
  }
  if (u.pathname === '/auth/v1/verify') {
    const id = links.get(body.token_hash);
    if (!id || body.type !== 'magiclink') return J({ msg: 'Token has expired or is invalid' }, 403);
    links.delete(body.token_hash);
    if (auth.get(id).banned) return J({ msg: 'User is banned' }, 400);
    return J({ access_token: `tok-${id}`, refresh_token: 'r-secret', expires_in: 3600, expires_at: 9999999999, user: { id } });
  }
  const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (m) {
    const a = auth.get(m[1]); if (!a) return J({ msg: 'not found' }, 404);
    if (method === 'DELETE') { auth.delete(m[1]); return J({}); }
    if (body.email !== undefined) {
      if (body.email === '') return J({ msg: 'Unable to validate email address: invalid format' }, 400); // GoTrue يرفض البريد الفارغ
      if ([...auth.entries()].some(([i, x]) => i !== m[1] && x.email === body.email)) return J({ msg: 'already been registered' }, 422);
      a.email = body.email;
    }
    if (body.password) a.password = body.password;
    if (body.ban_duration) a.banned = body.ban_duration !== 'none';
    return J({ id: m[1] });
  }
  if (u.pathname === '/auth/v1/token') {
    const e = [...auth.entries()].find(([, a]) => a.email === body.email && a.password === body.password);
    if (!e) return J({ error_description: 'Invalid login credentials' }, 400);
    if (e[1].banned) return J({ msg: 'User is banned' }, 400);
    return J({ access_token: `tok-${e[0]}`, refresh_token: 'r', expires_in: 3600, user: { id: e[0] } });
  }
  if (u.pathname.startsWith('/rest/v1/')) {
    const table = u.pathname.slice(9);
    const schema = h['content-profile'] && method !== 'GET' ? h['content-profile'] : h['accept-profile'];
    if (table === 'app_settings') return J(globalThis.SETTINGS || []);
    const rows = db[schema];
    const params = [...u.searchParams];
    if (method === 'GET') return J(rows.filter((r) => match(r, params)));
    if (method === 'POST') {
      if (body.login_no && rows.some((r) => r.login_no === body.login_no)) return J({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_login_no_key"' }, 409);
      const r = { is_active: true, ...body }; rows.push(r); return J([r]);
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => match(r, params));
      if (body.email === '') return J({ code: '23514', message: 'email empty' }, 400);
      hit.forEach((r) => Object.assign(r, body)); return J(hit);
    }
  }
  throw new Error('unmocked ' + method + ' ' + url);
};

current = 'admin'; await import('./.build/admin-users.mjs');
current = 'login'; await import('./.build/auth-login.mjs');

const call = async (fn, path, body, token) => {
  const res = await handlers[fn](new Request(`https://sb.test/functions/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

// ---------- البيانات الأولية: مدير ومهندس ببريد حقيقي في السكيمتين ----------
auth.set('admin', { email: 'admin@x.om', password: 'pw-admin' });
auth.set('eng', { email: 'eng@x.om', password: 'pw-eng' });
for (const s of Object.keys(db)) {
  db[s].push({ id: 'admin', email: 'admin@x.om', role: 'admin', is_active: true, login_no: null, full_name: 'المدير' });
  db[s].push({ id: 'eng', email: 'eng@x.om', role: 'engineer', is_active: true, login_no: null, full_name: 'مهندس' });
}
const T = 'tok-admin';
const prof = (s, id) => db[s].find((r) => r.id === id);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? '✅' : '❌', name, cond ? '' : extra); };

// 1) إضافة رقم دون لمس البريد (الحالة التي سببت المشكلة)
let r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', login_no: '0012345', full_name: 'مهندس', short_name: '' }, T);
ok('إضافة رقم: نجاح', r.status === 200, JSON.stringify(r));
ok('إضافة رقم: البريد في الملف الشخصي باقٍ', prof('support_tasks_staging', 'eng').email === 'eng@x.om', prof('support_tasks_staging', 'eng').email);
ok('إضافة رقم: بريد الدخول باقٍ', auth.get('eng').email === 'eng@x.om');
ok('إضافة رقم: الإنتاج لم يتأثر', prof('support_tasks', 'eng').login_no === null);

// 2) الدخول بالرقم ثم مرة ثانية ثم بالبريد
for (const i of [1, 2, 3]) {
  r = await call('login', 'auth-login-staging', { login: '0012345', password: 'pw-eng' });
  ok(`الدخول بالرقم (مرة ${i})`, r.status === 200 && r.body.access_token === 'tok-eng', JSON.stringify(r));
}
r = await call('login', 'auth-login-staging', { login: '٠٠١٢٣٤٥', password: 'pw-eng' });
ok('الدخول بأرقام عربية', r.status === 200);
r = await call('login', 'auth-login-staging', { login: 'eng@x.om', password: 'pw-eng' });
ok('الدخول بالبريد ما زال يعمل', r.status === 200);
r = await call('login', 'auth-login-staging', { login: '0012345', password: 'wrong' });
ok('كلمة مرور خاطئة: رسالة عامة', r.status === 400 && /الرقم أو كلمة المرور/.test(r.body.error));
r = await call('login', 'auth-login-staging', { login: '999', password: 'pw-eng' });
ok('رقم غير موجود: نفس الرسالة', r.status === 400 && /الرقم أو كلمة المرور/.test(r.body.error));
r = await call('login', 'auth-login', { login: '0012345', password: 'pw-eng' });
ok('رقم التجربة لا يعمل في الإنتاج', r.status === 400);

// 3) تعديل الاسم فقط بعد الرقم (حفظ مرة ثانية)
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', full_name: 'مهندس معدّل', short_name: '' }, T);
ok('حفظ ثانٍ: البريد باقٍ', prof('support_tasks_staging', 'eng').email === 'eng@x.om' && auth.get('eng').email === 'eng@x.om');

// 4) مسح البريد عمداً ← بريد داخلي، والدخول بالرقم يعمل
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', email: '' }, T);
ok('مسح البريد ← بريد داخلي', prof('support_tasks_staging', 'eng').email === 'n0012345@tasks.internal' && auth.get('eng').email === 'n0012345@tasks.internal', JSON.stringify(r));
r = await call('login', 'auth-login-staging', { login: '0012345', password: 'pw-eng' });
ok('الدخول بالرقم بعد مسح البريد', r.status === 200);

// 5) تغيير الرقم لمن بريده داخلي ← البريد الداخلي يتبعه
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', login_no: '777' }, T);
ok('تغيير الرقم: البريد الداخلي يتبعه', auth.get('eng').email === 'n777@tasks.internal' && prof('support_tasks_staging', 'eng').email === 'n777@tasks.internal');
r = await call('login', 'auth-login-staging', { login: '777', password: 'pw-eng' });
ok('الدخول بالرقم الجديد', r.status === 200);

// 6) إضافة بريد حقيقي من جديد
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', email: 'Eng2@x.om' }, T);
ok('إضافة بريد حقيقي', auth.get('eng').email === 'eng2@x.om' && prof('support_tasks_staging', 'eng').email === 'eng2@x.om');

// 7) منع مسح الرقم والبريد معاً
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', login_no: '', email: '' }, T);
ok('لا يمكن ترك الحساب بلا رقم ولا بريد', r.status === 400);

// 8) مستخدم جديد برقم فقط
r = await call('admin', 'admin-users-staging', { action: 'create', login_no: '5555', email: '', password: 'pw-new-1', full_name: 'جديد', role: 'engineer' }, T);
ok('إنشاء برقم فقط', r.status === 200 && r.body.user.email === 'n5555@tasks.internal', JSON.stringify(r));
r = await call('login', 'auth-login-staging', { login: '5555', password: 'pw-new-1' });
ok('دخول المستخدم الجديد بالرقم', r.status === 200);
r = await call('admin', 'admin-users-staging', { action: 'create', login_no: '5555', password: 'pw-new-1', full_name: 'مكرر', role: 'engineer' }, T);
ok('رقم مكرر عند الإنشاء', r.status === 400 && /الرقم/.test(r.body.error));
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'admin', login_no: '777' }, T);
ok('رقم مكرر عند التعديل', r.status === 400 && /الرقم/.test(r.body.error));

// 8ب) الرقم إلزامي، وكلمة المرور الافتراضية = الرقم
r = await call('admin', 'admin-users-staging', { action: 'create', email: 'only@x.om', password: 'pw-only-1', full_name: 'بريد فقط', role: 'engineer' }, T);
ok('إنشاء بلا رقم مرفوض', r.status === 400 && /الرقم/.test(r.body.error), JSON.stringify(r));
r = await call('admin', 'admin-users-staging', { action: 'create', login_no: '66778899', full_name: 'بلا كلمة', role: 'engineer' }, T);
ok('إنشاء بلا كلمة مرور ← الرقم', r.status === 200 && [...auth.values()].some((a) => a.email === 'n66778899@tasks.internal' && a.password === '66778899'), JSON.stringify(r));
r = await call('login', 'auth-login-staging', { login: '66778899', password: '66778899' });
ok('الدخول بالرقم ككلمة مرور', r.status === 200);
r = await call('admin', 'admin-users-staging', { action: 'create', login_no: '321', full_name: 'رقم قصير جديد', role: 'engineer' }, T);
ok('رقم أقصر من 6 بلا كلمة مرور: يُطلب كتابتها', r.status === 400 && /كلمة المرور/.test(r.body.error));
r = await call('admin', 'admin-users-staging', { action: 'create', login_no: '321', password: 'longer-pw', full_name: 'رقم قصير جديد', role: 'engineer' }, T);
ok('رقم قصير مقبول مع كلمة مرور مكتوبة', r.status === 200);
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'eng', login_no: '' }, T);
ok('مسح الرقم مرفوض', r.status === 400 && /الرقم/.test(r.body.error));
db.support_tasks_staging.push({ id: 'nono', email: 'nono@x.om', role: 'engineer', is_active: true, login_no: null, full_name: 'بلا رقم' });
auth.set('nono', { email: 'nono@x.om', password: 'pw-nono' });
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'nono', full_name: 'بلا رقم 2' }, T);
ok('تعديل مستخدم بلا رقم دون إضافة رقم: مرفوض', r.status === 400 && /الرقم/.test(r.body.error));
r = await call('admin', 'admin-users-staging', { action: 'update', id: 'nono', full_name: 'صار له رقم', login_no: '9988776' }, T);
ok('تعديل مع إضافة الرقم: ينجح والبريد باقٍ', r.status === 200 && auth.get('nono').email === 'nono@x.om');

// 9) إعادة تعيين كلمات المرور للكل
auth.set('off', { email: 'off@x.om', password: 'pw-off' });
db.support_tasks_staging.push({ id: 'off', email: 'off@x.om', role: 'engineer', is_active: false, login_no: '4444444', full_name: 'معطّل' });
db.support_tasks_staging.push({ id: 'short', email: 'short@x.om', role: 'engineer', is_active: true, login_no: '12', full_name: 'رقم قصير' });
auth.set('short', { email: 'short@x.om', password: 'pw-short' });
r = await call('admin', 'admin-users-staging', { action: 'reset_all', mode: 'same', password: '123', force: true }, T);
ok('الكل: كلمة موحدة قصيرة مرفوضة', r.status === 400);
r = await call('admin', 'admin-users-staging', { action: 'reset_all', mode: 'same', password: 'Test2026', force: true }, T);
ok('الكل: موحدة', r.status === 200 && auth.get('eng').password === 'Test2026' && auth.get('id1')?.password === 'Test2026', JSON.stringify(r.body));
ok('الكل: المنفّذ نفسه لم يتغير', auth.get('admin').password === 'pw-admin');
ok('الكل: المعطّل تُرك', auth.get('off').password === 'pw-off' && r.body.skipped.some((x) => x.reason === 'حساب معطّل'));
ok('الكل: إلزام التغيير', prof('support_tasks_staging', 'eng').must_change_password === true);
r = await call('admin', 'admin-users-staging', { action: 'reset_all', mode: 'login_no', force: false, include_inactive: true }, T);
ok('الكل: بالرقم ينجح', r.status === 200 && r.body.reset >= 1, JSON.stringify(r.body));
ok('الكل: الرقم القصير تُرك مع السبب', r.body.skipped.some((x) => x.name === 'رقم قصير'));
ok('الكل: المعطّل شُمل عند الطلب', auth.get('off').password === '4444444');
ok('الكل: بدون إلزام التغيير', prof('support_tasks_staging', 'off').must_change_password === false);
r = await call('admin', 'admin-users-staging', { action: 'reset_all', mode: 'same', password: 'Test2026' }, 'tok-eng');
ok('الكل: غير المدير مرفوض', r.status === 403 || r.status === 401 || r.status === 400, JSON.stringify(r));
// حساب مزامنة التجربة يُستثنى دائماً
auth.set('sync', { email: 'sync@x.om', password: 'pw-sync' });
db.support_tasks_staging.push({ id: 'sync', email: 'sync@x.om', role: 'viewer', is_active: true, login_no: '5000500', full_name: 'مزامنة التجربة' });
globalThis.SETTINGS = [{ key: 'sync_user_id', value: 'sync' }];
r = await call('admin', 'admin-users-staging', { action: 'reset_all', mode: 'same', password: 'Other2026', force: true }, T);
ok('الكل: حساب المزامنة لم يتغير', r.status === 200 && auth.get('sync').password === 'pw-sync' && auth.get('eng').password === 'Other2026', JSON.stringify(r.body));
ok('الكل: حساب المزامنة مذكور في النتيجة', r.body.skipped.some((x) => x.name === 'مزامنة التجربة' && /مزامنة/.test(x.reason)));
r = await call('admin', 'admin-users-staging', { action: 'reset_password', id: 'sync', password: 'NewSync2026' }, T);
ok('حساب المزامنة: تغيير فردي يعمل بلا إلزام تغيير', r.status === 200 && r.body.sync === true && auth.get('sync').password === 'NewSync2026' && prof('support_tasks_staging', 'sync').must_change_password === false);
globalThis.SETTINGS = [];

// 10) الدخول بحساب مستخدم آخر (التجربة فقط)
const pwBefore = auth.get('eng').password;
r = await call('admin', 'admin-users-staging', { action: 'impersonate', id: 'eng' }, T);
ok('الدخول بحسابه: نجاح', r.status === 200 && r.body.session.access_token === 'tok-eng' && r.body.name, JSON.stringify(r));
ok('الدخول بحسابه: بلا رمز تجديد', r.status === 200 && !r.body.session.refresh_token);
ok('الدخول بحسابه: كلمة مروره لم تتغير', auth.get('eng').password === pwBefore);
r = await call('admin', 'admin-users', { action: 'impersonate', id: 'eng' }, T);
ok('الدخول بحسابه: مرفوض في الإنتاج', r.status === 403 && /التجربة/.test(r.body.error), JSON.stringify(r));
r = await call('admin', 'admin-users-staging', { action: 'impersonate', id: 'admin' }, T);
ok('الدخول بحسابه: ليس لنفسك', r.status === 400);
r = await call('admin', 'admin-users-staging', { action: 'impersonate', id: 'off' }, T);
ok('الدخول بحسابه: المعطّل في التجربة مرفوض', r.status === 400 && /معطّل/.test(r.body.error));
r = await call('admin', 'admin-users-staging', { action: 'impersonate', id: 'eng' }, 'tok-short');
ok('الدخول بحسابه: لغير المدير مرفوض', r.status === 403, JSON.stringify(r));
auth.get('short').banned = true;
r = await call('admin', 'admin-users-staging', { action: 'impersonate', id: 'short' }, T);
ok('الدخول بحسابه: حساب دخول موقوف', r.status === 400 && /معطّل/.test(r.body.error), JSON.stringify(r));
r = await call('admin', 'admin-users-staging', { action: 'impersonate', id: 'nobody' }, T);
ok('الدخول بحسابه: مستخدم غير موجود', r.status === 404);

console.log(`\n${pass} ناجح، ${fail} فاشل`);
