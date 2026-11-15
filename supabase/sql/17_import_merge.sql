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
