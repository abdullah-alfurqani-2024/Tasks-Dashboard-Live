// =====================================================================
//  auth-login — الدخول بالرقم المدني/الوظيفي (Supabase Edge Function)
//
//  خدمة الدخول في Supabase تقبل البريد فقط، فهذه الدالة تبحث عن صاحب الرقم
//  وتسجّل دخوله ببريده، ثم تعيد الجلسة للمتصفح. البريد لا يصل للمتصفح أبداً.
//
//  الطلب: POST { login, password }   (بدون تسجيل دخول مسبق)
//  الرد:  نفس رد Supabase لتسجيل الدخول (access_token, refresh_token, expires_in, user)
//
//  ⚠️ تُنشر مع إيقاف Verify JWT (المستخدم لم يسجّل دخوله بعد)
//  نفس الكود يُنشر مرتين، والسكيما تُعرف من اسم الدالة:
//    auth-login          ← support_tasks          (الإنتاج)
//    auth-login-staging  ← support_tasks_staging  (التجربة)
//
//  لا يستخدم أي مكتبة: fetch مباشرة إلى واجهات Supabase
// =====================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INVALID = "الرقم أو كلمة المرور غير صحيحة.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function schemaFor(req: Request) {
  const path = new URL(req.url).pathname;
  if (path.includes("auth-login-staging")) return "support_tasks_staging";
  if (path.includes("auth-login")) return "support_tasks";
  return "";
}

// حماية من التخمين: بعد 8 محاولات خاطئة لنفس الرقم خلال 15 دقيقة يُوقف مؤقتاً
// (ذاكرة الدالة مؤقتة، وهذا حد إضافي فوق حدود Supabase نفسها)
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60e3, MAX_FAIL = 8;
const recent = (k: string) => (failures.get(k) || []).filter((t) => Date.now() - t < WINDOW);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toLatin = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const schema = schemaFor(req);
  if (!schema) return json({ error: "تعذّر تحديد نسخة النظام من اسم الدالة." }, 500);

  const body = await req.json().catch(() => ({}));
  const login = toLatin(String(body.login || "")).trim().toLowerCase();
  const password = String(body.password || "");
  if (!login || !password) return json({ error: "اكتب الرقم وكلمة المرور." }, 400);

  const key = `${schema}:${login}`;
  if (recent(key).length >= MAX_FAIL) return json({ error: "محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم أعد المحاولة." }, 429);
  const fail = async (msg = INVALID, status = 400) => {
    failures.set(key, [...recent(key), Date.now()]);
    await sleep(400); // إبطاء التخمين
    return json({ error: msg }, status);
  };

  // 1) البريد: مكتوب مباشرة، أو من الرقم
  let email = "";
  if (login.includes("@")) email = login;
  else {
    if (!/^[0-9]{1,20}$/.test(login)) return fail();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?login_no=eq.${login}&select=email,is_active`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": schema },
    });
    if (!res.ok) { console.error(await res.text()); return json({ error: "خطأ في الخادم. حاول لاحقاً." }, 502); }
    const rows = await res.json();
    if (!rows.length) return fail();
    if (!rows[0].is_active) return fail("هذا الحساب معطّل. تواصل مع مدير النظام.");
    email = rows[0].email;
  }

  // 2) تسجيل الدخول في Supabase
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.msg || data?.error_description || data?.message || "");
    if (/banned/i.test(msg)) return fail("هذا الحساب معطّل. تواصل مع مدير النظام.");
    if (res.status === 429) return json({ error: "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة." }, 429);
    return fail();
  }
  failures.delete(key);
  return json(data);
});
