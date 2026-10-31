// =====================================================================
//  admin-users — إدارة المستخدمين (Supabase Edge Function)
//  إنشاء الحسابات وتعديلها يحتاج مفتاح الخادم (service_role)، والمفتاح لا يوضع في المتصفح أبداً،
//  لذلك تتم هذه العمليات هنا على خادم Supabase، وبعد التحقق أن الطالب «مدير نظام» مفعّل.
//
//  الطلب: POST  { action, ...data }  مع ترويسة Authorization: Bearer <access token>
//    create         { email, password, full_name, short_name?, role }
//    update         { id, full_name?, short_name?, role?, is_active? }
//    reset_password { id, password }
//
//  لا يستخدم أي مكتبة: fetch مباشرة إلى واجهات Supabase
// =====================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROLES = ["admin", "head", "engineer", "viewer"];

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

// طلب إلى Supabase بمفتاح الخادم
async function admin(path: string, init: RequestInit = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || res.statusText;
    throw new AppError(translate(String(msg)), res.status >= 500 ? 502 : 400);
  }
  return data;
}

function translate(msg: string): string {
  if (/already been registered|already exists|duplicate key/i.test(msg)) return "هذا البريد مسجّل مسبقاً.";
  if (/password/i.test(msg) && /(short|least|weak)/i.test(msg)) return "كلمة المرور ضعيفة: 8 أحرف على الأقل.";
  if (/invalid.*email|email.*invalid/i.test(msg)) return "صيغة البريد غير صحيحة.";
  if (/بنفسك/.test(msg)) return msg;
  return msg;
}

// المستخدم الذي أرسل الطلب، ويجب أن يكون مدير نظام مفعّلاً
async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new AppError("غير مصرّح.", 401);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AppError("انتهت الجلسة، سجّل الدخول من جديد.", 401);
  const user = await res.json();
  const rows = await admin(`/rest/v1/profiles?id=eq.${user.id}&select=id,role,is_active`);
  if (!rows?.length || rows[0].role !== "admin" || !rows[0].is_active) {
    throw new AppError("هذه العملية لمدير النظام فقط.", 403);
  }
  return user.id as string;
}

function clean(v: unknown) {
  return typeof v === "string" ? v.trim() : v;
}

function checkPassword(p: unknown) {
  if (typeof p !== "string" || p.length < 8) throw new AppError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
}

async function createUser(body: Record<string, unknown>) {
  const email = String(clean(body.email) || "").toLowerCase();
  const full_name = String(clean(body.full_name) || "");
  const short_name = clean(body.short_name) || null;
  const role = String(body.role || "engineer");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("صيغة البريد غير صحيحة.");
  if (!full_name) throw new AppError("الاسم الكامل مطلوب.");
  if (!ROLES.includes(role)) throw new AppError("دور غير معروف.");
  checkPassword(body.password);

  const user = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: body.password, email_confirm: true, user_metadata: { full_name } }),
  });
  try {
    const rows = await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id: user.id, email, full_name, short_name, role, must_change_password: true }),
    });
    return rows[0];
  } catch (e) {
    // لا نترك حساب دخول بلا ملف مستخدم
    await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
}

async function updateUser(body: Record<string, unknown>, callerId: string) {
  const id = String(body.id || "");
  if (!id) throw new AppError("المستخدم غير محدد.");
  const patch: Record<string, unknown> = {};
  if (body.full_name !== undefined) {
    const n = String(clean(body.full_name) || "");
    if (!n) throw new AppError("الاسم الكامل مطلوب.");
    patch.full_name = n;
  }
  if (body.short_name !== undefined) patch.short_name = clean(body.short_name) || null;
  if (body.role !== undefined) {
    if (!ROLES.includes(String(body.role))) throw new AppError("دور غير معروف.");
    patch.role = body.role;
  }
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;
  if (id === callerId && (patch.role && patch.role !== "admin" || patch.is_active === false)) {
    throw new AppError("لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.");
  }
  if (!Object.keys(patch).length) throw new AppError("لا توجد تغييرات.");

  const rows = await admin(`/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!rows?.length) throw new AppError("المستخدم غير موجود.", 404);

  // الحساب المعطّل لا يستطيع تسجيل الدخول أصلاً
  if (patch.is_active !== undefined) {
    await admin(`/auth/v1/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({ ban_duration: patch.is_active ? "none" : "876000h" }),
    });
  }
  return rows[0];
}

async function resetPassword(body: Record<string, unknown>) {
  const id = String(body.id || "");
  if (!id) throw new AppError("المستخدم غير محدد.");
  checkPassword(body.password);
  await admin(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ password: body.password }) });
  await admin(`/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ must_change_password: true }),
  });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const callerId = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "create": return json({ user: await createUser(body) });
      case "update": return json({ user: await updateUser(body, callerId) });
      case "reset_password": return json(await resetPassword(body));
      default: throw new AppError("عملية غير معروفة.");
    }
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    const message = e instanceof AppError ? e.message : "خطأ غير متوقع في الخادم.";
    if (!(e instanceof AppError)) console.error(e);
    return json({ error: message }, status);
  }
});
