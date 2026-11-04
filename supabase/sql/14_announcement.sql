-- =====================================================================
--  نظام مهام الدعم الفني — 14: إعلان من مدير النظام
--
--  إعداد جديد announcement: نص يكتبه مدير النظام في «الإعدادات»،
--  ويظهر لكل المستخدمين شريطاً أعلى الصفحة حتى يمسحه. فارغ = لا إعلان.
--  يقرؤه كل المستخدمين ويعدّله المدير فقط (صلاحيات جدول الإعدادات الحالية).
--
--  للسكيمتين معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة.
--  يُنفَّذ في مشروع التجربة أولاً، ثم في مشروع الإنتاج. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.app_settings') is null then continue; end if;
    execute format($q$insert into %I.app_settings (key, value) values ('announcement', '""') on conflict (key) do nothing$q$, s);
  end loop;
end $do$;

-- التحقق: يجب أن يظهر سطر (announcement) لكل سكيما في هذا المشروع
create or replace function pg_temp.check_announcement() returns table (السكيما text, القيمة jsonb)
language plpgsql as $f$
declare s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.app_settings') is not null then
      return query execute format('select %L::text, value from %I.app_settings where key = %L', s, s, 'announcement');
    end if;
  end loop;
end $f$;
select * from pg_temp.check_announcement();
