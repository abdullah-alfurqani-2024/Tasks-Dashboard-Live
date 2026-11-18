-- =====================================================================
--  تراجع عن 20_employees_review.sql (سكيما التطوير وحدها)
--  1) يحذف الموظفين الذين بلا رقم مدني (وإسناداتهم وربطهم بالمستخدمين)، لأن الرقم المدني يعود إلزامياً
--  2) يحذف عمودي المراجعة
--  3) بعده: نفّذ 18_org_structure.sql ثم 19_employees.sql مرة أخرى لاسترجاع الدوال والسياسات كما كانت (آمن، لا يمس البيانات)
--  يُنفَّذ في Tasks-Test ← SQL Editor.
-- =====================================================================

drop function if exists support_tasks_dev.employees_purge();

update support_tasks_dev.profiles set employee_id = null
where employee_id in (select id from support_tasks_dev.employees where civil_no is null);
delete from support_tasks_dev.employee_assignments
where employee_id in (select id from support_tasks_dev.employees where civil_no is null);
delete from support_tasks_dev.employees where civil_no is null;

drop index if exists support_tasks_dev.employees_review_idx;
drop index if exists support_tasks_dev.employees_nocivil_name_idx;
alter table support_tasks_dev.employees drop column if exists review_notes;
alter table support_tasks_dev.employees drop column if exists needs_review;
alter table support_tasks_dev.employees alter column civil_no set not null;

-- التحقق: يجب أن يكون العدد صفراً، ثم نفّذ 18_org_structure.sql ثم 19_employees.sql
select count(*) as أعمدة_المراجعة_الباقية
from information_schema.columns
where table_schema = 'support_tasks_dev' and table_name = 'employees' and column_name in ('needs_review', 'review_notes');
