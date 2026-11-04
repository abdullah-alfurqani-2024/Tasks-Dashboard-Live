-- =====================================================================
--  التجربة: أول مدير للنظام في مشروع التجربة (مرة واحدة فقط، بعد setup_staging.sql)
--
--  قبل التنفيذ:
--    Authentication ← Users ← Add user ← Create new user
--    اكتب بريدك وكلمة مرور (6 أحرف على الأقل)، وفعّل «Auto Confirm User»
--
--  ثم عدّل الأسطر الأربعة المعلَّمة بـ ← ونفّذ.
--  بعدها تدخل التجربة برقمك، ثم «تحديث بيانات التجربة من الإنتاج» ينسخ بقية المستخدمين والمهام.
-- =====================================================================

insert into support_tasks_staging.profiles (id, email, login_no, full_name, short_name, role, must_change_password)
select id, email,
       '00000000',                   -- ← رقمك المدني أو الوظيفي (أرقام فقط)
       'الاسم الكامل',               -- ← الاسم الكامل
       'الاسم المختصر',              -- ← الاسم المختصر (يظهر في الجداول)
       'admin', false
from auth.users
where email = 'your.email@example.com'   -- ← بريدك كما كتبته في Add user
on conflict (id) do update set role = 'admin', is_active = true, login_no = excluded.login_no,
  full_name = excluded.full_name, short_name = excluded.short_name;

-- التحقق: يجب أن يظهر سطر واحد بدور admin ورقمك
select email, login_no, full_name, role from support_tasks_staging.profiles where role = 'admin';
