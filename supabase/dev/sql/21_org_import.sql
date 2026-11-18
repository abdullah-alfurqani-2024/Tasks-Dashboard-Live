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
