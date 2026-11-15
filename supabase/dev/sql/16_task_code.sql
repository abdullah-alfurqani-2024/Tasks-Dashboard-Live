-- =====================================================================
--  نظام مهام الدعم الفني — 16: رمز المهمة وتاريخ الإدخال (قيد التطوير: سكيما التطوير وحدها)
--
--  لكل مهمة رمز ثابت لا يتكرر (حتى بين المحذوفة)، ولا يتغير بعد إعطائه:
--    - من Google Sheets عبر الاستيراد: رمز المهندس + تسلسل، مثل A08-0177
--    - المهمة التي تُنشأ في النظام: رمز مهندسها + S + تسلسل خاص بالنظام، مثل A08-S0001،
--      فلا يتعارض أبداً مع تسلسل Sheets. والمهندس الذي ليس له رمز بعد: S-00001
--      (عدّاد دائم task_code_seq: الرقم لا يُعاد استخدامه حتى بعد حذف المهام)
--  رمز المهندس (A01…A15) في حسابه (profiles.engineer_code): يُعرف تلقائياً من رموز مهامه
--  بعد الاستيراد (learn_engineer_codes)، ويعدّله مدير النظام (set_engineer_code).
--
--  تاريخ الإدخال (entered_at): من Sheets عبر الاستيراد، وإلا وقت الإضافة في النظام.
--  imported_at: آخر مرة كتب فيها الاستيراد المهمة (إضافة أو تحديث)، لمعرفة ما عُدّل في النظام بعدها.
--  الاستيراد الذي يحدّث مهمة يُعلَّم في السجل «عبر الاستيراد» (new_data.via_import).
--
--  لسكيما التطوير وحدها (supabase/dev/sql)، بعد setup_dev.sql. يمكن إعادة تنفيذه بلا ضرر.
--  التراجع: 16_task_code.undo.sql
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    if not exists (select 1 from information_schema.columns where table_schema = s and table_name = 'tasks' and column_name = 'priority') then
      raise exception 'نفّذ 13_priority.sql أولاً (السكيما %)', s;
    end if;

    -- ───────────── الأعمدة ─────────────
    execute format('alter table %I.profiles add column if not exists engineer_code text', s);
    if not exists (select 1 from pg_constraint where conname = 'profiles_engineer_code_chk' and conrelid = (s || '.profiles')::regclass) then
      execute format($q$alter table %I.profiles add constraint profiles_engineer_code_chk check (engineer_code ~ '^[A-Z]+[0-9]+$')$q$, s);
    end if;
    execute format('create unique index if not exists profiles_engineer_code_key on %I.profiles (engineer_code) where engineer_code is not null', s);

    execute format('alter table %I.tasks add column if not exists task_code text', s);
    execute format('alter table %I.tasks add column if not exists entered_at timestamptz', s);
    execute format('alter table %I.tasks add column if not exists imported_at timestamptz', s);
    -- فريد في كل المهام، والمحذوفة منها أيضاً
    execute format('create unique index if not exists tasks_task_code_key on %I.tasks (task_code)', s);

    -- عدّاد رموز النظام لكل بادئة (A08-S، S-): لا يُعاد ترقيمه عند حذف المهام
    execute format('create table if not exists %I.task_code_seq (prefix text primary key, last_no int not null default 0)', s);
    execute format('alter table %I.task_code_seq enable row level security', s);   -- بلا سياسات: مغلق إلا لدوال النظام
    execute format('grant all on %I.task_code_seq to service_role', s);

    -- ───────────── الرمز التالي لمهمة تُنشأ في النظام ─────────────
    execute format($f$
create or replace function %1$I.next_task_code(p_engineer uuid)
returns text
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_eng    text;
  v_prefix text;
  v_digits int;
  v_last   int;
  v_max    int;
  v_no     text;
begin
  select engineer_code into v_eng from %1$I.profiles where id = p_engineer;
  if v_eng is not null then v_prefix := v_eng || '-S'; v_digits := 4;
  else v_prefix := 'S-'; v_digits := 5; end if;

  insert into %1$I.task_code_seq (prefix) values (v_prefix) on conflict do nothing;
  select last_no into v_last from %1$I.task_code_seq where prefix = v_prefix for update;   -- يمنع إعطاء الرقم نفسه مرتين
  -- احتياطاً: أكبر رقم مستخدم فعلاً بهذه البادئة (مثل مهام منسوخة من الإنتاج)
  select coalesce(max(substr(task_code, length(v_prefix) + 1)::int), 0) into v_max
  from %1$I.tasks
  where left(task_code, length(v_prefix)) = v_prefix and substr(task_code, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';

  v_last := greatest(v_last, v_max) + 1;
  update %1$I.task_code_seq set last_no = v_last where prefix = v_prefix;
  v_no := v_last::text;
  return v_prefix || case when length(v_no) >= v_digits then v_no else lpad(v_no, v_digits, '0') end;
end $fn$
    $f$, s);
    execute format('revoke all on function %I.next_task_code(uuid) from public, anon, authenticated', s);

    -- ───────────── قبل الكتابة: نفس 12_import_owner.sql + الرمز وتاريخ الإدخال ─────────────
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
  v_import boolean := v_role is null or v_role = 'admin';   -- الاستيراد (مدير النظام) أو محرر SQL
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

    -- رمز المهمة وتاريخ الإدخال: من الملف عند الاستيراد، وإلا يُعطيان تلقائياً
    if v_import then
      new.task_code   := nullif(upper(btrim(new.task_code)), '');
      new.entered_at  := coalesce(new.entered_at, now());
      new.imported_at := case when new.imported_at is not null then now() end;
    else
      new.task_code   := null;
      new.entered_at  := now();
      new.imported_at := null;
    end if;
    if new.task_code is null then
      new.task_code := %1$I.next_task_code(new.engineer_id);
    end if;
  else
    -- حقول لا تتغير
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(v_uid, old.updated_by);

    -- الرمز ثابت بعد إعطائه
    if old.task_code is not null or not v_import then
      new.task_code := old.task_code;
    else
      new.task_code := nullif(upper(btrim(new.task_code)), '');
    end if;
    if v_import then
      new.entered_at  := coalesce(new.entered_at, old.entered_at);
      -- الاستيراد يرسل imported_at عند التحديث، فيُختم بوقت التحديث نفسه (= updated_at)
      new.imported_at := case when new.imported_at is distinct from old.imported_at then now() else old.imported_at end;
    else
      new.entered_at  := old.entered_at;
      new.imported_at := old.imported_at;
    end if;

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

    -- ───────────── عرض المهام: نفس 13_priority.sql + الرمز وتاريخ الإدخال ورمز المهندس في آخره ─────────────
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
        t.priority,
        t.task_code, t.entered_at, t.imported_at, p.engineer_code
      from %1$I.tasks t
      join %1$I.profiles p             on p.id = t.engineer_id
      left join %1$I.task_types tt     on tt.id = t.task_type_id
      left join %1$I.correspondence_types ct on ct.id = t.correspondence_type_id
      join %1$I.task_statuses s        on s.id = t.status_id$v$, s);
    execute format('grant select on %I.v_tasks to authenticated', s);
    execute format('grant all on %I.v_tasks to service_role', s);

    -- ───────────── رمز المهندس ─────────────
    -- مدير النظام يحدده أو يمسحه من صفحة المستخدمين
    execute format($f$
create or replace function %1$I.set_engineer_code(p_id uuid, p_code text)
returns text
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_code text := nullif(upper(btrim(p_code)), '');
begin
  if %1$I.app_role() is distinct from 'admin' then
    perform %1$I.app_error('رمز المهندس لمدير النظام فقط.');
  end if;
  if v_code is not null and v_code !~ '^[A-Z]+[0-9]+$' then
    perform %1$I.app_error('رمز المهندس حروف إنجليزية ثم أرقام، مثل A08.');
  end if;
  if v_code is not null and exists (select 1 from %1$I.profiles where engineer_code = v_code and id <> p_id) then
    perform %1$I.app_error('رمز المهندس ' || v_code || ' مستخدم لحساب آخر.');
  end if;
  update %1$I.profiles set engineer_code = v_code where id = p_id;
  if not found then
    perform %1$I.app_error('المستخدم غير موجود.');
  end if;
  return v_code;
end $fn$
    $f$, s);

    -- بعد الاستيراد: المهندس الذي ليس له رمز يأخذه من رموز مهامه في Sheets (A08-0177 ← A08)،
    -- إن كانت كلها ببادئة واحدة لا يملكها غيره. يعيد عدد من أُعطوا رموزاً.
    execute format($f$
create or replace function %1$I.learn_engineer_codes()
returns int
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_n int;
begin
  if %1$I.app_role() is distinct from 'admin' then
    perform %1$I.app_error('لمدير النظام فقط.');
  end if;
  with c as (
    select distinct t.engineer_id, split_part(t.task_code, '-', 1) as pre
    from %1$I.tasks t
    where t.task_code ~ '^[A-Z]+[0-9]+-[0-9]+$'
  ), one as (
    select engineer_id, min(pre) as pre from c group by engineer_id having count(*) = 1
  ), uniq as (
    select pre from one group by pre having count(*) = 1
  )
  update %1$I.profiles p set engineer_code = one.pre
  from one join uniq using (pre)
  where p.id = one.engineer_id and p.engineer_code is null
    and not exists (select 1 from %1$I.profiles q where q.engineer_code = one.pre);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$
    $f$, s);

    execute format('revoke all on function %1$I.set_engineer_code(uuid, text), %1$I.learn_engineer_codes() from public, anon', s);
    execute format('grant execute on function %1$I.set_engineer_code(uuid, text), %1$I.learn_engineer_codes() to authenticated', s);
  end loop;
end $do$;

-- ───────────── استقبال نسخة الإنتاج: نفس supabase/staging/link_production.sql + الأعمدة الجديدة ─────────────
-- الإنتاج قبل هذا التعديل لا يرسل الرمز ولا تاريخ الإدخال: تُنسخ مهامه بلا رمز، وتاريخ إدخالها = تاريخ إضافتها.
-- (عند النقل إلى التجربة: يُنقل هذا التعديل إلى link_production.sql نفسه)
/*
  p: {
    keep:     [uuid]                -- حساب من ينفّذ النسخ: لا يتغير دوره ولا تفعيله ولا إلزام تغيير كلمة مروره
    force:    boolean               -- إلزام تغيير كلمة المرور عند أول دخول للتجربة
    users:    [{ id, source_id, email, login_no, full_name, short_name, role, is_active, engineer_code? }]   (id = حساب التجربة)
    lookups:  { task_types: [...], correspondence_types: [...], task_statuses: [...] }       (بأرقام الإنتاج)
    settings: [{ key, value }]
    tasks:    [ صفوف جدول المهام في الإنتاج كما هي ]
  }
*/
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

-- تستدعيها دالة refresh-staging بمفتاح الخادم فقط (لا المتصفح)
revoke all on function support_tasks_dev.apply_production_snapshot(jsonb) from public, anon, authenticated;
grant execute on function support_tasks_dev.apply_production_snapshot(jsonb) to service_role;

-- المهام الموجودة قبل هذا التعديل: تاريخ إدخالها = تاريخ إضافتها (بلا مشغّلات، فلا يُكتب في السجل)
alter table support_tasks_dev.tasks disable trigger user;
update support_tasks_dev.tasks set entered_at = created_at where entered_at is null;
alter table support_tasks_dev.tasks enable trigger user;

-- التحقق: سطر واحد، وكل القيم true
select
  exists (select 1 from information_schema.columns where table_schema = 'support_tasks_dev' and table_name = 'v_tasks' and column_name = 'task_code') as عرض_المهام,
  exists (select 1 from information_schema.columns where table_schema = 'support_tasks_dev' and table_name = 'profiles' and column_name = 'engineer_code') as رمز_المهندس,
  position('next_task_code' in (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'support_tasks_dev' and p.proname = 'tasks_before_write')) > 0 as الإعطاء_التلقائي,
  position('task_code' in (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'support_tasks_dev' and p.proname = 'apply_production_snapshot')) > 0 as النسخ_من_الإنتاج;
