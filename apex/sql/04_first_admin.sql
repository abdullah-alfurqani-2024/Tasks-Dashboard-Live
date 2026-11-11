-- =====================================================================
--  نظام مهام الدعم الفني — نسخة Oracle APEX
--  04: أول مدير للنظام (مرة واحدة فقط)
--
--  قبل التنفيذ: اكتب رقمك المدني/الوظيفي واسمك في السطرين المعلَّمين بـ ←
--  كلمة المرور = نفس الرقم. يمكنك تغييرها بعد الدخول من «تغيير كلمة المرور».
--
--  بعدها ادخل النظام، ومن «الإعدادات ← تحديث بيانات التجربة من الإنتاج» انقل كل البيانات من Supabase.
--  إذا كان رقمك موجوداً في الإنتاج، يُربط حسابك به تلقائياً وتبقى كلمة مرورك كما هي.
-- =====================================================================

declare
  l_login_no varchar2(20)  := '10774853';             -- ← رقمك المدني أو الوظيفي (أرقام فقط)
  l_name     varchar2(200) := 'عبدالله الفرقاني'
  l_id       varchar2(36);
  n          number;
begin
  if l_login_no = '0000000' then
    raise_application_error(-20001, 'اكتب رقمك في السطر المعلَّم أعلى الملف أولاً.');
  end if;
  select count(*) into n from st_profiles where login_no = l_login_no;
  if n > 0 then
    update st_profiles set role = 'admin', is_active = 1 where login_no = l_login_no returning id into l_id;
  else
    l_id := st_api.new_id;
    insert into st_profiles (id, login_no, full_name, short_name, role, must_change_password)
    values (l_id, l_login_no, l_name, l_name, 'admin', 0);
  end if;
  st_api.set_password(l_id, l_login_no, 0);
  commit;
end;
/

select id, login_no, full_name, role, is_active from st_profiles where role = 'admin';
