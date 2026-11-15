-- =====================================================================
--  تراجع عن 16_task_code.sql (سكيما التطوير وحدها)
--  يعيد الدوال والعرض كما كانت (12_import_owner.sql و13_priority.sql وlink_production.sql)،
--  ثم يحذف الرمز وتاريخ الإدخال ورمز المهندس والعدّاد. تُفقد الرموز وتواريخ الإدخال المحفوظة.
--  لا يدخل أي ملف تجهيز. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

-- 1) دالتا قبل الكتابة والسجل كما في 12_import_owner.sql
do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    if not exists (select 1 from information_schema.columns where table_schema = s and table_name = 'tasks' and column_name = 'review_reasons') then
      raise exception 'نفّذ 10_review.sql و 11_import_as_is.sql أولاً (السكيما %)', s;
    end if;

    execute format($f$
create or replace function %1$I.tasks_before_write()
returns trigger
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_role  %1$I.user_role := %1$I.app_role();
  v_uid   uuid := auth.uid();
  v_kind  %1$I.status_kind;
  v_lock  int;
  v_old_kind %1$I.status_kind;
begin
  if v_role is null and v_uid is not null then
    perform %1$I.app_error('حسابك غير مفعّل.');
  end if;

  if tg_op = 'INSERT' then
    if v_role is null then                      -- إدخال من خارج التطبيق (مثل محرر SQL)
      new.created_by := coalesce(new.created_by, new.engineer_id);
    else
      if v_role = 'viewer' then
        perform %1$I.app_error('المشاهد لا يستطيع إضافة مهام.');
      end if;
      if new.engineer_id is null or v_role = 'engineer' then
        new.engineer_id := v_uid;                -- المهندس يضيف لنفسه فقط
      end if;
      -- الاستيراد (مدير النظام) يسجّل المهمة باسم مهندسها؛ ومن أدخلها فعلاً يُحفظ في السجل (entered_by)
      new.created_by := case when v_role = 'admin' then coalesce(new.created_by, v_uid) else v_uid end;
    end if;
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := new.created_by;
    new.deleted_at := null;
    new.deleted_by := null;
  else
    -- حقول لا تتغير
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(v_uid, old.updated_by);

    if v_role in ('engineer', 'viewer') then
      if new.engineer_id <> old.engineer_id then
        perform %1$I.app_error('لا يمكن نقل المهمة إلى مهندس آخر.');
      end if;
      if new.deleted_at is distinct from old.deleted_at then
        perform %1$I.app_error('الحذف لمدير النظام فقط.');
      end if;
    end if;
    if v_role = 'head' and new.deleted_at is distinct from old.deleted_at then
      perform %1$I.app_error('الحذف لمدير النظام فقط.');
    end if;

    -- قفل التعديل: مهمة مكتملة مضى على انتهائها أكثر من «مدة القفل» (0 = بدون قفل). لا يُطبَّق على المدير ورئيس القسم
    if v_role = 'engineer' then
      v_lock := %1$I.setting_int('edit_lock_days', 0);
      select kind into v_old_kind from %1$I.task_statuses where id = old.status_id;
      if v_lock > 0 and v_old_kind = 'done' and old.completed_date is not null
         and old.completed_date + v_lock < current_date then
        perform %1$I.app_error('المهمة مقفلة: مضى على إنجازها أكثر من ' || v_lock || ' يوم. اطلب من مدير النظام أو رئيس القسم تعديلها.');
      end if;
    end if;
  end if;

  -- تنظيف النصوص
  new.ref_no        := nullif(btrim(new.ref_no), '');
  new.requester     := nullif(btrim(new.requester), '');
  new.employee_name := nullif(btrim(new.employee_name), '');
  new.subject       := btrim(new.subject);
  new.notes         := nullif(btrim(new.notes), '');
  new.delay_reason  := nullif(btrim(new.delay_reason), '');
  new.subject       := coalesce(new.subject, '');

  -- مهمة مستوردة تنتظر المراجعة (review_reasons): تُحفظ كما في الملف تماماً،
  -- وقواعد الإدخال تُطبَّق عند «تمت المراجعة» (مسح الأسباب). الأسباب يضعها الاستيراد فقط (tasks_review_guard)
  if nullif(new.review_reasons, '{}') is not null then
    return new;
  end if;

  if new.subject = '' then
    perform %1$I.app_error('الموضوع مطلوب.');
  end if;
  if new.received_date is null then
    perform %1$I.app_error('تاريخ الاستقبال مطلوب.');
  end if;

  -- الحالة المكتملة تحتاج تاريخ انتهاء، وغير المكتملة لا تحمل تاريخ انتهاء
  select kind into v_kind from %1$I.task_statuses where id = new.status_id;
  if v_kind = 'done' and new.completed_date is null then
    perform %1$I.app_error('المهمة المكتملة تحتاج «تاريخ الانتهاء».');
  end if;
  if v_kind = 'open' then
    new.completed_date := null;
  end if;
  if new.completed_date is not null and new.completed_date < new.received_date then
    perform %1$I.app_error('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الاستقبال.');
  end if;

  return new;
end $fn$
    $f$, s);

    execute format($f$
create or replace function %1$I.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days'];
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

  v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'duration_days'];
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
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k));
  return null;
end $fn$
    $f$, s);
  end loop;
end $do$;

-- 2) عرض المهام كما في 13_priority.sql
do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;

    execute format($q$alter table %I.tasks add column if not exists priority text not null default 'normal'$q$, s);
    if not exists (select 1 from pg_constraint where conname = 'tasks_priority_chk' and conrelid = (s || '.tasks')::regclass) then
      execute format($q$alter table %I.tasks add constraint tasks_priority_chk check (priority in ('normal', 'urgent'))$q$, s);
    end if;
    execute format($q$create index if not exists tasks_urgent_idx on %I.tasks (engineer_id) where priority = 'urgent' and deleted_at is null$q$, s);

    -- عرض المهام: نفس الأعمدة + priority في آخره
    execute format('drop view if exists %I.v_tasks', s);
    execute format($v$
      create view %1$I.v_tasks
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
        t.priority
      from %1$I.tasks t
      join %1$I.profiles p             on p.id = t.engineer_id
      left join %1$I.task_types tt     on tt.id = t.task_type_id
      left join %1$I.correspondence_types ct on ct.id = t.correspondence_type_id
      join %1$I.task_statuses s        on s.id = t.status_id$v$, s);
    execute format('grant select on %I.v_tasks to authenticated', s);
    execute format('grant all on %I.v_tasks to service_role', s);
  end loop;
end $do$;

-- 3) استقبال نسخة الإنتاج كما في supabase/staging/link_production.sql
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
  insert into support_tasks_dev.profiles (id, source_id, email, login_no, full_name, short_name, role, is_active, must_change_password)
  select u.id, u.source_id, u.email, nullif(u.login_no, ''), u.full_name, nullif(u.short_name, ''), u.role::support_tasks_dev.user_role,
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
      deleted_at timestamptz, deleted_by uuid, review_reasons text[], priority text)
  )
  insert into support_tasks_dev.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons, priority)
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
    case when t.priority = 'urgent' then 'urgent' else 'normal' end
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

-- تستدعيها دالة refresh-staging بمفتاح الخادم فقط (لا المتصفح)
revoke all on function support_tasks_dev.apply_production_snapshot(jsonb) from public, anon, authenticated;
grant execute on function support_tasks_dev.apply_production_snapshot(jsonb) to service_role;

-- 4) حذف الإضافات
drop function if exists support_tasks_dev.set_engineer_code(uuid, text);
drop function if exists support_tasks_dev.learn_engineer_codes();
drop function if exists support_tasks_dev.next_task_code(uuid);
drop table if exists support_tasks_dev.task_code_seq;
drop index if exists support_tasks_dev.tasks_task_code_key;
alter table support_tasks_dev.tasks drop column if exists task_code, drop column if exists entered_at, drop column if exists imported_at;
drop index if exists support_tasks_dev.profiles_engineer_code_key;
alter table support_tasks_dev.profiles drop constraint if exists profiles_engineer_code_chk, drop column if exists engineer_code;

-- التحقق: يجب أن يظهر 0
select count(*) as أعمدة_باقية from information_schema.columns
where table_schema = 'support_tasks_dev' and column_name in ('task_code', 'entered_at', 'imported_at', 'engineer_code');
