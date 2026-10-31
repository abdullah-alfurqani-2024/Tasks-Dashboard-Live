-- =====================================================================
--  نظام مهام الدعم الفني — 05: أول مدير للنظام (مرة واحدة فقط)
--
--  قبل التنفيذ:
--    Supabase ← Authentication ← Users ← Add user ← Create new user
--    اكتب بريدك وكلمة مرور، وفعّل «Auto Confirm User»
--
--  ثم غيّر البريد والاسم في السطرين التاليين ونفّذ.
--  بعدها يضيف هذا المدير بقية المستخدمين من شاشة «المستخدمون» في النظام.
-- =====================================================================

insert into public.profiles (id, email, full_name, short_name, role, must_change_password)
select id, email,
       'عبدالله الفرقاني',          -- ← الاسم الكامل
       'عبدالله الفرقاني',           -- ← الاسم المختصر (يظهر في الجداول)
       'admin', false
from auth.users
where email = 'your.email@example.com'   -- ← بريدك كما كتبته في Add user
on conflict (id) do update set role = 'admin', is_active = true;

select id, email, full_name, role from public.profiles where role = 'admin';
