-- =====================================================================
--  نظام مهام الدعم الفني — 01: الجداول
--  يُنفَّذ أولاً في Supabase ← SQL Editor
--  SQL قياسي لـ PostgreSQL. الارتباط الوحيد بـ Supabase: profiles.id يشير إلى auth.users
-- =====================================================================

-- كل جداول النظام في سكيما مستقلة حتى لا تختلط بجداولك الأخرى في public
-- (لتغيير الاسم: استبدل support_tasks بالاسم الجديد في كل ملفات SQL وفي js/config.js ودالة admin-users)
create schema if not exists support_tasks;

-- أنواع ثابتة
do $$ begin
  create type support_tasks.user_role as enum ('admin', 'head', 'engineer', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_tasks.status_kind as enum ('open', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- المستخدمون: صف لكل حساب دخول (ينشئه مدير النظام)
--   admin    مدير النظام: كل الصلاحيات
--   head     رئيس القسم: كل المهام والتقارير والقوائم، بدون المستخدمين والإعدادات والحذف
--   engineer مهندس: مهامه فقط
--   viewer   مشاهد: التقارير والمهام للقراءة فقط
-- ---------------------------------------------------------------------
create table if not exists support_tasks.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null unique,
  full_name            text not null,
  short_name           text,
  role                 support_tasks.user_role not null default 'engineer',
  is_active            boolean not null default true,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- القوائم: نوع المهمة، نوع المراسلة، الحالة
-- لا تُحذف القيم المستخدمة؛ تُعطَّل (is_active = false) فتختفي من الاختيار وتبقى في المهام القديمة
-- ---------------------------------------------------------------------
create table if not exists support_tasks.task_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists support_tasks.correspondence_types (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  sort_order int not null default 0,
  is_active  boolean not null default true
);

create table if not exists support_tasks.task_statuses (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  kind       support_tasks.status_kind not null default 'open',   -- open = مفتوحة، done = مكتملة، cancelled = ملغاة
  sort_order int not null default 0,
  is_active  boolean not null default true
);

-- ---------------------------------------------------------------------
-- المهام
-- ---------------------------------------------------------------------
create table if not exists support_tasks.tasks (
  id                     bigint generated always as identity primary key,
  engineer_id            uuid not null references support_tasks.profiles (id),
  ref_no                 text,                                   -- رقم القيد (نص: قد يحتوي / أو حروفاً)
  requester              text,                                   -- الجهة الطالبة
  employee_name          text,                                   -- اسم الموظف
  subject                text not null,                          -- الموضوع
  received_date          date not null,                          -- تاريخ الاستقبال
  completed_date         date,                                   -- تاريخ الانتهاء (للمكتملة)
  notes                  text,                                   -- الملاحظات
  task_type_id           smallint references support_tasks.task_types (id),
  correspondence_type_id smallint references support_tasks.correspondence_types (id),
  status_id              smallint not null references support_tasks.task_statuses (id),
  delay_reason           text,                                   -- سبب تأخير إنجاز المهمة
  duration_days          int generated always as (completed_date - received_date) stored,  -- المدة
  created_at             timestamptz not null default now(),     -- تاريخ الإدخال
  created_by             uuid references support_tasks.profiles (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references support_tasks.profiles (id),
  deleted_at             timestamptz,                            -- حذف ناعم
  deleted_by             uuid references support_tasks.profiles (id),
  review_reasons         text[],                                 -- أسباب المراجعة من الاستيراد (10_review.sql)
  constraint tasks_dates_chk check (completed_date is null or completed_date >= received_date)
);

create index if not exists tasks_engineer_idx on support_tasks.tasks (engineer_id, received_date desc) where deleted_at is null;
create index if not exists tasks_received_idx on support_tasks.tasks (received_date desc) where deleted_at is null;
create index if not exists tasks_status_idx   on support_tasks.tasks (status_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- الإعدادات العامة (يعدّلها مدير النظام)
-- ---------------------------------------------------------------------
create table if not exists support_tasks.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references support_tasks.profiles (id)
);

-- ---------------------------------------------------------------------
-- سجل التعديلات على المهام (يكتبه النظام تلقائياً)
-- ---------------------------------------------------------------------
create table if not exists support_tasks.task_audit (
  id             bigint generated always as identity primary key,
  task_id        bigint not null,
  action         text not null check (action in ('insert', 'update', 'delete', 'restore')),
  changed_by     uuid references support_tasks.profiles (id),
  changed_at     timestamptz not null default now(),
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb
);

create index if not exists task_audit_task_idx on support_tasks.task_audit (task_id, changed_at desc);
create index if not exists task_audit_time_idx on support_tasks.task_audit (changed_at desc);

-- ---------------------------------------------------------------------
-- عرض المهام مع الأسماء (يخضع لصلاحيات الجداول نفسها)
-- ---------------------------------------------------------------------
create or replace view support_tasks.v_tasks
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
from support_tasks.tasks t
join support_tasks.profiles p             on p.id = t.engineer_id
left join support_tasks.task_types tt     on tt.id = t.task_type_id
left join support_tasks.correspondence_types ct on ct.id = t.correspondence_type_id
join support_tasks.task_statuses s        on s.id = t.status_id;

-- ---------------------------------------------------------------------
-- تفعيل Row Level Security فوراً على كل جدول
-- (السياسات نفسها في 03_security.sql، وحتى تنفيذه يبقى كل جدول مغلقاً على الجميع)
-- ---------------------------------------------------------------------
alter table support_tasks.profiles             enable row level security;
alter table support_tasks.task_types           enable row level security;
alter table support_tasks.correspondence_types enable row level security;
alter table support_tasks.task_statuses        enable row level security;
alter table support_tasks.tasks                enable row level security;
alter table support_tasks.app_settings         enable row level security;
alter table support_tasks.task_audit           enable row level security;
