-- =====================================================================
--  تراجع عن 22_assign_import.sql (سكيما التطوير وحدها): يحذف دالة الإسناد الجماعي فقط، والإسنادات تبقى.
--  يُنفَّذ في Tasks-Test ← SQL Editor.
-- =====================================================================

drop function if exists support_tasks_dev.employees_assign_bulk(jsonb, date, boolean);

select count(*) as الدالة_الباقية
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'support_tasks_dev' and p.proname = 'employees_assign_bulk';
