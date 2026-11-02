// =====================================================================
//  refresh-staging — «تحديث بيانات التجربة من الإنتاج» (Supabase Edge Function)
//  تُنشر في مشروع التجربة فقط. الإنتاج مشروع Supabase مستقل، فالنسخ يتم عبر الإنترنت:
//
//    1) تتحقق أن الطالب مدير نظام مفعّل في التجربة
//    2) تدخل الإنتاج بحساب «مزامنة» دوره «مشاهد» (قراءة فقط، والقاعدة تمنعه من أي تعديل)
//       وتقرأ: المستخدمين، والقوائم، والإعدادات، والمهام
//    3) تنشئ أو تحدّث حسابات دخول التجربة لكل مستخدم، بكلمة مرور التجربة التي يختارها المدير
//       (موحدة، أو الرقم المدني/الوظيفي) — عدا حساب المدير الذي ينفّذ فلا تتغير كلمة مروره
//    4) تكتب البيانات في التجربة دفعة واحدة: support_tasks_staging.apply_production_snapshot
//
//  الإنتاج يُقرأ فقط ولا يُكتب فيه أبداً.
//
//  الطلب: POST { mode: 'same'|'login_no', password?, force }  مع Authorization: Bearer <رمز المدير>
//
//  الأسرار المطلوبة (Edge Functions ← Secrets في مشروع التجربة):
//    PROD_URL             رابط مشروع الإنتاج  https://xxxx.supabase.co
//    PROD_KEY             المفتاح العام (Publishable) لمشروع الإنتاج
//    PROD_SYNC_LOGIN      رقم (أو بريد) مستخدم المزامنة في الإنتاج، ودوره «مشاهد»
//    PROD_SYNC_PASSWORD   كلمة مروره
//  (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY لمشروع التجربة متوفران تلقائياً)
//
//  لا يستخدم أي مكتبة: fetch مباشرة إلى واجهات Supabase
// =====================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STG = "support_tasks_staging";
const PROD = "support_tasks";
const INTERNAL_DOMAIN = "tasks.internal";
const PW_FLOOR = 6;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const msgOf = (d: any, fallback: string) => String(d?.msg || d?.message || d?.error_description || d?.error || fallback);

/** طلب إلى مشروع التجربة بمفتاح الخادم */
async function stg(path: string, init: RequestInit = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(path.startsWith("/rest/") ? { "Accept-Profile": STG, "Content-Profile": STG } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new AppError(msgOf(data, res.statusText), res.status >= 500 ? 502 : 400);
  return data;
}

async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new AppError("غير مصرّح.", 401);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new AppError("انتهت الجلسة، سجّل الدخول من جديد.", 401);
  const user = await res.json();
  const rows = await stg(`/rest/v1/profiles?id=eq.${user.id}&select=id,role,is_active`);
  if (!rows?.length || rows[0].role !== "admin" || !rows[0].is_active) throw new AppError("تحديث بيانات التجربة لمدير النظام فقط.", 403);
  return user.id as string;
}

/* ───────── الإنتاج: قراءة فقط بحساب المزامنة ───────── */
function prodConfig() {
  const url = (Deno.env.get("PROD_URL") || "").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = Deno.env.get("PROD_KEY") || "";
  const login = (Deno.env.get("PROD_SYNC_LOGIN") || "").trim();
  const password = Deno.env.get("PROD_SYNC_PASSWORD") || "";
  if (!url || !key || !login || !password) {
    throw new AppError("أسرار الاتصال بالإنتاج غير مكتملة: أضف PROD_URL و PROD_KEY و PROD_SYNC_LOGIN و PROD_SYNC_PASSWORD في Edge Functions ← Secrets.", 500);
  }
  if (url === SUPABASE_URL.replace(/\/+$/, "")) throw new AppError("PROD_URL يشير إلى مشروع التجربة نفسه. ضع رابط مشروع الإنتاج.", 500);
  return { url, key, login, password };
}

async function prodSignIn(p: ReturnType<typeof prodConfig>) {
  const viaEmail = p.login.includes("@");
  const res = await fetch(viaEmail ? `${p.url}/auth/v1/token?grant_type=password` : `${p.url}/functions/v1/auth-login`, {
    method: "POST",
    headers: { apikey: p.key, "Content-Type": "application/json" },
    body: JSON.stringify(viaEmail ? { email: p.login, password: p.password } : { login: p.login, password: p.password }),
  });
  const d = await res.json().catch(() => null);
  if (!res.ok || !d?.access_token) throw new AppError(`تعذّر دخول الإنتاج بحساب المزامنة: ${msgOf(d, res.statusText)}`, 502);
  return { token: d.access_token as string, id: String(d.user?.id || "") };
}

async function prodAll(p: ReturnType<typeof prodConfig>, token: string, table: string, query: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${p.url}/rest/v1/${table}?${query}`, {
      headers: { apikey: p.key, Authorization: `Bearer ${token}`, "Accept-Profile": PROD, "Range-Unit": "items", Range: `${from}-${from + 999}` },
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new AppError(`تعذّرت قراءة «${table}» من الإنتاج: ${msgOf(d, res.statusText)}`, 502);
    out.push(...d);
    if (d.length < 1000) break;
  }
  return out;
}

/* ───────── كلمات مرور التجربة ───────── */
function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join("");
}

async function minPassword() {
  const rows = await stg("/rest/v1/app_settings?key=eq.min_password_length&select=value");
  return Math.min(72, Math.max(PW_FLOOR, Number(rows?.[0]?.value) || PW_FLOOR));
}

async function refresh(body: Record<string, unknown>, callerId: string) {
  const mode = body.mode === "login_no" ? "login_no" : "same";
  const force = body.force !== false;
  const shared = typeof body.password === "string" ? body.password : "";
  const min = await minPassword();
  if (mode === "same" && shared.length < min) throw new AppError(`كلمة المرور ${min} أحرف على الأقل.`);
  if (shared && shared.length < min) throw new AppError(`كلمة المرور ${min} أحرف على الأقل.`);

  // 1) قراءة الإنتاج
  const p = prodConfig();
  const sess = await prodSignIn(p);
  const [users, tt, ct, st, settings, tasks] = await Promise.all([
    prodAll(p, sess.token, "profiles", "select=id,email,login_no,full_name,short_name,role,is_active&order=full_name.asc"),
    prodAll(p, sess.token, "task_types", "select=id,name,sort_order,is_active"),
    prodAll(p, sess.token, "correspondence_types", "select=id,name,sort_order,is_active"),
    prodAll(p, sess.token, "task_statuses", "select=id,name,kind,sort_order,is_active"),
    prodAll(p, sess.token, "app_settings", "select=key,value"),
    prodAll(p, sess.token, "tasks", "select=*&order=id.asc"),
  ]);
  const me = users.find((u) => u.id === sess.id);
  if (me && me.role !== "viewer") throw new AppError("حساب المزامنة في الإنتاج يجب أن يكون بدور «مشاهد» (قراءة فقط). غيّر دوره ثم أعد المحاولة.");

  // 2) حسابات دخول التجربة
  const current: { id: string; email: string; login_no: string | null; source_id: string | null }[] =
    await stg("/rest/v1/profiles?select=id,email,login_no,source_id");
  const bySource = new Map(current.filter((c) => c.source_id).map((c) => [c.source_id, c]));
  const byNo = new Map(current.filter((c) => c.login_no).map((c) => [c.login_no, c]));
  const byEmail = new Map(current.map((c) => [c.email.toLowerCase(), c]));
  const used = new Set<string>();
  const notes: { name: string; note: string }[] = [];
  const out: Record<string, unknown>[] = [];
  let created = 0, reset = 0;

  const list = users.filter((u) => u.id !== sess.id);   // حساب المزامنة لا يُنسخ
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async (u) => {
      const email = String(u.email || "").toLowerCase();
      const real = email && !email.endsWith(`@${INTERNAL_DOMAIN}`);
      let match = bySource.get(u.id) || (u.login_no ? byNo.get(u.login_no) : undefined) || (real ? byEmail.get(email) : undefined);
      if (match && used.has(match.id)) match = undefined;
      const fromNo = mode === "login_no" && u.login_no && u.login_no.length >= min ? u.login_no : "";
      let pw = mode === "same" ? shared : fromNo || shared;
      try {
        let id: string, finalEmail = email || `p-${u.id}@${INTERNAL_DOMAIN}`;
        if (match) {
          id = match.id;
          used.add(id);
          if (finalEmail !== match.email) {
            try { await stg(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ email: finalEmail, email_confirm: true }) }); }
            catch { finalEmail = match.email; }                    // البريد مستخدم لحساب آخر في التجربة: يبقى القديم
          }
          if (id === callerId) pw = "";                             // حسابك لا تتغير كلمة مروره
          else if (pw) { await stg(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ password: pw }) }); reset++; }
          else notes.push({ name: u.full_name, note: "بقيت كلمة مروره في التجربة كما هي (رقمه أقصر من الحد ولم تُكتب كلمة موحدة)" });
        } else {
          if (!pw) { pw = randomPassword(); notes.push({ name: u.full_name, note: "حساب جديد بكلمة مرور عشوائية (رقمه أقصر من الحد): أعد تعيينها من «المستخدمون»" }); }
          let user;
          try { user = await stg("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: finalEmail, password: pw, email_confirm: true }) }); }
          catch {
            finalEmail = `p-${u.id}@${INTERNAL_DOMAIN}`;           // البريد مستخدم في التجربة لحساب بلا ملف
            user = await stg("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: finalEmail, password: pw, email_confirm: true }) });
          }
          id = user.id;
          created++;
        }
        out.push({ id, source_id: u.id, email: finalEmail, login_no: u.login_no, full_name: u.full_name, short_name: u.short_name, role: u.role, is_active: u.is_active });
      } catch (e) {
        notes.push({ name: u.full_name, note: `لم يُنسخ: ${e instanceof AppError ? e.message : "خطأ غير متوقع"}` });
      }
    }));
  }

  // 3) الكتابة في التجربة دفعة واحدة
  const r = await stg("/rest/v1/rpc/apply_production_snapshot", {
    method: "POST",
    body: JSON.stringify({ p: {
      keep: [callerId], force, users: out,
      lookups: { task_types: tt, correspondence_types: ct, task_statuses: st },
      settings, tasks,
    } }),
  });
  return { users: out.length, created, reset, tasks: r.tasks, skipped_tasks: r.skipped_tasks, deactivated: r.deactivated, notes, at: r.at };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const callerId = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    return json(await refresh(body, callerId));
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    const message = e instanceof AppError ? e.message : "خطأ غير متوقع في الخادم.";
    if (!(e instanceof AppError)) console.error(e);
    return json({ error: message }, status);
  }
});
