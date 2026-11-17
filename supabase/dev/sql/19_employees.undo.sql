-- =====================================================================
--  تراجع عن 19_employees.sql (سكيما التطوير وحدها)
--  يحذف الموظفين والإسنادات وأنواعها، وربط المستخدمين بالموظفين، وسجلها. الهيكل (18) يبقى كما هو.
--  يُنفَّذ في Tasks-Test ← SQL Editor.
-- =====================================================================

drop function if exists support_tasks_dev.employee_transfer(int, int, date, boolean);
drop function if exists support_tasks_dev.employee_set_active(int, boolean, date);
drop function if exists support_tasks_dev.assignment_delete(int);
drop function if exists support_tasks_dev.assignment_type_delete(int);
drop function if exists support_tasks_dev.employee_set_user(int, uuid);
drop function if exists support_tasks_dev.employees_import(jsonb);

alter table support_tasks_dev.profiles drop column if exists employee_id;
drop table if exists support_tasks_dev.employee_assignments;
drop table if exists support_tasks_dev.assignment_types;
drop table if exists support_tasks_dev.employees;

drop function if exists support_tasks_dev.employees_before_write();
drop function if exists support_tasks_dev.employees_after_insert();
drop function if exists support_tasks_dev.assignment_types_before_write();
drop function if exists support_tasks_dev.employee_assignments_before_write();
drop function if exists support_tasks_dev.link_users_to_employees();
drop function if exists support_tasks_dev.require_admin();
drop function if exists support_tasks_dev.period(date, date);
drop function if exists support_tasks_dev.clean_digits(text);

-- حذف الوحدة يعود لشكله في 18
create or replace function support_tasks_dev.org_units_before_delete()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
begin
  if exists (select 1 from support_tasks_dev.org_units where parent_id = old.id) then
    perform support_tasks_dev.app_error(format('لا يمكن حذف «%s» لأن تحتها وحدات. احذف الوحدات التابعة أولاً، أو عطّل الوحدة.', old.name));
  end if;
  return old;
end $$;

-- السجل يعود لشكله في 18
delete from support_tasks_dev.org_audit where entity not in ('level', 'unit');
alter table support_tasks_dev.org_audit drop constraint if exists org_audit_entity_check;
alter table support_tasks_dev.org_audit add constraint org_audit_entity_check check (entity in ('level', 'unit'));

create or replace function support_tasks_dev.org_audit_write()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - array['updated_at', 'updated_by', 'created_at', 'created_by'] end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - array['updated_at', 'updated_by', 'created_at', 'created_by'] end;
  v_fields text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_fields from jsonb_object_keys(v_new) k where v_new -> k is distinct from v_old -> k;
    if v_fields is null then return null; end if;
  end if;
  insert into support_tasks_dev.org_audit (entity, entity_id, action, changed_by, changed_fields, old_data, new_data)
  values (case tg_table_name when 'org_levels' then 'level' else 'unit' end,
          coalesce(new.id, old.id), lower(tg_op), auth.uid(), v_fields, v_old, v_new);
  return null;
end $$;

-- التحقق: يجب أن يكون العدد صفراً
select count(*) as جداول_الموظفين_الباقية
from information_schema.tables
where table_schema = 'support_tasks_dev' and table_name in ('employees', 'assignment_types', 'employee_assignments');
