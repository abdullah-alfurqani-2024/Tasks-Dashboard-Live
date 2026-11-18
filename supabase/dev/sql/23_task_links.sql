-- =====================================================================
--  نظام مهام الدعم الفني — 23: ربط المهام بالهيكل والموظفين (المرحلة الثالثة، بيئة التطوير)
--
--  «الجهة الطالبة» و«اسم الموظف» في المهمة يُختاران من الهيكل وقائمة الموظفين:
--    tasks.requester_unit_id ← الوحدة،   tasks.employee_id ← الموظف
--  ويبقى النصان (requester، employee_name) كما كُتبا: للمهام القديمة، وللنص الحر، وللإنتاج.
--
--  القواعد (مشغّل tasks_links، بعد tasks_before_write):
--    - اختيار الموظف يكتب اسمه، ويملأ الجهة الطالبة (إن كانت فارغة) من وحدته في تاريخ استقبال المهمة
--    - اختيار الوحدة يكتب اسمها؛ والوحدة أو الموظف غير النشط لا يُختار لمهمة (الموجود يبقى)
--    - أحد الحقلين على الأقل (للمهمة الجديدة، وعند تغيير الحقلين)، عدا الاستيراد
--    - النص الحر (جهة أو موظف غير موجود): بإعداد allow_unlisted (افتراضياً مفعّل).
--      المهمة غير المربوطة «تحتاج مراجعة» (needs_link في v_tasks) حتى تُربط
--  ربط المهام القديمة بالنصوص: tasks_link_texts (النصوص غير المربوطة) ثم tasks_link_apply (المطابقة من الواجهة).
--  الربط الجماعي وحذف الهيكل أو الموظفين لا يغيّر «آخر تعديل» ولا يُسجَّل في سجل المهمة.
--  دليل الموظفين للجميع بلا الرقم المدني: employee_directory.
--
--  بعد 18–22. يمكن إعادة تنفيذه بلا ضرر. التراجع: 23_task_links.undo.sql
-- =====================================================================

alter table support_tasks_dev.tasks add column if not exists requester_unit_id int
  references support_tasks_dev.org_units (id) on delete set null;
alter table support_tasks_dev.tasks add column if not exists employee_id int
  references support_tasks_dev.employees (id) on delete set null;
create index if not exists tasks_requester_unit_idx on support_tasks_dev.tasks (requester_unit_id) where requester_unit_id is not null;
create index if not exists tasks_employee_idx on support_tasks_dev.tasks (employee_id) where employee_id is not null;

-- إعداد منطقي (true/false) من app_settings
create or replace function support_tasks_dev.setting_on(p_key text, p_default boolean)
returns boolean
language sql stable security definer
set search_path = support_tasks_dev
as $$
  select coalesce((select case lower(value #>> '{}') when 'true' then true when 'false' then false end
                   from support_tasks_dev.app_settings where key = p_key), p_default)
$$;

-- عمليات جماعية لا تُعدّ تعديلاً للمهمة: الربط الجماعي، وحذف الهيكل أو الموظفين (فكّ الربط تلقائياً)
create or replace function support_tasks_dev.tasks_bulk_link()
returns boolean
language sql stable
as $$
  select coalesce(current_setting('support_tasks_dev.task_link', true), '') = 'on'
      or coalesce(current_setting('support_tasks_dev.org_bulk', true), '') = 'on'
      or coalesce(current_setting('support_tasks_dev.skip_audit', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------
-- قواعد الربط
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.tasks_links()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  v_unit support_tasks_dev.org_units;
  v_emp  support_tasks_dev.employees;
  v_old_unit_name text;
  v_review boolean := nullif(new.review_reasons, '{}') is not null;   -- مستوردة تنتظر المراجعة: تُحفظ كما هي
  v_import boolean := new.imported_at is not null and (tg_op = 'INSERT' or new.imported_at is distinct from old.imported_at);
begin
  if tg_op = 'UPDATE' and support_tasks_dev.tasks_bulk_link() then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- العرض يُظهر اسم الوحدة الحالي مكان النص القديم؛ إرجاعه كما هو ليس تغييراً
    if new.requester_unit_id is not distinct from old.requester_unit_id and old.requester_unit_id is not null then
      select name into v_old_unit_name from support_tasks_dev.org_units where id = old.requester_unit_id;
      if new.requester is not distinct from v_old_unit_name then new.requester := old.requester;
      elsif new.requester is distinct from old.requester then new.requester_unit_id := null;   -- كُتب نص آخر: فكّ الربط
      end if;
    end if;
    if new.employee_id is not null and new.employee_id = old.employee_id
       and new.employee_name is distinct from old.employee_name then
      if new.employee_name is not distinct from (select name_ar from support_tasks_dev.employees where id = new.employee_id) then
        null;
      else
        new.employee_id := null;
      end if;
    end if;
  end if;

  -- الموظف: اسمه، ووحدته في تاريخ المهمة إن لم تُحدَّد الجهة
  if new.employee_id is not null and (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id) then
    select * into v_emp from support_tasks_dev.employees where id = new.employee_id;
    if v_emp.id is null then perform support_tasks_dev.app_error('الموظف غير موجود في قائمة الموظفين.'); end if;
    if not v_emp.is_active then perform support_tasks_dev.app_error(format('الموظف «%s» غير نشط؛ اختر موظفاً آخر.', v_emp.name_ar)); end if;
    new.employee_name := v_emp.name_ar;
    if new.requester_unit_id is null and new.requester is null then
      select a.unit_id into new.requester_unit_id
      from support_tasks_dev.employee_assignments a
      join support_tasks_dev.assignment_types t on t.id = a.type_id
      where a.employee_id = v_emp.id
        and a.start_date <= coalesce(new.received_date, current_date)
        and (a.end_date is null or a.end_date >= coalesce(new.received_date, current_date))
      order by t.is_primary desc, a.start_date desc
      limit 1;
    end if;
  end if;

  -- الوحدة: اسمها
  if new.requester_unit_id is not null and (tg_op = 'INSERT' or new.requester_unit_id is distinct from old.requester_unit_id) then
    select * into v_unit from support_tasks_dev.org_units where id = new.requester_unit_id;
    if v_unit.id is null then perform support_tasks_dev.app_error('الجهة الطالبة غير موجودة في الهيكل التنظيمي.'); end if;
    if not v_unit.is_active then perform support_tasks_dev.app_error(format('الوحدة «%s» معطّلة؛ اختر وحدة أخرى.', v_unit.name)); end if;
    new.requester := v_unit.name;
  end if;

  if v_review or v_import then return new; end if;

  -- النص الحر: بإعداد مدير النظام
  if not support_tasks_dev.setting_on('allow_unlisted', true) then
    if new.requester is not null and new.requester_unit_id is null
       and (tg_op = 'INSERT' or new.requester is distinct from old.requester) then
      perform support_tasks_dev.app_error('اختر الجهة الطالبة من الهيكل التنظيمي.');
    end if;
    if new.employee_name is not null and new.employee_id is null
       and (tg_op = 'INSERT' or new.employee_name is distinct from old.employee_name) then
      perform support_tasks_dev.app_error('اختر اسم الموظف من قائمة الموظفين.');
    end if;
  end if;

  -- أحد الحقلين على الأقل
  if new.requester is null and new.employee_name is null
     and (tg_op = 'INSERT' or old.requester is not null or old.employee_name is not null) then
    perform support_tasks_dev.app_error('حدّد الجهة الطالبة أو اسم الموظف (أحدهما على الأقل).');
  end if;
  return new;
end $$;
revoke all on function support_tasks_dev.tasks_links() from public, anon;
drop trigger if exists tasks_links on support_tasks_dev.tasks;
create trigger tasks_links before insert or update on support_tasks_dev.tasks
  for each row execute function support_tasks_dev.tasks_links();

-- ---------------------------------------------------------------------
-- السجل (من 17): لا يسجّل العمليات الجماعية
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = support_tasks_dev
as $fn$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days', 'imported_at', 'imported_data'];
  v_fields text[];
  v_action text;
begin
  if tg_op = 'UPDATE' and support_tasks_dev.tasks_bulk_link() then return null; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and auth.uid() is distinct from new.created_by then
      v_new := v_new || jsonb_build_object('entered_by', auth.uid());
    end if;
    insert into support_tasks_dev.task_audit (task_id, action, changed_by, new_data)
    values (new.id, 'insert', new.created_by, v_new);
    return null;
  end if;

  v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'duration_days', 'imported_at', 'imported_data'];
  select array_agg(k order by k) into v_fields
  from jsonb_object_keys(v_new) k
  where v_new -> k is distinct from v_old -> k;

  if v_fields is null then return null; end if;

  v_action := case
    when old.deleted_at is null and new.deleted_at is not null then 'delete'
    when old.deleted_at is not null and new.deleted_at is null then 'restore'
    else 'update' end;

  insert into support_tasks_dev.task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (new.id, v_action, coalesce(auth.uid(), new.updated_by), v_fields,
          (select jsonb_object_agg(k, v_old -> k) from unnest(v_fields) k),
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k)
            || case when new.imported_at is distinct from old.imported_at then '{"via_import": true}'::jsonb else '{}'::jsonb end);
  return null;
end $fn$;

-- ---------------------------------------------------------------------
-- عرض المهام (من 16): الجهة الطالبة باسم وحدتها الحالي، والربط، و«تحتاج ربطاً»
-- ---------------------------------------------------------------------
drop view if exists support_tasks_dev.v_tasks;
create view support_tasks_dev.v_tasks
with (security_invoker = true) as
select
  t.id, t.engineer_id, p.full_name as engineer_name, p.short_name as engineer_short,
  t.ref_no, coalesce(u.name, t.requester) as requester, t.employee_name, t.subject,
  t.received_date, t.completed_date, t.notes,
  t.task_type_id, tt.name as task_type,
  t.correspondence_type_id, ct.name as correspondence_type,
  t.status_id, s.name as status, s.kind as status_kind,
  t.delay_reason, t.duration_days,
  t.created_at, t.created_by, t.updated_at, t.updated_by,
  t.deleted_at, t.deleted_by,
  t.review_reasons,
  t.priority,
  t.task_code, t.entered_at, t.imported_at, p.engineer_code,
  t.requester_unit_id, t.employee_id,
  (t.requester is not null and t.requester_unit_id is null) or (t.employee_name is not null and t.employee_id is null) as needs_link,
  t.requester as requester_text
from support_tasks_dev.tasks t
join support_tasks_dev.profiles p             on p.id = t.engineer_id
left join support_tasks_dev.task_types tt     on tt.id = t.task_type_id
left join support_tasks_dev.correspondence_types ct on ct.id = t.correspondence_type_id
join support_tasks_dev.task_statuses s        on s.id = t.status_id
left join support_tasks_dev.org_units u       on u.id = t.requester_unit_id;
grant select on support_tasks_dev.v_tasks to authenticated;
grant all on support_tasks_dev.v_tasks to service_role;

-- ---------------------------------------------------------------------
-- الوحدة المستخدمة في مهام لا تُحذف (من 21)
-- ---------------------------------------------------------------------
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
  select count(*) into v_n from support_tasks_dev.tasks where requester_unit_id = old.id;
  if v_n > 0 then
    perform support_tasks_dev.app_error(format('لا يمكن حذف «%s» لأنها الجهة الطالبة في %s مهمة؛ عطّلها بدلاً من حذفها.', old.name, v_n));
  end if;
  return old;
end $$;

-- ---------------------------------------------------------------------
-- ربط المهام القديمة (مدير النظام)
-- ---------------------------------------------------------------------
-- النصوص غير المربوطة وعدد مهام كل منها، وعدد المربوط
create or replace function support_tasks_dev.tasks_link_texts()
returns jsonb
language plpgsql stable security definer
set search_path = support_tasks_dev
as $$
begin
  perform support_tasks_dev.require_admin();
  return jsonb_build_object(
    'requesters', (select coalesce(jsonb_agg(jsonb_build_object('text', requester, 'n', n) order by n desc, requester), '[]')
                   from (select requester, count(*) n from support_tasks_dev.tasks
                         where requester is not null and requester_unit_id is null group by requester) x),
    'employees',  (select coalesce(jsonb_agg(jsonb_build_object('text', employee_name, 'n', n) order by n desc, employee_name), '[]')
                   from (select employee_name, count(*) n from support_tasks_dev.tasks
                         where employee_name is not null and employee_id is null group by employee_name) x),
    'linkedUnits', (select count(*) from support_tasks_dev.tasks where requester_unit_id is not null),
    'linkedEmployees', (select count(*) from support_tasks_dev.tasks where employee_id is not null),
    'tasks', (select count(*) from support_tasks_dev.tasks));
end $$;

-- p: [{ kind: 'unit' | 'employee', text, id }] ← { units, employees } عدد المهام المربوطة
-- يربط المهام غير المربوطة بالنص نفسه تماماً؛ النص يبقى كما كُتب
create or replace function support_tasks_dev.tasks_link_apply(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare v_u int; v_e int; v_bad text;
begin
  perform support_tasks_dev.require_admin();
  select x.text into v_bad from jsonb_to_recordset(p) as x(kind text, text text, id int)
  where (x.kind = 'unit' and not exists (select 1 from support_tasks_dev.org_units where id = x.id))
     or (x.kind = 'employee' and not exists (select 1 from support_tasks_dev.employees where id = x.id))
     or x.kind not in ('unit', 'employee')
  limit 1;
  if found then perform support_tasks_dev.app_error(format('«%s»: الوحدة أو الموظف غير موجود. حدّث الصفحة.', v_bad)); end if;
  perform set_config('support_tasks_dev.task_link', 'on', true);
  update support_tasks_dev.tasks t set requester_unit_id = x.id
  from (select distinct on (text) text, id from jsonb_to_recordset(p) as x(kind text, text text, id int) where kind = 'unit') x
  where t.requester = x.text and t.requester_unit_id is null;
  get diagnostics v_u = row_count;
  update support_tasks_dev.tasks t set employee_id = x.id
  from (select distinct on (text) text, id from jsonb_to_recordset(p) as x(kind text, text text, id int) where kind = 'employee') x
  where t.employee_name = x.text and t.employee_id is null;
  get diagnostics v_e = row_count;
  perform set_config('support_tasks_dev.task_link', '', true);
  return jsonb_build_object('units', v_u, 'employees', v_e);
end $$;

-- ---------------------------------------------------------------------
-- دليل الموظفين لكل المستخدمين (لاختيار اسم الموظف في المهمة)، بلا الرقم المدني
-- ← { employees: [[id, الاسم, الرقم الوظيفي, نشط]], assignments: [[الموظف, الوحدة, البداية, النهاية, أصيل]] }
-- ---------------------------------------------------------------------
create or replace function support_tasks_dev.employee_directory()
returns jsonb
language plpgsql stable security definer
set search_path = support_tasks_dev
as $$
begin
  if support_tasks_dev.app_role() is null then perform support_tasks_dev.app_error('حسابك غير مفعّل.'); end if;
  return jsonb_build_object(
    'employees', (select coalesce(jsonb_agg(jsonb_build_array(id, name_ar, employee_no, is_active) order by name_ar), '[]')
                  from support_tasks_dev.employees),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_array(a.employee_id, a.unit_id, a.start_date, a.end_date, t.is_primary)), '[]')
                    from support_tasks_dev.employee_assignments a join support_tasks_dev.assignment_types t on t.id = a.type_id));
end $$;

revoke all on function support_tasks_dev.setting_on(text, boolean), support_tasks_dev.tasks_bulk_link(),
  support_tasks_dev.tasks_link_texts(), support_tasks_dev.tasks_link_apply(jsonb), support_tasks_dev.employee_directory() from public, anon;
grant execute on function support_tasks_dev.setting_on(text, boolean), support_tasks_dev.tasks_bulk_link(),
  support_tasks_dev.tasks_link_texts(), support_tasks_dev.tasks_link_apply(jsonb), support_tasks_dev.employee_directory() to authenticated, service_role;

-- التحقق: كل القيم true
select
  exists (select 1 from information_schema.columns where table_schema = 'support_tasks_dev' and table_name = 'tasks' and column_name = 'requester_unit_id') as ربط_الجهة,
  exists (select 1 from information_schema.columns where table_schema = 'support_tasks_dev' and table_name = 'tasks' and column_name = 'employee_id') as ربط_الموظف,
  exists (select 1 from information_schema.columns where table_schema = 'support_tasks_dev' and table_name = 'v_tasks' and column_name = 'needs_link') as العرض,
  exists (select 1 from pg_trigger where tgname = 'tasks_links' and tgrelid = 'support_tasks_dev.tasks'::regclass) as المشغّل;
