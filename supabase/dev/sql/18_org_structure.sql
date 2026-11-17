-- =====================================================================
--  نظام مهام الدعم الفني — 18: الهيكل التنظيمي (المرحلة الأولى) — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev). يُنفَّذ في Tasks-Test ← SQL Editor، ويمكن إعادة تنفيذه بلا ضرر.
--  التراجع: 18_org_structure.undo.sql
--
--  الهيكل بيانات يدخلها مدير النظام من صفحة «الهيكل التنظيمي»، ولا شيء منه مكتوب في الكود:
--    org_levels  المستويات (مكتب الوزير، مكتب الوكيل، مديرية، دائرة، قسم…) بترتيب: الأصغر أعلى
--    org_units   الوحدات: كل وحدة تشير إلى وحدتها الأم (parent_id)، فتتكون شجرة بأي عمق
--    org_audit   سجل كل تغيير على المستويات والوحدات (يكتبه النظام تلقائياً)
--
--  القواعد (تفرضها قاعدة البيانات، لا المتصفح):
--    - الوحدة الأم في مستوى أعلى (ترتيبه أصغر): قسم تحت مديرية مباشرة مسموح، ومديرية تحت قسم لا
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

  -- الوحدة الأم: موجودة، في مستوى أعلى، وليست الوحدة نفسها أو إحدى التابعة لها
  if new.parent_id is not null then
    select * into v_parent from support_tasks_dev.org_units where id = new.parent_id;
    if v_parent.id is null then perform support_tasks_dev.app_error('الوحدة الأم غير موجودة.'); end if;
    select level_no into v_parent_no from support_tasks_dev.org_levels where id = v_parent.level_id;
    if v_parent_no >= v_level.level_no then
      perform support_tasks_dev.app_error(format('لا يمكن أن تتبع وحدة من مستوى «%s» وحدةً من مستوى «%s»: الوحدة الأم يجب أن تكون في مستوى أعلى.',
        v_level.name, (select name from support_tasks_dev.org_levels where id = v_parent.level_id)));
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id
       and new.parent_id in (select support_tasks_dev.org_subtree(new.id)) then
      perform support_tasks_dev.app_error('لا يمكن نقل الوحدة تحت نفسها أو تحت إحدى الوحدات التابعة لها.');
    end if;
    if new.is_active and not v_parent.is_active then
      perform support_tasks_dev.app_error(format('الوحدة الأم «%s» معطّلة؛ فعّلها أولاً.', v_parent.name));
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
