-- =====================================================================
--  نظام مهام الدعم الفني — 08: إصلاح البريد الممسوح (خلل الإصدار 1.3.0)
--
--  في الإصدار 1.3.0 كان حفظ الرقم لمستخدم يمسح بريده من جدول المستخدمين،
--  فيفشل الدخول بالرقم. هذا الملف:
--    1) يعيد البريد من حساب الدخول (auth.users) لكل مستخدم بريده فارغ، في السكيمتين
--    2) يمنع البريد الفارغ نهائياً في قاعدة البيانات
--    3) يعرض أي حساب ما زال يحتاج إصلاحاً يدوياً (يجب ألا يظهر شيء)
--  يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.profiles') is null then continue; end if;

    execute format('alter table %I.profiles disable trigger user', s);
    execute format($q$
      update %I.profiles p set email = u.email
      from auth.users u
      where u.id = p.id and coalesce(p.email, '') = '' and coalesce(u.email, '') <> ''$q$, s);
    execute format('alter table %I.profiles enable trigger user', s);

    if not exists (select 1 from pg_constraint where conname = 'profiles_email_not_blank' and conrelid = (s || '.profiles')::regclass)
       then
      begin
        execute format($q$alter table %I.profiles add constraint profiles_email_not_blank check (btrim(email) <> '')$q$, s);
      exception when check_violation then
        raise notice 'السكيما %: ما زال فيها بريد فارغ، راجع الجدول أدناه', s;
      end;
    end if;
  end loop;
end $$;

-- ما يحتاج إصلاحاً يدوياً (يجب أن تكون النتيجة فارغة)
select 'support_tasks' as السكيما, p.full_name, p.login_no, p.email as بريد_الملف, u.email as بريد_الدخول
from support_tasks.profiles p left join auth.users u on u.id = p.id
where coalesce(p.email, '') = '' or coalesce(u.email, '') = '' or p.email <> u.email
union all
select 'support_tasks_staging', p.full_name, p.login_no, p.email, u.email
from support_tasks_staging.profiles p left join auth.users u on u.id = p.id
where coalesce(p.email, '') = '' or coalesce(u.email, '') = '' or p.email <> u.email;
