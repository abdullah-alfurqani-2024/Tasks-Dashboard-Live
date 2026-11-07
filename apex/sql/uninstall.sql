-- =====================================================================
--  نظام مهام الدعم الفني — نسخة Oracle APEX
--  حذف كل كائنات النظام من قاعدة البيانات (لإعادة التركيب من الصفر)
--  ⚠️ يحذف كل البيانات نهائياً. لا يحذف تطبيق APEX نفسه (يُحذف من App Builder).
-- =====================================================================

begin
  for o in (
    select 'drop trigger ' || object_name s from user_objects where object_type = 'TRIGGER' and object_name in ('ST_TASKS_BIU', 'ST_TASKS_AUDIT')
    union all select 'drop package st_api' from user_objects where object_type = 'PACKAGE' and object_name = 'ST_API'
    union all select 'drop view st_v_tasks' from user_objects where object_type = 'VIEW' and object_name = 'ST_V_TASKS'
  ) loop
    execute immediate o.s;
  end loop;
  for t in (
    select table_name from user_tables
     where table_name in ('ST_TASK_AUDIT', 'ST_TASKS', 'ST_TASK_TYPES', 'ST_CORRESPONDENCE_TYPES', 'ST_TASK_STATUSES',
                          'ST_APP_SETTINGS', 'ST_LOGIN_FAILURES', 'ST_ACTING', 'ST_PROFILES')
     order by decode(table_name, 'ST_TASK_AUDIT', 1, 'ST_TASKS', 2, 'ST_PROFILES', 9, 5)
  ) loop
    execute immediate 'drop table ' || t.table_name || ' cascade constraints purge';
  end loop;
end;
/
