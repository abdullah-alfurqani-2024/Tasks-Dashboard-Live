-- =====================================================================
--  نسخة التطوير: سكيما support_tasks_dev
--  ملف مولَّد تلقائياً من supabase/sql (لا تعدّله يدوياً: node tools/staging-sql.mjs)
--
--  يُنفَّذ في Supabase ← SQL Editor (مشروع التجربة Tasks-Test) مرة واحدة، ثم:
--    Project Settings ← Data API ← Exposed schemas: أضف support_tasks_dev
--  البيانات تُنسخ من الإنتاج (مشروع مستقل) بزر «تحديث بيانات التطوير من الإنتاج» (دالة refresh-dev).
--  ويمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

-- ===================== 01_schema.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 01: الجداول
--  يُنفَّذ أولاً في Supabase ← SQL Editor
--  SQL قياسي لـ PostgreSQL. الارتباط الوحيد بـ Supabase: profiles.id يشير إلى auth.users
-- =====================================================================

-- كل جداول النظام في سكيما مستقلة حتى لا تختلط بجداولك الأخرى في public
-- (لتغيير الاسم: استبدل support_tasks_dev بالاسم الجديد في كل ملفات SQL وفي js/config.js ودالة admin-users)
create schema if not exists support_tasks_dev;

-- أنواع ثابتة
do $$ begin
  create type support_tasks_dev.user_role as enum ('admin', 'head', 'engineer', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_tasks_dev.status_kind as enum ('open', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- المستخدمون: صف لكل حساب دخول (ينشئه مدير النظام)
--   admin    مدير النظام: كل الصلاحيات
--   head     رئيس القسم: كل المهام والتقارير والقوائم، بدون المستخدمين والإعدادات والحذف
--   engineer مهندس: مهامه فقط
--   viewer   مشاهد: التقارير والمهام للقراءة فقط
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null unique,
  full_name            text not null,
  short_name           text,
  role                 support_tasks_dev.user_role not null default 'engineer',
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- القوائم: نوع المهمة، نوع المراسلة، الحالة
-- لا تُحذف القيم المستخدمة؛ تُعطَّل (is_active = false) فتختفي من الاختيار وتبقى في المهام القديمة
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.task_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists support_tasks_dev.correspondence_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists support_tasks_dev.task_statuses (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  kind       support_tasks_dev.status_kind not null default 'open',   -- open = مفتوحة، done = مكتملة، cancelled = ملغاة
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------
-- المهام
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.tasks (
  id                     bigint generated always as identity primary key,
  engineer_id            uuid not null references support_tasks_dev.profiles (id),
  ref_no                 text,                                   -- رقم القيد (نص: قد يحتوي / أو حروفاً)
  requester              text,                                   -- الجهة الطالبة
  employee_name          text,                                   -- اسم الموظف
  subject                text not null,                          -- الموضوع
  received_date          date not null,                          -- تاريخ الاستقبال
  completed_date         date,                                   -- تاريخ الانتهاء (للمكتملة)
  notes                  text,                                   -- الملاحظات
  task_type_id           smallint references support_tasks_dev.task_types (id),
  correspondence_type_id smallint references support_tasks_dev.correspondence_types (id),
  status_id              smallint not null references support_tasks_dev.task_statuses (id),
  delay_reason           text,                                   -- سبب تأخير إنجاز المهمة
  duration_days          int generated always as (completed_date - received_date) stored,  -- المدة
  created_at             timestamptz not null default now(),     -- تاريخ الإدخال
  created_by             uuid references support_tasks_dev.profiles (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references support_tasks_dev.profiles (id),
  deleted_at             timestamptz,                            -- حذف ناعم
  deleted_by             uuid references support_tasks_dev.profiles (id),
  review_reasons         text[],                                 -- أسباب المراجعة من الاستيراد (10_review.sql)
  priority               text not null default 'normal'          -- الأولوية: normal عادية / urgent عاجلة (13_priority.sql)
                         constraint tasks_priority_chk check (priority in ('normal', 'urgent')),
  constraint tasks_dates_chk check (completed_date is null or completed_date >= received_date)
);

create index if not exists tasks_engineer_idx on support_tasks_dev.tasks (engineer_id, received_date desc) where deleted_at is null;
create index if not exists tasks_received_idx on support_tasks_dev.tasks (received_date desc) where deleted_at is null;
create index if not exists tasks_status_idx   on support_tasks_dev.tasks (status_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- الإعدادات العامة (يعدّلها مدير النظام)
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references support_tasks_dev.profiles (id)
);

-- ---------------------------------------------------------------------
-- سجل التعديلات على المهام (يكتبه النظام تلقائياً)
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.task_audit (
  id             bigint generated always as identity primary key,
  task_id        bigint not null,
  action         text not null check (action in ('insert', 'update', 'delete', 'restore')),
  changed_by     uuid references support_tasks_dev.profiles (id),
  changed_at     timestamptz not null default now(),
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb
);

create index if not exists task_audit_task_idx on support_tasks_dev.task_audit (task_id, changed_at desc);
create index if not exists task_audit_time_idx on support_tasks_dev.task_audit (changed_at desc);

-- ---------------------------------------------------------------------
-- عرض المهام مع الأسماء (يخضع لصلاحيات الجداول نفسها)
-- ---------------------------------------------------------------------
-- يُنشأ مرة واحدة في القاعدة الجديدة؛ وفي القواعد القائمة تحدّثه ملفات التعديل (10، 13)
do $vw$ begin
  if to_regclass('support_tasks_dev.v_tasks') is null then
    execute $sql$
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
  t.priority
from support_tasks_dev.tasks t
join support_tasks_dev.profiles p             on p.id = t.engineer_id
left join support_tasks_dev.task_types tt     on tt.id = t.task_type_id
left join support_tasks_dev.correspondence_types ct on ct.id = t.correspondence_type_id
join support_tasks_dev.task_statuses s        on s.id = t.status_id
    $sql$;
  end if;
end $vw$;

-- ---------------------------------------------------------------------
-- تفعيل Row Level Security فوراً على كل جدول
-- (السياسات نفسها في 03_security.sql، وحتى تنفيذه يبقى كل جدول مغلقاً على الجميع)
-- ---------------------------------------------------------------------
alter table support_tasks_dev.profiles             enable row level security;
alter table support_tasks_dev.task_types           enable row level security;
alter table support_tasks_dev.correspondence_types enable row level security;
alter table support_tasks_dev.task_statuses        enable row level security;
alter table support_tasks_dev.tasks                enable row level security;
alter table support_tasks_dev.app_settings         enable row level security;
alter table support_tasks_dev.task_audit           enable row level security;


-- ===================== 02_functions.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 02: الدوال والمشغّلات
--  يُنفَّذ بعد 01_schema.sql
--  auth.uid() = معرّف المستخدم الحالي في Supabase (الدالة الوحيدة الخاصة بـ Supabase هنا)
-- =====================================================================

-- دور المستخدم الحالي (null إذا كان الحساب معطّلاً أو غير موجود)
create or replace function support_tasks_dev.app_role()
returns support_tasks_dev.user_role
language sql stable security definer
set search_path = support_tasks_dev
as $$
  select role from support_tasks_dev.profiles where id = auth.uid() and is_active
$$;

-- قيمة إعداد رقمي
create or replace function support_tasks_dev.setting_int(p_key text, p_default int)
returns int
language sql stable security definer
set search_path = support_tasks_dev
as $$
  select coalesce((select (value #>> '{}')::int from support_tasks_dev.app_settings where key = p_key), p_default)
$$;

-- رسالة خطأ واضحة للمستخدم (تظهر كما هي في الواجهة)
create or replace function support_tasks_dev.app_error(p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_message;
end $$;

-- ---------------------------------------------------------------------
-- قبل حفظ مهمة: القيم التلقائية، والقيود، وقفل التعديل
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.tasks_before_write()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  v_role  support_tasks_dev.user_role := support_tasks_dev.app_role();
  v_uid   uuid := auth.uid();
  v_kind  support_tasks_dev.status_kind;
  v_lock  int;
  v_old_kind support_tasks_dev.status_kind;
begin
  if v_role is null and v_uid is not null then
    perform support_tasks_dev.app_error('حسابك غير مفعّل.');
  end if;

  if tg_op = 'INSERT' then
    if v_role is null then                      -- إدخال من خارج التطبيق (مثل محرر SQL)
      new.created_by := coalesce(new.created_by, new.engineer_id);
    else
      if v_role = 'viewer' then
        perform support_tasks_dev.app_error('المشاهد لا يستطيع إضافة مهام.');
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
        perform support_tasks_dev.app_error('لا يمكن نقل المهمة إلى مهندس آخر.');
      end if;
      if new.deleted_at is distinct from old.deleted_at then
        perform support_tasks_dev.app_error('الحذف لمدير النظام فقط.');
      end if;
    end if;
    if v_role = 'head' and new.deleted_at is distinct from old.deleted_at then
      perform support_tasks_dev.app_error('الحذف لمدير النظام فقط.');
    end if;

    -- قفل التعديل: مهمة مكتملة مضى على انتهائها أكثر من «مدة القفل» (0 = بدون قفل). لا يُطبَّق على المدير ورئيس القسم
    if v_role = 'engineer' then
      v_lock := support_tasks_dev.setting_int('edit_lock_days', 0);
      select kind into v_old_kind from support_tasks_dev.task_statuses where id = old.status_id;
      if v_lock > 0 and v_old_kind = 'done' and old.completed_date is not null
         and old.completed_date + v_lock < current_date then
        perform support_tasks_dev.app_error('المهمة مقفلة: مضى على إنجازها أكثر من ' || v_lock || ' يوم. اطلب من مدير النظام أو رئيس القسم تعديلها.');
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
    perform support_tasks_dev.app_error('الموضوع مطلوب.');
  end if;

  -- الحالة المكتملة تحتاج تاريخ انتهاء، وغير المكتملة لا تحمل تاريخ انتهاء
  select kind into v_kind from support_tasks_dev.task_statuses where id = new.status_id;
  if v_kind = 'done' and new.completed_date is null then
    perform support_tasks_dev.app_error('المهمة المكتملة تحتاج «تاريخ الانتهاء».');
  end if;
  if v_kind = 'open' then
    new.completed_date := null;
  end if;
  if new.completed_date is not null and new.completed_date < new.received_date then
    perform support_tasks_dev.app_error('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الاستقبال.');
  end if;

  return new;
end $$;

drop trigger if exists tasks_before_write on support_tasks_dev.tasks;
create trigger tasks_before_write
  before insert or update on support_tasks_dev.tasks
  for each row execute function support_tasks_dev.tasks_before_write();

-- ---------------------------------------------------------------------
-- بعد حفظ مهمة: سجل التعديلات
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days'];
  v_fields text[];
  v_action text;
begin
  if tg_op = 'INSERT' then
    insert into support_tasks_dev.task_audit (task_id, action, changed_by, new_data)
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

  insert into support_tasks_dev.task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (new.id, v_action, coalesce(auth.uid(), new.updated_by), v_fields,
          (select jsonb_object_agg(k, v_old -> k) from unnest(v_fields) k),
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k));
  return null;
end $$;

drop trigger if exists tasks_audit on support_tasks_dev.tasks;
create trigger tasks_audit
  after insert or update on support_tasks_dev.tasks
  for each row execute function support_tasks_dev.tasks_audit();

-- ---------------------------------------------------------------------
-- الحذف الناعم والاسترجاع (مدير النظام فقط)
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.soft_delete_task(p_id bigint)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then
    perform support_tasks_dev.app_error('الحذف لمدير النظام فقط.');
  end if;
  update support_tasks_dev.tasks set deleted_at = now(), deleted_by = auth.uid()
  where id = p_id and deleted_at is null;
end $$;

create or replace function support_tasks_dev.restore_task(p_id bigint)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then
    perform support_tasks_dev.app_error('الاسترجاع لمدير النظام فقط.');
  end if;
  update support_tasks_dev.tasks set deleted_at = null, deleted_by = null
  where id = p_id and deleted_at is not null;
end $$;

-- المستخدم غيّر كلمة المرور المؤقتة
create or replace function support_tasks_dev.mark_password_changed()
returns void
language sql security definer
set search_path = support_tasks_dev
as $$
  update support_tasks_dev.profiles set must_change_password = false, updated_at = now() where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- حماية جدول المستخدمين: لا يستطيع المدير تعطيل نفسه أو إزالة دوره (حتى لا يُقفل النظام)
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.profiles_before_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.id := old.id;
  if old.id = auth.uid() and (new.role <> old.role or not new.is_active) then
    perform support_tasks_dev.app_error('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.');
  end if;
  return new;
end $$;

drop trigger if exists profiles_before_update on support_tasks_dev.profiles;
create trigger profiles_before_update
  before update on support_tasks_dev.profiles
  for each row execute function support_tasks_dev.profiles_before_update();

-- ختم وقت تعديل الإعدادات
create or replace function support_tasks_dev.settings_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists settings_before_write on support_tasks_dev.app_settings;
create trigger settings_before_write
  before insert or update on support_tasks_dev.app_settings
  for each row execute function support_tasks_dev.settings_before_write();


-- ===================== 03_security.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 03: الصلاحيات (Row Level Security)
--  يُنفَّذ بعد 02_functions.sql
--  كل صلاحية تُفرض هنا داخل قاعدة البيانات، فلا يمكن تجاوزها من المتصفح
-- =====================================================================

alter table support_tasks_dev.profiles             enable row level security;
alter table support_tasks_dev.task_types           enable row level security;
alter table support_tasks_dev.correspondence_types enable row level security;
alter table support_tasks_dev.task_statuses        enable row level security;
alter table support_tasks_dev.tasks                enable row level security;
alter table support_tasks_dev.app_settings         enable row level security;
alter table support_tasks_dev.task_audit           enable row level security;

-- السكيما: المستخدم المسجّل ودالة الخادم فقط (الزائر غير المسجّل لا يرى شيئاً)
grant usage on schema support_tasks_dev to authenticated, service_role;
revoke all on schema support_tasks_dev from anon;
revoke all on all tables    in schema support_tasks_dev from anon;
revoke all on all functions in schema support_tasks_dev from public, anon;
grant execute on all functions in schema support_tasks_dev to authenticated, service_role;

-- دالة admin-users تعمل بمفتاح service_role (يتجاوز RLS لكنه يحتاج صلاحية الجداول في السكيما الخاصة)
grant all on all tables in schema support_tasks_dev to service_role;
grant usage, select on all sequences in schema support_tasks_dev to service_role;

grant select                 on support_tasks_dev.profiles, support_tasks_dev.v_tasks, support_tasks_dev.task_audit to authenticated;
grant update (full_name, short_name, role, is_active) on support_tasks_dev.profiles to authenticated;
grant select, insert, update on support_tasks_dev.task_types, support_tasks_dev.correspondence_types, support_tasks_dev.task_statuses to authenticated;
grant select, insert, update on support_tasks_dev.tasks to authenticated;
grant select, insert, update on support_tasks_dev.app_settings to authenticated;
grant execute on function support_tasks_dev.soft_delete_task(bigint), support_tasks_dev.restore_task(bigint),
                          support_tasks_dev.mark_password_changed(), support_tasks_dev.app_role() to authenticated;

-- ---------------- المستخدمون ----------------
drop policy if exists profiles_select on support_tasks_dev.profiles;
create policy profiles_select on support_tasks_dev.profiles for select to authenticated
  using (id = auth.uid() or support_tasks_dev.app_role() in ('admin', 'head', 'viewer'));

drop policy if exists profiles_update on support_tasks_dev.profiles;
create policy profiles_update on support_tasks_dev.profiles for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');
-- الإضافة تتم من دالة admin-users (مفتاح الخادم) فقط

-- ---------------- القوائم ----------------
drop policy if exists task_types_select on support_tasks_dev.task_types;
create policy task_types_select on support_tasks_dev.task_types for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists task_types_write on support_tasks_dev.task_types;
create policy task_types_write on support_tasks_dev.task_types for insert to authenticated with check (support_tasks_dev.app_role() in ('admin', 'head'));
drop policy if exists task_types_update on support_tasks_dev.task_types;
create policy task_types_update on support_tasks_dev.task_types for update to authenticated
  using (support_tasks_dev.app_role() in ('admin', 'head')) with check (support_tasks_dev.app_role() in ('admin', 'head'));

drop policy if exists corr_types_select on support_tasks_dev.correspondence_types;
create policy corr_types_select on support_tasks_dev.correspondence_types for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists corr_types_write on support_tasks_dev.correspondence_types;
create policy corr_types_write on support_tasks_dev.correspondence_types for insert to authenticated with check (support_tasks_dev.app_role() in ('admin', 'head'));
drop policy if exists corr_types_update on support_tasks_dev.correspondence_types;
create policy corr_types_update on support_tasks_dev.correspondence_types for update to authenticated
  using (support_tasks_dev.app_role() in ('admin', 'head')) with check (support_tasks_dev.app_role() in ('admin', 'head'));

drop policy if exists statuses_select on support_tasks_dev.task_statuses;
create policy statuses_select on support_tasks_dev.task_statuses for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists statuses_write on support_tasks_dev.task_statuses;
create policy statuses_write on support_tasks_dev.task_statuses for insert to authenticated with check (support_tasks_dev.app_role() in ('admin', 'head'));
drop policy if exists statuses_update on support_tasks_dev.task_statuses;
create policy statuses_update on support_tasks_dev.task_statuses for update to authenticated
  using (support_tasks_dev.app_role() in ('admin', 'head')) with check (support_tasks_dev.app_role() in ('admin', 'head'));

-- ---------------- المهام ----------------
-- القراءة: المهندس مهامه، والمدير ورئيس القسم والمشاهد كل المهام. المحذوفة يراها المدير فقط
drop policy if exists tasks_select on support_tasks_dev.tasks;
create policy tasks_select on support_tasks_dev.tasks for select to authenticated
  using (
    (deleted_at is null and (engineer_id = auth.uid() or support_tasks_dev.app_role() in ('admin', 'head', 'viewer')))
    or support_tasks_dev.app_role() = 'admin'
  );

-- الإضافة: المهندس لنفسه، والمدير ورئيس القسم لأي مهندس
drop policy if exists tasks_insert on support_tasks_dev.tasks;
create policy tasks_insert on support_tasks_dev.tasks for insert to authenticated
  with check (
    support_tasks_dev.app_role() in ('admin', 'head')
    or (support_tasks_dev.app_role() = 'engineer' and engineer_id = auth.uid())
  );

-- التعديل: المهندس مهامه غير المحذوفة، والمدير ورئيس القسم كل المهام (الحذف عبر الدالة فقط)
drop policy if exists tasks_update on support_tasks_dev.tasks;
create policy tasks_update on support_tasks_dev.tasks for update to authenticated
  using (
    support_tasks_dev.app_role() = 'admin'
    or (deleted_at is null and support_tasks_dev.app_role() = 'head')
    or (deleted_at is null and support_tasks_dev.app_role() = 'engineer' and engineer_id = auth.uid())
  )
  with check (
    support_tasks_dev.app_role() in ('admin', 'head')
    or (support_tasks_dev.app_role() = 'engineer' and engineer_id = auth.uid())
  );
-- لا توجد سياسة DELETE: لا يُحذف أي صف فعلياً

-- ---------------- الإعدادات ----------------
drop policy if exists settings_select on support_tasks_dev.app_settings;
create policy settings_select on support_tasks_dev.app_settings for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists settings_insert on support_tasks_dev.app_settings;
create policy settings_insert on support_tasks_dev.app_settings for insert to authenticated with check (support_tasks_dev.app_role() = 'admin');
drop policy if exists settings_update on support_tasks_dev.app_settings;
create policy settings_update on support_tasks_dev.app_settings for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');

-- ---------------- سجل التعديلات ----------------
drop policy if exists audit_select on support_tasks_dev.task_audit;
create policy audit_select on support_tasks_dev.task_audit for select to authenticated
  using (support_tasks_dev.app_role() in ('admin', 'head'));
-- الكتابة من المشغّل فقط


-- ===================== 04_seed.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 04: القيم الأولية
--  يُنفَّذ بعد 03_security.sql. يمكن تعديل القوائم لاحقاً من شاشة «القوائم»
-- =====================================================================

-- قوائم القسم (تُعدَّل لاحقاً من شاشة «القوائم»)
insert into support_tasks_dev.task_types (name, sort_order) values
  ('مراسلة', 1), ('طلب خدمة', 2), ('اتصال', 3), ('طلب مباشر', 4), ('تكليف مباشر', 5), ('أخرى', 6)
on conflict (name) do nothing;

insert into support_tasks_dev.correspondence_types (name, sort_order) values
  ('المواصفات الفنية', 1), ('التحليل والتقييم', 2), ('أخرى', 3)
on conflict (name) do nothing;

-- kind: done = مكتملة (تحتاج تاريخ انتهاء وتدخل في نسبة الإنجاز)، open = مفتوحة (تُحسب في المتأخرة)،
--       cancelled = مغلقة بدون إنجاز (لا تدخل في نسبة الإنجاز ولا في المتأخرة)
insert into support_tasks_dev.task_statuses (name, kind, sort_order) values
  ('مكتمل', 'done', 1), ('غير مكتمل', 'open', 2), ('قائمة الانتظار', 'open', 3), ('إعادة تحويل', 'cancelled', 4)
on conflict (name) do nothing;

insert into support_tasks_dev.app_settings (key, value) values
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
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
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
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;

    execute format('alter table %I.tasks add column if not exists review_reasons text[]', s);
    execute format('create index if not exists tasks_review_idx on %I.tasks (engineer_id) where review_reasons is not null and deleted_at is null', s);

    -- عرض المهام: نفس الأعمدة السابقة + review_reasons في آخره
    -- (حذف ثم إنشاء: يُعاد بناؤه مع الأعمدة الأحدث في ملفات لاحقة مثل 13)
    if not exists (select 1 from information_schema.columns where table_schema = s and table_name = 'v_tasks' and column_name = 'review_reasons') then
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
    end if;

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


-- ===================== 11_import_as_is.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 11: الاستيراد «كما في الملف»
--
--  المهمة المستوردة التي تحتاج مراجعة (review_reasons) تُحفظ كما هي في الملف تماماً:
--    - تاريخ الاستقبال يمكن أن يبقى فارغاً
--    - المكتملة بلا تاريخ انتهاء، والانتهاء قبل الاستقبال، والموضوع الفارغ: تُحفظ كما هي
--  وعند «تمت المراجعة» (مسح الأسباب) تُطبَّق كل قواعد الإدخال المعتادة، فلا تُعلَّم مراجَعة وهي ناقصة.
--  المهام العادية (بلا أسباب مراجعة) لا يتغير عليها شيء.
--
--  للسكيمتين معاً، بعد 10_review.sql. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    if not exists (select 1 from information_schema.columns where table_schema = s and table_name = 'tasks' and column_name = 'review_reasons') then
      raise exception 'نفّذ 10_review.sql أولاً (السكيما %)', s;
    end if;

    execute format('alter table %I.tasks alter column received_date drop not null', s);
    execute format('alter table %I.tasks drop constraint if exists tasks_dates_chk', s);
    execute format($c$alter table %I.tasks add constraint tasks_dates_chk check (
      completed_date is null or received_date is null or completed_date >= received_date or review_reasons is not null)$c$, s);

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
  end loop;
end $do$;

-- التحقق: يجب أن يظهر سطران بالقيمة YES
select table_schema, column_name, is_nullable
from information_schema.columns
where table_name = 'tasks' and column_name = 'received_date' and table_schema in ('support_tasks', 'support_tasks_staging', 'support_tasks_dev')
order by table_schema;


-- ===================== 12_import_owner.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 12: المهمة المستوردة باسم مهندسها
--
--  عند الاستيراد تُسجَّل المهمة «أُدخلت بواسطة» مهندسها (لا مدير النظام الذي استوردها)،
--  وأول سطر في سجل تعديلاتها (الإضافة) باسم المهندس أيضاً،
--  ويُحفظ في السجل من أدخلها فعلاً (entered_by) فيظهر «عبر الاستيراد بواسطة …».
--  مدير النظام فقط يستطيع الإدخال باسم غيره؛ غيره يُسجَّل باسمه دائماً.
--
--  للسكيمتين معاً، بعد 11_import_as_is.sql. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
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

-- التحقق: يجب أن يظهر سطران بالقيمة true
select n.nspname as السكيما, position('entered_by' in p.prosrc) > 0 as محدّثة
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'tasks_audit' and n.nspname in ('support_tasks', 'support_tasks_staging', 'support_tasks_dev')
order by 1;


-- ===================== 13_priority.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 13: أولوية المهمة (عادية / عاجلة)
--
--  يضيف عمود priority للمهام: 'normal' (عادية، الافتراضي) أو 'urgent' (عاجلة).
--  المهام الحالية كلها تصبح «عادية».
--  للسكيمتين معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة، فيُنفَّذ قبل نقل الإصدار.
--  يُنفَّذ في مشروع التجربة أولاً، ثم في مشروع الإنتاج. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
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

-- التحقق: يجب أن يظهر سطر لكل سكيما في هذا المشروع (مشروع الإنتاج: support_tasks، مشروع التجربة: support_tasks_staging)
select table_schema, column_name, column_default
from information_schema.columns
where table_name = 'v_tasks' and column_name = 'priority'
order by table_schema;


-- ===================== 14_announcement.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 14: إعلان من مدير النظام
--
--  إعداد جديد announcement: نص يكتبه مدير النظام في «الإعدادات»،
--  ويظهر لكل المستخدمين شريطاً أعلى الصفحة حتى يمسحه. فارغ = لا إعلان.
--  يقرؤه كل المستخدمين ويعدّله المدير فقط (صلاحيات جدول الإعدادات الحالية).
--
--  للسكيمتين معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة.
--  يُنفَّذ في مشروع التجربة أولاً، ثم في مشروع الإنتاج. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.app_settings') is null then continue; end if;
    execute format($q$insert into %I.app_settings (key, value) values ('announcement', '""') on conflict (key) do nothing$q$, s);
  end loop;
end $do$;

-- التحقق: يجب أن يظهر سطر (announcement) لكل سكيما في هذا المشروع
create or replace function pg_temp.check_announcement() returns table (السكيما text, القيمة jsonb)
language plpgsql as $f$
declare s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.app_settings') is not null then
      return query execute format('select %L::text, value from %I.app_settings where key = %L', s, s, 'announcement');
    end if;
  end loop;
end $f$;
select * from pg_temp.check_announcement();


-- ===================== 15_announcement_type.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 15: نوع الإعلان وتاريخ انتهائه
--
--  إعدادان جديدان مع الإعلان (14_announcement.sql):
--    announcement_type        'normal' (عادي: يستطيع المستخدم إخفاءه) أو 'important' (مهم: لا يُخفى حتى يمسحه المدير)
--    announcement_expires_at  تاريخ ووقت يختفي بعده الإعلان تلقائياً ("" = بلا انتهاء)
--  يعدّلهما المدير فقط (صلاحيات جدول الإعدادات الحالية).
--
--  للسكيمتين معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة.
--  يُنفَّذ في مشروع التجربة أولاً، ثم في مشروع الإنتاج. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.app_settings') is null then continue; end if;
    execute format($q$insert into %I.app_settings (key, value) values
      ('announcement', '""'), ('announcement_type', '"normal"'), ('announcement_expires_at', '""')
      on conflict (key) do nothing$q$, s);
  end loop;
end $do$;

-- التحقق: يجب أن تظهر 3 أسطر لكل سكيما في هذا المشروع
create or replace function pg_temp.check_announcement_type() returns table (السكيما text, الإعداد text, القيمة jsonb)
language plpgsql as $f$
declare s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.app_settings') is not null then
      return query execute format($q$select %L::text, key, value from %I.app_settings where key like 'announcement%%' order by key$q$, s, s);
    end if;
  end loop;
end $f$;
select * from pg_temp.check_announcement_type();


-- ===================== 16_task_code.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 16: رمز المهمة وتاريخ الإدخال (الإصدار 2.0.0)
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
--  للسكيمات الثلاث (تتخطى غير الموجودة)، بعد 15. يمكن إعادة تنفيذه بلا ضرر (التطوير نُفّذ فيه من قبل).
--  استقبال نسخة الإنتاج (الأعمدة الجديدة) في supabase/staging/link_production.sql.
--  التراجع: 16_task_code.undo.sql
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
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


-- المهام الموجودة قبل هذا التعديل: تاريخ إدخالها = تاريخ إضافتها (بلا مشغّلات، فلا يُكتب في السجل)
do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    if exists (select 1 from information_schema.columns where table_schema = s and table_name = 'tasks' and column_name = 'entered_at') then
      execute format('alter table %I.tasks disable trigger user', s);
      execute format('update %I.tasks set entered_at = created_at where entered_at is null', s);
      execute format('alter table %I.tasks enable trigger user', s);
    end if;
  end loop;
end $do$;

-- التحقق: سطر لكل سكيما في هذا المشروع (الإنتاج: support_tasks، Tasks-Test: التجربة والتطوير)، وكل القيم true
select n.nspname as السكيما,
  exists (select 1 from information_schema.columns where table_schema = n.nspname and table_name = 'v_tasks' and column_name = 'task_code') as عرض_المهام,
  exists (select 1 from information_schema.columns where table_schema = n.nspname and table_name = 'profiles' and column_name = 'engineer_code') as رمز_المهندس,
  position('next_task_code' in p.prosrc) > 0 as الإعطاء_التلقائي
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'tasks_before_write' and n.nspname in ('support_tasks', 'support_tasks_staging', 'support_tasks_dev')
order by 1;


-- ===================== 17_import_merge.sql =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 17: دمج الاستيراد حسب الحقل (الإصدار 2.0.0)
--
--  مع كل استيراد تُحفظ قيم الملف للمهمة (imported_data: «مرجع آخر استيراد»).
--  وفي الاستيراد التالي تُقارن كل خانة بثلاث قيم: المرجع، والنظام الآن، والملف الآن:
--    تغيّرت في الملف فقط ← من الملف · في النظام فقط ← يبقى تعديل النظام · في الاثنين بقيمتين ← تعارض
--  (المقارنة نفسها في الواجهة: js/pages/import.js)
--
--  - المرجع يكتبه الاستيراد (مدير النظام) فقط، ولا يظهر في سجل التعديلات.
--  - حفظ المرجع وحده لا يغيّر «آخر تعديل» للمهمة (save_import_base).
--
--  للسكيمات الثلاث (تتخطى غير الموجودة)، بعد 16_task_code.sql. يمكن إعادة تنفيذه بلا ضرر.
--  استقبال نسخة الإنتاج (العمود الجديد) في supabase/staging/link_production.sql. التراجع: 17_import_merge.undo.sql
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging', 'support_tasks_dev'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;
    if not exists (select 1 from information_schema.columns where table_schema = s and table_name = 'tasks' and column_name = 'task_code') then
      raise exception 'نفّذ 16_task_code.sql أولاً (السكيما %)', s;
    end if;

    execute format('alter table %I.tasks add column if not exists imported_data jsonb', s);

    -- ───────────── حماية المرجع، وحفظه وحده لا يُعدّ تعديلاً ─────────────
    -- يعمل بعد tasks_before_write وtasks_review_guard (المشغّلات بترتيب أسمائها)
    execute format($f$
create or replace function %1$I.tasks_import_base()
returns trigger
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_role %1$I.user_role := %1$I.app_role();
  v_skip text[] := array['updated_at', 'updated_by', 'imported_at', 'imported_data', 'duration_days'];
begin
  -- المرجع يكتبه الاستيراد (مدير النظام) أو محرر SQL فقط
  if v_role is not null and v_role <> 'admin' then
    new.imported_data := case when tg_op = 'UPDATE' then old.imported_data end;
  end if;
  -- تغيّر المرجع وحده: لا يتغير «آخر تعديل» ولا «آخر استيراد»
  if tg_op = 'UPDATE' and new.imported_data is distinct from old.imported_data
     and (to_jsonb(new) - v_skip) = (to_jsonb(old) - v_skip) then
    new.updated_at  := old.updated_at;
    new.updated_by  := old.updated_by;
    new.imported_at := old.imported_at;
  end if;
  return new;
end $fn$
    $f$, s);
    execute format('revoke all on function %I.tasks_import_base() from public, anon', s);
    execute format('drop trigger if exists tasks_z_import_base on %I.tasks', s);
    execute format('create trigger tasks_z_import_base before insert or update on %1$I.tasks for each row execute function %1$I.tasks_import_base()', s);

    -- ───────────── حفظ المراجع دفعة واحدة (مدير النظام): [{ id, data }] ← عدد المحدَّثة ─────────────
    execute format($f$
create or replace function %1$I.save_import_base(p jsonb)
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
  update %1$I.tasks t set imported_data = x.data
  from jsonb_to_recordset(p) as x(id bigint, data jsonb)
  where t.id = x.id and t.imported_data is distinct from x.data;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$
    $f$, s);
    execute format('revoke all on function %I.save_import_base(jsonb) from public, anon', s);
    execute format('grant execute on function %I.save_import_base(jsonb) to authenticated', s);

    -- ───────────── السجل: نفس 16 + لا يسجّل مرجع الاستيراد (imported_data) ─────────────
    execute format($f$
create or replace function %1$I.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = %1$I
as $fn$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days', 'imported_at', 'imported_data'];
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

  v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'duration_days', 'imported_at', 'imported_data'];
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

  end loop;
end $do$;

-- التحقق: سطر لكل سكيما في هذا المشروع، وكل القيم true
select n.nspname as السكيما,
  exists (select 1 from information_schema.columns where table_schema = n.nspname and table_name = 'tasks' and column_name = 'imported_data') as مرجع_الاستيراد,
  exists (select 1 from pg_trigger where tgname = 'tasks_z_import_base' and tgrelid = (n.nspname || '.tasks')::regclass) as المشغّل,
  position('imported_data' in p.prosrc) > 0 as السجل
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'tasks_audit' and n.nspname in ('support_tasks', 'support_tasks_staging', 'support_tasks_dev')
order by 1;


-- =====================================================================
--  نسخة التجربة: دالة «حذف كل المهام» (زر في صفحة الإعدادات)
--  تُنفَّذ مرة واحدة في SQL Editor (وهي ضمن setup_staging.sql أيضاً)
--
--  تحذف نهائياً كل مهام التجربة وسجل تعديلاتها، لإعادة الاستيراد من جديد.
--  لا تمس المستخدمين ولا القوائم ولا الإعدادات، ولا تمس الإنتاج أبداً.
--  لا توجد نسخة من هذه الدالة في سكيما الإنتاج.
-- =====================================================================

create or replace function support_tasks_dev.purge_all_tasks()
returns jsonb
language plpgsql
security definer
set search_path = support_tasks_dev
as $$
declare
  v_tasks int;
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then
    perform support_tasks_dev.app_error('حذف كل المهام لمدير النظام فقط.');
  end if;
  select count(*) into v_tasks from support_tasks_dev.tasks;
  -- TRUNCATE وليس DELETE: Supabase يمنع DELETE بلا شرط، وهو أسرع، ويعيد ترقيم المهام من 1
  truncate support_tasks_dev.task_audit, support_tasks_dev.tasks restart identity;
  return jsonb_build_object('tasks', v_tasks, 'at', now());
end $$;

revoke all on function support_tasks_dev.purge_all_tasks() from public, anon;
grant execute on function support_tasks_dev.purge_all_tasks() to authenticated;


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
alter table support_tasks_dev.profiles add column if not exists source_id uuid;
create unique index if not exists profiles_source_id_key on support_tasks_dev.profiles (source_id) where source_id is not null;

-- دالة النسخ القديمة كانت تقرأ من سكيما الإنتاج في نفس المشروع؛ لم تعد صالحة بعد الفصل
drop function if exists support_tasks_dev.refresh_from_production();

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
      task_code text, entered_at timestamptz, imported_at timestamptz, imported_data jsonb)
  )
  insert into support_tasks_dev.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
    task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons, priority,
    task_code, entered_at, imported_at, imported_data)
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
    nullif(t.task_code, ''), coalesce(t.entered_at, t.created_at), t.imported_at, t.imported_data
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

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة, count(*) as مستخدمو_التجربة from support_tasks_dev.profiles;


-- ===================== dev/sql/18_org_structure.sql (قيد التطوير) =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 18: الهيكل التنظيمي (المرحلة الأولى) — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev). يُنفَّذ في Tasks-Test ← SQL Editor، ويمكن إعادة تنفيذه بلا ضرر.
--  التراجع: 18_org_structure.undo.sql
--
--  الهيكل بيانات يدخلها مدير النظام من صفحة «الهيكل التنظيمي»، ولا شيء منه مكتوب في الكود:
--    org_levels  المستويات (مكتب الوزير، مكتب الوكيل، مديرية، دائرة، قسم…) بترتيب: الأصغر أعلى
--    org_units   الوحدات: كل وحدة تشير إلى الوحدة الأعلى منها (parent_id)، فتتكون شجرة بأي عمق
--    org_audit   سجل كل تغيير على المستويات والوحدات (يكتبه النظام تلقائياً)
--
--  القواعد (تفرضها قاعدة البيانات، لا المتصفح):
--    - الوحدة الأعلى في مستوى أعلى (ترتيبه أصغر): قسم تحت مديرية مباشرة مسموح، ومديرية تحت قسم لا
--    - لا دوران: لا تُنقل وحدة تحت إحدى الوحدات التابعة لها، والتابعة تنتقل معها تلقائياً
--    - لا وحدة مفعّلة تحت وحدة معطّلة؛ تعطيل وحدة يعطّل كل ما تحتها
--    - الحذف للوحدة التي ليس تحتها وحدات فقط (لتصحيح الأخطاء)؛ وإلا تُعطَّل
--    - المستوى المستخدم لا يُحذف، ولا يتغير ترتيبه إن خالف وحدات قائمة
--    - التعديل لمدير النظام فقط، والقراءة لكل مستخدم نشط
--  الموظفون والتكليف (المرحلة الثانية) وربط المهام (الثالثة) في ملفات لاحقة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.org_levels (
  id         smallint generated always as identity primary key,
  name       text not null,
  level_no   int not null check (level_no between 1 and 9999),   -- الترتيب: الأصغر أعلى في الهيكل
  head_title text,                                               -- مسمى المسؤول: الوزير، المدير العام، رئيس القسم…
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references support_tasks_dev.profiles (id) on delete set null
);
create unique index if not exists org_levels_name_key on support_tasks_dev.org_levels (lower(btrim(name)));

create table if not exists support_tasks_dev.org_units (
  id         int generated always as identity primary key,
  parent_id  int references support_tasks_dev.org_units (id),
  level_id   smallint not null references support_tasks_dev.org_levels (id),
  name       text not null,
  short_name text,                                               -- اختصار اختياري (م.ع.ت.م)
  code       text,                                               -- الرمز الرسمي (اختياري، لا يتكرر)
  aliases    text[] not null default '{}',                       -- أسماء بديلة (لمطابقة الاستيراد لاحقاً)
  sort_order int not null default 0,                             -- ترتيب العرض بين الوحدات التابعة لنفس الأم
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references support_tasks_dev.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references support_tasks_dev.profiles (id) on delete set null,
  constraint org_units_not_self check (parent_id is null or parent_id <> id)
);
-- الاسم لا يتكرر بين وحدات الأم نفسها (ويتكرر في أماكن مختلفة: «قسم الشؤون الإدارية» في أكثر من مديرية)
create unique index if not exists org_units_sibling_name_key on support_tasks_dev.org_units (coalesce(parent_id, 0), lower(btrim(name)));
create unique index if not exists org_units_code_key on support_tasks_dev.org_units (upper(code)) where code is not null;
create index if not exists org_units_parent_idx on support_tasks_dev.org_units (parent_id);
create index if not exists org_units_level_idx on support_tasks_dev.org_units (level_id);

create table if not exists support_tasks_dev.org_audit (
  id             bigint generated always as identity primary key,
  entity         text not null check (entity in ('level', 'unit')),
  entity_id      int not null,
  action         text not null check (action in ('insert', 'update', 'delete')),
  changed_by     uuid references support_tasks_dev.profiles (id) on delete set null,
  changed_at     timestamptz not null default now(),
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb
);
create index if not exists org_audit_time_idx on support_tasks_dev.org_audit (changed_at desc);
create index if not exists org_audit_entity_idx on support_tasks_dev.org_audit (entity, entity_id, changed_at desc);

alter table support_tasks_dev.org_levels enable row level security;
alter table support_tasks_dev.org_units  enable row level security;
alter table support_tasks_dev.org_audit  enable row level security;

-- المستويات الأولى (مرة واحدة، والجدول فارغ). تُعدَّل وتُضاف من الصفحة. الأرقام بفراغات لإدخال مستوى بينها
insert into support_tasks_dev.org_levels (name, level_no, head_title)
select x.name, x.no, x.head
from (values ('مكتب الوزير', 10, 'الوزير'), ('مكتب الوكيل', 20, 'الوكيل'), ('مديرية', 30, 'المدير العام'),
             ('دائرة', 40, 'المدير'), ('قسم', 50, 'رئيس القسم')) as x(name, no, head)
where not exists (select 1 from support_tasks_dev.org_levels);

-- ---------------------------------------------------------------------
-- المستويات: قبل الحفظ والحذف
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.org_levels_before_write()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' then perform support_tasks_dev.app_error('اكتب اسم المستوى.'); end if;
  new.head_title := nullif(btrim(regexp_replace(coalesce(new.head_title, ''), '\s+', ' ', 'g')), '');
  if exists (select 1 from support_tasks_dev.org_levels l where lower(l.name) = lower(new.name) and l.id is distinct from new.id) then
    perform support_tasks_dev.app_error(format('يوجد مستوى باسم «%s».', new.name));
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
    -- الترتيب الجديد يجب أن يبقي كل وحدة تحت وحدة في مستوى أعلى منها
    if new.level_no <> old.level_no and (
      exists (select 1 from support_tasks_dev.org_units u
                join support_tasks_dev.org_units p on p.id = u.parent_id
                join support_tasks_dev.org_levels pl on pl.id = p.level_id
              where u.level_id = new.id and p.level_id <> new.id and pl.level_no >= new.level_no)
      or exists (select 1 from support_tasks_dev.org_units u
                join support_tasks_dev.org_units p on p.id = u.parent_id
                join support_tasks_dev.org_levels ul on ul.id = u.level_id
              where p.level_id = new.id and u.level_id <> new.id and ul.level_no <= new.level_no)
    ) then
      perform support_tasks_dev.app_error(format(
        'لا يمكن جعل ترتيب «%s» %s: توجد وحدات من هذا المستوى ستصبح تحت وحدات في مستواها أو أدنى منها، أو فوق وحدات في مستوى أعلى منها.',
        new.name, new.level_no));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists org_levels_before_write on support_tasks_dev.org_levels;
create trigger org_levels_before_write
  before insert or update on support_tasks_dev.org_levels
  for each row execute function support_tasks_dev.org_levels_before_write();

create or replace function support_tasks_dev.org_levels_before_delete()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
declare v_n int;
begin
  select count(*) into v_n from support_tasks_dev.org_units where level_id = old.id;
  if v_n > 0 then
    perform support_tasks_dev.app_error(format('المستوى «%s» مستخدم في %s وحدة؛ عطّله بدلاً من حذفه.', old.name, v_n));
  end if;
  return old;
end $$;

drop trigger if exists org_levels_before_delete on support_tasks_dev.org_levels;
create trigger org_levels_before_delete
  before delete on support_tasks_dev.org_levels
  for each row execute function support_tasks_dev.org_levels_before_delete();

-- ---------------------------------------------------------------------
-- الوحدات: قبل الحفظ
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.org_units_before_write()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
declare
  v_level support_tasks_dev.org_levels;
  v_parent support_tasks_dev.org_units;
  v_parent_no int;
  v_min_child int;
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' then perform support_tasks_dev.app_error('اكتب اسم الوحدة.'); end if;
  new.short_name := nullif(btrim(coalesce(new.short_name, '')), '');
  new.code := nullif(upper(btrim(coalesce(new.code, ''))), '');
  -- الأسماء البديلة: بلا فراغات زائدة، ولا فارغ، ولا تكرار، ولا اسم الوحدة نفسه
  new.aliases := coalesce((
    select array_agg(a order by ord) from (
      select distinct on (lower(a)) a, ord
      from (select btrim(regexp_replace(x, '\s+', ' ', 'g')) as a, ord
            from unnest(coalesce(new.aliases, '{}')) with ordinality as t(x, ord)) s
      where a <> '' and lower(a) <> lower(new.name)
      order by lower(a), ord) d), '{}');
  new.sort_order := coalesce(new.sort_order, 0);
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;

  select * into v_level from support_tasks_dev.org_levels where id = new.level_id;
  if v_level.id is null then perform support_tasks_dev.app_error('اختر مستوى الوحدة.'); end if;
  if not v_level.is_active and (tg_op = 'INSERT' or new.level_id <> old.level_id) then
    perform support_tasks_dev.app_error(format('المستوى «%s» معطّل؛ فعّله من تبويب «المستويات» أولاً.', v_level.name));
  end if;

  -- الوحدة الأعلى: موجودة، في مستوى أعلى، وليست الوحدة نفسها أو إحدى التابعة لها
  if new.parent_id is not null then
    select * into v_parent from support_tasks_dev.org_units where id = new.parent_id;
    if v_parent.id is null then perform support_tasks_dev.app_error('الوحدة الأعلى غير موجودة.'); end if;
    select level_no into v_parent_no from support_tasks_dev.org_levels where id = v_parent.level_id;
    if v_parent_no >= v_level.level_no then
      perform support_tasks_dev.app_error(format('لا يمكن أن تتبع وحدة من مستوى «%s» وحدةً من مستوى «%s»: تتبع الوحدة دائماً وحدةً في مستوى أعلى منها.',
        v_level.name, (select name from support_tasks_dev.org_levels where id = v_parent.level_id)));
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id
       and new.parent_id in (select support_tasks_dev.org_subtree(new.id)) then
      perform support_tasks_dev.app_error('لا يمكن نقل الوحدة تحت نفسها أو تحت إحدى الوحدات التابعة لها.');
    end if;
    if new.is_active and not v_parent.is_active then
      perform support_tasks_dev.app_error(format('الوحدة الأعلى «%s» معطّلة؛ فعّلها أولاً.', v_parent.name));
    end if;
  end if;

  -- تغيير المستوى: يبقى أعلى من كل الوحدات التابعة مباشرة
  if tg_op = 'UPDATE' and new.level_id <> old.level_id then
    select min(l.level_no) into v_min_child
    from support_tasks_dev.org_units c join support_tasks_dev.org_levels l on l.id = c.level_id
    where c.parent_id = new.id;
    if v_min_child is not null and v_min_child <= v_level.level_no then
      perform support_tasks_dev.app_error(format('لا يمكن جعل الوحدة من مستوى «%s»: تحتها وحدات في هذا المستوى أو أعلى منه.', v_level.name));
    end if;
  end if;

  if exists (select 1 from support_tasks_dev.org_units u
             where coalesce(u.parent_id, 0) = coalesce(new.parent_id, 0) and lower(btrim(u.name)) = lower(new.name)
               and u.id is distinct from new.id) then
    perform support_tasks_dev.app_error(format('توجد وحدة باسم «%s» في المكان نفسه من الهيكل.', new.name));
  end if;
  if new.code is not null and exists (select 1 from support_tasks_dev.org_units u where upper(u.code) = new.code and u.id is distinct from new.id) then
    perform support_tasks_dev.app_error(format('الرمز الرسمي «%s» مستخدم لوحدة أخرى.', new.code));
  end if;
  return new;
end $$;

-- كل الوحدات من وحدة ونزولاً (هي نفسها أولاً). تفيد في النقل، ولاحقاً في التقارير والصلاحيات
create or replace function support_tasks_dev.org_subtree(p_id int)
returns setof int
language sql stable
set search_path = support_tasks_dev
as $$
  with recursive t(id) as (
    select id from support_tasks_dev.org_units where id = p_id
    union
    select u.id from support_tasks_dev.org_units u join t on u.parent_id = t.id
  )
  select id from t
$$;

-- المسار الكامل من الوحدة الرئيسية حتى الوحدة: «مكتب الوكيل ← مديرية … ← دائرة …»
create or replace function support_tasks_dev.org_path(p_id int)
returns text
language sql stable
set search_path = support_tasks_dev
as $$
  with recursive t(id, parent_id, name, depth) as (
    select id, parent_id, name, 0 from support_tasks_dev.org_units where id = p_id
    union all
    select u.id, u.parent_id, u.name, t.depth + 1 from support_tasks_dev.org_units u join t on u.id = t.parent_id where t.depth < 50
  )
  select string_agg(name, ' ← ' order by depth desc) from t
$$;

drop trigger if exists org_units_before_write on support_tasks_dev.org_units;
create trigger org_units_before_write
  before insert or update on support_tasks_dev.org_units
  for each row execute function support_tasks_dev.org_units_before_write();

-- تعطيل وحدة يعطّل الوحدات التابعة لها (ينتشر مستوى بعد مستوى بنفس المشغّل)
create or replace function support_tasks_dev.org_units_after_update()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
begin
  if old.is_active and not new.is_active then
    update support_tasks_dev.org_units set is_active = false where parent_id = new.id and is_active;
  end if;
  return null;
end $$;

drop trigger if exists org_units_after_update on support_tasks_dev.org_units;
create trigger org_units_after_update
  after update of is_active on support_tasks_dev.org_units
  for each row execute function support_tasks_dev.org_units_after_update();

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

drop trigger if exists org_units_before_delete on support_tasks_dev.org_units;
create trigger org_units_before_delete
  before delete on support_tasks_dev.org_units
  for each row execute function support_tasks_dev.org_units_before_delete();

-- ---------------------------------------------------------------------
-- السجل
-- ---------------------------------------------------------------------
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
    if v_fields is null then return null; end if;   -- حفظ بلا تغيير: لا يُسجَّل
  end if;
  insert into support_tasks_dev.org_audit (entity, entity_id, action, changed_by, changed_fields, old_data, new_data)
  values (case tg_table_name when 'org_levels' then 'level' else 'unit' end,
          coalesce(new.id, old.id), lower(tg_op), auth.uid(), v_fields, v_old, v_new);
  return null;
end $$;

drop trigger if exists org_levels_audit on support_tasks_dev.org_levels;
create trigger org_levels_audit
  after insert or update or delete on support_tasks_dev.org_levels
  for each row execute function support_tasks_dev.org_audit_write();
drop trigger if exists org_units_audit on support_tasks_dev.org_units;
create trigger org_units_audit
  after insert or update or delete on support_tasks_dev.org_units
  for each row execute function support_tasks_dev.org_audit_write();

-- ---------------------------------------------------------------------
-- عمليات مدير النظام
-- ---------------------------------------------------------------------
-- تفعيل أو تعطيل وحدة. التعطيل يشمل كل ما تحتها دائماً؛ والتفعيل للوحدة وحدها، أو مع كل ما تحتها (p_subtree)
create or replace function support_tasks_dev.org_set_active(p_id int, p_active boolean, p_subtree boolean default false)
returns int
language plpgsql
set search_path = support_tasks_dev
as $$
declare v_n int := 0; v_d int; v_ids int[];
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then perform support_tasks_dev.app_error('لا تملك صلاحية لهذه العملية.'); end if;
  if not exists (select 1 from support_tasks_dev.org_units where id = p_id) then perform support_tasks_dev.app_error('الوحدة غير موجودة.'); end if;
  if not p_active then
    select count(*) into v_n from support_tasks_dev.org_units where id in (select support_tasks_dev.org_subtree(p_id)) and is_active;
    update support_tasks_dev.org_units set is_active = false where id = p_id and is_active;
    return v_n;
  end if;
  update support_tasks_dev.org_units set is_active = true where id = p_id and not is_active;
  get diagnostics v_n = row_count;
  if p_subtree then
    -- من الأعلى للأسفل، حتى تكون الأم مفعّلة قبل التابعة
    v_ids := array[p_id];
    loop
      update support_tasks_dev.org_units set is_active = true where parent_id = any(v_ids) and not is_active;
      get diagnostics v_d = row_count;
      v_n := v_n + v_d;
      select array_agg(id) into v_ids from support_tasks_dev.org_units where parent_id = any(v_ids);
      exit when v_ids is null;
    end loop;
  end if;
  return v_n;
end $$;

-- حذف وحدة ليس تحتها وحدات (لتصحيح الأخطاء)
create or replace function support_tasks_dev.org_delete_unit(p_id int)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then perform support_tasks_dev.app_error('لا تملك صلاحية لهذه العملية.'); end if;
  delete from support_tasks_dev.org_units where id = p_id;
  if not found then perform support_tasks_dev.app_error('الوحدة غير موجودة.'); end if;
end $$;

-- حذف مستوى غير مستخدم
create or replace function support_tasks_dev.org_delete_level(p_id int)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then perform support_tasks_dev.app_error('لا تملك صلاحية لهذه العملية.'); end if;
  delete from support_tasks_dev.org_levels where id = p_id;
  if not found then perform support_tasks_dev.app_error('المستوى غير موجود.'); end if;
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
grant select, insert, update on support_tasks_dev.org_levels, support_tasks_dev.org_units to authenticated;
grant select on support_tasks_dev.org_audit to authenticated;
grant all on support_tasks_dev.org_levels, support_tasks_dev.org_units, support_tasks_dev.org_audit to service_role;
revoke all on function support_tasks_dev.org_subtree(int), support_tasks_dev.org_path(int),
                       support_tasks_dev.org_set_active(int, boolean, boolean),
                       support_tasks_dev.org_delete_unit(int), support_tasks_dev.org_delete_level(int) from public, anon;
grant execute on function support_tasks_dev.org_subtree(int), support_tasks_dev.org_path(int),
                          support_tasks_dev.org_set_active(int, boolean, boolean),
                          support_tasks_dev.org_delete_unit(int), support_tasks_dev.org_delete_level(int) to authenticated, service_role;

drop policy if exists org_levels_select on support_tasks_dev.org_levels;
create policy org_levels_select on support_tasks_dev.org_levels for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists org_levels_insert on support_tasks_dev.org_levels;
create policy org_levels_insert on support_tasks_dev.org_levels for insert to authenticated with check (support_tasks_dev.app_role() = 'admin');
drop policy if exists org_levels_update on support_tasks_dev.org_levels;
create policy org_levels_update on support_tasks_dev.org_levels for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');

drop policy if exists org_units_select on support_tasks_dev.org_units;
create policy org_units_select on support_tasks_dev.org_units for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists org_units_insert on support_tasks_dev.org_units;
create policy org_units_insert on support_tasks_dev.org_units for insert to authenticated with check (support_tasks_dev.app_role() = 'admin');
drop policy if exists org_units_update on support_tasks_dev.org_units;
create policy org_units_update on support_tasks_dev.org_units for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');
-- لا توجد سياسة DELETE: الحذف عبر الدالتين فقط (بقيودهما)

drop policy if exists org_audit_select on support_tasks_dev.org_audit;
create policy org_audit_select on support_tasks_dev.org_audit for select to authenticated using (support_tasks_dev.app_role() = 'admin');
-- الكتابة في السجل من المشغّل فقط

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة,
       (select count(*) from support_tasks_dev.org_levels) as المستويات,
       (select count(*) from support_tasks_dev.org_units) as الوحدات;


-- ===================== dev/sql/19_employees.sql (قيد التطوير) =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 19: الموظفون والإسناد (المرحلة الثانية من الهيكل) — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev)، بعد 18_org_structure.sql. يُنفَّذ في Tasks-Test ← SQL Editor،
--  ويمكن إعادة تنفيذه بلا ضرر. التراجع: 19_employees.undo.sql
--  تنبيه: 20_employees_review.sql يعدّل دالتي الحفظ والاستيراد هنا؛ إن أعدت تنفيذ هذا الملف فأعد تنفيذ 20 بعده.
--
--  employees             موظفو الوزارة كلهم (مستقلون عن حسابات الدخول). المعرّف: الرقم المدني، لا يتكرر
--  assignment_types      أنواع الإسناد: أصيل (واحد، ثابت)، تكليف، ندب، قيام بالأعمال… يعدّلها مدير النظام
--  employee_assignments  مكان عمل الموظف: وحدة + نوع + رئاسة الوحدة + من تاريخ إلى تاريخ (الفارغ = قائم)
--                        النقل = إغلاق الإسناد القديم وفتح جديد، فيبقى التاريخ كاملاً
--  profiles.employee_id  ربط مستخدم النظام بسجله الوظيفي (تلقائياً بالرقم المدني أو الوظيفي)
--
--  القواعد (قاعدة البيانات تفرضها):
--    - للموظف إسناد أصيل واحد في أي يوم (لا تتداخل فترات الأصيل)
--    - لا يتكرر إسناد بالنوع نفسه للموظف في الوحدة نفسها في فترة متداخلة
--    - للوحدة رئيس أصيل واحد في أي يوم، ومن يقوم بأعمالها (غير أصيل) واحد في أي يوم، ويجتمعان (أثناء غياب الرئيس)
--    - الإسناد القائم لموظف نشط في وحدة مفعّلة فقط؛ تعطيل الموظف ينهي إسناداته القائمة
--    - التعديل والقراءة لمدير النظام (المرحلة الثالثة توسّع القراءة لاختيار الجهة الطالبة واسم الموظف)
-- =====================================================================

-- ---------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------
create table if not exists support_tasks_dev.employees (
  id          int generated always as identity primary key,
  civil_no    text not null,                                   -- الرقم المدني: معرّف الموظف
  employee_no text,                                            -- الرقم الوظيفي
  name_ar     text not null,
  name_en     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references support_tasks_dev.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references support_tasks_dev.profiles (id) on delete set null,
  constraint employees_civil_no_chk check (civil_no ~ '^[0-9]{1,20}$'),
  constraint employees_employee_no_chk check (employee_no is null or employee_no ~ '^[0-9A-Za-z/-]{1,30}$')
);
create unique index if not exists employees_civil_no_key on support_tasks_dev.employees (civil_no);
create unique index if not exists employees_employee_no_key on support_tasks_dev.employees (upper(employee_no)) where employee_no is not null;

create table if not exists support_tasks_dev.assignment_types (
  id           smallint generated always as identity primary key,
  name         text not null,
  is_primary   boolean not null default false,                 -- «أصيل»: نوع واحد فقط، ولا يُعطَّل
  implies_head boolean not null default false,                 -- النوع يعني رئاسة الوحدة (قيام بالأعمال)
  sort_order   int not null default 0,
  is_active    boolean not null default true
);
create unique index if not exists assignment_types_name_key on support_tasks_dev.assignment_types (lower(btrim(name)));
create unique index if not exists assignment_types_primary_key on support_tasks_dev.assignment_types (is_primary) where is_primary;

create table if not exists support_tasks_dev.employee_assignments (
  id          int generated always as identity primary key,
  employee_id int not null references support_tasks_dev.employees (id),
  unit_id     int not null references support_tasks_dev.org_units (id),
  type_id     smallint not null references support_tasks_dev.assignment_types (id),
  is_head     boolean not null default false,                  -- رئيس الوحدة (أو يقوم بأعمالها لغير الأصيل)
  start_date  date not null,
  end_date    date,                                            -- فارغ = قائم
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references support_tasks_dev.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references support_tasks_dev.profiles (id) on delete set null,
  constraint employee_assignments_dates_chk check (end_date is null or end_date >= start_date)
);
create index if not exists employee_assignments_employee_idx on support_tasks_dev.employee_assignments (employee_id, start_date desc);
create index if not exists employee_assignments_unit_idx on support_tasks_dev.employee_assignments (unit_id) where end_date is null;

alter table support_tasks_dev.profiles add column if not exists employee_id int references support_tasks_dev.employees (id) on delete set null;
create unique index if not exists profiles_employee_id_key on support_tasks_dev.profiles (employee_id) where employee_id is not null;

alter table support_tasks_dev.employees            enable row level security;
alter table support_tasks_dev.assignment_types     enable row level security;
alter table support_tasks_dev.employee_assignments enable row level security;

-- الأنواع الأولى (مرة واحدة، والجدول فارغ). تُعدَّل وتُضاف من النظام
insert into support_tasks_dev.assignment_types (name, is_primary, implies_head, sort_order)
select x.name, x.p, x.h, x.o
from (values ('أصيل', true, false, 1), ('تكليف', false, false, 2), ('ندب', false, false, 3), ('قيام بالأعمال', false, true, 4)) as x(name, p, h, o)
where not exists (select 1 from support_tasks_dev.assignment_types);

-- ---------------------------------------------------------------------
-- أدوات
-- ---------------------------------------------------------------------
-- أرقام عربية/فارسية ← لاتينية، بلا فراغات
create or replace function support_tasks_dev.clean_digits(p text)
returns text
language sql immutable
as $$
  select nullif(regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\s+', '', 'g'), '')
$$;

-- الفترة [من، إلى] (الفارغ = مفتوحة)
create or replace function support_tasks_dev.period(p_start date, p_end date)
returns daterange
language sql immutable
as $$ select daterange(p_start, p_end, '[]') $$;

-- ---------------------------------------------------------------------
-- الموظفون: قبل الحفظ، وبعد الإضافة (ربط المستخدم)
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.employees_before_write()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
declare v_other text;
begin
  new.civil_no := support_tasks_dev.clean_digits(new.civil_no);
  if new.civil_no is null then perform support_tasks_dev.app_error('الرقم المدني مطلوب.'); end if;
  if new.civil_no !~ '^[0-9]{1,20}$' then perform support_tasks_dev.app_error(format('الرقم المدني «%s» أرقام فقط (حتى 20 خانة).', new.civil_no)); end if;
  new.employee_no := upper(support_tasks_dev.clean_digits(new.employee_no));
  if new.employee_no is not null and new.employee_no !~ '^[0-9A-Z/-]{1,30}$' then
    perform support_tasks_dev.app_error(format('الرقم الوظيفي «%s» غير صحيح.', new.employee_no));
  end if;
  new.name_ar := btrim(regexp_replace(coalesce(new.name_ar, ''), '\s+', ' ', 'g'));
  if new.name_ar = '' then perform support_tasks_dev.app_error('الاسم بالعربي مطلوب.'); end if;
  new.name_en := nullif(btrim(regexp_replace(coalesce(new.name_en, ''), '\s+', ' ', 'g')), '');
  select name_ar into v_other from support_tasks_dev.employees where civil_no = new.civil_no and id is distinct from new.id;
  if v_other is not null then perform support_tasks_dev.app_error(format('الرقم المدني %s مسجّل للموظف «%s».', new.civil_no, v_other)); end if;
  if new.employee_no is not null then
    select name_ar into v_other from support_tasks_dev.employees where upper(employee_no) = new.employee_no and id is distinct from new.id;
    if v_other is not null then perform support_tasks_dev.app_error(format('الرقم الوظيفي %s مسجّل للموظف «%s».', new.employee_no, v_other)); end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    -- التعطيل عبر employee_set_active (ينهي الإسنادات القائمة)؛ هنا يُرفض إن بقي إسناد قائم
    if old.is_active and not new.is_active and exists (
      select 1 from support_tasks_dev.employee_assignments a
      where a.employee_id = new.id and (a.end_date is null or a.end_date > current_date)) then
      perform support_tasks_dev.app_error('للموظف إسنادات قائمة؛ أنهِها أولاً، أو عطّله من زر «تعطيل» فتنتهي معه.');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employees_before_write on support_tasks_dev.employees;
create trigger employees_before_write
  before insert or update on support_tasks_dev.employees
  for each row execute function support_tasks_dev.employees_before_write();

-- ربط مستخدمي النظام بسجلاتهم الوظيفية: رقم الدخول = الرقم المدني، أو = الرقم الوظيفي
create or replace function support_tasks_dev.link_users_to_employees()
returns int
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_n int; v_m int;
begin
  if auth.uid() is not null and support_tasks_dev.app_role() is distinct from 'admin' then
    perform support_tasks_dev.app_error('لا تملك صلاحية لهذه العملية.');
  end if;
  update support_tasks_dev.profiles p set employee_id = e.id
  from support_tasks_dev.employees e
  where p.employee_id is null and p.login_no is not null and e.civil_no = p.login_no
    and not exists (select 1 from support_tasks_dev.profiles x where x.employee_id = e.id);
  get diagnostics v_n = row_count;
  update support_tasks_dev.profiles p set employee_id = e.id
  from support_tasks_dev.employees e
  where p.employee_id is null and p.login_no is not null and upper(e.employee_no) = upper(p.login_no)
    and not exists (select 1 from support_tasks_dev.profiles x where x.employee_id = e.id);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;

create or replace function support_tasks_dev.employees_after_insert()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  update support_tasks_dev.profiles p set employee_id = new.id
  where p.employee_id is null and p.login_no is not null
    and (p.login_no = new.civil_no or upper(p.login_no) = new.employee_no)
    and not exists (select 1 from support_tasks_dev.profiles x where x.employee_id = new.id);
  return null;
end $$;

drop trigger if exists employees_after_insert on support_tasks_dev.employees;
create trigger employees_after_insert
  after insert on support_tasks_dev.employees
  for each row execute function support_tasks_dev.employees_after_insert();

-- ---------------------------------------------------------------------
-- أنواع الإسناد: قبل الحفظ
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.assignment_types_before_write()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' then perform support_tasks_dev.app_error('اكتب اسم النوع.'); end if;
  if exists (select 1 from support_tasks_dev.assignment_types t where lower(t.name) = lower(new.name) and t.id is distinct from new.id) then
    perform support_tasks_dev.app_error(format('يوجد نوع باسم «%s».', new.name));
  end if;
  if tg_op = 'INSERT' then
    new.is_primary := false;                    -- «أصيل» واحد فقط، من التجهيز
  else
    new.id := old.id;
    new.is_primary := old.is_primary;           -- لا يتغير
    if old.is_primary then new.is_active := true; new.implies_head := false; end if;
  end if;
  return new;
end $$;

drop trigger if exists assignment_types_before_write on support_tasks_dev.assignment_types;
create trigger assignment_types_before_write
  before insert or update on support_tasks_dev.assignment_types
  for each row execute function support_tasks_dev.assignment_types_before_write();

-- ---------------------------------------------------------------------
-- الإسناد: قبل الحفظ
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.employee_assignments_before_write()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
declare
  v_type support_tasks_dev.assignment_types;
  v_emp support_tasks_dev.employees;
  v_unit support_tasks_dev.org_units;
  v_open boolean;
  v_other text;
begin
  select * into v_type from support_tasks_dev.assignment_types where id = new.type_id;
  if v_type.id is null then perform support_tasks_dev.app_error('اختر نوع الإسناد.'); end if;
  select * into v_emp from support_tasks_dev.employees where id = new.employee_id;
  if v_emp.id is null then perform support_tasks_dev.app_error('الموظف غير موجود.'); end if;
  select * into v_unit from support_tasks_dev.org_units where id = new.unit_id;
  if v_unit.id is null then perform support_tasks_dev.app_error('اختر الوحدة.'); end if;
  if new.start_date is null then perform support_tasks_dev.app_error('تاريخ البداية مطلوب.'); end if;
  if new.end_date is not null and new.end_date < new.start_date then
    perform support_tasks_dev.app_error('تاريخ النهاية قبل تاريخ البداية.');
  end if;
  if v_type.implies_head then new.is_head := true; end if;
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.employee_id := old.employee_id;         -- الإسناد لا ينتقل من موظف لآخر
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;

  -- الإسناد القائم (أو المستقبلي): لموظف نشط، في وحدة مفعّلة، بنوع مفعّل
  v_open := new.end_date is null or new.end_date >= current_date;
  if v_open and (tg_op = 'INSERT' or new.end_date is distinct from old.end_date or new.unit_id <> old.unit_id or new.type_id <> old.type_id) then
    if not v_emp.is_active then perform support_tasks_dev.app_error(format('الموظف «%s» غير نشط.', v_emp.name_ar)); end if;
    if not v_unit.is_active then perform support_tasks_dev.app_error(format('الوحدة «%s» معطّلة.', v_unit.name)); end if;
    if not v_type.is_active then perform support_tasks_dev.app_error(format('نوع الإسناد «%s» معطّل.', v_type.name)); end if;
  end if;

  -- أصيل واحد للموظف في أي يوم
  if v_type.is_primary then
    select u.name into v_other
    from support_tasks_dev.employee_assignments a
      join support_tasks_dev.assignment_types t on t.id = a.type_id and t.is_primary
      join support_tasks_dev.org_units u on u.id = a.unit_id
    where a.employee_id = new.employee_id and a.id is distinct from new.id
      and support_tasks_dev.period(a.start_date, a.end_date) && support_tasks_dev.period(new.start_date, new.end_date)
    limit 1;
    if v_other is not null then
      perform support_tasks_dev.app_error(format('للموظف «%s» إسناد أصيل في «%s» في الفترة نفسها. أنهِه أولاً، أو استخدم «نقل».', v_emp.name_ar, v_other));
    end if;
  end if;

  -- لا يتكرر النوع نفسه للموظف في الوحدة نفسها
  if exists (select 1 from support_tasks_dev.employee_assignments a
             where a.employee_id = new.employee_id and a.unit_id = new.unit_id and a.type_id = new.type_id and a.id is distinct from new.id
               and support_tasks_dev.period(a.start_date, a.end_date) && support_tasks_dev.period(new.start_date, new.end_date)) then
    perform support_tasks_dev.app_error(format('للموظف إسناد «%s» في «%s» في الفترة نفسها.', v_type.name, v_unit.name));
  end if;

  -- رئيس أصيل واحد للوحدة، ومن يقوم بأعمالها واحد
  if new.is_head then
    select e.name_ar into v_other
    from support_tasks_dev.employee_assignments a
      join support_tasks_dev.assignment_types t on t.id = a.type_id
      join support_tasks_dev.employees e on e.id = a.employee_id
    where a.unit_id = new.unit_id and a.is_head and a.id is distinct from new.id and t.is_primary = v_type.is_primary
      and support_tasks_dev.period(a.start_date, a.end_date) && support_tasks_dev.period(new.start_date, new.end_date)
    limit 1;
    if v_other is not null then
      perform support_tasks_dev.app_error(format(case when v_type.is_primary
        then 'للوحدة «%s» رئيس في الفترة نفسها: %s. أنهِ إسناده أولاً.'
        else 'يقوم بأعمال رئاسة الوحدة «%s» في الفترة نفسها: %s. أنهِ إسناده أولاً.' end, v_unit.name, v_other));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employee_assignments_before_write on support_tasks_dev.employee_assignments;
create trigger employee_assignments_before_write
  before insert or update on support_tasks_dev.employee_assignments
  for each row execute function support_tasks_dev.employee_assignments_before_write();

-- حذف الوحدة (من 18): يُرفض أيضاً إن كان لها إسنادات موظفين
create or replace function support_tasks_dev.org_units_before_delete()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
declare v_n int;
begin
  if exists (select 1 from support_tasks_dev.org_units where parent_id = old.id) then
    perform support_tasks_dev.app_error(format('لا يمكن حذف «%s» لأن تحتها وحدات. احذف الوحدات التابعة أولاً، أو عطّل الوحدة.', old.name));
  end if;
  select count(*) into v_n from support_tasks_dev.employee_assignments where unit_id = old.id;
  if v_n > 0 then
    perform support_tasks_dev.app_error(format('لا يمكن حذف «%s» لأن لها %s إسناد موظفين (حالية أو سابقة)؛ عطّلها بدلاً من حذفها.', old.name, v_n));
  end if;
  return old;
end $$;

-- ---------------------------------------------------------------------
-- السجل: الجدول نفسه (org_audit) لكل الهيكل
-- ---------------------------------------------------------------------
alter table support_tasks_dev.org_audit drop constraint if exists org_audit_entity_check;
alter table support_tasks_dev.org_audit add constraint org_audit_entity_check
  check (entity in ('level', 'unit', 'employee', 'assignment', 'assignment_type'));

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
    if v_fields is null then return null; end if;   -- حفظ بلا تغيير: لا يُسجَّل
  end if;
  insert into support_tasks_dev.org_audit (entity, entity_id, action, changed_by, changed_fields, old_data, new_data)
  values (case tg_table_name when 'org_levels' then 'level' when 'org_units' then 'unit' when 'employees' then 'employee'
                             when 'employee_assignments' then 'assignment' else 'assignment_type' end,
          coalesce(new.id, old.id), lower(tg_op), auth.uid(), v_fields, v_old, v_new);
  return null;
end $$;

drop trigger if exists employees_audit on support_tasks_dev.employees;
create trigger employees_audit after insert or update or delete on support_tasks_dev.employees
  for each row execute function support_tasks_dev.org_audit_write();
drop trigger if exists employee_assignments_audit on support_tasks_dev.employee_assignments;
create trigger employee_assignments_audit after insert or update or delete on support_tasks_dev.employee_assignments
  for each row execute function support_tasks_dev.org_audit_write();
drop trigger if exists assignment_types_audit on support_tasks_dev.assignment_types;
create trigger assignment_types_audit after insert or update or delete on support_tasks_dev.assignment_types
  for each row execute function support_tasks_dev.org_audit_write();

-- ---------------------------------------------------------------------
-- عمليات مدير النظام
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.require_admin()
returns void
language plpgsql stable
as $$
begin
  if support_tasks_dev.app_role() is distinct from 'admin' then perform support_tasks_dev.app_error('لا تملك صلاحية لهذه العملية.'); end if;
end $$;

-- نقل الموظف (الأصيل): ينتهي إسناده الأصيل القائم في اليوم السابق، ويبدأ الجديد من p_date
create or replace function support_tasks_dev.employee_transfer(p_employee int, p_unit int, p_date date, p_is_head boolean default false)
returns int
language plpgsql
set search_path = support_tasks_dev
as $$
declare v_primary smallint; v_cur support_tasks_dev.employee_assignments; v_id int;
begin
  perform support_tasks_dev.require_admin();
  if p_date is null then perform support_tasks_dev.app_error('تاريخ النقل مطلوب.'); end if;
  select id into v_primary from support_tasks_dev.assignment_types where is_primary;
  select a.* into v_cur from support_tasks_dev.employee_assignments a
  where a.employee_id = p_employee and a.type_id = v_primary
    and a.start_date <= p_date and (a.end_date is null or a.end_date >= p_date)
  limit 1;
  if v_cur.id is not null then
    if v_cur.unit_id = p_unit then perform support_tasks_dev.app_error('الموظف في هذه الوحدة أصلاً.'); end if;
    if v_cur.start_date = p_date then
      -- بدأ اليوم نفسه: تصحيح الوحدة بدل فتح إسناد جديد
      update support_tasks_dev.employee_assignments set unit_id = p_unit, is_head = coalesce(p_is_head, false) where id = v_cur.id;
      return v_cur.id;
    end if;
    update support_tasks_dev.employee_assignments set end_date = p_date - 1 where id = v_cur.id;
  end if;
  insert into support_tasks_dev.employee_assignments (employee_id, unit_id, type_id, is_head, start_date)
  values (p_employee, p_unit, v_primary, coalesce(p_is_head, false), p_date)
  returning id into v_id;
  return v_id;
end $$;

-- تعطيل الموظف (ينهي إسناداته القائمة في p_date، ويحذف ما يبدأ بعده) أو تفعيله
create or replace function support_tasks_dev.employee_set_active(p_id int, p_active boolean, p_date date default current_date)
returns int
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_n int := 0; v_d int;
begin
  perform support_tasks_dev.require_admin();
  if not exists (select 1 from support_tasks_dev.employees where id = p_id) then perform support_tasks_dev.app_error('الموظف غير موجود.'); end if;
  if not p_active then
    if p_date is null or p_date > current_date then perform support_tasks_dev.app_error('تاريخ انتهاء الإسنادات لا يكون بعد اليوم.'); end if;
    delete from support_tasks_dev.employee_assignments where employee_id = p_id and start_date > p_date;
    get diagnostics v_d = row_count;
    update support_tasks_dev.employee_assignments set end_date = p_date
    where employee_id = p_id and (end_date is null or end_date > p_date);
    get diagnostics v_n = row_count;
    v_n := v_n + v_d;
  end if;
  update support_tasks_dev.employees set is_active = p_active where id = p_id and is_active <> p_active;
  return v_n;
end $$;

-- حذف إسناد أُدخل خطأً
create or replace function support_tasks_dev.assignment_delete(p_id int)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  perform support_tasks_dev.require_admin();
  delete from support_tasks_dev.employee_assignments where id = p_id;
  if not found then perform support_tasks_dev.app_error('الإسناد غير موجود.'); end if;
end $$;

-- حذف نوع إسناد غير مستخدم (غير «أصيل»)
create or replace function support_tasks_dev.assignment_type_delete(p_id int)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_t support_tasks_dev.assignment_types; v_n int;
begin
  perform support_tasks_dev.require_admin();
  select * into v_t from support_tasks_dev.assignment_types where id = p_id;
  if v_t.id is null then perform support_tasks_dev.app_error('النوع غير موجود.'); end if;
  if v_t.is_primary then perform support_tasks_dev.app_error('نوع «أصيل» أساسي ولا يُحذف.'); end if;
  select count(*) into v_n from support_tasks_dev.employee_assignments where type_id = p_id;
  if v_n > 0 then perform support_tasks_dev.app_error(format('النوع «%s» مستخدم في %s إسناد؛ عطّله بدلاً من حذفه.', v_t.name, v_n)); end if;
  delete from support_tasks_dev.assignment_types where id = p_id;
end $$;

-- ربط مستخدم بموظف يدوياً (أو فكّه بـ null)
create or replace function support_tasks_dev.employee_set_user(p_employee int, p_user uuid)
returns void
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  perform support_tasks_dev.require_admin();
  update support_tasks_dev.profiles set employee_id = null where employee_id = p_employee and id is distinct from p_user;
  if p_user is not null then
    if not exists (select 1 from support_tasks_dev.profiles where id = p_user) then perform support_tasks_dev.app_error('المستخدم غير موجود.'); end if;
    update support_tasks_dev.profiles set employee_id = p_employee where id = p_user;
  end if;
end $$;

-- استيراد الموظفين: إضافة أو تحديث حسب الرقم المدني. القيمة الفارغة في الملف لا تمسح الموجود
-- p: [{ civil_no, employee_no, name_ar, name_en }] ← { created, updated, unchanged, linked }
create or replace function support_tasks_dev.employees_import(p jsonb)
returns jsonb
language plpgsql
set search_path = support_tasks_dev
as $$
declare r record; v_e support_tasks_dev.employees; v_c int := 0; v_u int := 0; v_s int := 0; v_l int;
  v_civil text; v_no text; v_ar text; v_en text;
begin
  perform support_tasks_dev.require_admin();
  for r in select * from jsonb_to_recordset(p) as x(civil_no text, employee_no text, name_ar text, name_en text) loop
    v_civil := support_tasks_dev.clean_digits(r.civil_no);
    v_no := upper(support_tasks_dev.clean_digits(r.employee_no));
    v_ar := nullif(btrim(regexp_replace(coalesce(r.name_ar, ''), '\s+', ' ', 'g')), '');
    v_en := nullif(btrim(regexp_replace(coalesce(r.name_en, ''), '\s+', ' ', 'g')), '');
    select * into v_e from support_tasks_dev.employees where civil_no = v_civil;
    if v_e.id is null then
      insert into support_tasks_dev.employees (civil_no, employee_no, name_ar, name_en) values (v_civil, v_no, v_ar, v_en);
      v_c := v_c + 1;
    elsif (v_no is not null and v_no is distinct from v_e.employee_no) or (v_ar is not null and v_ar <> v_e.name_ar)
          or (v_en is not null and v_en is distinct from v_e.name_en) then
      update support_tasks_dev.employees set employee_no = coalesce(v_no, employee_no), name_ar = coalesce(v_ar, name_ar), name_en = coalesce(v_en, name_en)
      where id = v_e.id;
      v_u := v_u + 1;
    else
      v_s := v_s + 1;
    end if;
  end loop;
  v_l := support_tasks_dev.link_users_to_employees();
  return jsonb_build_object('created', v_c, 'updated', v_u, 'unchanged', v_s, 'linked', v_l);
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
grant select, insert, update on support_tasks_dev.employees, support_tasks_dev.assignment_types, support_tasks_dev.employee_assignments to authenticated;
grant all on support_tasks_dev.employees, support_tasks_dev.assignment_types, support_tasks_dev.employee_assignments to service_role;
revoke all on function support_tasks_dev.clean_digits(text), support_tasks_dev.period(date, date), support_tasks_dev.require_admin(),
  support_tasks_dev.link_users_to_employees(), support_tasks_dev.employee_transfer(int, int, date, boolean),
  support_tasks_dev.employee_set_active(int, boolean, date), support_tasks_dev.assignment_delete(int),
  support_tasks_dev.assignment_type_delete(int), support_tasks_dev.employee_set_user(int, uuid), support_tasks_dev.employees_import(jsonb) from public, anon;
grant execute on function support_tasks_dev.clean_digits(text), support_tasks_dev.period(date, date), support_tasks_dev.require_admin(),
  support_tasks_dev.link_users_to_employees(), support_tasks_dev.employee_transfer(int, int, date, boolean),
  support_tasks_dev.employee_set_active(int, boolean, date), support_tasks_dev.assignment_delete(int),
  support_tasks_dev.assignment_type_delete(int), support_tasks_dev.employee_set_user(int, uuid), support_tasks_dev.employees_import(jsonb) to authenticated, service_role;

drop policy if exists employees_select on support_tasks_dev.employees;
create policy employees_select on support_tasks_dev.employees for select to authenticated using (support_tasks_dev.app_role() = 'admin');
drop policy if exists employees_insert on support_tasks_dev.employees;
create policy employees_insert on support_tasks_dev.employees for insert to authenticated with check (support_tasks_dev.app_role() = 'admin');
drop policy if exists employees_update on support_tasks_dev.employees;
create policy employees_update on support_tasks_dev.employees for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');

drop policy if exists assignment_types_select on support_tasks_dev.assignment_types;
create policy assignment_types_select on support_tasks_dev.assignment_types for select to authenticated using (support_tasks_dev.app_role() is not null);
drop policy if exists assignment_types_insert on support_tasks_dev.assignment_types;
create policy assignment_types_insert on support_tasks_dev.assignment_types for insert to authenticated with check (support_tasks_dev.app_role() = 'admin');
drop policy if exists assignment_types_update on support_tasks_dev.assignment_types;
create policy assignment_types_update on support_tasks_dev.assignment_types for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');

drop policy if exists employee_assignments_select on support_tasks_dev.employee_assignments;
create policy employee_assignments_select on support_tasks_dev.employee_assignments for select to authenticated using (support_tasks_dev.app_role() = 'admin');
drop policy if exists employee_assignments_insert on support_tasks_dev.employee_assignments;
create policy employee_assignments_insert on support_tasks_dev.employee_assignments for insert to authenticated with check (support_tasks_dev.app_role() = 'admin');
drop policy if exists employee_assignments_update on support_tasks_dev.employee_assignments;
create policy employee_assignments_update on support_tasks_dev.employee_assignments for update to authenticated
  using (support_tasks_dev.app_role() = 'admin') with check (support_tasks_dev.app_role() = 'admin');
-- لا توجد سياسة DELETE: الحذف عبر الدوال فقط

-- ربط المستخدمين الحاليين بموظفين موجودين (إن وُجدوا)
select support_tasks_dev.link_users_to_employees();

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة,
       (select count(*) from support_tasks_dev.assignment_types) as أنواع_الإسناد,
       (select count(*) from support_tasks_dev.employees) as الموظفون;


-- ===================== dev/sql/20_employees_review.sql (قيد التطوير) =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 20: الموظفون «تحتاج مراجعة» — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev)، بعد 19_employees.sql. يُنفَّذ في Tasks-Test ← SQL Editor،
--  ويمكن إعادة تنفيذه بلا ضرر. التراجع: 20_employees_review.undo.sql
--
--  صفوف ملف الموظفين التي فيها خطأ (رقم مدني فارغ أو غير صحيح أو مكرر، رقم وظيفي مكرر، اسم ناقص) تُستورد
--  ولا تُترك: الخانة الخاطئة تُفرَّغ، وقيمتها الأصلية وسبب الخطأ تُحفظ في review_notes، والموظف يُعلَّم needs_review.
--  يُصحَّح لاحقاً من سجل الموظف، ثم تُزال العلامة.
--    - الرقم المدني يبقى المعرّف ولا يتكرر، لكنه يجوز أن يكون فارغاً للموظف الذي يحتاج مراجعة فقط
--      (الموظف بلا رقم مدني يبقى «تحتاج مراجعة» حتى يُكتب رقمه)
--    - السرعة: فحوص المشغّلات بصلاحية المالك والسياسات تقرأ الدور مرة واحدة (انظر آخر الملف)
--    - إعادة الاستيراد: الصف بلا رقم مدني يطابق الموظف صاحب رقمه الوظيفي (ولو صُحّح رقمه المدني في النظام)،
--      وإلا موظفاً بلا رقم مدني بالاسم نفسه، فلا يتكرر
-- =====================================================================

alter table support_tasks_dev.employees alter column civil_no drop not null;
alter table support_tasks_dev.employees add column if not exists needs_review boolean not null default false;
alter table support_tasks_dev.employees add column if not exists review_notes text;
create index if not exists employees_review_idx on support_tasks_dev.employees (needs_review) where needs_review;
-- مطابقة من بلا رقم مدني بالاسم عند إعادة الاستيراد
create index if not exists employees_nocivil_name_idx on support_tasks_dev.employees (name_ar) where civil_no is null;

-- أسباب المراجعة بصيغة موحّدة تبدأ بالسبب («لا يوجد رقم مدني»…) — تعدّل ملاحظات ما استُورد بالصيغة السابقة
update support_tasks_dev.employees set review_notes =
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(review_notes,
    'بلا رقم مدني في الملف', 'لا يوجد رقم مدني', 'g'),
    'بلا رقم وظيفي في الملف', 'لا يوجد رقم وظيفي', 'g'),
    'بلا اسم بالعربي \(استُخدم الإنجليزي\)', 'لا يوجد اسم بالعربي (وُضع الإنجليزي مكانه)', 'g'),
    ' · أُعطي الرقم الوظيفي \(([^)]*)\) رقماً مدنياً', ' (وُضع الرقم الوظيفي \1 مكانه مؤقتاً)', 'g'),
    ' · أُعطي الرقم المدني \(([^)]*)\) رقماً وظيفياً', ' (وُضع الرقم المدني \1 مكانه مؤقتاً)', 'g'),
    'رقم مدني غير صحيح في الملف:', 'رقم مدني غير صحيح:', 'g'),
    'الرقم المدني ([0-9]+) مكرر في الملف', 'رقم مدني مكرر: \1', 'g'),
    'رقم وظيفي غير صحيح في الملف:', 'رقم وظيفي غير صحيح:', 'g'),
    'الرقم الوظيفي (\S+) مسجّل للموظف («[^»]*»)', 'رقم وظيفي مسجّل لموظف آخر: \1 (\2)', 'g'),
    'الرقم الوظيفي (\S+) مكرر في الملف', 'رقم وظيفي مكرر: \1', 'g')
where review_notes ~ '(بلا رقم|بلا اسم بالعربي \(|أُعطي الرقم|في الملف)';

-- قبل الحفظ (من 19): الرقم المدني الفارغ مسموح للموظف الذي يحتاج مراجعة، ويفرضها
create or replace function support_tasks_dev.employees_before_write()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_other text;
begin
  new.civil_no := support_tasks_dev.clean_digits(new.civil_no);
  if new.civil_no is null then
    if not new.needs_review and (tg_op = 'INSERT' or old.civil_no is not null) then
      perform support_tasks_dev.app_error('الرقم المدني مطلوب.');
    end if;
    new.needs_review := true;
  elsif new.civil_no !~ '^[0-9]{1,20}$' then
    perform support_tasks_dev.app_error(format('الرقم المدني «%s» أرقام فقط (حتى 20 خانة).', new.civil_no));
  end if;
  new.employee_no := upper(support_tasks_dev.clean_digits(new.employee_no));
  if new.employee_no is not null and new.employee_no !~ '^[0-9A-Z/-]{1,30}$' then
    perform support_tasks_dev.app_error(format('الرقم الوظيفي «%s» غير صحيح.', new.employee_no));
  end if;
  new.name_ar := btrim(regexp_replace(coalesce(new.name_ar, ''), '\s+', ' ', 'g'));
  if new.name_ar = '' then perform support_tasks_dev.app_error('الاسم بالعربي مطلوب.'); end if;
  new.name_en := nullif(btrim(regexp_replace(coalesce(new.name_en, ''), '\s+', ' ', 'g')), '');
  new.review_notes := nullif(btrim(coalesce(new.review_notes, '')), '');
  if new.civil_no is not null then
    select name_ar into v_other from support_tasks_dev.employees where civil_no = new.civil_no and id is distinct from new.id;
    if v_other is not null then perform support_tasks_dev.app_error(format('الرقم المدني %s مسجّل للموظف «%s».', new.civil_no, v_other)); end if;
  end if;
  if new.employee_no is not null then
    select name_ar into v_other from support_tasks_dev.employees where upper(employee_no) = new.employee_no and id is distinct from new.id;
    if v_other is not null then perform support_tasks_dev.app_error(format('الرقم الوظيفي %s مسجّل للموظف «%s».', new.employee_no, v_other)); end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if old.is_active and not new.is_active and exists (
      select 1 from support_tasks_dev.employee_assignments a
      where a.employee_id = new.id and (a.end_date is null or a.end_date > current_date)) then
      perform support_tasks_dev.app_error('للموظف إسنادات قائمة؛ أنهِها أولاً، أو عطّله من زر «تعطيل» فتنتهي معه.');
    end if;
  end if;
  return new;
end $$;

-- الاستيراد (من 19)، مع صفوف المراجعة.
-- p: [{ civil_no, employee_no, name_ar, name_en, review }]   review: سبب المراجعة (والقيم الأصلية) أو null
-- ← { created, updated, unchanged, review, linked }
create or replace function support_tasks_dev.employees_import(p jsonb)
returns jsonb
language plpgsql
set search_path = support_tasks_dev
as $$
declare r record; v_e support_tasks_dev.employees; v_c int := 0; v_u int := 0; v_s int := 0; v_r int := 0; v_l int;
  v_civil text; v_no text; v_ar text; v_en text; v_rev text; v_notes text;
begin
  perform support_tasks_dev.require_admin();
  for r in select * from jsonb_to_recordset(p) as x(civil_no text, employee_no text, name_ar text, name_en text, review text) loop
    v_civil := support_tasks_dev.clean_digits(r.civil_no);
    v_no := upper(support_tasks_dev.clean_digits(r.employee_no));
    v_ar := nullif(btrim(regexp_replace(coalesce(r.name_ar, ''), '\s+', ' ', 'g')), '');
    v_en := nullif(btrim(regexp_replace(coalesce(r.name_en, ''), '\s+', ' ', 'g')), '');
    v_rev := nullif(btrim(coalesce(r.review, '')), '');
    v_e := null;
    if v_civil is not null then
      select * into v_e from support_tasks_dev.employees where civil_no = v_civil;
    else
      if v_no is not null then
        select * into v_e from support_tasks_dev.employees where upper(employee_no) = v_no;
      end if;
      if v_e.id is null and v_ar is not null then
        select * into v_e from support_tasks_dev.employees
        where civil_no is null and name_ar = v_ar and (v_no is null or employee_no is null or upper(employee_no) = v_no)
        order by id limit 1;
      end if;
    end if;
    if v_e.id is null then
      insert into support_tasks_dev.employees (civil_no, employee_no, name_ar, name_en, needs_review, review_notes)
      values (v_civil, v_no, coalesce(v_ar, v_en, 'بلا اسم'), v_en, v_rev is not null or v_civil is null, v_rev);
      v_c := v_c + 1;
      if v_rev is not null or v_civil is null then v_r := v_r + 1; end if;
    else
      -- سبب المراجعة يُضاف إلى الملاحظات إن لم يكن فيها
      v_notes := case when v_rev is null then v_e.review_notes
                      when v_e.review_notes is null then v_rev
                      when position(v_rev in v_e.review_notes) > 0 then v_e.review_notes
                      else v_e.review_notes || E'\n' || v_rev end;
      if (v_no is not null and v_no is distinct from v_e.employee_no) or (v_ar is not null and v_ar <> v_e.name_ar)
         or (v_en is not null and v_en is distinct from v_e.name_en) or v_notes is distinct from v_e.review_notes then
        update support_tasks_dev.employees set employee_no = coalesce(v_no, employee_no), name_ar = coalesce(v_ar, name_ar),
          name_en = coalesce(v_en, name_en), review_notes = v_notes, needs_review = needs_review or v_rev is not null
        where id = v_e.id;
        v_u := v_u + 1;
        if v_rev is not null then v_r := v_r + 1; end if;
      else
        v_s := v_s + 1;
      end if;
    end if;
  end loop;
  v_l := support_tasks_dev.link_users_to_employees();
  return jsonb_build_object('created', v_c, 'updated', v_u, 'unchanged', v_s, 'review', v_r, 'linked', v_l);
end $$;

-- ---------------------------------------------------------------------
-- السرعة: الاستيراد كان يبطؤ كلما زاد الموظفون (ويتجاوز مهلة Supabase ← خطأ 500)
--  1) فحوص المشغّلات (التكرار والتداخل) تعمل بصلاحية المالك: ترى كل الصفوف وتستخدم الفهارس، بدل أن
--     تمنعها سياسات RLS فيُفحص كل جدول الموظفين لكل صف مستورد
--  2) السياسات تقرأ دور المستخدم مرة واحدة لكل استعلام: (select app_role()) بدل استدعائها لكل صف
-- ---------------------------------------------------------------------
alter function support_tasks_dev.employee_assignments_before_write() security definer;
alter function support_tasks_dev.assignment_types_before_write() security definer;
alter function support_tasks_dev.org_units_before_write() security definer;
alter function support_tasks_dev.org_levels_before_write() security definer;
alter function support_tasks_dev.org_units_before_delete() security definer;
alter function support_tasks_dev.org_levels_before_delete() security definer;

do $$
declare r record;
begin
  for r in select * from (values
      ('employees', 'admin'), ('employee_assignments', 'admin'), ('assignment_types', 'any'),
      ('org_units', 'any'), ('org_levels', 'any')) as t(tbl, rd) loop
    execute format('drop policy if exists %1$s_select on support_tasks_dev.%1$s', r.tbl);
    execute format('create policy %1$s_select on support_tasks_dev.%1$s for select to authenticated using (%2$s)', r.tbl,
      case r.rd when 'admin' then '(select support_tasks_dev.app_role()) = ''admin''' else '(select support_tasks_dev.app_role()) is not null' end);
    execute format('drop policy if exists %1$s_insert on support_tasks_dev.%1$s', r.tbl);
    execute format('create policy %1$s_insert on support_tasks_dev.%1$s for insert to authenticated with check ((select support_tasks_dev.app_role()) = ''admin'')', r.tbl);
    execute format('drop policy if exists %1$s_update on support_tasks_dev.%1$s', r.tbl);
    execute format('create policy %1$s_update on support_tasks_dev.%1$s for update to authenticated using ((select support_tasks_dev.app_role()) = ''admin'') with check ((select support_tasks_dev.app_role()) = ''admin'')', r.tbl);
  end loop;
end $$;
drop policy if exists org_audit_select on support_tasks_dev.org_audit;
create policy org_audit_select on support_tasks_dev.org_audit for select to authenticated using ((select support_tasks_dev.app_role()) = 'admin');

-- السجل (من 19): يتوقف أثناء «حذف كل الموظفين» فقط (علامة skip_audit داخل العملية نفسها)
create or replace function support_tasks_dev.org_audit_write()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
begin
  if current_setting('support_tasks_dev.skip_audit', true) = 'on' then return null; end if;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) - array['updated_at', 'updated_by', 'created_at', 'created_by'] end;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) - array['updated_at', 'updated_by', 'created_at', 'created_by'] end;
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_fields from jsonb_object_keys(v_new) k where v_new -> k is distinct from v_old -> k;
    if v_fields is null then return null; end if;   -- حفظ بلا تغيير: لا يُسجَّل
  end if;
  insert into support_tasks_dev.org_audit (entity, entity_id, action, changed_by, changed_fields, old_data, new_data)
  values (case tg_table_name when 'org_levels' then 'level' when 'org_units' then 'unit' when 'employees' then 'employee'
                             when 'employee_assignments' then 'assignment' else 'assignment_type' end,
          coalesce(new.id, old.id), lower(tg_op), auth.uid(), v_fields, v_old, v_new);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- حذف كل الموظفين (مدير النظام): الموظفون وإسناداتهم وسجلها، وفك ربطهم بالمستخدمين
-- الهيكل (الوحدات والمستويات) وأنواع الإسناد والمستخدمون يبقون. ← { employees, assignments, users }
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.employees_purge()
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_e int; v_a int; v_u int;
begin
  perform support_tasks_dev.require_admin();
  update support_tasks_dev.profiles set employee_id = null where employee_id is not null;
  get diagnostics v_u = row_count;
  -- السجل لا يُكتب لكل صف محذوف (يُكتب سطر واحد في الآخر). علامة لهذه العملية فقط، بلا تعديل على الجداول
  perform set_config('support_tasks_dev.skip_audit', 'on', true);
  -- «where true»: Supabase يرفض DELETE بلا شرط (safeupdate). وTRUNCATE لا يصلح هنا لأن جدول المستخدمين يشير إلى الموظفين
  delete from support_tasks_dev.employee_assignments where true;
  get diagnostics v_a = row_count;
  delete from support_tasks_dev.employees where true;
  get diagnostics v_e = row_count;
  perform set_config('support_tasks_dev.skip_audit', 'off', true);
  delete from support_tasks_dev.org_audit where entity in ('employee', 'assignment');
  -- سطر واحد في السجل يبيّن الحذف ومن نفّذه
  insert into support_tasks_dev.org_audit (entity, entity_id, action, changed_by, new_data)
  values ('employee', 0, 'delete', auth.uid(), jsonb_build_object('name_ar', 'حذف كل الموظفين', 'employees', v_e, 'assignments', v_a));
  return jsonb_build_object('employees', v_e, 'assignments', v_a, 'users', v_u);
end $$;
revoke all on function support_tasks_dev.employees_purge() from public, anon;
grant execute on function support_tasks_dev.employees_purge() to authenticated, service_role;

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة,
       (select count(*) from support_tasks_dev.employees) as الموظفون,
       (select count(*) from support_tasks_dev.employees where needs_review) as تحتاج_مراجعة;


-- ===================== dev/sql/21_org_import.sql (قيد التطوير) =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 21: حذف الهيكل واستيراده من ملف — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev)، بعد 20_employees_review.sql. يُنفَّذ في Tasks-Test ← SQL Editor،
--  ويمكن إعادة تنفيذه بلا ضرر. التراجع: 21_org_import.undo.sql
--
--  org_purge()                 حذف كل الوحدات وسجلها، ومعها كل إسنادات الموظفين (المستويات والموظفون والأنواع تبقى)
--  org_import(items, replace)  استيراد شجرة جاهزة (الصفحة تقرأ الملف وتبنيها): الأعلى قبل ما تحته
--                              replace = حذف الهيكل الحالي ثم الاستيراد، في عملية واحدة (إن فشل الاستيراد لا يُحذف شيء)
--                              وإلا: الوحدة الموجودة (الاسم أو أحد أسمائها البديلة تحت الوحدة الأعلى نفسها) تُطابَق ولا تتكرر
--  قواعد الهيكل (المستوى الأعلى، عدم التكرار…) تبقى مفروضة بمشغّلات الوحدات نفسها
-- =====================================================================

-- حذف الوحدة (من 19): العلامة org_bulk تسمح بحذف الهيكل كله دفعة واحدة داخل org_purge فقط
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

-- الحذف نفسه (داخلي: تستدعيه org_purge وorg_import)
create or replace function support_tasks_dev.org_purge_inner()
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_u int; v_a int;
begin
  perform set_config('support_tasks_dev.skip_audit', 'on', true);
  perform set_config('support_tasks_dev.org_bulk', 'on', true);
  -- «where true»: Supabase يرفض DELETE بلا شرط
  delete from support_tasks_dev.employee_assignments where true;
  get diagnostics v_a = row_count;
  delete from support_tasks_dev.org_units where true;
  get diagnostics v_u = row_count;
  perform set_config('support_tasks_dev.org_bulk', 'off', true);
  perform set_config('support_tasks_dev.skip_audit', 'off', true);
  delete from support_tasks_dev.org_audit where entity in ('unit', 'assignment');
  insert into support_tasks_dev.org_audit (entity, entity_id, action, changed_by, new_data)
  values ('unit', 0, 'delete', auth.uid(), jsonb_build_object('name', 'حذف الهيكل', 'units', v_u, 'assignments', v_a));
  return jsonb_build_object('units', v_u, 'assignments', v_a);
end $$;
revoke all on function support_tasks_dev.org_purge_inner() from public, anon, authenticated;

-- حذف الهيكل (مدير النظام) ← { units, assignments }
create or replace function support_tasks_dev.org_purge()
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
begin
  perform support_tasks_dev.require_admin();
  return support_tasks_dev.org_purge_inner();
end $$;

-- استيراد الهيكل (مدير النظام)
-- items: [{ k: مفتاح الوحدة في الملف، p: مفتاح الوحدة الأعلى في الملف أو null، parent_id: وحدة أعلى موجودة أو null،
--           name، level_id، sort }]  مرتبة: الأعلى قبل ما تحته
-- ← { created, existing, purged_units, purged_assignments }
create or replace function support_tasks_dev.org_import(p jsonb, p_replace boolean default false)
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  r record; v_map jsonb := '{}'; v_parent int; v_id int; v_c int := 0; v_e int := 0; v_purge jsonb := '{}';
  v_name text;
begin
  perform support_tasks_dev.require_admin();
  if p_replace then v_purge := support_tasks_dev.org_purge_inner(); end if;
  for r in select * from jsonb_to_recordset(p) as x(k text, p text, parent_id int, name text, level_id int, sort int) loop
    v_name := btrim(regexp_replace(coalesce(r.name, ''), '\s+', ' ', 'g'));
    if r.p is not null then
      v_parent := (v_map ->> r.p)::int;
      if v_parent is null then perform support_tasks_dev.app_error(format('ترتيب الملف: «%s» قبل الوحدة الأعلى منها.', v_name)); end if;
    else
      v_parent := r.parent_id;
    end if;
    select u.id into v_id from support_tasks_dev.org_units u
    where coalesce(u.parent_id, 0) = coalesce(v_parent, 0)
      and (lower(btrim(u.name)) = lower(v_name) or exists (select 1 from unnest(u.aliases) a where lower(a) = lower(v_name)))
    order by (lower(btrim(u.name)) = lower(v_name)) desc, u.id
    limit 1;
    if v_id is null then
      insert into support_tasks_dev.org_units (parent_id, level_id, name, sort_order)
      values (v_parent, r.level_id, v_name, coalesce(r.sort, 0))
      returning id into v_id;
      v_c := v_c + 1;
    else
      v_e := v_e + 1;
    end if;
    v_map := v_map || jsonb_build_object(r.k, v_id);
  end loop;
  return jsonb_build_object('created', v_c, 'existing', v_e,
    'purged_units', coalesce((v_purge ->> 'units')::int, 0), 'purged_assignments', coalesce((v_purge ->> 'assignments')::int, 0));
end $$;

revoke all on function support_tasks_dev.org_purge(), support_tasks_dev.org_import(jsonb, boolean) from public, anon;
grant execute on function support_tasks_dev.org_purge(), support_tasks_dev.org_import(jsonb, boolean) to authenticated, service_role;

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة, (select count(*) from support_tasks_dev.org_units) as الوحدات;


-- ===================== dev/sql/22_assign_import.sql (قيد التطوير) =====================
-- =====================================================================
--  نظام مهام الدعم الفني — 22: إسناد الموظفين إلى وحداتهم دفعة واحدة (من ملف الهيكل) — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev)، بعد 21_org_import.sql. يُنفَّذ في Tasks-Test ← SQL Editor،
--  ويمكن إعادة تنفيذه بلا ضرر. التراجع: 22_assign_import.undo.sql
--
--  employees_assign_bulk(items, date, transfer) ← الصفحة تقرأ الملف وتطابق الموظفين (بالرقم الوظيفي) والوحدات (بالمسار)
--    items: [{ employee_id, unit_id, is_head }]   لكل موظف: إسناد «أصيل» من date
--    - بلا إسناد أصيل قائم في date ← إسناد جديد
--    - في الوحدة نفسها ← لا تغيير (وتُضاف الرئاسة إن طُلبت)
--    - في وحدة أخرى ← نقل (transfer = true) أو يُترك (false)
--    - الرئاسة تتعارض مع رئيس قائم للوحدة ← يُسند بلا رئاسة ويُذكر التعارض
--    - خطأ في موظف لا يوقف الباقين: يُذكر مع سببه
--  ← { created, unchanged, heads, transferred, skipped, head_conflicts: [...], failed: [...] }
--  قواعد الإسناد كلها (أصيل واحد، رئيس واحد، وحدة مفعّلة، موظف نشط) تبقى مفروضة بمشغّل الإسناد نفسه
-- =====================================================================

create or replace function support_tasks_dev.employees_assign_bulk(p jsonb, p_date date default current_date, p_transfer boolean default true)
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  r record; v_prim smallint; v_cur support_tasks_dev.employee_assignments;
  v_c int := 0; v_same int := 0; v_h int := 0; v_t int := 0; v_s int := 0;
  v_conf jsonb := '[]'; v_fail jsonb := '[]';
begin
  perform support_tasks_dev.require_admin();
  if p_date is null then perform support_tasks_dev.app_error('تاريخ بداية الإسناد مطلوب.'); end if;
  select id into v_prim from support_tasks_dev.assignment_types where is_primary;
  for r in select * from jsonb_to_recordset(p) as x(employee_id int, unit_id int, is_head boolean) loop
    begin
      select a.* into v_cur from support_tasks_dev.employee_assignments a
      where a.employee_id = r.employee_id and a.type_id = v_prim
        and a.start_date <= p_date and (a.end_date is null or a.end_date >= p_date)
      limit 1;
      if v_cur.id is null then
        begin
          insert into support_tasks_dev.employee_assignments (employee_id, unit_id, type_id, is_head, start_date)
          values (r.employee_id, r.unit_id, v_prim, coalesce(r.is_head, false), p_date);
          if r.is_head then v_h := v_h + 1; end if;
        exception when others then
          if not coalesce(r.is_head, false) then raise; end if;
          -- الرئاسة تتعارض: إسناد بلا رئاسة
          insert into support_tasks_dev.employee_assignments (employee_id, unit_id, type_id, is_head, start_date)
          values (r.employee_id, r.unit_id, v_prim, false, p_date);
          v_conf := v_conf || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
        end;
        v_c := v_c + 1;
      elsif v_cur.unit_id = r.unit_id then
        if coalesce(r.is_head, false) and not v_cur.is_head then
          begin
            update support_tasks_dev.employee_assignments set is_head = true where id = v_cur.id;
            v_h := v_h + 1;
          exception when others then
            v_conf := v_conf || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
          end;
        end if;
        v_same := v_same + 1;
      elsif p_transfer then
        begin
          perform support_tasks_dev.employee_transfer(r.employee_id, r.unit_id, p_date, coalesce(r.is_head, false));
          if r.is_head then v_h := v_h + 1; end if;
        exception when others then
          if not coalesce(r.is_head, false) then raise; end if;
          perform support_tasks_dev.employee_transfer(r.employee_id, r.unit_id, p_date, false);
          v_conf := v_conf || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
        end;
        v_t := v_t + 1;
      else
        v_s := v_s + 1;
      end if;
    exception when others then
      v_fail := v_fail || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', v_c, 'unchanged', v_same, 'heads', v_h, 'transferred', v_t, 'skipped', v_s,
    'head_conflicts', v_conf, 'failed', v_fail);
end $$;

revoke all on function support_tasks_dev.employees_assign_bulk(jsonb, date, boolean) from public, anon;
grant execute on function support_tasks_dev.employees_assign_bulk(jsonb, date, boolean) to authenticated, service_role;

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة, (select count(*) from support_tasks_dev.employee_assignments) as الإسنادات;

