-- =====================================================================
--  نسخة التجربة: دالة «تحديث بيانات التجربة من الإنتاج» (زر في صفحة الإعدادات)
--  تُنفَّذ مرة واحدة في SQL Editor (وهي ضمن setup_staging.sql أيضاً)
--
--  تقرأ من الإنتاج (support_tasks) وتكتب في التجربة (support_tasks_staging) فقط.
--  لا تكتب في الإنتاج أبداً. يستدعيها مدير النظام من نسخة التجربة.
-- =====================================================================

create or replace function support_tasks_staging.refresh_from_production()
returns jsonb
language plpgsql
security definer
set search_path = support_tasks_staging
as $$
declare
  v_users int;
  v_tasks int;
begin
  if support_tasks_staging.app_role() is distinct from 'admin' then
    perform support_tasks_staging.app_error('تحديث بيانات التجربة لمدير النظام فقط.');
  end if;

  -- قيود الجداول تُوقف أثناء النسخ فقط (داخل هذه العملية)، والسجل لا يسجّل النسخ
  alter table support_tasks_staging.profiles disable trigger user;
  alter table support_tasks_staging.tasks disable trigger user;

  -- المستخدمون: نفس الحسابات، وتُحدَّث أسماؤهم وأدوارهم من الإنتاج
  insert into support_tasks_staging.profiles (id, email, full_name, short_name, role, is_active, must_change_password, created_at, updated_at)
  select id, email, full_name, short_name, role::text::support_tasks_staging.user_role, is_active, false, created_at, updated_at
  from support_tasks.profiles
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, short_name = excluded.short_name,
    role = excluded.role, is_active = excluded.is_active;

  -- القوائم
  insert into support_tasks_staging.task_types (name, sort_order, is_active)
  select name, sort_order, is_active from support_tasks.task_types
  on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
  insert into support_tasks_staging.correspondence_types (name, sort_order, is_active)
  select name, sort_order, is_active from support_tasks.correspondence_types
  on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
  insert into support_tasks_staging.task_statuses (name, kind, sort_order, is_active)
  select name, kind::text::support_tasks_staging.status_kind, sort_order, is_active from support_tasks.task_statuses
  on conflict (name) do update set kind = excluded.kind, sort_order = excluded.sort_order, is_active = excluded.is_active;

  -- الإعدادات
  insert into support_tasks_staging.app_settings (key, value)
  select key, value from support_tasks.app_settings
  on conflict (key) do update set value = excluded.value;

  -- المهام: تُستبدل كلها بنسخة من الإنتاج (بنفس الأرقام)، ويُفرَّغ سجل التعديلات
  truncate support_tasks_staging.task_audit;
  delete from support_tasks_staging.tasks;
  insert into support_tasks_staging.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
  overriding system value
  select t.id, t.engineer_id, t.ref_no, t.requester, t.employee_name, t.subject, t.received_date, t.completed_date, t.notes,
    (select s.id from support_tasks_staging.task_types s join support_tasks.task_types p on p.name = s.name where p.id = t.task_type_id),
    (select s.id from support_tasks_staging.correspondence_types s join support_tasks.correspondence_types p on p.name = s.name where p.id = t.correspondence_type_id),
    (select s.id from support_tasks_staging.task_statuses s join support_tasks.task_statuses p on p.name = s.name where p.id = t.status_id),
    t.delay_reason, t.created_at, t.created_by, t.updated_at, t.updated_by, t.deleted_at, t.deleted_by
  from support_tasks.tasks t;
  perform setval(pg_get_serial_sequence('support_tasks_staging.tasks', 'id'),
                 coalesce((select max(id) from support_tasks_staging.tasks), 0) + 1, false);

  alter table support_tasks_staging.tasks enable trigger user;
  alter table support_tasks_staging.profiles enable trigger user;

  select count(*) into v_users from support_tasks_staging.profiles;
  select count(*) into v_tasks from support_tasks_staging.tasks;
  return jsonb_build_object('users', v_users, 'tasks', v_tasks, 'at', now());
end $$;

revoke all on function support_tasks_staging.refresh_from_production() from public, anon;
grant execute on function support_tasks_staging.refresh_from_production() to authenticated;
