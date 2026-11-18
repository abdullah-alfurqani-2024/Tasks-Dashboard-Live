-- التراجع عن 23_task_links.sql (بيئة التطوير): يحذف ربط المهام بالوحدات والموظفين (النصوص تبقى)،
-- ويعيد عرض المهام والسجل وحذف الوحدة كما في 16 و17 و21.

drop trigger if exists tasks_links on support_tasks_dev.tasks;
drop function if exists support_tasks_dev.tasks_links();
drop function if exists support_tasks_dev.tasks_link_texts();
drop function if exists support_tasks_dev.tasks_link_apply(jsonb);
drop function if exists support_tasks_dev.employee_directory();

drop view if exists support_tasks_dev.v_tasks;
create view support_tasks_dev.v_tasks
with (security_invoker = true) as
select
  t.id, t.engineer_id, p.full_name as engineer_name, p.short_name as engineer_short,
  t.ref_no, t.requester, t.employee_name, t.subject,
  t.received_date, t.completed_date, t.notes,
  t.task_type_id, tt.name as task_type,
  t.correspondence_type_id, ct.name as correspondence_type,
  t.status_id, s.name as status, s.kind as status_kind,
  t.delay_reason, t.duration_days,
  t.created_at, t.created_by, t.updated_at, t.updated_by,
  t.deleted_at, t.deleted_by,
  t.review_reasons,
  t.priority,
  t.task_code, t.entered_at, t.imported_at, p.engineer_code
from support_tasks_dev.tasks t
join support_tasks_dev.profiles p             on p.id = t.engineer_id
left join support_tasks_dev.task_types tt     on tt.id = t.task_type_id
left join support_tasks_dev.correspondence_types ct on ct.id = t.correspondence_type_id
join support_tasks_dev.task_statuses s        on s.id = t.status_id;
grant select on support_tasks_dev.v_tasks to authenticated;
grant all on support_tasks_dev.v_tasks to service_role;

create or replace function support_tasks_dev.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $fn$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days', 'imported_at', 'imported_data'];
  v_fields text[];
  v_action text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and auth.uid() is distinct from new.created_by then
      v_new := v_new || jsonb_build_object('entered_by', auth.uid());
    end if;
    insert into support_tasks_dev.task_audit (task_id, action, changed_by, new_data)
    values (new.id, 'insert', new.created_by, v_new);
    return null;
  end if;
  v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'duration_days', 'imported_at', 'imported_data'];
  select array_agg(k order by k) into v_fields
  from jsonb_object_keys(v_new) k
  where v_new -> k is distinct from v_old -> k;
  if v_fields is null then return null; end if;
  v_action := case
    when old.deleted_at is null and new.deleted_at is not null then 'delete'
    when old.deleted_at is not null and new.deleted_at is null then 'restore'
    else 'update' end;
  insert into support_tasks_dev.task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (new.id, v_action, coalesce(auth.uid(), new.updated_by), v_fields,
          (select jsonb_object_agg(k, v_old -> k) from unnest(v_fields) k),
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k)
            || case when new.imported_at is distinct from old.imported_at then '{"via_import": true}'::jsonb else '{}'::jsonb end);
  return null;
end $fn$;

create or replace function support_tasks_dev.org_units_before_delete()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_n int;
begin
  if current_setting('support_tasks_dev.org_bulk', true) = 'on' then return old; end if;
  if exists (select 1 from support_tasks_dev.org_units where parent_id = old.id) then
    perform support_tasks_dev.app_error(format('لا يمكن حذف «%s» لأن تحتها وحدات. احذف الوحدات التابعة أولاً، أو عطّل الوحدة.', old.name));
  end if;
  select count(*) into v_n from support_tasks_dev.employee_assignments where unit_id = old.id;
  if v_n > 0 then
    perform support_tasks_dev.app_error(format('لا يمكن حذف «%s» لأن لها %s إسناد موظفين (حالية أو سابقة)؛ عطّلها بدلاً من حذفها.', old.name, v_n));
  end if;
  return old;
end $$;

drop function if exists support_tasks_dev.tasks_bulk_link();
drop function if exists support_tasks_dev.setting_on(text, boolean);
alter table support_tasks_dev.tasks drop column if exists requester_unit_id;
alter table support_tasks_dev.tasks drop column if exists employee_id;
delete from support_tasks_dev.app_settings where key = 'allow_unlisted';
