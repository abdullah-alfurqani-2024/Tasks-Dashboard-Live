// محاكاة مشروعين (الإنتاج والتجربة) لاختبار دالة refresh-staging محلياً
let handler;
const ENV = {
  SUPABASE_URL: 'https://stg.test', SUPABASE_SERVICE_ROLE_KEY: 'stg-service',
  PROD_URL: 'https://prod.test/rest/v1/', PROD_KEY: 'sb_publishable_prod', PROD_SYNC_LOGIN: '5000', PROD_SYNC_PASSWORD: 'sync-pw',
};
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (fn) => { handler = fn; } };

const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---------- الإنتاج ----------
const prod = {
  users: [
    { id: 'p-admin', email: 'boss@x.om', login_no: '1001', full_name: 'المدير', short_name: '', role: 'admin', is_active: true },
    { id: 'p-eng', email: 'n1003@tasks.internal', login_no: '1003000', full_name: 'مهندس قديم', short_name: '', role: 'engineer', is_active: true },
    { id: 'p-new', email: 'new@x.om', login_no: '7777777', full_name: 'مهندس جديد', short_name: '', role: 'engineer', is_active: true },
    { id: 'p-short', email: 'n12@tasks.internal', login_no: '12', full_name: 'رقم قصير', short_name: '', role: 'engineer', is_active: true },
    { id: 'p-sync', email: 'n5000@tasks.internal', login_no: '5000', full_name: 'مزامنة التجربة', short_name: '', role: 'viewer', is_active: true },
  ],
  tasks: Array.from({ length: 2437 }, (_, i) => ({ id: i + 1, engineer_id: i % 2 ? 'p-eng' : 'p-new', subject: `مهمة ${i + 1}`, received_date: '2026-01-01', status_id: 1 })),
  writes: 0,
};
// ---------- التجربة ----------
const stgAuth = new Map([
  ['s-admin', { email: 'boss@x.om', password: 'my-own-pw' }],
  ['s-eng', { email: 'n1003000@tasks.internal', password: 'old' }],
  ['s-orphan', { email: 'new@x.om', password: 'x' }],          // حساب دخول بلا ملف مستخدم
]);
let stgProfiles = [
  { id: 's-admin', email: 'boss@x.om', login_no: '1001', source_id: null, role: 'admin', is_active: true },
  { id: 's-eng', email: 'n1003000@tasks.internal', login_no: '1003000', source_id: null, role: 'engineer', is_active: true },
];
let snapshot = null, seq = 0;

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body ? JSON.parse(init.body) : {};
  if (u.host === 'prod.test') {
    if (method !== 'GET' && !u.pathname.includes('auth-login')) prod.writes++;
    if (u.pathname === '/functions/v1/auth-login') {
      return body.login === '5000' && body.password === 'sync-pw' ? J({ access_token: 'prod-sync', user: { id: 'p-sync' } }) : J({ error: 'الرقم أو كلمة المرور غير صحيحة.' }, 400);
    }
    if (h.authorization !== 'Bearer prod-sync' || h['accept-profile'] !== 'support_tasks') return J({ message: 'denied' }, 401);
    const table = u.pathname.replace('/rest/v1/', '');
    const [a, b] = h.range.split('-').map(Number);
    const rows = { profiles: prod.users, tasks: prod.tasks, task_types: [{ id: 5, name: 'مراسلة', sort_order: 1, is_active: true }],
      correspondence_types: [], task_statuses: [{ id: 1, name: 'مكتمل', kind: 'done', sort_order: 1, is_active: true }], app_settings: [{ key: 'edit_lock_days', value: 0 }] }[table];
    return J(rows.slice(a, b + 1));
  }
  // مشروع التجربة
  if (u.pathname === '/auth/v1/user') return h.authorization === 'Bearer tok-s-admin' ? J({ id: 's-admin' }) : h.authorization === 'Bearer tok-s-eng' ? J({ id: 's-eng' }) : J({}, 401);
  if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
    if ([...stgAuth.values()].some((x) => x.email === body.email)) return J({ msg: 'A user with this email address has already been registered' }, 422);
    const id = `s-created-${++seq}`; stgAuth.set(id, { email: body.email, password: body.password }); return J({ id });
  }
  const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (m) {
    const a = stgAuth.get(m[1]);
    if (body.email && [...stgAuth.entries()].some(([i, x]) => i !== m[1] && x.email === body.email)) return J({ msg: 'already registered' }, 422);
    if (body.email) a.email = body.email;
    if (body.password) a.password = body.password;
    return J({ id: m[1] });
  }
  if (u.pathname === '/rest/v1/profiles') {
    const id = u.searchParams.get('id');
    return J(id ? stgProfiles.filter((p) => `eq.${p.id}` === id) : stgProfiles);
  }
  if (u.pathname === '/rest/v1/app_settings') return J([{ value: 6 }]);
  if (u.pathname === '/rest/v1/rpc/apply_production_snapshot') {
    snapshot = body.p; snapshot.__schema = h['content-profile'];
    return J({ users: body.p.users.length, tasks: body.p.tasks.length, skipped_tasks: 0, deactivated: 0, at: 'now' });
  }
  throw new Error('unmocked ' + method + ' ' + url);
};

await import('./.build/refresh-staging.mjs');
const call = async (body, token = 'tok-s-admin', fn = 'refresh-staging') => {
  const res = await handler(new Request(`https://stg.test/functions/v1/${fn}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? '✅' : '❌', name, cond ? '' : extra); };

let r = await call({ mode: 'same', password: 'Test2026', force: true }, 'tok-s-eng');
ok('غير المدير مرفوض', r.status === 403, JSON.stringify(r));
r = await call({ mode: 'same', password: '123' });
ok('كلمة موحدة قصيرة مرفوضة', r.status === 400);

r = await call({ mode: 'login_no', password: 'Shared2026', force: false });
ok('النسخ ينجح', r.status === 200, JSON.stringify(r).slice(0, 300));
ok('كل المهام قُرئت (على دفعات 1000)', snapshot.tasks.length === 2437);
ok('حساب المزامنة لا يُنسخ', !snapshot.users.some((x) => x.source_id === 'p-sync'));
ok('المدير المنفّذ: نفس حسابه وكلمة مروره كما هي', snapshot.users.find((x) => x.source_id === 'p-admin')?.id === 's-admin' && stgAuth.get('s-admin').password === 'my-own-pw');
ok('مهندس موجود يُربط برقمه، وكلمة مروره = رقمه', snapshot.users.find((x) => x.source_id === 'p-eng')?.id === 's-eng' && stgAuth.get('s-eng').password === '1003000');
ok('بريد الدخول في التجربة يتبع الإنتاج', stgAuth.get('s-eng').email === 'n1003@tasks.internal');
const nu = snapshot.users.find((x) => x.source_id === 'p-new');
ok('مستخدم جديد: بريده مستخدم في التجربة ← بريد داخلي بديل', nu && nu.id.startsWith('s-created') && stgAuth.get(nu.id).email === 'p-p-new@tasks.internal' && nu.email === 'p-p-new@tasks.internal');
ok('مستخدم جديد: كلمة مروره = رقمه', stgAuth.get(nu.id).password === '7777777');
const sh = snapshot.users.find((x) => x.source_id === 'p-short');
ok('رقم قصير: الكلمة الموحدة بدلاً منه', stgAuth.get(sh.id).password === 'Shared2026');
ok('المنفّذ في keep، والإلزام كما طُلب', snapshot.keep[0] === 's-admin' && snapshot.force === false);
ok('القوائم والإعدادات تُرسل', snapshot.lookups.task_statuses.length === 1 && snapshot.settings.length === 1);
ok('لا كتابة في الإنتاج إطلاقاً', prod.writes === 0, prod.writes);

// تشغيل ثانٍ: الربط بـ source_id، وكلمة موحدة للجميع
stgProfiles = snapshot.users.map((x) => ({ id: x.id, email: x.email, login_no: x.login_no, source_id: x.source_id, role: x.role, is_active: true }));
const before = stgAuth.size;
r = await call({ mode: 'same', password: 'Unified99', force: true });
ok('تشغيل ثانٍ: لا حسابات جديدة مكررة', stgAuth.size === before, `${before} -> ${stgAuth.size}`);
ok('تشغيل ثانٍ: كلمة موحدة للجميع عدا المنفّذ', stgAuth.get('s-eng').password === 'Unified99' && stgAuth.get('s-admin').password === 'my-own-pw');

ok('التجربة تكتب في سكيما التجربة', snapshot.__schema === 'support_tasks_staging', snapshot.__schema);

// نسخة التطوير: نفس الكود باسم refresh-dev يكتب في سكيما التطوير، وبريد بديل d- حتى لا يتعارض مع التجربة
stgProfiles = [{ id: 's-admin', email: 'boss@x.om', login_no: '1001', source_id: null, role: 'admin', is_active: true }];
const authBefore = new Map([...stgAuth].map(([k, v]) => [k, { ...v }]));
r = await call({ mode: 'same', password: 'DevPass99', force: false }, 'tok-s-admin', 'refresh-dev');
ok('التطوير: النسخ ينجح ويكتب في سكيما التطوير', r.status === 200 && snapshot.__schema === 'support_tasks_dev', JSON.stringify(r).slice(0, 200));
const devNew = snapshot.users.find((x) => x.source_id === 'p-new');
ok('التطوير: بريد بديل d- عند التعارض مع حسابات التجربة', devNew && /^d-/.test(devNew.email), devNew && devNew.email);
ok('التطوير: حسابات التجربة لم تتغير كلمات مرورها', [...authBefore].every(([k, v]) => k === 's-admin' || stgAuth.get(k).password === v.password));
stgProfiles = snapshot.users.map((x) => ({ id: x.id, email: x.email, login_no: x.login_no, source_id: x.source_id, role: x.role, is_active: true }));
r = await call({ mode: 'same', password: 'Unified99' });

// حساب المزامنة ليس مشاهداً
prod.users.find((x) => x.id === 'p-sync').role = 'head';
r = await call({ mode: 'same', password: 'Unified99' });
ok('حساب مزامنة بدور غير «مشاهد» مرفوض', r.status === 400 && /مشاهد/.test(r.body.error));
prod.users.find((x) => x.id === 'p-sync').role = 'viewer';

// أسرار ناقصة / خاطئة
ENV.PROD_SYNC_PASSWORD = 'wrong';
r = await call({ mode: 'same', password: 'Unified99' });
ok('كلمة مرور المزامنة خاطئة: رسالة واضحة', r.status === 502 && /حساب المزامنة/.test(r.body.error));
delete ENV.PROD_KEY;
r = await call({ mode: 'same', password: 'Unified99' });
ok('سر ناقص: رسالة واضحة', r.status === 500 && /PROD_KEY/.test(r.body.error));
ENV.PROD_KEY = 'k'; ENV.PROD_SYNC_PASSWORD = 'sync-pw'; ENV.PROD_URL = 'https://stg.test';
r = await call({ mode: 'same', password: 'Unified99' });
ok('PROD_URL يشير للتجربة نفسها: مرفوض', r.status === 500 && /التجربة نفسه/.test(r.body.error));

console.log(`\n${pass} ناجح، ${fail} فاشل`);
