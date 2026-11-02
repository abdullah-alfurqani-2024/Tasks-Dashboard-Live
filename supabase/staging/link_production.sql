-- =====================================================================
--  نسخة التجربة (مشروع Supabase مستقل عن الإنتاج): استقبال نسخة بيانات الإنتاج
--
--  بعد فصل الإنتاج في مشروع مستقل، لا تستطيع قاعدة التجربة قراءة الإنتاج بـ SQL.
--  فالنسخ تقوم به دالة refresh-staging (Edge Function في مشروع التجربة):
--    1) تقرأ من الإنتاج بحساب «مشاهد» (قراءة فقط)
--    2) تنشئ/تحدّث حسابات دخول التجربة (كلمات مرور التجربة مستقلة عن الإنتاج)
--    3) تستدعي apply_production_snapshot أدناه لتكتب البيانات في التجربة دفعة واحدة
--
--  يُنفَّذ مرة واحدة في SQL Editor في مشروع التجربة (pfarespmmaphtlscgmar). يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

-- ربط كل مستخدم في التجربة بنظيره في الإنتاج
alter table support_tasks_staging.profiles add column if not exists source_id uuid;
create unique index if not exists profiles_source_id_key on support_tasks_staging.profiles (source_id) where source_id is not null;

-- دالة النسخ القديمة كانت تقرأ من سكيما الإنتاج في نفس المشروع؛ لم تعد صالحة بعد الفصل
drop function if exists support_tasks_staging.refresh_from_production();

/*
  p: {
    keep:     [uuid]                -- حساب من ينفّذ النسخ: لا يتغير دوره ولا تفعيله ولا إلزام تغيير كلمة مروره
    force:    boolean               -- إلزام تغيير كلمة المرور عند أول دخول للتجربة
    users:    [{ id, source_id, email, login_no, full_name, short_name, role, is_active }]   (id = حساب التجربة)
    lookups:  { task_types: [...], correspondence_types: [...], task_statuses: [...] }       (بأرقام الإنتاج)
    settings: [{ key, value }]
    tasks:    [ صفوف جدول المهام في الإنتاج كما هي ]
  }
*/
create or replace function support_tasks_staging.apply_production_snapshot(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = support_tasks_staging
as $$
declare
  v_keep uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'keep') x), '{}');
  v_force boolean := coalesce((p ->> 'force')::boolean, true);
  v_users int; v_tasks int; v_skipped int; v_off int;
begin
  alter table support_tasks_staging.profiles disable trigger user;
  alter table support_tasks_staging.tasks disable trigger user;

  -- المستخدمون: الأرقام تُمسح أولاً ثم تُكتب، حتى لا يتعارض رقم مع مستخدم آخر أثناء النسخ
  update support_tasks_staging.profiles set login_no = null where login_no is not null;
  insert into support_tasks_staging.profiles (id, source_id, email, login_no, full_name, short_name, role, is_active, must_change_password)
  select u.id, u.source_id, u.email, nullif(u.login_no, ''), u.full_name, nullif(u.short_name, ''), u.role::support_tasks_staging.user_role,
         coalesce(u.is_active, true), v_force
  from jsonb_to_recordset(p -> 'users') as u(id uuid, source_id uuid, email text, login_no text, full_name text, short_name text, role text, is_active boolean)
  on conflict (id) do update set
    source_id = excluded.source_id, email = excluded.email, login_no = excluded.login_no,
    full_name = excluded.full_name, short_name = excluded.short_name,
    role      = case when profiles.id = any(v_keep) then profiles.role else excluded.role end,
    is_active = case when profiles.id = any(v_keep) then true else excluded.is_active end,
    must_change_password = case when profiles.id = any(v_keep) then profiles.must_change_password else v_force end;
  get diagnostics v_users = row_count;

  -- مستخدمو التجربة الذين لا نظير لهم في الإنتاج (عدا من ينفّذ): يُعطَّلون ولا يُحذفون
  update support_tasks_staging.profiles set is_active = false
  where is_active and not (id = any(v_keep))
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p -> 'users') x);
  get diagnostics v_off = row_count;

  -- القوائم بالاسم
  insert into support_tasks_staging.task_types (name, sort_order, is_active)
  select name, sort_order, is_active from jsonb_to_recordset(p -> 'lookups' -> 'task_types') as x(name text, sort_order int, is_active boolean)
  on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
  insert into support_tasks_staging.correspondence_types (name, sort_order, is_active)
  select name, sort_order, is_active from jsonb_to_recordset(p -> 'lookups' -> 'correspondence_types') as x(name text, sort_order int, is_active boolean)
  on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
  insert into support_tasks_staging.task_statuses (name, kind, sort_order, is_active)
  select name, kind::support_tasks_staging.status_kind, sort_order, is_active
  from jsonb_to_recordset(p -> 'lookups' -> 'task_statuses') as x(name text, kind text, sort_order int, is_active boolean)
  on conflict (name) do update set kind = excluded.kind, sort_order = excluded.sort_order, is_active = excluded.is_active;

  -- الإعدادات
  insert into support_tasks_staging.app_settings (key, value)
  select x ->> 'key', x -> 'value' from jsonb_array_elements(p -> 'settings') x
  on conflict (key) do update set value = excluded.value;

  -- المهام: نسخة كاملة بنفس الأرقام، مع ربط المهندس والقوائم بنظائرها في التجربة
  truncate support_tasks_staging.task_audit, support_tasks_staging.tasks;
  with lk as (
    select 'tt' as k, (x ->> 'id')::int as pid, s.id as sid
      from jsonb_array_elements(p -> 'lookups' -> 'task_types') x join support_tasks_staging.task_types s on s.name = x ->> 'name'
    union all
    select 'ct', (x ->> 'id')::int, s.id
      from jsonb_array_elements(p -> 'lookups' -> 'correspondence_types') x join support_tasks_staging.correspondence_types s on s.name = x ->> 'name'
    union all
    select 'st', (x ->> 'id')::int, s.id
      from jsonb_array_elements(p -> 'lookups' -> 'task_statuses') x join support_tasks_staging.task_statuses s on s.name = x ->> 'name'
  ), t as (
    select * from jsonb_to_recordset(p -> 'tasks') as t(
      id bigint, engineer_id uuid, ref_no text, requester text, employee_name text, subject text,
      received_date date, completed_date date, notes text, task_type_id int, correspondence_type_id int, status_id int,
      delay_reason text, created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
      deleted_at timestamptz, deleted_by uuid, review_reasons text[])
  )
  insert into support_tasks_staging.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons)
  overriding system value
  select t.id, e.id, t.ref_no, t.requester, t.employee_name, coalesce(t.subject, ''), t.received_date, t.completed_date, t.notes,
    (select sid from lk where k = 'tt' and pid = t.task_type_id),
    (select sid from lk where k = 'ct' and pid = t.correspondence_type_id),
    (select sid from lk where k = 'st' and pid = t.status_id),
    t.delay_reason, coalesce(t.created_at, now()),
    (select id from support_tasks_staging.profiles where source_id = t.created_by),
    coalesce(t.updated_at, now()),
    (select id from support_tasks_staging.profiles where source_id = t.updated_by),
    t.deleted_at,
    (select id from support_tasks_staging.profiles where source_id = t.deleted_by),
    nullif(t.review_reasons, '{}')
  from t
  join support_tasks_staging.profiles e on e.source_id = t.engineer_id
  where (select sid from lk where k = 'st' and pid = t.status_id) is not null;
  get diagnostics v_tasks = row_count;
  v_skipped := jsonb_array_length(coalesce(p -> 'tasks', '[]')) - v_tasks;

  perform setval(pg_get_serial_sequence('support_tasks_staging.tasks', 'id'),
                 coalesce((select max(id) from support_tasks_staging.tasks), 0) + 1, false);

  alter table support_tasks_staging.tasks enable trigger user;
  alter table support_tasks_staging.profiles enable trigger user;

  return jsonb_build_object('users', v_users, 'tasks', v_tasks, 'skipped_tasks', v_skipped, 'deactivated', v_off, 'at', now());
end $$;

-- تستدعيها دالة refresh-staging بمفتاح الخادم فقط (لا المتصفح)
revoke all on function support_tasks_staging.apply_production_snapshot(jsonb) from public, anon, authenticated;
grant execute on function support_tasks_staging.apply_production_snapshot(jsonb) to service_role;

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة, count(*) as مستخدمو_التجربة from support_tasks_staging.profiles;
