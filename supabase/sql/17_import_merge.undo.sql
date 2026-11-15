-- =====================================================================
--  تراجع عن 17_import_merge.sql (السكيمات الثلاث، وتتخطى غير الموجودة)
--  يعيد السجل واستقبال نسخة الإنتاج كما في 16_task_code.sql، ويحذف مرجع الاستيراد.
--  لا يدخل أي ملف تجهيز. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    -- ───────────── السجل: نفس 12_import_owner.sql + «عبر الاستيراد» عند التحديث ─────────────
    execute format($f$
create or replace function %1$I.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days', 'imported_at'];
  v_fields text[];
  v_action text;
begin
  if tg_op = 'INSERT' then
    -- إذا أدخلها شخص باسم غيره (الاستيراد)، يُحفظ من أدخلها فعلاً
    if auth.uid() is not null and auth.uid() is distinct from new.created_by then
      v_new := v_new || jsonb_build_object('entered_by', auth.uid());
    end if;
    insert into %1$I.task_audit (task_id, action, changed_by, new_data)
    values (new.id, 'insert', new.created_by, v_new);
    return null;
  end if;

  v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'duration_days', 'imported_at'];
  select array_agg(k order by k) into v_fields
  from jsonb_object_keys(v_new) k
  where v_new -> k is distinct from v_old -> k;

  if v_fields is null then return null; end if;   -- لا تغيير فعلي

  v_action := case
    when old.deleted_at is null and new.deleted_at is not null then 'delete'
    when old.deleted_at is not null and new.deleted_at is null then 'restore'
    else 'update' end;

  insert into %1$I.task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (new.id, v_action, coalesce(auth.uid(), new.updated_by), v_fields,
          (select jsonb_object_agg(k, v_old -> k) from unnest(v_fields) k),
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k)
            || case when new.imported_at is distinct from old.imported_at then '{"via_import": true}'::jsonb else '{}'::jsonb end);
  return null;
end $fn$
    $f$, s);

    execute format('drop trigger if exists tasks_z_import_base on %I.tasks', s);
    execute format('drop function if exists %I.tasks_import_base()', s);
    execute format('drop function if exists %I.save_import_base(jsonb)', s);
  end loop;
end $do$;

-- استقبال نسخة الإنتاج كما في 16 (التجربة والتطوير فقط)
do $u$ begin
  if to_regclass('support_tasks_staging.tasks') is not null then
    execute $f$
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
  -- رمز المهندس: من الإنتاج إن وُجد فيه، وإلا يبقى رمز التطوير
  insert into support_tasks_staging.profiles (id, source_id, email, login_no, full_name, short_name, role, is_active, must_change_password, engineer_code)
  select u.id, u.source_id, u.email, nullif(u.login_no, ''), u.full_name, nullif(u.short_name, ''), u.role::support_tasks_staging.user_role,
         coalesce(u.is_active, true), v_force, nullif(u.engineer_code, '')
  from jsonb_to_recordset(p -> 'users') as u(id uuid, source_id uuid, email text, login_no text, full_name text, short_name text, role text, is_active boolean, engineer_code text)
  on conflict (id) do update set
    source_id = excluded.source_id, email = excluded.email, login_no = excluded.login_no,
    full_name = excluded.full_name, short_name = excluded.short_name,
    engineer_code = coalesce(excluded.engineer_code, profiles.engineer_code),
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
      deleted_at timestamptz, deleted_by uuid, review_reasons text[], priority text,
      task_code text, entered_at timestamptz, imported_at timestamptz)
  )
  insert into support_tasks_staging.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons, priority,
    task_code, entered_at, imported_at)
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
    nullif(t.review_reasons, '{}'),
    case when t.priority = 'urgent' then 'urgent' else 'normal' end,
    nullif(t.task_code, ''), coalesce(t.entered_at, t.created_at), t.imported_at
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
    $f$;
    execute $f$revoke all on function support_tasks_staging.apply_production_snapshot(jsonb) from public, anon, authenticated$f$;
    execute $f$grant execute on function support_tasks_staging.apply_production_snapshot(jsonb) to service_role$f$;
  end if;
end $u$;

do $u$ begin
  if to_regclass('support_tasks_dev.tasks') is not null then
    execute $f$
create or replace function support_tasks_dev.apply_production_snapshot(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = support_tasks_dev
as $$
declare
  v_keep uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'keep') x), '{}');
  v_force boolean := coalesce((p ->> 'force')::boolean, true);
  v_users int; v_tasks int; v_skipped int; v_off int;
begin
  alter table support_tasks_dev.profiles disable trigger user;
  alter table support_tasks_dev.tasks disable trigger user;

  -- المستخدمون: الأرقام تُمسح أولاً ثم تُكتب، حتى لا يتعارض رقم مع مستخدم آخر أثناء النسخ
  update support_tasks_dev.profiles set login_no = null where login_no is not null;
  -- رمز المهندس: من الإنتاج إن وُجد فيه، وإلا يبقى رمز التطوير
  insert into support_tasks_dev.profiles (id, source_id, email, login_no, full_name, short_name, role, is_active, must_change_password, engineer_code)
  select u.id, u.source_id, u.email, nullif(u.login_no, ''), u.full_name, nullif(u.short_name, ''), u.role::support_tasks_dev.user_role,
         coalesce(u.is_active, true), v_force, nullif(u.engineer_code, '')
  from jsonb_to_recordset(p -> 'users') as u(id uuid, source_id uuid, email text, login_no text, full_name text, short_name text, role text, is_active boolean, engineer_code text)
  on conflict (id) do update set
    source_id = excluded.source_id, email = excluded.email, login_no = excluded.login_no,
    full_name = excluded.full_name, short_name = excluded.short_name,
    engineer_code = coalesce(excluded.engineer_code, profiles.engineer_code),
    role      = case when profiles.id = any(v_keep) then profiles.role else excluded.role end,
    is_active = case when profiles.id = any(v_keep) then true else excluded.is_active end,
    must_change_password = case when profiles.id = any(v_keep) then profiles.must_change_password else v_force end;
  get diagnostics v_users = row_count;

  -- مستخدمو التجربة الذين لا نظير لهم في الإنتاج (عدا من ينفّذ): يُعطَّلون ولا يُحذفون
  update support_tasks_dev.profiles set is_active = false
  where is_active and not (id = any(v_keep))
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p -> 'users') x);
  get diagnostics v_off = row_count;

  -- القوائم بالاسم
  insert into support_tasks_dev.task_types (name, sort_order, is_active)
  select name, sort_order, is_active from jsonb_to_recordset(p -> 'lookups' -> 'task_types') as x(name text, sort_order int, is_active boolean)
  on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
  insert into support_tasks_dev.correspondence_types (name, sort_order, is_active)
  select name, sort_order, is_active from jsonb_to_recordset(p -> 'lookups' -> 'correspondence_types') as x(name text, sort_order int, is_active boolean)
  on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
  insert into support_tasks_dev.task_statuses (name, kind, sort_order, is_active)
  select name, kind::support_tasks_dev.status_kind, sort_order, is_active
  from jsonb_to_recordset(p -> 'lookups' -> 'task_statuses') as x(name text, kind text, sort_order int, is_active boolean)
  on conflict (name) do update set kind = excluded.kind, sort_order = excluded.sort_order, is_active = excluded.is_active;

  -- الإعدادات
  insert into support_tasks_dev.app_settings (key, value)
  select x ->> 'key', x -> 'value' from jsonb_array_elements(p -> 'settings') x
  on conflict (key) do update set value = excluded.value;

  -- المهام: نسخة كاملة بنفس الأرقام، مع ربط المهندس والقوائم بنظائرها في التجربة
  truncate support_tasks_dev.task_audit, support_tasks_dev.tasks;
  with lk as (
    select 'tt' as k, (x ->> 'id')::int as pid, s.id as sid
      from jsonb_array_elements(p -> 'lookups' -> 'task_types') x join support_tasks_dev.task_types s on s.name = x ->> 'name'
    union all
    select 'ct', (x ->> 'id')::int, s.id
      from jsonb_array_elements(p -> 'lookups' -> 'correspondence_types') x join support_tasks_dev.correspondence_types s on s.name = x ->> 'name'
    union all
    select 'st', (x ->> 'id')::int, s.id
      from jsonb_array_elements(p -> 'lookups' -> 'task_statuses') x join support_tasks_dev.task_statuses s on s.name = x ->> 'name'
  ), t as (
    select * from jsonb_to_recordset(p -> 'tasks') as t(
      id bigint, engineer_id uuid, ref_no text, requester text, employee_name text, subject text,
      received_date date, completed_date date, notes text, task_type_id int, correspondence_type_id int, status_id int,
      delay_reason text, created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
      deleted_at timestamptz, deleted_by uuid, review_reasons text[], priority text,
      task_code text, entered_at timestamptz, imported_at timestamptz)
  )
  insert into support_tasks_dev.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons, priority,
    task_code, entered_at, imported_at)
  overriding system value
  select t.id, e.id, t.ref_no, t.requester, t.employee_name, coalesce(t.subject, ''), t.received_date, t.completed_date, t.notes,
    (select sid from lk where k = 'tt' and pid = t.task_type_id),
    (select sid from lk where k = 'ct' and pid = t.correspondence_type_id),
    (select sid from lk where k = 'st' and pid = t.status_id),
    t.delay_reason, coalesce(t.created_at, now()),
    (select id from support_tasks_dev.profiles where source_id = t.created_by),
    coalesce(t.updated_at, now()),
    (select id from support_tasks_dev.profiles where source_id = t.updated_by),
    t.deleted_at,
    (select id from support_tasks_dev.profiles where source_id = t.deleted_by),
    nullif(t.review_reasons, '{}'),
    case when t.priority = 'urgent' then 'urgent' else 'normal' end,
    nullif(t.task_code, ''), coalesce(t.entered_at, t.created_at), t.imported_at
  from t
  join support_tasks_dev.profiles e on e.source_id = t.engineer_id
  where (select sid from lk where k = 'st' and pid = t.status_id) is not null;
  get diagnostics v_tasks = row_count;
  v_skipped := jsonb_array_length(coalesce(p -> 'tasks', '[]')) - v_tasks;

  perform setval(pg_get_serial_sequence('support_tasks_dev.tasks', 'id'),
                 coalesce((select max(id) from support_tasks_dev.tasks), 0) + 1, false);

  alter table support_tasks_dev.tasks enable trigger user;
  alter table support_tasks_dev.profiles enable trigger user;

  return jsonb_build_object('users', v_users, 'tasks', v_tasks, 'skipped_tasks', v_skipped, 'deactivated', v_off, 'at', now());
end $$;
    $f$;
    execute $f$revoke all on function support_tasks_dev.apply_production_snapshot(jsonb) from public, anon, authenticated$f$;
    execute $f$grant execute on function support_tasks_dev.apply_production_snapshot(jsonb) to service_role$f$;
  end if;
end $u$;

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    execute format('alter table %I.tasks drop column if exists imported_data', s);
  end loop;
end $do$;

-- التحقق: يجب أن يظهر 0
select count(*) as أعمدة_باقية from information_schema.columns
where table_schema in ('support_tasks', 'support_tasks_staging', 'support_tasks_dev') and column_name = 'imported_data';
