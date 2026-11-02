-- =====================================================================
--  نسخة التجربة: سكيما support_tasks_staging
--  ملف مولَّد تلقائياً من supabase/sql/01-04 (لا تعدّله يدوياً: node tools/staging-sql.mjs)
--
--  يُنفَّذ في Supabase ← SQL Editor مرة واحدة، ثم:
--    Project Settings ← Data API ← Exposed schemas: أضف support_tasks_staging
--  ويمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

-- ===================== 01_schema.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 01: الجداول
--  يُنفَّذ أولاً في Supabase ← SQL Editor
--  SQL قياسي لـ PostgreSQL. الارتباط الوحيد بـ Supabase: profiles.id يشير إلى auth.users
-- =====================================================================

-- كل جداول النظام في سكيما مستقلة حتى لا تختلط بجداولك الأخرى في public
-- (لتغيير الاسم: استبدل support_tasks_staging بالاسم الجديد في كل ملفات SQL وفي js/config.js ودالة admin-users)
create schema if not exists support_tasks_staging;

-- أنواع ثابتة
do $$ begin
  create type support_tasks_staging.user_role as enum ('admin', 'head', 'engineer', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_tasks_staging.status_kind as enum ('open', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- المستخدمون: صف لكل حساب دخول (ينشئه مدير النظام)
--   admin    مدير النظام: كل الصلاحيات
--   head     رئيس القسم: كل المهام والتقارير والقوائم، بدون المستخدمين والإعدادات والحذف
--   engineer مهندس: مهامه فقط
--   viewer   مشاهد: التقارير والمهام للقراءة فقط
-- ---------------------------------------------------------------------
create table if not exists support_tasks_staging.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null unique,
  full_name            text not null,
  short_name           text,
  role                 support_tasks_staging.user_role not null default 'engineer',
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- القوائم: نوع المهمة، نوع المراسلة، الحالة
-- لا تُحذف القيم المستخدمة؛ تُعطَّل (is_active = false) فتختفي من الاختيار وتبقى في المهام القديمة
-- ---------------------------------------------------------------------
create table if not exists support_tasks_staging.task_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists support_tasks_staging.correspondence_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists support_tasks_staging.task_statuses (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  kind       support_tasks_staging.status_kind not null default 'open',   -- open = مفتوحة، done = مكتملة، cancelled = ملغاة
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------
-- المهام
-- ---------------------------------------------------------------------
create table if not exists support_tasks_staging.tasks (
  id                     bigint generated always as identity primary key,
  engineer_id            uuid not null references support_tasks_staging.profiles (id),
  ref_no                 text,                                   -- رقم القيد (نص: قد يحتوي / أو حروفاً)
  requester              text,                                   -- الجهة الطالبة
  employee_name          text,                                   -- اسم الموظف
  subject                text not null,                          -- الموضوع
  received_date          date not null,                          -- تاريخ الاستقبال
  completed_date         date,                                   -- تاريخ الانتهاء (للمكتملة)
  notes                  text,                                   -- الملاحظات
  task_type_id           smallint references support_tasks_staging.task_types (id),
  correspondence_type_id smallint references support_tasks_staging.correspondence_types (id),
  status_id              smallint not null references support_tasks_staging.task_statuses (id),
  delay_reason           text,                                   -- سبب تأخير إنجاز المهمة
  duration_days          int generated always as (completed_date - received_date) stored,  -- المدة
  created_at             timestamptz not null default now(),     -- تاريخ الإدخال
  created_by             uuid references support_tasks_staging.profiles (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references support_tasks_staging.profiles (id),
  deleted_at             timestamptz,                            -- حذف ناعم
  deleted_by             uuid references support_tasks_staging.profiles (id),
  constraint tasks_dates_chk check (completed_date is null or completed_date >= received_date)
);

create index if not exists tasks_engineer_idx on support_tasks_staging.tasks (engineer_id, received_date desc) where deleted_at is null;
create index if not exists tasks_received_idx on support_tasks_staging.tasks (received_date desc) where deleted_at is null;
create index if not exists tasks_status_idx   on support_tasks_staging.tasks (status_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- الإعدادات العامة (يعدّلها مدير النظام)
-- ---------------------------------------------------------------------
create table if not exists support_tasks_staging.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references support_tasks_staging.profiles (id)
);

-- ---------------------------------------------------------------------
-- سجل التعديلات على المهام (يكتبه النظام تلقائياً)
-- ---------------------------------------------------------------------
create table if not exists support_tasks_staging.task_audit (
  id             bigint generated always as identity primary key,
  task_id        bigint not null,
  action         text not null check (action in ('insert', 'update', 'delete', 'restore')),
  changed_by     uuid references support_tasks_staging.profiles (id),
  changed_at     timestamptz not null default now(),
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb
);

create index if not exists task_audit_task_idx on support_tasks_staging.task_audit (task_id, changed_at desc);
create index if not exists task_audit_time_idx on support_tasks_staging.task_audit (changed_at desc);

-- ---------------------------------------------------------------------
-- عرض المهام مع الأسماء (يخضع لصلاحيات الجداول نفسها)
-- ---------------------------------------------------------------------
create or replace view support_tasks_staging.v_tasks
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
  t.deleted_at, t.deleted_by
from support_tasks_staging.tasks t
join support_tasks_staging.profiles p             on p.id = t.engineer_id
left join support_tasks_staging.task_types tt     on tt.id = t.task_type_id
left join support_tasks_staging.correspondence_types ct on ct.id = t.correspondence_type_id
join support_tasks_staging.task_statuses s        on s.id = t.status_id;

-- ---------------------------------------------------------------------
-- تفعيل Row Level Security فوراً على كل جدول
-- (السياسات نفسها في 03_security.sql، وحتى تنفيذه يبقى كل جدول مغلقاً على الجميع)
-- ---------------------------------------------------------------------
alter table support_tasks_staging.profiles             enable row level security;
alter table support_tasks_staging.task_types           enable row level security;
alter table support_tasks_staging.correspondence_types enable row level security;
alter table support_tasks_staging.task_statuses        enable row level security;
alter table support_tasks_staging.tasks                enable row level security;
alter table support_tasks_staging.app_settings         enable row level security;
alter table support_tasks_staging.task_audit           enable row level security;


-- ===================== 02_functions.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 02: الدوال والمشغّلات
--  يُنفَّذ بعد 01_schema.sql
--  auth.uid() = معرّف المستخدم الحالي في Supabase (الدالة الوحيدة الخاصة بـ Supabase هنا)
-- =====================================================================

-- دور المستخدم الحالي (null إذا كان الحساب معطّلاً أو غير موجود)
create or replace function support_tasks_staging.app_role()
returns support_tasks_staging.user_role
language sql stable security definer
set search_path = support_tasks_staging
as $$
  select role from support_tasks_staging.profiles where id = auth.uid() and is_active
$$;

-- قيمة إعداد رقمي
create or replace function support_tasks_staging.setting_int(p_key text, p_default int)
returns int
language sql stable security definer
set search_path = support_tasks_staging
as $$
  select coalesce((select (value #>> '{}')::int from support_tasks_staging.app_settings where key = p_key), p_default)
$$;

-- رسالة خطأ واضحة للمستخدم (تظهر كما هي في الواجهة)
create or replace function support_tasks_staging.app_error(p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_message;
end $$;

-- ---------------------------------------------------------------------
-- قبل حفظ مهمة: القيم التلقائية، والقيود، وقفل التعديل
-- ---------------------------------------------------------------------
create or replace function support_tasks_staging.tasks_before_write()
returns trigger
language plpgsql security definer
set search_path = support_tasks_staging
as $$
declare
  v_role  support_tasks_staging.user_role := support_tasks_staging.app_role();
  v_uid   uuid := auth.uid();
  v_kind  support_tasks_staging.status_kind;
  v_lock  int;
  v_old_kind support_tasks_staging.status_kind;
begin
  if v_role is null and v_uid is not null then
    perform support_tasks_staging.app_error('حسابك غير مفعّل.');
  end if;

  if tg_op = 'INSERT' then
    if v_role is null then                      -- إدخال من خارج التطبيق (مثل محرر SQL)
      new.created_by := coalesce(new.created_by, new.engineer_id);
    else
      if v_role = 'viewer' then
        perform support_tasks_staging.app_error('المشاهد لا يستطيع إضافة مهام.');
      end if;
      if new.engineer_id is null or v_role = 'engineer' then
        new.engineer_id := v_uid;                -- المهندس يضيف لنفسه فقط
      end if;
      new.created_by := v_uid;
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
        perform support_tasks_staging.app_error('لا يمكن نقل المهمة إلى مهندس آخر.');
      end if;
      if new.deleted_at is distinct from old.deleted_at then
        perform support_tasks_staging.app_error('الحذف لمدير النظام فقط.');
      end if;
    end if;
    if v_role = 'head' and new.deleted_at is distinct from old.deleted_at then
      perform support_tasks_staging.app_error('الحذف لمدير النظام فقط.');
    end if;

    -- قفل التعديل: مهمة مكتملة مضى على انتهائها أكثر من «مدة القفل» (0 = بدون قفل). لا يُطبَّق على المدير ورئيس القسم
    if v_role = 'engineer' then
      v_lock := support_tasks_staging.setting_int('edit_lock_days', 0);
      select kind into v_old_kind from support_tasks_staging.task_statuses where id = old.status_id;
      if v_lock > 0 and v_old_kind = 'done' and old.completed_date is not null
         and old.completed_date + v_lock < current_date then
        perform support_tasks_staging.app_error('المهمة مقفلة: مضى على إنجازها أكثر من ' || v_lock || ' يوم. اطلب من مدير النظام أو رئيس القسم تعديلها.');
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
  if new.subject is null or new.subject = '' then
    perform support_tasks_staging.app_error('الموضوع مطلوب.');
  end if;

  -- الحالة المكتملة تحتاج تاريخ انتهاء، وغير المكتملة لا تحمل تاريخ انتهاء
  select kind into v_kind from support_tasks_staging.task_statuses where id = new.status_id;
  if v_kind = 'done' and new.completed_date is null then
    perform support_tasks_staging.app_error('المهمة المكتملة تحتاج «تاريخ الانتهاء».');
  end if;
  if v_kind = 'open' then
    new.completed_date := null;
  end if;
  if new.completed_date is not null and new.completed_date < new.received_date then
    perform support_tasks_staging.app_error('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الاستقبال.');
  end if;

  return new;
end $$;

drop trigger if exists tasks_before_write on support_tasks_staging.tasks;
create trigger tasks_before_write
  before insert or update on support_tasks_staging.tasks
  for each row execute function support_tasks_staging.tasks_before_write();

-- ---------------------------------------------------------------------
-- بعد حفظ مهمة: سجل التعديلات
-- ---------------------------------------------------------------------
create or replace function support_tasks_staging.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = support_tasks_staging
as $$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days'];
  v_fields text[];
  v_action text;
begin
  if tg_op = 'INSERT' then
    insert into support_tasks_staging.task_audit (task_id, action, changed_by, new_data)
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

  insert into support_tasks_staging.task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (new.id, v_action, coalesce(auth.uid(), new.updated_by), v_fields,
          (select jsonb_object_agg(k, v_old -> k) from unnest(v_fields) k),
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k));
  return null;
end $$;

drop trigger if exists tasks_audit on support_tasks_staging.tasks;
create trigger tasks_audit
  after insert or update on support_tasks_staging.tasks
  for each row execute function support_tasks_staging.tasks_audit();

-- ---------------------------------------------------------------------
-- الحذف الناعم والاسترجاع (مدير النظام فقط)
-- ---------------------------------------------------------------------
create or replace function support_tasks_staging.soft_delete_task(p_id bigint)
returns void
language plpgsql security definer
set search_path = support_tasks_staging
as $$
begin
  if support_tasks_staging.app_role() is distinct from 'admin' then
    perform support_tasks_staging.app_error('الحذف لمدير النظام فقط.');
  end if;
  update support_tasks_staging.tasks set deleted_at = now(), deleted_by = auth.uid()
  where id = p_id and deleted_at is null;
end $$;

create or replace function support_tasks_staging.restore_task(p_id bigint)
returns void
language plpgsql security definer
set search_path = support_tasks_staging
as $$
begin
  if support_tasks_staging.app_role() is distinct from 'admin' then
    perform support_tasks_staging.app_error('الاسترجاع لمدير النظام فقط.');
  end if;
  update support_tasks_staging.tasks set deleted_at = null, deleted_by = null
  where id = p_id and deleted_at is not null;
end $$;

-- المستخدم غيّر كلمة المرور المؤقتة
create or replace function support_tasks_staging.mark_password_changed()
returns void
language sql security definer
set search_path = support_tasks_staging
as $$
  update support_tasks_staging.profiles set must_change_password = false, updated_at = now() where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- حماية جدول المستخدمين: لا يستطيع المدير تعطيل نفسه أو إزالة دوره (حتى لا يُقفل النظام)
-- ---------------------------------------------------------------------
create or replace function support_tasks_staging.profiles_before_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.id := old.id;
  if old.id = auth.uid() and (new.role <> old.role or not new.is_active) then
    perform support_tasks_staging.app_error('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.');
  end if;
  return new;
end $$;

drop trigger if exists profiles_before_update on support_tasks_staging.profiles;
create trigger profiles_before_update
  before update on support_tasks_staging.profiles
  for each row execute function support_tasks_staging.profiles_before_update();

-- ختم وقت تعديل الإعدادات
create or replace function support_tasks_staging.settings_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists settings_before_write on support_tasks_staging.app_settings;
create trigger settings_before_write
  before insert or update on support_tasks_staging.app_settings
  for each row execute function support_tasks_staging.settings_before_write();


-- ===================== 03_security.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 03: الصلاحيات (Row Level Security)
--  يُنفَّذ بعد 02_functions.sql
--  كل صلاحية تُفرض هنا داخل قاعدة البيانات، فلا يمكن تجاوزها من المتصفح
-- =====================================================================

alter table support_tasks_staging.profiles             enable row level security;
alter table support_tasks_staging.task_types           enable row level security;
alter table support_tasks_staging.correspondence_types enable row level security;
alter table support_tasks_staging.task_statuses        enable row level security;
alter table support_tasks_staging.tasks                enable row level security;
alter table support_tasks_staging.app_settings         enable row level security;
alter table support_tasks_staging.task_audit           enable row level security;

-- السكيما: المستخدم المسجّل ودالة الخادم فقط (الزائر غير المسجّل لا يرى شيئاً)
grant usage on schema support_tasks_staging to authenticated, service_role;
revoke all on schema support_tasks_staging from anon;
revoke all on all tables    in schema support_tasks_staging from anon;
revoke all on all functions in schema support_tasks_staging from public, anon;
grant execute on all functions in schema support_tasks_staging to authenticated, service_role;

-- دالة admin-users تعمل بمفتاح service_role (يتجاوز RLS لكنه يحتاج صلاحية الجداول في السكيما الخاصة)
grant all on all tables in schema support_tasks_staging to service_role;
grant usage, select on all sequences in schema support_tasks_staging to service_role;

grant select                 on support_tasks_staging.profiles, support_tasks_staging.v_tasks, support_tasks_staging.task_audit to authenticated;
grant update (full_name, short_name, role, is_active) on support_tasks_staging.profiles to authenticated;
grant select, insert, update on support_tasks_staging.task_types, support_tasks_staging.correspondence_types, support_tasks_staging.task_statuses to authenticated;
grant select, insert, update on support_tasks_staging.tasks to authenticated;
grant select, insert, update on support_tasks_staging.app_settings to authenticated;
grant execute on function support_tasks_staging.soft_delete_task(bigint), support_tasks_staging.restore_task(bigint),
                          support_tasks_staging.mark_password_changed(), support_tasks_staging.app_role() to authenticated;

-- ---------------- المستخدمون ----------------
drop policy if exists profiles_select on support_tasks_staging.profiles;
create policy profiles_select on support_tasks_staging.profiles for select to authenticated
  using (id = auth.uid() or support_tasks_staging.app_role() in ('admin', 'head', 'viewer'));

drop policy if exists profiles_update on support_tasks_staging.profiles;
create policy profiles_update on support_tasks_staging.profiles for update to authenticated
  using (support_tasks_staging.app_role() = 'admin') with check (support_tasks_staging.app_role() = 'admin');
-- الإضافة تتم من دالة admin-users (مفتاح الخادم) فقط

-- ---------------- القوائم ----------------
drop policy if exists task_types_select on support_tasks_staging.task_types;
create policy task_types_select on support_tasks_staging.task_types for select to authenticated using (support_tasks_staging.app_role() is not null);
drop policy if exists task_types_write on support_tasks_staging.task_types;
create policy task_types_write on support_tasks_staging.task_types for insert to authenticated with check (support_tasks_staging.app_role() in ('admin', 'head'));
drop policy if exists task_types_update on support_tasks_staging.task_types;
create policy task_types_update on support_tasks_staging.task_types for update to authenticated
  using (support_tasks_staging.app_role() in ('admin', 'head')) with check (support_tasks_staging.app_role() in ('admin', 'head'));

drop policy if exists corr_types_select on support_tasks_staging.correspondence_types;
create policy corr_types_select on support_tasks_staging.correspondence_types for select to authenticated using (support_tasks_staging.app_role() is not null);
drop policy if exists corr_types_write on support_tasks_staging.correspondence_types;
create policy corr_types_write on support_tasks_staging.correspondence_types for insert to authenticated with check (support_tasks_staging.app_role() in ('admin', 'head'));
drop policy if exists corr_types_update on support_tasks_staging.correspondence_types;
create policy corr_types_update on support_tasks_staging.correspondence_types for update to authenticated
  using (support_tasks_staging.app_role() in ('admin', 'head')) with check (support_tasks_staging.app_role() in ('admin', 'head'));

drop policy if exists statuses_select on support_tasks_staging.task_statuses;
create policy statuses_select on support_tasks_staging.task_statuses for select to authenticated using (support_tasks_staging.app_role() is not null);
drop policy if exists statuses_write on support_tasks_staging.task_statuses;
create policy statuses_write on support_tasks_staging.task_statuses for insert to authenticated with check (support_tasks_staging.app_role() in ('admin', 'head'));
drop policy if exists statuses_update on support_tasks_staging.task_statuses;
create policy statuses_update on support_tasks_staging.task_statuses for update to authenticated
  using (support_tasks_staging.app_role() in ('admin', 'head')) with check (support_tasks_staging.app_role() in ('admin', 'head'));

-- ---------------- المهام ----------------
-- القراءة: المهندس مهامه، والمدير ورئيس القسم والمشاهد كل المهام. المحذوفة يراها المدير فقط
drop policy if exists tasks_select on support_tasks_staging.tasks;
create policy tasks_select on support_tasks_staging.tasks for select to authenticated
  using (
    (deleted_at is null and (engineer_id = auth.uid() or support_tasks_staging.app_role() in ('admin', 'head', 'viewer')))
    or support_tasks_staging.app_role() = 'admin'
  );

-- الإضافة: المهندس لنفسه، والمدير ورئيس القسم لأي مهندس
drop policy if exists tasks_insert on support_tasks_staging.tasks;
create policy tasks_insert on support_tasks_staging.tasks for insert to authenticated
  with check (
    support_tasks_staging.app_role() in ('admin', 'head')
    or (support_tasks_staging.app_role() = 'engineer' and engineer_id = auth.uid())
  );

-- التعديل: المهندس مهامه غير المحذوفة، والمدير ورئيس القسم كل المهام (الحذف عبر الدالة فقط)
drop policy if exists tasks_update on support_tasks_staging.tasks;
create policy tasks_update on support_tasks_staging.tasks for update to authenticated
  using (
    support_tasks_staging.app_role() = 'admin'
    or (deleted_at is null and support_tasks_staging.app_role() = 'head')
    or (deleted_at is null and support_tasks_staging.app_role() = 'engineer' and engineer_id = auth.uid())
  )
  with check (
    support_tasks_staging.app_role() in ('admin', 'head')
    or (support_tasks_staging.app_role() = 'engineer' and engineer_id = auth.uid())
  );
-- لا توجد سياسة DELETE: لا يُحذف أي صف فعلياً

-- ---------------- الإعدادات ----------------
drop policy if exists settings_select on support_tasks_staging.app_settings;
create policy settings_select on support_tasks_staging.app_settings for select to authenticated using (support_tasks_staging.app_role() is not null);
drop policy if exists settings_insert on support_tasks_staging.app_settings;
create policy settings_insert on support_tasks_staging.app_settings for insert to authenticated with check (support_tasks_staging.app_role() = 'admin');
drop policy if exists settings_update on support_tasks_staging.app_settings;
create policy settings_update on support_tasks_staging.app_settings for update to authenticated
  using (support_tasks_staging.app_role() = 'admin') with check (support_tasks_staging.app_role() = 'admin');

-- ---------------- سجل التعديلات ----------------
drop policy if exists audit_select on support_tasks_staging.task_audit;
create policy audit_select on support_tasks_staging.task_audit for select to authenticated
  using (support_tasks_staging.app_role() in ('admin', 'head'));
-- الكتابة من المشغّل فقط


-- ===================== 04_seed.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 04: القيم الأولية
--  يُنفَّذ بعد 03_security.sql. يمكن تعديل القوائم لاحقاً من شاشة «القوائم»
-- =====================================================================

-- قوائم القسم (تُعدَّل لاحقاً من شاشة «القوائم»)
insert into support_tasks_staging.task_types (name, sort_order) values
  ('مراسلة', 1), ('طلب خدمة', 2), ('اتصال', 3), ('طلب مباشر', 4), ('تكليف مباشر', 5), ('أخرى', 6)
on conflict (name) do nothing;

insert into support_tasks_staging.correspondence_types (name, sort_order) values
  ('المواصفات الفنية', 1), ('التحليل والتقييم', 2), ('أخرى', 3)
on conflict (name) do nothing;

-- kind: done = مكتملة (تحتاج تاريخ انتهاء وتدخل في نسبة الإنجاز)، open = مفتوحة (تُحسب في المتأخرة)،
--       cancelled = مغلقة بدون إنجاز (لا تدخل في نسبة الإنجاز ولا في المتأخرة)
insert into support_tasks_staging.task_statuses (name, kind, sort_order) values
  ('مكتمل', 'done', 1), ('غير مكتمل', 'open', 2), ('قائمة الانتظار', 'open', 3), ('إعادة تحويل', 'cancelled', 4)
on conflict (name) do nothing;

insert into support_tasks_staging.app_settings (key, value) values
  ('edit_lock_days', '0'),          -- قفل تعديل المهمة المكتملة بعد عدد أيام (0 = بدون قفل)
  ('delay_threshold_days', '7'),    -- مهمة أطول من هذا تُعدّ متأخرة في التقارير
  ('min_password_length', '6'),     -- أقل طول لكلمة المرور (6 = أقل ما تقبله Supabase)
  ('force_password_change', 'true') -- إلزام تغيير كلمة المرور التي يضعها المدير عند أول دخول
on conflict (key) do nothing;


-- ===================== 07_login_no.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 07: الدخول بالرقم المدني أو الوظيفي
--
--  يضيف عمود login_no (الرقم) لجدول المستخدمين في الإنتاج والتجربة معاً.
--  إضافة فقط: عمود فارغ لا يؤثر على النسخة الحالية من الواجهة، فيمكن تنفيذه في أي وقت.
--  يمكن إعادة تنفيذه بلا ضرر.
--
--  الرقم نص (لا رقم حسابي) حتى تبقى الأصفار في أوله، ويقبل حتى 20 خانة.
-- =====================================================================

do $$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.profiles') is null then continue; end if;

    execute format('alter table %I.profiles add column if not exists login_no text', s);

    if not exists (select 1 from pg_constraint where conname = 'profiles_login_no_chk' and conrelid = (s || '.profiles')::regclass) then
      execute format($q$alter table %I.profiles add constraint profiles_login_no_chk check (login_no ~ '^[0-9]{1,20}$')$q$, s);
    end if;

    execute format('create unique index if not exists profiles_login_no_key on %I.profiles (login_no) where login_no is not null', s);
  end loop;
end $$;

-- التحقق: يجب أن يظهر سطر لكل سكيما
select table_schema, column_name, data_type
from information_schema.columns
where column_name = 'login_no' and table_name = 'profiles'
order by 1;


-- ===================== 08_email_repair.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 08: إصلاح البريد الممسوح (خلل الإصدار 1.3.0)
--
--  في الإصدار 1.3.0 كان حفظ الرقم لمستخدم يمسح بريده من جدول المستخدمين،
--  فيفشل الدخول بالرقم. هذا الملف:
--    1) يعيد البريد من حساب الدخول (auth.users) لكل مستخدم بريده فارغ، في السكيمتين
--    2) يمنع البريد الفارغ نهائياً في قاعدة البيانات
--    3) يعرض أي حساب ما زال يحتاج إصلاحاً يدوياً (يجب ألا يظهر شيء)
--  يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.profiles') is null then continue; end if;

    execute format('alter table %I.profiles disable trigger user', s);
    execute format($q$
      update %I.profiles p set email = u.email
      from auth.users u
      where u.id = p.id and coalesce(p.email, '') = '' and coalesce(u.email, '') <> ''$q$, s);
    execute format('alter table %I.profiles enable trigger user', s);

    if not exists (select 1 from pg_constraint where conname = 'profiles_email_not_blank' and conrelid = (s || '.profiles')::regclass)
       then
      begin
        execute format($q$alter table %I.profiles add constraint profiles_email_not_blank check (btrim(email) <> '')$q$, s);
      exception when check_violation then
        raise notice 'السكيما %: ما زال فيها بريد فارغ، راجع الجدول أدناه', s;
      end;
    end if;
  end loop;
end $$;

-- ما يحتاج إصلاحاً يدوياً (يجب أن تكون النتيجة فارغة)
select 'support_tasks' as السكيما, p.full_name, p.login_no, p.email as بريد_الملف, u.email as بريد_الدخول
from support_tasks.profiles p left join auth.users u on u.id = p.id
where coalesce(p.email, '') = '' or coalesce(u.email, '') = '' or p.email <> u.email
union all
select 'support_tasks_staging', p.full_name, p.login_no, p.email, u.email
from support_tasks_staging.profiles p left join auth.users u on u.id = p.id
where coalesce(p.email, '') = '' or coalesce(u.email, '') = '' or p.email <> u.email;


-- ===================== 10_review.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 10: «مهام تحتاج مراجعة»
--
--  الاستيراد يأخذ كل الصفوف، والصف الذي فيه مشكلة (تاريخ غير مفهوم، مكررة محتملة…)
--  يُحفظ مع أسباب المراجعة في عمود review_reasons، ليصلحه المهندس لاحقاً ويضغط «تمت المراجعة».
--    review_reasons = null  ← لا تحتاج مراجعة
--
--  للسكيمتين (الإنتاج والتجربة) معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة.
--  يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;

    execute format('alter table %I.tasks add column if not exists review_reasons text[]', s);
    execute format('create index if not exists tasks_review_idx on %I.tasks (engineer_id) where review_reasons is not null and deleted_at is null', s);

    -- عرض المهام: نفس الأعمدة السابقة + review_reasons في آخره
    execute format($v$
      create or replace view %1$I.v_tasks
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
        t.review_reasons
      from %1$I.tasks t
      join %1$I.profiles p             on p.id = t.engineer_id
      left join %1$I.task_types tt     on tt.id = t.task_type_id
      left join %1$I.correspondence_types ct on ct.id = t.correspondence_type_id
      join %1$I.task_statuses s        on s.id = t.status_id$v$, s);

    -- أسباب المراجعة يضعها الاستيراد (مدير النظام) فقط؛ غيره يستطيع مسحها («تمت المراجعة») لا إضافتها
    execute format($f$
      create or replace function %1$I.tasks_review_guard()
      returns trigger
      language plpgsql security definer
      set search_path = %1$I
      as $b$
      begin
        new.review_reasons := nullif(new.review_reasons, '{}');
        if %1$I.app_role() is distinct from 'admin' and auth.uid() is not null
           and new.review_reasons is not null
           and new.review_reasons is distinct from (case when tg_op = 'UPDATE' then old.review_reasons end) then
          perform %1$I.app_error('أسباب المراجعة يضعها الاستيراد فقط.');
        end if;
        return new;
      end $b$
    $f$, s);
    execute format('revoke all on function %I.tasks_review_guard() from public, anon', s);
    execute format('drop trigger if exists tasks_review_guard on %I.tasks', s);
    execute format('create trigger tasks_review_guard before insert or update on %1$I.tasks for each row execute function %1$I.tasks_review_guard()', s);
  end loop;
end $do$;

-- التحقق: يجب أن يظهر سطر لكل سكيما
select table_schema, column_name, data_type
from information_schema.columns
where table_name = 'v_tasks' and column_name = 'review_reasons'
order by table_schema;


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
  -- الأرقام تُمسح أولاً ثم تُنسخ، حتى لا يتعارض رقم في التجربة مع رقم مستخدم آخر في الإنتاج
  update support_tasks_staging.profiles set login_no = null where login_no is not null;
  insert into support_tasks_staging.profiles (id, email, login_no, full_name, short_name, role, is_active, must_change_password, created_at, updated_at)
  select id, email, login_no, full_name, short_name, role::text::support_tasks_staging.user_role, is_active, false, created_at, updated_at
  from support_tasks.profiles
  on conflict (id) do update set email = excluded.email, login_no = excluded.login_no, full_name = excluded.full_name, short_name = excluded.short_name,
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
  -- truncate بدل delete: Supabase يرفض DELETE بدون WHERE في طلبات الواجهة (pg_safeupdate)
  truncate support_tasks_staging.task_audit, support_tasks_staging.tasks;
  insert into support_tasks_staging.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons)
  overriding system value
  select t.id, t.engineer_id, t.ref_no, t.requester, t.employee_name, t.subject, t.received_date, t.completed_date, t.notes,
    (select s.id from support_tasks_staging.task_types s join support_tasks.task_types p on p.name = s.name where p.id = t.task_type_id),
    (select s.id from support_tasks_staging.correspondence_types s join support_tasks.correspondence_types p on p.name = s.name where p.id = t.correspondence_type_id),
    (select s.id from support_tasks_staging.task_statuses s join support_tasks.task_statuses p on p.name = s.name where p.id = t.status_id),
    t.delay_reason, t.created_at, t.created_by, t.updated_at, t.updated_by, t.deleted_at, t.deleted_by, t.review_reasons
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


-- =====================================================================
--  نسخة التجربة: دالة «حذف كل المهام» (زر في صفحة الإعدادات)
--  تُنفَّذ مرة واحدة في SQL Editor (وهي ضمن setup_staging.sql أيضاً)
--
--  تحذف نهائياً كل مهام التجربة وسجل تعديلاتها، لإعادة الاستيراد من جديد.
--  لا تمس المستخدمين ولا القوائم ولا الإعدادات، ولا تمس الإنتاج أبداً.
--  لا توجد نسخة من هذه الدالة في سكيما الإنتاج.
-- =====================================================================

create or replace function support_tasks_staging.purge_all_tasks()
returns jsonb
language plpgsql
security definer
set search_path = support_tasks_staging
as $$
declare
  v_tasks int;
begin
  if support_tasks_staging.app_role() is distinct from 'admin' then
    perform support_tasks_staging.app_error('حذف كل المهام لمدير النظام فقط.');
  end if;
  select count(*) into v_tasks from support_tasks_staging.tasks;
  -- TRUNCATE وليس DELETE: Supabase يمنع DELETE بلا شرط، وهو أسرع، ويعيد ترقيم المهام من 1
  truncate support_tasks_staging.task_audit, support_tasks_staging.tasks restart identity;
  return jsonb_build_object('tasks', v_tasks, 'at', now());
end $$;

revoke all on function support_tasks_staging.purge_all_tasks() from public, anon;
grant execute on function support_tasks_staging.purge_all_tasks() to authenticated;


-- =====================================================================
--  نسخ البيانات من الإنتاج إلى التجربة (قراءة فقط من الإنتاج)
--  تستطيع إعادة تنفيذ هذا الجزء وحده متى أردت تحديث بيانات التجربة
-- =====================================================================
begin;

-- المستخدمون: نفس الحسابات تدخل نسخة التجربة بنفس كلمات المرور
update support_tasks_staging.profiles set login_no = null where login_no is not null;
insert into support_tasks_staging.profiles (id, email, login_no, full_name, short_name, role, is_active, must_change_password, created_at, updated_at)
select id, email, login_no, full_name, short_name, role::text::support_tasks_staging.user_role, is_active, false, created_at, updated_at
from support_tasks.profiles
on conflict (id) do update set email = excluded.email, login_no = excluded.login_no, full_name = excluded.full_name, short_name = excluded.short_name,
  role = excluded.role, is_active = excluded.is_active;

-- القوائم كما هي في الإنتاج
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

-- المهام: نسخة كاملة بنفس الأرقام (تُستبدل مهام التجربة السابقة)
alter table support_tasks_staging.tasks disable trigger user;
truncate support_tasks_staging.task_audit, support_tasks_staging.tasks;
insert into support_tasks_staging.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
  task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons)
overriding system value
select t.id, t.engineer_id, t.ref_no, t.requester, t.employee_name, t.subject, t.received_date, t.completed_date, t.notes,
  (select s.id from support_tasks_staging.task_types s join support_tasks.task_types p on p.name = s.name where p.id = t.task_type_id),
  (select s.id from support_tasks_staging.correspondence_types s join support_tasks.correspondence_types p on p.name = s.name where p.id = t.correspondence_type_id),
  (select s.id from support_tasks_staging.task_statuses s join support_tasks.task_statuses p on p.name = s.name where p.id = t.status_id),
  t.delay_reason, t.created_at, t.created_by, t.updated_at, t.updated_by, t.deleted_at, t.deleted_by, t.review_reasons
from support_tasks.tasks t;
select setval(pg_get_serial_sequence('support_tasks_staging.tasks', 'id'), coalesce((select max(id) from support_tasks_staging.tasks), 0) + 1, false);
alter table support_tasks_staging.tasks enable trigger user;

commit;

select 'المستخدمون' as البيان, count(*) as العدد from support_tasks_staging.profiles
union all select 'المهام', count(*) from support_tasks_staging.tasks;
