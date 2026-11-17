-- =====================================================================
--  تراجع عن 18_org_structure.sql (سكيما التطوير وحدها)
--  يحذف الهيكل التنظيمي كاملاً: المستويات والوحدات وسجلها. لا يمس المهام ولا المستخدمين.
--  يُنفَّذ في Tasks-Test ← SQL Editor.
-- =====================================================================

drop function if exists support_tasks_dev.org_set_active(int, boolean, boolean);
drop function if exists support_tasks_dev.org_delete_unit(int);
drop function if exists support_tasks_dev.org_delete_level(int);

drop table if exists support_tasks_dev.org_audit;
drop table if exists support_tasks_dev.org_units;
drop table if exists support_tasks_dev.org_levels;

drop function if exists support_tasks_dev.org_units_before_write();
drop function if exists support_tasks_dev.org_units_after_update();
drop function if exists support_tasks_dev.org_units_before_delete();
drop function if exists support_tasks_dev.org_levels_before_write();
drop function if exists support_tasks_dev.org_levels_before_delete();
drop function if exists support_tasks_dev.org_audit_write();
drop function if exists support_tasks_dev.org_subtree(int);
drop function if exists support_tasks_dev.org_path(int);

-- التحقق: يجب أن يكون العدد صفراً
select count(*) as جداول_الهيكل_الباقية
from information_schema.tables
where table_schema = 'support_tasks_dev' and table_name like 'org\_%';
