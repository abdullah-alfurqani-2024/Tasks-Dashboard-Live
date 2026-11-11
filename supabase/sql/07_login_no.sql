-- =====================================================================
--  نظام مهام الدعم الفني — 07: الدخول بالرقم المدني أو الوظيفي
--
--  يضيف عمود login_no (الرقم) لجدول المستخدمين في الإنتاج والتجربة معاً.
--  إضافة فقط: عمود فارغ لا يؤثر على النسخة الحالية من الواجهة، فيمكن تنفيذه في أي وقت.
--  يمكن إعادة تنفيذه بلا ضرر.
--
--  الرقم نص (لا رقم حسابي) حتى تبقى الأصفار في أوله، ويقبل حتى 20 خانة.
-- =====================================================================

do $$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.profiles') is null then continue; end if;

    execute format('alter table %I.profiles add column if not exists login_no text', s);

    if not exists (select 1 from pg_constraint where conname = 'profiles_login_no_chk' and conrelid = (s || '.profiles')::regclass) then
      execute format($q$alter table %I.profiles add constraint profiles_login_no_chk check (login_no ~ '^[0-9]{1,20}$')$q$, s);
    end if;

    execute format('create unique index if not exists profiles_login_no_key on %I.profiles (login_no) where login_no is not null', s);
  end loop;
end $$;

-- التحقق: يجب أن يظهر سطر لكل سكيما
select table_schema, column_name, data_type
from information_schema.columns
where column_name = 'login_no' and table_name = 'profiles'
order by 1;
