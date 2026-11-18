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
