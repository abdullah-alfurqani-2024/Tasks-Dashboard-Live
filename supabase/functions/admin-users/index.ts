// =====================================================================
//  admin-users — إدارة المستخدمين (Supabase Edge Function)
//  إنشاء الحسابات وتعديلها يحتاج مفتاح الخادم (service_role)، والمفتاح لا يوضع في المتصفح أبداً،
//  لذلك تتم هذه العمليات هنا على خادم Supabase، وبعد التحقق أن الطالب «مدير نظام» مفعّل.
//
//  الطلب: POST  { action, ...data }  مع ترويسة Authorization: Bearer <access token>
//    create         { login_no, email?, password?, full_name, short_name?, role }   (الرقم إلزامي، وكلمة المرور الافتراضية = الرقم)
//    update         { id, login_no?, email?, full_name?, short_name?, role?, is_active? }   (لا يُحفظ مستخدم بلا رقم)
//  المستخدم بلا بريد يُعطى بريد دخول داخلياً (n<الرقم>@tasks.internal) لا يُرسل إليه شيء
//    reset_password { id, password }
//    reset_all      { mode: 'same'|'login_no', password?, force, include_inactive }
//                   كل المستخدمين عدا من ينفّذ الأمر: كلمة مرور موحدة، أو الرقم المدني/الوظيفي لكل مستخدم
//    impersonate    { id }   (التجربة فقط) جلسة دخول بحساب المستخدم دون كلمة مروره ودون تغييرها
//
//  لا يستخدم أي مكتبة: fetch مباشرة إلى واجهات Supabase
//
//  نفس الكود يُنشر مرتين، والسكيما تُعرف من اسم الدالة:
//    admin-users          ← support_tasks          (الإنتاج)
//    admin-users-staging  ← support_tasks_staging  (التجربة)
// =====================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// السكيما التي فيها جداول النظام: تُحدَّد من اسم الدالة في كل طلب (انظر schemaFor)
let SCHEMA = "";
function schemaFor(req: Request) {
  const path = new URL(req.url).pathname;
  if (path.includes("admin-users-staging")) return "support_tasks_staging";
  if (path.includes("admin-users")) return "support_tasks";
  throw new AppError("تعذّر تحديد نسخة النظام من اسم الدالة.", 500);
}
const ROLES = ["admin", "head", "engineer", "viewer"];
const INTERNAL_DOMAIN = "tasks.internal";
const internalEmail = (no: string) => `n${no}@${INTERNAL_DOMAIN}`;
const isInternal = (email: string) => email.endsWith(`@${INTERNAL_DOMAIN}`);
const toLatin = (v: string) =>
  v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
/** الرقم: أرقام فقط حتى 20 خانة، أو null إذا تُرك فارغاً */
function cleanNo(v: unknown) {
  const no = toLatin(String(v ?? "")).replace(/\s+/g, "");
  if (!no) return null;
  if (!/^[0-9]{1,20}$/.test(no)) throw new AppError("الرقم يجب أن يكون أرقاماً فقط (حتى 20 خانة).");
  return no;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      ...(path.startsWith("/rest/") ? { "Accept-Profile": SCHEMA, "Content-Profile": SCHEMA } : {}),
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
  if (/login_no/i.test(msg)) return "هذا الرقم مسجّل لمستخدم آخر.";
  if (/already been registered|already exists|duplicate key/i.test(msg)) return "هذا البريد مسجّل مسبقاً.";
  if (/password/i.test(msg) && /(short|least|weak)/i.test(msg)) return "كلمة المرور أقصر من الحد الذي تقبله Supabase (Authentication ← Providers ← Email ← Minimum password length).";
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
  return { id: user.id as string, email: String(user.email || "") };
}

function clean(v: unknown) {
  return typeof v === "string" ? v.trim() : v;
}

// قواعد كلمة المرور من إعدادات النظام (يحددها المدير). 6 = أقل ما تقبله Supabase
const PW_FLOOR = 6;
async function passwordRules() {
  const rows = await admin("/rest/v1/app_settings?key=in.(min_password_length,force_password_change)&select=key,value");
  const m = Object.fromEntries((rows || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const min = Math.min(72, Math.max(PW_FLOOR, Number(m.min_password_length) || PW_FLOOR));
  const force = m.force_password_change === undefined ? true : m.force_password_change === true || m.force_password_change === "true";
  return { min, force };
}

function checkPassword(p: unknown, min: number) {
  if (typeof p !== "string" || p.length < min) throw new AppError(`كلمة المرور يجب أن تكون ${min} أحرف على الأقل.`);
}

async function createUser(body: Record<string, unknown>) {
  const login_no = cleanNo(body.login_no);
  const typed = String(clean(body.email) || "").toLowerCase();
  const full_name = String(clean(body.full_name) || "");
  const short_name = clean(body.short_name) || null;
  const role = String(body.role || "engineer");
  if (!login_no) throw new AppError("الرقم المدني أو الوظيفي مطلوب.");
  if (typed && !EMAIL_RE.test(typed)) throw new AppError("صيغة البريد غير صحيحة.");
  if (login_no) {
    const dup = await admin(`/rest/v1/profiles?login_no=eq.${login_no}&select=id`);
    if (dup?.length) throw new AppError("هذا الرقم مسجّل لمستخدم آخر.");
  }
  const email = typed || internalEmail(login_no);
  if (!full_name) throw new AppError("الاسم الكامل مطلوب.");
  if (!ROLES.includes(role)) throw new AppError("دور غير معروف.");
  const rules = await passwordRules();
  const password = body.password === undefined || body.password === "" ? login_no : body.password;
  checkPassword(password, rules.min);

  const user = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } }),
  });
  try {
    const rows = await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id: user.id, email, login_no, full_name, short_name, role, must_change_password: rules.force }),
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
  if (body.login_no !== undefined) patch.login_no = cleanNo(body.login_no);
  let newEmail = "";
  if (body.email !== undefined) {
    newEmail = String(clean(body.email) || "").toLowerCase();
    if (newEmail && !EMAIL_RE.test(newEmail)) throw new AppError("صيغة البريد غير صحيحة.");
  }
  if (id === callerId && (patch.role && patch.role !== "admin" || patch.is_active === false)) {
    throw new AppError("لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.");
  }
  // تغيير البريد: حساب الدخول أولاً (يرفض البريد المكرر)، ثم الملف الشخصي
  let oldEmail = "";
  {
    const cur = await admin(`/rest/v1/profiles?id=eq.${id}&select=email,login_no`);
    if (!cur?.length) throw new AppError("المستخدم غير موجود.", 404);
    oldEmail = cur[0].email;
    const no = body.login_no !== undefined ? (patch.login_no as string | null) : cur[0].login_no;
    // الرقم إلزامي: لا يُحفظ أي تعديل لمستخدم يبقى بلا رقم
    if (!no) throw new AppError("الرقم المدني أو الوظيفي مطلوب. أضف رقم هذا المستخدم أولاً.");
    if (no && no !== cur[0].login_no) {
      const dup = await admin(`/rest/v1/profiles?login_no=eq.${no}&id=neq.${id}&select=id`);
      if (dup?.length) throw new AppError("هذا الرقم مسجّل لمستخدم آخر.");
    }
    // البريد الجديد (target):
    //   - كتب المدير بريداً ← هو
    //   - مسح المدير البريد ← بريد داخلي من الرقم
    //   - لم يُرسل البريد أصلاً ← لا تغيير، إلا البريد الداخلي فيتبع الرقم إذا تغيّر
    let target = "";
    if (body.email !== undefined) target = newEmail || internalEmail(no!);
    else if (isInternal(oldEmail) && no) target = internalEmail(no);
    newEmail = "";
    if (target && target !== oldEmail) {
      await admin(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ email: target, email_confirm: true }) });
      patch.email = target;
      newEmail = target;
    }
  }
  if (!Object.keys(patch).length) throw new AppError("لا توجد تغييرات.");

  let rows;
  try {
    rows = await admin(`/rest/v1/profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
  } catch (e) {
    // إرجاع بريد الدخول كما كان حتى لا يختلف عن الملف الشخصي
    if (newEmail) await admin(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ email: oldEmail, email_confirm: true }) }).catch(() => {});
    throw e;
  }
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

/** إعادة تعيين كلمات المرور للكل عدا المدير الذي ينفّذ الأمر */
async function resetAll(body: Record<string, unknown>, callerId: string) {
  const mode = body.mode === "login_no" ? "login_no" : "same";
  const force = body.force !== false;
  const includeInactive = body.include_inactive === true;
  const rules = await passwordRules();
  if (mode === "same") checkPassword(body.password, rules.min);

  const users: { id: string; full_name: string; login_no: string | null; is_active: boolean }[] =
    await admin(`/rest/v1/profiles?id=neq.${callerId}&select=id,full_name,login_no,is_active&order=full_name.asc`);
  const done: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const queue = users.filter((u) => {
    if (!u.is_active && !includeInactive) { skipped.push({ name: u.full_name, reason: "حساب معطّل" }); return false; }
    if (mode === "login_no" && !u.login_no) { skipped.push({ name: u.full_name, reason: "ليس له رقم" }); return false; }
    if (mode === "login_no" && u.login_no!.length < rules.min) { skipped.push({ name: u.full_name, reason: `رقمه أقصر من ${rules.min} خانات` }); return false; }
    return true;
  });
  // 5 طلبات في وقت واحد
  for (let i = 0; i < queue.length; i += 5) {
    await Promise.all(queue.slice(i, i + 5).map(async (u) => {
      const password = mode === "same" ? String(body.password) : u.login_no!;
      try {
        await admin(`/auth/v1/admin/users/${u.id}`, { method: "PUT", body: JSON.stringify({ password }) });
        await admin(`/rest/v1/profiles?id=eq.${u.id}`, { method: "PATCH", body: JSON.stringify({ must_change_password: force }) });
        done.push(u.full_name);
      } catch (e) {
        skipped.push({ name: u.full_name, reason: e instanceof AppError ? e.message : "خطأ غير متوقع" });
      }
    }));
  }
  return { reset: done.length, skipped };
}

/**
 * الدخول بحساب مستخدم آخر — نسخة التجربة فقط، لمدير النظام فقط.
 * ينشئ جلسة لذلك المستخدم دون معرفة كلمة مروره ودون تغييرها، ودون إرسال أي بريد:
 *   generate_link يصنع رمز دخول (لا يُرسل)، ثم verify يحوّله إلى جلسة
 */
async function impersonate(body: Record<string, unknown>, callerId: string, callerEmail: string) {
  if (SCHEMA !== "support_tasks_staging") throw new AppError("الدخول بحساب مستخدم آخر متاح في نسخة التجربة فقط.", 403);
  const id = String(body.id || "");
  if (!id) throw new AppError("المستخدم غير محدد.");
  if (id === callerId) throw new AppError("هذا حسابك أنت.");
  const rows = await admin(`/rest/v1/profiles?id=eq.${id}&select=id,email,full_name,is_active`);
  if (!rows?.length) throw new AppError("المستخدم غير موجود.", 404);
  const u = rows[0];
  if (!u.is_active) throw new AppError("الحساب معطّل في نسخة التجربة. فعّله أولاً.");

  const link = await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: u.email }) });
  const hashed = link?.hashed_token || link?.properties?.hashed_token;
  if (!hashed) throw new AppError("تعذّر إنشاء جلسة الدخول.", 502);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const s = await res.json().catch(() => null);
  if (!res.ok || !s?.access_token) {
    const msg = String(s?.msg || s?.error_description || s?.message || "");
    if (/banned/i.test(msg)) throw new AppError("حساب الدخول لهذا المستخدم معطّل.");
    throw new AppError("تعذّر إنشاء جلسة الدخول." + (msg ? ` (${msg})` : ""), 502);
  }
  if (s.user?.id && s.user.id !== id) throw new AppError("تعذّر إنشاء جلسة الدخول.", 502);
  // يظهر في Supabase ← Edge Functions ← admin-users-staging ← Logs
  console.log(`impersonate: ${callerEmail} (${callerId}) -> ${u.full_name} (${id})`);
  // بلا رمز تجديد: الجلسة تنتهي بانتهاء صلاحية الرمز (ساعة افتراضياً)
  return { session: { access_token: s.access_token, expires_in: s.expires_in, expires_at: s.expires_at, user: { id } }, name: u.full_name };
}

async function resetPassword(body: Record<string, unknown>) {
  const id = String(body.id || "");
  if (!id) throw new AppError("المستخدم غير محدد.");
  const rules = await passwordRules();
  checkPassword(body.password, rules.min);
  await admin(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ password: body.password }) });
  await admin(`/rest/v1/profiles?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ must_change_password: rules.force }),
  });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    SCHEMA = schemaFor(req);
    const caller = await requireAdmin(req);
    const callerId = caller.id;
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "create": return json({ user: await createUser(body) });
      case "update": return json({ user: await updateUser(body, callerId) });
      case "reset_password": return json(await resetPassword(body));
      case "reset_all": return json(await resetAll(body, callerId));
      case "impersonate": return json(await impersonate(body, callerId, caller.email));
      default: throw new AppError("عملية غير معروفة.");
    }
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    const message = e instanceof AppError ? e.message : "خطأ غير متوقع في الخادم.";
    if (!(e instanceof AppError)) console.error(e);
    return json({ error: message }, status);
  }
});
