/**
 * عميل Supabase مصغّر بـ fetch فقط (بدون مكتبة supabase-js)
 *   /auth/v1      تسجيل الدخول وتجديد الجلسة (GoTrue)
 *   /rest/v1      الجداول والدوال (PostgREST)
 *   /functions/v1 الدوال على الخادم (Edge Functions)
 */

const STORE_KEY = 'tsk.session';

export class ApiError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}
function writeStore(s) {
  try { s ? localStorage.setItem(STORE_KEY, JSON.stringify(s)) : localStorage.removeItem(STORE_KEY); } catch { /* المتصفح يمنع التخزين */ }
}

/** رسالة عربية مفهومة من خطأ Supabase */
function translate(status, body) {
  const msg = body?.message || body?.msg || body?.error_description || body?.error || '';
  const code = body?.code || body?.error_code || '';
  if (code === 'P0001' && msg) return msg;
  if (code === 'PGRST106' || /schema must be one of/i.test(msg)) return 'سكيما النظام غير مضافة في Supabase ← Data API ← Exposed schemas. راجع دليل التركيب.';
  if (code === '3F000' || /permission denied for schema/i.test(msg)) return 'لا توجد صلاحية على سكيما النظام. أعد تنفيذ ملف 03_security.sql.';                        // رسائلنا من قاعدة البيانات
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/banned/i.test(msg) || code === 'user_banned') return 'هذا الحساب معطّل. تواصل مع مدير النظام.';
  if (code === 'email_not_confirmed') return 'البريد غير مؤكد.';
  if (code === 'same_password') return 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.';
  if (code === 'weak_password' || /password should be/i.test(msg)) return 'كلمة المرور أقصر من الحد الذي تقبله Supabase (Authentication ← Providers ← Email ← Minimum password length).';
  if (code === '42501' || status === 403) return 'لا تملك صلاحية لهذه العملية.';
  if (code === '23505') return 'هذه القيمة موجودة مسبقاً.';
  if (code === '23503') return 'لا يمكن تنفيذ العملية لارتباطها ببيانات أخرى.';
  if (code === '23514') return 'البيانات لا تحقق القيود (تحقق من التواريخ).';
  if (status === 429) return 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.';
  if (status >= 500) return 'خطأ في الخادم. حاول لاحقاً.';
  return msg || 'حدث خطأ غير متوقع.';
}

export function createClient({ url, anonKey, schema = 'public' }) {
  const base = url.replace(/\/+$/, '');
  // سكيما غير public: PostgREST يحددها بهذين الرأسين (قراءة / كتابة)
  const profile = (method) => (schema === 'public' ? {} : method === 'GET' || method === 'HEAD' ? { 'Accept-Profile': schema } : { 'Content-Profile': schema });
  let session = readStore();
  let refreshing = null;
  let onExpired = () => {};

  async function raw(path, { method = 'GET', headers = {}, body, token } = {}) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          apikey: anonKey,
          // رمز المستخدم فقط؛ الطلبات بدون دخول تكتفي بـ apikey (يعمل مع مفتاح anon القديم و publishable الجديد)
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('تعذّر الاتصال بالخادم. تحقق من الإنترنت.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new ApiError(translate(res.status, data), res.status, data?.code || data?.error_code || '');
    return { data, res };
  }

  function saveSession(d) {
    session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user,
    };
    writeStore(session);
    return session;
  }

  function clearSession() { session = null; writeStore(null); }

  async function refresh() {
    if (!session?.refresh_token) throw new ApiError('انتهت الجلسة.', 401);
    if (!refreshing) {
      refreshing = raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
        .then(({ data }) => saveSession(data))
        .catch((e) => { clearSession(); onExpired(); throw new ApiError('انتهت الجلسة، سجّل الدخول من جديد.', 401); })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function token() {
    if (!session) throw new ApiError('سجّل الدخول أولاً.', 401);
    if (session.expires_at - 60 < Date.now() / 1000) await refresh();
    return session.access_token;
  }

  /** طلب مع رمز المستخدم وتجديده مرة واحدة عند 401 */
  async function authed(path, opts = {}) {
    try {
      return await raw(path, { ...opts, token: await token() });
    } catch (e) {
      if (e.status === 401 && session) {
        await refresh();
        return raw(path, { ...opts, token: session.access_token });
      }
      throw e;
    }
  }

  return {
    get session() { return session; },
    setOnExpired(fn) { onExpired = fn; },

    async signIn(email, password) {
      const { data } = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      return saveSession(data);
    },
    /** الدخول بالرقم عبر Edge Function تبحث عن البريد على الخادم */
    async signInVia(fn, login, password) {
      try {
        const { data } = await raw(`/functions/v1/${fn}`, { method: 'POST', body: { login, password } });
        return saveSession(data);
      } catch (e) {
        if (e.status === 404) throw new ApiError(`دالة الدخول بالرقم غير منشورة على Supabase (${fn}). استخدم البريد أو راجع دليل التركيب.`, 404);
        throw e;
      }
    },
    async signOut() {
      try { if (session) await raw('/auth/v1/logout', { method: 'POST', token: session.access_token }); } catch { /* الخروج محلياً على أي حال */ }
      clearSession();
    },
    async ensureSession() {
      if (!session) return null;
      try { await token(); return session; } catch { return null; }
    },
    async updatePassword(password) {
      await authed('/auth/v1/user', { method: 'PUT', body: { password } });
    },

    /** PostgREST: select مع جلب كل الصفحات (1000 صف في كل طلب) */
    async selectAll(table, params) {
      const out = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const qs = new URLSearchParams(params).toString();
        const { data } = await authed(`/rest/v1/${table}?${qs}`, {
          headers: { ...profile('GET'), 'Range-Unit': 'items', Range: `${from}-${from + page - 1}` },
        });
        out.push(...data);
        if (data.length < page) break;
      }
      return out;
    },
    async select(table, params) {
      const { data } = await authed(`/rest/v1/${table}?${new URLSearchParams(params)}`, { headers: profile('GET') });
      return data;
    },
    async insert(table, rows, { returning = true } = {}) {
      const { data } = await authed(`/rest/v1/${table}`, {
        method: 'POST', body: rows, headers: { ...profile('POST'), Prefer: returning ? 'return=representation' : 'return=minimal' },
      });
      return data;
    },
    async update(table, match, patch) {
      const { data } = await authed(`/rest/v1/${table}?${new URLSearchParams(match)}`, {
        method: 'PATCH', body: patch, headers: { ...profile('PATCH'), Prefer: 'return=representation' },
      });
      return data;
    },
    async upsert(table, rows, onConflict) {
      const { data } = await authed(`/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: 'POST', body: rows, headers: { ...profile('POST'), Prefer: 'resolution=merge-duplicates,return=representation' },
      });
      return data;
    },
    async rpc(fn, args = {}) {
      const { data } = await authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, headers: profile('POST') });
      return data;
    },
    async invoke(fn, body) {
      try {
        const { data } = await authed(`/functions/v1/${fn}`, { method: 'POST', body });
        return data;
      } catch (e) {
        if (e.status === 404) throw new ApiError(`دالة إدارة المستخدمين غير منشورة على Supabase (${fn}). راجع دليل التركيب.`, 404);
        throw e;
      }
    },
  };
}
