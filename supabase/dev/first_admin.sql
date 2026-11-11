-- =====================================================================
--  التطوير: أول مدير للنظام في سكيما التطوير support_tasks_dev
--  مشروع Tasks-Test (نفس مشروع التجربة) — مرة واحدة فقط، بعد setup_dev.sql
--
--  حسابات الدخول في هذا المشروع مشتركة بين التجربة والتطوير، وحسابك موجود أصلاً
--  (من التجربة). فلا تضف مستخدماً جديداً: يكفي أن تكتب بريد حسابك في التجربة.
--
--  عدّل الأسطر المعلَّمة بـ ← ثم نفّذ.
--  بعدها تدخل /dev/ بنفس رقمك وكلمة مرورك في التجربة،
--  ثم «تحديث بيانات التطوير من الإنتاج» ينسخ بقية المستخدمين والمهام.
-- =====================================================================

insert into support_tasks_dev.profiles (id, email, login_no, full_name, short_name, role, must_change_password)
select id, email,
       '00000000',                   -- ← رقمك المدني أو الوظيفي (نفس رقمك في التجربة)
       'الاسم الكامل',               -- ← الاسم الكامل
       'الاسم المختصر',              -- ← الاسم المختصر (يظهر في الجداول)
       'admin', false
from auth.users
where email = 'your.email@example.com'   -- ← بريد حسابك في التجربة (Authentication ← Users)
on conflict (id) do update set role = 'admin', is_active = true, login_no = excluded.login_no,
  full_name = excluded.full_name, short_name = excluded.short_name;

-- التحقق: يجب أن يظهر سطر واحد بدور admin ورقمك
select email, login_no, full_name, role from support_tasks_dev.profiles where role = 'admin';
