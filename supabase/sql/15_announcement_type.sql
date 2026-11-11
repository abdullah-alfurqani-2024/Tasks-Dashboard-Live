-- =====================================================================
--  نظام مهام الدعم الفني — 15: نوع الإعلان وتاريخ انتهائه
--
--  إعدادان جديدان مع الإعلان (14_announcement.sql):
--    announcement_type        'normal' (عادي: يستطيع المستخدم إخفاءه) أو 'important' (مهم: لا يُخفى حتى يمسحه المدير)
--    announcement_expires_at  تاريخ ووقت يختفي بعده الإعلان تلقائياً ("" = بلا انتهاء)
--  يعدّلهما المدير فقط (صلاحيات جدول الإعدادات الحالية).
--
--  للسكيمتين معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة.
--  يُنفَّذ في مشروع التجربة أولاً، ثم في مشروع الإنتاج. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.app_settings') is null then continue; end if;
    execute format($q$insert into %I.app_settings (key, value) values
      ('announcement', '""'), ('announcement_type', '"normal"'), ('announcement_expires_at', '""')
      on conflict (key) do nothing$q$, s);
  end loop;
end $do$;

-- التحقق: يجب أن تظهر 3 أسطر لكل سكيما في هذا المشروع
create or replace function pg_temp.check_announcement_type() returns table (السكيما text, الإعداد text, القيمة jsonb)
language plpgsql as $f$
declare s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.app_settings') is not null then
      return query execute format($q$select %L::text, key, value from %I.app_settings where key like 'announcement%%' order by key$q$, s, s);
    end if;
  end loop;
end $f$;
select * from pg_temp.check_announcement_type();
